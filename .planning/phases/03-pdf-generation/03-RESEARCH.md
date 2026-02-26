# Phase 3: PDF Generation - Research

**Researched:** 2026-02-26
**Domain:** Client-side PDF generation with pdfme, signature capture, photo embedding
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Draw-on-screen signature pad (finger/stylus) -- no typed or uploaded signatures
- Signature appears as the final wizard step ("sign and submit" flow)
- Fresh signature drawn each inspection -- no saved/reused signatures
- Signature date auto-fills to today's date -- no date picker
- 2 photos per page, stacked vertically
- Each photo captioned with section label + number (e.g. "Septic Tank Inspection - Photo 1")
- Photos grouped by form section, not chronological
- "Inspection Photos" header at top of first photo page
- "Generate PDF" button on the inspection detail page (not auto-generated on submit)
- In-browser PDF preview before download -- embedded viewer
- PDF can be re-generated anytime after edits (always reflects latest data)
- Client-side generation using pdfme in the browser
- Overlay text on scanned blank form pages (background images from `septic_system_insp_form.pdf`)
- Checkboxes rendered as "X" character at checkbox coordinates
- Clean font (Arial/Helvetica style) for all text fields -- not handwriting font
- Auto-shrink font size to fit fields with limited space (long addresses, etc.)
- Comment overflow handling: if inspector comment text exceeds the form field, place "See Comments" in the field and append a dedicated comments page with full paragraph text
- Blank form source file: `septic_system_insp_form.pdf` (already in project root)
- The filled-in example `Adeq Report1.pdf` can be used as a reference for field positioning
- Comments overflow page should have a proper paragraph area -- not just raw text dump
- PDF page order: form pages -> comments page (if needed) -> photo pages

### Claude's Discretion
- Template format for blank form pages (PNG images vs PDF pages -- whatever pdfme supports best)
- Exact font sizes and positioning coordinates per field
- pdfme template schema design
- Loading states during PDF generation
- Error handling for generation failures

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PDF-01 | System generates a pixel-perfect PDF using the ADEQ GWS 432 form as the base template via pdfme coordinate overlay | pdfme v5 `basePdf` accepts the existing PDF directly (base64/ArrayBuffer/Uint8Array). `schemas: Schema[][]` defines text/image overlays per page with mm coordinates. `dynamicFontSize` handles auto-shrink. |
| PDF-02 | Inspector can digitally sign the completed report (signature captured and placed on form) | react-signature-canvas captures signature as PNG data URL via `toDataURL('image/png')`. pdfme's `image` schema embeds the data URL at the signature position on the form. |
| PDF-03 | Photo pages are appended after the main form pages in the final PDF | pdfme `generate()` accepts multi-element `inputs` array. Photo pages use blank basePdf pages with image schemas for 2-per-page stacked layout. |
| MDIA-03 | Photos are embedded in the final PDF report as appended photo pages | Photos fetched from Supabase Storage as signed URLs, converted to base64 data URLs client-side, then passed to pdfme image schemas on appended pages. |
</phase_requirements>

## Summary

Phase 3 implements client-side PDF generation using **pdfme v5.5.0** to overlay inspection data onto the existing ADEQ GWS 432 blank form PDF. The approach is: load `septic_system_insp_form.pdf` as the `basePdf`, define a `schemas: Schema[][]` template with x/y/width/height coordinates (in mm) for every text field, checkbox, and signature position across the 6 form pages, then call `generate()` with the inspection data as inputs. Signature capture uses **react-signature-canvas** to draw on-screen and export a PNG data URL, which pdfme embeds via its image schema. Photo pages are appended after the form by extending the inputs array with additional pages using a blank basePdf and image schemas.

The blank form `septic_system_insp_form.pdf` has **6 PDF pages** (1 instruction page labeled "PAGE i" + 5 form pages numbered 1-5). The CONTEXT.md references "7-page" which likely counts the SewerTime disclaimer cover page from the filled example `Adeq Report1.pdf` -- but the source blank form itself has 6 pages. The template must define schemas for all 6 pages. Page 1 (instructions) will have no overlays; pages 2-6 (form pages 1-5) contain all the data fields.

