---
phase: 02-inspection-form-input
plan: 01
subsystem: api, database, ui
tags: [zod, drizzle, nextjs, adeq, inspection-form, crud-api]

# Dependency graph
requires:
  - phase: 01-foundation-and-authentication
    provides: Supabase auth, Drizzle ORM, profiles/inspections/inspection_media tables, shadcn/ui components, role-based access
provides:
  - Zod v4 schemas for all 5 ADEQ GWS 432 form sections with per-step field paths
  - TypeScript types inferred from Zod schemas (InspectionFormData, FacilityInfo, etc.)
  - ADEQ constant enums (counties, facility types, GP 4.02-4.23 system types, tank materials, disposal types)
  - getDefaultFormValues() function pre-filling SewerTime Septic inspector defaults
  - POST /api/inspections (create draft with pre-filled data)
  - GET /api/inspections (list with role-based filtering)
  - GET /api/inspections/[id] (load with ownership check)
  - PATCH /api/inspections/[id] (auto-save formData + denormalized fields)
  - Inspections list page with draft cards
  - New inspection create-and-redirect page
  - shadcn/ui components: switch, checkbox, textarea, separator
affects: [02-02-wizard-ui, 02-03-media-capture, 03-pdf-generation, 04-review-workflow]

# Tech tracking
tech-stack:
  added: [shadcn/ui switch, shadcn/ui checkbox, shadcn/ui textarea, shadcn/ui separator]
  patterns: [Zod v4 per-section schemas with combined wrapper, STEP_FIELDS for trigger() validation, JWT role decode from session token, denormalized facility columns synced from JSONB on PATCH]

key-files:
  created:
    - src/lib/constants/inspection.ts
    - src/lib/validators/inspection.ts
    - src/types/inspection.ts
    - src/app/api/inspections/route.ts
    - src/app/api/inspections/[id]/route.ts
    - src/app/(dashboard)/inspections/page.tsx
    - src/app/(dashboard)/inspections/new/page.tsx
    - src/components/ui/switch.tsx
    - src/components/ui/checkbox.tsx
    - src/components/ui/textarea.tsx
    - src/components/ui/separator.tsx
  modified: []

key-decisions:
  - "ADEQ form fields mapped from pdftotext extraction of Adeq Report1.pdf -- 5 sections with all subfields including inspector qualifications, records obtained, cesspool check, summary condition ratings"
  - "Section 2 systemTypes stored as string array (multi-select checkboxes) matching all GP 4.02-4.23 types from ADEQ form"
  - "Septic tank data uses per-tank array within septicTankSchema for multi-tank support"
  - "Disposal works deficiencies stored as individual boolean fields matching ADEQ form checkbox items"

patterns-established:
  - "Zod v4 per-section schema pattern: individual section schemas + combined inspectionFormSchema wrapper"
  - "STEP_FIELDS Record<number, string[]> for react-hook-form trigger() per-step validation"
  - "getDefaultFormValues(inspectorName) for FORM-04 pre-fill with INSPECTOR_DEFAULTS"
  - "API route JWT role decoding pattern: Buffer.from(token.split('.')[1], 'base64') for user_role"
  - "Denormalized facility field sync on PATCH: extract from formData.facilityInfo and set on inspections row"

requirements-completed: [FORM-01, FORM-04]

# Metrics
duration: 4min
completed: 2026-02-26
---

# Phase 02 Plan 01: Inspection Data Layer Summary

**Zod v4 schemas for all 5 ADEQ GWS 432 sections, inspection CRUD API with pre-filled inspector defaults, inspections list page with draft cards**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-26T17:41:40Z
- **Completed:** 2026-02-26T17:46:04Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments
- Complete Zod v4 schema coverage for all 5 ADEQ form sections extracted from the official PDF, with nested tank array for multi-tank support
- CRUD API routes with role-based access (field_tech sees own, admin/office sees all), ownership verification, and denormalized field sync
- Inspector info pre-fill on creation via getDefaultFormValues() using INSPECTOR_DEFAULTS + profile name (FORM-04)
- Inspections list page with draft cards showing facility name, city, status badge, and update date
- shadcn/ui components installed for Phase 2 wizard UI (switch, checkbox, textarea, separator)

## Task Commits

Each task was committed atomically:

