# Architecture Research

**Domain:** Inspection form digitization web app (ADEQ GWS 432 property transfer inspections)
**Researched:** 2026-02-25
**Confidence:** HIGH

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                     PRESENTATION LAYER                              │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐           │
│  │ Field Form UI │  │ Review/Edit   │  │ Report Viewer │           │
│  │ (mobile-first)│  │ Dashboard     │  │ & Download    │           │
│  └───────┬───────┘  └───────┬───────┘  └───────┬───────┘           │
│          │                  │                  │                    │
│  ┌───────┴──────────────────┴──────────────────┴───────┐           │
│  │           Shared Components & Form State             │           │
│  │   (react-hook-form + zod + signature pad + uploads)  │           │
│  └──────────────────────┬──────────────────────────────┘           │
├─────────────────────────┼───────────────────────────────────────────┤
│                     API LAYER (Next.js)                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │ Server       │  │ Route        │  │ Middleware    │              │
│  │ Actions      │  │ Handlers     │  │ (Auth guard)  │              │
│  │ (form CRUD)  │  │ (PDF, email) │  │              │              │
│  └──────┬───────┘  └──────┬───────┘  └──────────────┘              │
│         │                 │                                        │
│  ┌──────┴─────────────────┴────────────────────────┐               │
│  │              Service Layer                       │               │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐         │               │
│  │  │ PDF      │ │ Storage  │ │ Workiz   │         │               │
│  │  │ Engine   │ │ Service  │ │ Client   │         │               │
│  │  └──────────┘ └──────────┘ └──────────┘         │               │
│  └─────────────────────────────────────────────────┘               │
├─────────────────────────────────────────────────────────────────────┤
│                     DATA LAYER                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │ Neon/Supabase│  │ Vercel Blob  │  │ Resend       │              │
│  │ (Postgres)   │  │ (photos,PDFs)│  │ (email)      │              │
│  └──────────────┘  └──────────────┘  └──────────────┘              │
├─────────────────────────────────────────────────────────────────────┤
│                     EXTERNAL SERVICES                               │
│  ┌──────────────┐                                                  │
│  │ Workiz API   │                                                  │
│  │ (read-only)  │                                                  │
│  └──────────────┘                                                  │
└─────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| Field Form UI | Mobile-first multi-section form for on-site data capture | Next.js App Router pages with react-hook-form, sectioned into tabs/steps matching ADEQ form sections |
| Review Dashboard | Office staff reviews, edits submissions, writes summaries, triggers PDF generation | Next.js pages with data tables, inline editing, status management |
| Report Viewer | Preview generated PDF, download, trigger email delivery | Embedded PDF viewer or download link with email send action |
| Server Actions | Form CRUD operations (create/read/update inspection records) | Next.js Server Actions for mutations, collocated with routes |
| Route Handlers | Heavy operations: PDF generation, file uploads, email sending, Workiz sync | Next.js Route Handlers (API routes) for stateless request/response operations |
| Auth Middleware | Protect routes by role (admin, tech, office) | NextAuth.js or Clerk middleware, role check on each request |
| PDF Engine | Load ADEQ template, fill fields, embed photos, embed signature, flatten, return buffer | pdf-lib operating on the official GWS 432 PDF template |
| Storage Service | Upload/retrieve photos and completed PDFs | Vercel Blob SDK with private storage for reports, public for non-sensitive assets |
| Workiz Client | Pull customer/property data from Workiz CRM | REST client wrapping Workiz API endpoints for jobs/clients |
| Database | Persist inspection records, user accounts, form state | Postgres via Drizzle ORM or Prisma |
| Email Service | Send completed reports to customers on manual trigger | Resend SDK with PDF attachment |

## Recommended Project Structure

