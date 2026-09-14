-- =============================================================================
-- Migration 0016: inspection_records.extraction_version — which
--                 PERMIT_EXTRACTION_VERSION (src/lib/ai/permit-extraction-prompt.ts)
--                 a `done` row's extracted facts were read under
-- =============================================================================

-- Stamped by the extraction step on every `done` row; NULL on rows never read,
-- on failed/skipped rows, and on rows read before this column existed. A later
-- "Find records" (D7 reuse) only replays facts carrying the current version —
-- any other `done` row is re-read from its stored PDF (no re-download) and
-- re-stamped. No backfill on purpose: every pre-existing row is stale by design.
--
-- APPLY TO THE REMOTE BEFORE MERGING / PUSHING THIS BRANCH (push main = prod):
--   node --env-file=.env.local scripts/apply-extraction-version-migration.mjs
-- run-store selects every schema column, so until the column exists every
-- inspection_records query fails ("column extraction_version does not exist"):
-- the records list loads empty, D7 reuse falls through to a fresh download +
-- duplicate insert, and extraction persist fails. Idempotent (IF NOT EXISTS).
ALTER TABLE public.inspection_records
  ADD COLUMN IF NOT EXISTS extraction_version text;
