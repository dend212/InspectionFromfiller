# Phase 02: Inspection Form Input - Research

**Researched:** 2026-02-26
**Domain:** Multi-step mobile form wizard with media capture, auto-save, and Supabase integration
**Confidence:** HIGH

## Summary

This phase builds the core data-entry experience: a 5-step mobile-first form wizard that mirrors the ADEQ GWS 432 inspection form. The existing codebase already has react-hook-form (v7.71), Zod v4, shadcn/ui Form primitives, Drizzle ORM with a `formData` JSONB column on the `inspections` table, and Supabase Storage with an `inspection_media` table. The architecture is well-suited for a single `useForm()` instance spanning all 5 wizard steps, with per-step validation via `trigger()`, and auto-save on blur via a debounced `useWatch()` hook that PATCHes the JSONB column.

Media capture uses native HTML `<input type="file" accept="image/*" capture="environment">` for photos (no library needed) and `<input type="file" accept="video/*">` for video. Files upload directly to Supabase Storage from the browser client, with metadata rows inserted into `inspection_media`. The 120-second video limit is enforced client-side by file duration check post-selection.

**Primary recommendation:** Use a single react-hook-form instance with Zod v4 per-step schemas, auto-save via debounced `useWatch()` to a PATCH API route, and direct Supabase Storage uploads from the browser for media.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Linear wizard: Step 1 -> 2 -> 3 -> 4 -> 5 with Next/Back buttons
- Step dots progress indicator at top (5 dots, filled as sections complete)
- Warn-but-allow validation: highlight incomplete required fields when advancing, but don't block navigation
- All validation enforced on final Submit
- Submit button on the last section (Disposal Works) -- no separate review summary page
- Toggle switch per group for rarely-used conditional fields (e.g., "Alternative Treatment System" toggle reveals those fields)
- Pre-fill inspector info: company credentials (SewerTime Septic, NAWT #15805, CR-37, ADEQ Truck #2833) plus the assigned field tech's name from their profile
- Mix of input types: dropdowns where options are fixed (AZ counties, facility types), free text where values vary (city, addresses)
- Large tap-friendly toggle rows for checkbox-heavy sections (septic tank condition items) -- easy to tap with gloves or dirty hands
- Native camera integration + gallery pick (tap "Add Photo" -> choose camera or existing photo)
- Per-section photo attachment: each form section has its own "Add Photo" area, photos tied to the section they document
- Optional text caption per photo (e.g., "Crack in tank lid")
- Video: native camera recording, 120-second limit per clip, attached to inspection (not embedded in PDF)
- Auto-save on field blur (when tech taps out of a field)
- Multiple simultaneous draft inspections allowed (tech may visit multiple sites in a day)
- Field tech dashboard shows draft cards: facility name, date started, completion status -- tap to resume
- Online only for v1 -- requires internet connection to save

### Claude's Discretion
- Exact animation/transition between wizard steps
- Loading states and skeleton screens
- Error toast design and placement
- Specific spacing, typography, and color usage within the design system

### Deferred Ideas (OUT OF SCOPE)
- Offline support / local-first sync -- potential future phase if remote sites prove to be an issue
- Smart pre-fill from recent inspections (copy facility info for recurring sites) -- nice-to-have for later
- In-app camera with overlay guides -- not needed for v1
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FORM-01 | Field tech can fill out the ADEQ GWS 432 form as a multi-step mobile wizard (all 5 sections) | Single react-hook-form instance with step-based rendering; Zod v4 schema per section; shadcn/ui form primitives already in project |
| FORM-02 | Rarely-used options in Section 2 collapsed/hidden by default with expand-on-demand | shadcn/ui Switch or Accordion component; conditional rendering gated by toggle state within the form |
| FORM-03 | Form auto-saves on every field change to prevent data loss | Debounced `useWatch()` hook triggering PATCH to API route; saves to `inspections.form_data` JSONB column; restores on page load via `defaultValues` |
| FORM-04 | Inspector info pre-populated on every new inspection | Server-side pre-fill from `profiles` table + hardcoded company constants when creating new inspection record |
| MDIA-01 | User can capture or upload photos from device camera | HTML `<input type="file" accept="image/*" capture="environment">` for camera; direct upload to Supabase Storage bucket; metadata in `inspection_media` table |
| MDIA-02 | User can upload videos as part of field data collection | HTML `<input type="file" accept="video/*">` with client-side 120-second duration validation; upload to Supabase Storage; metadata in `inspection_media` with `type: 'video'` |
</phase_requirements>

## Standard Stack

### Core (Already Installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| react-hook-form | ^7.71.2 | Form state, validation, field registration | Already in project; single `useForm()` with `trigger()` is the standard multi-step pattern |
| @hookform/resolvers | ^5.2.2 | Connects Zod schemas to react-hook-form | Already in project; zodResolver auto-detects Zod v4 |
| zod | ^4.3.6 | Schema validation per wizard step | Already in project; Zod v4 supported by @hookform/resolvers ^5.x |
| @supabase/supabase-js | ^2.97.0 | Client-side Supabase Storage uploads | Already in project; `supabase.storage.from('bucket').upload()` for media |
| drizzle-orm | ^0.45.1 | Database queries for inspection CRUD | Already in project; JSONB column for form data already defined |
| shadcn/ui components | latest | Form UI primitives (Form, Input, Select, Label, Button, Card) | Already partially installed; add Switch, Checkbox, Textarea, Accordion, Progress |
| lucide-react | ^0.575.0 | Icons for wizard navigation and form UI | Already in project |

### New Components to Add (shadcn/ui)
| Component | Purpose | Install Command |
|-----------|---------|-----------------|
| Switch | Toggle for conditional field groups (e.g., alternative treatment systems) | `npx shadcn@latest add switch` |
| Checkbox | Septic tank condition items, disposal works checkboxes | `npx shadcn@latest add checkbox` |
| Textarea | Inspector comments, summary fields, photo captions | `npx shadcn@latest add textarea` |
| Accordion | Collapsible sections for rarely-used alternative system options | `npx shadcn@latest add accordion` |
| Progress | Step dots / progress indicator at top of wizard | Custom component using existing primitives |
| Separator | Visual section dividers within form steps | `npx shadcn@latest add separator` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Single useForm() for all steps | Separate useForm() per step | Separate forms need manual state merging; single form with `trigger()` is simpler and avoids data loss between steps |
| Direct Supabase Storage upload | Signed URL upload via server | Signed URLs add complexity; direct upload with RLS policies is sufficient for authenticated users in v1 |
| Native HTML file input for camera | react-webcam or MediaStream API | HTML input with `capture` attribute is simpler, more reliable cross-browser on mobile, and handles gallery fallback automatically |
| JSONB column for form data | Fully normalized columns | JSONB is already in schema; provides flexibility during early development; can normalize later if query patterns demand it |

**Installation:**
```bash
npx shadcn@latest add switch checkbox textarea accordion separator
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── app/
│   ├── (dashboard)/
│   │   ├── inspections/
│   │   │   ├── page.tsx              # Inspection list / drafts dashboard
│   │   │   ├── new/
│   │   │   │   └── page.tsx          # Create new inspection (redirects to /inspections/[id]/edit)
│   │   │   └── [id]/
│   │   │       └── edit/
│   │   │           └── page.tsx      # Wizard form for inspection
│   │   └── page.tsx                  # Dashboard (already exists)
│   └── api/
│       └── inspections/
│           ├── route.ts              # POST: create new inspection, GET: list inspections
│           ├── [id]/
│           │   ├── route.ts          # PATCH: auto-save form data, GET: load inspection
│           │   └── media/
│           │       └── route.ts      # POST: upload media metadata, DELETE: remove media
├── components/
│   ├── inspection/
│   │   ├── inspection-wizard.tsx     # Wizard shell: step navigation, progress dots
│   │   ├── step-facility-info.tsx    # Step 1: Facility Information
│   │   ├── step-general-treatment.tsx # Step 2: General Treatment System
│   │   ├── step-design-flow.tsx      # Step 3: Design Flow
│   │   ├── step-septic-tank.tsx      # Step 4: Septic Tank Inspection
│   │   ├── step-disposal-works.tsx   # Step 5: Disposal Works
│   │   ├── photo-capture.tsx         # Photo capture/upload component
│   │   ├── video-upload.tsx          # Video upload component
│   │   └── media-gallery.tsx         # Display attached media with captions
│   └── ui/                           # shadcn/ui components (already exists)
├── hooks/
│   ├── use-auto-save.ts              # Debounced auto-save hook
│   └── use-user-role.ts              # Already exists
├── lib/
│   ├── validators/
│   │   └── inspection.ts             # Zod schemas for all 5 form sections
│   ├── constants/
│   │   └── inspection.ts             # ADEQ field options (counties, facility types, system types)
│   └── db/
│       └── schema.ts                 # Already exists with inspections + inspection_media tables
└── types/
    └── inspection.ts                 # TypeScript types derived from Zod schemas
```

### Pattern 1: Single useForm with Per-Step Validation
**What:** One `useForm()` wraps the entire wizard. Each step renders only its fields. Navigation triggers `trigger()` on the current step's field names to show warnings without blocking.
**When to use:** Multi-step forms where data must persist across steps and final submit validates everything.
**Example:**
```typescript
// lib/validators/inspection.ts
import { z } from "zod";

// Step 1: Facility Information
export const facilityInfoSchema = z.object({
  facilityName: z.string().min(1, "Facility name is required"),
  facilityAddress: z.string().min(1, "Address is required"),
  facilityCity: z.string().min(1, "City is required"),
  facilityCounty: z.string().min(1, "County is required"),
  facilityZip: z.string().optional(),
  ownerName: z.string().optional(),
  ownerPhone: z.string().optional(),
  taxParcelNumber: z.string().optional(),
  // ... more fields
});

// Step 2: General Treatment System
export const generalTreatmentSchema = z.object({
  systemType: z.string().optional(),
  gp402System: z.boolean().default(false),
  alternativeSystem: z.boolean().default(false),
  // ... conditional fields
});

// Combined schema for final validation
export const inspectionFormSchema = z.object({
  facilityInfo: facilityInfoSchema,
  generalTreatment: generalTreatmentSchema,
  designFlow: designFlowSchema,
  septicTank: septicTankSchema,
  disposalWorks: disposalWorksSchema,
});

// Per-step field name arrays for trigger()
export const STEP_FIELDS = {
  0: ["facilityInfo.facilityName", "facilityInfo.facilityAddress", ...],
  1: ["generalTreatment.systemType", ...],
  // ...
} as const;
```

```typescript
// components/inspection/inspection-wizard.tsx
"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { inspectionFormSchema, STEP_FIELDS } from "@/lib/validators/inspection";

export function InspectionWizard({ inspection }) {
  const [currentStep, setCurrentStep] = useState(0);

  const form = useForm({
    resolver: zodResolver(inspectionFormSchema),
    defaultValues: inspection.formData ?? getDefaultValues(inspection),
    mode: "onBlur", // validate on blur for auto-save
  });

  const handleNext = async () => {
    // Warn-but-allow: trigger validation to highlight issues, but always advance
    await form.trigger(STEP_FIELDS[currentStep]);
    setCurrentStep((prev) => Math.min(prev + 1, 4));
  };

  const handleBack = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 0));
  };

  const handleSubmit = form.handleSubmit(async (data) => {
    // Final submit -- all validation enforced here
    await submitInspection(inspection.id, data);
  });

  return (
    <Form {...form}>
      <form onSubmit={handleSubmit}>
        <WizardProgress currentStep={currentStep} totalSteps={5} />
        {currentStep === 0 && <StepFacilityInfo />}
        {currentStep === 1 && <StepGeneralTreatment />}
        {currentStep === 2 && <StepDesignFlow />}
        {currentStep === 3 && <StepSepticTank />}
        {currentStep === 4 && <StepDisposalWorks />}
        <WizardNavigation
          currentStep={currentStep}
          onNext={handleNext}
          onBack={handleBack}
          isLastStep={currentStep === 4}
        />
      </form>
    </Form>
  );
}
```

### Pattern 2: Debounced Auto-Save with useWatch
**What:** A custom hook watches form values and debounces saves to the server. Uses `useWatch()` (not `watch()`) for performance isolation.
**When to use:** When form data must persist to server on every field change without blocking the UI.
**Example:**
```typescript
// hooks/use-auto-save.ts
"use client";

import { useEffect, useRef, useCallback } from "react";
import { useWatch, type UseFormReturn } from "react-hook-form";

export function useAutoSave(
  form: UseFormReturn<any>,
  inspectionId: string,
  debounceMs = 1000
) {
  const values = useWatch({ control: form.control });
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedRef = useRef<string>("");

  const save = useCallback(async (data: unknown) => {
    const serialized = JSON.stringify(data);
    if (serialized === lastSavedRef.current) return; // skip if unchanged

    try {
      await fetch(`/api/inspections/${inspectionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: serialized,
      });
      lastSavedRef.current = serialized;
    } catch (error) {
      console.error("Auto-save failed:", error);
      // Toast notification for save failure
    }
  }, [inspectionId]);

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => save(values), debounceMs);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [values, save, debounceMs]);
}
```

### Pattern 3: Media Upload with Supabase Storage
**What:** Photos/videos upload directly from the browser to Supabase Storage. A separate API route records metadata in `inspection_media`.
**When to use:** File uploads that need to be associated with a specific inspection and section.
**Example:**
```typescript
// components/inspection/photo-capture.tsx
"use client";