```
src/
├── app/                          # Next.js App Router
│   ├── (auth)/                   # Route group: auth pages
│   │   ├── login/page.tsx
│   │   └── layout.tsx
│   ├── (dashboard)/              # Route group: authenticated pages
│   │   ├── inspections/          # Inspection list & management
│   │   │   ├── page.tsx          # List all inspections
│   │   │   ├── new/page.tsx      # Create new inspection
│   │   │   └── [id]/
│   │   │       ├── page.tsx      # View/edit single inspection
│   │   │       ├── review/page.tsx  # Office review interface
│   │   │       └── report/page.tsx  # Generated PDF view
│   │   ├── layout.tsx            # Dashboard shell with nav
│   │   └── page.tsx              # Dashboard home
│   ├── api/                      # Route Handlers
│   │   ├── pdf/
│   │   │   └── [id]/route.ts     # Generate PDF for inspection
│   │   ├── upload/
│   │   │   └── route.ts          # Photo upload endpoint
│   │   ├── email/
│   │   │   └── [id]/route.ts     # Send report via email
│   │   └── workiz/
│   │       └── sync/route.ts     # Pull data from Workiz
│   ├── layout.tsx                # Root layout
│   └── middleware.ts             # Auth protection
├── components/
│   ├── ui/                       # Base UI components (shadcn/ui)
│   ├── forms/                    # Form-specific components
│   │   ├── facility-info.tsx     # ADEQ Section: Facility Info
│   │   ├── general-treatment.tsx # ADEQ Section: General Treatment
│   │   ├── design-flow.tsx       # ADEQ Section: Design Flow
│   │   ├── septic-tank.tsx       # ADEQ Section: Septic Tank
│   │   ├── disposal-works.tsx    # ADEQ Section: Disposal Works
│   │   ├── alternative-systems.tsx
│   │   ├── photo-upload.tsx      # Photo capture/upload widget
│   │   └── signature-pad.tsx     # Digital signature capture
│   ├── inspection/               # Inspection-level components
│   │   ├── inspection-wizard.tsx # Multi-step form orchestrator
│   │   ├── review-panel.tsx      # Review/edit interface
│   │   └── status-badge.tsx
│   └── layout/                   # Layout components
│       ├── header.tsx
│       ├── nav.tsx
│       └── mobile-nav.tsx
├── lib/                          # Core business logic
│   ├── db/
│   │   ├── schema.ts             # Database schema (Drizzle)
│   │   ├── client.ts             # Database connection
│   │   └── migrations/           # SQL migrations
│   ├── pdf/
│   │   ├── generator.ts          # PDF generation logic
│   │   ├── template.ts           # Template loading & field mapping
│   │   └── field-map.ts          # ADEQ form field ID → data mapping
│   ├── storage/
│   │   └── blob.ts               # Vercel Blob upload/download helpers
│   ├── workiz/
│   │   └── client.ts             # Workiz API client
│   ├── email/
│   │   └── send-report.ts        # Resend email with PDF attachment
│   ├── auth/
│   │   └── config.ts             # Auth configuration
│   └── validators/
│       └── inspection.ts         # Zod schemas for form validation
├── types/
│   └── inspection.ts             # TypeScript types for inspection data
└── templates/
    └── adeq-gws-432.pdf          # The official ADEQ form template
```

### Structure Rationale

- **app/(dashboard)/inspections/:** Routes organized around the primary domain object (inspections), with nested routes for create, view/edit, review, and report -- matching the real workflow.
- **components/forms/:** One component per ADEQ form section because each section has distinct field types (checkboxes vs measurements vs text) and mapping these 1:1 to the official form makes the field mapping to pdf-lib straightforward.
- **lib/pdf/:** Isolated PDF generation logic so it can be tested independently. The field-map.ts file is the critical bridge between app data and PDF form field identifiers -- this will require careful mapping from the actual ADEQ template.
- **lib/ services pattern:** Each external integration (Workiz, Blob, Resend) is wrapped in its own module. Server Actions and Route Handlers call these services -- they never call external APIs directly.

## Architectural Patterns

### Pattern 1: Template-Based PDF Generation with pdf-lib

**What:** Load the official ADEQ GWS 432 PDF as a template, programmatically fill its AcroForm fields, embed photos and signature image, then flatten to produce a non-editable output.

**When to use:** Whenever the output must be a pixel-perfect replica of a government form. This is the core of the entire application.

