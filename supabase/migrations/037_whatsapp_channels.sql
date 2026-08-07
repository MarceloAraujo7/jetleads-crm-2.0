-- ============================================================
-- whatsapp_config -> whatsapp_channels: support multiple WhatsApp
-- providers per account (Meta Cloud API + Evolution API).
--
-- Why: campaigns/broadcasts need the official Meta Cloud API
-- (template messages, works outside the 24h session window).
-- Free-form inbox conversation can additionally go through Evolution
-- API (unofficial, WhatsApp Web protocol, no session-window limit).
-- An account may now have up to one row per provider instead of
-- exactly one row total.
--
-- Safe to rename in place — this environment has no rows in
-- whatsapp_config yet (fresh deployment, no WhatsApp credentials
-- saved), so no backfill/data-migration logic is needed. The rename
-- preserves the table's existing triggers and grants.
-- ============================================================

ALTER TABLE whatsapp_config RENAME TO whatsapp_channels;

-- Discriminator column. Existing (empty) rows would be Meta rows;
-- default kept only for that theoretical backfill case, then dropped
-- so future inserts must say which provider they are.
ALTER TABLE whatsapp_channels
  ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'meta_cloud';
UPDATE whatsapp_channels SET provider = 'meta_cloud' WHERE provider IS NULL;
ALTER TABLE whatsapp_channels ALTER COLUMN provider SET NOT NULL;
ALTER TABLE whatsapp_channels ALTER COLUMN provider DROP DEFAULT;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_channels_provider_check'
      AND conrelid = 'whatsapp_channels'::regclass
  ) THEN
    ALTER TABLE whatsapp_channels
      ADD CONSTRAINT whatsapp_channels_provider_check
      CHECK (provider IN ('meta_cloud', 'evolution'));
  END IF;
END $$;

-- Meta-only columns (phone_number_id, waba_id, access_token,
-- verify_token, registered_at, subscribed_apps_at,
-- last_registration_error) already exist from earlier migrations.
-- They become nullable/unused for provider='evolution' rows.
ALTER TABLE whatsapp_channels ALTER COLUMN phone_number_id DROP NOT NULL;
ALTER TABLE whatsapp_channels ALTER COLUMN access_token DROP NOT NULL;

-- Evolution-only columns.
ALTER TABLE whatsapp_channels
  ADD COLUMN IF NOT EXISTS evolution_instance_name TEXT,
  ADD COLUMN IF NOT EXISTS evolution_base_url TEXT,
  ADD COLUMN IF NOT EXISTS evolution_api_key TEXT,
  ADD COLUMN IF NOT EXISTS evolution_webhook_secret TEXT;

-- One row per (account, provider) instead of one row per account.
ALTER TABLE whatsapp_channels DROP CONSTRAINT IF EXISTS whatsapp_config_account_id_key;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_channels_account_id_provider_key'
      AND conrelid = 'whatsapp_channels'::regclass
  ) THEN
    ALTER TABLE whatsapp_channels
      ADD CONSTRAINT whatsapp_channels_account_id_provider_key
      UNIQUE (account_id, provider);
  END IF;
END $$;

-- phone_number_id / evolution_instance_name still need to be
-- globally unique when present (webhook routing resolves tenant by
-- these), but only for rows of the matching provider.
ALTER TABLE whatsapp_channels DROP CONSTRAINT IF EXISTS whatsapp_config_phone_number_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_channels_phone_number_id_key
  ON whatsapp_channels (phone_number_id) WHERE phone_number_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_channels_evolution_instance_key
  ON whatsapp_channels (evolution_instance_name) WHERE evolution_instance_name IS NOT NULL;

-- RLS: same settings-class shape as before, policies renamed to
-- match the table.
DROP POLICY IF EXISTS whatsapp_config_select ON whatsapp_channels;
DROP POLICY IF EXISTS whatsapp_config_insert ON whatsapp_channels;
DROP POLICY IF EXISTS whatsapp_config_update ON whatsapp_channels;
DROP POLICY IF EXISTS whatsapp_config_delete ON whatsapp_channels;
DROP POLICY IF EXISTS whatsapp_channels_select ON whatsapp_channels;
DROP POLICY IF EXISTS whatsapp_channels_insert ON whatsapp_channels;
DROP POLICY IF EXISTS whatsapp_channels_update ON whatsapp_channels;
DROP POLICY IF EXISTS whatsapp_channels_delete ON whatsapp_channels;
CREATE POLICY whatsapp_channels_select ON whatsapp_channels FOR SELECT USING (is_account_member(account_id));
CREATE POLICY whatsapp_channels_insert ON whatsapp_channels FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY whatsapp_channels_update ON whatsapp_channels FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY whatsapp_channels_delete ON whatsapp_channels FOR DELETE USING (is_account_member(account_id, 'admin'));

-- Index rename for consistency (cosmetic, but avoids a stale name).
ALTER INDEX IF EXISTS idx_whatsapp_config_account RENAME TO idx_whatsapp_channels_account;
ALTER INDEX IF EXISTS idx_whatsapp_config_registered_at RENAME TO idx_whatsapp_channels_registered_at;
