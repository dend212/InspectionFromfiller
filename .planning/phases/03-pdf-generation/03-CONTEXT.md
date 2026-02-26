# Phase 3: PDF Generation - Context

**Gathered:** 2026-02-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Generate pixel-perfect ADEQ GWS 432 form PDFs from inspection data using pdfme coordinate overlay on the blank form. Includes digital signature capture and appended photo pages. The review workflow (Phase 4) and delivery/storage (Phase 5) are separate phases.

</domain>

<decisions>
## Implementation Decisions

### Signature Capture
- Draw-on-screen signature pad (finger/stylus) — no typed or uploaded signatures
- Signature appears as the final wizard step ("sign and submit" flow)
- Fresh signature drawn each inspection — no saved/reused signatures
- Signature date auto-fills to today's date — no date picker

### Photo Page Layout
- 2 photos per page, stacked vertically
- Each photo captioned with section label + number (e.g. "Septic Tank Inspection - Photo 1")
- Photos grouped by form section, not chronological
- "Inspection Photos" header at top of first photo page

### PDF Preview & Trigger
- "Generate PDF" button on the inspection detail page (not auto-generated on submit)
- In-browser PDF preview before download — embedded viewer
- PDF can be re-generated anytime after edits (always reflects latest data)
- Client-side generation using pdfme in the browser

### Form Fidelity
- Overlay text on scanned blank form pages (background images from `septic_system_insp_form.pdf`)
- Checkboxes rendered as "X" character at checkbox coordinates
- Clean font (Arial/Helvetica style) for all text fields — not handwriting font
- Auto-shrink font size to fit fields with limited space (long addresses, etc.)
- Comment overflow handling: if inspector comment text exceeds the form field, place "See Comments" in the field and append a dedicated comments page with full paragraph text

### Claude's Discretion
- Template format for blank form pages (PNG images vs PDF pages — whatever pdfme supports best)
- Exact font sizes and positioning coordinates per field
- pdfme template schema design
- Loading states during PDF generation
- Error handling for generation failures

</decisions>

<specifics>
## Specific Ideas

- Blank form source file: `septic_system_insp_form.pdf` (7-page ADEQ GWS 432 blank form, already in project root)
- The filled-in example `Adeq Report1.pdf` can be used as a reference for field positioning
- Comments overflow page should have a proper paragraph area — not just raw text dump
- PDF page order: 7 form pages → comments page (if needed) → photo pages

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-pdf-generation*
*Context gathered: 2026-02-26*
