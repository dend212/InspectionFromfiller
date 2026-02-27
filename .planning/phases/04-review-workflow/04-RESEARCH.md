# Phase 4: Review Workflow - Research

**Researched:** 2026-02-26
**Domain:** Workflow state management, review UI, status transitions, email notifications
**Confidence:** HIGH

## Summary

Phase 4 builds a review workflow on top of the existing inspection CRUD, PDF generation, and role-based access control established in Phases 1-3. The core work is: (1) a "Submit for Review" action that transitions inspections from `draft` to `in_review`, (2) a side-by-side review interface where Dan (admin) can view/edit all field data alongside a PDF preview, (3) a return-to-tech flow with notes, (4) a finalization flow that locks inspections, and (5) an optional email notification when inspections are submitted.

The existing codebase already has the `inspection_status` enum with values `draft`, `submitted`, `in_review`, `completed`, `sent`. The database schema, API routes, RLS policies, and role-based access patterns are all in place. The PDF generation pipeline (`generateReport` in `src/lib/pdf/generate-report.ts`) and the iframe-based PDF preview (`src/components/inspection/pdf-preview.tsx`) are ready to reuse. The review interface will reuse the existing form field components and collapsible section patterns from the wizard.

**Primary recommendation:** Implement status transition API endpoints, build the review page with side-by-side layout reusing existing components, and add a simple email notification via Supabase Edge Functions or a Next.js API route with Resend/Nodemailer.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Explicit "Submit for Review" button at the end of the inspection form wizard
- Warn-but-allow validation: show warnings for missing data (signature, key fields) but allow submission anyway -- Dan can request corrections later
- Once submitted, only Dan (admin) can un-submit/return it -- field tech cannot retract
- No default notification; build a toggleable email notification setting so Dan can opt in to receiving an email when inspections are submitted
- Side-by-side layout: form data on the left, PDF preview on the right
- Dan can edit ALL fields (summaries, recommendations, AND any field data the tech entered) -- full override power
- Dan can return an inspection to the field tech with a note explaining what needs fixing -- status goes back to draft
- Field data organized in the same 5 collapsible sections as the wizard (Facility Info, General Treatment, Design Flow, Septic Tank Inspection, Disposal Works)
- Manual "Regenerate PDF" button -- Dan edits fields, then clicks to regenerate (avoids constant regeneration)
- Dan can download the current PDF at any point during review (not locked to finalization)
- PDF preview uses the existing embedded browser iframe approach from Phase 3
- Each regeneration overwrites the previous -- no version history, only the final PDF matters
- Finalizing locks all fields and stores the current PDF as the final version
- Status changes to "complete" on finalization
- Admin (Dan) can reopen a finalized report, putting it back to "in review" for further edits
- Finalized inspections display a clear status badge and are read-only for field techs (green/completed styling)

### Claude's Discretion
- Status model design (whether to use 3 statuses like draft/in-review/complete or add a "returned" status for the send-back flow)
- Email notification implementation details (provider, template)
- Exact layout proportions for side-by-side view
- Loading states and error handling during PDF regeneration

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| WKFL-01 | Field tech submits completed inspection for office review | Submit button on wizard last step, PATCH `/api/inspections/[id]/status` endpoint, status transition `draft` -> `in_review`, warn-but-allow validation pattern |
| WKFL-02 | Office staff (Dan) can review, edit summaries/recommendations, and finalize reports before sending | Review page at `/review/[id]` with side-by-side layout, collapsible form sections, PDF preview iframe, "Regenerate PDF" button, finalize action setting status to `completed`, reopen action |

</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js | 16.1.6 | App Router, API routes, server components | Already in project |
| React | 19.2.3 | UI rendering | Already in project |
| Drizzle ORM | 0.45.1 | Database queries, schema, migrations | Already in project |
| Supabase | 2.97.0 | Auth, storage, RLS | Already in project |
| react-hook-form | 7.71.2 | Form state management for review editor | Already in project |
| Zod | 4.3.6 | Validation schemas | Already in project |
| pdfme | 5.5.8 | PDF generation pipeline | Already in project |
| pdf-lib | 1.17.1 | PDF merge utility | Already in project |
| shadcn/ui + Radix | 1.4.3 | UI components (Card, Button, Badge, etc.) | Already in project |
| Tailwind CSS | 4 | Styling | Already in project |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Resend | latest | Email notification delivery | For the toggleable email notification on submission |
| lucide-react | 0.575.0 | Icons for review UI | Already in project |
| sonner | 2.0.7 | Toast notifications for status changes | Already in project |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Resend | Supabase Edge Functions + SMTP | Resend is simpler (single API call), Edge Functions add deployment complexity |
| Resend | Nodemailer via API route | Nodemailer requires SMTP config; Resend is API-first and simpler for transactional email |

