-- ============================================================
-- Evolution API, one connection per salesperson.
--
-- Until now an account could have exactly one 'evolution' row
-- (whatsapp_channels_evolution_one_per_account, migration 040) —
-- a single shared, unofficial WhatsApp connection used by whoever was
-- looking at the Inbox. Meta Cloud API already supports several
-- agent-owned numbers per account (migration 040/042); this brings
-- Evolution to the same model so each seller can link their own
-- personal WhatsApp instead of everyone sharing one phone.
--
-- Two partial unique indexes replace the old one:
--   - one evolution row per (account, agent) once a row is claimed
--     (assigned_agent_id set) — a seller can't double-connect;
--   - at most one *unclaimed* evolution row per account — preserves
--     today's single shared connection as a fallback (see
--     send-message.ts) instead of breaking it outright.
--
-- account_has_agent_owned_channel() gates six RLS policies
-- (whatsapp_channels_select, conversations_select/update/delete,
-- messages_select/modify — migration 042) that scope visibility to
-- "your own channel's conversations" once an account opts in by
-- actually assigning a channel to an agent. It only checked
-- provider = 'meta_cloud' before; extending it to evolution means
-- those same scoping rules apply the moment an agent claims a
-- personal Evolution connection, not just a Meta number.
--
-- whatsapp_channels_select previously had `provider = 'evolution' OR
-- ...` — an unconditional bypass that was harmless when there was
-- nothing to hide (one shared row, visible to the whole team by
-- definition). Now that a row can hold one seller's private
-- evolution_api_key/evolution_webhook_secret, that bypass would let
-- every teammate read every other teammate's credentials via a plain
-- SELECT — removed and replaced with the same shape already used for
-- meta_cloud, plus an explicit allowance for unclaimed rows (so the
-- legacy shared connection stays visible to everyone, matching its
-- current behavior).
--
-- Idempotent — safe to re-run.
-- ============================================================

DROP INDEX IF EXISTS whatsapp_channels_evolution_one_per_account;

-- Backfill: claim every existing (pre-this-feature) evolution row for
-- whoever set it up (`user_id`, already recorded on every row) —
-- otherwise the app code below, which now looks up "my own" evolution
-- channel by assigned_agent_id, would show that person's already-
-- connected WhatsApp as disconnected the moment this ships.
UPDATE whatsapp_channels
  SET assigned_agent_id = user_id
  WHERE provider = 'evolution' AND assigned_agent_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_channels_evolution_per_agent
  ON whatsapp_channels (account_id, assigned_agent_id)
  WHERE provider = 'evolution' AND assigned_agent_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_channels_evolution_shared
  ON whatsapp_channels (account_id)
  WHERE provider = 'evolution' AND assigned_agent_id IS NULL;

CREATE OR REPLACE FUNCTION account_has_agent_owned_channel(target_account_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM whatsapp_channels
    WHERE account_id = target_account_id
      AND provider IN ('meta_cloud', 'evolution')
      AND assigned_agent_id IS NOT NULL
  );
$$;

DROP POLICY IF EXISTS whatsapp_channels_select ON whatsapp_channels;
CREATE POLICY whatsapp_channels_select ON whatsapp_channels FOR SELECT USING (
  is_account_member(account_id, 'admin')
  OR NOT account_has_agent_owned_channel(account_id)
  OR (is_default OR assigned_agent_id = auth.uid() OR assigned_agent_id IS NULL)
);
