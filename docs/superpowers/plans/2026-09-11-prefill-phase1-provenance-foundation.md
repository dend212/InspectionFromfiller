# Property Records Prefill — Phase 1: Provenance Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the per-field provenance sidecar (types, merge rules, DB tables, routes, badge/chip/tile UI, provider) plus the prefill-run lifecycle with the Assessor stage live and Listing/Permits stubbed, so every value written by the APN lookup, the paper-form scan, or a prefill run carries a visible, persisted "where this came from" badge.

**Architecture:** `inspections.field_provenance` (jsonb) is a sidecar map keyed by react-hook-form dotted field path, written only through `PATCH /api/inspections/[id]/provenance`; `form_data` stays client-written. A prefill run is a row in `inspection_prefill_runs` created by `POST /api/inspections/[id]/prefill`, executed in `after()` by `runPrefill()` which runs three independent stages and stores `ProposedField[]`; the client hook polls the run, applies proposals through the pure `mergeProposals()` (fill above 0.75 confidence into empty fields, otherwise suggestion chip), and the `ProvenanceProvider` renders badges/chips through `FormLabel`/`FormItem` with no per-field changes.

**Tech Stack:** Next.js 16.1 App Router, React 19, TypeScript, react-hook-form 7, zod 4, Drizzle ORM over `postgres`, Supabase Auth, `radix-ui` monolithic package + shadcn/ui, lucide-react, Vitest 4 + jsdom + @testing-library/react.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-11-property-records-prefill-design.md` (this plan = §13 item 1). Shared contracts: `docs/superpowers/plans/2026-09-11-prefill-shared-contracts.md` — every name, type, SQL statement and route in this plan is copied from there verbatim; do not rename.
- Branch: `feature/property-records-prefill`. Deploy = push to `main`; **never push `main` without Daniel's explicit per-deploy approval**.
- No server-side writes to `form_data`; the client is the single writer. Provenance is a whole-map replace through its own route; the existing raw-body `PATCH /api/inspections/[id]` keeps its shape.
- Background work: `import { after } from "next/server"` and `after(() => work())` inside the handler; route files that start background work add `export const maxDuration = 300;`. Never leave a floating promise (Vercel freezes the function once the response is sent).
- Confidence gate: `PREFILL_FILL_THRESHOLD = 0.75`. User input is never overwritten. Rate limit: `MAX_PREFILL_RUNS_PER_HOUR = 3` per inspection, DB-backed. Lock: 409 while a run is `queued|running` and younger than 5 minutes; older stuck runs are marked `failed` / `"Timed out"`.
- Badges are `<button aria-label="Prefilled from <source label>, NN% confidence">` with visible text always present — colour is never the only signal. Popover opens on tap (no hover requirement).
- Provider persists with a 1 s debounce via the provenance route; no-op when `readOnly`.
- Source colours (`src/lib/prefill/sources.ts`): assessor `bg-blue-500`, permit `bg-amber-500`, listing `bg-violet-500`, scan `bg-green-600`; edited `bg-gray-400`; verified `bg-emerald-600`.
- Security: outbound calls only to `gis.mcassessor.maricopa.gov` in this phase; user-supplied APN validated (`isValidApn`: ≤ 20 chars, `[0-9A-Za-z -]`, contains a digit) and street names normalised to `[A-Z0-9 ]` before being placed in an ArcGIS `where` clause; `sourceUrl` in provenance must start with `https://` or `/api/` (rendered as `<a href>`); all new routes use the existing auth pattern (`createClient()` → `getUser()` → 401; `checkInspectionAccess` → 403; non-privileged edits only on drafts).
- Import primitives as `import { Popover as PopoverPrimitive } from "radix-ui"`. Do **not** run `biome --write` on touched files; edit by hand in the surrounding style.
- Migrations: SQL in `src/lib/db/migrations/` (this phase adds **0015**), applied to the remote DB with `node --env-file=.env.local scripts/apply-prefill-migration.mjs`, verified via `information_schema.columns`. `.env.local` does not exist locally — `npx vercel env pull .env.local`. Never run a migration without verifying afterwards.
- Type gate: `npm run build` with placeholder `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_APP_URL`. `npx tsc --noEmit` has pre-existing errors — ignore. ~15 pre-existing vitest failures live in untouched files (nav/roles/rbac, review-actions, reopen/download routes, inspection.test STEP_FIELDS + tank schema); the bar is **no new failures**.
- Field paths use react-hook-form's dotted form (`septicTank.tanks.0.tankCapacity`); the scan flow's bracket form (`septicTank.tanks[0].tankCapacity`) is normalised with `normalizeFieldPath` before it becomes a provenance key.
- Verified live on 2026-09-11 while writing this plan: the ArcGIS Parcels layer has `PHYSICAL_STREET_NUM`, `PHYSICAL_STREET_DIR`, `PHYSICAL_STREET_NAME` (no suffix) and `PHYSICAL_STREET_TYPE`; `where=PHYSICAL_STREET_NUM='8911' AND PHYSICAL_STREET_NAME LIKE 'CAVE CREEK%'` returns parcel `219-11-121`; `https://mcassessor.maricopa.gov/mcs/?q=219-11-121` returns HTTP 200. `PHYSICAL_ADDRESS` comes back as `"8911 E CAVE CREEK RD   CAREFREE  85377"` (city/zip appended after runs of spaces) — Task 4 trims that.
- Also verified in a scratch vitest run against this repo's `node_modules`: Radix `Popover` opens in jsdom 28 without a `ResizeObserver` stub; `form.watch(cb)` returns `{ unsubscribe }` and reports the changed `name`; the real `after()` from `next/server` throws outside a request scope (so route tests mock it); `getTableColumns` comes from `drizzle-orm` and columns expose `.name`, `.notNull`, `.default`.

**Before you start** (from the repo root, on `feature/property-records-prefill` at commit `de3d3bc`): record the pre-existing vitest failures so Task 16 can prove "no new failures":

```bash
npx vitest run 2>&1 | grep -E "^ (FAIL|❯) " | sort > /tmp/vitest-baseline.txt
wc -l /tmp/vitest-baseline.txt
```

Expected: roughly 8–10 lines (the ~15 failing tests are spread across those files).

---

## File Structure

**New — `src/lib/prefill/` (server + isomorphic pure modules)**

| File | Responsibility |
|---|---|
| `types.ts` | All prefill/provenance types and constants (verbatim from contracts) |
| `sources.ts` | Source labels/colours (verbatim) |
| `stage.ts` | `StageResult` / `StageContext` interfaces shared by stage modules and the orchestrator |
| `provenance-schema.ts` | Zod validation for `FieldProvenance` (provenance PATCH body) |
| `merge.ts` | Pure: `mergeProposals`, `getPath`, `isEmptyValue`, `valuesEqual`, `normalizeFieldPath` |
| `input.ts` | Pure: APN validation, street-address parsing/normalisation, `prefillStartBodySchema`, `buildPrefillInput` |
| `assessor-fields.ts` | Pure, client-safe: `AssessorSummary`, `assessorParcelUrl`, `assessorProposals` |
| `assessor.ts` | Server: ArcGIS parcel queries (`queryParcelByApn`, `findParcelByAddress`, `mapParcelToAssessor`) + `runAssessorStage` |
| `listing/index.ts`, `permits/index.ts` | Phase-1 stubs returning `skipped` (replaced in phases 2–4) |
| `run-store.ts` | Drizzle data access for `inspection_prefill_runs` / `inspection_records` (count, lock, create, load, update) |
| `run-dto.ts` | Row → `PrefillRunDTO` mapping + `loadRunDTO` / `loadLatestRunDTO` |
| `run-prefill.ts` | Orchestrator: `runPrefill`, `continuePrefillAfterSelection` |
| `route-access.ts` | `requireInspectionAccess(id, "view" | "edit")` shared by the six new routes |

**New — routes under `src/app/api/inspections/[id]/`**: `provenance/route.ts` (PATCH), `prefill/route.ts` (POST), `prefill/latest/route.ts` (GET), `prefill/[runId]/route.ts` (GET), `prefill/[runId]/applied/route.ts` (POST), `prefill/[runId]/select/route.ts` (POST).

**New — `src/components/prefill/`**: `provenance-context.tsx`, `provenance-badge.tsx`, `suggestion-chip.tsx`, `format.ts`, `prefill-sources-tile.tsx`, `use-prefill.ts`, `prefill-panel.tsx`. **New — `src/components/ui/popover.tsx`**.

**Modified**: `src/lib/db/schema.ts`, `src/app/api/apn-lookup/route.ts`, `src/components/ui/form.tsx`, `src/components/inspection/apn-lookup-input.tsx`, `src/components/inspection/inspection-wizard.tsx`, `src/components/inspection/scan-review-modal.tsx`, `src/hooks/use-form-scan.ts`, `src/app/(dashboard)/inspections/[id]/edit/page.tsx`.

**New — ops**: `src/lib/db/migrations/0015_prefill_runs_records_provenance.sql`, `scripts/apply-prefill-migration.mjs`.

**Testing conventions used throughout** (mirroring the repo): route tests live in `__tests__/route.test.ts` beside the route and mock `@/lib/supabase/server` (with `vi.hoisted`), `@/lib/db` (chainable objects whose terminal method returns a hoisted `vi.fn()`), `@/lib/db/schema` (plain column-name objects) and `drizzle-orm` (`eq`/`and` → plain objects); role is faked by encoding `{ user_role }` into a base64 JWT payload for `getSession`. `next/server`'s `after()` throws outside a request scope, so route tests that start background work mock it with `vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal()), after: mockAfter }))`. Component tests use a real `useForm` inside a wrapper. Run a single file with `npx vitest run <path>`.

---

### Task 1: Prefill types, source metadata, stage contract, provenance Zod schema

**Files:**
- Create: `src/lib/prefill/types.ts`
- Create: `src/lib/prefill/sources.ts`
- Create: `src/lib/prefill/stage.ts`
- Create: `src/lib/prefill/provenance-schema.ts`
- Test: `src/lib/prefill/__tests__/sources.test.ts`
- Test: `src/lib/prefill/__tests__/provenance-schema.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces: every type in the contracts (`ProvenanceEntry`, `FieldProvenance`, `ProposedField`, `PrefillRunDTO`, `PrefillStage`, `PrefillStages`, `PrefillInput`, `PrefillAddress`, `PermitCandidate`, `InspectionRecordDTO`, …), constants (`PREFILL_FILL_THRESHOLD = 0.75`, `MAX_PREFILL_RUNS_PER_HOUR = 3`, …), `emptyStages(): PrefillStages`, `SOURCE_META`, `EDITED_DOT_CLASS`, `VERIFIED_DOT_CLASS`, `StageResult`, `StageContext`, `provenanceEntrySchema`, `fieldProvenanceSchema`, `provenancePatchBodySchema`, `MAX_PROVENANCE_ENTRIES = 500`.

- [ ] **Step 1: Write the failing tests**

`src/lib/prefill/__tests__/sources.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { EDITED_DOT_CLASS, SOURCE_META, VERIFIED_DOT_CLASS } from "@/lib/prefill/sources";
import {
  emptyStages,
  MAX_PREFILL_RUNS_PER_HOUR,
  PREFILL_FILL_THRESHOLD,
} from "@/lib/prefill/types";

describe("SOURCE_META", () => {
  it("has a label, dot colour and accent for every source", () => {
    for (const source of ["assessor", "permit", "listing", "scan"] as const) {
      expect(SOURCE_META[source].label).toBeTruthy();
      expect(SOURCE_META[source].dotClass).toMatch(/^bg-/);
      expect(SOURCE_META[source].accentClass).toContain("border-");
    }
  });

  it("uses the spec colours", () => {
    expect(SOURCE_META.assessor.dotClass).toBe("bg-blue-500");
    expect(SOURCE_META.permit.dotClass).toBe("bg-amber-500");
    expect(SOURCE_META.listing.dotClass).toBe("bg-violet-500");
    expect(SOURCE_META.scan.dotClass).toBe("bg-green-600");
    expect(EDITED_DOT_CLASS).toBe("bg-gray-400");
    expect(VERIFIED_DOT_CLASS).toBe("bg-emerald-600");
  });
});

describe("types helpers", () => {
  it("emptyStages returns three independent pending stages with empty links", () => {
    const stages = emptyStages();
    expect(Object.keys(stages).sort()).toEqual(["assessor", "listing", "permits"]);
    for (const stage of Object.values(stages)) {
      expect(stage).toEqual({ status: "pending", links: [] });
    }
    expect(stages.assessor).not.toBe(stages.listing);
    expect(stages.assessor.links).not.toBe(stages.listing.links);
  });

  it("exposes the spec thresholds", () => {
    expect(PREFILL_FILL_THRESHOLD).toBe(0.75);
    expect(MAX_PREFILL_RUNS_PER_HOUR).toBe(3);
  });
});
```

`src/lib/prefill/__tests__/provenance-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  fieldProvenanceSchema,
  MAX_PROVENANCE_ENTRIES,
  provenanceEntrySchema,
  provenancePatchBodySchema,
} from "@/lib/prefill/provenance-schema";

const VALID = {
  source: "permit",
  state: "prefilled",
  kind: "fill",
  value: "1250",
  confidence: 0.92,
  explanation: "Permit OW-17-00474 · Discharge Authorization p.1",
  evidence: "Septic Tank Qty 1 Capacity 1250",
  sourceUrl: "/api/inspections/insp-1/records/rec-1#page=1",
  recordId: "rec-1",
  page: 1,
  runId: "run-1",
  at: "2026-09-11T10:00:00.000Z",
};

describe("provenanceEntrySchema", () => {
  it("accepts a complete entry", () => {
    expect(provenanceEntrySchema.safeParse(VALID).success).toBe(true);
  });

  it("accepts boolean and string[] values", () => {
    expect(provenanceEntrySchema.safeParse({ ...VALID, value: true }).success).toBe(true);
    expect(provenanceEntrySchema.safeParse({ ...VALID, value: ["a", "b"] }).success).toBe(true);
  });

  it("accepts a minimal entry without optional fields", () => {
    const { evidence, sourceUrl, recordId, page, runId, ...minimal } = VALID;
    void evidence;
    void sourceUrl;
    void recordId;
    void page;
    void runId;
    expect(provenanceEntrySchema.safeParse(minimal).success).toBe(true);
  });

  it("rejects unknown sources, states and kinds", () => {
    expect(provenanceEntrySchema.safeParse({ ...VALID, source: "zillow" }).success).toBe(false);
    expect(provenanceEntrySchema.safeParse({ ...VALID, state: "maybe" }).success).toBe(false);
    expect(provenanceEntrySchema.safeParse({ ...VALID, kind: "note" }).success).toBe(false);
  });

  it("rejects confidence outside 0–1 and numeric values", () => {
    expect(provenanceEntrySchema.safeParse({ ...VALID, confidence: 1.2 }).success).toBe(false);
    expect(provenanceEntrySchema.safeParse({ ...VALID, confidence: -0.1 }).success).toBe(false);
    expect(provenanceEntrySchema.safeParse({ ...VALID, value: 1250 }).success).toBe(false);
  });

  it("only allows https:// or /api/ source URLs (never javascript: or http:)", () => {
    expect(
      provenanceEntrySchema.safeParse({ ...VALID, sourceUrl: "javascript:alert(1)" }).success,
    ).toBe(false);
    expect(
      provenanceEntrySchema.safeParse({ ...VALID, sourceUrl: "http://example.com" }).success,
    ).toBe(false);
    expect(
      provenanceEntrySchema.safeParse({
        ...VALID,
        sourceUrl: "https://mcassessor.maricopa.gov/mcs/?q=219-11-121",
      }).success,
    ).toBe(true);
  });
});

describe("fieldProvenanceSchema", () => {
  it("accepts dotted keys including array indexes", () => {
    expect(
      fieldProvenanceSchema.safeParse({ "septicTank.tanks.0.tankCapacity": VALID }).success,
    ).toBe(true);
  });

  it("rejects bracket keys (must be normalised first)", () => {
    expect(
      fieldProvenanceSchema.safeParse({ "septicTank.tanks[0].tankCapacity": VALID }).success,
    ).toBe(false);
  });

  it("rejects more than MAX_PROVENANCE_ENTRIES entries", () => {
    const tooMany: Record<string, typeof VALID> = {};
    for (let i = 0; i <= MAX_PROVENANCE_ENTRIES; i++) {
      tooMany[`facilityInfo.f${i}`] = VALID;
    }
    expect(fieldProvenanceSchema.safeParse(tooMany).success).toBe(false);
  });
});

