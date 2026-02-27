---
phase: 04-review-workflow
verified: 2026-02-26T00:00:00Z
status: passed
score: 17/17 must-haves verified
re_verification: false
---

# Phase 4: Review Workflow Verification Report

**Phase Goal:** Office staff can review field-submitted inspections, edit summaries and recommendations, and mark reports as finalized
**Verified:** 2026-02-26
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | Field tech can submit a completed inspection (draft -> in_review) | VERIFIED | `submit/route.ts` L65-80: atomic update `eq(status, "draft")` -> `"in_review"` |
| 2  | Only draft inspections can be submitted (status guard, 409 on double-submit) | VERIFIED | `submit/route.ts` L75-80: `result.length === 0` returns 409 |
| 3  | Field techs cannot edit non-draft inspections via PATCH | VERIFIED | `route.ts` L112-117: `!isPrivileged && existing.status !== "draft"` returns 403 |
| 4  | Admin can return an in_review inspection to draft with a note | VERIFIED | `return/route.ts` L50-66: atomic update with `reviewNotes: note` |
| 5  | Admin can finalize an in_review inspection to completed | VERIFIED | `finalize/route.ts` L56-73: sets `status: "completed"`, `reviewedBy`, `completedAt` |
| 6  | Admin can reopen a completed inspection back to in_review | VERIFIED | `reopen/route.ts` L47-63: atomic update `eq(status, "completed")` -> `"in_review"` |
| 7  | Field tech sees a return note banner when reopening a returned draft | VERIFIED | `review-note-banner.tsx` renders amber banner; wizard passes `reviewNotes` |
| 8  | Dan can see a list of submitted inspections awaiting review at /review | VERIFIED | `review/page.tsx` queries `eq(status, "in_review")`, displays cards linking to `/review/{id}` |
| 9  | Dan can open a submitted inspection and see all field data alongside a PDF preview | VERIFIED | `review/[id]/page.tsx` loads full inspection + media; `review-editor.tsx` renders 5 sections + PDF panel |
| 10 | Dan can edit ANY field in the review interface | VERIFIED | `review-editor.tsx` renders react-hook-form fields for all 5 ADEQ form sections |
| 11 | Dan can click Regenerate PDF to see updated PDF after edits | VERIFIED | `review-editor.tsx` L80-83: `handleRegenerate` calls `usePdfGeneration` hook |
| 12 | Dan can finalize an inspection, locking it from further edits | VERIFIED | `review-actions.tsx` L52-73: `fetch("/finalize")` -> `onStatusChange("completed")`; editor sets `isReadOnly=true` |
| 13 | Dan can return an inspection to the field tech with a note | VERIFIED | `return-dialog.tsx` L43-57: `fetch("/return", { body: { note } })`; requires non-empty note |
| 14 | Dan can reopen a finalized inspection for further edits | VERIFIED | `review-actions.tsx` L75-96: `fetch("/reopen")` -> `onStatusChange("in_review")` |
| 15 | Finalized inspections display a completed status badge and are read-only | VERIFIED | `review-editor.tsx` L61: `isReadOnly = status === "completed"`; disables all fields and hides Save/Regenerate |
| 16 | Dan can toggle email notifications for new submissions | VERIFIED | `notifications/settings/route.ts`: GET/PUT on `notificationSettings`; submit route fires on `emailOnSubmission: true` |
| 17 | Status-aware inspection list linking (field techs to read-only, admins to /review) | VERIFIED | `inspections/page.tsx` L130-137: conditional `href` based on `isPrivileged` and `inspection.status` |

**Score:** 17/17 truths verified

---

### Required Artifacts

