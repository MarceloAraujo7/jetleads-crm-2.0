import { supabaseAdmin } from '@/lib/flows/admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sendTextMessage, sendMediaMessage, type MediaKind } from '@/lib/whatsapp/meta-api'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'
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
    .select('account_id, conversation_id')
    .eq('meta_message_id', quotedId)
    .maybeSingle()
  if (!notification) return false

  const { data: conversation } = await db
    .from('conversations')
    .select('id, contact:contacts(phone)')
    .eq('id', notification.conversation_id)
    .maybeSingle()
  const contact = conversation
    ? Array.isArray(conversation.contact)
      ? conversation.contact[0]
      : conversation.contact
    : null
  if (!conversation || !contact?.phone) {
    console.error('[relay-engine] matched notification but conversation/contact missing:', notification)
    return true // matched a relay message but couldn't act on it — don't fall through to contact creation
  }

  const { data: channel } = await db
    .from('whatsapp_channels')
    .select('phone_number_id, access_token')
    .eq('account_id', notification.account_id)
    .eq('provider', 'meta_cloud')
    .maybeSingle()
  if (!channel?.phone_number_id || !channel.access_token) {
    console.error('[relay-engine] no Meta channel for account:', notification.account_id)
    return true
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
        return true
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
        return true
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

  return true
}

/**
 * True if `senderPhone` (already `normalizePhone`-d, as the webhook
 * does for every inbound message) matches a `profiles.personal_phone`
 * for an agent on this account. Used to drop a stray non-quoted
 * message from an agent's own number instead of creating a contact
 * for them.
 */
export async function isKnownAgentPhone(accountId: string, senderPhone: string): Promise<boolean> {
  const db = supabaseAdmin()
  const { data: agents } = await db
    .from('profiles')
    .select('personal_phone')
    .eq('account_id', accountId)
    .not('personal_phone', 'is', null)
  if (!agents || agents.length === 0) return false
  return agents.some(
    (a) => a.personal_phone && normalizePhone(a.personal_phone) === senderPhone,
  )
}
