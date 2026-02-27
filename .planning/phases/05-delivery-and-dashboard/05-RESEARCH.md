# Phase 5: Delivery and Dashboard - Research

**Researched:** 2026-02-26
**Domain:** Cloud storage, email delivery, dashboard UI, search/filtering
**Confidence:** HIGH

## Summary

Phase 5 adds four capabilities to the existing inspection app: (1) automatic PDF storage to Supabase Storage when an inspection is finalized, (2) manual one-click email delivery of the PDF to a customer via Resend, (3) a table-based dashboard showing all inspections with status badges, and (4) a search box plus status tab filters for finding past inspections. The existing codebase already has the full stack in place -- Supabase Storage bucket (`inspection-media`), Resend email integration, Drizzle ORM queries, shadcn/ui Table component, and a `"sent"` status in the inspection enum. The work is primarily wiring existing building blocks together with new UI components.

The database needs two additions: a `customer_email` column on inspections (for pre-filling the email dialog and tracking who to send to) and an `inspection_emails` table for send history tracking. The `sellerName` field from `formData.facilityInfo.sellerName` serves as the customer name. Search across JSONB fields requires raw SQL via Drizzle's `sql` operator since `sellerName` lives inside the `formData` JSONB column rather than a top-level column.

**Primary recommendation:** Use the existing Supabase admin client for server-side PDF upload, Resend with base64 Buffer attachments for email delivery, URL-based searchParams for server-component search/filtering, and the existing shadcn/ui Table primitives for the dashboard layout.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Email Delivery Flow**: Clicking "Send to Customer" opens a confirmation dialog (not a full compose screen). Dialog shows: recipient email, subject line, and email preview before sending. Email body uses a standard professional template with an optional editable personal note field. Recipient email is pre-filled from the inspection record if available, but always editable at send time. Send history is tracked per inspection -- Dan can see when emails were sent and to whom. Emails are never sent automatically -- always requires explicit button click + confirmation.
- **Dashboard Layout**: Table/list layout -- rows with columns, not cards. Columns: Address, Date, Customer Name, Status, Inspector, Sent/Delivered. Status displayed as colored badges: Draft = gray, In Review = yellow/amber, Complete = green. Default sort order: newest inspections first. Clickable column headers for re-sorting.
- **Search & Filtering**: Single search box that searches across address, customer name, and date. Real-time filtering as Dan types (table updates live). Tab-style status filters above the table: All | Draft | In Review | Complete. Status tabs work alongside text search (combinable).
- **PDF Storage & Downloads**: PDF automatically saved to Supabase Storage when inspection is finalized (marked complete). Downloaded filenames use address + date format (e.g., "123-Main-St_2026-02-26.pdf"). Download button available both on dashboard table rows and inside inspection detail view. If a completed inspection is edited and re-finalized, old PDF is replaced with newly generated one.

### Claude's Discretion
- Empty search state design (message + clear button approach or similar)
- Email subject line default template text
- Exact table pagination or infinite scroll for large datasets
- Loading states and error handling patterns
- Column width proportions and responsive behavior

### Deferred Ideas (OUT OF SCOPE)
- Workiz CRM integration for pre-filling customer email and address -- v2 (INTG-01, INTG-02)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DLVR-01 | Completed reports saved to cloud storage (Supabase Storage) | Supabase Storage upload via admin client with upsert; signed URL download; finalize route integration |
| DLVR-02 | Manual email delivery of finished PDF to customer (button trigger, never automatic) | Resend attachments API with base64-encoded Buffer; confirmation dialog pattern; send history table |
| DLVR-03 | Dashboard listing all inspections with status (draft, in review, complete) | shadcn/ui Table component; server-component data fetching; status badge coloring; column sort via searchParams |
| DLVR-04 | Search past inspections by address, date, or customer name | Drizzle `ilike` + `or` for top-level columns; `sql` operator for JSONB sellerName; URL searchParams for server-side filtering |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @supabase/supabase-js | ^2.97.0 | Storage upload/download/signed URLs | Already in project; admin client pattern established |
| resend | ^6.9.2 | Email delivery with PDF attachments | Already in project; send-notification.ts pattern established |
| drizzle-orm | ^0.45.1 | Database queries with search/filter | Already in project; ilike, or, and, sql operators built in |
| next | 16.1.6 | Server components, async searchParams, API routes | Already in project; searchParams is Promise in Next.js 16 |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lucide-react | ^0.575.0 | Icons (Download, Mail, Search, ArrowUpDown) | Dashboard table icons, action buttons |
| sonner | ^2.0.7 | Toast notifications for send success/failure | After email send, download errors |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| URL searchParams for search | Client-side state (useState) | searchParams gives shareable URLs, server-side filtering, SSR compatibility; client state would be simpler but loses URL persistence |
| Supabase Storage for PDFs | S3/Cloudflare R2 | Supabase already configured, bucket exists, no new infrastructure needed |
| Resend for email | Nodemailer + SMTP | Resend already integrated, simpler API, already handles deliverability |

