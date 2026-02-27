-- Migration: 0004_review_workflow
-- Purpose: Add review workflow columns to inspections and notification settings to profiles

-- Add review workflow columns to inspections table
ALTER TABLE public.inspections
  ADD COLUMN IF NOT EXISTS review_notes text,
  ADD COLUMN IF NOT EXISTS finalized_pdf_path text,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.profiles(id);

-- Add notification settings to profiles table
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notification_settings jsonb DEFAULT '{"emailOnSubmission": false}'::jsonb;
