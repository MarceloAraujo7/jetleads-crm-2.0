import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  createInstance,
  fetchQrCode,
  getConnectionState,
  deleteInstance,
  setWebhook,
} from '@/lib/whatsapp/evolution-api'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'

const EVOLUTION_BASE_URL = process.env.EVOLUTION_API_BASE_URL
const EVOLUTION_ADMIN_KEY = process.env.EVOLUTION_API_ADMIN_KEY

async function resolveAccountId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data?.account_id) return null
  return data.account_id as string
}

function instanceNameFor(accountId: string): string {
  // Evolution instance names are shared global namespace on the
  // server — prefix so ours don't collide with other Jetleads
  // products using the same Evolution instance.
  return `jetleads-crm-${accountId.slice(0, 8)}`
}

/**
 * GET /api/whatsapp/evolution/config
 *
 * Returns the current Evolution channel state for the account,
 * live-refreshed against the Evolution server so the UI reflects
 * whether pairing actually completed (not just what we last wrote).
 */
export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json(
        { connected: false, reason: 'no_account' },
        { status: 200 },
      )
    }

    const { data: channel } = await supabase
      .from('whatsapp_channels')
      .select('*')
      .eq('account_id', accountId)
      .eq('provider', 'evolution')
      .maybeSingle()

    if (!channel) {
      return NextResponse.json({ connected: false, reason: 'not_connected' })
    }

    if (!EVOLUTION_BASE_URL || !channel.evolution_api_key) {
      return NextResponse.json({
        connected: channel.status === 'connected',
        instanceName: channel.evolution_instance_name,
      })
    }

    // Live-check — Evolution connections drop routinely (phone offline,
    // logged out from the phone side), so trust the server over our
    // last-written status.
    try {
      const state = await getConnectionState({
        baseUrl: EVOLUTION_BASE_URL,
        apiKey: decrypt(channel.evolution_api_key),
        instanceName: channel.evolution_instance_name,
      })
      const isConnected = state.status === 'open'
      if (isConnected !== (channel.status === 'connected')) {
        await supabase
          .from('whatsapp_channels')
          .update({
            status: isConnected ? 'connected' : 'disconnected',
            connected_at: isConnected ? new Date().toISOString() : channel.connected_at,
          })
          .eq('id', channel.id)
      }
      return NextResponse.json({
        connected: isConnected,
        instanceName: channel.evolution_instance_name,
      })
    } catch {
      return NextResponse.json({
        connected: false,
        instanceName: channel.evolution_instance_name,
        reason: 'server_unreachable',
      })
    }
  } catch (error) {
    console.error('[evolution/config] GET error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

/**
 * POST /api/whatsapp/evolution/config
 *
 * Creates (or reconnects) this account's Evolution instance and
 * returns a fresh QR code for the settings UI to render. Idempotent —
 * calling it again on an already-connecting instance just fetches a
 * new QR.
 */
export async function POST() {
  try {
    if (!EVOLUTION_BASE_URL || !EVOLUTION_ADMIN_KEY) {
      return NextResponse.json(
        { error: 'Evolution API is not configured on this server.' },
        { status: 500 },
      )
    }

    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    const { data: existing } = await supabase
      .from('whatsapp_channels')
      .select('*')
      .eq('account_id', accountId)
      .eq('provider', 'evolution')
      .maybeSingle()

    const instanceName = existing?.evolution_instance_name ?? instanceNameFor(accountId)
    const webhookSecret =
      existing?.evolution_webhook_secret ?? crypto.randomUUID().replace(/-/g, '')
    const webhookUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/api/whatsapp/evolution-webhook?token=${webhookSecret}`

    let apiKey: string
    let qrCode: string | undefined

    if (existing) {
      // Re-fetch a QR for an instance that already exists (e.g. the
      // phone was logged out and the dealership wants to re-pair).
      apiKey = decrypt(existing.evolution_api_key)
      const result = await fetchQrCode({ baseUrl: EVOLUTION_BASE_URL, apiKey, instanceName })
      qrCode = result.qrCode
    } else {
      const created = await createInstance({
        baseUrl: EVOLUTION_BASE_URL,
        adminApiKey: EVOLUTION_ADMIN_KEY,
        instanceName,
      })
      apiKey = created.apiKey
      qrCode = created.qrCode
    }

    if (webhookUrl.startsWith('http')) {
      try {
        await setWebhook({ baseUrl: EVOLUTION_BASE_URL, apiKey, instanceName, webhookUrl })
      } catch (err) {
        console.warn('[evolution/config] setWebhook failed:', err)
      }
    }

    const row = {
      account_id: accountId,
      user_id: user.id,
      provider: 'evolution' as const,
      status: 'disconnected',
      evolution_instance_name: instanceName,
      evolution_base_url: EVOLUTION_BASE_URL,
      evolution_api_key: encrypt(apiKey),
      evolution_webhook_secret: webhookSecret,
      updated_at: new Date().toISOString(),
    }

    if (existing) {
      await supabase.from('whatsapp_channels').update(row).eq('id', existing.id)
    } else {
      await supabase.from('whatsapp_channels').insert(row)
    }

    return NextResponse.json({ instanceName, qrCode })
  } catch (error) {
    console.error('[evolution/config] POST error:', error)
    const message = error instanceof Error ? error.message : 'Failed to connect'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * DELETE /api/whatsapp/evolution/config
 *
 * Disconnects and tears down the account's Evolution instance.
 */
export async function DELETE() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    const { data: existing } = await supabase
      .from('whatsapp_channels')
      .select('*')
      .eq('account_id', accountId)
      .eq('provider', 'evolution')
      .maybeSingle()

    if (existing && EVOLUTION_BASE_URL) {
      try {
        await deleteInstance({
          baseUrl: EVOLUTION_BASE_URL,
          apiKey: decrypt(existing.evolution_api_key),
          instanceName: existing.evolution_instance_name,
        })
      } catch (err) {
        console.warn('[evolution/config] deleteInstance failed (continuing):', err)
      }
    }

    const { error: deleteError } = await supabase
      .from('whatsapp_channels')
      .delete()
      .eq('account_id', accountId)
      .eq('provider', 'evolution')

    if (deleteError) {
      return NextResponse.json({ error: 'Failed to disconnect' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[evolution/config] DELETE error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
