-- ============================================================
-- Campaigns: a lightweight container that groups existing
-- broadcasts/automations/flows/the account's single AI config as
-- parallel "actions" running together for one audience (e.g. "Loja
-- Centro · SP"). Campaigns don't own execution — each action still
-- runs (and is tracked) entirely by its own module; a campaign just
-- names the grouping and lets the UI show them side by side with a
-- shared status.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  audience_label TEXT,
  audience_count INTEGER,
  -- Campaign-level status is set by whoever manages the campaign, not
  -- derived — the constituent actions can be in different states at
  -- once (e.g. a broadcast finishes sending while an automation stays
  -- active), so there's no single automatic rollup that is always
  -- correct.
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('running', 'scheduled', 'completed')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_account
  ON campaigns(account_id, created_at DESC);

DROP TRIGGER IF EXISTS set_campaigns_updated_at ON campaigns;
CREATE TRIGGER set_campaigns_updated_at
  BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- One row per action-card in the campaign. Exactly one of
-- broadcast_id / automation_id / flow_id / ai_config_id is set,
-- matching action_type — enforced below instead of a single
-- polymorphic id column so each link keeps real referential
-- integrity (ON DELETE SET NULL: the card survives, badge shows
-- "removido", instead of silently vanishing).
CREATE TABLE IF NOT EXISTS campaign_actions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL CHECK (action_type IN ('broadcast', 'automation', 'flow', 'agent')),
  -- Denormalized title: broadcasts/automations/flows already have a
  -- name we could join to, but the "agent" action has none (ai_configs
  -- is one row per account, not a nameable entity) — every action
  -- gets its own campaign-local title so all four cards behave the
  -- same way in the UI.
  title TEXT NOT NULL,
  broadcast_id UUID REFERENCES broadcasts(id) ON DELETE SET NULL,
  automation_id UUID REFERENCES automations(id) ON DELETE SET NULL,
  flow_id UUID REFERENCES flows(id) ON DELETE SET NULL,
  ai_config_id UUID REFERENCES ai_configs(id) ON DELETE SET NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT campaign_actions_link_matches_type CHECK (
    (action_type = 'broadcast'  AND broadcast_id  IS NOT NULL AND automation_id IS NULL AND flow_id IS NULL AND ai_config_id IS NULL) OR
    (action_type = 'automation' AND automation_id IS NOT NULL AND broadcast_id  IS NULL AND flow_id IS NULL AND ai_config_id IS NULL) OR
    (action_type = 'flow'       AND flow_id       IS NOT NULL AND broadcast_id  IS NULL AND automation_id IS NULL AND ai_config_id IS NULL) OR
    (action_type = 'agent'      AND ai_config_id   IS NOT NULL AND broadcast_id  IS NULL AND automation_id IS NULL AND flow_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_campaign_actions_campaign
  ON campaign_actions(campaign_id, position);

-- ============================================================
-- RLS — account-membership pattern (see 017_account_sharing.sql).
-- Operational writes (create/edit/delete campaigns and actions) need
-- 'agent' role, same tier as broadcasts/automations/flows.
-- ============================================================

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS campaigns_select ON campaigns;
CREATE POLICY campaigns_select ON campaigns
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS campaigns_insert ON campaigns;
CREATE POLICY campaigns_insert ON campaigns
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS campaigns_update ON campaigns;
CREATE POLICY campaigns_update ON campaigns
  FOR UPDATE USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS campaigns_delete ON campaigns;
CREATE POLICY campaigns_delete ON campaigns
  FOR DELETE USING (is_account_member(account_id, 'agent'));

ALTER TABLE campaign_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS campaign_actions_select ON campaign_actions;
CREATE POLICY campaign_actions_select ON campaign_actions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM campaigns c
      WHERE c.id = campaign_actions.campaign_id
        AND is_account_member(c.account_id)
    )
  );

DROP POLICY IF EXISTS campaign_actions_modify ON campaign_actions;
CREATE POLICY campaign_actions_modify ON campaign_actions
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM campaigns c
      WHERE c.id = campaign_actions.campaign_id
        AND is_account_member(c.account_id, 'agent')
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM campaigns c
      WHERE c.id = campaign_actions.campaign_id
        AND is_account_member(c.account_id, 'agent')
    )
  );