import { createClient } from "@/lib/supabase/client";

export function PhotoCapture({
  inspectionId,
  section,
  onUploadComplete,
}: {
  inspectionId: string;
  section: string;
  onUploadComplete: (media: MediaRecord) => void;
}) {
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const supabase = createClient();
    const fileName = `${inspectionId}/${section}/${crypto.randomUUID()}-${file.name}`;

    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from("inspection-media")
      .upload(fileName, file);

    if (error) { /* handle error */ return; }

    // Record metadata via API
    const response = await fetch(`/api/inspections/${inspectionId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storagePath: data.path,
        type: "photo",
        label: section,
      }),
    });

    const media = await response.json();
    onUploadComplete(media);
  };

  return (
    <div>
      <input
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileSelect}
        className="hidden"
        id={`photo-${section}`}
      />
      <label
        htmlFor={`photo-${section}`}
        className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-3 text-sm font-medium text-primary-foreground cursor-pointer min-h-[48px]"
      >
        Add Photo
      </label>
    </div>
  );
}
```

### Pattern 4: Conditional Field Groups with Toggle
**What:** Rarely-used form sections (e.g., alternative treatment systems) hidden behind a Switch toggle. Toggle state is part of form data so it persists with auto-save.
**When to use:** FORM-02 requirement -- collapsed sections for rarely-used options.
**Example:**
```typescript
// Inside step-general-treatment.tsx
const showAlternativeSystem = form.watch("generalTreatment.alternativeSystem");

return (
  <div className="space-y-6">
    {/* Standard GP 4.02 fields always visible */}
    <FormField name="generalTreatment.gp402System" ... />

    {/* Toggle for alternative systems */}
    <div className="flex items-center justify-between rounded-lg border p-4">
      <div>
        <Label className="text-base">Alternative Treatment System</Label>
        <p className="text-sm text-muted-foreground">
          Show fields for non-standard system types
        </p>
      </div>
      <FormField
        name="generalTreatment.alternativeSystem"
        render={({ field }) => (
          <Switch checked={field.value} onCheckedChange={field.onChange} />
        )}
      />
    </div>

    {/* Conditional fields */}
    {showAlternativeSystem && (
      <div className="space-y-4 rounded-lg border-l-2 border-primary/20 pl-4">
        <FormField name="generalTreatment.altSystemType" ... />
        <FormField name="generalTreatment.altSystemManufacturer" ... />
        {/* ... more alternative system fields */}
      </div>
    )}
  </div>
);
```

### Anti-Patterns to Avoid
- **Separate useForm per step:** Causes data loss between steps, requires manual state merging, and complicates final validation. Use a single `useForm()` with `trigger()` instead.
- **Auto-save with `watch()` at form root:** Causes full re-render on every keystroke. Use `useWatch()` in a dedicated child component or custom hook.
- **Server-side file uploads via Next.js API routes:** Next.js has a 1MB default body size limit for API routes. Upload directly to Supabase Storage from the browser client, then only send metadata to the API route.
- **Blocking navigation on validation failure:** CONTEXT.md explicitly says "warn-but-allow" -- highlight issues but let the tech navigate freely. Only enforce on final Submit.
- **Storing media files in the database:** Use Supabase Storage for files; only store the storage path in `inspection_media`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Form state management | Custom useState-based form | react-hook-form (already installed) | Handles dirty tracking, validation, error state, field registration |
| Schema validation | Custom validation functions | Zod v4 + zodResolver (already installed) | Type-safe, composable schemas, per-step validation with `trigger()` |
| File uploads to cloud | Custom upload handlers with presigned URLs | `supabase.storage.from().upload()` (already installed) | Handles auth, retries, progress; RLS policies for access control |
| Camera access on mobile | WebRTC/getUserMedia API | HTML `<input type="file" capture="environment">` | Native OS camera picker, works on all mobile browsers, handles permissions |
| Debounce logic | Custom setTimeout wrapper | Small inline implementation (8 lines) or lodash.debounce | Low complexity -- inline is fine, no need for a library |
| Progress indicator | Complex stepper library | Custom 5-dot component with Tailwind | Simple enough (5 divs with conditional classes) that a library is overkill |
| Toast notifications | Custom notification system | sonner (already installed) | Already in project, provides error/success toasts |

**Key insight:** The existing stack covers 90% of this phase's needs. The main implementation work is defining the Zod schemas that match the ADEQ form fields and building the step components with correct field mappings.

## Common Pitfalls

### Pitfall 1: JSONB Merge Clobbers Nested Data
**What goes wrong:** Auto-save sends the entire form object on every save, but if two saves overlap (race condition), the second overwrites the first's changes.
**Why it happens:** Drizzle's `update().set({ formData: newData })` replaces the entire JSONB value, not deep-merging.
**How to avoid:** Use PostgreSQL's `jsonb_concat` operator (`||`) for merging, or ensure saves are serialized (debounce + skip-if-unchanged check). The debounced approach with `lastSavedRef` comparison is simpler and sufficient for single-user editing.
**Warning signs:** Intermittent data loss when navigating quickly between steps.

### Pitfall 2: File Upload Fails Silently on Mobile
**What goes wrong:** Large photos from modern phone cameras (5-15MB) may fail to upload if the Supabase Storage bucket has a low file size limit.
**Why it happens:** Supabase free tier defaults to 50MB max per file; Pro plan allows up to 500GB. But photos from phones can be unexpectedly large, especially HEIC format.
**How to avoid:** Set bucket-level file size limit appropriately (at least 50MB for photos). Display upload progress and clear error messages. Consider client-side image compression for photos over 5MB (future optimization, not v1).
**Warning signs:** Upload spinner hangs indefinitely, no error shown.

### Pitfall 3: Video Duration Validation is Client-Side Only
**What goes wrong:** The 120-second video limit can only be enforced after the file is selected -- there is no standard HTML attribute to limit recording duration.
**Why it happens:** The `<input type="file" accept="video/*">` element opens the native camera app, which records without duration constraints.
**How to avoid:** After file selection, load the video into a `<video>` element to read `duration` before uploading. Reject files over 120 seconds with a clear message. This is a best-effort check -- users could still submit edited/trimmed videos.
**Warning signs:** Very large video files consuming storage; processing timeouts.

### Pitfall 4: useWatch Triggers Excessive Re-renders
**What goes wrong:** Placing `useWatch()` in the wizard root component causes the entire form to re-render on every keystroke.
**Why it happens:** `useWatch()` subscribes to form value changes and triggers re-renders in the component where it's called.
**How to avoid:** Isolate `useWatch()` in a dedicated `<AutoSaver />` child component or custom hook that does not render UI. This limits re-renders to that component only.
**Warning signs:** Laggy typing in form fields, especially on lower-end mobile devices.

### Pitfall 5: Lost Form Data on Accidental Navigation
**What goes wrong:** User taps browser back button or navigates away, losing unsaved changes.
**Why it happens:** Auto-save is debounced -- there may be a 1-second window of unsaved data.
**How to avoid:** Add a `beforeunload` event listener that flushes pending saves. Also consider `useEffect` cleanup that saves on unmount. The warn-but-allow approach already reduces this risk since data saves frequently.
**Warning signs:** Users report losing the last few fields they entered.

### Pitfall 6: Supabase Storage Bucket RLS Not Configured
**What goes wrong:** Authenticated users get 403 errors when uploading files.
**Why it happens:** Supabase Storage buckets are private by default. RLS policies on `storage.objects` must explicitly allow INSERT for authenticated users.
**How to avoid:** Create an `inspection-media` bucket with RLS policies: INSERT for authenticated users (scoped to their user ID path prefix), SELECT for authenticated users (scoped to inspections they own or are admin/office_staff).
**Warning signs:** First upload attempt fails with "new row violates row-level security policy."

## Code Examples

### Creating a New Inspection with Pre-filled Defaults
```typescript
// app/api/inspections/route.ts (POST handler)
import { db } from "@/lib/db";
import { inspections } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Pre-fill inspector info (FORM-04)
  const defaultFormData = {
    facilityInfo: {
      inspectorName: user.user_metadata?.full_name ?? "",
      company: "SewerTime Septic",
      certificationNumber: "NAWT #15805",
      registrationNumber: "CR-37",
      truckNumber: "ADEQ Truck #2833",
      facilityState: "AZ",
    },
    generalTreatment: {},
    designFlow: {},
    septicTank: {},
    disposalWorks: {},
  };

  const [newInspection] = await db
    .insert(inspections)
    .values({
      inspectorId: user.id,
      status: "draft",
      formData: defaultFormData,
    })
    .returning();

  return NextResponse.json(newInspection, { status: 201 });
}
```

### Auto-Save PATCH Endpoint
```typescript
// app/api/inspections/[id]/route.ts (PATCH handler)
import { db } from "@/lib/db";
import { inspections } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await request.json();

  // Update the entire formData JSONB (auto-save sends complete form state)
  await db
    .update(inspections)
    .set({
      formData,
      updatedAt: new Date(),
      // Update denormalized facility fields for dashboard display
      facilityName: formData.facilityInfo?.facilityName ?? null,
      facilityAddress: formData.facilityInfo?.facilityAddress ?? null,
      facilityCity: formData.facilityInfo?.facilityCity ?? null,
      facilityCounty: formData.facilityInfo?.facilityCounty ?? null,
      facilityZip: formData.facilityInfo?.facilityZip ?? null,
    })
    .where(eq(inspections.id, id));

  return NextResponse.json({ saved: true });
}
```

### Wizard Progress Dots
```typescript
// components/inspection/wizard-progress.tsx
const STEP_LABELS = [
  "Facility Info",
  "General Treatment",
  "Design Flow",
  "Septic Tank",
  "Disposal Works",
];

export function WizardProgress({
  currentStep,
  onStepClick,
}: {
  currentStep: number;
  onStepClick?: (step: number) => void;
}) {
  return (
    <div className="flex items-center justify-center gap-2 py-4">
      {STEP_LABELS.map((label, index) => (
        <button
          key={label}
          type="button"
          onClick={() => onStepClick?.(index)}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium transition-colors",
            index === currentStep
              ? "bg-primary text-primary-foreground"
              : index < currentStep
                ? "bg-primary/20 text-primary"
                : "bg-muted text-muted-foreground"
          )}
          aria-label={`Step ${index + 1}: ${label}`}
        >
          {index + 1}
        </button>
      ))}
    </div>
  );
}
```

### Supabase Storage Bucket Setup (SQL)
```sql
-- Create the inspection-media bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('inspection-media', 'inspection-media', false);

-- Allow authenticated users to upload to their own inspection folders
CREATE POLICY "Authenticated users can upload inspection media"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'inspection-media'
);

-- Allow authenticated users to view media from inspections
CREATE POLICY "Authenticated users can view inspection media"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'inspection-media'
);

-- Allow users to delete their own uploads
CREATE POLICY "Users can delete own inspection media"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'inspection-media'
);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Separate useForm per wizard step | Single useForm with trigger() per step | react-hook-form v7+ (2022+) | Simpler state management, no data loss between steps |
| zodResolver for Zod v3 only | zodResolver auto-detects Zod v3 and v4 | @hookform/resolvers v5 (2025) | Drop-in Zod v4 support, no migration needed |
| getUserMedia for camera access | HTML input with capture attribute | Well-supported since 2020+ | Simpler, more reliable, OS-level camera integration |
| formidable/multer for file uploads in Next.js | Native request.formData() in Route Handlers | Next.js 13+ App Router (2023+) | No additional middleware needed for file uploads |
| shadcn toast component | sonner | shadcn/ui 2024+ | toast was deprecated in favor of sonner |
| Zod v3 .errors property | Zod v4 .issues property | Zod v4 (2025) | Already handled in project (see STATE.md: Plan 01-02 decision) |

**Deprecated/outdated:**
- `@supabase/auth-helpers-nextjs`: Replaced by `@supabase/ssr` (already using correct package)
- shadcn `toast` component: Replaced by `sonner` (already using correct package)
- Zod v3 `z.enum()` parameter format: Updated in Zod v4 (already handled in project)

## Open Questions

1. **Exact ADEQ GWS 432 field inventory**
   - What we know: 5 sections confirmed (Facility Info, General Treatment, Design Flow, Septic Tank Inspection, Disposal Works). Reference PDF exists in project root (`Adeq Report1.pdf`).
   - What's unclear: The exact field-by-field inventory for each section needs to be extracted from the reference PDF during implementation. The PDF could not be read programmatically during research.
   - Recommendation: During planning, the planner should allocate a task to manually map every field from the reference PDF into the Zod schema. This is the most labor-intensive part of the phase.

2. **Supabase Storage bucket configuration**
   - What we know: Need a private bucket with RLS policies for authenticated uploads.
   - What's unclear: Whether the bucket already exists in the Supabase project, and what the current file size limits are configured to.
   - Recommendation: First task should check/create the bucket and set appropriate file size limits (50MB for photos, 200MB for video).

3. **Inspection `section` field on `inspection_media`**
   - What we know: The existing `inspection_media` table has a `label` field (text) and `sort_order` (integer).
   - What's unclear: Whether `label` is sufficient to associate media with a specific form section, or if a dedicated `section` column is needed.
   - Recommendation: Use the existing `label` column with a convention like "section-1", "section-2" etc., or repurpose it for a descriptive label and add a `section` field. Decide during planning.

## Sources

### Primary (HIGH confidence)
- react-hook-form official docs: `trigger()` API for per-step validation, `useWatch()` for efficient value observation, `mode: 'onBlur'` configuration
- Supabase official docs: Storage upload API (`supabase.storage.from().upload()`), Storage access control via RLS policies, bucket configuration
- shadcn/ui official component list: Switch, Checkbox, Textarea, Accordion, Progress, Separator confirmed available
- MDN Web Docs: HTML `<input type="file">` with `capture` and `accept` attributes for mobile camera access
- @hookform/resolvers GitHub: zodResolver v5+ auto-detects Zod v3/v4

### Secondary (MEDIUM confidence)
- ClarityDev blog: Multi-step form pattern with single useForm + trigger()
- LogRocket blog: Reusable multi-step form with react-hook-form and Zod
- Multiple community tutorials: Auto-save patterns with debounced useWatch

### Tertiary (LOW confidence)
- Video duration validation approach: Based on standard `<video>` element `duration` property -- works in theory but not verified for all mobile browsers and video codecs

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All core libraries already installed and verified in the codebase; versions confirmed from package.json
- Architecture: HIGH - Patterns are well-established (single useForm wizard, Supabase Storage uploads); consistent with existing project patterns (same API route style, same Supabase client usage)
- Pitfalls: HIGH - Based on official documentation (RLS policies, useWatch performance) and well-documented community patterns (auto-save debouncing, file upload limits)
- ADEQ form field mapping: MEDIUM - 5 sections confirmed but exact field inventory requires manual extraction from reference PDF

**Research date:** 2026-02-26
**Valid until:** 2026-03-26 (stable domain -- form libraries and Supabase Storage are mature)
