-- ============================================================
-- lead_bases.client_name — "a quem pertence" this base (e.g. the
-- dealership/client the leads were bought for), distinct from the
-- base's own internal name (e.g. "Leads Julho 2026" belonging to
-- client "Promac VW"). Nullable — existing bases just show no client
-- until edited.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE lead_bases
  ADD COLUMN IF NOT EXISTS client_name TEXT;