**Installation:**
```bash
npm install resend
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── app/
│   ├── (dashboard)/
│   │   ├── review/                       # NEW: Review queue page
│   │   │   ├── page.tsx                  # List of submitted inspections
│   │   │   └── [id]/
│   │   │       └── page.tsx              # Side-by-side review interface
│   │   └── inspections/
│   │       └── [id]/
│   │           ├── inspection-pdf-view.tsx  # MODIFY: Add submit button
│   │           └── edit/
│   │               └── page.tsx            # MODIFY: Add submit button for last step
│   ├── api/
│   │   └── inspections/
│   │       └── [id]/
│   │           ├── submit/
│   │           │   └── route.ts          # NEW: POST to submit for review
│   │           ├── return/
│   │           │   └── route.ts          # NEW: POST to return to field tech
│   │           ├── finalize/
│   │           │   └── route.ts          # NEW: POST to finalize
│   │           ├── reopen/
│   │           │   └── route.ts          # NEW: POST to reopen
│   │           └── route.ts              # EXISTING: PATCH for data edits
│   └── api/
│       └── notifications/
│           └── settings/
│               └── route.ts              # NEW: GET/PUT notification preferences
├── components/
│   ├── inspection/
│   │   └── submit-button.tsx             # NEW: "Submit for Review" with warnings
│   ├── review/
│   │   ├── review-editor.tsx             # NEW: Side-by-side review interface
│   │   ├── review-section.tsx            # NEW: Collapsible form section for review
│   │   ├── review-actions.tsx            # NEW: Finalize, Return, Reopen buttons
│   │   └── return-dialog.tsx             # NEW: Dialog for return note
│   └── ui/
│       └── collapsible.tsx               # NEW: shadcn Collapsible component
├── lib/
│   ├── db/
│   │   ├── schema.ts                     # MODIFY: Add review_notes, finalized_pdf_url columns
│   │   └── migrations/
│   │       └── 0004_review_workflow.sql  # NEW: Schema changes + RLS updates
│   └── email/
│       └── send-notification.ts          # NEW: Email sending utility
└── types/
    └── inspection.ts                     # No changes needed (types from Zod)
```

### Pattern 1: Status Transition API Endpoints
**What:** Dedicated POST endpoints for each status transition instead of a generic PATCH
**When to use:** When status transitions have side effects (validation, notifications, timestamp updates)
**Why:** Each transition has different authorization rules and side effects. A single PATCH endpoint with a `status` field would become a complex conditional mess.

```typescript
// src/app/api/inspections/[id]/submit/route.ts
// Pattern: Validate current status -> Check authorization -> Perform transition -> Side effects
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Load current inspection
  const [inspection] = await db
    .select()
    .from(inspections)
    .where(eq(inspections.id, id))
    .limit(1);

  if (!inspection) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Guard: Only draft inspections can be submitted
  if (inspection.status !== "draft") {
    return NextResponse.json({ error: "Only draft inspections can be submitted" }, { status: 409 });
  }

  // Guard: Only the inspector (or admin) can submit
  if (inspection.inspectorId !== user.id) {
    // Check if admin
    const role = await getUserRole(supabase);
    if (role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // Transition
  await db
    .update(inspections)
    .set({
      status: "in_review",
      submittedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(inspections.id, id));

  // Side effect: Send email notification if enabled
  // (fire-and-forget, don't block the response)

  return NextResponse.json({ status: "in_review" });
}
```

### Pattern 2: Side-by-Side Review Layout with Collapsible Sections
**What:** CSS Grid layout with form data on the left (collapsible sections) and PDF preview on the right (sticky)
**When to use:** The review page at `/review/[id]`

