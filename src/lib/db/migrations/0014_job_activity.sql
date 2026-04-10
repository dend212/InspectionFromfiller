-- =============================================================================
-- 0014_job_activity.sql
--
-- Timeline of meaningful events per job:
--   - creation, status change, assignee change, finalize, reopen
--   - checklist add/update/delete
--   - media add/delete
--   - summary link generated, summary email sent
--
-- Designed to mirror the inspection_emails / job_emails pattern: a thin
-- append-only log with a JSONB metadata column so new event types don't
-- require new columns.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.job_activity (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor_id uuid REFERENCES public.profiles(id),
  summary text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Fast reverse-chronological lookup per job (the only read pattern).
CREATE INDEX IF NOT EXISTS job_activity_job_id_idx
  ON public.job_activity (job_id, created_at DESC);

ALTER TABLE public.job_activity ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated user. Access is actually gated at the API layer
-- via checkJobAccess, so RLS here is a permissive safety net.
CREATE POLICY "Authenticated users can view job activity"
  ON public.job_activity FOR SELECT
  TO authenticated
  USING (true);

-- Insert: any authenticated user. Again, API routes are the real gate —
-- every insert is written by a server-side handler after a role / access
-- check has already passed.
CREATE POLICY "Authenticated users can insert job activity"
  ON public.job_activity FOR INSERT
  TO authenticated
  WITH CHECK (true);

COMMIT;
