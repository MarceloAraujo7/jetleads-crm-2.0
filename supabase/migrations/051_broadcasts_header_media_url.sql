-- ============================================================
-- broadcasts.header_media_url — the media-header override the wizard
-- applied at send time (upload/paste), if any.
--
-- Without this, "Retry failed" had no way to reapply the exact same
-- image/video/document the original send used — it could only fall
-- back to the template's own currently-stored header_media_url, which
-- may have changed or been unreliable (see migration 048's sync fix)
-- since the broadcast was sent, silently dropping the image on retry.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS header_media_url TEXT;