```typescript
// Review page layout pattern
// Left panel: scrollable form sections
// Right panel: sticky PDF preview
export function ReviewEditor({ inspection, media }: ReviewEditorProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left: Editable form sections */}
      <div className="space-y-4 overflow-y-auto">
        <ReviewSection title="Facility Info" defaultOpen>
          {/* Form fields from facilityInfo */}
        </ReviewSection>
        <ReviewSection title="General Treatment">
          {/* Form fields */}
        </ReviewSection>
        {/* ... 3 more sections */}
      </div>

      {/* Right: Sticky PDF preview */}
      <div className="lg:sticky lg:top-20 lg:self-start">
        <PdfPreview pdfData={pdfData} facilityName={facilityName} />
        <Button onClick={handleRegenerate}>Regenerate PDF</Button>
      </div>
    </div>
  );
}
```

### Pattern 3: Status-Aware Field Locking
**What:** Form fields are read-only based on inspection status and user role
**When to use:** Completed inspections for field techs, all inspections during transitions

```typescript
// Determine editability based on status and role
const isReadOnly =
  inspection.status === "completed" && role !== "admin";
// In review interface, admin always has full edit power
const canEdit = role === "admin" || role === "office_staff";
```

### Pattern 4: Warn-but-Allow Submission Validation
**What:** Run Zod validation but surface results as warnings, not blockers
**When to use:** When field tech clicks "Submit for Review"

```typescript
// Validate and collect warnings without blocking
const result = inspectionFormSchema.safeParse(formData);
const warnings: string[] = [];

if (!result.success) {
  // Collect human-readable warnings
  for (const issue of result.error.issues) {
    warnings.push(`${issue.path.join(".")}: ${issue.message}`);
  }
}

// Show confirmation dialog with warnings
// User can still proceed even with warnings
```

### Anti-Patterns to Avoid
- **Generic status PATCH endpoint:** Don't add status changes to the existing PATCH `/api/inspections/[id]` route. Use dedicated transition endpoints with proper guards.
- **Client-side status enforcement only:** Always enforce status transition rules on the server. The client can hide buttons, but the API must reject invalid transitions.
- **Storing finalized PDF as base64 in the database:** Store the finalized PDF in Supabase Storage and save the storage path. JSONB/bytea columns are wrong for binary blobs.
- **Re-implementing form fields in the review editor:** Reuse the existing form field components from the wizard. The review editor should use the same react-hook-form + Zod setup as the wizard, just with a different layout.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Collapsible sections | Custom toggle logic | shadcn/ui Collapsible (Radix Collapsible) | Accessible, animated, handles keyboard |
| Email delivery | Raw SMTP/fetch to mail API | Resend SDK | API key auth, templating, deliverability |
| Confirmation dialogs | Custom modal state | shadcn/ui AlertDialog (Radix AlertDialog) | Accessible, handles escape/focus trap |
| PDF blob storage | Base64 in DB column | Supabase Storage bucket | Proper CDN, signed URLs, size limits |

**Key insight:** This phase is workflow orchestration, not new technology. Every building block exists in the codebase already. The risk is in the state machine logic and authorization rules, not in unfamiliar libraries.

## Common Pitfalls

### Pitfall 1: Race Condition on Status Transitions
**What goes wrong:** Two users (or two tabs) submit/finalize the same inspection simultaneously, causing inconsistent state.
**Why it happens:** No optimistic locking or status guard on the database UPDATE.
**How to avoid:** Add a WHERE clause that checks the current status in the UPDATE query: `WHERE id = $id AND status = 'draft'`. If zero rows are updated, the transition was invalid -- return a 409 Conflict.
**Warning signs:** `rowCount` of 0 on the update response.

```typescript
// Safe status transition pattern
const result = await db
  .update(inspections)
  .set({ status: "in_review", submittedAt: new Date(), updatedAt: new Date() })
  .where(and(eq(inspections.id, id), eq(inspections.status, "draft")))
  .returning();

if (result.length === 0) {
  return NextResponse.json({ error: "Inspection is no longer a draft" }, { status: 409 });
}
```

### Pitfall 2: RLS Policy Gaps for Status-Dependent Access
**What goes wrong:** Field tech can still edit an `in_review` or `completed` inspection via the PATCH API because the RLS policy only checks `status = 'draft'` for the inspector.
**Why it happens:** The existing RLS policy on inspections UPDATE already restricts field techs to `status = 'draft'`, which is correct. But the API route at `/api/inspections/[id]/route.ts` does its own ownership check and does NOT check status.
**How to avoid:** The PATCH API route must also validate that field techs can only edit drafts. Add a status check in the API route, not just RLS (defense in depth).
**Warning signs:** Field tech successfully saves changes to a submitted inspection.