**Trade-offs:** Requires upfront work to map every form field ID in the template PDF to application data. Once mapped, generation is fast and reliable. Pure JavaScript (no native dependencies like PDFtk), so it works in Vercel serverless functions.

**Example:**
```typescript
// lib/pdf/generator.ts
import { PDFDocument } from 'pdf-lib';
import { getFieldMap } from './field-map';

export async function generateInspectionPdf(
  inspection: InspectionData,
  photos: { url: string; label: string }[],
  signatureDataUrl: string
): Promise<Uint8Array> {
  // 1. Load the ADEQ template
  const templateBytes = await fetch('/templates/adeq-gws-432.pdf')
    .then(res => res.arrayBuffer());
  const pdfDoc = await PDFDocument.load(templateBytes);

  // 2. Get the form and fill fields
  const form = pdfDoc.getForm();
  const fieldMap = getFieldMap(inspection);

  for (const [fieldName, value] of Object.entries(fieldMap)) {
    const field = form.getTextField(fieldName);
    field.setText(value);
  }

  // 3. Handle checkboxes
  if (inspection.septictank.pumpedDuringInspection) {
    form.getCheckBox('pumped_checkbox_id').check();
  }

  // 4. Embed signature image
  const sigBytes = dataUrlToBytes(signatureDataUrl);
  const sigImage = await pdfDoc.embedPng(sigBytes);
  const sigField = form.getButton('signature_field_id');
  sigField.setImage(sigImage);

  // 5. Embed photos on additional pages
  for (const photo of photos) {
    const photoBytes = await fetch(photo.url).then(r => r.arrayBuffer());
    const image = await pdfDoc.embedJpg(photoBytes);
    const page = pdfDoc.addPage();
    page.drawImage(image, { x: 50, y: 400, width: 500, height: 350 });
    page.drawText(photo.label, { x: 50, y: 380, size: 10 });
  }

  // 6. Flatten and return
  form.flatten();
  return pdfDoc.save();
}
```

### Pattern 2: Multi-Step Form Wizard with Client-Side State

**What:** Break the 7-page ADEQ form into logical sections displayed as a multi-step wizard. Use react-hook-form with Zod validation for each step. Persist intermediate state to the database on each step transition so field techs do not lose work if they navigate away.

**When to use:** Complex multi-section forms where filling happens over time (field tech may start on-site, pause, resume later).

**Trade-offs:** More complex state management than a single long form, but far better UX on mobile. Auto-save on step transitions prevents data loss. Requires a "draft" vs "submitted" status model.

**Example:**
```typescript
// components/inspection/inspection-wizard.tsx
'use client';

import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { inspectionSchema } from '@/lib/validators/inspection';
import { saveInspectionDraft } from '@/app/(dashboard)/inspections/actions';

const STEPS = [
  { id: 'facility', label: 'Facility Info', component: FacilityInfo },
  { id: 'treatment', label: 'General Treatment', component: GeneralTreatment },
  { id: 'flow', label: 'Design Flow', component: DesignFlow },
  { id: 'septic', label: 'Septic Tank', component: SepticTank },
  { id: 'disposal', label: 'Disposal Works', component: DisposalWorks },
  { id: 'alternative', label: 'Alternative Systems', component: AlternativeSystems },
  { id: 'summary', label: 'Summary & Sign', component: SummaryAndSign },
];

export function InspectionWizard({ inspectionId, initialData }) {
  const [currentStep, setCurrentStep] = useState(0);
  const methods = useForm({
    resolver: zodResolver(inspectionSchema),
    defaultValues: initialData,
  });

  async function handleStepChange(nextStep: number) {
    // Validate current step fields, then auto-save draft
    const currentFields = STEPS[currentStep].fields;
    const valid = await methods.trigger(currentFields);
    if (valid) {
      await saveInspectionDraft(inspectionId, methods.getValues());
      setCurrentStep(nextStep);
    }
  }
  // ...
}
```

### Pattern 3: Client-Side Uploads via Vercel Blob

