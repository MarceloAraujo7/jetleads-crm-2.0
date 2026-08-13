import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { getSubscribedApps, verifyPhoneNumber } from '@/lib/whatsapp/meta-api'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * GET /api/whatsapp/channels/[id]/verify-registration
 *
 * Per-channel version of the legacy /api/whatsapp/config/verify-registration
 * diagnostic (which is scoped to `is_default`). Same three checks, same
 * response shape, just addressed by channel id instead of "the default
 * channel" — needed once an account has more than one number.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Invalid channel id.' }, { status: 400 })
    }

    const { supabase, accountId } = await getCurrentAccount()

    const { data: config } = await supabase
      .from('whatsapp_channels')
      .select('*')
      .eq('id', id)
      .eq('account_id', accountId)
      .eq('provider', 'meta_cloud')
      .maybeSingle()

    if (!config) {
      return NextResponse.json({
        live: false,
        checks: { config_exists: false },
        message: 'Channel not found.',
      })
    }

    let accessToken: string
    try {
      accessToken = decrypt(config.access_token)
    } catch {
      return NextResponse.json({
        live: false,
        checks: { config_exists: true, token_decryptable: false },
        message:
          "Stored access token can't be decrypted — likely ENCRYPTION_KEY changed. Re-enter the token to repair.",
      })
    }

    const checks: {
      config_exists: boolean
      token_decryptable: boolean
      phone_metadata_ok: boolean
      waba_subscribed_to_app: boolean | null
      locally_marked_registered: boolean
    } = {
      config_exists: true,
      token_decryptable: true,
      phone_metadata_ok: false,
      waba_subscribed_to_app: null,
      locally_marked_registered: config.registered_at != null,
    }
    const errors: string[] = []

    try {
      await verifyPhoneNumber({ phoneNumberId: config.phone_number_id, accessToken })
      checks.phone_metadata_ok = true
    } catch (err) {
      errors.push(`Phone metadata check failed: ${err instanceof Error ? err.message : String(err)}`)
    }

    if (config.waba_id) {
      try {
        const subs = await getSubscribedApps({ wabaId: config.waba_id, accessToken })
        checks.waba_subscribed_to_app = subs.length > 0
        if (!checks.waba_subscribed_to_app) {
          errors.push('WABA has no subscribed apps. Re-save the configuration to subscribe.')
        }
      } catch (err) {
        errors.push(`WABA subscription check failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    } else {
      errors.push("No WABA ID on file — webhooks can't be wired without it. Add it in the form and re-save.")
    }

    const live =
      checks.phone_metadata_ok &&
      (checks.waba_subscribed_to_app ?? false) &&
      checks.locally_marked_registered

    return NextResponse.json({
      live,
      checks,
      errors,
      last_registration_error: config.last_registration_error ?? null,
      registered_at: config.registered_at ?? null,
      subscribed_apps_at: config.subscribed_apps_at ?? null,
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
