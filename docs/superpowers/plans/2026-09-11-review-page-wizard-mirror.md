# Review Page Mirrors the Wizard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 1,073-line hand-rolled `review-editor.tsx` with a thin shell that mounts the six wizard step components (button groups, toggles, tank cards, AI comment buttons, photo capture, provenance badges), autosaves, shows live per-section validation pills, and finalizes through a dialog that flushes saves, runs the step validators, and lets the admin jump to or override issues.

**Architecture:** The review shell owns one `useForm<InspectionFormData>` (resolver `inspectionFormSchema`, mode `onChange`) and wraps everything in shadcn `<Form>` so the unchanged `step-*.tsx` components read it via `useFormContext`. Each step gains a single `readOnly` prop that wraps its content in `<fieldset disabled>`; `PhotoCapture` / `AiCommentButton` / `VideoUpload` return `null` when `readOnly`. A pure `validateSteps()` helper runs the Zod schema once and buckets issues per step (pills + finalize list). `useAutoSave` gains a callable `flush()` and a `status`. `review_notes` cannot be appended through the existing `PATCH /api/inspections/[id]` (it only writes `form_data` + denormalised columns), so a tiny admin-only `PATCH /api/inspections/[id]/review-notes { append }` route is added.

**Tech Stack:** Next.js 16.1 App Router, React 19, TypeScript, Tailwind 4, shadcn/ui (`radix-ui` monolith), `react-hook-form` 7 + `zod` 4 (`@hookform/resolvers`), Drizzle ORM over `postgres`, Supabase Auth, Vitest 4 + jsdom + `@testing-library/react` + `@testing-library/user-event`, Biome (do **not** run `biome --write`; edit by hand in the surrounding style).

Spec: `docs/superpowers/specs/2026-09-11-review-page-wizard-mirror-design.md`.
Shared prefill contracts (provenance provider, tile): `docs/superpowers/plans/2026-09-11-prefill-shared-contracts.md`.

## Global Constraints

- Branch: `feature/review-page-wizard-mirror`, branched from `feature/property-records-prefill` (currently `de3d3bc`). Never push `main`; deploy (push to `main`) only with Daniel's explicit per-deploy approval. Single PR; rollback = revert the PR (no migrations).
- No change to the state machine or permissions: admin = edit + Finalize / Return / Reopen; office staff = edit only (the existing `ReviewActions` gating is untouched). Non-admin flow is exactly what it is today.
- No change to the wizard's tech-side experience (`inspection-wizard.tsx` is **not** modified; `useAutoSave` stays backwards compatible with its `useAutoSave(form, id)` / `useAutoSave(form, id, 500)` call forms and its `{ saving, lastSaved }` return fields).
- No change to the PDF pipeline. `POST /api/inspections/[id]/finalize` is unchanged and keeps receiving `{ selectedMediaIds }`.
- `PATCH /api/inspections/[id]` keeps taking the **raw form data object** as the body — do not change its body shape.
- Copy rules (verbatim from the spec): section pills `✓ complete` (green) / `N empty` (grey) / `⚠ N issues` (amber); save bar `Saved · 2 s ago` / `Saving…` / `Save failed — Retry`; finalize buttons **Fix issues** and **Finalize with issues**; issue groups `Septic Tank · 2 issues`; appended note `Finalized with N validation issues: <field list>`.
- Autosave: 1 s debounce; pills re-render on a 300 ms debounced watch; jump-to highlight lasts 2 s (`data-highlight` attribute, amber ring).
- Completed / sent inspections render read-only: `fieldset[disabled]` on every step, no autosave mounted, no photo upload, until Reopen.
- Test bar: `npx vitest run` must show **no new failures** versus the 15 pre-existing ones listed in Task 13 (three of those — the `review-actions` "Send to Customer" tests — are fixed by this plan, so the expected final count is 12). `npm run build` must pass (placeholder env vars are fine, see Task 13). `npx tsc --noEmit` has pre-existing errors in untouched files; ignore those.
- Every commit: `git add` only the files named in the task; commit message in the repo's conventional style (`feat:`, `fix:`, `test:`, `refactor:`, `docs:`), plus whatever attribution trailer your harness requires.

## Deviations from the spec (deliberate — flag to Daniel in the PR)

1. **`emptyCount` ignores booleans.** Spec §4 says empties are `""`, `[]`, `false`-by-default or `undefined`. With `false` counted, `General Treatment` could never reach `✓ complete` unless "Alternative System" is checked (its only boolean in `STEP_FIELDS`), and every deficiency checkbox would read as a gap. `validateSteps()` therefore counts `""`, whitespace-only, `[]`, `null` and `undefined` only; an unchecked box is an answer, not a gap.
2. **`review_notes` append gets its own route.** Spec §6 says the append goes "client-side through the same PATCH" — the existing PATCH never touches `review_notes`, so Task 7 adds `PATCH /api/inspections/[id]/review-notes` (admin only, `in_review` only).
3. **Extra small file.** The sticky save bar lives in `save-status-bar.tsx` (spec lists it inside `review-editor.tsx`) to keep the shell near 200 lines.
4. **Parity gate compares against the step components, not `STEP_FIELDS`.** `STEP_FIELDS` is the subset used for `form.trigger()`, so literal membership would report ~90 false "missing" fields. The script's hard gate is "rendered by a `step-*.tsx`"; the `STEP_FIELDS` prefix is printed for information.

## Codebase facts you need

