-- =============================================================================
-- Migration: Jobs Module
-- Description: Adds the general (non-ADEQ) Jobs / service-visit feature.
--              Creates checklist template library, jobs table, per-job
--              checklist item snapshots, job media (with visible_to_customer
--              flag), and tokenized customer summary pages.
-- Run via: Supabase Dashboard -> SQL Editor (copy-paste and execute)
--          OR via the scripts/apply-jobs-module-migration.mjs helper.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
CREATE TYPE "public"."job_status" AS ENUM('open', 'in_progress', 'completed');
CREATE TYPE "public"."job_media_bucket" AS ENUM('checklist_item', 'general');

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

-- Admin-managed reusable checklist template library
CREATE TABLE "checklist_templates" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "name" text NOT NULL,
    "description" text,
    "created_by" uuid,
    "archived_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Items inside a template
CREATE TABLE "checklist_template_items" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "template_id" uuid NOT NULL,
    "title" text NOT NULL,
    "instructions" text,
    "required_photo_count" integer DEFAULT 0 NOT NULL,
    "requires_note" boolean DEFAULT false NOT NULL,
    "is_required" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
);

-- Jobs (parallel to inspections but for non-ADEQ work)
CREATE TABLE "jobs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "assigned_to" uuid NOT NULL,
    "created_by" uuid,
    "status" "public"."job_status" DEFAULT 'open' NOT NULL,
    "title" text NOT NULL,
    "customer_name" text,
    "customer_email" text,
    "customer_phone" varchar(20),
    "service_address" text,
    "city" text,
    "state" varchar(2) DEFAULT 'AZ',
    "zip" varchar(10),
    "general_notes" text,
    "customer_summary" text,
    "source_template_id" uuid,
    "finalized_pdf_path" text,
    "customer_pdf_path" text,
    "scheduled_for" timestamp,
    "started_at" timestamp,
    "completed_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Per-job snapshot of checklist items (editable without touching templates)
CREATE TABLE "job_checklist_items" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "job_id" uuid NOT NULL,
    "title" text NOT NULL,
    "instructions" text,
    "required_photo_count" integer DEFAULT 0 NOT NULL,
    "requires_note" boolean DEFAULT false NOT NULL,
    "is_required" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "status" text DEFAULT 'pending' NOT NULL,
    "note" text,
    "completed_at" timestamp,
    "completed_by" uuid,
    "created_at" timestamp DEFAULT now() NOT NULL
);

-- Media attached to a job (either pinned to a checklist item or general bucket)
CREATE TABLE "job_media" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "job_id" uuid NOT NULL,
    "checklist_item_id" uuid,
    "bucket" "public"."job_media_bucket" NOT NULL,
    "type" text NOT NULL,
    "storage_path" text NOT NULL,
    "description" text,
    "visible_to_customer" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "uploaded_by" uuid,
    "created_at" timestamp DEFAULT now() NOT NULL
);

-- Tokenized public customer summary pages
CREATE TABLE "job_summaries" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "job_id" uuid NOT NULL,
    "token" varchar(32) NOT NULL,
    "customer_summary" text NOT NULL,
    "created_by" uuid,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "expires_at" timestamp NOT NULL,
    CONSTRAINT "job_summaries_token_unique" UNIQUE("token")
);

-- -----------------------------------------------------------------------------
-- Foreign keys
-- -----------------------------------------------------------------------------

ALTER TABLE "checklist_templates"
    ADD CONSTRAINT "checklist_templates_created_by_profiles_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");

ALTER TABLE "checklist_template_items"
    ADD CONSTRAINT "checklist_template_items_template_id_checklist_templates_id_fk"
    FOREIGN KEY ("template_id") REFERENCES "public"."checklist_templates"("id") ON DELETE CASCADE;

ALTER TABLE "jobs"
    ADD CONSTRAINT "jobs_assigned_to_profiles_id_fk"
    FOREIGN KEY ("assigned_to") REFERENCES "public"."profiles"("id");

ALTER TABLE "jobs"
    ADD CONSTRAINT "jobs_created_by_profiles_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");

