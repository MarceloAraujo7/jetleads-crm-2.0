-- ============================================================
-- Fase 3 — meta diária por vendedor.
--
-- NULL = no cap (default, zero behavior change). Deliberately not
-- addable via direct client UPDATE by the member themselves — the
-- `profiles_update` RLS policy (migration 017) already only lets a
-- user touch their OWN row, and admins editing a TEAMMATE's row go
-- through the service-role path in
-- /api/account/members/[userId]/route.ts (same reasoning as
-- migration 034: profiles writes to another user's row need a
-- supervised path, not a raw client UPDATE).
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS daily_lead_quota INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_daily_lead_quota_check'
      AND conrelid = 'profiles'::regclass
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_daily_lead_quota_check
      CHECK (daily_lead_quota IS NULL OR daily_lead_quota >= 0);
  END IF;
END $$;
