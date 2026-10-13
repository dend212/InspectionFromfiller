# Import from Workiz Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an **Import from Workiz** button on `/inspections/new` that creates a draft from a finished Workiz ADEQ job (service address filled, prefill run started) and shows everything else Workiz knows as pink, tap-to-accept suggestion chips. The chips live in a `secondary.*` provenance slot.

**Architecture:** A server-only, GET-only Workiz v2 client (`src/lib/workiz/*`) feeds two new route handlers: `GET /api/workiz/jobs` (a cached, filtered list) and `POST /api/workiz/import` (creates the draft and starts the run). A pure mapper turns a Workiz job into an `ImportPlan`: a form patch, primary and secondary provenance, the column values and the run input. Workiz suggestions sit in the existing `field_provenance` map under `secondary.<fieldPath>` keys. `mergeProposals` never touches those keys. A new `<SecondarySuggestionChip>` renders them, and new provider methods accept or dismiss them. There is no migration and no new column.

**Tech Stack:** Next.js 16 route handlers, React 19, react-hook-form, zod 4, Drizzle 0.45 (postgres.js), sonner, vitest 4 + Testing Library (jsdom), `server-only`, tsx for the smoke script.

**Spec:** `docs/superpowers/specs/2026-10-12-workiz-import-design.md`. Section references (§N) point there. Read the section a task cites before starting it.

## Global Constraints

Every task's requirements include these:

- **Read-only Workiz.** `client.ts` exports GET only. Nothing ever POSTs, PUTs, PATCHes or DELETEs to Workiz.
- **No migration, no new DB column.** `inspection_prefill_runs.trigger` is free text and `PrefillInput.zipMustMatch` lives in the existing `input` jsonb.
- **No push, PR, deploy, branch switch or env setting.** Stay on `feature/workiz-import`. The orchestrator handles push, PR, deploy, `.env.local` and the Vercel env vars, with the user's permission. Implementers only edit `.env.example`.
- **No reformatting.** Never run `npm run lint`, `npm run format` or `biome … --write`, because the repo is not Biome-formatted. `npx biome check` reports formatter diffs on almost every existing file (verified on `input.ts`, `assessor.ts`, `suggestion-chip.tsx`), so **the gate is `npx biome lint <files>`, which must report no new diagnostics**. Formatter output is informational only. Lint diagnostics that already exist on `main` are not yours: `noExplicitAny`/`useLiteralKeys` in `src/app/api/webhooks/workiz/__tests__/route.test.ts` (around lines 108, 122, 257, 335) and a `useExhaustiveDependencies` warning in `src/components/prefill/provenance-context.tsx` (the debounce effect, around line 135). Ignore those and fix anything else. Make edits by hand in the surrounding style: 2-space indent, double quotes, semicolons, trailing commas where the file uses them.
- **Synthetic fixtures only.** Use `Test Client`, `test.client@example.com`, `555-0100`/`555-0101`, `100 E Example Rd`, `123-45-678` APNs, fake team names (`Alex Tester`, `Sam Sample`). Never copy anything from the scratchpad `adeq_dpa.json`, the Workiz backup or the live API into a repo file.
- **PII-safe logging.** Never log the token, client names, emails, phones, addresses, note text or custom-field values. Workiz logs carry path templates, status codes, serial ids and reason codes only. Every DB catch in `src/lib/workiz/*` and the two new routes goes through `logDbError(scope, err, { serialId })`. None of them may `console.*` the error object, `err.message`, `query` or `params`, and none returns `err.message` to the client.
- **Token handling.** `WORKIZ_API_V2_TOKEN` is read only in `src/lib/workiz/client.ts`, trimmed, never `NEXT_PUBLIC_`, never logged or returned. `client.ts` starts with `import "server-only"`. `WORKIZ_API_V2_BASE` must start with `https://`, otherwise the config is `null`.
- **Client boundary.** No `"use client"` file and nothing under `src/components/` may import `@/lib/workiz/*`. Shared response types live in `src/types/workiz-import.ts`.
- **Roles.** Both Workiz routes admit `admin` and `field_tech` only. `office_staff` and a missing role get 403.
- **Environment variables:** `WORKIZ_API_V2_TOKEN` (required for the feature; 64-hex bearer) and `WORKIZ_API_V2_BASE` (optional, default `https://api.workiz.com/crm/api/v2`).
- **Commits.** Each task ends with one commit. Use a conventional-commit subject and the trailer line `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Stage only the task's own files with explicit `git add <paths>`, never `git add -A` or `git add .`. The tree has an unrelated modified `CLAUDE.md` that must not be committed.
- **Test baseline.** `npx vitest run` on this branch before any task: **12 failed / 2729 passed (157 files)**. The 12 known failures are `src/__tests__/security/rbac.test.ts` (1), `src/app/api/inspections/[id]/download/__tests__/route.test.ts` (2), `src/app/api/inspections/[id]/reopen/__tests__/route.test.ts` (2), `src/components/layout/__tests__/mobile-nav.test.tsx` (1), `src/components/layout/__tests__/nav.test.tsx` (2), `src/lib/validators/__tests__/inspection.test.ts` (2), `src/types/__tests__/roles.test.ts` (1), `src/lib/constants/__tests__/inspection.test.ts` (1). No task may add a failure.
- **TypeScript baseline.** `npx tsc --noEmit` has 67 pre-existing errors, all in `src/__tests__/security/`, `src/app/api/inspections/[id]/media/__tests__/` and `src/lib/pdf/__tests__/`. The no-new-errors check used throughout this plan is:
  ```bash
  npx tsc --noEmit 2>&1 | grep "error TS" | grep -vE "^src/(__tests__/security/|app/api/inspections/\[id\]/media/__tests__/|lib/pdf/__tests__/)"
  ```
  Expected output: nothing.

---

## File map

| File | New / Modified | Responsibility | Task |
|---|---|---|---|
| `package.json`, `package-lock.json` | M | `server-only` dependency (T1); `smoke:workiz` script (T22) | T1, T22 |
| `vitest.config.ts` | M | alias `server-only` → empty stub | T1 |
| `src/test/server-only-stub.ts` | N | empty module for the alias | T1 |
| `src/test/__tests__/server-only-alias.test.ts` | N | proves the alias works | T1 |
| `.env.example` | M | `WORKIZ_API_V2_TOKEN`, `WORKIZ_API_V2_BASE` | T1 |
| `src/lib/prefill/types.ts` | M | `PrefillSource += "workiz"`, `PrefillTrigger += "workiz_import"`, `PrefillInput.zipMustMatch` | T2 |
| `src/lib/prefill/sources.ts` | M | `SOURCE_META.workiz` (pink) | T2 |
| `src/lib/prefill/provenance-schema.ts` | M | source enum `+= "workiz"` | T2 |
| `src/lib/prefill/map-facts-to-fields.ts` | M | `workiz: -1` ranks (type completeness) | T2 |
| `src/components/prefill/format.ts` | M | condition / effluent / hydraulic-test labels | T2 |
| `src/lib/prefill/run-dto.ts` | M | `loadLatestRunDTOForDraft` sweeps stale runs first | T3 |
| `src/app/(dashboard)/layout.tsx` | M | mounts `<Toaster />` | T4 |
| `src/lib/workiz/log-db-error.ts` | N | PII-safe DB error logger | T5 |
| `src/lib/workiz/custom-fields.ts` | N | pure Workiz value → form value maps + address formatters | T6 |
| `src/app/api/webhooks/workiz/__tests__/route.test.ts` | M | +1 regression test (shared uuid key) | T7 |
| `src/lib/prefill/assessor.ts` | M | `AddressHints.requireZipMatch`; stage passes `input.zipMustMatch` | T8 |
| `src/lib/prefill/secondary.ts` | N | `secondary.*` key helpers, path-aware equality, visibility rule, append helper | T9 |
| `src/lib/prefill/__tests__/merge.test.ts` | M | +2 pin tests (secondary pass-through; accepted Workiz value survives a run) | T9 |
| `src/lib/workiz/client.ts` | N | `server-only` GET-only HTTP client, config, retries, typed errors, signal helpers | T10 |
| `src/lib/workiz/__tests__/boundary.test.ts` | N | no client file imports `@/lib/workiz/*` | T10 |
| `src/lib/workiz/schema.ts` | N | lenient zod job schema → `WorkizJob` | T11 |
| `src/lib/workiz/adeq.ts` | N | ids/status constants, CF ids, `isAdeqJob`/`isImportable`/`canImportNow`/`toJobSummary` | T11 |
| `src/lib/workiz/__tests__/fixtures/jobs.ts` | N | synthetic job builders | T11 |
| `src/lib/workiz/apn-hint.ts` | N | APN CF → else newest permit-bot note | T12 |
| `src/lib/workiz/adeq-jobs.ts` | N | paged listing, 25 s deadline, cache + refresh floor + single-flight, `getJob`, `getCachedSummary` | T13 |
| `src/types/workiz-import.ts` | N | route response / error-code types shared with the picker | T14 |
| `src/lib/workiz/route-errors.ts` | N | `WorkizError` → `NextResponse`; fixed-message helpers | T14 |
| `src/lib/workiz/route-auth.ts` | N | `requireWorkizImporter()` (401 / 403) | T14 |
| `src/lib/workiz/import-store.ts` | N | `findInspectionsByWorkizIds`, `insertImportedInspection`, `loadProfileFullName` | T14 |
| `src/components/prefill/provenance-context.tsx` | M | `getSecondary` / `acceptSecondary` / `dismissSecondary` | T15 |
| `src/lib/workiz/map-job.ts` | N | pure `WorkizJob` → `ImportPlan`; `sanitizeProvenance` | T16 |
| `src/components/prefill/suggestion-chip.tsx` | M | extract `<ChipView>`; add `<SecondarySuggestionChip>` | T17 |
| `src/components/ui/form.tsx` | M | `FormItem` / `FormFieldGroup` render the secondary chip | T17 |
| `src/app/api/workiz/jobs/route.ts` | N | `GET /api/workiz/jobs` | T18 |
| `src/components/inspection/workiz-import-picker.tsx` | N | button + inline panel (client) | T19 |
| `src/app/api/workiz/import/route.ts` | N | `POST /api/workiz/import` | T20 |
| `src/app/(dashboard)/inspections/new/page.tsx` | M | renders the picker beside Create New Inspection | T21 |
| `scripts/workiz-adeq-smoke.mts` | N | live read-only smoke | T22 |

## Waves and dependencies

Tasks inside one wave touch **disjoint files** and may run in parallel. A wave starts only after every task it depends on has been committed. If parallel tasks share one checkout, run their `git commit` steps one at a time, because two commits at once collide on the git index lock.

| Wave | Task | Title | Depends on | Parallel within wave? |
|---|---|---|---|---|
| 1 | T1 | Tooling + env: `server-only`, vitest alias, `.env.example` | — | yes |
| 1 | T2 | Prefill types: `workiz` source, `workiz_import` trigger, `zipMustMatch`, labels | — | yes |
| 1 | T3 | Edit-page loader fails stale runs first | — | yes |
| 1 | T4 | Mount `<Toaster />` in the dashboard layout | — | yes |
| 1 | T5 | PII-safe `logDbError` | — | yes |
| 1 | T6 | Custom-field value maps + address formatters | — | yes |
| 1 | T7 | Webhook regression test (shared uuid key) | — | yes |
| 2 | T8 | Assessor opt-in `requireZipMatch` | T2 | yes |
| 2 | T9 | `secondary.ts` + merge pin tests | T2 | yes |
| 2 | T10 | Workiz HTTP client + boundary test | T1 | yes |
| 2 | T11 | Job schema, ADEQ rules, fixtures | T6 | yes |
| 3 | T12 | APN hint | T11 | yes |
| 3 | T13 | Listing, cache, `getJob` | T10, T11 | yes |
| 3 | T14 | Route infra: types, errors, auth, import store | T10 | yes |
| 3 | T15 | Provider: `getSecondary` / `acceptSecondary` / `dismissSecondary` | T9 | yes |
| 4 | T16 | `mapJobToImportPlan` | T2, T6, T9, T11, T12 | yes |
| 4 | T17 | `<SecondarySuggestionChip>` + `form.tsx` | T15 | yes |
| 4 | T18 | `GET /api/workiz/jobs` | T5, T13, T14 | yes |
| 4 | T19 | `WorkizImportPicker` component | T14 | yes |
| 5 | T20 | `POST /api/workiz/import` | T2, T5, T13, T14, T16 | yes |
| 5 | T21 | New Inspection page integration | T19 | yes |
| 5 | T22 | Live read-only smoke script | T13, T16 | yes |
| 6 | T23 | Final verification (full suite, tsc, biome, build) | all | sequential (last) |

Strictly sequential chains: T6 → T11 → T12 → T16 → T20, T2 → T9 → T15 → T17, and T1 → T10 → T13/T14 → T18/T20.

---

## Wave 1

### Task T1: Tooling + env (`server-only`, vitest alias, `.env.example`)

**Files:**
- Modify: `package.json`, `package-lock.json` (via `npm install`)
- Modify: `vitest.config.ts`
- Create: `src/test/server-only-stub.ts`
- Create: `src/test/__tests__/server-only-alias.test.ts`
- Modify: `.env.example` (after the line `WORKIZ_API_TOKEN=your-workiz-api-token`)

**Interfaces:**
- Produces: `import "server-only"` resolves in vitest (empty module), in `tsc`, in `next build` (Next aliases it itself) and in tsx (`NODE_OPTIONS=--conditions=react-server` selects the package's empty export).

- [ ] **Step 1: Write the failing test**

`src/test/__tests__/server-only-alias.test.ts`:
```ts
// Loading this file at all is the assertion: without the vitest alias, the real
// `server-only` package throws on import outside a react-server bundle (or is missing).
import "server-only";
import { describe, expect, it } from "vitest";
import * as stub from "@/test/server-only-stub";

describe("server-only alias", () => {
  it("resolves `server-only` to an empty stub so server modules can be unit-tested", () => {
    expect(Object.keys(stub)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/test/__tests__/server-only-alias.test.ts`
Expected: FAIL. Either `Failed to resolve import "server-only"` or `Failed to resolve import "@/test/server-only-stub"`.

- [ ] **Step 3: Install the dependency, add the stub and the alias**

```bash
cd /Users/danielendres/InspectionFromfiller && npm install server-only@0.0.1
```
Expected: `package.json` `dependencies` gains `"server-only": "^0.0.1"` (alphabetical, between `resend` and `sharp`) and `package-lock.json` updates. Do not touch any other dependency.

`src/test/server-only-stub.ts`:
```ts
// vitest alias target for `server-only` (see vitest.config.ts). The real package throws when
// imported outside a react-server bundle; unit tests import server modules directly.
export {};
```

`vitest.config.ts`: replace the `alias` object with:
```ts
    alias: {
      "@": resolve(__dirname, "./src"),
      // `import "server-only"` throws outside a react-server bundle; tests import server modules directly
      "server-only": resolve(__dirname, "./src/test/server-only-stub.ts"),
    },
```

- [ ] **Step 4: Add the env vars to `.env.example`**

Insert directly after `WORKIZ_API_TOKEN=your-workiz-api-token`:
```
# Workiz API v2 — read-only "Import from Workiz" on New Inspection. Server-only: never NEXT_PUBLIC_.
# The 64-hex bearer token (NOT the KEY-… id). WORKIZ_API_SECRET / WORKIZ_API_TOKEN above are the
# n8n v1 credentials and are unrelated. Without it the picker says "isn't set up" and nothing else changes.
WORKIZ_API_V2_TOKEN=your-workiz-v2-bearer-token
# Optional. Must start with https:// (anything else disables the import). Default shown.
WORKIZ_API_V2_BASE=https://api.workiz.com/crm/api/v2
```
**Do not** create or edit `.env.local`, and do not touch Vercel. The orchestrator sets `WORKIZ_API_V2_TOKEN` (sensitive; Production + Preview) and `.env.local` itself, through the Vercel REST API without a trailing newline (spec §14).

- [ ] **Step 5: Run the test and confirm it passes**

Run: `npx vitest run src/test/__tests__/server-only-alias.test.ts`
Expected: PASS (1 test).

- [ ] **Step 6: Lint the changed files**

Run: `npx biome lint vitest.config.ts src/test/server-only-stub.ts src/test/__tests__/server-only-alias.test.ts`
Expected: no lint errors.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/test/server-only-stub.ts src/test/__tests__/server-only-alias.test.ts .env.example
git commit -F - <<'EOF'
chore(workiz-import): add server-only dependency, vitest alias and Workiz v2 env vars

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
```

---

### Task T2: Prefill types — `workiz` source, `workiz_import` trigger, `zipMustMatch`, chip labels

**Files:**
- Modify: `src/lib/prefill/types.ts` (`PrefillSource` line 4, `PrefillTrigger` line 76, `PrefillInput` lines 115-120)
- Modify: `src/lib/prefill/sources.ts`
- Modify: `src/lib/prefill/provenance-schema.ts` (source enum, line 28)
- Modify: `src/lib/prefill/map-facts-to-fields.ts` (lines 369-380)
- Modify: `src/components/prefill/format.ts`
- Test: `src/lib/prefill/__tests__/sources.test.ts`, `src/lib/prefill/__tests__/provenance-schema.test.ts`, `src/components/prefill/__tests__/format.test.ts`

**Interfaces:**
- Produces: `PrefillSource = "assessor" | "permit" | "listing" | "scan" | "workiz"`; `PrefillTrigger = "apn_lookup" | "manual" | "webhook" | "workiz_import"`; `PrefillInput.zipMustMatch?: boolean`; `SOURCE_META.workiz = { label: "Workiz", dotClass: "bg-pink-500", accentClass: "border-pink-300 text-pink-900 bg-pink-50" }`; the provenance schema accepts `source: "workiz"`. `formatFieldValue` labels `facilityInfo.septicTankCondition`, `facilityInfo.disposalWorksCondition`, `septicTank.tanks.*.effluentFilterPresent` and `disposalWorks.hydraulicLoadTestPerformed`.

- [ ] **Step 1: Write the failing tests**

In `src/lib/prefill/__tests__/sources.test.ts`, change the loop list to `["assessor", "permit", "listing", "scan", "workiz"] as const` and add inside `describe("SOURCE_META", …)`:
```ts
  it("has a pink Workiz source (distinct from blue/amber/violet/green and from destructive red)", () => {
    expect(SOURCE_META.workiz).toEqual({
      label: "Workiz",
      dotClass: "bg-pink-500",
      accentClass: "border-pink-300 text-pink-900 bg-pink-50",
    });
  });
```

Append to `src/lib/prefill/__tests__/provenance-schema.test.ts`:
```ts
describe("Workiz entries (Import from Workiz)", () => {
  const WORKIZ = {
    source: "workiz",
    state: "suggested",
    kind: "fill",
    value: "Test Client",
    confidence: 0.6,
    explanation: "Workiz client (job #4696)",
    at: "2026-10-12T17:04:05.000Z",
  };

  it("accepts source workiz", () => {
    expect(provenanceEntrySchema.safeParse(WORKIZ).success).toBe(true);
  });

  it("accepts secondary.* keys, including the longest one (50 chars)", () => {
    const result = fieldProvenanceSchema.safeParse({
      "secondary.facilityInfo.sellerName": WORKIZ,
      "secondary.septicTank.tanks.0.effluentFilterPresent": { ...WORKIZ, value: "present" },
    });
    expect(result.success).toBe(true);
  });

  it("still rejects an unknown source", () => {
    expect(provenanceEntrySchema.safeParse({ ...WORKIZ, source: "zillow" }).success).toBe(false);
  });
});
```

Add to `src/components/prefill/__tests__/format.test.ts` inside `describe("formatFieldValue", …)`:
```ts
  it("labels the condition, effluent-filter and hydraulic-load-test enums Workiz chips propose", () => {
    expect(formatFieldValue("facilityInfo.septicTankCondition", "operational_with_concerns")).toBe(
      "Operational with Concerns",
    );
    expect(formatFieldValue("facilityInfo.disposalWorksCondition", "not_operational")).toBe("Not Operational");
    expect(formatFieldValue("septicTank.tanks.0.effluentFilterPresent", "not_present")).toBe("Not Present");
    expect(formatFieldValue("septicTank.tanks.0.effluentFilterPresent", "present")).toBe("Present");
    expect(formatFieldValue("disposalWorks.hydraulicLoadTestPerformed", "yes")).toBe("Yes");
    expect(formatFieldValue("disposalWorks.hydraulicLoadTestPerformed", "no")).toBe("No");
  });
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run src/lib/prefill/__tests__/sources.test.ts src/lib/prefill/__tests__/provenance-schema.test.ts src/components/prefill/__tests__/format.test.ts`
Expected: FAIL. `SOURCE_META.workiz` is undefined, `source: "workiz"` is rejected, and the labels come back as raw tokens (`operational_with_concerns`).

- [ ] **Step 3: Implement**

`src/lib/prefill/types.ts`:
```ts
/**
 * Where a prefilled value came from. Colours/labels in ./sources.ts. `workiz` is only ever
 * written by POST /api/workiz/import (primary address entries + `secondary.*` chips) — it is
 * never a run stage and never enters dedupeProposals.
 */
export type PrefillSource = "assessor" | "permit" | "listing" | "scan" | "workiz";
```
```ts
export type PrefillTrigger = "apn_lookup" | "manual" | "webhook" | "workiz_import";
```
```ts
export interface PrefillInput {
  apn?: string;
  address?: PrefillAddress;
  subdivision?: string;
  lot?: string;
  /**
   * Set only by Import from Workiz when the job carried a valid 5-digit ZIP: the assessor
   * address lookup must match that ZIP instead of falling back to the first row (spec §5.4).
   * Manual runs never set it.
   */
  zipMustMatch?: boolean;
}
```

`src/lib/prefill/sources.ts`: add after the `scan` line:
```ts
  workiz: { label: "Workiz", dotClass: "bg-pink-500", accentClass: "border-pink-300 text-pink-900 bg-pink-50" },
```

`src/lib/prefill/provenance-schema.ts`:
```ts
  source: z.enum(["assessor", "permit", "listing", "scan", "workiz"]),
```

`src/lib/prefill/map-facts-to-fields.ts`:
```ts
// `workiz: -1` only completes Record<PrefillSource, number>: Workiz values never enter a run or dedupeProposals
const SOURCE_RANK: Record<PrefillSource, number> = { permit: 3, assessor: 2, listing: 1, scan: 0, workiz: -1 };
```
and the two `FIELD_SOURCE_RANK` rows:
```ts
  "facilityInfo.wastewaterSource": { assessor: 3, listing: 2, permit: 1, scan: 0, workiz: -1 },
  "facilityInfo.facilityType": { assessor: 3, listing: 2, permit: 1, scan: 0, workiz: -1 },
```

`src/components/prefill/format.ts`: add `CONDITION_OPTIONS` to the import list (alphabetical, after `CAPACITY_BASIS_OPTIONS`). After the `GP402_CHIP_LABELS` constant, add:
```ts
/** Effluent filter is a two-button group in the wizard; the form stores these tokens */
const EFFLUENT_FILTER_LABELS: readonly LabelOption[] = [
  { value: "present", label: "Present" },
  { value: "not_present", label: "Not Present" },
];

const YES_NO_LABELS: readonly LabelOption[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];
```
and add these rows to `FIELD_VALUE_LABELS`:
```ts
  "facilityInfo.septicTankCondition": CONDITION_OPTIONS,
  "facilityInfo.disposalWorksCondition": CONDITION_OPTIONS,
  "septicTank.tanks.*.effluentFilterPresent": EFFLUENT_FILTER_LABELS,
  "disposalWorks.hydraulicLoadTestPerformed": YES_NO_LABELS,
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/lib/prefill/__tests__/sources.test.ts src/lib/prefill/__tests__/provenance-schema.test.ts src/components/prefill/__tests__/format.test.ts src/lib/prefill/__tests__/map-facts-to-fields.test.ts src/components/prefill/__tests__/provenance-badge.test.tsx`
Expected: PASS.

- [ ] **Step 5: Type check (no new errors)**

Run the TypeScript baseline filter command from Global Constraints. Expected: no output. It would fail with `Property 'workiz' is missing` if any `Record<PrefillSource, …>` were left incomplete.

- [ ] **Step 6: Lint and commit**

```bash
npx biome lint src/lib/prefill/types.ts src/lib/prefill/sources.ts src/lib/prefill/provenance-schema.ts src/components/prefill/format.ts
git add src/lib/prefill/types.ts src/lib/prefill/sources.ts src/lib/prefill/provenance-schema.ts src/lib/prefill/map-facts-to-fields.ts src/components/prefill/format.ts src/lib/prefill/__tests__/sources.test.ts src/lib/prefill/__tests__/provenance-schema.test.ts src/components/prefill/__tests__/format.test.ts
git commit -F - <<'EOF'
feat(prefill): add workiz provenance source, workiz_import trigger and zipMustMatch input

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
```
(`map-facts-to-fields.ts` is left out of the lint call on purpose. It is a large pre-existing file, and your change is two lines.)

---

### Task T3: Edit-page run loader fails stale runs first

**Files:**
- Modify: `src/lib/prefill/run-dto.ts` (imports at line 6, `loadLatestRunDTOForDraft` at the end)
- Test: `src/lib/prefill/__tests__/run-dto.test.ts`

**Interfaces:**
- Consumes: `failStaleRuns(inspectionId: string): Promise<void>` from `./run-store` (existing).
- Produces: `loadLatestRunDTOForDraft(inspectionId, status)` calls `failStaleRuns` before loading (best-effort) and keeps its signature.

- [ ] **Step 1: Write the failing tests**

In `src/lib/prefill/__tests__/run-dto.test.ts`, extend the hoisted mocks and the `vi.mock`:
```ts
const { mockLoadRunRow, mockLoadLatestRunRow, mockListRecordRows, mockFailStaleRuns } = vi.hoisted(() => ({
  mockLoadRunRow: vi.fn(),
  mockLoadLatestRunRow: vi.fn(),
  mockListRecordRows: vi.fn(),
  mockFailStaleRuns: vi.fn(),
}));

