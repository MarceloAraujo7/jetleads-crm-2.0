import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { saveMetaChannel } from '@/lib/whatsapp/channel-save'

/**
 * Multi-number Meta Cloud channel list/create.
 *
 * Sibling to the legacy /api/whatsapp/config (which still manages just
 * "the default channel" for back-compat). This route lets an account
 * hold N meta_cloud channels — one per store/region/team, routed by
 * DDD via resolveChannel(). Adding/editing/removing a number requires
 * 'admin' (also enforced by RLS on whatsapp_channels, migration 037 —
 * requireRole gives a clean 403 instead of relying on the write
 * silently failing under RLS).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}

/**
 * GET /api/whatsapp/channels
 *
 * List every meta_cloud channel for the caller's account. Any member
 * may read. Returns DB state only (no live Meta ping — that's a
 * per-channel action via GET /api/whatsapp/channels/[id]/test) so
 * loading the list is cheap even with several numbers configured.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()

    const { data, error } = await supabase
      .from('whatsapp_channels')
      .select(
        'id, label, ddd, is_default, assigned_agent_id, phone_number_id, waba_id, status, registered_at, subscribed_apps_at, last_registration_error, connected_at, created_at',
      )
      .eq('account_id', accountId)
      .eq('provider', 'meta_cloud')
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true })

    if (error) {
      console.error('Error listing whatsapp_channels:', error)
      return NextResponse.json({ error: 'Failed to load channels' }, { status: 500 })
    }

    return NextResponse.json({ channels: data ?? [] })
  } catch (error) {
    return toErrorResponse(error)
  }
}

/**
 * POST /api/whatsapp/channels
 *
 * Add a new number to the account. Verifies with Meta, encrypts, and
 * inserts a new row (never updates an existing one — use PATCH
 * /api/whatsapp/channels/[id] for that). The very first channel an
 * account creates becomes the default automatically; subsequent ones
 * start as non-default (use the set-default action to switch).
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const body = await request.json()
    const { phone_number_id, waba_id, access_token, verify_token, pin, label, ddd } = body

    const { count } = await supabase
      .from('whatsapp_channels')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .eq('provider', 'meta_cloud')

    const result = await saveMetaChannel({
      db: supabase,
      admin: supabaseAdmin(),
      accountId,
      userId,
      phone_number_id,
      waba_id,
      access_token,
      verify_token,
      pin,
      label,
      ddd,
      makeDefault: !count,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    if (result.registration_error) {
      return NextResponse.json({
        success: false,
        saved: true,
        registered: false,
        channel_id: result.channelId,
        registration_error: result.registration_error,
        phone_info: result.phone_info,
      })
    }

    return NextResponse.json({
      success: true,
      saved: true,
      channel_id: result.channelId,
      registered: result.registered,
      registration_skipped: result.registration_skipped,
      phone_info: result.phone_info,
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
