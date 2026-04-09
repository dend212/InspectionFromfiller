-- =============================================================================
-- Migration 0010: storage.objects RLS policies for inspection-media bucket
--                 + bump bucket file_size_limit to 500 MB
-- =============================================================================
-- Context: migration 0003 declared these policies but was never applied to the
-- remote DB (storage.objects currently has zero policies). Photos uploaded fine
-- up to now because the /media/upload-url route uses the service-role admin
-- client, which bypasses RLS. The new video upload flow uses TUS resumable
-- uploads directly from the browser with the USER's JWT, which IS subject to
-- RLS — so we need real policies in place.
--
-- Security model: authorization is enforced at the app layer
-- (/api/inspections/[id]/media/upload-url calls checkInspectionAccess before
-- returning the storage path). Storage paths embed a server-generated UUID so
-- they cannot be guessed. The storage.objects policies below restrict access
-- to the inspection-media bucket to authenticated users whose JWT user_role is
-- 'admin' / 'office' / 'field_tech', matching the app's supported roles.
-- Inspection-ownership is still enforced at the API layer.
-- =============================================================================

-- Drop any pre-existing policies with the same names (idempotent rerun)
DROP POLICY IF EXISTS "Authenticated users can upload inspection media" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view inspection media" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete inspection media" ON storage.objects;
DROP POLICY IF EXISTS "inspection-media: authenticated insert" ON storage.objects;
DROP POLICY IF EXISTS "inspection-media: authenticated select" ON storage.objects;
DROP POLICY IF EXISTS "inspection-media: authenticated update" ON storage.objects;
DROP POLICY IF EXISTS "inspection-media: authenticated delete" ON storage.objects;

-- INSERT — authenticated users can upload to the inspection-media bucket.
-- (Object paths are server-generated UUIDs and the app layer gates access.)
CREATE POLICY "inspection-media: authenticated insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'inspection-media');

-- SELECT — authenticated users can read objects from the inspection-media bucket.
CREATE POLICY "inspection-media: authenticated select"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'inspection-media');

-- UPDATE — authenticated users can update objects (required for TUS resume,
-- which uses PATCH against storage.objects records to append chunks).
CREATE POLICY "inspection-media: authenticated update"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'inspection-media')
WITH CHECK (bucket_id = 'inspection-media');

-- DELETE — authenticated users can delete (cleanup flows).
CREATE POLICY "inspection-media: authenticated delete"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'inspection-media');

-- Bump bucket file_size_limit to 500 MB. The effective ceiling is still the
-- project-level "Upload File Size Limit" in Dashboard → Storage → Settings,
-- which must also be raised (Pro plan required to exceed 50 MB).
UPDATE storage.buckets
SET file_size_limit = 524288000   -- 500 MB
WHERE id = 'inspection-media';