vi.mock("@/lib/prefill/run-store", () => ({
  loadRunRow: mockLoadRunRow,
  loadLatestRunRow: mockLoadLatestRunRow,
  listRecordRows: mockListRecordRows,
  failStaleRuns: mockFailStaleRuns,
}));
```
In the file's top-level `beforeEach` (create one if absent), add `mockFailStaleRuns.mockReset().mockResolvedValue(undefined);`. The reset matters: the tests below count calls and one installs a rejection. Then add:
```ts
describe("loadLatestRunDTOForDraft — stale-run sweep (spec §10)", () => {
  it("fails stale runs before loading the latest run", async () => {
    const order: string[] = [];
    mockFailStaleRuns.mockImplementation(async () => {
      order.push("sweep");
    });
    mockLoadLatestRunRow.mockImplementation(async () => {
      order.push("load");
      return RUN;
    });
    mockListRecordRows.mockResolvedValue([]);
    const dto = await loadLatestRunDTOForDraft("insp-1", "draft");
    expect(mockFailStaleRuns).toHaveBeenCalledWith("insp-1");
    expect(order).toEqual(["sweep", "load"]);
    expect(dto?.id).toBe("run-1");
  });

  it("logs a sweep failure and still loads the run", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockFailStaleRuns.mockRejectedValue(new Error("db down"));
    mockLoadLatestRunRow.mockResolvedValue(RUN);
    mockListRecordRows.mockResolvedValue([]);
    const dto = await loadLatestRunDTOForDraft("insp-1", "draft");
    expect(dto?.id).toBe("run-1");
    expect(errorSpy).toHaveBeenCalledWith("[prefill] stale-run sweep failed", expect.anything());
    errorSpy.mockRestore();
  });

  it("does not sweep for a non-draft inspection", async () => {
    await loadLatestRunDTOForDraft("insp-1", "submitted");
    expect(mockFailStaleRuns).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run src/lib/prefill/__tests__/run-dto.test.ts`
Expected: FAIL. `mockFailStaleRuns` is never called and the order is `["load"]`.

- [ ] **Step 3: Implement**

`src/lib/prefill/run-dto.ts`, change the run-store import to:
```ts
import { failStaleRuns, listRecordRows, loadLatestRunRow, loadRunRow } from "./run-store";
```
and replace `loadLatestRunDTOForDraft`:
```ts
/**
 * Used by the edit page to load the prefill panel's run without letting a DB error crash
 * the page. Non-draft inspections never show the panel, so the query is skipped entirely.
 * Fails queued/running runs older than 5 minutes first (best-effort): a run whose after()
 * job was dropped would otherwise poll as "running" forever, because POST /prefill — the
 * only other sweep — is unreachable while the tile shows a run in progress (spec §10).
 */
export async function loadLatestRunDTOForDraft(
  inspectionId: string,
  status: string,
): Promise<PrefillRunDTO | null> {
  if (status !== "draft") return null;
  try {
    await failStaleRuns(inspectionId);
  } catch (err) {
    console.error("[prefill] stale-run sweep failed", err);
  }
  try {
    return await loadLatestRunDTO(inspectionId);
  } catch (err) {
    console.error("[prefill] latest run load failed", err);
    return null;
  }
}
```
(The sweep's SQL params are only the inspection id, so logging `err` here carries no PII. This matches the existing loader's logging.)

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/lib/prefill/__tests__/run-dto.test.ts src/lib/prefill/__tests__/run-dto.records.test.ts`
Expected: PASS. If `run-dto.records.test.ts` mocks `@/lib/prefill/run-store` without `failStaleRuns` and calls `loadLatestRunDTOForDraft`, add `failStaleRuns: vi.fn().mockResolvedValue(undefined)` to its mock.

- [ ] **Step 5: Commit**

```bash
git add src/lib/prefill/run-dto.ts src/lib/prefill/__tests__/run-dto.test.ts src/lib/prefill/__tests__/run-dto.records.test.ts
git commit -F - <<'EOF'
fix(prefill): fail stale prefill runs when the edit page loads the latest run

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
```
(Leave `run-dto.records.test.ts` out of `git add` if you did not change it.)

---

### Task T4: Mount `<Toaster />` in the dashboard layout

**Files:**
- Modify: `src/app/(dashboard)/layout.tsx`
- Create: `src/app/(dashboard)/__tests__/layout.test.tsx`

**Interfaces:**
- Produces: every dashboard page has a mounted sonner toaster, so `toast()` calls become visible. The import's post-redirect toasts depend on this (spec §2.3).

- [ ] **Step 1: Write the failing test**

`src/app/(dashboard)/__tests__/layout.test.tsx`:
```tsx
import { render } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
  }),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/components/layout/header", () => ({ Header: () => <header>header</header> }));
vi.mock("@/components/layout/nav", () => ({ Nav: () => <nav>nav</nav> }));

import DashboardLayout from "../layout";

beforeAll(() => {
  // sonner reads prefers-color-scheme; jsdom has no matchMedia
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

describe("DashboardLayout", () => {
  it("mounts the sonner toaster so toast() calls are visible on every dashboard page", async () => {
    const { container } = render(await DashboardLayout({ children: <p>page</p> }));
    // sonner 2.x always renders <section aria-label="Notifications alt+T" aria-live="polite">
    expect(container.querySelector('section[aria-label^="Notifications"]')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run "src/app/(dashboard)/__tests__/layout.test.tsx"`
Expected: FAIL, because no `section[aria-label^="Notifications"]` is rendered.

- [ ] **Step 3: Implement**

`src/app/(dashboard)/layout.tsx`: add `import { Toaster } from "@/components/ui/sonner";` (after the `Nav` import) and render it as the last child of the outer `div`:
```tsx
    <div className="flex min-h-svh flex-col">
      <Header />
      <div className="flex flex-1">
        <Nav />
        <main className="flex-1 p-4 lg:p-8">{children}</main>
      </div>
      {/* Lives in the layout (persists across client navigation) so a toast fired just before router.push stays visible */}
      <Toaster />
    </div>
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run "src/app/(dashboard)/__tests__/layout.test.tsx"`
Expected: PASS. If sonner 2.0.7 renders a different aria-label, inspect `container.innerHTML` and target the toaster's region instead. The assertion must still prove the Toaster mounted.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/layout.tsx" "src/app/(dashboard)/__tests__/layout.test.tsx"
git commit -F - <<'EOF'
fix(dashboard): mount the sonner Toaster so toasts are visible

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
```

---

### Task T5: PII-safe `logDbError`

**Files:**
- Create: `src/lib/workiz/log-db-error.ts`
- Test: `src/lib/workiz/__tests__/log-db-error.test.ts`

**Interfaces:**
- Produces: `logDbError(scope: string, err: unknown, ctx?: { serialId?: number | null }): void`. It writes exactly one `console.error` line, `[workiz-import] db error scope=<scope> job=<serialId|-> code=<SQLSTATE|unknown> constraint=<name|->`.

- [ ] **Step 1: Write the failing test**

`src/lib/workiz/__tests__/log-db-error.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { logDbError } from "@/lib/workiz/log-db-error";

const PII = ["Test Client", "test.client@example.com", "100 E Example Rd"];

/** Shape of Drizzle 0.45's DrizzleQueryError: message = SQL + params, cause = the postgres error */
function drizzleError(cause: Record<string, unknown>) {
  const err = new Error(
    `Failed query: insert into "inspections" … \nparams: ${PII.join(",")}`,
  ) as Error & { query: string; params: unknown[]; cause: unknown };
  err.query = 'insert into "inspections" …';
  err.params = [...PII];
  err.cause = cause;
  return err;
}

afterEach(() => vi.restoreAllMocks());

describe("logDbError", () => {
  it("logs only scope, serial, SQLSTATE and constraint — never the message or params", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logDbError(
      "insert",
      drizzleError({ code: "23505", constraint_name: "inspections_workiz_job_id_unique" }),
      { serialId: 4696 },
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]).toEqual([
      "[workiz-import] db error scope=insert job=4696 code=23505 constraint=inspections_workiz_job_id_unique",
    ]);
    const logged = JSON.stringify(spy.mock.calls);
    for (const value of PII) expect(logged).not.toContain(value);
  });

  it("falls back to err.code, then unknown / -", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logDbError("create_run", Object.assign(new Error("x"), { code: "57014" }));
    logDbError("lookup", "not even an error");
    expect(spy.mock.calls[0][0]).toBe("[workiz-import] db error scope=create_run job=- code=57014 constraint=-");
    expect(spy.mock.calls[1][0]).toBe("[workiz-import] db error scope=lookup job=- code=unknown constraint=-");
  });

  it("refuses non-identifier code/constraint values (they could carry text)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logDbError("insert", drizzleError({ code: "Test Client", constraint_name: "a b" }), { serialId: 1 });
    expect(spy.mock.calls[0][0]).toBe("[workiz-import] db error scope=insert job=1 code=unknown constraint=-");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/lib/workiz/__tests__/log-db-error.test.ts`
Expected: FAIL, `Failed to resolve import "@/lib/workiz/log-db-error"`.

- [ ] **Step 3: Implement**

`src/lib/workiz/log-db-error.ts`:
```ts
/**
 * PII-safe DB error logging for the Workiz import (spec §12). Drizzle 0.45 wraps a failed query
 * in DrizzleQueryError whose `message` is `Failed query: <sql>\nparams: <params>` — for the import
 * INSERT the params hold the client email, street, whole formData and provenance map. So callers
 * never log the error object, its message, query or params: only this line.
 */

function field(value: unknown, key: string): unknown {
  return value && typeof value === "object" && key in value
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

/** SQLSTATEs and constraint names are identifiers; anything else could be text, so it is dropped */
function identifier(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_]{1,63}$/.test(value) ? value : undefined;
}

export function logDbError(
  scope: string,
  err: unknown,
  ctx: { serialId?: number | null } = {},
): void {
  const cause = field(err, "cause");
  const code = identifier(field(cause, "code")) ?? identifier(field(err, "code")) ?? "unknown";
  const constraint =
    identifier(field(cause, "constraint_name")) ?? identifier(field(err, "constraint_name")) ?? "-";
  console.error(
    `[workiz-import] db error scope=${scope} job=${ctx.serialId ?? "-"} code=${code} constraint=${constraint}`,
  );
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run src/lib/workiz/__tests__/log-db-error.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Lint and commit**

```bash
npx biome lint src/lib/workiz/log-db-error.ts src/lib/workiz/__tests__/log-db-error.test.ts
git add src/lib/workiz/log-db-error.ts src/lib/workiz/__tests__/log-db-error.test.ts
git commit -F - <<'EOF'
feat(workiz-import): add PII-safe DB error logger

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
```

---

### Task T6: Custom-field value maps + address formatters

**Files:**
- Create: `src/lib/workiz/custom-fields.ts`
- Test: `src/lib/workiz/__tests__/custom-fields.test.ts`

**Interfaces:**
- Produces (all pure, no imports from other workiz files):
  ```ts
  export type SkipReason = "empty" | "ambiguous" | "unknown_option" | "out_of_range" | "invalid_apn";
  export type MapResult<T extends string = string> = { ok: true; value: T } | { ok: false; reason: SkipReason };
  export function normalizeOption(raw: string): string;                       // trim + collapse ws + lower-case
  export function mapWaterSource(raw: string): MapResult<"private_well" | "shared_well" | "hauled_water">;
  export function mapTankSize(raw: string): MapResult;                         // "1500"
  export function mapEffluentFilter(raw: string): MapResult<"present" | "not_present">;
  export function mapFlowTestCompleted(raw: string): MapResult<"yes" | "no">;
  export function mapCondition(raw: string): MapResult<"operational" | "operational_with_concerns" | "not_operational">;
  export const FREE_TEXT_MAX_CHARS = 4000;
  export function mapFreeText(raw: string, opts?: { dropNoneAnswers?: boolean }): MapResult;
  export function formatWorkizStreet(address: string, unit: string): string;   // "100 E Example Rd #12"
  export function formatWorkizCity(city: string): string;                       // "laveen" → "Laveen"
  export function formatWorkizZip(zip: string): string | null;                  // "85331-1234" → "85331"
  ```

- [ ] **Step 1: Write the failing test**

`src/lib/workiz/__tests__/custom-fields.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  formatWorkizCity,
  formatWorkizStreet,
  formatWorkizZip,
  mapCondition,
  mapEffluentFilter,
  mapFlowTestCompleted,
  mapFreeText,
  mapTankSize,
  mapWaterSource,
  normalizeOption,
} from "@/lib/workiz/custom-fields";

const ok = (value: string) => ({ ok: true, value });
const skip = (reason: string) => ({ ok: false, reason });

describe("normalizeOption", () => {
  it("trims, collapses internal whitespace and lower-cases", () => {
    expect(normalizeOption("  Shared   Private\tWell ")).toBe("shared private well");
  });
});

describe("mapWaterSource (§5.2.1)", () => {
  it.each([
    ["Private Well", ok("private_well")],
    ["private well ", ok("private_well")],
    ["Shared Private Well", ok("shared_well")],
    ["Hauled Water", ok("hauled_water")],
    ["Municipal / Private Water Supply", skip("ambiguous")],
    ["Unknown", skip("unknown_option")],
    ["Yes", skip("unknown_option")],
    ["", skip("empty")],
    ["   ", skip("empty")],
  ])("%j → %j", (raw, expected) => {
    expect(mapWaterSource(raw)).toEqual(expected);
  });
});

describe("mapTankSize (§5.2.2)", () => {
  it.each([
    ["1000", ok("1000")],
    ["1250", ok("1250")],
    ["1500", ok("1500")],
    ["2000", ok("2000")],
    ["2500", ok("2500")],
    ["3000", ok("3000")],
    ["1,500 Gallons", ok("1500")],
    ["1000 gallon", ok("1000")],
    ["1,500 gallons", ok("1500")],
    ["750 gal", ok("750")],
    ["300", ok("300")],
    ["10,000", ok("10000")],
    ["< 1000", skip("unknown_option")],
    [">3000", skip("unknown_option")],
    ["18", skip("out_of_range")],
    ["12000", skip("out_of_range")],
    ["big", skip("unknown_option")],
    ["", skip("empty")],
  ])("%j → %j", (raw, expected) => {
    expect(mapTankSize(raw)).toEqual(expected);
  });
});

describe("mapEffluentFilter / mapFlowTestCompleted (§5.2.3, §5.2.4)", () => {
  it("maps Yes/No and skips anything else", () => {
    expect(mapEffluentFilter("Yes")).toEqual(ok("present"));
    expect(mapEffluentFilter(" no ")).toEqual(ok("not_present"));
    expect(mapEffluentFilter("Maybe")).toEqual(skip("unknown_option"));
    expect(mapEffluentFilter("")).toEqual(skip("empty"));
    expect(mapFlowTestCompleted("YES")).toEqual(ok("yes"));
    expect(mapFlowTestCompleted("No")).toEqual(ok("no"));
    expect(mapFlowTestCompleted("N/A")).toEqual(skip("unknown_option"));
    expect(mapFlowTestCompleted("")).toEqual(skip("empty"));
  });
});

describe("mapCondition (§5.2.5)", () => {
  it.each([
    ["Operational", ok("operational")],
    ["Operational W/Concerns", ok("operational_with_concerns")],
    ["operational w/concerns", ok("operational_with_concerns")],
    ["Non-Operational", ok("not_operational")],
    ["Needs Pumping", skip("unknown_option")],
    ["", skip("empty")],
  ])("%j → %j", (raw, expected) => {
    expect(mapCondition(raw)).toEqual(expected);
  });
});

describe("mapFreeText", () => {
  it("trims, collapses runs of spaces/tabs and keeps internal newlines", () => {
    expect(mapFreeText("  Baffle   cracked.\r\n\tRoots at outlet.  ")).toEqual(
      ok("Baffle cracked.\n Roots at outlet."),
    );
  });

  it("caps at 4,000 characters", () => {
    const result = mapFreeText("a".repeat(5000));
    expect(result.ok && result.value.length).toBe(4000);
  });

  it("drops empty text", () => {
    expect(mapFreeText("  ")).toEqual(skip("empty"));
  });

  it("drops none / n/a / no concerns answers only when asked (notable concerns)", () => {
    for (const raw of ["None", "none.", "N/A", "n/a", "NA", "No concern", "no concerns."]) {
      expect(mapFreeText(raw, { dropNoneAnswers: true })).toEqual(skip("empty"));
    }
    expect(mapFreeText("None", { dropNoneAnswers: false })).toEqual(ok("None"));
    expect(mapFreeText("None of the risers are sealed", { dropNoneAnswers: true })).toEqual(
      ok("None of the risers are sealed"),
    );
  });
});

describe("address formatters (§5.1)", () => {
  it("formatWorkizStreet trims, collapses whitespace and appends #unit", () => {
    expect(formatWorkizStreet("  100  E Example   Rd ", "")).toBe("100 E Example Rd");
    expect(formatWorkizStreet("100 E Example Rd", " 12 ")).toBe("100 E Example Rd #12");
    expect(formatWorkizStreet("100 E Example Rd", "#12")).toBe("100 E Example Rd #12");
    expect(formatWorkizStreet("", "")).toBe("");
  });

  it("formatWorkizCity title-cases only all-lower or all-upper values", () => {
    expect(formatWorkizCity("laveen")).toBe("Laveen");
    expect(formatWorkizCity("CAVE CREEK")).toBe("Cave Creek");
    expect(formatWorkizCity(" McDowell  Mountain ")).toBe("McDowell Mountain");
    expect(formatWorkizCity("")).toBe("");
  });

  it("formatWorkizZip keeps 5-digit and ZIP+4 (first five), rejects the rest", () => {
    expect(formatWorkizZip("85331")).toBe("85331");
    expect(formatWorkizZip(" 85331-1234 ")).toBe("85331");
    expect(formatWorkizZip("8533")).toBeNull();
    expect(formatWorkizZip("AZ 85331")).toBeNull();
    expect(formatWorkizZip("")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/lib/workiz/__tests__/custom-fields.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`src/lib/workiz/custom-fields.ts`:
```ts
/**
 * Pure value maps: Workiz custom-field option → wizard form value (spec §5.2), plus the address
 * formatters the mapper and the job summary share. Matching is exact after trim, internal
 * whitespace collapse and case-folding. Never logs: callers log `reason` codes only.
 */

export type SkipReason = "empty" | "ambiguous" | "unknown_option" | "out_of_range" | "invalid_apn";

export type MapResult<T extends string = string> =
  | { ok: true; value: T }
  | { ok: false; reason: SkipReason };

const skip = (reason: SkipReason): { ok: false; reason: SkipReason } => ({ ok: false, reason });

export function normalizeOption(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

function fromTable<T extends string>(raw: string, table: Record<string, T | "ambiguous">): MapResult<T> {
  const key = normalizeOption(raw);
  if (!key) return skip("empty");
  const hit = table[key];
  if (hit === undefined) return skip("unknown_option");
  if (hit === "ambiguous") return skip("ambiguous");
  return { ok: true, value: hit };
}

/** §5.2.1 — "Municipal / Private Water Supply" merges two ADEQ boxes, so it is never guessed */
export function mapWaterSource(raw: string): MapResult<"private_well" | "shared_well" | "hauled_water"> {
  return fromTable(raw, {
    "private well": "private_well",
    "shared private well": "shared_well",
    "hauled water": "hauled_water",
    "municipal / private water supply": "ambiguous",
  });
}

const TANK_MIN_GALLONS = 300;
const TANK_MAX_GALLONS = 10_000;

/** §5.2.2 — an integer (commas allowed) with an optional gal/gallon(s) suffix, 300–10,000 */
export function mapTankSize(raw: string): MapResult {
  const text = raw.trim().replace(/\s+/g, " ");
  if (!text) return skip("empty");
  const match = /^(\d{1,3}(?:,\d{3})+|\d+)\s*(?:gal|gals|gallon|gallons)?\.?$/i.exec(text);
  if (!match) return skip("unknown_option"); // "< 1000", ">3000", free words
  const gallons = Number(match[1].replace(/,/g, ""));
  if (gallons < TANK_MIN_GALLONS || gallons > TANK_MAX_GALLONS) return skip("out_of_range");
  return { ok: true, value: String(gallons) };
}

/** §5.2.3 */
export function mapEffluentFilter(raw: string): MapResult<"present" | "not_present"> {
  return fromTable(raw, { yes: "present", no: "not_present" });
}

/** §5.2.4 — Workiz's "flow test" is the ADEQ hydraulic load test */
export function mapFlowTestCompleted(raw: string): MapResult<"yes" | "no"> {
  return fromTable(raw, { yes: "yes", no: "no" });
}

/** §5.2.5 — Tank / Drainfield Recommendation → CONDITION_OPTIONS */
export function mapCondition(
  raw: string,
): MapResult<"operational" | "operational_with_concerns" | "not_operational"> {
  return fromTable(raw, {
    operational: "operational",
    "operational w/concerns": "operational_with_concerns",
    "non-operational": "not_operational",
  });
}

export const FREE_TEXT_MAX_CHARS = 4000;
const NONE_ANSWER = /^(none|n\/?a|no concerns?)\.?$/i;

/** Tech notes: whitespace trimmed, internal newlines kept, capped at 4,000 chars */
export function mapFreeText(raw: string, opts: { dropNoneAnswers?: boolean } = {}): MapResult {
  const text = raw.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (!text) return skip("empty");
  if (opts.dropNoneAnswers && NONE_ANSWER.test(text)) return skip("empty");
  return { ok: true, value: text.slice(0, FREE_TEXT_MAX_CHARS) };
}

const collapse = (value: string): string => value.replace(/\s+/g, " ").trim();

/** "100 E Example Rd" + "12" → "100 E Example Rd #12" */
export function formatWorkizStreet(address: string, unit: string): string {
  const street = collapse(address);
  const unitText = collapse(unit).replace(/^#\s*/, "");
  if (!street) return "";
  return unitText ? `${street} #${unitText}` : street;
}

/** Title-cases only an all-lower or all-upper value ("laveen" → "Laveen"); mixed case is kept */
export function formatWorkizCity(city: string): string {
  const text = collapse(city);
  if (text !== text.toLowerCase() && text !== text.toUpperCase()) return text;
  return text.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** `^\d{5}(-\d{4})?$` → first five digits; anything else → null (no fill, no chip) */
export function formatWorkizZip(zip: string): string | null {
  const text = zip.trim();
  return /^\d{5}(-\d{4})?$/.test(text) ? text.slice(0, 5) : null;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run src/lib/workiz/__tests__/custom-fields.test.ts`
Expected: PASS. Note the free-text case: `"\r\n\t"` becomes `"\n "`. Tabs collapse to a single space and the newline stays.

- [ ] **Step 5: Lint and commit**

```bash
npx biome lint src/lib/workiz/custom-fields.ts src/lib/workiz/__tests__/custom-fields.test.ts
git add src/lib/workiz/custom-fields.ts src/lib/workiz/__tests__/custom-fields.test.ts
git commit -F - <<'EOF'
feat(workiz-import): add custom-field value maps and address formatters

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
```

---

### Task T7: Webhook regression test — the import and the webhook share the uuid key

**Files:**
- Test: `src/app/api/webhooks/workiz/__tests__/route.test.ts` (add one test inside `describe("Idempotency", …)`)

**Interfaces:**
- Consumes: the unchanged `POST /api/webhooks/workiz`. No production code changes in this task (spec §1 Non-goals).

- [ ] **Step 1: Write the test**

Add inside `describe("Idempotency", () => { … })`:
```ts
    it("regression (Import from Workiz): finds an inspection the import stored under the job's 6-char uuid", async () => {
      // POST /api/workiz/import stores workiz_job_id = job.uuid (e.g. "AB12CD"); the n8n flow
      // maps job.jobId from the v1 UUID — the same 6-character identifier.
      const { db } = await import("@/lib/db");
      const { eq } = await import("drizzle-orm");
      mockDbSelect.mockResolvedValueOnce([{ id: "imported-uuid", status: "draft" }]);

      const res = await POST(
        makeRequest(validPayload({ job: { jobId: "AB12CD", jobType: "ADEQ Inspection", serviceType: "", scheduledDate: "2026-10-06" } }), VALID_SECRET),
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toMatchObject({ inspectionId: "imported-uuid", duplicate: true });
      expect(eq).toHaveBeenCalledWith("workiz_job_id", "AB12CD");
      expect(db.insert).not.toHaveBeenCalled();
    });
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/app/api/webhooks/workiz/__tests__/route.test.ts`
Expected: PASS. This test pins existing behaviour, so it passes immediately. To confirm it is a real guard, temporarily change `eq(inspections.workizJobId, job.jobId)` in the route to `eq(inspections.workizJobId, "x")`, re-run (FAIL), then revert. Do not commit the change to the route.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/webhooks/workiz/__tests__/route.test.ts
git commit -F - <<'EOF'
test(webhooks): pin that the Workiz webhook dedupes on the import's uuid key

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
```

---
## Wave 2

### Task T8: Assessor opt-in `requireZipMatch`

**Files:**
- Modify: `src/lib/prefill/assessor.ts` (`AddressHints` at lines 126-131, `findParcelByAddress` at lines 152-171, `runAssessorStage` at lines 244-251)
- Test: `src/lib/prefill/__tests__/assessor.test.ts`

**Interfaces:**
- Consumes: `PrefillInput.zipMustMatch?: boolean` (T2).
- Produces: `AddressHints.requireZipMatch?: boolean`. When it is true and a ZIP hint is present, `findParcelByAddress` returns only a row in that ZIP, or `null`. `runAssessorStage` passes `requireZipMatch: true` when `input.zipMustMatch`, and its `searched` text then reads `123 Main St (ZIP 85132)`. Every existing caller is unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/prefill/__tests__/assessor.test.ts`:
```ts
describe("requireZipMatch (Import from Workiz, spec §5.4)", () => {
  // A same-number, same-street parcel on the Maricopa layer in another ZIP
  const OTHER_ZIP = {
    ...FEATURE,
    APN_DASH: "500-01-001",
    PHYSICAL_ADDRESS: "123 W MAIN ST   MESA  85201",
    PHYSICAL_STREET_DIR: "W",
    PHYSICAL_CITY: "MESA",
    PHYSICAL_ZIP: "85201",
  };
  const IN_ZIP = { ...OTHER_ZIP, APN_DASH: "500-01-002", PHYSICAL_ZIP: "85132" };

  it("returns null when every row is in another ZIP", async () => {
    mockFetch.mockResolvedValue(arcgis([OTHER_ZIP]));
    const feature = await findParcelByAddress("123", "Main St", undefined, {
      streetDir: "W",
      zip: "85132",
      requireZipMatch: true,
    });
    expect(feature).toBeNull();
  });

  it("returns the row in the hinted ZIP", async () => {
    mockFetch.mockResolvedValue(arcgis([OTHER_ZIP, IN_ZIP]));
    const feature = await findParcelByAddress("123", "Main St", undefined, {
      zip: "85132",
      requireZipMatch: true,
    });
    expect(feature?.APN_DASH).toBe("500-01-002");
  });

  it("without the flag keeps today's first-row fallback", async () => {
    mockFetch.mockResolvedValue(arcgis([OTHER_ZIP]));
    const feature = await findParcelByAddress("123", "Main St", undefined, { zip: "85132" });
    expect(feature?.APN_DASH).toBe("500-01-001");
  });

  it("with the flag but no ZIP hint behaves as today", async () => {
    mockFetch.mockResolvedValue(arcgis([OTHER_ZIP]));
    const feature = await findParcelByAddress("123", "Main St", undefined, { requireZipMatch: true });
    expect(feature?.APN_DASH).toBe("500-01-001");
  });

  it("runAssessorStage with input.zipMustMatch reports not_found and names the ZIP", async () => {
    mockFetch.mockResolvedValue(arcgis([OTHER_ZIP]));
    const result = await runAssessorStage(
      {
        address: { streetNumber: "123", streetDir: "W", streetName: "Main St", city: "Florence", zip: "85132" },
        zipMustMatch: true,
      },
      makeCtx(),
    );
    expect(result.stage.status).toBe("not_found");
    expect(result.stage.summary).toBe("No parcel found (searched 123 Main St (ZIP 85132))");
    expect(result.proposals).toEqual([]);
  });

  it("runAssessorStage without zipMustMatch still matches the first row (manual runs unchanged)", async () => {
    mockFetch.mockResolvedValue(arcgis([OTHER_ZIP]));
    const result = await runAssessorStage(
      { address: { streetNumber: "123", streetDir: "W", streetName: "Main St", city: "Florence", zip: "85132" } },
      makeCtx(),
    );
    expect(result.stage.status).toBe("done");
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run src/lib/prefill/__tests__/assessor.test.ts`
Expected: FAIL. The "returns null" test gets `500-01-001`, and the stage test gets `done`.

- [ ] **Step 3: Implement**

In `src/lib/prefill/assessor.ts`, extend `AddressHints`:
```ts
export interface AddressHints {
  /** Compass direction as parsed from the input ("E"); anything but N/S/E/W/NE/NW/SE/SW is ignored */
  streetDir?: string;
  /** Input ZIP; compared on its first five digits against the layer's `PHYSICAL_ZIP` */
  zip?: string;
  /**
   * Opt-in (Import from Workiz only): with a ZIP hint, never fall back to a row in another ZIP —
   * return null instead. A Florence "123 W Main St" must not resolve to a Maricopa-layer
   * "123 W MAIN ST" elsewhere at confidence 1.0 (spec §5.4). Without a ZIP hint it has no effect.
   */
  requireZipMatch?: boolean;
}
```
Replace the last three lines of `findParcelByAddress`:
```ts
  const zip = zip5(hints.zip);
  const inZip = zip ? rows.find((row) => zip5(row.PHYSICAL_ZIP) === zip) : undefined;
  if (zip && hints.requireZipMatch) return inZip ?? null;
  return inZip ?? rows[0] ?? null;
```
In `runAssessorStage`, replace the address branch:
```ts
    if (!feature && input.address) {
      const zipHint = input.zipMustMatch ? zip5(input.address.zip) : "";
      searched.push(
        `${input.address.streetNumber} ${input.address.streetName}`.trim() +
          (zipHint ? ` (ZIP ${zipHint})` : ""),
      );
      feature = await findParcelByAddress(
        input.address.streetNumber,
        input.address.streetName,
        { signal: ctx.signal },
        {
          streetDir: input.address.streetDir,
          zip: input.address.zip,
          ...(input.zipMustMatch ? { requireZipMatch: true } : {}),
        },
      );
    }
```
Also update the doc comment above `findParcelByAddress`. Its last sentence becomes: "…a ZIP hint then picks among the rows, else the first row wins as before (unless `requireZipMatch`, see AddressHints)."

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/lib/prefill/__tests__/assessor.test.ts src/lib/prefill/__tests__/run-prefill.test.ts`
Expected: PASS. All existing assessor tests still pass because the flag is opt-in.

- [ ] **Step 5: Commit**

```bash
git add src/lib/prefill/assessor.ts src/lib/prefill/__tests__/assessor.test.ts
git commit -F - <<'EOF'
feat(prefill): opt-in ZIP match for the assessor address lookup (zipMustMatch)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
```

---

### Task T9: `secondary.ts` (namespace, equality, visibility, append) + merge pin tests

**Files:**
- Create: `src/lib/prefill/secondary.ts`
- Test: `src/lib/prefill/__tests__/secondary.test.ts`
- Test: `src/lib/prefill/__tests__/merge.test.ts` (+2 tests, no production change to `merge.ts`)

**Interfaces:**
- Consumes: `formatApn` (`./apn`), `parseStreetAddress`, `normalizeStreetName` (`./input`), `normalizeFieldPath`, `valuesEqual` (`./merge`), `ProvenanceEntry` (`./types`).
- Produces:
  ```ts
  export const SECONDARY_PREFIX = "secondary.";
  export const secondaryKey: (fieldPath: string) => string;          // "secondary.facilityInfo.sellerName"
  export const isSecondaryKey: (key: string) => boolean;
  export const SECONDARY_APPEND_PATHS: ReadonlySet<string>;          // the two comments paths
  export function appendSecondaryText(current: unknown, addition: string): string;
  export function secondaryValuesEqual(fieldPath: string, a: unknown, b: unknown): boolean;
  export function isSecondaryVisible(args: {
    fieldPath: string; secondary?: ProvenanceEntry; primary?: ProvenanceEntry; currentValue: unknown;
  }): boolean;
  ```

- [ ] **Step 1: Write the failing tests**

`src/lib/prefill/__tests__/secondary.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  appendSecondaryText,
  isSecondaryKey,
  isSecondaryVisible,
  SECONDARY_APPEND_PATHS,
  secondaryKey,
  secondaryValuesEqual,
} from "@/lib/prefill/secondary";
import type { ProvenanceEntry } from "@/lib/prefill/types";
import { inspectionFormSchema } from "@/lib/validators/inspection";

const AT = "2026-10-12T17:04:05.000Z";

function workiz(value: ProvenanceEntry["value"], over: Partial<ProvenanceEntry> = {}): ProvenanceEntry {
  return {
    source: "workiz",
    state: "suggested",
    kind: "fill",
    value,
    confidence: 0.85,
    explanation: "Workiz job #4696 · Water Source",
    at: AT,
    ...over,
  };
}

function primary(value: ProvenanceEntry["value"], over: Partial<ProvenanceEntry> = {}): ProvenanceEntry {
  return {
    source: "assessor",
    state: "prefilled",
    kind: "fill",
    value,
    confidence: 1,
    explanation: "Maricopa County Assessor",
    at: AT,
    ...over,
  };
}

describe("key helpers", () => {
  it("namespaces and normalises paths", () => {
    expect(secondaryKey("facilityInfo.sellerName")).toBe("secondary.facilityInfo.sellerName");
    expect(secondaryKey("septicTank.tanks[0].tankCapacity")).toBe("secondary.septicTank.tanks.0.tankCapacity");
    expect(isSecondaryKey("secondary.facilityInfo.sellerName")).toBe(true);
    expect(isSecondaryKey("facilityInfo.sellerName")).toBe(false);
  });

  it("no form root is named `secondary`, so secondary keys can never collide with a real field path", () => {
    expect(Object.keys(inspectionFormSchema.shape)).not.toContain("secondary");
  });

  it("the append paths are exactly the two comments fields", () => {
    expect([...SECONDARY_APPEND_PATHS].sort()).toEqual([
      "disposalWorks.disposalWorksComments",
      "septicTank.septicTankComments",
    ]);
  });
});

describe("appendSecondaryText", () => {
  it("replaces an empty field and appends after a blank line otherwise", () => {
    expect(appendSecondaryText("", "Roots at outlet.")).toBe("Roots at outlet.");
    expect(appendSecondaryText("   ", "Roots at outlet.")).toBe("Roots at outlet.");
    expect(appendSecondaryText(undefined, "Roots at outlet.")).toBe("Roots at outlet.");
    expect(appendSecondaryText("Baffle cracked.  \n", "Roots at outlet.")).toBe(
      "Baffle cracked.\n\nRoots at outlet.",
    );
  });
});

describe("secondaryValuesEqual", () => {
  it("APN: dashes and case normalised", () => {
    expect(secondaryValuesEqual("facilityInfo.taxParcelNumber", "12345678a", "123-45-678A")).toBe(true);
    expect(secondaryValuesEqual("facilityInfo.taxParcelNumber", "123-45-678", "123-45-679")).toBe(false);
  });

  it("address: suffix/case differences are equal; a dropped unit or a different street differs", () => {
    const path = "facilityInfo.facilityAddress";
    expect(secondaryValuesEqual(path, "100 E Example Rd", "100 E EXAMPLE RD")).toBe(true);
    expect(secondaryValuesEqual(path, "100 E Example Road", "100 E EXAMPLE RD")).toBe(true);
    expect(secondaryValuesEqual(path, "100 E Example Rd #12", "100 E EXAMPLE RD")).toBe(false);
    expect(secondaryValuesEqual(path, "100 E Example Rd #12", "100 E Example Rd Space 12")).toBe(true);
    expect(secondaryValuesEqual(path, "100 E Example Rd", "102 E Example Rd")).toBe(false);
    expect(secondaryValuesEqual(path, "100 E Example Rd", "100 E Sample Rd")).toBe(false);
  });

  it("address: falls back to loose text when either side does not parse", () => {
    const path = "facilityInfo.facilityAddress";
    expect(secondaryValuesEqual(path, "Rural Route  Box", "rural route box")).toBe(true);
    expect(secondaryValuesEqual(path, "Rural Route Box", "100 E Example Rd")).toBe(false);
  });

  it("ZIP: first five digits", () => {
    expect(secondaryValuesEqual("facilityInfo.facilityZip", "85331-1234", "85331")).toBe(true);
    expect(secondaryValuesEqual("facilityInfo.facilityZip", "85331", "85332")).toBe(false);
  });

  it("other strings: trimmed, whitespace-collapsed, case-insensitive; non-strings use valuesEqual", () => {
    expect(secondaryValuesEqual("facilityInfo.facilityCity", " cave  creek ", "Cave Creek")).toBe(true);
    expect(secondaryValuesEqual("facilityInfo.waterSource", "private_well", "shared_well")).toBe(false);
    expect(secondaryValuesEqual("x.flag", true, true)).toBe(true);
    expect(secondaryValuesEqual("x.flag", true, "true")).toBe(false);
  });
});

describe("isSecondaryVisible (spec §6.3 truth table)", () => {
  const water = "facilityInfo.waterSource";

  it("hidden when there is no secondary", () => {
    expect(isSecondaryVisible({ fieldPath: water, currentValue: "" })).toBe(false);
  });

  it("visible when the field is empty or differs", () => {
    expect(isSecondaryVisible({ fieldPath: water, secondary: workiz("private_well"), currentValue: "" })).toBe(true);
    expect(
      isSecondaryVisible({
        fieldPath: water,
        secondary: workiz("private_well"),
        primary: primary("municipal", { source: "permit" }),
        currentValue: "municipal",
      }),
    ).toBe(true);
  });

  it("hidden when the field already equals it (also under normalisation)", () => {
    expect(isSecondaryVisible({ fieldPath: water, secondary: workiz("private_well"), currentValue: "private_well" })).toBe(false);
    expect(
      isSecondaryVisible({
        fieldPath: "facilityInfo.facilityAddress",
        secondary: workiz("100 E Example Rd"),
        currentValue: "100 E EXAMPLE RD",
      }),
    ).toBe(false);
  });

  it("hidden while the primary is verified", () => {
    expect(
      isSecondaryVisible({
        fieldPath: water,
        secondary: workiz("private_well"),
        primary: primary("municipal", { state: "verified" }),
        currentValue: "municipal",
      }),
    ).toBe(false);
  });

  it("hidden when the primary is a visible suggested chip with the same value (no duplicate chips)", () => {
    expect(
      isSecondaryVisible({
        fieldPath: water,
        secondary: workiz("private_well"),
        primary: primary("private_well", { state: "suggested", source: "permit" }),
        currentValue: "",
      }),
    ).toBe(false);
  });

  it("visible when the primary suggests a different value", () => {
    expect(
      isSecondaryVisible({
        fieldPath: water,
        secondary: workiz("private_well"),
        primary: primary("shared_well", { state: "suggested", source: "permit" }),
        currentValue: "",
      }),
    ).toBe(true);
  });

  it.each(["septicTank.septicTankComments", "disposalWorks.disposalWorksComments"])(
    "%s: hidden when the field already contains the Workiz text",
    (path) => {
      const secondary = workiz("Roots at outlet.");
      expect(isSecondaryVisible({ fieldPath: path, secondary, currentValue: "Baffle cracked.\n\nRoots at outlet." })).toBe(false);
      expect(isSecondaryVisible({ fieldPath: path, secondary, currentValue: "Baffle cracked." })).toBe(true);
    },
  );

  it("a warning-kind secondary never shows", () => {
    expect(
      isSecondaryVisible({ fieldPath: water, secondary: workiz("", { kind: "warning" }), currentValue: "" }),
    ).toBe(false);
  });
});
```

Append to `src/lib/prefill/__tests__/merge.test.ts`:
```ts
describe("secondary (Workiz) slots — spec §6.2 / §6.3", () => {
  const SECONDARY_SELLER: ProvenanceEntry = {
    source: "workiz",
    state: "suggested",
    kind: "fill",
    value: "Test Client",
    confidence: 0.6,
    explanation: "Workiz client (job #4696)",
    at: "2026-10-12T17:04:05.000Z",
  };
  const ASSESSOR_OWNER: ProposedField = {
    fieldPath: "facilityInfo.sellerName",
    value: "OWNER OF RECORD",
    kind: "fill",
    provenance: { source: "assessor", confidence: 1, explanation: "Maricopa County Assessor · parcel 123-45-678" },
  };

  it("passes secondary.* entries through byte-for-byte whether the primary is filled, suggested or edited", () => {
    const secondaries: FieldProvenance = {
      "secondary.facilityInfo.sellerName": SECONDARY_SELLER,
      "secondary.facilityInfo.waterSource": { ...SECONDARY_SELLER, value: "private_well", confidence: 0.85 },
    };
    // filled (empty field → fill)
    const filled = mergeProposals(form(), { ...secondaries }, [ASSESSOR_OWNER], OPTS);
    // suggested (field holds another value)
    const suggested = mergeProposals(
      form((f) => {
        f.facilityInfo.sellerName = "Someone Else";
      }),
      { ...secondaries },
      [ASSESSOR_OWNER],
      OPTS,
    );
    // edited
    const edited = mergeProposals(
      form((f) => {
        f.facilityInfo.sellerName = "Typed Name";
      }),
      { ...secondaries, "facilityInfo.sellerName": entry({ state: "edited", value: "Typed Name" }) },
      [ASSESSOR_OWNER],
      OPTS,
    );
    for (const result of [filled, suggested, edited]) {
      expect(result.provenance["secondary.facilityInfo.sellerName"]).toBe(secondaries["secondary.facilityInfo.sellerName"]);
      expect(result.provenance["secondary.facilityInfo.waterSource"]).toBe(secondaries["secondary.facilityInfo.waterSource"]);
      expect(result.fills.some((f) => f.fieldPath.startsWith("secondary."))).toBe(false);
    }
    expect(filled.provenance["facilityInfo.sellerName"].state).toBe("prefilled");
    expect(suggested.provenance["facilityInfo.sellerName"].state).toBe("suggested");
    expect(edited.provenance["facilityInfo.sellerName"].state).toBe("suggested");
  });

  it("regression: an accepted Workiz seller name (edited, source workiz) survives the assessor owner at 1.0", () => {
    const accepted: ProvenanceEntry = { ...SECONDARY_SELLER, state: "edited" };
    const { fills, provenance } = mergeProposals(
      form((f) => {
        f.facilityInfo.sellerName = "Test Client";
      }),
      { "facilityInfo.sellerName": accepted, "secondary.facilityInfo.sellerName": SECONDARY_SELLER },
      [ASSESSOR_OWNER],
      OPTS,
    );
    expect(fills).toEqual([]);
    expect(provenance["facilityInfo.sellerName"]).toMatchObject({
      source: "assessor",
      state: "suggested",
      value: "OWNER OF RECORD",
      prior: accepted,
    });
    expect(provenance["secondary.facilityInfo.sellerName"]).toBe(SECONDARY_SELLER);
  });
});
```

- [ ] **Step 2: Run them and confirm the new module fails**

Run: `npx vitest run src/lib/prefill/__tests__/secondary.test.ts src/lib/prefill/__tests__/merge.test.ts`
Expected: `secondary.test.ts` FAILs (module not found). The two merge tests PASS already. They pin current `mergeProposals` behaviour, and no merge change is intended.

- [ ] **Step 3: Implement**

`src/lib/prefill/secondary.ts`:
```ts
import { formatApn } from "./apn";
import { normalizeStreetName, parseStreetAddress } from "./input";
import { normalizeFieldPath, valuesEqual } from "./merge";
import type { ProvenanceEntry } from "./types";

/**
 * Import from Workiz keeps its suggestions in the SAME field_provenance map under
 * `secondary.<fieldPath>` keys (spec §6.2). mergeProposals never writes them (no proposal path
 * starts with `secondary.`), persistence rides the existing whole-map PATCH, and no form root is
 * named `secondary`. ANY code that iterates field_provenance — counters ("12 fields prefilled"),
 * exports, badges — MUST skip `isSecondaryKey(key)`.
 */
export const SECONDARY_PREFIX = "secondary.";

export const secondaryKey = (fieldPath: string): string =>
  `${SECONDARY_PREFIX}${normalizeFieldPath(fieldPath)}`;

export const isSecondaryKey = (key: string): boolean => key.startsWith(SECONDARY_PREFIX);

/** The two free-text targets: accepting appends to existing text instead of replacing it (§6.3) */
export const SECONDARY_APPEND_PATHS: ReadonlySet<string> = new Set([
  "septicTank.septicTankComments",
  "disposalWorks.disposalWorksComments",
]);

/** `current.trimEnd() + "\n\n" + addition`, or just `addition` when the field is empty */
export function appendSecondaryText(current: unknown, addition: string): string {
  const existing = typeof current === "string" ? current : "";
  return existing.trim() ? `${existing.trimEnd()}\n\n${addition}` : addition;
}

const looseText = (value: string): string => value.replace(/\s+/g, " ").trim().toLowerCase();

const UNIT_WORD = /^(UNIT|APT|STE|SUITE|SPACE|SPC|LOT)$/i;

/** "100 E Example Rd Space 12" → { street: "100 E Example Rd", unit: "12" } */
function splitUnit(line: string): { street: string; unit: string } {
  const words = line.replace(/\s+/g, " ").trim().split(" ");
  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    const rest = (from: number) => words.slice(from).join("").replace(/#/g, "").toUpperCase();
    if (word.startsWith("#")) return { street: words.slice(0, i).join(" "), unit: rest(i) };
    const next = words[i + 1];
    // A unit word only counts when a unit token follows ("Lot Rd" is a street, "Lot 7" a unit)
    if (UNIT_WORD.test(word) && next && /^#?[A-Za-z0-9-]{1,8}$/.test(next) && (/\d/.test(next) || /^#?[A-Za-z]$/.test(next))) {
      return { street: words.slice(0, i).join(" "), unit: rest(i + 1) };
    }
  }
  return { street: words.join(" "), unit: "" };
}

function addressesEqual(a: string, b: string): boolean {
  const left = splitUnit(a);
  const right = splitUnit(b);
  const pa = parseStreetAddress(left.street);
  const pb = parseStreetAddress(right.street);
  if (!pa || !pb) return looseText(a) === looseText(b);
  return (
    pa.streetNumber === pb.streetNumber &&
    (pa.streetDir ?? "") === (pb.streetDir ?? "") &&
    normalizeStreetName(pa.streetName) === normalizeStreetName(pb.streetName) &&
    left.unit === right.unit
  );
}

function zip5(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 5 ? digits.slice(0, 5) : looseText(value);
}

/** Path-aware equality used to hide a secondary chip that says nothing new (spec §6.2) */
export function secondaryValuesEqual(fieldPath: string, a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string") return valuesEqual(a, b);
  const path = normalizeFieldPath(fieldPath);
  if (path === "facilityInfo.taxParcelNumber") {
    const fa = formatApn(a);
    const fb = formatApn(b);
    if (fa && fb) return fa === fb;
  }
  if (path === "facilityInfo.facilityAddress") return addressesEqual(a, b);
  if (path === "facilityInfo.facilityZip") return zip5(a) === zip5(b);
  return looseText(a) === looseText(b);
}

/**
 * Chip visibility (spec §6.3): the secondary exists, the field's value differs from it, the
 * primary is not verified, the primary is not itself a visible suggested chip with an equal
 * value, and — for the two comments paths — the field does not already contain the text.
 */
export function isSecondaryVisible(args: {
  fieldPath: string;
  secondary?: ProvenanceEntry;
  primary?: ProvenanceEntry;
  currentValue: unknown;
}): boolean {
  const { secondary, primary, currentValue } = args;
  const fieldPath = normalizeFieldPath(args.fieldPath);
  if (!secondary || secondary.kind !== "fill") return false;
  if (secondaryValuesEqual(fieldPath, currentValue, secondary.value)) return false;
  if (primary?.state === "verified") return false;
  if (
    primary?.state === "suggested" &&
    primary.kind === "fill" &&
    !valuesEqual(currentValue, primary.value) &&
    secondaryValuesEqual(fieldPath, primary.value, secondary.value)
  ) {
    return false;
  }
  if (
    SECONDARY_APPEND_PATHS.has(fieldPath) &&
    typeof currentValue === "string" &&
    typeof secondary.value === "string" &&
    currentValue.includes(secondary.value.trim())
  ) {
    return false;
  }
  return true;
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/lib/prefill/__tests__/secondary.test.ts src/lib/prefill/__tests__/merge.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint and commit**

```bash
npx biome lint src/lib/prefill/secondary.ts src/lib/prefill/__tests__/secondary.test.ts
git add src/lib/prefill/secondary.ts src/lib/prefill/__tests__/secondary.test.ts src/lib/prefill/__tests__/merge.test.ts
git commit -F - <<'EOF'
feat(prefill): add secondary provenance slot helpers for Workiz suggestions

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
```

---

### Task T10: Workiz HTTP client (`client.ts`) + client-boundary test

**Files:**
- Create: `src/lib/workiz/client.ts`
- Test: `src/lib/workiz/__tests__/client.test.ts`
- Test: `src/lib/workiz/__tests__/boundary.test.ts`

**Interfaces:**
- Consumes: the `server-only` alias (T1).
- Produces:
  ```ts
  export type WorkizErrorCode = "not_configured" | "auth_failed" | "not_found" | "rate_limited" | "unavailable" | "bad_response";
  export class WorkizError extends Error { readonly code: WorkizErrorCode; readonly status?: number; constructor(code: WorkizErrorCode, status?: number) }
  export const WORKIZ_DEFAULT_BASE = "https://api.workiz.com/crm/api/v2";
  export const WORKIZ_USER_AGENT = "SewerTime-InspectionFormFiller/1.0";
  export const WORKIZ_REQUEST_TIMEOUT_MS = 15_000;
  export const WORKIZ_MAX_RETRY_WAIT_MS = 6_000;
  export function getWorkizConfig(): { token: string; base: string } | null;
  export function combineSignals(signals: Array<AbortSignal | undefined>, timeoutMs?: number): { signal: AbortSignal; dispose: () => void };
  export function waitFor(ms: number, signal?: AbortSignal): Promise<void>;   // rejects WorkizError("unavailable") on abort
  export async function workizGet<T>(path: string, query?: Record<string, string>, opts?: { signal?: AbortSignal }): Promise<T>;
  ```
  The timeouts are `setTimeout`-based rather than `AbortSignal.timeout`, so vitest fake timers drive them. This is equivalent to the spec's `AbortSignal.timeout(…)`.

- [ ] **Step 1: Write the failing tests**

`src/lib/workiz/__tests__/client.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  combineSignals,
  getWorkizConfig,
  WORKIZ_USER_AGENT,
  WorkizError,
  workizGet,
} from "@/lib/workiz/client";

const TOKEN = "f".repeat(64);
const mockFetch = vi.fn();

function res(status: number, body: string, headers: Record<string, string> = {}) {
  return { status, ok: status >= 200 && status < 300, headers: new Headers(headers), text: async () => body };
}
const json = (status: number, data: unknown, headers: Record<string, string> = {}) =>
  res(status, JSON.stringify(data), { "content-type": "application/json", ...headers });

let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  vi.stubEnv("WORKIZ_API_V2_TOKEN", TOKEN);
  vi.stubEnv("WORKIZ_API_V2_BASE", "");
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  mockFetch.mockReset();
});

/** Runs a call to completion under fake timers and returns its rejection (or resolution) */
async function settle<T>(promise: Promise<T>): Promise<T | unknown> {
  const outcome = promise.then(
    (value) => value,
    (err) => err,
  );
  await vi.runAllTimersAsync();
  return outcome;
}

function loggedText(): string {
  return JSON.stringify([...warnSpy.mock.calls, ...errorSpy.mock.calls]);
}

describe("getWorkizConfig", () => {
  it("defaults the base and trims the token (a pasted trailing newline must not 401)", () => {
    vi.stubEnv("WORKIZ_API_V2_TOKEN", `  ${TOKEN}\n`);
    expect(getWorkizConfig()).toEqual({ token: TOKEN, base: "https://api.workiz.com/crm/api/v2" });
  });

  it("returns null for a missing or whitespace-only token", () => {
    vi.stubEnv("WORKIZ_API_V2_TOKEN", "");
    expect(getWorkizConfig()).toBeNull();
    vi.stubEnv("WORKIZ_API_V2_TOKEN", " \n ");
    expect(getWorkizConfig()).toBeNull();
  });

  it("accepts an https base override and strips trailing slashes", () => {
    vi.stubEnv("WORKIZ_API_V2_BASE", " https://staging.example.com/crm/api/v2/ ");
    expect(getWorkizConfig()?.base).toBe("https://staging.example.com/crm/api/v2");
  });

  it("rejects a non-https base so the bearer token is never sent in cleartext", () => {
    vi.stubEnv("WORKIZ_API_V2_BASE", "http://api.workiz.com/crm/api/v2");
    expect(getWorkizConfig()).toBeNull();
    expect(loggedText()).toContain("WORKIZ_API_V2_BASE rejected: not https");
  });
});

describe("workizGet", () => {
  it("sends a GET with Bearer, User-Agent and Accept to the exact URL", async () => {
    mockFetch.mockResolvedValue(json(200, { ok: 1 }));
    const data = await workizGet<{ ok: number }>("/jobs", { isOpen: "true", page: "1" });
    expect(data).toEqual({ ok: 1 });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.workiz.com/crm/api/v2/jobs?isOpen=true&page=1");
    expect(init.method).toBe("GET");
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/json",
      "User-Agent": WORKIZ_USER_AGENT,
    });
    expect(WORKIZ_USER_AGENT).toBe("SewerTime-InspectionFormFiller/1.0");
  });

  it("uses the trimmed token in the header", async () => {
    vi.stubEnv("WORKIZ_API_V2_TOKEN", `${TOKEN}\n`);
    mockFetch.mockResolvedValue(json(200, {}));
    await workizGet("/jobs");
    expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("not_configured without a token or with a non-https base — and never fetches", async () => {
    vi.stubEnv("WORKIZ_API_V2_TOKEN", "");
    await expect(workizGet("/jobs")).rejects.toMatchObject({ name: "WorkizError", code: "not_configured" });
    vi.stubEnv("WORKIZ_API_V2_TOKEN", TOKEN);
    vi.stubEnv("WORKIZ_API_V2_BASE", "http://evil.example.com");
    await expect(workizGet("/jobs")).rejects.toMatchObject({ code: "not_configured" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([
    [json(401, { statusCode: 401 }), "auth_failed"],
    [json(403, { statusCode: 403 }), "auth_failed"],
    [res(403, "<html>Cloudflare</html>", { "content-type": "text/html" }), "unavailable"],
    [json(404, { statusCode: 404 }), "not_found"],
  ])("maps %# without retrying", async (response, code) => {
    mockFetch.mockResolvedValue(response);
    await expect(workizGet("/jobs/JOB-AbCdEf")).rejects.toMatchObject({ code });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("429 → waits 1 s and retries", async () => {
    vi.useFakeTimers();
    mockFetch.mockResolvedValueOnce(json(429, { statusCode: 429 })).mockResolvedValueOnce(json(200, { ok: 1 }));
    const promise = workizGet("/jobs", { page: "2" });
    await vi.advanceTimersByTimeAsync(999);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toEqual({ ok: 1 });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(loggedText()).toContain("[workiz] GET /jobs page=2 → 429 (retry 1)");
  });

  it("429 three times → rate_limited after waits of 1 s then 2 s", async () => {
    vi.useFakeTimers();
    mockFetch.mockResolvedValue(json(429, { statusCode: 429 }));
    const err = await settle(workizGet("/jobs"));
    expect(err).toBeInstanceOf(WorkizError);
    expect(err).toMatchObject({ code: "rate_limited" });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("honours Retry-After, capped at 5 s, within the 6 s total wait budget", async () => {
    vi.useFakeTimers();
    mockFetch.mockResolvedValue(json(429, { statusCode: 429 }, { "retry-after": "10" }));
    const promise = workizGet("/jobs");
    const outcome = promise.catch((e) => e);
    await vi.advanceTimersByTimeAsync(4999);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    // a second 5 s wait would exceed the 6 s budget → give up
    await vi.runAllTimersAsync();
    expect(await outcome).toMatchObject({ code: "rate_limited" });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("5xx → one retry after 1 s, then unavailable", async () => {
    vi.useFakeTimers();
    mockFetch.mockResolvedValueOnce(json(503, {})).mockResolvedValueOnce(json(200, { ok: 1 }));
    await expect(settle(workizGet("/jobs"))).resolves.toEqual({ ok: 1 });
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(json(502, {}));
    expect(await settle(workizGet("/jobs"))).toMatchObject({ code: "unavailable", status: 502 });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("network error and non-JSON 200 are retried once", async () => {
    vi.useFakeTimers();
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(json(200, { ok: 1 }));
    await expect(settle(workizGet("/jobs"))).resolves.toEqual({ ok: 1 });
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(res(200, "<html>not json</html>", { "content-type": "text/html" }));
    expect(await settle(workizGet("/jobs"))).toMatchObject({ code: "unavailable" });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("times out each attempt at 15 s (one retry) → unavailable", async () => {
    vi.useFakeTimers();
    mockFetch.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(init.signal.reason));
        }),
    );
    const outcome = workizGet("/jobs").catch((e) => e);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000 + 15_000);
    expect(await outcome).toMatchObject({ code: "unavailable" });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("a caller abort ends the call as unavailable with no retry", async () => {
    const controller = new AbortController();
    mockFetch.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(init.signal.reason));
        }),
    );
    const outcome = workizGet("/jobs", {}, { signal: controller.signal }).catch((e) => e);
    controller.abort();
    expect(await outcome).toMatchObject({ code: "unavailable" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("only ever calls fetch with GET and never logs the token", async () => {
    vi.useFakeTimers();
    mockFetch.mockResolvedValueOnce(json(429, {})).mockResolvedValueOnce(json(500, {})).mockResolvedValue(json(401, {}));
    await settle(workizGet("/jobs", { page: "1" }));
    for (const [, init] of mockFetch.mock.calls) expect(init.method).toBe("GET");
    expect(loggedText()).not.toContain(TOKEN);
  });
});

describe("combineSignals", () => {
  it("aborts after the timeout, or when any input aborts; dispose clears the timer", async () => {
    vi.useFakeTimers();
    const timed = combineSignals([], 100);
    expect(timed.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(timed.signal.aborted).toBe(true);

    const input = new AbortController();
    const linked = combineSignals([input.signal]);
    input.abort();
    expect(linked.signal.aborted).toBe(true);

    const disposed = combineSignals([], 100);
    disposed.dispose();
    await vi.advanceTimersByTimeAsync(200);
    expect(disposed.signal.aborted).toBe(false);
  });
});
```

`src/lib/workiz/__tests__/boundary.test.ts`:
```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Second line of defence behind `import "server-only"` in client.ts (spec §12): no client
 * component and nothing under src/components may import the Workiz server modules.
 */
const SRC = join(process.cwd(), "src");
const WORKIZ_IMPORT = /(?:from\s+|import\s*\(\s*|import\s+)["'][^"']*lib\/workiz(?:\/[^"']*)?["']/;
const USE_CLIENT = /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : walk(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("Workiz client boundary", () => {
  it("the detectors work", () => {
    expect(WORKIZ_IMPORT.test('import { workizGet } from "@/lib/workiz/client";')).toBe(true);
    expect(WORKIZ_IMPORT.test('import type { WorkizJob } from "../../lib/workiz/schema";')).toBe(true);
    expect(WORKIZ_IMPORT.test('import type { WorkizJobsResponse } from "@/types/workiz-import";')).toBe(false);
    expect(USE_CLIENT.test('"use client";\nimport x from "y";')).toBe(true);
    expect(USE_CLIENT.test('import x from "y";\n// "use client"')).toBe(false);
  });

  it('no "use client" file and nothing under src/components imports @/lib/workiz/*', () => {
    const offenders = walk(SRC)
      .filter((file) => {
        const text = readFileSync(file, "utf8");
        const inComponents = relative(SRC, file).split(sep)[0] === "components";
        return (inComponents || USE_CLIENT.test(text)) && WORKIZ_IMPORT.test(text);
      })
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run src/lib/workiz/__tests__/client.test.ts src/lib/workiz/__tests__/boundary.test.ts`
Expected: `client.test.ts` FAILs (module not found). `boundary.test.ts` PASSes (nothing imports the module yet). It is a guard for later tasks.

- [ ] **Step 3: Implement**

`src/lib/workiz/client.ts`:
```ts
import "server-only";

/**
 * GET-only Workiz v2 HTTP client (spec §7.2). The token's real scope is unknown and may allow
 * writes, so no other method is ever exported. The token is read only here, trimmed, and never
 * logged; logs carry the path, the page number, the status and the attempt only.
 */

export type WorkizErrorCode =
  | "not_configured"
  | "auth_failed"
  | "not_found"
  | "rate_limited"
  | "unavailable"
  | "bad_response";

export class WorkizError extends Error {
  readonly code: WorkizErrorCode;
  readonly status?: number;

  constructor(code: WorkizErrorCode, status?: number) {
    super(`Workiz ${code}${status ? ` (HTTP ${status})` : ""}`);
    this.name = "WorkizError";
    this.code = code;
    this.status = status;
  }
}

export const WORKIZ_DEFAULT_BASE = "https://api.workiz.com/crm/api/v2";
/** Cloudflare 403s some default UAs (Python-urllib); always send our own (spec §7.1) */
export const WORKIZ_USER_AGENT = "SewerTime-InspectionFormFiller/1.0";
export const WORKIZ_REQUEST_TIMEOUT_MS = 15_000;
/** Cap on the total time spent waiting between retries, so an interactive request never hangs */
export const WORKIZ_MAX_RETRY_WAIT_MS = 6_000;
const RATE_LIMIT_WAITS_MS = [1_000, 2_000];
const RETRY_AFTER_CAP_S = 5;
const TRANSIENT_RETRY_WAIT_MS = 1_000;

let baseRejectionLogged = false;

export function getWorkizConfig(): { token: string; base: string } | null {
  const token = (process.env.WORKIZ_API_V2_TOKEN ?? "").trim();
  if (!token) return null;
  const base =
    (process.env.WORKIZ_API_V2_BASE ?? "").trim().replace(/\/+$/, "") || WORKIZ_DEFAULT_BASE;
  if (!base.startsWith("https://")) {
    if (!baseRejectionLogged) {
      baseRejectionLogged = true;
      console.error("[workiz] WORKIZ_API_V2_BASE rejected: not https");
    }
    return null;
  }
  return { token, base };
}

/**
 * One AbortSignal that fires when any input fires or after `timeoutMs`. setTimeout-based
 * (not AbortSignal.timeout) so vitest fake timers drive it. Always call dispose().
 */
export function combineSignals(
  signals: Array<AbortSignal | undefined>,
  timeoutMs?: number,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const cleanups: Array<() => void> = [];
  const abort = (reason: unknown): void => {
    if (!controller.signal.aborted) controller.abort(reason);
  };
  for (const input of signals) {
    if (!input) continue;
    if (input.aborted) {
      abort(input.reason);
      continue;
    }
    const onAbort = (): void => abort(input.reason);
    input.addEventListener("abort", onAbort, { once: true });
    cleanups.push(() => input.removeEventListener("abort", onAbort));
  }
  if (timeoutMs !== undefined) {
    const timer = setTimeout(() => abort(new DOMException("Timed out", "TimeoutError")), timeoutMs);
    cleanups.push(() => clearTimeout(timer));
  }
  return {
    signal: controller.signal,
    dispose: () => {
      for (const cleanup of cleanups) cleanup();
    },
  };
}

/** Sleep that ends early (as `unavailable`) when the caller's deadline fires */
export function waitFor(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new WorkizError("unavailable"));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new WorkizError("unavailable"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

type Attempt<T> =
  | { kind: "ok"; data: T }
  | { kind: "rate_limited"; status: number; retryAfterMs?: number }
  | { kind: "transient"; status?: number };

function retryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.min(seconds, RETRY_AFTER_CAP_S) * 1000;
}

async function attemptOnce<T>(url: string, token: string, signal: AbortSignal): Promise<Attempt<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "User-Agent": WORKIZ_USER_AGENT,
      },
      signal,
      cache: "no-store",
    });
  } catch {
    return { kind: "transient" }; // network error or the 15 s timeout
  }
  if (res.status === 401) throw new WorkizError("auth_failed", 401);
  if (res.status === 403) {
    // JSON 403 = Workiz refusing the token; HTML 403 = Cloudflare in front of it
    const isJson = (res.headers.get("content-type") ?? "").toLowerCase().includes("json");
    throw new WorkizError(isJson ? "auth_failed" : "unavailable", 403);
  }
  if (res.status === 404) throw new WorkizError("not_found", 404);
  if (res.status === 429) {
    return { kind: "rate_limited", status: 429, retryAfterMs: retryAfterMs(res.headers.get("retry-after")) };
  }
  if (res.status >= 500) return { kind: "transient", status: res.status };
  if (!res.ok) throw new WorkizError("unavailable", res.status);
  try {
    return { kind: "ok", data: JSON.parse(await res.text()) as T };
  } catch {
    return { kind: "transient", status: res.status }; // non-JSON 200 or a body cut off
  }
}

/**
 * GET `${base}${path}?${query}`. Retries: 429 → 1 s then 2 s (or Retry-After, capped at 5 s);
 * 5xx / network / timeout / non-JSON 200 → one retry after 1 s; total waiting ≤ 6 s.
 * `path` must already be encoded (callers encodeURIComponent any id).
 */
export async function workizGet<T>(
  path: string,
  query: Record<string, string> = {},
  opts: { signal?: AbortSignal } = {},
): Promise<T> {
  const config = getWorkizConfig();
  if (!config) throw new WorkizError("not_configured");
  const qs = new URLSearchParams(query).toString();
  const url = `${config.base}${path}${qs ? `?${qs}` : ""}`;
  const label = `GET ${path}${query.page ? ` page=${query.page}` : ""}`;

  let rateRetries = 0;
  let transientRetries = 0;
  let waitedMs = 0;
  for (;;) {
    if (opts.signal?.aborted) throw new WorkizError("unavailable");
    const attemptSignal = combineSignals([opts.signal], WORKIZ_REQUEST_TIMEOUT_MS);
    let attempt: Attempt<T>;
    try {
      attempt = await attemptOnce<T>(url, config.token, attemptSignal.signal);
    } finally {
      attemptSignal.dispose();
    }
    if (attempt.kind === "ok") return attempt.data;
    if (opts.signal?.aborted) throw new WorkizError("unavailable");

    let waitMs: number | null = null;
    if (attempt.kind === "rate_limited" && rateRetries < RATE_LIMIT_WAITS_MS.length) {
      waitMs = attempt.retryAfterMs ?? RATE_LIMIT_WAITS_MS[rateRetries];
      rateRetries += 1;
    } else if (attempt.kind === "transient" && transientRetries < 1) {
      waitMs = TRANSIENT_RETRY_WAIT_MS;
      transientRetries += 1;
    }
    const status = attempt.status ?? "network";
    if (waitMs === null || waitedMs + waitMs > WORKIZ_MAX_RETRY_WAIT_MS) {
      console.warn(`[workiz] ${label} → ${status} (giving up)`);
      throw new WorkizError(attempt.kind === "rate_limited" ? "rate_limited" : "unavailable", attempt.status);
    }
    console.warn(`[workiz] ${label} → ${status} (retry ${rateRetries + transientRetries})`);
    waitedMs += waitMs;
    await waitFor(waitMs, opts.signal);
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/lib/workiz/__tests__/client.test.ts src/lib/workiz/__tests__/boundary.test.ts`
Expected: PASS. If a fake-timer test hangs, check that every retry wait goes through `waitFor` and every attempt timeout through `combineSignals` (both use `setTimeout`).

- [ ] **Step 5: Type check, lint, commit**

Run the TypeScript baseline filter command (expected: no output), then:
```bash
npx biome lint src/lib/workiz/client.ts src/lib/workiz/__tests__/client.test.ts src/lib/workiz/__tests__/boundary.test.ts
git add src/lib/workiz/client.ts src/lib/workiz/__tests__/client.test.ts src/lib/workiz/__tests__/boundary.test.ts
git commit -F - <<'EOF'
feat(workiz-import): add server-only GET-only Workiz v2 client with retries and typed errors

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
```

---

### Task T11: Job schema, ADEQ rules and synthetic fixtures

**Files:**
- Create: `src/lib/workiz/schema.ts`
- Create: `src/lib/workiz/adeq.ts`
- Create: `src/lib/workiz/__tests__/fixtures/jobs.ts`
- Test: `src/lib/workiz/__tests__/schema.test.ts`
- Test: `src/lib/workiz/__tests__/adeq.test.ts`

**Interfaces:**
- Consumes: `formatWorkizStreet`, `formatWorkizCity` (T6).
- Produces:
  ```ts
  // schema.ts
  export const workizJobSchema: z.ZodType<…>;           // lenient, z.looseObject (passthrough)
  export type WorkizJob = z.output<typeof workizJobSchema>;
  //   { id: string; uuid: string; serialId: number | null; status: string;
  //     subStatus: { id: string; name: string } | null; jobType: { id: string; name: string } | null;
  //     date: string | null; customFields: Array<{ id: string; fieldName: string; value: string | boolean | null }>;
  //     notes: Array<{ note: string; timestamp: string }>; team: Array<{ id: string; name: string }>;
  //     clientInfo: { firstName; lastName; companyName; email: string;
  //                   addressDetails: { address; unit; city; state; zipCode: string } } }
  export const workizJobsPageSchema;                     // { data: unknown[]; hasMore: boolean; … }
  export function parseWorkizJob(raw: unknown): WorkizJob | null;
  export function serialIdForLog(raw: unknown): string;   // "4696" or "?"
  // adeq.ts
  export const WORKIZ_STATUS_DONE_PENDING_APPROVAL = "done pending approval";
  export const ADEQ_JOB_TYPE_IDS: ReadonlySet<string>;
  export const IMPORT_ALLOWED_STATUSES: ReadonlySet<string>;
  export const WORKIZ_CF: { apn; waterSource; tankSize; effluentFilter; flowTestCompleted; tankRecommendation; drainfieldRecommendation; notableConcerns; flowTestDescription };
  export function isAdeqJob(job: WorkizJob): boolean;
  export function isImportable(job: WorkizJob): boolean;
  export function canImportNow(job: WorkizJob): boolean;
  export function scheduledDateOf(job: WorkizJob): string | null;   // "2026-10-06"
  export function teamNames(job: WorkizJob): string[];              // trimmed, non-empty, de-duplicated, Workiz order
  export function teamFirstNames(job: WorkizJob): string[];
  export interface WorkizJobSummary { id: string; uuid: string; serialId: number | null; street: string; city: string; scheduledDate: string | null; subStatus: string | null; teamFirstNames: string[] }
  export function toJobSummary(job: WorkizJob): WorkizJobSummary;
  // fixtures/jobs.ts
  export const JOB_ID, JOB_UUID, SERIAL; rawJob(over?), job(over?), withAddress(details, over?), withClient(client, over?), cf(id, value, fieldName?), note(text, timestamp), BOT_NOTES, fixtures.{importable, onlineBooking, nonAdeq, submitted, canceled, done, unscheduled, noSubStatus, emptyUuid, lowercaseCity, unit, emptyTeam, multiTeam, nonMaricopa}
  ```

- [ ] **Step 1: Create the fixtures**

`src/lib/workiz/__tests__/fixtures/jobs.ts`:
```ts
/**
 * SYNTHETIC Workiz jobs, shaped like the live v2 API (spec §13). Fake names, example.com
 * emails, 555-01xx phones, "Example" streets and 123-45-6xx APNs only — never paste real
 * Workiz data (or anything from a backup) into this file.
 */
import { WORKIZ_CF } from "@/lib/workiz/adeq";
import { type WorkizJob, workizJobSchema } from "@/lib/workiz/schema";

type Raw = Record<string, unknown>;

export const JOB_ID = "JOB-AbCdEfGhIjKlMnOp";
export const JOB_UUID = "AB12CD";
export const SERIAL = 4696;

export function rawJob(over: Raw = {}): Raw {
  return {
    id: JOB_ID,
    uuid: JOB_UUID,
    serialId: SERIAL,
    status: "done pending approval",
    subStatus: { id: "SS-test0001", name: "Job Complete - Reports Required" },
    jobType: { id: "JT-a5DbVzyREDgGvdWK", name: "ADEQ Septic Inspection " },
    date: "2026-10-06 12:00:00",
    latitude: -1,
    longitude: -1,
    description: "Synthetic test job",
    customFields: [],
    notes: [],
    team: [
      { id: 101, name: "Alex Tester" },
      { id: 102, name: "Sam Sample" },
    ],
    clientInfo: {
      firstName: "Test",
      lastName: "Client",
      companyName: "",
      email: "test.client@example.com",
      primaryPhone: "555-0100",
      secondaryPhone: "555-0101",
      addressDetails: {
        address: "100 E Example Rd",
        unit: "",
        city: "Cave Creek",
        state: "AZ",
        zipCode: "85331",
      },
    },
    ...over,
  };
}

export const job = (over: Raw = {}): WorkizJob => workizJobSchema.parse(rawJob(over));

export function withAddress(details: Raw, over: Raw = {}): Raw {
  const base = rawJob(over);
  const client = base.clientInfo as Raw;
  return {
    ...base,
    clientInfo: { ...client, addressDetails: { ...(client.addressDetails as Raw), ...details } },
  };
}

export function withClient(client: Raw, over: Raw = {}): Raw {
  const base = rawJob(over);
  return { ...base, clientInfo: { ...(base.clientInfo as Raw), ...client } };
}

/** `value` is `unknown` so tests can feed malformed values (objects) through the lenient schema */
export function cf(id: string, value: unknown, fieldName = "Synthetic field "): Raw {
  return { id, fieldName, value };
}

export const note = (text: string, timestamp: string): Raw => ({ note: text, timestamp });

/** The three live permit-bot note shapes (spec §5.3), plus variants */
export const BOT_NOTES = {
  grokHigh: note("Permit added by Grok Bot. Confidence high. APN 123-45-678, permit OW-00-00001 added.", "2026-10-01 09:00:00"),
  plainHighSuffix: note("Permit added. Confidence high. APN 123-45-678K, permit OW-00-00002 added.", "2026-10-02 09:00:00"),
  parenthesizedMedium: note("Permit added. Confidence medium, see file (APN 123-45-678Z, permit OW-00-00003).", "2026-10-03 09:00:00"),
  noConfidence: note("Permit added. APN 123-45-679, permit OW-00-00004.", "2026-10-04 09:00:00"),
  grokLow: note("Permit added by Grok Bot. Confidence low. APN 123-45-680, permit OW-00-00005.", "2026-10-05 09:00:00"),
  notABotNote: note("Customer called, APN 123-45-681 per county site.", "2026-10-09 09:00:00"),
};

export const CF_IDS = WORKIZ_CF;

export const fixtures = {
  importable: () => rawJob(),
  onlineBooking: () =>
    rawJob({
      id: "JOB-OnlineBooking00001",
      uuid: "OB12CD",
      serialId: 4700,
      jobType: { id: "JT-ly4RYx5nKd2z30dw", name: "ADEQ Inspection - Online Booking" },
    }),
  nonAdeq: () =>
    rawJob({
      id: "JOB-Pumping0000000001",
      uuid: "PU12CD",
      serialId: 4701,
      jobType: { id: "JT-pumping0000000001", name: "Septic Pumping" },
    }),
  submitted: () => rawJob({ status: "Submitted" }),
  canceled: () => rawJob({ status: "Canceled" }),
  done: () => rawJob({ status: "Done" }),
  unscheduled: () => rawJob({ id: "JOB-Unscheduled000001", uuid: "UN12CD", serialId: 4650, date: null }),
  noSubStatus: () => rawJob({ subStatus: null }),
  emptyUuid: () => rawJob({ uuid: "" }),
  lowercaseCity: () => withAddress({ address: "300 N Demo Ln", city: "laveen", zipCode: "85339" }),
  unit: () => withAddress({ unit: "12" }),
  emptyTeam: () => rawJob({ team: [] }),
  multiTeam: () =>
    rawJob({
      team: [
        { id: 1, name: " Alex Tester " },
        { id: 2, name: "Sam Sample" },
        { id: 3, name: "Alex Tester" },
        { id: 4, name: "" },
        { id: 5, name: "alex Other" },
      ],
    }),
  nonMaricopa: () => withAddress({ address: "123 W Main St", city: "Florence", zipCode: "85132" }),
};
```

- [ ] **Step 2: Write the failing tests**

`src/lib/workiz/__tests__/schema.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseWorkizJob, serialIdForLog, workizJobsPageSchema } from "@/lib/workiz/schema";
import { cf, fixtures, rawJob, withAddress } from "./fixtures/jobs";

describe("workizJobSchema (lenient boundary, spec §7.3)", () => {
  it("parses the live job shape and keeps unknown fields (passthrough)", () => {
    const job = parseWorkizJob(rawJob());
    expect(job).toMatchObject({
      id: "JOB-AbCdEfGhIjKlMnOp",
      uuid: "AB12CD",
      serialId: 4696,
      status: "done pending approval",
      subStatus: { name: "Job Complete - Reports Required" },
      jobType: { id: "JT-a5DbVzyREDgGvdWK" },
      date: "2026-10-06 12:00:00",
      clientInfo: { firstName: "Test", addressDetails: { city: "Cave Creek", zipCode: "85331" } },
    });
    expect((job as Record<string, unknown>).latitude).toBe(-1);
  });

  it("defaults missing arrays, null subStatus/date, and a missing clientInfo", () => {
    const job = parseWorkizJob({ id: "JOB-Minimal0000000001" });
    expect(job).toMatchObject({
      uuid: "",
      serialId: null,
      status: "",
      subStatus: null,
      jobType: null,
      date: null,
      customFields: [],
      notes: [],
      team: [],
      clientInfo: { firstName: "", email: "", addressDetails: { address: "", zipCode: "" } },
    });
  });

  it("coerces numeric zip/ids to strings and serialId strings to numbers", () => {
    const job = parseWorkizJob(withAddress({ zipCode: 85331 }, { serialId: "4696", team: [{ id: 7, name: "Sam Sample" }] }));
    expect(job?.clientInfo.addressDetails.zipCode).toBe("85331");
    expect(job?.serialId).toBe(4696);
    expect(job?.team[0].id).toBe("7");
  });

  it("normalises custom-field values: string/boolean kept, number → string, anything else → null", () => {
    const job = parseWorkizJob(
      rawJob({ customFields: [cf("CF-a", "Yes"), cf("CF-b", true), cf("CF-c", 1500), cf("CF-d", { x: 1 }), cf("CF-e", null)] }),
    );
    expect(job?.customFields.map((f) => f.value)).toEqual(["Yes", true, "1500", null, null]);
  });

  it("accepts a subStatus given as a plain string", () => {
    expect(parseWorkizJob(rawJob({ subStatus: "Job Complete" }))?.subStatus).toEqual({ id: "", name: "Job Complete" });
  });

  it("rejects a non-object or an item without an id", () => {
    expect(parseWorkizJob("nope")).toBeNull();
    expect(parseWorkizJob({ ...fixtures.importable(), id: "" })).toBeNull();
    expect(parseWorkizJob({ serialId: 1 })).toBeNull();
  });

  it("serialIdForLog never returns more than the serial", () => {
    expect(serialIdForLog(rawJob())).toBe("4696");
    expect(serialIdForLog({ serialId: "Test Client" })).toBe("?");
    expect(serialIdForLog(null)).toBe("?");
  });
});

describe("workizJobsPageSchema", () => {
  it("needs a data array; hasMore defaults to false", () => {
    expect(workizJobsPageSchema.safeParse({ data: [], page: 1 }).data?.hasMore).toBe(false);
    expect(workizJobsPageSchema.safeParse({ data: "x" }).success).toBe(false);
  });
});
```

`src/lib/workiz/__tests__/adeq.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  ADEQ_JOB_TYPE_IDS,
  canImportNow,
  isAdeqJob,
  isImportable,
  scheduledDateOf,
  teamFirstNames,
  teamNames,
  toJobSummary,
  WORKIZ_CF,
} from "@/lib/workiz/adeq";
import { fixtures, job } from "./fixtures/jobs";
import { workizJobSchema } from "@/lib/workiz/schema";

const parse = (raw: Record<string, unknown>) => workizJobSchema.parse(raw);

describe("constants", () => {
  it("pins the ADEQ job-type ids and custom-field ids (account-specific, spec §16)", () => {
    expect([...ADEQ_JOB_TYPE_IDS].sort()).toEqual(["JT-a5DbVzyREDgGvdWK", "JT-ly4RYx5nKd2z30dw"]);
    expect(WORKIZ_CF).toEqual({
      apn: "CF-nXNayb3y6x56kpwZ",
      waterSource: "CF-ypkPZr3dojlD9KnE",
      tankSize: "CF-mw5dG83Z9joVbYXE",
      effluentFilter: "CF-eWzopvxv6xPQglna",
      flowTestCompleted: "CF-JBDeg6xJWMlYV85W",
      tankRecommendation: "CF-p2ErD5xbe36Jl1XO",
      drainfieldRecommendation: "CF-y5W6qQMr9x1Rvld9",
      notableConcerns: "CF-2AblKqxDG3YeDga1",
      flowTestDescription: "CF-wlovONMYrjKBp4GE",
    });
  });
});

describe("isAdeqJob", () => {
  it("matches by job-type id or by a trimmed name starting with ADEQ", () => {
    expect(isAdeqJob(job())).toBe(true);
    expect(isAdeqJob(parse(fixtures.onlineBooking()))).toBe(true);
    expect(isAdeqJob(job({ jobType: { id: "JT-other000000000001", name: "  ADEQ Re-inspection" } }))).toBe(true);
    expect(isAdeqJob(parse(fixtures.nonAdeq()))).toBe(false);
    expect(isAdeqJob(job({ jobType: null }))).toBe(false);
  });
});

describe("isImportable (picker filter) — exact status match", () => {
  it("accepts only 'done pending approval' on an ADEQ job", () => {
    expect(isImportable(job())).toBe(true);
    for (const status of ["Done", "done", "Done pending approval", "Done Pending Approval", "Submitted"]) {
      expect(isImportable(job({ status }))).toBe(false);
    }
    expect(isImportable(parse(fixtures.nonAdeq()))).toBe(false);
  });
});

describe("canImportNow (import-time re-check)", () => {
  it("accepts 'done pending approval' and 'Done'; rejects Canceled, Submitted, done", () => {
    expect(canImportNow(job())).toBe(true);
    expect(canImportNow(parse(fixtures.done()))).toBe(true);
    expect(canImportNow(parse(fixtures.canceled()))).toBe(false);
    expect(canImportNow(parse(fixtures.submitted()))).toBe(false);
    expect(canImportNow(job({ status: "done" }))).toBe(false);
    expect(canImportNow({ ...parse(fixtures.nonAdeq()), status: "Done" })).toBe(false);
  });
});

describe("summary helpers", () => {
  it("scheduledDateOf slices YYYY-MM-DD and rejects anything else", () => {
    expect(scheduledDateOf(job())).toBe("2026-10-06");
    expect(scheduledDateOf(parse(fixtures.unscheduled()))).toBeNull();
    expect(scheduledDateOf(job({ date: "10/06/2026" }))).toBeNull();
  });

  it("teamNames trims, drops empties and de-duplicates; teamFirstNames de-duplicates case-insensitively", () => {
    const multi = parse(fixtures.multiTeam());
    expect(teamNames(multi)).toEqual(["Alex Tester", "Sam Sample", "alex Other"]);
    expect(teamFirstNames(multi)).toEqual(["Alex", "Sam"]);
    expect(teamFirstNames(parse(fixtures.emptyTeam()))).toEqual([]);
  });

  it("toJobSummary carries only summary fields", () => {
    expect(toJobSummary(parse(fixtures.unit()))).toEqual({
      id: "JOB-AbCdEfGhIjKlMnOp",
      uuid: "AB12CD",
      serialId: 4696,
      street: "100 E Example Rd #12",
      city: "Cave Creek",
      scheduledDate: "2026-10-06",
      subStatus: "Job Complete - Reports Required",
      teamFirstNames: ["Alex", "Sam"],
    });
    const lower = toJobSummary(parse(fixtures.lowercaseCity()));
    expect(lower.city).toBe("Laveen");
    expect(toJobSummary(parse(fixtures.noSubStatus())).subStatus).toBeNull();
    expect(JSON.stringify(toJobSummary(job()))).not.toMatch(/Test Client|example\.com|555-01/);
  });
});
```

- [ ] **Step 3: Run them and confirm they fail**

Run: `npx vitest run src/lib/workiz/__tests__/schema.test.ts src/lib/workiz/__tests__/adeq.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement `schema.ts`**

`src/lib/workiz/schema.ts`:
```ts
import { z } from "zod";

/**
 * Lenient zod schema for the Workiz v2 job fields we read (spec §7.3). Everything optional with
 * safe defaults; unknown fields pass through (z.looseObject). Never logs values.
 */

/** string | number | null | undefined → string ("" when absent) */
const text = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((value) => (value == null ? "" : String(value)));

const namedRef = z.union([
  z.looseObject({ id: text, name: text }),
  z.string().transform((name) => ({ id: "", name })),
]);

const customFieldValue = z
  .unknown()
  .transform((value): string | boolean | null => {
    if (typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    return null;
  });

const EMPTY_ADDRESS = { address: "", unit: "", city: "", state: "", zipCode: "" };

const addressDetailsSchema = z
  .looseObject({ address: text, unit: text, city: text, state: text, zipCode: text })
  .nullish()
  .transform((value) => value ?? { ...EMPTY_ADDRESS });

const clientInfoSchema = z
  .looseObject({
    firstName: text,
    lastName: text,
    companyName: text,
    email: text,
    addressDetails: addressDetailsSchema,
  })
  .nullish()
  .transform(
    (value) =>
      value ?? { firstName: "", lastName: "", companyName: "", email: "", addressDetails: { ...EMPTY_ADDRESS } },
  );

const list = <T extends z.ZodType>(item: T) =>
  z
    .array(item)
    .nullish()
    .transform((value) => value ?? []);

export const workizJobSchema = z.looseObject({
  id: z.string().min(1),
  uuid: text.transform((value) => value.trim()),
  serialId: z
    .union([z.number().int(), z.string().regex(/^\d+$/).transform(Number)])
    .nullish()
    .transform((value) => value ?? null),
  status: text,
  subStatus: namedRef.nullish().transform((value) => value ?? null),
  jobType: namedRef.nullish().transform((value) => value ?? null),
  date: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
  customFields: list(z.looseObject({ id: z.string(), fieldName: text, value: customFieldValue })),
  notes: list(z.looseObject({ note: text, timestamp: text })),
  team: list(z.looseObject({ id: text, name: text })),
  clientInfo: clientInfoSchema,
});

export type WorkizJob = z.output<typeof workizJobSchema>;

export const workizJobsPageSchema = z.looseObject({
  data: z.array(z.unknown()),
  hasMore: z
    .boolean()
    .nullish()
    .transform((value) => value ?? false),
  page: z.number().nullish(),
  pageSize: z.number().nullish(),
  totalResults: z.number().nullish(),
});

export function parseWorkizJob(raw: unknown): WorkizJob | null {
  const result = workizJobSchema.safeParse(raw);
  return result.success ? result.data : null;
}

/** For logs only: the serial when it is numeric, else "?" — never any other job text */
export function serialIdForLog(raw: unknown): string {
  const serial = raw && typeof raw === "object" ? (raw as { serialId?: unknown }).serialId : undefined;
  return typeof serial === "number" || (typeof serial === "string" && /^\d{1,10}$/.test(serial))
    ? String(serial)
    : "?";
}
```

- [ ] **Step 5: Implement `adeq.ts`**

`src/lib/workiz/adeq.ts`:
```ts
import { formatWorkizCity, formatWorkizStreet } from "./custom-fields";
import type { WorkizJob } from "./schema";

/** Exact, lowercase, top-level Workiz status (spec §7.4) — a rename would empty the picker */
export const WORKIZ_STATUS_DONE_PENDING_APPROVAL = "done pending approval";

export const ADEQ_JOB_TYPE_IDS: ReadonlySet<string> = new Set([
  "JT-a5DbVzyREDgGvdWK", // "ADEQ Septic Inspection "
  "JT-ly4RYx5nKd2z30dw", // "ADEQ Inspection - Online Booking"
]);

/** Import-time re-check also allows "Done": a job can move on between listing and import */
export const IMPORT_ALLOWED_STATUSES: ReadonlySet<string> = new Set([
  WORKIZ_STATUS_DONE_PENDING_APPROVAL,
  "Done",
]);

/** Custom fields are matched by id, never by fieldName (several names carry trailing spaces) */
export const WORKIZ_CF = {
  apn: "CF-nXNayb3y6x56kpwZ",
  waterSource: "CF-ypkPZr3dojlD9KnE",
  tankSize: "CF-mw5dG83Z9joVbYXE",
  effluentFilter: "CF-eWzopvxv6xPQglna",
  flowTestCompleted: "CF-JBDeg6xJWMlYV85W",
  tankRecommendation: "CF-p2ErD5xbe36Jl1XO",
  drainfieldRecommendation: "CF-y5W6qQMr9x1Rvld9",
  notableConcerns: "CF-2AblKqxDG3YeDga1",
  flowTestDescription: "CF-wlovONMYrjKBp4GE",
} as const;

export const isAdeqJob = (job: WorkizJob): boolean =>
  ADEQ_JOB_TYPE_IDS.has(job.jobType?.id ?? "") || (job.jobType?.name ?? "").trim().startsWith("ADEQ");

/** The picker's filter */
export const isImportable = (job: WorkizJob): boolean =>
  isAdeqJob(job) && job.status === WORKIZ_STATUS_DONE_PENDING_APPROVAL;

export const canImportNow = (job: WorkizJob): boolean =>
  isAdeqJob(job) && IMPORT_ALLOWED_STATUSES.has(job.status);

/** Workiz `date` is account-local wall-clock "YYYY-MM-DD HH:MM:SS"; slicing avoids any UTC shift */
export function scheduledDateOf(job: WorkizJob): string | null {
  const day = (job.date ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/** Trimmed, non-empty team names in Workiz order, de-duplicated */
export function teamNames(job: WorkizJob): string[] {
  const names = job.team.map((member) => member.name.replace(/\s+/g, " ").trim()).filter(Boolean);
  return [...new Set(names)];
}

/** First token of each team name, de-duplicated case-insensitively (first spelling wins) */
export function teamFirstNames(job: WorkizJob): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of teamNames(job)) {
    const first = name.split(" ")[0];
    const key = first.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(first);
  }
  return out;
}

/** Server-side summary: no client name, email, phone or notes (the list cache holds only these) */
export interface WorkizJobSummary {
  id: string;
  uuid: string;
  serialId: number | null;
  street: string;
  city: string;
  scheduledDate: string | null;
  subStatus: string | null;
  teamFirstNames: string[];
}

export function toJobSummary(job: WorkizJob): WorkizJobSummary {
  const address = job.clientInfo.addressDetails;
  return {
    id: job.id,
    uuid: job.uuid,
    serialId: job.serialId,
    street: formatWorkizStreet(address.address, address.unit),
    city: formatWorkizCity(address.city),
    scheduledDate: scheduledDateOf(job),
    subStatus: job.subStatus?.name.trim() || null,
    teamFirstNames: teamFirstNames(job),
  };
}
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `npx vitest run src/lib/workiz/__tests__/schema.test.ts src/lib/workiz/__tests__/adeq.test.ts`
Expected: PASS. In `multiTeam`, `teamFirstNames` is `["Alex", "Sam"]`, because `alex Other`'s first token folds into `Alex`.

- [ ] **Step 7: Type check, lint, commit**

Run the TypeScript baseline filter command (expected: no output), then:
```bash
npx biome lint src/lib/workiz/schema.ts src/lib/workiz/adeq.ts src/lib/workiz/__tests__/fixtures/jobs.ts src/lib/workiz/__tests__/schema.test.ts src/lib/workiz/__tests__/adeq.test.ts
git add src/lib/workiz/schema.ts src/lib/workiz/adeq.ts src/lib/workiz/__tests__/fixtures/jobs.ts src/lib/workiz/__tests__/schema.test.ts src/lib/workiz/__tests__/adeq.test.ts
git commit -F - <<'EOF'
feat(workiz-import): add lenient Workiz job schema, ADEQ job rules and synthetic fixtures

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
```

---

## Wave 3

### Task T12: APN hint (`apn-hint.ts`)

**Files:**
- Create: `src/lib/workiz/apn-hint.ts`
- Test: `src/lib/workiz/__tests__/apn-hint.test.ts`

**Interfaces:**
- Consumes: `formatApn` (`@/lib/prefill/apn`), `WORKIZ_CF` (T11), `WorkizJob` (T11), fixtures (T11).
- Produces:
  ```ts
  export type NoteConfidence = "high" | "medium" | "low" | "unstated";
  export type ApnHint =
    | { apn: string; confidence: number; source: "custom_field" }
    | { apn: string; confidence: number; source: "note"; noteConfidence: NoteConfidence };
  export interface ApnHintResult { hint: ApnHint | null; customFieldInvalid: boolean }
  export const CF_APN_CONFIDENCE = 0.7;
  export function findApnHint(job: WorkizJob): ApnHintResult;
  ```

- [ ] **Step 1: Write the failing test**

`src/lib/workiz/__tests__/apn-hint.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { WORKIZ_CF } from "@/lib/workiz/adeq";
import { findApnHint } from "@/lib/workiz/apn-hint";
import { BOT_NOTES, cf, job, note } from "./fixtures/jobs";

const withNotes = (...notes: Array<Record<string, unknown>>) => job({ notes });

describe("findApnHint (spec §5.3)", () => {
  it("the APN custom field wins over any note (0.7)", () => {
    const result = findApnHint(
      job({ customFields: [cf(WORKIZ_CF.apn, "12345670")], notes: [BOT_NOTES.grokHigh] }),
    );
    expect(result).toEqual({
      hint: { apn: "123-45-670", confidence: 0.7, source: "custom_field" },
      customFieldInvalid: false,
    });
  });

  it("an invalid custom field is flagged and the notes are used instead", () => {
    const result = findApnHint(job({ customFields: [cf(WORKIZ_CF.apn, "see notes")], notes: [BOT_NOTES.grokHigh] }));
    expect(result.customFieldInvalid).toBe(true);
    expect(result.hint).toMatchObject({ apn: "123-45-678", source: "note" });
  });

  it("an empty custom field is not 'invalid'", () => {
    expect(findApnHint(job({ customFields: [cf(WORKIZ_CF.apn, "  ")] }))).toEqual({ hint: null, customFieldInvalid: false });
  });

  it.each([
    [BOT_NOTES.grokHigh, "123-45-678", 0.6, "high"],
    [BOT_NOTES.plainHighSuffix, "123-45-678K", 0.6, "high"],
    [BOT_NOTES.parenthesizedMedium, "123-45-678Z", 0.5, "medium"],
    [BOT_NOTES.grokLow, "123-45-680", 0.4, "low"],
    [BOT_NOTES.noConfidence, "123-45-679", 0.4, "unstated"],
  ])("reads note shape %#", (shape, apn, confidence, noteConfidence) => {
    expect(findApnHint(withNotes(shape)).hint).toEqual({ apn, confidence, source: "note", noteConfidence });
  });

  it("uses only the newest permit-bot note", () => {
    expect(findApnHint(withNotes(BOT_NOTES.grokLow, BOT_NOTES.grokHigh)).hint?.apn).toBe("123-45-680");
  });

  it("ignores notes that are not permit-bot notes", () => {
    expect(findApnHint(withNotes(BOT_NOTES.notABotNote)).hint).toBeNull();
  });

  it("duplicate bot notes collapse naturally", () => {
    const dup = BOT_NOTES.grokHigh;
    expect(findApnHint(withNotes(dup, dup, dup)).hint).toMatchObject({ apn: "123-45-678", confidence: 0.6 });
  });

  it("an unparseable timestamp sorts oldest", () => {
    const undated = note("Permit added. Confidence high. APN 123-45-690.", "yesterday");
    expect(findApnHint(withNotes(undated, BOT_NOTES.grokLow)).hint?.apn).toBe("123-45-680");
  });

  it("no custom field and no bot note → no hint", () => {
    expect(findApnHint(job())).toEqual({ hint: null, customFieldInvalid: false });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/lib/workiz/__tests__/apn-hint.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`src/lib/workiz/apn-hint.ts`:
```ts
import { formatApn } from "@/lib/prefill/apn";
import { WORKIZ_CF } from "./adeq";
import type { WorkizJob } from "./schema";

/**
 * APN hint for the Tax Parcel Number chip (spec §5.3): the APN custom field, else the newest
 * permit-bot note. A chip only — it never feeds the lookup (the run stays address-driven).
 */

export type NoteConfidence = "high" | "medium" | "low" | "unstated";

export type ApnHint =
  | { apn: string; confidence: number; source: "custom_field" }
  | { apn: string; confidence: number; source: "note"; noteConfidence: NoteConfidence };

export interface ApnHintResult {
  hint: ApnHint | null;
  /** The custom field held text that is not an APN (logged by the caller as `invalid_apn`) */
  customFieldInvalid: boolean;
}

export const CF_APN_CONFIDENCE = 0.7;

const NOTE_CONFIDENCE: Record<NoteConfidence, number> = {
  high: 0.6,
  medium: 0.5,
  low: 0.4,
  unstated: 0.4,
};

const PERMIT_NOTE = /^\s*Permit added\b/;
const NOTE_APN = /\bAPN[:\s]+(\d{3}-?\d{2}-?\d{3}[A-Z]?)\b/;
const NOTE_CONFIDENCE_WORD = /\bConfidence (high|medium|low)\b/i;

/** "2026-10-01 09:00:00" or ISO → ms; unparseable sorts oldest */
function noteTime(timestamp: string): number {
  const ms = Date.parse(timestamp.trim().replace(" ", "T"));
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

export function findApnHint(job: WorkizJob): ApnHintResult {
  let customFieldInvalid = false;
  const field = job.customFields.find((f) => f.id === WORKIZ_CF.apn);
  if (typeof field?.value === "string" && field.value.trim()) {
    const apn = formatApn(field.value);
    if (apn) return { hint: { apn, confidence: CF_APN_CONFIDENCE, source: "custom_field" }, customFieldInvalid };
    customFieldInvalid = true;
  }

  const newest = job.notes
    .filter((n) => PERMIT_NOTE.test(n.note) && NOTE_APN.test(n.note))
    .sort((a, b) => noteTime(b.timestamp) - noteTime(a.timestamp) || 0)[0];
  if (!newest) return { hint: null, customFieldInvalid };

  const apn = formatApn(NOTE_APN.exec(newest.note)?.[1]);
  if (!apn) return { hint: null, customFieldInvalid };
  const word = (NOTE_CONFIDENCE_WORD.exec(newest.note)?.[1]?.toLowerCase() ?? "unstated") as NoteConfidence;
  return {
    hint: { apn, confidence: NOTE_CONFIDENCE[word], source: "note", noteConfidence: word },
    customFieldInvalid,
  };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run src/lib/workiz/__tests__/apn-hint.test.ts`
Expected: PASS. (`-Infinity - -Infinity` is `NaN`, which `|| 0` turns into a tie. `Array.prototype.sort` is stable.)

- [ ] **Step 5: Lint and commit**

```bash
npx biome lint src/lib/workiz/apn-hint.ts src/lib/workiz/__tests__/apn-hint.test.ts
git add src/lib/workiz/apn-hint.ts src/lib/workiz/__tests__/apn-hint.test.ts
git commit -F - <<'EOF'
feat(workiz-import): derive an APN hint from the APN custom field or the newest permit-bot note

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
```

---

### Task T13: Listing, cache and `getJob` (`adeq-jobs.ts`)

**Files:**
- Create: `src/lib/workiz/adeq-jobs.ts`
- Test: `src/lib/workiz/__tests__/adeq-jobs.test.ts`

**Interfaces:**
- Consumes: `workizGet`, `combineSignals`, `waitFor`, `WorkizError` (T10); `parseWorkizJob`, `workizJobsPageSchema`, `serialIdForLog`, `WorkizJob` (T11); `isImportable`, `toJobSummary`, `WorkizJobSummary` (T11).
- Produces:
  ```ts
  export const LIST_CACHE_TTL_MS = 60_000;
  export const REFRESH_FLOOR_MS = 15_000;
  export const LIST_DEADLINE_MS = 25_000;
  export const MAX_LIST_PAGES = 10;
  export const PAGE_DELAY_MS = 500;
  export function openJobsQuery(page: number): Record<string, string>;
  export async function fetchOpenJobs(opts?: { signal?: AbortSignal }): Promise<{ jobs: WorkizJob[]; pages: number; dropped: number }>;
  export async function listImportableAdeqJobs(opts?: { refresh?: boolean }): Promise<{ rows: WorkizJobSummary[]; fetchedAt: number }>;
  export function getCachedSummary(id: string): WorkizJobSummary | undefined;
  export function unwrapSingleJob(raw: unknown): unknown;
  export async function getJob(id: string): Promise<WorkizJob>;          // throws WorkizError
  export function __resetWorkizJobsCacheForTests(): void;
  ```

- [ ] **Step 1: Write the failing test**

`src/lib/workiz/__tests__/adeq-jobs.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockWorkizGet } = vi.hoisted(() => ({ mockWorkizGet: vi.fn() }));

vi.mock("@/lib/workiz/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workiz/client")>();
  return { ...actual, workizGet: mockWorkizGet };
});

import {
  __resetWorkizJobsCacheForTests,
  getCachedSummary,
  getJob,
  LIST_DEADLINE_MS,
  listImportableAdeqJobs,
  openJobsQuery,
} from "@/lib/workiz/adeq-jobs";
import { WorkizError } from "@/lib/workiz/client";
import { fixtures, rawJob } from "./fixtures/jobs";

const page = (data: unknown[], hasMore = false) => ({ data, hasMore, page: 1, pageSize: 300, totalResults: data.length });

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-12T17:00:00.000Z"));
  __resetWorkizJobsCacheForTests();
  mockWorkizGet.mockReset();
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function settle<T>(promise: Promise<T>): Promise<T | unknown> {
  const outcome = promise.then(
    (v) => v,
    (e) => e,
  );
  await vi.runAllTimersAsync();
  return outcome;
}

describe("openJobsQuery", () => {
  it("is the verified query: open jobs, 300/page, 1-based, stable created ASC order", () => {
    expect(openJobsQuery(2)).toEqual({
      isOpen: "true",
      pageSize: "300",
      page: "2",
      dateProperty: "date",
      dateOperator: "next",
      date: "2020-01-01",
      field: "created",
      order: "ASC",
    });
  });
});

describe("listImportableAdeqJobs", () => {
  it("pages from 1 until hasMore is false, 500 ms apart", async () => {
    mockWorkizGet
      .mockResolvedValueOnce(page([rawJob()], true))
      .mockResolvedValueOnce(page([fixtures.onlineBooking()], false));
    const promise = listImportableAdeqJobs();
    await vi.advanceTimersByTimeAsync(0);
    expect(mockWorkizGet).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(499);
    expect(mockWorkizGet).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const { rows } = await promise;
    expect(mockWorkizGet.mock.calls.map((c) => [c[0], c[1].page])).toEqual([
      ["/jobs", "1"],
      ["/jobs", "2"],
    ]);
    expect(rows.map((r) => r.serialId)).toEqual([4700, 4696]);
  });

  it("keeps only importable ADEQ jobs and sorts by date desc (nulls last), then serial desc", async () => {
    mockWorkizGet.mockResolvedValueOnce(
      page([
        rawJob({ id: "JOB-a000000000000001", serialId: 4667, date: "2026-09-28 08:00:00" }),
        fixtures.unscheduled(),
        rawJob({ id: "JOB-a000000000000002", serialId: 4690, date: "2026-10-06 10:00:00" }),
        rawJob({ id: "JOB-a000000000000003", serialId: 4696, date: "2026-10-06 12:00:00" }),
        fixtures.nonAdeq(),
        fixtures.done(),
        fixtures.canceled(),
      ]),
    );
    const { rows } = (await settle(listImportableAdeqJobs())) as Awaited<ReturnType<typeof listImportableAdeqJobs>>;
    expect(rows.map((r) => r.serialId)).toEqual([4696, 4690, 4667, 4650]);
  });

  it("drops a job that fails the schema and logs only its serial", async () => {
    mockWorkizGet.mockResolvedValueOnce(page([rawJob(), { serialId: 4711, clientInfo: { firstName: "Test" } }]));
    const { rows } = (await settle(listImportableAdeqJobs())) as Awaited<ReturnType<typeof listImportableAdeqJobs>>;
    expect(rows).toHaveLength(1);
    const logged = JSON.stringify(warnSpy.mock.calls);
    expect(logged).toContain("serial=4711");
    expect(logged).not.toContain("Test");
  });

  it("a page whose data is not an array → bad_response", async () => {
    mockWorkizGet.mockResolvedValueOnce({ data: "nope" });
    expect(await settle(listImportableAdeqJobs())).toMatchObject({ code: "bad_response" });
  });

  it("caches for 60 s", async () => {
    mockWorkizGet.mockResolvedValue(page([rawJob()]));
    await settle(listImportableAdeqJobs());
    vi.advanceTimersByTime(59_000);
    await settle(listImportableAdeqJobs());
    expect(mockWorkizGet).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_000);
    await settle(listImportableAdeqJobs());
    expect(mockWorkizGet).toHaveBeenCalledTimes(2);
  });

  it("single-flight: concurrent callers share one fetch sequence", async () => {
    mockWorkizGet.mockResolvedValue(page([rawJob()]));
    const a = listImportableAdeqJobs();
    const b = listImportableAdeqJobs({ refresh: true });
    await vi.runAllTimersAsync();
    expect((await a).rows).toEqual((await b).rows);
    expect(mockWorkizGet).toHaveBeenCalledTimes(1);
  });

  it("refresh within 15 s returns the cached rows; after 15 s it refetches", async () => {
    mockWorkizGet.mockResolvedValue(page([rawJob()]));
    const first = (await settle(listImportableAdeqJobs())) as Awaited<ReturnType<typeof listImportableAdeqJobs>>;
    vi.advanceTimersByTime(14_000);
    const second = (await settle(listImportableAdeqJobs({ refresh: true }))) as typeof first;
    expect(mockWorkizGet).toHaveBeenCalledTimes(1);
    expect(second.fetchedAt).toBe(first.fetchedAt);
    vi.advanceTimersByTime(1_000);
    await settle(listImportableAdeqJobs({ refresh: true }));
    expect(mockWorkizGet).toHaveBeenCalledTimes(2);
  });

  it("never caches a failure", async () => {
    mockWorkizGet.mockRejectedValueOnce(new WorkizError("unavailable")).mockResolvedValue(page([rawJob()]));
    expect(await settle(listImportableAdeqJobs())).toMatchObject({ code: "unavailable" });
    const ok = (await settle(listImportableAdeqJobs())) as Awaited<ReturnType<typeof listImportableAdeqJobs>>;
    expect(ok.rows).toHaveLength(1);
  });

  it("stops at 10 pages", async () => {
    mockWorkizGet.mockResolvedValue(page([], true));
    mockWorkizGet.mockImplementation(async () => page([rawJob()], true));
    await settle(listImportableAdeqJobs());
    expect(mockWorkizGet).toHaveBeenCalledTimes(10);
  });

  it("an empty page ends paging even when hasMore is true", async () => {
    mockWorkizGet.mockResolvedValueOnce(page([rawJob()], true)).mockResolvedValueOnce(page([], true));
    await settle(listImportableAdeqJobs());
    expect(mockWorkizGet).toHaveBeenCalledTimes(2);
  });

  it("gives up as unavailable at the 25 s overall deadline", async () => {
    mockWorkizGet.mockImplementation(
      (_path: string, _query: unknown, opts: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener("abort", () => reject(new WorkizError("unavailable")));
        }),
    );
    const outcome = listImportableAdeqJobs().catch((e) => e);
    await vi.advanceTimersByTimeAsync(LIST_DEADLINE_MS - 1);
    let settled = false;
    void outcome.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toMatchObject({ code: "unavailable" });
  });
});

describe("getCachedSummary", () => {
  it("hits after a listing and misses otherwise — without any network call", async () => {
    expect(getCachedSummary("JOB-AbCdEfGhIjKlMnOp")).toBeUndefined();
    mockWorkizGet.mockResolvedValue(page([rawJob()]));
    await settle(listImportableAdeqJobs());
    mockWorkizGet.mockClear();
    expect(getCachedSummary("JOB-AbCdEfGhIjKlMnOp")?.uuid).toBe("AB12CD");
    expect(getCachedSummary("JOB-Missing000000001")).toBeUndefined();
    expect(mockWorkizGet).not.toHaveBeenCalled();
  });
});

describe("getJob", () => {
  it("GETs /jobs/{encoded id} and accepts a bare job, {data: job} or {data: [job]}", async () => {
    for (const body of [rawJob(), { data: rawJob() }, { data: [rawJob()] }]) {
      mockWorkizGet.mockResolvedValueOnce(body);
      const job = await getJob("JOB-AbCdEfGhIjKlMnOp");
      expect(job.uuid).toBe("AB12CD");
    }
    expect(mockWorkizGet.mock.calls[0][0]).toBe("/jobs/JOB-AbCdEfGhIjKlMnOp");
    mockWorkizGet.mockResolvedValueOnce(rawJob());
    await getJob("JOB-a/b");
    expect(mockWorkizGet.mock.calls.at(-1)?.[0]).toBe("/jobs/JOB-a%2Fb");
  });

  it("an unparseable job → bad_response", async () => {
    mockWorkizGet.mockResolvedValueOnce({ data: [] });
    await expect(getJob("JOB-AbCdEfGhIjKlMnOp")).rejects.toMatchObject({ code: "bad_response" });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/lib/workiz/__tests__/adeq-jobs.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`src/lib/workiz/adeq-jobs.ts`:
```ts
import { type WorkizJobSummary, isImportable, toJobSummary } from "./adeq";
import { combineSignals, WorkizError, waitFor, workizGet } from "./client";
import { parseWorkizJob, serialIdForLog, type WorkizJob, workizJobsPageSchema } from "./schema";

/**
 * Importable-ADEQ-jobs listing (spec §7.4). The API has no server-side status/type filter, so
 * every open job is paged in and filtered here. One module-level cache entry per serverless
 * instance: 60 s TTL, a 15 s floor under `refresh`, single-flight, failures never cached.
 * Only summaries are cached — no client name, email, phone or notes.
 */

export const LIST_CACHE_TTL_MS = 60_000;
export const REFRESH_FLOOR_MS = 15_000;
export const LIST_DEADLINE_MS = 25_000;
export const MAX_LIST_PAGES = 10;
export const PAGE_DELAY_MS = 500;
const LIST_PAGE_SIZE = 300;

export function openJobsQuery(page: number): Record<string, string> {
  return {
    isOpen: "true",
    pageSize: String(LIST_PAGE_SIZE),
    page: String(page),
    dateProperty: "date",
    dateOperator: "next",
    date: "2020-01-01",
    field: "created",
    order: "ASC",
  };
}

/** Every open job (≤ 10 pages, 500 ms apart) under one 25 s deadline covering pages and retries */
export async function fetchOpenJobs(
  opts: { signal?: AbortSignal } = {},
): Promise<{ jobs: WorkizJob[]; pages: number; dropped: number }> {
  const deadline = combineSignals([opts.signal], LIST_DEADLINE_MS);
  try {
    const jobs: WorkizJob[] = [];
    let dropped = 0;
    let pages = 0;
    for (let page = 1; page <= MAX_LIST_PAGES; page++) {
      if (page > 1) await waitFor(PAGE_DELAY_MS, deadline.signal);
      const raw = await workizGet<unknown>("/jobs", openJobsQuery(page), { signal: deadline.signal });
      const parsed = workizJobsPageSchema.safeParse(raw);
      if (!parsed.success) throw new WorkizError("bad_response");
      pages = page;
      for (const item of parsed.data.data) {
        const job = parseWorkizJob(item);
        if (job) {
          jobs.push(job);
        } else {
          dropped += 1;
          console.warn(`[workiz] dropped job serial=${serialIdForLog(item)} reason=schema`);
        }
      }
      if (!parsed.data.hasMore || parsed.data.data.length === 0) break;
    }
    return { jobs, pages, dropped };
  } catch (err) {
    if (err instanceof WorkizError) throw err;
    throw new WorkizError("unavailable");
  } finally {
    deadline.dispose();
  }
}

function sortSummaries(rows: WorkizJobSummary[]): WorkizJobSummary[] {
  return [...rows].sort((a, b) => {
    if (a.scheduledDate !== b.scheduledDate) {
      if (!a.scheduledDate) return 1;
      if (!b.scheduledDate) return -1;
      return a.scheduledDate > b.scheduledDate ? -1 : 1;
    }
    return (b.serialId ?? 0) - (a.serialId ?? 0);
  });
}

interface CacheEntry {
  at: number;
  rows: WorkizJobSummary[];
}

let cache: CacheEntry | null = null;
let inflight: Promise<CacheEntry> | null = null;

export async function listImportableAdeqJobs(
  opts: { refresh?: boolean } = {},
): Promise<{ rows: WorkizJobSummary[]; fetchedAt: number }> {
  if (cache) {
    const age = Date.now() - cache.at;
    if (age < LIST_CACHE_TTL_MS && (!opts.refresh || age < REFRESH_FLOOR_MS)) {
      return { rows: cache.rows, fetchedAt: cache.at };
    }
  }
  if (!inflight) {
    inflight = (async () => {
      const { jobs } = await fetchOpenJobs();
      const entry = { at: Date.now(), rows: sortSummaries(jobs.filter(isImportable).map(toJobSummary)) };
      cache = entry;
      return entry;
    })().finally(() => {
      inflight = null;
    });
  }
  const entry = await inflight;
  return { rows: entry.rows, fetchedAt: entry.at };
}

/** The cached summary for a JOB-… id, without any network call (import's uuid pre-check) */
export function getCachedSummary(id: string): WorkizJobSummary | undefined {
  return cache?.rows.find((row) => row.id === id);
}

/** GET /jobs/{id} returns the job shape; tolerate a `{ data: job | [job] }` wrapper too */
export function unwrapSingleJob(raw: unknown): unknown {
  if (raw && typeof raw === "object" && "data" in raw) {
    const data = (raw as { data: unknown }).data;
    return Array.isArray(data) ? data[0] : data;
  }
  return raw;
}

export async function getJob(id: string): Promise<WorkizJob> {
  const raw = await workizGet<unknown>(`/jobs/${encodeURIComponent(id)}`);
  const job = parseWorkizJob(unwrapSingleJob(raw));
  if (!job) throw new WorkizError("bad_response");
  return job;
}

export function __resetWorkizJobsCacheForTests(): void {
  cache = null;
  inflight = null;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run src/lib/workiz/__tests__/adeq-jobs.test.ts`
Expected: PASS. If the 10-page test sees 11 calls, check the loop bound (`page <= MAX_LIST_PAGES`).

- [ ] **Step 5: Lint and commit**

```bash
npx biome lint src/lib/workiz/adeq-jobs.ts src/lib/workiz/__tests__/adeq-jobs.test.ts
git add src/lib/workiz/adeq-jobs.ts src/lib/workiz/__tests__/adeq-jobs.test.ts
git commit -F - <<'EOF'
feat(workiz-import): list importable ADEQ jobs with paging deadline, cache and single-flight

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
```

---

### Task T14: Route infra — shared types, error responses, auth gate, import store

**Files:**
- Create: `src/types/workiz-import.ts`
- Create: `src/lib/workiz/route-errors.ts`
- Create: `src/lib/workiz/route-auth.ts`
- Create: `src/lib/workiz/import-store.ts`
- Test: `src/lib/workiz/__tests__/route-errors.test.ts`, `src/lib/workiz/__tests__/route-auth.test.ts`, `src/lib/workiz/__tests__/import-store.test.ts`

**Interfaces:**
- Consumes: `WorkizError` (T10), `getUserRole` (`@/lib/supabase/auth-helpers`), `createClient` (`@/lib/supabase/server`), `db`, `inspections`, `profiles`.
- Produces:
  ```ts
  // src/types/workiz-import.ts (importable by client components)
  export type WorkizImporterRole = "admin" | "field_tech";
  export type WorkizExisting = { canOpen: true; inspectionId: string; status: string } | { canOpen: false };
  export interface WorkizJobRow { id: string; serialId: number | null; street: string; city: string; scheduledDate: string | null; subStatus: string | null; teamFirstNames: string[]; existing: WorkizExisting | null }
  export interface WorkizJobsResponse { jobs: WorkizJobRow[]; fetchedAt: string; role: WorkizImporterRole; currentUserFirstName: string | null }
  export type WorkizRouteErrorCode = "workiz_not_configured" | "workiz_auth_failed" | "workiz_rate_limited" | "workiz_unavailable" | "workiz_bad_response" | "workiz_job_not_found" | "invalid_request" | "already_imported" | "not_adeq_job" | "not_importable" | "internal";
  export interface WorkizErrorBody { error: string; code: WorkizRouteErrorCode; retryAfterSeconds?: number }
  export type WorkizImportPrefill = { status: "started"; runId: string } | { status: "skipped"; reason: "address_unparseable" } | { status: "failed" };
  export type WorkizImportCreated = { inspectionId: string; existing: false; prefill: WorkizImportPrefill };
  export type WorkizImportExisting = { inspectionId: string; existing: true; status: string };
  export type WorkizImportResponse = WorkizImportCreated | WorkizImportExisting;
  // route-errors.ts
  export const RATE_LIMIT_RETRY_AFTER_SECONDS = 60;
  export function errorResponse(status: number, code: WorkizRouteErrorCode, error: string, extra?: { retryAfterSeconds?: number }): NextResponse<WorkizErrorBody>;
  export function workizErrorResponse(err: WorkizError, context: "list" | "import"): NextResponse<WorkizErrorBody>;
  export function internalErrorResponse(): NextResponse<WorkizErrorBody>;      // 500 { error: "Something went wrong", code: "internal" }
  // route-auth.ts
  export type WorkizImporterAuth = { ok: true; user: User; role: WorkizImporterRole } | { ok: false; response: NextResponse };
  export async function requireWorkizImporter(): Promise<WorkizImporterAuth>;
  // import-store.ts
  export interface ImportedInspectionRow { id: string; inspectorId: string; status: string; workizJobId: string | null }
  export async function findInspectionsByWorkizIds(ids: ReadonlyArray<string | null | undefined>): Promise<ImportedInspectionRow[]>;
  export type ImportedInspectionValues = Pick<typeof inspections.$inferInsert, "inspectorId" | "status" | "formData" | "fieldProvenance" | "facilityAddress" | "facilityCity" | "facilityZip" | "facilityCounty" | "facilityName" | "customerEmail" | "customerName" | "workizJobId" | "apn">;
  export async function insertImportedInspection(values: ImportedInspectionValues): Promise<string>;
  export async function loadProfileFullName(userId: string): Promise<string | null>;
  export function firstNameOf(fullName: string | null | undefined): string | null;
  ```

- [ ] **Step 1: Write the failing tests**

`src/lib/workiz/__tests__/route-errors.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { WorkizError, type WorkizErrorCode } from "@/lib/workiz/client";
import { internalErrorResponse, workizErrorResponse } from "@/lib/workiz/route-errors";

describe("workizErrorResponse (spec §8.1 table)", () => {
  it.each<[WorkizErrorCode, "list" | "import", number, string]>([
    ["not_configured", "list", 503, "workiz_not_configured"],
    ["auth_failed", "list", 502, "workiz_auth_failed"],
    ["rate_limited", "list", 503, "workiz_rate_limited"],
    ["unavailable", "list", 502, "workiz_unavailable"],
    ["bad_response", "list", 502, "workiz_bad_response"],
    ["not_found", "list", 502, "workiz_unavailable"],
    ["not_found", "import", 404, "workiz_job_not_found"],
  ])("%s (%s) → %i %s", async (code, context, status, bodyCode) => {
    const res = workizErrorResponse(new WorkizError(code, 418), context);
    expect(res.status).toBe(status);
    const body = await res.json();
    expect(body.code).toBe(bodyCode);
    expect(typeof body.error).toBe("string");
    expect(JSON.stringify(body)).not.toContain("418"); // nothing from Workiz is forwarded
  });

  it("rate_limited carries retryAfterSeconds: 60", async () => {
    const body = await workizErrorResponse(new WorkizError("rate_limited"), "list").json();
    expect(body.retryAfterSeconds).toBe(60);
  });

  it("internalErrorResponse is a fixed 500", async () => {
    const res = internalErrorResponse();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Something went wrong", code: "internal" });
  });
});
```

`src/lib/workiz/__tests__/route-auth.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetUser, mockGetUserRole } = vi.hoisted(() => ({ mockGetUser: vi.fn(), mockGetUserRole: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({ auth: { getUser: mockGetUser } }),
}));
vi.mock("@/lib/supabase/auth-helpers", () => ({ getUserRole: mockGetUserRole }));

import { requireWorkizImporter } from "@/lib/workiz/route-auth";

const USER = { id: "user-1", email: "tech@example.com" };

beforeEach(() => {
  mockGetUser.mockReset();
  mockGetUserRole.mockReset();
});

describe("requireWorkizImporter (spec §8.3)", () => {
  it("401 without a user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const auth = await requireWorkizImporter();
    expect(auth.ok).toBe(false);
    if (!auth.ok) {
      expect(auth.response.status).toBe(401);
      expect(await auth.response.json()).toEqual({ error: "Unauthorized" });
    }
  });

  it.each(["office_staff", null])("403 for role %s", async (role) => {
    mockGetUser.mockResolvedValue({ data: { user: USER } });
    mockGetUserRole.mockResolvedValue(role);
    const auth = await requireWorkizImporter();
    expect(auth.ok).toBe(false);
    if (!auth.ok) {
      expect(auth.response.status).toBe(403);
      expect(await auth.response.json()).toEqual({ error: "Forbidden" });
    }
  });

  it.each(["admin", "field_tech"])("admits %s", async (role) => {
    mockGetUser.mockResolvedValue({ data: { user: USER } });
    mockGetUserRole.mockResolvedValue(role);
    expect(await requireWorkizImporter()).toEqual({ ok: true, user: USER, role });
  });
});
```

`src/lib/workiz/__tests__/import-store.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSelectWhere, mockSelectLimit, mockReturning, mockValues } = vi.hoisted(() => ({
  mockSelectWhere: vi.fn(),
  mockSelectLimit: vi.fn(),
  mockReturning: vi.fn(),
  mockValues: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  // where() is awaited directly (findInspectionsByWorkizIds) or followed by .limit() (profile lookup).
  // A real Promise with a `limit` property (not a hand-rolled thenable; Biome bans `then` keys).
  const whereResult = () =>
    Object.assign(Promise.resolve().then(() => mockSelectWhere()), { limit: mockSelectLimit });
  const selectChain = { from: vi.fn().mockReturnThis(), where: vi.fn(whereResult) };
  const insertChain = {
    values: vi.fn((v: unknown) => {
      mockValues(v);
      return insertChain;
    }),
    returning: mockReturning,
  };
  return { db: { select: vi.fn(() => selectChain), insert: vi.fn(() => insertChain) } };
});

vi.mock("@/lib/db/schema", () => ({
  inspections: { id: "id", inspectorId: "inspector_id", status: "status", workizJobId: "workiz_job_id" },
  profiles: { id: "profile_id", fullName: "full_name" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ op: "eq", col, val })),
  inArray: vi.fn((col: unknown, vals: unknown) => ({ op: "inArray", col, vals })),
}));

import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  findInspectionsByWorkizIds,
  firstNameOf,
  insertImportedInspection,
  loadProfileFullName,
} from "@/lib/workiz/import-store";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("findInspectionsByWorkizIds", () => {
  it("skips the query for no usable ids", async () => {
    expect(await findInspectionsByWorkizIds(["", null, undefined])).toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("queries workiz_job_id IN (de-duplicated ids)", async () => {
    mockSelectWhere.mockResolvedValue([{ id: "insp-1", inspectorId: "u1", status: "draft", workizJobId: "AB12CD" }]);
    const rows = await findInspectionsByWorkizIds(["AB12CD", "JOB-AbCdEfGhIjKlMnOp", "AB12CD", ""]);
    expect(inArray).toHaveBeenCalledWith("workiz_job_id", ["AB12CD", "JOB-AbCdEfGhIjKlMnOp"]);
    expect(rows).toEqual([{ id: "insp-1", inspectorId: "u1", status: "draft", workizJobId: "AB12CD" }]);
  });
});

describe("insertImportedInspection", () => {
  it("inserts the values and returns the new id", async () => {
    mockReturning.mockResolvedValue([{ id: "insp-new" }]);
    const values = {
      inspectorId: "user-1",
      status: "draft" as const,
      formData: {},
      fieldProvenance: {},
      facilityAddress: "100 E Example Rd",
      facilityCity: "Cave Creek",
      facilityZip: "85331",
      facilityCounty: null,
      facilityName: null,
      customerEmail: "test.client@example.com",
      customerName: null,
      workizJobId: "AB12CD",
      apn: null,
    };
    expect(await insertImportedInspection(values)).toBe("insp-new");
    expect(mockValues).toHaveBeenCalledWith(values);
  });
});

describe("loadProfileFullName / firstNameOf", () => {
  it("returns the profile's full name or null", async () => {
    mockSelectLimit.mockResolvedValueOnce([{ fullName: "Sam Sample" }]).mockResolvedValueOnce([]);
    expect(await loadProfileFullName("user-1")).toBe("Sam Sample");
    expect(await loadProfileFullName("user-2")).toBeNull();
  });

  it("firstNameOf takes the first token", () => {
    expect(firstNameOf("  Sam   Sample ")).toBe("Sam");
    expect(firstNameOf("")).toBeNull();
    expect(firstNameOf(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run src/lib/workiz/__tests__/route-errors.test.ts src/lib/workiz/__tests__/route-auth.test.ts src/lib/workiz/__tests__/import-store.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the shared types**

`src/types/workiz-import.ts`:
```ts
/**
 * Wire types for GET /api/workiz/jobs and POST /api/workiz/import. Lives in src/types (not
 * src/lib/workiz) so the client-side picker can import it without touching server modules.
 */

export type WorkizImporterRole = "admin" | "field_tech";

/** `canOpen: false` is exactly that — no inspection id or status leaks to a field tech */
export type WorkizExisting = { canOpen: true; inspectionId: string; status: string } | { canOpen: false };

export interface WorkizJobRow {
  id: string;
  serialId: number | null;
  street: string;
  city: string;
  /** "YYYY-MM-DD" (Workiz wall-clock date) or null */
  scheduledDate: string | null;
  subStatus: string | null;
  teamFirstNames: string[];
  existing: WorkizExisting | null;
}

export interface WorkizJobsResponse {
  jobs: WorkizJobRow[];
  fetchedAt: string;
  role: WorkizImporterRole;
  /** First token of profiles.fullName; null → the not-on-team warning is not shown */
  currentUserFirstName: string | null;
}

export type WorkizRouteErrorCode =
  | "workiz_not_configured"
  | "workiz_auth_failed"
  | "workiz_rate_limited"
  | "workiz_unavailable"
  | "workiz_bad_response"
  | "workiz_job_not_found"
  | "invalid_request"
  | "already_imported"
  | "not_adeq_job"
  | "not_importable"
  | "internal";

export interface WorkizErrorBody {
  error: string;
  code: WorkizRouteErrorCode;
  retryAfterSeconds?: number;
}

export type WorkizImportPrefill =
  | { status: "started"; runId: string }
  | { status: "skipped"; reason: "address_unparseable" }
  | { status: "failed" };

export interface WorkizImportCreated {
  inspectionId: string;
  existing: false;
  prefill: WorkizImportPrefill;
}

export interface WorkizImportExisting {
  inspectionId: string;
  existing: true;
  status: string;
}

export type WorkizImportResponse = WorkizImportCreated | WorkizImportExisting;
```

- [ ] **Step 4: Implement `route-errors.ts`, `route-auth.ts`, `import-store.ts`**

`src/lib/workiz/route-errors.ts`:
```ts
import { NextResponse } from "next/server";
import type { WorkizErrorBody, WorkizRouteErrorCode } from "@/types/workiz-import";
import type { WorkizError } from "./client";

/** Fixed, user-safe messages only — nothing from a Workiz body or a DB error is ever forwarded */
export const RATE_LIMIT_RETRY_AFTER_SECONDS = 60;

export function errorResponse(
  status: number,
  code: WorkizRouteErrorCode,
  error: string,
  extra: { retryAfterSeconds?: number } = {},
): NextResponse<WorkizErrorBody> {
  return NextResponse.json<WorkizErrorBody>({ error, code, ...extra }, { status });
}

export function workizErrorResponse(
  err: WorkizError,
  context: "list" | "import",
): NextResponse<WorkizErrorBody> {
  switch (err.code) {
    case "not_configured":
      return errorResponse(503, "workiz_not_configured", "Workiz import isn't set up on this server");
    case "auth_failed":
      return errorResponse(502, "workiz_auth_failed", "Workiz rejected the app's credentials");
    case "rate_limited":
      return errorResponse(503, "workiz_rate_limited", "Workiz is busy — try again in a minute", {
        retryAfterSeconds: RATE_LIMIT_RETRY_AFTER_SECONDS,
      });
    case "bad_response":
      return errorResponse(502, "workiz_bad_response", "Workiz sent a response the app couldn't read");
    case "not_found":
      if (context === "import") return errorResponse(404, "workiz_job_not_found", "Workiz job not found");
      return errorResponse(502, "workiz_unavailable", "Couldn't reach Workiz — try again");
    default:
      return errorResponse(502, "workiz_unavailable", "Couldn't reach Workiz — try again");
  }
}

export function internalErrorResponse(): NextResponse<WorkizErrorBody> {
  return errorResponse(500, "internal", "Something went wrong");
}
```

`src/lib/workiz/route-auth.ts`:
```ts
import type { User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getUserRole } from "@/lib/supabase/auth-helpers";
import { createClient } from "@/lib/supabase/server";
import type { WorkizImporterRole } from "@/types/workiz-import";

export type WorkizImporterAuth =
  | { ok: true; user: User; role: WorkizImporterRole }
  | { ok: false; response: NextResponse };

/**
 * Both Workiz routes: signed in (401) AND admin or field_tech (403) — the roles the nav offers
 * New Inspection to. office_staff and unprovisioned users (no role claim) are refused (spec §8.3).
 */
export async function requireWorkizImporter(): Promise<WorkizImporterAuth> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const role = await getUserRole(supabase);
  if (role !== "admin" && role !== "field_tech") {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true, user, role };
}
```

`src/lib/workiz/import-store.ts`:
```ts
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { inspections, profiles } from "@/lib/db/schema";

/**
 * DB access for the Workiz routes. Callers wrap every call in try/catch and log failures with
 * logDbError only (Drizzle error messages carry the query params — PII).
 */

export interface ImportedInspectionRow {
  id: string;
  inspectorId: string;
  status: string;
  workizJobId: string | null;
}

/** Matches the uuid (what the import and the webhook store) and the JOB-… id */
export async function findInspectionsByWorkizIds(
  ids: ReadonlyArray<string | null | undefined>,
): Promise<ImportedInspectionRow[]> {
  const unique = [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))];
  if (unique.length === 0) return [];
  return db
    .select({
      id: inspections.id,
      inspectorId: inspections.inspectorId,
      status: inspections.status,
      workizJobId: inspections.workizJobId,
    })
    .from(inspections)
    .where(inArray(inspections.workizJobId, unique));
}

export type ImportedInspectionValues = Pick<
  typeof inspections.$inferInsert,
  | "inspectorId"
  | "status"
  | "formData"
  | "fieldProvenance"
  | "facilityAddress"
  | "facilityCity"
  | "facilityZip"
  | "facilityCounty"
  | "facilityName"
  | "customerEmail"
  | "customerName"
  | "workizJobId"
  | "apn"
>;

export async function insertImportedInspection(values: ImportedInspectionValues): Promise<string> {
  const [row] = await db.insert(inspections).values(values).returning({ id: inspections.id });
  return row.id;
}

export async function loadProfileFullName(userId: string): Promise<string | null> {
  const [profile] = await db
    .select({ fullName: profiles.fullName })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  return profile?.fullName ?? null;
}

export function firstNameOf(fullName: string | null | undefined): string | null {
  const first = (fullName ?? "").trim().split(/\s+/)[0];
  return first ? first : null;
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx vitest run src/lib/workiz/__tests__/route-errors.test.ts src/lib/workiz/__tests__/route-auth.test.ts src/lib/workiz/__tests__/import-store.test.ts src/lib/workiz/__tests__/boundary.test.ts`
Expected: PASS.

- [ ] **Step 6: Type check, lint, commit**

Run the TypeScript baseline filter command (expected: no output), then:
```bash
npx biome lint src/types/workiz-import.ts src/lib/workiz/route-errors.ts src/lib/workiz/route-auth.ts src/lib/workiz/import-store.ts src/lib/workiz/__tests__/route-errors.test.ts src/lib/workiz/__tests__/route-auth.test.ts src/lib/workiz/__tests__/import-store.test.ts
git add src/types/workiz-import.ts src/lib/workiz/route-errors.ts src/lib/workiz/route-auth.ts src/lib/workiz/import-store.ts src/lib/workiz/__tests__/route-errors.test.ts src/lib/workiz/__tests__/route-auth.test.ts src/lib/workiz/__tests__/import-store.test.ts
git commit -F - <<'EOF'
feat(workiz-import): add route types, error responses, importer auth gate and import store

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
```

---

### Task T15: Provider — `getSecondary` / `acceptSecondary` / `dismissSecondary`

**Files:**
- Modify: `src/components/prefill/provenance-context.tsx`
- Modify: `src/lib/prefill/provenance-schema.ts` (export the 5,000-char value cap as a constant)
- Test: `src/components/prefill/__tests__/provenance-context.test.tsx`

**Interfaces:**
- Consumes: `secondaryKey`, `SECONDARY_APPEND_PATHS`, `appendSecondaryText` (T9).
- Produces (on `ProvenanceContextValue` and `NOOP_PROVENANCE`):
  ```ts
  getSecondary(fieldPath: string): ProvenanceEntry | undefined;
  /** Writes the Workiz value (comments paths append), primary := edited Workiz entry; keeps the secondary */
  acceptSecondary(fieldPath: string): void;
  /** Deletes the secondary key permanently for this inspection */
  dismissSecondary(fieldPath: string): void;
  ```
  `provenance-schema.ts` gains `export const PROVENANCE_VALUE_MAX_CHARS = 5000;`, used by `provenanceValueSchema`.

**Plan-level refinement (spec §6.3 Accept row):** the primary entry written on accept stores `newValue`. When an append makes `newValue` longer than `PROVENANCE_VALUE_MAX_CHARS`, the primary stores the Workiz text instead. Without this, one over-long entry would make the whole-map `PATCH /provenance` fail validation, and every provenance save for that draft would be lost. The form field still gets the full appended text.

- [ ] **Step 1: Write the failing tests**

In `src/components/prefill/__tests__/provenance-context.test.tsx`, add an optional `patch` to `makeWrapper`'s options and apply it to the defaults before `useForm`:
```tsx
function makeWrapper(opts: {
  formRef: FormRef;
  initial?: FieldProvenance;
  readOnly?: boolean;
  facility?: Partial<InspectionFormData["facilityInfo"]>;
  tanks?: Tank[];
  patch?: (f: InspectionFormData) => void;
}) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    const defaults = getDefaultFormValues("Tech") as unknown as InspectionFormData;
    opts.patch?.(defaults);
    // …rest unchanged
```
Then append:
```tsx
describe("secondary (Workiz) slot — spec §6.3 / §6.4", () => {
  const AT = "2026-10-12T17:04:05.000Z";
  const workiz = (value: ProvenanceEntry["value"], over: Partial<ProvenanceEntry> = {}): ProvenanceEntry => ({
    source: "workiz",
    state: "suggested",
    kind: "fill",
    value,
    confidence: 0.6,
    explanation: "Workiz client (job #4696)",
    at: AT,
    ...over,
  });

  it("getSecondary reads the secondary key; get() still reads the primary", () => {
    const formRef: FormRef = { current: null };
    const { result } = renderHook(() => useProvenance("facilityInfo.sellerName"), {
      wrapper: makeWrapper({
        formRef,
        initial: {
          "facilityInfo.sellerName": entry({ value: "OWNER OF RECORD" }),
          "secondary.facilityInfo.sellerName": workiz("Test Client"),
        },
      }),
    });
    expect(result.current.getSecondary("facilityInfo.sellerName")?.value).toBe("Test Client");
    expect(result.current.entry?.value).toBe("OWNER OF RECORD");
  });

  it("acceptSecondary writes the value, makes the primary an edited Workiz entry (keeping a warning, dropping prior), keeps the secondary and persists", async () => {
    const formRef: FormRef = { current: null };
    const prior = entry({ state: "edited", value: "Typed" });
    const { result } = renderHook(() => useProvenance("facilityInfo.sellerName"), {
      wrapper: makeWrapper({
        formRef,
        facility: { sellerName: "OWNER OF RECORD" },
        initial: {
          "facilityInfo.sellerName": entry({ value: "OWNER OF RECORD", warning: "Check owner", prior }),
          "secondary.facilityInfo.sellerName": workiz("Test Client"),
        },
      }),
    });
    act(() => result.current.acceptSecondary("facilityInfo.sellerName"));
    expect(formRef.current?.getValues("facilityInfo.sellerName")).toBe("Test Client");
    const primary = result.current.get("facilityInfo.sellerName");
    expect(primary).toMatchObject({ source: "workiz", state: "edited", value: "Test Client", warning: "Check owner" });
    expect(primary?.prior).toBeUndefined();
    expect(result.current.getSecondary("facilityInfo.sellerName")).toEqual(workiz("Test Client"));
    await act(async () => {
      vi.advanceTimersByTime(PROVENANCE_SAVE_DEBOUNCE_MS);
    });
    const body = lastPatchBody();
    expect(body.fieldProvenance["facilityInfo.sellerName"].state).toBe("edited");
    expect(body.fieldProvenance["secondary.facilityInfo.sellerName"]).toBeDefined();
  });

  it("grows the tanks array for a tanks.0 path", () => {
    const formRef: FormRef = { current: null };
    const { result } = renderHook(() => useProvenance("septicTank.tanks.0.tankCapacity"), {
      wrapper: makeWrapper({
        formRef,
        tanks: [],
        initial: { "secondary.septicTank.tanks.0.tankCapacity": workiz("1500", { confidence: 0.85 }) },
      }),
    });
    act(() => result.current.acceptSecondary("septicTank.tanks.0.tankCapacity"));
    expect(formRef.current?.getValues("septicTank.tanks.0.tankCapacity")).toBe("1500");
  });

  it.each(["septicTank.septicTankComments", "disposalWorks.disposalWorksComments"] as const)(
    "%s: appends to existing text and replaces only when empty",
    (path) => {
      const [section, field] = path.split(".") as ["septicTank" | "disposalWorks", string];
      const formRef: FormRef = { current: null };
      const { result } = renderHook(() => useProvenance(path), {
        wrapper: makeWrapper({
          formRef,
          patch: (f) => {
            (f[section] as Record<string, unknown>)[field] = "Baffle cracked.  ";
          },
          initial: { [`secondary.${path}`]: workiz("Roots at outlet.", { confidence: 0.8 }) },
        }),
      });
      act(() => result.current.acceptSecondary(path));
      expect(formRef.current?.getValues(path)).toBe("Baffle cracked.\n\nRoots at outlet.");
      expect(result.current.get(path)?.value).toBe("Baffle cracked.\n\nRoots at outlet.");

      act(() => formRef.current?.setValue(path, ""));
      act(() => result.current.acceptSecondary(path));
      expect(formRef.current?.getValues(path)).toBe("Roots at outlet.");
    },
  );

  it("an append longer than the provenance value cap stores the Workiz text in the primary", () => {
    const formRef: FormRef = { current: null };
    const path = "septicTank.septicTankComments";
    const { result } = renderHook(() => useProvenance(path), {
      wrapper: makeWrapper({
        formRef,
        patch: (f) => {
          f.septicTank.septicTankComments = "x".repeat(4990);
        },
        initial: { [`secondary.${path}`]: workiz("Roots at outlet.") },
      }),
    });
    act(() => result.current.acceptSecondary(path));
    expect((formRef.current?.getValues(path) as string).length).toBe(4990 + 2 + 16);
    expect(result.current.get(path)?.value).toBe("Roots at outlet.");
  });

  it("dismissSecondary removes only the secondary key and persists", async () => {
    const formRef: FormRef = { current: null };
    const { result } = renderHook(() => useProvenance("facilityInfo.sellerName"), {
      wrapper: makeWrapper({
        formRef,
        initial: {
          "facilityInfo.sellerName": entry(),
          "secondary.facilityInfo.sellerName": workiz("Test Client"),
        },
      }),
    });
    act(() => result.current.dismissSecondary("facilityInfo.sellerName"));
    expect(result.current.getSecondary("facilityInfo.sellerName")).toBeUndefined();
    expect(result.current.entry).toBeDefined();
    await act(async () => {
      vi.advanceTimersByTime(PROVENANCE_SAVE_DEBOUNCE_MS);
    });
    expect(lastPatchBody().fieldProvenance["secondary.facilityInfo.sellerName"]).toBeUndefined();
  });

  it("read-only: accept and dismiss are no-ops", () => {
    const formRef: FormRef = { current: null };
    const { result } = renderHook(() => useProvenance("facilityInfo.sellerName"), {
      wrapper: makeWrapper({
        formRef,
        readOnly: true,
        initial: { "secondary.facilityInfo.sellerName": workiz("Test Client") },
      }),
    });
    act(() => result.current.acceptSecondary("facilityInfo.sellerName"));
    act(() => result.current.dismissSecondary("facilityInfo.sellerName"));
    expect(formRef.current?.getValues("facilityInfo.sellerName")).toBe("");
    expect(result.current.getSecondary("facilityInfo.sellerName")).toBeDefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("acceptSecondary without a secondary does nothing", () => {
    const formRef: FormRef = { current: null };
    const { result } = renderHook(() => useProvenance("facilityInfo.sellerName"), {
      wrapper: makeWrapper({ formRef }),
    });
    act(() => result.current.acceptSecondary("facilityInfo.sellerName"));
    expect(result.current.entry).toBeUndefined();
  });

  it("the no-op context exposes the three methods", () => {
    expect(NOOP_PROVENANCE.getSecondary("facilityInfo.sellerName")).toBeUndefined();
    expect(() => NOOP_PROVENANCE.acceptSecondary("x")).not.toThrow();
    expect(() => NOOP_PROVENANCE.dismissSecondary("x")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run src/components/prefill/__tests__/provenance-context.test.tsx`
Expected: FAIL, `result.current.getSecondary is not a function`.

- [ ] **Step 3: Implement**

`src/lib/prefill/provenance-schema.ts`:
```ts
/** Max length of a string provenance value; the whole-map PATCH rejects anything longer */
export const PROVENANCE_VALUE_MAX_CHARS = 5000;

export const provenanceValueSchema = z.union([
  z.string().max(PROVENANCE_VALUE_MAX_CHARS),
  z.boolean(),
  z.array(z.string().max(500)).max(100),
]);
```

`src/components/prefill/provenance-context.tsx`:

1. Imports. Add:
```ts
import { PROVENANCE_VALUE_MAX_CHARS } from "@/lib/prefill/provenance-schema";
import { appendSecondaryText, SECONDARY_APPEND_PATHS, secondaryKey } from "@/lib/prefill/secondary";
```
2. Interface. Add after `setMany`:
```ts
  /** Import from Workiz: the `secondary.<path>` entry (a pink chip), never written to the form until accepted */
  getSecondary(fieldPath: string): ProvenanceEntry | undefined;
  /**
   * Writes the Workiz value into the form (the two comments paths append to existing text), then
   * makes the primary an `edited` Workiz entry so later runs never silently replace the user's
   * choice (spec §6.3). The secondary key is kept; it hides while the field equals it.
   */
  acceptSecondary(fieldPath: string): void;
  /** Deletes the secondary key — permanently for this inspection */
  dismissSecondary(fieldPath: string): void;
```
3. `NOOP_PROVENANCE`. Add `getSecondary: () => undefined, acceptSecondary: noop, dismissSecondary: noop,`.
4. Callbacks. Add after `setMany`:
```tsx
  const getSecondary = React.useCallback(
    (fieldPath: string) => provenance[secondaryKey(fieldPath)],
    [provenance],
  );

  const acceptSecondary = React.useCallback(
    (fieldPath: string) => {
      if (readOnly) return;
      const key = normalizeFieldPath(fieldPath);
      const sKey = secondaryKey(key);
      const secondary = provenanceRef.current[sKey];
      if (!secondary || secondary.kind !== "fill") return;
      ensureTankArrayCapacity(form, [key]);
      const formPath = key as FieldPath<InspectionFormData>;
      const newValue =
        SECONDARY_APPEND_PATHS.has(key) && typeof secondary.value === "string"
          ? appendSecondaryText(form.getValues(formPath), secondary.value)
          : secondary.value;
      form.setValue(formPath, newValue as never, { shouldDirty: true, shouldValidate: true });
      // An appended comment can outgrow the per-value cap; the whole-map PATCH would then reject
      // EVERY entry, so the primary records the Workiz text instead (the form keeps the full text)
      const storedValue =
        typeof newValue === "string" && newValue.length > PROVENANCE_VALUE_MAX_CHARS
          ? secondary.value
          : newValue;
      update((prev) => {
        const latest = prev[sKey];
        if (!latest) return prev;
        const old = prev[key];
        const { prior: _prior, warning: _warning, ...base } = latest;
        const primary: ProvenanceEntry = {
          ...base,
          value: storedValue,
          state: "edited",
          at: new Date().toISOString(),
          ...(old?.warning !== undefined ? { warning: old.warning } : {}),
        };
        return { ...prev, [key]: primary };
      });
    },
    [form, readOnly, update],
  );

  const dismissSecondary = React.useCallback(
    (fieldPath: string) => {
      if (readOnly) return;
      const sKey = secondaryKey(fieldPath);
      if (!(sKey in provenanceRef.current)) return;
      update((prev) => {
        if (!(sKey in prev)) return prev;
        const { [sKey]: _removed, ...rest } = prev;
        return rest;
      });
    },
    [readOnly, update],
  );
```
5. Add `getSecondary, acceptSecondary, dismissSecondary` to the `useMemo` value object and its dependency array.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/components/prefill/__tests__/provenance-context.test.tsx src/lib/prefill/__tests__/provenance-schema.test.ts src/components/inspection/__tests__/apn-lookup-provenance.test.tsx src/components/inspection/__tests__/inspection-wizard-provenance.test.tsx`
Expected: PASS. Existing consumers are unaffected because the new members are additive.

- [ ] **Step 5: Type check, lint, commit**

Run the TypeScript baseline filter command (expected: no output). Any hand-built `ProvenanceContextValue` object literal in other tests must now include the three members; add `getSecondary: () => undefined, acceptSecondary: vi.fn(), dismissSecondary: vi.fn()` where tsc flags one.
```bash
npx biome lint src/components/prefill/provenance-context.tsx src/lib/prefill/provenance-schema.ts
git add src/components/prefill/provenance-context.tsx src/lib/prefill/provenance-schema.ts src/components/prefill/__tests__/provenance-context.test.tsx
git commit -F - <<'EOF'
feat(prefill): accept and dismiss Workiz secondary suggestions in the provenance provider

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
```
(Add any test file you had to touch for the new context members to the `git add` list.)

---

## Wave 4

### Task T16: `mapJobToImportPlan` (`map-job.ts`)

**Files:**
- Create: `src/lib/workiz/map-job.ts`
- Test: `src/lib/workiz/__tests__/map-job.test.ts`

**Interfaces:**
- Consumes: `parseStreetAddress`, `formatFullAddress`, `prefillAddressSchema` (`@/lib/prefill/input`); `fieldProvenanceSchema`; `secondaryKey` (T9); `getDefaultFormValues`; `scheduledDateOf`, `teamNames`, `WORKIZ_CF` (T11); `findApnHint` (T12); the T6 maps and formatters.
- Produces:
  ```ts
  export const WORKIZ_ADDRESS_CONFIDENCE = 0.9;
  export type WorkizSkipReason = SkipReason | "non_az_state";
  export interface WorkizSkip { field: string; reason: WorkizSkipReason }   // field = CF id or "addressDetails.state"; never a value
  export type ImportFormData = ReturnType<typeof getDefaultFormValues>;
  export interface ImportPlan {
    formData: ImportFormData;                       // defaults + facilityAddress/City/Zip fill; county "" ; state "AZ"
    fieldProvenance: FieldProvenance;               // primary address entries + secondary.* entries
    columns: { facilityAddress: string | null; facilityCity: string | null; facilityZip: string | null; customerEmail: string | null; workizJobId: string };
    prefillInput: PrefillInput | null;              // null → address unparseable → no run
    skips: WorkizSkip[];
  }
  export function mapJobToImportPlan(job: WorkizJob, opts: { inspectorName: string; now?: string }): ImportPlan;
  export function sanitizeProvenance(map: FieldProvenance): { map: FieldProvenance; dropped: string[] };
  ```
  `columns` deliberately has no `customerName`. It stays null at insert (spec §5.1).

- [ ] **Step 1: Write the failing test**

`src/lib/workiz/__tests__/map-job.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { fieldProvenanceSchema } from "@/lib/prefill/provenance-schema";
import type { FieldProvenance } from "@/lib/prefill/types";
import { WORKIZ_CF } from "@/lib/workiz/adeq";
import { mapJobToImportPlan, sanitizeProvenance } from "@/lib/workiz/map-job";
import { workizJobSchema } from "@/lib/workiz/schema";
import { BOT_NOTES, cf, fixtures, job, withAddress, withClient } from "./fixtures/jobs";

const NOW = "2026-10-13T15:00:00.000Z";
const plan = (raw: Record<string, unknown>) =>
  mapJobToImportPlan(workizJobSchema.parse(raw), { inspectorName: "Sam Sample", now: NOW });
const secondaryPaths = (p: ReturnType<typeof plan>) =>
  Object.keys(p.fieldProvenance)
    .filter((k) => k.startsWith("secondary."))
    .sort();

describe("address (spec §5.1)", () => {
  it("fills street/city/ZIP with primary prefilled 0.9 entries and matching secondary chips", () => {
    const p = plan(fixtures.importable());
    expect(p.formData.facilityInfo).toMatchObject({
      facilityAddress: "100 E Example Rd",
      facilityCity: "Cave Creek",
      facilityZip: "85331",
      facilityState: "AZ",
      facilityCounty: "",
      inspectorName: "Sam Sample",
    });
    for (const [path, value] of [
      ["facilityInfo.facilityAddress", "100 E Example Rd"],
      ["facilityInfo.facilityCity", "Cave Creek"],
      ["facilityInfo.facilityZip", "85331"],
    ]) {
      const expected = {
        source: "workiz",
        kind: "fill",
        value,
        confidence: 0.9,
        explanation: "Workiz job #4696 · service address",
        at: NOW,
      };
      expect(p.fieldProvenance[path]).toEqual({ ...expected, state: "prefilled" });
      expect(p.fieldProvenance[`secondary.${path}`]).toEqual({ ...expected, state: "suggested" });
    }
    expect(p.columns).toEqual({
      facilityAddress: "100 E Example Rd",
      facilityCity: "Cave Creek",
      facilityZip: "85331",
      customerEmail: "test.client@example.com",
      workizJobId: "AB12CD",
    });
    expect(p.columns).not.toHaveProperty("customerName");
  });

  it("appends the unit, title-cases a lower-case city and keeps the first 5 ZIP digits", () => {
    expect(plan(fixtures.unit()).formData.facilityInfo.facilityAddress).toBe("100 E Example Rd #12");
    expect(plan(fixtures.lowercaseCity()).formData.facilityInfo.facilityCity).toBe("Laveen");
    expect(plan(withAddress({ zipCode: "85331-1234" })).columns.facilityZip).toBe("85331");
  });

  it("an invalid ZIP is neither filled nor chipped, and the run gets no zipMustMatch", () => {
    const p = plan(withAddress({ zipCode: "8533" }));
    expect(p.formData.facilityInfo.facilityZip).toBe("");
    expect(p.fieldProvenance["facilityInfo.facilityZip"]).toBeUndefined();
    expect(p.fieldProvenance["secondary.facilityInfo.facilityZip"]).toBeUndefined();
    expect(p.columns.facilityZip).toBeNull();
    expect(p.prefillInput).toEqual({
      address: { streetNumber: "100", streetDir: "E", streetName: "Example Rd", city: "Cave Creek", full: "100 E Example Rd, Cave Creek, AZ" },
    });
  });

  it("state: Arizona/AZ/empty → AZ silently; anything else → AZ + non_az_state skip", () => {
    expect(plan(withAddress({ state: "arizona" })).skips).toEqual([]);
    expect(plan(withAddress({ state: "" })).skips).toEqual([]);
    const nv = plan(withAddress({ state: "NV" }));
    expect(nv.formData.facilityInfo.facilityState).toBe("AZ");
    expect(nv.skips).toContainEqual({ field: "addressDetails.state", reason: "non_az_state" });
  });

  it("builds the run input from the parsed street (unit dropped) + city + ZIP, with zipMustMatch", () => {
    expect(plan(fixtures.unit()).prefillInput).toEqual({
      address: {
        streetNumber: "100",
        streetDir: "E",
        streetName: "Example Rd",
        city: "Cave Creek",
        zip: "85331",
        full: "100 E Example Rd, Cave Creek, AZ 85331",
      },
      zipMustMatch: true,
    });
  });

  it("an address without a leading house number → no run input, but the street is still filled", () => {
    const p = plan(withAddress({ address: "Rural Route Box" }));
    expect(p.prefillInput).toBeNull();
    expect(p.formData.facilityInfo.facilityAddress).toBe("Rural Route Box");
  });
});

describe("chips (secondary only, never written to formData)", () => {
  it("date: the YYYY-MM-DD slice with the raw value as evidence; unscheduled → none", () => {
    const p = plan(fixtures.importable());
    expect(p.fieldProvenance["secondary.facilityInfo.dateOfInspection"]).toMatchObject({
      value: "2026-10-06",
      confidence: 0.9,
      explanation: "Workiz scheduled date (job #4696)",
      evidence: "date: 2026-10-06 12:00:00",
    });
    expect(p.formData.facilityInfo.dateOfInspection).toBe("");
    expect(plan(fixtures.unscheduled()).fieldProvenance["secondary.facilityInfo.dateOfInspection"]).toBeUndefined();
  });

  it("seller name: first + last, else company, else none; never fills the field", () => {
    const p = plan(fixtures.importable());
    expect(p.fieldProvenance["secondary.facilityInfo.sellerName"]).toMatchObject({
      value: "Test Client",
      confidence: 0.6,
      explanation: "Workiz client (job #4696)",
    });
    expect(p.formData.facilityInfo.sellerName).toBe("");
    const company = plan(withClient({ firstName: "", lastName: "", companyName: "Example Holdings LLC" }));
    expect(company.fieldProvenance["secondary.facilityInfo.sellerName"]?.value).toBe("Example Holdings LLC");
    const none = plan(withClient({ firstName: " ", lastName: "", companyName: "" }));
    expect(none.fieldProvenance["secondary.facilityInfo.sellerName"]).toBeUndefined();
  });

  it("email: valid → customer_email; invalid → null", () => {
    expect(plan(withClient({ email: "not-an-email" })).columns.customerEmail).toBeNull();
    expect(plan(withClient({ email: "" })).columns.customerEmail).toBeNull();
  });

  it("team: trimmed names in Workiz order, de-duplicated, capped at 200 chars; empty team → none", () => {
    expect(plan(fixtures.multiTeam()).fieldProvenance["secondary.facilityInfo.employeeName"]).toMatchObject({
      value: "Alex Tester, Sam Sample, alex Other",
      confidence: 0.8,
      explanation: "Workiz team (job #4696)",
    });
    expect(plan(fixtures.emptyTeam()).fieldProvenance["secondary.facilityInfo.employeeName"]).toBeUndefined();
    const big = plan({
      ...fixtures.importable(),
      team: Array.from({ length: 30 }, (_, i) => ({ id: i, name: `Tech Number${i}` })),
    });
    const value = big.fieldProvenance["secondary.facilityInfo.employeeName"]?.value as string;
    expect(value.length).toBeLessThanOrEqual(200);
    expect(value).not.toMatch(/[,\s]$/);
  });

  it("APN: custom field (0.7) or permit-bot note with its confidence; invalid CF → invalid_apn skip", () => {
    const fromCf = plan({ ...fixtures.importable(), customFields: [cf(WORKIZ_CF.apn, "12345670")] });
    expect(fromCf.fieldProvenance["secondary.facilityInfo.taxParcelNumber"]).toMatchObject({
      value: "123-45-670",
      confidence: 0.7,
      explanation: "Workiz APN field (job #4696)",
      evidence: "APN 123-45-670",
    });
    const fromNote = plan({ ...fixtures.importable(), notes: [BOT_NOTES.grokHigh] });
    expect(fromNote.fieldProvenance["secondary.facilityInfo.taxParcelNumber"]).toMatchObject({
      value: "123-45-678",
      confidence: 0.6,
      explanation: "Workiz note — permit bot, confidence high (job #4696)",
    });
    const unstated = plan({ ...fixtures.importable(), notes: [BOT_NOTES.noConfidence] });
    expect(unstated.fieldProvenance["secondary.facilityInfo.taxParcelNumber"]?.explanation).toBe(
      "Workiz note — permit bot, confidence not stated (job #4696)",
    );
    const invalid = plan({ ...fixtures.importable(), customFields: [cf(WORKIZ_CF.apn, "see file")] });
    expect(invalid.skips).toContainEqual({ field: WORKIZ_CF.apn, reason: "invalid_apn" });
    expect(invalid.fieldProvenance["secondary.facilityInfo.taxParcelNumber"]).toBeUndefined();
  });

  it("custom-field chips: value maps, confidences, explanations and evidence", () => {
    const p = plan({
      ...fixtures.importable(),
      customFields: [
        cf(WORKIZ_CF.waterSource, "Private Well", "Water Source "),
        cf(WORKIZ_CF.tankSize, "1,500 Gallons"),
        cf(WORKIZ_CF.effluentFilter, "Yes"),
        cf(WORKIZ_CF.flowTestCompleted, "No"),
        cf(WORKIZ_CF.tankRecommendation, "Operational W/Concerns"),
        cf(WORKIZ_CF.drainfieldRecommendation, "Non-Operational"),
        cf("CF-someCheckbox00001", true),
      ],
    });
    expect(p.fieldProvenance["secondary.facilityInfo.waterSource"]).toEqual({
      source: "workiz",
      state: "suggested",
      kind: "fill",
      value: "private_well",
      confidence: 0.85,
      explanation: "Workiz job #4696 · Water Source",
      evidence: 'Water Source: "Private Well"',
      at: NOW,
    });
    expect(p.fieldProvenance["secondary.septicTank.tanks.0.tankCapacity"]?.value).toBe("1500");
    expect(p.fieldProvenance["secondary.septicTank.tanks.0.effluentFilterPresent"]?.value).toBe("present");
    expect(p.fieldProvenance["secondary.disposalWorks.hydraulicLoadTestPerformed"]?.value).toBe("no");
    expect(p.fieldProvenance["secondary.facilityInfo.septicTankCondition"]?.value).toBe("operational_with_concerns");
    expect(p.fieldProvenance["secondary.facilityInfo.disposalWorksCondition"]?.value).toBe("not_operational");
    expect(p.skips).toEqual([]); // the checkbox CF is ignored silently
    expect(p.formData.facilityInfo.waterSource).toBe("");
  });

  it("skips unmappable values with a reason code only", () => {
    const p = plan({
      ...fixtures.importable(),
      customFields: [
        cf(WORKIZ_CF.waterSource, "Municipal / Private Water Supply"),
        cf(WORKIZ_CF.tankSize, "18"),
        cf(WORKIZ_CF.effluentFilter, ""),
        cf(WORKIZ_CF.tankRecommendation, "Needs Pumping"),
      ],
    });
    expect(p.skips).toEqual([
      { field: WORKIZ_CF.waterSource, reason: "ambiguous" },
      { field: WORKIZ_CF.tankSize, reason: "out_of_range" },
      { field: WORKIZ_CF.effluentFilter, reason: "empty" },
      { field: WORKIZ_CF.tankRecommendation, reason: "unknown_option" },
    ]);
    expect(JSON.stringify(p.skips)).not.toMatch(/Municipal|Pumping/);
  });

  it("two separate comment chips: concerns → septic tank comments, flow test description → disposal works comments", () => {
    const p = plan({
      ...fixtures.importable(),
      customFields: [
        cf(WORKIZ_CF.notableConcerns, "Inlet baffle cracked."),
        cf(WORKIZ_CF.flowTestDescription, "Ran 150 gal, no surfacing."),
      ],
    });
    expect(p.fieldProvenance["secondary.septicTank.septicTankComments"]).toMatchObject({
      value: "Inlet baffle cracked.",
      confidence: 0.8,
      explanation: "Workiz job #4696 · Notable Concerns",
    });
    expect(p.fieldProvenance["secondary.disposalWorks.disposalWorksComments"]).toMatchObject({
      value: "Ran 150 gal, no surfacing.",
      confidence: 0.8,
      explanation: "Workiz job #4696 · Flow Test Description",
    });
    expect(p.fieldProvenance["secondary.septicTank.septicTankComments"]?.evidence).toBeUndefined();
  });

  it("'none' concerns and an empty flow description are dropped", () => {
    const p = plan({
      ...fixtures.importable(),
      customFields: [cf(WORKIZ_CF.notableConcerns, "None."), cf(WORKIZ_CF.flowTestDescription, "  ")],
    });
    expect(p.fieldProvenance["secondary.septicTank.septicTankComments"]).toBeUndefined();
    expect(p.fieldProvenance["secondary.disposalWorks.disposalWorksComments"]).toBeUndefined();
  });
});

describe("whole plan", () => {
  it("every key and entry passes fieldProvenanceSchema; secondary keys are the expected set", () => {
    const p = plan({
      ...fixtures.importable(),
      notes: [BOT_NOTES.grokHigh],
      customFields: [
        cf(WORKIZ_CF.waterSource, "Private Well"),
        cf(WORKIZ_CF.tankSize, "1500"),
        cf(WORKIZ_CF.effluentFilter, "Yes"),
        cf(WORKIZ_CF.flowTestCompleted, "Yes"),
        cf(WORKIZ_CF.tankRecommendation, "Operational"),
        cf(WORKIZ_CF.drainfieldRecommendation, "Operational"),
        cf(WORKIZ_CF.notableConcerns, "Inlet baffle cracked."),
        cf(WORKIZ_CF.flowTestDescription, "Ran 150 gal."),
      ],
    });
    expect(fieldProvenanceSchema.safeParse(p.fieldProvenance).success).toBe(true);
    expect(secondaryPaths(p)).toEqual(
      [
        "secondary.disposalWorks.disposalWorksComments",
        "secondary.disposalWorks.hydraulicLoadTestPerformed",
        "secondary.facilityInfo.dateOfInspection",
        "secondary.facilityInfo.disposalWorksCondition",
        "secondary.facilityInfo.employeeName",
        "secondary.facilityInfo.facilityAddress",
        "secondary.facilityInfo.facilityCity",
        "secondary.facilityInfo.facilityZip",
        "secondary.facilityInfo.sellerName",
        "secondary.facilityInfo.septicTankCondition",
        "secondary.facilityInfo.taxParcelNumber",
        "secondary.facilityInfo.waterSource",
        "secondary.septicTank.septicTankComments",
        "secondary.septicTank.tanks.0.effluentFilterPresent",
        "secondary.septicTank.tanks.0.tankCapacity",
      ].sort(),
    );
    for (const e of Object.values(p.fieldProvenance)) {
      expect(e.source).toBe("workiz");
      expect(e.runId).toBeUndefined();
      expect(e.sourceUrl).toBeUndefined();
    }
  });

  it("workizJobId is the 6-char uuid, not the JOB- id", () => {
    expect(plan(fixtures.importable()).columns.workizJobId).toBe("AB12CD");
  });

  it("uses the job serial in explanations, '?' when absent", () => {
    const p = mapJobToImportPlan(job({ serialId: null }), { inspectorName: "Sam Sample", now: NOW });
    expect(p.fieldProvenance["facilityInfo.facilityAddress"]?.explanation).toBe("Workiz job #? · service address");
  });
});

describe("sanitizeProvenance", () => {
  it("keeps valid entries and reports the paths of invalid ones", () => {
    const good = plan(fixtures.importable()).fieldProvenance;
    const bad: FieldProvenance = {
      ...good,
      "secondary.facilityInfo.sellerName": { ...good["secondary.facilityInfo.sellerName"], value: "x".repeat(6000) },
      "bad key!": good["facilityInfo.facilityAddress"],
    };
    const { map, dropped } = sanitizeProvenance(bad);
    expect(dropped.sort()).toEqual(["bad key!", "secondary.facilityInfo.sellerName"]);
    expect(map["facilityInfo.facilityAddress"]).toEqual(good["facilityInfo.facilityAddress"]);
    expect(fieldProvenanceSchema.safeParse(map).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/lib/workiz/__tests__/map-job.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`src/lib/workiz/map-job.ts`:
```ts
import { z } from "zod";
import { formatFullAddress, parseStreetAddress, prefillAddressSchema } from "@/lib/prefill/input";
import { fieldProvenanceSchema } from "@/lib/prefill/provenance-schema";
import { secondaryKey } from "@/lib/prefill/secondary";
import type { FieldProvenance, PrefillInput, ProvenanceEntry, ProvenanceValue } from "@/lib/prefill/types";
import { getDefaultFormValues } from "@/lib/validators/inspection";
import { scheduledDateOf, teamNames, WORKIZ_CF } from "./adeq";
import { findApnHint } from "./apn-hint";
import {
  formatWorkizCity,
  formatWorkizStreet,
  formatWorkizZip,
  type MapResult,
  mapCondition,
  mapEffluentFilter,
  mapFlowTestCompleted,
  mapFreeText,
  mapTankSize,
  mapWaterSource,
  type SkipReason,
} from "./custom-fields";
import type { WorkizJob } from "./schema";

/**
 * Pure: Workiz job → everything POST /api/workiz/import writes (spec §5.1). The address is a
 * primary fill AND a same-value secondary chip; every other value is a secondary chip only
 * (`secondary.<path>`, never written to formData). No logging here — callers log `skips`
 * (field ids + reason codes, never values).
 */

export const WORKIZ_ADDRESS_CONFIDENCE = 0.9;
const TEAM_MAX_CHARS = 200;
const EVIDENCE_VALUE_MAX_CHARS = 200;
const emailSchema = z.string().trim().max(254).email();

export type WorkizSkipReason = SkipReason | "non_az_state";

export interface WorkizSkip {
  /** A custom-field id or "addressDetails.state" — never a value */
  field: string;
  reason: WorkizSkipReason;
}

export type ImportFormData = ReturnType<typeof getDefaultFormValues>;

export interface ImportPlan {
  formData: ImportFormData;
  fieldProvenance: FieldProvenance;
  columns: {
    facilityAddress: string | null;
    facilityCity: string | null;
    facilityZip: string | null;
    customerEmail: string | null;
    workizJobId: string;
  };
  /** null → the street could not be parsed: the draft is created without a prefill run */
  prefillInput: PrefillInput | null;
  skips: WorkizSkip[];
}

interface CustomFieldRule {
  id: string;
  label: string;
  path: string;
  confidence: number;
  map: (raw: string) => MapResult;
  /** Enum answers quote the Workiz option as evidence; free text does not (the value is the text) */
  evidence: boolean;
}

const CUSTOM_FIELD_RULES: CustomFieldRule[] = [
  { id: WORKIZ_CF.waterSource, label: "Water Source", path: "facilityInfo.waterSource", confidence: 0.85, map: mapWaterSource, evidence: true },
  { id: WORKIZ_CF.tankSize, label: "Tank Size", path: "septicTank.tanks.0.tankCapacity", confidence: 0.85, map: mapTankSize, evidence: true },
  { id: WORKIZ_CF.effluentFilter, label: "Has Effluent Filter", path: "septicTank.tanks.0.effluentFilterPresent", confidence: 0.85, map: mapEffluentFilter, evidence: true },
  { id: WORKIZ_CF.flowTestCompleted, label: "Flow Test Completed", path: "disposalWorks.hydraulicLoadTestPerformed", confidence: 0.85, map: mapFlowTestCompleted, evidence: true },
  { id: WORKIZ_CF.tankRecommendation, label: "Tank Recommendation", path: "facilityInfo.septicTankCondition", confidence: 0.85, map: mapCondition, evidence: true },
  { id: WORKIZ_CF.drainfieldRecommendation, label: "Drainfield Recommendation", path: "facilityInfo.disposalWorksCondition", confidence: 0.85, map: mapCondition, evidence: true },
  { id: WORKIZ_CF.notableConcerns, label: "Notable Concerns", path: "septicTank.septicTankComments", confidence: 0.8, map: (raw) => mapFreeText(raw, { dropNoneAnswers: true }), evidence: false },
  { id: WORKIZ_CF.flowTestDescription, label: "Flow Test Description", path: "disposalWorks.disposalWorksComments", confidence: 0.8, map: (raw) => mapFreeText(raw), evidence: false },
];

function buildPrefillInput(rawAddress: string, city: string, zip: string | null): PrefillInput | null {
  const parsed = parseStreetAddress(formatWorkizStreet(rawAddress, ""));
  if (!parsed) return null;
  const address = { ...parsed, ...(city ? { city } : {}), ...(zip ? { zip } : {}) };
  const checked = prefillAddressSchema.safeParse({ ...address, full: formatFullAddress(address) });
  if (!checked.success) return null;
  return { address: checked.data, ...(zip ? { zipMustMatch: true } : {}) };
}

export function mapJobToImportPlan(
  job: WorkizJob,
  opts: { inspectorName: string; now?: string },
): ImportPlan {
  const now = opts.now ?? new Date().toISOString();
  const n = job.serialId ?? "?";
  const formData = getDefaultFormValues(opts.inspectorName);
  const fieldProvenance: FieldProvenance = {};
  const skips: WorkizSkip[] = [];

  const suggestion = (
    value: ProvenanceValue,
    confidence: number,
    explanation: string,
    evidence?: string,
  ): ProvenanceEntry => ({
    source: "workiz",
    state: "suggested",
    kind: "fill",
    value,
    confidence,
    explanation,
    ...(evidence ? { evidence } : {}),
    at: now,
  });
  const chip = (path: string, value: ProvenanceValue, confidence: number, explanation: string, evidence?: string): void => {
    fieldProvenance[secondaryKey(path)] = suggestion(value, confidence, explanation, evidence);
  };

  // Address: primary fill (the run's starting point) + same-value chip (survives the assessor's replacement)
  const details = job.clientInfo.addressDetails;
  const street = formatWorkizStreet(details.address, details.unit);
  const city = formatWorkizCity(details.city);
  const zip = formatWorkizZip(details.zipCode);
  const addressExplanation = `Workiz job #${n} · service address`;
  const fillAddress = (path: string, value: string): void => {
    fieldProvenance[path] = { ...suggestion(value, WORKIZ_ADDRESS_CONFIDENCE, addressExplanation), state: "prefilled" };
    chip(path, value, WORKIZ_ADDRESS_CONFIDENCE, addressExplanation);
  };
  if (street) {
    formData.facilityInfo.facilityAddress = street;
    fillAddress("facilityInfo.facilityAddress", street);
  }
  if (city) {
    formData.facilityInfo.facilityCity = city;
    fillAddress("facilityInfo.facilityCity", city);
  }
  if (zip) {
    formData.facilityInfo.facilityZip = zip;
    fillAddress("facilityInfo.facilityZip", zip);
  }
  const state = details.state.trim();
  if (state && !/^(az|arizona)$/i.test(state)) skips.push({ field: "addressDetails.state", reason: "non_az_state" });
  formData.facilityInfo.facilityState = "AZ";
  // County is left blank on purpose: the assessor fills Maricopa at 1.0; ~3% of jobs are elsewhere (§5.4)

  const scheduled = scheduledDateOf(job);
  if (scheduled) {
    chip("facilityInfo.dateOfInspection", scheduled, 0.9, `Workiz scheduled date (job #${n})`, `date: ${job.date}`);
  }

  const client = job.clientInfo;
  const person = `${client.firstName} ${client.lastName}`.replace(/\s+/g, " ").trim();
  const clientName = person || client.companyName.replace(/\s+/g, " ").trim();
  if (clientName) chip("facilityInfo.sellerName", clientName, 0.6, `Workiz client (job #${n})`);

  const team = teamNames(job).join(", ").slice(0, TEAM_MAX_CHARS).replace(/[,\s]+$/, "");
  if (team) chip("facilityInfo.employeeName", team, 0.8, `Workiz team (job #${n})`);

  const { hint, customFieldInvalid } = findApnHint(job);
  if (customFieldInvalid) skips.push({ field: WORKIZ_CF.apn, reason: "invalid_apn" });
  if (hint) {
    const explanation =
      hint.source === "custom_field"
        ? `Workiz APN field (job #${n})`
        : `Workiz note — permit bot, confidence ${hint.noteConfidence === "unstated" ? "not stated" : hint.noteConfidence} (job #${n})`;
    chip("facilityInfo.taxParcelNumber", hint.apn, hint.confidence, explanation, `APN ${hint.apn}`);
  }

  for (const rule of CUSTOM_FIELD_RULES) {
    const field = job.customFields.find((f) => f.id === rule.id);
    if (!field || typeof field.value === "boolean") continue; // absent, or a checkbox field
    const raw = field.value ?? "";
    const result = rule.map(raw);
    if (!result.ok) {
      skips.push({ field: rule.id, reason: result.reason });
      continue;
    }
    const evidence = rule.evidence ? `${rule.label}: "${raw.trim().slice(0, EVIDENCE_VALUE_MAX_CHARS)}"` : undefined;
    chip(rule.path, result.value, rule.confidence, `Workiz job #${n} · ${rule.label}`, evidence);
  }

  const email = emailSchema.safeParse(client.email);
  return {
    formData,
    fieldProvenance,
    columns: {
      facilityAddress: street || null,
      facilityCity: city || null,
      facilityZip: zip,
      customerEmail: email.success ? email.data : null,
      workizJobId: job.uuid,
    },
    prefillInput: buildPrefillInput(details.address, city, zip),
    skips,
  };
}

/** Validates entry by entry; an entry that fails is dropped (the caller logs its path) */
export function sanitizeProvenance(map: FieldProvenance): { map: FieldProvenance; dropped: string[] } {
  const out: FieldProvenance = {};
  const dropped: string[] = [];
  for (const [path, entry] of Object.entries(map)) {
    if (fieldProvenanceSchema.safeParse({ [path]: entry }).success) out[path] = entry;
    else dropped.push(path);
  }
  return { map: out, dropped };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run src/lib/workiz/__tests__/map-job.test.ts`
Expected: PASS. In the "invalid ZIP" case, `formatFullAddress` omits the ZIP: `"100 E Example Rd, Cave Creek, AZ"`.

- [ ] **Step 5: Type check, lint, commit**

Run the TypeScript baseline filter command (expected: no output). `formData.facilityInfo.facilityAddress = street` must type-check against `getDefaultFormValues`'s inferred literal type (`string`). Then:
```bash
npx biome lint src/lib/workiz/map-job.ts src/lib/workiz/__tests__/map-job.test.ts
git add src/lib/workiz/map-job.ts src/lib/workiz/__tests__/map-job.test.ts
git commit -F - <<'EOF'
feat(workiz-import): map a Workiz job to an import plan (address fill + secondary chips)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
```

---

### Task T17: `<SecondarySuggestionChip>` + `form.tsx` wiring

**Files:**
- Modify: `src/components/prefill/suggestion-chip.tsx`
- Modify: `src/components/ui/form.tsx` (`FormItem` and `FormFieldGroup`)
- Test: `src/components/prefill/__tests__/suggestion-chip.test.tsx` (+)
- Test: `src/components/ui/__tests__/form-provenance.test.tsx` (+)

**Interfaces:**
- Consumes: `getSecondary`, `acceptSecondary`, `dismissSecondary` (T15); `isSecondaryVisible` (T9); `SOURCE_META.workiz` (T2).
- Produces:
  ```tsx
  export function ChipView(props: { entry: ProvenanceEntry; fieldPath: string; readOnly: boolean; onAccept: () => void; onDismiss: () => void; slot?: string; dismissLabel?: string }): JSX.Element;
  export function SecondarySuggestionChip(props: { fieldPath: string }): JSX.Element | null;   // data-slot="secondary-suggestion-chip"
  ```
  `FormItem` (outside groups) and `FormFieldGroup` render `<SecondarySuggestionChip>` after the existing chip whenever `getSecondary(name)` exists, whatever the primary's state.

- [ ] **Step 1: Write the failing tests**

Append to `src/components/prefill/__tests__/suggestion-chip.test.tsx`. Add `SecondarySuggestionChip` to the existing import from `@/components/prefill/suggestion-chip` and `within` to the RTL import:
```tsx
describe("SecondarySuggestionChip (Workiz)", () => {
  const WATER = "facilityInfo.waterSource";
  const SECONDARY: ProvenanceEntry = {
    source: "workiz",
    state: "suggested",
    kind: "fill",
    value: "private_well",
    confidence: 0.85,
    explanation: "Workiz job #4696 · Water Source",
    evidence: 'Water Source: "Private Well"',
    at: "2026-10-12T17:04:05.000Z",
  };

  function WaterInput() {
    const { register } = useFormContext<InspectionFormData>();
    return <input aria-label="Water source" {...register(WATER)} />;
  }

  it("renders a pink chip that reads like a permit chip, and hides once accepted", async () => {
    const user = userEvent.setup();
    render(
      <Harness initial={{ [`secondary.${WATER}`]: SECONDARY }} withFormProvider>
        <WaterInput />
        <SecondarySuggestionChip fieldPath={WATER} />
      </Harness>,
    );
    const chip = document.querySelector('[data-slot="secondary-suggestion-chip"]') as HTMLElement;
    expect(chip).not.toBeNull();
    expect(chip.className).toContain("border-pink-300");
    expect(within(chip).getByText("Suggested: Private Well · 85% · Workiz job #4696 · Water Source")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Accept suggestion from Workiz: Private Well" }));
    expect(formRef.current?.getValues(WATER)).toBe("private_well");
    expect(document.querySelector('[data-slot="secondary-suggestion-chip"]')).toBeNull();
  });

  it("is hidden while the field already holds the value", () => {
    render(
      <Harness
        initial={{ [`secondary.${WATER}`]: SECONDARY }}
        values={(f) => {
          f.facilityInfo.waterSource = "private_well";
        }}
        withFormProvider
      >
        <SecondarySuggestionChip fieldPath={WATER} />
      </Harness>,
    );
    expect(document.querySelector('[data-slot="secondary-suggestion-chip"]')).toBeNull();
  });

  it("× dismisses it", async () => {
    const user = userEvent.setup();
    render(
      <Harness initial={{ [`secondary.${WATER}`]: SECONDARY }} withFormProvider>
        <SecondarySuggestionChip fieldPath={WATER} />
      </Harness>,
    );
    await user.click(screen.getByRole("button", { name: "Dismiss Workiz suggestion" }));
    expect(document.querySelector('[data-slot="secondary-suggestion-chip"]')).toBeNull();
  });

  it("read-only: accept disabled, no dismiss", () => {
    render(
      <Harness initial={{ [`secondary.${WATER}`]: SECONDARY }} readOnly withFormProvider>
        <SecondarySuggestionChip fieldPath={WATER} />
      </Harness>,
    );
    expect(screen.getByRole("button", { name: /Accept suggestion from Workiz/ })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Dismiss Workiz suggestion" })).toBeNull();
  });

  it("renders nothing without a secondary entry", () => {
    const { container } = render(
      <Harness initial={{}} withFormProvider>
        <SecondarySuggestionChip fieldPath={WATER} />
      </Harness>,
    );
    expect(container.querySelector('[data-slot="secondary-suggestion-chip"]')).toBeNull();
  });
});
```

Append to `src/components/ui/__tests__/form-provenance.test.tsx`:
```tsx
describe("FormItem / FormFieldGroup — Workiz secondary chip", () => {
  const SECONDARY: ProvenanceEntry = {
    source: "workiz",
    state: "suggested",
    kind: "fill",
    value: "Test Client",
    confidence: 0.6,
    explanation: "Workiz client (job #4696)",
    at: "2026-10-12T17:04:05.000Z",
  };
  const KEY = "secondary.facilityInfo.facilityName";
  const secondaryChip = () => document.querySelector('[data-slot="secondary-suggestion-chip"]');

  it.each([
    ["absent", {}],
    ["prefilled", { "facilityInfo.facilityName": { ...ENTRY, value: "" } }],
    ["edited", { "facilityInfo.facilityName": { ...ENTRY, state: "edited" as const, value: "" } }],
  ])("FormItem renders it when the primary is %s", (_label, primary) => {
    render(<WithProvenance initial={{ ...primary, [KEY]: SECONDARY }} />);
    expect(secondaryChip()).not.toBeNull();
    expect(screen.getByText("Suggested: Test Client · 60% · Workiz client (job #4696)")).toBeInTheDocument();
  });

  it("FormItem renders it alongside a suggested primary chip", () => {
    render(
      <WithProvenance
        initial={{
          "facilityInfo.facilityName": { ...ENTRY, state: "suggested", value: "OWNER OF RECORD" },
          [KEY]: SECONDARY,
        }}
      />,
    );
    expect(document.querySelector('[data-slot="suggestion-chip"]')).not.toBeNull();
    expect(secondaryChip()).not.toBeNull();
  });

  it("FormFieldGroup renders it once for the group path", () => {
    function Group() {
      const form = useForm<InspectionFormData>({
        defaultValues: getDefaultFormValues("Tech") as unknown as InspectionFormData,
      });
      return (
        <ProvenanceProvider
          form={form}
          inspectionId="insp-1"
          initial={{ "secondary.facilityInfo.waterSource": { ...SECONDARY, value: "private_well", explanation: "Workiz job #4696 · Water Source" } }}
        >
          <Form {...form}>
            <FormFieldGroup name="facilityInfo.waterSource" label="Water source">
              <span>options</span>
            </FormFieldGroup>
          </Form>
        </ProvenanceProvider>
      );
    }
    render(<Group />);
    expect(document.querySelectorAll('[data-slot="secondary-suggestion-chip"]')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run src/components/prefill/__tests__/suggestion-chip.test.tsx src/components/ui/__tests__/form-provenance.test.tsx`
Expected: FAIL, because `SecondarySuggestionChip` is not exported and no secondary chip renders.

- [ ] **Step 3: Implement `suggestion-chip.tsx`**

Add `import { isSecondaryVisible } from "@/lib/prefill/secondary";`. Extract the chip `div` into `ChipView`, use it from `SuggestionChipBody`, and add the secondary chip:
```tsx
interface ChipViewProps {
  entry: ProvenanceEntry;
  fieldPath: string;
  readOnly: boolean;
  onAccept: () => void;
  onDismiss: () => void;
  /** data-slot of the chip container */
  slot?: string;
  dismissLabel?: string;
}

/** Presentational chip body shared by the records chip and the Workiz (secondary) chip */
export function ChipView({
  entry,
  fieldPath,
  readOnly,
  onAccept,
  onDismiss,
  slot = "suggestion-chip",
  dismissLabel = "Dismiss suggestion",
}: ChipViewProps) {
  const meta = SOURCE_META[entry.source];
  const isWarning = entry.kind === "warning";
  return (
    <div data-slot={slot} className={cn(CHIP_CLASS, isWarning ? WARNING_CLASS : meta.accentClass)}>
      {isWarning ? (
        <span className="min-w-0 whitespace-normal break-words" title={entry.explanation}>
          {entry.explanation}
        </span>
      ) : (
        <button
          type="button"
          disabled={readOnly}
          aria-label={`Accept suggestion from ${meta.label}: ${formatFieldValue(fieldPath, entry.value)}`}
          title={suggestionText(entry, fieldPath)}
          onClick={onAccept}
          className="min-w-0 whitespace-normal break-words text-left underline-offset-2 hover:underline disabled:no-underline"
        >
          {suggestionDisplayText(entry, fieldPath)}
        </button>
      )}
      {!readOnly && (
        <button
          type="button"
          aria-label={dismissLabel}
          onClick={onDismiss}
          className="ml-1 shrink-0 rounded-full p-0.5 hover:bg-black/5"
        >
          <X className="h-3 w-3" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
```
In `SuggestionChipBody`, replace the whole `{showChip && (<div data-slot="suggestion-chip" …>…</div>)}` block with:
```tsx
      {showChip && (
        <ChipView
          entry={entry}
          fieldPath={fieldPath}
          readOnly={readOnly}
          onAccept={() => acceptSuggestion(fieldPath)}
          onDismiss={() => dismissSuggestion(fieldPath)}
        />
      )}
```
Remove the now-unused `meta` local only if nothing else in the body uses it. Leave the warning-line markup unchanged. Then append:
```tsx
/**
 * Import from Workiz: the pink chip for a `secondary.<path>` entry (spec §6.4). Rendered by
 * FormItem / FormFieldGroup whenever a secondary exists, independently of the primary's state;
 * returns null while isSecondaryVisible says the chip has nothing new to offer.
 */
export function SecondarySuggestionChip({ fieldPath }: SuggestionChipProps) {
  const form = useFormContext();
  if (!form) return <SecondaryChipBody fieldPath={fieldPath} />;
  return <WatchedSecondaryChip fieldPath={fieldPath} />;
}

function WatchedSecondaryChip({ fieldPath }: SuggestionChipProps) {
  const currentValue = useWatch({ name: fieldPath });
  return <SecondaryChipBody fieldPath={fieldPath} currentValue={currentValue} />;
}

function SecondaryChipBody({
  fieldPath,
  currentValue,
}: SuggestionChipProps & { currentValue?: unknown }) {
  const { entry: primary, getSecondary, acceptSecondary, dismissSecondary, readOnly } = useProvenance(fieldPath);
  const secondary = getSecondary(fieldPath);
  if (!secondary || !isSecondaryVisible({ fieldPath, secondary, primary, currentValue })) return null;
  return (
    <ChipView
      entry={secondary}
      fieldPath={fieldPath}
      readOnly={readOnly}
      slot="secondary-suggestion-chip"
      dismissLabel="Dismiss Workiz suggestion"
      onAccept={() => acceptSecondary(fieldPath)}
      onDismiss={() => dismissSecondary(fieldPath)}
    />
  );
}
```

- [ ] **Step 4: Implement `form.tsx`**

Import: `import { SecondarySuggestionChip, SuggestionChip } from "@/components/prefill/suggestion-chip";`

`FormItem`: `const { entry, getSecondary } = useProvenance(fieldName);`. Add after the existing chip expression, inside the `div`:
```tsx
        {fieldName && !inGroup && getSecondary(fieldName) ? (
          <SecondarySuggestionChip fieldPath={fieldName} />
        ) : null}
```
`FormFieldGroup`: `const { entry, getSecondary } = useProvenance(name);`. Add after the existing chip expression:
```tsx
        {getSecondary(name) ? <SecondarySuggestionChip fieldPath={name} /> : null}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx vitest run src/components/prefill/__tests__/suggestion-chip.test.tsx src/components/ui/__tests__/form-provenance.test.tsx src/components/ui/__tests__/form-item.test.tsx src/components/inspection/__tests__/step-facility-info-provenance.test.tsx src/components/inspection/__tests__/step-general-treatment-provenance.test.tsx src/components/inspection/__tests__/step-read-only.test.tsx`
Expected: PASS. All existing chip tests are unchanged.

- [ ] **Step 6: Type check, lint, commit**

Run the TypeScript baseline filter command (expected: no output), then:
```bash
npx biome lint src/components/prefill/suggestion-chip.tsx src/components/ui/form.tsx
git add src/components/prefill/suggestion-chip.tsx src/components/ui/form.tsx src/components/prefill/__tests__/suggestion-chip.test.tsx src/components/ui/__tests__/form-provenance.test.tsx
git commit -F - <<'EOF'
feat(prefill): render Workiz secondary suggestion chips under form fields

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
```

---

### Task T18: `GET /api/workiz/jobs`

**Files:**
- Create: `src/app/api/workiz/jobs/route.ts`
- Test: `src/app/api/workiz/jobs/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `requireWorkizImporter` (T14), `listImportableAdeqJobs` (T13), `WorkizError` (T10), `findInspectionsByWorkizIds`, `loadProfileFullName`, `firstNameOf` (T14), `logDbError` (T5), `workizErrorResponse`, `internalErrorResponse` (T14).
- Produces: `GET` returning `WorkizJobsResponse` (T14 type), plus `export const maxDuration = 60`. The response never contains `uuid`.

- [ ] **Step 1: Write the failing test**

`src/app/api/workiz/jobs/__tests__/route.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetUser, mockGetUserRole, mockList, mockFind, mockLoadName } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockGetUserRole: vi.fn(),
  mockList: vi.fn(),
  mockFind: vi.fn(),
  mockLoadName: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({ auth: { getUser: mockGetUser } }),
}));
vi.mock("@/lib/supabase/auth-helpers", () => ({ getUserRole: mockGetUserRole }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/workiz/adeq-jobs", () => ({ listImportableAdeqJobs: mockList }));
vi.mock("@/lib/workiz/import-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workiz/import-store")>();
  return { ...actual, findInspectionsByWorkizIds: mockFind, loadProfileFullName: mockLoadName };
});

import { toJobSummary } from "@/lib/workiz/adeq";
import { WorkizError, type WorkizErrorCode } from "@/lib/workiz/client";
import { fixtures, job } from "@/lib/workiz/__tests__/fixtures/jobs";
import { workizJobSchema } from "@/lib/workiz/schema";
import { GET, maxDuration } from "../route";

const USER = { id: "user-1", email: "tech@example.com" };
const FETCHED_AT = Date.parse("2026-10-12T17:04:05.000Z");
const ROW_A = toJobSummary(job());
const ROW_B = toJobSummary(workizJobSchema.parse(fixtures.onlineBooking()));
const ROW_C = toJobSummary(workizJobSchema.parse(fixtures.unscheduled()));

const request = (query = "") => new Request(`http://localhost/api/workiz/jobs${query}`);

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: USER } });
  mockGetUserRole.mockResolvedValue("field_tech");
  mockList.mockResolvedValue({ rows: [ROW_A, ROW_B, ROW_C], fetchedAt: FETCHED_AT });
  mockFind.mockResolvedValue([]);
  mockLoadName.mockResolvedValue("Sam Sample");
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/workiz/jobs", () => {
  it("exports maxDuration 60", () => {
    expect(maxDuration).toBe(60);
  });

  it("401 when signed out", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await GET(request());
    expect(res.status).toBe(401);
    expect(mockList).not.toHaveBeenCalled();
  });

  it.each(["office_staff", null])("403 for role %s", async (role) => {
    mockGetUserRole.mockResolvedValue(role);
    expect((await GET(request())).status).toBe(403);
    expect(mockList).not.toHaveBeenCalled();
  });

  it("200 with summary rows, fetchedAt, role and currentUserFirstName — and no uuid", async () => {
    const res = await GET(request());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      jobs: [
        {
          id: "JOB-AbCdEfGhIjKlMnOp",
          serialId: 4696,
          street: "100 E Example Rd",
          city: "Cave Creek",
          scheduledDate: "2026-10-06",
          subStatus: "Job Complete - Reports Required",
          teamFirstNames: ["Alex", "Sam"],
          existing: null,
        },
        expect.objectContaining({ id: "JOB-OnlineBooking00001", existing: null }),
        expect.objectContaining({ id: "JOB-Unscheduled000001", scheduledDate: null }),
      ],
      fetchedAt: "2026-10-12T17:04:05.000Z",
      role: "field_tech",
      currentUserFirstName: "Sam",
    });
    expect(JSON.stringify(body)).not.toContain("AB12CD");
    expect(mockList).toHaveBeenCalledWith({ refresh: false });
  });

  it("looks existing inspections up by uuid ∪ JOB- id", async () => {
    await GET(request());
    const ids = mockFind.mock.calls[0][0] as string[];
    expect(ids).toEqual(expect.arrayContaining(["AB12CD", "JOB-AbCdEfGhIjKlMnOp", "OB12CD", "JOB-OnlineBooking00001"]));
  });

  it("existing: own → canOpen with id + status; another inspector's → exactly { canOpen: false }", async () => {
    mockFind.mockResolvedValue([
      { id: "insp-own", inspectorId: "user-1", status: "submitted", workizJobId: "AB12CD" },
      { id: "insp-other", inspectorId: "user-2", status: "draft", workizJobId: "JOB-OnlineBooking00001" },
    ]);
    const body = await (await GET(request())).json();
    expect(body.jobs[0].existing).toEqual({ canOpen: true, inspectionId: "insp-own", status: "submitted" });
    expect(body.jobs[1].existing).toEqual({ canOpen: false });
    expect(JSON.stringify(body)).not.toContain("insp-other");
  });

  it("admins can open anyone's import", async () => {
    mockGetUserRole.mockResolvedValue("admin");
    mockFind.mockResolvedValue([{ id: "insp-other", inspectorId: "user-2", status: "draft", workizJobId: "AB12CD" }]);
    const body = await (await GET(request())).json();
    expect(body.role).toBe("admin");
    expect(body.jobs[0].existing).toEqual({ canOpen: true, inspectionId: "insp-other", status: "draft" });
  });

  it("currentUserFirstName is null without a profile name", async () => {
    mockLoadName.mockResolvedValue(null);
    expect((await (await GET(request())).json()).currentUserFirstName).toBeNull();
  });

  it("refresh=1 asks for a refresh", async () => {
    await GET(request("?refresh=1"));
    expect(mockList).toHaveBeenCalledWith({ refresh: true });
  });

  it.each<[WorkizErrorCode, number, string]>([
    ["not_configured", 503, "workiz_not_configured"],
    ["auth_failed", 502, "workiz_auth_failed"],
    ["rate_limited", 503, "workiz_rate_limited"],
    ["unavailable", 502, "workiz_unavailable"],
    ["bad_response", 502, "workiz_bad_response"],
  ])("Workiz %s → %i %s", async (code, status, bodyCode) => {
    mockList.mockRejectedValue(new WorkizError(code));
    const res = await GET(request());
    expect(res.status).toBe(status);
    expect((await res.json()).code).toBe(bodyCode);
  });

  it("a DB error → 500 with a fixed message, logged through logDbError only", async () => {
    const err = Object.assign(new Error("Failed query: select … params: AB12CD"), { cause: { code: "08006" } });
    mockFind.mockRejectedValue(err);
    const res = await GET(request());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Something went wrong", code: "internal" });
    expect(errorSpy).toHaveBeenCalledWith(
      "[workiz-import] db error scope=jobs_existing_lookup job=- code=08006 constraint=-",
    );
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("Failed query");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/app/api/workiz/jobs/__tests__/route.test.ts`
Expected: FAIL, `Failed to resolve import "../route"`.

- [ ] **Step 3: Implement**

`src/app/api/workiz/jobs/route.ts`:
```ts
import { NextResponse } from "next/server";
import type { WorkizJobSummary } from "@/lib/workiz/adeq";
import { listImportableAdeqJobs } from "@/lib/workiz/adeq-jobs";
import { WorkizError } from "@/lib/workiz/client";
import {
  findInspectionsByWorkizIds,
  firstNameOf,
  type ImportedInspectionRow,
  loadProfileFullName,
} from "@/lib/workiz/import-store";
import { logDbError } from "@/lib/workiz/log-db-error";
import { requireWorkizImporter } from "@/lib/workiz/route-auth";
import { internalErrorResponse, workizErrorResponse } from "@/lib/workiz/route-errors";
import type {
  WorkizExisting,
  WorkizImporterRole,
  WorkizJobRow,
  WorkizJobsResponse,
} from "@/types/workiz-import";

// The listing has its own 25 s deadline; the DB lookup fits well inside the rest
export const maxDuration = 60;

function existingFor(
  row: WorkizJobSummary,
  matches: ImportedInspectionRow[],
  userId: string,
  role: WorkizImporterRole,
): WorkizExisting | null {
  const match = matches.find(
    (m) => (row.uuid !== "" && m.workizJobId === row.uuid) || m.workizJobId === row.id,
  );
  if (!match) return null;
  // Same rule as checkInspectionAccess, restricted to the roles these routes admit
  if (match.inspectorId === userId || role === "admin") {
    return { canOpen: true, inspectionId: match.id, status: match.status };
  }
  return { canOpen: false };
}

/**
 * GET /api/workiz/jobs[?refresh=1] — importable ADEQ jobs for the New Inspection picker
 * (spec §8.1). Summaries only (serial, street, city, date, sub-status, team first names);
 * `existing` is computed per request and never cached.
 */
export async function GET(request: Request) {
  const auth = await requireWorkizImporter();
  if (!auth.ok) return auth.response;
  const refresh = new URL(request.url).searchParams.get("refresh") === "1";

  let list: Awaited<ReturnType<typeof listImportableAdeqJobs>>;
  try {
    list = await listImportableAdeqJobs({ refresh });
  } catch (err) {
    if (err instanceof WorkizError) return workizErrorResponse(err, "list");
    console.error(`[workiz] job list failed: ${err instanceof Error ? err.name : "unknown"}`);
    return internalErrorResponse();
  }

  let matches: ImportedInspectionRow[];
  let fullName: string | null;
  try {
    [matches, fullName] = await Promise.all([
      findInspectionsByWorkizIds(list.rows.flatMap((row) => [row.uuid, row.id])),
      loadProfileFullName(auth.user.id),
    ]);
  } catch (err) {
    logDbError("jobs_existing_lookup", err);
    return internalErrorResponse();
  }

  const jobs: WorkizJobRow[] = list.rows.map((row) => ({
    id: row.id,
    serialId: row.serialId,
    street: row.street,
    city: row.city,
    scheduledDate: row.scheduledDate,
    subStatus: row.subStatus,
    teamFirstNames: row.teamFirstNames,
    existing: existingFor(row, matches, auth.user.id, auth.role),
  }));

  const body: WorkizJobsResponse = {
    jobs,
    fetchedAt: new Date(list.fetchedAt).toISOString(),
    role: auth.role,
    currentUserFirstName: firstNameOf(fullName),
  };
  return NextResponse.json(body);
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run src/app/api/workiz/jobs/__tests__/route.test.ts src/lib/workiz/__tests__/boundary.test.ts`
Expected: PASS.

- [ ] **Step 5: Type check, lint, commit**

Run the TypeScript baseline filter command (expected: no output), then:
```bash
npx biome lint src/app/api/workiz/jobs/route.ts src/app/api/workiz/jobs/__tests__/route.test.ts
git add src/app/api/workiz/jobs/route.ts src/app/api/workiz/jobs/__tests__/route.test.ts
git commit -F - <<'EOF'
feat(workiz-import): add GET /api/workiz/jobs for the New Inspection picker

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
```

---

### Task T19: `WorkizImportPicker` component

**Files:**
- Create: `src/components/inspection/workiz-import-picker.tsx`
- Test: `src/components/inspection/__tests__/workiz-import-picker.test.tsx`

**Interfaces:**
- Consumes: types from `@/types/workiz-import` (T14) only. **Never** `@/lib/workiz/*` (the boundary test enforces this). Also `Button`, `Badge`, `Card*`, `sonner`'s `toast` and `next/navigation`'s `useRouter`.
- Produces:
  ```tsx
  export function WorkizImportPicker(props: { disabled?: boolean; onBusyChange?: (busy: boolean) => void }): JSX.Element;
  export const PREFILL_SKIPPED_TOAST: string;   // spec §2.3, verbatim
  export const PREFILL_FAILED_TOAST: string;
  export const LIST_ERROR_COPY: Partial<Record<WorkizRouteErrorCode, string>>;
  export const DEFAULT_LIST_ERROR = "Couldn't reach Workiz — try again.";
  export function formatScheduledDate(date: string | null): string;          // "Oct 6, 2026" | "Unscheduled"
  export function inspectionHref(id: string, status: string, role: WorkizImporterRole): string;
  ```
  The root is `<div className="contents">`, so its button sits in the page's button row and its panel (`basis-full`) wraps onto its own line under both buttons.

- [ ] **Step 1: Write the failing test**

`src/components/inspection/__tests__/workiz-import-picker.test.tsx`:
```tsx
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkizJobRow, WorkizJobsResponse } from "@/types/workiz-import";

const { mockPush, mockToastError, mockToastWarning } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockToastError: vi.fn(),
  mockToastWarning: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));
vi.mock("sonner", () => ({ toast: { error: mockToastError, warning: mockToastWarning, success: vi.fn() } }));

import {
  formatScheduledDate,
  inspectionHref,
  PREFILL_FAILED_TOAST,
  PREFILL_SKIPPED_TOAST,
  WorkizImportPicker,
} from "@/components/inspection/workiz-import-picker";

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function row(over: Partial<WorkizJobRow> = {}): WorkizJobRow {
  return {
    id: "JOB-AbCdEfGhIjKlMnOp",
    serialId: 4696,
    street: "100 E Example Rd",
    city: "Cave Creek",
    scheduledDate: "2026-10-06",
    subStatus: "Job Complete - Reports Required",
    teamFirstNames: ["Alex", "Sam"],
    existing: null,
    ...over,
  };
}

function jobs(over: Partial<WorkizJobsResponse> = {}): WorkizJobsResponse {
  return {
    jobs: [row()],
    fetchedAt: "2026-10-12T17:04:05.000Z",
    role: "field_tech",
    currentUserFirstName: "Sam",
    ...over,
  };
}

async function openPanel(response = reply(200, jobs())) {
  const user = userEvent.setup();
  fetchMock.mockResolvedValueOnce(response);
  await user.click(screen.getByRole("button", { name: "Import from Workiz" }));
  return user;
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  fetchMock.mockReset();
});

describe("helpers", () => {
  it("formats the Workiz date without shifting it", () => {
    expect(formatScheduledDate("2026-10-06")).toBe("Oct 6, 2026");
    expect(formatScheduledDate(null)).toBe("Unscheduled");
  });

  it("routes like the dashboard's handleRowClick", () => {
    expect(inspectionHref("i1", "draft", "field_tech")).toBe("/inspections/i1/edit");
    expect(inspectionHref("i1", "submitted", "admin")).toBe("/review/i1");
    expect(inspectionHref("i1", "submitted", "field_tech")).toBe("/inspections/i1");
  });
});

describe("WorkizImportPicker", () => {
  it("does not call the API until opened, then shows a loading state", async () => {
    render(<WorkizImportPicker />);
    expect(fetchMock).not.toHaveBeenCalled();
    let resolve: (v: unknown) => void = () => {};
    fetchMock.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    await userEvent.setup().click(screen.getByRole("button", { name: "Import from Workiz" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/workiz/jobs");
    expect(screen.getByText("Loading Workiz jobs…")).toBeInTheDocument();
    resolve(reply(200, jobs()));
    expect(await screen.findByText("ADEQ jobs awaiting reports (1)")).toBeInTheDocument();
  });

  it("renders rows: serial, address, date, sub-status, team; Unscheduled when no date", async () => {
    render(<WorkizImportPicker />);
    await openPanel(
      reply(200, jobs({ jobs: [row(), row({ id: "JOB-Unscheduled000001", serialId: 4650, scheduledDate: null, subStatus: null, teamFirstNames: [] })] })),
    );
    const items = await screen.findAllByRole("listitem");
    expect(items).toHaveLength(2);
    const first = within(items[0]);
    expect(first.getByText("#4696")).toBeInTheDocument();
    expect(first.getByText("100 E Example Rd, Cave Creek")).toBeInTheDocument();
    expect(first.getByText("Oct 6, 2026")).toBeInTheDocument();
    expect(first.getByText("Job Complete - Reports Required")).toBeInTheDocument();
    expect(first.getByText("Team: Alex, Sam")).toBeInTheDocument();
    const second = within(items[1]);
    expect(second.getByText("Unscheduled")).toBeInTheDocument();
    expect(second.queryByText(/^Team:/)).toBeNull();
  });

  it("warns (case-insensitively) when the user is not on the Workiz team; omits it when the name is unknown", async () => {
    const { unmount } = render(<WorkizImportPicker />);
    await openPanel(reply(200, jobs({ currentUserFirstName: "pat" })));
    expect(await screen.findByText("You're not on this job's Workiz team")).toBeInTheDocument();
    unmount();

    const second = render(<WorkizImportPicker />);
    await openPanel(reply(200, jobs({ currentUserFirstName: "sam" })));
    await screen.findByText("#4696");
    expect(screen.queryByText("You're not on this job's Workiz team")).toBeNull();
    second.unmount();

    render(<WorkizImportPicker />);
    await openPanel(reply(200, jobs({ currentUserFirstName: null })));
    await screen.findByText("#4696");
    expect(screen.queryByText("You're not on this job's Workiz team")).toBeNull();
  });

  it("Open existing routes by status and role; a submitted one reads 'Report submitted'", async () => {
    render(<WorkizImportPicker />);
    const user = await openPanel(
      reply(
        200,
        jobs({
          role: "admin",
          jobs: [
            row({ existing: { canOpen: true, inspectionId: "insp-draft", status: "draft" } }),
            row({ id: "JOB-b000000000000001", serialId: 4667, existing: { canOpen: true, inspectionId: "insp-sub", status: "submitted" } }),
          ],
        }),
      ),
    );
    await user.click(await screen.findByRole("button", { name: "Open the inspection for Workiz job 4696" }));
    expect(mockPush).toHaveBeenCalledWith("/inspections/insp-draft/edit");
    const submitted = screen.getByRole("button", { name: "Open the inspection for Workiz job 4667" });
    expect(submitted).toHaveTextContent("Report submitted");
    await user.click(submitted);
    expect(mockPush).toHaveBeenCalledWith("/review/insp-sub");
  });

  it("a field tech's submitted inspection opens the read-only view", async () => {
    render(<WorkizImportPicker />);
    const user = await openPanel(
      reply(200, jobs({ jobs: [row({ existing: { canOpen: true, inspectionId: "insp-sub", status: "completed" } })] })),
    );
    await user.click(await screen.findByRole("button", { name: "Open the inspection for Workiz job 4696" }));
    expect(mockPush).toHaveBeenCalledWith("/inspections/insp-sub");
  });

  it("another inspector's import is a disabled button", async () => {
    render(<WorkizImportPicker />);
    await openPanel(reply(200, jobs({ jobs: [row({ existing: { canOpen: false } })] })));
    expect(await screen.findByRole("button", { name: "Imported by another inspector" })).toBeDisabled();
  });

  it("Import → POST {jobId} → router.push to the edit page; busy while importing", async () => {
    const onBusyChange = vi.fn();
    render(<WorkizImportPicker onBusyChange={onBusyChange} />);
    const user = await openPanel();
    let resolve: (v: unknown) => void = () => {};
    fetchMock.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const button = await screen.findByRole("button", { name: "Import Workiz job 4696, 100 E Example Rd" });
    await user.click(button);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/workiz/import", expect.objectContaining({ method: "POST", body: JSON.stringify({ jobId: "JOB-AbCdEfGhIjKlMnOp" }) }));
    expect(button).toHaveTextContent("Importing…");
    expect(button).toBeDisabled();
    expect(screen.getByRole("button", { name: "Import from Workiz" })).toBeDisabled();
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
    resolve(reply(201, { inspectionId: "insp-new", existing: false, prefill: { status: "started", runId: "run-1" } }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/inspections/insp-new/edit"));
    expect(mockToastWarning).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: "skipped", reason: "address_unparseable" }, PREFILL_SKIPPED_TOAST],
    [{ status: "failed" }, PREFILL_FAILED_TOAST],
  ])("toasts the prefill outcome %j before navigating", async (prefill, text) => {
    render(<WorkizImportPicker />);
    const user = await openPanel();
    fetchMock.mockResolvedValueOnce(reply(201, { inspectionId: "insp-new", existing: false, prefill }));
    await user.click(await screen.findByRole("button", { name: /Import Workiz job 4696/ }));
    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    expect(mockToastWarning).toHaveBeenCalledWith(text);
    expect(PREFILL_SKIPPED_TOAST).toBe(
      "Imported — the street address couldn't be read, so records lookup didn't start. Enter an APN on the next screen.",
    );
    expect(PREFILL_FAILED_TOAST).toBe("Imported — records lookup couldn't start; use Find records.");
  });

  it("200 existing routes like Open existing", async () => {
    render(<WorkizImportPicker />);
    const user = await openPanel();
    fetchMock.mockResolvedValueOnce(reply(200, { inspectionId: "insp-old", existing: true, status: "draft" }));
    await user.click(await screen.findByRole("button", { name: /Import Workiz job 4696/ }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/inspections/insp-old/edit"));
  });

  it("an import error renders inline (role=alert) and as a toast, and the Import button comes back", async () => {
    const onBusyChange = vi.fn();
    render(<WorkizImportPicker onBusyChange={onBusyChange} />);
    const user = await openPanel();
    fetchMock.mockResolvedValueOnce(reply(422, { error: "This Workiz job isn't ready to import", code: "not_importable" }));
    await user.click(await screen.findByRole("button", { name: /Import Workiz job 4696/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This Workiz job isn't ready to import");
    expect(mockToastError).toHaveBeenCalledWith("This Workiz job isn't ready to import");
    const button = screen.getByRole("button", { name: /Import Workiz job 4696/ });
    expect(button).toBeEnabled();
    expect(button).toHaveTextContent("Import");
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it("409 marks the row as imported by another inspector", async () => {
    render(<WorkizImportPicker />);
    const user = await openPanel();
    fetchMock.mockResolvedValueOnce(
      reply(409, { error: "This Workiz job was already imported by another inspector", code: "already_imported" }),
    );
    await user.click(await screen.findByRole("button", { name: /Import Workiz job 4696/ }));
    expect(await screen.findByRole("button", { name: "Imported by another inspector" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("already imported by another inspector");
  });

  it.each([
    ["workiz_not_configured", "Workiz import isn't set up on this server yet."],
    ["workiz_auth_failed", "Workiz rejected the app's credentials — ask an admin to check the Workiz API token."],
    ["workiz_rate_limited", "Workiz is busy — try again in a minute."],
    ["workiz_unavailable", "Couldn't reach Workiz — try again."],
    ["workiz_bad_response", "Couldn't reach Workiz — try again."],
  ])("list error %s → copy + Retry + manual hint", async (code, copy) => {
    render(<WorkizImportPicker />);
    const user = await openPanel(reply(502, { error: "x", code }));
    expect(await screen.findByText(copy)).toBeInTheDocument();
    expect(screen.getByText("You can still start a blank inspection with Create New Inspection.")).toBeInTheDocument();
    fetchMock.mockResolvedValueOnce(reply(200, jobs()));
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("#4696")).toBeInTheDocument();
  });

  it("empty state", async () => {
    render(<WorkizImportPicker />);
    await openPanel(reply(200, jobs({ jobs: [] })));
    expect(await screen.findByText("No ADEQ jobs are waiting for reports in Workiz.")).toBeInTheDocument();
    expect(screen.getByText("ADEQ jobs awaiting reports (0)")).toBeInTheDocument();
  });

  it("Refresh asks the server for a refresh", async () => {
    render(<WorkizImportPicker />);
    const user = await openPanel();
    await screen.findByText("#4696");
    fetchMock.mockResolvedValueOnce(reply(200, jobs()));
    await user.click(screen.getByRole("button", { name: "Refresh Workiz jobs" }));
    expect(fetchMock).toHaveBeenLastCalledWith("/api/workiz/jobs?refresh=1");
  });

  it("disabled (page is creating) disables the open button", () => {
    render(<WorkizImportPicker disabled />);
    expect(screen.getByRole("button", { name: "Import from Workiz" })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/components/inspection/__tests__/workiz-import-picker.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`src/components/inspection/workiz-import-picker.tsx`:
```tsx
"use client";

import { AlertTriangle, CloudDownload, Loader2, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  WorkizErrorBody,
  WorkizImporterRole,
  WorkizImportResponse,
  WorkizJobRow,
  WorkizJobsResponse,
  WorkizRouteErrorCode,
} from "@/types/workiz-import";

export const LIST_ERROR_COPY: Partial<Record<WorkizRouteErrorCode, string>> = {
  workiz_not_configured: "Workiz import isn't set up on this server yet.",
  workiz_auth_failed: "Workiz rejected the app's credentials — ask an admin to check the Workiz API token.",
  workiz_rate_limited: "Workiz is busy — try again in a minute.",
};
export const DEFAULT_LIST_ERROR = "Couldn't reach Workiz — try again.";
const DEFAULT_IMPORT_ERROR = "Couldn't import this job — try again.";
export const PREFILL_SKIPPED_TOAST =
  "Imported — the street address couldn't be read, so records lookup didn't start. Enter an APN on the next screen.";
export const PREFILL_FAILED_TOAST = "Imported — records lookup couldn't start; use Find records.";

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  year: "numeric",
});

/** "2026-10-06" → "Oct 6, 2026" — noon UTC formatted in UTC, so the day never shifts */
export function formatScheduledDate(date: string | null): string {
  return date ? DATE_FORMAT.format(new Date(`${date}T12:00:00Z`)) : "Unscheduled";
}

/** Same routing as handleRowClick in src/components/dashboard/inspections-table.tsx */
export function inspectionHref(id: string, status: string, role: WorkizImporterRole): string {
  if (status === "draft") return `/inspections/${id}/edit`;
  return role === "admin" ? `/review/${id}` : `/inspections/${id}`;
}

type Panel =
  | { kind: "closed" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: WorkizJobsResponse };

interface WorkizImportPickerProps {
  /** The page is creating a blank inspection */
  disabled?: boolean;
  /** true while an import is in flight (the page then disables Create New Inspection) */
  onBusyChange?: (busy: boolean) => void;
}

/**
 * "Import from Workiz" on /inspections/new (spec §2, §9). Fetches the job list only when opened,
 * so a slow or broken Workiz never delays the manual flow. All Workiz text renders as React text.
 */
export function WorkizImportPicker({ disabled = false, onBusyChange }: WorkizImportPickerProps) {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>({ kind: "closed" });
  const [importingId, setImportingId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const locked = disabled || importingId !== null;

  const setImporting = (jobId: string | null): void => {
    setImportingId(jobId);
    onBusyChange?.(jobId !== null);
  };

  async function load(refresh: boolean): Promise<void> {
    setPanel({ kind: "loading" });
    try {
      const res = await fetch(refresh ? "/api/workiz/jobs?refresh=1" : "/api/workiz/jobs");
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const code = (body as Partial<WorkizErrorBody> | null)?.code;
        setPanel({ kind: "error", message: (code && LIST_ERROR_COPY[code]) || DEFAULT_LIST_ERROR });
        return;
      }
      setPanel({ kind: "ready", data: body as WorkizJobsResponse });
    } catch {
      setPanel({ kind: "error", message: DEFAULT_LIST_ERROR });
    }
  }

  function markImportedByOther(jobId: string): void {
    setPanel((current) =>
      current.kind === "ready"
        ? {
            ...current,
            data: {
              ...current.data,
              jobs: current.data.jobs.map((j) => (j.id === jobId ? { ...j, existing: { canOpen: false } } : j)),
            },
          }
        : current,
    );
  }

  async function handleImport(job: WorkizJobRow, role: WorkizImporterRole): Promise<void> {
    setRowErrors(({ [job.id]: _cleared, ...rest }) => rest);
    setImporting(job.id);
    let navigating = false;
    try {
      const res = await fetch("/api/workiz/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id }),
      });
      const body: unknown = await res.json().catch(() => null);
      if (res.status === 200 || res.status === 201) {
        const result = body as WorkizImportResponse;
        if (result.existing) {
          navigating = true;
          router.push(inspectionHref(result.inspectionId, result.status, role));
          return;
        }
        // Fired just before router.push; the dashboard layout's <Toaster /> survives the navigation
        if (result.prefill.status === "skipped") toast.warning(PREFILL_SKIPPED_TOAST);
        if (result.prefill.status === "failed") toast.warning(PREFILL_FAILED_TOAST);
        navigating = true;
        router.push(`/inspections/${result.inspectionId}/edit`);
        return;
      }
      const message = (body as Partial<WorkizErrorBody> | null)?.error || DEFAULT_IMPORT_ERROR;
      if (res.status === 409) markImportedByOther(job.id);
      setRowErrors((prev) => ({ ...prev, [job.id]: message }));
      toast.error(message);
    } catch {
      setRowErrors((prev) => ({ ...prev, [job.id]: DEFAULT_IMPORT_ERROR }));
      toast.error(DEFAULT_IMPORT_ERROR);
    } finally {
      // Stay busy while navigating so nothing else can be created in the meantime
      if (!navigating) setImporting(null);
    }
  }

  function renderAction(job: WorkizJobRow, role: WorkizImporterRole) {
    const serial = job.serialId ?? "?";
    const existing = job.existing;
    if (existing === null) {
      return (
        <Button
          type="button"
          size="sm"
          disabled={locked}
          aria-label={`Import Workiz job ${serial}, ${job.street}`}
          onClick={() => void handleImport(job, role)}
        >
          {importingId === job.id ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Importing…
            </>
          ) : (
            "Import"
          )}
        </Button>
      );
    }
    if (existing.canOpen) {
      return (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={locked}
          aria-label={`Open the inspection for Workiz job ${serial}`}
          onClick={() => router.push(inspectionHref(existing.inspectionId, existing.status, role))}
        >
          {existing.status === "draft" ? "Open existing" : "Report submitted"}
        </Button>
      );
    }
    return (
      <Button type="button" size="sm" variant="outline" disabled>
        Imported by another inspector
      </Button>
    );
  }

  const listBusy = panel.kind === "loading";

  return (
    <div className="contents">
      <Button
        type="button"
        size="lg"
        variant="outline"
        disabled={locked || listBusy}
        aria-expanded={panel.kind !== "closed"}
        aria-controls="workiz-import-panel"
        onClick={() => {
          if (panel.kind === "closed") void load(false);
        }}
      >
        <CloudDownload className="size-5" aria-hidden="true" />
        Import from Workiz
      </Button>

      {panel.kind !== "closed" && (
        <div id="workiz-import-panel" className="flex w-full basis-full justify-center">
          <Card className="w-full max-w-xl">
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-base">
                ADEQ jobs awaiting reports{panel.kind === "ready" ? ` (${panel.data.jobs.length})` : ""}
              </CardTitle>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Refresh Workiz jobs"
                disabled={locked || listBusy}
                onClick={() => void load(true)}
              >
                <RefreshCw className="size-4" aria-hidden="true" />
              </Button>
            </CardHeader>
            <CardContent>
              {panel.kind === "loading" && (
                <p aria-live="polite" className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Loading Workiz jobs…
                </p>
              )}

              {panel.kind === "error" && (
                <div aria-live="polite" className="space-y-2 text-sm">
                  <p className="text-destructive">{panel.message}</p>
                  <Button type="button" size="sm" variant="outline" disabled={locked} onClick={() => void load(false)}>
                    Retry
                  </Button>
                  <p className="text-muted-foreground">
                    You can still start a blank inspection with Create New Inspection.
                  </p>
                </div>
              )}

              {panel.kind === "ready" && panel.data.jobs.length === 0 && (
                <p aria-live="polite" className="text-sm text-muted-foreground">
                  No ADEQ jobs are waiting for reports in Workiz.
                </p>
              )}

              {panel.kind === "ready" && panel.data.jobs.length > 0 && (
                // biome-ignore lint/a11y/noRedundantRoles: Safari drops list semantics under list-style:none
                // biome-ignore lint/a11y/useSemanticElements: same element; it already is a <ul>
                <ul role="list" className="max-h-[60vh] divide-y overflow-y-auto">
                  {panel.data.jobs.map((job) => {
                    const me = panel.data.currentUserFirstName?.toLowerCase();
                    const notOnTeam =
                      !!me && job.existing === null && !job.teamFirstNames.some((name) => name.toLowerCase() === me);
                    return (
                      <li key={job.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 space-y-1">
                          <p className="text-sm font-medium">
                            <span>#{job.serialId ?? "?"}</span> · <span>{[job.street, job.city].filter(Boolean).join(", ")}</span>
                          </p>
                          <p className="text-xs text-muted-foreground">{formatScheduledDate(job.scheduledDate)}</p>
                          {job.subStatus && <Badge variant="secondary">{job.subStatus}</Badge>}
                          {job.teamFirstNames.length > 0 && (
                            <p className="text-xs text-muted-foreground">Team: {job.teamFirstNames.join(", ")}</p>
                          )}
                          {rowErrors[job.id] && (
                            <p role="alert" className="text-sm text-destructive">
                              {rowErrors[job.id]}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
                          {renderAction(job, panel.data.role)}
                          {notOnTeam && (
                            <p className="flex items-center gap-1 text-xs text-muted-foreground">
                              <AlertTriangle className="size-3" aria-hidden="true" />
                              You're not on this job's Workiz team
                            </p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
```
Notes for the implementer:
- `#{job.serialId}` renders as two text nodes inside one `<span>`. If `getByText("#4696")` cannot find it, render it as a template string: ``<span>{`#${job.serialId ?? "?"}`}</span>``.
- Both `biome-ignore` lines are needed: with `role="list"` on a `<ul>`, Biome 2.4 raises `noRedundantRoles` and `useSemanticElements` (verified). Keep `role="list"`, which the spec requires.
- `lucide-react@0.575` exports `CloudDownload`. If it does not, use `Download`.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run src/components/inspection/__tests__/workiz-import-picker.test.tsx src/lib/workiz/__tests__/boundary.test.ts`
Expected: PASS. The boundary test stays green because the picker imports only `@/types/workiz-import`.

- [ ] **Step 5: Type check, lint, commit**

Run the TypeScript baseline filter command (expected: no output), then:
```bash
npx biome lint src/components/inspection/workiz-import-picker.tsx src/components/inspection/__tests__/workiz-import-picker.test.tsx
git add src/components/inspection/workiz-import-picker.tsx src/components/inspection/__tests__/workiz-import-picker.test.tsx
git commit -F - <<'EOF'
feat(workiz-import): add the Import from Workiz picker component

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
```

---

## Wave 5

### Task T20: `POST /api/workiz/import`

**Files:**
- Create: `src/app/api/workiz/import/route.ts`
- Test: `src/app/api/workiz/import/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `requireWorkizImporter`, `WorkizImporterAuth` (T14); `getJob`, `getCachedSummary` (T13); `isAdeqJob`, `canImportNow` (T11); `WorkizError` (T10); `findInspectionsByWorkizIds`, `insertImportedInspection`, `loadProfileFullName`, `ImportedInspectionRow` (T14); `mapJobToImportPlan`, `sanitizeProvenance` (T16); `logDbError` (T5); `errorResponse`, `internalErrorResponse`, `workizErrorResponse` (T14); `isUniqueViolation` (`@/lib/prefill/db-errors`); `createRun` (`@/lib/prefill/run-store`, trigger `"workiz_import"` from T2); `runPrefill`; `after` from `next/server`.
- Produces: `POST` (spec §8.2 responses table) and `export const maxDuration = 300`. A route file may only export Next route fields, so the body schema stays a **non-exported** module constant.

- [ ] **Step 1: Write the failing test**

`src/app/api/workiz/import/__tests__/route.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockGetUserRole: vi.fn(),
  mockFind: vi.fn(),
  mockInsert: vi.fn(),
  mockLoadName: vi.fn(),
  mockGetJob: vi.fn(),
  mockGetCached: vi.fn(),
  mockCreateRun: vi.fn(),
  mockRunPrefill: vi.fn(),
  mockAfter: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({ auth: { getUser: h.mockGetUser } }),
}));
vi.mock("@/lib/supabase/auth-helpers", () => ({ getUserRole: h.mockGetUserRole }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/workiz/import-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workiz/import-store")>()),
  findInspectionsByWorkizIds: h.mockFind,
  insertImportedInspection: h.mockInsert,
  loadProfileFullName: h.mockLoadName,
}));
vi.mock("@/lib/workiz/adeq-jobs", () => ({ getJob: h.mockGetJob, getCachedSummary: h.mockGetCached }));
vi.mock("@/lib/prefill/run-store", () => ({ createRun: h.mockCreateRun }));
vi.mock("@/lib/prefill/run-prefill", () => ({ runPrefill: h.mockRunPrefill }));
// after() throws outside a request scope — replace it, keep NextResponse
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: h.mockAfter,
}));

import { WORKIZ_CF } from "@/lib/workiz/adeq";
import { WorkizError } from "@/lib/workiz/client";
import { cf, fixtures, job, withAddress } from "@/lib/workiz/__tests__/fixtures/jobs";
import { workizJobSchema } from "@/lib/workiz/schema";
import { maxDuration, POST } from "../route";

const USER = { id: "user-1", email: "tech@example.com", user_metadata: { full_name: "Meta Name" } };
const JOB_ID = "JOB-AbCdEfGhIjKlMnOp";
const PII = ["Test Client", "test.client@example.com", "100 E Example Rd"];
const OWN = { id: "insp-own", inspectorId: "user-1", status: "draft", workizJobId: "AB12CD" };
const OTHER = { id: "insp-other", inspectorId: "user-2", status: "draft", workizJobId: "AB12CD" };

const post = (body: unknown) =>
  new Request("http://localhost/api/workiz/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

/** Drizzle 0.45 DrizzleQueryError shape: PII in message + params, SQLSTATE on cause */
function drizzleError(cause: Record<string, unknown>) {
  return Object.assign(new Error(`Failed query: insert into "inspections" …\nparams: ${PII.join(",")}`), {
    query: 'insert into "inspections" …',
    params: [...PII],
    cause,
  });
}

let spies: Array<ReturnType<typeof vi.spyOn>> = [];
const consoleText = () => JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
const expectNoPiiLogged = () => {
  for (const value of PII) expect(consoleText()).not.toContain(value);
};

beforeEach(() => {
  vi.clearAllMocks();
  h.mockGetUser.mockResolvedValue({ data: { user: USER } });
  h.mockGetUserRole.mockResolvedValue("field_tech");
  h.mockFind.mockResolvedValue([]);
  h.mockGetCached.mockReturnValue(undefined);
  h.mockGetJob.mockResolvedValue(job());
  h.mockLoadName.mockResolvedValue("Sam Sample");
  h.mockInsert.mockResolvedValue("insp-new");
  h.mockCreateRun.mockResolvedValue("run-1");
  spies = (["error", "warn", "info", "log"] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => {}),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

it("exports maxDuration 300 (the run continues in after())", () => {
  expect(maxDuration).toBe(300);
});

describe("validation and auth", () => {
  it.each([["not json"], [{}], [{ jobId: "JOB-1" }], [{ jobId: "job-AbCdEfGh" }], [{ jobId: JOB_ID, extra: 1 }]])(
    "400 invalid_request for %j",
    async (body) => {
      const res = await POST(post(body));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "Invalid request", code: "invalid_request" });
      expect(h.mockGetJob).not.toHaveBeenCalled();
    },
  );

  it("401 when signed out", async () => {
    h.mockGetUser.mockResolvedValue({ data: { user: null } });
    expect((await POST(post({ jobId: JOB_ID }))).status).toBe(401);
  });

  it.each(["office_staff", null])("403 for role %s", async (role) => {
    h.mockGetUserRole.mockResolvedValue(role);
    expect((await POST(post({ jobId: JOB_ID }))).status).toBe(403);
    expect(h.mockGetJob).not.toHaveBeenCalled();
  });
});

describe("existing-job checks (spec §8.2)", () => {
  it("pre-check by the JOB- id → 200 without calling Workiz", async () => {
    h.mockFind.mockResolvedValueOnce([{ ...OWN, workizJobId: JOB_ID }]);
    const res = await POST(post({ jobId: JOB_ID }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ inspectionId: "insp-own", existing: true, status: "draft" });
    expect(h.mockFind.mock.calls[0][0]).toEqual([JOB_ID, undefined]);
    expect(h.mockGetJob).not.toHaveBeenCalled();
  });

  it("pre-check also matches the cached uuid", async () => {
    h.mockGetCached.mockReturnValue({ uuid: "AB12CD" });
    h.mockFind.mockResolvedValueOnce([OWN]);
    expect((await POST(post({ jobId: JOB_ID }))).status).toBe(200);
    expect(h.mockFind.mock.calls[0][0]).toEqual([JOB_ID, "AB12CD"]);
    expect(h.mockGetJob).not.toHaveBeenCalled();
  });

  it("409 for another inspector's import — and no inspection id in the body", async () => {
    h.mockFind.mockResolvedValueOnce([OTHER]);
    const res = await POST(post({ jobId: JOB_ID }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toEqual({ error: "This Workiz job was already imported by another inspector", code: "already_imported" });
    expect(JSON.stringify(body)).not.toContain("insp-other");
  });

  it("admins may open another inspector's import", async () => {
    h.mockGetUserRole.mockResolvedValue("admin");
    h.mockFind.mockResolvedValueOnce([OTHER]);
    expect(await (await POST(post({ jobId: JOB_ID }))).json()).toEqual({
      inspectionId: "insp-other",
      existing: true,
      status: "draft",
    });
  });

  it("post-fetch check by job.uuid ∪ job.id", async () => {
    h.mockFind.mockResolvedValueOnce([]).mockResolvedValueOnce([OWN]);
    expect((await POST(post({ jobId: JOB_ID }))).status).toBe(200);
    expect(h.mockFind.mock.calls[1][0]).toEqual(["AB12CD", JOB_ID]);
    expect(h.mockInsert).not.toHaveBeenCalled();
  });
});

describe("Workiz-side checks", () => {
  it("404 workiz_job_not_found", async () => {
    h.mockGetJob.mockRejectedValue(new WorkizError("not_found", 404));
    const res = await POST(post({ jobId: JOB_ID }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Workiz job not found", code: "workiz_job_not_found" });
  });

  it("Workiz rate limit → 503 workiz_rate_limited", async () => {
    h.mockGetJob.mockRejectedValue(new WorkizError("rate_limited", 429));
    const res = await POST(post({ jobId: JOB_ID }));
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("workiz_rate_limited");
  });

  it("422 not_adeq_job", async () => {
    h.mockGetJob.mockResolvedValue(workizJobSchema.parse(fixtures.nonAdeq()));
    const res = await POST(post({ jobId: JOB_ID }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "Only ADEQ inspection jobs can be imported", code: "not_adeq_job" });
  });

  it.each(["Canceled", "Submitted"])("422 not_importable for %s", async (status) => {
    h.mockGetJob.mockResolvedValue(job({ status }));
    const res = await POST(post({ jobId: JOB_ID }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "This Workiz job isn't ready to import", code: "not_importable" });
    expect(h.mockInsert).not.toHaveBeenCalled();
  });

  it("'Done' is accepted", async () => {
    h.mockGetJob.mockResolvedValue(workizJobSchema.parse(fixtures.done()));
    expect((await POST(post({ jobId: JOB_ID }))).status).toBe(201);
  });

  it("a job without a uuid → 502 workiz_bad_response, nothing inserted", async () => {
    h.mockGetJob.mockResolvedValue(workizJobSchema.parse(fixtures.emptyUuid()));
    const res = await POST(post({ jobId: JOB_ID }));
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("workiz_bad_response");
    expect(h.mockInsert).not.toHaveBeenCalled();
  });
});

describe("happy path", () => {
  it("inserts the draft (workiz_job_id = uuid, customer_name null) and starts the run in after()", async () => {
    const res = await POST(post({ jobId: JOB_ID }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      inspectionId: "insp-new",
      existing: false,
      prefill: { status: "started", runId: "run-1" },
    });
    const values = h.mockInsert.mock.calls[0][0];
    expect(values).toMatchObject({
      inspectorId: "user-1",
      status: "draft",
      workizJobId: "AB12CD",
      customerName: null,
      customerEmail: "test.client@example.com",
      facilityAddress: "100 E Example Rd",
      facilityCity: "Cave Creek",
      facilityZip: "85331",
      facilityCounty: null,
      facilityName: null,
      apn: null,
    });
    expect(values.formData.facilityInfo).toMatchObject({
      facilityAddress: "100 E Example Rd",
      inspectorName: "Sam Sample",
      sellerName: "",
    });
    expect(values.fieldProvenance["secondary.facilityInfo.sellerName"]).toMatchObject({ value: "Test Client" });
    expect(h.mockCreateRun).toHaveBeenCalledWith({
      inspectionId: "insp-new",
      trigger: "workiz_import",
      input: {
        address: expect.objectContaining({ streetNumber: "100", streetDir: "E", streetName: "Example Rd", zip: "85331" }),
        zipMustMatch: true,
      },
      createdBy: "user-1",
    });
    expect(h.mockAfter).toHaveBeenCalledTimes(1);
    await h.mockAfter.mock.calls[0][0]();
    expect(h.mockRunPrefill).toHaveBeenCalledWith("run-1");
    expectNoPiiLogged();
  });

  it("falls back to user_metadata.full_name for the inspector name", async () => {
    h.mockLoadName.mockResolvedValue(null);
    await POST(post({ jobId: JOB_ID }));
    expect(h.mockInsert.mock.calls[0][0].formData.facilityInfo.inspectorName).toBe("Meta Name");
  });

  it("logs a skipped custom field by id and reason only", async () => {
    h.mockGetJob.mockResolvedValue(job({ customFields: [cf(WORKIZ_CF.waterSource, "Municipal / Private Water Supply")] }));
    await POST(post({ jobId: JOB_ID }));
    expect(consoleText()).toContain(`[workiz-import] skip job=4696 field=${WORKIZ_CF.waterSource} reason=ambiguous`);
    expect(consoleText()).not.toContain("Municipal");
  });

  it("an unparseable address → 201 skipped, no run", async () => {
    h.mockGetJob.mockResolvedValue(workizJobSchema.parse(withAddress({ address: "Rural Route Box" })));
    const res = await POST(post({ jobId: JOB_ID }));
    expect(res.status).toBe(201);
    expect((await res.json()).prefill).toEqual({ status: "skipped", reason: "address_unparseable" });
    expect(h.mockCreateRun).not.toHaveBeenCalled();
    expect(h.mockAfter).not.toHaveBeenCalled();
  });
});

describe("DB failures stay PII-safe (spec §12)", () => {
  it("createRun throws → 201 failed, the inspection is kept, only the SQLSTATE is logged", async () => {
    h.mockCreateRun.mockRejectedValue(drizzleError({ code: "57014" }));
    const res = await POST(post({ jobId: JOB_ID }));
    expect(res.status).toBe(201);
    expect((await res.json()).prefill).toEqual({ status: "failed" });
    expect(h.mockInsert).toHaveBeenCalledTimes(1);
    expect(h.mockAfter).not.toHaveBeenCalled();
    expect(consoleText()).toContain("[workiz-import] db error scope=create_run job=4696 code=57014 constraint=-");
    expectNoPiiLogged();
  });

  it("INSERT throws (not unique) → 500 with a fixed message", async () => {
    h.mockInsert.mockRejectedValue(drizzleError({ code: "23502", constraint_name: "inspections_inspector_id_not_null" }));
    const res = await POST(post({ jobId: JOB_ID }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "Something went wrong", code: "internal" });
    expectNoPiiLogged();
  });

  it("unique violation → re-select by uuid → 200 for the user's own import", async () => {
    h.mockInsert.mockRejectedValue(drizzleError({ code: "23505", constraint_name: "inspections_workiz_job_id_unique" }));
    h.mockFind.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([OWN]);
    const res = await POST(post({ jobId: JOB_ID }));
    expect(res.status).toBe(200);
    expect(h.mockFind.mock.calls[2][0]).toEqual(["AB12CD"]);
    expectNoPiiLogged();
  });

  it("unique violation for someone else's import → 409", async () => {
    h.mockInsert.mockRejectedValue(drizzleError({ code: "23505" }));
    h.mockFind.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([OTHER]);
    expect((await POST(post({ jobId: JOB_ID }))).status).toBe(409);
  });

  it("a DB error in the pre-check → 500, logged through logDbError", async () => {
    h.mockFind.mockRejectedValueOnce(drizzleError({ code: "08006" }));
    const res = await POST(post({ jobId: JOB_ID }));
    expect(res.status).toBe(500);
    expect(consoleText()).toContain("[workiz-import] db error scope=import job=- code=08006 constraint=-");
    expectNoPiiLogged();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/app/api/workiz/import/__tests__/route.test.ts`
Expected: FAIL, `Failed to resolve import "../route"`.

- [ ] **Step 3: Implement**

`src/app/api/workiz/import/route.ts`:
```ts
import { after, NextResponse } from "next/server";
import { z } from "zod";
import { isUniqueViolation } from "@/lib/prefill/db-errors";
import { runPrefill } from "@/lib/prefill/run-prefill";
import { createRun } from "@/lib/prefill/run-store";
import { canImportNow, isAdeqJob } from "@/lib/workiz/adeq";
import { getCachedSummary, getJob } from "@/lib/workiz/adeq-jobs";
import { WorkizError } from "@/lib/workiz/client";
import {
  findInspectionsByWorkizIds,
  type ImportedInspectionRow,
  insertImportedInspection,
  loadProfileFullName,
} from "@/lib/workiz/import-store";
import { logDbError } from "@/lib/workiz/log-db-error";
import { mapJobToImportPlan, sanitizeProvenance } from "@/lib/workiz/map-job";
import type { WorkizJob } from "@/lib/workiz/schema";
import { requireWorkizImporter, type WorkizImporterAuth } from "@/lib/workiz/route-auth";
import { errorResponse, internalErrorResponse, workizErrorResponse } from "@/lib/workiz/route-errors";
import type { WorkizImportCreated, WorkizImportExisting, WorkizImportPrefill } from "@/types/workiz-import";

// The run continues in after() once the 201 is sent — needs Fluid Compute's longer budget
export const maxDuration = 300;

// Not exported: a route module may only export Next.js route fields
const workizImportBodySchema = z.strictObject({
  jobId: z.string().regex(/^JOB-[A-Za-z0-9]{6,40}$/),
});

type Importer = Extract<WorkizImporterAuth, { ok: true }>;

/** 200 when the user can open the match (checkInspectionAccess rule), else 409 with no id */
function existingResponse(match: ImportedInspectionRow, auth: Importer) {
  if (match.inspectorId === auth.user.id || auth.role === "admin") {
    return NextResponse.json<WorkizImportExisting>(
      { inspectionId: match.id, existing: true, status: match.status },
      { status: 200 },
    );
  }
  return errorResponse(409, "already_imported", "This Workiz job was already imported by another inspector");
}

/**
 * POST /api/workiz/import  { jobId: "JOB-…" }
 * Creates a draft from a finished Workiz ADEQ job and starts the address-driven prefill run
 * (spec §4, §8.2). One inspection per job: three existing-job checks plus the unique
 * workiz_job_id index. DB errors are logged with logDbError only — never err/message/params.
 */
export async function POST(request: Request) {
  const auth = await requireWorkizImporter();
  if (!auth.ok) return auth.response;

  const raw: unknown = await request.json().catch(() => null);
  const parsed = workizImportBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", code: "invalid_request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { jobId } = parsed.data;
  let serialId: number | null = null;

  try {
    // 1. Before calling Workiz: the JOB- id and, when the list cached it, the uuid
    const before = await findInspectionsByWorkizIds([jobId, getCachedSummary(jobId)?.uuid]);
    if (before[0]) return existingResponse(before[0], auth);

    // 2. Fresh, authoritative job
    let job: WorkizJob;
    try {
      job = await getJob(jobId);
    } catch (err) {
      if (err instanceof WorkizError) return workizErrorResponse(err, "import");
      throw err;
    }
    serialId = job.serialId;

    // The server re-checks type AND status: a hand-crafted jobId cannot pull a pumping job or a
    // canceled job's client data
    if (!isAdeqJob(job)) return errorResponse(422, "not_adeq_job", "Only ADEQ inspection jobs can be imported");
    if (!canImportNow(job)) return errorResponse(422, "not_importable", "This Workiz job isn't ready to import");
    if (!job.uuid) {
      return errorResponse(502, "workiz_bad_response", "Workiz sent a response the app couldn't read");
    }

    // 3. After the fetch: the uuid (what this route and the webhook store) ∪ the JOB- id
    const after_ = await findInspectionsByWorkizIds([job.uuid, job.id]);
    if (after_[0]) return existingResponse(after_[0], auth);

    const inspectorName = (await loadProfileFullName(auth.user.id)) ?? auth.user.user_metadata?.full_name ?? "";
    const plan = mapJobToImportPlan(job, { inspectorName });
    for (const skip of plan.skips) {
      console.info(`[workiz-import] skip job=${serialId ?? "?"} field=${skip.field} reason=${skip.reason}`);
    }
    const { map: fieldProvenance, dropped } = sanitizeProvenance(plan.fieldProvenance);
    for (const path of dropped) {
      console.warn(`[workiz-import] dropped provenance entry job=${serialId ?? "?"} path=${path}`);
    }

    let inspectionId: string;
    try {
      inspectionId = await insertImportedInspection({
        inspectorId: auth.user.id,
        status: "draft",
        formData: plan.formData,
        fieldProvenance,
        facilityAddress: plan.columns.facilityAddress,
        facilityCity: plan.columns.facilityCity,
        facilityZip: plan.columns.facilityZip,
        facilityCounty: null,
        facilityName: null,
        customerEmail: plan.columns.customerEmail,
        // Left null: the wizard's first autosave writes sellerName ?? null anyway (spec §5.1)
        customerName: null,
        workizJobId: plan.columns.workizJobId,
        // The run sets it via setInspectionApnIfNull; the unverified hint is never written here
        apn: null,
      });
    } catch (err) {
      // A concurrent import of the same job won the unique index: return what it created
      if (isUniqueViolation(err)) {
        const winner = await findInspectionsByWorkizIds([job.uuid]);
        if (winner[0]) return existingResponse(winner[0], auth);
      }
      logDbError("insert", err, { serialId });
      return internalErrorResponse();
    }

    let prefill: WorkizImportPrefill;
    if (!plan.prefillInput) {
      prefill = { status: "skipped", reason: "address_unparseable" };
    } else {
      try {
        // A brand-new inspection cannot trip countRunsInLastHour or findActiveRun — no checks needed
        const runId = await createRun({
          inspectionId,
          trigger: "workiz_import",
          input: plan.prefillInput,
          createdBy: auth.user.id,
        });
        after(() => runPrefill(runId));
        prefill = { status: "started", runId };
      } catch (err) {
        logDbError("create_run", err, { serialId });
        prefill = { status: "failed" };
      }
    }

    return NextResponse.json<WorkizImportCreated>(
      { inspectionId, existing: false, prefill },
      { status: 201 },
    );
  } catch (err) {
    logDbError("import", err, { serialId });
    return internalErrorResponse();
  }
}
```
(`after_` avoids shadowing the imported `after`. Rename it to `afterFetch` if you prefer.)

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run src/app/api/workiz/import/__tests__/route.test.ts src/lib/workiz/__tests__/boundary.test.ts`
Expected: PASS.

- [ ] **Step 5: Type check, lint, commit**

Run the TypeScript baseline filter command (expected: no output), then:
```bash
npx biome lint src/app/api/workiz/import/route.ts src/app/api/workiz/import/__tests__/route.test.ts
git add src/app/api/workiz/import/route.ts src/app/api/workiz/import/__tests__/route.test.ts
git commit -F - <<'EOF'
feat(workiz-import): add POST /api/workiz/import to create a draft and start the prefill run

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
```

---

### Task T21: New Inspection page integration

**Files:**
- Modify: `src/app/(dashboard)/inspections/new/page.tsx`
- Create: `src/app/(dashboard)/inspections/new/__tests__/page.test.tsx`

**Interfaces:**
- Consumes: `WorkizImportPicker` (T19), `Toaster` (`@/components/ui/sonner`, used by the test harness only).
- Produces: the page renders **Create New Inspection** and **Import from Workiz** side by side (stacked below `sm`). Each disables the other while busy. `handleCreate` is unchanged.

- [ ] **Step 1: Write the failing test**

`src/app/(dashboard)/inspections/new/__tests__/page.test.tsx`:
```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));

import { Toaster } from "@/components/ui/sonner";
import NewInspectionPage from "../page";

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const JOBS = {
  jobs: [
    {
      id: "JOB-AbCdEfGhIjKlMnOp",
      serialId: 4696,
      street: "100 E Example Rd",
      city: "Cave Creek",
      scheduledDate: "2026-10-06",
      subStatus: null,
      teamFirstNames: ["Sam"],
      existing: null,
    },
  ],
  fetchedAt: "2026-10-12T17:04:05.000Z",
  role: "field_tech",
  currentUserFirstName: "Sam",
};

beforeAll(() => {
  // sonner reads prefers-color-scheme; jsdom has no matchMedia
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  fetchMock.mockReset();
});

const renderPage = () =>
  render(
    <>
      <NewInspectionPage />
      <Toaster />
    </>,
  );

describe("NewInspectionPage", () => {
  it("shows both buttons and does not call Workiz on load", () => {
    renderPage();
    expect(screen.getByRole("button", { name: "Create New Inspection" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Import from Workiz" })).toBeEnabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Create New Inspection still POSTs /api/inspections and routes to the edit page", async () => {
    fetchMock.mockResolvedValueOnce(reply(201, { id: "insp-1" }));
    renderPage();
    await userEvent.setup().click(screen.getByRole("button", { name: "Create New Inspection" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/inspections", { method: "POST" });
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/inspections/insp-1/edit"));
  });

  it("while creating, Import from Workiz is disabled", async () => {
    fetchMock.mockReturnValueOnce(new Promise(() => {}));
    renderPage();
    await userEvent.setup().click(screen.getByRole("button", { name: "Create New Inspection" }));
    expect(screen.getByRole("button", { name: /Creating/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Import from Workiz" })).toBeDisabled();
  });

  it("while importing, Create New Inspection is disabled", async () => {
    const user = userEvent.setup();
    renderPage();
    fetchMock.mockResolvedValueOnce(reply(200, JOBS));
    await user.click(screen.getByRole("button", { name: "Import from Workiz" }));
    fetchMock.mockReturnValueOnce(new Promise(() => {}));
    await user.click(await screen.findByRole("button", { name: /Import Workiz job 4696/ }));
    expect(screen.getByRole("button", { name: "Create New Inspection" })).toBeDisabled();
  });

  it("a failed create renders the toast text (the Toaster is mounted)", async () => {
    fetchMock.mockResolvedValueOnce(reply(500, { error: "Failed to create inspection" }));
    renderPage();
    await userEvent.setup().click(screen.getByRole("button", { name: "Create New Inspection" }));
    expect(await screen.findByText("Failed to create inspection")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create New Inspection" })).toBeEnabled();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run "src/app/(dashboard)/inspections/new/__tests__/page.test.tsx"`
Expected: FAIL. There is no "Import from Workiz" button, so the first, third and fourth tests fail. The create and toast tests may already pass.

- [ ] **Step 3: Implement**

`src/app/(dashboard)/inspections/new/page.tsx`: add `import { WorkizImportPicker } from "@/components/inspection/workiz-import-picker";`, add `const [isImporting, setIsImporting] = useState(false);` under `isCreating`, and replace the `<Button size="lg" …>…</Button>` block with:
```tsx
      <div className="flex w-full flex-col items-center gap-3 sm:flex-row sm:flex-wrap sm:justify-center">
        <Button size="lg" onClick={handleCreate} disabled={isCreating || isImporting}>
          {isCreating ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <FilePlus className="size-5" />
          )}
          {isCreating ? "Creating..." : "Create New Inspection"}
        </Button>
        {/* Its panel wraps onto its own row under both buttons (basis-full inside this flex row) */}
        <WorkizImportPicker disabled={isCreating} onBusyChange={setIsImporting} />
      </div>
```
Leave `handleCreate`, the title and the copy unchanged.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run "src/app/(dashboard)/inspections/new/__tests__/page.test.tsx" src/components/inspection/__tests__/workiz-import-picker.test.tsx src/lib/workiz/__tests__/boundary.test.ts`
Expected: PASS. If sonner needs another browser API that jsdom lacks (for example `ResizeObserver`), stub it in `beforeAll` the same way as `matchMedia`.

- [ ] **Step 5: Type check, lint, commit**

Run the TypeScript baseline filter command (expected: no output), then:
```bash
npx biome lint "src/app/(dashboard)/inspections/new/page.tsx" "src/app/(dashboard)/inspections/new/__tests__/page.test.tsx"
git add "src/app/(dashboard)/inspections/new/page.tsx" "src/app/(dashboard)/inspections/new/__tests__/page.test.tsx"
git commit -F - <<'EOF'
feat(workiz-import): offer Import from Workiz beside Create New Inspection

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
```

---

### Task T22: Live read-only smoke script

**Files:**
- Create: `scripts/workiz-adeq-smoke.mts`
- Modify: `package.json` (add the script after `smoke:permits`)

**Interfaces:**
- Consumes: `getWorkizConfig` (T10), `fetchOpenJobs`, `getJob` (T13), `isAdeqJob`, `isImportable`, `scheduledDateOf` (T11), `mapJobToImportPlan` (T16), `isSecondaryKey` (T9).
- Produces: `npm run smoke:workiz`. It is **read-only**: about 2 list pages plus one `GET /jobs/{id}`. It prints counts and, per importable job, only the serial, job-type id, sub-status, scheduled date, prefill mode, secondary paths and skip codes. It never prints names, addresses, emails, phones, notes or custom-field values.

- [ ] **Step 1: Add the npm script**

In `package.json` `scripts`, after `"smoke:permits": …,`:
```json
    "smoke:workiz": "NODE_OPTIONS=--conditions=react-server tsx --env-file=.env.local scripts/workiz-adeq-smoke.mts"
```
(`--conditions=react-server` makes `import "server-only"` resolve to the package's empty export.)

- [ ] **Step 2: Write the script**

`scripts/workiz-adeq-smoke.mts`:
```ts
// scripts/workiz-adeq-smoke.mts
/**
 * Live, READ-ONLY smoke test for Import from Workiz (spec §13). Pages every open Workiz job
 * (GET /jobs) and fetches the first importable one (GET /jobs/{id}). Never writes anything,
 * anywhere.
 *
 * Prints counts and, per importable job, ONLY: serial, job-type id, sub-status, scheduled date,
 * prefill mode, the secondary provenance paths the import would produce, and skip reason codes.
 * It never prints names, addresses, emails, phones, notes or custom-field values.
 *
 * Usage: npm run smoke:workiz   (needs WORKIZ_API_V2_TOKEN in .env.local)
 * Expected (2026-10-12): 5 importable jobs, all JT-a5DbVzyREDgGvdWK.
 */

import { isSecondaryKey } from "../src/lib/prefill/secondary";
import { isAdeqJob, isImportable, scheduledDateOf } from "../src/lib/workiz/adeq";
import { fetchOpenJobs, getJob } from "../src/lib/workiz/adeq-jobs";
import { getWorkizConfig } from "../src/lib/workiz/client";
import { mapJobToImportPlan } from "../src/lib/workiz/map-job";

async function main(): Promise<void> {
  if (!getWorkizConfig()) {
    console.error("WORKIZ_API_V2_TOKEN is missing (or WORKIZ_API_V2_BASE is not https) — set it in .env.local");
    process.exit(1);
  }

  const started = Date.now();
  const { jobs, pages, dropped } = await fetchOpenJobs();
  const ms = Date.now() - started;
  const adeq = jobs.filter(isAdeqJob);
  const importable = jobs.filter(isImportable);
  console.log(`open jobs: ${jobs.length} (pages ${pages}, ${ms} ms, dropped by schema ${dropped})`);
  console.log(`ADEQ: ${adeq.length} · importable (done pending approval): ${importable.length}`);

  for (const job of importable) {
    const plan = mapJobToImportPlan(job, { inspectorName: "Smoke Test" });
    const secondaries = Object.keys(plan.fieldProvenance).filter(isSecondaryKey).sort();
    const prefill = plan.prefillInput ? (plan.prefillInput.zipMustMatch ? "address+zip" : "address") : "skipped";
    console.log(
      `#${job.serialId ?? "?"} type=${job.jobType?.id ?? "-"} sub=${JSON.stringify(job.subStatus?.name ?? null)} date=${scheduledDateOf(job) ?? "unscheduled"} prefill=${prefill} uuid=${job.uuid ? "yes" : "MISSING"}`,
    );
    console.log(`   secondary: ${secondaries.join(", ") || "(none)"}`);
    console.log(`   skips: ${plan.skips.map((s) => `${s.field}:${s.reason}`).join(", ") || "(none)"}`);
  }

  const first = importable[0];
  if (first) {
    const t0 = Date.now();
    const single = await getJob(first.id);
    console.log(
      `getJob #${single.serialId ?? "?"}: ${Date.now() - t0} ms, same serial: ${single.serialId === first.serialId}, uuid: ${single.uuid ? "yes" : "MISSING"}`,
    );
  }
}

main().catch((err: unknown) => {
  const code = err && typeof err === "object" && "code" in err ? ` code=${String((err as { code: unknown }).code)}` : "";
  console.error(`smoke failed: ${err instanceof Error ? err.name : "unknown"}${code}`);
  process.exit(1);
});
```

- [ ] **Step 3: Run it (live, read-only)**

Run: `npm run smoke:workiz`
Expected: lines like `open jobs: 3xx (pages 2, ~5000 ms, dropped by schema 0)` and `ADEQ: … · importable (done pending approval): N`, then one `#NNNN type=JT-… …` block per importable job and a final `getJob #NNNN: … same serial: true, uuid: yes`. Check the output for PII by eye. Only serials, ids, sub-status names, dates, field paths and reason codes may appear.
The plan's code was dry-run against live Workiz on 2026-10-13 (read-only, before implementation). It returned `open jobs: 353 (pages 2, ~4100 ms, dropped by schema 0)`, `ADEQ: 11 · importable: 5` (all `JT-a5DbVzyREDgGvdWK`), and `getJob … same serial: true, uuid: yes`. The bare single-job envelope works.
- `WORKIZ_API_V2_TOKEN is missing…` (exit 1) or `smoke failed: WorkizError code=auth_failed`: **do not edit `.env.local`**. Report it to the orchestrator, which owns the env vars, and still commit the script.
- `smoke failed: … code=bad_response` on `getJob`: the single-job endpoint uses a wrapper `unwrapSingleJob` does not handle. Add a temporary `console.log(Object.keys(raw))` (keys only, never values), adjust `unwrapSingleJob` in `adeq-jobs.ts` plus its test, and re-run.

- [ ] **Step 4: Type check and commit**

Run the TypeScript baseline filter command (expected: no output), then:
```bash
npx biome lint scripts/workiz-adeq-smoke.mts
git add scripts/workiz-adeq-smoke.mts package.json
git commit -F - <<'EOF'
chore(workiz-import): add read-only live smoke script (npm run smoke:workiz)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
```

---

## Wave 6

### Task T23: Final verification (no push, no deploy)

**Files:** none planned. This task only fixes what verification finds, in the file that broke, committed as `fix(workiz-import): …` with the trailer.

- [ ] **Step 1: Full test suite**

Run: `npx vitest run 2>&1 | tail -40`
Expected: `Tests  12 failed | N passed`, where N = 2729 + the new tests. The failures are exactly the 12 baseline ones in Global Constraints (`rbac.test.ts`, download route ×2, reopen route ×2, mobile-nav, nav ×2, validators `inspection.test.ts` ×2, `roles.test.ts`, constants `inspection.test.ts`). List them with `npx vitest run 2>&1 | grep "FAIL"` and compare. Any other failure is a regression: fix it before continuing.

- [ ] **Step 2: Type check**

Run the TypeScript baseline filter command. Expected: no output (only the 67 pre-existing errors in the three excluded test folders remain).

- [ ] **Step 3: Lint every changed file**

```bash
npx biome lint $(git diff --name-only --diff-filter=AM "$(git merge-base main HEAD)" -- '*.ts' '*.tsx' '*.mts')
```
Expected: no diagnostics except the pre-existing ones named in Global Constraints (webhook route test, provenance-context debounce effect). Optionally run `npx biome check` on the **new** files only to see formatter suggestions. They are informational and must not be applied with `--write`.

- [ ] **Step 4: Production build**

```bash
NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=placeholder NEXT_PUBLIC_APP_URL=http://localhost:3000 NEXT_PUBLIC_SITE_URL=http://localhost:3000 npx next build
```
Expected: exit 0, and the route list includes `ƒ /api/workiz/import` and `ƒ /api/workiz/jobs`. The baseline build passed on 2026-10-13. A `server-only` violation shows up here as "You're importing a component that needs server-only", which means a client file reached `src/lib/workiz/*`.

- [ ] **Step 5: Security spot checks**

```bash
git grep -n "WORKIZ_API_V2_TOKEN" -- src scripts
git grep -nE "dangerouslySetInnerHTML" -- src/components/inspection/workiz-import-picker.tsx
git grep -nE "console\.(error|warn|info|log)\([^)]*\berr\b" -- src/lib/workiz src/app/api/workiz
git grep -nE "method: \"(POST|PUT|PATCH|DELETE)\"" -- src/lib/workiz
```
Expected:
- Line 1 matches only `src/lib/workiz/client.ts` and `src/lib/workiz/__tests__/client.test.ts`.
- Lines 2 and 4 print nothing.
- Line 3 prints nothing (no error object is logged directly). `logDbError(…, err, …)` calls do not match this pattern.

- [ ] **Step 6: Live smoke (read-only)**

Run: `npm run smoke:workiz`
Expected: as in T22 Step 3. Paste the output into the handoff. It contains no PII by construction, so confirm that by eye.

- [ ] **Step 7: Confirm the tree**

Run: `git status --short && git log --oneline "$(git merge-base main HEAD)"..HEAD`
Expected: only the unrelated ` M CLAUDE.md` is left uncommitted. The log shows the plan commit plus T1–T22, and any T23 fixes, each with the trailer. **Do not push.** Hand back to the orchestrator.

---

## Orchestrator handoff (not implementer tasks)

These need the user's permission and are done by the orchestrator, not by implementers:

1. **Env vars:** check that `WORKIZ_API_V2_TOKEN` exists in `.env.local`. Set it in Vercel **Production + Preview** as `type: "sensitive"` through the REST API (`POST /v10/projects/{project}/env`), with no trailing newline. `WORKIZ_API_V2_BASE` is optional. Verify through a preview call to `GET /api/workiz/jobs` (spec §14.1).
2. **Push → PR → preview deploy.**
3. **E2E on the preview** with the Playwright MCP browser as an admin test account (spec §13 steps 1–4). Pick a job whose report is already done, or coordinate with that job's tech.
4. **Cleanup** (single production DB, spec §13): wait for the run to reach `done` or `failed`. Remove the run's `inspection_records.storage_path` objects with a service-role script. Then `DELETE /api/inspections/[id]` as admin, and confirm with one read-only query that no row holds that `workiz_job_id`.
5. **Rollback** (spec §14.5): revert the feature commits but keep `"workiz"` in the provenance-schema source enum, or strip `source = 'workiz'` entries first. Otherwise `PATCH /provenance` rejects those drafts' whole maps.

## Plan validation (done while writing this plan, 2026-10-13)

Every code block in this plan was extracted into a throwaway worktree at `e75e699` and run there. Nothing was committed from it.
- Whole plan applied: `npx vitest run` gave **12 failed (exactly the baseline set) / 3007 passed**, 176 files.
- The TypeScript baseline filter printed nothing.
- `npx biome lint` on every new or changed file showed no new diagnostics.
- `next build` exited 0 with `ƒ /api/workiz/import` and `ƒ /api/workiz/jobs` listed.
- `smoke:workiz` ran live and read-only, with the output shown in T22.

The test and expected-value snippets are therefore known-good as written. If one fails during implementation, the cause is a divergence from the plan text, not the plan.

## Spec coverage map (self-review)

| Spec section | Task(s) |
|---|---|
| §1 Small change 1 (Toaster) | T4 (test in T4; also exercised by T21) |
| §1 Small change 2 (`failStaleRuns` on load) | T3 |
| §1 Small change 3 (`requireZipMatch` / `zipMustMatch`) | T2 (type), T8 (behaviour), T16 (sets it) |
| §1 Small change 4 (`workiz` source, `secondary.*` keys) | T2, T9 |
| §2 User-facing behaviour | T19 (picker), T21 (page), T17 (chips), T15 (accept/dismiss) |
| §3 Architecture file list | every file in the File map; additions: `route-auth.ts`, `src/types/workiz-import.ts` |
| §4 Data flow | T20 (import), T18 (list), T3 (edit page loader) |
| §5.1 Field mapping | T16 |
| §5.2 Custom-field value maps | T6 (+ CF ids in T11) |
| §5.3 APN hint | T12 |
| §5.4 Decisions (county blank, ZIP match, email, no phone) | T16, T8 |
| §6 Secondary slot, precedence, lifecycle | T9, T15, T17; merge pins in T9 |
| §7.1–7.2 Client | T10 |
| §7.3 Schema | T11 |
| §7.4 ADEQ rules, listing, cache | T11, T13 |
| §8.1 `GET /api/workiz/jobs` | T18 (+ errors/auth/store in T14) |
| §8.2 `POST /api/workiz/import` | T20 |
| §8.3 Who can import | T14 (`requireWorkizImporter`), T18/T20 tests |
| §9 Picker | T19 |
| §10 Caching / rate limits / stuck runs | T13, T3 |
| §11 Failure handling | T10, T13, T18, T19, T20 |
| §12 Security (token, server-only, boundary, PII logging) | T1, T5, T10 (boundary test), T14, T20, T23 Step 5 |
| §13 Unit tests | every task; webhook regression in T7; e2e = handoff |
| §13 Live smoke | T22, T23 Step 6 |
| §14 Rollout (env, dependency, no migration) | T1 (`.env.example`, `server-only`); handoff 1–5 |

**Plan-level refinements (deliberate, reviewer-visible):**
1. Paging lives in `adeq-jobs.ts` (`fetchOpenJobs`), so the "1-based paging / exact query string" tests are in `adeq-jobs.test.ts`, not `client.test.ts`.
2. Per-request and overall timeouts use `combineSignals` (`setTimeout` + `AbortController`) instead of `AbortSignal.timeout`. The behaviour is the same, and fake timers can drive it.
3. Route tests mock the module seams (`import-store`, `adeq-jobs`, `run-store`). `import-store` has its own Drizzle-chain test.
4. `acceptSecondary` stores the Workiz text as the primary value when an append would exceed the 5,000-char provenance value cap (T15). Otherwise one entry would invalidate the whole-map PATCH.
5. `getJob` accepts a bare job or a `{ data: job | [job] }` wrapper (the single-job envelope was not pinned in the spec). The smoke script confirms which one is live.
6. The lint gate is `npx biome lint` because `biome check` fails on formatting repo-wide.
7. Tank-0 chips (`tankCapacity`, `effluentFilterPresent`) render once the wizard shows a tank section. The form defaults to `tanks: []`, which is existing wizard behaviour. `acceptSecondary` still grows the array.
