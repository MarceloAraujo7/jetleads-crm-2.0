import type { MessageTemplate } from '@/types'

/**
 * Meta's official per-message rates for WhatsApp Business (Brazil),
 * mirrored 1:1 from the Jetleads 3.0 prototype's broadcast wizard —
 * Marketing-category templates are billed at the higher rate;
 * Utility and Authentication share the lower one. These are ceiling
 * estimates: a recipient with an already-open free service window
 * costs less in practice, which is why the UI calls this a maximum,
 * not a guarantee.
 */
export const META_MESSAGE_RATE_USD: Record<MessageTemplate['category'], number> = {
  Marketing: 0.0625,
  Utility: 0.035,
  Authentication: 0.035,
}

export function metaRateForCategory(category: MessageTemplate['category'] | undefined | null): number {
  if (!category) return META_MESSAGE_RATE_USD.Utility
  return META_MESSAGE_RATE_USD[category] ?? META_MESSAGE_RATE_USD.Utility
}

export interface BroadcastCostEstimate {
  ratePerMessageUsd: number
  costUsd: number
  costBrl: number
}

/**
 * Ceiling cost estimate for sending `recipientCount` messages with a
 * template of the given category, converted to BRL at `usdToBrlRate`
 * (accounts.whatsapp_usd_brl_rate). Same formula as the reference
 * module: recipients × per-message rate, no discounting for open
 * service windows — that's the "worst case" framing shown to the user
 * before they commit to a send.
 */
export function estimateBroadcastCost(
  recipientCount: number,
  category: MessageTemplate['category'] | undefined | null,
  usdToBrlRate: number,
): BroadcastCostEstimate {
  const ratePerMessageUsd = metaRateForCategory(category)
  const costUsd = Number((recipientCount * ratePerMessageUsd).toFixed(4))
  const costBrl = Number((costUsd * usdToBrlRate).toFixed(2))
  return { ratePerMessageUsd, costUsd, costBrl }
}
