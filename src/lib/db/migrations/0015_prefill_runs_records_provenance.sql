-- =============================================================================
-- Migration 0015: property-records prefill — runs, stored permit documents,
--                 per-field provenance sidecar on inspections
-- =============================================================================

ALTER TABLE public.inspections
  ADD COLUMN IF NOT EXISTS field_provenance jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.inspection_prefill_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id uuid NOT NULL REFERENCES public.inspections(id) ON DELETE CASCADE,
  trigger text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  stages jsonb NOT NULL DEFAULT '{}'::jsonb,
  proposals jsonb NOT NULL DEFAULT '[]'::jsonb,
  candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text,
  applied_at timestamp,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamp NOT NULL DEFAULT now(),
  finished_at timestamp
);
CREATE INDEX IF NOT EXISTS inspection_prefill_runs_inspection_created_idx
  ON public.inspection_prefill_runs (inspection_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.inspection_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id uuid NOT NULL REFERENCES public.inspections(id) ON DELETE CASCADE,
  run_id uuid REFERENCES public.inspection_prefill_runs(id) ON DELETE SET NULL,
  source text NOT NULL,
  permit_number text NOT NULL,
  doc_type text NOT NULL,
  doc_date date,
  description text,
  page_count integer,
  size_bytes integer,
  storage_path text NOT NULL,
  selected boolean NOT NULL DEFAULT true,
  extraction_status text NOT NULL DEFAULT 'pending',
  extraction_error text,
  extracted jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inspection_records_inspection_idx
  ON public.inspection_records (inspection_id);

-- RLS: the app talks to Postgres through the service connection (bypasses RLS);
-- these policies are defence-in-depth for direct Supabase-client access,
-- mirroring 0005 (inspection_emails).
ALTER TABLE public.inspection_prefill_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspection_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Prefill runs readable by authenticated" ON public.inspection_prefill_runs;
CREATE POLICY "Prefill runs readable by authenticated"
  ON public.inspection_prefill_runs FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Inspection records readable by authenticated" ON public.inspection_records;
CREATE POLICY "Inspection records readable by authenticated"
  ON public.inspection_records FOR SELECT TO authenticated USING (true);
