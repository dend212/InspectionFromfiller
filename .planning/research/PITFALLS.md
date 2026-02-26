# Pitfalls Research

**Domain:** Inspection form digitization, pixel-perfect PDF generation, mobile field data collection
**Researched:** 2026-02-25
**Confidence:** HIGH (multiple verified sources across all critical areas)

## Critical Pitfalls

### Pitfall 1: Choosing the Wrong PDF Generation Strategy for Serverless

**What goes wrong:**
Teams pick Puppeteer/headless Chrome for pixel-perfect PDF generation, then discover it cannot run on Vercel. Chromium alone is ~280 MB uncompressed, exceeding Vercel's 250 MB function bundle limit. Even with `@sparticuz/chromium-min` (~45 MB compressed), cold starts take 5-15 seconds and memory usage spikes during rendering. The alternative -- HTML-to-PDF services -- introduce external dependencies and recurring costs for a low-volume app (5-15 inspections/month).

**Why it happens:**
Puppeteer is the most commonly recommended tool for "pixel-perfect" PDF rendering because it leverages a real browser engine. Developers default to it without considering the serverless constraint. The ADEQ GWS 432 form is a fixed-layout government document with exact checkbox positions, table grids, and measurement fields -- it looks like something that needs a browser to render, but it actually needs a template overlay approach instead.

**How to avoid:**
Use `pdf-lib` to load the original ADEQ PDF as a template and draw text/checkmarks directly onto it at exact coordinates. This approach:
- Runs in pure JavaScript (no binary dependencies, ~200 KB)
- Works perfectly in Vercel serverless functions
- Guarantees pixel-perfect output because the base form IS the original government PDF
- Avoids all HTML-to-PDF rendering inconsistencies

The ADEQ form was created with PyPDF2 and has AcroForm fields (per `pdfinfo` analysis of the actual `Adeq Report1.pdf`). However, the form fields have a structural issue ("Syntax Error: Can't get Fields array"), so the safest approach is coordinate-based text drawing onto the loaded template pages rather than relying on form field names.

**Warning signs:**
- Exploring Puppeteer, Playwright, or headless Chrome early in development
- Investigating HTML/CSS layout to replicate the ADEQ form visually
- Bundle size warnings during Vercel deployment
- Function timeout errors during PDF generation

**Phase to address:**
Phase 1 (Foundation/PDF Engine). This is a make-or-break architectural decision. Validate the pdf-lib template overlay approach with a single page of the ADEQ form before building anything else.

---

### Pitfall 2: Vercel's 4.5 MB Request/Response Body Limit Blocking PDF Delivery

**What goes wrong:**
The generated PDF (7 pages with embedded photos) exceeds Vercel's hard 4.5 MB limit on serverless function request/response bodies. Photos from phone cameras are typically 3-12 MB each. Even with compression, a report with 4-8 photos embedded can easily produce a 10-30 MB PDF. The API route that generates the PDF returns a 413 `FUNCTION_PAYLOAD_TOO_LARGE` error. Separately, photo uploads from the field also hit this limit.

**Why it happens:**
Developers build the "generate PDF" endpoint as a serverless function that returns the PDF directly in the response body. This works in development with small test files but fails in production with real inspection photos.