**Installation:**
No new packages needed. All dependencies are already in `package.json`.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── app/
│   ├── (dashboard)/
│   │   ├── inspections/
│   │   │   └── page.tsx              # REPLACE: card grid -> table with search/filter
│   │   └── page.tsx                  # UPDATE: add dashboard stats or redirect
│   └── api/
│       └── inspections/
│           └── [id]/
│               ├── finalize/route.ts  # UPDATE: add PDF upload to Supabase Storage
│               ├── send-email/route.ts # NEW: email delivery endpoint
│               └── emails/route.ts    # NEW: GET send history for inspection
├── components/
│   ├── dashboard/
│   │   ├── inspections-table.tsx      # NEW: table with sort, status badges
│   │   ├── search-bar.tsx            # NEW: search input with debounce
│   │   ├── status-tabs.tsx           # NEW: All | Draft | In Review | Complete
│   │   └── send-email-dialog.tsx     # NEW: confirmation dialog for email
│   └── ui/
│       └── table.tsx                 # EXISTING: shadcn/ui Table primitives
├── lib/
│   ├── db/
│   │   ├── schema.ts                 # UPDATE: add customer_email, inspection_emails table
│   │   └── migrations/
│   │       └── 0005_delivery_dashboard.sql # NEW: schema changes
│   └── storage/
│       └── pdf-storage.ts            # NEW: upload/download/signed-url helpers
└── types/
    └── inspection.ts                 # UPDATE: add email-related types
```

### Pattern 1: PDF Upload on Finalize (Server-Side)
**What:** When the finalize API route transitions status to "completed", generate the PDF server-side and upload to Supabase Storage using the admin client.
**When to use:** Every time an inspection is finalized or re-finalized.
**Example:**
```typescript
// Source: Supabase Storage docs + existing admin.ts pattern
import { createAdminClient } from "@/lib/supabase/admin";

async function uploadPdfToStorage(
  inspectionId: string,
  pdfBuffer: Uint8Array,
  filename: string
): Promise<string> {
  const admin = createAdminClient();
  const storagePath = `reports/${inspectionId}/${filename}`;

  const { error } = await admin.storage
    .from("inspection-media")  // reuse existing bucket
    .upload(storagePath, pdfBuffer, {
      contentType: "application/pdf",
      upsert: true,  // replaces old PDF on re-finalize
    });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  return storagePath;
}
```

### Pattern 2: Signed URL for PDF Download
**What:** Generate time-limited signed URLs for downloading PDFs from the private bucket.
**When to use:** When user clicks download button on dashboard row or detail view.
**Example:**
```typescript
// Source: Supabase Storage docs
import { createAdminClient } from "@/lib/supabase/admin";

async function getDownloadUrl(storagePath: string): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from("inspection-media")
    .createSignedUrl(storagePath, 3600, {
      download: true,  // triggers browser download instead of inline display
    });

  if (error) throw new Error(`Signed URL failed: ${error.message}`);
  return data.signedUrl;
}
```

### Pattern 3: Email with PDF Attachment via Resend
**What:** Send the finalized PDF as an email attachment using Resend's attachments array.
**When to use:** When Dan clicks "Send to Customer" and confirms in the dialog.
**Example:**
```typescript
// Source: Resend API reference (attachments docs)
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY!);

