import { supabaseAdmin } from '@/lib/flows/admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sendTemplateMessage, sendTextMessage, sendMediaMessage, type MediaKind } from '@/lib/whatsapp/meta-api'
import { RELAYABLE_MEDIA_TYPES } from '@/lib/whatsapp/relay-engine'
import { resolveChannel } from '@/lib/whatsapp/channel-resolve'
import type { WhatsAppMessage } from '@/app/api/whatsapp/webhook/route'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Shared lookup: the agent's personal phone + which Meta channel to
 * send from. Both `notifyAgentOfHandoff` and `forwardCustomerReplyToAgent`
 * send TO the agent about a specific lead, so they resolve the number
 * the same way: the conversation's own channel if it's already
 * anchored to one, else DDD-routed by the lead's phone, else the
 * account default — same as any other outbound send.
 */
async function resolveAgentAndChannel(
  db: SupabaseClient,
  accountId: string,
  agentUserId: string,
  opts: { channelId?: string | null; leadPhone?: string | null } = {},
): Promise<{ agentPhone: string; phoneNumberId: string; accessToken: string; channelId: string } | null> {
  const { data: profile } = await db
    .from('profiles')
    .select('personal_phone')
    .eq('user_id', agentUserId)
    .maybeSingle()
  const agentPhone = profile?.personal_phone as string | undefined
  if (!agentPhone) {
    console.warn(`[relay-notify] agent ${agentUserId} has no personal_phone set — skipping.`)
    return null
  }

  const channel = await resolveChannel(db, accountId, {
    channelId: opts.channelId ?? undefined,
    phoneForDdd: opts.leadPhone ?? undefined,
  })
  if (!channel?.phone_number_id || !channel.access_token) {
    console.warn(`[relay-notify] account ${accountId} has no Meta channel configured — skipping.`)
    return null
  }

  return {
    agentPhone,
    phoneNumberId: channel.phone_number_id,
    accessToken: decrypt(channel.access_token),
    channelId: channel.id,
  }
}

/**
 * Relay Proxy — notify the assigned agent on their own WhatsApp when a
 * lead is handed off to them, via an approved Meta template (a
 * business-initiated message to a number that isn't a CRM contact
 * needs a template, not a free-form send). The resulting message id
 * is stored in `agent_notifications` so the agent's quote-reply can
 * be resolved back to this conversation later (see relay-engine.ts).
 *
 * Best-effort: callers fire this without awaiting the result mattering
 * to the handoff itself — a missing personal_phone, an unconfigured
 * Meta channel, or a rejected template send should never break the
 * underlying assignment.
 */
export async function notifyAgentOfHandoff(
  conversationId: string,
  agentUserId: string,
): Promise<void> {
  const db = supabaseAdmin()

  const { data: conversation } = await db
    .from('conversations')
    .select('id, account_id, channel_id, ai_handoff_summary, contact:contacts(name, phone)')
    .eq('id', conversationId)
    .maybeSingle()
  if (!conversation) return

  const accountId = conversation.account_id as string
  const contact = Array.isArray(conversation.contact)
    ? conversation.contact[0]
    : conversation.contact
  const leadName = contact?.name || contact?.phone || 'Lead'
  const summary = (conversation.ai_handoff_summary as string | null) || 'Sem resumo disponível.'

  const resolved = await resolveAgentAndChannel(db, accountId, agentUserId, {
    channelId: conversation.channel_id as string | null,
    leadPhone: contact?.phone,
  })
  if (!resolved) return
  const { agentPhone, phoneNumberId, accessToken, channelId } = resolved

  try {
    const result = await sendTemplateMessage({
      phoneNumberId,
      accessToken,
      to: agentPhone,
      templateName: RELAY_NOTIFICATION_TEMPLATE,
      language: 'pt_BR',
      params: [leadName, summary],
    })

    await db.from('agent_notifications').insert({
      account_id: accountId,
      conversation_id: conversationId,
      agent_user_id: agentUserId,
      meta_message_id: result.messageId,
      channel_id: channelId,
    })

    // Best-effort instructional follow-up, free-form (rides the session
    // window the template just opened, so it needs no Meta approval and
    // can say exactly what the approved template can't). Only matters
    // when the agent has more than one lead going at once — with a
    // single active conversation, a reply relays automatically even
    // without quoting (see tryRelayFromAgentByAssignment in relay-engine.ts).
    try {
      await sendTextMessage({
        phoneNumberId,
        accessToken,
        to: agentPhone,
        text: 'Você pode responder digitando aqui mesmo. Se estiver atendendo mais de um cliente ao mesmo tempo, toque e segure a mensagem do cliente certo e escolha "Responder" antes de digitar, pra garantir que a resposta vá pra pessoa certa.',
      })
    } catch (err) {
      console.error('[relay-notify] failed to send follow-up instructions:', err)
    }
  } catch (err) {
    console.error('[relay-notify] failed to notify agent:', err)
  }
}

/**
 * Relay Proxy — forward a customer's inbound message to the assigned
 * agent's personal WhatsApp, so the conversation stays "citable" on
 * their end (they can quote-reply to THIS forwarded message, not just
 * the original handoff notification, for a natural back-and-forth).
 * Called from the webhook right after a normal customer message is
 * processed, only when the conversation already has an assigned agent.
 *
 * Best-effort — never throws; a forwarding failure must not affect
 * the customer-facing webhook processing that triggered it.
 */
export async function forwardCustomerReplyToAgent(
  conversationId: string,
  accountId: string,
  agentUserId: string,
  message: WhatsAppMessage,
  contentType: string,
  contentText: string | null,
  channelId?: string | null,
): Promise<void> {
  const db = supabaseAdmin()

  const resolved = await resolveAgentAndChannel(db, accountId, agentUserId, { channelId })
  if (!resolved) return
  const { agentPhone, phoneNumberId, accessToken, channelId: resolvedChannelId } = resolved

  try {
    let waMessageId: string

    if (RELAYABLE_MEDIA_TYPES.has(contentType)) {
      const kind = contentType as MediaKind
      const media = message[kind as 'image' | 'video' | 'document' | 'audio']
      if (!media?.id) {
        console.warn('[relay-notify] customer media message missing id, skipping forward')
        return
      }
      const result = await sendMediaMessage({
        phoneNumberId,
        accessToken,
        to: agentPhone,
        kind,
        mediaId: media.id,
        caption: contentText || undefined,
      })
      waMessageId = result.messageId
    } else if (contentType === 'text' && contentText) {
      const result = await sendTextMessage({
        phoneNumberId,
        accessToken,
        to: agentPhone,
        text: `💬 Cliente: ${contentText}`,
      })
      waMessageId = result.messageId
    } else {
      // Unsupported type for forwarding (location, reaction, etc.) —
      // the agent still sees it in the dashboard Inbox if they open it.
      return
    }

    await db.from('agent_notifications').insert({
      account_id: accountId,
      conversation_id: conversationId,
      agent_user_id: agentUserId,
      meta_message_id: waMessageId,
      channel_id: resolvedChannelId,
    })
  } catch (err) {
    console.error('[relay-notify] failed to forward customer reply to agent:', err)
  }
}

/**
 * Name of the approved Meta template used for handoff notifications.
 * Must be created and approved in Settings → Templates before this
 * flow works — the code only references the name, it can't create
 * Meta approvals on its own. Body: two variables — lead name, then
 * the AI's handoff summary.
 */
export const RELAY_NOTIFICATION_TEMPLATE = 'lead_handoff'