ALTER TABLE "jobs"
    ADD CONSTRAINT "jobs_source_template_id_checklist_templates_id_fk"
    FOREIGN KEY ("source_template_id") REFERENCES "public"."checklist_templates"("id");

ALTER TABLE "job_checklist_items"
    ADD CONSTRAINT "job_checklist_items_job_id_jobs_id_fk"
    FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE CASCADE;

ALTER TABLE "job_checklist_items"
    ADD CONSTRAINT "job_checklist_items_completed_by_profiles_id_fk"
    FOREIGN KEY ("completed_by") REFERENCES "public"."profiles"("id");

ALTER TABLE "job_media"
    ADD CONSTRAINT "job_media_job_id_jobs_id_fk"
    FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE CASCADE;

ALTER TABLE "job_media"
    ADD CONSTRAINT "job_media_checklist_item_id_job_checklist_items_id_fk"
    FOREIGN KEY ("checklist_item_id") REFERENCES "public"."job_checklist_items"("id") ON DELETE CASCADE;

ALTER TABLE "job_media"
    ADD CONSTRAINT "job_media_uploaded_by_profiles_id_fk"
    FOREIGN KEY ("uploaded_by") REFERENCES "public"."profiles"("id");

ALTER TABLE "job_summaries"
    ADD CONSTRAINT "job_summaries_job_id_jobs_id_fk"
    FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE CASCADE;

ALTER TABLE "job_summaries"
    ADD CONSTRAINT "job_summaries_created_by_profiles_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");

-- -----------------------------------------------------------------------------
-- Defensive integrity: bucket <-> checklist_item_id invariant
-- -----------------------------------------------------------------------------
ALTER TABLE "job_media"
    ADD CONSTRAINT "job_media_bucket_item_consistency"
    CHECK (
        (bucket = 'checklist_item' AND checklist_item_id IS NOT NULL)
        OR (bucket = 'general' AND checklist_item_id IS NULL)
    );

-- -----------------------------------------------------------------------------
-- Indexes
-- -----------------------------------------------------------------------------
CREATE INDEX "jobs_assigned_to_idx" ON "jobs" ("assigned_to");
CREATE INDEX "jobs_status_idx" ON "jobs" ("status");
CREATE INDEX "jobs_created_at_idx" ON "jobs" ("created_at" DESC);
CREATE INDEX "job_checklist_items_job_id_idx" ON "job_checklist_items" ("job_id", "sort_order");
CREATE INDEX "job_media_job_id_idx" ON "job_media" ("job_id");
CREATE INDEX "job_media_checklist_item_id_idx" ON "job_media" ("checklist_item_id");
CREATE INDEX "checklist_template_items_template_id_idx" ON "checklist_template_items" ("template_id", "sort_order");

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
-- Enable RLS on all new tables; policies mirror the inspections model.
-- The get_user_role() SQL function from 0001_custom_auth_hook_and_rls.sql is reused.

ALTER TABLE "checklist_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "checklist_template_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job_checklist_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job_media" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job_summaries" ENABLE ROW LEVEL SECURITY;

-- Templates: all authenticated users can read; only admins can write.
CREATE POLICY "Authenticated users can read templates"
    ON "checklist_templates" FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Admins can insert templates"
    ON "checklist_templates" FOR INSERT
    TO authenticated
    WITH CHECK ((auth.jwt() ->> 'user_role') = 'admin');

CREATE POLICY "Admins can update templates"
    ON "checklist_templates" FOR UPDATE
    TO authenticated
    USING ((auth.jwt() ->> 'user_role') = 'admin');

CREATE POLICY "Admins can delete templates"
    ON "checklist_templates" FOR DELETE
    TO authenticated
    USING ((auth.jwt() ->> 'user_role') = 'admin');

CREATE POLICY "Authenticated users can read template items"
    ON "checklist_template_items" FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Admins can insert template items"
    ON "checklist_template_items" FOR INSERT
    TO authenticated
    WITH CHECK ((auth.jwt() ->> 'user_role') = 'admin');

CREATE POLICY "Admins can update template items"
    ON "checklist_template_items" FOR UPDATE
    TO authenticated
    USING ((auth.jwt() ->> 'user_role') = 'admin');

