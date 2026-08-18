import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { validateAiCredentials } from '@/lib/ai/validate'
import { AiError, type AiProvider } from '@/lib/ai/types'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

/** GET /api/ai/configs/[id] — single agent's detail (any member). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { id } = await params

    const { data, error } = await supabase
      .from('ai_configs')
      .select(
        'id, name, purpose, provider, model, system_prompt, is_active, is_default, auto_reply_enabled, auto_reply_max_per_conversation, handoff_agent_id, api_key, embeddings_api_key',
      )
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()

    if (error) {
      console.error('[ai/configs/[id] GET] fetch error:', error)
      return NextResponse.json({ error: 'Failed to load AI agent' }, { status: 500 })
    }
    if (!data) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

    const { api_key, embeddings_api_key, ...safe } = data
    return NextResponse.json({
      ...safe,
      has_key: !!api_key,
      has_embeddings_key: !!embeddings_api_key,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * PATCH /api/ai/configs/[id]  (admin+)
 *
 * Updates one agent. `api_key`/`embeddings_api_key` are omitted to
 * leave them unchanged (the form only sends them when re-entered) —
 * same convention as the old single-config route. Re-validates with
 * the provider only when provider/model/key actually changed.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const { id } = await params

    const limit = checkRateLimit(`ai-config:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { data: existing } = await supabase
      .from('ai_configs')
      .select('id, provider, model, api_key')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (!existing) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    const patch: Record<string, unknown> = {}

    if (typeof body.name === 'string') {
      const name = body.name.trim()
      if (!name) return bad('name cannot be empty')
      patch.name = name
    }
    if ('purpose' in body) {
      patch.purpose = typeof body.purpose === 'string' && body.purpose.trim() ? body.purpose.trim() : null
    }
    if ('system_prompt' in body) {
      patch.system_prompt =
        typeof body.system_prompt === 'string' && body.system_prompt.trim()
          ? body.system_prompt.trim()
          : null
    }
    if ('is_active' in body) patch.is_active = body.is_active === true
    if ('auto_reply_enabled' in body) patch.auto_reply_enabled = body.auto_reply_enabled === true
    if ('auto_reply_max_per_conversation' in body) {
      let maxPer = Number(body.auto_reply_max_per_conversation)
      if (!Number.isFinite(maxPer)) maxPer = 3
      patch.auto_reply_max_per_conversation = Math.min(20, Math.max(1, Math.floor(maxPer)))
    }
    if ('handoff_agent_id' in body) {
      const raw = typeof body.handoff_agent_id === 'string' ? body.handoff_agent_id.trim() : ''
      if (raw) {
        const { data: member } = await supabase
          .from('profiles')
          .select('user_id')
          .eq('account_id', accountId)
          .eq('user_id', raw)
          .maybeSingle()
        if (!member) return bad('handoff_agent_id must be a member of this account')
        patch.handoff_agent_id = raw
      } else {
        patch.handoff_agent_id = null
      }
    }

    const providerChanging = typeof body.provider === 'string' && body.provider !== existing.provider
    const modelChanging = typeof body.model === 'string' && body.model.trim() !== existing.model
    const rawKey = typeof body.api_key === 'string' ? body.api_key.trim() : ''

    if (providerChanging || modelChanging || rawKey) {
      const provider = (typeof body.provider === 'string' ? body.provider : existing.provider) as AiProvider
      if (provider !== 'openai' && provider !== 'anthropic') {
        return bad('provider must be "openai" or "anthropic"')
      }
      const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : existing.model
      let apiKeyPlain: string
      if (rawKey) {
        apiKeyPlain = rawKey
      } else {
        try {
          apiKeyPlain = decrypt(existing.api_key)
        } catch {
          return bad('Stored API key could not be decrypted — re-enter your key.')
        }
      }
      try {
        await validateAiCredentials({
          provider,
          model,
          apiKey: apiKeyPlain,
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
        console.error('[ai/configs/[id] PATCH] validation error:', err)
        return bad('Could not validate the API key with the provider.')
      }
      patch.provider = provider
      patch.model = model
      if (rawKey) patch.api_key = encrypt(rawKey)
    }

    if (body.embeddings_api_key === null) {
      patch.embeddings_api_key = null
    } else if (typeof body.embeddings_api_key === 'string' && body.embeddings_api_key.trim()) {
      patch.embeddings_api_key = encrypt(body.embeddings_api_key.trim())
    }

    if (Object.keys(patch).length === 0) return NextResponse.json({ success: true })

    const { error: upErr } = await supabase.from('ai_configs').update(patch).eq('id', id)
    if (upErr) {
      console.error('[ai/configs/[id] PATCH] update error:', upErr)
      return NextResponse.json({ error: 'Failed to save AI agent' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/ai/configs/[id]  (admin+)
 *
 * Removing the account's default agent auto-promotes another existing
 * agent (oldest first) so is_default never goes dark while other
 * agents still exist — every non-campaign-scoped call site depends on
 * there being exactly one.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { id } = await params

    const { data: target } = await supabase
      .from('ai_configs')
      .select('id, is_default')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (!target) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

    const { error: delErr } = await supabase.from('ai_configs').delete().eq('id', id)
    if (delErr) {
      console.error('[ai/configs/[id] DELETE] error:', delErr)
      return NextResponse.json({ error: 'Failed to delete AI agent' }, { status: 500 })
    }

    if (target.is_default) {
      const { data: next } = await supabase
        .from('ai_configs')
        .select('id')
        .eq('account_id', accountId)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (next) {
        await supabase.from('ai_configs').update({ is_default: true }).eq('id', next.id)
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
