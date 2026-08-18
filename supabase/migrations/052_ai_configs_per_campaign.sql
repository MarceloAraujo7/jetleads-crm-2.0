-- ============================================================
-- Multiple named AI agents per account, so a campaign can have its
-- own agent (prompt/behavior) instead of every campaign sharing the
-- one account-wide assistant.
--
-- Until now ai_configs was UNIQUE(account_id) — exactly one agent per
-- workspace, used for both dashboard drafting and inbound auto-reply
-- everywhere. This drops that constraint and adds:
--   - name       — human label, shown in pickers ("Agente Qualificador").
--   - purpose    — free-text tag (e.g. "qualifier", "scheduler") driving
--                  a preset-prompt starting point in the UI; not
--                  enforced/read by the runtime.
--   - is_default — exactly one TRUE row per account (partial unique
--                  index below) — this is the agent every existing
--                  code path (Settings, Playground, draft-reply,
--                  auto-reply with no campaign match) already expects.
--     Existing rows are backfilled to is_default = true, so nothing
--     changes for an account that never creates a second agent.
--
-- A campaign links its own agent via the existing
-- campaign_actions.ai_config_id (action_type = 'agent') — no new
-- column needed there. Resolution (contact -> lead_base -> campaign ->
-- its agent, falling back to the account default) lives in
-- src/lib/ai/config.ts, not in SQL.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_account_id_key;

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT 'Agente padrão',
  ADD COLUMN IF NOT EXISTS purpose TEXT,
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;

UPDATE ai_configs SET is_default = true WHERE is_default = false;

CREATE UNIQUE INDEX IF NOT EXISTS ai_configs_default_key
  ON ai_configs (account_id) WHERE is_default;

CREATE INDEX IF NOT EXISTS idx_ai_configs_account ON ai_configs (account_id);
