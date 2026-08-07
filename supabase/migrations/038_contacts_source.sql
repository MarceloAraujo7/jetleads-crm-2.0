-- ============================================================
-- contacts.source — where a contact/lead came from.
--
-- Every existing creation path (manual form, CSV import, auto-create
-- on first inbound WhatsApp message) left no trace of its origin.
-- Needed now so the new Evolution API inbound webhook can stamp
-- 'evolution_inbound' distinctly from the existing Meta webhook's
-- 'whatsapp_inbound'.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contacts_source_check'
      AND conrelid = 'contacts'::regclass
  ) THEN
    ALTER TABLE contacts
      ADD CONSTRAINT contacts_source_check
      CHECK (source IN ('manual', 'csv_import', 'whatsapp_inbound', 'evolution_inbound', 'api'));
  END IF;
END $$;
