---
phase: 03-pdf-generation
plan: 01
subsystem: pdf
tags: [pdfme, pdf-generation, template, field-mapping, liberation-sans, form-overlay]

# Dependency graph
requires:
  - phase: 02-inspection-form-input
    provides: InspectionFormData Zod schema with all ADEQ GWS 432 fields, constants for dropdown/checkbox options
provides:
  - pdfme template schema (ADEQ_TEMPLATE_SCHEMAS) with 150+ field coordinates across 6 PDF pages
  - Field mapping function (mapFormDataToInputs) converting InspectionFormData to flat pdfme inputs
  - Comment overflow detection (detectCommentOverflow) with "See Comments" substitution
  - Template loader (loadTemplate) with basePdf + font caching
  - Liberation Sans font files for PDF text rendering
  - Blank ADEQ form PDF in public/ for runtime basePdf loading
affects: [03-pdf-generation, pdf-preview, generate-report]

# Tech tracking
tech-stack:
  added: ["@pdfme/generator", "@pdfme/common", "@pdfme/schemas", "LiberationSans fonts"]
  patterns: ["pdfme v5 Schema[][] template structure", "checkbox as centered X text overlay", "dynamicFontSize for auto-shrink", "per-tank array flattening to tank1_fieldName keys", "comment overflow threshold with See Comments substitution"]

key-files:
  created:
    - src/lib/pdf/template.ts
    - src/lib/pdf/field-mapping.ts
    - public/fonts/LiberationSans-Regular.ttf
    - public/fonts/LiberationSans-Bold.ttf
    - public/septic_system_insp_form.pdf
  modified:
    - package.json
    - package-lock.json

key-decisions:
  - "Liberation Sans as Helvetica-alike font (SIL Open Font License, metrically compatible with Arial)"
  - "Checkbox rendering via text schema with centered X character at 4x4mm boxes"
  - "Per-page header repeaters (taxParcelNumber, dateOfInspection, initials) as separate schema names per page"
  - "Comment overflow threshold at 200 characters with See Comments substitution"
  - "Factory helper functions (textField, checkbox, multilineField) for DRY schema definitions"
  - "Schema type is passthrough (z.core.$loose) so plugin-specific props (fontSize, fontName, etc.) are accepted"

patterns-established:
  - "Pattern: pdfme schema factory helpers (textField, checkbox, multilineField) for consistent field creation"
  - "Pattern: field-mapping layer decouples InspectionFormData shape from pdfme input keys"
  - "Pattern: boolean -> boolToX(), enum -> enumToX() for checkbox/radio mapping"
  - "Pattern: per-tank array flattening as tank{N}_fieldName for multi-tank support"

requirements-completed: [PDF-01]

# Metrics
duration: 6min
completed: 2026-02-26
---

# Phase 3 Plan 01: PDF Template & Field Mapping Summary

**pdfme template with 150+ field schemas across 6 ADEQ form pages, field-mapping layer transforming InspectionFormData to flat pdfme inputs with checkbox/radio/overflow handling**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-26T22:18:43Z
- **Completed:** 2026-02-26T22:24:57Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Installed pdfme v5 runtime packages (@pdfme/generator, @pdfme/common, @pdfme/schemas)
- Created comprehensive pdfme template schema covering all 6 PDF pages with 150+ fields including text fields, checkbox overlays, multiline comment areas, and signature image
- Built field-mapping layer that converts every InspectionFormData field to flat pdfme inputs with proper type transformations (bool->X, enum->checkbox, array->flattened keys)
- Added Liberation Sans font files (regular + bold) as free Helvetica-alike for PDF rendering
- Implemented comment overflow detection with 200-char threshold and "See Comments" substitution

## Task Commits

Each task was committed atomically:

1. **Task 1: Install pdfme packages and download Liberation Sans fonts** - `1506cef` (chore)
2. **Task 2: Create pdfme template schema and field-mapping module** - `9f343ec` (feat)

## Files Created/Modified
- `src/lib/pdf/template.ts` - pdfme Template schema with ADEQ_TEMPLATE_SCHEMAS (6-page Schema[][]) and loadTemplate() with caching
- `src/lib/pdf/field-mapping.ts` - mapFormDataToInputs() and detectCommentOverflow() transforming InspectionFormData to pdfme inputs
- `public/fonts/LiberationSans-Regular.ttf` - Regular weight font for PDF body text
- `public/fonts/LiberationSans-Bold.ttf` - Bold weight font for PDF headers
- `public/septic_system_insp_form.pdf` - Blank ADEQ form for runtime basePdf loading
- `package.json` - Added @pdfme/generator, @pdfme/common, @pdfme/schemas dependencies
- `package-lock.json` - Updated lockfile

## Decisions Made
- Used Liberation Sans instead of Inter or other alternatives -- metrically compatible with Arial, familiar form appearance
- Checkbox rendered as "X" text in 4x4mm centered boxes -- matches the original form aesthetic per user decision
- Page header fields (tax parcel, date, initials) duplicated per-page as separate schema names to avoid naming conflicts across pages
- Comment overflow threshold set at 200 characters -- conservative estimate for form field width at 10pt font
- Schema factory helpers (textField, checkbox, multilineField) established as reusable pattern for consistent schema creation
- Font caching at module level to avoid redundant fetches on repeated PDF generation

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- pdfme's antd transitive dependency causes type errors in node_modules when running tsc without --skipLibCheck. This is a known issue with antd type declarations and does not affect source code compilation. The project's tsconfig.json already has skipLibCheck: true.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Template schema ready for the pdfme Designer to fine-tune field positions visually (Plan 03-02 or later)
- Field mapping covers every InspectionFormData field -- ready for generate-report.ts orchestration
- Comment overflow detection ready for comments-page.ts overflow page builder
- Font and basePdf loading is cached and reusable by the PDF generation pipeline

## Self-Check: PASSED

All files verified present:
- src/lib/pdf/template.ts
- src/lib/pdf/field-mapping.ts
- public/fonts/LiberationSans-Regular.ttf
- public/fonts/LiberationSans-Bold.ttf
- public/septic_system_insp_form.pdf

All commits verified:
- 1506cef (Task 1)
- 9f343ec (Task 2)

---
*Phase: 03-pdf-generation*
*Completed: 2026-02-26*
