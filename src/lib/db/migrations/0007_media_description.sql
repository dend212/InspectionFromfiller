-- Add optional description field to inspection_media
-- Used for user-provided photo captions shown in the PDF output.
-- When empty, no label text appears next to the photo in the PDF.
ALTER TABLE inspection_media ADD COLUMN description TEXT;
