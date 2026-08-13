import type { SupabaseClient } from '@supabase/supabase-js'

// ------------------------------------------------------------
// Real lead distribution — replaces the round_robin stub that used
// to always return the first profile row (src/lib/automations/engine.ts).
//
// Two paths:
//   1. The lead arrived through a seller's own connected number
//      (whatsapp_channels.assigned_agent_id) — assign directly to
//      that seller, no pooling needed; the number IS the distribution.
//   2. Anything else (shared/default number, CSV import, manual entry)
//      — round-robin by current load among the account's agent-role
//      members (self-balancing: whoever has the fewest contacts
//      currently assigned to them gets the next one, no cursor/state
//      to maintain).
//
// Callers pass a service-role client — this runs from webhooks,
// automations, and import routes, none of which have a user session.
// ------------------------------------------------------------

export interface PickAgentForNewLeadOptions {
  /** The channel the lead came in on, if known. */
  channelId?: string | null
}

export async function pickAgentForNewLead(
  db: SupabaseClient,
  accountId: string,
  opts: PickAgentForNewLeadOptions = {},
): Promise<string | null> {
  if (opts.channelId) {
    const { data: channel } = await db
      .from('whatsapp_channels')
      .select('assigned_agent_id')
      .eq('id', opts.channelId)
      .maybeSingle()
    if (channel?.assigned_agent_id) return channel.assigned_agent_id as string
  }

  const { data: agents } = await db
    .from('profiles')
    .select('user_id, daily_lead_quota')
    .eq('account_id', accountId)
    .eq('account_role', 'agent')
  if (!agents || agents.length === 0) return null

  const { data: loadRows } = await db
    .from('contacts')
    .select('assigned_agent_id')
    .eq('account_id', accountId)
    .not('assigned_agent_id', 'is', null)

  const loadByAgent = new Map<string, number>()
  for (const a of agents) loadByAgent.set(a.user_id as string, 0)
  for (const row of loadRows ?? []) {
    const id = row.assigned_agent_id as string
    if (loadByAgent.has(id)) loadByAgent.set(id, (loadByAgent.get(id) ?? 0) + 1)
  }

  // Quota check — only bothers with a query when at least one
  // candidate actually has a cap set (the common case has none).
  let todayCountByAgent: Map<string, number> | null = null
  if (agents.some((a) => a.daily_lead_quota != null)) {
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const { data: todayRows } = await db
      .from('contacts')
      .select('assigned_agent_id')
      .eq('account_id', accountId)
      .not('assigned_agent_id', 'is', null)
      .gte('created_at', todayStart.toISOString())
    todayCountByAgent = new Map<string, number>()
    for (const row of todayRows ?? []) {
      const id = row.assigned_agent_id as string
      todayCountByAgent.set(id, (todayCountByAgent.get(id) ?? 0) + 1)
    }
  }

  const quotaByAgent = new Map<string, number | null>(
    agents.map((a) => [a.user_id as string, a.daily_lead_quota as number | null]),
  )

  let picked: string | null = null
  let minLoad = Infinity
  for (const [agentId, load] of loadByAgent) {
    const quota = quotaByAgent.get(agentId) ?? null
    if (quota != null && (todayCountByAgent?.get(agentId) ?? 0) >= quota) continue
    if (load < minLoad) {
      minLoad = load
      picked = agentId
    }
  }
  return picked
}

/**
 * Convenience wrapper for contact-creation call sites: only assigns
 * when the account has opted in (`lead_distribution_enabled`) and the
 * contact doesn't already have an owner. Swallows its own errors —
 * distribution is a best-effort enhancement, never worth failing the
 * contact creation that triggered it.
 */
export async function maybeDistributeNewLead(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  opts: PickAgentForNewLeadOptions = {},
): Promise<void> {
  try {
    const { data: account } = await db
      .from('accounts')
      .select('lead_distribution_enabled')
      .eq('id', accountId)
      .maybeSingle()
    if (!account?.lead_distribution_enabled) return

    // account_id filters below are defense-in-depth, not the primary
    // guard — callers must already scope contactId to this account,
    // but this stops a wrong/foreign id from silently pulling a
    // contact from a different tenant into this account's pool.
    const { data: contact } = await db
      .from('contacts')
      .select('assigned_agent_id')
      .eq('id', contactId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (!contact || contact.assigned_agent_id) return

    const agentId = await pickAgentForNewLead(db, accountId, opts)
    if (!agentId) return

    await db
      .from('contacts')
      .update({ assigned_agent_id: agentId })
      .eq('id', contactId)
      .eq('account_id', accountId)
  } catch (err) {
    console.error('[assign-lead] maybeDistributeNewLead failed:', err)
  }
}