**What:** Photos are uploaded directly from the client to Vercel Blob storage. The server generates a presigned upload token, the client uploads the file directly (bypassing the 4.5MB serverless function body limit), and the resulting URL is stored in the database linked to the inspection.

**When to use:** Any file upload -- photos from field techs, completed PDFs for storage.

**Trade-offs:** Slightly more complex than server-side upload, but avoids the Vercel serverless 4.5MB request body limit entirely. Photos from phone cameras can easily exceed 4.5MB.

**Example:**
```typescript
// app/api/upload/route.ts
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  const jsonResponse = await handleUpload({
    body,
    request,
    onBeforeGenerateToken: async (pathname) => {
      // Auth check here
      return {
        allowedContentTypes: ['image/jpeg', 'image/png', 'image/heic'],
        maximumSizeInBytes: 20 * 1024 * 1024, // 20MB max per photo
      };
    },
    onUploadCompleted: async ({ blob }) => {
      // Save blob URL to database, linked to inspection
      await db.insert(inspectionPhotos).values({
        inspectionId: extractInspectionId(blob.pathname),
        url: blob.url,
        pathname: blob.pathname,
      });
    },
  });

  return NextResponse.json(jsonResponse);
}
```

## Data Flow

### Primary Data Flows

#### 1. Field Tech Creates Inspection (on-site)

```
Field Tech opens app on phone
    ↓
(Optional) Pull customer data from Workiz
    ↓ GET /api/workiz/sync?jobId=123
Workiz API returns customer name, address, job details
    ↓
Pre-populate Facility Info section
    ↓
Field tech fills each form section (multi-step wizard)
    ↓ Server Action: saveInspectionDraft()
Each step auto-saves to Postgres (status: "draft")
    ↓
Field tech uploads photos
    ↓ Client upload → Vercel Blob (via presigned token)
Photo URLs saved to inspection_photos table
    ↓
Field tech submits inspection
    ↓ Server Action: submitInspection()
Status changes to "submitted"
```

#### 2. Office Staff Reviews and Generates Report

```
Dan opens Review Dashboard
    ↓
Sees list of submitted inspections
    ↓ Server Component fetches from Postgres
Clicks into inspection to review
    ↓
Edits data, writes summary/recommendations
    ↓ Server Action: updateInspection()
Updates saved to Postgres
    ↓
Adds digital signature
    ↓ react-signature-canvas → base64 data URL → saved to DB
    ↓
Clicks "Generate PDF"
    ↓ POST /api/pdf/[id]
Route Handler:
  1. Loads inspection data from Postgres
  2. Loads photos from Vercel Blob
  3. Loads ADEQ template PDF
  4. Fills form fields via pdf-lib field map
  5. Embeds photos on appended pages
  6. Embeds signature image
  7. Flattens form
  8. Uploads completed PDF to Vercel Blob (private)
  9. Saves PDF URL to inspection record
  10. Returns PDF URL
    ↓
PDF displayed in browser / available for download
```

#### 3. Email Delivery (manual trigger)

```
Dan clicks "Send to Customer"
    ↓
Enters/confirms customer email
    ↓ POST /api/email/[id]
Route Handler:
  1. Loads completed PDF from Vercel Blob
  2. Sends via Resend with PDF as attachment
  3. Logs email sent timestamp to inspection record
    ↓
Customer receives email with ADEQ report attached
```

### State Model

```
Inspection Lifecycle:

  [draft] → [submitted] → [in_review] → [completed] → [sent]
     ↑                         │
     └─────────────────────────┘
         (returned for edits)
```

| Status | Who | What happens |
|--------|-----|-------------|
| draft | Field tech | Form partially filled, auto-saved per step |
| submitted | Field tech | All required fields complete, ready for office review |
| in_review | Dan/office | Being reviewed, summaries being written |
| completed | Dan/office | PDF generated, report finalized |
| sent | Dan/office | Email sent to customer |

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 5-15 inspections/month (current) | Monolith is perfect. Single Postgres DB, Vercel Blob, no caching needed. This architecture handles this easily. |
| 50-100 inspections/month | Still fine as-is. Consider adding search/filter to dashboard. Background job queue for PDF generation if it gets slow. |
| 500+ inspections/month | Consider: background PDF generation via Vercel Cron or Inngest. Add pagination to all list views. Consider archiving old inspections to cold storage. |

