import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { hasMinRole } from '@/lib/auth/roles'
import { saveMetaChannel } from '@/lib/whatsapp/channel-save'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
 * PATCH /api/whatsapp/channels/[id]
 *
 * Three shapes, told apart by body contents:
 *   - `{ set_default: true }` — admin+ only. Flips is_default on this
 *     row and clears it on every other meta_cloud channel for the
 *     account (the partial unique index only allows one at a time,
 *     so siblings must be cleared first). Uses the service-role
 *     client because `is_default` is deliberately excluded from the
 *     column grant every session client has (migration 042) — no one
 *     can flip it via a direct table UPDATE, admins included.
 *   - Metadata-only (`access_token` absent) — just label/ddd, no
 *     Meta round-trip. admin+ on any channel; agent only on their own.
 *   - Credential update (`access_token` present) — re-verifies with
 *     Meta (same flow as adding a number) and re-encrypts. Same
 *     admin-any / agent-own-only split.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Invalid channel id.' }, { status: 400 })
    }

    const { supabase, accountId, userId, role } = await getCurrentAccount()
    if (!hasMinRole(role, 'agent')) {
      return NextResponse.json({ error: "This action requires the 'agent' role or higher" }, { status: 403 })
    }
    const isAdmin = hasMinRole(role, 'admin')
    const body = await request.json()

    if (body.set_default) {
      if (!isAdmin) {
        return NextResponse.json({ error: "This action requires the 'admin' role or higher" }, { status: 403 })
      }
      const admin = supabaseAdmin()
      const { data: existing } = await admin
        .from('whatsapp_channels')
        .select('id')
        .eq('id', id)
        .eq('account_id', accountId)
        .eq('provider', 'meta_cloud')
        .maybeSingle()
      if (!existing) {
        return NextResponse.json({ error: 'Channel not found.' }, { status: 404 })
      }

      const { error: clearError } = await admin
        .from('whatsapp_channels')
        .update({ is_default: false })
        .eq('account_id', accountId)
        .eq('provider', 'meta_cloud')
        .neq('id', id)
      if (clearError) {
        console.error('Error clearing default channel:', clearError)
        return NextResponse.json({ error: 'Failed to update default channel' }, { status: 500 })
      }

      const { error: setError } = await admin
        .from('whatsapp_channels')
        .update({ is_default: true })
        .eq('id', id)
      if (setError) {
        console.error('Error setting default channel:', setError)
        return NextResponse.json({ error: 'Failed to update default channel' }, { status: 500 })
      }

      return NextResponse.json({ success: true })
    }

    // Non-admin editing a channel: only their own. RLS enforces this
    // independently (migration 042); this check exists to return a
    // clean 403/404 instead of a silent "0 rows updated".
    if (!isAdmin) {
      const { data: owned } = await supabase
        .from('whatsapp_channels')
        .select('id')
        .eq('id', id)
        .eq('account_id', accountId)
        .eq('assigned_agent_id', userId)
        .maybeSingle()
      if (!owned) {
        return NextResponse.json({ error: 'Channel not found.' }, { status: 404 })
      }
    }

    // Metadata-only update (label/ddd), no credential change.
    if (body.access_token === undefined) {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (body.label !== undefined) patch.label = body.label || null
      if (body.ddd !== undefined) patch.ddd = body.ddd || null

      const { error } = await supabase
        .from('whatsapp_channels')
        .update(patch)
        .eq('id', id)
        .eq('account_id', accountId)
        .eq('provider', 'meta_cloud')
      if (error) {
        console.error('Error updating channel metadata:', error)
        return NextResponse.json({ error: 'Failed to update channel' }, { status: 500 })
      }
      return NextResponse.json({ success: true })
    }

    // Credential update — full re-verify/register flow.
    const { phone_number_id, waba_id, access_token, verify_token, pin, label, ddd } = body
    const result = await saveMetaChannel({
      db: supabase,
      admin: supabaseAdmin(),
      accountId,
      userId,
      channelId: id,
      phone_number_id,
      waba_id,
      access_token,
      verify_token,
      pin,
      label,
      ddd,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    if (result.registration_error) {
      return NextResponse.json({
        success: false,
        saved: true,
        registered: false,
        registration_error: result.registration_error,
        phone_info: result.phone_info,
      })
    }

    return NextResponse.json({
      success: true,
      saved: true,
      registered: result.registered,
      registration_skipped: result.registration_skipped,
      phone_info: result.phone_info,
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

/**
 * DELETE /api/whatsapp/channels/[id]
 *
 * Removes one channel. admin+ can delete any; agent only their own
 * (RLS, migration 042, also enforces this independently). If it was
 * the account's default and other channels remain, promotes the
 * oldest survivor to default so resolveChannel() always has a
 * fallback target — otherwise every send silently loses its number
 * until someone notices. A non-admin's own channel is never the
 * default (enforced at creation), so that branch only ever fires for
 * an admin's delete.
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Invalid channel id.' }, { status: 400 })
    }

    const { supabase, accountId, userId, role } = await getCurrentAccount()
    if (!hasMinRole(role, 'agent')) {
      return NextResponse.json({ error: "This action requires the 'agent' role or higher" }, { status: 403 })
    }
    const isAdmin = hasMinRole(role, 'admin')

    const { data: existing, error: lookupErr } = await supabase
      .from('whatsapp_channels')
      .select('id, is_default, assigned_agent_id')
      .eq('id', id)
      .eq('account_id', accountId)
      .eq('provider', 'meta_cloud')
      .maybeSingle()
    if (lookupErr || !existing) {
      return NextResponse.json({ error: 'Channel not found.' }, { status: 404 })
    }
    if (!isAdmin && existing.assigned_agent_id !== userId) {
      return NextResponse.json({ error: 'Channel not found.' }, { status: 404 })
    }

    const { error: deleteError } = await supabase
      .from('whatsapp_channels')
      .delete()
      .eq('id', id)
    if (deleteError) {
      console.error('Error deleting channel:', deleteError)
      return NextResponse.json({ error: 'Failed to delete channel' }, { status: 500 })
    }

    if (existing.is_default) {
      const admin = supabaseAdmin()
      const { data: survivor } = await admin
        .from('whatsapp_channels')
        .select('id')
        .eq('account_id', accountId)
        .eq('provider', 'meta_cloud')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (survivor) {
        await admin
          .from('whatsapp_channels')
          .update({ is_default: true })
          .eq('id', survivor.id)
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return toErrorResponse(error)
  }
}
