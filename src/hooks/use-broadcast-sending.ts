'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Contact, MessageTemplate } from '@/types';

export type CustomFieldOperator = 'is' | 'is_not' | 'contains';

export interface CustomFieldFilter {
  fieldId: string;
  operator: CustomFieldOperator;
  value: string;
}

export interface AudienceConfig {
  type: 'all' | 'tags' | 'custom_field' | 'csv' | 'lead_base';
  tagIds?: string[];
  customField?: CustomFieldFilter;
  csvContacts?: { phone: string; name?: string }[];
  /** Contacts carrying any of these tags are subtracted from the result. */
  excludeTagIds?: string[];
  /** Set when `type === 'lead_base'` — every contact in this base
   *  (see 047_lead_bases.sql). Used by the Campanha form's "create a
   *  new broadcast" action, which always targets its own lead base. */
  leadBaseId?: string;
}

/**
 * Variable mapping — each template placeholder (by key, usually "1",
 * "2", …) is resolved at send time. `field` maps to a built-in contact
 * field (name/phone/email/company); `custom_field` maps to a
 * contact_custom_values.value row keyed by the custom_fields.id stored
 * in `value`.
 */
export type VariableMapping =
  | { type: 'static'; value: string }
  | { type: 'field'; value: string }
  | { type: 'custom_field'; value: string };

interface BroadcastPayload {
  name: string;
  template: MessageTemplate;
  audience: AudienceConfig;
  variables: Record<string, VariableMapping>;
  /**
   * Media URL for an IMAGE/VIDEO/DOCUMENT header. Required at send
   * time for media-header templates — Meta rejects the send without
   * it. Passed through as `messageParams.headerMediaUrl`; the builder
   * falls back to the template's stored URL only when this is empty.
   */
  headerMediaUrl?: string;
  /** Send from this specific number instead of the account default. */
  channelId?: string | null;
  /**
   * Marks this campaign for the dashboard's invite widgets and the
   * webhook's RSVP correlation (`broadcast_recipients.rsvp_choice`).
   * Null/undefined for a regular broadcast — no behavior change.
   */
  campaignKind?: 'event_invite' | null;
}

interface UseBroadcastSendingReturn {
  createAndSendBroadcast: (payload: BroadcastPayload) => Promise<string>;
  /** Re-sends the template to every recipient currently `failed` on an
   *  existing broadcast, reusing its stored template/variables/channel.
   *  Returns how many of those retried recipients ended up sent. */
  retryFailedRecipients: (broadcastId: string) => Promise<{ retried: number; stillFailed: number }>;
  isProcessing: boolean;
  progress: number;
}

/**
 * Meta rate-limit buffer. 10 per batch + 1 s pause matches the spec
 * and keeps us comfortably under Meta's per-phone-number messaging
 * rate so a large broadcast never trips the upstream limiter.
 */
const SEND_BATCH_SIZE = 10;
const SEND_BATCH_DELAY_MS = 1000;

/** `broadcast_recipients` inserts are independent of the send rate. */
const INSERT_BATCH_SIZE = 200;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface BroadcastApiResult {
  phone: string;
  status: 'sent' | 'failed';
  whatsapp_message_id?: string;
  error?: string;
}

/** contactId → (customFieldId → value). */
type CustomValueIndex = Map<string, Map<string, string>>;

/**
 * Per-contact resolution of custom-field placeholders. Static and
 * built-in-field mappings resolve synchronously; custom fields read
 * from a pre-built index to avoid N+1 queries during the send loop.
 */
export function resolveVariables(
  variables: Record<string, VariableMapping>,
  contact: Contact,
  customValues?: Map<string, string>,
): string[] {
  // Keys are typically "1","2",... — numeric-aware sort keeps
  // {{1}} before {{10}}.
  const keys = Object.keys(variables).sort((a, b) => {
    const an = Number(a);
    const bn = Number(b);
    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
    return a.localeCompare(b);
  });

  return keys.map((key) => {
    const v = variables[key];
    if (v.type === 'static') return v.value;

    if (v.type === 'field') {
      const fieldMap: Record<string, string | undefined> = {
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
        company: contact.company,
      };
      return fieldMap[v.value] ?? '';
    }

    // custom_field
    return customValues?.get(v.value) ?? '';
  });
}

