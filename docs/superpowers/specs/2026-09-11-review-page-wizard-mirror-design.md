# Review Page Mirrors the Wizard — Design

**Date:** 2026-09-11
**Status:** Approved (design), pending implementation plan
**Branch:** `feature/review-page-wizard-mirror` (branched from `feature/property-records-prefill` once Phase 1 of that spec lands, so the provenance tile/badges are available; can also ship independently if that phase slips)

## 1. Goal

Admins finalize inspections from `/review/[id]` without bouncing them back to the tech. The review page must offer the **same controls as the wizard** — button groups, toggles, per-tank UI, AI comment buttons, photo capture, provenance badges — instead of the current hand-rolled text inputs. One source of truth for field rendering.

### Non-goals

- No change to the state machine or permissions. Admin: edit + Finalize / Return / Reopen. Office staff: edit only. Non-admin flow is exactly what it is today.
- No change to the wizard's tech-side experience (review-note banner, submit flow).
- No change to the PDF pipeline.

## 2. Current state (what gets replaced)

`src/components/review/review-editor.tsx` (1,073 lines) re-implements every wizard section with `Input` / `Select` / `Textarea` / `Checkbox`, has a per-section "show all fields" toggle, a manual **Save** button, photo selection for the report with caption editing, and a PDF preview/regenerate block. `review-section.tsx` is a 38-line collapsible. `review-actions.tsx` holds the status badge and Finalize / Return / Reopen / summary-link actions.

## 3. User-facing behaviour

1. **Open:** the page shows, top to bottom — status header + actions (existing `ReviewActions`), the **Prefill sources** tile (Feature 1), six collapsed accordion sections, **Photos**, **Report Preview**, and a sticky bottom bar with the save indicator.
2. **Section pills:** each header shows one of `✓ complete` (green), `N empty` (grey — optional fields blank, no validator errors), `⚠ N issues` (amber — validator errors). Computed live from the same Zod step validators the wizard uses (`STEP_FIELDS` + `inspectionFormSchema`), so the pill changes as you type.
3. **Editing:** expanding a section renders the wizard's step component. Same button groups/toggles/tank cards/AI comment buttons/photo capture as the tech sees. Provenance badges and suggestion chips render exactly as in the wizard.
4. **Autosave:** every change PATCHes after a 1 s debounce; the bottom bar shows `Saved · 2 s ago`, `Saving…`, or `Save failed — Retry`. Leaving with a pending save flushes it; a failed flush shows a `beforeunload` warning.
5. **Finalize:** the dialog first flushes pending saves, then runs all step validators. Clean → **Finalize**. Issues → a list grouped by section (`Septic Tank · 2 issues`) where each row expands the section and scrolls to / highlights the field; buttons **Fix issues** (closes the dialog) and **Finalize with issues** (proceeds; appends `Finalized with N validation issues: <field list>` to `review_notes`).
6. **Return to tech / Reopen:** unchanged dialogs; both flush saves first.
7. **Completed / sent:** everything renders read-only (disabled controls, no autosave, no photo upload) until Reopen.
8. **Office staff:** identical page minus Finalize / Return / Reopen (as today).

## 4. Architecture

```
src/components/review/
  review-editor.tsx          ← rewritten shell (~250 lines): form, autosave, sections, photos, preview, sticky bar
  review-section.tsx         ← gains `pill` prop and controlled open state (for jump-to)
  review-pill.tsx            ← new: computes pill from validator result
  finalize-dialog.tsx        ← new: flush → validate → list issues → finalize / finalize-with-issues
  review-actions.tsx         ← Finalize button opens FinalizeDialog; Return/Reopen call flush() first
  photo-selection.tsx        ← extracted from the old editor unchanged (select-for-report + captions)
  report-preview.tsx         ← extracted from the old editor unchanged
src/components/inspection/
  step-*.tsx                 ← each accepts `readOnly?: boolean`; wraps its content in <fieldset disabled={readOnly}>
  inspection-wizard.tsx      ← unchanged
src/lib/validators/
  step-validation.ts         ← new pure helper: validateSteps(formData) → { [stepIndex]: { errors: FieldError[], emptyCount } }
src/hooks/use-auto-save.ts   ← exposes flush(): Promise<boolean> (already flushes on unmount; make it callable)
```