The biggest implementation effort is mapping ~100+ form fields to precise mm coordinates across 5 form pages. The pdfme WYSIWYG Designer can accelerate this by allowing visual field placement on the actual form background, but the final template JSON will be large and should be stored as a separate module. A field-mapping utility should translate the Zod schema field names to pdfme template input keys.

**Primary recommendation:** Use pdfme v5.5.0 with the existing 6-page PDF as basePdf, build the template schema using the Designer for visual positioning, capture signatures with react-signature-canvas, and generate everything client-side in the browser.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @pdfme/generator | ^5.5.0 | PDF generation engine | Only lib needed for `generate()` call; works in browser and Node.js |
| @pdfme/common | ^5.5.0 | Shared types and utilities | Required peer dependency for Template, Schema types |
| @pdfme/schemas | ^5.5.0 | Built-in schema plugins (text, image, checkbox, etc.) | Provides text (with dynamicFontSize), image (for signature/photos), checkbox schemas |
| react-signature-canvas | ^1.0.7 | Signature pad capture | React wrapper around signature_pad; toDataURL() outputs PNG data URL; 100% test coverage; TypeScript |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @pdfme/ui | ^5.5.0 | Designer/Viewer/Form UI components | ONLY during template development (Designer for WYSIWYG field positioning). Not needed at runtime for generation. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| @pdfme/generator | pdf-lib directly | pdf-lib is lower-level; pdfme adds template system, font handling, dynamic sizing -- massive time savings |
| react-signature-canvas | signature_pad (vanilla) | react-signature-canvas wraps signature_pad with React API; either works, but the wrapper is more ergonomic in this React app |
| Client-side generation | Server-side generation (API route) | Client-side avoids server load, works offline, simpler architecture. Server-side would be needed only if file sizes cause browser memory issues (unlikely for a 6-page form). |

**Installation:**
```bash
npm install @pdfme/generator @pdfme/common @pdfme/schemas react-signature-canvas
# Dev only (for template design):
npm install --save-dev @pdfme/ui
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── lib/
│   └── pdf/
│       ├── template.ts           # pdfme Template JSON (basePdf + schemas[][])
│       ├── field-mapping.ts      # Maps InspectionFormData -> pdfme inputs object
│       ├── generate-report.ts    # Orchestrates: load data + photos + signature -> generate()
│       ├── photo-pages.ts        # Builds photo page inputs (2 per page, grouped by section)
│       └── comments-page.ts     # Builds overflow comments page if needed
├── components/
│   └── inspection/
│       ├── signature-pad.tsx     # react-signature-canvas wrapper component
│       ├── pdf-preview.tsx       # In-browser PDF viewer (iframe/object with blob URL)
│       └── generate-pdf-button.tsx  # "Generate PDF" button with loading state
└── hooks/
    └── use-pdf-generation.ts     # Hook: loading state, error handling, blob management
```

### Pattern 1: Template as Static JSON Module
**What:** Define the entire pdfme template (basePdf reference + schemas[][]) as a TypeScript module exporting a `Template` object. The basePdf is loaded once as base64 from the static PDF file.
**When to use:** Always -- the form template is fixed and never changes per-inspection.
**Example:**
```typescript
// src/lib/pdf/template.ts
import type { Template } from '@pdfme/common';

// basePdf loaded as base64 string from septic_system_insp_form.pdf
// Can be imported via fetch() at runtime or bundled as a constant
export const ADEQ_TEMPLATE: Template = {
  basePdf: '', // Loaded at runtime via fetch('/septic_system_insp_form.pdf')
  schemas: [
    // Page 1 (instructions) - no schemas, empty array
    [],
    // Page 2 (form page 1) - facility info, inspector info, etc.
    [
      {
        name: 'facilityName',
        type: 'text',
        position: { x: 30, y: 55 },
        width: 160,
        height: 5,
        fontSize: 10,
        dynamicFontSize: { min: 6, max: 10, fit: 'horizontal' },
      },
      // ... 30+ more fields for this page
    ],
    // Pages 3-6 (form pages 2-5) similarly
    // ...
  ],
};
```

