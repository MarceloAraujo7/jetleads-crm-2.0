import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'

export interface WhatsAppChannel {
  id: string
  account_id: string
  provider: string
  status: string
  phone_number_id: string | null
  waba_id: string | null
  access_token: string | null
  verify_token: string | null
  label: string | null
  ddd: string | null
  is_default: boolean
  assigned_agent_id: string | null
  evolution_instance_name: string | null
  evolution_base_url: string | null
  evolution_api_key: string | null
  evolution_webhook_secret: string | null
  [key: string]: unknown
}

export interface ResolveChannelOptions {
  /** Use this exact channel — skips all other resolution. */
  channelId?: string
  /**
   * Route by the recipient/lead's phone number's Brazilian area code
   * (DDD). Falls back to the account's generic number (ddd IS NULL),
   * then to the account default, exactly like Jetleads Prospect's
   * pickNumberForPhone/buildNumberPool — no rate limiting, no
   * round-robin, just DDD match.
   */
  phoneForDdd?: string
}

/**
 * Extract the 2-digit Brazilian area code (DDD) from a phone number,
 * or null if it doesn't look like a +55 number. Brazil-specific by
 * design — the `ddd` column/concept only makes sense for BR numbers;
 * accounts routing non-BR numbers just get the account default.
 */
export function extractDDD(phone: string): string | null {
  const digits = normalizePhone(phone)
  if (!digits.startsWith('55') || digits.length < 4) return null
  return digits.slice(2, 4)
}

/**
 * Single point of "which Meta Cloud channel should this send use."
 * Replaces the ~18 scattered `.eq('provider','meta_cloud').single()`
 * lookups that assumed exactly one channel per account.
 *
 * Resolution order:
 *   1. `channelId` — use exactly that channel.
 *   2. `phoneForDdd` — DDD pool match, then the account's generic
 *      (ddd IS NULL) number, then the account default.
 *   3. Neither given — the account's default meta_cloud channel.
 *
 * Returns null if nothing matches (caller surfaces "not configured").
 */
export async function resolveChannel(
  db: SupabaseClient,
  accountId: string,
  opts: ResolveChannelOptions = {},
): Promise<WhatsAppChannel | null> {
  if (opts.channelId) {
    const { data } = await db
      .from('whatsapp_channels')
      .select('*')
      .eq('id', opts.channelId)
      .eq('account_id', accountId)
      .maybeSingle()
    return (data as WhatsAppChannel | null) ?? null
  }

  if (opts.phoneForDdd) {
    const ddd = extractDDD(opts.phoneForDdd)
    if (ddd) {
      const { data: pool } = await db
        .from('whatsapp_channels')
        .select('*')
        .eq('account_id', accountId)
        .eq('provider', 'meta_cloud')
      const channels = (pool as WhatsAppChannel[] | null) ?? []
      const match = channels.find((c) => c.ddd === ddd)
      if (match) return match
      const generic = channels.find((c) => !c.ddd)
      if (generic) return generic
      const fallbackDefault = channels.find((c) => c.is_default)
      if (fallbackDefault) return fallbackDefault
    }
  }

  const { data } = await db
    .from('whatsapp_channels')
    .select('*')
    .eq('account_id', accountId)
    .eq('provider', 'meta_cloud')
    .eq('is_default', true)
    .maybeSingle()
  return (data as WhatsAppChannel | null) ?? null
}
