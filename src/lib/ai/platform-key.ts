import type { AiProvider } from './types'

/**
 * The Jetleads-managed AI key — set once (via env vars, never exposed
 * in the app) so an account can run its AI agent without bringing its
 * own OpenAI/Anthropic key. An `ai_configs` row with `api_key IS NULL`
 * means "use this" (see loadAiConfig in ./config.ts); a row with its
 * own key always takes priority.
 *
 * Not configured on a given deployment simply means BYOK stays
 * mandatory there — no behavior change for installs that never set
 * these.
 */
export interface PlatformAiConfig {
  provider: AiProvider
  model: string
  apiKey: string
}

export function getPlatformAiConfig(): PlatformAiConfig | null {
  const provider = process.env.PLATFORM_AI_PROVIDER
  const model = process.env.PLATFORM_AI_MODEL
  const apiKey = process.env.PLATFORM_AI_API_KEY
  if (!apiKey || !model) return null
  if (provider !== 'openai' && provider !== 'anthropic') return null
  return { provider, model, apiKey }
}

/** True when this deployment has a platform key configured at all —
 *  drives whether the "use the shared model" option even appears. */
export function hasPlatformAiConfig(): boolean {
  return getPlatformAiConfig() !== null
}
