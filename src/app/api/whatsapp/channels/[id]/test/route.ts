import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { verifyPhoneNumber } from '@/lib/whatsapp/meta-api'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * GET /api/whatsapp/channels/[id]/test
 *
 * Live health check for one channel — decrypts its token and pings
 * Meta. Same response shape as the legacy GET /api/whatsapp/config so
 * the per-row UI can reuse the same status rendering.
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

    const { data: config, error: configError } = await supabase
      .from('whatsapp_channels')
      .select('phone_number_id, access_token, status')
      .eq('id', id)
      .eq('account_id', accountId)
      .eq('provider', 'meta_cloud')
      .maybeSingle()

    if (configError) {
      console.error('Error fetching whatsapp_channels:', configError)
      return NextResponse.json(
        { connected: false, reason: 'db_error', message: 'Failed to fetch configuration' },
        { status: 200 },
      )
    }
    if (!config || !config.access_token || !config.phone_number_id) {
      return NextResponse.json(
        { connected: false, reason: 'no_config', message: 'Channel not found or incomplete.' },
        { status: 200 },
      )
    }

    let accessToken: string
    try {
      accessToken = decrypt(config.access_token)
    } catch (err) {
      console.error('[whatsapp/channels/[id]/test] Token decryption failed:', err)
      return NextResponse.json(
        {
          connected: false,
          reason: 'token_corrupted',
          needs_reset: true,
          message:
            'The stored access token cannot be decrypted with the current ENCRYPTION_KEY. Re-enter the credentials for this number.',
        },
        { status: 200 },
      )
    }

    try {
      const phoneInfo = await verifyPhoneNumber({
        phoneNumberId: config.phone_number_id,
        accessToken,
      })
      return NextResponse.json({ connected: true, phone_info: phoneInfo })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error'
      console.error('[whatsapp/channels/[id]/test] Meta API verification failed:', message)
      return NextResponse.json(
        { connected: false, reason: 'meta_api_error', message: `Meta API rejected the credentials: ${message}` },
        { status: 200 },
      )
    }
  } catch (error) {
    return toErrorResponse(error)
  }
}
