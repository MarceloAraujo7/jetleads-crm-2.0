-- ============================================================
-- Lead distribution gains a strategy selector (was a plain on/off).
-- `lead_distribution_enabled=false` is still "Manual" in the UI —
-- the strategy column only matters once distribution is on.
--
-- `lead_distribution_cursor` — last agent picked by 'round_robin',
-- so the next lead advances to whoever comes after them in a stable
-- (user_id-ordered) rotation. Unused by the other two strategies.
--
-- Also: default_currency's DEFAULT moves to BRL — the currency
-- picker in Settings is going away (BR-only operation), so new
-- accounts should land on the right value without a picker to fix it.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS lead_distribution_strategy TEXT NOT NULL DEFAULT 'least_loaded';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'accounts_lead_distribution_strategy_check'
      AND conrelid = 'accounts'::regclass
  ) THEN
    ALTER TABLE accounts
      ADD CONSTRAINT accounts_lead_distribution_strategy_check
      CHECK (lead_distribution_strategy IN ('least_loaded', 'round_robin', 'equal'));
  END IF;
END $$;

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS lead_distribution_cursor UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE accounts
  ALTER COLUMN default_currency SET DEFAULT 'BRL';
