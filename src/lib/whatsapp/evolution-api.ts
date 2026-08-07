/**
 * Evolution API helpers — unofficial WhatsApp (WhatsApp Web protocol,
 * self-hosted). Used only for free-form inbox conversation; campaigns
 * always go through Meta Cloud API (meta-api.ts) since Evolution has
 * no template concept and no session-window exemption.
 *
 * Mirrors meta-api.ts's shape (named-params functions, `{ messageId }`
 * return type) so send-message.ts can call either provider behind one
 * interface.
 */

export interface EvolutionSendResult {
  messageId: string
}

interface EvolutionErrorResponse {
  message?: string | string[]
  error?: string
  response?: { message?: string | string[] }
}

async function throwEvolutionError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const data = (await response.json()) as EvolutionErrorResponse
    const raw = data.response?.message ?? data.message ?? data.error
    if (raw) message = Array.isArray(raw) ? raw.join('; ') : raw
  } catch {
    // response body wasn't JSON — keep the fallback
  }
  throw new Error(message)
}

function authHeaders(apiKey: string): HeadersInit {
  return { apikey: apiKey, 'Content-Type': 'application/json' }
}

// ============================================================
// Instance management
// ============================================================

export interface EvolutionInstanceInfo {
  instanceName: string
  status: 'open' | 'connecting' | 'close' | string
}

export interface CreateInstanceArgs {
  baseUrl: string
  adminApiKey: string
  instanceName: string
}

/**
 * Create a new Evolution instance and return its own per-instance API
 * key (distinct from the server's admin key) plus a QR-pairing hint.
 * The caller stores the returned `apiKey` — the admin key is only
 * used for this one provisioning call.
 */
export async function createInstance(
  args: CreateInstanceArgs
): Promise<{ apiKey: string; qrCode?: string }> {
  const { baseUrl, adminApiKey, instanceName } = args
  const response = await fetch(`${baseUrl}/instance/create`, {
    method: 'POST',
    headers: authHeaders(adminApiKey),
    body: JSON.stringify({
      instanceName,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
    }),
  })
  if (!response.ok) {
    await throwEvolutionError(response, `Evolution API error: ${response.status}`)
  }
  const data = await response.json()
  return {
    apiKey: data.hash?.apikey ?? data.hash ?? adminApiKey,
    qrCode: data.qrcode?.base64,
  }
}

/** Fetch a fresh QR code for an instance awaiting pairing. */
export async function fetchQrCode(args: {
  baseUrl: string
  apiKey: string
  instanceName: string
}): Promise<{ qrCode?: string; status: string }> {
  const { baseUrl, apiKey, instanceName } = args
  const response = await fetch(
    `${baseUrl}/instance/connect/${instanceName}`,
    { headers: authHeaders(apiKey) }
  )
  if (!response.ok) {
    await throwEvolutionError(response, `Evolution API error: ${response.status}`)
  }
  const data = await response.json()
  return { qrCode: data.base64, status: data.instance?.state ?? 'connecting' }
}

/** Poll connection state for an instance ('open' = paired and ready). */
export async function getConnectionState(args: {
  baseUrl: string
  apiKey: string
  instanceName: string
}): Promise<EvolutionInstanceInfo> {
  const { baseUrl, apiKey, instanceName } = args
  const response = await fetch(
    `${baseUrl}/instance/connectionState/${instanceName}`,
    { headers: authHeaders(apiKey) }
  )
  if (!response.ok) {
    await throwEvolutionError(response, `Evolution API error: ${response.status}`)
  }
  const data = await response.json()
  return {
    instanceName,
    status: data.instance?.state ?? 'close',
  }
}

/** Tear down an instance (used when disconnecting the channel). */
export async function deleteInstance(args: {
  baseUrl: string
  apiKey: string
  instanceName: string
}): Promise<void> {
  const { baseUrl, apiKey, instanceName } = args
  await fetch(`${baseUrl}/instance/delete/${instanceName}`, {
    method: 'DELETE',
    headers: authHeaders(apiKey),
  })
  // Best-effort — an already-gone instance shouldn't block disconnect.
}

/** Register the webhook Evolution will POST inbound events to. */
export async function setWebhook(args: {
  baseUrl: string
  apiKey: string
  instanceName: string
  webhookUrl: string
}): Promise<void> {
  const { baseUrl, apiKey, instanceName, webhookUrl } = args
  const response = await fetch(`${baseUrl}/webhook/set/${instanceName}`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({
      webhook: {
        url: webhookUrl,
        enabled: true,
        events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'],
      },
    }),
  })
  if (!response.ok) {
    await throwEvolutionError(response, `Evolution API error: ${response.status}`)
  }
}

// ============================================================
// Sending
// ============================================================

function toEvolutionNumber(phoneE164: string): string {
  // Evolution expects digits only, no leading '+'.
  return phoneE164.replace(/^\+/, '')
}

export interface SendTextArgs {
  baseUrl: string
  apiKey: string
  instanceName: string
  to: string
  text: string
}

export async function sendTextMessage(args: SendTextArgs): Promise<EvolutionSendResult> {
  const { baseUrl, apiKey, instanceName, to, text } = args
  const response = await fetch(`${baseUrl}/message/sendText/${instanceName}`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ number: toEvolutionNumber(to), text }),
  })
  if (!response.ok) {
    await throwEvolutionError(response, `Evolution API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.key?.id ?? data.id ?? '' }
}

export type EvolutionMediaKind = 'image' | 'video' | 'document' | 'audio'

export interface SendMediaArgs {
  baseUrl: string
  apiKey: string
  instanceName: string
  to: string
  kind: EvolutionMediaKind
  link: string
  caption?: string
  filename?: string
}

export async function sendMediaMessage(args: SendMediaArgs): Promise<EvolutionSendResult> {
  const { baseUrl, apiKey, instanceName, to, kind, link, caption, filename } = args
  const response = await fetch(`${baseUrl}/message/sendMedia/${instanceName}`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({
      number: toEvolutionNumber(to),
      mediatype: kind,
      media: link,
      caption: caption || undefined,
      fileName: filename || undefined,
    }),
  })
  if (!response.ok) {
    await throwEvolutionError(response, `Evolution API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.key?.id ?? data.id ?? '' }
}
