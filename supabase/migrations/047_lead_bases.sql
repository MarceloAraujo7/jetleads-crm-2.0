-- ============================================================
-- Lead Bases — Campanha becomes the real owner of a client/region-
-- specific pool of leads, instead of just a free-text audience label.
--
-- A lead base groups contacts (contacts.lead_base_id) and has its own
-- team (lead_base_members) and its own distribution settings
-- (distribution_enabled/strategy/cursor on lead_bases itself) —
-- mirroring the account-wide equivalents added in
-- 043_lead_distribution.sql / 045_lead_distribution_strategy.sql, but
-- scoped to one base instead of the whole account.
--
-- Backward-compatible by construction: contacts.lead_base_id and
-- campaigns.lead_base_id are both nullable. NULL means "the legacy
-- account-wide pool" — existing accounts/campaigns/contacts keep
-- working exactly as before until someone opts a contact/campaign
-- into a base. src/lib/contacts/assign-lead.ts branches on whether a
-- leadBaseId is present rather than requiring one.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS lead_bases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  -- Same shape as accounts.lead_distribution_* (043/045), just
  -- scoped to this base instead of the whole account.
  distribution_enabled BOOLEAN NOT NULL DEFAULT false,
  distribution_strategy TEXT NOT NULL DEFAULT 'least_loaded'
    CHECK (distribution_strategy IN ('least_loaded', 'round_robin', 'equal')),
  distribution_cursor UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_bases_account ON lead_bases(account_id, created_at DESC);

DROP TRIGGER IF EXISTS set_lead_bases_updated_at ON lead_bases;
CREATE TRIGGER set_lead_bases_updated_at
  BEFORE UPDATE ON lead_bases
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Which account members work this base, and their per-base daily
-- quota (mirrors profiles.daily_lead_quota from 044, but per-base —
-- a seller can be on multiple bases with a different cap on each).
CREATE TABLE IF NOT EXISTS lead_base_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_base_id UUID NOT NULL REFERENCES lead_bases(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  daily_lead_quota INTEGER CHECK (daily_lead_quota IS NULL OR daily_lead_quota >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (lead_base_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_lead_base_members_base ON lead_base_members(lead_base_id);
CREATE INDEX IF NOT EXISTS idx_lead_base_members_user ON lead_base_members(user_id);

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS lead_base_id UUID REFERENCES lead_bases(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_lead_base ON contacts(lead_base_id);

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS lead_base_id UUID REFERENCES lead_bases(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_campaigns_lead_base ON campaigns(lead_base_id);

-- ============================================================
-- RLS — same account-membership pattern as campaigns (046): agent+
-- for operational writes, viewer+ to read.
-- ============================================================

ALTER TABLE lead_bases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_bases_select ON lead_bases;
CREATE POLICY lead_bases_select ON lead_bases
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS lead_bases_insert ON lead_bases;
CREATE POLICY lead_bases_insert ON lead_bases
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS lead_bases_update ON lead_bases;
CREATE POLICY lead_bases_update ON lead_bases
  FOR UPDATE USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS lead_bases_delete ON lead_bases;
CREATE POLICY lead_bases_delete ON lead_bases
  FOR DELETE USING (is_account_member(account_id, 'agent'));

ALTER TABLE lead_base_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_base_members_select ON lead_base_members;
CREATE POLICY lead_base_members_select ON lead_base_members
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM lead_bases b
      WHERE b.id = lead_base_members.lead_base_id
        AND is_account_member(b.account_id)
    )
  );

DROP POLICY IF EXISTS lead_base_members_modify ON lead_base_members;
CREATE POLICY lead_base_members_modify ON lead_base_members
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM lead_bases b
      WHERE b.id = lead_base_members.lead_base_id
        AND is_account_member(b.account_id, 'agent')
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM lead_bases b
      WHERE b.id = lead_base_members.lead_base_id
        AND is_account_member(b.account_id, 'agent')
    )
  );