### Pattern 2: Field Mapping Layer
**What:** A pure function that transforms `InspectionFormData` (the Zod schema shape) into the flat `Record<string, string>` that pdfme's `inputs` array expects. Handles checkbox -> "X" conversion, enum -> display text, date formatting, etc.
**When to use:** Always -- decouples form data shape from PDF template field names.
**Example:**
```typescript
// src/lib/pdf/field-mapping.ts
import type { InspectionFormData } from '@/types/inspection';

export function mapFormDataToInputs(
  data: InspectionFormData
): Record<string, string> {
  return {
    facilityName: data.facilityInfo.facilityName,
    facilityAddress: data.facilityInfo.facilityAddress,
    facilityCity: data.facilityInfo.facilityCity,
    // Checkbox fields: boolean -> "X" or ""
    hasAdeqCourse: data.facilityInfo.hasAdeqCourse ? 'X' : '',
    isProfessionalEngineer: data.facilityInfo.isProfessionalEngineer ? 'X' : '',
    // Enum fields: map to display text
    septicTankCondition: mapConditionText(data.facilityInfo.septicTankCondition),
    // ... all fields
  };
}
```

### Pattern 3: Photo Page Builder
**What:** A function that takes inspection media records, fetches their image data, groups by section, and builds pdfme page schemas + inputs for the photo appendix. Uses a blank basePdf for photo pages (letter size: 215.9mm x 279.4mm).
**When to use:** When the inspection has photos attached.
**Example:**
```typescript
// src/lib/pdf/photo-pages.ts
export async function buildPhotoPages(
  media: MediaRecord[],
  supabase: SupabaseClient
): Promise<{ schemas: Schema[][]; inputs: Record<string, string>[] }> {
  const photos = media.filter(m => m.type === 'photo');
  const grouped = groupBySection(photos);
  // 2 photos per page, stacked vertically
  // Each page schema: header text + 2 image schemas + 2 caption texts
  // ...
}
```

### Pattern 4: Blob URL Preview
**What:** After `generate()` returns a `Uint8Array`, create a Blob URL and embed it in an `<iframe>` or `<object>` for in-browser preview. Revoke the blob URL on cleanup.
**When to use:** For the in-browser PDF preview requirement.
**Example:**
```typescript
const pdf = await generate({ template, inputs, plugins });
const blob = new Blob([pdf], { type: 'application/pdf' });
const url = URL.createObjectURL(blob);
// Display in iframe
// Cleanup: URL.revokeObjectURL(url)
```

### Anti-Patterns to Avoid
- **Hardcoding field positions inline:** Keep the template schema in a separate module, not scattered across components. The template will be ~500+ lines of JSON and must be maintainable.
- **Converting basePdf to images:** Use the PDF directly as basePdf -- pdfme supports multi-page PDF backgrounds natively. Converting to PNG per page loses quality and increases file size.
- **Generating on the server for basic reports:** Client-side generation avoids API round-trips, server memory pressure, and works offline. Only move to server if PDF exceeds browser memory (~100MB+).
- **Re-fetching photos on every generation:** Cache fetched photo base64 data in component state or a ref during the session.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Text positioning on PDF pages | Manual pdf-lib text drawing with point math | pdfme template schemas with mm coordinates | pdfme handles font embedding, text wrapping, alignment, dynamic sizing |
| Font auto-shrink for long text | Custom font size calculation loop | pdfme `dynamicFontSize: { min, max, fit }` | Built-in feature, tested, handles both horizontal and vertical fitting |
| PDF background overlay | Manual page embedding with pdf-lib | pdfme `basePdf` property (accepts PDF directly) | Automatically layers schemas on top of existing PDF pages |
| Signature drawing UI | Custom canvas touch handling | react-signature-canvas | Handles touch/mouse events, trimming, export, resize -- battle-tested |
| PDF preview in browser | Custom PDF.js viewer | Native browser PDF viewer via `<iframe src={blobUrl}>` | All modern browsers have built-in PDF viewers; zero additional code |
| Photo page layout | Manual image sizing/positioning math | pdfme image schemas with fixed positions | Consistent positioning, handles JPEG/PNG, automatic format handling |