#### Plan 04-01 Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `src/lib/db/schema.ts` | VERIFIED | Contains `reviewNotes`, `finalizedPdfPath`, `reviewedBy` on inspections; `notificationSettings` on profiles |
| `src/lib/db/migrations/0004_review_workflow.sql` | VERIFIED | Contains `ALTER TABLE` for both tables; all 4 columns |
| `src/app/api/inspections/[id]/submit/route.ts` | VERIFIED | Exports `POST`; atomic WHERE clause; fire-and-forget notification |
| `src/app/api/inspections/[id]/return/route.ts` | VERIFIED | Exports `POST`; admin-only; parses `note` from body; 409 on invalid state |
| `src/app/api/inspections/[id]/finalize/route.ts` | VERIFIED | Exports `POST`; admin-only; sets `reviewedBy`, `completedAt`; 409 on invalid state |
| `src/app/api/inspections/[id]/reopen/route.ts` | VERIFIED | Exports `POST`; admin-only; nulls `completedAt`; 409 on invalid state |
| `src/components/inspection/submit-for-review-button.tsx` | VERIFIED | Contains "Submit for Review"; AlertDialog with validation warnings; warn-but-allow pattern |
| `src/components/inspection/review-note-banner.tsx` | VERIFIED | Amber banner with `AlertTriangle`; null/dismissed guard; dismiss button |
| `src/components/ui/alert-dialog.tsx` | VERIFIED | shadcn AlertDialog component installed |

#### Plan 04-02 Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `src/app/(dashboard)/review/page.tsx` | VERIFIED | Contains "Review Queue"; queries `in_review`; role guard (admin/office_staff only) |
| `src/app/(dashboard)/review/[id]/page.tsx` | VERIFIED | Contains `ReviewEditor` import and render; loads all inspection fields + media |
| `src/components/review/review-editor.tsx` | VERIFIED | Contains `grid-cols-1 lg:grid-cols-2`; 5 collapsible sections; save PATCH; regenerate PDF |
| `src/components/review/review-section.tsx` | VERIFIED | Contains `Collapsible`; wraps shadcn Collapsible with Card styling |
| `src/components/review/review-actions.tsx` | VERIFIED | Contains "Finalize"; Return, and Reopen buttons with AlertDialog confirmations |
| `src/components/review/return-dialog.tsx` | VERIFIED | Contains "return"; Textarea for note; validates non-empty before posting |
| `src/lib/email/send-notification.ts` | VERIFIED | Contains `resend`; graceful degradation when env vars absent |
| `src/components/ui/collapsible.tsx` | VERIFIED | shadcn Collapsible component installed |
| `src/app/api/notifications/settings/route.ts` | VERIFIED | GET/PUT endpoints for `notificationSettings` on profiles |

---

### Key Link Verification

#### Plan 04-01 Key Links

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `submit-for-review-button.tsx` | `/api/inspections/[id]/submit` | `fetch POST call` | WIRED | L58: `fetch(\`/api/inspections/${inspectionId}/submit\`, { method: "POST" })` |
| `submit/route.ts` | `db.update(inspections)` | Drizzle atomic status transition | WIRED | L72: `.where(and(eq(inspections.id, id), eq(inspections.status, "draft")))` |
| `route.ts` (PATCH) | `inspections.status` | Status guard on PATCH for field techs | WIRED | L112: `if (!isPrivileged && existing.status !== "draft")` returns 403 |

#### Plan 04-02 Key Links

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `review/[id]/page.tsx` | `review-editor.tsx` | Server component passes inspection data | WIRED | L8 import + L74 `<ReviewEditor inspection={...} media={...} />` |
| `review-editor.tsx` | `/api/inspections/[id]` | PATCH to save edited field data | WIRED | L89-95: `fetch(\`/api/inspections/${inspection.id}\`, { method: "PATCH" })` |
| `review-editor.tsx` | `use-pdf-generation.ts` | `usePdfGeneration` hook for regenerate | WIRED | L11 import + L68-69 `usePdfGeneration()`, L82 `generatePdf(...)` |
| `review-actions.tsx` | `/api/inspections/[id]/finalize` | POST to finalize inspection | WIRED | L55: `fetch(\`/api/inspections/${inspectionId}/finalize\`, { method: "POST" })` |
| `return-dialog.tsx` | `/api/inspections/[id]/return` | POST with note to return to field tech | WIRED | L43: `fetch(\`/api/inspections/${inspectionId}/return\`, { method: "POST", body: { note } })` |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| WKFL-01 | 04-01 | Field tech submits completed inspection for office review | SATISFIED | `submit/route.ts` POST endpoint; `submit-for-review-button.tsx` in wizard; full status state machine |
| WKFL-02 | 04-02 | Office staff (Dan) can review, edit summaries/recommendations, and finalize reports | SATISFIED | `/review` queue page; `/review/[id]` editor with all 5 form sections; Finalize/Return/Reopen actions |

