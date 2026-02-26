# Research Summary: Inspection Form Filler

**Domain:** Inspection form digitization with pixel-perfect PDF generation
**Researched:** 2026-02-25
**Overall confidence:** HIGH

## Executive Summary

The Inspection Form Filler project is a well-scoped vertical application: field techs capture inspection data on mobile, office staff reviews and finalizes, and the system produces a pixel-perfect replica of the ADEQ GWS 432 government form as a PDF. The technical challenge is not in the form capture (standard web forms) but in the PDF output fidelity and the end-to-end workflow connecting mobile input to print-ready output.

The recommended stack centers on **Supabase as a unified backend** (database, auth, storage) with **Next.js 16 on Vercel** and **pdfme for PDF generation**. Supabase is the critical simplification decision: instead of managing separate services for Postgres, authentication, and file storage, Supabase bundles all three with Row Level Security that enforces role-based access at the database level. For a 3-5 user app doing 5-15 inspections/month, this architecture is appropriately simple.

The **PDF generation approach is the project's highest-risk technical decision**. pdfme (v5.5.0) supports loading an existing PDF as a `basePdf` background and overlaying text, checkboxes, and images at precise x/y coordinates via JSON schemas. This is exactly the "template overlay" pattern needed for government form replication. The alternative approaches (HTML-to-PDF via Puppeteer, React-to-PDF via @react-pdf/renderer) fundamentally cannot replicate an existing form layout. The risk is in the mapping work: every field on the 7-page ADEQ form must be manually positioned with coordinates. pdfme includes a WYSIWYG Designer component that makes this process visual rather than trial-and-error.

The **Workiz CRM integration is the area of lowest confidence**. The API exists (REST v1 at api.workiz.com) with jobs and leads endpoints, but detailed field-level documentation could not be verified through public sources. The integration requires a paid Developer API add-on. This should be validated early but built last, since the app is fully functional without it (manual data entry as fallback).

## Key Findings

**Stack:** Next.js 16 + Supabase (DB/Auth/Storage) + Drizzle ORM + pdfme + shadcn/ui + React Hook Form/Zod
**Architecture:** Single Next.js app on Vercel with Supabase as unified backend. Server Actions for mutations. pdfme generates PDFs server-side in API routes.
**Critical pitfall:** Choosing the wrong PDF generation approach (HTML-to-PDF or React-to-PDF) will require a complete rewrite. Must use template overlay pattern with the official ADEQ PDF as the base.

## Implications for Roadmap

Based on research, suggested phase structure:

1. **Foundation & Auth** - Set up Next.js 16, Supabase, Drizzle schema, and role-based auth
   - Addresses: Project scaffolding, user roles, database schema
   - Avoids: Building on unstable foundation

2. **Form Input (Mobile-First)** - Build the inspection form UI with all ADEQ GWS 432 sections
   - Addresses: Field tech data capture, form validation, mobile UX
   - Avoids: PDF complexity blocking early progress. Forms work independently.

3. **PDF Generation (Highest Risk)** - Map ADEQ form template, build generation pipeline
   - Addresses: Pixel-perfect PDF output, photo embedding, digital signature
   - Avoids: Premature optimization. Form data is available from Phase 2 to test with.

4. **Review Workflow** - Office staff review, edit, add summaries/recommendations
   - Addresses: Dan's review process, templated language, finalization
   - Avoids: Building review before the data pipeline exists

5. **Storage, Email & Polish** - Cloud storage for reports, email delivery, UX refinements
   - Addresses: Report persistence, customer delivery, edge cases
   - Avoids: Premature delivery features before core is solid

6. **Workiz Integration (Optional)** - Pull customer/job data from Workiz CRM
   - Addresses: Eliminating manual re-entry of customer data
   - Avoids: Dependency on an unverified external API blocking core functionality

**Phase ordering rationale:**
- Auth/DB first because every other feature depends on data persistence and user identity
- Form input before PDF because you need data to generate PDFs, and form UI can be tested independently
- PDF generation as its own phase because it is the highest-risk technical challenge and deserves focused attention
- Review workflow after PDF because Dan needs to see generated output to validate the review process
- Workiz last because it is optional and the app works without it

**Research flags for phases:**
- Phase 3 (PDF Generation): Needs spike/prototype research. Mapping 7 pages of ADEQ fields to pdfme schemas is significant effort. WYSIWYG Designer may accelerate this.
- Phase 6 (Workiz): Needs API investigation. Exact data fields available from jobs/leads endpoints are unverified. Developer API add-on availability on Dan's plan is unknown.
- Phase 1-2: Standard patterns, unlikely to need additional research.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Well-established libraries. Versions verified against official sources. Next.js 16, Supabase, Drizzle all current and actively maintained. |
| Features | HIGH | Requirements are clear and specific. ADEQ form structure is fixed. User count is known. |
| Architecture | HIGH | Standard Next.js + BaaS pattern. Well-documented by Supabase and Vercel. |
| PDF Generation | MEDIUM | pdfme's basePdf overlay concept is verified and correct for this use case. Risk is in execution: mapping 100+ fields across 7 pages to x/y coordinates. |
| Workiz Integration | LOW | API exists but field-level documentation not publicly accessible. Requires Developer API add-on (paid). Data fields returned by jobs/leads endpoints are unverified. |
| Pitfalls | HIGH | PDF generation approach is the critical decision. Other pitfalls are well-documented in the ecosystem. |

## Gaps to Address

- **Workiz API data fields:** Need to enable Developer API add-on and inspect actual API responses to understand what customer/job data is available
- **ADEQ form coordinate mapping:** Need to load the GWS 432 PDF into pdfme Designer and map every field. This is execution work, not research, but is the highest-effort task in the project.
- **Photo embedding in pdfme:** Confirmed pdfme supports image schemas, but need to validate that photos embedded in a 7-page PDF don't cause file size issues
- **Offline capability:** Deferred. If rural Arizona connectivity is a real problem, will need PWA + IndexedDB research later
- **Supabase free tier adequacy:** 500MB DB and 1GB storage should be sufficient for 5-15 inspections/month with photos, but monitor usage

---
*Research summary for: Inspection Form Filler*
*Researched: 2026-02-25*