1. **Task 1: Define Zod schemas, TypeScript types, and ADEQ constants** - `aa93965` (feat)
2. **Task 2: Build inspection CRUD API routes, inspections list page, and new-inspection page** - `654b9fd` (feat)

## Files Created/Modified
- `src/lib/constants/inspection.ts` - ADEQ dropdown options: AZ counties, facility types, GP 4.02-4.23 system types, tank materials, disposal types, inspector defaults
- `src/lib/validators/inspection.ts` - Zod v4 schemas for all 5 sections + combined schema + STEP_FIELDS + getDefaultFormValues()
- `src/types/inspection.ts` - TypeScript types inferred from Zod schemas
- `src/app/api/inspections/route.ts` - POST (create draft) and GET (list) endpoints
- `src/app/api/inspections/[id]/route.ts` - GET (load) and PATCH (auto-save) endpoints
- `src/app/(dashboard)/inspections/page.tsx` - Inspections list with cards, empty state, "New Inspection" button
- `src/app/(dashboard)/inspections/new/page.tsx` - Create draft and redirect to /inspections/[id]/edit
- `src/components/ui/switch.tsx` - shadcn/ui Switch component
- `src/components/ui/checkbox.tsx` - shadcn/ui Checkbox component
- `src/components/ui/textarea.tsx` - shadcn/ui Textarea component
- `src/components/ui/separator.tsx` - shadcn/ui Separator component

## Decisions Made
- ADEQ form field inventory extracted via pdftotext from `Adeq Report1.pdf`. All 5 sections captured with sub-fields including rarely-used inspector qualification checkboxes, records obtained section, cesspool check, and summary condition ratings.
- Section 2 (General Treatment) stores system type selections as a string array (`systemTypes: z.array(z.string())`) to support multi-select checkboxes for GP 4.02 through GP 4.23.
- Septic tank schema uses a `tanks` array within `septicTankSchema` for per-tank inspection data (liquid levels, deficiencies, baffles, etc.), supporting multi-tank properties.
- Disposal works deficiencies stored as individual boolean fields (e.g., `defCrushedOutletPipe`, `defRootInvasion`) matching the ADEQ form checkbox layout for easy rendering as tap-friendly toggle rows.
- String fields used for numeric form values (e.g., `numberOfBedrooms: z.string()`) instead of `z.coerce.number()` to avoid NaN issues with empty fields in the wizard -- coercion will happen at submission time.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Used z.string() instead of z.coerce.number() for numeric fields**
- **Found during:** Task 1 (Schema definition)
- **Issue:** Plan specified `z.coerce.number()` for numeric fields like numberOfBedrooms, flowPerBedroom, etc. However, these fields start empty in the wizard and `z.coerce.number()` on an empty string produces NaN, which fails validation immediately on page load.
- **Fix:** Used `z.string().optional().default("")` for all numeric-like fields. Numeric coercion will be applied at final submission time, not during per-step auto-save.
- **Files modified:** src/lib/validators/inspection.ts
- **Verification:** npx tsc --noEmit passes, default form values work correctly
- **Committed in:** aa93965 (Task 1 commit)

**2. [Rule 2 - Missing Critical] Added ownership verification to PATCH endpoint**
- **Found during:** Task 2 (API route implementation)
- **Issue:** Plan described the PATCH handler but did not mention verifying that the user owns the inspection before allowing saves. Without this, any authenticated user could overwrite another user's inspection data.
- **Fix:** Added ownership check with role-based fallback (admin/office_staff can save any inspection).
- **Files modified:** src/app/api/inspections/[id]/route.ts
- **Verification:** Build passes, endpoint returns 403 for unauthorized access
- **Committed in:** 654b9fd (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 missing critical)
**Impact on plan:** Both auto-fixes essential for correctness and security. No scope creep.

## Issues Encountered
None -- plan executed smoothly.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All Zod schemas and TypeScript types ready for the wizard UI (Plan 02-02) to build against
- API routes ready for auto-save hook (PATCH) and inspection loading (GET)
- Inspections list page ready for field tech dashboard flow
- shadcn/ui Switch, Checkbox, Textarea, Separator installed for wizard step components
- The `/inspections/[id]/edit` page does not exist yet -- Plan 02-02 will create it with the wizard shell

## Self-Check: PASSED

All 8 files verified on disk. Both commit hashes (aa93965, 654b9fd) confirmed in git log.

---
*Phase: 02-inspection-form-input*
*Completed: 2026-02-26*
