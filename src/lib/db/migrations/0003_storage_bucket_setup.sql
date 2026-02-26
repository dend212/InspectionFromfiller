-- Create the inspection-media storage bucket (private, not public)
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('inspection-media', 'inspection-media', false, 209715200)
ON CONFLICT (id) DO NOTHING;
-- 209715200 bytes = 200MB (accommodates large videos)

-- Allow authenticated users to upload to inspection-media bucket
CREATE POLICY "Authenticated users can upload inspection media"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'inspection-media');

-- Allow authenticated users to view inspection media
CREATE POLICY "Authenticated users can view inspection media"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'inspection-media');

-- Allow authenticated users to delete inspection media
CREATE POLICY "Authenticated users can delete inspection media"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'inspection-media');