describe("provenancePatchBodySchema", () => {
  it("requires fieldProvenance", () => {
    expect(provenancePatchBodySchema.safeParse({}).success).toBe(false);
    expect(provenancePatchBodySchema.safeParse({ fieldProvenance: {} }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/prefill/__tests__/sources.test.ts src/lib/prefill/__tests__/provenance-schema.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/prefill/sources"` / `"@/lib/prefill/provenance-schema"`.

- [ ] **Step 3: Create the four modules**

`src/lib/prefill/types.ts` (verbatim from the shared contracts):

```ts
/** Where a prefilled value came from. Colours/labels in ./sources.ts */
export type PrefillSource = "assessor" | "permit" | "listing" | "scan";

/** Lifecycle of a provenance entry for one field */
export type ProvenanceState = "prefilled" | "suggested" | "edited" | "verified";

export type ProvenanceValue = string | boolean | string[];

/** `fill` proposes a value; `warning` only carries a message (never writes a value) */
export type ProposalKind = "fill" | "warning";

export interface ProvenanceEntry {
  source: PrefillSource;
  state: ProvenanceState;
  kind: ProposalKind;
  /** The value we proposed (for `warning`, the empty string) */
  value: ProvenanceValue;
  /** 0–1 */
  confidence: number;
  /** One line shown in the popover, e.g. "Permit OW-17-00474 · Discharge Authorization p.1" */
  explanation: string;
  /** Verbatim quote from the source, if any */
  evidence?: string;
  /** Link to the source: Zillow URL, assessor page, or /api/inspections/{id}/records/{recordId}#page=N */
  sourceUrl?: string;
  recordId?: string;
  page?: number;
  runId?: string;
  /** ISO timestamp of when the entry was written/updated */
  at: string;
}

/** Keyed by dotted form field path, e.g. "septicTank.tankCapacity" */
export type FieldProvenance = Record<string, ProvenanceEntry>;

/** What a prefill stage proposes for one field; the client merges these into the form */
export interface ProposedField {
  fieldPath: string;
  value: ProvenanceValue;
  kind: ProposalKind;
  provenance: Omit<ProvenanceEntry, "state" | "value" | "at" | "kind">;
}

export type PrefillTrigger = "apn_lookup" | "manual" | "webhook";
export type PrefillRunStatus = "queued" | "running" | "awaiting_selection" | "done" | "failed";
export type StageStatus = "pending" | "running" | "done" | "not_found" | "error" | "skipped";

export interface StageLink {
  label: string;
  url: string;
}

export interface PrefillStage {
  status: StageStatus;
  startedAt?: string;
  finishedAt?: string;
  /** One line for the tile, e.g. "2 permits found" / "No Zillow listing found for 8911 E Cave Creek Rd" */
  summary?: string;
  error?: string;
  links: StageLink[];
}

export interface PrefillStages {
  assessor: PrefillStage;
  listing: PrefillStage;
  permits: PrefillStage;
}

export interface PrefillAddress {
  streetNumber: string;
  streetName: string;
  streetDir?: string;
  city?: string;
  zip?: string;
  /** Single-line address for the listing lookup, e.g. "8911 E Cave Creek Rd, Carefree, AZ 85377" */
  full?: string;
}

export interface PrefillInput {
  apn?: string;
  address?: PrefillAddress;
  subdivision?: string;
  lot?: string;
}

export type PermitArchive = "edms_env" | "edms_eplpav";

/**
 * A permit document we might extract from. `key` is stable across searches
 * (EDMS document IDs are ephemeral and are never persisted).
 */
export interface PermitCandidate {
  /** `${archive}:${permitNumber}:${docType}:${docDate ?? ""}` */
  key: string;
  archive: PermitArchive;
  permitNumber: string;
  docType: string;
  docDate?: string;
  description?: string;
  streetAddress?: string;
  city?: string;
  zip?: string;
  subdivision?: string;
  lot?: string;
  apn?: string;
  score: number;
}

export type ExtractionStatus = "pending" | "done" | "skipped" | "failed";

export interface InspectionRecordDTO {
  id: string;
  source: PermitArchive;
  permitNumber: string;
  docType: string;
  docDate: string | null;
  description: string | null;
  pageCount: number | null;
  sizeBytes: number | null;
  selected: boolean;
  extractionStatus: ExtractionStatus;
  extractionError: string | null;
  isAbandonment: boolean;
  /** Auth-gated route that 302s to a signed URL */
  downloadUrl: string;
}

export interface PrefillRunDTO {
  id: string;
  inspectionId: string;
  trigger: PrefillTrigger;
  status: PrefillRunStatus;
  input: PrefillInput;
  stages: PrefillStages;
  proposals: ProposedField[];
  candidates: PermitCandidate[];
  error: string | null;
  appliedAt: string | null;
  createdAt: string;
  finishedAt: string | null;
  records: InspectionRecordDTO[];
}

/** Values at or above this confidence fill the field directly; below → suggestion chip */
export const PREFILL_FILL_THRESHOLD = 0.75;
/** Handwritten facts below this confidence are re-asked on the stronger model */
export const HANDWRITING_ESCALATION_THRESHOLD = 0.6;
/** Max prefill runs per inspection per rolling hour */
export const MAX_PREFILL_RUNS_PER_HOUR = 3;
/** Max permit documents extracted per run */
export const MAX_DOCUMENTS_PER_RUN = 3;
/** Skip documents larger than this (bytes) — Claude request cap is 32 MB */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

export function emptyStages(): PrefillStages {
  const s = (): PrefillStage => ({ status: "pending", links: [] });
  return { assessor: s(), listing: s(), permits: s() };
}
```

`src/lib/prefill/sources.ts` (verbatim):

```ts
import type { PrefillSource } from "./types";

export interface SourceMeta {
  label: string;
  /** Tailwind classes for the badge dot */
  dotClass: string;
  /** Tailwind classes for chips/borders */
  accentClass: string;
}

export const SOURCE_META: Record<PrefillSource, SourceMeta> = {
  assessor: { label: "County Assessor", dotClass: "bg-blue-500", accentClass: "border-blue-300 text-blue-800 bg-blue-50" },
  permit: { label: "Permit records", dotClass: "bg-amber-500", accentClass: "border-amber-300 text-amber-900 bg-amber-50" },
  listing: { label: "Listing", dotClass: "bg-violet-500", accentClass: "border-violet-300 text-violet-900 bg-violet-50" },
  scan: { label: "Scanned form", dotClass: "bg-green-600", accentClass: "border-green-300 text-green-900 bg-green-50" },
};

export const EDITED_DOT_CLASS = "bg-gray-400";
export const VERIFIED_DOT_CLASS = "bg-emerald-600";
```

`src/lib/prefill/stage.ts` (the `StageResult`/`StageContext` contract from the orchestrator section):

```ts
import type { PrefillStage, ProposedField } from "./types";

/** What every stage module returns. Stages never throw — errors become `stage.status = "error"`. */
export interface StageResult {
  stage: PrefillStage;
  proposals: ProposedField[];
}

export interface StageContext {
  inspectionId: string;
  runId: string;
  /** AbortSignal that fires at the 240 s total budget */
  signal: AbortSignal;
  /** Persist a partial stage update so the client sees progress */
  progress: (stage: Partial<PrefillStage>) => Promise<void>;
}
```

`src/lib/prefill/provenance-schema.ts`:

```ts
import { z } from "zod";

/** The form has ~150 fields; 500 leaves room for per-tank array fields */
export const MAX_PROVENANCE_ENTRIES = 500;

/** Rendered as <a href> in the badge popover — only https:// and our own /api/ paths, never javascript:/data:/http: */
const sourceUrlSchema = z
  .string()
  .max(2048)
  .refine((u) => u.startsWith("https://") || u.startsWith("/api/"), {
    message: "sourceUrl must start with https:// or /api/",
  });

export const provenanceValueSchema = z.union([
  z.string().max(5000),
  z.boolean(),
  z.array(z.string().max(500)).max(100),
]);

export const provenanceEntrySchema = z.object({
  source: z.enum(["assessor", "permit", "listing", "scan"]),
  state: z.enum(["prefilled", "suggested", "edited", "verified"]),
  kind: z.enum(["fill", "warning"]),
  value: provenanceValueSchema,
  confidence: z.number().min(0).max(1),
  explanation: z.string().max(500),
  evidence: z.string().max(1000).optional(),
  sourceUrl: sourceUrlSchema.optional(),
  recordId: z.string().max(64).optional(),
  page: z.number().int().positive().optional(),
  runId: z.string().max(64).optional(),
  at: z.string().max(40),
});

/** Keys are react-hook-form dotted paths: "facilityInfo.waterSource", "septicTank.tanks.0.tankCapacity" */
const fieldPathKeySchema = z
  .string()
  .max(120)
  .regex(/^[A-Za-z][A-Za-z0-9_.]*$/, "Invalid field path");

export const fieldProvenanceSchema = z
  .record(fieldPathKeySchema, provenanceEntrySchema)
  .refine((map) => Object.keys(map).length <= MAX_PROVENANCE_ENTRIES, {
    message: `At most ${MAX_PROVENANCE_ENTRIES} provenance entries`,
  });

export const provenancePatchBodySchema = z.object({
  fieldProvenance: fieldProvenanceSchema,
});

export type ProvenancePatchBody = z.infer<typeof provenancePatchBodySchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/prefill/__tests__/sources.test.ts src/lib/prefill/__tests__/provenance-schema.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/prefill/types.ts src/lib/prefill/sources.ts src/lib/prefill/stage.ts src/lib/prefill/provenance-schema.ts src/lib/prefill/__tests__/sources.test.ts src/lib/prefill/__tests__/provenance-schema.test.ts
git commit -m "feat(prefill): add provenance/prefill types, source metadata and provenance zod schema"
```

---

### Task 2: Pure merge rules (`merge.ts`)

**Files:**
- Create: `src/lib/prefill/merge.ts`
- Test: `src/lib/prefill/__tests__/merge.test.ts`

**Interfaces:**
- Consumes: `PREFILL_FILL_THRESHOLD`, `FieldProvenance`, `ProposedField`, `ProvenanceEntry` from Task 1.
- Produces:
  - `mergeProposals(formData: InspectionFormData, provenance: FieldProvenance, proposals: ProposedField[], opts: { runId: string; now?: string }): MergeResult` where `MergeResult = { fills: Array<{ fieldPath: string; value: ProvenanceValue }>; provenance: FieldProvenance }`
  - `getPath(obj: unknown, path: string): unknown`
  - `isEmptyValue(v: unknown): boolean`
  - `valuesEqual(a: unknown, b: unknown): boolean`
  - `normalizeFieldPath(path: string): string` — `a[0].b` → `a.0.b`

Merge decision table (spec §7, plus one clarification for the equal-value case that the spec leaves implicit):

| Situation | Result |
|---|---|
| `kind: "warning"` | entry `state: "suggested"`, `value: ""`, no fill |
| existing entry `verified` or `edited` | `suggested` |
| `confidence < 0.75` | `suggested` |
| existing `prefilled`, form value no longer equals the earlier proposed value | `suggested` |
| existing `prefilled`, form still equals earlier value, new confidence higher | replace entry (`prefilled`), fill only if the value differs |
| existing `prefilled`, same value, confidence not higher | leave existing entry untouched |
| no/`suggested` entry, form value empty | fill + `prefilled` |
| no/`suggested` entry, form value equals the proposal | `prefilled` entry, no fill (source corroborates the value; nothing is overwritten) |
| otherwise (occupied by a different value) | `suggested` |

- [ ] **Step 1: Write the failing tests**

`src/lib/prefill/__tests__/merge.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  getPath,
  isEmptyValue,
  mergeProposals,
  normalizeFieldPath,
  valuesEqual,
} from "@/lib/prefill/merge";
import type { FieldProvenance, ProposedField, ProvenanceEntry } from "@/lib/prefill/types";
import { getDefaultFormValues } from "@/lib/validators/inspection";
import type { InspectionFormData } from "@/types/inspection";

const NOW = "2026-09-11T10:00:00.000Z";
const OPTS = { runId: "run-1", now: NOW };

function form(patch: (f: InspectionFormData) => void = () => {}): InspectionFormData {
  const f = getDefaultFormValues("Tech") as unknown as InspectionFormData;
  patch(f);
  return f;
}

function proposal(
  fieldPath: string,
  value: ProposedField["value"],
  confidence = 0.9,
  over: Partial<ProposedField> = {},
): ProposedField {
  return {
    fieldPath,
    value,
    kind: "fill",
    provenance: { source: "permit", confidence, explanation: "Permit OW-17-00474 p.1" },
    ...over,
  };
}

function entry(over: Partial<ProvenanceEntry> = {}): ProvenanceEntry {
  return {
    source: "scan",
    state: "prefilled",
    kind: "fill",
    value: "3",
    confidence: 0.8,
    explanation: "Scanned form · Page 1",
    at: "2026-09-10T00:00:00.000Z",
    ...over,
  };
}

describe("normalizeFieldPath", () => {
  it("rewrites bracket indexes to dotted segments", () => {
    expect(normalizeFieldPath("septicTank.tanks[0].tankCapacity")).toBe(
      "septicTank.tanks.0.tankCapacity",
    );
    expect(normalizeFieldPath("facilityInfo.waterSource")).toBe("facilityInfo.waterSource");
  });
});

describe("getPath", () => {
  it("reads nested and array paths in either notation", () => {
    const f = form((d) => {
      d.designFlow.numberOfBedrooms = "3";
      d.septicTank.tanks = [{ tankCapacity: "1250" } as InspectionFormData["septicTank"]["tanks"][0]];
    });
    expect(getPath(f, "designFlow.numberOfBedrooms")).toBe("3");
    expect(getPath(f, "septicTank.tanks.0.tankCapacity")).toBe("1250");
    expect(getPath(f, "septicTank.tanks[0].tankCapacity")).toBe("1250");
  });

  it("returns undefined for missing segments and non-objects", () => {
    expect(getPath({ a: 1 }, "a.b")).toBeUndefined();
    expect(getPath(null, "a")).toBeUndefined();
    expect(getPath({ a: { b: null } }, "a.b.c")).toBeUndefined();
  });
});

describe("isEmptyValue", () => {
  it("treats '', whitespace, [], false, null and undefined as empty", () => {
    for (const v of ["", "   ", [], false, null, undefined]) expect(isEmptyValue(v)).toBe(true);
  });
  it("treats '0', 'AZ', true and non-empty arrays as not empty", () => {
    for (const v of ["0", "AZ", true, ["x"]]) expect(isEmptyValue(v)).toBe(false);
  });
});

describe("valuesEqual", () => {
  it("trims strings, compares arrays element-wise, strict otherwise", () => {
    expect(valuesEqual(" 1250 ", "1250")).toBe(true);
    expect(valuesEqual(["a", "b"], ["a", "b"])).toBe(true);
    expect(valuesEqual(["a"], ["a", "b"])).toBe(false);
    expect(valuesEqual(true, true)).toBe(true);
    expect(valuesEqual("1", 1)).toBe(false);
  });
});

describe("mergeProposals", () => {
  it("turns a warning into a suggested entry with an empty value and no fill", () => {
    const warning: ProposedField = {
      fieldPath: "facilityInfo.wastewaterSource",
      value: "",
      kind: "warning",
      provenance: {
        source: "listing",
        confidence: 0.8,
        explanation: 'Listing says "Sewer" — confirm this property is on septic',
      },
    };
    const { fills, provenance } = mergeProposals(form(), {}, [warning], OPTS);
    expect(fills).toEqual([]);
    expect(provenance["facilityInfo.wastewaterSource"]).toMatchObject({
      state: "suggested",
      kind: "warning",
      value: "",
      runId: "run-1",
      at: NOW,
    });
  });

  it("fills an empty field when confidence meets the threshold", () => {
    const { fills, provenance } = mergeProposals(
      form(),
      {},
      [proposal("designFlow.numberOfBedrooms", "3", 0.75)],
      OPTS,
    );
    expect(fills).toEqual([{ fieldPath: "designFlow.numberOfBedrooms", value: "3" }]);
    expect(provenance["designFlow.numberOfBedrooms"]).toMatchObject({
      source: "permit",
      state: "prefilled",
      kind: "fill",
      value: "3",
      confidence: 0.75,
      runId: "run-1",
      at: NOW,
    });
  });

  it("suggests instead of filling below the threshold", () => {
    const { fills, provenance } = mergeProposals(
      form(),
      {},
      [proposal("designFlow.numberOfBedrooms", "3", 0.61)],
      OPTS,
    );
    expect(fills).toEqual([]);
    expect(provenance["designFlow.numberOfBedrooms"].state).toBe("suggested");
  });

  it("never overwrites a different existing value — it suggests", () => {
    const f = form((d) => {
      d.designFlow.numberOfBedrooms = "4";
    });
    const { fills, provenance } = mergeProposals(
      f,
      {},
      [proposal("designFlow.numberOfBedrooms", "3", 0.95)],
      OPTS,
    );
    expect(fills).toEqual([]);
    expect(provenance["designFlow.numberOfBedrooms"]).toMatchObject({
      state: "suggested",
      value: "3",
    });
  });

  it("records a prefilled entry without a fill when the field already holds the proposed value", () => {
    const f = form((d) => {
      d.facilityInfo.facilityName = "JOHN DOE";
    });
    const { fills, provenance } = mergeProposals(
      f,
      {},
      [proposal("facilityInfo.facilityName", "JOHN DOE", 1)],
      OPTS,
    );
    expect(fills).toEqual([]);
    expect(provenance["facilityInfo.facilityName"].state).toBe("prefilled");
  });

  it("turns proposals for verified or edited fields into suggestions", () => {
    const f = form((d) => {
      d.designFlow.numberOfBedrooms = "3";
    });
    for (const state of ["verified", "edited"] as const) {
      const existing: FieldProvenance = { "designFlow.numberOfBedrooms": entry({ state }) };
      const { fills, provenance } = mergeProposals(
        f,
        existing,
        [proposal("designFlow.numberOfBedrooms", "5", 0.99)],
        OPTS,
      );
      expect(fills).toEqual([]);
      expect(provenance["designFlow.numberOfBedrooms"]).toMatchObject({
        state: "suggested",
        value: "5",
        source: "permit",
      });
    }
  });

  it("replaces a prefilled entry with a higher-confidence proposal while the value is still ours", () => {
    const f = form((d) => {
      d.designFlow.numberOfBedrooms = "3";
    });
    const existing: FieldProvenance = {
      "designFlow.numberOfBedrooms": entry({ value: "3", confidence: 0.8 }),
    };
    const { fills, provenance } = mergeProposals(
      f,
      existing,
      [proposal("designFlow.numberOfBedrooms", "4", 0.95)],
      OPTS,
    );
    expect(fills).toEqual([{ fieldPath: "designFlow.numberOfBedrooms", value: "4" }]);
    expect(provenance["designFlow.numberOfBedrooms"]).toMatchObject({
      source: "permit",
      state: "prefilled",
      value: "4",
      confidence: 0.95,
    });
  });

  it("leaves a prefilled entry untouched when the same value arrives with no better confidence", () => {
    const f = form((d) => {
      d.designFlow.numberOfBedrooms = "3";
    });
    const old = entry({ value: "3", confidence: 0.8 });
    const existing: FieldProvenance = { "designFlow.numberOfBedrooms": old };
    for (const confidence of [0.8, 0.76]) {
      const { fills, provenance } = mergeProposals(
        f,
        existing,
        [proposal("designFlow.numberOfBedrooms", "3", confidence)],
        OPTS,
      );
      expect(fills).toEqual([]);
      expect(provenance["designFlow.numberOfBedrooms"]).toBe(old);
    }
  });

  it("suggests when a prefilled field was changed by the user since", () => {
    const f = form((d) => {
      d.designFlow.numberOfBedrooms = "6";
    });
    const existing: FieldProvenance = {
      "designFlow.numberOfBedrooms": entry({ value: "3", confidence: 0.8 }),
    };
    const { fills, provenance } = mergeProposals(
      f,
      existing,
      [proposal("designFlow.numberOfBedrooms", "4", 0.99)],
      OPTS,
    );
    expect(fills).toEqual([]);
    expect(provenance["designFlow.numberOfBedrooms"].state).toBe("suggested");
  });

  it("re-evaluates an existing suggestion and fills once the field is empty", () => {
    const existing: FieldProvenance = {
      "designFlow.numberOfBedrooms": entry({ state: "suggested", value: "3" }),
    };
    const { fills, provenance } = mergeProposals(
      form(),
      existing,
      [proposal("designFlow.numberOfBedrooms", "3", 0.9)],
      OPTS,
    );
    expect(fills).toEqual([{ fieldPath: "designFlow.numberOfBedrooms", value: "3" }]);
    expect(provenance["designFlow.numberOfBedrooms"].state).toBe("prefilled");
  });

  it("normalises bracket paths in keys and fills", () => {
    const f = form((d) => {
      d.septicTank.tanks = [{} as InspectionFormData["septicTank"]["tanks"][0]];
    });
    const { fills, provenance } = mergeProposals(
      f,
      {},
      [proposal("septicTank.tanks[0].tankCapacity", "1250", 0.9)],
      OPTS,
    );
    expect(fills).toEqual([{ fieldPath: "septicTank.tanks.0.tankCapacity", value: "1250" }]);
    expect(Object.keys(provenance)).toEqual(["septicTank.tanks.0.tankCapacity"]);
  });

  it("does not mutate its inputs", () => {
    const existing: FieldProvenance = { "facilityInfo.waterSource": entry({ value: "well" }) };
    const snapshot = JSON.stringify(existing);
    mergeProposals(form(), existing, [proposal("designFlow.numberOfBedrooms", "3")], OPTS);
    expect(JSON.stringify(existing)).toBe(snapshot);
  });

  it("uses the current time when opts.now is omitted", () => {
    const before = Date.now();
    const { provenance } = mergeProposals(form(), {}, [proposal("designFlow.numberOfBedrooms", "3")], {
      runId: "run-2",
    });
    const at = Date.parse(provenance["designFlow.numberOfBedrooms"].at);
    expect(at).toBeGreaterThanOrEqual(before);
    expect(provenance["designFlow.numberOfBedrooms"].runId).toBe("run-2");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/prefill/__tests__/merge.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/prefill/merge"`.

- [ ] **Step 3: Implement `merge.ts`**

`src/lib/prefill/merge.ts`:

```ts
import type { InspectionFormData } from "@/types/inspection";
import { PREFILL_FILL_THRESHOLD } from "./types";
import type { FieldProvenance, ProposedField, ProvenanceEntry } from "./types";

export interface MergeResult {
  /** Field paths whose value changed and must be `form.setValue`d */
  fills: Array<{ fieldPath: string; value: ProposedField["value"] }>;
  provenance: FieldProvenance;
}

/** `septicTank.tanks[0].tankCapacity` → `septicTank.tanks.0.tankCapacity` (react-hook-form's dotted form) */
export function normalizeFieldPath(path: string): string {
  return path.replace(/\[(\d+)\]/g, ".$1");
}

/** Read a dotted path from form data */
export function getPath(obj: unknown, path: string): unknown {
  let current: unknown = obj;
  for (const segment of normalizeFieldPath(path).split(".")) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** "", [], false, undefined, null are empty; "0" is not */
export function isEmptyValue(v: unknown): boolean {
  if (v === undefined || v === null || v === false) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/** Loose equality for form values: trimmed strings, element-wise arrays, strict otherwise */
export function valuesEqual(a: unknown, b: unknown): boolean {
  if (typeof a === "string" && typeof b === "string") return a.trim() === b.trim();
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => item === b[i]);
  }
  return a === b;
}

/**
 * Pure. Applies the spec §7 merge rules:
 *  - kind "warning" → provenance entry state "suggested", no fill
 *  - confidence ≥ PREFILL_FILL_THRESHOLD and current value empty/default → fill + "prefilled"
 *  - otherwise → "suggested"
 *  - existing "verified"/"edited" entry → new proposal becomes "suggested"
 *  - existing "prefilled" entry is replaced only if the current value still equals its proposed value and the new confidence is higher
 *  - a field that already holds the proposed value gets a "prefilled" entry without a fill (nothing is overwritten)
 */
export function mergeProposals(
  formData: InspectionFormData,
  provenance: FieldProvenance,
  proposals: ProposedField[],
  opts: { runId: string; now?: string },
): MergeResult {
  const now = opts.now ?? new Date().toISOString();
  const next: FieldProvenance = { ...provenance };
  const fills: MergeResult["fills"] = [];

  for (const proposal of proposals) {
    const fieldPath = normalizeFieldPath(proposal.fieldPath);
    const existing = next[fieldPath];
    const current = getPath(formData, fieldPath);
    const base: Omit<ProvenanceEntry, "state" | "value"> = {
      ...proposal.provenance,
      kind: proposal.kind,
      runId: opts.runId,
      at: now,
    };
    const suggest = (): void => {
      next[fieldPath] = { ...base, state: "suggested", value: proposal.value };
    };
    const fill = (): void => {
      next[fieldPath] = { ...base, state: "prefilled", value: proposal.value };
      if (!valuesEqual(current, proposal.value)) {
        fills.push({ fieldPath, value: proposal.value });
      }
    };

    if (proposal.kind === "warning") {
      next[fieldPath] = { ...base, state: "suggested", value: "" };
      continue;
    }
    if (existing?.state === "verified" || existing?.state === "edited") {
      suggest();
      continue;
    }
    if (proposal.confidence < PREFILL_FILL_THRESHOLD) {
      suggest();
      continue;
    }
    if (existing?.state === "prefilled") {
      // The provider flips prefilled → edited when the user changes a value; this is the defensive check
      if (!valuesEqual(current, existing.value)) {
        suggest();
        continue;
      }
      if (proposal.confidence > existing.confidence) {
        fill();
        continue;
      }
      if (valuesEqual(proposal.value, current)) {
        continue; // same value, no better confidence — keep the existing entry
      }
      suggest();
      continue;
    }
    if (isEmptyValue(current) || valuesEqual(current, proposal.value)) {
      fill();
      continue;
    }
    suggest();
  }

  return { fills, provenance: next };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/prefill/__tests__/merge.test.ts`
Expected: PASS (19 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/prefill/merge.ts src/lib/prefill/__tests__/merge.test.ts
git commit -m "feat(prefill): pure mergeProposals with fill/suggest rules, getPath and isEmptyValue"
```

---

### Task 3: Migration 0015 + Drizzle schema additions

**Files:**
- Create: `src/lib/db/migrations/0015_prefill_runs_records_provenance.sql`
- Modify: `src/lib/db/schema.ts` (import line 1–13; `inspections` table after `reviewNotes`; new tables before `// Relations`; `inspectionsRelations`; new relations)
- Test: `src/lib/db/__tests__/prefill-schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `inspections.fieldProvenance` (jsonb, default `{}`), `inspectionPrefillRuns`, `inspectionRecords` tables (column names below are what `run-store.ts` selects); `inspectionPrefillRunsRelations`, `inspectionRecordsRelations`.

Note: the remote column does not exist until Task 16 applies the migration. Because Drizzle's `db.select().from(inspections)` lists every column explicitly, **do not run the dev server against the remote DB between this task and Task 16** — the edit page would fail with `column "field_provenance" does not exist`. All tests until then mock `@/lib/db`.

- [ ] **Step 1: Write the failing test**

`src/lib/db/__tests__/prefill-schema.test.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { inspectionPrefillRuns, inspectionRecords, inspections } from "@/lib/db/schema";

describe("prefill Drizzle schema", () => {
  it("adds field_provenance to inspections, NOT NULL with a {} default", () => {
    const cols = getTableColumns(inspections);
    expect(cols.fieldProvenance.name).toBe("field_provenance");
    expect(cols.fieldProvenance.notNull).toBe(true);
    expect(cols.fieldProvenance.default).toEqual({});
  });

  it("defines inspection_prefill_runs with the contract columns", () => {
    expect(getTableName(inspectionPrefillRuns)).toBe("inspection_prefill_runs");
    expect(Object.keys(getTableColumns(inspectionPrefillRuns))).toEqual([
      "id",
      "inspectionId",
      "trigger",
      "status",
      "input",
      "stages",
      "proposals",
      "candidates",
      "error",
      "appliedAt",
      "createdBy",
      "createdAt",
      "finishedAt",
    ]);
    expect(getTableColumns(inspectionPrefillRuns).status.default).toBe("queued");
  });

  it("defines inspection_records with the contract columns", () => {
    expect(getTableName(inspectionRecords)).toBe("inspection_records");
    expect(Object.keys(getTableColumns(inspectionRecords))).toEqual([
      "id",
      "inspectionId",
      "runId",
      "source",
      "permitNumber",
      "docType",
      "docDate",
      "description",
      "pageCount",
      "sizeBytes",
      "storagePath",
      "selected",
      "extractionStatus",
      "extractionError",
      "extracted",
      "createdAt",
    ]);
    expect(getTableColumns(inspectionRecords).selected.default).toBe(true);
    expect(getTableColumns(inspectionRecords).extractionStatus.default).toBe("pending");
  });
});

describe("migration 0015", () => {
  const sql = readFileSync(
    path.resolve(process.cwd(), "src/lib/db/migrations/0015_prefill_runs_records_provenance.sql"),
    "utf8",
  );

  it("adds the column and both tables idempotently", () => {
    expect(sql).toContain(
      "ADD COLUMN IF NOT EXISTS field_provenance jsonb NOT NULL DEFAULT '{}'::jsonb",
    );
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.inspection_prefill_runs");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.inspection_records");
    expect(sql).toContain("inspection_prefill_runs_inspection_created_idx");
    expect(sql).toContain("inspection_records_inspection_idx");
  });

  it("enables RLS on both tables with a read policy", () => {
    expect(sql).toContain("ALTER TABLE public.inspection_prefill_runs ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("ALTER TABLE public.inspection_records ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain('CREATE POLICY "Prefill runs readable by authenticated"');
    expect(sql).toContain('CREATE POLICY "Inspection records readable by authenticated"');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/db/__tests__/prefill-schema.test.ts`
Expected: FAIL — `No "inspectionPrefillRuns" export is defined` / ENOENT for the migration file.

- [ ] **Step 3: Write the migration**

`src/lib/db/migrations/0015_prefill_runs_records_provenance.sql` (verbatim from the contracts):

```sql
-- =============================================================================
-- Migration 0015: property-records prefill — runs, stored permit documents,
--                 per-field provenance sidecar on inspections
-- =============================================================================

ALTER TABLE public.inspections
  ADD COLUMN IF NOT EXISTS field_provenance jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.inspection_prefill_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id uuid NOT NULL REFERENCES public.inspections(id) ON DELETE CASCADE,
  trigger text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  stages jsonb NOT NULL DEFAULT '{}'::jsonb,
  proposals jsonb NOT NULL DEFAULT '[]'::jsonb,
  candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text,
  applied_at timestamp,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamp NOT NULL DEFAULT now(),
  finished_at timestamp
);
CREATE INDEX IF NOT EXISTS inspection_prefill_runs_inspection_created_idx
  ON public.inspection_prefill_runs (inspection_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.inspection_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id uuid NOT NULL REFERENCES public.inspections(id) ON DELETE CASCADE,
  run_id uuid REFERENCES public.inspection_prefill_runs(id) ON DELETE SET NULL,
  source text NOT NULL,
  permit_number text NOT NULL,
  doc_type text NOT NULL,
  doc_date date,
  description text,
  page_count integer,
  size_bytes integer,
  storage_path text NOT NULL,
  selected boolean NOT NULL DEFAULT true,
  extraction_status text NOT NULL DEFAULT 'pending',
  extraction_error text,
  extracted jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inspection_records_inspection_idx
  ON public.inspection_records (inspection_id);

-- RLS: the app talks to Postgres through the service connection (bypasses RLS);
-- these policies are defence-in-depth for direct Supabase-client access,
-- mirroring 0005 (inspection_emails).
ALTER TABLE public.inspection_prefill_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspection_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Prefill runs readable by authenticated" ON public.inspection_prefill_runs;
CREATE POLICY "Prefill runs readable by authenticated"
  ON public.inspection_prefill_runs FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Inspection records readable by authenticated" ON public.inspection_records;
CREATE POLICY "Inspection records readable by authenticated"
  ON public.inspection_records FOR SELECT TO authenticated USING (true);
```

- [ ] **Step 4: Extend the Drizzle schema**

In `src/lib/db/schema.ts`:

(a) Add `date` to the `drizzle-orm/pg-core` import (keep alphabetical):

```ts
import {
  boolean,
  date,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
```

(b) Inside the `inspections` table, directly after `reviewNotes: text("review_notes"),`:

```ts
  // Per-field prefill provenance sidecar (see src/lib/prefill/types.ts FieldProvenance).
  // Written only through PATCH /api/inspections/[id]/provenance.
  fieldProvenance: jsonb("field_provenance").notNull().default({}),
```

(c) After the `inspectionSummaries` table and before the `// Relations` comment, add the two tables (verbatim from the contracts):

```ts
// Property-records prefill runs — one row per POST /api/inspections/[id]/prefill
export const inspectionPrefillRuns = pgTable("inspection_prefill_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  inspectionId: uuid("inspection_id")
    .references(() => inspections.id, { onDelete: "cascade" })
    .notNull(),
  trigger: text("trigger").notNull(), // apn_lookup | manual | webhook
  status: text("status").notNull().default("queued"),
  input: jsonb("input").notNull().default({}),
  stages: jsonb("stages").notNull().default({}),
  proposals: jsonb("proposals").notNull().default([]),
  candidates: jsonb("candidates").notNull().default([]),
  error: text("error"),
  appliedAt: timestamp("applied_at"),
  createdBy: uuid("created_by").references(() => profiles.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
});

// Permit documents downloaded for an inspection (kept out of inspection_media so
// they can never appear in the report's photo pages)
export const inspectionRecords = pgTable("inspection_records", {
  id: uuid("id").defaultRandom().primaryKey(),
  inspectionId: uuid("inspection_id")
    .references(() => inspections.id, { onDelete: "cascade" })
    .notNull(),
  runId: uuid("run_id").references(() => inspectionPrefillRuns.id, { onDelete: "set null" }),
  source: text("source").notNull(), // edms_env | edms_eplpav
  permitNumber: text("permit_number").notNull(),
  docType: text("doc_type").notNull(),
  docDate: date("doc_date"),
  description: text("description"),
  pageCount: integer("page_count"),
  sizeBytes: integer("size_bytes"),
  storagePath: text("storage_path").notNull(),
  selected: boolean("selected").notNull().default(true),
  extractionStatus: text("extraction_status").notNull().default("pending"),
  extractionError: text("extraction_error"),
  extracted: jsonb("extracted"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

(d) Replace the existing `inspectionsRelations` with:

```ts
export const inspectionsRelations = relations(inspections, ({ one, many }) => ({
  inspector: one(profiles, {
    fields: [inspections.inspectorId],
    references: [profiles.id],
  }),
  media: many(inspectionMedia),
  emails: many(inspectionEmails),
  summaries: many(inspectionSummaries),
  prefillRuns: many(inspectionPrefillRuns),
  records: many(inspectionRecords),
}));
```

(e) After `inspectionSummariesRelations`, add:

```ts
export const inspectionPrefillRunsRelations = relations(inspectionPrefillRuns, ({ one, many }) => ({
  inspection: one(inspections, {
    fields: [inspectionPrefillRuns.inspectionId],
    references: [inspections.id],
  }),
  creator: one(profiles, {
    fields: [inspectionPrefillRuns.createdBy],
    references: [profiles.id],
  }),
  records: many(inspectionRecords),
}));

export const inspectionRecordsRelations = relations(inspectionRecords, ({ one }) => ({
  inspection: one(inspections, {
    fields: [inspectionRecords.inspectionId],
    references: [inspections.id],
  }),
  run: one(inspectionPrefillRuns, {
    fields: [inspectionRecords.runId],
    references: [inspectionPrefillRuns.id],
  }),
}));
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/lib/db/__tests__/prefill-schema.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/migrations/0015_prefill_runs_records_provenance.sql src/lib/db/schema.ts src/lib/db/__tests__/prefill-schema.test.ts
git commit -m "feat(db): migration 0015 — field_provenance column, inspection_prefill_runs and inspection_records tables"
```

---

### Task 4: Input validation/parsing, Assessor library, and `/api/apn-lookup` refactor

**Files:**
- Create: `src/lib/prefill/input.ts`
- Create: `src/lib/prefill/assessor-fields.ts`
- Create: `src/lib/prefill/assessor.ts`
- Modify: `src/app/api/apn-lookup/route.ts` (replace the ArcGIS constants and the `try` block; keep the rate limiter)
- Test: `src/lib/prefill/__tests__/input.test.ts`
- Test: `src/lib/prefill/__tests__/assessor-fields.test.ts`
- Test: `src/lib/prefill/__tests__/assessor.test.ts`
- Existing test that must stay green: `src/app/api/apn-lookup/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `PrefillAddress`, `PrefillInput`, `ProposedField` (Task 1), `StageContext`/`StageResult` (Task 1).
- Produces:
  - `input.ts`: `APN_MAX_LENGTH = 20`, `isValidApn(apn: string): boolean`, `normalizeStreetName(name: string): string`, `parseStreetAddress(line: string): PrefillAddress | null`, `formatFullAddress(a: PrefillAddress): string`, `prefillAddressSchema`, `prefillStartBodySchema`, `type PrefillStartBody`, `buildPrefillInput(formData: unknown, body: PrefillStartBody): PrefillInput`
  - `assessor-fields.ts`: `interface AssessorSummary { ownerName; physicalAddress; city; zip; county; apnFormatted; legalDescription; lotSize; yearBuilt }` (all strings), `assessorParcelUrl(apn: string): string`, `assessorProposals(summary: AssessorSummary, apn: string): ProposedField[]`
  - `assessor.ts`: `ARCGIS_PARCELS_URL`, `interface ParcelAttributes`, `class AssessorUnavailableError`, `queryParcelByApn(apn, opts?: { signal? }): Promise<ParcelAttributes | null>`, `findParcelByAddress(streetNumber, streetName, opts?): Promise<ParcelAttributes | null>`, `cleanPhysicalAddress(raw): string`, `mapParcelToAssessor(feature): AssessorSummary`, `runAssessorStage(input: PrefillInput, ctx: StageContext): Promise<StageResult>`

- [ ] **Step 1: Write the failing tests**

`src/lib/prefill/__tests__/input.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildPrefillInput,
  formatFullAddress,
  isValidApn,
  normalizeStreetName,
  parseStreetAddress,
  prefillStartBodySchema,
} from "@/lib/prefill/input";

describe("isValidApn", () => {
  it("accepts dashed, spaced, plain-digit and letter-suffixed APNs", () => {
    for (const apn of ["219-11-121", "123 45 678", "12345678", "201-13-030Z"]) {
      expect(isValidApn(apn)).toBe(true);
    }
  });
  it("rejects empty, over-long, digit-less and special-character APNs", () => {
    for (const apn of ["", "123-45-678-90-123-456", "---", "ABC", "123@45#678", "1'; DROP"]) {
      expect(isValidApn(apn)).toBe(false);
    }
  });
});

describe("normalizeStreetName", () => {
  it("uppercases, drops a leading direction and a trailing suffix", () => {
    expect(normalizeStreetName("Cave Creek Rd")).toBe("CAVE CREEK");
    expect(normalizeStreetName("E. Cave Creek Road")).toBe("CAVE CREEK");
    expect(normalizeStreetName("North 7th Street")).toBe("7TH");
  });
  it("strips every character outside A–Z, 0–9 and space", () => {
    expect(normalizeStreetName("O'Neil Dr")).toBe("ONEIL");
    expect(normalizeStreetName("Main' OR 1=1 --")).toBe("MAIN OR 1 1");
  });
  it("keeps a one-word name that happens to be a suffix", () => {
    expect(normalizeStreetName("Way")).toBe("WAY");
  });
});

describe("parseStreetAddress", () => {
  it("splits number, direction and street name", () => {
    expect(parseStreetAddress("8911 E Cave Creek Rd")).toEqual({
      streetNumber: "8911",
      streetDir: "E",
      streetName: "Cave Creek Rd",
    });
  });
  it("handles no direction, unit markers and full-word directions", () => {
    expect(parseStreetAddress("123 Main St #4")).toEqual({
      streetNumber: "123",
      streetName: "Main St",
    });
    expect(parseStreetAddress("123 Main St Unit B")).toEqual({
      streetNumber: "123",
      streetName: "Main St",
    });
    expect(parseStreetAddress("10 North Central Ave")).toEqual({
      streetNumber: "10",
      streetDir: "N",
      streetName: "Central Ave",
    });
  });
  it("drops the city/zip tail the assessor appends after runs of spaces", () => {
    expect(parseStreetAddress("8911 E CAVE CREEK RD   CAREFREE  85377")).toEqual({
      streetNumber: "8911",
      streetDir: "E",
      streetName: "CAVE CREEK RD",
    });
  });
  it("returns null without a leading house number", () => {
    expect(parseStreetAddress("Main St")).toBeNull();
    expect(parseStreetAddress("")).toBeNull();
    expect(parseStreetAddress("123")).toBeNull();
  });
  it("strips non-ASCII characters", () => {
    expect(parseStreetAddress("123 Maïn St")).toEqual({ streetNumber: "123", streetName: "Ma n St" });
  });
});

describe("formatFullAddress", () => {
  it("builds the single-line listing address", () => {
    expect(
      formatFullAddress({
        streetNumber: "8911",
        streetDir: "E",
        streetName: "Cave Creek Rd",
        city: "Carefree",
        zip: "85377",
      }),
    ).toBe("8911 E Cave Creek Rd, Carefree, AZ 85377");
    expect(formatFullAddress({ streetNumber: "123", streetName: "Main St" })).toBe("123 Main St, AZ");
  });
});

describe("prefillStartBodySchema", () => {
  it("accepts an empty body and trims the APN", () => {
    expect(prefillStartBodySchema.safeParse({}).success).toBe(true);
    expect(prefillStartBodySchema.parse({ apn: " 219-11-121 " }).apn).toBe("219-11-121");
  });
  it("rejects non-digit street numbers, over-long names and unknown triggers", () => {
    expect(
      prefillStartBodySchema.safeParse({ address: { streetNumber: "12a", streetName: "Main" } })
        .success,
    ).toBe(false);
    expect(
      prefillStartBodySchema.safeParse({ address: { streetNumber: "12", streetName: "x".repeat(81) } })
        .success,
    ).toBe(false);
    expect(prefillStartBodySchema.safeParse({ trigger: "webhook" }).success).toBe(false);
    expect(prefillStartBodySchema.safeParse({ trigger: "apn_lookup" }).success).toBe(true);
  });
});

describe("buildPrefillInput", () => {
  const formData = {
    facilityInfo: {
      taxParcelNumber: "219-11-121",
      facilityAddress: "8911 E Cave Creek Rd",
      facilityCity: "Carefree",
      facilityZip: "85377",
    },
  };

  it("prefers the request body over the form data", () => {
    const input = buildPrefillInput(formData, {
      apn: "200-08-079",
      address: { streetNumber: "1", streetName: "Other St", full: "1 Other St" },
    });
    expect(input.apn).toBe("200-08-079");
    expect(input.address).toEqual({ streetNumber: "1", streetName: "Other St", full: "1 Other St" });
  });

  it("falls back to facilityInfo and derives the full address", () => {
    expect(buildPrefillInput(formData, {})).toEqual({
      apn: "219-11-121",
      address: {
        streetNumber: "8911",
        streetDir: "E",
        streetName: "Cave Creek Rd",
        city: "Carefree",
        zip: "85377",
        full: "8911 E Cave Creek Rd, Carefree, AZ 85377",
      },
    });
  });

  it("returns an empty input when nothing is available", () => {
    expect(buildPrefillInput(null, {})).toEqual({});
    expect(buildPrefillInput({ facilityInfo: { facilityAddress: "No number here" } }, {})).toEqual({});
  });
});
```

`src/lib/prefill/__tests__/assessor-fields.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { assessorParcelUrl, assessorProposals } from "@/lib/prefill/assessor-fields";

const SUMMARY = {
  ownerName: "JOHN DOE",
  physicalAddress: "8911 E CAVE CREEK RD",
  city: "CAREFREE",
  zip: "85377",
  county: "Maricopa",
  apnFormatted: "219-11-121",
  legalDescription: "Lot 4",
  lotSize: "43560",
  yearBuilt: "1998",
};

describe("assessorParcelUrl", () => {
  it("links to the assessor parcel page", () => {
    expect(assessorParcelUrl("219-11-121")).toBe("https://mcassessor.maricopa.gov/mcs/?q=219-11-121");
  });
  it("URL-encodes the APN", () => {
    expect(assessorParcelUrl("219 11 121")).toBe("https://mcassessor.maricopa.gov/mcs/?q=219%2011%20121");
  });
});

describe("assessorProposals", () => {
  it("proposes the seven facilityInfo fields the APN lookup writes, at confidence 1", () => {
    const proposals = assessorProposals(SUMMARY, "219-11-121");
    expect(proposals.map((p) => [p.fieldPath, p.value])).toEqual([
      ["facilityInfo.facilityName", "JOHN DOE"],
      ["facilityInfo.sellerName", "JOHN DOE"],
      ["facilityInfo.facilityAddress", "8911 E CAVE CREEK RD"],
      ["facilityInfo.facilityCity", "CAREFREE"],
      ["facilityInfo.facilityZip", "85377"],
      ["facilityInfo.facilityCounty", "Maricopa"],
      ["facilityInfo.taxParcelNumber", "219-11-121"],
    ]);
    for (const p of proposals) {
      expect(p.kind).toBe("fill");
      expect(p.provenance).toMatchObject({
        source: "assessor",
        confidence: 1,
        explanation: "Maricopa County Assessor · parcel 219-11-121",
        sourceUrl: "https://mcassessor.maricopa.gov/mcs/?q=219-11-121",
      });
    }
    expect(proposals[0].provenance.evidence).toBe("OWNER_NAME: JOHN DOE");
  });

  it("skips empty values and falls back to the searched APN for the parcel number", () => {
    const proposals = assessorProposals({ ...SUMMARY, ownerName: "", apnFormatted: "" }, "219-11-121");
    const paths = proposals.map((p) => p.fieldPath);
    expect(paths).not.toContain("facilityInfo.facilityName");
    expect(paths).not.toContain("facilityInfo.sellerName");
    expect(proposals.find((p) => p.fieldPath === "facilityInfo.taxParcelNumber")?.value).toBe(
      "219-11-121",
    );
  });
});
```

`src/lib/prefill/__tests__/assessor.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AssessorUnavailableError,
  cleanPhysicalAddress,
  findParcelByAddress,
  mapParcelToAssessor,
  queryParcelByApn,
  runAssessorStage,
} from "@/lib/prefill/assessor";
import type { StageContext } from "@/lib/prefill/stage";

const FEATURE = {
  OWNER_NAME: "JOHN DOE",
  PHYSICAL_ADDRESS: "8911 E CAVE CREEK RD   CAREFREE  85377",
  PHYSICAL_CITY: "CAREFREE",
  PHYSICAL_ZIP: "85377",
  JURISDICTION: "CAREFREE",
  APN_DASH: "219-11-121",
  LAND_SIZE: 43560,
  CONST_YEAR: 1998,
  SUBNAME: "CAVE CREEK ESTATES",
  LOT_NUM: "4",
  BLOCK: "",
  STR: "",
};

const mockFetch = vi.fn();

function arcgis(features: Array<Record<string, unknown>>) {
  return { ok: true, json: () => Promise.resolve({ features: features.map((attributes) => ({ attributes })) }) };
}

function whereOf(call: unknown[]): string | null {
  return new URL(String(call[0])).searchParams.get("where");
}

function makeCtx(over: Partial<StageContext> = {}): StageContext {
  return {
    inspectionId: "insp-1",
    runId: "run-1",
    signal: new AbortController().signal,
    progress: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockResolvedValue(arcgis([FEATURE]));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("queryParcelByApn", () => {
  it("queries APN_DASH and returns the first feature", async () => {
    const feature = await queryParcelByApn("219-11-121");
    expect(feature?.APN_DASH).toBe("219-11-121");
    expect(whereOf(mockFetch.mock.calls[0])).toBe("APN_DASH='219-11-121'");
    expect(String(mockFetch.mock.calls[0][0])).toContain("gis.mcassessor.maricopa.gov");
  });

  it("returns null when there are no features", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });
    expect(await queryParcelByApn("999-99-999")).toBeNull();
  });

  it("throws AssessorUnavailableError on a non-2xx response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });
    await expect(queryParcelByApn("219-11-121")).rejects.toBeInstanceOf(AssessorUnavailableError);
  });

  it("refuses an invalid APN before calling the service", async () => {
    await expect(queryParcelByApn("1'; DROP TABLE")).rejects.toThrow("Invalid APN format");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("findParcelByAddress", () => {
  it("queries the normalised street number and name with a LIKE prefix", async () => {
    await findParcelByAddress("8911", "E Cave Creek Rd");
    expect(whereOf(mockFetch.mock.calls[0])).toBe(
      "PHYSICAL_STREET_NUM='8911' AND PHYSICAL_STREET_NAME LIKE 'CAVE CREEK%'",
    );
  });

  it("strips quotes from the street name", async () => {
    await findParcelByAddress("12", "O'Neil Dr");
    expect(whereOf(mockFetch.mock.calls[0])).toContain("LIKE 'ONEIL%'");
  });

  it("returns null without calling the service for a bad number or empty name", async () => {
    expect(await findParcelByAddress("12a", "Main St")).toBeNull();
    expect(await findParcelByAddress("12", "'--")).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("cleanPhysicalAddress / mapParcelToAssessor", () => {
  it("cuts the city/zip tail the layer appends after runs of spaces", () => {
    expect(cleanPhysicalAddress("8911 E CAVE CREEK RD   CAREFREE  85377")).toBe("8911 E CAVE CREEK RD");
    expect(cleanPhysicalAddress("123 Main St")).toBe("123 Main St");
    expect(cleanPhysicalAddress(null)).toBe("");
  });

  it("maps the feature to the assessor summary", () => {
    expect(mapParcelToAssessor(FEATURE)).toEqual({
      ownerName: "JOHN DOE",
      physicalAddress: "8911 E CAVE CREEK RD",
      city: "CAREFREE",
      zip: "85377",
      county: "Maricopa",
      apnFormatted: "219-11-121",
      legalDescription: "CAVE CREEK ESTATES, Lot 4",
      lotSize: "43560",
      yearBuilt: "1998",
    });
  });
});

describe("runAssessorStage", () => {
  it("reports running, then done with proposals and the parcel link", async () => {
    const ctx = makeCtx();
    const result = await runAssessorStage({ apn: "219-11-121" }, ctx);
    expect(ctx.progress).toHaveBeenCalledWith(expect.objectContaining({ status: "running" }));
    expect(result.stage.status).toBe("done");
    expect(result.stage.summary).toBe("Parcel 219-11-121 · 8911 E CAVE CREEK RD");
    expect(result.stage.links).toEqual([
      { label: "Assessor parcel page", url: "https://mcassessor.maricopa.gov/mcs/?q=219-11-121" },
    ]);
    expect(result.proposals.map((p) => p.fieldPath)).toContain("facilityInfo.taxParcelNumber");
    expect(result.stage.startedAt).toBeTruthy();
    expect(result.stage.finishedAt).toBeTruthy();
  });

  it("falls back to the address when the APN finds nothing", async () => {
    mockFetch.mockResolvedValueOnce(arcgis([])).mockResolvedValueOnce(arcgis([FEATURE]));
    const result = await runAssessorStage(
      { apn: "999-99-999", address: { streetNumber: "8911", streetName: "Cave Creek Rd" } },
      makeCtx(),
    );
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(whereOf(mockFetch.mock.calls[1])).toContain("PHYSICAL_STREET_NUM='8911'");
    expect(result.stage.status).toBe("done");
    expect(result.proposals.find((p) => p.fieldPath === "facilityInfo.taxParcelNumber")?.value).toBe(
      "219-11-121",
    );
  });

  it("returns not_found naming what was searched", async () => {
    mockFetch.mockResolvedValue(arcgis([]));
    const result = await runAssessorStage(
      { apn: "999-99-999", address: { streetNumber: "1", streetName: "Nowhere Ln" } },
      makeCtx(),
    );
    expect(result.stage.status).toBe("not_found");
    expect(result.stage.summary).toBe("No parcel found (searched APN 999-99-999 and 1 Nowhere Ln)");
    expect(result.proposals).toEqual([]);
  });

  it("returns an error stage (never throws) when the service is down", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 502 });
    const result = await runAssessorStage({ apn: "219-11-121" }, makeCtx());
    expect(result.stage.status).toBe("error");
    expect(result.stage.error).toBe("Assessor service unavailable — try Find records later");
  });

  it("reports a timeout when the fetch is aborted", async () => {
    mockFetch.mockRejectedValue(new DOMException("aborted", "AbortError"));
    const result = await runAssessorStage({ apn: "219-11-121" }, makeCtx());
    expect(result.stage.status).toBe("error");
    expect(result.stage.error).toBe("Assessor lookup timed out");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/prefill/__tests__/input.test.ts src/lib/prefill/__tests__/assessor-fields.test.ts src/lib/prefill/__tests__/assessor.test.ts`
Expected: FAIL — unresolved imports for the three new modules.

- [ ] **Step 3: Implement `input.ts`**

`src/lib/prefill/input.ts`:

```ts
import { z } from "zod";
import type { PrefillAddress, PrefillInput } from "./types";

export const APN_MAX_LENGTH = 20;

/** Digits, letters, dashes, spaces; must contain a digit; max 20 chars — the same rule /api/apn-lookup has always used */
export function isValidApn(apn: string): boolean {
  return (
    apn.length > 0 &&
    apn.length <= APN_MAX_LENGTH &&
    /^[\dA-Za-z -]+$/.test(apn) &&
    /\d/.test(apn)
  );
}

const STREET_SUFFIXES = new Set([
  "RD", "ROAD", "DR", "DRIVE", "ST", "STREET", "AVE", "AVENUE", "LN", "LANE", "BLVD",
  "BOULEVARD", "WAY", "CT", "COURT", "PL", "PLACE", "CIR", "CIRCLE", "TRL", "TRAIL",
  "PKWY", "PARKWAY", "HWY", "HIGHWAY", "TER", "TERRACE", "LOOP",
]);

const DIRECTION_ABBR: Record<string, string> = {
  N: "N", S: "S", E: "E", W: "W", NE: "NE", NW: "NW", SE: "SE", SW: "SW",
  NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W",
};

const UNIT_MARKER = /^(#|UNIT|APT|STE|SUITE)$/i;

/**
 * Uppercase, keep only A–Z/0–9/space, drop a leading direction and a trailing
 * suffix: "E. Cave Creek Rd" → "CAVE CREEK". The ArcGIS layer stores the name
 * without direction or suffix, and this is the only form that may be placed in
 * a `where` clause (quotes cannot survive).
 */
export function normalizeStreetName(name: string): string {
  const words = name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length > 1 && DIRECTION_ABBR[words[0]]) words.shift();
  if (words.length > 1 && STREET_SUFFIXES.has(words[words.length - 1])) words.pop();
  return words.join(" ");
}

/**
 * "8911 E Cave Creek Rd #4" → { streetNumber: "8911", streetDir: "E", streetName: "Cave Creek Rd" }.
 * Null when there is no leading house number. Anything after a run of 2+ spaces
 * is dropped (the assessor appends "   CITY  ZIP" that way).
 */
export function parseStreetAddress(line: string): PrefillAddress | null {
  const ascii = line.replace(/[^\x20-\x7E]/g, " ").slice(0, 200);
  const cleaned = ascii.split(/ {2,}/)[0].replace(/\s+/g, " ").trim();
  const match = cleaned.match(/^(\d{1,8}) (.+)$/);
  if (!match) return null;

  const words = match[2].split(" ");
  let streetDir: string | undefined;
  const first = words[0].replace(/\./g, "").toUpperCase();
  if (words.length > 1 && DIRECTION_ABBR[first]) {
    streetDir = DIRECTION_ABBR[first];
    words.shift();
  }
  const unitIndex = words.findIndex((w) => UNIT_MARKER.test(w) || w.startsWith("#"));
  const streetName = (unitIndex >= 0 ? words.slice(0, unitIndex) : words).join(" ").trim();
  if (!streetName) return null;

  return { streetNumber: match[1], streetName, ...(streetDir ? { streetDir } : {}) };
}

/** "8911 E Cave Creek Rd, Carefree, AZ 85377" */
export function formatFullAddress(a: PrefillAddress): string {
  const line1 = [a.streetNumber, a.streetDir, a.streetName].filter(Boolean).join(" ");
  const stateZip = ["AZ", a.zip].filter(Boolean).join(" ");
  return [line1, a.city, stateZip].filter(Boolean).join(", ");
}

const printableAscii = /^[\x20-\x7E]*$/;

export const prefillAddressSchema = z.object({
  streetNumber: z.string().trim().regex(/^\d{1,8}$/, "Street number must be digits"),
  streetName: z.string().trim().min(1).max(80).regex(printableAscii),
  streetDir: z.string().trim().max(2).regex(printableAscii).optional(),
  city: z.string().trim().max(60).regex(printableAscii).optional(),
  zip: z.string().trim().max(10).regex(printableAscii).optional(),
  full: z.string().trim().max(200).regex(printableAscii).optional(),
});

/** Body of POST /api/inspections/[id]/prefill — everything optional; defaults come from facilityInfo */
export const prefillStartBodySchema = z.object({
  apn: z.string().trim().max(APN_MAX_LENGTH).optional(),
  address: prefillAddressSchema.optional(),
  trigger: z.enum(["apn_lookup", "manual"]).optional(),
});

export type PrefillStartBody = z.infer<typeof prefillStartBodySchema>;

/** Body wins; otherwise APN/address are derived from the inspection's facilityInfo */
export function buildPrefillInput(formData: unknown, body: PrefillStartBody): PrefillInput {
  const facility = ((formData as { facilityInfo?: Record<string, unknown> } | null)?.facilityInfo ??
    {}) as Record<string, unknown>;
  const text = (key: string): string =>
    typeof facility[key] === "string" ? (facility[key] as string).trim() : "";

  const apn = body.apn?.trim() || text("taxParcelNumber") || undefined;

  let address = body.address;
  if (!address) {
    const parsed = parseStreetAddress(text("facilityAddress"));
    if (parsed) {
      address = {
        ...parsed,
        ...(text("facilityCity") ? { city: text("facilityCity") } : {}),
        ...(text("facilityZip") ? { zip: text("facilityZip") } : {}),
      };
    }
  }
  if (address && !address.full) {
    address = { ...address, full: formatFullAddress(address) };
  }

  return { ...(apn ? { apn } : {}), ...(address ? { address } : {}) };
}
```

- [ ] **Step 4: Implement `assessor-fields.ts`**

`src/lib/prefill/assessor-fields.ts` (pure and client-safe — the APN lookup input imports it):

```ts
import type { ProposedField } from "./types";

/** The shape /api/apn-lookup returns under `assessor` */
export interface AssessorSummary {
  ownerName: string;
  physicalAddress: string;
  city: string;
  zip: string;
  county: string;
  apnFormatted: string;
  legalDescription: string;
  lotSize: string;
  yearBuilt: string;
}

/** Verified 2026-09-11: returns the parcel page with HTTP 200 */
export function assessorParcelUrl(apn: string): string {
  return `https://mcassessor.maricopa.gov/mcs/?q=${encodeURIComponent(apn)}`;
}

const FIELD_MAP: Array<{ fieldPath: string; key: keyof AssessorSummary; attribute: string }> = [
  { fieldPath: "facilityInfo.facilityName", key: "ownerName", attribute: "OWNER_NAME" },
  { fieldPath: "facilityInfo.sellerName", key: "ownerName", attribute: "OWNER_NAME" },
  { fieldPath: "facilityInfo.facilityAddress", key: "physicalAddress", attribute: "PHYSICAL_ADDRESS" },
  { fieldPath: "facilityInfo.facilityCity", key: "city", attribute: "PHYSICAL_CITY" },
  { fieldPath: "facilityInfo.facilityZip", key: "zip", attribute: "PHYSICAL_ZIP" },
  { fieldPath: "facilityInfo.facilityCounty", key: "county", attribute: "COUNTY" },
  { fieldPath: "facilityInfo.taxParcelNumber", key: "apnFormatted", attribute: "APN_DASH" },
];

/**
 * The same seven fields /api/apn-lookup writes, as confidence-1.0 proposals so
 * the APN lookup input, the assessor stage and (phase 5) webhook drafts all
 * attach identical provenance.
 */
export function assessorProposals(summary: AssessorSummary, apn: string): ProposedField[] {
  const explanation = `Maricopa County Assessor · parcel ${apn}`;
  const sourceUrl = assessorParcelUrl(apn);
  const proposals: ProposedField[] = [];
  for (const { fieldPath, key, attribute } of FIELD_MAP) {
    const value = key === "apnFormatted" ? summary.apnFormatted || apn : summary[key];
    if (!value) continue;
    proposals.push({
      fieldPath,
      value,
      kind: "fill",
      provenance: {
        source: "assessor",
        confidence: 1,
        explanation,
        evidence: `${attribute}: ${value}`,
        sourceUrl,
      },
    });
  }
  return proposals;
}
```

- [ ] **Step 5: Implement `assessor.ts`**

`src/lib/prefill/assessor.ts`:

```ts
import type { AssessorSummary } from "./assessor-fields";
import { assessorParcelUrl, assessorProposals } from "./assessor-fields";
import { isValidApn, normalizeStreetName } from "./input";
import type { StageContext, StageResult } from "./stage";
import type { PrefillInput } from "./types";

export const ARCGIS_PARCELS_URL =
  "https://gis.mcassessor.maricopa.gov/arcgis/rest/services/Parcels/MapServer/0/query";

const ARCGIS_TIMEOUT_MS = 10_000;

const OUT_FIELDS = [
  "OWNER_NAME",
  "PHYSICAL_ADDRESS",
  "PHYSICAL_CITY",
  "PHYSICAL_ZIP",
  "JURISDICTION",
  "APN_DASH",
  "LAND_SIZE",
  "CONST_YEAR",
  "SUBNAME",
  "LOT_NUM",
  "BLOCK",
  "STR",
].join(",");

/** Attributes of one feature on the Maricopa Assessor Parcels layer */
export interface ParcelAttributes {
  OWNER_NAME?: string | null;
  PHYSICAL_ADDRESS?: string | null;
  PHYSICAL_CITY?: string | null;
  PHYSICAL_ZIP?: string | null;
  JURISDICTION?: string | null;
  APN_DASH?: string | null;
  LAND_SIZE?: number | string | null;
  CONST_YEAR?: number | string | null;
  SUBNAME?: string | null;
  LOT_NUM?: string | null;
  BLOCK?: string | null;
  STR?: string | null;
}

export class AssessorUnavailableError extends Error {
  constructor(status: number) {
    super(`Assessor service unavailable (HTTP ${status})`);
    this.name = "AssessorUnavailableError";
  }
}

interface QueryOptions {
  /** Outer abort (the run's 240 s budget); a 10 s per-request timeout is always applied */
  signal?: AbortSignal;
}

async function queryParcels(where: string, opts: QueryOptions = {}): Promise<ParcelAttributes[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ARCGIS_TIMEOUT_MS);
  const forwardAbort = () => controller.abort();
  if (opts.signal?.aborted) controller.abort();
  opts.signal?.addEventListener("abort", forwardAbort, { once: true });

  try {
    const params = new URLSearchParams({
      where,
      outFields: OUT_FIELDS,
      f: "json",
      returnGeometry: "false",
    });
    const response = await fetch(`${ARCGIS_PARCELS_URL}?${params}`, { signal: controller.signal });
    if (!response.ok) throw new AssessorUnavailableError(response.status);

    const data = (await response.json()) as { features?: Array<{ attributes?: ParcelAttributes }> };
    return (data.features ?? [])
      .map((f) => f.attributes)
      .filter((a): a is ParcelAttributes => Boolean(a));
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", forwardAbort);
  }
}

/** Parcel by dashed APN (`219-11-121`). Throws AssessorUnavailableError on non-2xx; null when not found. */
export async function queryParcelByApn(
  apn: string,
  opts?: QueryOptions,
): Promise<ParcelAttributes | null> {
  if (!isValidApn(apn)) throw new Error("Invalid APN format");
  const [first] = await queryParcels(`APN_DASH='${apn}'`, opts);
  return first ?? null;
}

/** Parcel by house number + street name (direction/suffix stripped). Null for unusable input, without a request. */
export async function findParcelByAddress(
  streetNumber: string,
  streetName: string,
  opts?: QueryOptions,
): Promise<ParcelAttributes | null> {
  const number = streetNumber.trim();
  const name = normalizeStreetName(streetName);
  if (!/^\d{1,8}$/.test(number) || !name) return null;
  const [first] = await queryParcels(
    `PHYSICAL_STREET_NUM='${number}' AND PHYSICAL_STREET_NAME LIKE '${name}%'`,
    opts,
  );
  return first ?? null;
}

/** "8911 E CAVE CREEK RD   CAREFREE  85377" → "8911 E CAVE CREEK RD" (the layer appends city/zip after runs of spaces) */
export function cleanPhysicalAddress(raw: string | null | undefined): string {
  return (raw ?? "").split(/ {2,}/)[0].trim();
}

export function mapParcelToAssessor(feature: ParcelAttributes): AssessorSummary {
  const legalParts = [
    feature.SUBNAME || "",
    feature.LOT_NUM ? `Lot ${feature.LOT_NUM}` : "",
    feature.BLOCK ? `Block ${feature.BLOCK}` : "",
    feature.STR ? `STR ${feature.STR}` : "",
  ].filter(Boolean);

  return {
    ownerName: feature.OWNER_NAME || "",
    physicalAddress: cleanPhysicalAddress(feature.PHYSICAL_ADDRESS),
    city: feature.PHYSICAL_CITY || "",
    zip: feature.PHYSICAL_ZIP || "",
    // The Maricopa County Assessor API only serves parcels in Maricopa
    // County, so the county is always "Maricopa". The JURISDICTION field on
    // the source record is the *city* (Phoenix, Tempe, etc.), not the
    // county — using it here previously left the County dropdown empty
    // because no value matched AZ_COUNTIES.
    county: "Maricopa",
    apnFormatted: feature.APN_DASH || "",
    legalDescription: legalParts.join(", "),
    lotSize: String(feature.LAND_SIZE || ""),
    yearBuilt: String(feature.CONST_YEAR || ""),
  };
}

/** Assessor stage: APN first, street-address fallback. Never throws. */
export async function runAssessorStage(
  input: PrefillInput,
  ctx: StageContext,
): Promise<StageResult> {
  const startedAt = new Date().toISOString();
  await ctx.progress({ status: "running", startedAt });
  const searched: string[] = [];

  try {
    let feature: ParcelAttributes | null = null;
    if (input.apn) {
      searched.push(`APN ${input.apn}`);
      feature = await queryParcelByApn(input.apn, { signal: ctx.signal });
    }
    if (!feature && input.address) {
      searched.push(`${input.address.streetNumber} ${input.address.streetName}`.trim());
      feature = await findParcelByAddress(input.address.streetNumber, input.address.streetName, {
        signal: ctx.signal,
      });
    }

    const finishedAt = new Date().toISOString();
    if (!feature) {
      return {
        stage: {
          status: "not_found",
          startedAt,
          finishedAt,
          summary: searched.length
            ? `No parcel found (searched ${searched.join(" and ")})`
            : "No APN or street address to search",
          links: [],
        },
        proposals: [],
      };
    }

    const summary = mapParcelToAssessor(feature);
    const apn = summary.apnFormatted || input.apn || "";
    return {
      stage: {
        status: "done",
        startedAt,
        finishedAt,
        summary: [`Parcel ${apn}`, summary.physicalAddress].filter(Boolean).join(" · "),
        links: apn ? [{ label: "Assessor parcel page", url: assessorParcelUrl(apn) }] : [],
      },
      proposals: assessorProposals(summary, apn),
    };
  } catch (err) {
    console.error("[prefill:assessor]", err);
    const error =
      err instanceof AssessorUnavailableError
        ? "Assessor service unavailable — try Find records later"
        : err instanceof Error && err.name === "AbortError"
          ? "Assessor lookup timed out"
          : "Assessor lookup failed";
    return {
      stage: { status: "error", startedAt, finishedAt: new Date().toISOString(), error, links: [] },
      proposals: [],
    };
  }
}
```

- [ ] **Step 6: Refactor `/api/apn-lookup` onto the library**

Replace the whole of `src/app/api/apn-lookup/route.ts` with:

```ts
import { NextResponse } from "next/server";
import {
  AssessorUnavailableError,
  mapParcelToAssessor,
  queryParcelByApn,
} from "@/lib/prefill/assessor";
import { isValidApn } from "@/lib/prefill/input";
import { createClient } from "@/lib/supabase/server";

/** In-memory rate limiter: userId → timestamps of recent lookups */
const lookupTimestamps = new Map<string, number[]>();
const MAX_LOOKUPS_PER_HOUR = 30;
const ONE_HOUR_MS = 60 * 60 * 1000;

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const timestamps = lookupTimestamps.get(userId) ?? [];
  const recent = timestamps.filter((t) => now - t < ONE_HOUR_MS);
  if (recent.length >= MAX_LOOKUPS_PER_HOUR) return false;
  recent.push(now);
  lookupTimestamps.set(userId, recent);
  return true;
}

/**
 * GET /api/apn-lookup?apn=123-45-678
 * Looks up property data from Maricopa County Assessor by APN.
 * The ArcGIS query itself lives in src/lib/prefill/assessor.ts so the
 * prefill assessor stage shares it.
 */
export async function GET(request: Request) {
  // Auth check
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!checkRateLimit(user.id)) {
    return NextResponse.json({ error: "Too many lookups — try again later" }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const apn = searchParams.get("apn")?.trim();

  if (!apn) {
    return NextResponse.json({ error: "APN parameter is required" }, { status: 400 });
  }

  if (!isValidApn(apn)) {
    return NextResponse.json({ error: "Invalid APN format" }, { status: 400 });
  }

  try {
    const feature = await queryParcelByApn(apn);

    if (!feature) {
      return NextResponse.json(
        { error: "No property found for this APN" },
        { status: 404 },
      );
    }

    return NextResponse.json({ assessor: mapParcelToAssessor(feature) });
  } catch (err) {
    if (err instanceof AssessorUnavailableError) {
      return NextResponse.json(
        { error: "Assessor service unavailable" },
        { status: 502 },
      );
    }
    console.error("APN lookup failed:", err);
    return NextResponse.json(
      { error: "APN lookup failed" },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 7: Run the new tests and the existing route test**

Run: `npx vitest run src/lib/prefill/__tests__/input.test.ts src/lib/prefill/__tests__/assessor-fields.test.ts src/lib/prefill/__tests__/assessor.test.ts src/app/api/apn-lookup/__tests__/route.test.ts`
Expected: PASS — all new tests plus the existing 24 apn-lookup route tests (the 502/500/404 paths still map the same way).

- [ ] **Step 8: Commit**

```bash
git add src/lib/prefill/input.ts src/lib/prefill/assessor-fields.ts src/lib/prefill/assessor.ts src/app/api/apn-lookup/route.ts src/lib/prefill/__tests__/input.test.ts src/lib/prefill/__tests__/assessor-fields.test.ts src/lib/prefill/__tests__/assessor.test.ts
git commit -m "feat(prefill): assessor stage + address fallback; apn-lookup route reuses the shared ArcGIS query"
```

---

### Task 5: Run store, run DTO, stage stubs and the `runPrefill` orchestrator

**Files:**
- Create: `src/lib/prefill/run-store.ts`
- Create: `src/lib/prefill/run-dto.ts`
- Create: `src/lib/prefill/listing/index.ts`
- Create: `src/lib/prefill/permits/index.ts`
- Create: `src/lib/prefill/run-prefill.ts`
- Test: `src/lib/prefill/__tests__/run-store.test.ts`
- Test: `src/lib/prefill/__tests__/run-dto.test.ts`
- Test: `src/lib/prefill/__tests__/run-prefill.test.ts`

**Interfaces:**
- Consumes: `inspectionPrefillRuns`, `inspectionRecords` (Task 3); `runAssessorStage` (Task 4); types (Task 1).
- Produces:
  - `run-store.ts`: `type PrefillRunRow`, `type InspectionRecordRow`, `countRunsInLastHour(inspectionId): Promise<number>`, `failStaleRuns(inspectionId): Promise<void>`, `findActiveRun(inspectionId): Promise<{ id: string } | null>`, `createRun({ inspectionId, trigger, input, createdBy }): Promise<string>` (returns the run id), `loadRunRow(runId): Promise<PrefillRunRow | null>`, `loadLatestRunRow(inspectionId): Promise<PrefillRunRow | null>`, `interface RunPatch`, `updateRun(runId, patch: RunPatch): Promise<void>`, `markRunApplied(runId): Promise<void>`, `listRecordRows(runId): Promise<InspectionRecordRow[]>`
  - `run-dto.ts`: `isAbandonmentDocType(docType): boolean`, `toInspectionRecordDTO(row): InspectionRecordDTO`, `toPrefillRunDTO(run, records): PrefillRunDTO`, `loadRunDTO(runId): Promise<PrefillRunDTO | null>`, `loadLatestRunDTO(inspectionId): Promise<PrefillRunDTO | null>`
  - `listing/index.ts`: `runListingStage(input, ctx): Promise<StageResult>`; `permits/index.ts`: `runPermitsStage(input, ctx): Promise<StageResult & { candidates?: PermitCandidate[] }>` — both return `{ status: "skipped", summary: "Not available yet", links: [] }` in phase 1
  - `run-prefill.ts`: `runPrefill(runId): Promise<void>`, `continuePrefillAfterSelection(runId, candidateKeys): Promise<void>`, `PREFILL_TOTAL_BUDGET_MS = 240_000`

- [ ] **Step 1: Write the failing tests**

`src/lib/prefill/__tests__/run-store.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockExecute, mockLimit, mockReturning, mockUpdateWhere, mockSet, mockValues } = vi.hoisted(
  () => ({
    mockExecute: vi.fn(),
    mockLimit: vi.fn(),
    mockReturning: vi.fn(),
    mockUpdateWhere: vi.fn(),
    mockSet: vi.fn(),
    mockValues: vi.fn(),
  }),
);

vi.mock("@/lib/db", () => {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn(() => mockLimit()),
  };
  const insertChain = {
    values: vi.fn((v: unknown) => {
      mockValues(v);
      return insertChain;
    }),
    returning: vi.fn(() => mockReturning()),
  };
  const updateChain = {
    set: vi.fn((v: unknown) => {
      mockSet(v);
      return updateChain;
    }),
    where: vi.fn(() => mockUpdateWhere()),
  };
  return {
    db: {
      execute: vi.fn((q: unknown) => mockExecute(q)),
      select: vi.fn(() => selectChain),
      insert: vi.fn(() => insertChain),
      update: vi.fn(() => updateChain),
    },
  };
});

import {
  countRunsInLastHour,
  createRun,
  failStaleRuns,
  findActiveRun,
  listRecordRows,
  loadLatestRunRow,
  loadRunRow,
  markRunApplied,
  updateRun,
} from "@/lib/prefill/run-store";

beforeEach(() => {
  vi.clearAllMocks();
  mockExecute.mockResolvedValue([]);
  mockLimit.mockResolvedValue([]);
  mockReturning.mockResolvedValue([{ id: "run-1" }]);
  mockUpdateWhere.mockResolvedValue(undefined);
});

describe("run-store", () => {
  it("countRunsInLastHour reads the count column", async () => {
    mockExecute.mockResolvedValueOnce([{ n: 2 }]);
    expect(await countRunsInLastHour("insp-1")).toBe(2);
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it("countRunsInLastHour returns 0 for an empty result", async () => {
    expect(await countRunsInLastHour("insp-1")).toBe(0);
  });

  it("failStaleRuns issues one UPDATE", async () => {
    await failStaleRuns("insp-1");
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it("findActiveRun returns the row or null", async () => {
    expect(await findActiveRun("insp-1")).toBeNull();
    mockLimit.mockResolvedValueOnce([{ id: "run-9" }]);
    expect(await findActiveRun("insp-1")).toEqual({ id: "run-9" });
  });

  it("createRun inserts a queued row with empty stages and returns its id", async () => {
    const id = await createRun({
      inspectionId: "insp-1",
      trigger: "apn_lookup",
      input: { apn: "219-11-121" },
      createdBy: "user-1",
    });
    expect(id).toBe("run-1");
    expect(mockValues).toHaveBeenCalledWith({
      inspectionId: "insp-1",
      trigger: "apn_lookup",
      status: "queued",
      input: { apn: "219-11-121" },
      stages: {
        assessor: { status: "pending", links: [] },
        listing: { status: "pending", links: [] },
        permits: { status: "pending", links: [] },
      },
      createdBy: "user-1",
    });
  });

  it("loadRunRow / loadLatestRunRow return the first row or null", async () => {
    expect(await loadRunRow("run-1")).toBeNull();
    mockLimit.mockResolvedValueOnce([{ id: "run-1" }]);
    expect(await loadRunRow("run-1")).toEqual({ id: "run-1" });
    mockLimit.mockResolvedValueOnce([{ id: "run-2" }]);
    expect(await loadLatestRunRow("insp-1")).toEqual({ id: "run-2" });
  });

  it("updateRun and markRunApplied write through set()", async () => {
    await updateRun("run-1", { status: "done", error: null });
    expect(mockSet).toHaveBeenCalledWith({ status: "done", error: null });
    await markRunApplied("run-1");
    expect(mockSet).toHaveBeenLastCalledWith({ appliedAt: expect.any(Date) });
  });

  it("listRecordRows returns the rows", async () => {
    mockLimit.mockResolvedValueOnce([{ id: "rec-1" }]);
    expect(await listRecordRows("run-1")).toEqual([{ id: "rec-1" }]);
  });
});
```

`src/lib/prefill/__tests__/run-dto.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockLoadRunRow, mockLoadLatestRunRow, mockListRecordRows } = vi.hoisted(() => ({
  mockLoadRunRow: vi.fn(),
  mockLoadLatestRunRow: vi.fn(),
  mockListRecordRows: vi.fn(),
}));

vi.mock("@/lib/prefill/run-store", () => ({
  loadRunRow: mockLoadRunRow,
  loadLatestRunRow: mockLoadLatestRunRow,
  listRecordRows: mockListRecordRows,
}));

import type { InspectionRecordRow, PrefillRunRow } from "@/lib/prefill/run-store";
import {
  isAbandonmentDocType,
  loadLatestRunDTO,
  loadRunDTO,
  toInspectionRecordDTO,
  toPrefillRunDTO,
} from "@/lib/prefill/run-dto";

const RUN: PrefillRunRow = {
  id: "run-1",
  inspectionId: "insp-1",
  trigger: "manual",
  status: "done",
  input: { apn: "219-11-121" },
  stages: { assessor: { status: "done", summary: "Parcel 219-11-121", links: [] } },
  proposals: [],
  candidates: [],
  error: null,
  appliedAt: null,
  createdBy: "user-1",
  createdAt: new Date("2026-09-11T10:00:00.000Z"),
  finishedAt: new Date("2026-09-11T10:00:05.000Z"),
};

const RECORD: InspectionRecordRow = {
  id: "rec-1",
  inspectionId: "insp-1",
  runId: "run-1",
  source: "edms_env",
  permitNumber: "OW-17-00474",
  docType: "ABANDONMENT",
  docDate: "2019-03-04",
  description: null,
  pageCount: 3,
  sizeBytes: 12345,
  storagePath: "records/insp-1/rec-1.pdf",
  selected: true,
  extractionStatus: "pending",
  extractionError: null,
  extracted: null,
  createdAt: new Date("2026-09-11T10:00:03.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockListRecordRows.mockResolvedValue([]);
});

describe("toPrefillRunDTO", () => {
  it("serialises dates, fills missing stages and maps records", () => {
    const dto = toPrefillRunDTO(RUN, [RECORD]);
    expect(dto).toMatchObject({
      id: "run-1",
      inspectionId: "insp-1",
      trigger: "manual",
      status: "done",
      input: { apn: "219-11-121" },
      error: null,
      appliedAt: null,
      createdAt: "2026-09-11T10:00:00.000Z",
      finishedAt: "2026-09-11T10:00:05.000Z",
    });
    expect(dto.stages.assessor.status).toBe("done");
    expect(dto.stages.listing).toEqual({ status: "pending", links: [] });
    expect(dto.stages.permits).toEqual({ status: "pending", links: [] });
    expect(dto.records).toHaveLength(1);
  });

  it("tolerates a queued row whose jsonb columns are still defaults", () => {
    const dto = toPrefillRunDTO({ ...RUN, status: "queued", stages: {}, input: {}, finishedAt: null }, []);
    expect(dto.stages.assessor).toEqual({ status: "pending", links: [] });
    expect(dto.finishedAt).toBeNull();
    expect(dto.proposals).toEqual([]);
    expect(dto.candidates).toEqual([]);
  });
});

describe("toInspectionRecordDTO", () => {
  it("builds the auth-gated download URL and flags abandonment documents", () => {
    const dto = toInspectionRecordDTO(RECORD);
    expect(dto.downloadUrl).toBe("/api/inspections/insp-1/records/rec-1");
    expect(dto.isAbandonment).toBe(true);
    expect(dto.docDate).toBe("2019-03-04");
    expect(dto).not.toHaveProperty("storagePath");
  });

  it("isAbandonmentDocType is case-insensitive", () => {
    expect(isAbandonmentDocType("Abandonment")).toBe(true);
    expect(isAbandonmentDocType("PERMIT")).toBe(false);
  });
});

describe("loadRunDTO / loadLatestRunDTO", () => {
  it("returns null when the run does not exist", async () => {
    mockLoadRunRow.mockResolvedValueOnce(null);
    expect(await loadRunDTO("nope")).toBeNull();
    mockLoadLatestRunRow.mockResolvedValueOnce(null);
    expect(await loadLatestRunDTO("insp-1")).toBeNull();
  });

  it("joins the records for the run", async () => {
    mockLoadRunRow.mockResolvedValueOnce(RUN);
    mockListRecordRows.mockResolvedValueOnce([RECORD]);
    const dto = await loadRunDTO("run-1");
    expect(mockListRecordRows).toHaveBeenCalledWith("run-1");
    expect(dto?.records[0].id).toBe("rec-1");
    mockLoadLatestRunRow.mockResolvedValueOnce(RUN);
    const latest = await loadLatestRunDTO("insp-1");
    expect(latest?.id).toBe("run-1");
  });
});
```

`src/lib/prefill/__tests__/run-prefill.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockLoadRunRow, mockUpdateRun, mockRunAssessorStage } = vi.hoisted(() => ({
  mockLoadRunRow: vi.fn(),
  mockUpdateRun: vi.fn(),
  mockRunAssessorStage: vi.fn(),
}));

vi.mock("@/lib/prefill/run-store", () => ({
  loadRunRow: mockLoadRunRow,
  updateRun: mockUpdateRun,
}));

vi.mock("@/lib/prefill/assessor", () => ({
  runAssessorStage: mockRunAssessorStage,
}));

import { continuePrefillAfterSelection, runPrefill } from "@/lib/prefill/run-prefill";
import type { StageContext } from "@/lib/prefill/stage";
import type { PrefillInput } from "@/lib/prefill/types";

const RUN = {
  id: "run-1",
  inspectionId: "insp-1",
  trigger: "manual",
  status: "queued",
  input: { apn: "219-11-121" },
  stages: {},
  proposals: [],
  candidates: [],
  error: null,
  appliedAt: null,
  createdBy: "user-1",
  createdAt: new Date(),
  finishedAt: null,
};

const PROPOSAL = {
  fieldPath: "facilityInfo.taxParcelNumber",
  value: "219-11-121",
  kind: "fill" as const,
  provenance: { source: "assessor" as const, confidence: 1, explanation: "Assessor" },
};

function lastPatch() {
  const call = mockUpdateRun.mock.calls[mockUpdateRun.mock.calls.length - 1];
  return call[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadRunRow.mockResolvedValue(RUN);
  mockUpdateRun.mockResolvedValue(undefined);
  mockRunAssessorStage.mockImplementation(async (_input: PrefillInput, ctx: StageContext) => {
    await ctx.progress({ status: "running" });
    return {
      stage: { status: "done", summary: "Parcel 219-11-121", links: [] },
      proposals: [PROPOSAL],
    };
  });
});

describe("runPrefill", () => {
  it("marks the run running, runs the stages, stores proposals and finishes done", async () => {
    await runPrefill("run-1");

    expect(mockUpdateRun.mock.calls[0][0]).toBe("run-1");
    expect(mockUpdateRun.mock.calls[0][1]).toMatchObject({ status: "running" });

    const final = lastPatch();
    expect(final.status).toBe("done");
    expect(final.proposals).toEqual([PROPOSAL]);
    expect(final.stages.assessor.status).toBe("done");
    expect(final.stages.listing).toEqual({ status: "skipped", summary: "Not available yet", links: [] });
    expect(final.stages.permits).toEqual({ status: "skipped", summary: "Not available yet", links: [] });
    expect(final.finishedAt).toBeInstanceOf(Date);
  });

  it("passes the run input and a StageContext to the assessor stage", async () => {
    await runPrefill("run-1");
    const [input, ctx] = mockRunAssessorStage.mock.calls[0];
    expect(input).toEqual({ apn: "219-11-121" });
    expect(ctx.inspectionId).toBe("insp-1");
    expect(ctx.runId).toBe("run-1");
    expect(ctx.signal).toBeInstanceOf(AbortSignal);
    expect(ctx.signal.aborted).toBe(false);
  });

  it("persists progress updates so the client can see stages advance", async () => {
    await runPrefill("run-1");
    const progressCall = mockUpdateRun.mock.calls.find(
      (c) => c[1].stages?.assessor?.status === "running",
    );
    expect(progressCall).toBeDefined();
  });

  it("does nothing when the run is missing or not queued", async () => {
    mockLoadRunRow.mockResolvedValueOnce(null);
    await runPrefill("run-1");
    mockLoadRunRow.mockResolvedValueOnce({ ...RUN, status: "done" });
    await runPrefill("run-1");
    expect(mockUpdateRun).not.toHaveBeenCalled();
    expect(mockRunAssessorStage).not.toHaveBeenCalled();
  });

  it("records a stage error when a stage rejects and still finishes the run", async () => {
    mockRunAssessorStage.mockRejectedValueOnce(new Error("boom"));
    await runPrefill("run-1");
    const final = lastPatch();
    expect(final.status).toBe("done");
    expect(final.stages.assessor).toMatchObject({ status: "error", error: "boom", links: [] });
    expect(final.proposals).toEqual([]);
  });

  it("marks the run failed (never throws) when persistence blows up", async () => {
    mockUpdateRun.mockRejectedValueOnce(new Error("db down"));
    await expect(runPrefill("run-1")).resolves.toBeUndefined();
    const final = lastPatch();
    expect(final.status).toBe("failed");
    expect(final.error).toBe("db down");
    expect(final.finishedAt).toBeInstanceOf(Date);
  });

  it("swallows a load failure", async () => {
    mockLoadRunRow.mockRejectedValueOnce(new Error("db down"));
    await expect(runPrefill("run-1")).resolves.toBeUndefined();
    expect(mockUpdateRun).not.toHaveBeenCalled();
  });
});

describe("continuePrefillAfterSelection", () => {
  it("fails the run with an explicit phase-1 message", async () => {
    await continuePrefillAfterSelection("run-1", ["edms_env:OW-17-00474:PERMIT:"]);
    expect(mockUpdateRun).toHaveBeenCalledWith("run-1", {
      status: "failed",
      error: "Candidate selection is not available yet",
      finishedAt: expect.any(Date),
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/prefill/__tests__/run-store.test.ts src/lib/prefill/__tests__/run-dto.test.ts src/lib/prefill/__tests__/run-prefill.test.ts`
Expected: FAIL — unresolved imports for `run-store`, `run-dto`, `run-prefill`.

- [ ] **Step 3: Implement `run-store.ts`**

`src/lib/prefill/run-store.ts`:

```ts
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { inspectionPrefillRuns, inspectionRecords } from "@/lib/db/schema";
import type {
  PermitCandidate,
  PrefillInput,
  PrefillRunStatus,
  PrefillStages,
  PrefillTrigger,
  ProposedField,
} from "./types";
import { emptyStages } from "./types";

export type PrefillRunRow = typeof inspectionPrefillRuns.$inferSelect;
export type InspectionRecordRow = typeof inspectionRecords.$inferSelect;

/** Runs created in the last rolling hour — the DB-backed rate limit (survives cold starts) */
export async function countRunsInLastHour(inspectionId: string): Promise<number> {
  const rows = await db.execute(
    sql`SELECT count(*)::int AS n FROM inspection_prefill_runs
        WHERE inspection_id = ${inspectionId} AND created_at > now() - interval '1 hour'`,
  );
  return Number(rows[0]?.n ?? 0);
}

/** Queued/running runs older than 5 minutes are stuck — fail them so they can't hold the lock forever */
export async function failStaleRuns(inspectionId: string): Promise<void> {
  await db.execute(
    sql`UPDATE inspection_prefill_runs
        SET status = 'failed', error = 'Timed out', finished_at = now()
        WHERE inspection_id = ${inspectionId}
          AND status IN ('queued', 'running')
          AND created_at < now() - interval '5 minutes'`,
  );
}

export async function findActiveRun(inspectionId: string): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: inspectionPrefillRuns.id })
    .from(inspectionPrefillRuns)
    .where(
      and(
        eq(inspectionPrefillRuns.inspectionId, inspectionId),
        inArray(inspectionPrefillRuns.status, ["queued", "running"]),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function createRun(args: {
  inspectionId: string;
  trigger: PrefillTrigger;
  input: PrefillInput;
  createdBy: string | null;
}): Promise<string> {
  const [row] = await db
    .insert(inspectionPrefillRuns)
    .values({
      inspectionId: args.inspectionId,
      trigger: args.trigger,
      status: "queued",
      input: args.input,
      stages: emptyStages(),
      createdBy: args.createdBy,
    })
    .returning({ id: inspectionPrefillRuns.id });
  return row.id;
}

export async function loadRunRow(runId: string): Promise<PrefillRunRow | null> {
  const [row] = await db
    .select()
    .from(inspectionPrefillRuns)
    .where(eq(inspectionPrefillRuns.id, runId))
    .limit(1);
  return row ?? null;
}

export async function loadLatestRunRow(inspectionId: string): Promise<PrefillRunRow | null> {
  const [row] = await db
    .select()
    .from(inspectionPrefillRuns)
    .where(eq(inspectionPrefillRuns.inspectionId, inspectionId))
    .orderBy(desc(inspectionPrefillRuns.createdAt))
    .limit(1);
  return row ?? null;
}

export interface RunPatch {
  status?: PrefillRunStatus;
  stages?: PrefillStages;
  proposals?: ProposedField[];
  candidates?: PermitCandidate[];
  error?: string | null;
  finishedAt?: Date | null;
  appliedAt?: Date | null;
}

export async function updateRun(runId: string, patch: RunPatch): Promise<void> {
  await db.update(inspectionPrefillRuns).set(patch).where(eq(inspectionPrefillRuns.id, runId));
}

export async function markRunApplied(runId: string): Promise<void> {
  await updateRun(runId, { appliedAt: new Date() });
}

/** Capped at 200 rows — a run stores at most a handful of documents */
export async function listRecordRows(runId: string): Promise<InspectionRecordRow[]> {
  return db
    .select()
    .from(inspectionRecords)
    .where(eq(inspectionRecords.runId, runId))
    .orderBy(inspectionRecords.createdAt)
    .limit(200);
}
```

- [ ] **Step 4: Implement `run-dto.ts`**

`src/lib/prefill/run-dto.ts`:

```ts
import type { InspectionRecordRow, PrefillRunRow } from "./run-store";
import { listRecordRows, loadLatestRunRow, loadRunRow } from "./run-store";
import type {
  ExtractionStatus,
  InspectionRecordDTO,
  PermitArchive,
  PermitCandidate,
  PrefillInput,
  PrefillRunDTO,
  PrefillRunStatus,
  PrefillStages,
  PrefillTrigger,
  ProposedField,
} from "./types";
import { emptyStages } from "./types";

export function isAbandonmentDocType(docType: string): boolean {
  return /ABANDON/i.test(docType);
}

/** Never exposes storage_path — documents are reached only through the auth-gated records route */
export function toInspectionRecordDTO(row: InspectionRecordRow): InspectionRecordDTO {
  return {
    id: row.id,
    source: row.source as PermitArchive,
    permitNumber: row.permitNumber,
    docType: row.docType,
    docDate: row.docDate,
    description: row.description,
    pageCount: row.pageCount,
    sizeBytes: row.sizeBytes,
    selected: row.selected,
    extractionStatus: row.extractionStatus as ExtractionStatus,
    extractionError: row.extractionError,
    isAbandonment: isAbandonmentDocType(row.docType),
    downloadUrl: `/api/inspections/${row.inspectionId}/records/${row.id}`,
  };
}

export function toPrefillRunDTO(run: PrefillRunRow, records: InspectionRecordRow[]): PrefillRunDTO {
  const stages: PrefillStages = {
    ...emptyStages(),
    ...((run.stages ?? {}) as Partial<PrefillStages>),
  };
  return {
    id: run.id,
    inspectionId: run.inspectionId,
    trigger: run.trigger as PrefillTrigger,
    status: run.status as PrefillRunStatus,
    input: (run.input ?? {}) as PrefillInput,
    stages,
    proposals: (run.proposals ?? []) as ProposedField[],
    candidates: (run.candidates ?? []) as PermitCandidate[],
    error: run.error,
    appliedAt: run.appliedAt ? run.appliedAt.toISOString() : null,
    createdAt: run.createdAt.toISOString(),
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
    records: records.map(toInspectionRecordDTO),
  };
}

export async function loadRunDTO(runId: string): Promise<PrefillRunDTO | null> {
  const run = await loadRunRow(runId);
  if (!run) return null;
  const records = await listRecordRows(run.id);
  return toPrefillRunDTO(run, records);
}

export async function loadLatestRunDTO(inspectionId: string): Promise<PrefillRunDTO | null> {
  const run = await loadLatestRunRow(inspectionId);
  if (!run) return null;
  const records = await listRecordRows(run.id);
  return toPrefillRunDTO(run, records);
}
```

- [ ] **Step 5: Implement the phase-1 stage stubs**

`src/lib/prefill/listing/index.ts`:

```ts
import type { StageContext, StageResult } from "../stage";
import type { PrefillInput } from "../types";

/** Phase 4 replaces this with the Zillow/Apify provider */
export async function runListingStage(
  _input: PrefillInput,
  _ctx: StageContext,
): Promise<StageResult> {
  return { stage: { status: "skipped", summary: "Not available yet", links: [] }, proposals: [] };
}
```

`src/lib/prefill/permits/index.ts`:

```ts
import type { StageContext, StageResult } from "../stage";
import type { PermitCandidate, PrefillInput } from "../types";

/** Phase 2 replaces this with the Maricopa EDMS search + document download */
export async function runPermitsStage(
  _input: PrefillInput,
  _ctx: StageContext,
): Promise<StageResult & { candidates?: PermitCandidate[] }> {
  return { stage: { status: "skipped", summary: "Not available yet", links: [] }, proposals: [] };
}
```

- [ ] **Step 6: Implement the orchestrator**

`src/lib/prefill/run-prefill.ts`:

```ts
import { runAssessorStage } from "./assessor";
import { runListingStage } from "./listing";
import { runPermitsStage } from "./permits";
import type { PrefillRunRow } from "./run-store";
import { loadRunRow, updateRun } from "./run-store";
import type { StageContext, StageResult } from "./stage";
import type { PrefillInput, PrefillStages, ProposedField } from "./types";
import { emptyStages } from "./types";

/** Hard stop for a whole run; whatever finished is persisted */
export const PREFILL_TOTAL_BUDGET_MS = 240_000;

const STAGE_NAMES: Array<keyof PrefillStages> = ["assessor", "listing", "permits"];

/**
 * Runs all stages for a run row that is `queued`, persisting progress after each stage.
 * Safe to call from `after()`. Never throws; on unexpected error marks the run `failed`.
 */
export async function runPrefill(runId: string): Promise<void> {
  let run: PrefillRunRow | null;
  try {
    run = await loadRunRow(runId);
  } catch (err) {
    console.error("[prefill] could not load run", runId, err);
    return;
  }
  if (!run || run.status !== "queued") return;

  const input = (run.input ?? {}) as PrefillInput;
  const stages = emptyStages();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PREFILL_TOTAL_BUDGET_MS);

  // Always persist a snapshot — `stages` keeps mutating while stages run in parallel
  const makeContext = (name: keyof PrefillStages): StageContext => ({
    inspectionId: run.inspectionId,
    runId,
    signal: controller.signal,
    progress: async (patch) => {
      stages[name] = { ...stages[name], ...patch };
      await updateRun(runId, { stages: { ...stages } });
    },
  });

  try {
    await updateRun(runId, { status: "running", stages: { ...stages } });

    const settled = await Promise.allSettled<StageResult>([
      runAssessorStage(input, makeContext("assessor")),
      runListingStage(input, makeContext("listing")),
      runPermitsStage(input, makeContext("permits")),
    ]);

    const proposals: ProposedField[] = [];
    settled.forEach((result, i) => {
      const name = STAGE_NAMES[i];
      if (result.status === "fulfilled") {
        stages[name] = result.value.stage;
        proposals.push(...result.value.proposals);
      } else {
        // Stage modules are contracted never to throw; this is the belt-and-braces path
        stages[name] = {
          ...stages[name],
          status: "error",
          error: result.reason instanceof Error ? result.reason.message : "Stage failed",
          finishedAt: new Date().toISOString(),
          links: stages[name].links ?? [],
        };
      }
    });

    await updateRun(runId, {
      status: "done",
      stages: { ...stages },
      proposals,
      finishedAt: new Date(),
    });
  } catch (err) {
    console.error("[prefill] run failed", runId, err);
    try {
      await updateRun(runId, {
        status: "failed",
        stages: { ...stages },
        error: err instanceof Error ? err.message : "Prefill failed",
        finishedAt: new Date(),
      });
    } catch (persistErr) {
      console.error("[prefill] could not record failure", runId, persistErr);
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Called by the /select route after candidates are chosen.
 * Phase 1 has no stage that produces candidates, so a selection can only reach
 * here through a hand-crafted request — record it as a failed run.
 * Phase 2 replaces this with the extraction continuation.
 */
export async function continuePrefillAfterSelection(
  runId: string,
  _candidateKeys: string[],
): Promise<void> {
  await updateRun(runId, {
    status: "failed",
    error: "Candidate selection is not available yet",
    finishedAt: new Date(),
  });
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/lib/prefill/__tests__/run-store.test.ts src/lib/prefill/__tests__/run-dto.test.ts src/lib/prefill/__tests__/run-prefill.test.ts`
Expected: PASS (8 + 6 + 8 tests).

- [ ] **Step 8: Commit**

```bash
git add src/lib/prefill/run-store.ts src/lib/prefill/run-dto.ts src/lib/prefill/listing/index.ts src/lib/prefill/permits/index.ts src/lib/prefill/run-prefill.ts src/lib/prefill/__tests__/run-store.test.ts src/lib/prefill/__tests__/run-dto.test.ts src/lib/prefill/__tests__/run-prefill.test.ts
git commit -m "feat(prefill): run store, run DTO and runPrefill orchestrator with assessor stage (listing/permits stubbed)"
```

---

### Task 6: Shared route access helper + `PATCH /api/inspections/[id]/provenance`

**Files:**
- Create: `src/lib/prefill/route-access.ts`
- Create: `src/app/api/inspections/[id]/provenance/route.ts`
- Test: `src/lib/prefill/__tests__/route-access.test.ts`
- Test: `src/app/api/inspections/[id]/provenance/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `checkInspectionAccess` (`src/lib/supabase/auth-helpers.ts`), `createClient`, `db`, `inspections`, `provenancePatchBodySchema` (Task 1).
- Produces: `requireInspectionAccess(inspectionId: string, mode: "view" | "edit"): Promise<InspectionAccess>` where `InspectionAccess = { ok: true; userId: string; inspection: { inspectorId: string; status: string; formData: unknown }; isPrivileged: boolean } | { ok: false; response: NextResponse }`. `"view"` = owner or admin/office_staff; `"edit"` additionally rejects non-privileged users on non-drafts (mirrors `PATCH /api/inspections/[id]`). Every prefill route in Tasks 7–8 starts with it.

- [ ] **Step 1: Write the failing tests**

`src/lib/prefill/__tests__/route-access.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetUser, mockGetSession, mockCreateClient, mockDbSelect } = vi.hoisted(() => {
  const mockGetUser = vi.fn();
  const mockGetSession = vi.fn();
  const mockDbSelect = vi.fn();
  const mockCreateClient = vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
  });
  return { mockGetUser, mockGetSession, mockCreateClient, mockDbSelect };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));

vi.mock("@/lib/db", () => {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(() => mockDbSelect()),
  };
  return { db: { select: vi.fn(() => selectChain) } };
});

vi.mock("@/lib/db/schema", () => ({
  inspections: { id: "id", inspectorId: "inspector_id", status: "status", formData: "form_data" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ _col, val })),
}));

import { requireInspectionAccess } from "@/lib/prefill/route-access";

function fakeAccessToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64");
  return `${header}.${body}.fakesig`;
}

function sessionWithRole(role: string) {
  return { data: { session: { access_token: fakeAccessToken({ user_role: role }) } } };
}

const USER = { id: "user-1", email: "tech@example.com" };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: USER } });
  mockGetSession.mockResolvedValue(sessionWithRole("field_tech"));
  mockDbSelect.mockResolvedValue([{ inspectorId: "user-1", status: "draft", formData: {} }]);
});

describe("requireInspectionAccess", () => {
  it("returns a 401 response when unauthenticated", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const access = await requireInspectionAccess("insp-1", "view");
    expect(access.ok).toBe(false);
    if (!access.ok) expect(access.response.status).toBe(401);
  });

  it("returns a 404 response when the inspection does not exist", async () => {
    mockDbSelect.mockResolvedValueOnce([]);
    const access = await requireInspectionAccess("insp-1", "view");
    expect(access.ok).toBe(false);
    if (!access.ok) expect(access.response.status).toBe(404);
  });

  it("lets the owner view and edit their draft", async () => {
    const access = await requireInspectionAccess("insp-1", "edit");
    expect(access.ok).toBe(true);
    if (access.ok) {
      expect(access.userId).toBe("user-1");
      expect(access.inspection.inspectorId).toBe("user-1");
      expect(access.isPrivileged).toBe(false);
    }
  });

  it("returns 403 for a non-owner field tech", async () => {
    mockDbSelect.mockResolvedValueOnce([{ inspectorId: "someone-else", status: "draft", formData: {} }]);
    const access = await requireInspectionAccess("insp-1", "view");
    expect(access.ok).toBe(false);
    if (!access.ok) expect(access.response.status).toBe(403);
  });

  it("returns 403 when a field tech edits a non-draft, but allows viewing it", async () => {
    mockDbSelect.mockResolvedValue([{ inspectorId: "user-1", status: "submitted", formData: {} }]);
    const edit = await requireInspectionAccess("insp-1", "edit");
    expect(edit.ok).toBe(false);
    if (!edit.ok) {
      expect(edit.response.status).toBe(403);
      expect((await edit.response.json()).error).toContain("no longer a draft");
    }
    const view = await requireInspectionAccess("insp-1", "view");
    expect(view.ok).toBe(true);
  });

  it("lets admin and office_staff edit anyone's inspection in any status", async () => {
    for (const role of ["admin", "office_staff"]) {
      mockGetSession.mockResolvedValue(sessionWithRole(role));
      mockDbSelect.mockResolvedValueOnce([{ inspectorId: "someone-else", status: "completed", formData: {} }]);
      const access = await requireInspectionAccess("insp-1", "edit");
      expect(access.ok).toBe(true);
      if (access.ok) expect(access.isPrivileged).toBe(true);
    }
  });
});
```

`src/app/api/inspections/[id]/provenance/__tests__/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetUser, mockGetSession, mockCreateClient, mockDbSelect, mockDbUpdate, mockSet } =
  vi.hoisted(() => {
    const mockGetUser = vi.fn();
    const mockGetSession = vi.fn();
    const mockDbSelect = vi.fn();
    const mockDbUpdate = vi.fn();
    const mockSet = vi.fn();
    const mockCreateClient = vi.fn().mockResolvedValue({
      auth: { getUser: mockGetUser, getSession: mockGetSession },
    });
    return { mockGetUser, mockGetSession, mockCreateClient, mockDbSelect, mockDbUpdate, mockSet };
  });

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));

