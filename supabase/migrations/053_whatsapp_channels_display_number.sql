-- The numbers list only ever stored phone_number_id (Meta's internal
-- API id, e.g. "118065438847551..."), not the actual phone number, so
-- the UI had nothing human-readable to show on a channel card besides
-- the id itself. Meta's phone number GET already returns
-- display_phone_number/verified_name on every save and test-connection
-- call — persist them so the UI can show the real number.
ALTER TABLE whatsapp_channels
  ADD COLUMN IF NOT EXISTS display_phone_number TEXT,
  ADD COLUMN IF NOT EXISTS verified_name TEXT;
