-- =============================================================================
-- Migration: Jobs external_id (webhook idempotency key)
-- Description: Adds a nullable external_id column to `jobs` so the n8n
--              webhook can safely retry. Dashboard-created jobs leave it
--              NULL; webhook-created jobs store the upstream job id
--              (e.g. Workiz job id) and a partial unique index guarantees
--              no duplicates.
-- Run via: scripts/apply-external-id-migration.mjs
-- =============================================================================

ALTER TABLE "jobs" ADD COLUMN "external_id" text;

-- Partial unique index: multiple NULLs allowed, any non-NULL must be unique.
CREATE UNIQUE INDEX "jobs_external_id_unique"
  ON "jobs" ("external_id")
  WHERE "external_id" IS NOT NULL;