### Pitfall 3: Field Tech Editing a "Returned" Inspection
**What goes wrong:** When Dan returns an inspection to the field tech, the status goes back to "draft". If the return note is stored on the inspection, the field tech's auto-save could overwrite it.
**How to avoid:** Store the return note in a separate column (`review_notes`) that the field tech's auto-save PATCH endpoint does not touch. The auto-save only writes `formData` and facility fields.
**Warning signs:** Return note disappears after field tech opens the inspection.

### Pitfall 4: PDF Preview Showing Stale Data
**What goes wrong:** Dan edits fields in the review interface but forgets to click "Regenerate PDF". The preview shows the old version. Dan then finalizes with the stale PDF.
**How to avoid:** (1) Clear the PDF preview when any field is edited (same pattern already used in `InspectionPdfView`'s `handleSignatureCapture`). (2) Require PDF generation before finalization -- the finalize endpoint should check that a current PDF exists.
**Warning signs:** Finalized PDF does not match the form data.

### Pitfall 5: Notification Email Blocking the Response
**What goes wrong:** Sending an email inside the submit API handler adds 1-3 seconds of latency to the user's submit action.
**How to avoid:** Fire-and-forget the email send. Use a try/catch that logs errors but does not affect the HTTP response. Alternatively, use `waitUntil()` (Next.js 16 supports this via the `after` function) to defer work after the response is sent.
**Warning signs:** Submit button feels slow.

### Pitfall 6: Side-by-Side Layout Breaking on Mobile
**What goes wrong:** The review interface is designed for desktop side-by-side but is unusable on mobile.
**How to avoid:** Use responsive grid (`grid-cols-1 lg:grid-cols-2`). On mobile, stack the sections vertically with the PDF preview below (or behind a tab). Since Dan primarily reviews on desktop, mobile is secondary but should still be functional.
**Warning signs:** PDF preview hidden or overlapping form fields on small screens.

## Code Examples

### Status Transition: Submit for Review
```typescript
// src/app/api/inspections/[id]/submit/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { inspections } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Atomic status transition: only succeeds if currently "draft"
  const [updated] = await db
    .update(inspections)
    .set({
      status: "in_review",
      submittedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(inspections.id, id),
        eq(inspections.status, "draft"),
        eq(inspections.inspectorId, user.id)
      )
    )
    .returning({ id: inspections.id });

  if (!updated) {
    return NextResponse.json(
      { error: "Cannot submit: inspection is not a draft or you are not the inspector" },
      { status: 409 }
    );
  }

  // Fire-and-forget email notification
  // sendSubmissionNotification(id).catch(console.error);

  return NextResponse.json({ status: "in_review" });
}
```

### Status Transition: Finalize
```typescript
// src/app/api/inspections/[id]/finalize/route.ts
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  // ... auth check, admin role check ...

  const [updated] = await db
    .update(inspections)
    .set({
      status: "completed",
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(inspections.id, id),
        eq(inspections.status, "in_review")
      )
    )
    .returning({ id: inspections.id });

  if (!updated) {
    return NextResponse.json(
      { error: "Cannot finalize: inspection is not in review" },
      { status: 409 }
    );
  }

  return NextResponse.json({ status: "completed" });
}
```

### Return to Field Tech with Note
```typescript
// src/app/api/inspections/[id]/return/route.ts
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { note } = await request.json();
  // ... auth check, admin role check ...

  const [updated] = await db
    .update(inspections)
    .set({
      status: "draft",
      reviewNotes: note || null,
      submittedAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(inspections.id, id),
        eq(inspections.status, "in_review")
      )
    )
    .returning({ id: inspections.id });

  if (!updated) {
    return NextResponse.json(
      { error: "Cannot return: inspection is not in review" },
      { status: 409 }
    );
  }

  return NextResponse.json({ status: "draft" });
}
```

### Collapsible Review Section Component
```typescript
// src/components/review/review-section.tsx
"use client";

import { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ChevronDown, ChevronRight } from "lucide-react";

interface ReviewSectionProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function ReviewSection({ title, defaultOpen = false, children }: ReviewSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <Card>
      <CardHeader
        className="cursor-pointer select-none"
        onClick={() => setIsOpen(!isOpen)}
      >
        <CardTitle className="flex items-center gap-2 text-base">
          {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          {title}
        </CardTitle>
      </CardHeader>
      {isOpen && <CardContent>{children}</CardContent>}
    </Card>
  );
}
```

### Email Notification with Resend
```typescript
// src/lib/email/send-notification.ts
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendSubmissionNotification(
  inspectionId: string,
  facilityName: string | null
) {
  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL;
  if (!adminEmail) return;

  await resend.emails.send({
    from: "SewerTime Inspections <noreply@yourdomain.com>",
    to: adminEmail,
    subject: `New Inspection Submitted: ${facilityName || "Untitled"}`,
    text: `A new inspection has been submitted for review.\n\nFacility: ${facilityName || "Untitled"}\n\nReview it here: ${process.env.NEXT_PUBLIC_APP_URL}/review/${inspectionId}`,
  });
}
```

## Architecture Decisions

### Status Model: Use Existing 3-Status Flow (draft / in_review / completed)

**Recommendation:** Do NOT add a "returned" status. When Dan returns an inspection to the field tech, set status back to `draft`. The `review_notes` column stores the return note, which the field tech sees as a banner on their draft.

**Rationale:**
- The existing `inspection_status` enum already has `draft`, `submitted`, `in_review`, `completed`, `sent`.
- A "returned" status would require additional RLS policy updates and UI handling.
- The simplest model: `draft` (field tech working) -> `in_review` (Dan reviewing) -> `completed` (finalized). Return just goes back to `draft`.
- The `submitted` enum value is redundant with `in_review` -- recommend skipping `submitted` and going directly `draft` -> `in_review` on submit. This avoids a two-step transition where nothing happens between submitted and in_review.

**Status transition diagram:**
```
draft  --(submit)--> in_review  --(finalize)--> completed
  ^                    |                           |
  |                    |                           |
  +----(return)--------+                           |
  |                                                |
  +----(reopen)------------------------------------+
```

### Email Provider: Resend

**Recommendation:** Use Resend for email delivery.

**Rationale:**
- Simple API-first design: single `resend.emails.send()` call.
- Free tier includes 100 emails/day (more than enough for this use case of a few inspections per day).
- No SMTP configuration needed.
- Works from both serverless functions and API routes.
- Requires a verified domain or using a Resend-provided test domain during development.

**Alternative if domain verification is not desired:** Use a simple API route that calls `fetch` to any transactional email service (SendGrid, Mailgun, etc.) -- the pattern is identical.

### Notification Settings Storage

**Recommendation:** Add a `notification_settings` JSONB column to the `profiles` table (or a separate `user_settings` table). Since there is only one admin (Dan) and one setting (email on/off), a simple approach works.

```typescript
// In profiles table or a new user_settings table
notificationSettings: jsonb("notification_settings").default({
  emailOnSubmission: false,
})
```

### PDF Storage on Finalization

**Recommendation:** When Dan finalizes, upload the current PDF to Supabase Storage under a path like `finalized-reports/{inspectionId}.pdf`. Store the storage path in a `finalizedPdfPath` column on the inspections table.

**Rationale:**
- The PDF is generated client-side (in the browser via pdfme). The finalize action should upload the PDF bytes alongside the status change.
- Storing in Supabase Storage allows signed URL access later (Phase 5 delivery).
- The `finalizedPdfPath` column enables quick checks ("has this been finalized with a PDF?").

### Layout Proportions for Side-by-Side View

**Recommendation:** 50/50 split on large screens (`lg:grid-cols-2`). On medium screens, stack vertically. The PDF preview panel should be `sticky` so it stays visible as the user scrolls through form sections.

```
Desktop (lg+): [Form Sections 50%] | [PDF Preview 50%]
Mobile/Tablet:  [Form Sections 100%]
                [PDF Preview 100%]
```

## Don't Hand-Roll (Extended)

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Collapsible UI | CSS display toggle | Radix Collapsible via shadcn `npx shadcn@latest add collapsible` | Accessible, animatable |
| Confirmation dialog | window.confirm | Radix AlertDialog via shadcn `npx shadcn@latest add alert-dialog` | Accessible, styled consistently |
| Email sending | Raw fetch to SMTP | Resend SDK | Handles retries, bounce tracking |
| PDF file upload | Manual multipart/form-data | Supabase Storage `.upload()` | Already configured with signed URLs |
| State machine | If/else chains | Explicit transition guards in API routes | Each endpoint handles one transition |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Server-side email from API route | `after()` / `waitUntil()` in Next.js 15+ | Next.js 15 (2024) | Fire-and-forget work after response is sent |
| Generic PATCH for all fields + status | Dedicated POST endpoints per transition | Industry standard | Clearer authorization, easier to audit |
| Client-side form validation as gate | Warn-but-allow (project decision) | N/A | Better UX for field conditions |

## Database Schema Changes

### New Columns on `inspections` Table
```sql
-- Add review workflow columns
ALTER TABLE public.inspections
  ADD COLUMN review_notes text,
  ADD COLUMN finalized_pdf_path text,
  ADD COLUMN reviewed_by uuid REFERENCES public.profiles(id);
```

### Drizzle Schema Update
```typescript
// Add to inspections table in schema.ts
reviewNotes: text("review_notes"),
finalizedPdfPath: text("finalized_pdf_path"),
reviewedBy: uuid("reviewed_by").references(() => profiles.id),
```

### Notification Settings
```sql
-- Add notification preferences to profiles (or create separate table)
ALTER TABLE public.profiles
  ADD COLUMN notification_settings jsonb DEFAULT '{"emailOnSubmission": false}'::jsonb;
```

### RLS Policy Updates
The existing RLS policies are already well-structured for this phase:
- Field techs can only UPDATE drafts (existing policy handles returned inspections correctly since they go back to `draft`)
- Admin/office_staff can UPDATE any inspection (covers review edits, finalization, return)
- No new RLS policies needed for status transitions since the API routes handle authorization

The only RLS consideration is ensuring the `review_notes` and `finalized_pdf_path` columns are covered by the existing policies (they are, since the policies are row-level, not column-level).

## Open Questions

1. **Resend API Key and Domain Verification**
   - What we know: Resend requires a verified domain for production sending. Test mode uses `onboarding@resend.dev`.
   - What's unclear: Whether Dan has a domain to verify, or if a different email provider is preferred.
   - Recommendation: Start with Resend test mode. The notification feature is toggleable (off by default), so email delivery can be validated later. The code pattern is the same regardless of provider.

2. **Finalized PDF Upload Size Limits**
   - What we know: Supabase Storage free tier has 1GB storage. ADEQ inspection PDFs with photos could be 5-20MB.
   - What's unclear: Exact PDF sizes with photo pages.
   - Recommendation: Upload to Supabase Storage with the existing bucket setup. Monitor storage usage. Not a blocker.

3. **Review Queue Filtering**
   - What we know: The `/review` page should show inspections with status `in_review`.
   - What's unclear: Whether to also show recently completed inspections for reference.
   - Recommendation: Default to showing `in_review` inspections. Add a tab or filter to show `completed` inspections as well. This is a UI detail the planner can decide.

## Sources

### Primary (HIGH confidence)
- **Existing codebase analysis** - Direct inspection of all source files in the project (schema, API routes, components, hooks, migrations)
- **Drizzle ORM patterns** - Already established in project, using the same query patterns
- **Supabase Auth/Storage** - Already configured with RLS, signed URLs, and role-based access
- **pdfme/pdf-lib** - Already integrated for PDF generation pipeline
- **Next.js 16 App Router** - Already in use with route groups, server components, API routes

### Secondary (MEDIUM confidence)
- **Resend email service** - Well-known API-first email service; documentation verified. Free tier sufficient for this use case.
- **shadcn/ui Collapsible and AlertDialog** - Standard Radix-based components compatible with the existing shadcn setup in the project.

### Tertiary (LOW confidence)
- None -- all findings are based on direct codebase analysis and established project patterns.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already in use; only Resend is new (trivial addition)
- Architecture: HIGH - Follows established patterns from Phases 1-3; status transitions are straightforward
- Pitfalls: HIGH - Based on direct analysis of existing code (e.g., RLS policies, API routes, auto-save)

**Research date:** 2026-02-26
**Valid until:** 2026-03-28 (stable -- no fast-moving dependencies)
