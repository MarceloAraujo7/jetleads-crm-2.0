-- Broadcast cost simulation (mirrors the Jetleads 3.0 prototype's
-- "Custo Máximo Estimado" panel) needs a USD→BRL rate to convert
-- Meta's per-message pricing into a locally-meaningful number.
-- Account-level so each account can keep it current without a
-- deploy — mirrors 021_account_default_currency's pattern.
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS whatsapp_usd_brl_rate NUMERIC NOT NULL DEFAULT 5.30;

ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_whatsapp_usd_brl_rate_positive;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_whatsapp_usd_brl_rate_positive
  CHECK (whatsapp_usd_brl_rate > 0);
