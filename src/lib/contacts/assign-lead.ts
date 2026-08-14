import type { SupabaseClient } from '@supabase/supabase-js'

// ------------------------------------------------------------
// Real lead distribution — replaces the round_robin stub that used
// to always return the first profile row (src/lib/automations/engine.ts).
//
// Three strategies (accounts.lead_distribution_strategy):
//   - least_loaded (default): whoever has the fewest contacts
//     currently assigned gets the next one. Self-balancing, no
//     cursor/state to maintain.
//   - round_robin: fixed rotation (by user_id order) regardless of
//     current load — tracked via accounts.lead_distribution_cursor.
//   - equal: pure round-robin-by-count across ALL agents, ignoring
//     both the "own number" shortcut below and daily quotas.
//
// All strategies except `equal` first check: did the lead arrive
// through a seller's own connected number
// (whatsapp_channels.assigned_agent_id)? If so, assign directly to
// that seller — no pooling needed, the number IS the distribution.
//
// Callers pass a service-role client — this runs from webhooks,
// automations, and import routes, none of which have a user session.
// ------------------------------------------------------------

export type DistributionStrategy = 'least_loaded' | 'round_robin' | 'equal'

export interface PickAgentForNewLeadOptions {
  /** The channel the lead came in on, if known. */
  channelId?: string | null
  /** Defaults to 'least_loaded' — the only strategy that existed before this. */
  strategy?: DistributionStrategy
  /** Scopes the agent pool, quota, and load-count to one lead base
   *  (lead_base_members / contacts.lead_base_id) instead of the whole
   *  account (profiles / all of the account's contacts). Omit for the
   *  legacy account-wide pool — this is what makes lead bases opt-in
   *  and keeps every account/campaign that predates them working
   *  exactly as before. */
  leadBaseId?: string | null
}

interface AgentRow {
  user_id: string
  daily_lead_quota: number | null
}

export async function pickAgentForNewLead(
  db: SupabaseClient,
  accountId: string,
  opts: PickAgentForNewLeadOptions = {},
): Promise<string | null> {
  const strategy = opts.strategy ?? 'least_loaded'
  const leadBaseId = opts.leadBaseId ?? null

  if (strategy !== 'equal' && opts.channelId) {
    const { data: channel } = await db
      .from('whatsapp_channels')
      .select('assigned_agent_id')
      .eq('id', opts.channelId)
      .maybeSingle()
    if (channel?.assigned_agent_id) return channel.assigned_agent_id as string
  }

  const agents = leadBaseId
    ? await loadLeadBaseAgents(db, leadBaseId)
    : await loadAccountAgents(db, accountId)
  if (agents.length === 0) return null

  const respectQuota = strategy !== 'equal'
  const quotaByAgent = new Map<string, number | null>(
    agents.map((a) => [a.user_id, respectQuota ? a.daily_lead_quota : null]),
  )

  let todayCountByAgent: Map<string, number> | null = null
  if (respectQuota && agents.some((a) => a.daily_lead_quota != null)) {
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    let query = db
      .from('contacts')
      .select('assigned_agent_id')
      .eq('account_id', accountId)
      .not('assigned_agent_id', 'is', null)
      .gte('created_at', todayStart.toISOString())
    query = leadBaseId ? query.eq('lead_base_id', leadBaseId) : query
    const { data: todayRows } = await query
    todayCountByAgent = new Map<string, number>()
    for (const row of todayRows ?? []) {
      const id = row.assigned_agent_id as string
      todayCountByAgent.set(id, (todayCountByAgent.get(id) ?? 0) + 1)
    }
  }

  const isEligible = (agentId: string): boolean => {
    const quota = quotaByAgent.get(agentId) ?? null
    if (quota == null) return true
    return (todayCountByAgent?.get(agentId) ?? 0) < quota
  }

  if (strategy === 'round_robin') {
    return pickRoundRobin(db, accountId, agents, isEligible, leadBaseId)
  }

  // least_loaded and equal both pick the minimum-load eligible agent —
  // 'equal' just never excludes anyone on quota (isEligible is always
  // true there) and skipped the channel shortcut above.
  let loadQuery = db
    .from('contacts')
    .select('assigned_agent_id')
    .eq('account_id', accountId)
    .not('assigned_agent_id', 'is', null)
  loadQuery = leadBaseId ? loadQuery.eq('lead_base_id', leadBaseId) : loadQuery
  const { data: loadRows } = await loadQuery

  const loadByAgent = new Map<string, number>()
  for (const a of agents) loadByAgent.set(a.user_id, 0)
  for (const row of loadRows ?? []) {
    const id = row.assigned_agent_id as string
    if (loadByAgent.has(id)) loadByAgent.set(id, (loadByAgent.get(id) ?? 0) + 1)
  }

  let picked: string | null = null
  let minLoad = Infinity
  for (const [agentId, load] of loadByAgent) {
    if (!isEligible(agentId)) continue
    if (load < minLoad) {
      minLoad = load
      picked = agentId
    }
  }
  return picked
}