**Key insight:** pdfme's template system eliminates ~80% of the code you'd write with raw pdf-lib. The template is declarative JSON -- no imperative PDF drawing code. The main effort is field coordinate mapping, which the Designer tool handles visually.

## Common Pitfalls

### Pitfall 1: Blank Form Page Count Mismatch
**What goes wrong:** The CONTEXT.md references "7-page ADEQ GWS 432 form" but `septic_system_insp_form.pdf` has exactly 6 PDF pages (PAGE i + pages 1-5). The filled example `Adeq Report1.pdf` has 7 pages because SewerTime prepends a disclaimer cover page.
**Why it happens:** Confusion between the source blank form (6 pages) and the output report which may include a cover page.
**How to avoid:** The basePdf template uses the 6-page `septic_system_insp_form.pdf` as-is. If a SewerTime disclaimer page is desired in the output, it should be prepended as an additional page in the template. Clarify with user during planning.
**Warning signs:** Schema arrays not matching page count; fields appearing on wrong pages.

### Pitfall 2: Coordinate System Units (mm, not points)
**What goes wrong:** Positioning fields using PDF points (72/inch) instead of millimeters.
**Why it happens:** Standard PDF uses points; pdfme uses millimeters. US Letter = 215.9mm x 279.4mm (not 612 x 792 points).
**How to avoid:** All schema positions and dimensions use mm. Use the pdfme Designer tool for visual positioning to avoid manual unit conversion.
**Warning signs:** Fields appearing way off-position, outside page bounds.

### Pitfall 3: pdfme v5 Schema Array Structure
**What goes wrong:** Using v4 keyed-object format instead of v5 array format for schemas.
**Why it happens:** Many examples online show the v4 format. v5 changed schemas from `Record<string, Schema>[]` to `Schema[][]` where each Schema object has a `name` property.
**How to avoid:** Use v5 format: `schemas: [ [{ name: 'field1', type: 'text', ... }], [{ name: 'field2', ... }] ]` where each inner array = one page.
**Warning signs:** TypeScript type errors on template creation; blank pages in output.