### Scaling Priorities

1. **First bottleneck: PDF generation time.** Embedding multiple high-res photos into a PDF is CPU-intensive. If it exceeds Vercel's serverless function timeout (default 10s on Hobby, 60s on Pro), move to background generation. At 5-15/month this will not be an issue.
2. **Second bottleneck: Photo storage costs.** Each inspection might have 5-20 photos at 2-5MB each. At 15 inspections/month = ~1.5GB/month of new storage. Vercel Blob handles this fine. Consider image compression (Sharp) before upload to reduce costs and PDF file size.

## Anti-Patterns

### Anti-Pattern 1: Generating PDFs from HTML/CSS

**What people do:** Render an HTML page that looks like the ADEQ form, then use Puppeteer/Playwright to convert it to PDF.

**Why it's wrong:** (1) Pixel-perfect fidelity to a government form is nearly impossible with HTML-to-PDF -- fonts, spacing, and layout drift across renders. (2) Puppeteer requires a headless browser, which needs large serverless function bundles (50MB+) and may not work within Vercel's function size limits. (3) Maintaining CSS that matches a 7-page government form layout is fragile and time-consuming.

**Do this instead:** Use the actual ADEQ PDF as a template with pdf-lib. Fill its existing form fields programmatically. The output is guaranteed to match because you are writing into the original document.

### Anti-Pattern 2: Server-Side Photo Upload Through API Routes

**What people do:** Upload photos through a Next.js API route, buffering the entire file in the serverless function before forwarding to storage.

**Why it's wrong:** Vercel serverless functions have a 4.5MB request body limit. Phone camera photos routinely exceed this. Even if they do not, buffering large files in memory wastes function execution time and can cause timeouts.

**Do this instead:** Use Vercel Blob's client upload pattern. The server only generates a short-lived upload token. The client uploads directly to Blob storage, bypassing the serverless function entirely.

### Anti-Pattern 3: Storing Form State Only in Client Memory

**What people do:** Keep all form data in React state or localStorage, only saving to the database on final submit.

**Why it's wrong:** Field techs are on rural Arizona properties with spotty connectivity. If they lose signal, close the browser, or the phone locks, all data is lost. Hours of on-site work gone.

**Do this instead:** Auto-save each form section to the database on step transition via Server Actions. The form wizard resumes from the last saved state. Treat the database as the source of truth, not the browser.

### Anti-Pattern 4: Putting Everything in Server Actions

**What people do:** Use Server Actions for all backend operations including PDF generation, file uploads, and email sending.

**Why it's wrong:** Server Actions are designed for mutations that result from user interactions (form submissions). They are not well-suited for heavy, long-running operations like PDF generation with multiple image embeds. They also cannot return binary data (like a PDF buffer) to the client.

