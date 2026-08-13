-- ============================================================
-- Fase 2 — Distribuição real de leads pros vendedores.
--
-- contacts.assigned_agent_id: who's working this lead. Filled by
-- pickAgentForNewLead() (src/lib/contacts/assign-lead.ts) at creation
-- time, only when the account opts in via lead_distribution_enabled
-- (default OFF — this must not change behavior for an account that
-- hasn't turned it on).
--
-- Completes the contacts RLS scoping deferred from migration 042:
-- once an account has an agent-owned channel, an agent only sees
-- contacts assigned to them (or that they personally created) — same
-- "seller can't see another client's leads" guarantee already applied
-- to conversations/messages.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS assigned_agent_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_assigned_agent ON contacts (assigned_agent_id);

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS lead_distribution_enabled BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION can_view_scoped_contact(
  target_account_id UUID,
  contact_assigned_agent_id UUID,
  contact_user_id UUID
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    is_account_member(target_account_id, 'admin')
    OR NOT account_has_agent_owned_channel(target_account_id)
    OR (
      is_account_member(target_account_id, 'viewer')
      AND (
        contact_assigned_agent_id = auth.uid()
        -- A contact the agent personally created stays visible to
        -- them even before distribution assigns it — otherwise
        -- manually adding a lead would immediately hide it from its
        -- own creator once the guard is active.
        OR contact_user_id = auth.uid()
      )
    );
$$;

DROP POLICY IF EXISTS contacts_select ON contacts;
CREATE POLICY contacts_select ON contacts FOR SELECT USING (
  can_view_scoped_contact(account_id, assigned_agent_id, user_id)
);

DROP POLICY IF EXISTS contacts_update ON contacts;
CREATE POLICY contacts_update ON contacts FOR UPDATE USING (
  is_account_member(account_id, 'agent')
  AND can_view_scoped_contact(account_id, assigned_agent_id, user_id)
) WITH CHECK (
  is_account_member(account_id, 'agent')
  AND can_view_scoped_contact(account_id, assigned_agent_id, user_id)
);

DROP POLICY IF EXISTS contacts_delete ON contacts;
CREATE POLICY contacts_delete ON contacts FOR DELETE USING (
  is_account_member(account_id, 'agent')
  AND can_view_scoped_contact(account_id, assigned_agent_id, user_id)
);

-- contacts_insert is unchanged (is_account_member(account_id,'agent'),
-- no ownership check needed at insert time).