async function sendInspectionEmail(
  to: string,
  subject: string,
  bodyText: string,
  pdfBuffer: Buffer,
  filename: string
) {
  const { data, error } = await resend.emails.send({
    from: "SewerTime Inspections <onboarding@resend.dev>",
    to: [to],
    subject,
    text: bodyText,
    attachments: [
      {
        content: pdfBuffer.toString("base64"),
        filename,
      },
    ],
  });

  if (error) throw new Error(`Email send failed: ${error.message}`);
  return data;
}
```

### Pattern 4: Server-Side Search with URL SearchParams
**What:** Use Next.js async `searchParams` prop to pass search/filter state to server component, query with Drizzle conditional filters.
**When to use:** Dashboard table with search box and status tabs.
**Example:**
```typescript
// Source: Next.js 16 docs + Drizzle conditional filters docs
import { ilike, or, and, eq, desc, sql } from "drizzle-orm";

export default async function InspectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; sort?: string; order?: string }>;
}) {
  const { q, status, sort, order } = await searchParams;

  const results = await db
    .select()
    .from(inspections)
    .where(
      and(
        // Status filter (undefined = all)
        status ? eq(inspections.status, status) : undefined,
        // Text search across multiple columns
        q
          ? or(
              ilike(inspections.facilityAddress, `%${q}%`),
              ilike(inspections.facilityCity, `%${q}%`),
              ilike(inspections.facilityName, `%${q}%`),
              // JSONB field search for sellerName (customer name)
              sql`${inspections.formData}->>'facilityInfo'->>'sellerName' ILIKE ${'%' + q + '%'}`,
            )
          : undefined,
      ),
    )
    .orderBy(
      sort === "date" ? (order === "asc" ? inspections.createdAt : desc(inspections.createdAt))
      : desc(inspections.updatedAt)
    );
}
```

### Pattern 5: Client-Side Search with URL Updates (Debounced)
**What:** Client component updates URL searchParams on input change with debounce, triggering server re-render.
**When to use:** The search bar component.
**Example:**
```typescript
// Source: Next.js learn/dashboard-app search pattern
"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useRef } from "react";

