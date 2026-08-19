import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { hasMinRole } from '@/lib/auth/roles';
import { saveMetaChannel } from '@/lib/whatsapp/channel-save';

/**
 * Multi-number Meta Cloud channel list/create.
 *
 * Sibling to the legacy /api/whatsapp/config (which still manages just
 * "the default channel" for back-compat). This route lets an account
 * hold N meta_cloud channels — one per store/region/team, routed by
 * DDD via resolveChannel(). Two write paths (also enforced by RLS,
 * migration 037 + 042):
 *   - admin+: full access, can create/edit/remove any channel.
 *   - agent: "vendedor conecta o próprio WhatsApp" — can create
 *     exactly one kind of channel: their own (assigned_agent_id =
 *     themselves, never the account default).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null;
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _adminClient;
}

/**
 * GET /api/whatsapp/channels
 *
 * List meta_cloud channels for the caller's account. Any member may
 * read, but RLS (migration 042) narrows what an agent actually gets
 * back once the account has at least one agent-owned channel: their
 * own + the account default, not every client's number. Returns DB
 * state only (no live Meta ping — that's a per-channel action via GET
 * /api/whatsapp/channels/[id]/test) so loading the list is cheap even
 * with several numbers configured.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();

    const { data, error } = await supabase
      .from('whatsapp_channels')
      .select(
        'id, label, ddd, is_default, assigned_agent_id, phone_number_id, waba_id, status, registered_at, subscribed_apps_at, last_registration_error, connected_at, created_at, display_phone_number, verified_name'
      )
      .eq('account_id', accountId)
      .eq('provider', 'meta_cloud')
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error listing whatsapp_channels:', error);
      return NextResponse.json(
        { error: 'Failed to load channels' },
        { status: 500 }
      );
    }

    return NextResponse.json({ channels: data ?? [] });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * POST /api/whatsapp/channels
 *
 * Add a new number to the account. Verifies with Meta, encrypts, and
 * inserts a new row (never updates an existing one — use PATCH
 * /api/whatsapp/channels/[id] for that).
 *
 * admin+: the very first channel an account creates becomes the
 * default automatically; subsequent ones start as non-default (use
 * the set-default action to switch).
 *
 * agent ("vendedor conecta o próprio WhatsApp"): can only create a
 * channel assigned to themselves, and it never becomes the account
 * default — RLS (migration 042) enforces this independently, this is
 * just the friendly 403 + forced values.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId, role } = await getCurrentAccount();
    if (!hasMinRole(role, 'agent')) {
      return NextResponse.json(
        { error: "This action requires the 'agent' role or higher" },
        { status: 403 }
      );
    }
    const isAdmin = hasMinRole(role, 'admin');

    const body = await request.json();
    const {
      phone_number_id,
      waba_id,
      access_token,
      verify_token,
      pin,
      label,
      ddd,
    } = body;

    const { count } = await supabase
      .from('whatsapp_channels')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .eq('provider', 'meta_cloud');

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
      // Agent-created channels never become the account default —
      // that stays an admin-only decision (set via the service-role
      // path, see PATCH .../[id] `set_default`).
      makeDefault: isAdmin && !count,
      assignedAgentId: isAdmin ? undefined : userId,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      );
    }

    if (result.registration_error) {
      return NextResponse.json({
        success: false,
        saved: true,
        registered: false,
        channel_id: result.channelId,
        registration_error: result.registration_error,
        phone_info: result.phone_info,
      });
    }

    return NextResponse.json({
      success: true,
      saved: true,
      channel_id: result.channelId,
      registered: result.registered,
      registration_skipped: result.registration_skipped,
      phone_info: result.phone_info,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
