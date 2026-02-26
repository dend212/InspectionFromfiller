---
phase: 02-inspection-form-input
plan: 02
subsystem: ui, forms
tags: [react-hook-form, zod, wizard, mobile-first, auto-save, adeq, inspection-form]

# Dependency graph
requires:
  - phase: 02-inspection-form-input
    plan: 01
    provides: Zod v4 schemas, TypeScript types, ADEQ constants, CRUD API routes, shadcn/ui components
provides:
  - 5-step inspection wizard shell with single useForm instance and zodResolver
  - Step progress indicator (5 clickable numbered dots)
  - Sticky bottom navigation bar with Back/Next/Submit and save indicator
  - Debounced auto-save hook (useAutoSave) with beforeunload warning
  - Edit page with ownership verification and inspection data loading
  - Step 1: Facility info with property, seller, inspector credentials, qualifications, records
  - Step 2: GP 4.02-4.23 system type checkboxes with Switch toggle for alternative system (FORM-02)
  - Step 3: Design flow calculations with basis and actual flow evaluation
  - Step 4: Multi-tank septic inspection with large tap-friendly deficiency toggle rows
  - Step 5: Disposal works with deficiency toggles, inspector summary, and signature
affects: [02-03-media-capture, 03-pdf-generation, 04-review-workflow]

# Tech tracking
tech-stack:
  added: []
  patterns: [useAutoSave isolated hook with useWatch to prevent full-form re-renders, warn-but-allow validation via trigger() then always advance, zodResolver as any cast for Zod v4 compatibility, multi-tank array rendering based on watched numberOfTanks, large tap-friendly toggle rows for mobile field work]

key-files:
  created:
    - src/hooks/use-auto-save.ts
    - src/components/inspection/inspection-wizard.tsx
    - src/components/inspection/wizard-progress.tsx
    - src/components/inspection/wizard-navigation.tsx
    - src/components/inspection/step-facility-info.tsx
    - src/components/inspection/step-general-treatment.tsx
    - src/components/inspection/step-design-flow.tsx
    - src/components/inspection/step-septic-tank.tsx
    - src/components/inspection/step-disposal-works.tsx
    - src/app/(dashboard)/inspections/[id]/edit/page.tsx
  modified: []

key-decisions:
  - "zodResolver cast to any for Zod v4 compatibility -- Zod v4 output types have optional fields that mismatch react-hook-form's expected required types with defaults"
  - "useAutoSave hook isolates useWatch to prevent full wizard re-renders on every keystroke (Research pitfall #4)"
  - "Warn-but-allow validation: trigger() highlights errors but setCurrentStep always advances regardless of validation result"
  - "Multi-tank support renders 1-3 tank sections dynamically based on watched numberOfTanks value with array auto-expansion"
  - "All tap targets 48px+ minimum height with 56px for deficiency toggle rows -- designed for field use with gloves"

patterns-established:
  - "useAutoSave(form, inspectionId) isolated hook pattern for debounced PATCH saves"
  - "Step component pattern: useFormContext() + FormField for each field, no props needed"
  - "Deficiency toggle row pattern: label + checkbox in min-h-[56px] border row, entire row clickable"
  - "Conditional field sections with border-l-2 border-primary/20 pl-4 visual indicator"

requirements-completed: [FORM-01, FORM-02, FORM-03, FORM-04]

# Metrics
duration: 6min
completed: 2026-02-26
---

# Phase 02 Plan 02: Wizard UI Summary

**5-step mobile-first inspection wizard with auto-save, warn-but-allow validation, alternative system toggle, and tap-friendly deficiency rows matching all ADEQ GWS 432 form sections**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-26T17:49:29Z
- **Completed:** 2026-02-26T17:56:20Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- Complete 5-step wizard covering all ADEQ GWS 432 form sections with 100+ fields rendered as mobile-first form components
- Auto-save on form changes via debounced PATCH with unsaved-changes warning on browser close
- Alternative treatment system fields hidden behind Switch toggle by default (FORM-02)
- Septic tank deficiency checkboxes rendered as large 56px tap-friendly toggle rows for field use with gloves
- Multi-tank support (up to 3 tanks) with dynamic section rendering based on numberOfTanks field
- Inspector credentials pre-filled from saved formData with all ADEQ qualification checkboxes