No orphaned requirements found for Phase 4.

---

### Anti-Patterns Found

No blockers or stubs detected. Scanned all 22 created/modified files.

| File | Pattern | Severity | Notes |
|------|---------|----------|-------|
| All files | None | — | No TODO/FIXME/placeholder comments; no empty implementations; no console.log-only handlers |

---

### Human Verification Required

The following items require manual testing and cannot be verified programmatically:

#### 1. Submit for Review Dialog — Warn-but-Allow Flow

**Test:** Open an inspection with some fields unfilled, navigate to the last wizard step, click "Submit for Review"
**Expected:** AlertDialog opens listing validation warnings, with "Submit Anyway" button that successfully submits
**Why human:** Runtime validation behavior; form state at submission time cannot be grep-verified

#### 2. Review Editor — Collapsible Section Animation

**Test:** Navigate to `/review/{id}` as admin, click section headers
**Expected:** Sections expand/collapse with smooth animation; first section (Facility Info) starts open
**Why human:** Visual/animation behavior; CSS transition rendering cannot be verified statically

#### 3. PDF Regenerate After Edits

**Test:** In the review editor, edit a field, then click "Regenerate PDF"
**Expected:** Hint text "Form data changed -- regenerate PDF to see updates" appears when dirty; clicking Regenerate clears existing PDF and generates new one with updated data
**Why human:** `useEffect` clearing PDF on dirty state is runtime behavior

#### 4. Email Notification (requires env vars)

**Test:** Configure `RESEND_API_KEY` and `ADMIN_NOTIFICATION_EMAIL`; enable `emailOnSubmission` via PUT `/api/notifications/settings`; submit an inspection
**Expected:** Admin receives email with facility name and link to `/review/{id}`
**Why human:** Requires live Resend API credentials and external email delivery

#### 5. Return Note Banner Persistence

**Test:** Return an inspection with a note; field tech opens the inspection in the wizard
**Expected:** Amber banner shows the admin's note at the top of the wizard
**Why human:** Requires a live database with a returned inspection record

#### 6. Migration Applied to Supabase

**Test:** Confirm `0004_review_workflow.sql` has been run in the Supabase SQL Editor
**Expected:** `review_notes`, `finalized_pdf_path`, `reviewed_by` columns exist on `inspections`; `notification_settings` on `profiles`
**Why human:** External database operation; cannot verify from codebase

---

## Summary

Phase 4 goal is fully achieved. Both plans executed completely with all artifacts substantive and wired.

**Plan 04-01 (WKFL-01):** The status state machine is fully implemented. Four atomic transition endpoints (submit, return, finalize, reopen) each guard the expected current status with a Drizzle WHERE clause, returning 409 on invalid transitions. The PATCH route blocks field tech edits on non-draft inspections. The Submit for Review button renders on the wizard's last step with a warn-but-allow validation dialog. The return note banner renders on returned drafts.

**Plan 04-02 (WKFL-02):** The complete review workflow UI is built. The review queue at `/review` lists `in_review` inspections (and recently completed) with role guarding. The review editor at `/review/[id]` renders a side-by-side layout with all 5 ADEQ form sections as collapsible cards on the left and a sticky PDF preview panel on the right. All Finalize/Return/Reopen actions are wired to their respective API endpoints. The return dialog validates that a note is provided before posting. Completed inspections are read-only (fields disabled, Save/Regenerate hidden). The inspections list page links field techs to read-only view for non-drafts and admins to the review interface.

**TypeScript:** `npx tsc --noEmit` passes with zero errors.

**One pending external dependency:** The Supabase migration `0004_review_workflow.sql` must be applied manually via the Supabase SQL Editor before any of the review workflow features function at runtime.

---

_Verified: 2026-02-26_
_Verifier: Claude (gsd-verifier)_
