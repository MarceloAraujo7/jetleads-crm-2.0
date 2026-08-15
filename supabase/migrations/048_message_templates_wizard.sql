-- ============================================================
-- Message Templates rebuild — supports the 5-step wizard's two new
-- features on top of the existing local-catalog/Meta-sync schema:
--
--   - variable_names JSONB {body: string[], header: string[]} —
--     the friendly names (e.g. "nome", "loja") shown in the wizard
--     as [nome]/[loja] chips, ordered 1:1 with the {{1}}, {{2}}...
--     positions actually stored in body_text/header_content. Meta
--     only ever sees the positional form (built by
--     template-components.ts, unchanged) — this column exists purely
--     so re-opening a template for editing can redisplay the named
--     form instead of forcing the user back to raw {{1}} syntax.
--     Mirrors the shape of the existing `sample_values` column.
--
--   - is_default_for_broadcasts BOOLEAN — "Usar como padrão em
--     disparos" in the wizard's review step. Partial unique index
--     enforces at most one default per account; the app clears the
--     previous default in the same transaction as setting a new one
--     (see template-form actions), this index is the backstop.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE message_templates
  ADD COLUMN IF NOT EXISTS variable_names JSONB,
  ADD COLUMN IF NOT EXISTS is_default_for_broadcasts BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS idx_message_templates_one_default_per_account
  ON message_templates(account_id)
  WHERE is_default_for_broadcasts;
