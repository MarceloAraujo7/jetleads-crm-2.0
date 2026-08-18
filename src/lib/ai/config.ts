import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import type { AiConfig } from './types'

interface AiConfigRow {
  provider: 'openai' | 'anthropic'
  model: string
  api_key: string
  system_prompt: string | null
  is_active: boolean
  auto_reply_enabled: boolean
  auto_reply_max_per_conversation: number
  handoff_agent_id: string | null
  embeddings_api_key: string | null
}

const CONFIG_COLUMNS =
  'provider, model, api_key, system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation, handoff_agent_id, embeddings_api_key'

/**
 * Which specific ai_configs row a contact's conversation should use:
 * the agent linked to whichever campaign owns the contact's lead base
 * (campaign_actions.action_type = 'agent'), if any. Null means "no
 * campaign-specific agent — use the account default" (the caller falls
 * back, this never throws for a plain miss).
 */
async function resolveAiConfigIdForContact(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<string | null> {
  const { data: contact } = await db
    .from('contacts')
    .select('lead_base_id')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle()
  const leadBaseId = contact?.lead_base_id as string | null | undefined
  if (!leadBaseId) return null

  const { data: campaignRows } = await db
    .from('campaigns')
    .select('id')
    .eq('account_id', accountId)
    .eq('lead_base_id', leadBaseId)
  const campaignIds = (campaignRows ?? []).map((c) => c.id as string)
  if (campaignIds.length === 0) return null

  const { data: actionRows } = await db
    .from('campaign_actions')
    .select('ai_config_id')
    .in('campaign_id', campaignIds)
    .eq('action_type', 'agent')
    .not('ai_config_id', 'is', null)
    .limit(1)
  return (actionRows?.[0]?.ai_config_id as string | undefined) ?? null
}

/**
 * Load and decrypt an AI config for *use* (draft or auto-reply).
 * Returns `null` when there's no row or the master switch
 * (`is_active`) is off — both mean "AI is not available", which callers
 * treat identically. Throws only if the stored key can't be decrypted
 * (mismatched `ENCRYPTION_KEY`), so that distinct failure surfaces
 * rather than looking like "not configured".
 *
 * `opts.contactId`, when passed, resolves to that contact's campaign-
 * specific agent (via its lead base) if one is linked; otherwise (or
 * when omitted) falls back to the account's single `is_default` agent
 * — the same one every pre-multi-agent call site already expected.
 *
 * Works with any client: pass the RLS-scoped SSR client from a
 * dashboard route, or the service-role admin client from the webhook.
 */
export async function loadAiConfig(
  db: SupabaseClient,
  accountId: string,
  opts: { requireActive?: boolean; contactId?: string } = {},
): Promise<AiConfig | null> {
  const { requireActive = true, contactId } = opts

  const configId = contactId ? await resolveAiConfigIdForContact(db, accountId, contactId) : null

  let query = db.from('ai_configs').select(CONFIG_COLUMNS).eq('account_id', accountId)
  query = configId ? query.eq('id', configId) : query.eq('is_default', true)
  const { data, error } = await query.maybeSingle()

  if (error) throw error
  if (!data) return null

  const row = data as AiConfigRow
  // The Playground passes requireActive:false so an admin can test the
  // agent before flipping the master switch on.
  if (requireActive && !row.is_active) return null
  // Defensive: the column is NOT NULL, but a partial write / manual DB
  // edit could leave it empty. Treat a missing key as "not configured"
  // rather than letting decrypt() throw on null.
  if (!row.api_key) return null

  // The embeddings key is optional and independent of the chat key —
  // a corrupt/undecryptable one should downgrade to lexical KB, not
  // take down draft/auto-reply, so decrypt failures are swallowed here.
  let embeddingsApiKey: string | null = null
  if (row.embeddings_api_key) {
    try {
      embeddingsApiKey = decrypt(row.embeddings_api_key)
    } catch {
      // Not silent — a rotated/mismatched ENCRYPTION_KEY here means
      // semantic search quietly stops working, so leave a breadcrumb.
      console.error(
        `[ai config] embeddings key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY; semantic search is disabled until it is re-entered.`,
      )
      embeddingsApiKey = null
    }
  }

  return {
    provider: row.provider,
    model: row.model,
    apiKey: decrypt(row.api_key),
    systemPrompt: row.system_prompt,
    isActive: row.is_active,
    autoReplyEnabled: row.auto_reply_enabled,
    autoReplyMaxPerConversation: row.auto_reply_max_per_conversation,
    handoffAgentId: row.handoff_agent_id,
    embeddingsApiKey,
  }
}

/**
 * Load + decrypt just the embeddings key, independent of `is_active`.
 * Used by the knowledge-base ingest routes so the KB gets embedded (and
 * semantic search works) whenever an embeddings key is present, even if
 * the assistant's master switch is currently off.
 *
 * Returns `{ key, corrupt }`: `key` is null when there's no key OR it
 * can't be decrypted; `corrupt` distinguishes those cases so callers can
 * warn ("a key is set but unusable") rather than silently indexing
 * lexical-only and reporting success.
 */
export async function loadEmbeddingsKey(
  db: SupabaseClient,
  accountId: string,
): Promise<{ key: string | null; corrupt: boolean }> {
  const { data, error } = await db
    .from('ai_configs')
    .select('embeddings_api_key')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error || !data?.embeddings_api_key) return { key: null, corrupt: false }
  try {
    return { key: decrypt(data.embeddings_api_key), corrupt: false }
  } catch {
    console.error(
      `[ai config] embeddings key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY.`,
    )
    return { key: null, corrupt: true }
  }
}