vi.mock("@/lib/db", () => {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(() => mockDbSelect()),
  };
  const updateChain = {
    set: vi.fn((v: unknown) => {
      mockSet(v);
      return updateChain;
    }),
    where: vi.fn(() => mockDbUpdate()),
  };
  return { db: { select: vi.fn(() => selectChain), update: vi.fn(() => updateChain) } };
});

vi.mock("@/lib/db/schema", () => ({
  inspections: {
    id: "id",
    inspectorId: "inspector_id",
    status: "status",
    formData: "form_data",
    fieldProvenance: "field_provenance",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ _col, val })),
}));

import { PATCH } from "../route";

function fakeAccessToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64");
  return `${header}.${body}.fakesig`;
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeRequest(body: unknown, raw = false): Request {
  return new Request("http://localhost/api/inspections/insp-1/provenance", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

const USER = { id: "user-1", email: "tech@example.com" };
const ENTRY = {
  source: "assessor",
  state: "prefilled",
  kind: "fill",
  value: "219-11-121",
  confidence: 1,
  explanation: "Maricopa County Assessor · parcel 219-11-121",
  sourceUrl: "https://mcassessor.maricopa.gov/mcs/?q=219-11-121",
  at: "2026-09-11T10:00:00.000Z",
};
const BODY = { fieldProvenance: { "facilityInfo.taxParcelNumber": ENTRY } };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: USER } });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: fakeAccessToken({ user_role: "field_tech" }) } },
  });
  mockDbSelect.mockResolvedValue([{ inspectorId: "user-1", status: "draft", formData: {} }]);
  mockDbUpdate.mockResolvedValue(undefined);
});

