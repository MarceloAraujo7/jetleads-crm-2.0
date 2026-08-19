import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sendTextMessage, sendMediaMessage, type MediaKind } from '@/lib/whatsapp/meta-api'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'
import { resolveChannel } from '@/lib/whatsapp/channel-resolve'
import type { WhatsAppMessage } from '@/app/api/whatsapp/webhook/route'

export const RELAYABLE_MEDIA_TYPES = new Set(['image', 'video', 'document', 'audio'])

/**
 * Relay Proxy — an agent replies to a lead by quote-replying (on their
 * own personal WhatsApp) to a message we sent them (the handoff
 * notification, or a forwarded customer reply — see relay-notify.ts
 * and the customer-reply forwarder in the webhook). Meta delivers that
 * reply to our webhook like any other inbound message, `context.id`
 * pointing at the quoted message.
 *
 * Call this FIRST in the webhook's message processing, before the
 * normal findOrCreateContact/conversation flow — a matched relay
 * message is never a new customer contact.
 *
 * Returns true if the message was a relay reply and has been fully
 * handled (caller should stop processing it further).
 */
export async function tryRelayFromAgent(message: WhatsAppMessage): Promise<boolean> {
  const quotedId = message.context?.id
  if (!quotedId) return false

  const db = supabaseAdmin()

  const { data: notification } = await db
    .from('agent_notifications')
    .select('account_id, conversation_id, channel_id')
    .eq('meta_message_id', quotedId)
    .maybeSingle()
  if (!notification) return false

  await relayAndPersist(db, notification.account_id, notification.conversation_id, notification.channel_id, message)
  return true
}

/**
 * Fallback for the case that was breaking the "one continuous chat"
 * expectation: the agent replies on their own WhatsApp WITHOUT
 * quote-replying (the natural thing to do — WhatsApp gives no visual
 * cue that quoting is required). `tryRelayFromAgent` above found
 * nothing to match, but the sender IS a known agent's personal_phone —
 * before giving up, check whether this agent has exactly ONE
 * still-open conversation assigned to them. If so, there's no real
 * ambiguity about who the reply is for, so relay it there instead of
 * silently dropping it (which is what pushed the agent to work around
 * it by texting the lead directly from their own number — creating a
 * second, disconnected thread on the customer's side).
 *
 * Returns true once handled (relayed, or determined ambiguous/none —
 * either way the caller should stop processing this as a new customer
 * message). Returns false only if `senderPhone` doesn't match any
 * agent on this account, so the caller can fall through to normal
 * contact creation.
 */
export async function tryRelayFromAgentByAssignment(
  accountId: string,
  senderPhone: string,
  message: WhatsAppMessage,
): Promise<boolean> {
  const db = supabaseAdmin()

  const { data: agents } = await db
    .from('profiles')
    .select('user_id, personal_phone')
    .eq('account_id', accountId)
    .not('personal_phone', 'is', null)
  const agentUserId = agents?.find(
    (a) => a.personal_phone && normalizePhone(a.personal_phone) === senderPhone,
  )?.user_id as string | undefined
  if (!agentUserId) return false

  const { data: candidates } = await db
    .from('conversations')
    .select('id, channel_id')
    .eq('account_id', accountId)
    .eq('assigned_agent_id', agentUserId)
    .neq('status', 'closed')
    .order('last_message_at', { ascending: false })
    .limit(2)

  if (!candidates || candidates.length !== 1) {
    console.warn(
      `[relay-engine] agent ${agentUserId} sent a non-quoted reply with ${candidates?.length ?? 0} open assigned conversations — can't tell which lead it's for, dropped. Ask them to quote-reply the customer's message instead.`,
    )
    return true
  }

  await relayAndPersist(db, accountId, candidates[0].id, candidates[0].channel_id, message)
  return true
}

/** Shared send-to-customer + persist step used by both match paths above. */
async function relayAndPersist(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  channelHint: string | null,
  message: WhatsAppMessage,
): Promise<void> {
  const { data: conversation } = await db
    .from('conversations')
    .select('id, contact:contacts(phone)')
    .eq('id', conversationId)
    .maybeSingle()
  const contact = conversation
    ? Array.isArray(conversation.contact)
      ? conversation.contact[0]
      : conversation.contact
    : null
  if (!conversation || !contact?.phone) {
    console.error('[relay-engine] matched conversation missing or has no contact phone:', conversationId)
    return
  }

  // Reuse the exact channel that sent the notification/forward being
  // replied to, so the reply goes out through the same number the
  // lead has been talking to — not a freshly re-resolved (possibly
  // different) one. Falls back to normal resolution for older rows
  // saved before `channel_id` existed.
  const channel = await resolveChannel(db, accountId, {
    channelId: channelHint ?? undefined,
    phoneForDdd: channelHint ? undefined : contact.phone,
  })
  if (!channel?.phone_number_id || !channel.access_token) {
    console.error('[relay-engine] no Meta channel for account:', accountId)
    return
  }
  const accessToken = decrypt(channel.access_token)

  try {
    let waMessageId: string
    let contentType: string
    let contentText: string | null = null
    let mediaUrl: string | null = null

    if (RELAYABLE_MEDIA_TYPES.has(message.type)) {
      const kind = message.type as MediaKind
      const media = message[kind as 'image' | 'video' | 'document' | 'audio']
      if (!media?.id) {
        console.error('[relay-engine] media message missing id:', message.type)
        return
      }
      const caption =
        kind === 'image' || kind === 'video' || kind === 'document'
          ? (message[kind] as { caption?: string })?.caption
          : undefined
      const filename = kind === 'document' ? message.document?.filename : undefined
      const result = await sendMediaMessage({
        phoneNumberId: channel.phone_number_id,
        accessToken,
        to: contact.phone,
        kind,
        mediaId: media.id,
        caption,
        filename,
      })
      waMessageId = result.messageId
      contentType = kind
      contentText = caption || filename || null
      // Same proxy convention used for inbound customer media — fetches
      // live from Meta with the account's token, works for this id too
      // since it's the same WABA.
      mediaUrl = `/api/whatsapp/media/${media.id}`
    } else {
      // Text is the only other type an agent's WhatsApp app can send in
      // reply; anything else (location, reaction, etc.) is dropped.
      const text = message.text?.body
      if (!text) {
        console.warn('[relay-engine] unsupported relay message type:', message.type)
        return
      }
      const result = await sendTextMessage({
        phoneNumberId: channel.phone_number_id,
        accessToken,
        to: contact.phone,
        text,
      })
      waMessageId = result.messageId
      contentType = 'text'
      contentText = text
    }

    const { error: msgError } = await db.from('messages').insert({
      conversation_id: conversation.id,
      sender_type: 'agent',
      content_type: contentType,
      content_text: contentText,
      media_url: mediaUrl,
      message_id: waMessageId,
      status: 'sent',
    })
    if (msgError) {
      console.error('[relay-engine] relayed to customer but failed to persist message:', msgError)
    }

    await db
      .from('conversations')
      .update({
        last_message_text: contentText || `[${contentType}]`,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversation.id)
  } catch (err) {
    console.error('[relay-engine] failed to relay agent message to customer:', err)
  }
}