**Do this instead:** Use Server Actions for form CRUD (save draft, submit, update). Use Route Handlers (API routes) for PDF generation, file upload token generation, and email sending. The rule: internal UI mutations use Server Actions; integration boundaries and binary responses use Route Handlers.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Workiz CRM | REST API client in `lib/workiz/client.ts`. Called from a Route Handler or Server Action when user clicks "Import from Workiz." | API uses token auth. Endpoint: `https://api.workiz.com/api/v1/{token}/...`. Read-only for v1. Must enable Developer API add-on in Workiz Feature Center. Investigate available endpoints early -- API docs are sparse. |
| Vercel Blob | `@vercel/blob` SDK. Client uploads for photos, server-side `put()` for generated PDFs. | Use private storage for completed reports (contains PII). Use folder convention: `inspections/{id}/photos/`, `inspections/{id}/report.pdf`. |
| Resend | `resend` SDK in Route Handler. Send email with PDF blob as attachment. | Free tier: 100 emails/day, 3000/month. More than enough for 5-15 inspections/month. Use React Email for template. |
| Neon/Supabase (Postgres) | Drizzle ORM or Prisma for type-safe queries. Connected via Vercel integration. | Neon recommended for tighter Vercel integration and serverless scaling (auto-suspend on inactivity). Free tier sufficient for this volume. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Form UI ↔ Database | Server Actions (react-hook-form submit → server action → Drizzle → Postgres) | Auto-save on step transitions. Zod validation runs both client-side (instant feedback) and server-side (security). |
| Dashboard ↔ PDF Engine | Route Handler → `lib/pdf/generator.ts` → returns PDF buffer | PDF generation is synchronous in the Route Handler. If it exceeds timeout, move to background job. |
| PDF Engine ↔ Storage | `lib/pdf/generator.ts` fetches photos from Blob URLs, writes completed PDF back to Blob | Generator fetches photos via URL. After generation, uploads result to `inspections/{id}/report.pdf`. |
| Dashboard ↔ Email | Route Handler → `lib/email/send-report.ts` → Resend API | Always manual trigger. Fetches PDF from Blob, attaches to email. Logs timestamp. |
| Dashboard ↔ Workiz | Route Handler or Server Action → `lib/workiz/client.ts` → Workiz REST API | User-initiated sync. Pulls customer name, address, job ID. Pre-fills facility info section. |

## Build Order (Dependencies)

The following build order is driven by component dependencies:

1. **Database schema + Auth** -- Everything depends on these. Define the inspection data model and user roles first.
2. **Form UI (field tech input)** -- The core data capture interface. Can be built and tested with mock data before other services exist.
3. **Photo upload pipeline** -- Depends on Vercel Blob setup. Field techs need this alongside the form.
4. **Review dashboard** -- Depends on form data existing in the database. Build after form UI works.
5. **PDF generation engine** -- Depends on the ADEQ template field mapping (significant upfront work to identify all form field IDs), inspection data in DB, and photos in Blob. This is the highest-complexity, highest-risk component.
6. **Digital signature** -- Can be added to the form UI and review flow at any point, but must exist before PDF generation is finalized.
7. **Workiz integration** -- Nice-to-have data pre-population. Does not block any other component. Build last.
8. **Email delivery** -- Depends on completed PDFs existing. Build last.

**Critical path:** Schema → Form UI → Photo Upload → PDF Engine → Review Dashboard. The PDF engine is the riskiest component because it requires mapping every field in the ADEQ template, and this mapping can only be validated by visual comparison against the official form.

## Sources

- [Vercel Blob Documentation](https://vercel.com/docs/vercel-blob) -- Official, HIGH confidence
- [pdf-lib Official Site](https://pdf-lib.js.org/) -- Official, HIGH confidence
- [PDFtk + Node.js Pixel-Perfect Forms](https://www.fullstack.com/labs/resources/blog/generate-pixel-perfect-pdf-forms-with-pdftk-and-node-js) -- Template overlay pattern reference, MEDIUM confidence
- [Workiz API Documentation](https://developer.workiz.com/) -- Official, MEDIUM confidence (docs are sparse, SPA-only)
- [Workiz API Credentials Help](https://help.workiz.com/hc/en-us/articles/18053137531409-Accessing-your-Workiz-API-credentials) -- Official, HIGH confidence
- [react-signature-canvas](https://www.npmjs.com/package/react-signature-canvas) -- npm, HIGH confidence
- [Resend + Next.js](https://resend.com/nextjs) -- Official, HIGH confidence
- [Next.js Project Structure](https://nextjs.org/docs/app/getting-started/project-structure) -- Official, HIGH confidence
- [Neon for Vercel](https://vercel.com/marketplace/neon) -- Official, HIGH confidence
- [Vercel Serverless Function Limits](https://vercel.com/docs/concepts/solutions/file-storage) -- Official, HIGH confidence
- [Next.js Best Practices 2025](https://dev.to/bajrayejoon/best-practices-for-organizing-your-nextjs-15-2025-53ji) -- Community, MEDIUM confidence

---
*Architecture research for: ADEQ Inspection Form Digitization (SewerTime Septic)*
*Researched: 2026-02-25*
