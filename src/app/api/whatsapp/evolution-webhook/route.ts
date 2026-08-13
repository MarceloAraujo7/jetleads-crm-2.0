import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToFlows } from '@/lib/flows/engine'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import { maybeDistributeNewLead } from '@/lib/contacts/assign-lead'

// Mirrors src/app/api/whatsapp/webhook/route.ts's fan-out budget.
export const maxDuration = 60

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _adminClient
}

// ------------------------------------------------------------
// Evolution API's `messages.upsert` webhook payload (Baileys shape).
// Deliberately loose-typed — we only read the fields this route uses.
// ------------------------------------------------------------
interface EvolutionWebhookBody {
  event: string
  instance: string
  data?: {
    key?: { id?: string; remoteJid?: string; fromMe?: boolean }
    pushName?: string
    message?: {
      conversation?: string
      extendedTextMessage?: { text?: string }
      imageMessage?: { caption?: string; url?: string; mimetype?: string }
      videoMessage?: { caption?: string; url?: string; mimetype?: string }
      documentMessage?: { fileName?: string; url?: string; mimetype?: string }
      audioMessage?: { url?: string; mimetype?: string }
    }
    messageTimestamp?: number
  }
  // connection.update shape
  state?: string
}

function jidToPhone(jid: string): string {
  // '5511999999999@s.whatsapp.net' -> '+5511999999999'
  const digits = jid.split('@')[0].split(':')[0]
  return `+${digits}`
}

function parseInboundContent(data: NonNullable<EvolutionWebhookBody['data']>): {
  contentText: string | null
  mediaUrl: string | null
  contentType: 'text' | 'image' | 'video' | 'document' | 'audio'
} {
  const m = data.message
  if (!m) return { contentText: null, mediaUrl: null, contentType: 'text' }
  if (m.imageMessage) {
    return {
      contentText: m.imageMessage.caption ?? null,
      mediaUrl: m.imageMessage.url ?? null,
      contentType: 'image',
    }
  }
  if (m.videoMessage) {
    return {
      contentText: m.videoMessage.caption ?? null,
      mediaUrl: m.videoMessage.url ?? null,
      contentType: 'video',
    }
  }
  if (m.documentMessage) {
    return {
      contentText: m.documentMessage.fileName ?? null,
      mediaUrl: m.documentMessage.url ?? null,
      contentType: 'document',
    }
  }
  if (m.audioMessage) {
    return { contentText: null, mediaUrl: m.audioMessage.url ?? null, contentType: 'audio' }
  }
  return {
    contentText: m.conversation ?? m.extendedTextMessage?.text ?? null,
    mediaUrl: null,
    contentType: 'text',
  }
}

/**
 * POST /api/whatsapp/evolution-webhook?token=<per-channel secret>
 *
 * Evolution has no request-signing scheme like Meta's
 * x-hub-signature-256, so the channel's webhook URL carries a random
 * token (set when the instance is created) that we match against the
 * stored `evolution_webhook_secret` for the instance named in the
 * payload.
 */
