-- ============================================================
-- Multiple Meta Cloud API numbers per account.
--
-- Until now an account could have exactly one 'meta_cloud' row in
-- whatsapp_channels (UNIQUE(account_id, provider)). Active-prospecting
-- accounts need several official numbers (per store/region/team),
-- routed by the lead's area code (DDD) — same pattern proven in the
-- sibling Jetleads Prospect product, kept intentionally simple: no
-- rate limiting, no round-robin, just DDD match -> generic fallback
-- -> account default.
--
-- This account already has one real, connected meta_cloud row, so
-- unlike migration 037 this one is NOT a fresh-table rename — existing
-- data must survive and get sane defaults.
-- ============================================================

-- One row per (account, provider) no longer holds for meta_cloud.
-- Evolution still gets one row per account (unrelated to this change).
ALTER TABLE whatsapp_channels
  DROP CONSTRAINT IF EXISTS whatsapp_channels_account_id_provider_key;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_channels_evolution_one_per_account'
      AND conrelid = 'whatsapp_channels'::regclass
  ) THEN
    -- Re-add the one-row constraint, but scoped to evolution only, via
    -- a partial unique index (a plain UNIQUE constraint can't be
    -- conditional).
    CREATE UNIQUE INDEX whatsapp_channels_evolution_one_per_account
      ON whatsapp_channels (account_id) WHERE provider = 'evolution';
  END IF;
END $$;

ALTER TABLE whatsapp_channels
  ADD COLUMN IF NOT EXISTS label TEXT,
  ADD COLUMN IF NOT EXISTS ddd TEXT,
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS assigned_agent_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Backfill: every existing meta_cloud row was, by definition of the
-- old UNIQUE(account_id, provider) constraint, the only one for its
-- account — mark it default so resolveChannel() has a fallback target
-- for every account that already has a number connected.
UPDATE whatsapp_channels SET is_default = true WHERE provider = 'meta_cloud';

-- Exactly one default meta_cloud channel per account.
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_channels_default_meta_key
  ON whatsapp_channels (account_id) WHERE provider = 'meta_cloud' AND is_default;

CREATE INDEX IF NOT EXISTS idx_whatsapp_channels_account_provider
  ON whatsapp_channels (account_id, provider);

-- Anchor which number a conversation/campaign is on. Nullable —
-- existing rows and single-number accounts don't need to care.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS channel_id UUID REFERENCES whatsapp_channels(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_channel ON conversations (channel_id);

ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS channel_id UUID REFERENCES whatsapp_channels(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_broadcasts_channel ON broadcasts (channel_id);

-- Relay Proxy: remember which number sent each agent notification, so
-- a reply relays back out through that SAME number rather than
-- re-resolving by DDD (which could drift if the channel pool changes
-- between the notification and the reply).
ALTER TABLE agent_notifications
  ADD COLUMN IF NOT EXISTS channel_id UUID REFERENCES whatsapp_channels(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_agent_notifications_channel ON agent_notifications (channel_id);
