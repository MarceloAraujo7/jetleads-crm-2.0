-- ============================================================
-- Fase 1 — "Vendedor conecta o próprio WhatsApp" + visibilidade
-- escopada por canal.
--
-- Context: "vendedor"/"gestor" are the CLIENT's own staff (e.g. the
-- dealership's real salesperson), not Elephant Mídia's — several
-- clients share the same Jetleads account (one client = one
-- whatsapp_channels row), so once a seller connects their own
-- number, that seller must never see another client's conversations
-- or channel details.
--
-- Every restriction below is guarded by
-- account_has_agent_owned_channel() — it only activates once an
-- account actually HAS a channel with assigned_agent_id set (i.e.
-- this feature has actually been used at least once). Until then,
-- every account behaves exactly as it does today. This is the same
-- safety principle already used for the broadcast role gate in the
-- previous migration's application code.
-- ============================================================

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
      AND provider = 'meta_cloud'
      AND assigned_agent_id IS NOT NULL
  );
$$;

-- ------------------------------------------------------------
-- whatsapp_channels: agent can manage a channel they own.
-- ------------------------------------------------------------

DROP POLICY IF EXISTS whatsapp_channels_select ON whatsapp_channels;
CREATE POLICY whatsapp_channels_select ON whatsapp_channels FOR SELECT USING (
  provider = 'evolution'
  OR is_account_member(account_id, 'admin')
  OR NOT account_has_agent_owned_channel(account_id)
  OR (is_default OR assigned_agent_id = auth.uid())
);

DROP POLICY IF EXISTS whatsapp_channels_insert ON whatsapp_channels;
CREATE POLICY whatsapp_channels_insert ON whatsapp_channels FOR INSERT WITH CHECK (
  is_account_member(account_id, 'admin')
  OR (
    is_account_member(account_id, 'agent')
    AND assigned_agent_id = auth.uid()
    AND is_default = false
  )
);

DROP POLICY IF EXISTS whatsapp_channels_update ON whatsapp_channels;
CREATE POLICY whatsapp_channels_update ON whatsapp_channels FOR UPDATE USING (
  is_account_member(account_id, 'admin')
  OR (
    is_account_member(account_id, 'agent')
    AND assigned_agent_id = auth.uid()
  )
);

DROP POLICY IF EXISTS whatsapp_channels_delete ON whatsapp_channels;
CREATE POLICY whatsapp_channels_delete ON whatsapp_channels FOR DELETE USING (
  is_account_member(account_id, 'admin')
  OR (
    is_account_member(account_id, 'agent')
    AND assigned_agent_id = auth.uid()
  )
);

-- Column-scoped write privilege (same recipe as 027_notifications.sql):
-- the RLS UPDATE policy above gates WHICH ROWS; this gates WHICH
-- COLUMNS. `is_default` and `assigned_agent_id` are deliberately
-- excluded for EVERYONE (including admins) — those two only change
-- via application code using the service-role client, which bypasses
-- this table-level grant entirely (see /api/whatsapp/channels/[id]).
REVOKE UPDATE ON whatsapp_channels FROM authenticated;
GRANT UPDATE (
  label, ddd, phone_number_id, waba_id, access_token, verify_token,
  status, connected_at, registered_at, subscribed_apps_at, last_registration_error,
  updated_at, evolution_instance_name, evolution_base_url, evolution_api_key,
  evolution_webhook_secret
) ON whatsapp_channels TO authenticated;

-- ------------------------------------------------------------
-- conversations / messages: an agent only sees conversations tied to
-- a channel they own (or explicitly assigned to them). admin/owner
-- keep full account-wide visibility.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION can_view_scoped_conversation(
  target_account_id UUID,
  conv_assigned_agent_id UUID,
  conv_channel_id UUID
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
        conv_assigned_agent_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM whatsapp_channels wc
          WHERE wc.id = conv_channel_id AND wc.assigned_agent_id = auth.uid()
        )
      )
    );
$$;

DROP POLICY IF EXISTS conversations_select ON conversations;
CREATE POLICY conversations_select ON conversations FOR SELECT USING (
  can_view_scoped_conversation(account_id, assigned_agent_id, channel_id)
);

DROP POLICY IF EXISTS conversations_update ON conversations;
CREATE POLICY conversations_update ON conversations FOR UPDATE USING (
  is_account_member(account_id, 'agent')
  AND can_view_scoped_conversation(account_id, assigned_agent_id, channel_id)
) WITH CHECK (
  is_account_member(account_id, 'agent')
  AND can_view_scoped_conversation(account_id, assigned_agent_id, channel_id)
);

DROP POLICY IF EXISTS conversations_delete ON conversations;
CREATE POLICY conversations_delete ON conversations FOR DELETE USING (
  is_account_member(account_id, 'agent')
  AND can_view_scoped_conversation(account_id, assigned_agent_id, channel_id)
);

-- conversations_insert is unchanged (is_account_member(account_id,'agent'),
-- no ownership check) — the row usually doesn't have a channel_id
-- decided yet at insert time, and creating a stray conversation isn't
-- the leak this migration protects against.

DROP POLICY IF EXISTS messages_select ON messages;
CREATE POLICY messages_select ON messages FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
      AND can_view_scoped_conversation(c.account_id, c.assigned_agent_id, c.channel_id)
  )
);

DROP POLICY IF EXISTS messages_modify ON messages;
CREATE POLICY messages_modify ON messages FOR ALL USING (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
      AND is_account_member(c.account_id, 'agent')
      AND can_view_scoped_conversation(c.account_id, c.assigned_agent_id, c.channel_id)
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
      AND is_account_member(c.account_id, 'agent')
      AND can_view_scoped_conversation(c.account_id, c.assigned_agent_id, c.channel_id)
  )
);