### Pitfall 4: Large basePdf Output Size
**What goes wrong:** When generating multiple PDFs or the basePdf is large (~2MB), pdfme may embed the base PDF multiple times in the output.
**Why it happens:** Known issue (#729): `getEmbedPdfPages` embeds the template once per input element. For single-input generation (our case), this is mitigated.
**How to avoid:** Our use case generates ONE report at a time with ONE inputs element for the form pages, so the basePdf is embedded once. Photo pages use a blank basePdf (tiny). Monitor output file size during testing.
**Warning signs:** Generated PDF is unexpectedly large (>10MB for a simple form).

### Pitfall 5: Photo Fetching and Base64 Conversion
**What goes wrong:** Photos from Supabase Storage need to be converted to base64 data URLs before pdfme can embed them. Signed URLs expire and cannot be used directly.
**Why it happens:** pdfme's image schema accepts `data:image/...;base64,...` format, not URLs.
**How to avoid:** Fetch each photo via signed URL, convert to base64 using `fetch()` -> `blob()` -> `FileReader.readAsDataURL()` (or `arrayBuffer()` -> base64 encoding). Do this before calling `generate()`.
**Warning signs:** Blank image placeholders in generated PDF; CORS errors on fetch.

### Pitfall 6: Checkbox Rendering Strategy
**What goes wrong:** Attempting to use pdfme's built-in `checkbox` schema type, which renders a styled checkbox UI element -- not the "X" character overlay the user requested.
**Why it happens:** The user specifically decided on rendering an "X" character at checkbox coordinates, not a styled checkbox graphic.
**How to avoid:** Use a `text` schema at each checkbox coordinate. Input value is `"X"` when checked, `""` when unchecked. Set font to a clean sans-serif, center-aligned, appropriate font size.
**Warning signs:** Checkbox rendering looks different from the original form's checkbox style.

### Pitfall 7: Comments Overflow Detection
**What goes wrong:** Not detecting when comment text exceeds the form field area, resulting in clipped text in the PDF.
**Why it happens:** pdfme will clip text that doesn't fit in the defined width/height, or `dynamicFontSize` may shrink it below readability.
**How to avoid:** Implement a character/line count heuristic to detect overflow before generation. If comments exceed threshold, place "See Comments" in the form field and create a dedicated overflow comments page appended after the form pages.
**Warning signs:** Tiny unreadable text in comment fields; truncated comments.

## Code Examples

### Generate PDF Report (Complete Flow)
```typescript
// src/lib/pdf/generate-report.ts
import { generate } from '@pdfme/generator';
import { text, image, checkbox } from '@pdfme/schemas';
import type { Template } from '@pdfme/common';
import { loadTemplate } from './template';
import { mapFormDataToInputs } from './field-mapping';
import { buildPhotoPages } from './photo-pages';
import { buildCommentsPage } from './comments-page';
import type { InspectionFormData } from '@/types/inspection';
import type { MediaRecord } from '@/components/inspection/media-gallery';

const plugins = { text, image, checkbox };

export async function generateReport(
  formData: InspectionFormData,
  signatureDataUrl: string,
  media: MediaRecord[],
  supabase: SupabaseClient
): Promise<Uint8Array> {
  // 1. Load template with basePdf
  const template = await loadTemplate();

  // 2. Map form data to flat inputs
  const formInputs = mapFormDataToInputs(formData);

  // 3. Add signature image
  formInputs.signatureImage = signatureDataUrl;

  // 4. Check for comment overflow, build overflow page if needed
  const { formInputsWithOverflow, commentsPage } =
    buildCommentsPage(formData, formInputs);

  // 5. Build photo pages
  const photoPages = await buildPhotoPages(media, supabase);

  // 6. Assemble final template and inputs
  // Form pages use basePdf from the ADEQ form
  // Comments + photo pages use blank basePdf
  // Strategy: generate form PDF, then merge with appended pages

  const pdf = await generate({
    template,
    inputs: [formInputsWithOverflow],
    plugins,
    options: {
      font: {
        Helvetica: {
          data: await loadFont('/fonts/Helvetica.ttf'),
          fallback: true,
        },
      },
    },
  });

  return pdf;
}
```

### Signature Pad Component
```typescript
// src/components/inspection/signature-pad.tsx
'use client';

import { useRef, useState } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import { Button } from '@/components/ui/button';

interface SignaturePadProps {
  onSignatureCapture: (dataUrl: string) => void;
}

export function SignaturePad({ onSignatureCapture }: SignaturePadProps) {
  const sigRef = useRef<SignatureCanvas>(null);
  const [isEmpty, setIsEmpty] = useState(true);

  const handleClear = () => {
    sigRef.current?.clear();
    setIsEmpty(true);
  };

  const handleEnd = () => {
    if (sigRef.current && !sigRef.current.isEmpty()) {
      setIsEmpty(false);
      const trimmed = sigRef.current.getTrimmedCanvas();
      const dataUrl = trimmed.toDataURL('image/png');
      onSignatureCapture(dataUrl);
    }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-lg border-2 border-dashed p-1">
        <SignatureCanvas
          ref={sigRef}
          canvasProps={{
            className: 'w-full h-40 touch-none',
          }}
          onEnd={handleEnd}
          penColor="black"
          backgroundColor="rgba(0,0,0,0)" // Transparent background
        />
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleClear}
        >
          Clear Signature
        </Button>
      </div>
    </div>
  );
}
```

### PDF Preview Component
```typescript
// src/components/inspection/pdf-preview.tsx
'use client';

import { useEffect, useState } from 'react';

interface PdfPreviewProps {
  pdfData: Uint8Array | null;
}

export function PdfPreview({ pdfData }: PdfPreviewProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!pdfData) return;
    const blob = new Blob([pdfData], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pdfData]);

  if (!blobUrl) return null;

  return (
    <iframe
      src={blobUrl}
      className="w-full h-[80vh] rounded-lg border"
      title="PDF Preview"
    />
  );
}
```

### Dynamic Font Size for Auto-Shrink Fields
```typescript
// In template schema, for fields like addresses that may overflow:
{
  name: 'facilityAddress',
  type: 'text',
  position: { x: 45, y: 62 },
  width: 80,
  height: 5,
  fontSize: 10,
  dynamicFontSize: {
    min: 6,    // Won't shrink below 6pt
    max: 10,   // Normal size is 10pt
    fit: 'horizontal',  // Shrink to fit width
  },
  fontName: 'Helvetica',
  alignment: 'left',
  verticalAlignment: 'middle',
  fontColor: '#000000',
  backgroundColor: '',
  lineHeight: 1,
  characterSpacing: 0,
}
```

### Checkbox as "X" Text Overlay
```typescript
// Checkbox fields rendered as centered "X" text at checkbox coordinates:
{
  name: 'hasAdeqCourse',
  type: 'text',
  position: { x: 14.5, y: 128 },  // Exact checkbox position on form
  width: 4,
  height: 4,
  fontSize: 10,
  alignment: 'center',
  verticalAlignment: 'middle',
  fontColor: '#000000',
  backgroundColor: '',
  lineHeight: 1,
  characterSpacing: 0,
}
// Input: { hasAdeqCourse: 'X' } or { hasAdeqCourse: '' }
```

### Photo Page Template
```typescript
// Photo pages use a blank basePdf (letter size)
const PHOTO_PAGE_TEMPLATE = {
  basePdf: { width: 215.9, height: 279.4, padding: [10, 10, 10, 10] },
  schemas: [[
    // Header
    { name: 'header', type: 'text', position: { x: 10, y: 10 }, width: 195.9, height: 8, fontSize: 14, alignment: 'center' },
    // Photo 1
    { name: 'photo1', type: 'image', position: { x: 20, y: 25 }, width: 175.9, height: 110 },
    { name: 'caption1', type: 'text', position: { x: 20, y: 137 }, width: 175.9, height: 6, fontSize: 10, alignment: 'center' },
    // Photo 2
    { name: 'photo2', type: 'image', position: { x: 20, y: 150 }, width: 175.9, height: 110 },
    { name: 'caption2', type: 'text', position: { x: 20, y: 262 }, width: 175.9, height: 6, fontSize: 10, alignment: 'center' },
  ]],
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| pdfme v4 keyed schema objects `{ fieldName: { type, position, ... } }` | pdfme v5 array schemas with `name` property `[{ name, type, position, ... }]` | v5.0.0 (2024) | Template structure changed; v4 auto-converts internally |
| readOnlyText, readOnlyImage, readOnlySvg, tableBeta schemas | Removed in v5 | v5.0.0 (2024) | Use standard text/image schemas instead |
| Manual PDF form filling with pdf-lib | Template-based overlay with pdfme | 2023+ | Declarative JSON templates vs imperative code |
| Server-side PDF generation (puppeteer/wkhtmltopdf) | Client-side with pdfme/pdf-lib | 2023+ | No server dependency for generation |

**Deprecated/outdated:**
- pdfme v4 schema format (keyed objects) -- still works (auto-converted) but use v5 array format for new templates
- `readOnlyText`, `readOnlyImage`, `readOnlySvg`, `tableBeta` -- removed in v5
- Utility imports from `@pdfme/schemas` -- moved to `@pdfme/schemas/utils` in v5

## Open Questions

1. **SewerTime Disclaimer Cover Page**
   - What we know: The filled example `Adeq Report1.pdf` (7 pages) has a SewerTime disclaimer as page 1. The blank form `septic_system_insp_form.pdf` (6 pages) does not.
   - What's unclear: Should the generated PDF include a SewerTime disclaimer cover page? This would make it 7 form pages + comments + photos.
   - Recommendation: Ask user during planning. If yes, create a simple blank page with the disclaimer text as a text schema on page 1, shifting form pages to 2-7.

2. **Font Availability**
   - What we know: pdfme requires TTF/OTF font files. The user wants Arial/Helvetica style. Helvetica is a commercial font (not freely bundable). Arial TTF may be available.
   - What's unclear: Which specific free font to bundle. Liberation Sans, Inter, or similar are free Helvetica-alikes.
   - Recommendation: Use a free Helvetica-alike font (Liberation Sans or Inter). Bundle the TTF in `public/fonts/` and load via fetch at generation time.

3. **Template Schema Creation Workflow**
   - What we know: ~100+ fields across 5 form pages need x/y coordinates in mm. The pdfme Designer can help, but the Designer is a runtime UI component, not a build-time tool.
   - What's unclear: Best workflow for creating the initial template -- use the online pdfme Designer at pdfme.com/template-design, or build a temporary dev page with the Designer component?
   - Recommendation: Build a temporary dev-only page (`/dev/template-designer`) that loads the Designer with the blank form as basePdf. Use it to visually place fields, then export the template JSON. This page is not for production.

4. **Multi-Template Generation (Form + Appended Pages)**
   - What we know: pdfme generates a PDF from ONE template + inputs. The form pages use the ADEQ PDF as basePdf; photo/comments pages use blank basePdf. These are different basePdf values.
   - What's unclear: pdfme does not natively support different basePdf per page within a single generate() call.
   - Recommendation: Generate the form PDF and the appended pages (comments + photos) separately, then merge them using pdf-lib (which pdfme already depends on internally via @pdfme/pdf-lib). Alternative: use a single blank basePdf for everything and render the form pages as full-page background images -- but this loses PDF quality. Best approach: two generate() calls + pdf-lib merge.

## Sources

### Primary (HIGH confidence)
- [pdfme GitHub repository](https://github.com/pdfme/pdfme) - v5.5.0 release, package structure, schema types
- [pdfme Getting Started docs](https://pdfme.com/docs/getting-started) - Template structure, generate API, basePdf format
- [pdfme Supported Features](https://pdfme.com/docs/supported-features) - dynamicFontSize, image formats, checkbox/radioGroup schemas
- [pdfme Custom Fonts docs](https://pdfme.com/docs/custom-fonts) - Font loading, TTF support, fallback configuration
- [pdfme Custom Schemas docs](https://pdfme.com/docs/custom-schemas) - Plugin architecture, schema registration
- [pdfme schemas package index.ts](https://github.com/pdfme/pdfme/blob/main/packages/schemas/src/index.ts) - Confirmed available exports: text, image, checkbox, radioGroup, etc.
- [pdfme text types.ts](https://app.unpkg.com/@pdfme/schemas@5.2.4/files/src/text/types.ts) - TextSchema interface with dynamicFontSize, alignment, fontSize, fontColor
- [react-signature-canvas npm](https://www.npmjs.com/package/react-signature-canvas) - API: toDataURL, getTrimmedCanvas, clear; TypeScript support
- [DeepWiki pdfme UI Package](https://deepwiki.com/pdfme/pdfme/2.3-ui-package) - Designer class API, coordinate system (mm), multi-page Schema[][]

### Secondary (MEDIUM confidence)
- [pdfme issue #729](https://github.com/pdfme/pdfme/issues/729) - basePdf embedding performance (open issue, workaround documented)
- [pdfme issue #425](https://github.com/pdfme/pdfme/issues/425) - Multi-page inputs array structure, v5 schema format
- [pdfme discussion #270](https://github.com/pdfme/pdfme/discussions/270) - Multi-page different layouts: confirmed possible with multi-page basePdf
- [BrightCoding pdfme article](http://blog.brightcoding.dev/2026/02/13/pdfme-the-react-pdf-generator-every-developer-needs) - Practical patterns: Web Workers, font preloading, caching

### Tertiary (LOW confidence)
- [pdfme issue #624](https://github.com/pdfme/pdfme/issues/624) - Multiple basePdf per page: unresolved, may require separate generation + merge

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - pdfme v5 well-documented, confirmed schema types (text, image, checkbox), generate API verified from source
- Architecture: HIGH - Template overlay on existing PDF is pdfme's core use case; pattern well-established
- Pitfalls: HIGH - Coordinate units (mm), v5 schema format change, basePdf page count all confirmed from official sources
- Photo embedding: MEDIUM - Photo pages with blank basePdf approach is sound but multi-template merge needs implementation validation
- Signature capture: HIGH - react-signature-canvas -> PNG data URL -> pdfme image schema is a documented workflow

**Research date:** 2026-02-26
**Valid until:** 2026-03-26 (pdfme is stable; v5.5.0 released Nov 2025)