describe("PATCH /api/inspections/[id]/provenance", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const res = await PATCH(makeRequest(BODY), makeParams("insp-1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when the inspection does not exist", async () => {
    mockDbSelect.mockResolvedValueOnce([]);
    const res = await PATCH(makeRequest(BODY), makeParams("insp-1"));
    expect(res.status).toBe(404);
  });

  it("returns 403 for a non-owner field tech", async () => {
    mockDbSelect.mockResolvedValueOnce([{ inspectorId: "other", status: "draft", formData: {} }]);
    const res = await PATCH(makeRequest(BODY), makeParams("insp-1"));
    expect(res.status).toBe(403);
  });

  it("returns 403 when a field tech writes to a non-draft", async () => {
    mockDbSelect.mockResolvedValueOnce([{ inspectorId: "user-1", status: "in_review", formData: {} }]);
    const res = await PATCH(makeRequest(BODY), makeParams("insp-1"));
    expect(res.status).toBe(403);
  });

  it("replaces the whole map for the owner of a draft", async () => {
    const res = await PATCH(makeRequest(BODY), makeParams("insp-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ saved: true });
    expect(mockSet).toHaveBeenCalledWith({ fieldProvenance: BODY.fieldProvenance });
  });

  it("lets admins write provenance on any inspection", async () => {
    mockGetSession.mockResolvedValueOnce({
      data: { session: { access_token: fakeAccessToken({ user_role: "admin" }) } },
    });
    mockDbSelect.mockResolvedValueOnce([{ inspectorId: "other", status: "completed", formData: {} }]);
    const res = await PATCH(makeRequest({ fieldProvenance: {} }), makeParams("insp-1"));
    expect(res.status).toBe(200);
  });

  it("returns 400 for invalid JSON", async () => {
    const res = await PATCH(makeRequest("{not json", true), makeParams("insp-1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid JSON body");
  });

  it("returns 400 when the map fails validation (bad source, javascript: URL)", async () => {
    const badSource = await PATCH(
      makeRequest({ fieldProvenance: { "facilityInfo.x": { ...ENTRY, source: "zillow" } } }),
      makeParams("insp-1"),
    );
    expect(badSource.status).toBe(400);
    expect((await badSource.json()).error).toBe("Invalid provenance");

    const badUrl = await PATCH(
      makeRequest({ fieldProvenance: { "facilityInfo.x": { ...ENTRY, sourceUrl: "javascript:alert(1)" } } }),
      makeParams("insp-1"),
    );
    expect(badUrl.status).toBe(400);
    expect(mockSet).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/prefill/__tests__/route-access.test.ts "src/app/api/inspections/[id]/provenance/__tests__/route.test.ts"`
Expected: FAIL — unresolved imports.

- [ ] **Step 3: Implement `route-access.ts`**

`src/lib/prefill/route-access.ts`:

```ts
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { inspections } from "@/lib/db/schema";
import { checkInspectionAccess } from "@/lib/supabase/auth-helpers";
import { createClient } from "@/lib/supabase/server";

export type InspectionAccess =
  | {
      ok: true;
      userId: string;
      inspection: { inspectorId: string; status: string; formData: unknown };
      isPrivileged: boolean;
    }
  | { ok: false; response: NextResponse };

/**
 * Auth gate shared by the prefill/provenance routes.
 *  - "view": owner, or admin/office_staff.
 *  - "edit": as "view", and non-privileged users may only touch drafts
 *    (the same rule PATCH /api/inspections/[id] enforces).
 */
export async function requireInspectionAccess(
  inspectionId: string,
  mode: "view" | "edit",
): Promise<InspectionAccess> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const [inspection] = await db
    .select({
      inspectorId: inspections.inspectorId,
      status: inspections.status,
      formData: inspections.formData,
    })
    .from(inspections)
    .where(eq(inspections.id, inspectionId))
    .limit(1);

  if (!inspection) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Inspection not found" }, { status: 404 }),
    };
  }

  const { allowed, role } = await checkInspectionAccess(supabase, user.id, inspection.inspectorId);
  if (!allowed) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  const isPrivileged = role === "admin" || role === "office_staff";
  if (mode === "edit" && !isPrivileged && inspection.status !== "draft") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Cannot edit: inspection is no longer a draft" },
        { status: 403 },
      ),
    };
  }

  return { ok: true, userId: user.id, inspection, isPrivileged };
}
```

- [ ] **Step 4: Implement the provenance route**

`src/app/api/inspections/[id]/provenance/route.ts`:

```ts
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { inspections } from "@/lib/db/schema";
import { provenancePatchBodySchema } from "@/lib/prefill/provenance-schema";
import { requireInspectionAccess } from "@/lib/prefill/route-access";

/**
 * PATCH /api/inspections/[id]/provenance
 * Whole-map replace of the per-field provenance sidecar. Body: { fieldProvenance }.
 * Same access rule as PATCH /api/inspections/[id]; form_data is untouched.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireInspectionAccess(id, "edit");
  if (!access.ok) return access.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = provenancePatchBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid provenance", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  await db
    .update(inspections)
    .set({ fieldProvenance: parsed.data.fieldProvenance })
    .where(eq(inspections.id, id));

  return NextResponse.json({ saved: true });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/prefill/__tests__/route-access.test.ts "src/app/api/inspections/[id]/provenance/__tests__/route.test.ts"`
Expected: PASS (6 + 8 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/prefill/route-access.ts "src/app/api/inspections/[id]/provenance" src/lib/prefill/__tests__/route-access.test.ts
git commit -m "feat(prefill): requireInspectionAccess helper and PATCH /provenance whole-map route"
```

---

### Task 7: `POST /api/inspections/[id]/prefill` — start a run

**Files:**
- Create: `src/app/api/inspections/[id]/prefill/route.ts`
- Test: `src/app/api/inspections/[id]/prefill/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `requireInspectionAccess` (Task 6); `prefillStartBodySchema`, `buildPrefillInput`, `isValidApn` (Task 4); `countRunsInLastHour`, `failStaleRuns`, `findActiveRun`, `createRun` (Task 5); `runPrefill` (Task 5); `MAX_PREFILL_RUNS_PER_HOUR` (Task 1).
- Produces: `POST` → `201 { runId }`; `400 { error: "Invalid request" | "Invalid APN format" | "Enter an APN or a street address first" }`; `409 { error: "A prefill run is already in progress" }`; `429 { error: "Prefill limit reached (3 per hour)" }`. Body `{ apn?, address?, trigger?: "apn_lookup" | "manual" }` (all optional; `trigger` defaults to `"manual"`). `export const maxDuration = 300`.

- [ ] **Step 1: Write the failing test**

`src/app/api/inspections/[id]/prefill/__tests__/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetUser,
  mockGetSession,
  mockCreateClient,
  mockDbSelect,
  mockAfter,
  mockCountRuns,
  mockFailStale,
  mockFindActive,
  mockCreateRun,
  mockRunPrefill,
} = vi.hoisted(() => {
  const mockGetUser = vi.fn();
  const mockGetSession = vi.fn();
  const mockDbSelect = vi.fn();
  const mockCreateClient = vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
  });
  return {
    mockGetUser,
    mockGetSession,
    mockCreateClient,
    mockDbSelect,
    mockAfter: vi.fn(),
    mockCountRuns: vi.fn(),
    mockFailStale: vi.fn(),
    mockFindActive: vi.fn(),
    mockCreateRun: vi.fn(),
    mockRunPrefill: vi.fn(),
  };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));

vi.mock("@/lib/db", () => {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(() => mockDbSelect()),
  };
  return { db: { select: vi.fn(() => selectChain) } };
});

vi.mock("@/lib/db/schema", () => ({
  inspections: { id: "id", inspectorId: "inspector_id", status: "status", formData: "form_data" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ _col, val })),
}));

// after() throws outside a request scope — replace it, keep NextResponse
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: mockAfter };
});

vi.mock("@/lib/prefill/run-store", () => ({
  countRunsInLastHour: mockCountRuns,
  failStaleRuns: mockFailStale,
  findActiveRun: mockFindActive,
  createRun: mockCreateRun,
}));

vi.mock("@/lib/prefill/run-prefill", () => ({ runPrefill: mockRunPrefill }));

import { maxDuration, POST } from "../route";

function fakeAccessToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64");
  return `${header}.${body}.fakesig`;
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeRequest(body?: unknown): Request {
  return new Request("http://localhost/api/inspections/insp-1/prefill", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const USER = { id: "user-1", email: "tech@example.com" };
const INSPECTION = {
  inspectorId: "user-1",
  status: "draft",
  formData: {
    facilityInfo: {
      taxParcelNumber: "219-11-121",
      facilityAddress: "8911 E Cave Creek Rd",
      facilityCity: "Carefree",
      facilityZip: "85377",
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: USER } });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: fakeAccessToken({ user_role: "field_tech" }) } },
  });
  mockDbSelect.mockResolvedValue([INSPECTION]);
  mockCountRuns.mockResolvedValue(0);
  mockFailStale.mockResolvedValue(undefined);
  mockFindActive.mockResolvedValue(null);
  mockCreateRun.mockResolvedValue("run-1");
  mockRunPrefill.mockResolvedValue(undefined);
});

describe("POST /api/inspections/[id]/prefill", () => {
  it("exports maxDuration = 300 for the background work", () => {
    expect(maxDuration).toBe(300);
  });

  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const res = await POST(makeRequest({}), makeParams("insp-1"));
    expect(res.status).toBe(401);
    expect(mockCreateRun).not.toHaveBeenCalled();
  });

  it("returns 404 when the inspection does not exist", async () => {
    mockDbSelect.mockResolvedValueOnce([]);
    const res = await POST(makeRequest({}), makeParams("insp-1"));
    expect(res.status).toBe(404);
  });

  it("returns 403 for a non-owner field tech and for a tech on a non-draft", async () => {
    mockDbSelect.mockResolvedValueOnce([{ ...INSPECTION, inspectorId: "other" }]);
    expect((await POST(makeRequest({}), makeParams("insp-1"))).status).toBe(403);
    mockDbSelect.mockResolvedValueOnce([{ ...INSPECTION, status: "submitted" }]);
    expect((await POST(makeRequest({}), makeParams("insp-1"))).status).toBe(403);
  });

  it("creates a run from the body, schedules runPrefill via after() and returns 201", async () => {
    const res = await POST(
      makeRequest({ apn: "200-08-079", trigger: "apn_lookup" }),
      makeParams("insp-1"),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ runId: "run-1" });

    expect(mockCreateRun).toHaveBeenCalledWith({
      inspectionId: "insp-1",
      trigger: "apn_lookup",
      input: expect.objectContaining({ apn: "200-08-079" }),
      createdBy: "user-1",
    });

    expect(mockAfter).toHaveBeenCalledTimes(1);
    expect(mockRunPrefill).not.toHaveBeenCalled();
    await mockAfter.mock.calls[0][0]();
    expect(mockRunPrefill).toHaveBeenCalledWith("run-1");
  });

  it("defaults the APN and address from facilityInfo and the trigger to manual", async () => {
    const res = await POST(makeRequest(), makeParams("insp-1"));
    expect(res.status).toBe(201);
    expect(mockCreateRun).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: "manual",
        input: {
          apn: "219-11-121",
          address: {
            streetNumber: "8911",
            streetDir: "E",
            streetName: "Cave Creek Rd",
            city: "Carefree",
            zip: "85377",
            full: "8911 E Cave Creek Rd, Carefree, AZ 85377",
          },
        },
      }),
    );
  });

  it("returns 400 for an invalid APN and for an unparseable body", async () => {
    const bad = await POST(makeRequest({ apn: "1'; DROP" }), makeParams("insp-1"));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("Invalid APN format");

    const shape = await POST(makeRequest({ address: { streetNumber: "x" } }), makeParams("insp-1"));
    expect(shape.status).toBe(400);
    expect((await shape.json()).error).toBe("Invalid request");
  });

  it("returns 400 when there is nothing to search", async () => {
    mockDbSelect.mockResolvedValueOnce([{ ...INSPECTION, formData: {} }]);
    const res = await POST(makeRequest({}), makeParams("insp-1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Enter an APN or a street address first");
  });

  it("returns 429 once three runs exist in the last hour", async () => {
    mockCountRuns.mockResolvedValueOnce(3);
    const res = await POST(makeRequest({}), makeParams("insp-1"));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("Prefill limit reached (3 per hour)");
    expect(mockCreateRun).not.toHaveBeenCalled();
  });

  it("fails stale runs, then returns 409 while a run is still active", async () => {
    mockFindActive.mockResolvedValueOnce({ id: "run-0" });
    const res = await POST(makeRequest({}), makeParams("insp-1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("A prefill run is already in progress");
    expect(mockFailStale).toHaveBeenCalledWith("insp-1");
    expect(mockCreateRun).not.toHaveBeenCalled();
  });

  it("lets admins start runs on non-drafts they do not own", async () => {
    mockGetSession.mockResolvedValueOnce({
      data: { session: { access_token: fakeAccessToken({ user_role: "admin" }) } },
    });
    mockDbSelect.mockResolvedValueOnce([{ ...INSPECTION, inspectorId: "other", status: "in_review" }]);
    const res = await POST(makeRequest({}), makeParams("insp-1"));
    expect(res.status).toBe(201);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run "src/app/api/inspections/[id]/prefill/__tests__/route.test.ts"`
Expected: FAIL — `Failed to resolve import "../route"`.

- [ ] **Step 3: Implement the route**

`src/app/api/inspections/[id]/prefill/route.ts`:

```ts
import { after, NextResponse } from "next/server";
import { buildPrefillInput, isValidApn, prefillStartBodySchema } from "@/lib/prefill/input";
import { requireInspectionAccess } from "@/lib/prefill/route-access";
import { runPrefill } from "@/lib/prefill/run-prefill";
import {
  countRunsInLastHour,
  createRun,
  failStaleRuns,
  findActiveRun,
} from "@/lib/prefill/run-store";
import { MAX_PREFILL_RUNS_PER_HOUR } from "@/lib/prefill/types";

// The run continues in after() once the 201 is sent — needs Fluid Compute's longer budget
export const maxDuration = 300;

/**
 * POST /api/inspections/[id]/prefill
 * Body: { apn?, address?, trigger? } — defaults come from the inspection's facilityInfo.
 * Creates a queued run row and executes it in after(). 201 { runId }.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireInspectionAccess(id, "edit");
  if (!access.ok) return access.response;

  // An empty body is fine — "Find records" sends none
  const raw: unknown = await request.json().catch(() => ({}));
  const parsed = prefillStartBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const input = buildPrefillInput(access.inspection.formData, parsed.data);
  if (input.apn && !isValidApn(input.apn)) {
    return NextResponse.json({ error: "Invalid APN format" }, { status: 400 });
  }
  if (!input.apn && !input.address) {
    return NextResponse.json(
      { error: "Enter an APN or a street address first" },
      { status: 400 },
    );
  }

  if ((await countRunsInLastHour(id)) >= MAX_PREFILL_RUNS_PER_HOUR) {
    return NextResponse.json(
      { error: `Prefill limit reached (${MAX_PREFILL_RUNS_PER_HOUR} per hour)` },
      { status: 429 },
    );
  }

  await failStaleRuns(id);
  if (await findActiveRun(id)) {
    return NextResponse.json({ error: "A prefill run is already in progress" }, { status: 409 });
  }

  const runId = await createRun({
    inspectionId: id,
    trigger: parsed.data.trigger ?? "manual",
    input,
    createdBy: access.userId,
  });

  after(() => runPrefill(runId));

  return NextResponse.json({ runId }, { status: 201 });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run "src/app/api/inspections/[id]/prefill/__tests__/route.test.ts"`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/inspections/[id]/prefill/route.ts" "src/app/api/inspections/[id]/prefill/__tests__/route.test.ts"
git commit -m "feat(prefill): POST /prefill starts a run (DB rate limit, lock, after() execution)"
```

---

### Task 8: Run read/apply/select routes

**Files:**
- Create: `src/app/api/inspections/[id]/prefill/latest/route.ts`
- Create: `src/app/api/inspections/[id]/prefill/[runId]/route.ts`
- Create: `src/app/api/inspections/[id]/prefill/[runId]/applied/route.ts`
- Create: `src/app/api/inspections/[id]/prefill/[runId]/select/route.ts`
- Test: `src/app/api/inspections/[id]/prefill/latest/__tests__/route.test.ts`
- Test: `src/app/api/inspections/[id]/prefill/[runId]/__tests__/route.test.ts`
- Test: `src/app/api/inspections/[id]/prefill/[runId]/applied/__tests__/route.test.ts`
- Test: `src/app/api/inspections/[id]/prefill/[runId]/select/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `requireInspectionAccess` (Task 6); `loadRunDTO`, `loadLatestRunDTO` (Task 5); `loadRunRow`, `markRunApplied`, `updateRun` (Task 5); `continuePrefillAfterSelection` (Task 5).
- Produces:
  - `GET prefill/latest` → `PrefillRunDTO | null` (JSON `null` when no run)
  - `GET prefill/[runId]` → `PrefillRunDTO`; `404 { error: "Run not found" }` when missing or belonging to another inspection
  - `POST prefill/[runId]/applied` → `{ ok: true }` after setting `applied_at`
  - `POST prefill/[runId]/select` body `{ candidateKeys: string[] }` (1–3 keys, each ≤ 200 chars) → `{ ok: true }`, run → `running`, `after(() => continuePrefillAfterSelection(...))`; `409 { error: "Run is not awaiting selection" }` otherwise (always, in phase 1). `export const maxDuration = 300`.

- [ ] **Step 1: Write the failing tests**

All four test files share the same mock preamble; it is repeated in each so every file stands alone.

`src/app/api/inspections/[id]/prefill/latest/__tests__/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetUser, mockGetSession, mockCreateClient, mockDbSelect, mockLoadLatestRunDTO } =
  vi.hoisted(() => {
    const mockGetUser = vi.fn();
    const mockGetSession = vi.fn();
    const mockDbSelect = vi.fn();
    const mockCreateClient = vi.fn().mockResolvedValue({
      auth: { getUser: mockGetUser, getSession: mockGetSession },
    });
    return { mockGetUser, mockGetSession, mockCreateClient, mockDbSelect, mockLoadLatestRunDTO: vi.fn() };
  });

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/db", () => {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(() => mockDbSelect()),
  };
  return { db: { select: vi.fn(() => selectChain) } };
});
vi.mock("@/lib/db/schema", () => ({
  inspections: { id: "id", inspectorId: "inspector_id", status: "status", formData: "form_data" },
}));
vi.mock("drizzle-orm", () => ({ eq: vi.fn((_c: unknown, v: unknown) => ({ _c, v })) }));
vi.mock("@/lib/prefill/run-dto", () => ({ loadLatestRunDTO: mockLoadLatestRunDTO }));

import { GET } from "../route";

function fakeAccessToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64");
  return `${header}.${body}.fakesig`;
}
const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });
const RUN = { id: "run-1", inspectionId: "insp-1", status: "done" };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: fakeAccessToken({ user_role: "field_tech" }) } },
  });
  mockDbSelect.mockResolvedValue([{ inspectorId: "user-1", status: "submitted", formData: {} }]);
  mockLoadLatestRunDTO.mockResolvedValue(RUN);
});

describe("GET /api/inspections/[id]/prefill/latest", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    expect((await GET(new Request("http://localhost"), makeParams("insp-1"))).status).toBe(401);
  });

  it("returns 403 for a non-owner field tech", async () => {
    mockDbSelect.mockResolvedValueOnce([{ inspectorId: "other", status: "draft", formData: {} }]);
    expect((await GET(new Request("http://localhost"), makeParams("insp-1"))).status).toBe(403);
  });

  it("returns the latest run for the owner even on a non-draft (view access)", async () => {
    const res = await GET(new Request("http://localhost"), makeParams("insp-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(RUN);
    expect(mockLoadLatestRunDTO).toHaveBeenCalledWith("insp-1");
  });

  it("returns JSON null when there is no run", async () => {
    mockLoadLatestRunDTO.mockResolvedValueOnce(null);
    const res = await GET(new Request("http://localhost"), makeParams("insp-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });
});
```

`src/app/api/inspections/[id]/prefill/[runId]/__tests__/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetUser, mockGetSession, mockCreateClient, mockDbSelect, mockLoadRunDTO } = vi.hoisted(
  () => {
    const mockGetUser = vi.fn();
    const mockGetSession = vi.fn();
    const mockDbSelect = vi.fn();
    const mockCreateClient = vi.fn().mockResolvedValue({
      auth: { getUser: mockGetUser, getSession: mockGetSession },
    });
    return { mockGetUser, mockGetSession, mockCreateClient, mockDbSelect, mockLoadRunDTO: vi.fn() };
  },
);

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/db", () => {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(() => mockDbSelect()),
  };
  return { db: { select: vi.fn(() => selectChain) } };
});
vi.mock("@/lib/db/schema", () => ({
  inspections: { id: "id", inspectorId: "inspector_id", status: "status", formData: "form_data" },
}));
vi.mock("drizzle-orm", () => ({ eq: vi.fn((_c: unknown, v: unknown) => ({ _c, v })) }));
vi.mock("@/lib/prefill/run-dto", () => ({ loadRunDTO: mockLoadRunDTO }));

import { GET } from "../route";

function fakeAccessToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64");
  return `${header}.${body}.fakesig`;
}
const makeParams = (id: string, runId: string) => ({ params: Promise.resolve({ id, runId }) });
const RUN = { id: "run-1", inspectionId: "insp-1", status: "running" };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: fakeAccessToken({ user_role: "field_tech" }) } },
  });
  mockDbSelect.mockResolvedValue([{ inspectorId: "user-1", status: "draft", formData: {} }]);
  mockLoadRunDTO.mockResolvedValue(RUN);
});

describe("GET /api/inspections/[id]/prefill/[runId]", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    expect((await GET(new Request("http://localhost"), makeParams("insp-1", "run-1"))).status).toBe(401);
  });

  it("returns 403 for a non-owner field tech", async () => {
    mockDbSelect.mockResolvedValueOnce([{ inspectorId: "other", status: "draft", formData: {} }]);
    expect((await GET(new Request("http://localhost"), makeParams("insp-1", "run-1"))).status).toBe(403);
  });

  it("returns the run DTO", async () => {
    const res = await GET(new Request("http://localhost"), makeParams("insp-1", "run-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(RUN);
    expect(mockLoadRunDTO).toHaveBeenCalledWith("run-1");
  });

  it("returns 404 when the run is missing or belongs to another inspection", async () => {
    mockLoadRunDTO.mockResolvedValueOnce(null);
    expect((await GET(new Request("http://localhost"), makeParams("insp-1", "run-x"))).status).toBe(404);
    mockLoadRunDTO.mockResolvedValueOnce({ ...RUN, inspectionId: "insp-2" });
    const res = await GET(new Request("http://localhost"), makeParams("insp-1", "run-1"));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Run not found");
  });
});
```

`src/app/api/inspections/[id]/prefill/[runId]/applied/__tests__/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetUser, mockGetSession, mockCreateClient, mockDbSelect, mockLoadRunRow, mockMarkApplied } =
  vi.hoisted(() => {
    const mockGetUser = vi.fn();
    const mockGetSession = vi.fn();
    const mockDbSelect = vi.fn();
    const mockCreateClient = vi.fn().mockResolvedValue({
      auth: { getUser: mockGetUser, getSession: mockGetSession },
    });
    return {
      mockGetUser,
      mockGetSession,
      mockCreateClient,
      mockDbSelect,
      mockLoadRunRow: vi.fn(),
      mockMarkApplied: vi.fn(),
    };
  });

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/db", () => {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(() => mockDbSelect()),
  };
  return { db: { select: vi.fn(() => selectChain) } };
});
vi.mock("@/lib/db/schema", () => ({
  inspections: { id: "id", inspectorId: "inspector_id", status: "status", formData: "form_data" },
}));
vi.mock("drizzle-orm", () => ({ eq: vi.fn((_c: unknown, v: unknown) => ({ _c, v })) }));
vi.mock("@/lib/prefill/run-store", () => ({
  loadRunRow: mockLoadRunRow,
  markRunApplied: mockMarkApplied,
}));

import { POST } from "../route";

function fakeAccessToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64");
  return `${header}.${body}.fakesig`;
}
const makeParams = (id: string, runId: string) => ({ params: Promise.resolve({ id, runId }) });
const makeRequest = () => new Request("http://localhost", { method: "POST" });

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: fakeAccessToken({ user_role: "field_tech" }) } },
  });
  mockDbSelect.mockResolvedValue([{ inspectorId: "user-1", status: "draft", formData: {} }]);
  mockLoadRunRow.mockResolvedValue({ id: "run-1", inspectionId: "insp-1", status: "done" });
  mockMarkApplied.mockResolvedValue(undefined);
});

describe("POST /api/inspections/[id]/prefill/[runId]/applied", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    expect((await POST(makeRequest(), makeParams("insp-1", "run-1"))).status).toBe(401);
  });

  it("returns 403 when a field tech touches a non-draft (edit access)", async () => {
    mockDbSelect.mockResolvedValueOnce([{ inspectorId: "user-1", status: "submitted", formData: {} }]);
    expect((await POST(makeRequest(), makeParams("insp-1", "run-1"))).status).toBe(403);
    expect(mockMarkApplied).not.toHaveBeenCalled();
  });

  it("returns 404 when the run is missing or belongs to another inspection", async () => {
    mockLoadRunRow.mockResolvedValueOnce(null);
    expect((await POST(makeRequest(), makeParams("insp-1", "run-1"))).status).toBe(404);
    mockLoadRunRow.mockResolvedValueOnce({ id: "run-1", inspectionId: "insp-2", status: "done" });
    expect((await POST(makeRequest(), makeParams("insp-1", "run-1"))).status).toBe(404);
  });

  it("marks the run applied", async () => {
    const res = await POST(makeRequest(), makeParams("insp-1", "run-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockMarkApplied).toHaveBeenCalledWith("run-1");
  });
});
```

`src/app/api/inspections/[id]/prefill/[runId]/select/__tests__/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetUser,
  mockGetSession,
  mockCreateClient,
  mockDbSelect,
  mockLoadRunRow,
  mockUpdateRun,
  mockAfter,
  mockContinue,
} = vi.hoisted(() => {
  const mockGetUser = vi.fn();
  const mockGetSession = vi.fn();
  const mockDbSelect = vi.fn();
  const mockCreateClient = vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
  });
  return {
    mockGetUser,
    mockGetSession,
    mockCreateClient,
    mockDbSelect,
    mockLoadRunRow: vi.fn(),
    mockUpdateRun: vi.fn(),
    mockAfter: vi.fn(),
    mockContinue: vi.fn(),
  };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/db", () => {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(() => mockDbSelect()),
  };
  return { db: { select: vi.fn(() => selectChain) } };
});
vi.mock("@/lib/db/schema", () => ({
  inspections: { id: "id", inspectorId: "inspector_id", status: "status", formData: "form_data" },
}));
vi.mock("drizzle-orm", () => ({ eq: vi.fn((_c: unknown, v: unknown) => ({ _c, v })) }));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: mockAfter };
});
vi.mock("@/lib/prefill/run-store", () => ({
  loadRunRow: mockLoadRunRow,
  updateRun: mockUpdateRun,
}));
vi.mock("@/lib/prefill/run-prefill", () => ({
  continuePrefillAfterSelection: mockContinue,
}));

import { maxDuration, POST } from "../route";

function fakeAccessToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64");
  return `${header}.${body}.fakesig`;
}
const makeParams = (id: string, runId: string) => ({ params: Promise.resolve({ id, runId }) });
const makeRequest = (body: unknown) =>
  new Request("http://localhost", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const KEYS = ["edms_env:OW-17-00474:PERMIT:2017-03-01"];

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: fakeAccessToken({ user_role: "field_tech" }) } },
  });
  mockDbSelect.mockResolvedValue([{ inspectorId: "user-1", status: "draft", formData: {} }]);
  mockLoadRunRow.mockResolvedValue({ id: "run-1", inspectionId: "insp-1", status: "done" });
  mockUpdateRun.mockResolvedValue(undefined);
  mockContinue.mockResolvedValue(undefined);
});

describe("POST /api/inspections/[id]/prefill/[runId]/select", () => {
  it("exports maxDuration = 300", () => {
    expect(maxDuration).toBe(300);
  });

  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    expect((await POST(makeRequest({ candidateKeys: KEYS }), makeParams("insp-1", "run-1"))).status).toBe(401);
  });

  it("returns 400 for a bad body (no keys, more than 3, non-strings)", async () => {
    for (const body of [{}, { candidateKeys: [] }, { candidateKeys: ["a", "b", "c", "d"] }, { candidateKeys: [1] }]) {
      const res = await POST(makeRequest(body), makeParams("insp-1", "run-1"));
      expect(res.status).toBe(400);
    }
  });

  it("returns 404 when the run belongs to another inspection", async () => {
    mockLoadRunRow.mockResolvedValueOnce({ id: "run-1", inspectionId: "insp-2", status: "awaiting_selection" });
    expect((await POST(makeRequest({ candidateKeys: KEYS }), makeParams("insp-1", "run-1"))).status).toBe(404);
  });

  it("returns 409 when the run is not awaiting selection (always, in phase 1)", async () => {
    const res = await POST(makeRequest({ candidateKeys: KEYS }), makeParams("insp-1", "run-1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Run is not awaiting selection");
    expect(mockAfter).not.toHaveBeenCalled();
  });

  it("moves an awaiting_selection run to running and continues in after()", async () => {
    mockLoadRunRow.mockResolvedValueOnce({ id: "run-1", inspectionId: "insp-1", status: "awaiting_selection" });
    const res = await POST(makeRequest({ candidateKeys: KEYS }), makeParams("insp-1", "run-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockUpdateRun).toHaveBeenCalledWith("run-1", { status: "running" });
    expect(mockAfter).toHaveBeenCalledTimes(1);
    await mockAfter.mock.calls[0][0]();
    expect(mockContinue).toHaveBeenCalledWith("run-1", KEYS);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run "src/app/api/inspections/[id]/prefill/latest" "src/app/api/inspections/[id]/prefill/[runId]"`
Expected: FAIL — `Failed to resolve import "../route"` in all four files.

- [ ] **Step 3: Implement the four routes**

`src/app/api/inspections/[id]/prefill/latest/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireInspectionAccess } from "@/lib/prefill/route-access";
import { loadLatestRunDTO } from "@/lib/prefill/run-dto";

/** GET /api/inspections/[id]/prefill/latest — most recent run, or JSON null. Used on wizard mount. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireInspectionAccess(id, "view");
  if (!access.ok) return access.response;

  const run = await loadLatestRunDTO(id);
  return NextResponse.json(run);
}
```

`src/app/api/inspections/[id]/prefill/[runId]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireInspectionAccess } from "@/lib/prefill/route-access";
import { loadRunDTO } from "@/lib/prefill/run-dto";

/** GET /api/inspections/[id]/prefill/[runId] — run status, stages, proposals, candidates, records. Polled every 2 s. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  const { id, runId } = await params;
  const access = await requireInspectionAccess(id, "view");
  if (!access.ok) return access.response;

  const run = await loadRunDTO(runId);
  if (!run || run.inspectionId !== id) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  return NextResponse.json(run);
}
```

`src/app/api/inspections/[id]/prefill/[runId]/applied/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireInspectionAccess } from "@/lib/prefill/route-access";
import { loadRunRow, markRunApplied } from "@/lib/prefill/run-store";

/** POST /api/inspections/[id]/prefill/[runId]/applied — the client has merged this run's proposals into the form. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  const { id, runId } = await params;
  const access = await requireInspectionAccess(id, "edit");
  if (!access.ok) return access.response;

  const run = await loadRunRow(runId);
  if (!run || run.inspectionId !== id) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  await markRunApplied(runId);
  return NextResponse.json({ ok: true });
}
```

`src/app/api/inspections/[id]/prefill/[runId]/select/route.ts`:

```ts
import { after, NextResponse } from "next/server";
import { z } from "zod";
import { requireInspectionAccess } from "@/lib/prefill/route-access";
import { continuePrefillAfterSelection } from "@/lib/prefill/run-prefill";
import { loadRunRow, updateRun } from "@/lib/prefill/run-store";

// Extraction continues in after() once the 200 is sent
export const maxDuration = 300;

const selectBodySchema = z.object({
  candidateKeys: z.array(z.string().min(1).max(200)).min(1).max(3),
});

/**
 * POST /api/inspections/[id]/prefill/[runId]/select
 * Body: { candidateKeys: string[] } (1–3). Only valid while the run is awaiting_selection;
 * phase 1 never produces candidates, so this always 409s until phase 2.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  const { id, runId } = await params;
  const access = await requireInspectionAccess(id, "edit");
  if (!access.ok) return access.response;

  const raw: unknown = await request.json().catch(() => null);
  const parsed = selectBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "candidateKeys must be 1–3 strings", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const run = await loadRunRow(runId);
  if (!run || run.inspectionId !== id) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  if (run.status !== "awaiting_selection") {
    return NextResponse.json({ error: "Run is not awaiting selection" }, { status: 409 });
  }

  await updateRun(runId, { status: "running" });
  const keys = parsed.data.candidateKeys;
  after(() => continuePrefillAfterSelection(runId, keys));

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run "src/app/api/inspections/[id]/prefill/latest" "src/app/api/inspections/[id]/prefill/[runId]"`
Expected: PASS (4 + 4 + 4 + 6 tests).

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/inspections/[id]/prefill/latest" "src/app/api/inspections/[id]/prefill/[runId]"
git commit -m "feat(prefill): run read, applied and select routes"
```

---

### Task 9: shadcn Popover + `ProvenanceProvider` / `useProvenance`

**Files:**
- Create: `src/components/ui/popover.tsx`
- Create: `src/components/prefill/provenance-context.tsx`
- Test: `src/components/prefill/__tests__/provenance-context.test.tsx`

**Interfaces:**
- Consumes: `getPath`, `normalizeFieldPath`, `valuesEqual` (Task 2); `FieldProvenance`, `ProvenanceEntry` (Task 1).
- Produces:
  - `popover.tsx`: `Popover`, `PopoverTrigger`, `PopoverContent`, `PopoverAnchor` (shadcn "new-york" output for this project's `components.json`; `npx shadcn@latest add popover` produces the same file — writing it by hand is equivalent and deterministic).
  - `provenance-context.tsx`:
    ```ts
    export interface ProvenanceContextValue {
      provenance: FieldProvenance;
      readOnly: boolean;
      get(fieldPath: string): ProvenanceEntry | undefined;
      verify(fieldPath: string): void;
      clear(fieldPath: string): void;
      acceptSuggestion(fieldPath: string): void;   // setValue + state → "prefilled"
      dismissSuggestion(fieldPath: string): void;  // removes entry
      setMany(entries: FieldProvenance): void;     // used by the prefill hook, the APN lookup and the scan flow
    }
    export const NOOP_PROVENANCE: ProvenanceContextValue;   // default context when no provider is mounted
    export const PROVENANCE_SAVE_DEBOUNCE_MS = 1000;
    export function ProvenanceProvider(props: { form: UseFormReturn<InspectionFormData>; inspectionId: string; initial: FieldProvenance; readOnly?: boolean; children: React.ReactNode }): JSX.Element;
    export function useProvenance(fieldPath?: string): ProvenanceContextValue & { entry?: ProvenanceEntry };
    ```
    Behaviour: every mutation marks the map dirty and, 1 s after the last change, `PATCH /api/inspections/{id}/provenance` with `{ fieldProvenance }` (whole map); a pending save is flushed on unmount; nothing is persisted when `readOnly`. A `form.watch` subscription flips `prefilled → edited` when the form value diverges from `entry.value` (also for entries nested under a replaced parent path such as `septicTank.tanks`). Keys are normalised with `normalizeFieldPath` on every read and write.

- [ ] **Step 1: Write the failing test**

`src/components/prefill/__tests__/provenance-context.test.tsx`:

```tsx
import { act, renderHook } from "@testing-library/react";
import type * as React from "react";
import { type UseFormReturn, useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NOOP_PROVENANCE,
  PROVENANCE_SAVE_DEBOUNCE_MS,
  ProvenanceProvider,
  useProvenance,
} from "@/components/prefill/provenance-context";
import type { FieldProvenance, ProvenanceEntry } from "@/lib/prefill/types";
import { getDefaultFormValues } from "@/lib/validators/inspection";
import type { InspectionFormData } from "@/types/inspection";

const NOW = "2026-09-11T10:00:00.000Z";

function entry(over: Partial<ProvenanceEntry> = {}): ProvenanceEntry {
  return {
    source: "assessor",
    state: "prefilled",
    kind: "fill",
    value: "JOHN DOE",
    confidence: 1,
    explanation: "Maricopa County Assessor · parcel 219-11-121",
    at: NOW,
    ...over,
  };
}

type FormRef = { current: UseFormReturn<InspectionFormData> | null };
type Tank = InspectionFormData["septicTank"]["tanks"][number];

function makeWrapper(opts: {
  formRef: FormRef;
  initial?: FieldProvenance;
  readOnly?: boolean;
  facility?: Partial<InspectionFormData["facilityInfo"]>;
  tanks?: Tank[];
}) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    const defaults = getDefaultFormValues("Tech") as unknown as InspectionFormData;
    const form = useForm<InspectionFormData>({
      defaultValues: {
        ...defaults,
        facilityInfo: { ...defaults.facilityInfo, ...opts.facility },
        septicTank: { ...defaults.septicTank, tanks: opts.tanks ?? [] },
      },
    });
    opts.formRef.current = form;
    return (
      <ProvenanceProvider
        form={form}
        inspectionId="insp-1"
        initial={opts.initial ?? {}}
        readOnly={opts.readOnly}
      >
        {children}
      </ProvenanceProvider>
    );
  };
}

function lastPatchBody(): { fieldProvenance: FieldProvenance } {
  const calls = vi.mocked(fetch).mock.calls;
  const [, init] = calls[calls.length - 1];
  return JSON.parse(String(init?.body));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useProvenance without a provider", () => {
  it("returns the no-op context so badges render nothing and mutations are ignored", () => {
    const { result } = renderHook(() => useProvenance("facilityInfo.facilityName"));
    expect(result.current.entry).toBeUndefined();
    expect(result.current.readOnly).toBe(true);
    expect(() => result.current.setMany({ "facilityInfo.facilityName": entry() })).not.toThrow();
    expect(result.current.get("facilityInfo.facilityName")).toBeUndefined();
    expect(NOOP_PROVENANCE.provenance).toEqual({});
  });
});

describe("ProvenanceProvider", () => {
  it("exposes the initial map; bracket paths are normalised on read", () => {
    const formRef: FormRef = { current: null };
    const { result } = renderHook(() => useProvenance("septicTank.tanks[0].tankCapacity"), {
      wrapper: makeWrapper({
        formRef,
        initial: { "septicTank.tanks.0.tankCapacity": entry({ value: "1250", source: "scan" }) },
      }),
    });
    expect(result.current.entry?.value).toBe("1250");
    expect(result.current.readOnly).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("verify flips the state and persists the whole map after the 1 s debounce", () => {
    const formRef: FormRef = { current: null };
    const { result } = renderHook(() => useProvenance("facilityInfo.facilityName"), {
      wrapper: makeWrapper({
        formRef,
        initial: { "facilityInfo.facilityName": entry() },
        facility: { facilityName: "JOHN DOE" },
      }),
    });

    act(() => result.current.verify("facilityInfo.facilityName"));
    expect(result.current.entry?.state).toBe("verified");
    expect(fetch).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(PROVENANCE_SAVE_DEBOUNCE_MS - 1);
    });
    expect(fetch).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/inspections/insp-1/provenance");
    expect(init?.method).toBe("PATCH");
    expect(lastPatchBody().fieldProvenance["facilityInfo.facilityName"].state).toBe("verified");
  });

  it("coalesces rapid changes into one PATCH", () => {
    const formRef: FormRef = { current: null };
    const { result } = renderHook(() => useProvenance(), {
      wrapper: makeWrapper({
        formRef,
        initial: {
          "facilityInfo.facilityName": entry(),
          "facilityInfo.facilityCity": entry({ value: "CAREFREE" }),
        },
      }),
    });

    act(() => result.current.verify("facilityInfo.facilityName"));
    act(() => result.current.clear("facilityInfo.facilityCity"));
    act(() => {
      vi.advanceTimersByTime(PROVENANCE_SAVE_DEBOUNCE_MS);
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    const map = lastPatchBody().fieldProvenance;
    expect(map["facilityInfo.facilityName"].state).toBe("verified");
    expect(map["facilityInfo.facilityCity"]).toBeUndefined();
  });

  it("clear and dismissSuggestion remove the entry", () => {
    const formRef: FormRef = { current: null };
    const { result } = renderHook(() => useProvenance(), {
      wrapper: makeWrapper({
        formRef,
        initial: {
          "facilityInfo.facilityName": entry(),
          "designFlow.numberOfBedrooms": entry({ state: "suggested", value: "3" }),
        },
      }),
    });
    act(() => result.current.clear("facilityInfo.facilityName"));
    act(() => result.current.dismissSuggestion("designFlow.numberOfBedrooms"));
    expect(result.current.provenance).toEqual({});
  });

  it("acceptSuggestion writes the value into the form and marks the entry prefilled", () => {
    const formRef: FormRef = { current: null };
    const { result } = renderHook(() => useProvenance("designFlow.numberOfBedrooms"), {
      wrapper: makeWrapper({
        formRef,
        initial: {
          "designFlow.numberOfBedrooms": entry({ state: "suggested", value: "3", source: "permit" }),
        },
      }),
    });
    act(() => result.current.acceptSuggestion("designFlow.numberOfBedrooms"));
    expect(formRef.current?.getValues("designFlow.numberOfBedrooms")).toBe("3");
    expect(result.current.entry?.state).toBe("prefilled");
  });

  it("acceptSuggestion on a warning removes it without touching the form", () => {
    const formRef: FormRef = { current: null };
    const { result } = renderHook(() => useProvenance("facilityInfo.wastewaterSource"), {
      wrapper: makeWrapper({
        formRef,
        initial: {
          "facilityInfo.wastewaterSource": entry({
            state: "suggested",
            kind: "warning",
            value: "",
            source: "listing",
          }),
        },
      }),
    });
    act(() => result.current.acceptSuggestion("facilityInfo.wastewaterSource"));
    expect(result.current.entry).toBeUndefined();
    expect(formRef.current?.getValues("facilityInfo.wastewaterSource")).toBe("");
  });

  it("ignores acceptSuggestion for non-suggested or missing entries", () => {
    const formRef: FormRef = { current: null };
    const { result } = renderHook(() => useProvenance("facilityInfo.facilityName"), {
      wrapper: makeWrapper({
        formRef,
        initial: { "facilityInfo.facilityName": entry() },
        facility: { facilityName: "JOHN DOE" },
      }),
    });
    act(() => result.current.acceptSuggestion("facilityInfo.facilityName"));
    act(() => result.current.acceptSuggestion("facilityInfo.nothingHere"));
    expect(result.current.entry?.state).toBe("prefilled");
    expect(formRef.current?.getValues("facilityInfo.facilityName")).toBe("JOHN DOE");
  });

  it("flips prefilled → edited when the form value diverges, not when it merely re-trims", () => {
    const formRef: FormRef = { current: null };
    const { result } = renderHook(() => useProvenance("facilityInfo.facilityName"), {
      wrapper: makeWrapper({
        formRef,
        initial: { "facilityInfo.facilityName": entry() },
        facility: { facilityName: "JOHN DOE" },
      }),
    });

    act(() => formRef.current?.setValue("facilityInfo.facilityName", "JOHN DOE "));
    expect(result.current.entry?.state).toBe("prefilled");

    act(() => formRef.current?.setValue("facilityInfo.facilityName", "JANE DOE"));
    expect(result.current.entry?.state).toBe("edited");
    expect(result.current.entry?.value).toBe("JOHN DOE");
  });

  it("flips nested entries when a parent array is replaced (scan flow writes whole tank arrays)", () => {
    const formRef: FormRef = { current: null };
    const tank = { tankCapacity: "1250" } as unknown as Tank;
    const { result } = renderHook(() => useProvenance("septicTank.tanks.0.tankCapacity"), {
      wrapper: makeWrapper({
        formRef,
        initial: { "septicTank.tanks.0.tankCapacity": entry({ value: "1250", source: "scan" }) },
        tanks: [tank],
      }),
    });
    act(() => formRef.current?.setValue("septicTank.tanks", [{ ...tank, tankCapacity: "1000" }]));
    expect(result.current.entry?.state).toBe("edited");
  });

  it("setMany merges entries and normalises bracket keys", () => {
    const formRef: FormRef = { current: null };
    const { result } = renderHook(() => useProvenance(), {
      wrapper: makeWrapper({ formRef, initial: { "facilityInfo.facilityName": entry() } }),
    });
    act(() =>
      result.current.setMany({
        "septicTank.tanks[1].tankCapacity": entry({ value: "1000", source: "scan" }),
      }),
    );
    expect(Object.keys(result.current.provenance).sort()).toEqual([
      "facilityInfo.facilityName",
      "septicTank.tanks.1.tankCapacity",
    ]);
  });

  it("does not persist when readOnly", () => {
    const formRef: FormRef = { current: null };
    const { result } = renderHook(() => useProvenance("facilityInfo.facilityName"), {
      wrapper: makeWrapper({
        formRef,
        readOnly: true,
        initial: { "facilityInfo.facilityName": entry() },
      }),
    });
    expect(result.current.readOnly).toBe(true);
    act(() => result.current.verify("facilityInfo.facilityName"));
    act(() => {
      vi.advanceTimersByTime(PROVENANCE_SAVE_DEBOUNCE_MS * 2);
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("flushes a pending save on unmount", () => {
    const formRef: FormRef = { current: null };
    const { result, unmount } = renderHook(() => useProvenance("facilityInfo.facilityName"), {
      wrapper: makeWrapper({ formRef, initial: { "facilityInfo.facilityName": entry() } }),
    });
    act(() => result.current.verify("facilityInfo.facilityName"));
    expect(fetch).not.toHaveBeenCalled();
    unmount();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/prefill/__tests__/provenance-context.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/prefill/provenance-context"`.

- [ ] **Step 3: Create the Popover primitive**

`src/components/ui/popover.tsx` (identical to `npx shadcn@latest add popover` output for this project; the surrounding `ui/` files use this no-semicolon style):

```tsx
"use client"

import * as React from "react"
import { Popover as PopoverPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-md border p-4 shadow-md outline-hidden",
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor }
```

- [ ] **Step 4: Implement the provider**

`src/components/prefill/provenance-context.tsx`:

```tsx
"use client";

import * as React from "react";
import type { FieldPath, UseFormReturn } from "react-hook-form";
import { getPath, normalizeFieldPath, valuesEqual } from "@/lib/prefill/merge";
import type { FieldProvenance, ProvenanceEntry } from "@/lib/prefill/types";
import type { InspectionFormData } from "@/types/inspection";

export interface ProvenanceContextValue {
  provenance: FieldProvenance;
  /** True on non-draft inspections and outside a provider: badges render, nothing is persisted or editable */
  readOnly: boolean;
  get(fieldPath: string): ProvenanceEntry | undefined;
  verify(fieldPath: string): void;
  clear(fieldPath: string): void;
  /** Writes the suggested value into the form and marks the entry prefilled (warnings are just removed) */
  acceptSuggestion(fieldPath: string): void;
  dismissSuggestion(fieldPath: string): void;
  /** Merge entries in — used by the prefill hook, the APN lookup and the scan flow */
  setMany(entries: FieldProvenance): void;
}

