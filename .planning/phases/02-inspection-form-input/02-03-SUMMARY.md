---
phase: 02-inspection-form-input
plan: 03
subsystem: ui
tags: [supabase-storage, media-upload, photo-capture, video-upload, react, nextjs]

# Dependency graph
requires:
  - phase: 02-inspection-form-input/02
    provides: "5-step wizard UI with step components, auto-save, inspection-wizard shell"
  - phase: 02-inspection-form-input/01
    provides: "inspection_media schema, Drizzle DB, Supabase client helpers, inspection CRUD API"
provides:
  - "PhotoCapture component for device camera/gallery photo upload per form section"
  - "VideoUpload component with 120-second duration validation"
  - "MediaGallery component with signed URL thumbnails, captions, and delete"
  - "Media API route (POST/GET/DELETE) for inspection_media CRUD"
  - "Supabase Storage bucket SQL migration (0003_storage_bucket_setup.sql)"
  - "Per-section photo attachment integrated into all 5 wizard steps"
affects: [03-pdf-generation]

# Tech tracking
tech-stack:
  added: [supabase-storage, crypto.randomUUID]
  patterns: [per-section-media-attachment, signed-url-thumbnails, client-side-video-duration-validation]

key-files:
  created:
    - src/components/inspection/photo-capture.tsx
    - src/components/inspection/video-upload.tsx
    - src/components/inspection/media-gallery.tsx
    - src/app/api/inspections/[id]/media/route.ts
    - src/lib/db/migrations/0003_storage_bucket_setup.sql
  modified:
    - src/components/inspection/step-facility-info.tsx
    - src/components/inspection/step-general-treatment.tsx
    - src/components/inspection/step-design-flow.tsx
    - src/components/inspection/step-septic-tank.tsx
    - src/components/inspection/step-disposal-works.tsx
    - src/components/inspection/inspection-wizard.tsx

key-decisions:
  - "Private Supabase Storage bucket with signed URLs (1-hour expiry) for secure media access"
  - "Client-side video duration validation using temporary <video> element loadedmetadata event"
  - "Per-section photo attachment -- each wizard step filters media by section label"
  - "Video upload only on Step 5 (Disposal Works) as general inspection attachment"

patterns-established:
  - "Per-section media: PhotoCapture and MediaGallery rendered at bottom of each step, filtered by section label"
  - "Signed URL pattern: createSignedUrl(path, 3600) for private bucket media display"
  - "Media lifecycle: upload to Storage -> POST metadata to API -> display via signed URL -> DELETE removes both"

requirements-completed: [MDIA-01, MDIA-02]

# Metrics
duration: 15min
completed: 2026-02-26
---

# Phase 2 Plan 3: Media Capture Summary

**Photo capture from device camera, video upload with 120s duration validation, per-section media galleries with signed URL thumbnails, and Supabase Storage bucket setup**

## Performance

- **Duration:** ~15 min (continuation after checkpoint approval)
- **Started:** 2026-02-26T17:56:00Z
- **Completed:** 2026-02-26T18:15:00Z
- **Tasks:** 3 (2 auto + 1 checkpoint:human-verify)
- **Files modified:** 11

## Accomplishments
- PhotoCapture component opens native camera/gallery picker via `<input capture="environment">` and uploads to Supabase Storage
- VideoUpload validates duration <= 120 seconds client-side before upload (MDIA-02)
- MediaGallery displays thumbnails via signed URLs with optional captions and delete capability
- Media API route handles POST (create metadata), GET (list by inspection), DELETE (remove storage file + DB record)
- Per-section photo attachment integrated into all 5 wizard steps (MDIA-01)
- Supabase Storage bucket migration with RLS policies for authenticated users

## Task Commits

Each task was committed atomically:

1. **Task 1: Build photo capture, video upload, media gallery components, and media API route** - `88a09cc` (feat)
2. **Task 2: Integrate photo/video capture into all 5 wizard steps** - `7fe6bd6` (feat)
3. **Task 3: Verify Supabase Storage bucket and end-to-end media upload** - checkpoint:human-verify (approved by user)

## Files Created/Modified
- `src/components/inspection/photo-capture.tsx` - Photo capture button with native camera/gallery picker, uploads to Supabase Storage
- `src/components/inspection/video-upload.tsx` - Video upload with 120-second duration validation
- `src/components/inspection/media-gallery.tsx` - Gallery grid with signed URL thumbnails, captions, and delete
- `src/app/api/inspections/[id]/media/route.ts` - Media metadata CRUD (POST/GET/DELETE)
- `src/lib/db/migrations/0003_storage_bucket_setup.sql` - SQL to create inspection-media bucket with RLS policies
- `src/components/inspection/step-facility-info.tsx` - Added Photos section with PhotoCapture and MediaGallery
- `src/components/inspection/step-general-treatment.tsx` - Added Photos section with PhotoCapture and MediaGallery
- `src/components/inspection/step-design-flow.tsx` - Added Photos section with PhotoCapture and MediaGallery
- `src/components/inspection/step-septic-tank.tsx` - Added Photos section with PhotoCapture and MediaGallery
- `src/components/inspection/step-disposal-works.tsx` - Added Photos + Video sections with all media components
- `src/components/inspection/inspection-wizard.tsx` - Pass inspectionId prop to all step components

## Decisions Made
- Private Supabase Storage bucket with signed URLs (1-hour expiry) rather than public bucket -- secure media access
- Client-side video duration validation using temporary `<video>` element and `loadedmetadata` event -- no server-side processing needed
- Per-section photo attachment: each wizard step renders its own PhotoCapture/MediaGallery filtered by section label
- Video upload placed only on Step 5 (Disposal Works) as a general inspection attachment point

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

**Supabase Storage bucket requires manual configuration:**
- Run `src/lib/db/migrations/0003_storage_bucket_setup.sql` in Supabase Dashboard SQL Editor
- Creates `inspection-media` bucket (private, 200MB file size limit)
- Adds RLS policies for authenticated users (INSERT, SELECT, DELETE)

## Next Phase Readiness
- All Phase 2 (Inspection Form Input) plans complete
- Full inspection wizard with 5 ADEQ sections, auto-save, pre-filled fields, conditional toggles, photo capture, and video upload
- Ready for Phase 3 (PDF Generation) which will read inspection data + embedded media to produce ADEQ reports

## Self-Check: PASSED

- FOUND: src/components/inspection/photo-capture.tsx
- FOUND: src/components/inspection/video-upload.tsx
- FOUND: src/components/inspection/media-gallery.tsx
- FOUND: src/app/api/inspections/[id]/media/route.ts
- FOUND: commit 88a09cc
- FOUND: commit 7fe6bd6

---
*Phase: 02-inspection-form-input*
*Completed: 2026-02-26*
