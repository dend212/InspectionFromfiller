-- Migration: Delivery & Dashboard schema additions
-- Phase 05, Plan 01: Add customer contact fields and email history tracking

-- Add customer contact columns to inspections
ALTER TABLE public.inspections
  ADD COLUMN IF NOT EXISTS customer_email text,
  ADD COLUMN IF NOT EXISTS customer_name text;

-- Create email send history table
CREATE TABLE IF NOT EXISTS public.inspection_emails (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  inspection_id uuid NOT NULL REFERENCES public.inspections(id) ON DELETE CASCADE,
  recipient_email text NOT NULL,
  subject text NOT NULL,
  sent_at timestamptz DEFAULT now() NOT NULL,
  sent_by uuid REFERENCES public.profiles(id)
);

ALTER TABLE public.inspection_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view email history"
  ON public.inspection_emails FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert email records"
  ON public.inspection_emails FOR INSERT
  TO authenticated
  WITH CHECK (true);