const noop = (): void => {};

/** Default context when no provider is mounted (tests, pages that have not adopted provenance yet) */
export const NOOP_PROVENANCE: ProvenanceContextValue = {
  provenance: {},
  readOnly: true,
  get: () => undefined,
  verify: noop,
  clear: noop,
  acceptSuggestion: noop,
  dismissSuggestion: noop,
  setMany: noop,
};

const ProvenanceContext = React.createContext<ProvenanceContextValue>(NOOP_PROVENANCE);

export const PROVENANCE_SAVE_DEBOUNCE_MS = 1000;

interface ProvenanceProviderProps {
  form: UseFormReturn<InspectionFormData>;
  inspectionId: string;
  initial: FieldProvenance;
  readOnly?: boolean;
  children: React.ReactNode;
}

export function ProvenanceProvider({
  form,
  inspectionId,
  initial,
  readOnly = false,
  children,
}: ProvenanceProviderProps) {
  const [provenance, setProvenance] = React.useState<FieldProvenance>(initial);
  const provenanceRef = React.useRef(provenance);
  provenanceRef.current = provenance;
  const dirtyRef = React.useRef(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const persist = React.useCallback((): void => {
    if (readOnly) return;
    fetch(`/api/inspections/${inspectionId}/provenance`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fieldProvenance: provenanceRef.current }),
    }).catch(() => {
      // Provenance is a sidecar — never block the form; the next change retries
    });
  }, [inspectionId, readOnly]);

  // Debounced persistence: mutations mark the map dirty, 1 s after the last change we PATCH the whole map
  React.useEffect(() => {
    if (readOnly || !dirtyRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      dirtyRef.current = false;
      persist();
    }, PROVENANCE_SAVE_DEBOUNCE_MS);
  }, [provenance, readOnly, persist]);

  // Flush a pending save on unmount
  React.useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (dirtyRef.current) {
        dirtyRef.current = false;
        persist();
      }
    };
  }, [persist]);

  const update = React.useCallback((fn: (prev: FieldProvenance) => FieldProvenance): void => {
    dirtyRef.current = true;
    setProvenance((prev) => fn(prev));
  }, []);

  const get = React.useCallback(
    (fieldPath: string) => provenance[normalizeFieldPath(fieldPath)],
    [provenance],
  );

  const verify = React.useCallback(
    (fieldPath: string) => {
      const key = normalizeFieldPath(fieldPath);
      update((prev) => {
        const current = prev[key];
        if (!current) return prev;
        return { ...prev, [key]: { ...current, state: "verified", at: new Date().toISOString() } };
      });
    },
    [update],
  );

  const clear = React.useCallback(
    (fieldPath: string) => {
      const key = normalizeFieldPath(fieldPath);
      update((prev) => {
        if (!(key in prev)) return prev;
        const { [key]: _removed, ...rest } = prev;
        return rest;
      });
    },
    [update],
  );

  const acceptSuggestion = React.useCallback(
    (fieldPath: string) => {
      const key = normalizeFieldPath(fieldPath);
      const current = provenanceRef.current[key];
      if (!current || current.state !== "suggested") return;
      if (current.kind === "warning") {
        clear(key);
        return;
      }
      form.setValue(key as FieldPath<InspectionFormData>, current.value as never, {
        shouldDirty: true,
        shouldValidate: true,
      });
      update((prev) => {
        const latest = prev[key];
        if (!latest) return prev;
        return { ...prev, [key]: { ...latest, state: "prefilled", at: new Date().toISOString() } };
      });
    },
    [form, update, clear],
  );

  const setMany = React.useCallback(
    (entries: FieldProvenance) => {
      update((prev) => {
        const next = { ...prev };
        for (const [path, value] of Object.entries(entries)) {
          next[normalizeFieldPath(path)] = value;
        }
        return next;
      });
    },
    [update],
  );

  // prefilled → edited when the form value diverges from what we proposed.
  // Also checks entries nested under the changed path (the scan flow replaces whole tank arrays).
  React.useEffect(() => {
    const subscription = form.watch((values, { name }) => {
      if (!name) return;
      const changed = normalizeFieldPath(name);
      const diverged = Object.keys(provenanceRef.current).filter((key) => {
        if (key !== changed && !key.startsWith(`${changed}.`)) return false;
        const current = provenanceRef.current[key];
        return current.state === "prefilled" && !valuesEqual(getPath(values, key), current.value);
      });
      if (diverged.length === 0) return;
      update((prev) => {
        const next = { ...prev };
        const at = new Date().toISOString();
        for (const key of diverged) {
          const current = next[key];
          if (current?.state === "prefilled") next[key] = { ...current, state: "edited", at };
        }
        return next;
      });
    });
    return () => subscription.unsubscribe();
  }, [form, update]);

  const value = React.useMemo<ProvenanceContextValue>(
    () => ({
      provenance,
      readOnly,
      get,
      verify,
      clear,
      acceptSuggestion,
      dismissSuggestion: clear,
      setMany,
    }),
    [provenance, readOnly, get, verify, clear, acceptSuggestion, setMany],
  );

  return <ProvenanceContext.Provider value={value}>{children}</ProvenanceContext.Provider>;
}

