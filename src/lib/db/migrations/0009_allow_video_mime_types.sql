-- Allow both image and video uploads in the inspection-media bucket.
-- The bucket may have been created with image-only MIME types via dashboard,
-- which causes video uploads to fail with a 400 error.
UPDATE storage.buckets
SET allowed_mime_types = NULL
WHERE id = 'inspection-media';
