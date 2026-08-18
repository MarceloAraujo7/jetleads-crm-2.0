import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

/**
 * POST /api/ai/configs/[id]/set-default  (admin+)
 *
 * Makes this agent the account's default (used by Settings/Playground/
 * draft-reply/auto-reply whenever there's no campaign-specific match).
 * Clears the previous default first — the partial unique index
 * (ai_configs_default_key, migration 052) only allows one TRUE row per
 * account, so setting the new one before clearing the old would 23505.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { id } = await params

    const { data: target } = await supabase
      .from('ai_configs')
      .select('id')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (!target) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

    const { error: clearErr } = await supabase
      .from('ai_configs')
      .update({ is_default: false })
      .eq('account_id', accountId)
      .eq('is_default', true)
    if (clearErr) {
      console.error('[ai/configs/[id]/set-default] clear error:', clearErr)
      return NextResponse.json({ error: 'Failed to update default agent' }, { status: 500 })
    }

    const { error: setErr } = await supabase.from('ai_configs').update({ is_default: true }).eq('id', id)
    if (setErr) {
      console.error('[ai/configs/[id]/set-default] set error:', setErr)
      return NextResponse.json({ error: 'Failed to update default agent' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
