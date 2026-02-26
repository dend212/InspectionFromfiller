---
phase: 03-pdf-generation
plan: 03
subsystem: pdf
tags: [pdfme, pdf-lib, photo-pages, comments-overflow, pdf-merge, supabase-storage, base64-images]

# Dependency graph
requires:
  - phase: 03-pdf-generation
    provides: pdfme template schema (ADEQ_TEMPLATE_SCHEMAS), field mapping (mapFormDataToInputs), comment overflow detection (detectCommentOverflow), Liberation Sans fonts, loadTemplate()
provides:
  - Photo appendix page builder (buildPhotoPages) fetching photos from Supabase, grouping by section, 2-per-page layout
  - Comments overflow page builder (buildCommentsPage) for long inspector comments with section headings
  - PDF merge utility (mergeGeneratedPdfs) combining form + comments + photos via pdf-lib
  - Full generate-report pipeline with overflow detection, photo pages, and merge
  - Inspection detail page passes media records to PDF generation
affects: [04-dashboard-workflow, pdf-download, inspection-detail]

# Tech tracking
tech-stack:
  added: ["pdf-lib"]
  patterns: ["pdfme blank basePdf for dynamically generated pages", "Supabase signed URL to base64 data URL conversion for pdfme image schemas", "pdf-lib merge of independently-generated PDFs", "section-grouped photo layout with sequential captions"]

key-files:
  created:
    - src/lib/pdf/photo-pages.ts
    - src/lib/pdf/comments-page.ts
    - src/lib/pdf/merge-pdf.ts
  modified:
    - src/lib/pdf/generate-report.ts
    - src/hooks/use-pdf-generation.ts
    - src/app/(dashboard)/inspections/[id]/inspection-pdf-view.tsx
    - src/app/(dashboard)/inspections/[id]/page.tsx
    - package.json
    - package-lock.json

key-decisions:
  - "pdf-lib for merge utility since @pdfme/pdf-lib is internal and not exposed as public API"
  - "Photo pages use blank pdfme basePdf (letter dimensions) rather than modifying the ADEQ form template"
  - "Photo data fetched as Supabase signed URLs then converted to base64 data URLs for pdfme image schemas"
  - "Comments overflow page uses dynamicFontSize (min 7, max 10) to handle variable-length comments"
  - "Early-exit optimization: if no comments overflow and no photos, mergeGeneratedPdfs returns form PDF as-is"
  - "Font loading cached at module level in photo-pages.ts and comments-page.ts (same pattern as template.ts)"

patterns-established:
  - "Pattern: blank pdfme basePdf for dynamically-generated appendix pages (not bound to the ADEQ form)"
  - "Pattern: parallel photo fetch with Promise.all + Map for O(1) lookup by photo ID"
  - "Pattern: section-grouped media ordering using STEP_LABELS constant as sort key"
  - "Pattern: conditional PDF generation (null return) with merge-level null checks for optional pages"

requirements-completed: [PDF-03, MDIA-03]

# Metrics
duration: 7min
completed: 2026-02-26
---

# Phase 3 Plan 03: Photo Pages, Comments Overflow & PDF Merge Summary

**Photo appendix (2-per-page, section-grouped, captioned), comments overflow page with section headings, and pdf-lib merge utility integrating all PDFs into single output**

## Performance

- **Duration:** 7 min
- **Started:** 2026-02-26T22:28:06Z
- **Completed:** 2026-02-26T22:35:08Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- Created photo page builder that fetches photos from Supabase, groups by form section in STEP_LABELS order, and generates 2-per-page layout with "Inspection Photos" header and sequential captions
- Created comments overflow page builder that generates a formatted page with section headings and dynamically-sized text areas for long inspector comments
- Created PDF merge utility using pdf-lib that combines form PDF + optional comments + optional photos into the final output
- Extended generateReport() to run the full pipeline: form generation, overflow detection, photo pages, and merge
- Wired media records from server page through client component to PDF generation hook

## Task Commits

Each task was committed atomically:

1. **Task 1: Create photo page builder and comments overflow page** - `d7406c0` (feat)
2. **Task 2: Create PDF merge utility and integrate with generate-report** - `d67abe5` (feat)

## Files Created/Modified
- `src/lib/pdf/photo-pages.ts` - buildPhotoPages() fetches photos from Supabase, groups by section, creates 2-per-page layout with captions
- `src/lib/pdf/comments-page.ts` - buildCommentsPage() creates formatted overflow page for long inspector comments
- `src/lib/pdf/merge-pdf.ts` - mergeGeneratedPdfs() combines form + comments + photo PDFs via pdf-lib
- `src/lib/pdf/generate-report.ts` - Extended to detect overflow, build comments and photo pages, and merge into final PDF
- `src/hooks/use-pdf-generation.ts` - Updated hook to accept and pass MediaRecord[] to generateReport
- `src/app/(dashboard)/inspections/[id]/inspection-pdf-view.tsx` - Added media prop, passes to generatePdf handler
- `src/app/(dashboard)/inspections/[id]/page.tsx` - Maps DB media records to MediaRecord[] and passes to client component
- `package.json` - Added pdf-lib dependency
- `package-lock.json` - Updated lockfile

## Decisions Made
- Used standalone pdf-lib for merge because @pdfme/pdf-lib is an internal dependency not exposed as public API
- Photo pages use a blank pdfme basePdf (US Letter dimensions) rather than trying to append to the ADEQ form template -- this keeps photo generation independent and composable
- Photos fetched via Supabase signed URLs then converted to base64 data URLs (data:image/jpeg;base64,...) which pdfme's image schema accepts natively
- Comments overflow page uses dynamicFontSize (min 7pt, max 10pt) so long comments shrink rather than clip
- mergeGeneratedPdfs returns formPdf as-is when no additional pages exist (avoids unnecessary pdf-lib processing)
- Font caching in photo-pages.ts and comments-page.ts follows the established pattern from template.ts

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Biome linter with noUnusedImports rule was auto-removing MediaRecord type imports during incremental file edits (import appeared unused before the consuming code was written in the same file). Resolved by writing all interdependent files in parallel to avoid transient unused-import state.
- Pre-existing unstaged changes from Plan 03-02 were present in working directory -- committed only Task 2-specific files to maintain atomic commit boundaries.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Complete PDF generation pipeline is operational: form data -> 6-page ADEQ form -> optional comments overflow -> optional photo appendix -> merged single PDF
- Ready for Phase 4 (Dashboard & Workflow) which will add PDF download/email from the inspection list
- Photo embedding file size should be validated during real-world testing with actual inspection photos (blocker from STATE.md)
- The pdf-preview.tsx has a pre-existing TypeScript issue with Uint8Array BlobPart compatibility (not introduced by this plan, affects browser PDF preview only)

## Self-Check: PASSED

All files verified present:
- src/lib/pdf/photo-pages.ts
- src/lib/pdf/comments-page.ts
- src/lib/pdf/merge-pdf.ts
- src/lib/pdf/generate-report.ts
- src/hooks/use-pdf-generation.ts
- src/app/(dashboard)/inspections/[id]/inspection-pdf-view.tsx
- src/app/(dashboard)/inspections/[id]/page.tsx

All commits verified:
- d7406c0 (Task 1)
- d67abe5 (Task 2)

---
*Phase: 03-pdf-generation*
*Completed: 2026-02-26*
