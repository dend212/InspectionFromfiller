---
phase: 04-review-workflow
plan: 01
subsystem: api, ui
tags: [drizzle, nextjs, api-routes, status-machine, alertdialog, shadcn]

# Dependency graph
requires:
  - phase: 02-inspection-form
    provides: "Inspection wizard, form schema, auto-save, PATCH endpoint"
  - phase: 01-foundation
    provides: "Auth, profiles table, JWT role decode pattern, Supabase client"
provides:
  - "Status transition API endpoints (submit, return, finalize, reopen)"
  - "Atomic status guards preventing invalid transitions (409 on race)"
  - "PATCH status guard blocking field tech edits on non-draft inspections"
  - "Submit for Review button with warn-but-allow validation dialog"
  - "Review note banner for returned drafts"
  - "reviewNotes, finalizedPdfPath, reviewedBy columns on inspections table"
  - "notificationSettings column on profiles table"
  - "Migration SQL 0004_review_workflow.sql"
affects: [04-review-workflow, 05-delivery]

# Tech tracking
tech-stack:
  added: ["@radix-ui/react-alert-dialog (via shadcn)"]
  patterns: ["Atomic status transition via Drizzle WHERE clause", "submitButton prop injection for wizard last-step override"]

key-files:
  created:
    - src/lib/db/migrations/0004_review_workflow.sql
    - src/app/api/inspections/[id]/submit/route.ts
    - src/app/api/inspections/[id]/return/route.ts
    - src/app/api/inspections/[id]/finalize/route.ts
    - src/app/api/inspections/[id]/reopen/route.ts
    - src/components/inspection/submit-for-review-button.tsx
    - src/components/inspection/review-note-banner.tsx
    - src/components/ui/alert-dialog.tsx
  modified:
    - src/lib/db/schema.ts
    - src/app/api/inspections/[id]/route.ts
    - src/components/inspection/inspection-wizard.tsx
    - src/components/inspection/wizard-navigation.tsx
    - src/app/(dashboard)/inspections/[id]/edit/page.tsx

key-decisions:
  - "Atomic WHERE clause for all status transitions -- prevents race conditions without database-level locks"
  - "submitButton ReactNode prop on WizardNavigation for clean last-step override without breaking existing API"
  - "AlertDialogDescription uses asChild with div wrapper for rich content (warning lists) without nesting p in p"

patterns-established:
  - "Status transition endpoint pattern: auth check, role check, atomic update with WHERE status guard, 409 on conflict"
  - "WizardNavigation submitButton prop injection for overriding last-step button behavior"

requirements-completed: [WKFL-01]

# Metrics
duration: 4min
completed: 2026-02-27
---

# Phase 4 Plan 01: Review Workflow API and Submit Button Summary

**Status state machine with 4 atomic transition endpoints, PATCH guard for field techs, submit-for-review button with warn-but-allow validation dialog, and return-note banner**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-27T00:21:39Z
- **Completed:** 2026-02-27T00:26:00Z
- **Tasks:** 3
- **Files modified:** 13

## Accomplishments
- All four status transition API endpoints (submit, return, finalize, reopen) with atomic WHERE-clause guards
- PATCH route now blocks field tech edits on non-draft inspections (defense in depth)
- Submit for Review button with AlertDialog showing validation warnings but allowing submission anyway
- Review note banner appears on returned drafts with the admin's note
- Database migration ready for Supabase SQL Editor (0004_review_workflow.sql)

## Task Commits

Each task was committed atomically:

1. **Task 1: Database migration and Drizzle schema update** - `53062e2` (feat)
2. **Task 2: Four status transition API endpoints with atomic guards** - `7abcbe6` (feat)
3. **Task 3: Submit for Review button, review-note banner, wizard integration** - `4ad8cbb` (feat)

## Files Created/Modified
- `src/lib/db/migrations/0004_review_workflow.sql` - SQL migration adding review_notes, finalized_pdf_path, reviewed_by to inspections; notification_settings to profiles
- `src/lib/db/schema.ts` - Drizzle schema with 3 new inspections columns and 1 new profiles column
- `src/app/api/inspections/[id]/submit/route.ts` - POST: draft -> in_review (inspector or admin)
- `src/app/api/inspections/[id]/return/route.ts` - POST: in_review -> draft with note (admin)
- `src/app/api/inspections/[id]/finalize/route.ts` - POST: in_review -> completed (admin)
- `src/app/api/inspections/[id]/reopen/route.ts` - POST: completed -> in_review (admin)
- `src/app/api/inspections/[id]/route.ts` - PATCH now rejects field tech edits on non-draft inspections
- `src/components/inspection/submit-for-review-button.tsx` - Submit for Review button with validation dialog
- `src/components/inspection/review-note-banner.tsx` - Amber banner showing admin return notes
- `src/components/ui/alert-dialog.tsx` - shadcn AlertDialog component
- `src/components/inspection/inspection-wizard.tsx` - Integrated ReviewNoteBanner and SubmitForReviewButton
- `src/components/inspection/wizard-navigation.tsx` - Added submitButton prop for last-step override
- `src/app/(dashboard)/inspections/[id]/edit/page.tsx` - Passes reviewNotes to wizard

## Decisions Made
- Atomic WHERE clause for all status transitions -- prevents race conditions without needing database-level locks or advisory locks
- submitButton ReactNode prop on WizardNavigation for clean last-step override without breaking existing component API
- AlertDialogDescription uses asChild with div wrapper to allow rich content (bullet-point warning lists) without HTML nesting violations (p inside p)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

The `npx shadcn@latest add alert-dialog --overwrite` command reformatted several existing files (globals.css, button.tsx, and others) with shadcn's latest styling defaults. These unintended formatting changes were reverted before committing to keep the diff clean and scoped to Task 3 changes only.

## User Setup Required

**External services require manual configuration:**
- Run migration `0004_review_workflow.sql` in Supabase Dashboard -> SQL Editor -> paste and run

## Next Phase Readiness
- Status state machine is operational -- all 4 transition endpoints ready
- Plan 04-02 (admin review dashboard) can build on these endpoints
- Migration must be applied in Supabase SQL Editor before testing live

## Self-Check: PASSED

All 13 files verified present. All 3 task commits verified (53062e2, 7abcbe6, 4ad8cbb).

---
*Phase: 04-review-workflow*
*Completed: 2026-02-27*
