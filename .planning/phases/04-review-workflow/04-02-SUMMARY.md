---
phase: 04-review-workflow
plan: 02
subsystem: ui, api
tags: [nextjs, react-hook-form, collapsible, review-workflow, resend, email, pdf-preview]

# Dependency graph
requires:
  - phase: 04-review-workflow
    provides: "Status transition API endpoints (submit, return, finalize, reopen), PATCH guard, review schema columns"
  - phase: 03-pdf-generation
    provides: "usePdfGeneration hook, PdfPreview component, generateReport"
  - phase: 02-inspection-form
    provides: "Inspection form schema, validators, wizard step fields, auto-save PATCH endpoint"
provides:
  - "Review queue page at /review showing in_review and recently completed inspections"
  - "Side-by-side review editor at /review/[id] with collapsible form sections and sticky PDF preview"
  - "ReviewActions component with Finalize, Return, Reopen buttons and confirmation dialogs"
  - "ReturnDialog for sending inspection back to field tech with a note"
  - "ReviewSection collapsible card component wrapping shadcn Collapsible"
  - "Email notification on submission via Resend (fire-and-forget)"
  - "Notification settings API (GET/PUT) for admin email preferences"
  - "Status-aware inspection list linking (field techs to read-only, admins to review)"
affects: [05-delivery]

# Tech tracking
tech-stack:
  added: ["resend", "@radix-ui/react-collapsible (via shadcn)"]
  patterns: ["Side-by-side review layout with sticky PDF panel", "Collapsible form sections for dense data review", "Fire-and-forget email notification pattern"]

key-files:
  created:
    - src/app/(dashboard)/review/page.tsx
    - src/app/(dashboard)/review/[id]/page.tsx
    - src/components/review/review-editor.tsx
    - src/components/review/review-section.tsx
    - src/components/review/review-actions.tsx
    - src/components/review/return-dialog.tsx
    - src/components/ui/collapsible.tsx
    - src/lib/email/send-notification.ts
    - src/app/api/notifications/settings/route.ts
  modified:
    - src/app/(dashboard)/inspections/[id]/inspection-pdf-view.tsx
    - src/app/(dashboard)/inspections/page.tsx
    - src/app/api/inspections/[id]/submit/route.ts

key-decisions:
  - "Show All Fields toggles within each review section -- keeps primary editing area clean while allowing access to all 100+ form fields"
  - "Disposal Works comments/summary highlighted with border-primary styling as primary editing area for Dan"
  - "Fire-and-forget email notification via async IIFE in submit route -- does not block the HTTP response"
  - "Admin notification preference checked via profiles.notificationSettings join before sending"

patterns-established:
  - "ReviewSection collapsible card pattern for dense form data display"
  - "Show All Fields toggle pattern for progressive disclosure in review interfaces"
  - "Fire-and-forget notification pattern with graceful degradation when env vars missing"

requirements-completed: [WKFL-02]

# Metrics
duration: 6min
completed: 2026-02-27
---

# Phase 4 Plan 02: Review Editor and Email Notification Summary

**Side-by-side review editor with collapsible form sections, sticky PDF preview, finalize/return/reopen actions, Resend email notification on submission, and notification settings API**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-27T00:28:47Z
- **Completed:** 2026-02-27T00:35:16Z
- **Tasks:** 3
- **Files modified:** 12

## Accomplishments
- Review queue page at /review showing submitted inspections awaiting review and recently completed
- Side-by-side review editor with all 5 ADEQ form sections as collapsible cards, editable fields via react-hook-form, and sticky PDF preview panel
- Finalize, Return to Tech, and Reopen action buttons with AlertDialog confirmations
- Return dialog collects a note explaining what needs to be fixed
- Email notification fires on submission when admin has emailOnSubmission enabled
- Notification settings API for toggling email preferences
- Status-aware linking: field techs see read-only views for non-drafts, admins go to /review/[id]

## Task Commits

Each task was committed atomically:

1. **Task 1: Review queue page and collapsible section component** - `7e65fbb` (feat)
2. **Task 2: Side-by-side review editor with PDF preview and action buttons** - `6b9ec3a` (feat)
3. **Task 3: Email notification on submission and notification settings API** - `f0496d9` (feat)

## Files Created/Modified
- `src/app/(dashboard)/review/page.tsx` - Review queue listing in_review + recently completed inspections
- `src/app/(dashboard)/review/[id]/page.tsx` - Server component loading inspection data for review editor
- `src/components/review/review-editor.tsx` - Side-by-side layout: editable form sections left, PDF preview right
- `src/components/review/review-section.tsx` - Collapsible card section for review interface
- `src/components/review/review-actions.tsx` - Finalize, Return, Reopen action buttons with confirmation dialogs
- `src/components/review/return-dialog.tsx` - Dialog for entering return note when sending back to field tech
- `src/components/ui/collapsible.tsx` - shadcn Collapsible primitive component
- `src/lib/email/send-notification.ts` - Resend email sending utility for submission notifications
- `src/app/api/notifications/settings/route.ts` - GET/PUT notification settings for admin email preferences
- `src/app/(dashboard)/inspections/[id]/inspection-pdf-view.tsx` - Status-aware: hides Edit for non-drafts, shows review notice
- `src/app/(dashboard)/inspections/page.tsx` - Status-aware linking: field techs to read-only, admins to review
- `src/app/api/inspections/[id]/submit/route.ts` - Fire-and-forget email notification after submission

## Decisions Made
- Show All Fields toggles within each review section keeps the primary editing area clean while allowing access to all 100+ ADEQ form fields when needed
- Disposal Works comments/summary highlighted with border-primary styling as the primary editing area Dan uses most
- Fire-and-forget email notification via async IIFE in the submit route does not block the HTTP response
- Admin notification preference checked via profiles.notificationSettings join before sending email
- Used onboarding@resend.dev as sender address until Dan verifies a custom domain in Resend

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

**External services require manual configuration:**
- Create a free Resend account at https://resend.com and generate an API key
- Add `RESEND_API_KEY` to Vercel environment variables (from Resend Dashboard -> API Keys)
- Add `ADMIN_NOTIFICATION_EMAIL` to Vercel environment variables (Dan's email address)
- Enable email notifications by PUTting `{ "emailOnSubmission": true }` to `/api/notifications/settings` after logging in as admin

## Next Phase Readiness
- Review workflow is fully operational -- all review UI components built
- Phase 5 (Delivery) can build on completed inspection outputs
- Email notification works in test mode via Resend's onboarding sender

## Self-Check: PASSED

All 9 created files verified present. All 3 task commits verified (7e65fbb, 6b9ec3a, f0496d9).

---
*Phase: 04-review-workflow*
*Completed: 2026-02-27*