/**
 * Bulk-fetch contact_custom_values for a set of contacts. Returns an
 * index keyed by contact_id → field_id → value.
 */
async function fetchCustomValueIndex(
  supabase: ReturnType<typeof createClient>,
  contactIds: string[],
): Promise<CustomValueIndex> {
  const index: CustomValueIndex = new Map();
  if (contactIds.length === 0) return index;

  // Supabase PostgREST caps the .in(...) IN-clause roughly at 1000
  // values. Page through to stay safe.
  const PAGE = 500;
  for (let i = 0; i < contactIds.length; i += PAGE) {
    const slice = contactIds.slice(i, i + PAGE);
    const { data } = await supabase
      .from('contact_custom_values')
      .select('contact_id, custom_field_id, value')
      .in('contact_id', slice);

    for (const row of data ?? []) {
      const bucket = index.get(row.contact_id) ?? new Map<string, string>();
      bucket.set(row.custom_field_id, row.value ?? '');
      index.set(row.contact_id, bucket);
    }
  }
  return index;
}

export function useBroadcastSending(): UseBroadcastSendingReturn {
  const { accountId } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  async function resolveAudience(audience: AudienceConfig): Promise<Contact[]> {
    const supabase = createClient();

    let contacts: Contact[] = [];

    if (audience.type === 'all') {
      const { data, error } = await supabase.from('contacts').select('*');
      if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
      contacts = data ?? [];
    } else if (
      audience.type === 'tags' &&
      audience.tagIds &&
      audience.tagIds.length > 0
    ) {
      const { data: contactTags, error: tagError } = await supabase
        .from('contact_tags')
        .select('contact_id')
        .in('tag_id', audience.tagIds);

      if (tagError)
        throw new Error(`Failed to fetch contact tags: ${tagError.message}`);

      if (contactTags && contactTags.length > 0) {
        const uniqueContactIds = [
          ...new Set(contactTags.map((ct) => ct.contact_id)),
        ];
        const { data, error } = await supabase
          .from('contacts')
          .select('*')
          .in('id', uniqueContactIds);
        if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
        contacts = data ?? [];
      }
    } else if (audience.type === 'custom_field' && audience.customField) {
      contacts = await resolveCustomFieldAudience(supabase, audience.customField);
    } else if (audience.type === 'csv' && audience.csvContacts) {
      contacts = await upsertCsvContacts(supabase, audience.csvContacts);
    } else if (audience.type === 'lead_base' && audience.leadBaseId) {
      const { data, error } = await supabase
        .from('contacts')
        .select('*')
        .eq('lead_base_id', audience.leadBaseId);
      if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
      contacts = data ?? [];
    }

    // Apply exclude tags (works across all contact-derived audience
    // types). CSV contacts are synthetic so exclusion doesn't apply.
    if (audience.excludeTagIds && audience.excludeTagIds.length > 0) {
      const { data: excludeRows } = await supabase
        .from('contact_tags')
        .select('contact_id')
        .in('tag_id', audience.excludeTagIds);
      const excludedIds = new Set((excludeRows ?? []).map((r) => r.contact_id));
      contacts = contacts.filter((c) => !excludedIds.has(c.id));
    }

    return contacts;
  }

  /**
   * CSV uploads arrive as raw phone/name pairs, not DB rows. Before we
   * can insert broadcast_recipients (whose contact_id FKs contacts.id),
   * we need real contacts.id UUIDs. So: look up each CSV phone in the
   * caller's contacts table; insert any that don't exist; return the
   * resolved set.
   *
   * Pre-existing implementation synthesized `csv-N` strings as
   * contact_id, which failed the UUID cast on insert — every CSV
   * broadcast silently created zero recipients.
   */
  async function upsertCsvContacts(
    supabase: ReturnType<typeof createClient>,
    csvRows: { phone: string; name?: string }[],
  ): Promise<Contact[]> {
    if (csvRows.length === 0) return [];

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      throw new Error('You are not signed in.');
    }
    if (!accountId) {
      throw new Error('Your profile is not linked to an account.');
    }

    // De-duplicate by phone within the CSV (users can paste duplicates).
    const uniqueByPhone = new Map<string, { phone: string; name?: string }>();
    for (const row of csvRows) {
      if (row.phone) uniqueByPhone.set(row.phone, row);
    }
    const phones = [...uniqueByPhone.keys()];

    // Single round-trip lookup of existing contacts by phone.
    const { data: existing, error: lookupErr } = await supabase
      .from('contacts')
      .select('*')
      .eq('user_id', user.id)
      .in('phone', phones);
    if (lookupErr) {
      throw new Error(`Failed to look up CSV contacts: ${lookupErr.message}`);
    }

    const byPhone = new Map<string, Contact>();
    for (const c of (existing ?? []) as Contact[]) {
      if (c.phone) byPhone.set(c.phone, c);
    }

    // Insert only missing contacts, in one batch per 200 rows (PostgREST
    // has a default payload cap — 200 keeps individual requests small).
    const missing = phones
      .filter((p) => !byPhone.has(p))
      .map((phone) => ({
        user_id: user.id,
        account_id: accountId,
        phone,
        name: uniqueByPhone.get(phone)?.name ?? null,
      }));

    const INSERT_CHUNK = 200;
    for (let i = 0; i < missing.length; i += INSERT_CHUNK) {
      const chunk = missing.slice(i, i + INSERT_CHUNK);
      const { data: inserted, error: insertErr } = await supabase
        .from('contacts')
        .insert(chunk)
        .select();
      if (insertErr) {
        throw new Error(`Failed to create CSV contacts: ${insertErr.message}`);
      }
      for (const c of (inserted ?? []) as Contact[]) {
        if (c.phone) byPhone.set(c.phone, c);
      }
    }

    // Preserve input order so analytics roughly matches the CSV order.
    return phones
      .map((p) => byPhone.get(p))
      .filter((c): c is Contact => Boolean(c));
  }

  async function resolveCustomFieldAudience(
    supabase: ReturnType<typeof createClient>,
    filter: CustomFieldFilter,
  ): Promise<Contact[]> {
    const { fieldId, operator, value } = filter;

    // Build the WHERE clause for the operator. PostgREST supports
    // eq/neq/ilike via the query builder — use ilike with wildcards
    // for "contains" so the match is case-insensitive.
    let query = supabase
      .from('contact_custom_values')
      .select('contact_id')
      .eq('custom_field_id', fieldId);

    if (operator === 'is') query = query.eq('value', value);
    else if (operator === 'is_not') query = query.neq('value', value);
    else if (operator === 'contains') query = query.ilike('value', `%${value}%`);

    const { data: matches, error: matchErr } = await query;
    if (matchErr)
      throw new Error(`Custom-field filter failed: ${matchErr.message}`);

    const contactIds = [...new Set((matches ?? []).map((m) => m.contact_id))];
    if (contactIds.length === 0) return [];

    const { data, error } = await supabase
      .from('contacts')
      .select('*')
      .in('id', contactIds);
    if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
    return data ?? [];
  }

  interface SendableRecipient {
    id: string;
    contact: Contact | null;
  }

  /** Positional {{1}}/{{2}}… substitution for a readable Inbox preview
   *  of a sent template — not full Meta-parity rendering, just enough
   *  for the conversation list/bubble to show something meaningful. */
  function renderTemplatePreview(
    bodyText: string | null | undefined,
    templateName: string,
    params: string[],
  ): string {
    let body = bodyText || templateName;
    params.forEach((val, i) => {
      body = body.split(`{{${i + 1}}}`).join(val || '');
    });
    return body;
  }

  /** Find (oldest-first) or create the single conversation for
   *  (accountId, contactId) — same one-per-pair convention the inbound
   *  webhook uses. Re-resolves on a unique-index race instead of
   *  failing, so a reply landing at the same instant can't 23505 this. */
  async function findOrCreateConversationForContact(
    supabase: ReturnType<typeof createClient>,
    accountId: string,
    contactId: string,
    userId: string,
  ): Promise<string | null> {
    const { data: existing } = await supabase
      .from('conversations')
      .select('id')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: true })
      .limit(1);
    if (existing && existing.length > 0) return existing[0].id as string;

    const { data: created, error } = await supabase
      .from('conversations')
      .insert({ account_id: accountId, user_id: userId, contact_id: contactId, status: 'open', unread_count: 0 })
      .select('id')
      .single();
    if (!error && created) return created.id as string;

    const { data: raced } = await supabase
      .from('conversations')
      .select('id')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: true })
      .limit(1);
    return (raced?.[0]?.id as string | undefined) ?? null;
  }

  /**
   * Mirrors a successfully-sent broadcast message into the Inbox, so
   * every recipient shows up as a conversation with the sent template
   * visible — not just the ones who happened to reply. Best-effort:
   * callers swallow its errors, since a mirroring hiccup must never
   * affect the actual send/delivery bookkeeping.
   */
  async function mirrorSentBroadcastToInbox(
    supabase: ReturnType<typeof createClient>,
    accountId: string,
    userId: string,
    contact: Contact,
    template: MessageTemplate,
    params: string[],
    whatsappMessageId: string | null,
  ): Promise<void> {
    const conversationId = await findOrCreateConversationForContact(supabase, accountId, contact.id, userId);
    if (!conversationId) return;
    const preview = renderTemplatePreview(template.body_text, template.name, params);
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_type: 'agent',
      content_type: 'template',
      content_text: preview,
      template_name: template.name,
      message_id: whatsappMessageId,
      status: 'sent',
    });
    await supabase
      .from('conversations')
      .update({
        last_message_text: preview,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId);
  }

  /**
   * Batched send loop shared by a fresh broadcast and a failed-recipient
   * retry: sends `SEND_BATCH_SIZE` at a time via `/api/whatsapp/broadcast`,
   * stamping each `broadcast_recipients` row with the result. `onProgress`
   * receives a 0..1 fraction so callers can map it into their own overall
   * progress range.
   *
   * `headerMediaUrl` is the wizard's upload/paste override for a
   * media-header template (persisted on `broadcasts.header_media_url`
   * so a retry can reapply the exact same one); undefined falls back
   * to the template's own stored `header_media_url` server-side.
   */
  async function sendRecipientBatches(
    supabase: ReturnType<typeof createClient>,
    recipients: SendableRecipient[],
    template: MessageTemplate,
    variables: Record<string, VariableMapping>,
    channelId: string | null | undefined,
    headerMediaUrl: string | undefined,
    onProgress: (fraction: number) => void,
  ): Promise<{ failedCount: number }> {
    let failedCount = 0;
    const totalRecipients = recipients.length;

    const contactIds = recipients
      .map((r) => r.contact?.id)
      .filter((id): id is string => Boolean(id));
    const customValueIndex = await fetchCustomValueIndex(supabase, contactIds);

    // Needed to mirror sends into the Inbox (conversations.user_id /
    // messages audit trail) — resolved once up front rather than per
    // recipient.
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const senderUserId = session?.user?.id;

    const headerType = template.header_type;
    const isMediaHeader =
      headerType === 'image' || headerType === 'video' || headerType === 'document';
    const messageParams =
      isMediaHeader && headerMediaUrl ? { headerMediaUrl } : undefined;

    for (let i = 0; i < recipients.length; i += SEND_BATCH_SIZE) {
      const batch = recipients.slice(i, i + SEND_BATCH_SIZE);

      const paramsByRecipientId = new Map<string, string[]>();
      const apiRecipients = batch
        .filter((r) => r.contact?.phone)
        .map((r) => {
          const params = r.contact
            ? resolveVariables(variables, r.contact, customValueIndex.get(r.contact.id))
            : [];
          paramsByRecipientId.set(r.id, params);
          return {
            phone: r.contact!.phone as string,
            params,
            ...(messageParams ? { messageParams } : {}),
          };
        });

      if (apiRecipients.length === 0) continue;

      try {
        const res = await fetch('/api/whatsapp/broadcast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipients: apiRecipients,
            template_name: template.name,
            template_language: template.language ?? 'en_US',
            channel_id: channelId || undefined,
          }),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || 'Broadcast API request failed');
        }

        const resultsByPhone = new Map<string, BroadcastApiResult>();
        for (const r of (data.results ?? []) as BroadcastApiResult[]) {
          resultsByPhone.set(r.phone, r);
        }

        for (const recipient of batch) {
          const phone = recipient.contact?.phone;
          const result = phone ? resultsByPhone.get(phone) : undefined;

          if (!result) {
            failedCount++;
            await supabase
              .from('broadcast_recipients')
              .update({
                status: 'failed',
                error_message: 'No phone number on contact',
              })
              .eq('id', recipient.id);
            continue;
          }

          if (result.status === 'sent') {
            await supabase
              .from('broadcast_recipients')
              .update({
                status: 'sent',
                sent_at: new Date().toISOString(),
                whatsapp_message_id: result.whatsapp_message_id ?? null,
                error_message: null,
              })
              .eq('id', recipient.id);

            if (accountId && senderUserId && recipient.contact) {
              try {
                await mirrorSentBroadcastToInbox(
                  supabase,
                  accountId,
                  senderUserId,
                  recipient.contact,
                  template,
                  paramsByRecipientId.get(recipient.id) ?? [],
                  result.whatsapp_message_id ?? null,
                );
              } catch (mirrorErr) {
                console.error('[broadcast] failed to mirror sent message into Inbox:', mirrorErr);
              }
            }
          } else {
            failedCount++;
            await supabase
              .from('broadcast_recipients')
              .update({
                status: 'failed',
                error_message: result.error ?? 'Unknown error',
              })
              .eq('id', recipient.id);
          }
        }
      } catch (err) {
        for (const recipient of batch) {
          failedCount++;
          await supabase
            .from('broadcast_recipients')
            .update({
              status: 'failed',
              error_message: err instanceof Error ? err.message : 'Unknown error',
            })
            .eq('id', recipient.id);
        }
      }

      onProgress((i + batch.length) / totalRecipients);

      if (i + SEND_BATCH_SIZE < recipients.length) {
        await sleep(SEND_BATCH_DELAY_MS);
      }
    }

    return { failedCount };
  }

  async function retryFailedRecipients(
    broadcastId: string,
  ): Promise<{ retried: number; stillFailed: number }> {
    setIsProcessing(true);
    setProgress(0);
    const supabase = createClient();

    try {
      const { data: broadcast, error: bErr } = await supabase
        .from('broadcasts')
        .select('*')
        .eq('id', broadcastId)
        .single();
      if (bErr || !broadcast) throw new Error('Broadcast not found.');

      const { data: templateRow, error: tErr } = await supabase
        .from('message_templates')
        .select('*')
        .eq('account_id', broadcast.account_id)
        .eq('name', broadcast.template_name)
        .eq('language', broadcast.template_language)
        .maybeSingle();
      if (tErr || !templateRow) {
        throw new Error('Template not found — it may have been deleted or renamed since this broadcast was sent.');
      }

      setProgress(10);
      const { data: failedRows, error: rErr } = await supabase
        .from('broadcast_recipients')
        .select('id, contact:contacts(*)')
        .eq('broadcast_id', broadcastId)
        .eq('status', 'failed');
      if (rErr) throw new Error('Failed to load failed recipients.');

      const recipients = (failedRows ?? []) as unknown as SendableRecipient[];
      if (recipients.length === 0) {
        return { retried: 0, stillFailed: 0 };
      }

      const { failedCount } = await sendRecipientBatches(
        supabase,
        recipients,
        templateRow as unknown as MessageTemplate,
        (broadcast.template_variables ?? {}) as Record<string, VariableMapping>,
        broadcast.channel_id,
        (broadcast.header_media_url as string | null | undefined) ?? undefined,
        (fraction) => setProgress(10 + Math.round(fraction * 85)),
      );

      // Only flip back to 'sent' when at least one retry actually went
      // through — otherwise leave the broadcast's terminal status as-is
      // rather than implying progress that didn't happen.
      if (failedCount < recipients.length) {
        await supabase.from('broadcasts').update({ status: 'sent' }).eq('id', broadcastId);
      }

      setProgress(100);
      return { retried: recipients.length - failedCount, stillFailed: failedCount };
    } finally {
      setIsProcessing(false);
    }
  }

  async function createAndSendBroadcast(payload: BroadcastPayload): Promise<string> {
    setIsProcessing(true);
    setProgress(0);

    const supabase = createClient();

    try {
      // ── Step 0: Resolve current user ──────────────────────────────
      // broadcasts.user_id is NOT NULL + guarded by RLS
      // (auth.uid() = user_id). Without this, the INSERT below was
      // silently failing with 23502 / 42501 — the wizard would
      // no-op with no feedback.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) {
        throw new Error('You are not signed in.');
      }
      if (!accountId) {
        throw new Error('Your profile is not linked to an account.');
      }

      // ── Step 1: Resolve audience contacts ─────────────────────────
      setProgress(5);
      const contacts = await resolveAudience(payload.audience);

      if (contacts.length === 0) {
        throw new Error('No contacts found for this audience.');
      }

      // ── Step 2: Create broadcast row ──────────────────────────────
      setProgress(10);
      const { data: broadcast, error: broadcastError } = await supabase
        .from('broadcasts')
        .insert({
          user_id: user.id,
          account_id: accountId,
          name: payload.name,
          template_name: payload.template.name,
          template_language: payload.template.language ?? 'en_US',
          template_variables: payload.variables,
          audience_filter: {
            type: payload.audience.type,
            tagIds: payload.audience.tagIds,
            customField: payload.audience.customField,
            excludeTagIds: payload.audience.excludeTagIds,
            leadBaseId: payload.audience.leadBaseId,
          },
          channel_id: payload.channelId || null,
          header_media_url: payload.headerMediaUrl?.trim() || null,
          campaign_kind: payload.campaignKind || null,
          status: 'sending',
          total_recipients: contacts.length,
          sent_count: 0,
          delivered_count: 0,
          read_count: 0,
          replied_count: 0,
          failed_count: 0,
        })
        .select()
        .single();

      if (broadcastError || !broadcast) {
        throw new Error(
          `Failed to create broadcast: ${broadcastError?.message ?? 'unknown error'}`,
        );
      }

      // ── Step 3: Insert recipient rows ─────────────────────────────
      setProgress(20);
      const recipientRows = contacts.map((contact) => ({
        broadcast_id: broadcast.id,
        contact_id: contact.id,
        status: 'pending' as const,
      }));

      for (let i = 0; i < recipientRows.length; i += INSERT_BATCH_SIZE) {
        const batch = recipientRows.slice(i, i + INSERT_BATCH_SIZE);
        const { error: recipientError } = await supabase
          .from('broadcast_recipients')
          .insert(batch);
        if (recipientError) {
          // Previous impl logged and marched on — the broadcast then ran
          // with an incomplete recipient set, so webhook status updates
          // couldn't find some rows and the aggregate counts drifted.
          // Flip the broadcast to failed so the user sees the problem
          // immediately, then throw to abort the send loop.
          await supabase
            .from('broadcasts')
            .update({
              status: 'failed',
              failed_count: contacts.length,
            })
            .eq('id', broadcast.id);
          throw new Error(
            `Failed to insert recipient batch ${i / INSERT_BATCH_SIZE + 1}: ${recipientError.message}`,
          );
        }
      }

      // ── Step 4: Fetch recipients (joined contact) + preload custom values
      setProgress(30);
      const { data: recipients, error: recipientsFetchError } = await supabase
        .from('broadcast_recipients')
        .select('*, contact:contacts(*)')
        .eq('broadcast_id', broadcast.id);

      if (recipientsFetchError || !recipients) {
        throw new Error('Failed to fetch broadcast recipients');
      }

      const totalRecipients = recipients.length;
      const { failedCount } = await sendRecipientBatches(
        supabase,
        recipients,
        payload.template,
        payload.variables,
        payload.channelId,
        payload.headerMediaUrl?.trim(),
        (fraction) => setProgress(30 + Math.round(fraction * 60)),
      );

      // ── Step 5: Finalize status ───────────────────────────────────
      // Aggregate counts are maintained by the DB trigger (migration
      // 003); we only flip the final status here.
      setProgress(95);
      const finalStatus = failedCount === totalRecipients ? 'failed' : 'sent';
      await supabase
        .from('broadcasts')
        .update({ status: finalStatus })
        .eq('id', broadcast.id);

      setProgress(100);
      return broadcast.id;
    } finally {
      setIsProcessing(false);
    }
  }

  return { createAndSendBroadcast, retryFailedRecipients, isProcessing, progress };
}
