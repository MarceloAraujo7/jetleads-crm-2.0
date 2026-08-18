import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'

/**
 * GET /api/ai/config
 *
 * Back-compat read-only shim over the account's DEFAULT agent
 * (migration 052 made ai_configs multi-row — see /api/ai/configs for
 * the full list/CRUD API used by Settings and the campaign wizard).
 * Kept because a couple of call sites (the Agentes de IA tab default,
 * the inbox AI-thread banner) only ever need "is AI on for this
 * account" and shouldn't have to know about multi-agent at all.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()

    const { data, error } = await supabase
      .from('ai_configs')
      .select(
        'provider, model, system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation, handoff_agent_id, api_key, embeddings_api_key',
      )
      .eq('account_id', accountId)
      .eq('is_default', true)
      .maybeSingle()

    if (error) {
      console.error('[ai/config GET] fetch error:', error)
      return NextResponse.json({ error: 'Failed to load AI configuration' }, { status: 500 })
    }

    if (!data) return NextResponse.json({ configured: false })
    const { api_key, embeddings_api_key, ...safe } = data
    return NextResponse.json({
      configured: true,
      has_key: !!api_key,
      has_embeddings_key: !!embeddings_api_key,
      ...safe,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