export function SearchBar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const timeoutRef = useRef<NodeJS.Timeout>();

  const handleSearch = useCallback(
    (term: string) => {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        const params = new URLSearchParams(searchParams.toString());
        if (term) {
          params.set("q", term);
        } else {
          params.delete("q");
        }
        router.replace(`${pathname}?${params.toString()}`);
      }, 300); // 300ms debounce
    },
    [router, searchParams, pathname],
  );
}
```

### Anti-Patterns to Avoid
- **Client-side PDF generation for storage:** The finalize route should generate the PDF server-side and upload directly. Do NOT generate on client, send to API, then upload -- this adds unnecessary round trips and fails for large PDFs.
- **Storing PDF as base64 in database:** PDFs belong in Supabase Storage (object storage), not in the `formData` JSONB column or any database text field.
- **Automatic email sending on finalize:** CONTEXT.md explicitly locks this: emails are NEVER sent automatically. Always requires explicit button click + confirmation.
- **Client-side search filtering:** With 50+ inspections, filtering should happen at the database level, not by fetching all records and filtering in the browser.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PDF cloud storage | Custom file server or S3 integration | Supabase Storage (existing bucket) | Already configured, RLS policies in place, signed URLs built in |
| Email delivery | SMTP client, custom mail server | Resend SDK (already in project) | Handles deliverability, bounce tracking, rate limiting, templates |
| Table sorting/filtering | Custom sort algorithm in JS | SQL ORDER BY + Drizzle operators | Database is already indexed, handles any dataset size |
| Search debouncing | Custom debounce utility | setTimeout ref pattern | Standard React pattern, no extra dependencies |
| File download naming | Manual Content-Disposition header | Supabase signed URL download option | Built-in download parameter handles browser download behavior |

**Key insight:** Every piece of this phase's functionality is a standard integration of existing tools. The Supabase bucket, Resend client, Drizzle ORM, and shadcn Table are all already installed and configured. The work is composition, not creation.

## Common Pitfalls

### Pitfall 1: PDF Generation on Finalize Requires Server-Side Execution
**What goes wrong:** The current PDF generation (`generateReport`) runs client-side via `usePdfGeneration` hook. Calling it from an API route requires that all dependencies (pdfme, fonts, template loading) work in Node.js, not just the browser.
**Why it happens:** pdfme's `generate()` function and font loading were originally designed for client-side use in this project.
**How to avoid:** The `generateReport` function in `src/lib/pdf/generate-report.ts` already uses standard imports (no DOM APIs) and should work server-side. Test this early. If the template loads fonts from filesystem paths, those paths must be accessible from the API route's execution context (they should be, since Next.js API routes run in Node.js).
**Warning signs:** "Cannot find module" errors, font loading failures, or `window is not defined` errors in the finalize route.

### Pitfall 2: JSONB Search Requires Raw SQL in Drizzle
**What goes wrong:** Drizzle's `ilike()` operator works on column types but the customer name (`sellerName`) is nested inside the `formData` JSONB column at `formData.facilityInfo.sellerName`. Using `ilike(inspections.formData, ...)` will not work.
**Why it happens:** JSONB fields are opaque to Drizzle's type system -- you need PostgreSQL's JSON operators (`->>`, `#>>`, or `jsonb_extract_path_text`).
**How to avoid:** Use Drizzle's `sql` template literal for the JSONB search portion:
```typescript
sql`${inspections.formData} #>> '{facilityInfo,sellerName}' ILIKE ${'%' + query + '%'}`
```
Alternatively, extract sellerName to a top-level `customer_name` column during save (denormalization) for simpler queries. The denormalization approach is recommended since it avoids JSONB query complexity and enables proper indexing.
**Warning signs:** Search by customer name returns zero results despite matching data existing.

### Pitfall 3: Supabase Storage Upload Size and Content-Type
**What goes wrong:** Upload succeeds but download serves garbled content, or file is too large.
**Why it happens:** Missing `contentType: "application/pdf"` in upload options, or Buffer/Uint8Array conversion issues.
**How to avoid:** Always specify `contentType: "application/pdf"` and ensure the `pdfBuffer` is a proper `Uint8Array` or `Buffer`. The existing `generateReport` returns `Uint8Array`, which is compatible with Supabase's upload.
**Warning signs:** Downloaded PDF won't open, shows as corrupt, or has wrong MIME type.

### Pitfall 4: Resend Attachment Size Limit (40MB after base64)
**What goes wrong:** Email send fails silently or returns error for inspections with many photos.
**Why it happens:** Base64 encoding increases file size by ~33%. A 30MB PDF becomes ~40MB in base64, hitting Resend's limit.
**How to avoid:** Most ADEQ reports with photos will be 2-10MB. Add a check before sending: if base64 size exceeds 35MB, show an error suggesting the user download and send manually. Log the actual PDF size for monitoring.
**Warning signs:** Email send returns error for photo-heavy inspections but works for simple ones.

### Pitfall 5: Re-finalize Must Replace Existing PDF
**What goes wrong:** Multiple PDF versions accumulate in storage, or the download link points to a stale PDF.
**Why it happens:** Using `upload()` without `upsert: true`, or using a different storage path for each finalization.
**How to avoid:** Use a deterministic storage path (e.g., `reports/{inspectionId}/report.pdf`) and set `upsert: true` in the upload options. The old file is automatically replaced.
**Warning signs:** Storage bucket fills with duplicate PDFs, or user downloads an old version after re-finalize.

### Pitfall 6: Email Dialog Pre-fill Requires Customer Email in Schema
**What goes wrong:** No way to pre-fill the recipient email because there's no `customer_email` column on inspections.
**Why it happens:** The ADEQ form has seller/transferor info but no email field in the current schema. The CONTEXT.md says to pre-fill from inspection record.
**How to avoid:** Add a `customer_email` column to the inspections table. Pre-fill it from the form data if the seller info includes an email, or allow Dan to enter it during the send flow and persist it for next time.
**Warning signs:** Send dialog always shows empty email field, no way to pre-populate.

## Code Examples

Verified patterns from official sources:

### Database Migration for Phase 5
```sql
-- Migration: 0005_delivery_dashboard
-- Add customer email to inspections for email delivery pre-fill
ALTER TABLE public.inspections
  ADD COLUMN IF NOT EXISTS customer_email text,
  ADD COLUMN IF NOT EXISTS customer_name text;

-- Email send history tracking
CREATE TABLE IF NOT EXISTS public.inspection_emails (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  inspection_id uuid NOT NULL REFERENCES public.inspections(id) ON DELETE CASCADE,
  recipient_email text NOT NULL,
  subject text NOT NULL,
  sent_at timestamptz DEFAULT now() NOT NULL,
  sent_by uuid REFERENCES public.profiles(id)
);