export function useProvenance(
  fieldPath?: string,
): ProvenanceContextValue & { entry?: ProvenanceEntry } {
  const ctx = React.useContext(ProvenanceContext);
  const entry = fieldPath ? ctx.get(fieldPath) : undefined;
  return { ...ctx, entry };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/components/prefill/__tests__/provenance-context.test.tsx`
Expected: PASS (13 tests).

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/popover.tsx src/components/prefill/provenance-context.tsx src/components/prefill/__tests__/provenance-context.test.tsx
git commit -m "feat(prefill): ProvenanceProvider with debounced persistence and edit detection; add shadcn popover"
```

---

### Task 10: `ProvenanceBadge` and `SuggestionChip`

**Files:**
- Create: `src/components/prefill/format.ts`
- Create: `src/components/prefill/provenance-badge.tsx`
- Create: `src/components/prefill/suggestion-chip.tsx`
- Test: `src/components/prefill/__tests__/provenance-badge.test.tsx`
- Test: `src/components/prefill/__tests__/suggestion-chip.test.tsx`

**Interfaces:**
- Consumes: `useProvenance`, `ProvenanceProvider` (Task 9); `Popover*` (Task 9); `SOURCE_META`, `EDITED_DOT_CLASS`, `VERIFIED_DOT_CLASS` (Task 1); `Button` (`src/components/ui/button.tsx`).
- Produces:
  - `format.ts`: `formatProvenanceValue(value: ProvenanceValue): string` (booleans → "Yes"/"No", arrays joined with ", "), `confidencePercent(confidence: number): string` (`"92%"`).
  - `provenance-badge.tsx`: `ProvenanceBadge({ fieldPath })` — renders nothing unless the entry exists with `kind: "fill"` and state ≠ `suggested`; a `<button aria-label="Prefilled from <label>, NN% confidence">` (verified: `"Verified. Prefilled from …"`, edited: `"Edited after prefill from …"`) whose visible text is `NN%` / `edited` / `verified`; tapping opens a popover with source label, explanation, value + confidence, quoted evidence, `Open source (p. N)` link (`target="_blank" rel="noopener noreferrer"`), and Verify / Clear buttons (hidden when `readOnly`). Also exports `badgeText(entry)` and `badgeAriaLabel(entry)`.
  - `suggestion-chip.tsx`: `SuggestionChip({ fieldPath })` — renders nothing unless `entry.state === "suggested"`; fill kind: an accept `<button>` reading `Suggested: <value> · NN% · <explanation>` plus a dismiss `<button aria-label="Dismiss suggestion">`; warning kind: amber chip with the message and dismiss only. Exports `suggestionText(entry)`.

- [ ] **Step 1: Write the failing tests**

`src/components/prefill/__tests__/provenance-badge.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as React from "react";
import { useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProvenanceBadge } from "@/components/prefill/provenance-badge";
import { ProvenanceProvider } from "@/components/prefill/provenance-context";
import type { FieldProvenance, ProvenanceEntry } from "@/lib/prefill/types";
import { getDefaultFormValues } from "@/lib/validators/inspection";
import type { InspectionFormData } from "@/types/inspection";

const ENTRY: ProvenanceEntry = {
  source: "permit",
  state: "prefilled",
  kind: "fill",
  value: "1250",
  confidence: 0.92,
  explanation: "Permit OW-17-00474 · Discharge Authorization p.1",
  evidence: "Septic Tank Qty 1 Capacity 1250",
  sourceUrl: "/api/inspections/insp-1/records/rec-1#page=1",
  page: 1,
  at: "2026-09-11T10:00:00.000Z",
};
const FIELD = "septicTank.tanks.0.tankCapacity";

function Harness({
  initial,
  readOnly,
  children,
}: {
  initial: FieldProvenance;
  readOnly?: boolean;
  children: React.ReactNode;
}) {
  const form = useForm<InspectionFormData>({
    defaultValues: getDefaultFormValues("Tech") as unknown as InspectionFormData,
  });
  return (
    <ProvenanceProvider form={form} inspectionId="insp-1" initial={initial} readOnly={readOnly}>
      {children}
    </ProvenanceProvider>
  );
}

function renderBadge(entry: ProvenanceEntry | null, readOnly = false) {
  return render(
    <Harness initial={entry ? { [FIELD]: entry } : {}} readOnly={readOnly}>
      <ProvenanceBadge fieldPath={FIELD} />
    </Harness>,
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ProvenanceBadge", () => {
  it("renders nothing without an entry, for suggestions, and for warnings", () => {
    const { container: none } = renderBadge(null);
    expect(none.querySelector("button")).toBeNull();
    const { container: suggested } = renderBadge({ ...ENTRY, state: "suggested" });
    expect(suggested.querySelector("button")).toBeNull();
    const { container: warning } = renderBadge({ ...ENTRY, kind: "warning", value: "" });
    expect(warning.querySelector("button")).toBeNull();
  });

  it("is a button with the source and confidence in its accessible name and visible text", () => {
    renderBadge(ENTRY);
    const badge = screen.getByRole("button", { name: "Prefilled from Permit records, 92% confidence" });
    expect(badge).toHaveTextContent("92%");
    expect(badge.querySelector("span")).toHaveClass("bg-amber-500");
  });

  it("shows grey 'edited' and green 'verified' states with distinct labels", () => {
    renderBadge({ ...ENTRY, state: "edited" });
    const edited = screen.getByRole("button", { name: "Edited after prefill from Permit records, 92% confidence" });
    expect(edited).toHaveTextContent("edited");
    expect(edited.querySelector("span")).toHaveClass("bg-gray-400");
  });

  it("opens a popover with explanation, evidence and an external source link", async () => {
    const user = userEvent.setup();
    renderBadge(ENTRY);
    await user.click(screen.getByRole("button", { name: /prefilled from permit records/i }));

    expect(await screen.findByText("Permit OW-17-00474 · Discharge Authorization p.1")).toBeInTheDocument();
    expect(screen.getByText("Permit records")).toBeInTheDocument();
    expect(screen.getByText(/Septic Tank Qty 1 Capacity 1250/)).toBeInTheDocument();
    expect(screen.getByText("1250")).toBeInTheDocument();

    const link = screen.getByRole("link", { name: /open source \(p\. 1\)/i });
    expect(link).toHaveAttribute("href", "/api/inspections/insp-1/records/rec-1#page=1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("Verify turns the badge into the verified state", async () => {
    const user = userEvent.setup();
    renderBadge(ENTRY);
    await user.click(screen.getByRole("button", { name: /prefilled from permit records/i }));
    await user.click(await screen.findByRole("button", { name: "Verify" }));

    const verified = screen.getByRole("button", {
      name: "Verified. Prefilled from Permit records, 92% confidence",
    });
    expect(verified).toHaveTextContent("verified");
    expect(verified.querySelector("span")).toHaveClass("bg-emerald-600");
  });

  it("Clear removes the badge", async () => {
    const user = userEvent.setup();
    renderBadge(ENTRY);
    await user.click(screen.getByRole("button", { name: /prefilled from permit records/i }));
    await user.click(await screen.findByRole("button", { name: "Clear" }));
    expect(screen.queryByRole("button", { name: /prefilled from/i })).toBeNull();
  });

  it("hides Verify and Clear when read-only but still shows the details", async () => {
    const user = userEvent.setup();
    renderBadge(ENTRY, true);
    await user.click(screen.getByRole("button", { name: /prefilled from permit records/i }));
    expect(await screen.findByText("Permit OW-17-00474 · Discharge Authorization p.1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Verify" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
  });
});
```

`src/components/prefill/__tests__/suggestion-chip.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as React from "react";
import { type UseFormReturn, useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProvenanceProvider } from "@/components/prefill/provenance-context";
import { SuggestionChip, suggestionText } from "@/components/prefill/suggestion-chip";
import type { FieldProvenance, ProvenanceEntry } from "@/lib/prefill/types";
import { getDefaultFormValues } from "@/lib/validators/inspection";
import type { InspectionFormData } from "@/types/inspection";

const SUGGESTION: ProvenanceEntry = {
  source: "permit",
  state: "suggested",
  kind: "fill",
  value: "3",
  confidence: 0.61,
  explanation: "Permit OW-17-00474 p.2",
  at: "2026-09-11T10:00:00.000Z",
};
const WARNING: ProvenanceEntry = {
  source: "listing",
  state: "suggested",
  kind: "warning",
  value: "",
  confidence: 0.8,
  explanation: 'Listing says "Sewer" — confirm this property is on septic',
  at: "2026-09-11T10:00:00.000Z",
};
const FIELD = "designFlow.numberOfBedrooms";
const formRef: { current: UseFormReturn<InspectionFormData> | null } = { current: null };

function Harness({
  initial,
  readOnly,
  children,
}: {
  initial: FieldProvenance;
  readOnly?: boolean;
  children: React.ReactNode;
}) {
  const form = useForm<InspectionFormData>({
    defaultValues: getDefaultFormValues("Tech") as unknown as InspectionFormData,
  });
  formRef.current = form;
  return (
    <ProvenanceProvider form={form} inspectionId="insp-1" initial={initial} readOnly={readOnly}>
      {children}
    </ProvenanceProvider>
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("suggestionText", () => {
  it("formats value, confidence and explanation", () => {
    expect(suggestionText(SUGGESTION)).toBe("Suggested: 3 · 61% · Permit OW-17-00474 p.2");
    expect(suggestionText({ ...SUGGESTION, value: true })).toBe("Suggested: Yes · 61% · Permit OW-17-00474 p.2");
    expect(suggestionText({ ...SUGGESTION, value: ["a", "b"] })).toBe("Suggested: a, b · 61% · Permit OW-17-00474 p.2");
    expect(suggestionText(WARNING)).toBe('Listing says "Sewer" — confirm this property is on septic');
  });
});

describe("SuggestionChip", () => {
  it("renders nothing without a suggested entry", () => {
    const { container } = render(
      <Harness initial={{ [FIELD]: { ...SUGGESTION, state: "prefilled" } }}>
        <SuggestionChip fieldPath={FIELD} />
      </Harness>,
    );
    expect(container.querySelector("[data-slot=suggestion-chip]")).toBeNull();
  });

  it("accepts the suggestion into the form and disappears", async () => {
    const user = userEvent.setup();
    render(
      <Harness initial={{ [FIELD]: SUGGESTION }}>
        <SuggestionChip fieldPath={FIELD} />
      </Harness>,
    );
    await user.click(
      screen.getByRole("button", { name: "Accept suggestion from Permit records: 3" }),
    );
    expect(formRef.current?.getValues("designFlow.numberOfBedrooms")).toBe("3");
    expect(screen.queryByRole("button", { name: /accept suggestion/i })).toBeNull();
  });

  it("dismisses the suggestion without touching the form", async () => {
    const user = userEvent.setup();
    render(
      <Harness initial={{ [FIELD]: SUGGESTION }}>
        <SuggestionChip fieldPath={FIELD} />
      </Harness>,
    );
    await user.click(screen.getByRole("button", { name: "Dismiss suggestion" }));
    expect(screen.queryByRole("button", { name: /accept suggestion/i })).toBeNull();
    expect(formRef.current?.getValues("designFlow.numberOfBedrooms")).toBe("");
  });

  it("renders a warning as an amber message with dismiss only", () => {
    render(
      <Harness initial={{ "facilityInfo.wastewaterSource": WARNING }}>
        <SuggestionChip fieldPath="facilityInfo.wastewaterSource" />
      </Harness>,
    );
    expect(screen.getByText(WARNING.explanation)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /accept suggestion/i })).toBeNull();
    expect(screen.getByRole("button", { name: "Dismiss suggestion" })).toBeInTheDocument();
    expect(document.querySelector("[data-slot=suggestion-chip]")).toHaveClass("border-amber-300");
  });

  it("is inert when read-only", () => {
    render(
      <Harness initial={{ [FIELD]: SUGGESTION }} readOnly>
        <SuggestionChip fieldPath={FIELD} />
      </Harness>,
    );
    expect(screen.getByRole("button", { name: /accept suggestion/i })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Dismiss suggestion" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/prefill/__tests__/provenance-badge.test.tsx src/components/prefill/__tests__/suggestion-chip.test.tsx`
Expected: FAIL — unresolved imports.

- [ ] **Step 3: Implement `format.ts`**

`src/components/prefill/format.ts`:

```ts
import type { ProvenanceValue } from "@/lib/prefill/types";

export function formatProvenanceValue(value: ProvenanceValue): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.join(", ");
  return value;
}

export function confidencePercent(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}
```

- [ ] **Step 4: Implement the badge**

`src/components/prefill/provenance-badge.tsx`:

```tsx
"use client";

import { Check, ExternalLink } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EDITED_DOT_CLASS, SOURCE_META, VERIFIED_DOT_CLASS } from "@/lib/prefill/sources";
import type { ProvenanceEntry } from "@/lib/prefill/types";
import { cn } from "@/lib/utils";
import { confidencePercent, formatProvenanceValue } from "./format";
import { useProvenance } from "./provenance-context";

/** Visible badge text — always present so colour is never the only signal */
export function badgeText(entry: ProvenanceEntry): string {
  if (entry.state === "verified") return "verified";
  if (entry.state === "edited") return "edited";
  return confidencePercent(entry.confidence);
}

export function badgeAriaLabel(entry: ProvenanceEntry): string {
  const label = SOURCE_META[entry.source].label;
  const pct = confidencePercent(entry.confidence);
  if (entry.state === "verified") return `Verified. Prefilled from ${label}, ${pct} confidence`;
  if (entry.state === "edited") return `Edited after prefill from ${label}, ${pct} confidence`;
  return `Prefilled from ${label}, ${pct} confidence`;
}

interface ProvenanceBadgeProps {
  fieldPath: string;
}

/**
 * Small dot + text badge rendered by FormLabel next to every prefilled field.
 * Tap opens the explanation popover (no hover needed — works on phones).
 */
export function ProvenanceBadge({ fieldPath }: ProvenanceBadgeProps) {
  const { entry, verify, clear, readOnly } = useProvenance(fieldPath);
  const [open, setOpen] = React.useState(false);

  if (!entry || entry.kind !== "fill" || entry.state === "suggested") return null;

  const meta = SOURCE_META[entry.source];
  const dotClass =
    entry.state === "verified"
      ? VERIFIED_DOT_CLASS
      : entry.state === "edited"
        ? EDITED_DOT_CLASS
        : meta.dotClass;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={badgeAriaLabel(entry)}
          data-slot="provenance-badge"
          data-provenance-state={entry.state}
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full border bg-background px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground",
            "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            entry.state === "verified" && "text-emerald-700",
          )}
        >
          <span aria-hidden="true" className={cn("h-2 w-2 rounded-full", dotClass)} />
          {entry.state === "verified" && <Check className="h-3 w-3" aria-hidden="true" />}
          {badgeText(entry)}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-3 text-sm">
        <div>
          <p className="font-medium">{meta.label}</p>
          <p className="text-muted-foreground">{entry.explanation}</p>
        </div>
        <p>
          <span className="text-muted-foreground">Value: </span>
          <span className="font-medium">{formatProvenanceValue(entry.value)}</span>
          <span className="text-muted-foreground">
            {" "}
            · {confidencePercent(entry.confidence)} confidence
          </span>
        </p>
        {entry.evidence && (
          <blockquote className="border-l-2 pl-2 text-muted-foreground italic">
            “{entry.evidence}”
          </blockquote>
        )}
        {entry.sourceUrl && (
          <a
            href={entry.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary underline underline-offset-2"
          >
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
            Open source{entry.page ? ` (p. ${entry.page})` : ""}
          </a>
        )}
        {!readOnly && (
          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              disabled={entry.state === "verified"}
              onClick={() => {
                verify(fieldPath);
                setOpen(false);
              }}
            >
              Verify
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                clear(fieldPath);
                setOpen(false);
              }}
            >
              Clear
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 5: Implement the chip**

`src/components/prefill/suggestion-chip.tsx`:

```tsx
"use client";

import { X } from "lucide-react";
import { SOURCE_META } from "@/lib/prefill/sources";
import type { ProvenanceEntry } from "@/lib/prefill/types";
import { cn } from "@/lib/utils";
import { confidencePercent, formatProvenanceValue } from "./format";
import { useProvenance } from "./provenance-context";

const WARNING_CLASS = "border-amber-300 text-amber-900 bg-amber-50";

export function suggestionText(entry: ProvenanceEntry): string {
  if (entry.kind === "warning") return entry.explanation;
  return `Suggested: ${formatProvenanceValue(entry.value)} · ${confidencePercent(entry.confidence)} · ${entry.explanation}`;
}

interface SuggestionChipProps {
  fieldPath: string;
}

/**
 * Rendered by FormItem under a field whose provenance entry is "suggested":
 * below-threshold values and proposals for fields that already had a value.
 * Tap the text to accept; × dismisses. Warnings carry no value — dismiss only.
 */
export function SuggestionChip({ fieldPath }: SuggestionChipProps) {
  const { entry, acceptSuggestion, dismissSuggestion, readOnly } = useProvenance(fieldPath);
  if (!entry || entry.state !== "suggested") return null;

  const meta = SOURCE_META[entry.source];
  const isWarning = entry.kind === "warning";

  return (
    <div
      data-slot="suggestion-chip"
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
        isWarning ? WARNING_CLASS : meta.accentClass,
      )}
    >
      {isWarning ? (
        <span className="truncate">{entry.explanation}</span>
      ) : (
        <button
          type="button"
          disabled={readOnly}
          aria-label={`Accept suggestion from ${meta.label}: ${formatProvenanceValue(entry.value)}`}
          onClick={() => acceptSuggestion(fieldPath)}
          className="truncate text-left underline-offset-2 hover:underline disabled:no-underline"
        >
          {suggestionText(entry)}
        </button>
      )}
      {!readOnly && (
        <button
          type="button"
          aria-label="Dismiss suggestion"
          onClick={() => dismissSuggestion(fieldPath)}
          className="ml-1 shrink-0 rounded-full p-0.5 hover:bg-black/5"
        >
          <X className="h-3 w-3" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/components/prefill/__tests__/provenance-badge.test.tsx src/components/prefill/__tests__/suggestion-chip.test.tsx`
Expected: PASS (7 + 6 tests).

- [ ] **Step 7: Commit**

```bash
git add src/components/prefill/format.ts src/components/prefill/provenance-badge.tsx src/components/prefill/suggestion-chip.tsx src/components/prefill/__tests__/provenance-badge.test.tsx src/components/prefill/__tests__/suggestion-chip.test.tsx
git commit -m "feat(prefill): ProvenanceBadge popover and SuggestionChip"
```

---

### Task 11: `FormLabel` / `FormItem` integration

**Files:**
- Modify: `src/components/ui/form.tsx` (`FormItem` and `FormLabel` functions, imports)
- Test: `src/components/ui/__tests__/form-provenance.test.tsx`

**Interfaces:**
- Consumes: `ProvenanceBadge` (Task 10), `SuggestionChip` (Task 10), `useProvenance` (Task 9).
- Produces: every `FormLabel` inside a `FormField` appends `<ProvenanceBadge fieldPath={name} />`; every `FormItem` inside a `FormField` appends `<SuggestionChip fieldPath={name} />` after its children. No per-field changes in the six step components. Outside a `ProvenanceProvider` both render nothing (no-op context), so every existing test keeps passing.

- [ ] **Step 1: Write the failing test**

`src/components/ui/__tests__/form-provenance.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProvenanceProvider } from "@/components/prefill/provenance-context";
import { Form, FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import type { FieldProvenance, ProvenanceEntry } from "@/lib/prefill/types";
import { getDefaultFormValues } from "@/lib/validators/inspection";
import type { InspectionFormData } from "@/types/inspection";

const ENTRY: ProvenanceEntry = {
  source: "assessor",
  state: "prefilled",
  kind: "fill",
  value: "JOHN DOE",
  confidence: 1,
  explanation: "Maricopa County Assessor · parcel 219-11-121",
  at: "2026-09-11T10:00:00.000Z",
};

function NameField() {
  const form = useForm<InspectionFormData>({
    defaultValues: getDefaultFormValues("Tech") as unknown as InspectionFormData,
  });
  return (
    <Form {...form}>
      <FormField
        control={form.control}
        name="facilityInfo.facilityName"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Facility name</FormLabel>
            <FormControl>
              <Input {...field} />
            </FormControl>
          </FormItem>
        )}
      />
    </Form>
  );
}

function WithProvenance({ initial }: { initial: FieldProvenance }) {
  const form = useForm<InspectionFormData>({
    defaultValues: getDefaultFormValues("Tech") as unknown as InspectionFormData,
  });
  return (
    <ProvenanceProvider form={form} inspectionId="insp-1" initial={initial}>
      <Form {...form}>
        <FormField
          control={form.control}
          name="facilityInfo.facilityName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Facility name</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
            </FormItem>
          )}
        />
      </Form>
    </ProvenanceProvider>
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FormLabel / FormItem provenance integration", () => {
  it("renders no badge or chip outside a ProvenanceProvider", () => {
    render(<NameField />);
    expect(screen.getByText("Facility name")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /prefilled from/i })).toBeNull();
    expect(document.querySelector("[data-slot=suggestion-chip]")).toBeNull();
  });

  it("renders no badge when the field has no entry", () => {
    render(<WithProvenance initial={{ "facilityInfo.facilityCity": ENTRY }} />);
    expect(screen.queryByRole("button", { name: /prefilled from/i })).toBeNull();
  });

  it("appends the badge inside the label for a prefilled field", () => {
    render(<WithProvenance initial={{ "facilityInfo.facilityName": ENTRY }} />);
    const badge = screen.getByRole("button", { name: "Prefilled from County Assessor, 100% confidence" });
    expect(badge.closest("label")).toHaveTextContent("Facility name");
    expect(document.querySelector("[data-slot=suggestion-chip]")).toBeNull();
  });

  it("appends the suggestion chip inside the item for a suggested field", () => {
    render(
      <WithProvenance
        initial={{ "facilityInfo.facilityName": { ...ENTRY, state: "suggested", confidence: 0.6 } }}
      />,
    );
    const chip = document.querySelector("[data-slot=suggestion-chip]");
    expect(chip).not.toBeNull();
    expect(chip?.closest("[data-slot=form-item]")).not.toBeNull();
    expect(screen.getByRole("button", { name: /accept suggestion from county assessor/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /prefilled from/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/ui/__tests__/form-provenance.test.tsx`
Expected: FAIL — the two "appends" tests fail (no badge / chip rendered).

- [ ] **Step 3: Wire the badge and chip into `form.tsx`**

In `src/components/ui/form.tsx`, add the imports after `import { Label } from "@/components/ui/label";`:

```ts
import { ProvenanceBadge } from "@/components/prefill/provenance-badge";
import { SuggestionChip } from "@/components/prefill/suggestion-chip";
import { useProvenance } from "@/components/prefill/provenance-context";
```

Replace the `FormItem` function with:

```tsx
function FormItem({ className, children, ...props }: React.ComponentProps<"div">) {
  const id = React.useId();
  // FormItem is normally rendered inside a FormField; outside one the context is empty
  const fieldContext = React.useContext(FormFieldContext);
  const fieldName = fieldContext?.name;
  const { entry } = useProvenance(fieldName);

  return (
    <FormItemContext.Provider value={{ id }}>
      <div data-slot="form-item" className={cn("grid gap-2", className)} {...props}>
        {children}
        {fieldName && entry?.state === "suggested" ? <SuggestionChip fieldPath={fieldName} /> : null}
      </div>
    </FormItemContext.Provider>
  );
}
```

Replace the `FormLabel` function with:

```tsx
function FormLabel({
  className,
  children,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  const { error, formItemId, name } = useFormField();

  // The badge is a <button>, i.e. interactive content: per the HTML spec clicking it
  // does not activate the label's control, so it is safe inside the label.
  return (
    <Label
      data-slot="form-label"
      data-error={!!error}
      className={cn("data-[error=true]:text-destructive", className)}
      htmlFor={formItemId}
      {...props}
    >
      {children}
      <ProvenanceBadge fieldPath={name} />
    </Label>
  );
}
```

- [ ] **Step 4: Run the new test and the existing component suites that render form fields**

Run: `npx vitest run src/components/ui/__tests__/form-provenance.test.tsx src/components/inspection src/components/review src/components/dashboard`
Expected: the new file PASSES (4 tests); the existing suites show **no new failures** (`review-actions.test.tsx` has pre-existing failures — compare against a run on the previous commit if unsure).

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/form.tsx src/components/ui/__tests__/form-provenance.test.tsx
git commit -m "feat(prefill): FormLabel renders ProvenanceBadge, FormItem renders SuggestionChip"
```

---

### Task 12: `PrefillSourcesTile`

**Files:**
- Create: `src/components/prefill/prefill-sources-tile.tsx`
- Test: `src/components/prefill/__tests__/prefill-sources-tile.test.tsx`

**Interfaces:**
- Consumes: `PrefillRunDTO`, `PrefillStage`, `PrefillStages`, `StageStatus` (Task 1); `Button`, `Collapsible*` (existing ui).
- Produces:
  ```ts
  export interface PrefillSourcesTileProps {
    run: PrefillRunDTO | null;
    isRunning: boolean;
    canRun: boolean;      // false → "Find records" disabled
    error: string | null; // hook-level error (409/429/network)
    onFindRecords: () => void;
  }
  export function PrefillSourcesTile(props: PrefillSourcesTileProps): JSX.Element;
  export function stageSummary(stage: PrefillStage): string;
  ```
  Rows for Assessor / Listing / Permits with a status icon, one-line summary and `target="_blank"` links; banners for `error`, `run.status === "failed"` (`Prefill failed — Find records to retry`), and abandonment (`run.records.some(r => r.isAbandonment)`); collapsible; last-run timestamp; the candidate picker is phase 2.

- [ ] **Step 1: Write the failing test**

`src/components/prefill/__tests__/prefill-sources-tile.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { PrefillSourcesTile, stageSummary } from "@/components/prefill/prefill-sources-tile";
import type { InspectionRecordDTO, PrefillRunDTO } from "@/lib/prefill/types";

const RUN: PrefillRunDTO = {
  id: "run-1",
  inspectionId: "insp-1",
  trigger: "manual",
  status: "done",
  input: { apn: "219-11-121" },
  stages: {
    assessor: {
      status: "done",
      summary: "Parcel 219-11-121 · 8911 E CAVE CREEK RD",
      links: [{ label: "Assessor parcel page", url: "https://mcassessor.maricopa.gov/mcs/?q=219-11-121" }],
    },
    listing: { status: "skipped", summary: "Not available yet", links: [] },
    permits: {
      status: "not_found",
      summary: "No permit records found (searched APN 219-11-121 and 8911 CAVE CREEK — 0 matches)",
      links: [],
    },
  },
  proposals: [],
  candidates: [],
  error: null,
  appliedAt: null,
  createdAt: "2026-09-11T10:00:00.000Z",
  finishedAt: "2026-09-11T10:00:05.000Z",
  records: [],
};

const ABANDONMENT: InspectionRecordDTO = {
  id: "rec-1",
  source: "edms_env",
  permitNumber: "000972",
  docType: "ABANDONMENT",
  docDate: null,
  description: null,
  pageCount: null,
  sizeBytes: null,
  selected: true,
  extractionStatus: "pending",
  extractionError: null,
  isAbandonment: true,
  downloadUrl: "/api/inspections/insp-1/records/rec-1",
};

function renderTile(over: Partial<React.ComponentProps<typeof PrefillSourcesTile>> = {}) {
  const props = {
    run: RUN,
    isRunning: false,
    canRun: true,
    error: null,
    onFindRecords: vi.fn(),
    ...over,
  };
  render(<PrefillSourcesTile {...props} />);
  return props;
}

describe("stageSummary", () => {
  it("prefers the stage summary, then the error, then a status default", () => {
    expect(stageSummary({ status: "done", summary: "2 permits found", links: [] })).toBe("2 permits found");
    expect(stageSummary({ status: "error", error: "Maricopa EDMS unavailable", links: [] })).toBe("Maricopa EDMS unavailable");
    expect(stageSummary({ status: "pending", links: [] })).toBe("Waiting…");
    expect(stageSummary({ status: "running", links: [] })).toBe("Searching…");
    expect(stageSummary({ status: "skipped", links: [] })).toBe("Not available yet");
  });
});

describe("PrefillSourcesTile", () => {
  it("shows intro copy and an enabled Find records button before any run", () => {
    renderTile({ run: null });
    expect(screen.getByText(/pull owner, address and permit details/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /find records/i })).toBeEnabled();
    expect(screen.queryByText(/last run/i)).toBeNull();
  });

  it("calls onFindRecords when the button is clicked", async () => {
    const user = userEvent.setup();
    const props = renderTile({ run: null });
    await user.click(screen.getByRole("button", { name: /find records/i }));
    expect(props.onFindRecords).toHaveBeenCalledTimes(1);
  });

  it("disables the button while running and when the caller cannot run", () => {
    renderTile({ isRunning: true });
    expect(screen.getByRole("button", { name: /searching/i })).toBeDisabled();
  });

  it("disables the button when canRun is false", () => {
    renderTile({ canRun: false });
    expect(screen.getByRole("button", { name: /find records/i })).toBeDisabled();
  });

  it("renders one row per stage with summary, status and external links", () => {
    renderTile();
    expect(screen.getByText(/Parcel 219-11-121 · 8911 E CAVE CREEK RD/)).toBeInTheDocument();
    expect(screen.getByText(/Not available yet/)).toBeInTheDocument();
    expect(screen.getByText(/No permit records found \(searched APN 219-11-121/)).toBeInTheDocument();

    const link = screen.getByRole("link", { name: "Assessor parcel page" });
    expect(link).toHaveAttribute("href", "https://mcassessor.maricopa.gov/mcs/?q=219-11-121");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");

    expect(document.querySelector("[data-stage=permits]")).toHaveAttribute("data-status", "not_found");
    expect(screen.getByText(/last run/i)).toBeInTheDocument();
  });

  it("shows the failed banner with the run error", () => {
    renderTile({ run: { ...RUN, status: "failed", error: "Timed out" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Prefill failed — Find records to retry (Timed out)");
  });

  it("shows the abandonment banner when a record is an ABANDONMENT document", () => {
    renderTile({ run: { ...RUN, records: [ABANDONMENT] } });
    expect(screen.getByRole("alert")).toHaveTextContent(/ABANDONMENT document was found/);
  });

  it("shows the hook-level error", () => {
    renderTile({ error: "Prefill limit reached (3 per hour)" });
    expect(screen.getByRole("alert")).toHaveTextContent("Prefill limit reached (3 per hour)");
  });

  it("collapses and expands the rows", async () => {
    const user = userEvent.setup();
    renderTile();
    await user.click(screen.getByRole("button", { name: /prefill sources/i }));
    expect(screen.queryByText(/Parcel 219-11-121/)).toBeNull();
    await user.click(screen.getByRole("button", { name: /prefill sources/i }));
    expect(screen.getByText(/Parcel 219-11-121/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/prefill/__tests__/prefill-sources-tile.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/prefill/prefill-sources-tile"`.

- [ ] **Step 3: Implement the tile**

`src/components/prefill/prefill-sources-tile.tsx`:

```tsx
"use client";

import { AlertTriangle, Check, ChevronDown, Loader2, Minus, Search, SearchX } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { PrefillRunDTO, PrefillStage, PrefillStages, StageStatus } from "@/lib/prefill/types";
import { cn } from "@/lib/utils";

const STAGE_ROWS: Array<{ key: keyof PrefillStages; label: string }> = [
  { key: "assessor", label: "Assessor" },
  { key: "listing", label: "Listing" },
  { key: "permits", label: "Permits" },
];

const DEFAULT_SUMMARY: Record<StageStatus, string> = {
  pending: "Waiting…",
  running: "Searching…",
  done: "Done",
  not_found: "No records found",
  error: "Failed",
  skipped: "Not available yet",
};

export function stageSummary(stage: PrefillStage): string {
  if (stage.summary) return stage.summary;
  if (stage.status === "error" && stage.error) return stage.error;
  return DEFAULT_SUMMARY[stage.status];
}

function StageIcon({ status }: { status: StageStatus }) {
  const base = "h-4 w-4 shrink-0 mt-0.5";
  switch (status) {
    case "running":
      return <Loader2 className={cn(base, "animate-spin text-primary")} aria-hidden="true" />;
    case "done":
      return <Check className={cn(base, "text-emerald-600")} aria-hidden="true" />;
    case "not_found":
      return <SearchX className={cn(base, "text-muted-foreground")} aria-hidden="true" />;
    case "error":
      return <AlertTriangle className={cn(base, "text-destructive")} aria-hidden="true" />;
    default:
      return <Minus className={cn(base, "text-muted-foreground")} aria-hidden="true" />;
  }
}

function Banner({ tone, children }: { tone: "destructive" | "red"; children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className={cn(
        "rounded-md border p-2 text-sm",
        tone === "destructive"
          ? "border-destructive/50 bg-destructive/10 text-destructive"
          : "border-red-300 bg-red-50 font-medium text-red-900",
      )}
    >
      {children}
    </div>
  );
}

export interface PrefillSourcesTileProps {
  run: PrefillRunDTO | null;
  isRunning: boolean;
  /** False on non-drafts / read-only views — the button is disabled */
  canRun: boolean;
  /** Hook-level error (409 / 429 / network) shown above the rows */
  error: string | null;
  onFindRecords: () => void;
}

/**
 * "Prefill sources" card above step 1: one row per source with status, summary
 * and links, the Find records button, and the failure / abandonment banners.
 * The candidate picker (ambiguous permits) arrives in phase 2.
 */
export function PrefillSourcesTile({
  run,
  isRunning,
  canRun,
  error,
  onFindRecords,
}: PrefillSourcesTileProps) {
  const [open, setOpen] = React.useState(true);
  const hasAbandonment = run?.records.some((r) => r.isAbandonment) ?? false;
  const failed = run?.status === "failed";

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-lg border bg-card"
      data-slot="prefill-sources-tile"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <CollapsibleTrigger asChild>
          <button type="button" className="flex min-w-0 items-center gap-2 text-left">
            <ChevronDown
              className={cn("h-4 w-4 shrink-0 transition-transform", !open && "-rotate-90")}
              aria-hidden="true"
            />
            <span className="text-sm font-semibold">Prefill sources</span>
            {run && (
              <span className="truncate text-xs text-muted-foreground">
                Last run {new Date(run.createdAt).toLocaleString()}
              </span>
            )}
          </button>
        </CollapsibleTrigger>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onFindRecords}
          disabled={!canRun || isRunning}
          className="gap-2"
        >
          {isRunning ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Search className="h-4 w-4" aria-hidden="true" />
          )}
          {isRunning ? "Searching…" : "Find records"}
        </Button>
      </div>

      <CollapsibleContent>
        <div className="space-y-3 border-t px-4 py-3">
          {error && <Banner tone="destructive">{error}</Banner>}
          {failed && (
            <Banner tone="destructive">
              Prefill failed — Find records to retry{run?.error ? ` (${run.error})` : ""}
            </Banner>
          )}
          {hasAbandonment && (
            <Banner tone="red">
              An ABANDONMENT document was found for this parcel — the system may have been
              abandoned. Review the permit records before continuing.
            </Banner>
          )}

          {run ? (
            <ul className="space-y-2">
              {STAGE_ROWS.map(({ key, label }) => {
                const stage = run.stages[key];
                return (
                  <li
                    key={key}
                    className="flex items-start gap-2 text-sm"
                    data-stage={key}
                    data-status={stage.status}
                  >
                    <StageIcon status={stage.status} />
                    <div className="min-w-0 flex-1">
                      <span className="font-medium">{label}</span>
                      <span className="text-muted-foreground"> · {stageSummary(stage)}</span>
                      {stage.links.length > 0 && (
                        <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1">
                          {stage.links.map((link) => (
                            <a
                              key={link.url}
                              href={link.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-primary underline underline-offset-2"
                            >
                              {link.label}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Pull owner, address and permit details from county records into this form. Each
              value gets a badge so you can verify where it came from.
            </p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/prefill/__tests__/prefill-sources-tile.test.tsx`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/prefill/prefill-sources-tile.tsx src/components/prefill/__tests__/prefill-sources-tile.test.tsx
git commit -m "feat(prefill): PrefillSourcesTile with stage rows, links, banners and Find records"
```

---

### Task 13: `usePrefill` hook — start / poll / apply / select

**Files:**
- Create: `src/components/prefill/use-prefill.ts`
- Test: `src/components/prefill/__tests__/use-prefill.test.tsx`

**Interfaces:**
- Consumes: `mergeProposals` (Task 2); `useProvenance` (Task 9); routes from Tasks 7–8; `PrefillRunDTO`, `PrefillAddress`, `emptyStages` (Task 1).
- Produces:
  ```ts
  export const PREFILL_POLL_MS = 2000;
  export interface StartPrefillInput { apn?: string; address?: PrefillAddress; trigger?: "apn_lookup" | "manual" }
  export function usePrefill(args: { inspectionId: string; form: UseFormReturn<InspectionFormData>; enabled: boolean; initialRun?: PrefillRunDTO | null }): {
    run: PrefillRunDTO | null;
    isRunning: boolean;
    start(input?: StartPrefillInput): Promise<void>;
    selectCandidates(keys: string[]): Promise<void>;
    error: string | null;
  };
  ```
  Must be called inside a `ProvenanceProvider`. On mount (when `enabled`): adopts `initialRun` if given, else `GET prefill/latest`; a `done` run with `appliedAt === null` is applied once: `mergeProposals(form.getValues(), provenance, proposals)` → `form.setValue` per fill → `setMany` → `POST …/applied`. While the run is `queued|running`, `GET prefill/[runId]` every 2 s. `start()` → `POST prefill` (409/429 messages land in `error`). `selectCandidates()` → `POST …/select`.

- [ ] **Step 1: Write the failing test**

`src/components/prefill/__tests__/use-prefill.test.tsx`:

```tsx
import { act, renderHook, waitFor } from "@testing-library/react";
import type * as React from "react";
import { type UseFormReturn, useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProvenanceProvider, useProvenance } from "@/components/prefill/provenance-context";
import { PREFILL_POLL_MS, usePrefill } from "@/components/prefill/use-prefill";
import type { PrefillRunDTO } from "@/lib/prefill/types";
import { getDefaultFormValues } from "@/lib/validators/inspection";
import type { InspectionFormData } from "@/types/inspection";

const DONE_RUN: PrefillRunDTO = {
  id: "run-1",
  inspectionId: "insp-1",
  trigger: "manual",
  status: "done",
  input: { apn: "219-11-121" },
  stages: {
    assessor: { status: "done", summary: "Parcel 219-11-121", links: [] },
    listing: { status: "skipped", summary: "Not available yet", links: [] },
    permits: { status: "skipped", summary: "Not available yet", links: [] },
  },
  proposals: [
    {
      fieldPath: "facilityInfo.taxParcelNumber",
      value: "219-11-121",
      kind: "fill",
      provenance: { source: "assessor", confidence: 1, explanation: "Maricopa County Assessor · parcel 219-11-121" },
    },
    {
      fieldPath: "designFlow.numberOfBedrooms",
      value: "3",
      kind: "fill",
      provenance: { source: "permit", confidence: 0.6, explanation: "Permit 000972 p.1" },
    },
  ],
  candidates: [],
  error: null,
  appliedAt: null,
  createdAt: "2026-09-11T10:00:00.000Z",
  finishedAt: "2026-09-11T10:00:05.000Z",
  records: [],
};

type Route = { status: number; body: unknown };
type Handler = (method: string, url: string, body: unknown) => Route | undefined;

function installFetch(handler: Handler) {
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const route = handler(method, url, body) ?? { status: 404, body: { error: "no route" } };
    return { ok: route.status < 400, status: route.status, json: () => Promise.resolve(route.body) };
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

function calls(mock: ReturnType<typeof installFetch>) {
  return mock.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${url}`);
}

type FormRef = { current: UseFormReturn<InspectionFormData> | null };

function makeWrapper(formRef: FormRef) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    const form = useForm<InspectionFormData>({
      defaultValues: getDefaultFormValues("Tech") as unknown as InspectionFormData,
    });
    formRef.current = form;
    return (
      <ProvenanceProvider form={form} inspectionId="insp-1" initial={{}}>
        {children}
      </ProvenanceProvider>
    );
  };
}

function renderPrefill(opts: { enabled?: boolean; initialRun?: PrefillRunDTO | null } = {}) {
  const formRef: FormRef = { current: null };
  const hook = renderHook(
    () => ({
      prefill: usePrefill({
        inspectionId: "insp-1",
        form: formRef.current as UseFormReturn<InspectionFormData>,
        enabled: opts.enabled ?? true,
        initialRun: opts.initialRun,
      }),
      prov: useProvenance(),
    }),
    { wrapper: makeWrapper(formRef) },
  );
  return { ...hook, formRef };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("usePrefill", () => {
  it("does nothing when disabled", async () => {
    const mock = installFetch(() => undefined);
    const { result } = renderPrefill({ enabled: false });
    await act(async () => {});
    expect(mock).not.toHaveBeenCalled();
    expect(result.current.prefill.run).toBeNull();
    expect(result.current.prefill.isRunning).toBe(false);
  });

  it("loads the latest run on mount and applies an unapplied done run", async () => {
    const mock = installFetch((method, url) => {
      if (method === "GET" && url === "/api/inspections/insp-1/prefill/latest") return { status: 200, body: DONE_RUN };
      if (method === "POST" && url === "/api/inspections/insp-1/prefill/run-1/applied") return { status: 200, body: { ok: true } };
      return undefined;
    });
    const { result, formRef } = renderPrefill();

    await waitFor(() => {
      expect(formRef.current?.getValues("facilityInfo.taxParcelNumber")).toBe("219-11-121");
    });
    expect(result.current.prov.provenance["facilityInfo.taxParcelNumber"]).toMatchObject({
      source: "assessor",
      state: "prefilled",
      runId: "run-1",
    });
    // below the gate → suggestion, not written
    expect(formRef.current?.getValues("designFlow.numberOfBedrooms")).toBe("");
    expect(result.current.prov.provenance["designFlow.numberOfBedrooms"].state).toBe("suggested");

    await waitFor(() => {
      expect(calls(mock)).toContain("POST /api/inspections/insp-1/prefill/run-1/applied");
    });
    await waitFor(() => {
      expect(result.current.prefill.run?.appliedAt).toBeTruthy();
    });
  });

  it("adopts initialRun without fetching latest", async () => {
    const mock = installFetch((method, url) => {
      if (method === "POST" && url.endsWith("/applied")) return { status: 200, body: { ok: true } };
      return undefined;
    });
    const { result, formRef } = renderPrefill({ initialRun: DONE_RUN });
    await waitFor(() => {
      expect(formRef.current?.getValues("facilityInfo.taxParcelNumber")).toBe("219-11-121");
    });
    expect(calls(mock)).not.toContain("GET /api/inspections/insp-1/prefill/latest");
    expect(result.current.prefill.run?.id).toBe("run-1");
  });

  it("does not re-apply a run that was already applied", async () => {
    const mock = installFetch(() => undefined);
    const { formRef } = renderPrefill({
      initialRun: { ...DONE_RUN, appliedAt: "2026-09-11T10:01:00.000Z" },
    });
    await act(async () => {});
    expect(formRef.current?.getValues("facilityInfo.taxParcelNumber")).toBe("");
    expect(mock).not.toHaveBeenCalled();
  });

  it("start() posts, then polls every 2 s until the run is done and applies it", async () => {
    vi.useFakeTimers();
    let polls = 0;
    const mock = installFetch((method, url) => {
      if (method === "POST" && url === "/api/inspections/insp-1/prefill") return { status: 201, body: { runId: "run-2" } };
      if (method === "GET" && url === "/api/inspections/insp-1/prefill/run-2") {
        polls += 1;
        return polls < 2
          ? { status: 200, body: { ...DONE_RUN, id: "run-2", status: "running", proposals: [] } }
          : { status: 200, body: { ...DONE_RUN, id: "run-2" } };
      }
      if (method === "POST" && url === "/api/inspections/insp-1/prefill/run-2/applied") return { status: 200, body: { ok: true } };
      return undefined;
    });
    const { result, formRef } = renderPrefill({ initialRun: null });

    await act(async () => {
      await result.current.prefill.start({ apn: "219-11-121", trigger: "apn_lookup" });
    });
    const post = mock.mock.calls.find(([url, init]) => init?.method === "POST" && url === "/api/inspections/insp-1/prefill");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ apn: "219-11-121", trigger: "apn_lookup" });
    expect(result.current.prefill.run?.status).toBe("running");
    expect(result.current.prefill.isRunning).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PREFILL_POLL_MS);
    });
    expect(result.current.prefill.run?.status).toBe("done");
    expect(result.current.prefill.isRunning).toBe(false);
    expect(formRef.current?.getValues("facilityInfo.taxParcelNumber")).toBe("219-11-121");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(calls(mock)).toContain("POST /api/inspections/insp-1/prefill/run-2/applied");
  });

  it("surfaces the server error from start() (429 / 409) and keeps the previous run", async () => {
    installFetch((method, url) => {
      if (method === "POST" && url === "/api/inspections/insp-1/prefill") {
        return { status: 429, body: { error: "Prefill limit reached (3 per hour)" } };
      }
      return undefined;
    });
    const { result } = renderPrefill({ initialRun: null });
    await act(async () => {
      await result.current.prefill.start();
    });
    expect(result.current.prefill.error).toBe("Prefill limit reached (3 per hour)");
    expect(result.current.prefill.run).toBeNull();
  });

  it("surfaces a network failure from start()", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { result } = renderPrefill({ initialRun: null });
    await act(async () => {
      await result.current.prefill.start();
    });
    expect(result.current.prefill.error).toBe("Prefill failed — check your connection and try again");
  });

  it("selectCandidates surfaces the 409 from the select route", async () => {
    installFetch((method, url) => {
      if (method === "POST" && url === "/api/inspections/insp-1/prefill/run-1/select") {
        return { status: 409, body: { error: "Run is not awaiting selection" } };
      }
      if (method === "POST" && url.endsWith("/applied")) return { status: 200, body: { ok: true } };
      return undefined;
    });
    const { result } = renderPrefill({ initialRun: DONE_RUN });
    await act(async () => {
      await result.current.prefill.selectCandidates(["edms_env:000972:PERMIT:"]);
    });
    expect(result.current.prefill.error).toBe("Run is not awaiting selection");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/prefill/__tests__/use-prefill.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/prefill/use-prefill"`.

- [ ] **Step 3: Implement the hook**

`src/components/prefill/use-prefill.ts`:

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FieldPath, UseFormReturn } from "react-hook-form";
import { mergeProposals } from "@/lib/prefill/merge";
import type { PrefillAddress, PrefillRunDTO, PrefillTrigger } from "@/lib/prefill/types";
import { emptyStages } from "@/lib/prefill/types";
import type { InspectionFormData } from "@/types/inspection";
import { useProvenance } from "./provenance-context";

export const PREFILL_POLL_MS = 2000;

const ACTIVE_STATUSES: ReadonlySet<string> = new Set(["queued", "running"]);

export interface StartPrefillInput {
  apn?: string;
  address?: PrefillAddress;
  trigger?: "apn_lookup" | "manual";
}

export interface UsePrefillArgs {
  inspectionId: string;
  form: UseFormReturn<InspectionFormData>;
  enabled: boolean;
  /** Server-loaded latest run: undefined = fetch on mount; null = known to be none */
  initialRun?: PrefillRunDTO | null;
}

export interface UsePrefillReturn {
  run: PrefillRunDTO | null;
  isRunning: boolean;
  start(input?: StartPrefillInput): Promise<void>;
  selectCandidates(keys: string[]): Promise<void>;
  error: string | null;
}

/** Used only if the GET right after creation fails — keeps polling alive */
function placeholderRun(id: string, inspectionId: string, trigger: PrefillTrigger): PrefillRunDTO {
  return {
    id,
    inspectionId,
    trigger,
    status: "queued",
    input: {},
    stages: emptyStages(),
    proposals: [],
    candidates: [],
    error: null,
    appliedAt: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
    records: [],
  };
}

/**
 * Starts prefill runs, polls them, and applies finished runs to the form via
 * mergeProposals + the provenance context. Must be used inside ProvenanceProvider.
 */
export function usePrefill({ inspectionId, form, enabled, initialRun }: UsePrefillArgs): UsePrefillReturn {
  const { provenance, setMany } = useProvenance();
  const provenanceRef = useRef(provenance);
  provenanceRef.current = provenance;

  const [run, setRun] = useState<PrefillRunDTO | null>(initialRun ?? null);
  const [error, setError] = useState<string | null>(null);
  const appliedRef = useRef<Set<string>>(new Set());

  const applyRun = useCallback(
    async (candidate: PrefillRunDTO) => {
      if (candidate.status !== "done" || candidate.appliedAt || appliedRef.current.has(candidate.id)) {
        return;
      }
      appliedRef.current.add(candidate.id);

      const { fills, provenance: next } = mergeProposals(
        form.getValues(),
        provenanceRef.current,
        candidate.proposals,
        { runId: candidate.id },
      );
      for (const fill of fills) {
        form.setValue(fill.fieldPath as FieldPath<InspectionFormData>, fill.value as never, {
          shouldDirty: true,
          shouldValidate: true,
        });
      }
      setMany(next);

      try {
        const res = await fetch(`/api/inspections/${inspectionId}/prefill/${candidate.id}/applied`, {
          method: "POST",
        });
        if (res.ok) {
          setRun((current) =>
            current && current.id === candidate.id
              ? { ...current, appliedAt: new Date().toISOString() }
              : current,
          );
        }
      } catch {
        // The merge is idempotent — an unapplied run is simply re-applied on the next mount
      }
    },
    [form, inspectionId, setMany],
  );

  const fetchRun = useCallback(
    async (runId: string): Promise<PrefillRunDTO | null> => {
      try {
        const res = await fetch(`/api/inspections/${inspectionId}/prefill/${runId}`);
        if (!res.ok) return null;
        return (await res.json()) as PrefillRunDTO;
      } catch {
        return null;
      }
    },
    [inspectionId],
  );

  // Mount: adopt or load the latest run and apply it if it finished unapplied
  // (this is how webhook-triggered runs reach the form in phase 5).
  useEffect(() => {
    if (!enabled) return;
    if (initialRun !== undefined) {
      if (initialRun) void applyRun(initialRun);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/inspections/${inspectionId}/prefill/latest`);
        if (!res.ok || cancelled) return;
        const latest = (await res.json()) as PrefillRunDTO | null;
        if (cancelled) return;
        setRun(latest);
        if (latest) void applyRun(latest);
      } catch {
        // No latest run to show — the tile falls back to its intro copy
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, inspectionId, initialRun, applyRun]);

  // Poll while the run is queued/running
  useEffect(() => {
    if (!enabled || !run || !ACTIVE_STATUSES.has(run.status)) return;
    const runId = run.id;
    const timer = setInterval(async () => {
      const next = await fetchRun(runId);
      if (!next) return;
      setRun(next);
      if (next.status === "done") void applyRun(next);
    }, PREFILL_POLL_MS);
    return () => clearInterval(timer);
  }, [enabled, run, fetchRun, applyRun]);

  const start = useCallback(
    async (input: StartPrefillInput = {}) => {
      setError(null);
      try {
        const res = await fetch(`/api/inspections/${inspectionId}/prefill`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        const body = (await res.json().catch(() => ({}))) as { runId?: string; error?: string };
        if (!res.ok || !body.runId) {
          setError(body.error ?? `Prefill failed (${res.status})`);
          return;
        }
        const created = await fetchRun(body.runId);
        setRun(created ?? placeholderRun(body.runId, inspectionId, input.trigger ?? "manual"));
      } catch {
        setError("Prefill failed — check your connection and try again");
      }
    },
    [inspectionId, fetchRun],
  );

  const selectCandidates = useCallback(
    async (keys: string[]) => {
      if (!run) return;
      setError(null);
      try {
        const res = await fetch(`/api/inspections/${inspectionId}/prefill/${run.id}/select`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ candidateKeys: keys }),
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setError(body.error ?? "Could not select records");
          return;
        }
        setRun({ ...run, status: "running", candidates: [] });
      } catch {
        setError("Could not select records — try again");
      }
    },
    [inspectionId, run],
  );

  return {
    run,
    isRunning: run !== null && ACTIVE_STATUSES.has(run.status),
    start,
    selectCandidates,
    error,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/prefill/__tests__/use-prefill.test.tsx`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/prefill/use-prefill.ts src/components/prefill/__tests__/use-prefill.test.tsx
git commit -m "feat(prefill): usePrefill hook — start, poll, apply via mergeProposals, select"
```

---

### Task 14: Wizard wiring — provider, panel, APN-lookup provenance + auto-start, edit page

**Files:**
- Modify: `src/components/inspection/apn-lookup-input.tsx`
- Create: `src/components/prefill/prefill-panel.tsx`
- Modify: `src/components/inspection/inspection-wizard.tsx`
- Modify: `src/app/(dashboard)/inspections/[id]/edit/page.tsx`
- Test: `src/components/inspection/__tests__/apn-lookup-provenance.test.tsx`
- Test: `src/components/prefill/__tests__/prefill-panel.test.tsx`
- Test: `src/components/inspection/__tests__/inspection-wizard-provenance.test.tsx`
- Existing tests that must stay green: `src/components/inspection/__tests__/apn-lookup-input.test.tsx`

**Interfaces:**
- Consumes: `assessorProposals`, `AssessorSummary` (Task 4); `useProvenance`, `ProvenanceProvider` (Task 9); `PrefillSourcesTile` (Task 12); `usePrefill` (Task 13); `loadLatestRunDTO` (Task 5).
- Produces:
  - `ApnLookupInput` gains `onLookupSuccess?: (result: { apn: string; assessor: AssessorSummary }) => void` and writes assessor provenance entries (`state: "prefilled"`, confidence 1) through `setMany` for every field it sets. Its `setValue` calls are unchanged (`{ shouldDirty: true }`), so the existing tests pass untouched.
  - `PrefillPanel({ inspectionId, form, initialRun? })` — draft-only toolbar (APN lookup + scan buttons) plus the tile; owns `usePrefill`; auto-starts a run with `trigger: "apn_lookup"` on lookup success; "Find records" starts a `manual` run.
  - `InspectionWizard` props gain `fieldProvenance?: FieldProvenance` and `prefillRun?: PrefillRunDTO | null`; wraps the form in `ProvenanceProvider` (`readOnly = status !== "draft"`) and renders `PrefillPanel` for drafts.
  - Edit page passes `fieldProvenance` from the row and `prefillRun` from `loadLatestRunDTO`.

- [ ] **Step 1: Write the failing tests**

`src/components/inspection/__tests__/apn-lookup-provenance.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApnLookupInput } from "@/components/inspection/apn-lookup-input";
import { ProvenanceProvider, useProvenance } from "@/components/prefill/provenance-context";
import { getDefaultFormValues } from "@/lib/validators/inspection";
import type { InspectionFormData } from "@/types/inspection";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const ASSESSOR = {
  ownerName: "John Smith",
  physicalAddress: "123 Main St",
  city: "Phoenix",
  zip: "85001",
  county: "Maricopa",
  apnFormatted: "123-45-678",
  legalDescription: "",
  lotSize: "",
  yearBuilt: "",
};

function Probe() {
  const { provenance } = useProvenance();
  return (
    <ul data-testid="probe">
      {Object.entries(provenance).map(([path, entry]) => (
        <li key={path}>{`${path}|${entry.source}|${entry.state}|${entry.confidence}|${entry.value}`}</li>
      ))}
    </ul>
  );
}

function Harness({ onLookupSuccess }: { onLookupSuccess?: (r: { apn: string }) => void }) {
  const form = useForm<InspectionFormData>({
    defaultValues: getDefaultFormValues("Tech") as unknown as InspectionFormData,
  });
  return (
    <ProvenanceProvider form={form} inspectionId="insp-1" initial={{}}>
      <ApnLookupInput form={form} onLookupSuccess={onLookupSuccess} />
      <Probe />
    </ProvenanceProvider>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ApnLookupInput provenance", () => {
  it("writes an assessor entry for every field it fills and reports success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ assessor: ASSESSOR }) }),
    );
    const onLookupSuccess = vi.fn();
    const user = userEvent.setup();
    render(<Harness onLookupSuccess={onLookupSuccess} />);

    await user.type(screen.getByLabelText("Assessor Parcel Number"), "123-45-678");
    await user.click(screen.getByRole("button", { name: /apn lookup/i }));

    await waitFor(() => {
      expect(screen.getByTestId("probe").children).toHaveLength(7);
    });
    expect(screen.getByText("facilityInfo.facilityName|assessor|prefilled|1|John Smith")).toBeInTheDocument();
    expect(screen.getByText("facilityInfo.taxParcelNumber|assessor|prefilled|1|123-45-678")).toBeInTheDocument();
    expect(onLookupSuccess).toHaveBeenCalledWith({ apn: "123-45-678", assessor: ASSESSOR });
  });

  it("does not write provenance or call onLookupSuccess when the lookup fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: "No property found" }) }),
    );
    const onLookupSuccess = vi.fn();
    const user = userEvent.setup();
    render(<Harness onLookupSuccess={onLookupSuccess} />);

    await user.type(screen.getByLabelText("Assessor Parcel Number"), "999-99-999");
    await user.click(screen.getByRole("button", { name: /apn lookup/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /apn lookup/i })).toBeEnabled();
    });
    expect(screen.getByTestId("probe").children).toHaveLength(0);
    expect(onLookupSuccess).not.toHaveBeenCalled();
  });
});
```

`src/components/prefill/__tests__/prefill-panel.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrefillPanel } from "@/components/prefill/prefill-panel";
import { ProvenanceProvider } from "@/components/prefill/provenance-context";
import { getDefaultFormValues } from "@/lib/validators/inspection";
import type { InspectionFormData } from "@/types/inspection";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/inspection/scan-form-button", () => ({
  ScanFormButton: () => <button type="button">Scan Paper Form</button>,
}));

