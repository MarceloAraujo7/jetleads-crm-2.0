-- ============================================================
-- Relay Proxy — salespeople handle leads from their own personal
-- WhatsApp by quote-replying to a handoff notification sent through
-- the account's official Meta Cloud API number. The webhook resolves
-- the quoted message's Meta id back to the lead's conversation and
-- relays content through the same official number, so the customer
-- never sees the agent's personal number.
--
-- `agent_notifications` maps every message WE send TO an agent
-- (the initial handoff notification, and every forwarded customer
-- reply) to its conversation, so a later quoted reply from the agent
-- resolves back to the right lead.
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS personal_phone TEXT;

CREATE TABLE IF NOT EXISTS agent_notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  agent_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  meta_message_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_notifications_meta_message_id_key
  ON agent_notifications (meta_message_id);
CREATE INDEX IF NOT EXISTS idx_agent_notifications_conversation
  ON agent_notifications (conversation_id);

ALTER TABLE agent_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_notifications_select ON agent_notifications;
DROP POLICY IF EXISTS agent_notifications_insert ON agent_notifications;
DROP POLICY IF EXISTS agent_notifications_update ON agent_notifications;
DROP POLICY IF EXISTS agent_notifications_delete ON agent_notifications;
CREATE POLICY agent_notifications_select ON agent_notifications FOR SELECT USING (is_account_member(account_id));
CREATE POLICY agent_notifications_insert ON agent_notifications FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY agent_notifications_update ON agent_notifications FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY agent_notifications_delete ON agent_notifications FOR DELETE USING (is_account_member(account_id, 'admin'));