async function loadAccountAgents(db: SupabaseClient, accountId: string): Promise<AgentRow[]> {
  const { data } = await db
    .from('profiles')
    .select('user_id, daily_lead_quota')
    .eq('account_id', accountId)
    .eq('account_role', 'agent')
    .order('user_id', { ascending: true })
  return (data ?? []) as AgentRow[]
}

async function loadLeadBaseAgents(db: SupabaseClient, leadBaseId: string): Promise<AgentRow[]> {
  const { data } = await db
    .from('lead_base_members')
    .select('user_id, daily_lead_quota')
    .eq('lead_base_id', leadBaseId)
    .order('user_id', { ascending: true })
  return (data ?? []) as AgentRow[]
}

/**
 * Fixed rotation: advances past `accounts.lead_distribution_cursor`
 * in the stable (user_id-ordered) agent list, skipping anyone over
 * quota, and wraps around. Persists the new cursor as a side effect —
 * best-effort (a lost race just means two leads might land on the
 * same agent once, not a correctness issue worth transactional care).
 */
async function pickRoundRobin(
  db: SupabaseClient,
  accountId: string,
  agents: AgentRow[],
  isEligible: (agentId: string) => boolean,
  leadBaseId: string | null,
): Promise<string | null> {
  const eligible = agents.map((a) => a.user_id).filter(isEligible)
  if (eligible.length === 0) return null

  const cursorId = leadBaseId ?? accountId
  let cursor: string | null | undefined
  if (leadBaseId) {
    const { data } = await db
      .from('lead_bases')
      .select('distribution_cursor')
      .eq('id', cursorId)
      .maybeSingle()
    cursor = data?.distribution_cursor
  } else {
    const { data } = await db
      .from('accounts')
      .select('lead_distribution_cursor')
      .eq('id', cursorId)
      .maybeSingle()
    cursor = data?.lead_distribution_cursor
  }

  let nextIndex = 0
  if (cursor) {
    const cursorIndex = eligible.indexOf(cursor)
    // indexOf is -1 when the cursor's agent no longer exists/isn't
    // eligible this round — falling back to index 0 is fine, it just
    // means the rotation restarts from the top instead of resuming
    // exactly where a since-removed agent left off.
    nextIndex = cursorIndex === -1 ? 0 : (cursorIndex + 1) % eligible.length
  }
  const picked = eligible[nextIndex]

  if (leadBaseId) {
    await db.from('lead_bases').update({ distribution_cursor: picked }).eq('id', cursorId)
  } else {
    await db.from('accounts').update({ lead_distribution_cursor: picked }).eq('id', cursorId)
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
    // account_id filter below is defense-in-depth, not the primary
    // guard — callers must already scope contactId to this account,
    // but this stops a wrong/foreign id from silently pulling a
    // contact from a different tenant into this account's pool.
    const { data: contact } = await db
      .from('contacts')
      .select('assigned_agent_id, lead_base_id')
      .eq('id', contactId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (!contact || contact.assigned_agent_id) return

    const leadBaseId = (contact.lead_base_id as string | null) ?? null
    let strategy: DistributionStrategy

    if (leadBaseId) {
      const { data: base } = await db
        .from('lead_bases')
        .select('distribution_enabled, distribution_strategy')
        .eq('id', leadBaseId)
        .maybeSingle()
      if (!base?.distribution_enabled) return
      strategy = (base.distribution_strategy as DistributionStrategy) ?? 'least_loaded'
    } else {
      const { data: account } = await db
        .from('accounts')
        .select('lead_distribution_enabled, lead_distribution_strategy')
        .eq('id', accountId)
        .maybeSingle()
      if (!account?.lead_distribution_enabled) return
      strategy = (account.lead_distribution_strategy as DistributionStrategy) ?? 'least_loaded'
    }

    const agentId = await pickAgentForNewLead(db, accountId, { ...opts, strategy, leadBaseId })
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