The review shell owns one `useForm<InspectionFormData>` (resolver = `inspectionFormSchema`, mode `onChange`), passes `form` to each step exactly as the wizard does, and mounts `useAutoSave(form, inspectionId, { enabled: !readOnly })`. Step components stay presentational; the only new prop is `readOnly`.

### Read-only mechanism

`<fieldset disabled>` disables every native `button`, `input`, `select`, `textarea` inside it, which covers shadcn `Input`, `Textarea`, `Checkbox`, `Switch`, `Select` trigger and `ButtonGroup` (all render native buttons/inputs). `PhotoCapture` and `AiCommentButton` additionally check `readOnly` to hide upload/AI actions. A `fieldset:disabled` CSS rule dims content and sets `pointer-events: none` on the few non-native widgets (signature pad).

### Section pills

`validateSteps()` runs `inspectionFormSchema.safeParse` once on the watched form values and buckets issues by `STEP_FIELDS` prefix; `emptyCount` counts step fields whose value is `""`, `[]`, `false`-by-default, or `undefined`. Pills re-render on a 300 ms debounced `form.watch`.

### Jump-to-field

`ReviewSection` is controlled (`open`, `onOpenChange`). The finalize dialog's issue rows call `openSection(stepIndex)` then `form.setFocus(fieldPath)` after the section's expand animation (`requestAnimationFrame` ×2), and the field's `FormItem` gets a 2-second `ring-amber-400` highlight via a `data-highlight` attribute.

## 5. Save & finalize ordering

```
Finalize click → flush() → (fails → toast, stay) → validateSteps()
  → clean:   POST /finalize { selectedMediaIds }
  → issues:  show list → "Finalize with issues" → PATCH review_notes append → POST /finalize
Return / Reopen click → flush() → existing dialog flow
```

`useAutoSave.flush()` resolves `true` only after the PATCH returns 2xx; while a flush is in flight the action buttons are disabled with a spinner.

## 6. Data & API

No schema changes. `PATCH /api/inspections/[id]` already accepts `formData` (and, after Feature 1, `fieldProvenance`). `review_notes` is appended client-side through the same PATCH. `POST /finalize` unchanged.

## 7. Parity check (pre-delete gate)

`scripts/review-field-parity.ts` extracts every `name="…"` / `render…(“…”)` field path from the old `review-editor.tsx` and asserts each is present in `STEP_FIELDS` (or in the alternative-system step) — the script runs once during implementation and its output is pasted into the PR. Any field the old editor exposed that the wizard hides is added to the relevant step (none are expected).

## 8. Testing

- `step-validation.test.ts`: pill buckets for clean / empty / error states; every `STEP_FIELDS` path maps to exactly one step.
- `review-editor.test.tsx`: renders six sections collapsed with pills; expanding renders the step component; `completed` → `fieldset[disabled]` present and autosave not mounted.
- `finalize-dialog.test.tsx`: flush called before validate; issue list grouped by section; "Finalize with issues" PATCHes `review_notes` then POSTs finalize; clean path skips the list.
- `review-actions.test.tsx` (existing) updated for the dialog; Return/Reopen assert `flush` ordering with a mocked fetch queue.
- `use-auto-save.test.ts`: `flush()` resolves true on 2xx, false on failure, dedupes an in-flight save.
- Playwright: log in as the test admin, open an `in_review` inspection, edit a button-group field in Septic Tank, see `Saved`, finalize with one deliberate issue via the override, confirm status `completed` and PDF download works.

## 9. Rollout

Single PR. Because the old editor is deleted, the PR keeps `git mv` history for the extracted photo/preview pieces. Deploy only with Daniel's explicit approval. Rollback = revert the PR (no migrations).

## 10. Risks

- Step components were written for a single-step layout; six mounted at once (when expanded) is fine for React, but photo galleries in several sections could issue several signed-URL requests at once — acceptable (they already do on the wizard as the tech pages through).
- `fieldset disabled` does not affect elements rendered in portals (Select dropdown content, dialogs); those are gated by the disabled trigger, so no leakage.