-- Enable RLS on inspection_emails
ALTER TABLE public.inspection_emails ENABLE ROW LEVEL SECURITY;

-- Authenticated users can view email history
CREATE POLICY "Authenticated users can view email history"
  ON public.inspection_emails FOR SELECT
  TO authenticated
  USING (true);

-- Authenticated users can insert email records
CREATE POLICY "Authenticated users can insert email records"
  ON public.inspection_emails FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Storage policy for reports subfolder (already covered by existing bucket policies)
-- No additional storage policies needed -- existing inspection-media policies cover uploads/downloads
```

### Drizzle Schema Addition
```typescript
// Add to src/lib/db/schema.ts
export const inspectionEmails = pgTable("inspection_emails", {
  id: uuid("id").defaultRandom().primaryKey(),
  inspectionId: uuid("inspection_id")
    .references(() => inspections.id, { onDelete: "cascade" })
    .notNull(),
  recipientEmail: text("recipient_email").notNull(),
  subject: text("subject").notNull(),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
  sentBy: uuid("sent_by").references(() => profiles.id),
});
```

### PDF Upload Helper
```typescript
// Source: Supabase Storage docs
import { createAdminClient } from "@/lib/supabase/admin";

export async function uploadReport(
  inspectionId: string,
  pdfData: Uint8Array,
  filename: string,
): Promise<string> {
  const admin = createAdminClient();
  const path = `reports/${inspectionId}/${filename}`;

  const { error } = await admin.storage
    .from("inspection-media")
    .upload(path, pdfData, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (error) throw new Error(`PDF upload failed: ${error.message}`);
  return path;
}

export async function getReportDownloadUrl(
  storagePath: string,
  downloadFilename: string,
): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from("inspection-media")
    .createSignedUrl(storagePath, 3600, {
      download: downloadFilename,
    });

  if (error) throw new Error(`Download URL failed: ${error.message}`);
  return data.signedUrl;
}
```

### Email Send API Route
```typescript
// Source: Resend API reference
import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";

const resend = new Resend(process.env.RESEND_API_KEY!);

// Download PDF from storage, attach to email, send
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { recipientEmail, subject, personalNote } = await request.json();

  // 1. Get the PDF from storage
  const admin = createAdminClient();
  const { data: fileData, error: downloadError } = await admin.storage
    .from("inspection-media")
    .download(`reports/${id}/report.pdf`);

  if (downloadError) {
    return NextResponse.json({ error: "PDF not found" }, { status: 404 });
  }

  // 2. Convert Blob to Buffer for Resend attachment
  const buffer = Buffer.from(await fileData.arrayBuffer());

  // 3. Send email with attachment
  const { error: sendError } = await resend.emails.send({
    from: "SewerTime Inspections <onboarding@resend.dev>",
    to: [recipientEmail],
    subject,
    text: buildEmailBody(personalNote),
    attachments: [{
      content: buffer.toString("base64"),
      filename: "inspection-report.pdf",
    }],
  });

  if (sendError) {
    return NextResponse.json({ error: sendError.message }, { status: 500 });
  }

  // 4. Record send history
  // INSERT into inspection_emails...

  return NextResponse.json({ success: true });
}
```

### Conditional Drizzle Query with JSONB Search
```typescript
// Source: Drizzle ORM operators docs + conditional filters docs
import { ilike, or, and, eq, desc, asc, sql, type SQL } from "drizzle-orm";