CREATE POLICY "Admins can delete template items"
    ON "checklist_template_items" FOR DELETE
    TO authenticated
    USING ((auth.jwt() ->> 'user_role') = 'admin');

-- Jobs: field_tech sees own; admin/office_staff see all.
CREATE POLICY "Users can read own or privileged jobs"
    ON "jobs" FOR SELECT
    TO authenticated
    USING (
        assigned_to = auth.uid()
        OR (auth.jwt() ->> 'user_role') IN ('admin', 'office_staff')
    );

CREATE POLICY "Users can insert jobs"
    ON "jobs" FOR INSERT
    TO authenticated
    WITH CHECK (
        assigned_to = auth.uid()
        OR (auth.jwt() ->> 'user_role') IN ('admin', 'office_staff')
    );

CREATE POLICY "Users can update own or privileged jobs"
    ON "jobs" FOR UPDATE
    TO authenticated
    USING (
        assigned_to = auth.uid()
        OR (auth.jwt() ->> 'user_role') IN ('admin', 'office_staff')
    );

CREATE POLICY "Privileged users can delete jobs"
    ON "jobs" FOR DELETE
    TO authenticated
    USING ((auth.jwt() ->> 'user_role') IN ('admin', 'office_staff'));

-- Job checklist items: access follows parent job
CREATE POLICY "Users can read job checklist items"
    ON "job_checklist_items" FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM "jobs"
            WHERE "jobs".id = "job_checklist_items".job_id
              AND (
                  "jobs".assigned_to = auth.uid()
                  OR (auth.jwt() ->> 'user_role') IN ('admin', 'office_staff')
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
                  "jobs".assigned_to = auth.uid()
                  OR (auth.jwt() ->> 'user_role') IN ('admin', 'office_staff')
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
                  "jobs".assigned_to = auth.uid()
                  OR (auth.jwt() ->> 'user_role') IN ('admin', 'office_staff')
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
                  "jobs".assigned_to = auth.uid()
                  OR (auth.jwt() ->> 'user_role') IN ('admin', 'office_staff')
              )
        )
    );

-- Job media: access follows parent job
CREATE POLICY "Users can read job media"
    ON "job_media" FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM "jobs"
            WHERE "jobs".id = "job_media".job_id
              AND (
                  "jobs".assigned_to = auth.uid()
                  OR (auth.jwt() ->> 'user_role') IN ('admin', 'office_staff')
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
                  "jobs".assigned_to = auth.uid()
                  OR (auth.jwt() ->> 'user_role') IN ('admin', 'office_staff')
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
                  "jobs".assigned_to = auth.uid()
                  OR (auth.jwt() ->> 'user_role') IN ('admin', 'office_staff')
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
                  "jobs".assigned_to = auth.uid()
                  OR (auth.jwt() ->> 'user_role') IN ('admin', 'office_staff')
              )
        )
    );

-- Job summaries: authenticated users follow parent job access.
-- Public tokenized reads happen via the service-role key in the API route,
-- which bypasses RLS entirely.
CREATE POLICY "Users can read job summaries"
    ON "job_summaries" FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM "jobs"
            WHERE "jobs".id = "job_summaries".job_id
              AND (
                  "jobs".assigned_to = auth.uid()
                  OR (auth.jwt() ->> 'user_role') IN ('admin', 'office_staff')
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
                  "jobs".assigned_to = auth.uid()
                  OR (auth.jwt() ->> 'user_role') IN ('admin', 'office_staff')
              )
        )
    );

-- -----------------------------------------------------------------------------
-- updated_at trigger helpers (reuse project pattern)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."set_updated_at"()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "checklist_templates_set_updated_at"
    BEFORE UPDATE ON "checklist_templates"
    FOR EACH ROW
    EXECUTE FUNCTION "public"."set_updated_at"();

CREATE TRIGGER "jobs_set_updated_at"
    BEFORE UPDATE ON "jobs"
    FOR EACH ROW
    EXECUTE FUNCTION "public"."set_updated_at"();