- Step components take only `inspectionId` and read the form via `useFormContext<InspectionFormData>()`; they fetch `/api/inspections/[id]/media` on mount and render `MediaGallery` + `PhotoCapture` (Disposal Works also `VideoUpload`; Septic Tank and Disposal Works also `AiCommentButton`). Their root element is `<div className="space-y-8">` (`space-y-6` for Alternative System).
- `STEP_LABELS` (`src/lib/constants/inspection.ts`) = `["Facility Info","General Treatment","Design Flow","Septic Tank","Disposal Works","Alternative System"]`; `STEP_FIELDS` (`src/lib/validators/inspection.ts`) maps step index 0–5 → dotted paths. The only `.min(1)` rules in the schema are `facilityInfo.facilityName` and `facilityInfo.inspectorName`; other errors come from enum/boolean shape violations in old data.
- `getDefaultFormValues("")` returns a type that is *not* assignable to `InspectionFormData` (missing `disposalWorks.signatureDataUrl`); in tests cast it: `getDefaultFormValues("x") as unknown as InspectionFormData`.
- shadcn `FormItem` renders `<div data-slot="form-item">`; `CollapsibleTrigger asChild` on `CardHeader` yields `data-slot="collapsible-trigger"` on the header (the trigger's slot prop wins over `card-header`) — tests use that selector.
- Radix `CollapsibleContent` unmounts its children when closed, so a step mounts (and fetches media) each time its section expands. RHF keeps values for unmounted fields (`shouldUnregister` defaults to false).
- `form.setFocus(path)` is a no-op for Controller fields that never attach `field.ref` (ButtonGroup, checkboxes) and focuses `Input`/`Textarea` fields — safe to call for any path.
- Tailwind 4 preflight resets `fieldset` margin/padding/border; only the UA `min-inline-size: min-content` remains, so the wrapper gets `min-w-0`. Theme colours are exposed as CSS variables (`--color-amber-400`).
- Existing route tests mock `@/lib/supabase/server`, `@/lib/db`, `@/lib/db/schema`, `drizzle-orm` with `vi.hoisted` factories — copy that shape (see `src/app/api/inspections/[id]/return/__tests__/route.test.ts`).
- Test-admin credentials are **not** in the repo (searched `src/` and `docs/`): ask Daniel for the admin login before the browser check in Task 13. `.env.local` is not committed; `npx vercel env pull .env.local` fetches it (project linked in `.vercel/`). That env points at the **production** database — only exercise inspections you create for the test.
- `node scripts/*.mts` runs under Node 24 with native type stripping (no `tsx` needed) as long as the script avoids path aliases, enums and parameter properties.

## File structure

Create:
- `scripts/review-field-parity.mts` — parity gate (spec §7)
- `src/lib/validators/step-validation.ts` — `validateSteps()`, `stepForPath()`, `allIssues()`, `humanizeFieldPath()`, `isEmptyFieldValue()`
- `src/lib/validators/__tests__/step-validation.test.ts`
- `src/components/inspection/__tests__/step-read-only.test.tsx`
- `src/components/review/review-pill.tsx` — `ReviewPill`, `pillKind()`, `useStepValidations()`
- `src/components/review/__tests__/review-pill.test.tsx`
- `src/components/review/photo-selection.tsx` — extracted from the old editor
- `src/components/review/__tests__/photo-selection.test.tsx`
- `src/components/review/report-preview.tsx` — extracted from the old editor
- `src/components/review/__tests__/report-preview.test.tsx`
- `src/app/api/inspections/[id]/review-notes/route.ts` + `__tests__/route.test.ts`
- `src/components/review/finalize-dialog.tsx` + `__tests__/finalize-dialog.test.tsx`
- `src/components/review/save-status-bar.tsx` + `__tests__/save-status-bar.test.tsx`
- `src/components/review/__tests__/review-editor.test.tsx`
- `src/components/ui/__tests__/form-item.test.tsx`

Modify:
- `src/hooks/use-auto-save.ts` (+ `src/hooks/__tests__/use-auto-save.test.ts`) — `flush()`, `status`, `enabled`
- `src/app/globals.css` — `fieldset:disabled` + `data-highlight` rules
- `src/components/ui/form.tsx` — `FormItem` exposes `data-field-path`
- `src/components/inspection/photo-capture.tsx`, `ai-comment-button.tsx`, `video-upload.tsx` — `readOnly` gate
- `src/components/inspection/step-facility-info.tsx`, `step-general-treatment.tsx`, `step-design-flow.tsx`, `step-septic-tank.tsx`, `step-disposal-works.tsx`, `step-alternative-system.tsx` — `readOnly` prop + fieldset wrapper
- `src/components/review/review-section.tsx` (+ test) — controlled `open` / `onOpenChange`, `pill`
- `src/components/review/review-actions.tsx` (+ test rewrite) — FinalizeDialog, `flush` before Return/Reopen
- `src/components/review/review-editor.tsx` — rewritten as the shell (~215 lines)
- `src/app/(dashboard)/review/[id]/page.tsx` — provenance prop (guarded)

---

### Task 1: Parity gate script

**Files:**
- Create: `scripts/review-field-parity.mts`

**Interfaces:**
- Consumes: `src/components/review/review-editor.tsx` (old editor, still present), `src/components/inspection/step-*.tsx`, `src/lib/validators/inspection.ts`
- Produces: a CLI that exits 0 when every field the old editor renders is rendered by a step component, 1 otherwise. Task 12 re-runs it against a saved copy of the old editor with `--old <path>`.

- [ ] **Step 1: Create the branch**

```bash
git checkout feature/property-records-prefill
git pull --ff-only
git checkout -b feature/review-page-wizard-mirror
```

- [ ] **Step 2: Write the script**

Create `scripts/review-field-parity.mts`:

```ts
/**
 * Review-page parity gate (spec §7).
 *
 * Extracts every form field path the legacy review editor renders and checks
 * that a wizard step component renders the same path. Run before deleting the
 * old editor and again after the rewrite; paste the output into the PR.
 *
 * Usage:
 *   node scripts/review-field-parity.mts                      # gate the live old editor
 *   node scripts/review-field-parity.mts --old <saved-copy>   # gate a saved copy after deletion
 * Exit code 1 when any field is missing.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const oldArgIdx = process.argv.indexOf("--old");
const OLD_EDITOR =
  oldArgIdx > -1 ? process.argv[oldArgIdx + 1] : "src/components/review/review-editor.tsx";
const STEP_DIR = "src/components/inspection";
const VALIDATORS = "src/lib/validators/inspection.ts";

/** `${index}` / `${tankIndex}` / `${i}` → `*` so tank/port fields compare structurally */
function normalize(path: string): string {
  return path.replace(/\$\{[^}]+\}/g, "*");
}

/** Field paths the legacy editor renders via its render*("…") helpers */
function extractOldEditorFields(source: string): Set<string> {
  const out = new Set<string>();
  const helperCall =
    /render(?:TextField|Checkbox|SelectField|ButtonGroup|CheckboxGroup)\(\s*(["'`])([^"'`]+)\1/g;
  for (const m of source.matchAll(helperCall)) out.add(normalize(m[2]));
  return out;
}

/**
 * Field paths a step component renders: name="…", name={`…`}, `${item.field}`
 * loops expanded from `field: "…"` tables, and `name: "…"` inline tables.
 */
function extractStepFields(source: string): Set<string> {
  const out = new Set<string>();
  const fieldTable = [...source.matchAll(/field:\s*"([A-Za-z0-9_]+)"/g)].map((m) => m[1]);
  for (const m of source.matchAll(/name:\s*"([A-Za-z0-9_.]+)"/g)) out.add(m[1]);
  for (const m of source.matchAll(/name=(?:"([^"]+)"|\{`([^`]+)`(?:\s+as\s+const)?\})/g)) {
    const raw = m[1] ?? m[2];
    if (raw.includes("${item.field}")) {
      for (const f of fieldTable) out.add(normalize(raw.replace("${item.field}", f)));
    } else {
      out.add(normalize(raw));
    }
  }
  return out;
}

/** Top-level key → step index, derived from STEP_FIELDS in the validators file */
function extractStepPrefixes(source: string): Map<string, number> {
  const block = source.slice(source.indexOf("export const STEP_FIELDS"));
  const map = new Map<string, number>();
  let step = -1;
  for (const line of block.split("\n")) {
    const stepStart = line.match(/^\s*(\d+):\s*\[/);
    if (stepStart) step = Number(stepStart[1]);
    const path = line.match(/^\s*"([A-Za-z]+)\./);
    if (path && step >= 0 && !map.has(path[1])) map.set(path[1], step);
    if (/^};/.test(line)) break;
  }
  return map;
}

if (!existsSync(join(root, OLD_EDITOR))) {
  console.error(`Old editor not found at ${OLD_EDITOR} — pass --old <path to a saved copy>`);
  process.exit(2);
}

const oldFields = extractOldEditorFields(readFileSync(join(root, OLD_EDITOR), "utf8"));
const stepFields = new Map<string, string>(); // path → file
for (const file of readdirSync(join(root, STEP_DIR)).filter((f) => /^step-.*\.tsx$/.test(f))) {
  for (const p of extractStepFields(readFileSync(join(root, STEP_DIR, file), "utf8"))) {
    if (!stepFields.has(p)) stepFields.set(p, file);
  }
}
const prefixes = extractStepPrefixes(readFileSync(join(root, VALIDATORS), "utf8"));

const missing: string[] = [];
console.log(`Old editor fields: ${oldFields.size}   Step component fields: ${stepFields.size}\n`);
for (const p of [...oldFields].sort()) {
  const step = prefixes.get(p.split(".")[0]);
  const where = stepFields.get(p);
  const status = where ? "OK     " : "MISSING";
  console.log(`${status}  ${p.padEnd(52)} step ${step ?? "?"}  ${where ?? "-"}`);
  if (!where) missing.push(p);
}
console.log(
  `\n${missing.length === 0 ? "PARITY OK" : `PARITY FAILED — ${missing.length} field(s) not rendered by any step component:`}`,
);
for (const p of missing) console.log(`  - ${p}`);
process.exit(missing.length === 0 ? 0 : 1);
```

- [ ] **Step 3: Run it against the live old editor**

Run: `node scripts/review-field-parity.mts; echo "exit=$?"`

Expected (verified on `de3d3bc`): first line `Old editor fields: 120   Step component fields: 201`, 120 `OK` rows (every `facilityInfo.*`, `generalTreatment.*`, `designFlow.*`, `septicTank.*` incl. `septicTank.tanks.*.…`, `disposalWorks.*` path), last line `PARITY OK`, `exit=0`.

If any row prints `MISSING`: the old editor exposed a field the wizard hides. Add a `FormField` for that path to the step file printed for its prefix (`step 0` → `step-facility-info.tsx`, `1` → general-treatment, `2` → design-flow, `3` → septic-tank, `4` → disposal-works, `5` → alternative-system), copying the neighbouring `FormField` pattern (`FormItem` → `FormLabel` → `FormControl` → `Input`/`ButtonGroup` → `FormMessage`), re-run until `PARITY OK`, and include that step file in this task's commit. None are expected.

- [ ] **Step 4: Save the output for the PR and commit**

```bash
mkdir -p "$SCRATCHPAD"   # your session scratchpad directory
node scripts/review-field-parity.mts > "$SCRATCHPAD/parity-before.txt"
git add scripts/review-field-parity.mts
git commit -m "chore(review): add field-parity gate for the review editor rewrite"
```

(Keep `parity-before.txt`; its content goes into the PR description in Task 13.)

---

### Task 2: `validateSteps()` pure helper

**Files:**
- Create: `src/lib/validators/step-validation.ts`
- Test: `src/lib/validators/__tests__/step-validation.test.ts`

**Interfaces:**
- Consumes: `inspectionFormSchema`, `STEP_FIELDS` from `@/lib/validators/inspection`
- Produces (used by Tasks 5 and 8):
  - `interface StepIssue { path: string; message: string }`
  - `interface StepValidation { errors: StepIssue[]; emptyCount: number }`
  - `type StepValidationResult = Record<number, StepValidation>` (keys 0–5 always present)
  - `const STEP_COUNT = 6`
  - `validateSteps(formData: unknown): StepValidationResult`
  - `stepForPath(path: string): number | null`
  - `allIssues(result): Array<StepIssue & { step: number }>`
  - `humanizeFieldPath(path: string): string` — `"septicTank.tanks.0.lidsRisersPresent"` → `"Tank 1 · Lids Risers Present"`
  - `isEmptyFieldValue(v: unknown): boolean`, `getPath(obj, path): unknown`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/validators/__tests__/step-validation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getDefaultFormValues, STEP_FIELDS } from "@/lib/validators/inspection";
import {
  allIssues,
  humanizeFieldPath,
  isEmptyFieldValue,
  STEP_COUNT,
  stepForPath,
  validateSteps,
} from "@/lib/validators/step-validation";
import type { InspectionFormData } from "@/types/inspection";

function completeForm(): InspectionFormData {
  const d = getDefaultFormValues("Dan Endres") as unknown as InspectionFormData;
  d.facilityInfo.facilityName = "Smith Residence";
  return d;
}

/** Schema-valid non-empty values for the enum-typed STEP_FIELDS entries */
const ENUM_VALUES: Record<string, string> = {
  "generalTreatment.hasPerformanceAssurancePlan": "yes",
  "septicTank.tanksPumped": "yes",
  "disposalWorks.disposalWorksLocationDetermined": "yes",
  "disposalWorks.distributionComponentInspected": "yes",
  "disposalWorks.inspectionPortsPresent": "present",
  "disposalWorks.hydraulicLoadTestPerformed": "yes",
  "disposalWorks.hasDisposalDeficiency": "no",
  "disposalWorks.repairsRecommended": "no",
  "alternativeSystem.altDisposalLocationDetermined": "yes",
};

function setPath(obj: unknown, path: string, value: unknown) {
  const segs = path.split(".");
  let cur = obj as Record<string, unknown>;
  for (const s of segs.slice(0, -1)) cur = cur[s] as Record<string, unknown>;
  cur[segs[segs.length - 1]] = value;
}

describe("validateSteps", () => {
  it("returns an entry for every step, even when the form is empty", () => {
    const result = validateSteps(getDefaultFormValues(""));
    expect(Object.keys(result).map(Number)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("buckets required-field errors into step 0", () => {
    const result = validateSteps(getDefaultFormValues(""));
    expect(result[0].errors).toEqual([
      { path: "facilityInfo.facilityName", message: "Facility/Property name is required" },
      { path: "facilityInfo.inspectorName", message: "Inspector name is required" },
    ]);
    for (let i = 1; i < STEP_COUNT; i++) expect(result[i].errors).toEqual([]);
  });

  it("is clean for a form with both required fields filled", () => {
    expect(allIssues(validateSteps(completeForm()))).toEqual([]);
  });

  it("buckets a nested tank enum error into step 3 with the full dotted path", () => {
    const form = completeForm();
    form.septicTank.tanks = [{ lidsRisersPresent: "sideways" } as never];
    const result = validateSteps(form);
    expect(result[3].errors).toHaveLength(1);
    expect(result[3].errors[0].path).toBe("septicTank.tanks.0.lidsRisersPresent");
    expect(result[0].errors).toEqual([]);
  });

  it("counts empty STEP_FIELDS per step and ignores booleans", () => {
    const form = completeForm();
    const result = validateSteps(form);
    // Step 2 (Design Flow): all 7 STEP_FIELDS are "" on a fresh form
    expect(result[2].emptyCount).toBe(STEP_FIELDS[2].length);
    form.designFlow.estimatedDesignFlow = "450";
    expect(validateSteps(form)[2].emptyCount).toBe(STEP_FIELDS[2].length - 1);
    // Step 1: generalTreatment.alternativeSystem is a boolean and never counts as empty
    expect(STEP_FIELDS[1]).toContain("generalTreatment.alternativeSystem");
    expect(result[1].emptyCount).toBe(STEP_FIELDS[1].length - 1);
  });

  it("reports zero empties and zero errors when every step field has a value", () => {
    const form = completeForm();
    for (const paths of Object.values(STEP_FIELDS)) {
      for (const p of paths) {
        const current = p.split(".").reduce<unknown>((o, s) => (o as Record<string, unknown>)?.[s], form);
        if (Array.isArray(current)) setPath(form, p, ["x"]);
        else if (typeof current === "boolean") setPath(form, p, true);
        else setPath(form, p, ENUM_VALUES[p] ?? "x");
      }
    }
    const result = validateSteps(form);
    for (let i = 0; i < STEP_COUNT; i++) {
      expect(result[i].emptyCount, `step ${i}`).toBe(0);
      expect(result[i].errors, `step ${i}`).toEqual([]);
    }
  });

  it("maps every STEP_FIELDS path to exactly one step, matching its bucket", () => {
    for (const [step, paths] of Object.entries(STEP_FIELDS)) {
      for (const p of paths) expect(stepForPath(p), p).toBe(Number(step));
    }
    expect(stepForPath("includeAlternativePages")).toBe(4);
    expect(stepForPath("nope.field")).toBeNull();
  });
});

describe("isEmptyFieldValue", () => {
  it("treats '', whitespace, [], null, undefined as empty and everything else as filled", () => {
    expect(isEmptyFieldValue("")).toBe(true);
    expect(isEmptyFieldValue("   ")).toBe(true);
    expect(isEmptyFieldValue([])).toBe(true);
    expect(isEmptyFieldValue(null)).toBe(true);
    expect(isEmptyFieldValue(undefined)).toBe(true);
    expect(isEmptyFieldValue("0")).toBe(false);
    expect(isEmptyFieldValue(false)).toBe(false);
    expect(isEmptyFieldValue(["a"])).toBe(false);
  });
});

describe("humanizeFieldPath", () => {
  it("humanizes plain and tank-indexed paths", () => {
    expect(humanizeFieldPath("facilityInfo.facilityName")).toBe("Facility Name");
    expect(humanizeFieldPath("septicTank.tanks.1.lidsRisersPresent")).toBe(
      "Tank 2 · Lids Risers Present",
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/validators/__tests__/step-validation.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/validators/step-validation"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/validators/step-validation.ts`:

```ts
import { inspectionFormSchema, STEP_FIELDS } from "@/lib/validators/inspection";

/** One validator error, addressed by dotted form path (e.g. `septicTank.tanks.0.lidsRisersPresent`) */
export interface StepIssue {
  path: string;
  message: string;
}

export interface StepValidation {
  /** Zod issues whose path falls inside this step */
  errors: StepIssue[];
  /** STEP_FIELDS entries for this step whose value is "", [], null or undefined */
  emptyCount: number;
}

/** Keyed by step index 0–5 (STEP_LABELS order); every step is always present */
export type StepValidationResult = Record<number, StepValidation>;

export const STEP_COUNT = 6;

/** Top-level form keys that live in a step but are not listed in STEP_FIELDS */
const EXTRA_STEP_KEYS: Record<string, number> = {
  // The "Add Alternative System Pages" switch renders at the bottom of Disposal Works
  includeAlternativePages: 4,
};

/** Top-level form key (`facilityInfo`, `septicTank`, …) → step index, derived from STEP_FIELDS */
const STEP_BY_PREFIX: Record<string, number> = (() => {
  const map: Record<string, number> = { ...EXTRA_STEP_KEYS };
  for (const [step, paths] of Object.entries(STEP_FIELDS)) {
    for (const p of paths) {
      const prefix = p.split(".")[0];
      if (!(prefix in map)) map[prefix] = Number(step);
    }
  }
  return map;
})();

/** Step index for a dotted field path, or null when the prefix is unknown */
export function stepForPath(path: string): number | null {
  const step = STEP_BY_PREFIX[path.split(".")[0]];
  return step === undefined ? null : step;
}

/** Read a dotted path (array indices allowed) from a plain object */
export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const seg of path.split(".")) {
    if (cur === null || cur === undefined) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/**
 * "", [], null and undefined are empty. Booleans are never empty: an unchecked
 * box is an answer ("no"), not a gap — so a section can reach "complete".
 */
export function isEmptyFieldValue(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/**
 * Runs the full inspection schema once and buckets the result per wizard step.
 * Pure: safe to call on every (debounced) form change.
 */
export function validateSteps(formData: unknown): StepValidationResult {
  const result: StepValidationResult = {};
  for (let i = 0; i < STEP_COUNT; i++) result[i] = { errors: [], emptyCount: 0 };

  const parsed = inspectionFormSchema.safeParse(formData);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.map(String).join(".");
      const step = stepForPath(path);
      if (step === null) continue;
      result[step].errors.push({ path, message: issue.message });
    }
  }

  for (let i = 0; i < STEP_COUNT; i++) {
    for (const path of STEP_FIELDS[i] ?? []) {
      if (isEmptyFieldValue(getPath(formData, path))) result[i].emptyCount += 1;
    }
  }

  return result;
}

/** Flat list of every error across steps, in step order — what the finalize dialog shows */
export function allIssues(result: StepValidationResult): Array<StepIssue & { step: number }> {
  const out: Array<StepIssue & { step: number }> = [];
  for (let i = 0; i < STEP_COUNT; i++) {
    for (const e of result[i].errors) out.push({ ...e, step: i });
  }
  return out;
}

/** "septicTank.tanks.0.lidsRisersPresent" → "Tank 1 · Lids Risers Present" */
export function humanizeFieldPath(path: string): string {
  const segs = path.split(".");
  const words = (s: string) =>
    s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
  const last = words(segs[segs.length - 1]);
  const tankIdx = segs.indexOf("tanks");
  if (tankIdx > -1 && /^\d+$/.test(segs[tankIdx + 1] ?? "")) {
    return `Tank ${Number(segs[tankIdx + 1]) + 1} · ${last}`;
  }
  return last;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/validators/__tests__/step-validation.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validators/step-validation.ts src/lib/validators/__tests__/step-validation.test.ts
git commit -m "feat(review): validateSteps() buckets schema issues and empties per wizard step"
```

---
### Task 3: `useAutoSave` — callable `flush()`, `status`, `enabled`

**Files:**
- Modify: `src/hooks/use-auto-save.ts` (whole file replaced below)
- Test: `src/hooks/__tests__/use-auto-save.test.ts` (append new blocks; the 14 existing tests must keep passing unchanged)

**Interfaces:**
- Consumes: nothing new
- Produces:
  - `type AutoSaveStatus = "idle" | "saving" | "saved" | "error"`
  - `interface UseAutoSaveOptions { debounceMs?: number; enabled?: boolean }`
  - `useAutoSave(form, inspectionId, options?: number | UseAutoSaveOptions): { saving: boolean; lastSaved: Date | null; status: AutoSaveStatus; flush: () => Promise<boolean> }`
  - `flush()` cancels the pending debounce and saves now; resolves `true` on 2xx or when nothing changed, `false` when the PATCH failed; a flush issued while a save is in flight waits for it instead of PATCHing again. With `enabled: false` nothing ever saves and `flush()` resolves `true`.

- [ ] **Step 1: Append the failing tests**

Append to the end of `src/hooks/__tests__/use-auto-save.test.ts` (after the closing `});` of `describe("useAutoSave", …)`):

```ts
// ── flush() / status / enabled ────────────────────────────────────────────────

describe("flush()", () => {
  it("resolves true on 2xx and cancels the pending debounce", async () => {
    const form = makeMockForm({ field: "v1" });
    const { result, rerender } = renderHook(() => useAutoSave(form, "insp-1", 1000));

    watchedValuesRef.current = { field: "v2" };
    form.getValues.mockReturnValue({ field: "v2" });
    rerender();

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.flush();
    });

    expect(ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/api/inspections/insp-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ field: "v2" }),
    });

    // The debounce that was pending must not fire a second PATCH
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("saved");
  });

  it("resolves false and sets status=error when the PATCH fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const form = makeMockForm({ field: "v1" });
    const { result } = renderHook(() => useAutoSave(form, "insp-1", 1000));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.flush();
    });

    expect(ok).toBe(false);
    expect(result.current.status).toBe("error");
    expect(toast.error).toHaveBeenCalledWith("Auto-save failed");
  });

  it("resolves true without a request when nothing changed since the last save", async () => {
    const form = makeMockForm({ field: "same" });
    const { result } = renderHook(() => useAutoSave(form, "insp-1", 1000));

    await act(async () => {
      await result.current.flush();
    });
    expect(fetch).toHaveBeenCalledTimes(1);

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.flush();
    });
    expect(ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("dedupes an in-flight save: a second flush waits for the first instead of PATCHing again", async () => {
    let resolveFetch: (v: any) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; })),
    );
    const form = makeMockForm({ field: "v1" });
    const { result } = renderHook(() => useAutoSave(form, "insp-1", 1000));

    let first: Promise<boolean> = Promise.resolve(false);
    let second: Promise<boolean> = Promise.resolve(false);
    act(() => {
      first = result.current.flush();
      second = result.current.flush();
    });
    expect(result.current.status).toBe("saving");
    expect(fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFetch({ ok: true });
      await first;
      await second;
    });

    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("saved");
  });

  it("exposes status transitions idle → saving → saved", async () => {
    let resolveFetch: (v: any) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; })),
    );
    const form = makeMockForm({ field: "v1" });
    const { result, rerender } = renderHook(() => useAutoSave(form, "insp-1", 100));
    expect(result.current.status).toBe("idle");

    watchedValuesRef.current = { field: "v1" };
    rerender();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.status).toBe("saving");
    expect(result.current.saving).toBe(true);

    await act(async () => {
      resolveFetch({ ok: true });
    });
    expect(result.current.status).toBe("saved");
    expect(result.current.saving).toBe(false);
  });
});

describe("enabled: false", () => {
  it("never saves, flush() resolves true, and no beforeunload listener is added", async () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const form = makeMockForm({ field: "v1" });
    const { result, rerender, unmount } = renderHook(() =>
      useAutoSave(form, "insp-1", { debounceMs: 100, enabled: false }),
    );

    watchedValuesRef.current = { field: "v2" };
    form.getValues.mockReturnValue({ field: "v2" });
    rerender();
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.flush();
    });
    unmount();

    expect(ok).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(addSpy).not.toHaveBeenCalledWith("beforeunload", expect.any(Function));
  });
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `npx vitest run src/hooks/__tests__/use-auto-save.test.ts`
Expected: 14 pass, 6 fail (`result.current.flush is not a function`, `status` undefined).

- [ ] **Step 3: Replace the hook**

Replace the whole of `src/hooks/use-auto-save.ts` with:

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type UseFormReturn, useWatch } from "react-hook-form";
import { toast } from "sonner";

export type AutoSaveStatus = "idle" | "saving" | "saved" | "error";

export interface UseAutoSaveOptions {
  /** Debounce window in ms (default 1000) */
  debounceMs?: number;
  /** When false the hook never saves (read-only review) and flush() resolves true immediately */
  enabled?: boolean;
}

export interface UseAutoSaveReturn {
  /** True while a PATCH is in flight (kept for WizardNavigation) */
  saving: boolean;
  lastSaved: Date | null;
  status: AutoSaveStatus;
  /**
   * Cancel the pending debounce and save now. Resolves true when the form is
   * persisted (or nothing changed), false when the PATCH failed. If a save is
   * already in flight, waits for it and then saves any newer changes.
   */
  flush: () => Promise<boolean>;
}

/**
 * Debounced auto-save hook for the inspection wizard and the review page.
 * Uses useWatch to observe form changes in an isolated context,
 * preventing full-form re-renders on every keystroke.
 *
 * The third argument accepts a bare debounce number for backwards compatibility.
 */
export function useAutoSave(
  form: UseFormReturn<any>,
  inspectionId: string,
  options: number | UseAutoSaveOptions = {},
): UseAutoSaveReturn {
  const { debounceMs = 1000, enabled = true } =
    typeof options === "number" ? { debounceMs: options } : options;

  const [status, setStatus] = useState<AutoSaveStatus>("idle");
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const lastSavedRef = useRef<string>("");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<Promise<boolean> | null>(null);
  const isMountedRef = useRef(true);

  // Observe form changes via useWatch to trigger debounced saves.
  // We use useWatch as a change trigger, but always send the complete
  // form via form.getValues() to avoid partial data from unmounted steps.
  const watchedValues = useWatch({ control: form.control });

  const performSave = useCallback(async (): Promise<boolean> => {
    const json = JSON.stringify(form.getValues());
    if (json === lastSavedRef.current) return true;

    if (isMountedRef.current) setStatus("saving");
    try {
      const response = await fetch(`/api/inspections/${inspectionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: json,
      });

      if (!response.ok) {
        throw new Error(`Save failed: ${response.status}`);
      }

      lastSavedRef.current = json;
      if (isMountedRef.current) {
        setLastSaved(new Date());
        setStatus("saved");
      }
      return true;
    } catch {
      if (isMountedRef.current) {
        setStatus("error");
        toast.error("Auto-save failed");
      }
      return false;
    }
  }, [form, inspectionId]);

  const flush = useCallback((): Promise<boolean> => {
    if (!enabled) return Promise.resolve(true);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    // Serialise behind any in-flight save so two flushes never race; the
    // chained performSave is a no-op when nothing changed in the meantime.
    const run: Promise<boolean> = inFlightRef.current
      ? inFlightRef.current.then(() => performSave())
      : performSave();
    inFlightRef.current = run;
    run.finally(() => {
      if (inFlightRef.current === run) inFlightRef.current = null;
    });
    return run;
  }, [enabled, performSave]);

  // Debounce saves on form value changes
  useEffect(() => {
    if (!enabled) return;
    const json = JSON.stringify(watchedValues);
    if (json === lastSavedRef.current) return;

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      flush();
    }, debounceMs);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [watchedValues, debounceMs, enabled, flush]);

  // Flush pending save on unmount
  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      if (!enabled) return;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        // Fire-and-forget save of current values
        const currentValues = form.getValues();
        const json = JSON.stringify(currentValues);
        if (json !== lastSavedRef.current) {
          fetch(`/api/inspections/${inspectionId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: json,
          }).catch(() => {
            // Unmount save failed silently
          });
        }
      }
    };
  }, [form, inspectionId, enabled]);

  // Warn on browser close if there are unsaved changes
  useEffect(() => {
    if (!enabled) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const currentJson = JSON.stringify(form.getValues());
      if (currentJson !== lastSavedRef.current) {
        e.preventDefault();
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [form, enabled]);

  return { saving: status === "saving", lastSaved, status, flush };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/hooks/__tests__/use-auto-save.test.ts`
Expected: PASS — 20 tests.

Also confirm the wizard still type-checks against the new return shape (it destructures `{ saving, lastSaved }`):
Run: `npx tsc --noEmit 2>&1 | grep -E "inspection-wizard|use-auto-save" ; echo "grep-exit=$?"`
Expected: no lines, `grep-exit=1`.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-auto-save.ts src/hooks/__tests__/use-auto-save.test.ts
git commit -m "feat(autosave): callable flush(), status and enabled option"
```

---
### Task 4: Read-only mechanism — `readOnly` on every step, upload/AI gating, CSS, `data-field-path`

**Files:**
- Modify: `src/app/globals.css` (append after the `@layer base { … }` block at the end of the file)
- Modify: `src/components/ui/form.tsx` (`FormItem`, lines ~70–78)
- Modify: `src/components/inspection/photo-capture.tsx`, `ai-comment-button.tsx`, `video-upload.tsx`
- Modify: `src/components/inspection/step-facility-info.tsx`, `step-general-treatment.tsx`, `step-design-flow.tsx`, `step-septic-tank.tsx`, `step-disposal-works.tsx`, `step-alternative-system.tsx`
- Test: `src/components/inspection/__tests__/step-read-only.test.tsx`, `src/components/ui/__tests__/form-item.test.tsx`

**Interfaces:**
- Consumes: nothing new
- Produces (used by Task 10):
  - every `Step*` component accepts `readOnly?: boolean` (default `false`) and renders its content inside `<fieldset disabled={readOnly} className="min-w-0 space-y-8">` (Alternative System: `space-y-6`)
  - `PhotoCapture`, `VideoUpload`, `AiCommentButton` accept `readOnly?: boolean` and render `null` when true
  - `FormItem` renders `data-field-path="<FormField name>"` (absent outside a `FormField`)
  - CSS: `fieldset:disabled { opacity: .6 }`, `fieldset:disabled .pointer-none { pointer-events: none }`, `[data-slot="form-item"][data-highlight="true"]` amber ring

- [ ] **Step 1: Write the failing tests**

Create `src/components/inspection/__tests__/step-read-only.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiCommentButton } from "@/components/inspection/ai-comment-button";
import { PhotoCapture } from "@/components/inspection/photo-capture";
import { StepDesignFlow } from "@/components/inspection/step-design-flow";
import { VideoUpload } from "@/components/inspection/video-upload";
import { getDefaultFormValues } from "@/lib/validators/inspection";
import type { InspectionFormData } from "@/types/inspection";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/storage/tus-upload.mjs", () => ({ uploadVideoTus: vi.fn() }));
vi.mock("@/hooks/use-comment-rewrite", () => ({
  useCommentRewrite: () => ({ isGenerating: false, generate: vi.fn() }),
}));

function Wrapper({ children }: { children: React.ReactNode }) {
  const form = useForm<InspectionFormData>({ defaultValues: getDefaultFormValues("Dan") });
  return <FormProvider {...form}>{children}</FormProvider>;
}

beforeEach(() => {
  // Media list fetch performed on mount by every step
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
});

describe("step readOnly", () => {
  it("wraps the step in an enabled fieldset by default and shows the photo drop zone", () => {
    render(
      <Wrapper>
        <StepDesignFlow inspectionId="insp-1" />
      </Wrapper>,
    );
    const fieldset = document.querySelector("fieldset");
    expect(fieldset).not.toBeNull();
    expect(fieldset).not.toBeDisabled();
    expect(screen.getByLabelText("Estimated Design Flow (GPD)")).toBeEnabled();
    expect(screen.getByText(/browse files/i)).toBeInTheDocument();
  });

  it("readOnly: fieldset[disabled] disables every control and hides the photo drop zone", () => {
    render(
      <Wrapper>
        <StepDesignFlow inspectionId="insp-1" readOnly />
      </Wrapper>,
    );
    expect(document.querySelector("fieldset[disabled]")).not.toBeNull();
    expect(screen.getByLabelText("Estimated Design Flow (GPD)")).toBeDisabled();
    // ButtonGroup buttons are native <button>s → disabled by the fieldset
    for (const b of screen.getAllByRole("button")) expect(b).toBeDisabled();
    expect(screen.queryByText(/browse files/i)).not.toBeInTheDocument();
  });
});

describe("readOnly gating of upload / AI actions", () => {
  it("PhotoCapture renders nothing when readOnly", () => {
    const { container } = render(
      <PhotoCapture inspectionId="insp-1" section="design-flow" onUploadComplete={vi.fn()} readOnly />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("VideoUpload renders nothing when readOnly", () => {
    const { container } = render(
      <VideoUpload inspectionId="insp-1" onUploadComplete={vi.fn()} readOnly />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("AiCommentButton renders nothing when readOnly, and the button otherwise", () => {
    const { container, rerender } = render(
      <Wrapper>
        <AiCommentButton
          inspectionId="insp-1"
          section="septicTank"
          fieldPath="septicTank.septicTankComments"
          buildContext={() => ({}) as never}
          readOnly
        />
      </Wrapper>,
    );
    expect(container).toBeEmptyDOMElement();
    rerender(
      <Wrapper>
        <AiCommentButton
          inspectionId="insp-1"
          section="septicTank"
          fieldPath="septicTank.septicTankComments"
          buildContext={() => ({}) as never}
        />
      </Wrapper>,
    );
    expect(screen.getByRole("button", { name: /generate with ai/i })).toBeInTheDocument();
  });
});
```

Create `src/components/ui/__tests__/form-item.test.tsx`:

```tsx
import { render } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";
import { Form, FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { Input } from "@/components/ui/input";

function Harness() {
  const form = useForm({ defaultValues: { facilityInfo: { facilityName: "" } } });
  return (
    <Form {...form}>
      <FormField
        control={form.control}
        name="facilityInfo.facilityName"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Name</FormLabel>
            <FormControl>
              <Input {...field} />
            </FormControl>
          </FormItem>
        )}
      />
      <FormItem data-testid="bare" />
    </Form>
  );
}

describe("FormItem data-field-path", () => {
  it("exposes the FormField name and omits it outside a FormField", () => {
    const { getByTestId } = render(<Harness />);
    expect(
      document.querySelector('[data-slot="form-item"][data-field-path="facilityInfo.facilityName"]'),
    ).not.toBeNull();
    expect(getByTestId("bare")).not.toHaveAttribute("data-field-path");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/inspection/__tests__/step-read-only.test.tsx src/components/ui/__tests__/form-item.test.tsx`
Expected: FAIL — `document.querySelector("fieldset")` is null; `readOnly` components still render; `data-field-path` missing.

- [ ] **Step 3: Add the CSS rules**

Append to the end of `src/app/globals.css`:

```css
/* Review page read-only mode: every step is wrapped in <fieldset disabled> */
@layer components {
  fieldset:disabled {
    opacity: 0.6;
  }
  /* Non-native widgets (canvas/signature pads) opt in with .pointer-none */
  fieldset:disabled .pointer-none {
    pointer-events: none;
  }
  /* Finalize dialog "jump to issue" highlight, set on the field's FormItem for 2 s */
  [data-slot="form-item"][data-highlight="true"] {
    outline: 3px solid var(--color-amber-400);
    outline-offset: 6px;
    border-radius: var(--radius-md);
    transition: outline-color 300ms ease-out;
  }
}
```

- [ ] **Step 4: Expose the field path on `FormItem`**

In `src/components/ui/form.tsx`, replace the `FormItem` function:

```tsx
function FormItem({ className, ...props }: React.ComponentProps<"div">) {
  const id = React.useId();

  return (
    <FormItemContext.Provider value={{ id }}>
      <div data-slot="form-item" className={cn("grid gap-2", className)} {...props} />
    </FormItemContext.Provider>
  );
}
```

with:

```tsx
function FormItem({ className, ...props }: React.ComponentProps<"div">) {
  const id = React.useId();
  // Exposes the field path so the review page can scroll to / highlight a field
  const fieldContext = React.useContext(FormFieldContext);

  return (
    <FormItemContext.Provider value={{ id }}>
      <div
        data-slot="form-item"
        data-field-path={fieldContext.name}
        className={cn("grid gap-2", className)}
        {...props}
      />
    </FormItemContext.Provider>
  );
}
```

(`FormFieldContext` defaults to `{}` cast, so `fieldContext.name` is `undefined` outside a `FormField` and React omits the attribute.) If prefill Phase 1 has already modified `FormItem` (suggestion chip), keep those changes and only add the `fieldContext` line and the attribute.

- [ ] **Step 5: Gate `PhotoCapture`, `VideoUpload`, `AiCommentButton`**

`src/components/inspection/photo-capture.tsx` — change the props interface and signature:

```tsx
interface PhotoCaptureProps {
  inspectionId: string;
  section: string;
  onUploadComplete: (media: MediaRecord) => void;
  /** Completed/sent inspections: render nothing (no upload, no drop zone) */
  readOnly?: boolean;
}

export function PhotoCapture({ inspectionId, section, onUploadComplete, readOnly }: PhotoCaptureProps) {
```

and insert `if (readOnly) return null;` on its own line immediately before the component's `return (` (after the `handleDrop` `useCallback` — hooks must all run first).

`src/components/inspection/video-upload.tsx` — same pattern:

```tsx
interface VideoUploadProps {
  inspectionId: string;
  onUploadComplete: (media: MediaRecord) => void;
  /** Completed/sent inspections: render nothing */
  readOnly?: boolean;
}
```

```tsx
export function VideoUpload({ inspectionId, onUploadComplete, readOnly }: VideoUploadProps) {
```

and insert `if (readOnly) return null;` immediately before `return (` (after the `labelText` line).

`src/components/inspection/ai-comment-button.tsx`:

```tsx
interface AiCommentButtonProps {
  inspectionId: string;
  section: CommentSection;
  fieldPath: "septicTank.septicTankComments" | "disposalWorks.disposalWorksComments";
  buildContext: () => SepticTankContext | DisposalWorksContext;
  /** Completed/sent inspections: render nothing */
  readOnly?: boolean;
}

export function AiCommentButton({ inspectionId, section, fieldPath, buildContext, readOnly }: AiCommentButtonProps) {
```

and insert `if (readOnly) return null;` immediately before `return (` (after the `handleGenerate` `useCallback`).

- [ ] **Step 6: Add `readOnly` to the six steps**

Apply the same four edits to each step file. Exact current text is quoted so you can search for it.

**(a) Props interface + signature** — add the prop and default:

| File | Replace | With |
|---|---|---|
| `step-facility-info.tsx` | `interface StepFacilityInfoProps {\n  inspectionId: string;\n}` / `export function StepFacilityInfo({ inspectionId }: StepFacilityInfoProps) {` | `interface StepFacilityInfoProps {\n  inspectionId: string;\n  /** Review page, completed/sent: disables every control and hides upload/AI actions */\n  readOnly?: boolean;\n}` / `export function StepFacilityInfo({ inspectionId, readOnly = false }: StepFacilityInfoProps) {` |
| `step-general-treatment.tsx` | `interface StepGeneralTreatmentProps {\n  inspectionId: string;\n}` / `export function StepGeneralTreatment({ inspectionId }: StepGeneralTreatmentProps) {` | same shape with `readOnly?: boolean;` and `{ inspectionId, readOnly = false }` |
| `step-design-flow.tsx` | `interface StepDesignFlowProps {\n  inspectionId: string;\n}` / `export function StepDesignFlow({ inspectionId }: StepDesignFlowProps) {` | same |
| `step-septic-tank.tsx` | `interface StepSepticTankProps {\n  inspectionId: string;\n}` / `export function StepSepticTank({ inspectionId }: StepSepticTankProps) {` | same |
| `step-disposal-works.tsx` | `interface StepDisposalWorksProps {\n  inspectionId: string;\n}` / `export function StepDisposalWorks({ inspectionId }: StepDisposalWorksProps) {` | same |
| `step-alternative-system.tsx` | `interface StepAlternativeSystemProps {\n  inspectionId: string;\n}` / `export function StepAlternativeSystem({ inspectionId: _inspectionId }: StepAlternativeSystemProps) {` | same, keeping the `_inspectionId` rename: `{ inspectionId: _inspectionId, readOnly = false }` |

**(b) Root element** — the first line after the component's `return (`:

- five files: `<div className="space-y-8">` → `<fieldset disabled={readOnly} className="min-w-0 space-y-8">`
- `step-alternative-system.tsx`: `<div className="space-y-6">` → `<fieldset disabled={readOnly} className="min-w-0 space-y-6">`

**(c) Closing tag** — the final `</div>` of the component (the line right before the closing `  );` and `}` at the end of the file) → `</fieldset>`.

**(d) Pass `readOnly` to the gated children** — add `readOnly={readOnly}` as the last prop of every `<PhotoCapture …>`, `<VideoUpload …>` and `<AiCommentButton …>` element inside the step:

- `step-facility-info.tsx`: 1 `PhotoCapture`
- `step-general-treatment.tsx`: 1 `PhotoCapture`
- `step-design-flow.tsx`: 1 `PhotoCapture`
- `step-septic-tank.tsx`: 1 `AiCommentButton` (in the Inspector Comments section) + 1 `PhotoCapture`
- `step-disposal-works.tsx`: 1 `AiCommentButton` (Inspector Summary section) + 1 `PhotoCapture` + 1 `VideoUpload`
- `step-alternative-system.tsx`: none

Example (`step-design-flow.tsx`, the complete new tail):

```tsx
        <PhotoCapture
          inspectionId={inspectionId}
          section={SECTION_NAME}
          onUploadComplete={(newMedia) => setMedia((prev) => [...prev, newMedia])}
          readOnly={readOnly}
        />
      </div>
    </fieldset>
  );
}
```

Sanity check that every step got the wrapper:

Run: `grep -c "<fieldset disabled={readOnly}" src/components/inspection/step-*.tsx && grep -c "</fieldset>" src/components/inspection/step-*.tsx && grep -c "readOnly={readOnly}" src/components/inspection/step-*.tsx`
Expected: each of the six files reports `1` for the first two greps; the third reports `1,1,1,2,3,0` for facility-info, general-treatment, design-flow, septic-tank, disposal-works, alternative-system respectively.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/components/inspection/__tests__/step-read-only.test.tsx src/components/ui/__tests__/form-item.test.tsx src/components/inspection`
Expected: PASS — 6 new tests plus all existing `components/inspection` tests.

The wizard passes no `readOnly`, so the tech experience is unchanged; confirm the wizard test files in that run are still green (they are part of the directory run above).

- [ ] **Step 8: Commit**

```bash
git add src/app/globals.css src/components/ui/form.tsx src/components/ui/__tests__/form-item.test.tsx \
  src/components/inspection/photo-capture.tsx src/components/inspection/video-upload.tsx \
  src/components/inspection/ai-comment-button.tsx src/components/inspection/step-*.tsx \
  src/components/inspection/__tests__/step-read-only.test.tsx
git commit -m "feat(inspection): readOnly prop on wizard steps (fieldset disabled) + upload/AI gating"
```

---
### Task 5: `ReviewSection` controlled + `pill`, and `review-pill.tsx`

**Files:**
- Modify: `src/components/review/review-section.tsx` (whole file replaced)
- Create: `src/components/review/review-pill.tsx`
- Test: `src/components/review/__tests__/review-section.test.tsx` (append), `src/components/review/__tests__/review-pill.test.tsx`

**Interfaces:**
- Consumes: `StepValidation`, `StepValidationResult`, `validateSteps` (Task 2)
- Produces (used by Task 10):
  - `ReviewSection({ title, defaultOpen?, open?, onOpenChange?, pill?: ReactNode, children })` — controlled when `open !== undefined`, otherwise the existing uncontrolled behaviour
  - `type PillKind = "complete" | "empty" | "issues" | "excluded"`; `pillKind(result: StepValidation | null): PillKind`
  - `ReviewPill({ result: StepValidation | null })` — `null` renders `Not included`; the badge carries `data-pill="<kind>"`
  - `useStepValidations(control: Control<InspectionFormData>, debounceMs = 300): StepValidationResult`

- [ ] **Step 1: Write the failing tests**

Append to `src/components/review/__tests__/review-section.test.tsx` (after the existing `describe("ReviewSection", …)` block; add `import { vi } from "vitest"` to the existing vitest import if `vi` is not already imported — it is: `import { describe, expect, it, vi } from "vitest";`):

```tsx
describe("ReviewSection (controlled + pill)", () => {
  it("renders the pill in the header", () => {
    render(
      <ReviewSection title="Septic Tank" pill={<span data-testid="pill">2 issues</span>}>
        <p>Body</p>
      </ReviewSection>,
    );
    expect(screen.getByTestId("pill")).toBeInTheDocument();
  });

  it("follows the controlled `open` prop and reports changes via onOpenChange", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <ReviewSection title="Controlled" open={false} onOpenChange={onOpenChange}>
        <p>Controlled body</p>
      </ReviewSection>,
    );
    expect(screen.queryByText("Controlled body")).not.toBeInTheDocument();

    await user.click(screen.getByText("Controlled"));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    // Still closed: the parent owns the state
    expect(screen.queryByText("Controlled body")).not.toBeInTheDocument();

    rerender(
      <ReviewSection title="Controlled" open={true} onOpenChange={onOpenChange}>
        <p>Controlled body</p>
      </ReviewSection>,
    );
    expect(screen.getByText("Controlled body")).toBeVisible();
  });

  it("stays uncontrolled when `open` is omitted", async () => {
    const user = userEvent.setup();
    render(
      <ReviewSection title="Uncontrolled">
        <p>Uncontrolled body</p>
      </ReviewSection>,
    );
    await user.click(screen.getByText("Uncontrolled"));
    expect(screen.getByText("Uncontrolled body")).toBeVisible();
  });
});
```

Create `src/components/review/__tests__/review-pill.test.tsx`:

```tsx
import { act, render, renderHook, screen } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pillKind, ReviewPill, useStepValidations } from "@/components/review/review-pill";
import { getDefaultFormValues } from "@/lib/validators/inspection";
import type { InspectionFormData } from "@/types/inspection";

describe("pillKind", () => {
  it("maps validation results to pill kinds", () => {
    expect(pillKind(null)).toBe("excluded");
    expect(pillKind({ errors: [{ path: "a.b", message: "x" }], emptyCount: 0 })).toBe("issues");
    expect(pillKind({ errors: [{ path: "a.b", message: "x" }], emptyCount: 3 })).toBe("issues");
    expect(pillKind({ errors: [], emptyCount: 3 })).toBe("empty");
    expect(pillKind({ errors: [], emptyCount: 0 })).toBe("complete");
  });
});

describe("ReviewPill", () => {
  it("renders complete / N empty / N issues / Not included", () => {
    const { rerender } = render(<ReviewPill result={{ errors: [], emptyCount: 0 }} />);
    expect(screen.getByText("complete")).toHaveAttribute("data-pill", "complete");

    rerender(<ReviewPill result={{ errors: [], emptyCount: 4 }} />);
    expect(screen.getByText("4 empty")).toHaveAttribute("data-pill", "empty");

    rerender(<ReviewPill result={{ errors: [{ path: "a", message: "m" }], emptyCount: 4 }} />);
    expect(screen.getByText("1 issue")).toHaveAttribute("data-pill", "issues");

    rerender(
      <ReviewPill
        result={{ errors: [{ path: "a", message: "m" }, { path: "b", message: "m" }], emptyCount: 0 }}
      />,
    );
    expect(screen.getByText("2 issues")).toBeInTheDocument();

    rerender(<ReviewPill result={null} />);
    expect(screen.getByText("Not included")).toHaveAttribute("data-pill", "excluded");
  });
});

describe("useStepValidations", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("computes synchronously on mount and recomputes 300 ms after a change", () => {
    const { result } = renderHook(() => {
      const form = useForm<InspectionFormData>({ defaultValues: getDefaultFormValues("") });
      const validations = useStepValidations(form.control);
      return { form, validations };
    });

    // Fresh defaults: facilityName + inspectorName missing → 2 issues in step 0
    expect(result.current.validations[0].errors).toHaveLength(2);

    act(() => {
      result.current.form.setValue("facilityInfo.facilityName", "Smith Residence");
      result.current.form.setValue("facilityInfo.inspectorName", "Dan");
    });
    // Debounced: unchanged until the timer fires
    expect(result.current.validations[0].errors).toHaveLength(2);

    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(result.current.validations[0].errors).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/review/__tests__/review-section.test.tsx src/components/review/__tests__/review-pill.test.tsx`
Expected: FAIL — review-pill import unresolved; the controlled test fails because the section opens itself (uncontrolled) and the pill is not rendered.

- [ ] **Step 3: Replace `review-section.tsx`**

```tsx
"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface ReviewSectionProps {
  title: string;
  /** Uncontrolled initial state (ignored when `open` is provided) */
  defaultOpen?: boolean;
  /** Controlled open state — the review shell drives this for jump-to-field */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Status pill rendered at the right of the header (see review-pill.tsx) */
  pill?: React.ReactNode;
  children: React.ReactNode;
}

export function ReviewSection({
  title,
  defaultOpen = false,
  open,
  onOpenChange,
  pill,
  children,
}: ReviewSectionProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;

  const handleOpenChange = (next: boolean) => {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  };

  return (
    <Collapsible open={isOpen} onOpenChange={handleOpenChange}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer select-none transition-colors hover:bg-accent/50">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base">{title}</CardTitle>
              <div className="flex items-center gap-3">
                {pill}
                {isOpen ? (
                  <ChevronDown className="size-5 text-muted-foreground transition-transform" />
                ) : (
                  <ChevronRight className="size-5 text-muted-foreground transition-transform" />
                )}
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0">{children}</CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
```

- [ ] **Step 4: Create `review-pill.tsx`**

```tsx
"use client";

import { AlertTriangle, Check } from "lucide-react";
import { useEffect, useState } from "react";
import { type Control, useWatch } from "react-hook-form";
import { Badge } from "@/components/ui/badge";
import {
  type StepValidation,
  type StepValidationResult,
  validateSteps,
} from "@/lib/validators/step-validation";
import type { InspectionFormData } from "@/types/inspection";

export type PillKind = "complete" | "empty" | "issues" | "excluded";

/** Pure: which pill a step's validation result maps to */
export function pillKind(result: StepValidation | null): PillKind {
  if (result === null) return "excluded";
  if (result.errors.length > 0) return "issues";
  if (result.emptyCount > 0) return "empty";
  return "complete";
}

interface ReviewPillProps {
  /** `null` renders the neutral "Not included" pill (alt-system pages switched off) */
  result: StepValidation | null;
}

/** Section-header status pill: ✓ complete (green) · N empty (grey) · ⚠ N issues (amber) */
export function ReviewPill({ result }: ReviewPillProps) {
  const kind = pillKind(result);
  if (kind === "excluded") {
    return (
      <Badge variant="outline" className="font-normal text-muted-foreground" data-pill="excluded">
        Not included
      </Badge>
    );
  }
  if (kind === "issues") {
    const n = result!.errors.length;
    return (
      <Badge
        className="bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
        data-pill="issues"
      >
        <AlertTriangle />
        {n} {n === 1 ? "issue" : "issues"}
      </Badge>
    );
  }
  if (kind === "empty") {
    return (
      <Badge variant="secondary" className="font-normal" data-pill="empty">
        {result!.emptyCount} empty
      </Badge>
    );
  }
  return (
    <Badge
      className="bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200"
      data-pill="complete"
    >
      <Check />
      complete
    </Badge>
  );
}

/**
 * Watches the whole form and recomputes validateSteps() after `debounceMs` of
 * quiet. The first result is computed synchronously so pills never flash empty.
 */
export function useStepValidations(
  control: Control<InspectionFormData>,
  debounceMs = 300,
): StepValidationResult {
  const values = useWatch({ control });
  const [result, setResult] = useState<StepValidationResult>(() => validateSteps(values));

  useEffect(() => {
    const t = setTimeout(() => setResult(validateSteps(values)), debounceMs);
    return () => clearTimeout(t);
  }, [values, debounceMs]);

  return result;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/components/review/__tests__/review-section.test.tsx src/components/review/__tests__/review-pill.test.tsx`
Expected: PASS — 8 existing + 3 new section tests, 3 pill tests.

- [ ] **Step 6: Commit**

```bash
git add src/components/review/review-section.tsx src/components/review/review-pill.tsx \
  src/components/review/__tests__/review-section.test.tsx src/components/review/__tests__/review-pill.test.tsx
git commit -m "feat(review): controlled ReviewSection with status pill; useStepValidations"
```

---

### Task 6: Extract `PhotoSelection` and `ReportPreview` from the old editor

**Files:**
- Create: `src/components/review/photo-selection.tsx` (from old `review-editor.tsx` lines 71–122 state/handlers and 857–999 markup)
- Create: `src/components/review/report-preview.tsx` (from old lines 136–177 and 1010–1068)
- Test: `src/components/review/__tests__/photo-selection.test.tsx`, `src/components/review/__tests__/report-preview.test.tsx`

**Interfaces:**
- Consumes: `ReviewSection` (Task 5), `MediaRecord` (`@/components/inspection/media-gallery`), `usePdfGeneration`, `PdfPreview`
- Produces (used by Task 10):
  - `PhotoSelection({ inspectionId, media: MediaRecord[], selectedIds: Set<string>, onToggle(id), onSelectAll(), onDeselectAll(), onDescriptionSaved(id, description), readOnly })` — renders `null` without media
  - `ReportPreview({ inspectionId, status, form: UseFormReturn<InspectionFormData>, selectedMedia: MediaRecord[], readOnly })`

Git history note (spec §9): commit this extraction **before** the shell rewrite (Task 10) while the old editor is still intact, so `git log -C -C --follow` can trace the copied blocks back to `review-editor.tsx`. The markup is moved verbatim; only prop plumbing changes (the old `mediaItems`/`selectedMediaIds` state stays in the shell, the caption-edit state moves here).

- [ ] **Step 1: Write the failing tests**

Create `src/components/review/__tests__/photo-selection.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PhotoSelection } from "@/components/review/photo-selection";

const media = [
  { id: "p1", type: "photo" as const, storagePath: "a", label: "septic-tank", description: null, sortOrder: 0, createdAt: "2026-09-01T00:00:00.000Z", signedUrl: null },
  { id: "p2", type: "photo" as const, storagePath: "b", label: "facility-info", description: "Lid", sortOrder: 1, createdAt: "2026-09-01T00:00:00.000Z", signedUrl: null },
  { id: "v1", type: "video" as const, storagePath: "c", label: "video", description: null, sortOrder: 2, createdAt: "2026-09-01T00:00:00.000Z", signedUrl: null },
];

const baseProps = {
  inspectionId: "insp-1",
  media,
  selectedIds: new Set(["p1"]),
  onToggle: vi.fn(),
  onSelectAll: vi.fn(),
  onDeselectAll: vi.fn(),
  onDescriptionSaved: vi.fn(),
  readOnly: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});

describe("PhotoSelection", () => {
  it("shows the selected count, toggles photos and lists videos", async () => {
    const user = userEvent.setup();
    render(<PhotoSelection {...baseProps} />);

    expect(screen.getByText("Photos (1 of 2 selected for the report)")).toBeInTheDocument();
    expect(screen.getByText("video")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /include facility-info/i }));
    expect(baseProps.onToggle).toHaveBeenCalledWith("p2");

    await user.click(screen.getByRole("button", { name: /^select all$/i }));
    expect(baseProps.onSelectAll).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /deselect all/i }));
    expect(baseProps.onDeselectAll).toHaveBeenCalled();
  });

  it("edits a caption: PATCHes the media route and reports the saved description", async () => {
    const user = userEvent.setup();
    render(<PhotoSelection {...baseProps} />);

    await user.click(screen.getByRole("button", { name: "Lid" }));
    const input = screen.getByPlaceholderText("Add description…");
    await user.clear(input);
    await user.type(input, "Outlet lid{Enter}");

    await waitFor(() => expect(baseProps.onDescriptionSaved).toHaveBeenCalledWith("p2", "Outlet lid"));
    expect(fetch).toHaveBeenCalledWith("/api/inspections/insp-1/media", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mediaId: "p2", description: "Outlet lid" }),
    });
  });

  it("readOnly: hides Select/Deselect All and disables the photo buttons", () => {
    render(<PhotoSelection {...baseProps} readOnly />);
    expect(screen.queryByRole("button", { name: /^select all$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /exclude septic-tank/i })).toBeDisabled();
  });

  it("renders nothing without media", () => {
    const { container } = render(<PhotoSelection {...baseProps} media={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

Create `src/components/review/__tests__/report-preview.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReportPreview } from "@/components/review/report-preview";
import { getDefaultFormValues } from "@/lib/validators/inspection";
import type { InspectionFormData } from "@/types/inspection";

const generatePdf = vi.fn();
vi.mock("@/hooks/use-pdf-generation", () => ({
  usePdfGeneration: () => ({ generatePdf, pdfData: null, isGenerating: false, error: null, clearPdf: vi.fn() }),
}));

function Harness({ status, readOnly }: { status: string; readOnly: boolean }) {
  const form = useForm<InspectionFormData>({ defaultValues: getDefaultFormValues("Dan") });
  return (
    <ReportPreview inspectionId="insp-1" status={status} form={form} selectedMedia={[]} readOnly={readOnly} />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ReportPreview", () => {
  it("in review: offers Regenerate PDF and generates from the current form values", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const user = userEvent.setup();
    render(<Harness status="in_review" readOnly={false} />);

    expect(screen.getByText(/click "regenerate pdf" to preview/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /regenerate pdf/i }));
    expect(generatePdf).toHaveBeenCalledWith(
      expect.objectContaining({ facilityInfo: expect.objectContaining({ inspectorName: "Dan" }) }),
      null,
      [],
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("completed: loads the finalized PDF from the download route and shows it in an iframe", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ previewUrl: "https://x.test/preview.pdf", downloadUrl: "https://x.test/dl.pdf" }),
      }),
    );
    render(<Harness status="completed" readOnly />);

    expect(fetch).toHaveBeenCalledWith("/api/inspections/insp-1/download");
    await waitFor(() =>
      expect(screen.getByTitle("Finalized PDF")).toHaveAttribute("src", "https://x.test/preview.pdf"),
    );
    expect(screen.getByRole("link", { name: /download pdf/i })).toHaveAttribute("href", "https://x.test/dl.pdf");
    expect(screen.queryByRole("button", { name: /regenerate pdf/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/review/__tests__/photo-selection.test.tsx src/components/review/__tests__/report-preview.test.tsx`
Expected: FAIL — both imports unresolved.

- [ ] **Step 3: Create `photo-selection.tsx`**

```tsx
"use client";

import { ImageIcon, Video } from "lucide-react";
import { useCallback, useState } from "react";
import type { MediaRecord } from "@/components/inspection/media-gallery";
import { Button } from "@/components/ui/button";
import { ReviewSection } from "./review-section";

interface PhotoSelectionProps {
  inspectionId: string;
  media: MediaRecord[];
  /** Photo ids included in the report */
  selectedIds: Set<string>;
  onToggle: (mediaId: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  /** Called after a caption PATCH succeeds so the owner can update its media list */
  onDescriptionSaved: (mediaId: string, description: string) => void;
  readOnly: boolean;
}

/**
 * Select-for-report photo grid with inline caption editing, plus a read-only
 * video list. Extracted verbatim from the legacy review editor.
 */
export function PhotoSelection({
  inspectionId,
  media,
  selectedIds,
  onToggle,
  onSelectAll,
  onDeselectAll,
  onDescriptionSaved,
  readOnly,
}: PhotoSelectionProps) {
  const photos = media.filter((m) => m.type === "photo");
  const videos = media.filter((m) => m.type === "video");
  const [editingDescId, setEditingDescId] = useState<string | null>(null);
  const [descDraft, setDescDraft] = useState("");

  const saveDescription = useCallback(
    async (mediaId: string, newDesc: string) => {
      const trimmed = newDesc.trim();
      const item = media.find((m) => m.id === mediaId);
      if (trimmed === (item?.description ?? "")) {
        setEditingDescId(null);
        return;
      }
      try {
        const res = await fetch(`/api/inspections/${inspectionId}/media`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mediaId, description: trimmed }),
        });
        if (res.ok) {
          onDescriptionSaved(mediaId, trimmed);
        }
      } finally {
        setEditingDescId(null);
      }
    },
    [inspectionId, media, onDescriptionSaved],
  );

  if (photos.length === 0 && videos.length === 0) return null;

  return (
    <ReviewSection
      title={`Photos (${selectedIds.size} of ${photos.length} selected for the report)`}
      defaultOpen
    >
      <div className="space-y-4">
        {/* Photos */}
        {photos.length > 0 && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Photos</p>
              {!readOnly && (
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={onSelectAll}
                  >
                    Select All
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={onDeselectAll}
                  >
                    Deselect All
                  </Button>
                </div>
              )}
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
              {photos.map((photo, idx) => {
                const isSelected = selectedIds.has(photo.id);
                const isEditingThis = editingDescId === photo.id;
                return (
                  <div
                    key={photo.id}
                    className={`relative rounded-lg border overflow-hidden text-left transition-all ${
                      isSelected ? "ring-2 ring-primary border-primary" : "opacity-50 border-muted"
                    }`}
                  >
                    <button
                      type="button"
                      disabled={readOnly}
                      aria-pressed={isSelected}
                      aria-label={`${isSelected ? "Exclude" : "Include"} ${photo.label ?? `photo ${idx + 1}`}`}
                      className={`w-full ${!readOnly ? "cursor-pointer hover:opacity-80" : ""}`}
                      onClick={() => onToggle(photo.id)}
                    >
                      {photo.signedUrl ? (
                        <img
                          src={photo.signedUrl}
                          alt={photo.label ?? `Photo ${idx + 1}`}
                          className="aspect-square w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex aspect-square w-full items-center justify-center bg-muted">
                          <ImageIcon className="size-6 text-muted-foreground" />
                        </div>
                      )}
                      <div className="absolute left-1.5 top-1.5">
                        <div
                          className={`flex size-5 items-center justify-center rounded border text-[10px] font-bold ${
                            isSelected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-muted-foreground/50 bg-background/80 text-muted-foreground"
                          }`}
                        >
                          {isSelected ? "✓" : ""}
                        </div>
                      </div>
                    </button>
                    {isEditingThis && !readOnly ? (
                      <input
                        type="text"
                        autoFocus
                        value={descDraft}
                        onChange={(e) => setDescDraft(e.target.value)}
                        onBlur={() => saveDescription(photo.id, descDraft)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            saveDescription(photo.id, descDraft);
                          } else if (e.key === "Escape") {
                            setEditingDescId(null);
                          }
                        }}
                        className="w-full border-t bg-background px-1.5 py-1 text-[10px] outline-none focus:ring-1 focus:ring-ring"
                        placeholder="Add description…"
                      />
                    ) : (
                      <button
                        type="button"
                        disabled={readOnly}
                        className="w-full truncate px-1.5 py-1 text-left text-[10px] text-muted-foreground hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDescDraft(photo.description ?? "");
                          setEditingDescId(photo.id);
                        }}
                      >
                        {photo.description || "Add description…"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Videos */}
        {videos.length > 0 && (
          <>
            <p className="text-xs font-semibold uppercase text-muted-foreground">Videos</p>
            <div className="space-y-1">
              {videos.map((video) => (
                <div key={video.id} className="flex items-center gap-2 rounded-md border px-3 py-2">
                  <Video className="size-4 text-muted-foreground" />
                  <span className="text-sm">{video.label || "Video"}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {new Date(video.createdAt).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </ReviewSection>
  );
}
```

- [ ] **Step 4: Create `report-preview.tsx`**

```tsx
"use client";

import { Download, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { type UseFormReturn, useWatch } from "react-hook-form";
import type { MediaRecord } from "@/components/inspection/media-gallery";
import { PdfPreview } from "@/components/inspection/pdf-preview";
import { Button } from "@/components/ui/button";
import { usePdfGeneration } from "@/hooks/use-pdf-generation";
import type { InspectionFormData } from "@/types/inspection";
import { ReviewSection } from "./review-section";

interface ReportPreviewProps {
  inspectionId: string;
  status: string;
  form: UseFormReturn<InspectionFormData>;
  /** Photos currently selected for the report (drives client-side regeneration) */
  selectedMedia: MediaRecord[];
  readOnly: boolean;
}

/**
 * Client-side "Regenerate PDF" preview while in review; the exact server-generated
 * PDF once the inspection is completed/sent. Extracted from the legacy review editor.
 */
export function ReportPreview({ inspectionId, status, form, selectedMedia, readOnly }: ReportPreviewProps) {
  const facilityName = useWatch({ control: form.control, name: "facilityInfo.facilityName" });
  const values = useWatch({ control: form.control });
  const { generatePdf, pdfData, isGenerating, error, clearPdf } = usePdfGeneration();

  // Snapshot of the form + selection the preview was generated from, to flag staleness
  const generatedFromRef = useRef<string | null>(null);
  const currentSnapshot = JSON.stringify({ values, ids: selectedMedia.map((m) => m.id) });
  const isStale = generatedFromRef.current !== null && generatedFromRef.current !== currentSnapshot;

  // Finalized PDF state — for showing the exact server-generated PDF
  const [finalizedPdfUrl, setFinalizedPdfUrl] = useState<string | null>(null);
  const [finalizedDownloadUrl, setFinalizedDownloadUrl] = useState<string | null>(null);
  const [loadingFinalizedPdf, setLoadingFinalizedPdf] = useState(false);

  const fetchFinalizedPdf = useCallback(async () => {
    setLoadingFinalizedPdf(true);
    try {
      const res = await fetch(`/api/inspections/${inspectionId}/download`);
      if (res.ok) {
        const data = await res.json();
        setFinalizedPdfUrl(data.previewUrl ?? data.downloadUrl);
        setFinalizedDownloadUrl(data.downloadUrl);
      }
    } catch (err) {
      console.error("Failed to fetch finalized PDF:", err);
    } finally {
      setLoadingFinalizedPdf(false);
    }
  }, [inspectionId]);

  const isFinalized = status === "completed" || status === "sent";

  // Load the finalized PDF whenever the inspection becomes completed/sent; drop it on reopen
  useEffect(() => {
    if (isFinalized) {
      fetchFinalizedPdf();
    } else {
      setFinalizedPdfUrl(null);
      setFinalizedDownloadUrl(null);
    }
  }, [isFinalized, fetchFinalizedPdf]);

  const handleRegenerate = useCallback(async () => {
    clearPdf();
    const formData = form.getValues();
    const signatureDataUrl = formData.disposalWorks?.signatureDataUrl ?? null;
    generatedFromRef.current = JSON.stringify({
      values: formData,
      ids: selectedMedia.map((m) => m.id),
    });
    await generatePdf(formData, signatureDataUrl, selectedMedia);
  }, [form, selectedMedia, generatePdf, clearPdf]);

  return (
    <ReviewSection title="Report Preview" defaultOpen>
      <div className="space-y-4">
        {!readOnly && (
          <Button onClick={handleRegenerate} disabled={isGenerating} className="w-full">
            {isGenerating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Regenerate PDF
          </Button>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        {isStale && !readOnly && pdfData && (
          <p className="text-xs text-amber-600">
            Form data changed -- click &quot;Regenerate PDF&quot; to see updates
          </p>
        )}

        {isFinalized && finalizedPdfUrl ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Finalized Report</h3>
              <Button variant="outline" size="sm" asChild>
                <a
                  href={finalizedDownloadUrl ?? finalizedPdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Download className="size-4" />
                  Download PDF
                </a>
              </Button>
            </div>
            <iframe
              src={finalizedPdfUrl}
              className="h-[80vh] w-full rounded-lg border"
              title="Finalized PDF"
            />
          </div>
        ) : isFinalized && loadingFinalizedPdf ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="size-8 mb-2 animate-spin opacity-30" />
            <p className="text-sm">Loading finalized report...</p>
          </div>
        ) : pdfData ? (
          <PdfPreview pdfData={pdfData} facilityName={facilityName || undefined} />
        ) : !readOnly ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <RefreshCw className="size-8 mb-2 opacity-30" />
            <p className="text-sm">Click &quot;Regenerate PDF&quot; to preview</p>
          </div>
        ) : null}
      </div>
    </ReviewSection>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/components/review/__tests__/photo-selection.test.tsx src/components/review/__tests__/report-preview.test.tsx`
Expected: PASS — 4 + 2 tests.

- [ ] **Step 6: Commit (old editor untouched — copy detection)**

```bash
git add src/components/review/photo-selection.tsx src/components/review/report-preview.tsx \
  src/components/review/__tests__/photo-selection.test.tsx src/components/review/__tests__/report-preview.test.tsx
git commit -m "refactor(review): extract PhotoSelection and ReportPreview from the review editor"
```

---
### Task 7: `PATCH /api/inspections/[id]/review-notes`

**Files:**
- Create: `src/app/api/inspections/[id]/review-notes/route.ts`
- Test: `src/app/api/inspections/[id]/review-notes/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `createClient` (`@/lib/supabase/server`), `db`, `inspections`, `and`/`eq`/`sql` from `drizzle-orm`
- Produces: `PATCH` handler — body `{ append: string }` (trimmed, 1–2000 chars) → `200 { appended: true }`; `401` unauthenticated; `403 { error: "Forbidden: admin only" }` for non-admin; `400` bad body; `409` when the inspection is not `in_review`. The line is appended with `concat_ws(chr(10), review_notes, $append)` so a `NULL` `review_notes` gets no leading newline.

- [ ] **Step 1: Write the failing test**

Create `src/app/api/inspections/[id]/review-notes/__tests__/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const { mockGetUser, mockGetSession, mockCreateClient, mockDbUpdate, mockSet } = vi.hoisted(() => {
  const mockGetUser = vi.fn();
  const mockGetSession = vi.fn();
  const mockDbUpdate = vi.fn();
  const mockSet = vi.fn();
  const mockCreateClient = vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
  });
  return { mockGetUser, mockGetSession, mockCreateClient, mockDbUpdate, mockSet };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));

vi.mock("@/lib/db", () => {
  const updateChain = {
    set: vi.fn((values: unknown) => {
      mockSet(values);
      return updateChain;
    }),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn(() => mockDbUpdate()),
  };
  return { db: { update: vi.fn(() => updateChain) } };
});

vi.mock("@/lib/db/schema", () => ({
  inspections: { id: "id", status: "status", reviewNotes: "review_notes" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ _col, val })),
  and: vi.fn((...args: unknown[]) => args),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings: [...strings], values })),
}));

// ---------------------------------------------------------------------------
// Import handler
// ---------------------------------------------------------------------------
import { PATCH } from "../route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fakeAccessToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64");
  return `${header}.${body}.fakesig`;
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeRequest(body?: unknown): Request {
  return new Request("http://localhost/api/inspections/insp-1/review-notes", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? "not json" : JSON.stringify(body),
  });
}

const USER = { id: "admin-1" };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: USER } });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: fakeAccessToken({ user_role: "admin" }) } },
  });
  mockDbUpdate.mockResolvedValue([{ id: "insp-1" }]);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("PATCH /api/inspections/[id]/review-notes", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const res = await PATCH(makeRequest({ append: "x" }), makeParams("insp-1"));
    expect(res.status).toBe(401);
  });

  it("returns 403 for field_tech and office_staff", async () => {
    for (const role of ["field_tech", "office_staff"]) {
      mockGetSession.mockResolvedValueOnce({
        data: { session: { access_token: fakeAccessToken({ user_role: role }) } },
      });
      const res = await PATCH(makeRequest({ append: "x" }), makeParams("insp-1"));
      expect(res.status).toBe(403);
      expect((await res.json()).error).toContain("admin only");
    }
  });

  it("returns 400 when append is missing, blank, too long, or the body is not JSON", async () => {
    expect((await PATCH(makeRequest({}), makeParams("insp-1"))).status).toBe(400);
    expect((await PATCH(makeRequest({ append: "   " }), makeParams("insp-1"))).status).toBe(400);
    expect((await PATCH(makeRequest({ append: "x".repeat(2001) }), makeParams("insp-1"))).status).toBe(400);
    expect((await PATCH(makeRequest(), makeParams("insp-1"))).status).toBe(400);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("appends the trimmed line with concat_ws and returns { appended: true }", async () => {
    const res = await PATCH(
      makeRequest({ append: "  Finalized with 1 validation issue: Facility Name  " }),
      makeParams("insp-1"),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ appended: true });
    const setArg = mockSet.mock.calls[0][0] as { reviewNotes: { strings: string[]; values: unknown[] } };
    expect(setArg.reviewNotes.strings.join("?")).toBe("concat_ws(chr(10), ?, ?)");
    expect(setArg.reviewNotes.values).toEqual([
      "review_notes",
      "Finalized with 1 validation issue: Facility Name",
    ]);
  });

  it("returns 409 when the inspection is not in_review", async () => {
    mockDbUpdate.mockResolvedValueOnce([]);
    const res = await PATCH(makeRequest({ append: "x" }), makeParams("insp-1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("not in review");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run "src/app/api/inspections/[id]/review-notes/__tests__/route.test.ts"`
Expected: FAIL — `Failed to resolve import "../route"`.

- [ ] **Step 3: Write the route**

Create `src/app/api/inspections/[id]/review-notes/route.ts`:

```ts
import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { inspections } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";

const MAX_APPEND_LENGTH = 2000;

/**
 * PATCH /api/inspections/[id]/review-notes
 * Appends one line to review_notes (used by "Finalize with issues").
 * Body: { append: string }
 * Allowed: admin only, and only while the inspection is in_review.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Admin-only check
  let userRole: string | null = null;
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session) {
      const payload = JSON.parse(
        Buffer.from(session.access_token.split(".")[1], "base64").toString(),
      );
      userRole = payload.user_role ?? null;
    }
  } catch {
    // Role decode failed
  }

  if (userRole !== "admin") {
    return NextResponse.json({ error: "Forbidden: admin only" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const append = typeof body?.append === "string" ? body.append.trim() : "";
  if (!append || append.length > MAX_APPEND_LENGTH) {
    return NextResponse.json(
      { error: `append must be a non-empty string of at most ${MAX_APPEND_LENGTH} characters` },
      { status: 400 },
    );
  }

  // concat_ws skips a NULL review_notes, so the first append has no leading newline
  const result = await db
    .update(inspections)
    .set({
      reviewNotes: sql`concat_ws(chr(10), ${inspections.reviewNotes}, ${append})`,
      updatedAt: new Date(),
    })
    .where(and(eq(inspections.id, id), eq(inspections.status, "in_review")))
    .returning({ id: inspections.id });

  if (result.length === 0) {
    return NextResponse.json(
      { error: "Cannot update review notes: inspection is not in review" },
      { status: 409 },
    );
  }

  return NextResponse.json({ appended: true });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run "src/app/api/inspections/[id]/review-notes/__tests__/route.test.ts"`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/inspections/[id]/review-notes"
git commit -m "feat(api): admin-only PATCH review-notes append route"
```

---

### Task 8: `FinalizeDialog`

**Files:**
- Create: `src/components/review/finalize-dialog.tsx`
- Test: `src/components/review/__tests__/finalize-dialog.test.tsx`

**Interfaces:**
- Consumes: `allIssues`, `humanizeFieldPath`, `validateSteps`, `StepIssue` (Task 2); `STEP_LABELS`; shadcn `AlertDialog*`, `Button`; `toast` from `sonner`; the route from Task 7
- Produces (used by Task 9):

```ts
interface FinalizeDialogProps {
  inspectionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Flush pending autosave first; resolves false when the save failed (dialog closes with a toast) */
  flush: () => Promise<boolean>;
  /** Current form values; `null` skips validation (finalize is then always "clean") */
  getFormData: () => InspectionFormData | null;
  selectedMediaIds: string[];
  /** Expand the section and highlight the field; the dialog closes first */
  onJumpToField?: (path: string, stepIndex: number) => void;
  onFinalized: () => void;
}
export function FinalizeDialog(props: FinalizeDialogProps): JSX.Element;
```

Flow: `open` → `flush()` → (false → `toast.error`, close) → `validateSteps(getFormData())` → clean: title `Finalize Inspection Report?`, buttons **Cancel** / **Finalize**; issues: title `Finalize with validation issues?`, rows grouped `<STEP_LABEL> · N issue(s)` (click → `onOpenChange(false)` + `onJumpToField(path, step)`), buttons **Fix issues** / **Finalize with issues** (→ `PATCH …/review-notes { append: "Finalized with N validation issues: <Section › Field, …>" }` → `POST …/finalize { selectedMediaIds }`). Success: `toast.success("Inspection finalized successfully")`, close, `onFinalized()`.

- [ ] **Step 1: Write the failing test**

Create `src/components/review/__tests__/finalize-dialog.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { toast } from "sonner";
import { FinalizeDialog } from "@/components/review/finalize-dialog";
import { getDefaultFormValues } from "@/lib/validators/inspection";
import type { InspectionFormData } from "@/types/inspection";

// ── Helpers ────────────────────────────────────────────────────────────────────

function cleanForm(): InspectionFormData {
  const d = getDefaultFormValues("Dan Endres") as unknown as InspectionFormData;
  d.facilityInfo.facilityName = "Smith Residence";
  return d;
}

function formWithIssues() {
  const d = cleanForm();
  d.facilityInfo.facilityName = "";
  d.septicTank.tanks = [{ lidsRisersPresent: "sideways" } as never];
  return d;
}

/** fetch mock that records the order of calls as "METHOD url" */
function queuedFetch(calls: string[], responses: Record<string, { ok: boolean; body?: unknown }> = {}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    const r = responses[url] ?? { ok: true, body: {} };
    return { ok: r.ok, status: r.ok ? 200 : 500, statusText: "x", json: async () => r.body ?? {} };
  });
}

const baseProps = {
  inspectionId: "insp-1",
  open: true,
  onOpenChange: vi.fn(),
  selectedMediaIds: ["m1", "m2"],
  onFinalized: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("FinalizeDialog", () => {
  it("calls flush() before validating and shows the clean confirmation", async () => {
    const order: string[] = [];
    const flush = vi.fn(async () => {
      order.push("flush");
      return true;
    });
    const getFormData = vi.fn(() => {
      order.push("getFormData");
      return cleanForm();
    });
    render(<FinalizeDialog {...baseProps} flush={flush} getFormData={getFormData} />);

    expect(screen.getByText(/saving your changes/i)).toBeInTheDocument();
    await screen.findByText(/mark the inspection as completed/i);
    expect(order).toEqual(["flush", "getFormData"]);
    expect(screen.getByRole("button", { name: /^finalize$/i })).toBeEnabled();
    expect(screen.queryByText(/finalize with issues/i)).not.toBeInTheDocument();
  });

  it("closes with an error toast when flush() fails", async () => {
    const onOpenChange = vi.fn();
    render(
      <FinalizeDialog
        {...baseProps}
        onOpenChange={onOpenChange}
        flush={async () => false}
        getFormData={cleanForm}
      />,
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/couldn't save/i));
  });

  it("clean path: POSTs finalize with selectedMediaIds and skips the issue list", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", queuedFetch(calls));
    const onFinalized = vi.fn();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      <FinalizeDialog
        {...baseProps}
        onOpenChange={onOpenChange}
        onFinalized={onFinalized}
        flush={async () => true}
        getFormData={cleanForm}
      />,
    );

    await user.click(await screen.findByRole("button", { name: /^finalize$/i }));

    await waitFor(() => expect(onFinalized).toHaveBeenCalled());
    expect(calls).toEqual(["POST /api/inspections/insp-1/finalize"]);
    expect(vi.mocked(fetch).mock.calls[0][1]).toEqual(
      expect.objectContaining({ body: JSON.stringify({ selectedMediaIds: ["m1", "m2"] }) }),
    );
    expect(toast.success).toHaveBeenCalledWith("Inspection finalized successfully");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("lists issues grouped by section with jump-to rows", async () => {
    const onJumpToField = vi.fn();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      <FinalizeDialog
        {...baseProps}
        onOpenChange={onOpenChange}
        onJumpToField={onJumpToField}
        flush={async () => true}
        getFormData={formWithIssues}
      />,
    );

    expect(await screen.findByText("Finalize with validation issues?")).toBeInTheDocument();
    expect(screen.getByText("Facility Info · 1 issue")).toBeInTheDocument();
    expect(screen.getByText("Septic Tank · 1 issue")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /fix issues/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /tank 1 · lids risers present/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onJumpToField).toHaveBeenCalledWith("septicTank.tanks.0.lidsRisersPresent", 3);
  });

  it("Finalize with issues PATCHes review_notes, then POSTs finalize", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", queuedFetch(calls));
    const onFinalized = vi.fn();
    const user = userEvent.setup();
    render(
      <FinalizeDialog
        {...baseProps}
        onFinalized={onFinalized}
        flush={async () => true}
        getFormData={formWithIssues}
      />,
    );

    await user.click(await screen.findByRole("button", { name: /finalize with issues/i }));

    await waitFor(() => expect(onFinalized).toHaveBeenCalled());
    expect(calls).toEqual([
      "PATCH /api/inspections/insp-1/review-notes",
      "POST /api/inspections/insp-1/finalize",
    ]);
    const notesBody = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(notesBody.append).toBe(
      "Finalized with 2 validation issues: Facility Info › Facility Name, Septic Tank › Tank 1 · Lids Risers Present",
    );
  });

  it("stays open with an error toast when the review-notes PATCH fails", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      queuedFetch(calls, {
        "/api/inspections/insp-1/review-notes": { ok: false, body: { error: "Forbidden: admin only" } },
      }),
    );
    const onFinalized = vi.fn();
    const user = userEvent.setup();
    render(
      <FinalizeDialog
        {...baseProps}
        onFinalized={onFinalized}
        flush={async () => true}
        getFormData={formWithIssues}
      />,
    );

    await user.click(await screen.findByRole("button", { name: /finalize with issues/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Forbidden: admin only"));
    expect(calls).toEqual(["PATCH /api/inspections/insp-1/review-notes"]);
    expect(onFinalized).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /finalize with issues/i })).toBeEnabled();
  });

  it("renders nothing when closed", () => {
    render(<FinalizeDialog {...baseProps} open={false} flush={async () => true} getFormData={cleanForm} />);
    expect(screen.queryByText(/finalize inspection report/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/review/__tests__/finalize-dialog.test.tsx`
Expected: FAIL — import unresolved.

- [ ] **Step 3: Create `finalize-dialog.tsx`**

```tsx
"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { STEP_LABELS } from "@/lib/constants/inspection";
import {
  allIssues,
  humanizeFieldPath,
  type StepIssue,
  validateSteps,
} from "@/lib/validators/step-validation";
import type { InspectionFormData } from "@/types/inspection";

type Phase = "checking" | "clean" | "issues" | "submitting";

interface FinalizeDialogProps {
  inspectionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Flush pending autosave first; resolves false when the save failed (dialog closes with a toast) */
  flush: () => Promise<boolean>;
  /** Current form values; `null` skips validation (finalize is then always "clean") */
  getFormData: () => InspectionFormData | null;
  selectedMediaIds: string[];
  /** Expand the section and highlight the field; the dialog closes first */
  onJumpToField?: (path: string, stepIndex: number) => void;
  onFinalized: () => void;
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    return data.error || fallback;
  } catch {
    return `Server error (${res.status}): ${res.statusText}`;
  }
}

/** Groups issues by step, preserving step order */
function groupByStep(issues: Array<StepIssue & { step: number }>) {
  const groups = new Map<number, Array<StepIssue & { step: number }>>();
  for (const issue of issues) {
    const list = groups.get(issue.step) ?? [];
    list.push(issue);
    groups.set(issue.step, list);
  }
  return [...groups.entries()].map(([step, list]) => ({ step, issues: list }));
}

export function FinalizeDialog({
  inspectionId,
  open,
  onOpenChange,
  flush,
  getFormData,
  selectedMediaIds,
  onJumpToField,
  onFinalized,
}: FinalizeDialogProps) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [issues, setIssues] = useState<Array<StepIssue & { step: number }>>([]);
  // Set when the user clicked an issue row: Radix would otherwise return focus to
  // the Finalize button on close and steal it from the highlighted field.
  const jumpedRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    jumpedRef.current = false;
    setPhase("checking");
    setIssues([]);

    (async () => {
      const ok = await flush();
      if (cancelled) return;
      if (!ok) {
        toast.error("Couldn't save your latest changes — fix the save error, then finalize");
        onOpenChange(false);
        return;
      }
      const data = getFormData();
      const found = data ? allIssues(validateSteps(data)) : [];
      setIssues(found);
      setPhase(found.length > 0 ? "issues" : "clean");
    })();

    return () => {
      cancelled = true;
    };
  }, [open, flush, getFormData, onOpenChange]);

  const finalize = async (withIssues: boolean) => {
    setPhase("submitting");
    try {
      if (withIssues) {
        const list = issues
          .map((i) => `${STEP_LABELS[i.step]} › ${humanizeFieldPath(i.path)}`)
          .join(", ");
        const line = `Finalized with ${issues.length} validation ${
          issues.length === 1 ? "issue" : "issues"
        }: ${list}`;
        const notesRes = await fetch(`/api/inspections/${inspectionId}/review-notes`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ append: line }),
        });
        if (!notesRes.ok) {
          throw new Error(await errorMessage(notesRes, "Failed to record validation issues"));
        }
      }

      const res = await fetch(`/api/inspections/${inspectionId}/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedMediaIds }),
      });
      if (!res.ok) {
        throw new Error(await errorMessage(res, "Failed to finalize"));
      }

      toast.success("Inspection finalized successfully");
      onOpenChange(false);
      onFinalized();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to finalize inspection");
      setPhase(issues.length > 0 ? "issues" : "clean");
    }
  };

  const jump = (issue: StepIssue & { step: number }) => {
    jumpedRef.current = true;
    onOpenChange(false);
    onJumpToField?.(issue.path, issue.step);
  };

  const groups = groupByStep(issues);
  const busy = phase === "checking" || phase === "submitting";
  const showIssues = phase === "issues" || (phase === "submitting" && issues.length > 0);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        onCloseAutoFocus={(e) => {
          if (jumpedRef.current) e.preventDefault();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            {showIssues ? "Finalize with validation issues?" : "Finalize Inspection Report?"}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>
              {phase === "checking" && (
                <p className="flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" />
                  Saving your changes…
                </p>
              )}
              {!showIssues && phase !== "checking" && (
                <p>
                  This will mark the inspection as completed. The field tech will no longer be
                  able to edit it. You can reopen it later if needed.
                </p>
              )}
              {showIssues && (
                <div className="space-y-3">
                  <p>
                    The validators found {issues.length}{" "}
                    {issues.length === 1 ? "issue" : "issues"}. Click one to jump to the field, or
                    finalize anyway — the issues are recorded in the review notes.
                  </p>
                  <div className="max-h-64 space-y-3 overflow-y-auto pr-1">
                    {groups.map((g) => (
                      <div key={g.step}>
                        <p className="text-xs font-semibold uppercase text-muted-foreground">
                          {STEP_LABELS[g.step]} · {g.issues.length}{" "}
                          {g.issues.length === 1 ? "issue" : "issues"}
                        </p>
                        <ul className="mt-1 space-y-1">
                          {g.issues.map((issue) => (
                            <li key={issue.path}>
                              <button
                                type="button"
                                onClick={() => jump(issue)}
                                className="flex w-full items-start gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent"
                              >
                                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                                <span>
                                  <span className="font-medium">{humanizeFieldPath(issue.path)}</span>
                                  <span className="text-muted-foreground"> — {issue.message}</span>
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {showIssues ? (
            <>
              <AlertDialogCancel disabled={busy}>Fix issues</AlertDialogCancel>
              <Button
                onClick={() => finalize(true)}
                disabled={busy}
                className="bg-amber-600 hover:bg-amber-700"
              >
                {phase === "submitting" && <Loader2 className="size-4 animate-spin" />}
                Finalize with issues
              </Button>
            </>
          ) : (
            <>
              <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
              <Button onClick={() => finalize(false)} disabled={busy}>
                {phase === "submitting" && <Loader2 className="size-4 animate-spin" />}
                Finalize
              </Button>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/review/__tests__/finalize-dialog.test.tsx`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/review/finalize-dialog.tsx src/components/review/__tests__/finalize-dialog.test.tsx
git commit -m "feat(review): FinalizeDialog — flush, validate, jump-to-issue, finalize with issues"
```

---
### Task 9: `ReviewActions` — open `FinalizeDialog`, `flush()` before Return / Reopen

**Files:**
- Modify: `src/components/review/review-actions.tsx` (whole file replaced)
- Test: `src/components/review/__tests__/review-actions.test.tsx` (whole file replaced — this also re-baselines the three pre-existing failures that looked for `/send to customer/i` while the button reads "Send PDF to Customer")

**Interfaces:**
- Consumes: `FinalizeDialog` (Task 8), `ReturnDialog` (unchanged), `SendEmailDialog` (unchanged)
- Produces (used by Task 10): `ReviewActions` gains three optional props —
  `flush?: () => Promise<boolean>` (default resolves `true`), `getFormData?: () => InspectionFormData | null` (default `() => null`), `onJumpToField?: (path: string, stepIndex: number) => void`. Everything else (`inspectionId`, `status`, `facilityAddress`, `customerEmail`, `isFromWorkiz`, `selectedMediaIds`, `onStatusChange`) is unchanged.
  Behaviour: **Finalize Report** opens `FinalizeDialog` (`onFinalized` → `onStatusChange("completed")` + `router.refresh()`); **Return to Tech** awaits `flush()` before opening `ReturnDialog` (false → `toast.error`, stays); **Reopen** awaits `flush()` before `POST …/reopen`. Buttons show a spinner and are disabled while a flush is in flight.

- [ ] **Step 1: Replace the test file**

Replace `src/components/review/__tests__/review-actions.test.tsx` with:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockPush = vi.fn();
const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock the child dialogs to simplify tests
vi.mock("@/components/review/return-dialog", () => ({
  ReturnDialog: ({ open, onOpenChange, onReturned }: any) =>
    open ? (
      <div data-testid="return-dialog">
        <button onClick={() => { onReturned(); onOpenChange(false); }}>
          Mock Return
        </button>
      </div>
    ) : null,
}));

const finalizeDialogProps = vi.fn();
vi.mock("@/components/review/finalize-dialog", () => ({
  FinalizeDialog: (props: any) => {
    finalizeDialogProps(props);
    return props.open ? (
      <div data-testid="finalize-dialog">
        <button onClick={() => { props.onOpenChange(false); props.onFinalized(); }}>
          Mock Finalize
        </button>
      </div>
    ) : null;
  },
}));

vi.mock("@/components/dashboard/send-email-dialog", () => ({
  SendEmailDialog: ({ open }: any) =>
    open ? <div data-testid="send-email-dialog">Email Dialog</div> : null,
}));

import { toast } from "sonner";
import { ReviewActions } from "@/components/review/review-actions";

// ── Helpers ────────────────────────────────────────────────────────────────────

const defaultProps = {
  inspectionId: "insp-1",
  status: "in_review",
  onStatusChange: vi.fn(),
};

/** fetch mock that records "METHOD url" into `calls` so ordering can be asserted */
function recordingFetch(calls: string[], ok = true, body: unknown = {}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    return { ok, status: ok ? 200 : 500, statusText: "x", json: async () => body };
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.restoreAllMocks();
  mockPush.mockClear();
  mockRefresh.mockClear();
  finalizeDialogProps.mockClear();
  // Silence the recommendations prefetch that runs on mount
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
});

describe("ReviewActions", () => {
  describe("status badge", () => {
    it("renders In Review badge for in_review status", () => {
      render(<ReviewActions {...defaultProps} status="in_review" />);
      expect(screen.getByText("In Review")).toBeInTheDocument();
    });

    it("renders Completed badge for completed status", () => {
      render(<ReviewActions {...defaultProps} status="completed" />);
      expect(screen.getByText("Completed")).toBeInTheDocument();
    });

    it("renders Draft badge for draft status", () => {
      render(<ReviewActions {...defaultProps} status="draft" />);
      expect(screen.getByText("Draft")).toBeInTheDocument();
    });

    it("renders Sent badge for sent status", () => {
      render(<ReviewActions {...defaultProps} status="sent" />);
      expect(screen.getByText("Sent")).toBeInTheDocument();
    });

    it("renders raw status when not in labels map", () => {
      render(<ReviewActions {...defaultProps} status="unknown_status" />);
      expect(screen.getByText("unknown_status")).toBeInTheDocument();
    });
  });

  describe("in_review status actions", () => {
    it("renders Finalize Report button", () => {
      render(<ReviewActions {...defaultProps} status="in_review" />);
      expect(
        screen.getByRole("button", { name: /finalize report/i }),
      ).toBeInTheDocument();
    });

    it("renders Return to Tech button", () => {
      render(<ReviewActions {...defaultProps} status="in_review" />);
      expect(
        screen.getByRole("button", { name: /return to tech/i }),
      ).toBeInTheDocument();
    });

    it("does not render Send PDF to Customer for in_review", () => {
      render(<ReviewActions {...defaultProps} status="in_review" />);
      expect(
        screen.queryByRole("button", { name: /send pdf to customer/i }),
      ).not.toBeInTheDocument();
    });

    it("opens the FinalizeDialog with flush, form data and selected media", async () => {
      const flush = vi.fn(async () => true);
      const getFormData = vi.fn(() => null);
      const onJumpToField = vi.fn();
      const user = userEvent.setup();
      render(
        <ReviewActions
          {...defaultProps}
          status="in_review"
          flush={flush}
          getFormData={getFormData}
          onJumpToField={onJumpToField}
          selectedMediaIds={["m1"]}
        />,
      );

      expect(screen.queryByTestId("finalize-dialog")).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /finalize report/i }));

      expect(screen.getByTestId("finalize-dialog")).toBeInTheDocument();
      expect(finalizeDialogProps).toHaveBeenLastCalledWith(
        expect.objectContaining({
          inspectionId: "insp-1",
          open: true,
          flush,
          getFormData,
          onJumpToField,
          selectedMediaIds: ["m1"],
        }),
      );
    });

    it("marks the inspection completed and refreshes when the dialog finalizes", async () => {
      const onStatusChange = vi.fn();
      const user = userEvent.setup();
      render(
        <ReviewActions {...defaultProps} status="in_review" onStatusChange={onStatusChange} />,
      );

      await user.click(screen.getByRole("button", { name: /finalize report/i }));
      await user.click(screen.getByRole("button", { name: /mock finalize/i }));

      expect(onStatusChange).toHaveBeenCalledWith("completed");
      expect(mockRefresh).toHaveBeenCalled();
      expect(screen.queryByTestId("finalize-dialog")).not.toBeInTheDocument();
    });

    it("flushes before opening the return dialog", async () => {
      const order: string[] = [];
      const flush = vi.fn(async () => {
        order.push("flush");
        return true;
      });
      const user = userEvent.setup();
      render(<ReviewActions {...defaultProps} status="in_review" flush={flush} />);

      await user.click(screen.getByRole("button", { name: /return to tech/i }));

      expect(await screen.findByTestId("return-dialog")).toBeInTheDocument();
      expect(order).toEqual(["flush"]);
    });

    it("does not open the return dialog when flush fails", async () => {
      const user = userEvent.setup();
      render(<ReviewActions {...defaultProps} status="in_review" flush={async () => false} />);

      await user.click(screen.getByRole("button", { name: /return to tech/i }));

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/couldn't save/i)),
      );
      expect(screen.queryByTestId("return-dialog")).not.toBeInTheDocument();
    });
  });

  describe("completed status actions", () => {
    it("renders Send PDF to Customer button", () => {
      render(<ReviewActions {...defaultProps} status="completed" />);
      expect(
        screen.getByRole("button", { name: /send pdf to customer/i }),
      ).toBeInTheDocument();
    });

    it("renders Reopen for Editing button", () => {
      render(<ReviewActions {...defaultProps} status="completed" />);
      expect(
        screen.getByRole("button", { name: /reopen for editing/i }),
      ).toBeInTheDocument();
    });

    it("does not render Finalize button for completed", () => {
      render(<ReviewActions {...defaultProps} status="completed" />);
      expect(
        screen.queryByRole("button", { name: /finalize report/i }),
      ).not.toBeInTheDocument();
    });

    it("opens email dialog when Send PDF to Customer is clicked", async () => {
      const user = userEvent.setup();
      render(
        <ReviewActions
          {...defaultProps}
          status="completed"
          customerEmail="test@example.com"
        />,
      );

      await user.click(
        screen.getByRole("button", { name: /send pdf to customer/i }),
      );

      expect(screen.getByTestId("send-email-dialog")).toBeInTheDocument();
    });

    it("shows reopen confirmation dialog", async () => {
      const user = userEvent.setup();
      render(<ReviewActions {...defaultProps} status="completed" />);

      await user.click(
        screen.getByRole("button", { name: /reopen for editing/i }),
      );

      expect(screen.getByText("Reopen Inspection?")).toBeInTheDocument();
    });

    it("flushes, then calls the reopen API on confirmation", async () => {
      const calls: string[] = [];
      vi.stubGlobal("fetch", recordingFetch(calls));
      const flush = vi.fn(async () => {
        calls.push("flush");
        return true;
      });

      const onStatusChange = vi.fn();
      const user = userEvent.setup();
      render(
        <ReviewActions
          {...defaultProps}
          status="completed"
          onStatusChange={onStatusChange}
          flush={flush}
        />,
      );

      await user.click(
        screen.getByRole("button", { name: /reopen for editing/i }),
      );
      await user.click(screen.getByRole("button", { name: /^reopen$/i }));

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith(
          "Inspection reopened for editing",
        );
        expect(onStatusChange).toHaveBeenCalledWith("in_review");
      });
      // The recommendations prefetch is the GET; flush must precede the POST
      expect(calls.filter((c) => !c.startsWith("GET"))).toEqual([
        "flush",
        "POST /api/inspections/insp-1/reopen",
      ]);
    });

    it("does not call the reopen API when flush fails", async () => {
      const calls: string[] = [];
      vi.stubGlobal("fetch", recordingFetch(calls));
      const user = userEvent.setup();
      render(
        <ReviewActions {...defaultProps} status="completed" flush={async () => false} />,
      );

      await user.click(screen.getByRole("button", { name: /reopen for editing/i }));
      await user.click(screen.getByRole("button", { name: /^reopen$/i }));

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/couldn't save/i)),
      );
      expect(calls.filter((c) => c.startsWith("POST"))).toEqual([]);
    });
  });

  describe("sent status actions", () => {
    it("renders Send PDF to Customer and Reopen buttons", () => {
      render(<ReviewActions {...defaultProps} status="sent" />);

      expect(
        screen.getByRole("button", { name: /send pdf to customer/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /reopen for editing/i }),
      ).toBeInTheDocument();
    });
  });

  describe("draft status", () => {
    it("only shows status badge, no action buttons", () => {
      render(<ReviewActions {...defaultProps} status="draft" />);

      expect(screen.getByText("Draft")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /finalize/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /send/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /reopen/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe("error handling", () => {
    it("shows error toast on reopen failure", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          json: () =>
            Promise.resolve({ error: "Cannot reopen" }),
        }),
      );

      const user = userEvent.setup();
      render(<ReviewActions {...defaultProps} status="completed" />);

      await user.click(
        screen.getByRole("button", { name: /reopen for editing/i }),
      );
      await user.click(screen.getByRole("button", { name: /^reopen$/i }));

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith("Cannot reopen");
      });
    });
  });
});
```

- [ ] **Step 2: Run the test to verify the new cases fail**

Run: `npx vitest run src/components/review/__tests__/review-actions.test.tsx`
Expected: FAIL — `opens the FinalizeDialog…` (no dialog; the old inline AlertDialog renders instead), `flushes before…` cases (`flush` never called), `does not call the reopen API when flush fails`.

- [ ] **Step 3: Replace `review-actions.tsx`**

```tsx
"use client";

import { CheckCircle, Link2, Loader2, Mail, RotateCcw, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SendEmailDialog } from "@/components/dashboard/send-email-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getStatusConfig } from "@/lib/constants/status";
import type { InspectionFormData } from "@/types/inspection";
import { FinalizeDialog } from "./finalize-dialog";
import { ReturnDialog } from "./return-dialog";

const STATUS_BADGE_STYLES: Record<string, string> = {
  in_review: "text-sm px-3 py-1",
  completed: "text-sm px-3 py-1",
  draft: "text-sm px-3 py-1",
};

const FLUSH_FAILED_MESSAGE = "Couldn't save your latest changes — fix the save error, then try again";

interface ReviewActionsProps {
  inspectionId: string;
  status: string;
  facilityAddress?: string | null;
  customerEmail?: string | null;
  isFromWorkiz?: boolean;
  selectedMediaIds?: string[];
  onStatusChange: (newStatus: string) => void;
  /** Flush pending autosave before a transition; resolves false when the save failed. Defaults to a no-op. */
  flush?: () => Promise<boolean>;
  /** Current form values for finalize validation. When omitted, finalize skips validation. */
  getFormData?: () => InspectionFormData | null;
  /** Expand a section and highlight a field (finalize "jump to issue") */
  onJumpToField?: (path: string, stepIndex: number) => void;
}

const noopFlush = async () => true;
const noFormData = () => null;

export function ReviewActions({
  inspectionId,
  status,
  facilityAddress,
  customerEmail,
  isFromWorkiz,
  selectedMediaIds,
  onStatusChange,
  flush = noopFlush,
  getFormData = noFormData,
  onJumpToField,
}: ReviewActionsProps) {
  const router = useRouter();
  const [isFlushing, setIsFlushing] = useState(false);
  const [isReopening, setIsReopening] = useState(false);
  const [finalizeDialogOpen, setFinalizeDialogOpen] = useState(false);
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [sendEmailDialogOpen, setSendEmailDialogOpen] = useState(false);
  const [summaryDialogOpen, setSummaryDialogOpen] = useState(false);
  const [summaryEmailDialogOpen, setSummaryEmailDialogOpen] = useState(false);
  const [summaryUrl, setSummaryUrl] = useState<string | null>(null);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [recommendations, setRecommendations] = useState("");
  const [recommendationsLoaded, setRecommendationsLoaded] = useState(false);

  // Pre-fill recommendations from the most recent summary for this inspection
  useEffect(() => {
    if (recommendationsLoaded) return;
    fetch(`/api/inspections/${inspectionId}/generate-summary`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.recommendations) setRecommendations(data.recommendations);
      })
      .catch(() => {})
      .finally(() => setRecommendationsLoaded(true));
  }, [inspectionId, recommendationsLoaded]);

  const handleFinalized = () => {
    onStatusChange("completed");
    router.refresh();
  };

  const handleReturnClick = async () => {
    setIsFlushing(true);
    const ok = await flush();
    setIsFlushing(false);
    if (!ok) {
      toast.error(FLUSH_FAILED_MESSAGE);
      return;
    }
    setReturnDialogOpen(true);
  };

  const handleReopen = async () => {
    setIsReopening(true);
    try {
      const ok = await flush();
      if (!ok) {
        toast.error(FLUSH_FAILED_MESSAGE);
        return;
      }
      const res = await fetch(`/api/inspections/${inspectionId}/reopen`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        let errorMessage = "Failed to reopen";
        try {
          const data = await res.json();
          errorMessage = data.error || errorMessage;
        } catch {
          errorMessage = `Server error (${res.status}): ${res.statusText}`;
        }
        throw new Error(errorMessage);
      }
      toast.success("Inspection reopened for editing");
      onStatusChange("in_review");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reopen inspection");
    } finally {
      setIsReopening(false);
    }
  };

  const handleReturned = () => {
    onStatusChange("draft");
    router.refresh();
  };

  const handleGenerateSummary = async () => {
    if (!recommendations.trim()) {
      toast.error("Please enter recommendations before generating the summary link.");
      return;
    }
    setIsGeneratingSummary(true);
    try {
      const res = await fetch(`/api/inspections/${inspectionId}/generate-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recommendations: recommendations.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to generate summary link");
      }
      const data = await res.json();
      setSummaryUrl(data.summaryUrl);
      setSummaryDialogOpen(false);
      setSummaryEmailDialogOpen(true);
      toast.success("Summary link generated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate summary link");
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Status badge */}
      <Badge className={`${getStatusConfig(status).className} ${STATUS_BADGE_STYLES[status] ?? "text-sm px-3 py-1"}`}>
        {getStatusConfig(status).label}
      </Badge>

      {/* In Review: Finalize and Return buttons */}
      {status === "in_review" && (
        <>
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700"
            disabled={isFlushing || finalizeDialogOpen}
            onClick={() => setFinalizeDialogOpen(true)}
          >
            {finalizeDialogOpen ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CheckCircle className="size-4" />
            )}
            Finalize Report
          </Button>

          <FinalizeDialog
            inspectionId={inspectionId}
            open={finalizeDialogOpen}
            onOpenChange={setFinalizeDialogOpen}
            flush={flush}
            getFormData={getFormData}
            selectedMediaIds={selectedMediaIds ?? []}
            onJumpToField={onJumpToField}
            onFinalized={handleFinalized}
          />

          <Button
            size="sm"
            variant="outline"
            className="border-amber-300 text-amber-700 hover:bg-amber-50"
            disabled={isFlushing}
            onClick={handleReturnClick}
          >
            {isFlushing ? <Loader2 className="size-4 animate-spin" /> : <Undo2 className="size-4" />}
            Return to Tech
          </Button>

          <ReturnDialog
            inspectionId={inspectionId}
            open={returnDialogOpen}
            onOpenChange={setReturnDialogOpen}
            onReturned={handleReturned}
          />
        </>
      )}

      {/* Completed/Sent: Send to Customer and Reopen buttons */}
      {(status === "completed" || status === "sent") && (
        <>
          <Button size="sm" onClick={() => setSendEmailDialogOpen(true)}>
            <Mail className="size-4" />
            Send PDF to Customer
          </Button>

          <Button size="sm" variant="outline" onClick={() => setSummaryDialogOpen(true)}>
            <Link2 className="size-4" />
            Send Summary Link
          </Button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="outline" disabled={isReopening}>
                {isReopening ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RotateCcw className="size-4" />
                )}
                Reopen for Editing
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reopen Inspection?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will move the inspection back to &quot;In Review&quot; status, allowing
                  further edits before re-finalizing.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleReopen} variant="default">
                  Reopen
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <SendEmailDialog
            inspectionId={inspectionId}
            facilityAddress={facilityAddress ?? null}
            customerEmail={customerEmail ?? null}
            isFromWorkiz={isFromWorkiz}
            open={sendEmailDialogOpen}
            onOpenChange={setSendEmailDialogOpen}
          />

          {/* Summary link generation dialog */}
          <AlertDialog open={summaryDialogOpen} onOpenChange={setSummaryDialogOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Generate Summary Link</AlertDialogTitle>
                <AlertDialogDescription>
                  Enter recommendations for the customer. A shareable summary link will be generated
                  and you can email it to the customer.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="py-2">
                <Label htmlFor="recommendations">Recommendations</Label>
                <Textarea
                  id="recommendations"
                  value={recommendations}
                  onChange={(e) => setRecommendations(e.target.value)}
                  placeholder="Enter recommendations for the customer..."
                  rows={4}
                  className="mt-1"
                />
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <Button onClick={handleGenerateSummary} disabled={isGeneratingSummary}>
                  {isGeneratingSummary && <Loader2 className="size-4 animate-spin" />}
                  Generate & Send
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Email dialog for summary link */}
          <SendEmailDialog
            inspectionId={inspectionId}
            facilityAddress={facilityAddress ?? null}
            customerEmail={customerEmail ?? null}
            isFromWorkiz={isFromWorkiz}
            open={summaryEmailDialogOpen}
            onOpenChange={setSummaryEmailDialogOpen}
            summaryUrl={summaryUrl}
          />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/review/__tests__/review-actions.test.tsx`
Expected: PASS — 22 tests. (`act(...)` warnings from the recommendations prefetch on mount are pre-existing noise, not failures.)

- [ ] **Step 5: Commit**

```bash
git add src/components/review/review-actions.tsx src/components/review/__tests__/review-actions.test.tsx
git commit -m "feat(review): ReviewActions opens FinalizeDialog and flushes autosave before Return/Reopen"
```

---
### Task 10: `SaveStatusBar` + rewrite `review-editor.tsx` as the shell

**Files:**
- Create: `src/components/review/save-status-bar.tsx`
- Modify: `src/components/review/review-editor.tsx` (whole file replaced — the 1,073-line editor goes away here)
- Test: `src/components/review/__tests__/save-status-bar.test.tsx`, `src/components/review/__tests__/review-editor.test.tsx`

**Interfaces:**
- Consumes: `useAutoSave` (Task 3) with `{ enabled }`; `Step*` `readOnly` (Task 4); `ReviewSection`/`ReviewPill`/`useStepValidations` (Task 5); `PhotoSelection`/`ReportPreview` (Task 6); `ReviewActions` with `flush`/`getFormData`/`onJumpToField` (Task 9); `data-field-path` on `FormItem` (Task 4)
- Produces:
  - `SaveStatusBar({ status: AutoSaveStatus; lastSaved: Date | null; onRetry: () => void; readOnly: boolean })` — `role="status"`
  - `ReviewEditor({ inspection, media })` — same props as today (Task 11 adds the optional provenance prop when prefill Phase 1 is present)

- [ ] **Step 1: Write the failing tests**

Create `src/components/review/__tests__/save-status-bar.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SaveStatusBar } from "@/components/review/save-status-bar";

describe("SaveStatusBar", () => {
  it("shows Saving…, Saved · N s ago, and Save failed — Retry", async () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <SaveStatusBar status="saving" lastSaved={null} onRetry={onRetry} readOnly={false} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Saving…");

    rerender(
      <SaveStatusBar status="saved" lastSaved={new Date(Date.now() - 2000)} onRetry={onRetry} readOnly={false} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(/Saved · \d s ago/);

    rerender(<SaveStatusBar status="error" lastSaved={null} onRetry={onRetry} readOnly={false} />);
    expect(screen.getByRole("status")).toHaveTextContent("Save failed");
    await userEvent.setup().click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("shows the read-only notice regardless of save status", () => {
    render(<SaveStatusBar status="error" lastSaved={null} onRetry={vi.fn()} readOnly />);
    expect(screen.getByRole("status")).toHaveTextContent(/read-only/i);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
```

Create `src/components/review/__tests__/review-editor.test.tsx`. The six step components are mocked with stubs that mirror the real `readOnly` contract (a `<fieldset disabled>` wrapper and one `data-field-path` element) so the shell test stays fast and does not fetch media; the real fieldset behaviour is covered by Task 4's test. `ReviewActions` is mocked to expose the shell's `onJumpToField` and `flush` wiring.

```tsx
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Autosave: spy on the options the shell passes and expose a controllable flush
const autoSaveSpy = vi.fn();
vi.mock("@/hooks/use-auto-save", () => ({
  useAutoSave: (...args: unknown[]) => {
    autoSaveSpy(...args);
    return { saving: false, lastSaved: null, status: "idle", flush: vi.fn(async () => true) };
  },
}));

// Step components: lightweight stubs that mirror the real readOnly contract
// (a <fieldset disabled> wrapper) and expose one data-field-path for jump-to.
function stepStub(index: number, fieldPath: string) {
  return ({ readOnly }: { inspectionId: string; readOnly?: boolean }) => (
    <fieldset disabled={readOnly} data-testid={`step-${index}`}>
      <div data-slot="form-item" data-field-path={fieldPath}>
        <input aria-label={fieldPath} />
      </div>
    </fieldset>
  );
}
vi.mock("@/components/inspection/step-facility-info", () => ({
  StepFacilityInfo: stepStub(0, "facilityInfo.facilityName"),
}));
vi.mock("@/components/inspection/step-general-treatment", () => ({
  StepGeneralTreatment: stepStub(1, "generalTreatment.systemTypes"),
}));
vi.mock("@/components/inspection/step-design-flow", () => ({
  StepDesignFlow: stepStub(2, "designFlow.estimatedDesignFlow"),
}));
vi.mock("@/components/inspection/step-septic-tank", () => ({
  StepSepticTank: stepStub(3, "septicTank.numberOfTanks"),
}));
vi.mock("@/components/inspection/step-disposal-works", () => ({
  StepDisposalWorks: stepStub(4, "disposalWorks.disposalType"),
}));
vi.mock("@/components/inspection/step-alternative-system", () => ({
  StepAlternativeSystem: stepStub(5, "alternativeSystem.manufacturer"),
}));

// Actions: expose the jump-to callback so the shell's section/highlight logic can be driven
vi.mock("@/components/review/review-actions", () => ({
  ReviewActions: ({ status, onJumpToField, flush }: any) => (
    <div data-testid="review-actions" data-status={status}>
      <button onClick={() => onJumpToField("septicTank.numberOfTanks", 3)}>Jump to tanks</button>
      <button onClick={() => flush()}>Flush</button>
    </div>
  ),
}));

// PDF preview: avoid pdf-lib in jsdom
vi.mock("@/hooks/use-pdf-generation", () => ({
  usePdfGeneration: () => ({
    generatePdf: vi.fn(),
    pdfData: null,
    isGenerating: false,
    error: null,
    clearPdf: vi.fn(),
  }),
}));

import { getDefaultFormValues } from "@/lib/validators/inspection";
import type { InspectionFormData } from "@/types/inspection";
import { ReviewEditor } from "@/components/review/review-editor";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeInspection(overrides: Partial<Parameters<typeof ReviewEditor>[0]["inspection"]> = {}) {
  const formData = getDefaultFormValues("Dan Endres") as unknown as InspectionFormData;
  formData.facilityInfo.facilityName = "Smith Residence";
  formData.designFlow = {
    estimatedDesignFlow: "450",
    designFlowBasis: "bedrooms",
    numberOfBedrooms: "3",
    fixtureCount: "12",
    nonDwellingGpd: "0",
    actualFlowEvaluation: "normal",
    designFlowComments: "ok",
  };
  return {
    id: "insp-1",
    status: "in_review",
    formData,
    facilityName: "Smith Residence",
    facilityAddress: "123 Main St",
    facilityCity: "Phoenix",
    facilityCounty: "Maricopa",
    createdAt: "2026-09-01T00:00:00.000Z",
    reviewNotes: null,
    customerEmail: null,
    isFromWorkiz: false,
    ...overrides,
  };
}

const media = [
  {
    id: "m1",
    type: "photo" as const,
    storagePath: "insp-1/a.jpg",
    label: "septic-tank",
    description: null,
    sortOrder: 0,
    createdAt: "2026-09-01T00:00:00.000Z",
    signedUrl: "https://example.test/a.jpg",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("ReviewEditor", () => {
  it("renders the six wizard sections collapsed, with live pills", () => {
    render(<ReviewEditor inspection={makeInspection()} media={media} />);

    for (const label of [
      "Facility Info",
      "General Treatment",
      "Design Flow",
      "Septic Tank",
      "Disposal Works",
      "Alternative System",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    for (let i = 0; i < 6; i++) {
      expect(screen.queryByTestId(`step-${i}`)).not.toBeInTheDocument();
    }

    // Design Flow is fully filled → complete; Septic Tank still has empty STEP_FIELDS;
    // Alternative System is switched off → Not included
    const designFlow = screen.getByText("Design Flow").closest("[data-slot=collapsible-trigger]")!;
    expect(within(designFlow as HTMLElement).getByText("complete")).toBeInTheDocument();
    const septic = screen.getByText("Septic Tank").closest("[data-slot=collapsible-trigger]")!;
    expect(within(septic as HTMLElement).getByText(/^\d+ empty$/)).toBeInTheDocument();
    const alt = screen.getByText("Alternative System").closest("[data-slot=collapsible-trigger]")!;
    expect(within(alt as HTMLElement).getByText("Not included")).toBeInTheDocument();
  });

  it("shows an issues pill when a validator error exists", () => {
    const inspection = makeInspection();
    inspection.formData.facilityInfo.facilityName = "";
    render(<ReviewEditor inspection={inspection} media={media} />);

    const facility = screen.getByText("Facility Info").closest("[data-slot=collapsible-trigger]")!;
    expect(within(facility as HTMLElement).getByText("1 issue")).toBeInTheDocument();
  });

  it("expanding a section renders the wizard step component", async () => {
    const user = userEvent.setup();
    render(<ReviewEditor inspection={makeInspection()} media={media} />);

    await user.click(screen.getByText("Septic Tank"));

    expect(screen.getByTestId("step-3")).toBeInTheDocument();
    expect(screen.getByTestId("step-3")).not.toBeDisabled();
    expect(screen.queryByTestId("step-0")).not.toBeInTheDocument();
  });

  it("mounts autosave enabled while in review, passing the inspection id", () => {
    render(<ReviewEditor inspection={makeInspection()} media={media} />);
    expect(autoSaveSpy).toHaveBeenCalledWith(expect.anything(), "insp-1", { enabled: true });
  });

  it("completed: steps render inside fieldset[disabled], autosave is disabled, bar says read-only", async () => {
    const user = userEvent.setup();
    render(<ReviewEditor inspection={makeInspection({ status: "completed" })} media={media} />);

    expect(autoSaveSpy).toHaveBeenCalledWith(expect.anything(), "insp-1", { enabled: false });
    expect(screen.getByRole("status")).toHaveTextContent(/read-only/i);
    expect(screen.getByTestId("review-actions")).toHaveAttribute("data-status", "completed");

    await user.click(screen.getByText("Facility Info"));
    const step = screen.getByTestId("step-0");
    expect(step.tagName).toBe("FIELDSET");
    expect(step).toBeDisabled();
    expect(document.querySelector("fieldset[disabled]")).not.toBeNull();
  });

  it("jump-to-field opens the section and highlights the field", async () => {
    const user = userEvent.setup();
    render(<ReviewEditor inspection={makeInspection()} media={media} />);

    expect(screen.queryByTestId("step-3")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /jump to tanks/i }));

    await waitFor(() => {
      const target = document.querySelector('[data-field-path="septicTank.numberOfTanks"]');
      expect(target).not.toBeNull();
      expect(target).toHaveAttribute("data-highlight", "true");
    });
  });

  it("renders the photo selection with all photos selected by default", () => {
    render(<ReviewEditor inspection={makeInspection()} media={media} />);
    expect(screen.getByText("Photos (1 of 1 selected for the report)")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/review/__tests__/save-status-bar.test.tsx src/components/review/__tests__/review-editor.test.tsx`
Expected: FAIL — `save-status-bar` import unresolved; the editor test fails on the six-section assertions (the old editor renders five hand-rolled sections and no pills) and on `useAutoSave` never being called.

- [ ] **Step 3: Create `save-status-bar.tsx`**

```tsx
"use client";

import { AlertTriangle, Check, Loader2, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { AutoSaveStatus } from "@/hooks/use-auto-save";

interface SaveStatusBarProps {
  status: AutoSaveStatus;
  lastSaved: Date | null;
  /** Re-run the save (wired to useAutoSave.flush) */
  onRetry: () => void;
  readOnly: boolean;
}

function relativeTime(from: Date, now: number): string {
  const s = Math.max(0, Math.round((now - from.getTime()) / 1000));
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return from.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Sticky bottom bar: `Saved · 2 s ago` · `Saving…` · `Save failed — Retry` · read-only notice */
export function SaveStatusBar({ status, lastSaved, onRetry, readOnly }: SaveStatusBarProps) {
  const [now, setNow] = useState(() => Date.now());

  // Tick once a second so "N s ago" stays honest
  useEffect(() => {
    if (readOnly || !lastSaved) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [readOnly, lastSaved]);

  let content: React.ReactNode;
  if (readOnly) {
    content = (
      <span className="flex items-center gap-2 text-muted-foreground">
        <Lock className="size-4" />
        Read-only — reopen the inspection to edit
      </span>
    );
  } else if (status === "saving") {
    content = (
      <span className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Saving…
      </span>
    );
  } else if (status === "error") {
    content = (
      <span className="flex items-center gap-2 text-destructive">
        <AlertTriangle className="size-4" />
        Save failed
        <Button type="button" variant="outline" size="sm" className="h-7" onClick={onRetry}>
          Retry
        </Button>
      </span>
    );
  } else if (lastSaved) {
    content = (
      <span className="flex items-center gap-2 text-muted-foreground">
        <Check className="size-4 text-emerald-600" />
        Saved · {relativeTime(lastSaved, now)}
      </span>
    );
  } else {
    content = <span className="text-muted-foreground">Changes save automatically</span>;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky bottom-0 z-20 -mx-4 mt-6 border-t bg-background/95 px-4 py-2 text-sm backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:mx-0 sm:rounded-t-lg"
    >
      {content}
    </div>
  );
}
```

- [ ] **Step 4: Replace `review-editor.tsx` with the shell**

Delete every line of the old file and write this (the `// prefill provider mounted in prefill phase 1` comment marks where Step 5 mounts the provider/tile when that phase has landed):

```tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { type FieldPath, useForm, useWatch } from "react-hook-form";
import type { MediaRecord } from "@/components/inspection/media-gallery";
import { StepAlternativeSystem } from "@/components/inspection/step-alternative-system";
import { StepDesignFlow } from "@/components/inspection/step-design-flow";
import { StepDisposalWorks } from "@/components/inspection/step-disposal-works";
import { StepFacilityInfo } from "@/components/inspection/step-facility-info";
import { StepGeneralTreatment } from "@/components/inspection/step-general-treatment";
import { StepSepticTank } from "@/components/inspection/step-septic-tank";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { useAutoSave } from "@/hooks/use-auto-save";
import { STEP_LABELS } from "@/lib/constants/inspection";
import { normalizeIncludeAlternativePages } from "@/lib/inspection-form";
import { getDefaultFormValues, inspectionFormSchema } from "@/lib/validators/inspection";
import type { InspectionFormData } from "@/types/inspection";
import { PhotoSelection } from "./photo-selection";
import { ReportPreview } from "./report-preview";
import { ReviewActions } from "./review-actions";
import { ReviewPill, useStepValidations } from "./review-pill";
import { ReviewSection } from "./review-section";
import { SaveStatusBar } from "./save-status-bar";

// prefill provider mounted in prefill phase 1

export interface ReviewEditorProps {
  inspection: {
    id: string;
    status: string;
    formData: InspectionFormData | null;
    facilityName: string | null;
    facilityAddress: string | null;
    facilityCity: string | null;
    facilityCounty: string | null;
    createdAt: string;
    reviewNotes: string | null;
    customerEmail: string | null;
    isFromWorkiz: boolean;
  };
  media: MediaRecord[];
}

/** How long the jumped-to field keeps its amber ring */
const HIGHLIGHT_MS = 2000;

export function ReviewEditor({ inspection, media: initialMedia }: ReviewEditorProps) {
  const [status, setStatus] = useState(inspection.status);
  const readOnly = status === "completed" || status === "sent";

  // ── Form ────────────────────────────────────────────────────────────────────
  // Normalize so the includeAlternativePages flag stays consistent with the
  // presence of saved alt-system data round-tripping through review.
  const initialFormValues =
    normalizeIncludeAlternativePages(inspection.formData) ?? getDefaultFormValues("");

  const form = useForm<InspectionFormData>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(inspectionFormSchema) as any,
    defaultValues: initialFormValues,
    mode: "onChange",
  });

  const { status: saveStatus, lastSaved, flush } = useAutoSave(form, inspection.id, {
    enabled: !readOnly,
  });
  const validations = useStepValidations(form.control);
  const includeAlternativePages = useWatch({ control: form.control, name: "includeAlternativePages" });

  // ── Media selection (photos included in the report) ─────────────────────────
  const [mediaItems, setMediaItems] = useState(initialMedia);
  const [selectedMediaIds, setSelectedMediaIds] = useState<Set<string>>(
    () => new Set(initialMedia.filter((m) => m.type === "photo").map((m) => m.id)),
  );
  const selectedMedia = useMemo(
    () => mediaItems.filter((m) => selectedMediaIds.has(m.id)),
    [mediaItems, selectedMediaIds],
  );
  const toggleMedia = useCallback((id: string) => {
    setSelectedMediaIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const selectAllPhotos = useCallback(
    () => setSelectedMediaIds(new Set(mediaItems.filter((m) => m.type === "photo").map((m) => m.id))),
    [mediaItems],
  );
  const deselectAllPhotos = useCallback(() => setSelectedMediaIds(new Set()), []);
  const handleDescriptionSaved = useCallback((mediaId: string, description: string) => {
    setMediaItems((prev) => prev.map((m) => (m.id === mediaId ? { ...m, description } : m)));
  }, []);

  // ── Sections (controlled so the finalize dialog can jump to a field) ────────
  const [openSections, setOpenSections] = useState<Record<number, boolean>>({});
  const setSectionOpen = useCallback(
    (index: number, open: boolean) => setOpenSections((prev) => ({ ...prev, [index]: open })),
    [],
  );

  const jumpToField = useCallback(
    (path: string, stepIndex: number) => {
      setSectionOpen(stepIndex, true);
      // Two frames: one for the section to mount, one for layout
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const el = document.querySelector<HTMLElement>(`[data-field-path="${path}"]`);
          if (!el) return;
          el.scrollIntoView?.({ behavior: "smooth", block: "center" });
          el.setAttribute("data-highlight", "true");
          setTimeout(() => el.removeAttribute("data-highlight"), HIGHLIGHT_MS);
          form.setFocus(path as FieldPath<InspectionFormData>);
        }),
      );
    },
    [form, setSectionOpen],
  );

  const steps = [
    <StepFacilityInfo key="0" inspectionId={inspection.id} readOnly={readOnly} />,
    <StepGeneralTreatment key="1" inspectionId={inspection.id} readOnly={readOnly} />,
    <StepDesignFlow key="2" inspectionId={inspection.id} readOnly={readOnly} />,
    <StepSepticTank key="3" inspectionId={inspection.id} readOnly={readOnly} />,
    <StepDisposalWorks key="4" inspectionId={inspection.id} readOnly={readOnly} />,
    <StepAlternativeSystem key="5" inspectionId={inspection.id} readOnly={readOnly} />,
  ];

  return (
    <div className="space-y-4">
      {/* Navigation */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/review">
            <ArrowLeft className="size-4" />
            Back to Queue
          </Link>
        </Button>
        <h1 className="text-lg font-semibold truncate">
          {inspection.facilityName || "Untitled Inspection"}
        </h1>
      </div>

      <Form {...form}>
        {/* Status header + actions */}
        <ReviewActions
          inspectionId={inspection.id}
          status={status}
          facilityAddress={inspection.facilityAddress}
          customerEmail={inspection.customerEmail}
          isFromWorkiz={inspection.isFromWorkiz}
          selectedMediaIds={Array.from(selectedMediaIds)}
          onStatusChange={setStatus}
          flush={flush}
          getFormData={form.getValues}
          onJumpToField={jumpToField}
        />

        {/* Six wizard sections */}
        <div className="space-y-3">
          {steps.map((step, index) => (
            <ReviewSection
              key={STEP_LABELS[index]}
              title={STEP_LABELS[index]}
              open={openSections[index] ?? false}
              onOpenChange={(open) => setSectionOpen(index, open)}
              pill={
                <ReviewPill
                  result={index === 5 && !includeAlternativePages ? null : validations[index]}
                />
              }
            >
              {step}
            </ReviewSection>
          ))}
        </div>

        <PhotoSelection
          inspectionId={inspection.id}
          media={mediaItems}
          selectedIds={selectedMediaIds}
          onToggle={toggleMedia}
          onSelectAll={selectAllPhotos}
          onDeselectAll={deselectAllPhotos}
          onDescriptionSaved={handleDescriptionSaved}
          readOnly={readOnly}
        />

        <ReportPreview
          inspectionId={inspection.id}
          status={status}
          form={form}
          selectedMedia={selectedMedia}
          readOnly={readOnly}
        />

        <SaveStatusBar
          status={saveStatus}
          lastSaved={lastSaved}
          onRetry={() => void flush()}
          readOnly={readOnly}
        />
      </Form>
    </div>
  );
}
```

- [ ] **Step 5: Mount the prefill provider and sources tile — guarded**

Check whether prefill Phase 1 has landed on this branch:

Run: `test -f src/components/prefill/provenance-context.tsx && echo PREFILL_PRESENT || echo PREFILL_ABSENT`

**If `PREFILL_ABSENT`:** do nothing — keep the `// prefill provider mounted in prefill phase 1` comment exactly as written above (no TODO markers), and skip to Step 6.

**If `PREFILL_PRESENT`:** apply all of the following to `review-editor.tsx`:

1. Add the imports (after the `@/components/ui/form` import):

```tsx
import { PrefillSourcesTile } from "@/components/prefill/prefill-sources-tile";
import { ProvenanceProvider } from "@/components/prefill/provenance-context";
import type { FieldProvenance } from "@/lib/prefill/types";
```

2. Replace the comment line `// prefill provider mounted in prefill phase 1` with nothing (delete it).

3. Add the optional prop to `ReviewEditorProps.inspection`:

```tsx
    isFromWorkiz: boolean;
    /** Per-field provenance sidecar (prefill Phase 1); `{}` when the column is empty */
    fieldProvenance?: FieldProvenance;
```

4. Wrap the contents of `<Form {...form}>…</Form>` in the provider (contract: `ProvenanceProvider(props: { form; inspectionId; initial; readOnly?; children })` from `docs/superpowers/plans/2026-09-11-prefill-shared-contracts.md`), and mount the tile directly after `<ReviewActions … />`:

```tsx
      <Form {...form}>
        <ProvenanceProvider
          form={form}
          inspectionId={inspection.id}
          initial={inspection.fieldProvenance ?? {}}
          readOnly={readOnly}
        >
          {/* Status header + actions */}
          <ReviewActions
            …unchanged props…
          />

          {/* Prefill sources (assessor / listing / permits) — same tile as the wizard */}
          <PrefillSourcesTile inspectionId={inspection.id} form={form} readOnly={readOnly} />

          {/* Six wizard sections */}
          …unchanged…
          <SaveStatusBar … />
        </ProvenanceProvider>
      </Form>
```

The shared contract fixes `ProvenanceProvider`'s props; `PrefillSourcesTile`'s props are owned by the prefill Phase 1 plan — open `src/components/prefill/prefill-sources-tile.tsx`, read its exported props interface, and pass exactly those (expected: `inspectionId`, `form`, and a `readOnly` flag). Do not invent props.

5. In `review-editor.test.tsx` add, next to the other `vi.mock` calls:

```tsx
vi.mock("@/components/prefill/provenance-context", () => ({
  ProvenanceProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/prefill/prefill-sources-tile", () => ({
  PrefillSourcesTile: () => <div data-testid="prefill-tile" />,
}));
```

and add one test inside `describe("ReviewEditor", …)`:

```tsx
  it("mounts the prefill sources tile above the sections", () => {
    render(<ReviewEditor inspection={makeInspection()} media={media} />);
    expect(screen.getByTestId("prefill-tile")).toBeInTheDocument();
  });
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/components/review`
Expected: PASS — every file under `src/components/review/__tests__` (save-status-bar 2, review-editor 7 (8 with prefill), finalize-dialog 7, review-actions 22, review-section 11, review-pill 3, photo-selection 4, report-preview 2, return-dialog unchanged).

- [ ] **Step 7: Confirm the shell size and that nothing imports the deleted helpers**

Run: `wc -l src/components/review/review-editor.tsx && grep -rn "renderTextField\|renderCheckboxGroup\|showAllFields\|handleSave\b" src | grep -v __tests__ ; echo "grep-exit=$?"`
Expected: `~211 src/components/review/review-editor.tsx` (≤ 260 with the prefill block) and `grep-exit=1` (no matches).

- [ ] **Step 8: Commit**

```bash
git add src/components/review/save-status-bar.tsx src/components/review/review-editor.tsx \
  src/components/review/__tests__/save-status-bar.test.tsx src/components/review/__tests__/review-editor.test.tsx
git commit -m "feat(review): rewrite the review editor as a shell over the wizard steps"
```

---
