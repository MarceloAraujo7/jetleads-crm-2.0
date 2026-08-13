-- ============================================================
-- Event-invite campaigns: mark a broadcast as an "event_invite" and
-- capture each recipient's RSVP button tap.
--
-- `campaign_kind` is a narrow, optional discriminator — null for every
-- regular broadcast (no behavior change). When set to 'event_invite',
-- the dashboard widgets and RSVP correlation logic in the webhook key
-- off it. Kept as a single value CHECK rather than a full enum since
-- this is the only campaign kind that needs special handling today.
-- ============================================================

ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS campaign_kind TEXT DEFAULT NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'broadcasts_campaign_kind_check'
      AND conrelid = 'broadcasts'::regclass
  ) THEN
    ALTER TABLE broadcasts
      ADD CONSTRAINT broadcasts_campaign_kind_check
      CHECK (campaign_kind IS NULL OR campaign_kind IN ('event_invite'));
  END IF;
END $$;

-- Per-recipient RSVP: the human-readable title of the button they
-- tapped (e.g. "Confirmar presença"), scoped to THIS broadcast's
-- recipient row — unlike the generic `status='replied'` flip (any
-- inbound message from the contact), this only gets set when the tap
-- can be attributed to an event_invite campaign specifically.
ALTER TABLE broadcast_recipients
  ADD COLUMN IF NOT EXISTS rsvp_choice TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_broadcasts_campaign_kind
  ON broadcasts (account_id, campaign_kind) WHERE campaign_kind IS NOT NULL;