const ASSESSOR = {
  ownerName: "John Smith",
  physicalAddress: "123 Main St",
  city: "Phoenix",
  zip: "85001",
  county: "Maricopa",
  apnFormatted: "123-45-678",
  legalDescription: "",
  lotSize: "",
  yearBuilt: "",
};

function Harness() {
  const form = useForm<InspectionFormData>({
    defaultValues: getDefaultFormValues("Tech") as unknown as InspectionFormData,
  });
  return (
    <ProvenanceProvider form={form} inspectionId="insp-1" initial={{}}>
      <PrefillPanel inspectionId="insp-1" form={form} initialRun={null} />
    </ProvenanceProvider>
  );
}

function installFetch() {
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (url.startsWith("/api/apn-lookup")) {
      return { ok: true, status: 200, json: () => Promise.resolve({ assessor: ASSESSOR }) };
    }
    if (method === "POST" && url === "/api/inspections/insp-1/prefill") {
      return { ok: true, status: 201, json: () => Promise.resolve({ runId: "run-1" }) };
    }
    if (method === "GET" && url === "/api/inspections/insp-1/prefill/run-1") {
      return {
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            id: "run-1",
            inspectionId: "insp-1",
            trigger: "apn_lookup",
            status: "running",
            input: {},
            stages: {
              assessor: { status: "running", links: [] },
              listing: { status: "pending", links: [] },
              permits: { status: "pending", links: [] },
            },
            proposals: [],
            candidates: [],
            error: null,
            appliedAt: null,
            createdAt: "2026-09-11T10:00:00.000Z",
            finishedAt: null,
            records: [],
          }),
      };
    }
    return { ok: false, status: 404, json: () => Promise.resolve({ error: "no route" }) };
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PrefillPanel", () => {
  it("renders the toolbar and the tile", () => {
    installFetch();
    render(<Harness />);
    expect(screen.getByLabelText("Assessor Parcel Number")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /scan paper form/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /find records/i })).toBeInTheDocument();
  });

  it("auto-starts an apn_lookup run after a successful APN lookup", async () => {
    const mock = installFetch();
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByLabelText("Assessor Parcel Number"), "123-45-678");
    await user.click(screen.getByRole("button", { name: /apn lookup/i }));

    await waitFor(() => {
      const post = mock.mock.calls.find(
        ([url, init]) => init?.method === "POST" && url === "/api/inspections/insp-1/prefill",
      );
      expect(post).toBeDefined();
      expect(JSON.parse(String(post?.[1]?.body))).toEqual({ apn: "123-45-678", trigger: "apn_lookup" });
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /searching/i })).toBeDisabled();
    });
  });

  it("Find records starts a manual run", async () => {
    const mock = installFetch();
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /find records/i }));
    await waitFor(() => {
      const post = mock.mock.calls.find(
        ([url, init]) => init?.method === "POST" && url === "/api/inspections/insp-1/prefill",
      );
      expect(JSON.parse(String(post?.[1]?.body))).toEqual({ trigger: "manual" });
    });
  });
});
```

`src/components/inspection/__tests__/inspection-wizard-provenance.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProvenanceEntry } from "@/lib/prefill/types";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/hooks/use-auto-save", () => ({ useAutoSave: () => ({ saving: false, lastSaved: null }) }));

// Step 0 doubles as a probe for the provenance context the wizard provides
vi.mock("@/components/inspection/step-facility-info", async () => {
  const { useProvenance } = await import("@/components/prefill/provenance-context");
  return {
    StepFacilityInfo: () => {
      const { provenance, readOnly } = useProvenance();
      return (
        <div data-testid="step-0" data-readonly={String(readOnly)}>
          {Object.keys(provenance).join(",")}
        </div>
      );
    },
  };
});
vi.mock("@/components/inspection/step-general-treatment", () => ({ StepGeneralTreatment: () => <div /> }));
vi.mock("@/components/inspection/step-design-flow", () => ({ StepDesignFlow: () => <div /> }));
vi.mock("@/components/inspection/step-septic-tank", () => ({ StepSepticTank: () => <div /> }));
vi.mock("@/components/inspection/step-disposal-works", () => ({ StepDisposalWorks: () => <div /> }));
vi.mock("@/components/inspection/step-alternative-system", () => ({ StepAlternativeSystem: () => <div /> }));
vi.mock("@/components/prefill/prefill-panel", () => ({
  PrefillPanel: ({ inspectionId }: { inspectionId: string }) => (
    <div data-testid="prefill-panel">{inspectionId}</div>
  ),
}));

import { InspectionWizard } from "@/components/inspection/inspection-wizard";

const ENTRY: ProvenanceEntry = {
  source: "assessor",
  state: "prefilled",
  kind: "fill",
  value: "JOHN DOE",
  confidence: 1,
  explanation: "Maricopa County Assessor · parcel 219-11-121",
  at: "2026-09-11T10:00:00.000Z",
};

