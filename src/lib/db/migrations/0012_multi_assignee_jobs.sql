-- =============================================================================
-- 0012_multi_assignee_jobs.sql
--
-- Convert jobs.assigned_to (single uuid FK) to jobs.assignees (uuid[] array).
--
-- New access model:
--   - admin + office_staff  → full access to every job (unchanged)
--   - field_tech            → access if assignees is empty OR auth.uid() is in assignees
--
-- An empty assignees array means "unassigned / open to all techs" — any field
-- tech can pick it up. Explicitly naming one or more techs restricts visibility
-- to just those people (plus admins/office_staff).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Drop existing RLS policies that reference the old assigned_to column.
--    (Postgres won't let us drop a column that an RLS policy depends on.)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can read own or privileged jobs" ON "jobs";
DROP POLICY IF EXISTS "Users can insert jobs" ON "jobs";
DROP POLICY IF EXISTS "Users can update own or privileged jobs" ON "jobs";

DROP POLICY IF EXISTS "Users can read job checklist items" ON "job_checklist_items";
DROP POLICY IF EXISTS "Users can insert job checklist items" ON "job_checklist_items";
DROP POLICY IF EXISTS "Users can update job checklist items" ON "job_checklist_items";
DROP POLICY IF EXISTS "Users can delete job checklist items" ON "job_checklist_items";

DROP POLICY IF EXISTS "Users can read job media" ON "job_media";
DROP POLICY IF EXISTS "Users can insert job media" ON "job_media";
DROP POLICY IF EXISTS "Users can update job media" ON "job_media";
DROP POLICY IF EXISTS "Users can delete job media" ON "job_media";

DROP POLICY IF EXISTS "Users can read job summaries" ON "job_summaries";
DROP POLICY IF EXISTS "Users can insert job summaries" ON "job_summaries";

-- -----------------------------------------------------------------------------
-- 2. Drop the old index + FK constraint (a column can't be dropped with them).
-- -----------------------------------------------------------------------------
DROP INDEX IF EXISTS "public"."jobs_assigned_to_idx";
ALTER TABLE "jobs" DROP CONSTRAINT IF EXISTS "jobs_assigned_to_profiles_id_fk";

-- -----------------------------------------------------------------------------
-- 3. Add the new uuid[] column (nullable momentarily for backfill).
-- -----------------------------------------------------------------------------
ALTER TABLE "jobs" ADD COLUMN "assignees" uuid[];

-- -----------------------------------------------------------------------------
-- 4. Backfill: wrap each existing single assigned_to in an array.
--    Rows that had a NULL assigned_to (shouldn't exist — old column was NOT
--    NULL — but be defensive) become empty arrays.
-- -----------------------------------------------------------------------------
UPDATE "jobs"
   SET "assignees" = CASE
       WHEN "assigned_to" IS NOT NULL THEN ARRAY["assigned_to"]
       ELSE '{}'::uuid[]
   END;

-- -----------------------------------------------------------------------------
-- 5. Enforce NOT NULL + default, now that every row has a valid array.
-- -----------------------------------------------------------------------------
ALTER TABLE "jobs" ALTER COLUMN "assignees" SET NOT NULL;
ALTER TABLE "jobs" ALTER COLUMN "assignees" SET DEFAULT '{}'::uuid[];

-- -----------------------------------------------------------------------------
-- 6. Drop the old column.
-- -----------------------------------------------------------------------------
ALTER TABLE "jobs" DROP COLUMN "assigned_to";

-- -----------------------------------------------------------------------------
-- 7. GIN index for fast `auth.uid() = ANY(assignees)` lookups.
-- -----------------------------------------------------------------------------
CREATE INDEX "jobs_assignees_gin_idx" ON "jobs" USING gin ("assignees");

-- -----------------------------------------------------------------------------
-- 8. Recreate RLS policies with the new multi-assignee + empty-means-open rule.
--
--    SELECT/INSERT/UPDATE allow admin+office_staff unconditionally, plus any
--    authenticated user when either:
--      (a) the job has no assignees (cardinality(assignees) = 0), or
--      (b) auth.uid() is in the assignees array.
--
--    DELETE remains admin/office_staff only (unchanged).
-- -----------------------------------------------------------------------------
CREATE POLICY "Users can read jobs"
    ON "jobs" FOR SELECT
    TO authenticated
    USING (
        (auth.jwt() ->> 'user_role') IN ('admin', 'office_staff')
        OR cardinality("assignees") = 0
        OR auth.uid() = ANY("assignees")
    );

CREATE POLICY "Users can insert jobs"
    ON "jobs" FOR INSERT
    TO authenticated
    WITH CHECK (
        (auth.jwt() ->> 'user_role') IN ('admin', 'office_staff')
        OR cardinality("assignees") = 0
        OR auth.uid() = ANY("assignees")
    );

CREATE POLICY "Users can update jobs"
    ON "jobs" FOR UPDATE
    TO authenticated
    USING (
        (auth.jwt() ->> 'user_role') IN ('admin', 'office_staff')
        OR cardinality("assignees") = 0
        OR auth.uid() = ANY("assignees")
    );

-- Note: the existing "Privileged users can delete jobs" policy is unchanged
-- and still applies — no recreation needed.

-- -----------------------------------------------------------------------------
-- 9. Child-table policies — access still follows the parent job.
-- -----------------------------------------------------------------------------
CREATE POLICY "Users can read job checklist items"
    ON "job_checklist_items" FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM "jobs"
            WHERE "jobs".id = "job_checklist_items".job_id
              AND (
                  (auth.jwt() ->> 'user_role') IN ('admin', 'office_staff')
                  OR cardinality("jobs"."assignees") = 0
                  OR auth.uid() = ANY("jobs"."assignees")
              )
        )
    );