function buildInspectionQuery(
  q?: string,
  status?: string,
  sortCol?: string,
  sortDir?: string,
) {
  const filters: (SQL | undefined)[] = [];

  // Status filter
  if (status && status !== "all") {
    filters.push(eq(inspections.status, status));
  }

  // Text search across multiple fields
  if (q) {
    const searchTerm = `%${q}%`;
    filters.push(
      or(
        ilike(inspections.facilityAddress, searchTerm),
        ilike(inspections.facilityName, searchTerm),
        ilike(inspections.facilityCity, searchTerm),
        // Top-level customer_name column (denormalized)
        ilike(inspections.customerName, searchTerm),
      ),
    );
  }

  return db
    .select()
    .from(inspections)
    .where(and(...filters))
    .orderBy(desc(inspections.createdAt));
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Sync searchParams in page components | Async searchParams (Promise) | Next.js 15+ (current: 16.1.6) | Must `await searchParams` in server components |
| Resend `path` for attachment URLs | Resend `content` with base64 Buffer | Current API | Supports both; `content` avoids needing a publicly accessible URL |
| Supabase service_role key | Supabase secret key (new projects) | 2025 transition | Project uses service_role; still fully supported |
| Client-side only PDF generation | Server-side PDF generation possible | pdfme 5.x | Node.js compatible -- can generate in API routes |

**Deprecated/outdated:**
- Sync `searchParams` prop: Must be async in Next.js 16. The project already uses `await params` in API routes, same pattern needed for page components.
- Resend `from` address: Currently using `onboarding@resend.dev` (Resend test sender). Works for development but delivery to external recipients requires domain verification.

## Open Questions

1. **Server-side PDF generation viability**
   - What we know: `generateReport()` uses pdfme + pdf-lib with font files. No DOM APIs detected. Should work in Node.js.
   - What's unclear: Whether the font loading (reading files from `public/` or using `fetch`) works correctly in the Next.js API route environment.
   - Recommendation: Test early in the first task. If font loading fails server-side, fall back to having the client generate the PDF and POST the buffer to the finalize endpoint (current pattern).

2. **Customer name denormalization vs JSONB query**
   - What we know: `sellerName` is nested in `formData.facilityInfo.sellerName` (JSONB). Direct `ilike` on JSONB requires raw SQL.
   - What's unclear: Whether a top-level `customer_name` column is better (simpler queries, indexable) vs. keeping it in JSONB (less schema changes).
   - Recommendation: Add `customer_name` as a denormalized top-level column. Populate it from `formData.facilityInfo.sellerName` on save. This makes dashboard queries straightforward without JSONB operators and allows proper indexing.

3. **Resend domain verification for production**
   - What we know: `onboarding@resend.dev` works for testing. Production email requires a verified custom domain.
   - What's unclear: Whether Dan has a custom domain to verify, or if the app will continue using the test sender.
   - Recommendation: Build with the current `onboarding@resend.dev` sender. Add a TODO/env var (`EMAIL_FROM_ADDRESS`) so the sender address is configurable without code changes. Domain verification is a deployment concern, not a code concern.

4. **Dashboard pagination strategy**
   - What we know: Dan's company is small (3-5 users). Initially there will be tens of inspections, growing to hundreds over months/years.
   - What's unclear: Whether simple limit/offset pagination or infinite scroll is better.
   - Recommendation: Start with simple pagination (20 per page). The dataset is small enough that this won't be a performance issue for a long time. Pagination is simpler to implement and provides predictable page navigation.

## Sources

### Primary (HIGH confidence)
- [Resend API Reference - Send Email](https://resend.com/docs/api-reference/emails/send-email) - Attachments format, 40MB limit, base64 content
- [Supabase Storage - Upload](https://supabase.com/docs/reference/javascript/storage-from-upload) - Upload method, upsert option, content type
- [Supabase Storage - Downloads](https://supabase.com/docs/guides/storage/serving/downloads) - createSignedUrl, download parameter
- [Drizzle ORM - Operators](https://orm.drizzle.team/docs/operators) - ilike, or, and, eq imports and usage
- [Drizzle ORM - Conditional Filters](https://orm.drizzle.team/docs/guides/conditional-filters-in-query) - Dynamic where clause building pattern
- [Next.js 16 - Async searchParams](https://nextjs.org/docs/app/api-reference/file-conventions/page) - Promise-based searchParams in page components

### Secondary (MEDIUM confidence)
- [Next.js Learn - Search and Pagination](https://nextjs.org/learn/dashboard-app/adding-search-and-pagination) - URL-based search with debounced client input pattern
- [Resend Attachments Guide](https://resend.com/docs/dashboard/emails/attachments) - General attachment guidance

### Tertiary (LOW confidence)
- None. All findings verified with primary documentation.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already installed and configured in project. No new dependencies.
- Architecture: HIGH - Patterns directly follow existing codebase conventions (admin client, API routes, server components). Verified with official docs.
- Pitfalls: HIGH - JSONB search, PDF size, upsert behavior all verified with Drizzle and Supabase docs. Server-side PDF generation is the one MEDIUM area (untested but architecturally sound).

**Research date:** 2026-02-26
**Valid until:** 2026-03-26 (stable -- no fast-moving dependencies)