**How to avoid:**
Never pass large files through Vercel function bodies. Instead:
1. Upload photos directly from the client to cloud storage (e.g., Vercel Blob, S3, or Supabase Storage) using presigned URLs -- the upload bypasses the serverless function entirely
2. Generate the PDF in the serverless function by fetching photos from storage (within the function's 2-4 GB memory limit)
3. Write the finished PDF to cloud storage
4. Return only a download URL (a few bytes) from the API route
5. Client downloads the PDF directly from storage

**Warning signs:**
- 413 errors in production but not in development
- Using `res.send(pdfBuffer)` or returning PDF bytes directly from API routes
- Photo upload failures on real phone cameras but success with test images
- PDF download failures that correlate with number of photos in the report

**Phase to address:**
Phase 1 (Foundation). Storage architecture must be designed before any file upload or PDF generation features are built.

---

### Pitfall 3: PDF Coordinate Mapping Nightmare (Bottom-Left Origin)

**What goes wrong:**
Teams spend weeks hand-mapping X/Y coordinates for every text field, checkbox, and measurement on a 7-page government form. PDFs use a bottom-left origin coordinate system (opposite of web's top-left), with units in points (1/72 inch). A single misaligned field on the ADEQ form makes the entire report look unprofessional or, worse, gets rejected by the buyer/county.

**Why it happens:**
pdf-lib's `drawText()` uses absolute coordinates. The ADEQ GWS 432 form has hundreds of data points across 7 pages: property info, tank dimensions, liquid levels, scum/sludge thickness, checkboxes for system types, disposal works details, and inspector comments. Manual coordinate mapping is tedious and error-prone, especially with the inverted Y-axis.

**How to avoid:**
1. Build a coordinate mapping tool FIRST: a simple page that loads each PDF page as an image and lets you click to capture coordinates, automatically converting to PDF coordinate space
2. Store all coordinates in a structured config file (JSON/TS), not hardcoded in rendering logic
3. Create a visual overlay preview tool that shows field positions before generating the final PDF -- this catches alignment errors in seconds rather than print-test-adjust cycles
4. Account for font metrics: pdf-lib requires manual line height and text width calculations. Use `font.widthOfTextAtSize()` and `font.heightAtSize()` for precise placement
5. Test with the actual ADEQ form PDF, not a recreation -- alignment must match the real document

**Warning signs:**
- Hardcoded coordinate values scattered across rendering code
- "It looks right on screen" but prints misaligned
- Frequent back-and-forth adjusting individual X/Y values
- No automated visual regression tests for PDF output

**Phase to address:**
Phase 1 (PDF Engine). Build the coordinate mapping tooling before attempting to lay out the full form. This investment pays for itself many times over.

---

### Pitfall 4: iPhone HEIC Photos Breaking the Entire Upload Pipeline

**What goes wrong:**
Field techs use iPhones (nearly 60% of US mobile market). iPhones default to HEIC format, which zero web browsers can display natively and most server-side image libraries cannot process without special configuration. Photos appear as broken images, fail to upload, or crash the image processing pipeline. Worse, the `accept="image/*"` attribute on file inputs accepts HEIC files without warning, giving users no indication anything is wrong until the upload fails.

**Why it happens:**
Developers test with JPEG/PNG files during development. iPhones with "High Efficiency" photo setting (the default since iOS 11) produce HEIC files. The `<input type="file" accept="image/*">` element happily accepts them. Sharp (Next.js image optimization) needs a custom libvips build for HEIC support. pdf-lib cannot embed HEIC images.

**How to avoid:**
1. Convert HEIC to JPEG on the client side before upload using `heic2any` or `heic-convert`. Be aware `heic2any` is ~2.7 MB -- lazy-load it only when a HEIC file is detected
2. Alternatively, use the `capture="environment"` attribute on mobile to force the camera app, which typically outputs JPEG regardless of phone settings
3. Add server-side validation that rejects non-JPEG/PNG files with a clear error message
4. Compress images client-side before upload (phone photos are 3-12 MB; PDF embedding needs at most 300-500 KB per photo for print quality at form size)
5. Test the entire pipeline with real iPhone photos from the start, not stock images

**Warning signs:**
- Upload works in development/desktop but fails for field techs
- Blank or broken photo thumbnails in the review interface
- PDF generation crashes with "unsupported image format" errors
- File sizes from uploads are unexpectedly large (HEIC is actually smaller than JPEG, so this may indicate no conversion is happening and raw camera output is being stored)

**Phase to address:**
Phase 2 (Mobile Field Interface). Must be solved before field techs use the system. Include HEIC test files in the QA process.

---

### Pitfall 5: Field Data Loss from Poor Mobile Form State Management

**What goes wrong:**
A field tech spends 30-45 minutes filling out an inspection form on-site, then loses all data due to: accidental back-button navigation, browser tab being killed by iOS memory management, phone call interrupting the session, accidentally closing the browser, or losing cell signal before submission. One lost inspection means a return trip to the property -- a real cost in time, fuel, and customer trust.

**Why it happens:**
Web apps store form state in React component state (memory only). Mobile Safari aggressively kills background tabs to reclaim memory. There is no built-in browser mechanism to reliably prevent all forms of accidental data loss on mobile. The `beforeunload` event is unreliable on iOS Safari. Field techs are working in physically demanding environments (crawling around septic systems) and are not thinking about saving form state.

**How to avoid:**
1. Auto-save form state to `localStorage` or `IndexedDB` on every field change (debounced, ~500ms)
2. On page load, check for saved state and offer to restore it
3. Implement the `beforeunload` warning (imperfect but helps for desktop/some mobile browsers)
4. Use Next.js route change interception to warn before in-app navigation
5. Design the form as a multi-step wizard with explicit "Save Progress" at each section transition, persisting to the database (not just local storage)
6. Show a persistent "unsaved changes" indicator so techs know their data is not yet committed
7. Consider making "save draft to server" the primary action, with "submit for review" as the final step

**Warning signs:**
- Form state stored only in React `useState`/`useReducer`
- No `beforeunload` handler registered
- No draft/auto-save functionality
- Field techs reporting data loss in the first week of use

**Phase to address:**
Phase 2 (Mobile Field Interface). Auto-save must be built into the form architecture from day one, not bolted on later.

---

### Pitfall 6: Ignoring the ADEQ Form's Existing AcroForm Field Structure

**What goes wrong:**
The template PDF (`Adeq Report1.pdf`) contains AcroForm interactive fields, but they have a structural issue ("Syntax Error: Can't get Fields array" per pdfinfo analysis). Developers either try to use the broken form fields (and get inconsistent rendering across PDF viewers) or ignore them and draw text that overlaps with the invisible-but-present field widgets, causing visual artifacts like double-rendered text or unexpected interactive elements in the output PDF.

**Why it happens:**
The ADEQ form was apparently processed with PyPDF2 (per PDF metadata) and the form field array was corrupted in the process. This is a known issue with some PDF processing tools. Developers may not inspect the PDF metadata before building their approach and discover this problem late in development.

**How to avoid:**
1. Strip all AcroForm fields from the template PDF during the build/setup phase (pdf-lib can remove form fields)
2. Use the cleaned PDF as the base template for coordinate-based text drawing
3. Alternatively, obtain a fresh copy of the ADEQ GWS 432 form from https://static.azdeq.gov/forms/ and verify its form fields are intact before deciding on an approach
4. If using form fields: always flatten them after filling to ensure consistent rendering across all PDF viewers (Adobe Reader, Preview, Chrome, etc.)
5. Test the output PDF in at least 3 viewers: Adobe Reader, macOS Preview, and Chrome's built-in PDF viewer

**Warning signs:**
- PDF viewer showing "Syntax Error" messages when opening the template
- Text appearing in the wrong font in some viewers but not others
- Interactive form field prompts appearing in the generated output
- Different appearance between screen and print

**Phase to address:**
Phase 1 (PDF Engine). Resolve the template PDF approach before any form filling logic is built.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Hardcoded PDF coordinates in rendering functions | Fast initial development | Every form layout change requires finding and updating scattered magic numbers; no reuse if adding other form types | Never -- use a coordinate config file from day one |
| Storing photos as base64 in the database | Simple to implement, no external storage needed | Database bloat, slow queries, 4.5 MB Vercel body limit hit immediately, cannot serve images via CDN | Never for this project |
| Skipping image compression on upload | Simpler upload pipeline | 10 MB phone photos create 50+ MB PDFs, storage costs balloon, PDF generation is slow | Never -- compress client-side before upload |
| Using `localStorage` only for offline data | No backend changes needed | 5 MB limit per origin, no structured queries, lost when user clears browser data | MVP only -- migrate to IndexedDB + server drafts |
| Building the full 7-page form as a single component | Faster to build initially | 500+ line component, impossible to test sections independently, poor mobile performance | Never -- section-per-component from the start |
| No PDF visual regression tests | Faster development cycle | Coordinate changes silently break layout; caught only by manual print-and-inspect | MVP only -- add before going live |

## Integration Gotchas

Common mistakes when connecting to external services.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Workiz CRM API | Assuming rich query capabilities. The Workiz API is "very minimal" -- it exposes Jobs, Leads, and Time Off with basic pagination. No property/address search endpoint. No webhook support for real-time sync. | Build a simple "search by client name" that pages through jobs. Cache Workiz data locally. Accept manual entry as the primary path with Workiz as a convenience shortcut. Do NOT make Workiz a hard dependency for creating inspections. |
| Workiz CRM API | Hardcoding against the current API version without error handling. Workiz is a third-party CRM that can change its API without notice. | Wrap all Workiz calls in a service layer with graceful degradation. If the API is down or changes, the app still works -- techs just enter data manually. |
| Cloud Storage (Vercel Blob/S3) | Generating presigned upload URLs with no file type or size validation. Users upload 50 MB video files or non-image files. | Validate file type (JPEG/PNG only) and max size (e.g., 10 MB) both client-side and in the presigned URL policy. |
| Email delivery | Building a custom email sending pipeline with attachments. PDF attachments often exceed email provider limits (10-25 MB). | Use a service like Resend or SendGrid. Send a download link instead of attaching the PDF. Keep the email lightweight. |
| ADEQ OWN System | Trying to auto-submit the inspection form to ADEQ digitally. | The Report of Inspection (ROI) is NOT submitted to ADEQ. It goes from Inspector to Seller to Buyer. The Buyer separately files the Notice of Transfer online. The app only needs to produce the PDF document, not integrate with any government system. |

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Generating PDF synchronously in the API route | Works fine with 1-2 pages, no photos | PDF generation with photo embedding takes 5-30 seconds. Use background job or at minimum configure Vercel function timeout to 60s+ | With 4+ embedded photos (the normal case) |
| Loading all inspection records on the dashboard | Fast with 5 records | Slow page loads, high data transfer | At 100+ inspections (~6-12 months of use) |
| No image CDN/optimization for photo review | Works in development with small images | Review page loads 10+ full-resolution photos (30-80 MB total) | First real inspection with photos |
| Embedding full-resolution photos in PDF | Produces a correct-looking PDF | 50+ MB PDF files, slow generation, email delivery fails, storage costs | Every single real inspection |
| Client-side PDF generation | Avoids serverless limits entirely | Phone browsers have limited memory; generating a 7-page PDF with photos can crash mobile Safari | On the field tech's phone |

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Storing Workiz API token in client-side code | Token exposed, attacker can read all CRM data | Store token in server-side environment variables only. All Workiz calls go through your API routes. |
| No access control on inspection records | Any authenticated user can view/edit any inspection, including competitor information | Implement role-based access: field techs see only their assigned inspections, Dan (admin) sees all. |
| Inspection photos accessible via predictable URLs | Property photos (showing addresses, tank conditions, system defects) are sensitive -- they could be used for property disputes or insurance fraud | Use signed/expiring URLs for photo access. Do not use sequential or guessable storage keys. |
| Digital signature stored as a simple image | Anyone with image access can forge the inspector's signature on fraudulent reports | Store signature with metadata (timestamp, IP, user ID). Consider a signature hash tied to the document content so tampering is detectable. |
| No audit trail on inspection edits | If an inspection is modified after signing, there is no record of what changed or when | Log all edits with timestamp, user, and before/after values. Lock editing after the report is signed and delivered. |

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Replicating the 7-page ADEQ form layout as the mobile input UI | Field techs have to pinch-zoom and scroll through a desktop-designed government form on a phone screen | Design a mobile-optimized wizard UI with large touch targets and one section per screen. The ADEQ form layout is for the OUTPUT PDF only, not the input interface. |
| Requiring all fields before saving | Tech cannot save partial work; if they need to leave and come back, everything is lost | Allow saving incomplete inspections as drafts. Validate completeness only at "Submit for Review" |
| No photo annotation or labeling | Photos arrive at the office with no context. Dan has to guess which photo is the inlet, outlet, distribution box, etc. | Require a label/category when uploading each photo (e.g., "Septic Tank Lid", "Effluent Filter", "Distribution Box") |
| Tiny checkboxes and radio buttons on mobile | Field techs with dirty/gloved hands cannot accurately tap small controls | Use large toggle buttons or segmented controls instead of native HTML checkboxes. Minimum 44px touch targets (Apple HIG). |
| Desktop-first data review for Dan | Dan reviews on desktop but the interface was designed mobile-first | Build the review/edit interface as a responsive layout optimized for desktop, since Dan always reviews in the office |
| No clear indication of form completion status | Techs do not know if they missed required fields until submission fails | Show section-by-section completion indicators (green checkmark vs. red "incomplete") in the navigation |

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **PDF Generation:** Often missing embedded fonts -- verify text renders correctly in Adobe Reader, not just Chrome. Chrome is forgiving; Adobe Reader falls back to default fonts for unembedded fonts.
- [ ] **Photo Embedding:** Often missing EXIF rotation handling -- verify photos are correctly oriented in the PDF. Phone photos carry EXIF orientation metadata that pdf-lib does not automatically apply. Photos will appear rotated 90 degrees.
- [ ] **Digital Signature:** Often missing timestamp and signer identity binding -- verify the signature is tied to the specific document version, not just "an image of Dan's signature pasted on any PDF."
- [ ] **Mobile Form:** Often missing offline recovery -- verify that closing and reopening the browser restores in-progress form data. Test by actually killing the browser process, not just navigating away.
- [ ] **Workiz Integration:** Often missing error handling -- verify the app works when Workiz API is unreachable (network error, API change, expired token). The integration should be a convenience, not a dependency.
- [ ] **Email Delivery:** Often missing large attachment handling -- verify email works with a real 7-page inspection report with photos. Test with the actual PDF size, not a placeholder.
- [ ] **Multi-page PDF:** Often missing page-break logic for variable-length content -- verify that long inspector comments or many photos do not overflow the ADEQ form's fixed page boundaries.
- [ ] **Image Compression:** Often missing quality validation after compression -- verify that compressed photos are still readable and useful in the printed PDF, not blurry artifacts.

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Wrong PDF engine chosen (Puppeteer on Vercel) | HIGH | Rewrite PDF generation layer with pdf-lib. If template overlay approach is used, this is a contained rewrite. If HTML-to-PDF was used, all layout code must be redone. |
| 4.5 MB body limit hit in production | MEDIUM | Move to presigned URL upload pattern. Requires adding cloud storage, updating upload components, and updating PDF generation to fetch from storage. |
| HEIC photos breaking pipeline | LOW | Add heic2any client-side conversion as a middleware step in the upload component. Server-side, add Sharp HEIC support or reject HEIC at the API. |
| Field data loss reported by techs | MEDIUM | Add localStorage auto-save retroactively. Harder if form state is deeply coupled to component hierarchy. Easier if form uses a centralized state (Zustand/React Hook Form). |
| PDF coordinate misalignment discovered after go-live | MEDIUM | Fix coordinates in the config file and re-generate affected reports. Much worse if coordinates are hardcoded throughout rendering functions. |
| Workiz API changes/breaks | LOW | App continues to work with manual data entry. Fix Workiz service layer at leisure. This is why it should not be a hard dependency. |

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Wrong PDF generation strategy | Phase 1: Foundation | Generate a single test page of the ADEQ form with pdf-lib on a deployed Vercel function. If this works, the approach is validated. |
| 4.5 MB body limit | Phase 1: Foundation | Architecture includes cloud storage from the start. No file bytes pass through API route bodies. |
| PDF coordinate mapping difficulty | Phase 1: PDF Engine | Coordinate mapping tool built and tested. All 7 pages of the ADEQ form rendered with correct alignment. |
| AcroForm field corruption in template | Phase 1: PDF Engine | Template PDF cleaned or replaced. Output tested in Adobe Reader, Preview, and Chrome. |
| HEIC photo format | Phase 2: Mobile Field UI | Upload tested with real iPhone HEIC photos. Conversion happens transparently. |
| Field data loss | Phase 2: Mobile Field UI | Auto-save to localStorage implemented. Tested by killing the browser process mid-form. |
| Mobile UX (tiny controls, form layout) | Phase 2: Mobile Field UI | Usability tested on an actual phone with gloved hands or wet fingers. |
| Photo EXIF rotation | Phase 2: Mobile Field UI / Phase 3: Photo Handling | Photos display correctly oriented in both the review interface and the final PDF. |
| Image compression for PDF | Phase 3: Photo Handling | Photos compressed to target size before PDF embedding. Final PDF size under 10 MB for a typical inspection. |
| Workiz API fragility | Phase 4: CRM Integration | App tested with Workiz API returning errors. Graceful fallback to manual entry confirmed. |
| Digital signature integrity | Phase 3: Signatures | Signature bound to document content with timestamp. Editing after signing is blocked or creates a new version. |
| Email delivery with large PDF | Phase 5: Delivery | Real inspection report emailed successfully. Download link approach used if attachment too large. |
| Offline/poor connectivity | Phase 2 (basic) / Future (full PWA) | Basic: auto-save to localStorage. Future: full offline PWA with IndexedDB and background sync. |

## Sources

- [Vercel Functions Limits (official docs)](https://vercel.com/docs/functions/limitations) -- HIGH confidence: 250 MB bundle, 4.5 MB body, 300s default timeout
- [Vercel body size workaround](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions) -- HIGH confidence
- [Deploying Puppeteer on Vercel](https://vercel.com/kb/guide/deploying-puppeteer-with-nextjs-on-vercel) -- HIGH confidence: confirms Puppeteer bundle challenges
- [pdf-lib form filling issues (GitHub)](https://github.com/Hopding/pdf-lib/issues/1076) -- HIGH confidence: form field recognition problems
- [pdf-lib Adobe Reader compatibility (GitHub)](https://github.com/Hopding/pdf-lib/issues/1615) -- HIGH confidence: cross-viewer rendering differences
- [HEIC on the web (Upside Lab)](https://upsidelab.io/blog/handling-heic-on-the-web) -- MEDIUM confidence: zero browser HEIC support, conversion approaches
- [HEIC images in Next.js (GitHub discussion)](https://github.com/vercel/next.js/discussions/30043) -- MEDIUM confidence: Sharp HEIC limitations
- [Workiz PHP SDK (GitHub)](https://github.com/forward-force/workiz) -- MEDIUM confidence: "very minimal" API with Jobs, Leads, Time Off only
- [Workiz API Documentation](https://developer.workiz.com/) -- MEDIUM confidence: REST API at api.workiz.com/api/v1/
- [ADEQ Forms page](https://azdeq.gov/forms) -- HIGH confidence: official form repository
- [ADEQ GWS 432 Instructions](https://static.azdeq.gov/forms/septic_system_insp.pdf) -- HIGH confidence: Report of Inspection not submitted to ADEQ
- [PDFtk and Node.js for pixel-perfect forms](https://www.fullstack.com/labs/resources/blog/generate-pixel-perfect-pdf-forms-with-pdftk-and-node-js) -- MEDIUM confidence
- [Next.js PWA offline support (LogRocket)](https://blog.logrocket.com/nextjs-16-pwa-offline-support/) -- MEDIUM confidence: IndexedDB + service worker patterns
- [Preventing data loss in web forms (Innolitics)](https://innolitics.com/articles/web-form-warn-on-nav/) -- MEDIUM confidence: beforeunload limitations on iOS
- [Next.js unsaved data loss prevention](https://betterprogramming.pub/prevent-route-changes-and-unsaved-data-loss-in-next-js-f93622d73791) -- MEDIUM confidence
- [PDF generation in serverless (DEV Community)](https://dev.to/joyfill/integrating-pdf-generation-into-nodejs-backends-tips-gotchas-3907) -- LOW confidence: general patterns
- [Mobile field data collection best practices (Fulcrum)](https://www.fulcrumapp.com/blog/best-practices-for-creating-mobile-apps-for-data-collection/) -- MEDIUM confidence
- Direct analysis of `Adeq Report1.pdf` via `pdfinfo` and `pdftotext` -- HIGH confidence: confirmed PyPDF2 origin, AcroForm corruption, 7 pages, letter size

---
*Pitfalls research for: Inspection Form Filler (ADEQ GWS 432 digitization)*
*Researched: 2026-02-25*