export async function POST(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get('token')
    const body = (await request.json()) as EvolutionWebhookBody

    const { data: channel, error: channelError } = await supabaseAdmin()
      .from('whatsapp_channels')
      .select('*')
      .eq('provider', 'evolution')
      .eq('evolution_instance_name', body.instance)
      .maybeSingle()

    if (channelError || !channel) {
      console.error('[evolution-webhook] unknown instance:', body.instance)
      return NextResponse.json({ error: 'Unknown instance' }, { status: 404 })
    }

    if (!token || token !== channel.evolution_webhook_secret) {
      console.error('[evolution-webhook] token mismatch for instance:', body.instance)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Respond fast; do the actual work after the response is sent —
    // same pattern as the Meta webhook.
    after(() => processEvolutionEvent(body, channel))

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('[evolution-webhook] error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processEvolutionEvent(body: EvolutionWebhookBody, channel: any) {
  const accountId = channel.account_id as string
  const configOwnerUserId = channel.user_id as string

  if (body.event === 'connection.update') {
    const isConnected = body.state === 'open'
    await supabaseAdmin()
      .from('whatsapp_channels')
      .update({
        status: isConnected ? 'connected' : 'disconnected',
        connected_at: isConnected ? new Date().toISOString() : channel.connected_at,
      })
      .eq('id', channel.id)
    return
  }

  if (body.event !== 'messages.upsert') return

  const data = body.data
  if (!data?.key || data.key.fromMe) return // ignore our own sent messages
  const remoteJid = data.key.remoteJid
  if (!remoteJid || remoteJid.endsWith('@g.us')) return // ignore group chats for now

  const senderPhone = normalizePhone(jidToPhone(remoteJid))
  const contactName = data.pushName || senderPhone

  const contactOutcome = await findOrCreateContact(
    accountId,
    configOwnerUserId,
    senderPhone,
    contactName,
  )
  if (!contactOutcome) return
  const contactRecord = contactOutcome.contact
  if (contactOutcome.wasCreated) {
    void maybeDistributeNewLead(supabaseAdmin(), accountId, contactRecord.id)
  }

  const convResult = await findOrCreateConversation(accountId, configOwnerUserId, contactRecord.id)
  if (!convResult) return
  const conversation = convResult.conversation

  if (convResult.created) {
    await dispatchWebhookEvent(supabaseAdmin(), accountId, 'conversation.created', {
      conversation_id: conversation.id,
      contact_id: contactRecord.id,
    })
  }

  const { contentText, mediaUrl, contentType } = parseInboundContent(data)

  const { count: priorCustomerMsgCount } = await supabaseAdmin()
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversation.id)
    .eq('sender_type', 'customer')
  const isFirstInboundMessage = (priorCustomerMsgCount ?? 0) === 0

  const { error: msgError } = await supabaseAdmin().from('messages').insert({
    conversation_id: conversation.id,
    sender_type: 'customer',
    content_type: contentType,
    content_text: contentText,
    media_url: mediaUrl,
    message_id: data.key.id ?? null,
    status: 'delivered',
    created_at: data.messageTimestamp
      ? new Date(data.messageTimestamp * 1000).toISOString()
      : new Date().toISOString(),
  })

  if (msgError) {
    console.error('[evolution-webhook] error inserting message:', msgError)
    return
  }

  await supabaseAdmin()
    .from('conversations')
    .update({
      last_message_text: contentText || `[${contentType}]`,
      last_message_at: new Date().toISOString(),
      unread_count: (conversation.unread_count || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation.id)

  // Flow runner first — same "flows win over automations/AI" ordering
  // as the Meta webhook. Awaited because the `consumed` result decides
  // whether content-level automation triggers still fire.
  const flowResult = await dispatchInboundToFlows({
    accountId,
    userId: configOwnerUserId,
    contactId: contactRecord.id,
    conversationId: conversation.id,
    message: { kind: 'text', text: contentText ?? '', meta_message_id: data.key.id ?? '' },
    isFirstInboundMessage,
  })
  const flowConsumed = flowResult.consumed

  const automationTriggers: (
    | 'new_contact_created'
    | 'first_inbound_message'
    | 'new_message_received'
    | 'keyword_match'
  )[] = []
  if (!flowConsumed) {
    automationTriggers.push('new_message_received', 'keyword_match')
  }
  if (contactOutcome.wasCreated) automationTriggers.unshift('new_contact_created')
  if (isFirstInboundMessage) automationTriggers.unshift('first_inbound_message')

  for (const triggerType of automationTriggers) {
    runAutomationsForTrigger({
      accountId,
      triggerType,
      contactId: contactRecord.id,
      context: { message_text: contentText ?? '', conversation_id: conversation.id },
    }).catch((err) => console.error('[evolution-webhook] automations dispatch failed:', err))
  }

  if (!flowConsumed && (contentText ?? '').trim()) {
    try {
      await dispatchInboundToAiReply({
        accountId,
        conversationId: conversation.id,
        contactId: contactRecord.id,
        configOwnerUserId,
      })
    } catch (err) {
      console.error('[evolution-webhook] AI auto-reply dispatch failed:', err)
    }
  }

  await dispatchWebhookEvent(supabaseAdmin(), accountId, 'message.received', {
    conversation_id: conversation.id,
    contact_id: contactRecord.id,
    content_type: contentType,
    text: contentText,
  })
}

async function findOrCreateContact(
  accountId: string,
  configOwnerUserId: string,
  phone: string,
  name: string
) {
  const existingContact = await findExistingContact(supabaseAdmin(), accountId, phone)

  if (existingContact) {
    if (name && name !== existingContact.name) {
      await supabaseAdmin()
        .from('contacts')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', existingContact.id)
    }
    return { contact: existingContact, wasCreated: false }
  }

  const { data: newContact, error: createError } = await supabaseAdmin()
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      phone,
      name: name || phone,
      source: 'evolution_inbound',
    })
    .select()
    .single()

  if (createError) {
    if (isUniqueViolation(createError)) {
      const raced = await findExistingContact(supabaseAdmin(), accountId, phone)
      if (raced) return { contact: raced, wasCreated: false }
    }
    console.error('[evolution-webhook] error creating contact:', createError)
    return null
  }

  return { contact: newContact, wasCreated: true }
}

async function findOrCreateConversation(
  accountId: string,
  configOwnerUserId: string,
  contactId: string,
) {
  const { data: existingRows, error: findError } = await supabaseAdmin()
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1)

  if (findError) {
    console.error('[evolution-webhook] error finding conversation:', findError)
    return null
  }

  if (existingRows && existingRows.length > 0) {
    return { conversation: existingRows[0], created: false }
  }

  const { data: newConv, error: createError } = await supabaseAdmin()
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      contact_id: contactId,
      status: 'open',
      unread_count: 0,
    })
    .select()
    .single()

  if (createError) {
    console.error('[evolution-webhook] error creating conversation:', createError)
    return null
  }

  return { conversation: newConv, created: true }
}