describe("InspectionWizard provenance wiring", () => {
  it("provides the loaded provenance to the steps and renders the prefill panel for drafts", () => {
    render(
      <InspectionWizard
        inspection={{
          id: "insp-1",
          formData: null,
          status: "draft",
          fieldProvenance: { "facilityInfo.facilityName": ENTRY },
          prefillRun: null,
        }}
      />,
    );
    expect(screen.getByTestId("step-0")).toHaveTextContent("facilityInfo.facilityName");
    expect(screen.getByTestId("step-0")).toHaveAttribute("data-readonly", "false");
    expect(screen.getByTestId("prefill-panel")).toHaveTextContent("insp-1");
  });

  it("is read-only and hides the panel on non-drafts", () => {
    render(
      <InspectionWizard
        inspection={{
          id: "insp-1",
          formData: null,
          status: "submitted",
          fieldProvenance: { "facilityInfo.facilityName": ENTRY },
        }}
      />,
    );
    expect(screen.getByTestId("step-0")).toHaveAttribute("data-readonly", "true");
    expect(screen.queryByTestId("prefill-panel")).toBeNull();
  });

  it("defaults to an empty map when no provenance is passed", () => {
    render(<InspectionWizard inspection={{ id: "insp-1", formData: null, status: "draft" }} />);
    expect(screen.getByTestId("step-0")).toHaveTextContent("");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/inspection/__tests__/apn-lookup-provenance.test.tsx src/components/prefill/__tests__/prefill-panel.test.tsx src/components/inspection/__tests__/inspection-wizard-provenance.test.tsx`
Expected: FAIL — probe has 0 entries / `onLookupSuccess` not called; unresolved `prefill-panel`; `step-0` has no provenance.

- [ ] **Step 3: Update `ApnLookupInput`**

Replace the whole of `src/components/inspection/apn-lookup-input.tsx` with:

```tsx
"use client";

import { Search, Loader2 } from "lucide-react";
import { useState } from "react";
import type { FieldPath, UseFormReturn } from "react-hook-form";
import { toast } from "sonner";
import { useProvenance } from "@/components/prefill/provenance-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type AssessorSummary, assessorProposals } from "@/lib/prefill/assessor-fields";
import type { FieldProvenance } from "@/lib/prefill/types";
import type { InspectionFormData } from "@/types/inspection";

interface ApnLookupInputProps {
  form: UseFormReturn<InspectionFormData>;
  /** Fired after the form has been filled — the prefill panel starts a run from here */
  onLookupSuccess?: (result: { apn: string; assessor: AssessorSummary }) => void;
}

export function ApnLookupInput({ form, onLookupSuccess }: ApnLookupInputProps) {
  const [apn, setApn] = useState("");
  const [loading, setLoading] = useState(false);
  const { setMany } = useProvenance();

  const handleLookup = async () => {
    if (loading) return;
    const trimmed = apn.trim();
    if (!trimmed) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/apn-lookup?apn=${encodeURIComponent(trimmed)}`);

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "APN lookup failed");
        return;
      }

      const { assessor: a } = (await res.json()) as { assessor: AssessorSummary };
      const apnUsed = a.apnFormatted || trimmed;

      // The same seven fields the assessor prefill stage proposes — an explicit
      // lookup overwrites, and every written field gets an assessor badge.
      const at = new Date().toISOString();
      const entries: FieldProvenance = {};
      for (const proposal of assessorProposals(a, apnUsed)) {
        form.setValue(proposal.fieldPath as FieldPath<InspectionFormData>, proposal.value as never, {
          shouldDirty: true,
        });
        entries[proposal.fieldPath] = {
          ...proposal.provenance,
          kind: proposal.kind,
          state: "prefilled",
          value: proposal.value,
          at,
        };
      }
      setMany(entries);

      toast.success("Property data loaded from APN");
      onLookupSuccess?.({ apn: apnUsed, assessor: a });
    } catch {
      toast.error("APN lookup failed — try again");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Input
        type="text"
        aria-label="Assessor Parcel Number"
        placeholder="APN (e.g. 123-45-678)"
        value={apn}
        onChange={(e) => setApn(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            handleLookup();
          }
        }}
        className="w-44 h-9 text-sm"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleLookup}
        disabled={loading || !apn.trim()}
        className="gap-2"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Search className="h-4 w-4" />
        )}
        APN Lookup
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Create `PrefillPanel`**

`src/components/prefill/prefill-panel.tsx`:

```tsx
"use client";

import type { UseFormReturn } from "react-hook-form";
import { ApnLookupInput } from "@/components/inspection/apn-lookup-input";
import { ScanFormButton } from "@/components/inspection/scan-form-button";
import type { PrefillRunDTO } from "@/lib/prefill/types";
import type { InspectionFormData } from "@/types/inspection";
import { PrefillSourcesTile } from "./prefill-sources-tile";
import { usePrefill } from "./use-prefill";

interface PrefillPanelProps {
  inspectionId: string;
  form: UseFormReturn<InspectionFormData>;
  /** Server-loaded latest run (null when none) */
  initialRun?: PrefillRunDTO | null;
}

/**
 * Draft-only toolbar (APN lookup + scan) and the Prefill sources tile.
 * Owns the prefill run via usePrefill, so it must render inside ProvenanceProvider.
 */
export function PrefillPanel({ inspectionId, form, initialRun }: PrefillPanelProps) {
  const prefill = usePrefill({ inspectionId, form, enabled: true, initialRun });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <ApnLookupInput
          form={form}
          onLookupSuccess={({ apn }) => {
            void prefill.start({ apn, trigger: "apn_lookup" });
          }}
        />
        <ScanFormButton inspectionId={inspectionId} form={form} />
      </div>
      <PrefillSourcesTile
        run={prefill.run}
        isRunning={prefill.isRunning}
        canRun
        error={prefill.error}
        onFindRecords={() => {
          void prefill.start({ trigger: "manual" });
        }}
      />
    </div>
  );
}
```

- [ ] **Step 5: Wire the wizard**

In `src/components/inspection/inspection-wizard.tsx`:

(a) Replace the two imports `ApnLookupInput` and `ScanFormButton` with:

```ts
import { PrefillPanel } from "@/components/prefill/prefill-panel";
import { ProvenanceProvider } from "@/components/prefill/provenance-context";
```

and add after the `STEP_LABELS` import:

```ts
import type { FieldProvenance, PrefillRunDTO } from "@/lib/prefill/types";
```

(b) Replace the props interface with:

```ts
interface InspectionWizardProps {
  inspection: {
    id: string;
    formData: InspectionFormData | null;
    status: string;
    reviewNotes?: string | null;
    /** Per-field prefill provenance sidecar (inspections.field_provenance) */
    fieldProvenance?: FieldProvenance;
    /** Latest prefill run, loaded server-side so the tile renders without a fetch */
    prefillRun?: PrefillRunDTO | null;
  };
}
```

(c) Replace the returned JSX's outer structure. The old:

```tsx
  return (
    <Form {...form}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-6 pb-4">
        {inspection.reviewNotes && <ReviewNoteBanner note={inspection.reviewNotes} />}

        {inspection.status === "draft" && (
          <div className="flex flex-wrap items-center justify-end gap-3">
            <ApnLookupInput form={form} />
            <ScanFormButton inspectionId={inspection.id} form={form} />
          </div>
        )}
```

becomes:

```tsx
  return (
    <Form {...form}>
      <ProvenanceProvider
        form={form}
        inspectionId={inspection.id}
        initial={inspection.fieldProvenance ?? {}}
        readOnly={inspection.status !== "draft"}
      >
      <form onSubmit={handleSubmit} className="flex flex-col gap-6 pb-4">
        {inspection.reviewNotes && <ReviewNoteBanner note={inspection.reviewNotes} />}

        {inspection.status === "draft" && (
          <PrefillPanel
            inspectionId={inspection.id}
            form={form}
            initialRun={inspection.prefillRun}
          />
        )}
```

and the closing of the component, old:

```tsx
        />
      </form>
    </Form>
  );
}
```

becomes:

```tsx
        />
      </form>
      </ProvenanceProvider>
    </Form>
  );
}
```

Everything between (`WizardProgress`, the step card, `WizardNavigation`) is unchanged.

- [ ] **Step 6: Load provenance and the latest run on the edit page**

In `src/app/(dashboard)/inspections/[id]/edit/page.tsx`, add the imports:

```ts
import { loadLatestRunDTO } from "@/lib/prefill/run-dto";
import type { FieldProvenance } from "@/lib/prefill/types";
```

and replace the final `return` with:

```tsx
  const prefillRun = await loadLatestRunDTO(inspection.id);

  return (
    <div className="mx-auto max-w-3xl">
      <InspectionWizard
        inspection={{
          id: inspection.id,
          formData: inspection.formData as InspectionFormData | null,
          status: inspection.status,
          reviewNotes: inspection.reviewNotes,
          fieldProvenance: (inspection.fieldProvenance ?? {}) as FieldProvenance,
          prefillRun,
        }}
      />
    </div>
  );
```

- [ ] **Step 7: Run the new tests plus the existing APN-input suite**

Run: `npx vitest run src/components/inspection/__tests__/apn-lookup-provenance.test.tsx src/components/prefill/__tests__/prefill-panel.test.tsx src/components/inspection/__tests__/inspection-wizard-provenance.test.tsx src/components/inspection/__tests__/apn-lookup-input.test.tsx`
Expected: PASS — 2 + 3 + 3 new tests and all 15 existing APN-input tests.

- [ ] **Step 8: Commit**

```bash
git add src/components/inspection/apn-lookup-input.tsx src/components/prefill/prefill-panel.tsx src/components/inspection/inspection-wizard.tsx "src/app/(dashboard)/inspections/[id]/edit/page.tsx" src/components/inspection/__tests__/apn-lookup-provenance.test.tsx src/components/prefill/__tests__/prefill-panel.test.tsx src/components/inspection/__tests__/inspection-wizard-provenance.test.tsx
git commit -m "feat(prefill): wire ProvenanceProvider + PrefillPanel into the wizard; APN lookup writes assessor provenance and auto-starts a run"
```

---

### Task 15: Scan flow writes `source: "scan"` provenance

**Files:**
- Modify: `src/hooks/use-form-scan.ts` (`UseFormScanReturn.applyFields`, `applyFields` implementation, imports)
- Modify: `src/components/inspection/scan-review-modal.tsx` (`handleApply`, imports)
- Test: `src/hooks/__tests__/use-form-scan-provenance.test.ts`
- Test: `src/components/inspection/__tests__/scan-review-modal-provenance.test.tsx`
- Existing tests that must stay green: `src/hooks/__tests__/use-form-scan.test.ts`, `src/components/inspection/__tests__/scan-review-modal.test.tsx`

**Interfaces:**
- Consumes: `normalizeFieldPath` (Task 2); `useProvenance` (Task 9); `FieldProvenance` (Task 1).
- Produces: `applyFields(form, onProvenance?: (entries: FieldProvenance) => void)` — after applying, calls `onProvenance` with one `{ source: "scan", state: "prefilled", kind: "fill", value, confidence, explanation: "Scanned form · <field.source>", at }` entry per applied field, keyed by the normalised path (`septicTank.tanks.0.tankCapacity`). The modal passes the provider's `setMany`.

- [ ] **Step 1: Write the failing tests**

`src/hooks/__tests__/use-form-scan-provenance.test.ts`:

```ts
import { act, renderHook } from "@testing-library/react";
import type { UseFormReturn } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useFormScan } from "@/hooks/use-form-scan";
import type { ScanResult } from "@/lib/ai/scan-types";
import type { FieldProvenance } from "@/lib/prefill/types";
import type { InspectionFormData } from "@/types/inspection";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const SCAN: ScanResult = {
  fields: [
    { fieldPath: "facilityInfo.facilityName", value: "Test Facility", confidence: 0.95, source: "Page 1, Facility Information" },
    { fieldPath: "facilityInfo.facilityAddress", value: "123 Main St", confidence: 0.5, source: "Page 1" },
    { fieldPath: "septicTank.tanks[0].tankCapacity", value: "1000", confidence: 0.9, source: "Page 2, Section 4E" },
  ],
  metadata: { pagesProcessed: 2, totalFieldsExtracted: 3, processingTimeMs: 1200 },
};

const makeMockForm = () =>
  ({
    setValue: vi.fn(),
    getValues: vi.fn().mockReturnValue([]),
  }) as unknown as UseFormReturn<InspectionFormData>;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useFormScan.applyFields provenance", () => {
  it("reports a scan entry for every applied field, keyed by the normalised path", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(SCAN) }));
    const { result } = renderHook(() => useFormScan());
    const form = makeMockForm();
    const onProvenance = vi.fn<(entries: FieldProvenance) => void>();

    act(() => result.current.addUploadedImage({ storagePath: "a.jpg", previewUrl: "blob:a", fileName: "a.jpg" }));
    await act(() => result.current.startScan("insp-1"));
    // auto-selected: facilityName (0.95) and tanks[0].tankCapacity (0.9); address (0.5) is not
    act(() => result.current.applyFields(form, onProvenance));

    expect(onProvenance).toHaveBeenCalledTimes(1);
    const entries = onProvenance.mock.calls[0][0];
    expect(Object.keys(entries).sort()).toEqual([
      "facilityInfo.facilityName",
      "septicTank.tanks.0.tankCapacity",
    ]);
    expect(entries["facilityInfo.facilityName"]).toMatchObject({
      source: "scan",
      state: "prefilled",
      kind: "fill",
      value: "Test Facility",
      confidence: 0.95,
      explanation: "Scanned form · Page 1, Facility Information",
    });
    expect(entries["septicTank.tanks.0.tankCapacity"]).toMatchObject({
      value: "1000",
      confidence: 0.9,
      explanation: "Scanned form · Page 2, Section 4E",
    });
    expect(Date.parse(entries["facilityInfo.facilityName"].at)).not.toBeNaN();
  });

  it("still works without an onProvenance callback", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(SCAN) }));
    const { result } = renderHook(() => useFormScan());
    const form = makeMockForm();
    act(() => result.current.addUploadedImage({ storagePath: "a.jpg", previewUrl: "blob:a", fileName: "a.jpg" }));
    await act(() => result.current.startScan("insp-1"));
    expect(() => act(() => result.current.applyFields(form))).not.toThrow();
    expect(form.setValue).toHaveBeenCalled();
  });
});
```

`src/components/inspection/__tests__/scan-review-modal-provenance.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as React from "react";
import { type UseFormReturn, useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScanReviewModal } from "@/components/inspection/scan-review-modal";
import { ProvenanceProvider, useProvenance } from "@/components/prefill/provenance-context";
import type { UseFormScanReturn } from "@/hooks/use-form-scan";
import { getDefaultFormValues } from "@/lib/validators/inspection";
import type { InspectionFormData } from "@/types/inspection";

vi.mock("@/components/inspection/scan-upload-zone", () => ({
  ScanUploadZone: () => <div data-testid="scan-upload-zone">Upload Zone</div>,
}));

function Probe() {
  const { provenance } = useProvenance();
  return <div data-testid="probe">{Object.keys(provenance).join(",")}</div>;
}

function Harness({
  children,
}: {
  children: (form: UseFormReturn<InspectionFormData>) => React.ReactNode;
}) {
  const form = useForm<InspectionFormData>({
    defaultValues: getDefaultFormValues("Tech") as unknown as InspectionFormData,
  });
  return (
    <ProvenanceProvider form={form} inspectionId="insp-1" initial={{}}>
      {children(form)}
      <Probe />
    </ProvenanceProvider>
  );
}

function makeScan(): UseFormScanReturn {
  return {
    state: "reviewing",
    setState: vi.fn(),
    uploadedImages: [],
    scanResult: {
      fields: [
        { fieldPath: "facilityInfo.facilityName", value: "Test Facility", confidence: 0.95, source: "Page 1" },
      ],
      metadata: { pagesProcessed: 1, totalFieldsExtracted: 1, processingTimeMs: 900 },
    },
    selectedFields: new Set(["facilityInfo.facilityName"]),
    error: null,
    addUploadedImage: vi.fn(),
    removeUploadedImage: vi.fn(),
    startScan: vi.fn(),
    toggleField: vi.fn(),
    selectAllHighConfidence: vi.fn(),
    clearAllSelections: vi.fn(),
    // Real-ish applyFields: forwards the provider's setMany like the hook does
    applyFields: vi.fn((_form, onProvenance) => {
      onProvenance?.({
        "facilityInfo.facilityName": {
          source: "scan",
          state: "prefilled",
          kind: "fill",
          value: "Test Facility",
          confidence: 0.95,
          explanation: "Scanned form · Page 1",
          at: "2026-09-11T10:00:00.000Z",
        },
      });
    }),
    reset: vi.fn(),
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ScanReviewModal provenance", () => {
  it("passes the provider's setMany into applyFields so scanned fields get badges", async () => {
    const user = userEvent.setup();
    const scan = makeScan();
    render(
      <Harness>
        {(form) => (
          <ScanReviewModal open onOpenChange={vi.fn()} inspectionId="insp-1" form={form} scan={scan} />
        )}
      </Harness>,
    );

    await user.click(screen.getByRole("button", { name: /apply 1 field/i }));

    expect(scan.applyFields).toHaveBeenCalledWith(expect.anything(), expect.any(Function));
    expect(screen.getByTestId("probe")).toHaveTextContent("facilityInfo.facilityName");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/hooks/__tests__/use-form-scan-provenance.test.ts src/components/inspection/__tests__/scan-review-modal-provenance.test.tsx`
Expected: FAIL — `onProvenance` never called; `applyFields` called with one argument.

- [ ] **Step 3: Update `use-form-scan.ts`**

Add the imports after `import { AUTO_SELECT_CONFIDENCE } from "@/lib/ai/scan-types";`:

```ts
import { normalizeFieldPath } from "@/lib/prefill/merge";
import type { FieldProvenance } from "@/lib/prefill/types";
```

Change the interface member:

```ts
  applyFields: (
    form: UseFormReturn<InspectionFormData>,
    onProvenance?: (entries: FieldProvenance) => void,
  ) => void;
```

Replace the `applyFields` implementation with:

```ts
  const applyFields = useCallback(
    (form: UseFormReturn<InspectionFormData>, onProvenance?: (entries: FieldProvenance) => void) => {
      if (!scanResult) return;

      let appliedCount = 0;
      const entries: FieldProvenance = {};
      const at = new Date().toISOString();

      for (const field of scanResult.fields) {
        if (!selectedFields.has(field.fieldPath)) continue;

        // Handle tank array fields: septicTank.tanks[0].fieldName
        const tankMatch = field.fieldPath.match(/^septicTank\.tanks\[(\d+)\]\.(\w+)$/);
        if (tankMatch) {
          const tankIndex = Number.parseInt(tankMatch[1], 10);
          const tankField = tankMatch[2];
          const currentTanks = form.getValues("septicTank.tanks") ?? [];

          // Ensure the tanks array is long enough
          while (currentTanks.length <= tankIndex) {
            currentTanks.push({} as (typeof currentTanks)[0]);
          }

          // Set the field value on the tank object
          // biome-ignore lint/suspicious/noExplicitAny: Dynamic form path
          (currentTanks[tankIndex] as any)[tankField] = field.value;
          form.setValue("septicTank.tanks", currentTanks, {
            shouldDirty: true,
          });
        } else {
          // Standard dotted path (e.g., "facilityInfo.facilityName")
          // biome-ignore lint/suspicious/noExplicitAny: Dynamic form path
          form.setValue(field.fieldPath as any, field.value as any, {
            shouldDirty: true,
            shouldValidate: true,
          });
        }

        appliedCount++;
        // Scanned values join the provenance system as source "scan" (green badge)
        entries[normalizeFieldPath(field.fieldPath)] = {
          source: "scan",
          state: "prefilled",
          kind: "fill",
          value: field.value,
          confidence: field.confidence,
          explanation: `Scanned form · ${field.source}`,
          at,
        };
      }

      onProvenance?.(entries);
      toast.success(`${appliedCount} field${appliedCount === 1 ? "" : "s"} applied from scan`);
      setState("done");
    },
    [scanResult, selectedFields],
  );
```

- [ ] **Step 4: Update the modal**

In `src/components/inspection/scan-review-modal.tsx`, add the import after the `Button` import:

```ts
import { useProvenance } from "@/components/prefill/provenance-context";
```

Inside `ScanReviewModal`, after the destructuring of `scan`, add:

```ts
  const { setMany } = useProvenance();
```

and replace `handleApply`:

```ts
  const handleApply = () => {
    applyFields(form, setMany);
    onOpenChange(false);
    setTimeout(reset, 300);
  };
```

- [ ] **Step 5: Run the new and the existing scan suites**

Run: `npx vitest run src/hooks/__tests__/use-form-scan-provenance.test.ts src/components/inspection/__tests__/scan-review-modal-provenance.test.tsx src/hooks/__tests__/use-form-scan.test.ts src/components/inspection/__tests__/scan-review-modal.test.tsx src/components/inspection/__tests__/scan-form-button.test.tsx`
Expected: PASS — the new tests and every existing scan test (the added optional argument and the no-op context leave them unaffected).

- [ ] **Step 6: Commit**

```bash
git add src/hooks/use-form-scan.ts src/components/inspection/scan-review-modal.tsx src/hooks/__tests__/use-form-scan-provenance.test.ts src/components/inspection/__tests__/scan-review-modal-provenance.test.tsx
git commit -m "feat(prefill): scan flow writes source=scan provenance entries"
```

---

### Task 16: Apply migration 0015 remotely, verify, full build + test gate, live smoke

**Files:**
- Create: `scripts/apply-prefill-migration.mjs`
- Create (local only, git-ignored): `.env.local`

**Interfaces:**
- Consumes: the migration from Task 3; `DATABASE_URL` / `DIRECT_URL` from Vercel.
- Produces: the remote schema; a green `npm run build`; a vitest run with no new failures; a manual end-to-end check of the badge/tile flow.

- [ ] **Step 1: Write the apply-and-verify script**

`scripts/apply-prefill-migration.mjs` (modelled on `scripts/apply-job-activity-migration.mjs`):

```js
#!/usr/bin/env node
// Apply src/lib/db/migrations/0015_prefill_runs_records_provenance.sql to the remote DB.
// Usage: node --env-file=.env.local scripts/apply-prefill-migration.mjs

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!connectionString) {
  console.error("Missing DATABASE_URL (or DIRECT_URL) in .env.local");
  process.exit(1);
}

const migrationPath = path.join(
  repoRoot,
  "src/lib/db/migrations/0015_prefill_runs_records_provenance.sql",
);
const sql = await readFile(migrationPath, "utf8");

const client = postgres(connectionString, { prepare: false, max: 1 });

async function expectColumns(table, expected) {
  const cols = await client`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}
    ORDER BY ordinal_position
  `;
  if (cols.length === 0) {
    console.error(`FAIL: ${table} table not found`);
    process.exit(2);
  }
  for (const name of expected) {
    if (!cols.find((c) => c.column_name === name)) {
      console.error(`FAIL: ${table} missing column ${name}`);
      process.exit(2);
    }
  }
  console.log(`  ✓ ${table} has ${cols.length} columns (all ${expected.length} expected present)`);
}

async function expectIndex(table, indexName) {
  const idx = await client`
    SELECT indexname FROM pg_indexes WHERE tablename = ${table} AND indexname = ${indexName}
  `;
  if (idx.length === 0) {
    console.error(`FAIL: missing index ${indexName}`);
    process.exit(2);
  }
  console.log(`  ✓ ${indexName}`);
}

async function expectPolicies(table, minimum) {
  const policies = await client`
    SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = ${table}
  `;
  if (policies.length < minimum) {
    console.error(`FAIL: expected ≥${minimum} RLS policies on ${table}, found ${policies.length}`);
    process.exit(2);
  }
  console.log(`  ✓ ${policies.length} RLS ${policies.length === 1 ? "policy" : "policies"} on ${table}`);
}

try {
  console.log("Applying 0015_prefill_runs_records_provenance.sql …");
  await client.unsafe(sql);
  console.log("Migration applied cleanly.\n");

  const provenance = await client`
    SELECT data_type, is_nullable, column_default FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'inspections' AND column_name = 'field_provenance'
  `;
  if (provenance.length === 0 || provenance[0].data_type !== "jsonb" || provenance[0].is_nullable !== "NO") {
    console.error("FAIL: inspections.field_provenance missing or not `jsonb NOT NULL`", provenance);
    process.exit(2);
  }
  console.log("  ✓ inspections.field_provenance jsonb NOT NULL default", provenance[0].column_default);

  await expectColumns("inspection_prefill_runs", [
    "id", "inspection_id", "trigger", "status", "input", "stages", "proposals", "candidates",
    "error", "applied_at", "created_by", "created_at", "finished_at",
  ]);
  await expectColumns("inspection_records", [
    "id", "inspection_id", "run_id", "source", "permit_number", "doc_type", "doc_date",
    "description", "page_count", "size_bytes", "storage_path", "selected", "extraction_status",
    "extraction_error", "extracted", "created_at",
  ]);
  await expectIndex("inspection_prefill_runs", "inspection_prefill_runs_inspection_created_idx");
  await expectIndex("inspection_records", "inspection_records_inspection_idx");
  await expectPolicies("inspection_prefill_runs", 1);
  await expectPolicies("inspection_records", 1);

  console.log("\nVerification passed — migration applied and healthy.");
} catch (err) {
  console.error("\nMIGRATION FAILED:");
  console.error(err);
  process.exit(1);
} finally {
  await client.end({ timeout: 5 });
}
```

- [ ] **Step 2: Pull the environment and apply the migration**

Run:

```bash
test -f .env.local || npx vercel env pull .env.local
grep -c "DATABASE_URL" .env.local
node --env-file=.env.local scripts/apply-prefill-migration.mjs
```

Expected output ends with:

```
  ✓ inspections.field_provenance jsonb NOT NULL default '{}'::jsonb
  ✓ inspection_prefill_runs has 13 columns (all 13 expected present)
  ✓ inspection_records has 16 columns (all 16 expected present)
  ✓ inspection_prefill_runs_inspection_created_idx
  ✓ inspection_records_inspection_idx
  ✓ 1 policy on inspection_prefill_runs
  ✓ 1 policy on inspection_records

Verification passed — migration applied and healthy.
```

If the pooler URL fails to connect (IPv6-only direct endpoint), confirm `DATABASE_URL` in `.env.local` is the `aws-0-<region>.pooler.supabase.com:6543` URL; the script already prefers `DIRECT_URL` when present. The migration is idempotent (`IF NOT EXISTS` / `DROP POLICY IF EXISTS`) — re-run it after fixing connectivity.

- [ ] **Step 3: Independent verification query**

Run:

```bash
node --env-file=.env.local -e "
import('postgres').then(async ({ default: postgres }) => {
  const c = postgres(process.env.DIRECT_URL || process.env.DATABASE_URL, { prepare: false, max: 1 });
  const rows = await c\`SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema='public' AND (
      (table_name='inspections' AND column_name='field_provenance') OR
      table_name IN ('inspection_prefill_runs','inspection_records')
    ) ORDER BY table_name, ordinal_position\`;
  console.log(rows.map(r => r.table_name + '.' + r.column_name).join('\n'));
  await c.end();
});
"
```

Expected: 30 lines — `inspection_prefill_runs.*` (13), `inspection_records.*` (16), `inspections.field_provenance` (1).

- [ ] **Step 4: Type gate — production build**

Run:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co \
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=placeholder \
NEXT_PUBLIC_APP_URL=http://localhost:3000 \
npm run build
```

Expected: `✓ Compiled successfully` and the route list includes `/api/inspections/[id]/provenance`, `/api/inspections/[id]/prefill`, `/api/inspections/[id]/prefill/latest`, `/api/inspections/[id]/prefill/[runId]`, `/api/inspections/[id]/prefill/[runId]/applied`, `/api/inspections/[id]/prefill/[runId]/select`. Any TypeScript error printed here is in code from this plan — fix it in place (do not touch the pre-existing `tsc --noEmit` noise, which the build does not surface).

- [ ] **Step 5: Full test run — acceptance bar**

Run:

```bash
npx vitest run 2>&1 | tail -40
npx vitest run 2>&1 | grep -E "^ (FAIL|❯) " | sort > /tmp/vitest-after.txt
diff /tmp/vitest-baseline.txt /tmp/vitest-after.txt && echo "NO NEW FAILING FILES"
```

Expected: every new test file from Tasks 1–15 passes, and `diff` prints nothing but `NO NEW FAILING FILES`. **Acceptance bar: no new failures versus the ~15 pre-existing ones** captured in `/tmp/vitest-baseline.txt` before Task 1 (see "Before you start" in the header; they live in nav/roles/rbac, review-actions, reopen/download routes, inspection.test STEP_FIELDS + tank schema). If the baseline file is missing, produce it from a second worktree of the pre-plan commit — `git worktree add /tmp/prefill-baseline de3d3bc`, symlink `node_modules` into it, run the same grep there — never with `git stash`.

- [ ] **Step 6: Live smoke of the user-visible flow**

`.env.local` points at the production Supabase project, so use a throwaway draft. Start the dev server (clean first per the repo rules), then in a browser (Playwright MCP / chrome-devtools MCP, or by hand):

```bash
rm -rf .next; lsof -ti :3000 | xargs -r kill; npm run dev
```

1. Log in, create a new inspection (draft), open its edit page.
2. Expect the **Prefill sources** tile above step 1 with intro copy and an enabled **Find records** button.
3. Enter APN `219-11-121` in the APN box and run **APN Lookup**. Expect: owner/address/city/zip/county/APN fields fill; each of those labels now shows a blue `100%` badge; the tile flips to **Searching…** and within ~5 s shows `Assessor · Parcel 219-11-121 · 8911 E CAVE CREEK RD` with an **Assessor parcel page** link, `Listing · Not available yet`, `Permits · Not available yet`, and a **Last run** timestamp.
4. Tap a badge: popover shows "County Assessor", the explanation, evidence, an **Open source** link to `https://mcassessor.maricopa.gov/mcs/?q=219-11-121` (opens in a new tab), Verify / Clear. Tap **Verify** → badge reads `verified` with a checkmark. Edit the Facility name field → its badge turns grey `edited`.
5. Reload the page. Expect the badges (verified / edited states included) and the tile's last run to persist — this proves the provenance PATCH and `GET prefill/latest` round-trip.
6. Click **Find records** three more times quickly: the 2nd click while running shows `A prefill run is already in progress`; once the hourly count reaches 3, the tile shows `Prefill limit reached (3 per hour)`.
7. Scan flow: open **Scan Paper Form**, upload a page, apply fields → applied fields get green badges (`Scanned form`).
8. Delete the throwaway inspection.

Record what you saw (screenshots or the console/network log) in the PR description; if any step deviates, fix the code and re-run from step 1 of this smoke.

- [ ] **Step 7: Commit the script**

```bash
git add scripts/apply-prefill-migration.mjs
git commit -m "chore(db): apply/verify script for migration 0015 (prefill runs, records, provenance)"
```

`.env.local` is already ignored — confirm with `git status --short | grep -c env.local` → `0`.

- [ ] **Step 8: Hand off**

Push the feature branch (`git push -u origin feature/property-records-prefill`) and open the phase-1 PR against `main`. Do **not** merge or deploy: production deploys need Daniel's explicit per-deploy approval. The PR body should list: the migration (already applied remotely, verified), the six new routes, the new `field_provenance` column, the smoke results from Step 6, and the known gaps below.

---

## Self-Review

### 1. Spec coverage (phase 1 = spec §13 item 1)

| Spec requirement | Task |
|---|---|
| §4 migration 0015 — `field_provenance`, `inspection_prefill_runs`, `inspection_records`, indexes, RLS | 3, applied in 16 |
| §4 `ProvenanceEntry` / `FieldProvenance` types stored outside `form_data`; dedicated PATCH route, whole-map replace, validated | 1 (types + zod), 6 (route) |
| §4 rate limit DB-backed, 3/hour; lock 409 with stale-run timeout | 5 (`countRunsInLastHour`, `failStaleRuns`, `findActiveRun`), 7 |
| §5.1 assessor stage wrapping the ArcGIS query; `findParcelByAddress`; provenance confidence 1.0 with parcel link; URL pattern verified | 4 (verified live: field names + URL 200) |
| §7 merge rules (warning → suggested; ≥0.75 into empty → fill; verified/edited protection; higher-confidence replacement) | 2 |
| §7 scan flow writes `source: "scan"` entries with scan confidence and `source` description | 15 |
| §8 routes: POST prefill (201/400/409/429, `after()`, `maxDuration`), GET `[runId]`, POST select (409 in phase 1), POST applied, PATCH provenance, GET latest | 7, 8, 6 |
| §8 client hook: start, 2 s polling, merge on `done` + unapplied, `setValue` fills, provenance update, POST applied, apply-on-mount | 13 |
| §9 `ProvenanceProvider` with verify/clear/accept/dismiss and `form.watch` edit detection; 1 s debounced persistence; no-op when readOnly | 9 |
| §9 `FormLabel` → badge, `FormItem` → chip, no per-field changes | 11 |
| §9 badge: dot + `%`, grey edited, checkmark verified, colour tokens in `sources.ts`, radix Popover from `radix-ui`, tap to open | 1, 9 (popover), 10 |
| §9 tile: rows with status/summary/links, red abandonment banner, Find records (disabled while running; shows the limit message), last-run timestamp; not-found copy from the stage summary; "Prefill failed — Find records to retry" | 12 |
| §9 accessibility: badge is a `<button aria-label="Prefilled from …, NN% confidence">`, chips are buttons, text always present | 10 (tested) |
| §2.1 trigger: auto-start after APN lookup success; manual Find records | 14 |
| §10 failure handling for the assessor stage (error stage, run still done; run crash → failed) | 4, 5 |
| §11 security: APN/address validated before the `where` clause; `sourceUrl` restricted to https:///api/; auth matrix tests on every route | 4, 1, 6–8 |
| §12 unit/route/component tests; existing suites stay green | every task; gate in 16 |
| Spec architecture file list for phase 1 (`types.ts`, `run-prefill.ts`, `merge.ts`, `assessor.ts`, routes, `provenance-context.tsx`, `provenance-badge.tsx`, `suggestion-chip.tsx`, `prefill-sources-tile.tsx`, `use-prefill.ts`, `ui/form.tsx`) | all present; plus `stage.ts`, `input.ts`, `assessor-fields.ts`, `run-store.ts`, `run-dto.ts`, `route-access.ts`, `format.ts`, `prefill-panel.tsx` as supporting units |

Deliberately out of phase 1 (per §13): EDMS client/search/records download (phase 2), extraction (3), listing provider (4), webhook trigger (5), `records/[recordId]` signed-URL route (needed only once phase 2 stores documents — the DTO already carries `downloadUrl`), candidate picker UI (phase 2; `selectCandidates` and the 409 route exist), review-page reuse (separate spec).

### 2. Placeholder scan

Searched the plan for "TBD", "TODO", "implement later", "fill in", "add appropriate", "similar to Task", "handle edge cases". None present. Every code step carries the complete file or an exact old→new replacement; every run step has a command and an expected result. `continuePrefillAfterSelection` is a deliberate, tested phase-1 stub required by the contract (not a placeholder): it fails the run with an explicit message and is replaced in phase 2.

### 3. Type consistency

- `ProposedField.provenance` omits `state | value | at | kind` (Task 1); `mergeProposals` (Task 2), `assessorProposals` (Task 4), `ApnLookupInput` (Task 14) and `use-form-scan` (Task 15) all add exactly `kind`, `state`, `value`, `at` when building a `ProvenanceEntry`.
- `StageResult` / `StageContext` live in `src/lib/prefill/stage.ts` (Task 1) and are imported by `assessor.ts` (4), the stubs and `run-prefill.ts` (5).
- `run-store.ts` exports `PrefillRunRow` / `InspectionRecordRow` (5) consumed by `run-dto.ts` (5) and mocked as plain objects in the route tests (8).
- `requireInspectionAccess(id, "view" | "edit")` (6) is the only auth entry point for Tasks 6–8; its `inspection.formData` feeds `buildPrefillInput` (7).
- `usePrefill` returns `{ run, isRunning, start, selectCandidates, error }` (13) and `PrefillPanel` (14) passes `run / isRunning / error / start` into `PrefillSourcesTile({ run, isRunning, canRun, error, onFindRecords })` (12).
- `ProvenanceContextValue` (9) is what `ProvenanceBadge` / `SuggestionChip` (10), `FormItem`/`FormLabel` (11), `ApnLookupInput` (14), `ScanReviewModal` (15) and `usePrefill` (13) read; `readOnly` is an addition to the contract's interface (used by the badge/chip to hide actions).
- Body of `POST /prefill` adds an optional `trigger: "apn_lookup" | "manual"` to the contract's `{ apn?, address? }` so the run row records the real trigger; `StartPrefillInput` (13) mirrors it.
- Provenance keys everywhere are react-hook-form dotted paths; `normalizeFieldPath` is applied on the scan path (15), in `setMany`/`get` (9) and in `mergeProposals` (2).

### 4. Findings for the spec owner (not blocking phase 1)

- The spec's §7 field table uses top-level `septicTank.tankCapacity`, `septicTank.capacityBasis`, `septicTank.tankMaterial` — those fields do not exist in `src/lib/validators/inspection.ts`; tank fields live only under `septicTank.tanks[n].*` (`tankCapacity`, `capacityBasis`, `tankMaterial`). Phase 3's mapper must target `septicTank.tanks.0.*` (the provider's parent-path edit detection already handles that shape).
- `PHYSICAL_ADDRESS` from ArcGIS includes the city/zip after runs of spaces; Task 4 trims it in `mapParcelToAssessor`, which also cleans what `/api/apn-lookup` writes into `facilityAddress` from now on.
- Hover-open on the badge popover (§9) is not implemented — tap/click/keyboard only; hover-open plus click-to-pin is a small follow-up if wanted.
- Admins editing non-drafts get read-only badges (`readOnly = status !== "draft"` in the wizard) until the review-page redesign lands its own provider wiring.
