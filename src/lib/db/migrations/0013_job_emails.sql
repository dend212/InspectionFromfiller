-- =============================================================================
-- 0013_job_emails.sql
--
-- Tracks every customer-facing email sent for a job (currently just the
-- tokenized summary-link emails from /api/jobs/[id]/send-summary-email).
--
-- Mirrors the shape of inspection_emails (0005) so the jobs flow has the
-- same "Previously sent" history in its send dialog that inspections have.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.job_emails (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  recipient_email text NOT NULL,
  subject text NOT NULL,
  sent_at timestamptz DEFAULT now() NOT NULL,
  sent_by uuid REFERENCES public.profiles(id)
);

CREATE INDEX IF NOT EXISTS job_emails_job_id_idx
  ON public.job_emails (job_id, sent_at DESC);

ALTER TABLE public.job_emails ENABLE ROW LEVEL SECURITY;

-- Same RLS posture as inspection_emails — any authenticated user can
-- read/write history rows. The send route itself is already role-gated to
-- admin / office_staff, so unprivileged users have no way to produce inserts.
CREATE POLICY "Authenticated users can view job email history"
  ON public.job_emails FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert job email records"
  ON public.job_emails FOR INSERT
  TO authenticated
  WITH CHECK (true);

COMMIT;