## Task Commits

Each task was committed atomically:

1. **Task 1: Build wizard shell, progress indicator, navigation, auto-save hook, and edit page** - `b9e1453` (feat)
2. **Task 2: Build all 5 ADEQ form step components with mobile-first fields** - `7db5bf5` (feat)

## Files Created/Modified
- `src/hooks/use-auto-save.ts` - Debounced auto-save hook using useWatch, beforeunload warning, save indicator state
- `src/components/inspection/inspection-wizard.tsx` - Wizard shell with single useForm, zodResolver, step state, auto-save integration
- `src/components/inspection/wizard-progress.tsx` - 5-dot clickable step progress indicator with WCAG 44px targets
- `src/components/inspection/wizard-navigation.tsx` - Sticky bottom Back/Next/Submit bar with save indicator
- `src/components/inspection/step-facility-info.tsx` - Property info, seller, inspector credentials, qualifications, records
- `src/components/inspection/step-general-treatment.tsx` - GP 4.02-4.23 checkboxes, Switch toggle for alternative system
- `src/components/inspection/step-design-flow.tsx` - Design flow calculations with basis and evaluation
- `src/components/inspection/step-septic-tank.tsx` - Multi-tank inspection with tap-friendly deficiency rows
- `src/components/inspection/step-disposal-works.tsx` - Disposal works deficiencies, inspector summary, signature
- `src/app/(dashboard)/inspections/[id]/edit/page.tsx` - Server component loading inspection with ownership verification

## Decisions Made
- Cast `zodResolver(inspectionFormSchema) as any` because Zod v4 schemas produce output types where optional fields remain `T | undefined`, while react-hook-form expects non-optional fields (since defaults fill them). This is a known Zod v4 + @hookform/resolvers interop issue.
- Isolated `useWatch` inside the `useAutoSave` hook rather than in the wizard root component. This prevents the entire wizard from re-rendering on every keystroke -- only the auto-save logic observes changes.
- Implemented warn-but-allow validation by calling `form.trigger(STEP_FIELDS[currentStep])` to highlight errors, then always advancing via `setCurrentStep`. Navigation is never blocked, per CONTEXT.md requirement.
- Multi-tank rendering uses `form.watch("septicTank.numberOfTanks")` to dynamically show 1-3 tank sections, auto-expanding the tanks array when needed.
- All interactive elements use `min-h-[48px]` minimum with deficiency rows at `min-h-[56px]` -- designed for field technicians using phones outdoors, potentially with gloves.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Cast zodResolver to any for Zod v4 type compatibility**
- **Found during:** Task 1 (Wizard shell implementation)
- **Issue:** `zodResolver(inspectionFormSchema)` produced a resolver type incompatible with `useForm<InspectionFormData>` because Zod v4 output types treat `.optional().default()` fields differently than react-hook-form expects.
- **Fix:** Added `as any` cast on the resolver. Runtime behavior is correct -- only the TypeScript types differ.
- **Files modified:** src/components/inspection/inspection-wizard.tsx
- **Verification:** `npx tsc --noEmit` passes, `npm run build` succeeds
- **Committed in:** b9e1453 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Minimal -- type-level cast only, no behavioral change. Known Zod v4 interop issue.

## Issues Encountered
None -- both tasks executed smoothly, build passes on first attempt.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 5 wizard steps render their ADEQ fields, connected to the single useForm instance
- Auto-save persists data to the database on field changes, restoring on reload
- Plan 02-03 (Media Capture) can add photo/video capture to existing step components
- Phase 3 (PDF Generation) has all 100+ form fields ready for template mapping
- Phase 4 (Review Workflow) has the Submit button wired in the wizard navigation

## Self-Check: PASSED

All 10 files verified on disk. Both commit hashes (b9e1453, 7db5bf5) confirmed in git log.

---
*Phase: 02-inspection-form-input*
*Completed: 2026-02-26*
