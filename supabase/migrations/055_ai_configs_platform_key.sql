-- Lets an agent run on the platform's own shared AI key instead of
-- requiring every account to bring their own — api_key IS NULL now
-- means "use the platform key" (resolved at request time from
-- PLATFORM_AI_PROVIDER/PLATFORM_AI_MODEL/PLATFORM_AI_API_KEY, see
-- src/lib/ai/platform-key.ts) rather than "broken/unconfigured".
ALTER TABLE ai_configs ALTER COLUMN api_key DROP NOT NULL;
