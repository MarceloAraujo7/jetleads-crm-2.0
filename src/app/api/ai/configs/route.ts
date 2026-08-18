import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { encrypt } from '@/lib/whatsapp/encryption'
import { validateAiCredentials } from '@/lib/ai/validate'
import { AiError, type AiProvider } from '@/lib/ai/types'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

/**
 * GET /api/ai/configs
 *
 * Lists every named AI agent on the account (multi-agent, migration
 * 052) — any member may read, same "settings is visible, only admin+
 * can write" pattern as the rest of Settings. The encrypted key is
 * never returned, only a `has_key` flag.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()

    const { data, error } = await supabase
      .from('ai_configs')
      .select(
        'id, name, purpose, provider, model, is_active, is_default, auto_reply_enabled, auto_reply_max_per_conversation, handoff_agent_id, api_key, embeddings_api_key, created_at',
      )
      .eq('account_id', accountId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true })

    if (error) {
      console.error('[ai/configs GET] fetch error:', error)
      return NextResponse.json({ error: 'Failed to load AI agents' }, { status: 500 })
    }

    const configs = (data ?? []).map(({ api_key, embeddings_api_key, ...rest }) => ({
      ...rest,
      has_key: !!api_key,
      has_embeddings_key: !!embeddings_api_key,
    }))

    return NextResponse.json({ configs })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/ai/configs  (admin+)
 *
 * Creates a new named agent. Two ways to supply credentials:
 *   - `clone_from_id`: copy provider/model/api_key(+embeddings key) from
 *     an existing agent on this account — the "reuse an existing setup"
 *     path, no re-validation needed since the key already works.
 *   - `provider`/`model`/`api_key`: a fresh BYOK setup, validated with
 *     the provider before saving (same discipline as the old single-
 *     config route).
 * The account's very first agent is automatically the default — every
 * other call site (Settings, Playground, draft-reply, auto-reply with
 * no campaign match) expects exactly one is_default row to exist.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`ai-config:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return bad('name is required')
    const purpose =
      typeof body.purpose === 'string' && body.purpose.trim() ? body.purpose.trim() : null

    let provider: AiProvider
    let model: string
    let apiKeyEncrypted: string
    let embeddingsKeyEncrypted: string | null = null

    const cloneFromId = typeof body.clone_from_id === 'string' ? body.clone_from_id : ''
    if (cloneFromId) {
      const { data: source } = await supabase
        .from('ai_configs')
        .select('provider, model, api_key, embeddings_api_key')
        .eq('id', cloneFromId)
        .eq('account_id', accountId)
        .maybeSingle()
      if (!source) return bad('clone_from_id does not match an agent on this account')
      provider = source.provider as AiProvider
      model = source.model as string
      apiKeyEncrypted = source.api_key as string
      embeddingsKeyEncrypted = (source.embeddings_api_key as string | null) ?? null
    } else {
      const rawProvider = body.provider as AiProvider
      if (rawProvider !== 'openai' && rawProvider !== 'anthropic') {
        return bad('provider must be "openai" or "anthropic"')
      }
      provider = rawProvider
      model = typeof body.model === 'string' ? body.model.trim() : ''
      if (!model) return bad('model is required')
      const rawKey = typeof body.api_key === 'string' ? body.api_key.trim() : ''
      if (!rawKey) return bad('api_key is required')

      try {
        await validateAiCredentials({
          provider,
          model,
          apiKey: rawKey,
          systemPrompt: null,
          isActive: false,
          autoReplyEnabled: false,
          autoReplyMaxPerConversation: 3,
          handoffAgentId: null,
          embeddingsApiKey: null,
        })
      } catch (err) {
        if (err instanceof AiError) {
          return NextResponse.json({ error: err.message, code: err.code }, { status: 400 })
        }
        console.error('[ai/configs POST] validation error:', err)
        return bad('Could not validate the API key with the provider.')
      }
      apiKeyEncrypted = encrypt(rawKey)
    }

    const systemPrompt =
      typeof body.system_prompt === 'string' && body.system_prompt.trim()
        ? body.system_prompt.trim()
        : null

    const { count } = await supabase
      .from('ai_configs')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
    const isFirstAgent = (count ?? 0) === 0

    const { data: inserted, error } = await supabase
      .from('ai_configs')
      .insert({
        account_id: accountId,
        created_by: userId,
        name,
        purpose,
        provider,
        model,
        api_key: apiKeyEncrypted,
        embeddings_api_key: embeddingsKeyEncrypted,
        system_prompt: systemPrompt,
        is_active: body.is_active === true,
        auto_reply_enabled: false,
        is_default: isFirstAgent,
      })
      .select('id')
      .single()

    if (error || !inserted) {
      console.error('[ai/configs POST] insert error:', error)
      return NextResponse.json({ error: 'Failed to create AI agent' }, { status: 500 })
    }

    return NextResponse.json({ id: inserted.id }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
