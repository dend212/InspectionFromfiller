# Phase 4: Review Workflow - Context

**Gathered:** 2026-02-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Office staff can review field-submitted inspections, edit summaries and recommendations, preview/regenerate the PDF, and mark reports as finalized (locking them from further field tech edits). Delivery (email, cloud storage) and dashboard search are Phase 5.

</domain>

<decisions>
## Implementation Decisions

### Submission Flow
- Explicit "Submit for Review" button at the end of the inspection form wizard
- Warn-but-allow validation: show warnings for missing data (signature, key fields) but allow submission anyway — Dan can request corrections later
- Once submitted, only Dan (admin) can un-submit/return it — field tech cannot retract
- No default notification; build a toggleable email notification setting so Dan can opt in to receiving an email when inspections are submitted

### Review Interface
- Side-by-side layout: form data on the left, PDF preview on the right
- Dan can edit ALL fields (summaries, recommendations, AND any field data the tech entered) — full override power
- Dan can return an inspection to the field tech with a note explaining what needs fixing — status goes back to draft
- Field data organized in the same 5 collapsible sections as the wizard (Facility Info, General Treatment, Design Flow, Septic Tank Inspection, Disposal Works)

### PDF Edit Cycle
- Manual "Regenerate PDF" button — Dan edits fields, then clicks to regenerate (avoids constant regeneration)
- Dan can download the current PDF at any point during review (not locked to finalization)
- PDF preview uses the existing embedded browser iframe approach from Phase 3
- Each regeneration overwrites the previous — no version history, only the final PDF matters

### Finalization
- Finalizing locks all fields and stores the current PDF as the final version
- Status changes to "complete" on finalization
- Admin (Dan) can reopen a finalized report, putting it back to "in review" for further edits
- Finalized inspections display a clear status badge and are read-only for field techs (green/completed styling)

### Claude's Discretion
- Status model design (whether to use 3 statuses like draft/in-review/complete or add a "returned" status for the send-back flow)
- Email notification implementation details (provider, template)
- Exact layout proportions for side-by-side view
- Loading states and error handling during PDF regeneration

</decisions>

<specifics>
## Specific Ideas

- Return-to-tech flow: Dan adds a note explaining what needs fixing, tech sees the note when they reopen the draft
- Notification toggle: simple on/off setting in user preferences, sends to Dan's email when a new inspection is submitted
- Reuse the existing iframe PDF viewer from Phase 3 — no new PDF viewer library

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-review-workflow*
*Context gathered: 2026-02-26*