CREATE POLICY "Users can insert job checklist items"
    ON "job_checklist_items" FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM "jobs"
            WHERE "jobs".id = "job_checklist_items".job_id
              AND (
                  (auth.jwt() ->> 'user_role') IN ('admin', 'office_staff')
                  OR cardinality("jobs"."assignees") = 0
                  OR auth.uid() = ANY("jobs"."assignees")
              )
        )
    );

CREATE POLICY "Users can update job checklist items"
    ON "job_checklist_items" FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM "jobs"
            WHERE "jobs".id = "job_checklist_items".job_id
              AND (
                  (auth.jwt() ->> 'user_role') IN ('admin', 'office_staff')
                  OR cardinality("jobs"."assignees") = 0
                  OR auth.uid() = ANY("jobs"."assignees")
              )
        )
    );

CREATE POLICY "Users can delete job checklist items"
    ON "job_checklist_items" FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM "jobs"
            WHERE "jobs".id = "job_checklist_items".job_id
              AND (
                  (auth.jwt() ->> 'user_role') IN ('admin', 'office_staff')
                  OR cardinality("jobs"."assignees") = 0
                  OR auth.uid() = ANY("jobs"."assignees")
              )
        )
    );

CREATE POLICY "Users can read job media"
    ON "job_media" FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM "jobs"
            WHERE "jobs".id = "job_media".job_id
              AND (
                  (auth.jwt() ->> 'user_role') IN ('admin', 'office_staff')
                  OR cardinality("jobs"."assignees") = 0
                  OR auth.uid() = ANY("jobs"."assignees")
              )
        )
    );

CREATE POLICY "Users can insert job media"
    ON "job_media" FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM "jobs"
            WHERE "jobs".id = "job_media".job_id
              AND (
                  (auth.jwt() ->> 'user_role') IN ('admin', 'office_staff')
                  OR cardinality("jobs"."assignees") = 0
                  OR auth.uid() = ANY("jobs"."assignees")
              )
        )
    );

CREATE POLICY "Users can update job media"
    ON "job_media" FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM "jobs"
            WHERE "jobs".id = "job_media".job_id
              AND (
                  (auth.jwt() ->> 'user_role') IN ('admin', 'office_staff')
                  OR cardinality("jobs"."assignees") = 0
                  OR auth.uid() = ANY("jobs"."assignees")
              )
        )
    );

CREATE POLICY "Users can delete job media"
    ON "job_media" FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM "jobs"
            WHERE "jobs".id = "job_media".job_id
              AND (
                  (auth.jwt() ->> 'user_role') IN ('admin', 'office_staff')
                  OR cardinality("jobs"."assignees") = 0
                  OR auth.uid() = ANY("jobs"."assignees")
              )
        )
    );

CREATE POLICY "Users can read job summaries"
    ON "job_summaries" FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM "jobs"
            WHERE "jobs".id = "job_summaries".job_id
              AND (
                  (auth.jwt() ->> 'user_role') IN ('admin', 'office_staff')
                  OR cardinality("jobs"."assignees") = 0
                  OR auth.uid() = ANY("jobs"."assignees")
              )
        )
    );

CREATE POLICY "Users can insert job summaries"
    ON "job_summaries" FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM "jobs"
            WHERE "jobs".id = "job_summaries".job_id
              AND (
                  (auth.jwt() ->> 'user_role') IN ('admin', 'office_staff')
                  OR cardinality("jobs"."assignees") = 0
                  OR auth.uid() = ANY("jobs"."assignees")
              )
        )
    );

COMMIT;
