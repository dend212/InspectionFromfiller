---
phase: 05-delivery-and-dashboard
plan: 01
subsystem: api, database, storage
tags: [supabase-storage, pdf, drizzle, migration, signed-url]

# Dependency graph
requires:
  - phase: 04-review-workflow
    provides: finalize route with in_review -> completed transition
  - phase: 03-pdf-generation
    provides: generateReport function for server-side PDF creation
provides:
  - inspection_emails table and customer contact columns on inspections
  - uploadReport and getReportDownloadUrl storage helpers
  - Server-side PDF generation in finalize route
  - GET /api/inspections/[id]/download signed URL endpoint
  - buildDownloadFilename with address+date format
affects: [05-02-email-delivery, 05-03-dashboard]

# Tech tracking
tech-stack:
  added: []
  patterns: [supabase-storage-upsert, signed-url-download, server-side-pdf-generation]

key-files:
  created:
    - src/lib/db/migrations/0005_delivery_dashboard.sql
    - src/lib/storage/pdf-storage.ts
    - src/app/api/inspections/[id]/download/route.ts
  modified:
    - src/lib/db/schema.ts
    - src/app/api/inspections/[id]/finalize/route.ts
    - src/app/api/inspections/[id]/route.ts

key-decisions:
  - "Deterministic storage path reports/{id}/report.pdf with upsert for clean re-finalize"
  - "Signature extracted from formData.disposalWorks.signatureDataUrl rather than passed separately"
  - "Admin client used for storage operations (bypasses RLS for server-side uploads)"

patterns-established:
  - "PDF storage pattern: uploadReport with upsert at deterministic path, getReportDownloadUrl with 1h signed URL"
  - "Download filename pattern: sanitized address + ISO date (123-Main-St_2026-02-26.pdf)"

requirements-completed: [DLVR-01]

# Metrics
duration: 3min
completed: 2026-02-27
---

# Phase 5 Plan 1: PDF Storage and Delivery Schema Summary

**Server-side PDF generation on finalize with Supabase Storage upload, signed download URLs, and delivery schema (customer_email, customer_name, inspection_emails table)**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-27T01:28:12Z
- **Completed:** 2026-02-27T01:31:06Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Database schema extended with customer_email, customer_name columns and inspection_emails table with RLS policies
- Finalize route now generates PDF server-side and uploads to Supabase Storage at `reports/{id}/report.pdf`
- Download endpoint returns 1-hour signed URLs with address+date filenames for browser download
- PATCH auto-save syncs customerName from formData for dashboard search

## Task Commits

Each task was committed atomically:

1. **Task 1: Database schema migration and Drizzle schema updates** - `7810b0d` (feat)
2. **Task 2: PDF storage helpers, server-side finalize, and download endpoint** - `d97ae42` (feat)

## Files Created/Modified
- `src/lib/db/migrations/0005_delivery_dashboard.sql` - SQL migration for customer columns and email history table
- `src/lib/db/schema.ts` - Drizzle schema: customerEmail, customerName columns, inspectionEmails table + relations
- `src/app/api/inspections/[id]/route.ts` - PATCH handler syncs customerName from facilityInfo.sellerName
- `src/lib/storage/pdf-storage.ts` - uploadReport, getReportDownloadUrl, buildDownloadFilename helpers
- `src/app/api/inspections/[id]/finalize/route.ts` - Server-side PDF generation + Storage upload on finalize
- `src/app/api/inspections/[id]/download/route.ts` - GET endpoint returning signed download URL

## Decisions Made
- Deterministic storage path `reports/{id}/report.pdf` with `upsert: true` so re-finalize cleanly replaces the old PDF without separate delete logic
- Signature data URL extracted from `formData.disposalWorks.signatureDataUrl` rather than requiring it as a separate parameter -- the data is already stored in formData from the client-side capture
- Admin client used for all storage operations to bypass RLS (server-side only, never exposed to client)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required

**Database migration must be applied.** Run the SQL in `src/lib/db/migrations/0005_delivery_dashboard.sql` via the Supabase SQL Editor to add the customer columns and inspection_emails table.

## Next Phase Readiness
- Storage helpers ready for Plan 02 (email delivery) to attach download links
- inspection_emails table ready for Plan 02 to log email send history
- customerEmail and customerName columns ready for Plan 02 (email) and Plan 03 (dashboard)
- Download endpoint ready for dashboard integration in Plan 03

---
*Phase: 05-delivery-and-dashboard*
*Completed: 2026-02-27*
