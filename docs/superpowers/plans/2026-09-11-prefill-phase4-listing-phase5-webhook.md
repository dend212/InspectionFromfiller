# Property Records Prefill — Phase 4 (Listing) + Phase 5 (Webhook Trigger) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Zillow (Apify) listing stage to the prefill pipeline — water source, bedrooms, and a "listing says sewer" warning — and make the Workiz webhook start a background prefill run for every draft it creates, with the wizard applying that run's proposals on mount.

**Architecture:** Phase 4 adds `src/lib/prefill/listing/` (a `ListingProvider` interface, an Apify REST client with a defensive raw-item normaliser, and `runListingStage`) plus `mapListingFacts`, then swaps the phase-1 listing stub in `run-prefill.ts` for the real stage so it runs in parallel with assessor and permits. Phase 5 adds `src/lib/prefill/webhook-input.ts` (turns the Workiz payload into a `PrefillInput`), makes `POST /api/webhooks/workiz` insert an `inspection_prefill_runs` row with `trigger: "webhook"` and schedule `runPrefill` via `after()`, and adds the apply-on-mount effect to `usePrefill` so webhook-created runs reach the form without a user action.

**Tech Stack:** Next.js 16.1 App Router (`after` from `next/server`), TypeScript, Drizzle ORM over `postgres`, Vitest 4 + jsdom + `@testing-library/react`, native `fetch` + `AbortSignal`, Apify REST API (`run-sync-get-dataset-items`), `tsx` via `npx` for `.mts` scripts (repo convention, same as the phase 2/3 smoke scripts).

## Global Constraints

Copied from the spec (`docs/superpowers/specs/2026-09-11-property-records-prefill-design.md`) and the shared contracts (`docs/superpowers/plans/2026-09-11-prefill-shared-contracts.md`). Every task's requirements implicitly include this section.

- Branch: `feature/property-records-prefill`. Deploy = push to `main`; **never push `main` without Daniel's explicit per-deploy approval.**
- Types, stage/orchestrator signatures and route contracts come from the shared contracts doc and must be used **verbatim** (`ListingFacts`, `ListingProvider`, `StageContext`, `StageResult`, `PrefillInput`, `PrefillStage`, `ProposedField`, `runPrefill(runId)`, `usePrefill({ inspectionId, form, enabled })`).
- Listing provider v1: Apify actor `sian.agency/zillow-property-detail-scraper`, called with `POST https://api.apify.com/v2/acts/sian.agency~zillow-property-detail-scraper/run-sync-get-dataset-items?token=$APIFY_TOKEN&timeout=60&memory=1024`, body `{ "addresses": ["<full address>"] }`. Apify timeout **60 s**. Not-found is `summary: "No Zillow listing found for <address>"`.
- Water-source normalisation (spec §5.3): `city|municipal|public` → `municipal`; `private (water )?company|water co` → `private_company`; `shared well` → `shared_well`; `well|private well` → `private_well`; `hauled` → `hauled_water`.
- Listing proposals: `facilityInfo.waterSource` confidence **0.8**; `designFlow.numberOfBedrooms` confidence **0.85**; listing `sewer = "sewer"` → `kind: "warning"` on `facilityInfo.wastewaterSource` with message `Listing says "Sewer" — confirm this property is on septic`; no value written for warnings.
- The mapper is defensive: unmapped shapes yield `null` facts, never an error. A stage never throws; it returns a `StageResult`. A stage failure never fails the run.
- `APIFY_TOKEN` is server-only, added to `.env.example`; **never log the token** and never let it leak into a stored error message (error messages must not contain the request URL).
- Outbound hosts are fixed: `api.apify.com` for this phase. User-supplied APN/address are validated (APN regex, address length ≤ 200, printable ASCII) before use.
- Background work on Vercel: `import { after } from "next/server"`; `after(() => work())` inside the route handler; `export const maxDuration = 300;` on the route file. **Never leave a floating promise.**
- Webhook runs: `trigger: "webhook"`, `created_by: null`. Creating the run must **never** fail the webhook response.
- `next/link` is never used for record/source links — plain `<a target="_blank" rel="noopener">`.
- Tests: `npx vitest run <path>`. Type gate: `npm run build` (needs `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_APP_URL` — placeholders are fine). Acceptance bar: **no new vitest failures vs. the ~15 pre-existing** (nav/roles/rbac, review-actions, reopen/download routes, inspection.test STEP_FIELDS + tank schema). Do **not** run `biome --write`; edit by hand in the surrounding style.
- Test files live in a `__tests__/` folder next to the source (repo convention).

---

## What phases 1–3 already deliver (consume, do not re-create)

Verify each of these exists on the branch before starting Task 1 (`ls`/`grep` — takes 30 seconds). If a name differs, the contracts doc wins; fix the earlier phase, not this plan.

| Artefact | From | Used by |
|---|---|---|
| `src/lib/prefill/types.ts` — `PrefillInput`, `PrefillAddress`, `PrefillStage`, `PrefillStages`, `ProposedField`, `PrefillRunDTO`, `emptyStages()`, `PREFILL_FILL_THRESHOLD` | Phase 1 | every task |
| `StageContext`, `StageResult` interfaces — exported from `src/lib/prefill/run-prefill.ts` (the phase 2 and phase 3 plans both import them from there; if phase 1 put them in `src/lib/prefill/types.ts` instead, change only the `import type` line in Task 4) | Phase 1 | Tasks 4, 5 |
| `src/lib/prefill/run-prefill.ts` — `runPrefill(runId)`, `continuePrefillAfterSelection(runId, keys)`; listing stage is a stub returning `{ status: "skipped", summary: "Not available yet" }` | Phase 1 (+2, 3) | Task 5 |
| `src/lib/prefill/map-facts-to-fields.ts` — `mapPermitFacts`, `dedupeProposals` | Phase 3 | Task 3 |
| `src/lib/prefill/merge.ts` — `mergeProposals`, `getPath`, `isEmptyValue` | Phase 1 | Task 10 |
| `src/lib/db/schema.ts` — `inspectionPrefillRuns` table | Phase 1 | Task 9 |
| `src/components/prefill/prefill-sources-tile.tsx` — `PrefillSourcesTile` with one row per stage rendering `stage.summary` and `stage.links` | Phase 1 (+2) | Task 6 |
| `src/components/prefill/use-prefill.ts` — `usePrefill` (start / poll / select) and `provenance-context.tsx` — `useProvenance()` with `setMany` | Phase 1 | Task 10 |
| `GET /api/inspections/[id]/prefill/latest` → `PrefillRunDTO \| null`; `POST /api/inspections/[id]/prefill/[runId]/applied` → `{ ok: true }` | Phase 1/2 | Task 10 |

## File structure

**Phase 4 — Listing**

| File | Responsibility |
|---|---|
| Create `src/lib/prefill/listing/provider.ts` | `ListingProvider` / `ListingFacts` contract (verbatim from contracts doc) |
| Create `src/lib/prefill/listing/zillow-apify.ts` | Apify REST client (`zillowApifyProvider`), deep key search (`findFact`), water/sewer normalisers, `normaliseListingItem(raw)`, `fullAddress(address)` |
| Create `src/lib/prefill/listing/index.ts` | `runListingStage(input, ctx, provider?)` — skip / not_found / done / error → `StageResult` |
| Modify `src/lib/prefill/map-facts-to-fields.ts` | add `mapListingFacts(facts)` |
| Modify `src/lib/prefill/run-prefill.ts` | replace listing stub with `runListingStage`, run in parallel with permits; keep listing proposals across `/select` |
| Modify `src/components/prefill/prefill-sources-tile.tsx` | Listing row shows the Zillow link (verify generic link rendering; add if missing) |
| Modify `.env.example` | `APIFY_TOKEN` with comment |
| Create `scripts/listing-shape-check.mts` | one real lookup, prints raw keys + normalised facts |

**Phase 5 — Webhook trigger**

| File | Responsibility |
|---|---|
| Create `src/lib/prefill/webhook-input.ts` | `buildWebhookPrefillInput(src)` → `PrefillInput \| null`; `parseStreetLine` |
| Modify `src/app/api/webhooks/workiz/route.ts` | insert `webhook` run + `after(() => runPrefill(runId))`; `maxDuration = 300` |
| Modify `src/app/api/webhooks/workiz/__tests__/route.test.ts`, `src/__tests__/security/webhook-security.test.ts` | mocks for schema/`after`/`runPrefill`; new trigger tests |
| Modify `src/components/prefill/use-prefill.ts` | apply-on-mount effect (fetch `/prefill/latest`, apply unapplied `done` run) |

---

# Phase 4 — Listing (Zillow via Apify)

### Task 1: Listing provider contract + raw-item normaliser

**Files:**
- Create: `src/lib/prefill/listing/provider.ts`
- Create: `src/lib/prefill/listing/zillow-apify.ts` (normaliser half; the HTTP client is Task 2)
- Test: `src/lib/prefill/listing/__tests__/normalise.test.ts`

**Interfaces:**
- Consumes: `PrefillAddress` from `src/lib/prefill/types.ts` (phase 1).
- Produces: `ListingFacts`, `ListingProvider`, `ListingWaterSource` (provider.ts); `normaliseWaterSource(raw: unknown): ListingWaterSource | undefined`, `normaliseSewer(raw: unknown): "septic" | "sewer" | "unknown" | undefined`, `findFact(raw: unknown, candidates: string[]): unknown`, `flattenText(raw: unknown): string | undefined`, `normaliseListingItem(raw: unknown): ListingFacts | null`, `WATER_KEYS`, `SEWER_KEYS` (zillow-apify.ts).

- [ ] **Step 1: Write the provider contract (verbatim from the contracts doc)**

Create `src/lib/prefill/listing/provider.ts`:

```ts
import type { PrefillAddress } from "../types";

export type ListingWaterSource = "municipal" | "private_company" | "shared_well" | "private_well" | "hauled_water";

export interface ListingFacts {
  provider: "zillow";
  url: string;
  waterSource?: ListingWaterSource;
  sewer?: "septic" | "sewer" | "unknown";
  bedrooms?: number;
  bathrooms?: number;
  yearBuilt?: number;
  lotSqft?: number;
  raw: Record<string, unknown>;
}

export interface ListingProvider {
  readonly name: "zillow";
  lookup(address: PrefillAddress, signal: AbortSignal): Promise<ListingFacts | null>;
}
```

- [ ] **Step 2: Write the failing normaliser tests**

Create `src/lib/prefill/listing/__tests__/normalise.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  findFact,
  flattenText,
  normaliseListingItem,
  normaliseSewer,
  normaliseWaterSource,
} from "../zillow-apify";

describe("normaliseWaterSource (spec §5.3)", () => {
  it.each([
    ["City Water", "municipal"],
    ["Public", "municipal"],
    ["municipal", "municipal"],
    ["Private Water Company", "private_company"],
    ["EPCOR Water Co", "private_company"],
    ["Shared Well", "shared_well"],
    ["Well", "private_well"],
    ["Private Well", "private_well"],
    ["Hauled Water", "hauled_water"],
  ])("maps %j → %s", (raw, expected) => {
    expect(normaliseWaterSource(raw)).toBe(expected);
  });

  it("accepts arrays (Zillow resoFacts style) and label/value objects", () => {
    expect(normaliseWaterSource(["Public"])).toBe("municipal");
    expect(normaliseWaterSource({ factLabel: "Water", factValue: "Private Well" })).toBe("private_well");
  });

  it("returns undefined for unknown, empty or non-text values", () => {
    expect(normaliseWaterSource("Other")).toBeUndefined();
    expect(normaliseWaterSource("")).toBeUndefined();
    expect(normaliseWaterSource(true)).toBeUndefined();
    expect(normaliseWaterSource(undefined)).toBeUndefined();
  });
});

describe("normaliseSewer", () => {
  it.each([
    ["Septic Tank", "septic"],
    ["Septic", "septic"],
    ["Public Sewer", "sewer"],
    ["Sewer in & Connected", "sewer"],
    ["Sewer", "sewer"],
    ["None", "unknown"],
    [["Septic Tank"], "septic"],
  ])("maps %j → %s", (raw, expected) => {
    expect(normaliseSewer(raw)).toBe(expected);
  });

  it("returns undefined when there is no text", () => {
    expect(normaliseSewer(undefined)).toBeUndefined();
    expect(normaliseSewer("")).toBeUndefined();
  });
});

describe("flattenText", () => {
  it("lower-cases strings, joins string arrays, reads value/factValue/name", () => {
    expect(flattenText("Public Sewer")).toBe("public sewer");
    expect(flattenText(["Public", "Well"])).toBe("public, well");
    expect(flattenText({ value: "City" })).toBe("city");
    expect(flattenText({ factValue: "City" })).toBe("city");
    expect(flattenText({ name: "City" })).toBe("city");
    expect(flattenText(42)).toBe("42");
  });

  it("returns undefined for empty / non-text", () => {
    expect(flattenText("")).toBeUndefined();
    expect(flattenText([])).toBeUndefined();
    expect(flattenText(null)).toBeUndefined();
    expect(flattenText({ other: 1 })).toBeUndefined();
  });
});

describe("findFact", () => {
  it("finds a top-level key case-insensitively and ignoring underscores", () => {
    expect(findFact({ WaterSource: "Public" }, ["waterSource"])).toBe("Public");
    expect(findFact({ water_source: "Public" }, ["waterSource"])).toBe("Public");
  });

  it("finds nested keys (resoFacts.sewer, utilities.water)", () => {
    expect(findFact({ resoFacts: { sewer: ["Septic Tank"] } }, ["sewer"])).toEqual(["Septic Tank"]);
    expect(findFact({ utilities: { water: "City" } }, ["water"])).toBe("City");
  });

  it("finds label/value pairs inside arrays (atAGlanceFacts style)", () => {
    const raw = { atAGlanceFacts: [{ factLabel: "Sewer", factValue: "Septic Tank" }] };
    expect(findFact(raw, ["sewer"])).toBe("Septic Tank");
  });

  it("prefers shallower matches and skips empty values", () => {
    const raw = { water: "", nested: { water: "Well" }, deeper: { x: { water: "City" } } };
    expect(findFact(raw, ["water"])).toBe("Well");
  });

  it("returns undefined when nothing matches", () => {
    expect(findFact({ a: 1 }, ["sewer"])).toBeUndefined();
    expect(findFact(null, ["sewer"])).toBeUndefined();
  });
});

describe("normaliseListingItem", () => {
  it("maps a flat item", () => {
    const facts = normaliseListingItem({
      hdpUrl: "https://www.zillow.com/homedetails/8911-E-Cave-Creek-Rd-Carefree-AZ-85377/7921650_zpid/",
      waterSource: ["Private Well"],
      sewer: ["Septic Tank"],
      bedrooms: 3,
      bathrooms: 2,
      yearBuilt: 1998,
      lotAreaValue: 1.2,
      lotAreaUnits: "Acres",
    });
    expect(facts).toMatchObject({
      provider: "zillow",
      url: "https://www.zillow.com/homedetails/8911-E-Cave-Creek-Rd-Carefree-AZ-85377/7921650_zpid/",
      waterSource: "private_well",
      sewer: "septic",
      bedrooms: 3,
      bathrooms: 2,
      yearBuilt: 1998,
      lotSqft: 52272,
    });
  });

  it("maps a nested resoFacts item and builds the URL from zpid when no URL key exists", () => {
    const facts = normaliseListingItem({
      zpid: 7921650,
      resoFacts: { waterSource: ["Public"], sewer: ["Public Sewer"], bedrooms: "4", yearBuilt: "2001" },
    });
    expect(facts).toMatchObject({
      url: "https://www.zillow.com/homedetails/7921650_zpid/",
      waterSource: "municipal",
      sewer: "sewer",
      bedrooms: 4,
      yearBuilt: 2001,
    });
  });

  it("never picks a photo URL as the listing URL", () => {
    const facts = normaliseListingItem({
      zpid: 1,
      photos: [{ url: "https://photos.zillowstatic.com/fp/abc.jpg" }],
      bedrooms: 2,
    });
    expect(facts?.url).toBe("https://www.zillow.com/homedetails/1_zpid/");
  });

  it("keeps the raw item", () => {
    const raw = { zpid: 5, bedrooms: 1 };
    expect(normaliseListingItem(raw)?.raw).toBe(raw);
  });

  it("returns null for not-found / error items and non-objects", () => {
    expect(normaliseListingItem({ error: "Property not found", input: "1 Nowhere Rd" })).toBeNull();
    expect(normaliseListingItem({ unrelated: true })).toBeNull();
    expect(normaliseListingItem("string")).toBeNull();
    expect(normaliseListingItem(null)).toBeNull();
    expect(normaliseListingItem(undefined)).toBeNull();
  });

  it("returns facts with no septic fields when only a URL is known", () => {
    const facts = normaliseListingItem({ url: "https://www.zillow.com/homedetails/9_zpid/" });
    expect(facts).toEqual({
      provider: "zillow",
      url: "https://www.zillow.com/homedetails/9_zpid/",
      raw: { url: "https://www.zillow.com/homedetails/9_zpid/" },
    });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/lib/prefill/listing/__tests__/normalise.test.ts`
Expected: FAIL — `Failed to resolve import "../zillow-apify"`.

- [ ] **Step 4: Write the normaliser half of `zillow-apify.ts`**

Create `src/lib/prefill/listing/zillow-apify.ts` (Task 2 appends the HTTP client to this same file):

```ts
import type { ListingFacts, ListingWaterSource } from "./provider";

/**
 * Zillow via the Apify actor `sian.agency/zillow-property-detail-scraper`.
 *
 * The actor's output shape is not published, so everything below is defensive:
 * facts are located by a case-insensitive deep key search (`findFact`) and any
 * unmapped shape yields `null` facts, never an error. Run
 * `scripts/listing-shape-check.mts` to see the real keys for one address.
 */

/** Candidate key names, matched after lower-casing and stripping non-alphanumerics. */
export const WATER_KEYS = ["waterSource", "water_source", "water", "waterUtility"];
export const SEWER_KEYS = ["sewer", "sewerType", "sewer_type", "sewerSystem"];
const BEDROOM_KEYS = ["bedrooms", "beds", "bedroomCount"];
const BATHROOM_KEYS = ["bathrooms", "baths", "bathroomCount"];
const YEAR_BUILT_KEYS = ["yearBuilt", "year_built"];
const LOT_VALUE_KEYS = ["lotAreaValue", "lotSize", "lot_size", "lotArea"];
const LOT_UNIT_KEYS = ["lotAreaUnits", "lotSizeUnits"];
const URL_KEYS = ["hdpUrl", "url", "detailUrl", "zillowUrl", "propertyUrl", "link"];
const ZPID_KEYS = ["zpid"];
const NOT_FOUND_KEYS = ["error", "notFound", "errorMessage"];

const ZILLOW_HOMEDETAILS_RE = /^https?:\/\/(www\.)?zillow\.com\/homedetails\//i;
const MAX_SEARCH_DEPTH = 5;
const SQFT_PER_ACRE = 43_560;

function normKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isPresent(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/**
 * Turns a raw fact value into lower-cased text: strings as-is, string arrays
 * joined with ", ", `{ value | factValue | name }` objects by that property,
 * numbers stringified. Anything else → undefined.
 */
export function flattenText(raw: unknown): string | undefined {
  if (typeof raw === "string") return raw.trim() ? raw.trim().toLowerCase() : undefined;
  if (typeof raw === "number") return String(raw);
  if (Array.isArray(raw)) {
    const parts = raw.map(flattenText).filter((s): s is string => Boolean(s));
    return parts.length ? parts.join(", ") : undefined;
  }
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    return flattenText(obj.value ?? obj.factValue ?? obj.name);
  }
  return undefined;
}

/** Spec §5.3 water-source normalisation. Specific phrases are tested before generic ones. */
export function normaliseWaterSource(raw: unknown): ListingWaterSource | undefined {
  const text = flattenText(raw);
  if (!text) return undefined;
  if (/hauled/.test(text)) return "hauled_water";
  if (/shared\s*well/.test(text)) return "shared_well";
  if (/city|municipal|public/.test(text)) return "municipal";
  if (/private\s*(water\s*)?company|water\s*co\b/.test(text)) return "private_company";
  if (/\bwell\b/.test(text)) return "private_well";
  return undefined;
}

export function normaliseSewer(raw: unknown): "septic" | "sewer" | "unknown" | undefined {
  const text = flattenText(raw);
  if (!text) return undefined;
  if (/septic|cesspool|on-?site/.test(text)) return "septic";
  if (/sewer|public|city|municipal/.test(text)) return "sewer";
  return "unknown";
}

/**
 * Breadth-first search for the first non-empty value whose key (or
 * `factLabel`/`label`/`name` in a label/value pair) matches one of `candidates`.
 * Shallower matches win. Depth-limited so a huge dossier stays cheap.
 */
export function findFact(raw: unknown, candidates: string[]): unknown {
  const wanted = new Set(candidates.map(normKey));
  const queue: Array<{ node: unknown; depth: number }> = [{ node: raw, depth: 0 }];
  while (queue.length) {
    const { node, depth } = queue.shift() as { node: unknown; depth: number };
    if (!node || typeof node !== "object" || depth > MAX_SEARCH_DEPTH) continue;
    if (Array.isArray(node)) {
      for (const item of node) queue.push({ node: item, depth: depth + 1 });
      continue;
    }
    const obj = node as Record<string, unknown>;
    const label = obj.factLabel ?? obj.label ?? obj.name;
    if (typeof label === "string" && wanted.has(normKey(label))) {
      const v = obj.factValue ?? obj.value;
      if (isPresent(v)) return v;
    }
    for (const [key, v] of Object.entries(obj)) {
      if (wanted.has(normKey(key)) && isPresent(v)) return v;
    }
    for (const v of Object.values(obj)) {
      if (v && typeof v === "object") queue.push({ node: v, depth: depth + 1 });
    }
  }
  return undefined;
}

function toNumber(raw: unknown): number | undefined {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw === "string") {
    const n = Number.parseFloat(raw.replace(/[^\d.]/g, ""));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function toInteger(raw: unknown): number | undefined {
  const n = toNumber(raw);
  return n === undefined ? undefined : Math.round(n);
}

function toLotSqft(value: unknown, units: unknown): number | undefined {
  const n = toNumber(value);
  if (n === undefined) return undefined;
  const unitText = flattenText(units) ?? (typeof value === "string" ? value.toLowerCase() : "");
  if (/acre/.test(unitText)) return Math.round(n * SQFT_PER_ACRE);
  return Math.round(n);
}

function findListingUrl(raw: unknown): string | undefined {
  for (const key of URL_KEYS) {
    const v = findFact(raw, [key]);
    if (typeof v === "string" && ZILLOW_HOMEDETAILS_RE.test(v)) return v;
  }
  const zpid = findFact(raw, ZPID_KEYS);
  if (typeof zpid === "number" || (typeof zpid === "string" && /^\d+$/.test(zpid))) {
    return `https://www.zillow.com/homedetails/${zpid}_zpid/`;
  }
  return undefined;
}

/**
 * Maps one dataset item to `ListingFacts`. Returns null when the item is not an
 * object, looks like a not-found/error row, or carries neither a Zillow URL
 * nor any fact we care about.
 */
export function normaliseListingItem(raw: unknown): ListingFacts | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;

  const url = findListingUrl(item);
  const waterSource = normaliseWaterSource(findFact(item, WATER_KEYS));
  const sewer = normaliseSewer(findFact(item, SEWER_KEYS));
  const bedrooms = toInteger(findFact(item, BEDROOM_KEYS));
  const bathrooms = toNumber(findFact(item, BATHROOM_KEYS));
  const yearBuilt = toInteger(findFact(item, YEAR_BUILT_KEYS));
  const lotSqft = toLotSqft(findFact(item, LOT_VALUE_KEYS), findFact(item, LOT_UNIT_KEYS));

  const hasFacts =
    waterSource !== undefined ||
    sewer !== undefined ||
    bedrooms !== undefined ||
    yearBuilt !== undefined;

  // An error/not-found row without a resolvable URL is "no listing".
  const looksLikeError = NOT_FOUND_KEYS.some((k) => isPresent(item[k]));
  if (!url && (looksLikeError || !hasFacts)) return null;
  if (looksLikeError && !hasFacts) return null;

  const facts: ListingFacts = { provider: "zillow", url: url ?? "", raw: item };
  if (waterSource !== undefined) facts.waterSource = waterSource;
  if (sewer !== undefined) facts.sewer = sewer;
  if (bedrooms !== undefined) facts.bedrooms = bedrooms;
  if (bathrooms !== undefined) facts.bathrooms = bathrooms;
  if (yearBuilt !== undefined) facts.yearBuilt = yearBuilt;
  if (lotSqft !== undefined) facts.lotSqft = lotSqft;
  return facts;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/prefill/listing/__tests__/normalise.test.ts`
Expected: PASS — all `normaliseWaterSource`, `normaliseSewer`, `flattenText`, `findFact`, `normaliseListingItem` cases green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/prefill/listing/provider.ts src/lib/prefill/listing/zillow-apify.ts src/lib/prefill/listing/__tests__/normalise.test.ts
git commit -m "feat(prefill): listing provider contract + defensive Zillow item normaliser"
```

---

### Task 2: Apify HTTP client (`zillowApifyProvider.lookup`)

**Files:**
- Modify: `src/lib/prefill/listing/zillow-apify.ts` (append below Task 1's code)
- Test: `src/lib/prefill/listing/__tests__/zillow-apify.test.ts`

**Interfaces:**
- Consumes: `normaliseListingItem`, `PrefillAddress`, `ListingProvider`.
- Produces: `APIFY_ACTOR_ID`, `APIFY_TIMEOUT_MS = 60_000`, `buildApifyUrl(token: string): string`, `fullAddress(address: PrefillAddress): string | null`, `zillowApifyProvider: ListingProvider`, `ListingLookupError` (class with `status?: number`). Task 4 injects `zillowApifyProvider` as the default provider.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/prefill/listing/__tests__/zillow-apify.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrefillAddress } from "@/lib/prefill/types";
import {
  APIFY_ACTOR_ID,
  ListingLookupError,
  buildApifyUrl,
  fullAddress,
  zillowApifyProvider,
} from "../zillow-apify";

const ADDRESS: PrefillAddress = {
  streetNumber: "8911",
  streetDir: "E",
  streetName: "Cave Creek Rd",
  city: "Carefree",
  zip: "85377",
};
const FULL = "8911 E Cave Creek Rd, Carefree, AZ 85377";

const mockFetch = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APIFY_TOKEN", "apify_test_token_123");
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("fullAddress", () => {
  it("prefers address.full when present", () => {
    expect(fullAddress({ ...ADDRESS, full: "  1 Main St, Phoenix, AZ 85001 " })).toBe(
      "1 Main St, Phoenix, AZ 85001",
    );
  });

  it("composes number + dir + street, city, AZ zip", () => {
    expect(fullAddress(ADDRESS)).toBe(FULL);
  });

  it("omits missing city/zip and the direction", () => {
    expect(fullAddress({ streetNumber: "12", streetName: "Oak Ave" })).toBe("12 Oak Ave, AZ");
    expect(fullAddress({ streetNumber: "12", streetName: "Oak Ave", city: "Mesa" })).toBe("12 Oak Ave, Mesa, AZ");
  });

  it("returns null without a street number or street name", () => {
    expect(fullAddress({ streetNumber: "", streetName: "Oak Ave" })).toBeNull();
    expect(fullAddress({ streetNumber: "12", streetName: "" })).toBeNull();
  });
});

describe("buildApifyUrl", () => {
  it("targets run-sync-get-dataset-items with token, timeout=60 and memory=1024", () => {
    const url = new URL(buildApifyUrl("tok"));
    expect(url.origin).toBe("https://api.apify.com");
    expect(url.pathname).toBe(`/v2/acts/${APIFY_ACTOR_ID}/run-sync-get-dataset-items`);
    expect(url.searchParams.get("token")).toBe("tok");
    expect(url.searchParams.get("timeout")).toBe("60");
    expect(url.searchParams.get("memory")).toBe("1024");
    expect(APIFY_ACTOR_ID).toBe("sian.agency~zillow-property-detail-scraper");
  });
});

describe("zillowApifyProvider.lookup", () => {
  it("POSTs { addresses: [full] } and returns the first item normalised", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse([{ hdpUrl: "https://www.zillow.com/homedetails/1_zpid/", waterSource: ["Public"], bedrooms: 3 }]),
    );

    const facts = await zillowApifyProvider.lookup(ADDRESS, new AbortController().signal);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(buildApifyUrl("apify_test_token_123"));
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ addresses: [FULL] });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(facts).toMatchObject({ url: "https://www.zillow.com/homedetails/1_zpid/", waterSource: "municipal", bedrooms: 3 });
  });

  it("returns null for an empty dataset (not found — Apify does not charge)", async () => {
    mockFetch.mockResolvedValue(jsonResponse([]));
    await expect(zillowApifyProvider.lookup(ADDRESS, new AbortController().signal)).resolves.toBeNull();
  });

  it("returns null when the dataset is not an array or the item is unmappable", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "bad" }));
    await expect(zillowApifyProvider.lookup(ADDRESS, new AbortController().signal)).resolves.toBeNull();
    mockFetch.mockResolvedValueOnce(jsonResponse([{ error: "Property not found" }]));
    await expect(zillowApifyProvider.lookup(ADDRESS, new AbortController().signal)).resolves.toBeNull();
  });

  it("returns null without calling Apify when no address can be composed", async () => {
    await expect(
      zillowApifyProvider.lookup({ streetNumber: "", streetName: "" }, new AbortController().signal),
    ).resolves.toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws ListingLookupError with the status on non-2xx, without leaking the token", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: { message: "Insufficient credit" } }, 402));
    const err = await zillowApifyProvider.lookup(ADDRESS, new AbortController().signal).catch((e) => e);
    expect(err).toBeInstanceOf(ListingLookupError);
    expect(err.status).toBe(402);
    expect(err.message).toBe("Apify responded 402");
    expect(err.message).not.toContain("apify_test_token_123");
  });

  it("throws when APIFY_TOKEN is missing, without calling fetch", async () => {
    vi.stubEnv("APIFY_TOKEN", "");
    await expect(zillowApifyProvider.lookup(ADDRESS, new AbortController().signal)).rejects.toThrow(
      "APIFY_TOKEN is not configured",
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("propagates an abort from the caller's signal", async () => {
    const controller = new AbortController();
    mockFetch.mockImplementation((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
    );
    const pending = zillowApifyProvider.lookup(ADDRESS, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow(/aborted/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/prefill/listing/__tests__/zillow-apify.test.ts`
Expected: FAIL — `zillow-apify` has no export named `zillowApifyProvider` / `buildApifyUrl` / `fullAddress` / `ListingLookupError`.

- [ ] **Step 3: Append the client to `zillow-apify.ts`**

Replace the import block at the top of `src/lib/prefill/listing/zillow-apify.ts` with:

```ts
import type { PrefillAddress } from "../types";
import type { ListingFacts, ListingProvider, ListingWaterSource } from "./provider";
```

Then add at the end of the file (after `normaliseListingItem`):

```ts
// ---------------------------------------------------------------------------
// Apify client
// ---------------------------------------------------------------------------

export const APIFY_ACTOR_ID = "sian.agency~zillow-property-detail-scraper";
const APIFY_RUN_SYNC_URL = `https://api.apify.com/v2/acts/${APIFY_ACTOR_ID}/run-sync-get-dataset-items`;
/** Spec §10: Apify 60 s. The actor's own `timeout` query param matches. */
export const APIFY_TIMEOUT_MS = 60_000;

export class ListingLookupError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ListingLookupError";
    this.status = status;
  }
}

/** The token travels only in the query string of this URL — never log or persist the URL. */
export function buildApifyUrl(token: string): string {
  const params = new URLSearchParams({ token, timeout: "60", memory: "1024" });
  return `${APIFY_RUN_SYNC_URL}?${params}`;
}

/**
 * Single-line address for the actor's `addresses` input:
 * "8911 E Cave Creek Rd, Carefree, AZ 85377". The app is Maricopa-only, so the
 * state is always AZ. Returns null when there is no street number or name.
 */
export function fullAddress(address: PrefillAddress): string | null {
  const explicit = address.full?.trim();
  if (explicit) return explicit;
  const number = address.streetNumber?.trim();
  const name = address.streetName?.trim();
  if (!number || !name) return null;
  const street = [number, address.streetDir?.trim(), name].filter(Boolean).join(" ");
  const stateZip = ["AZ", address.zip?.trim()].filter(Boolean).join(" ");
  return [street, address.city?.trim(), stateZip].filter(Boolean).join(", ");
}

export const zillowApifyProvider: ListingProvider = {
  name: "zillow",
  async lookup(address: PrefillAddress, signal: AbortSignal): Promise<ListingFacts | null> {
    const token = process.env.APIFY_TOKEN;
    if (!token) throw new ListingLookupError("APIFY_TOKEN is not configured");
    const full = fullAddress(address);
    if (!full) return null;

    const res = await fetch(buildApifyUrl(token), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addresses: [full] }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(APIFY_TIMEOUT_MS)]),
    });
    if (!res.ok) throw new ListingLookupError(`Apify responded ${res.status}`, res.status);

    const items: unknown = await res.json();
    if (!Array.isArray(items) || items.length === 0) return null;
    return normaliseListingItem(items[0]);
  },
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/prefill/listing/`
Expected: PASS — both `normalise.test.ts` and `zillow-apify.test.ts` green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/prefill/listing/zillow-apify.ts src/lib/prefill/listing/__tests__/zillow-apify.test.ts
git commit -m "feat(prefill): Apify Zillow listing client with 60 s timeout and token-safe errors"
```

---

### Task 3: `mapListingFacts` — water source, bedrooms, sewer warning

**Files:**
- Modify: `src/lib/prefill/map-facts-to-fields.ts` (phase 3 file; add one exported function + one helper, keep `mapPermitFacts` / `dedupeProposals` untouched)
- Test: `src/lib/prefill/__tests__/map-listing-facts.test.ts`

**Interfaces:**
- Consumes: `ListingFacts` (Task 1), `ProposedField` (`src/lib/prefill/types.ts`), `WATER_KEYS`/`SEWER_KEYS`/`findFact`/`flattenText` (Task 1), `dedupeProposals` (phase 3), `WATER_SOURCES` (`src/lib/constants/inspection.ts`).
- Produces: `mapListingFacts(facts: ListingFacts): ProposedField[]`, `LISTING_WATER_CONFIDENCE = 0.8`, `LISTING_BEDROOMS_CONFIDENCE = 0.85`, `LISTING_SEWER_WARNING = 'Listing says "Sewer" — confirm this property is on septic'`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/prefill/__tests__/map-listing-facts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ListingFacts } from "@/lib/prefill/listing/provider";
import {
  LISTING_BEDROOMS_CONFIDENCE,
  LISTING_SEWER_WARNING,
  LISTING_WATER_CONFIDENCE,
  dedupeProposals,
  mapListingFacts,
} from "@/lib/prefill/map-facts-to-fields";
import type { ProposedField } from "@/lib/prefill/types";

const URL = "https://www.zillow.com/homedetails/8911-E-Cave-Creek-Rd/7921650_zpid/";

function facts(overrides: Partial<ListingFacts> = {}): ListingFacts {
  return { provider: "zillow", url: URL, raw: {}, ...overrides };
}

describe("mapListingFacts", () => {
  it("proposes facilityInfo.waterSource at confidence 0.8 with the Zillow URL and quoted evidence", () => {
    const out = mapListingFacts(facts({ waterSource: "private_well", raw: { resoFacts: { waterSource: ["Private Well"] } } }));
    expect(out).toEqual([
      {
        fieldPath: "facilityInfo.waterSource",
        value: "private_well",
        kind: "fill",
        provenance: {
          source: "listing",
          confidence: LISTING_WATER_CONFIDENCE,
          explanation: "Zillow listing · Water source: Private Well",
          evidence: "Water: Private Well",
          sourceUrl: URL,
        },
      },
    ]);
    expect(LISTING_WATER_CONFIDENCE).toBe(0.8);
  });

  it("proposes designFlow.numberOfBedrooms as a string at confidence 0.85", () => {
    const out = mapListingFacts(facts({ bedrooms: 3 }));
    expect(out).toEqual([
      {
        fieldPath: "designFlow.numberOfBedrooms",
        value: "3",
        kind: "fill",
        provenance: {
          source: "listing",
          confidence: LISTING_BEDROOMS_CONFIDENCE,
          explanation: "Zillow listing · 3 bedrooms",
          evidence: "Bedrooms: 3",
          sourceUrl: URL,
        },
      },
    ]);
    expect(LISTING_BEDROOMS_CONFIDENCE).toBe(0.85);
  });

  it("ignores non-positive or fractional bedroom counts", () => {
    expect(mapListingFacts(facts({ bedrooms: 0 }))).toEqual([]);
    expect(mapListingFacts(facts({ bedrooms: 2.5 }))).toEqual([]);
  });

  it('adds a "warning" proposal on facilityInfo.wastewaterSource when the listing says sewer', () => {
    const out = mapListingFacts(facts({ sewer: "sewer", raw: { sewer: ["Public Sewer"] } }));
    expect(out).toEqual([
      {
        fieldPath: "facilityInfo.wastewaterSource",
        value: "",
        kind: "warning",
        provenance: {
          source: "listing",
          confidence: LISTING_WATER_CONFIDENCE,
          explanation: LISTING_SEWER_WARNING,
          evidence: "Sewer: Public Sewer",
          sourceUrl: URL,
        },
      },
    ]);
    expect(LISTING_SEWER_WARNING).toBe('Listing says "Sewer" — confirm this property is on septic');
  });

  it("proposes nothing for septic / unknown sewer and for year built, baths, lot size", () => {
    expect(mapListingFacts(facts({ sewer: "septic", yearBuilt: 1998, bathrooms: 2, lotSqft: 5000 }))).toEqual([]);
    expect(mapListingFacts(facts({ sewer: "unknown" }))).toEqual([]);
  });

  it("omits sourceUrl when the listing has no URL", () => {
    const out = mapListingFacts(facts({ url: "", bedrooms: 2 }));
    expect(out[0].provenance).not.toHaveProperty("sourceUrl");
  });

  it("returns all three proposals together, in a stable order", () => {
    const out = mapListingFacts(facts({ waterSource: "municipal", bedrooms: 4, sewer: "sewer" }));
    expect(out.map((p) => `${p.kind}:${p.fieldPath}`)).toEqual([
      "fill:facilityInfo.waterSource",
      "fill:designFlow.numberOfBedrooms",
      "warning:facilityInfo.wastewaterSource",
    ]);
  });
});

describe("dedupeProposals with listing proposals (spec §7: permit wins over listing)", () => {
  const permitWater: ProposedField = {
    fieldPath: "facilityInfo.waterSource",
    value: "municipal",
    kind: "fill",
    provenance: { source: "permit", confidence: 0.7, explanation: "Permit 000972 p.1" },
  };

  it("keeps the permit water source even when the listing is more confident", () => {
    const [listingWater] = mapListingFacts(facts({ waterSource: "private_well" }));
    const out = dedupeProposals([listingWater, permitWater]);
    expect(out).toEqual([permitWater]);
  });

  it("keeps a listing sewer warning alongside a permit fill for the same field", () => {
    const [warning] = mapListingFacts(facts({ sewer: "sewer" }));
    const permitFill: ProposedField = {
      fieldPath: "facilityInfo.wastewaterSource",
      value: "residential",
      kind: "fill",
      provenance: { source: "permit", confidence: 0.9, explanation: "Permit" },
    };
    const out = dedupeProposals([warning, permitFill]);
    expect(out).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/prefill/__tests__/map-listing-facts.test.ts`
Expected: FAIL — `mapListingFacts` / `LISTING_WATER_CONFIDENCE` are not exported from `map-facts-to-fields`.

- [ ] **Step 3: Add `mapListingFacts` to `map-facts-to-fields.ts`**

Add these imports at the top of `src/lib/prefill/map-facts-to-fields.ts` (merge with the existing import block; keep phase 3's imports):

```ts
import { WATER_SOURCES } from "@/lib/constants/inspection";
import type { ListingFacts } from "./listing/provider";
import { SEWER_KEYS, WATER_KEYS, findFact, flattenText } from "./listing/zillow-apify";
```

Append at the end of the file (after `dedupeProposals`):

```ts
// ---------------------------------------------------------------------------
// Listing (Zillow) — spec §5.3 / §7
// ---------------------------------------------------------------------------

/** Listing data can be stale, so listing fills sit just above the 0.75 gate. */
export const LISTING_WATER_CONFIDENCE = 0.8;
export const LISTING_BEDROOMS_CONFIDENCE = 0.85;
export const LISTING_SEWER_WARNING = 'Listing says "Sewer" — confirm this property is on septic';

/** Original (un-normalised) text of a listing fact, for the popover evidence line. */
function listingEvidence(raw: Record<string, unknown>, keys: string[]): string | undefined {
  const value = findFact(raw, keys);
  if (value === undefined) return undefined;
  if (typeof value === "string") return value.trim() || undefined;
  if (Array.isArray(value)) {
    const parts = value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
    return parts.length ? parts.join(", ") : undefined;
  }
  const text = flattenText(value);
  return text ? text : undefined;
}

export function mapListingFacts(facts: ListingFacts): ProposedField[] {
  const out: ProposedField[] = [];
  const sourceUrl = facts.url ? { sourceUrl: facts.url } : {};

  if (facts.waterSource) {
    const label = WATER_SOURCES.find((w) => w.value === facts.waterSource)?.label ?? facts.waterSource;
    const rawText = listingEvidence(facts.raw, WATER_KEYS);
    out.push({
      fieldPath: "facilityInfo.waterSource",
      value: facts.waterSource,
      kind: "fill",
      provenance: {
        source: "listing",
        confidence: LISTING_WATER_CONFIDENCE,
        explanation: `Zillow listing · Water source: ${rawText ?? label}`,
        ...(rawText ? { evidence: `Water: ${rawText}` } : {}),
        ...sourceUrl,
      },
    });
  }

  if (typeof facts.bedrooms === "number" && Number.isInteger(facts.bedrooms) && facts.bedrooms > 0) {
    out.push({
      fieldPath: "designFlow.numberOfBedrooms",
      value: String(facts.bedrooms),
      kind: "fill",
      provenance: {
        source: "listing",
        confidence: LISTING_BEDROOMS_CONFIDENCE,
        explanation: `Zillow listing · ${facts.bedrooms} bedrooms`,
        evidence: `Bedrooms: ${facts.bedrooms}`,
        ...sourceUrl,
      },
    });
  }

  // A listing on sewer proposes no value — it warns the inspector (amber chip).
  if (facts.sewer === "sewer") {
    const rawText = listingEvidence(facts.raw, SEWER_KEYS);
    out.push({
      fieldPath: "facilityInfo.wastewaterSource",
      value: "",
      kind: "warning",
      provenance: {
        source: "listing",
        confidence: LISTING_WATER_CONFIDENCE,
        explanation: LISTING_SEWER_WARNING,
        ...(rawText ? { evidence: `Sewer: ${rawText}` } : {}),
        ...sourceUrl,
      },
    });
  }

  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/prefill/__tests__/map-listing-facts.test.ts src/lib/prefill/__tests__/map-facts-to-fields.test.ts`
Expected: PASS — the new file green, and phase 3's `map-facts-to-fields.test.ts` still green (nothing there changed).

- [ ] **Step 5: Commit**

```bash
git add src/lib/prefill/map-facts-to-fields.ts src/lib/prefill/__tests__/map-listing-facts.test.ts
git commit -m "feat(prefill): map listing facts to water-source/bedroom proposals and sewer warning"
```

---

### Task 4: `runListingStage` — skip / not_found / done / error

**Files:**
- Create: `src/lib/prefill/listing/index.ts`
- Test: `src/lib/prefill/listing/__tests__/index.test.ts`

**Interfaces:**
- Consumes: `StageContext`, `StageResult` (phase 1 — `src/lib/prefill/run-prefill.ts`; if phase 1 exported them from `src/lib/prefill/types.ts`, change only the import line), `PrefillInput`, `PrefillStage`, `StageLink` (`src/lib/prefill/types.ts`), `ListingProvider`, `zillowApifyProvider`, `fullAddress`, `mapListingFacts`, `WATER_SOURCES`.
- Produces: `runListingStage(input: PrefillInput, ctx: StageContext, provider: ListingProvider = zillowApifyProvider): Promise<StageResult>`, `summariseListing(facts: ListingFacts): string`, `safeErrorMessage(err: unknown): string`. Task 5 calls `runListingStage(input, ctx)`.

Behaviour table (spec §5.3, §10):

| Condition | `stage.status` | `stage.summary` | `stage.links` | proposals |
|---|---|---|---|---|
| no composable address | `skipped` | `No address to search` | `[]` | `[]` |
| `APIFY_TOKEN` unset | `skipped` | `Listing lookup not configured` | `[]` | `[]` |
| provider returns `null` | `not_found` | `No Zillow listing found for <full address>` | `[]` | `[]` |
| provider returns facts | `done` | `summariseListing(facts)` | `[{ label: "Open on Zillow", url }]` when `facts.url` | `mapListingFacts(facts)` |
| provider throws / aborts | `error` | `Zillow lookup failed` | `[]` | `[]` (+ `stage.error`) |

- [ ] **Step 1: Write the failing tests**

Create `src/lib/prefill/listing/__tests__/index.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ListingFacts, ListingProvider } from "@/lib/prefill/listing/provider";
import type { PrefillInput } from "@/lib/prefill/types";
import { runListingStage, safeErrorMessage, summariseListing } from "../index";

const INPUT: PrefillInput = {
  apn: "219-11-121",
  address: { streetNumber: "8911", streetDir: "E", streetName: "Cave Creek Rd", city: "Carefree", zip: "85377" },
};
const FULL = "8911 E Cave Creek Rd, Carefree, AZ 85377";
const URL = "https://www.zillow.com/homedetails/7921650_zpid/";

function makeCtx() {
  return {
    inspectionId: "insp-1",
    runId: "run-1",
    signal: new AbortController().signal,
    progress: vi.fn().mockResolvedValue(undefined),
  };
}

function providerReturning(result: ListingFacts | null | Error): ListingProvider & { lookup: ReturnType<typeof vi.fn> } {
  const lookup = vi.fn();
  if (result instanceof Error) lookup.mockRejectedValue(result);
  else lookup.mockResolvedValue(result);
  return { name: "zillow", lookup };
}

beforeEach(() => {
  vi.stubEnv("APIFY_TOKEN", "apify_test_token");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("runListingStage", () => {
  it("skips when there is no address", async () => {
    const provider = providerReturning(null);
    const result = await runListingStage({ apn: "219-11-121" }, makeCtx(), provider);
    expect(result.stage).toMatchObject({ status: "skipped", summary: "No address to search", links: [] });
    expect(result.proposals).toEqual([]);
    expect(provider.lookup).not.toHaveBeenCalled();
  });

  it("skips when APIFY_TOKEN is not configured", async () => {
    vi.stubEnv("APIFY_TOKEN", "");
    const provider = providerReturning(null);
    const result = await runListingStage(INPUT, makeCtx(), provider);
    expect(result.stage).toMatchObject({ status: "skipped", summary: "Listing lookup not configured", links: [] });
    expect(provider.lookup).not.toHaveBeenCalled();
  });

  it("reports progress, passes the composed full address and the abort signal to the provider", async () => {
    const provider = providerReturning(null);
    const ctx = makeCtx();
    await runListingStage(INPUT, ctx, provider);
    expect(ctx.progress).toHaveBeenCalledWith(
      expect.objectContaining({ status: "running", summary: `Searching Zillow for ${FULL}…` }),
    );
    expect(provider.lookup).toHaveBeenCalledWith(expect.objectContaining({ ...INPUT.address, full: FULL }), ctx.signal);
  });

  it("returns not_found with the searched address when the provider returns null", async () => {
    const result = await runListingStage(INPUT, makeCtx(), providerReturning(null));
    expect(result.stage).toMatchObject({
      status: "not_found",
      summary: `No Zillow listing found for ${FULL}`,
      links: [],
    });
    expect(result.stage.startedAt).toBeTruthy();
    expect(result.stage.finishedAt).toBeTruthy();
    expect(result.proposals).toEqual([]);
  });

  it("returns done with the Zillow link, a summary and mapped proposals", async () => {
    const facts: ListingFacts = {
      provider: "zillow",
      url: URL,
      waterSource: "private_well",
      sewer: "septic",
      bedrooms: 3,
      yearBuilt: 1998,
      raw: {},
    };
    const result = await runListingStage(INPUT, makeCtx(), providerReturning(facts));
    expect(result.stage).toMatchObject({
      status: "done",
      summary: "Water: Private Well · 3 bed · Sewer: septic · Built 1998",
      links: [{ label: "Open on Zillow", url: URL }],
    });
    expect(result.proposals.map((p) => p.fieldPath)).toEqual([
      "facilityInfo.waterSource",
      "designFlow.numberOfBedrooms",
    ]);
  });

  it("returns done with no link when the listing has no URL", async () => {
    const facts: ListingFacts = { provider: "zillow", url: "", bedrooms: 2, raw: {} };
    const result = await runListingStage(INPUT, makeCtx(), providerReturning(facts));
    expect(result.stage.status).toBe("done");
    expect(result.stage.links).toEqual([]);
  });

  it("returns error (never throws) when the provider fails, with a token-free message", async () => {
    const err = new Error("fetch failed: https://api.apify.com/v2/acts/x?token=apify_test_token&timeout=60");
    const result = await runListingStage(INPUT, makeCtx(), providerReturning(err));
    expect(result.stage.status).toBe("error");
    expect(result.stage.summary).toBe("Zillow lookup failed");
    expect(result.stage.error).toBe("fetch failed: https://api.apify.com/v2/acts/x?token=***&timeout=60");
    expect(result.stage.error).not.toContain("apify_test_token");
    expect(result.proposals).toEqual([]);
  });

  it("returns error when progress persistence throws", async () => {
    const ctx = makeCtx();
    ctx.progress.mockRejectedValue(new Error("db down"));
    const result = await runListingStage(INPUT, ctx, providerReturning(null));
    expect(result.stage.status).toBe("error");
    expect(result.stage.error).toBe("db down");
  });

  it("uses input.address.full verbatim when present", async () => {
    const provider = providerReturning(null);
    const input: PrefillInput = { address: { streetNumber: "1", streetName: "Main St", full: "1 Main St, Phoenix, AZ 85001" } };
    const result = await runListingStage(input, makeCtx(), provider);
    expect(result.stage.summary).toBe("No Zillow listing found for 1 Main St, Phoenix, AZ 85001");
  });
});

describe("summariseListing", () => {
  it("joins the known facts with · and labels water sources from WATER_SOURCES", () => {
    expect(summariseListing({ provider: "zillow", url: "", waterSource: "municipal", raw: {} })).toBe("Water: Municipal System");
    expect(summariseListing({ provider: "zillow", url: "", sewer: "sewer", bedrooms: 4, raw: {} })).toBe("4 bed · Sewer: sewer");
  });

  it("falls back to a fixed line when no septic-relevant fact is present", () => {
    expect(summariseListing({ provider: "zillow", url: "", bathrooms: 2, raw: {} })).toBe("Listing found — no water/sewer/bedroom facts");
  });
});

describe("safeErrorMessage", () => {
  it("redacts token query values and handles non-Error values", () => {
    expect(safeErrorMessage(new Error("x?token=abc123&y=1"))).toBe("x?token=***&y=1");
    expect(safeErrorMessage("plain")).toBe("plain");
    expect(safeErrorMessage(undefined)).toBe("Unknown error");
  });

  it("names aborts explicitly", () => {
    expect(safeErrorMessage(new DOMException("The operation was aborted.", "AbortError"))).toBe("Timed out");
    expect(safeErrorMessage(new DOMException("timed out", "TimeoutError"))).toBe("Timed out");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/prefill/listing/__tests__/index.test.ts`
Expected: FAIL — `Failed to resolve import "../index"`.

- [ ] **Step 3: Write `listing/index.ts`**

Create `src/lib/prefill/listing/index.ts`:

```ts
import { WATER_SOURCES } from "@/lib/constants/inspection";
import { mapListingFacts } from "../map-facts-to-fields";
import type { StageContext, StageResult } from "@/lib/prefill/stage";
import type { PrefillInput, PrefillStage, StageLink } from "../types";
import type { ListingFacts, ListingProvider } from "./provider";
import { fullAddress, zillowApifyProvider } from "./zillow-apify";

/** One line for the tile, e.g. "Water: Private Well · 3 bed · Sewer: septic · Built 1998". */
export function summariseListing(facts: ListingFacts): string {
  const parts: string[] = [];
  if (facts.waterSource) {
    const label = WATER_SOURCES.find((w) => w.value === facts.waterSource)?.label ?? facts.waterSource;
    parts.push(`Water: ${label}`);
  }
  if (typeof facts.bedrooms === "number") parts.push(`${facts.bedrooms} bed`);
  if (facts.sewer) parts.push(`Sewer: ${facts.sewer}`);
  if (typeof facts.yearBuilt === "number") parts.push(`Built ${facts.yearBuilt}`);
  return parts.length ? parts.join(" · ") : "Listing found — no water/sewer/bedroom facts";
}

/** Error text safe to persist on the run: no token, aborts named. */
export function safeErrorMessage(err: unknown): string {
  if (err instanceof DOMException && (err.name === "AbortError" || err.name === "TimeoutError")) {
    return "Timed out";
  }
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (!message) return "Unknown error";
  return message.replace(/token=[^&\s]+/g, "token=***");
}

function finished(stage: Omit<PrefillStage, "finishedAt">): PrefillStage {
  return { ...stage, finishedAt: new Date().toISOString() };
}

/**
 * Listing stage (spec §5.3). Never throws — every outcome is a StageResult.
 * `provider` is injectable for tests; production uses the Apify Zillow actor.
 */
export async function runListingStage(
  input: PrefillInput,
  ctx: StageContext,
  provider: ListingProvider = zillowApifyProvider,
): Promise<StageResult> {
  const startedAt = new Date().toISOString();
  const full = input.address ? fullAddress(input.address) : null;

  if (!full) {
    return {
      stage: finished({ status: "skipped", startedAt, summary: "No address to search", links: [] }),
      proposals: [],
    };
  }
  if (!process.env.APIFY_TOKEN) {
    return {
      stage: finished({ status: "skipped", startedAt, summary: "Listing lookup not configured", links: [] }),
      proposals: [],
    };
  }

  try {
    await ctx.progress({ status: "running", startedAt, summary: `Searching Zillow for ${full}…`, links: [] });

    const facts = await provider.lookup({ ...input.address, full } as NonNullable<PrefillInput["address"]>, ctx.signal);
    if (!facts) {
      return {
        stage: finished({ status: "not_found", startedAt, summary: `No Zillow listing found for ${full}`, links: [] }),
        proposals: [],
      };
    }

    const links: StageLink[] = facts.url ? [{ label: "Open on Zillow", url: facts.url }] : [];
    return {
      stage: finished({ status: "done", startedAt, summary: summariseListing(facts), links }),
      proposals: mapListingFacts(facts),
    };
  } catch (err) {
    return {
      stage: finished({
        status: "error",
        startedAt,
        summary: "Zillow lookup failed",
        error: safeErrorMessage(err),
        links: [],
      }),
      proposals: [],
    };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/prefill/listing/`
Expected: PASS — `index.test.ts`, `zillow-apify.test.ts`, `normalise.test.ts` all green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/prefill/listing/index.ts src/lib/prefill/listing/__tests__/index.test.ts
git commit -m "feat(prefill): runListingStage — skipped/not_found/done/error with Zillow link"
```

---

### Task 5: Wire the listing stage into `run-prefill.ts` (parallel with permits)

**Files:**
- Modify: `src/lib/prefill/run-prefill.ts` (phase 1 file, already modified by phases 2–3)
- Test: `src/lib/prefill/__tests__/run-prefill.listing.test.ts`

**Interfaces:**
- Consumes: `runListingStage` (Task 4), `runAssessorStage` (phase 1, `src/lib/prefill/assessor.ts`), `runPermitsStage` + `runPermitsSelection` (phase 2, `src/lib/prefill/permits/index.ts`), `dedupeProposals` (phase 3), `inspectionPrefillRuns` (schema), `emptyStages`, `PrefillInput`, `PrefillStages`, `ProposedField`.
- Produces: unchanged public contract — `runPrefill(runId)`, `continuePrefillAfterSelection(runId, candidateKeys)`, `StageContext`, `StageResult`. After this task `stages.listing` is real and listing proposals survive the `/select` round-trip.

The phase-1 file contains a stub for the listing stage (a local function or inline object returning `{ status: "skipped", summary: "Not available yet", links: [] }` with no proposals). This task deletes the stub and calls the real stage inside the same `Promise.all` as assessor and permits. The tests below mock the DB with a chain-agnostic proxy so they hold regardless of how phases 1–3 shaped the queries.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/prefill/__tests__/run-prefill.listing.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrefillStage, ProposedField } from "@/lib/prefill/types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { dbState, mockRunAssessorStage, mockRunListingStage, mockRunPermitsStage, mockRunPermitsSelection } =
  vi.hoisted(() => ({
    dbState: {
      row: null as Record<string, unknown> | null,
      calls: [] as Array<{ method: string; args: unknown[] }>,
    },
    mockRunAssessorStage: vi.fn(),
    mockRunListingStage: vi.fn(),
    mockRunPermitsStage: vi.fn(),
    mockRunPermitsSelection: vi.fn(),
  }));

// Chain-agnostic Drizzle mock: every property is callable, every call records
// itself and returns the proxy, and awaiting the proxy resolves to the configured
// run row — as an array that ALSO carries the row's properties, so both
// `const [run] = await db.select()…` and `const run = await db.query…findFirst()`
// see the row. `db.transaction(fn)` runs `fn` with the same proxy.
vi.mock("@/lib/db", () => {
  const handler: ProxyHandler<() => void> = {
    get(_target, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
          const row = dbState.row;
          const value = row ? Object.assign([row], row) : [];
          return Promise.resolve(value).then(resolve, reject);
        };
      }
      if (prop === "transaction") {
        return async (fn: (tx: unknown) => unknown) => fn(proxy);
      }
      return (...args: unknown[]) => {
        dbState.calls.push({ method: String(prop), args });
        return proxy;
      };
    },
    apply() {
      return proxy;
    },
  };
  const proxy: unknown = new Proxy(() => {}, handler);
  return { db: proxy };
});

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/prefill/assessor", () => ({ runAssessorStage: mockRunAssessorStage }));
vi.mock("@/lib/prefill/listing", () => ({ runListingStage: mockRunListingStage }));
vi.mock("@/lib/prefill/permits", () => ({
  runPermitsStage: mockRunPermitsStage,
  runPermitsSelection: mockRunPermitsSelection,
}));

import { continuePrefillAfterSelection, runPrefill } from "@/lib/prefill/run-prefill";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RUN_ID = "run-1";
const INPUT = {
  apn: "219-11-121",
  address: { streetNumber: "8911", streetDir: "E", streetName: "Cave Creek Rd", city: "Carefree", zip: "85377" },
};

function doneStage(summary: string, links: PrefillStage["links"] = []): PrefillStage {
  const at = new Date().toISOString();
  return { status: "done", startedAt: at, finishedAt: at, summary, links };
}

const LISTING_PROPOSAL: ProposedField = {
  fieldPath: "facilityInfo.waterSource",
  value: "private_well",
  kind: "fill",
  provenance: { source: "listing", confidence: 0.8, explanation: "Zillow listing · Water source: Private Well" },
};
const PERMIT_PROPOSAL: ProposedField = {
  fieldPath: "septicTank.tankCapacity",
  value: "1250",
  kind: "fill",
  provenance: { source: "permit", confidence: 0.9, explanation: "Permit OW-17-00474 p.1" },
};

/** Every argument passed to `.set(...)`, in call order. */
function setCalls(): Array<Record<string, unknown>> {
  return dbState.calls.filter((c) => c.method === "set").map((c) => c.args[0] as Record<string, unknown>);
}

function finalSet(): Record<string, unknown> {
  const sets = setCalls();
  return sets[sets.length - 1];
}

beforeEach(() => {
  vi.clearAllMocks();
  dbState.calls = [];
  dbState.row = {
    id: RUN_ID,
    inspectionId: "insp-1",
    trigger: "manual",
    status: "queued",
    input: INPUT,
    stages: {},
    proposals: [],
    candidates: [],
    error: null,
    appliedAt: null,
    createdBy: null,
    createdAt: new Date(),
    finishedAt: null,
  };
  mockRunAssessorStage.mockResolvedValue({ stage: doneStage("Parcel found"), proposals: [] });
  mockRunListingStage.mockResolvedValue({
    stage: doneStage("Water: Private Well", [{ label: "Open on Zillow", url: "https://www.zillow.com/homedetails/1_zpid/" }]),
    proposals: [LISTING_PROPOSAL],
  });
  mockRunPermitsStage.mockResolvedValue({ stage: doneStage("1 permit found"), proposals: [PERMIT_PROPOSAL] });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runPrefill — listing stage wiring", () => {
  it("calls runListingStage with the run input and a StageContext", async () => {
    await runPrefill(RUN_ID);

    expect(mockRunListingStage).toHaveBeenCalledTimes(1);
    const [input, ctx] = mockRunListingStage.mock.calls[0];
    expect(input).toEqual(INPUT);
    expect(ctx).toMatchObject({ inspectionId: "insp-1", runId: RUN_ID });
    expect(ctx.signal).toBeInstanceOf(AbortSignal);
    expect(typeof ctx.progress).toBe("function");
  });

  it("starts the listing stage before the permits stage finishes (parallel, not sequential)", async () => {
    let listingStarted = false;
    mockRunListingStage.mockImplementation(async () => {
      listingStarted = true;
      return { stage: doneStage("Water: Private Well"), proposals: [LISTING_PROPOSAL] };
    });
    mockRunPermitsStage.mockImplementation(async () => {
      // Give the event loop a few turns; if the orchestrator awaited permits
      // before starting listing, `listingStarted` is still false here.
      for (let i = 0; i < 5 && !listingStarted; i += 1) await Promise.resolve();
      if (!listingStarted) throw new Error("listing stage was not started concurrently with permits");
      return { stage: doneStage("1 permit found"), proposals: [PERMIT_PROPOSAL] };
    });

    await runPrefill(RUN_ID);

    expect(finalSet()).toMatchObject({ status: "done" });
  });

  it("persists the listing stage (with its link) and merges listing proposals into the run", async () => {
    await runPrefill(RUN_ID);

    const final = finalSet();
    expect(final.status).toBe("done");
    const stages = final.stages as { listing: PrefillStage };
    expect(stages.listing).toMatchObject({
      status: "done",
      summary: "Water: Private Well",
      links: [{ label: "Open on Zillow", url: "https://www.zillow.com/homedetails/1_zpid/" }],
    });
    expect(final.proposals).toEqual(expect.arrayContaining([LISTING_PROPOSAL, PERMIT_PROPOSAL]));
  });

  it("persists listing progress updates while the stage runs", async () => {
    mockRunListingStage.mockImplementation(async (_input, ctx) => {
      await ctx.progress({ status: "running", summary: "Searching Zillow for 8911 E Cave Creek Rd, Carefree, AZ 85377…" });
      return { stage: doneStage("Water: Private Well"), proposals: [] };
    });

    await runPrefill(RUN_ID);

    const running = setCalls().find((s) => (s.stages as { listing?: PrefillStage } | undefined)?.listing?.status === "running");
    expect(running).toBeDefined();
  });

  it("a listing error never fails the run", async () => {
    mockRunListingStage.mockResolvedValue({
      stage: { ...doneStage("Zillow lookup failed"), status: "error", error: "Apify responded 402" },
      proposals: [],
    });

    await runPrefill(RUN_ID);

    const final = finalSet();
    expect(final.status).toBe("done");
    expect((final.stages as { listing: PrefillStage }).listing).toMatchObject({ status: "error", error: "Apify responded 402" });
    expect(final.proposals).toEqual([PERMIT_PROPOSAL]);
  });

  it("keeps the permit proposal when listing and permit propose the same field", async () => {
    mockRunPermitsStage.mockResolvedValue({
      stage: doneStage("1 permit found"),
      proposals: [{ ...PERMIT_PROPOSAL, fieldPath: "facilityInfo.waterSource", value: "municipal" }],
    });

    await runPrefill(RUN_ID);

    const proposals = finalSet().proposals as ProposedField[];
    const water = proposals.filter((p) => p.fieldPath === "facilityInfo.waterSource");
    expect(water).toHaveLength(1);
    expect(water[0].provenance.source).toBe("permit");
  });
});

describe("continuePrefillAfterSelection — keeps listing proposals", () => {
  it("merges the newly extracted permit proposals with the run's existing non-permit proposals", async () => {
    dbState.row = {
      ...(dbState.row as Record<string, unknown>),
      status: "running",
      stages: { assessor: doneStage("Parcel found"), listing: doneStage("Water: Private Well"), permits: { status: "running", links: [] } },
      proposals: [LISTING_PROPOSAL],
      candidates: [{ key: "edms_env:000972:PERMIT:2015-09-11", archive: "edms_env", permitNumber: "000972", docType: "PERMIT", score: 5 }],
    };
    mockRunPermitsSelection.mockResolvedValue({ stage: doneStage("1 permit stored"), proposals: [PERMIT_PROPOSAL] });

    await continuePrefillAfterSelection(RUN_ID, ["edms_env:000972:PERMIT:2015-09-11"]);

    const final = finalSet();
    expect(final.status).toBe("done");
    expect(final.proposals).toEqual(expect.arrayContaining([LISTING_PROPOSAL, PERMIT_PROPOSAL]));
  });
});
```

> If `run-prefill.ts` imports server modules beyond those mocked above (check its import block), add a `vi.mock("<module>", () => ({ ... }))` line per module next to the others so the file loads without a DB/API key. Do not weaken the assertions.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/prefill/__tests__/run-prefill.listing.test.ts`
Expected: FAIL — `mockRunListingStage` is never called (`expected "spy" to be called 1 times, but got 0 times`) because the stub is still in place; the `continuePrefillAfterSelection` test fails on the missing listing proposal.

- [ ] **Step 3: Replace the listing stub in `runPrefill`**

In `src/lib/prefill/run-prefill.ts`:

1. Add the import (alphabetical with the other stage imports):

```ts
import { runListingStage } from "./listing";
```

2. Delete the phase-1 stub (the local `listingStub`/inline `{ status: "skipped", summary: "Not available yet", links: [] }` result and the `proposals: []` that went with it).

3. Make the three stages run in one `Promise.all`. The complete `runPrefill` after the change reads as follows — if phases 1–3 named the local helpers differently (`persistStages`, `ctxFor`, …) keep their names and apply only the two listing-related edits (`runListingStage(input, ctxFor("listing"))` inside the same `Promise.all` as permits, and `listing.proposals` included in the `dedupeProposals` call):

```ts
export async function runPrefill(runId: string): Promise<void> {
  const [run] = await db
    .select()
    .from(inspectionPrefillRuns)
    .where(eq(inspectionPrefillRuns.id, runId))
    .limit(1);
  if (!run || run.status !== "queued") return;

  const input = (run.input ?? {}) as PrefillInput;
  const stages: PrefillStages = { ...emptyStages(), ...(run.stages as Partial<PrefillStages>) };
  const controller = new AbortController();
  const budget = setTimeout(() => controller.abort(), TOTAL_BUDGET_MS);

  const persistStages = () =>
    db.update(inspectionPrefillRuns).set({ stages }).where(eq(inspectionPrefillRuns.id, runId));

  const ctxFor = (name: keyof PrefillStages): StageContext => ({
    inspectionId: run.inspectionId,
    runId,
    signal: controller.signal,
    progress: async (partial) => {
      stages[name] = { ...stages[name], ...partial };
      await persistStages();
    },
  });

  try {
    await db
      .update(inspectionPrefillRuns)
      .set({ status: "running", stages })
      .where(eq(inspectionPrefillRuns.id, runId));

    // All three stages are independent (spec §3) — run them concurrently.
    // Each stage never throws; it returns its own status/summary/error.
    const [assessor, listing, permits] = await Promise.all([
      runAssessorStage(input, ctxFor("assessor")),
      runListingStage(input, ctxFor("listing")),
      runPermitsStage(input, ctxFor("permits")),
    ]);
    stages.assessor = assessor.stage;
    stages.listing = listing.stage;
    stages.permits = permits.stage;

    const proposals = dedupeProposals([
      ...assessor.proposals,
      ...listing.proposals,
      ...permits.proposals,
    ]);
    const candidates = permits.candidates ?? [];
    const awaiting = candidates.length > 0;

    await db
      .update(inspectionPrefillRuns)
      .set({
        status: awaiting ? "awaiting_selection" : "done",
        stages,
        proposals,
        candidates,
        finishedAt: awaiting ? null : new Date(),
      })
      .where(eq(inspectionPrefillRuns.id, runId));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Prefill failed";
    await db
      .update(inspectionPrefillRuns)
      .set({ status: "failed", error: message, stages, finishedAt: new Date() })
      .where(eq(inspectionPrefillRuns.id, runId))
      .catch(() => undefined);
  } finally {
    clearTimeout(budget);
  }
}
```

(`TOTAL_BUDGET_MS = 240_000`, `StageContext`, `dedupeProposals`, `runAssessorStage`, `runPermitsStage`, `emptyStages`, `PrefillInput`, `PrefillStages` already exist in this file from phases 1–3.)

4. In `continuePrefillAfterSelection` (phase 2/3), find where the run's `proposals` are written after the selected candidates are stored/extracted. It must **merge** with the proposals already on the run rather than overwrite them, so the assessor and listing proposals persisted before `awaiting_selection` survive. The write becomes:

```ts
    const existing = (run.proposals as ProposedField[]).filter((p) => p.provenance.source !== "permit");
    const proposals = dedupeProposals([...existing, ...selection.proposals]);
```

where `selection` is the `StageResult` returned by `runPermitsSelection(...)` (phase 2's name) and `run` is the row loaded at the top of the function. If the function already merges this way, leave it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/prefill/__tests__/`
Expected: PASS — `run-prefill.listing.test.ts` green; phase 1–3 tests in the same folder unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/lib/prefill/run-prefill.ts src/lib/prefill/__tests__/run-prefill.listing.test.ts
git commit -m "feat(prefill): run the Zillow listing stage in parallel with assessor and permits"
```

---

### Task 6: Listing row in the Prefill sources tile — Zillow link

**Files:**
- Create: `src/components/prefill/stage-links.tsx`
- Modify: `src/components/prefill/prefill-sources-tile.tsx` (phase 1/2 file — Listing row only)
- Test: `src/components/prefill/__tests__/stage-links.test.tsx`, `src/components/prefill/__tests__/prefill-sources-tile.listing.test.tsx`

**Interfaces:**
- Consumes: `StageLink`, `PrefillRunDTO`, `PrefillStage` (`src/lib/prefill/types.ts`); `PrefillSourcesTile` (phase 1 — props `run: PrefillRunDTO | null`, `isRunning: boolean`, `onFindRecords: () => void`, `onSelectCandidates: (keys: string[]) => void`; if phase 1's prop names differ, change only the JSX in the tile test — the assertions stay).
- Produces: `StageLinks({ links, className? })` — renders each link as `<a href target="_blank" rel="noopener noreferrer">`, nothing when empty.

- [ ] **Step 1: Write the failing `StageLinks` test**

Create `src/components/prefill/__tests__/stage-links.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StageLinks } from "../stage-links";

describe("StageLinks", () => {
  it("renders each link as a new-tab anchor with rel=noopener", () => {
    render(
      <StageLinks
        links={[
          { label: "Open on Zillow", url: "https://www.zillow.com/homedetails/1_zpid/" },
          { label: "Assessor parcel", url: "https://mcassessor.maricopa.gov/mcs/?q=219-11-121" },
        ]}
      />,
    );
    const zillow = screen.getByRole("link", { name: "Open on Zillow" });
    expect(zillow).toHaveAttribute("href", "https://www.zillow.com/homedetails/1_zpid/");
    expect(zillow).toHaveAttribute("target", "_blank");
    expect(zillow.getAttribute("rel")).toContain("noopener");
    expect(screen.getByRole("link", { name: "Assessor parcel" })).toBeInTheDocument();
  });

  it("renders nothing for an empty list", () => {
    const { container } = render(<StageLinks links={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("refuses non-http(s) URLs (defence against javascript: links from a bad source payload)", () => {
    render(<StageLinks links={[{ label: "Bad", url: "javascript:alert(1)" }]} />);
    expect(screen.queryByRole("link", { name: "Bad" })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/prefill/__tests__/stage-links.test.tsx`
Expected: FAIL — `Failed to resolve import "../stage-links"`.

- [ ] **Step 3: Write `stage-links.tsx`**

Create `src/components/prefill/stage-links.tsx`:

```tsx
"use client";

import { ExternalLink } from "lucide-react";
import type { StageLink } from "@/lib/prefill/types";
import { cn } from "@/lib/utils";

const SAFE_URL = /^https?:\/\//i;

interface StageLinksProps {
  links: StageLink[];
  className?: string;
}

/**
 * Source links for one prefill stage. Plain anchors on purpose — `next/link`
 * prefetch would fire the auth-gated record download route (spec §8).
 */
export function StageLinks({ links, className }: StageLinksProps) {
  const safe = links.filter((l) => SAFE_URL.test(l.url));
  if (safe.length === 0) return null;
  return (
    <span className={cn("flex flex-wrap gap-x-3 gap-y-1", className)}>
      {safe.map((link) => (
        <a
          key={`${link.label}:${link.url}`}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-blue-700 underline-offset-2 hover:underline"
        >
          {link.label}
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      ))}
    </span>
  );
}
```

(`cn` is the existing helper in `src/lib/utils.ts`.)

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/components/prefill/__tests__/stage-links.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing tile test**

Create `src/components/prefill/__tests__/prefill-sources-tile.listing.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PrefillRunDTO, PrefillStage } from "@/lib/prefill/types";
import { PrefillSourcesTile } from "../prefill-sources-tile";

const ZILLOW_URL = "https://www.zillow.com/homedetails/8911-E-Cave-Creek-Rd-Carefree-AZ-85377/7921650_zpid/";

function stage(partial: Partial<PrefillStage>): PrefillStage {
  return { status: "done", links: [], ...partial };
}

function makeRun(listing: PrefillStage): PrefillRunDTO {
  return {
    id: "run-1",
    inspectionId: "insp-1",
    trigger: "manual",
    status: "done",
    input: { apn: "219-11-121" },
    stages: {
      assessor: stage({ summary: "Parcel 219-11-121" }),
      listing,
      permits: stage({ status: "not_found", summary: "No permit records found" }),
    },
    proposals: [],
    candidates: [],
    error: null,
    appliedAt: null,
    createdAt: "2026-09-11T18:00:00.000Z",
    finishedAt: "2026-09-11T18:00:20.000Z",
    records: [],
  };
}

function renderTile(run: PrefillRunDTO) {
  return render(
    <PrefillSourcesTile run={run} isRunning={false} onFindRecords={vi.fn()} onSelectCandidates={vi.fn()} />,
  );
}

describe("PrefillSourcesTile — Listing row", () => {
  it("shows the listing summary and an Open on Zillow link that opens in a new tab", () => {
    renderTile(
      makeRun(
        stage({
          summary: "Water: Private Well · 3 bed · Sewer: septic",
          links: [{ label: "Open on Zillow", url: ZILLOW_URL }],
        }),
      ),
    );
    expect(screen.getByText("Water: Private Well · 3 bed · Sewer: septic")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /open on zillow/i });
    expect(link).toHaveAttribute("href", ZILLOW_URL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("shows the not-found copy with the searched address and no link", () => {
    renderTile(
      makeRun(stage({ status: "not_found", summary: "No Zillow listing found for 8911 E Cave Creek Rd, Carefree, AZ 85377" })),
    );
    expect(screen.getByText("No Zillow listing found for 8911 E Cave Creek Rd, Carefree, AZ 85377")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /zillow/i })).not.toBeInTheDocument();
  });

  it("shows the error message when the lookup failed", () => {
    renderTile(makeRun(stage({ status: "error", summary: "Zillow lookup failed", error: "Apify responded 402" })));
    expect(screen.getByText("Zillow lookup failed")).toBeInTheDocument();
    expect(screen.getByText(/Apify responded 402/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run it**

Run: `npx vitest run src/components/prefill/__tests__/prefill-sources-tile.listing.test.tsx`
Expected: either PASS (phase 1's tile already renders `stage.summary`, `stage.error` and `stage.links` generically for every row — then skip Step 7) or FAIL on the missing link / error text.

- [ ] **Step 7: Render the Listing row's links and error through `StageLinks` (only if Step 6 failed)**

In `src/components/prefill/prefill-sources-tile.tsx`, import `StageLinks`:

```tsx
import { StageLinks } from "@/components/prefill/stage-links";
```

and in the Listing row (the JSX that renders `run.stages.listing`), render summary, error and links like this — the same three elements phase 1 renders for the Assessor row, so keep the row's existing status icon and layout and add what is missing:

```tsx
{/* Listing (Zillow) */}
<div className="flex items-start gap-2 py-1.5" data-stage="listing">
  <StageStatusIcon status={run.stages.listing.status} />
  <div className="min-w-0 flex-1">
    <div className="flex flex-wrap items-baseline gap-x-2">
      <span className="text-sm font-medium">Listing</span>
      {run.stages.listing.summary && (
        <span className="text-sm text-muted-foreground">{run.stages.listing.summary}</span>
      )}
    </div>
    {run.stages.listing.error && (
      <p className="text-xs text-red-700">{run.stages.listing.error}</p>
    )}
    <StageLinks links={run.stages.listing.links} className="mt-0.5" />
  </div>
</div>
```

(`StageStatusIcon` is phase 1's per-status icon in the same file; if phase 1 named it differently, use that name.) If the Assessor and Permits rows still render their links with hand-written anchors, switch them to `<StageLinks links={…} />` too so all three rows share one implementation.

- [ ] **Step 8: Run the tile tests to verify they pass**

Run: `npx vitest run src/components/prefill/`
Expected: PASS — the new listing test plus every phase 1/2 tile/badge/chip test unchanged.

- [ ] **Step 9: Commit**

```bash
git add src/components/prefill/stage-links.tsx src/components/prefill/prefill-sources-tile.tsx src/components/prefill/__tests__/stage-links.test.tsx src/components/prefill/__tests__/prefill-sources-tile.listing.test.tsx
git commit -m "feat(prefill): Listing row shows the Zillow link via shared StageLinks"
```

---

### Task 7: `APIFY_TOKEN` in `.env.example` + live shape-check script

**Files:**
- Modify: `.env.example`
- Create: `scripts/listing-shape-check.mts`

**Interfaces:**
- Consumes: `buildApifyUrl`, `normaliseListingItem`, `fullAddress` (Task 1–2) via a dynamic file-URL import (the pattern used by `scripts/test-pdf-gen.mts`).
- Produces: a script that runs **one real** Apify lookup for `8911 E Cave Creek Rd, Carefree, AZ 85377` and prints the raw top-level keys, the water/sewer-related raw values, and the normalised `ListingFacts` — so the mapper's key list can be confirmed or extended. No test file: the script *is* the manual verification (spec §5.3 "confirmed with one real run during implementation"). Cost: one actor start + one dossier (≈ $0.02).

- [ ] **Step 1: Add the env var to `.env.example`**

Append to `.env.example` after the `ANTHROPIC_API_KEY` block:

```bash
# Apify (Zillow listing lookup for the property-records prefill)
# Get from: https://console.apify.com/account/integrations  (SERVER-ONLY — never NEXT_PUBLIC_)
# Actor: sian.agency/zillow-property-detail-scraper, ~$0.02 per found listing; leave empty to skip the listing stage.
APIFY_TOKEN=your-apify-token
```

- [ ] **Step 2: Write the shape-check script**

Create `scripts/listing-shape-check.mts`:

```ts
/**
 * One real Apify → Zillow lookup so the defensive mapper in
 * src/lib/prefill/listing/zillow-apify.ts can be checked against the actor's
 * actual output keys. Prints raw keys, water/sewer-ish raw values and the
 * normalised facts. Never prints the token.
 *
 * Usage: npx tsx --env-file=.env.local scripts/listing-shape-check.mts ["<full address>"]
 * Default address: 8911 E Cave Creek Rd, Carefree, AZ 85377
 */

import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const root = resolve(dirname(__filename), "..");

const { buildApifyUrl, normaliseListingItem, findFact, WATER_KEYS, SEWER_KEYS } = await import(
  pathToFileURL(join(root, "src/lib/prefill/listing/zillow-apify.ts")).href
);

const token = process.env.APIFY_TOKEN;
if (!token) {
  console.error("APIFY_TOKEN is not set — run with --env-file=.env.local (after `npx vercel env pull .env.local`).");
  process.exit(1);
}

const address = process.argv[2] ?? "8911 E Cave Creek Rd, Carefree, AZ 85377";
console.log(`Looking up: ${address}`);

const started = Date.now();
const res = await fetch(buildApifyUrl(token), {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ addresses: [address] }),
  signal: AbortSignal.timeout(90_000),
});
console.log(`HTTP ${res.status} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
if (!res.ok) {
  console.error(await res.text().catch(() => "<no body>"));
  process.exit(1);
}

const items: unknown = await res.json();
if (!Array.isArray(items)) {
  console.error("Dataset is not an array:", JSON.stringify(items).slice(0, 500));
  process.exit(1);
}
console.log(`Dataset items: ${items.length}`);
if (items.length === 0) {
  console.log("No listing found (Apify does not charge for this).");
  process.exit(0);
}

const item = items[0] as Record<string, unknown>;
console.log("\nTop-level keys:");
for (const key of Object.keys(item).sort()) {
  const v = item[key];
  const kind = Array.isArray(v) ? `array(${v.length})` : v === null ? "null" : typeof v;
  console.log(`  ${key}: ${kind}`);
}

/** Every dotted path (depth ≤ 4) whose key or string value mentions water/sewer/septic/well. */
function scan(node: unknown, path: string, out: string[], depth = 0) {
  if (!node || typeof node !== "object" || depth > 4) return;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    const p = path ? `${path}.${k}` : k;
    const text = typeof v === "string" ? v : Array.isArray(v) ? v.filter((x) => typeof x === "string").join(", ") : "";
    if (/water|sewer|septic|well|utilit/i.test(k) || /water|sewer|septic|well/i.test(text)) {
      out.push(`  ${p} = ${JSON.stringify(v).slice(0, 160)}`);
    }
    if (v && typeof v === "object") scan(v, p, out, depth + 1);
  }
}
const hits: string[] = [];
scan(item, "", hits);
console.log("\nWater/sewer-related paths:");
console.log(hits.length ? hits.join("\n") : "  (none — extend WATER_KEYS/SEWER_KEYS in zillow-apify.ts after inspecting the keys above)");

console.log("\nfindFact(WATER_KEYS):", JSON.stringify(findFact(item, WATER_KEYS)));
console.log("findFact(SEWER_KEYS):", JSON.stringify(findFact(item, SEWER_KEYS)));

const facts = normaliseListingItem(item);
console.log("\nNormalised facts:");
console.log(facts ? JSON.stringify({ ...facts, raw: "<omitted>" }, null, 2) : "null (mapper found nothing — fix the key lists)");
```

- [ ] **Step 3: Run it against the real actor**

Prerequisite: `.env.local` with a real `APIFY_TOKEN` (`npx vercel env pull .env.local` after adding the var in Vercel, or paste it into `.env.local` locally — never into chat, never into a committed file).

Run: `npx tsx --env-file=.env.local scripts/listing-shape-check.mts`
Expected: `HTTP 200`, `Dataset items: 1`, a list of top-level keys, at least one water/sewer path, and `Normalised facts` showing a Zillow `url` and (for this property) a `waterSource`/`sewer`. If `findFact(WATER_KEYS)` prints `undefined` while the path scan shows the real key, add that key to `WATER_KEYS`/`SEWER_KEYS` in `src/lib/prefill/listing/zillow-apify.ts`, add a matching case to `normalise.test.ts` (Task 1, `normaliseListingItem` describe block) using the real shape, and re-run `npx vitest run src/lib/prefill/listing/`.

Record the output's key list in the commit message body (see Step 4) so the next person does not have to spend another lookup.

- [ ] **Step 4: Commit**

```bash
git add .env.example scripts/listing-shape-check.mts src/lib/prefill/listing/zillow-apify.ts src/lib/prefill/listing/__tests__/normalise.test.ts
git commit -m "chore(prefill): APIFY_TOKEN in .env.example + Zillow listing shape-check script

Shape check 2026-09-11 for 8911 E Cave Creek Rd: <paste the top-level keys and the
water/sewer paths printed by the script here>"
```

---

# Phase 5 — Webhook trigger + apply-on-mount

### Task 8: `buildWebhookPrefillInput` — Workiz payload → `PrefillInput`

**Files:**
- Create: `src/lib/prefill/webhook-input.ts`
- Test: `src/lib/prefill/__tests__/webhook-input.test.ts`

**Interfaces:**
- Consumes: `PrefillInput`, `PrefillAddress` (`src/lib/prefill/types.ts`).
- Produces: `parseStreetLine(street: string): Pick<PrefillAddress, "streetNumber" | "streetDir" | "streetName"> | null`; `interface WebhookPrefillSource { apn: string; street: string; city: string; zip: string; addressVerified: boolean }`; `buildWebhookPrefillInput(src: WebhookPrefillSource): PrefillInput | null`. Task 9 calls `buildWebhookPrefillInput` from the route.

Rules (spec §2 "creates a draft that carries an APN", team decision "APN or assessor address"):
- A run is created when the APN is valid (same regex as `/api/apn-lookup`: ≤ 20 chars, `[\dA-Za-z -]`, contains a digit) **or** the address came from the assessor (`addressVerified`) and parses to number + street. A bare Workiz address with no APN does **not** trigger a run (unverified addresses would burn Apify/EDMS calls).
- The address, when parseable, is always included in the input (it feeds the listing lookup and the permit street fallback) — even when it is the unverified Workiz address, as long as the APN is what triggered the run.
- Address parts are trimmed, capped at 200 chars, and must be printable ASCII (spec §11); otherwise the address is dropped (the APN can still trigger).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/prefill/__tests__/webhook-input.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildWebhookPrefillInput, parseStreetLine } from "../webhook-input";

describe("parseStreetLine", () => {
  it("splits number, direction and street name", () => {
    expect(parseStreetLine("8911 E Cave Creek Rd")).toEqual({
      streetNumber: "8911",
      streetDir: "E",
      streetName: "Cave Creek Rd",
    });
  });

  it("handles no direction, dotted directions and extra whitespace", () => {
    expect(parseStreetLine("123 Main St")).toEqual({ streetNumber: "123", streetDir: undefined, streetName: "Main St" });
    expect(parseStreetLine("  4521  N.  Scottsdale Rd ")).toEqual({
      streetNumber: "4521",
      streetDir: "N",
      streetName: "Scottsdale Rd",
    });
    expect(parseStreetLine("10 NW Elm Ave")).toEqual({ streetNumber: "10", streetDir: "NW", streetName: "Elm Ave" });
  });

  it("keeps a number suffix like 1234A and does not treat a one-word street as a direction", () => {
    expect(parseStreetLine("1234A Oak Ln")).toEqual({ streetNumber: "1234A", streetDir: undefined, streetName: "Oak Ln" });
    expect(parseStreetLine("5 E")).toEqual({ streetNumber: "5", streetDir: undefined, streetName: "E" });
  });

  it("returns null when there is no leading number or no street name", () => {
    expect(parseStreetLine("Main St")).toBeNull();
    expect(parseStreetLine("123")).toBeNull();
    expect(parseStreetLine("")).toBeNull();
  });
});

describe("buildWebhookPrefillInput", () => {
  const base = { apn: "219-11-121", street: "8911 E Cave Creek Rd", city: "Carefree", zip: "85377", addressVerified: true };

  it("builds apn + parsed address + full single-line address", () => {
    expect(buildWebhookPrefillInput(base)).toEqual({
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

  it("triggers on a valid APN alone, still carrying the (unverified) Workiz address", () => {
    const out = buildWebhookPrefillInput({ ...base, addressVerified: false });
    expect(out?.apn).toBe("219-11-121");
    expect(out?.address?.streetName).toBe("Cave Creek Rd");
  });

  it("triggers on a verified assessor address when the APN is empty", () => {
    const out = buildWebhookPrefillInput({ ...base, apn: "" });
    expect(out).toEqual({
      apn: undefined,
      address: expect.objectContaining({ streetNumber: "8911", full: "8911 E Cave Creek Rd, Carefree, AZ 85377" }),
    });
  });

  it("returns null for an unverified address with no APN", () => {
    expect(buildWebhookPrefillInput({ ...base, apn: "", addressVerified: false })).toBeNull();
  });

  it("returns null when the APN is invalid and the address is unparseable", () => {
    expect(
      buildWebhookPrefillInput({ apn: "not an apn!", street: "Cave Creek Rd", city: "", zip: "", addressVerified: true }),
    ).toBeNull();
  });

  it("drops an invalid APN but keeps a verified address", () => {
    const out = buildWebhookPrefillInput({ ...base, apn: "x".repeat(21) });
    expect(out?.apn).toBeUndefined();
    expect(out?.address?.streetNumber).toBe("8911");
  });

  it("omits empty city/zip from the address and from the full line", () => {
    expect(buildWebhookPrefillInput({ ...base, city: "", zip: " " })).toEqual({
      apn: "219-11-121",
      address: {
        streetNumber: "8911",
        streetDir: "E",
        streetName: "Cave Creek Rd",
        city: undefined,
        zip: undefined,
        full: "8911 E Cave Creek Rd, AZ",
      },
    });
  });

  it("drops the address (keeps the APN) when a part is too long or not printable ASCII", () => {
    expect(buildWebhookPrefillInput({ ...base, street: `1 ${"a".repeat(200)} St` })?.address).toBeUndefined();
    expect(buildWebhookPrefillInput({ ...base, city: "Café " })?.address).toBeUndefined();
    expect(buildWebhookPrefillInput({ ...base, city: "Café " })?.apn).toBe("219-11-121");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/prefill/__tests__/webhook-input.test.ts`
Expected: FAIL — `Failed to resolve import "../webhook-input"`.

- [ ] **Step 3: Write `webhook-input.ts`**

Create `src/lib/prefill/webhook-input.ts`:

```ts
import type { PrefillAddress, PrefillInput } from "./types";

/** Same rule as /api/apn-lookup: digits, letters, dashes, spaces; must contain a digit; ≤ 20 chars. */
const APN_RE = /^[\dA-Za-z -]{1,20}$/;
/** Spec §11: address parts ≤ 200 chars, printable ASCII only (space through tilde). */
const MAX_PART_LENGTH = 200;
const PRINTABLE_ASCII_RE = /^[ -~]*$/;
const STREET_DIRS = new Set(["N", "S", "E", "W", "NE", "NW", "SE", "SW"]);

export interface WebhookPrefillSource {
  apn: string;
  street: string;
  city: string;
  zip: string;
  /** true when the address came from the assessor payload (APN lookup succeeded in n8n) */
  addressVerified: boolean;
}

/** Trimmed, whitespace-collapsed part; null when it violates the §11 limits. */
function cleanPart(raw: string): string | null {
  const value = raw.trim().replace(/\s+/g, " ");
  if (value.length > MAX_PART_LENGTH || !PRINTABLE_ASCII_RE.test(value)) return null;
  return value;
}

/** "8911 E Cave Creek Rd" → { streetNumber: "8911", streetDir: "E", streetName: "Cave Creek Rd" } */
export function parseStreetLine(
  street: string,
): Pick<PrefillAddress, "streetNumber" | "streetDir" | "streetName"> | null {
  const tokens = street.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  if (tokens.length < 2 || !/^\d+[A-Za-z]?$/.test(tokens[0])) return null;
  const streetNumber = tokens[0];
  let rest = tokens.slice(1);
  let streetDir: string | undefined;
  const maybeDir = rest[0].replace(/\./g, "").toUpperCase();
  if (rest.length > 1 && STREET_DIRS.has(maybeDir)) {
    streetDir = maybeDir;
    rest = rest.slice(1);
  }
  const streetName = rest.join(" ");
  if (!streetName) return null;
  return { streetNumber, streetDir, streetName };
}

/**
 * Turns the Workiz webhook's (possibly assessor-enriched) address + APN into a
 * `PrefillInput`, or null when nothing trustworthy is available to search on.
 * A run is worth starting when the APN is valid, or the address is
 * assessor-verified and parses to a number + street.
 */
export function buildWebhookPrefillInput(src: WebhookPrefillSource): PrefillInput | null {
  const apnText = src.apn.trim();
  const apn = apnText && APN_RE.test(apnText) && /\d/.test(apnText) ? apnText : undefined;

  let address: PrefillAddress | undefined;
  const street = cleanPart(src.street);
  const city = cleanPart(src.city);
  const zip = cleanPart(src.zip);
  const parsed = street ? parseStreetLine(street) : null;
  if (parsed && street && city !== null && zip !== null) {
    const stateZip = ["AZ", zip || undefined].filter(Boolean).join(" ");
    address = {
      ...parsed,
      city: city || undefined,
      zip: zip || undefined,
      full: [street, city || undefined, stateZip].filter(Boolean).join(", "),
    };
  }

  const addressTriggers = src.addressVerified && address !== undefined;
  if (!apn && !addressTriggers) return null;
  return { apn, address };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/prefill/__tests__/webhook-input.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/prefill/webhook-input.ts src/lib/prefill/__tests__/webhook-input.test.ts
git commit -m "feat(prefill): build a PrefillInput from the Workiz webhook payload"
```

---

### Task 9: Workiz webhook starts a background prefill run

**Files:**
- Modify: `src/app/api/webhooks/workiz/route.ts`
- Modify: `src/app/api/webhooks/workiz/__tests__/route.test.ts` (mock section + new describe)
- Modify: `src/__tests__/security/webhook-security.test.ts` (mock section only)

**Interfaces:**
- Consumes: `buildWebhookPrefillInput`, `WebhookPrefillSource` (Task 8); `runPrefill` (`src/lib/prefill/run-prefill.ts`); `emptyStages` (`src/lib/prefill/types.ts`); `inspectionPrefillRuns` (`src/lib/db/schema.ts`); `after` from `next/server`.
- Produces: `POST /api/webhooks/workiz` 201 body gains an optional `prefillRunId: string` when a run was created. `export const maxDuration = 300`. Row shape: `{ inspectionId, trigger: "webhook", status: "queued", input, stages: emptyStages(), proposals: [], candidates: [], createdBy: null }`.

Why the tests need new mocks: the route now imports `@/lib/prefill/run-prefill`, which transitively loads `src/lib/ai/*` where `new Anthropic()` runs at module scope and throws without `ANTHROPIC_API_KEY`; and `after()` from `next/server` throws when called outside a real request scope. Both are mocked in **both** webhook test files.

- [ ] **Step 1: Update the mock section of `route.test.ts` and add the failing tests**

In `src/app/api/webhooks/workiz/__tests__/route.test.ts`, replace everything from the first `const {` (the `vi.hoisted` block) down to and including the `vi.mock("@/lib/validators/inspection", …)` block with:

```ts
const {
  mockDbSelect,
  mockDbInsert,
  mockDbInsertRun,
  mockDbSelectProfiles,
  mockInsertValues,
  mockAfter,
  mockRunPrefill,
  PREFILL_RUNS_TABLE,
} = vi.hoisted(() => {
  const mockDbSelect = vi.fn();
  const mockDbInsert = vi.fn();
  const mockDbInsertRun = vi.fn();
  const mockDbSelectProfiles = vi.fn();
  const mockInsertValues = vi.fn();
  const mockAfter = vi.fn();
  const mockRunPrefill = vi.fn();
  // Sentinel object shared by the schema mock and the db mock so the db mock can
  // tell an inspection insert from a prefill-run insert.
  const PREFILL_RUNS_TABLE = { id: "prefill_run_id" };

  return {
    mockDbSelect,
    mockDbInsert,
    mockDbInsertRun,
    mockDbSelectProfiles,
    mockInsertValues,
    mockAfter,
    mockRunPrefill,
    PREFILL_RUNS_TABLE,
  };
});

// Track which table is targeted by select/insert so we can route to the right mock
vi.mock("@/lib/db", () => {
  // We need separate chains for inspections vs profiles selects
  let selectTarget: "inspections" | "profiles" | null = null;
  let insertTarget: "inspections" | "runs" = "inspections";

  const selectChain = {
    from: vi.fn((table: unknown) => {
      // The schema mock uses different objects for inspections vs profiles
      if (table === "profiles_table") {
        selectTarget = "profiles";
      } else {
        selectTarget = "inspections";
      }
      return selectChain;
    }),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(() => {
      if (selectTarget === "profiles") {
        return mockDbSelectProfiles();
      }
      return mockDbSelect();
    }),
  };

  const insertReturningChain = {
    values: vi.fn((values: unknown) => {
      mockInsertValues(insertTarget, values);
      return insertReturningChain;
    }),
    returning: vi.fn(() => (insertTarget === "runs" ? mockDbInsertRun() : mockDbInsert())),
  };

  return {
    db: {
      select: vi.fn(() => selectChain),
      insert: vi.fn((table: unknown) => {
        insertTarget = table === PREFILL_RUNS_TABLE ? "runs" : "inspections";
        return insertReturningChain;
      }),
    },
  };
});

vi.mock("@/lib/db/schema", () => ({
  inspections: {
    id: "id",
    inspectorId: "inspector_id",
    status: "status",
    workizJobId: "workiz_job_id",
  },
  profiles: "profiles_table",
  inspectionPrefillRuns: PREFILL_RUNS_TABLE,
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ _col, val })),
  ilike: vi.fn((_col: unknown, val: unknown) => ({ _col, val, _op: "ilike" })),
}));

vi.mock("@/lib/validators/inspection", () => ({
  getDefaultFormValues: vi.fn((name: string) => ({
    facilityInfo: {
      facilityName: "",
      facilityAddress: "",
      facilityCity: "",
      facilityCounty: "",
      facilityState: "AZ",
      facilityZip: "",
      taxParcelNumber: "",
      dateOfInspection: "",
      sellerName: "",
      inspectorName: name,
    },
    generalTreatment: { systemTypes: [] },
    designFlow: {},
    septicTank: { tanks: [] },
    disposalWorks: { printedName: name },
  })),
}));

// `after()` throws outside a real request scope; capture the callback instead.
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: mockAfter };
});

// run-prefill pulls in the Anthropic SDK (throws at import without a key) — stub it.
vi.mock("@/lib/prefill/run-prefill", () => ({ runPrefill: mockRunPrefill }));
```

Then in the existing `beforeEach`, add after `mockDbInsert.mockResolvedValue([NEW_INSPECTION]);`:

```ts
  mockDbInsertRun.mockResolvedValue([{ id: "run-uuid-1" }]); // prefill run created
  mockRunPrefill.mockResolvedValue(undefined);
```

Append a new describe block at the end of the top-level `describe("POST /api/webhooks/workiz", …)` (after the "Inspection creation" block):

```ts
  // -----------------------------------------------------------------------
  // 9. Prefill run trigger (spec §8 webhook row)
  // -----------------------------------------------------------------------
  describe("Prefill run trigger", () => {
    /** The values object passed to db.insert(inspectionPrefillRuns).values(...) */
    function runInsertValues(): Record<string, unknown> | undefined {
      const call = mockInsertValues.mock.calls.find(([target]) => target === "runs");
      return call?.[1] as Record<string, unknown> | undefined;
    }

    it("creates a webhook run and schedules runPrefill via after() when an APN is present", async () => {
      const res = await POST(makeRequest(validPayload(), VALID_SECRET));
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.inspectionId).toBe("insp-uuid-1");
      expect(json.prefillRunId).toBe("run-uuid-1");

      expect(runInsertValues()).toEqual({
        inspectionId: "insp-uuid-1",
        trigger: "webhook",
        status: "queued",
        input: {
          apn: "123-45-678",
          address: {
            streetNumber: "123",
            streetDir: undefined,
            streetName: "Main St",
            city: "Phoenix",
            zip: "85001",
            full: "123 Main St, Phoenix, AZ 85001",
          },
        },
        stages: {
          assessor: { status: "pending", links: [] },
          listing: { status: "pending", links: [] },
          permits: { status: "pending", links: [] },
        },
        proposals: [],
        candidates: [],
        createdBy: null,
      });

      // Scheduled, not awaited: runPrefill only runs when Next invokes the callback.
      expect(mockAfter).toHaveBeenCalledTimes(1);
      expect(mockRunPrefill).not.toHaveBeenCalled();
      const callback = mockAfter.mock.calls[0][0] as () => Promise<void>;
      await callback();
      expect(mockRunPrefill).toHaveBeenCalledWith("run-uuid-1");
    });

    it("uses the assessor's formatted APN and address when assessor data is present", async () => {
      const payload = validPayload({
        apn: "12345678",
        assessor: {
          ownerName: "Property Owner LLC",
          physicalAddress: "8911 E Cave Creek Rd",
          city: "Carefree",
          zip: "85377",
          county: "Maricopa",
          apnFormatted: "219-11-121",
        },
      });
      const res = await POST(makeRequest(payload, VALID_SECRET));
      expect(res.status).toBe(201);
      expect(runInsertValues()?.input).toEqual({
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

    it("creates a run from a verified assessor address when the APN is empty", async () => {
      const payload = validPayload({
        apn: "",
        assessor: { ownerName: "Owner", physicalAddress: "456 Oak Ave", city: "Scottsdale", zip: "85251" },
      });
      const res = await POST(makeRequest(payload, VALID_SECRET));
      expect(res.status).toBe(201);
      expect((await res.json()).prefillRunId).toBe("run-uuid-1");
      expect(runInsertValues()?.input).toEqual({
        apn: undefined,
        address: expect.objectContaining({ streetNumber: "456", streetName: "Oak Ave" }),
      });
      expect(mockAfter).toHaveBeenCalledTimes(1);
    });

    it("does not create a run when there is no APN and no assessor address", async () => {
      const payload = validPayload({ apn: "" });
      const res = await POST(makeRequest(payload, VALID_SECRET));
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json).not.toHaveProperty("prefillRunId");
      expect(runInsertValues()).toBeUndefined();
      expect(mockAfter).not.toHaveBeenCalled();
    });

    it("does not create a run for skipped (non-ADEQ) or duplicate jobs", async () => {
      await POST(makeRequest(validPayload({ job: { jobId: "WZ-1", jobType: "Drain Cleaning" } }), VALID_SECRET));
      expect(runInsertValues()).toBeUndefined();

      mockDbSelect.mockResolvedValueOnce([{ id: "existing-uuid", status: "draft" }]);
      await POST(makeRequest(validPayload(), VALID_SECRET));
      expect(runInsertValues()).toBeUndefined();
      expect(mockAfter).not.toHaveBeenCalled();
    });

    it("still returns 201 with the inspection when the run insert fails", async () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      mockDbInsertRun.mockRejectedValueOnce(new Error("db down"));

      const res = await POST(makeRequest(validPayload(), VALID_SECRET));
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.inspectionId).toBe("insp-uuid-1");
      expect(json).not.toHaveProperty("prefillRunId");
      expect(mockAfter).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining("could not start prefill run"),
        "insp-uuid-1",
        expect.any(Error),
      );
      consoleError.mockRestore();
    });

    it("still returns 201 when after() itself throws", async () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      mockAfter.mockImplementationOnce(() => {
        throw new Error("after() was called outside a request scope");
      });

      const res = await POST(makeRequest(validPayload(), VALID_SECRET));
      expect(res.status).toBe(201);
      expect((await res.json()).inspectionId).toBe("insp-uuid-1");
      consoleError.mockRestore();
    });

    it("exports maxDuration = 300 for the background run", async () => {
      const route = await import("../route");
      expect(route.maxDuration).toBe(300);
    });
  });
```

- [ ] **Step 2: Run the webhook tests to verify the new ones fail and the old ones still pass**

Run: `npx vitest run src/app/api/webhooks/workiz/__tests__/route.test.ts`
Expected: the 8 new "Prefill run trigger" tests FAIL (`prefillRunId` undefined, `mockAfter` not called, `maxDuration` undefined); all pre-existing tests in the file PASS (the mock refactor is behaviour-preserving).

- [ ] **Step 3: Update `webhook-security.test.ts` mocks**

In `src/__tests__/security/webhook-security.test.ts`, extend the schema mock and add two mocks right after it:

```ts
vi.mock("@/lib/db/schema", () => ({
  inspections: {
    id: "id",
    inspectorId: "inspector_id",
    status: "status",
    formData: "form_data",
    workizJobId: "workiz_job_id",
  },
  profiles: { id: "id", fullName: "full_name", email: "email" },
  inspectionMedia: {},
  userRoles: {},
  inspectionEmails: {},
  inspectionPrefillRuns: { id: "id" },
}));

// The route schedules a background prefill run: `after()` throws outside a real
// request scope and run-prefill imports the Anthropic SDK (throws without a key).
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: vi.fn() };
});
vi.mock("@/lib/prefill/run-prefill", () => ({ runPrefill: vi.fn() }));
```

Run: `npx vitest run src/__tests__/security/webhook-security.test.ts`
Expected: PASS (unchanged count) — this file has no APN payloads, so the run path is never hit; the mocks only keep the module importable.

- [ ] **Step 4: Rewrite the route**

Replace the full contents of `src/app/api/webhooks/workiz/route.ts` with:

```ts
import crypto from "crypto";
import { eq, ilike } from "drizzle-orm";
import { after, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { inspectionPrefillRuns, inspections, profiles } from "@/lib/db/schema";
import { runPrefill } from "@/lib/prefill/run-prefill";
import { emptyStages } from "@/lib/prefill/types";
import { buildWebhookPrefillInput, type WebhookPrefillSource } from "@/lib/prefill/webhook-input";
import { getDefaultFormValues } from "@/lib/validators/inspection";
import { workizWebhookSchema } from "@/lib/validators/workiz-webhook";

// The background prefill run (assessor + Zillow + Maricopa EDMS + extraction)
// continues after the response via after(); give it the full budget.
export const maxDuration = 300;

/**
 * POST /api/webhooks/workiz
 * Receives job data from Workiz (via n8n), creates a pre-filled draft
 * inspection assigned to the matching tech.
 *
 * When n8n enriches the payload with Maricopa County Assessor data (via APN lookup),
 * the assessor's property owner and address override the Workiz client/address fields
 * for the form. The Workiz customer name is preserved separately for reference.
 *
 * After the draft is created, a property-records prefill run is queued in the
 * background when the payload carries an APN or an assessor-verified address.
 *
 * Auth: Bearer token matching WORKIZ_WEBHOOK_SECRET env var.
 */
export async function POST(request: Request) {
  // 1. API key authentication
  const secret = process.env.WORKIZ_WEBHOOK_SECRET;
  if (!secret) {
    console.error("WORKIZ_WEBHOOK_SECRET not configured");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Timing-safe comparison to prevent timing attacks
  const tokenBuf = Buffer.from(token);
  const secretBuf = Buffer.from(secret);
  if (tokenBuf.length !== secretBuf.length || !crypto.timingSafeEqual(tokenBuf, secretBuf)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Parse and validate payload
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = workizWebhookSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { client, address, job, tech, apn, assessor } = parsed.data;

  // 3. Only create inspections for "ADEQ Inspection" jobs
  const jobType = (job.jobType || job.serviceType || "").trim();
  const isAdeqInspection = jobType.toLowerCase().includes("adeq");
  if (!isAdeqInspection) {
    return NextResponse.json(
      { skipped: true, reason: `Job type "${jobType}" is not an ADEQ inspection` },
      { status: 200 },
    );
  }

  // 4. Idempotency check — if this Workiz job already created an inspection, return it
  if (job.jobId) {
    const [existing] = await db
      .select({ id: inspections.id, status: inspections.status })
      .from(inspections)
      .where(eq(inspections.workizJobId, job.jobId))
      .limit(1);

    if (existing) {
      return NextResponse.json(
        { inspectionId: existing.id, status: existing.status, duplicate: true },
        { status: 200 },
      );
    }
  }

  // 5. Look up tech — try email first, fall back to name match
  let techProfile: { id: string; fullName: string } | undefined;

  if (tech.email) {
    const [byEmail] = await db
      .select({ id: profiles.id, fullName: profiles.fullName })
      .from(profiles)
      .where(eq(profiles.email, tech.email.toLowerCase()))
      .limit(1);
    techProfile = byEmail;
  }

  if (!techProfile && tech.name) {
    const [byName] = await db
      .select({ id: profiles.id, fullName: profiles.fullName })
      .from(profiles)
      .where(ilike(profiles.fullName, tech.name.trim()))
      .limit(1);
    techProfile = byName;
  }

  if (!techProfile) {
    return NextResponse.json(
      { error: `No user found matching tech: ${tech.email || tech.name}` },
      { status: 404 },
    );
  }

  // 6. Build pre-filled form data using existing defaults
  const workizCustomerName = `${client.firstName} ${client.lastName}`.trim();
  const hasAssessor = Boolean(assessor && assessor.ownerName);
  const formData = getDefaultFormValues(techProfile.fullName);

  if (hasAssessor && assessor) {
    // Assessor data available — use property owner as facility name, Workiz customer as seller
    formData.facilityInfo.facilityName = assessor.ownerName;
    formData.facilityInfo.sellerName = assessor.ownerName;
    formData.facilityInfo.facilityAddress = assessor.physicalAddress || address.street;
    formData.facilityInfo.facilityCity = assessor.city || address.city;
    formData.facilityInfo.facilityState = address.state || "AZ";
    formData.facilityInfo.facilityZip = assessor.zip || address.zip;
    formData.facilityInfo.facilityCounty = assessor.county || address.county;
    formData.facilityInfo.taxParcelNumber = assessor.apnFormatted || apn || "";
  } else {
    // No assessor data — use Workiz client/address as before
    formData.facilityInfo.facilityName = workizCustomerName;
    formData.facilityInfo.sellerName = workizCustomerName;
    formData.facilityInfo.facilityAddress = address.street;
    formData.facilityInfo.facilityCity = address.city;
    formData.facilityInfo.facilityState = address.state || "AZ";
    formData.facilityInfo.facilityZip = address.zip;
    formData.facilityInfo.facilityCounty = address.county;
    if (apn) {
      formData.facilityInfo.taxParcelNumber = apn;
    }
  }

  if (job.scheduledDate) {
    formData.facilityInfo.dateOfInspection = job.scheduledDate;
  }

  // Use assessor address for denormalized columns when available
  const displayAddress =
    hasAssessor && assessor ? assessor.physicalAddress || address.street : address.street;
  const displayCity = hasAssessor && assessor ? assessor.city || address.city : address.city;
  const displayCounty =
    hasAssessor && assessor ? assessor.county || address.county : address.county;
  const displayZip = hasAssessor && assessor ? assessor.zip || address.zip : address.zip;
  const displayFacilityName = hasAssessor && assessor ? assessor.ownerName : workizCustomerName;

  // 7. Insert inspection assigned to the tech
  const [newInspection] = await db
    .insert(inspections)
    .values({
      inspectorId: techProfile.id,
      status: "draft",
      formData,
      // Denormalized columns for dashboard display
      facilityName: displayFacilityName,
      facilityAddress: displayAddress,
      facilityCity: displayCity,
      facilityCounty: displayCounty,
      facilityZip: displayZip,
      customerEmail: client.email || null,
      customerName: workizCustomerName,
      // External integration references
      workizJobId: job.jobId || null,
      apn: apn || null,
    })
    .returning({ id: inspections.id, status: inspections.status });

  // 8. Queue a background property-records prefill run (spec §8). Never fails the webhook.
  const prefillRunId = await startWebhookPrefill(newInspection.id, {
    apn: (hasAssessor && assessor ? assessor.apnFormatted : "") || apn || "",
    street: displayAddress,
    city: displayCity,
    zip: displayZip,
    addressVerified: Boolean(hasAssessor && assessor?.physicalAddress),
  });

  return NextResponse.json(
    {
      inspectionId: newInspection.id,
      status: newInspection.status,
      ...(prefillRunId ? { prefillRunId } : {}),
    },
    { status: 201 },
  );
}

/**
 * Inserts a `webhook` prefill run and schedules `runPrefill` with `after()` so it
 * keeps running once the response is sent (never a floating promise on Vercel).
 * Returns the run id, or null when there is nothing to search on or anything
 * fails — the draft was already created and the webhook must still succeed.
 */
async function startWebhookPrefill(
  inspectionId: string,
  source: WebhookPrefillSource,
): Promise<string | null> {
  const input = buildWebhookPrefillInput(source);
  if (!input) return null;

  try {
    const [run] = await db
      .insert(inspectionPrefillRuns)
      .values({
        inspectionId,
        trigger: "webhook",
        status: "queued",
        input,
        stages: emptyStages(),
        proposals: [],
        candidates: [],
        createdBy: null,
      })
      .returning({ id: inspectionPrefillRuns.id });
    if (!run) return null;

    after(() => runPrefill(run.id));
    return run.id;
  } catch (err) {
    console.error("Workiz webhook: could not start prefill run for inspection", inspectionId, err);
    return null;
  }
}
```

Everything above the `// 8.` comment is the existing handler with three mechanical changes: `Boolean(...)` around `hasAssessor` (so it is a real boolean for the new call) with `&& assessor` guards for TypeScript narrowing, the extended imports, and `maxDuration`.

- [ ] **Step 5: Run both webhook suites**

Run: `npx vitest run src/app/api/webhooks/workiz/__tests__/route.test.ts src/__tests__/security/webhook-security.test.ts src/lib/validators/__tests__/workiz-webhook.test.ts`
Expected: PASS — every pre-existing test plus the 8 new trigger tests.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/webhooks/workiz/route.ts src/app/api/webhooks/workiz/__tests__/route.test.ts src/__tests__/security/webhook-security.test.ts
git commit -m "feat(webhook): Workiz drafts queue a background property-records prefill run"
```

---

### Task 10: `usePrefill` apply-on-mount (webhook runs reach the form)

**Files:**
- Modify: `src/components/prefill/use-prefill.ts` (phase 1 file)
- Test: `src/components/prefill/__tests__/use-prefill.mount.test.tsx`

**Interfaces:**
- Consumes: `usePrefill({ inspectionId, form, enabled })` (phase 1 contract), `useProvenance()` → `{ provenance, setMany }` (phase 1), `mergeProposals` (phase 1 `src/lib/prefill/merge.ts`), `PrefillRunDTO`, `GET /api/inspections/[id]/prefill/latest`, `POST /api/inspections/[id]/prefill/[runId]/applied`.
- Produces: on mount (when `enabled`), the hook fetches the latest run, exposes it as `run`, and — if it is `done` with `appliedAt === null` — merges its proposals into the live form (`form.setValue` for fills, `setMany` for provenance) and POSTs `/applied`. Spec §8 last paragraph; §13 item 5.

Phase 1's hook already applies a run that finishes while it is polling (start → poll → apply). This task adds the **mount** path, which is how webhook-created runs (no user action) reach the wizard. If phase 1 already implemented the mount fetch (search the file for `prefill/latest`), keep it and make the tests below pass against it — the tests are the contract; only add what is missing.

- [ ] **Step 1: Write the failing tests**

Create `src/components/prefill/__tests__/use-prefill.mount.test.tsx`:

```tsx
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UseFormReturn } from "react-hook-form";
import type { FieldProvenance, PrefillRunDTO } from "@/lib/prefill/types";
import { getDefaultFormValues } from "@/lib/validators/inspection";
import type { InspectionFormData } from "@/types/inspection";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockSetMany, provenanceState } = vi.hoisted(() => ({
  mockSetMany: vi.fn(),
  provenanceState: { map: {} as FieldProvenance },
}));

vi.mock("@/components/prefill/provenance-context", () => ({
  useProvenance: () => ({
    provenance: provenanceState.map,
    get: (fieldPath: string) => provenanceState.map[fieldPath],
    verify: vi.fn(),
    clear: vi.fn(),
    acceptSuggestion: vi.fn(),
    dismissSuggestion: vi.fn(),
    setMany: mockSetMany,
  }),
}));

import { usePrefill } from "@/components/prefill/use-prefill";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const INSPECTION_ID = "insp-1";

function makeForm(values: InspectionFormData = getDefaultFormValues("Tech")) {
  return {
    getValues: vi.fn(() => values),
    setValue: vi.fn(),
    watch: vi.fn(),
    control: {},
  } as unknown as UseFormReturn<InspectionFormData>;
}

function makeRun(overrides: Partial<PrefillRunDTO> = {}): PrefillRunDTO {
  const at = "2026-09-11T18:00:00.000Z";
  return {
    id: "run-web-1",
    inspectionId: INSPECTION_ID,
    trigger: "webhook",
    status: "done",
    input: { apn: "219-11-121" },
    stages: {
      assessor: { status: "done", links: [] },
      listing: { status: "done", summary: "Water: Private Well", links: [] },
      permits: { status: "not_found", links: [] },
    },
    proposals: [
      {
        fieldPath: "facilityInfo.waterSource",
        value: "private_well",
        kind: "fill",
        provenance: { source: "listing", confidence: 0.8, explanation: "Zillow listing · Water source: Private Well" },
      },
    ],
    candidates: [],
    error: null,
    appliedAt: null,
    createdAt: at,
    finishedAt: at,
    records: [],
    ...overrides,
  };
}

const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];

function mockFetchLatest(latest: PrefillRunDTO | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init });
      if (url.endsWith("/prefill/latest")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(latest) });
      }
      if (url.endsWith("/applied")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: "unexpected" }) });
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchCalls.length = 0;
  provenanceState.map = {};
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("usePrefill — apply on mount", () => {
  it("fetches the latest run on mount and applies an unapplied done run to the form", async () => {
    mockFetchLatest(makeRun());
    const form = makeForm();

    const { result } = renderHook(() => usePrefill({ inspectionId: INSPECTION_ID, form, enabled: true }));

    await waitFor(() => expect(form.setValue).toHaveBeenCalled());
    expect(fetchCalls[0].url).toBe(`/api/inspections/${INSPECTION_ID}/prefill/latest`);
    expect(form.setValue).toHaveBeenCalledWith("facilityInfo.waterSource", "private_well", expect.anything());

    expect(mockSetMany).toHaveBeenCalledTimes(1);
    const entries = mockSetMany.mock.calls[0][0] as FieldProvenance;
    expect(entries["facilityInfo.waterSource"]).toMatchObject({
      source: "listing",
      state: "prefilled",
      value: "private_well",
      confidence: 0.8,
      runId: "run-web-1",
    });

    await waitFor(() =>
      expect(fetchCalls.some((c) => c.url === `/api/inspections/${INSPECTION_ID}/prefill/run-web-1/applied` && c.init?.method === "POST")).toBe(true),
    );
    expect(result.current.run?.id).toBe("run-web-1");
  });

  it("turns a low-confidence proposal into a suggestion without writing the field", async () => {
    mockFetchLatest(
      makeRun({
        proposals: [
          {
            fieldPath: "designFlow.numberOfBedrooms",
            value: "3",
            kind: "fill",
            provenance: { source: "listing", confidence: 0.5, explanation: "Zillow listing · 3 bedrooms" },
          },
        ],
      }),
    );
    const form = makeForm();

    renderHook(() => usePrefill({ inspectionId: INSPECTION_ID, form, enabled: true }));

    await waitFor(() => expect(mockSetMany).toHaveBeenCalled());
    expect(form.setValue).not.toHaveBeenCalled();
    const entries = mockSetMany.mock.calls[0][0] as FieldProvenance;
    expect(entries["designFlow.numberOfBedrooms"].state).toBe("suggested");
  });

  it("does not re-apply a run that was already applied", async () => {
    mockFetchLatest(makeRun({ appliedAt: "2026-09-11T18:01:00.000Z" }));
    const form = makeForm();

    const { result } = renderHook(() => usePrefill({ inspectionId: INSPECTION_ID, form, enabled: true }));

    await waitFor(() => expect(result.current.run?.id).toBe("run-web-1"));
    expect(form.setValue).not.toHaveBeenCalled();
    expect(mockSetMany).not.toHaveBeenCalled();
    expect(fetchCalls.filter((c) => c.url.endsWith("/applied"))).toHaveLength(0);
  });

  it("does not apply a run that is still running (the poller handles it)", async () => {
    mockFetchLatest(makeRun({ status: "running", finishedAt: null }));
    const form = makeForm();

    const { result } = renderHook(() => usePrefill({ inspectionId: INSPECTION_ID, form, enabled: true }));

    await waitFor(() => expect(result.current.run?.id).toBe("run-web-1"));
    expect(form.setValue).not.toHaveBeenCalled();
    expect(result.current.isRunning).toBe(true);
  });

  it("does nothing when there is no run yet", async () => {
    mockFetchLatest(null);
    const form = makeForm();

    const { result } = renderHook(() => usePrefill({ inspectionId: INSPECTION_ID, form, enabled: true }));

    await waitFor(() => expect(fetchCalls).toHaveLength(1));
    expect(result.current.run).toBeNull();
    expect(form.setValue).not.toHaveBeenCalled();
  });

  it("does not fetch when disabled (read-only review page)", async () => {
    mockFetchLatest(makeRun());
    const form = makeForm();

    renderHook(() => usePrefill({ inspectionId: INSPECTION_ID, form, enabled: false }));

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchCalls).toHaveLength(0);
  });

  it("does not clobber a field the user already filled (merge no-clobber rule)", async () => {
    mockFetchLatest(makeRun());
    const values = getDefaultFormValues("Tech");
    values.facilityInfo.waterSource = "municipal";
    const form = makeForm(values);

    renderHook(() => usePrefill({ inspectionId: INSPECTION_ID, form, enabled: true }));

    await waitFor(() => expect(mockSetMany).toHaveBeenCalled());
    expect(form.setValue).not.toHaveBeenCalled();
    const entries = mockSetMany.mock.calls[0][0] as FieldProvenance;
    expect(entries["facilityInfo.waterSource"].state).toBe("suggested");
  });

  it("applies each run only once even if the hook re-renders", async () => {
    mockFetchLatest(makeRun());
    const form = makeForm();

    const { rerender } = renderHook(() => usePrefill({ inspectionId: INSPECTION_ID, form, enabled: true }));
    await waitFor(() => expect(form.setValue).toHaveBeenCalledTimes(1));
    rerender();
    rerender();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(form.setValue).toHaveBeenCalledTimes(1);
    expect(fetchCalls.filter((c) => c.url.endsWith("/applied"))).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/prefill/__tests__/use-prefill.mount.test.tsx`
Expected: FAIL — no `/prefill/latest` request on mount (`fetchCalls[0]` undefined / `setValue` never called). If phase 1 already implemented the mount path, these PASS — then skip to Step 5.

- [ ] **Step 3: Add the mount effect to `use-prefill.ts`**

Inside `usePrefill` in `src/components/prefill/use-prefill.ts`, keep phase 1's state (`run`, `setRun`, `error`, polling, `start`, `selectCandidates`) and add the following. Imports needed at the top of the file (add any that are missing):

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { FieldPath, UseFormReturn } from "react-hook-form";
import { mergeProposals } from "@/lib/prefill/merge";
import type { PrefillAddress, PrefillRunDTO } from "@/lib/prefill/types";
import type { InspectionFormData } from "@/types/inspection";
import { useProvenance } from "./provenance-context";
```

Body additions (place after the `useState` declarations; if phase 1 already has an "apply this run to the form" function used by the poller, reuse it instead of adding `applyRun` — the mount effect must call the same function so a run is applied exactly once):

```ts
  const { provenance, setMany } = useProvenance();
  // Latest provenance without re-creating callbacks on every change.
  const provenanceRef = useRef(provenance);
  provenanceRef.current = provenance;
  // Runs applied by this hook instance — guards against double-apply on re-render.
  const appliedRunIds = useRef<Set<string>>(new Set());

  const applyRun = useCallback(
    async (candidate: PrefillRunDTO) => {
      if (candidate.status !== "done" || candidate.appliedAt || appliedRunIds.current.has(candidate.id)) return;
      appliedRunIds.current.add(candidate.id);

      const { fills, provenance: next } = mergeProposals(
        form.getValues(),
        provenanceRef.current,
        candidate.proposals,
        { runId: candidate.id },
      );
      for (const fill of fills) {
        form.setValue(fill.fieldPath as FieldPath<InspectionFormData>, fill.value as never, {
          shouldDirty: true,
        });
      }
      setMany(next);

      try {
        await fetch(`/api/inspections/${inspectionId}/prefill/${candidate.id}/applied`, { method: "POST" });
      } catch {
        // Non-fatal: the next mount re-applies; mergeProposals is idempotent for identical values.
      }
    },
    [form, inspectionId, setMany],
  );

  // MOUNT: pick up a run created without this client (webhook trigger, another
  // device) and apply it once. queued/running runs are handed to the poller via setRun.
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/inspections/${inspectionId}/prefill/latest`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const latest = (await res.json()) as PrefillRunDTO | null;
        if (!latest || controller.signal.aborted) return;
        setRun(latest);
        if (latest.status === "done" && !latest.appliedAt) await applyRun(latest);
      } catch {
        // Offline or unmounted — the tile just shows no run.
      }
    })();
    return () => controller.abort();
  }, [enabled, inspectionId, applyRun]);
```

`isRunning` must derive from the exposed run (`run?.status === "queued" || run?.status === "running"`) so a running webhook run picked up on mount shows as running and the phase-1 poller (keyed on that state) resumes polling it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/prefill/`
Expected: PASS — the 8 mount tests plus every phase 1/2 test for the tile, badge, chip, context and hook.

- [ ] **Step 5: Commit**

```bash
git add src/components/prefill/use-prefill.ts src/components/prefill/__tests__/use-prefill.mount.test.tsx
git commit -m "feat(prefill): apply the latest unapplied run on wizard mount (webhook runs reach the form)"
```

---

### Task 11: End-to-end verification — shape check, build, full suite, manual webhook test

**Files:**
- No source changes expected. Fix anything the gates surface (a fix goes in its own commit with the failing test that caught it).

**Interfaces:**
- Consumes: everything above.
- Produces: evidence for the handoff — the phase 4/5 PR description.

- [ ] **Step 1: Live listing shape check (one real Apify lookup)**

Prerequisite: `.env.local` contains `APIFY_TOKEN` (add it in Vercel → Settings → Environment Variables for Production + Preview + Development first, then `npx vercel env pull .env.local`).

Run: `npx tsx --env-file=.env.local scripts/listing-shape-check.mts`
Expected: `HTTP 200`, `Dataset items: 1`, `Normalised facts` shows a `https://www.zillow.com/homedetails/…` URL and at least one of `waterSource` / `sewer` / `bedrooms`. If `findFact(WATER_KEYS)` is `undefined` but the "Water/sewer-related paths" list shows the real key, add it to `WATER_KEYS` / `SEWER_KEYS` (Task 1 file), add a fixture case to `normalise.test.ts` with the real shape, re-run `npx vitest run src/lib/prefill/listing/`, and commit as `fix(prefill): map Zillow <key> from the live actor output`.

- [ ] **Step 2: Type gate**

Run:

```bash
NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL:-https://placeholder.supabase.co} \
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:-placeholder} \
NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL:-http://localhost:3000} \
npm run build 2>&1 | tail -40
```

Expected: `✓ Compiled successfully` and the route table includes `ƒ /api/webhooks/workiz`. Any `Type error:` in a file touched by this plan is a defect to fix here (`npx tsc --noEmit` has pre-existing errors elsewhere — ignore those).

- [ ] **Step 3: Full test suite against the acceptance bar**

Run: `npx vitest run 2>&1 | tail -60`
Expected: the only failing files are the ~15 pre-existing ones (nav/roles/rbac, review-actions, reopen/download routes, `inspection.test` STEP_FIELDS + tank schema). Record the exact "Test Files … failed | … passed" line. To prove "no new failures", compare with the baseline on the commit before Task 1:

```bash
# Baseline in a throwaway worktree (never use bare `git stash` — the stash stack is shared with other sessions)
git worktree add /tmp/prefill-baseline "$(git log --format=%H --grep='listing provider contract' -n 1)~1"
(cd /tmp/prefill-baseline && npm install --silent && npx vitest run 2>&1 | grep -E "^ (FAIL|❯) " | sort > /tmp/baseline-failures.txt)
npx vitest run 2>&1 | grep -E "^ (FAIL|❯) " | sort > /tmp/current-failures.txt
diff /tmp/baseline-failures.txt /tmp/current-failures.txt && echo "no new failures"
git worktree remove /tmp/prefill-baseline --force
```

Expected: `no new failures` (the diff is empty).

- [ ] **Step 4: Manual webhook test against a local `next dev`**

This hits the **real** database configured in `.env.local` (it is the production Supabase project — there is no staging DB). The draft is real; clean it up in Step 5. Use a tech account that exists (the `tech.email` must match a `profiles.email`).

1. Start the app:

```bash
rm -rf .next && lsof -ti :3000 | xargs -r kill; npx next dev
```

2. In another terminal, send the webhook exactly as n8n does — `Authorization: Bearer <WORKIZ_WEBHOOK_SECRET>`, JSON body with `client`, `address`, `job`, `tech`, `apn`, optional `assessor` (shape from `src/lib/validators/workiz-webhook.ts`):

```bash
SECRET=$(grep '^WORKIZ_WEBHOOK_SECRET=' .env.local | cut -d= -f2- | tr -d '"')
TECH_EMAIL="<email of a real field-tech profile — see profiles.email>"
JOB_ID="PREFILL-SMOKE-$(date +%s)"
curl -s -X POST http://localhost:3000/api/webhooks/workiz \
  -H "Authorization: Bearer $SECRET" \
  -H "Content-Type: application/json" \
  -d "{
    \"client\": { \"firstName\": \"Prefill\", \"lastName\": \"Smoke\", \"email\": \"\", \"phone\": \"\" },
    \"address\": { \"street\": \"8911 E Cave Creek Rd\", \"city\": \"Carefree\", \"state\": \"AZ\", \"zip\": \"85377\", \"county\": \"Maricopa\" },
    \"job\": { \"jobId\": \"$JOB_ID\", \"jobType\": \"ADEQ Inspection\", \"serviceType\": \"\", \"scheduledDate\": \"2026-09-15\" },
    \"tech\": { \"email\": \"$TECH_EMAIL\", \"name\": \"\" },
    \"apn\": \"219-11-121\",
    \"assessor\": { \"ownerName\": \"Smoke Test Owner\", \"physicalAddress\": \"8911 E Cave Creek Rd\", \"city\": \"Carefree\", \"zip\": \"85377\", \"county\": \"Maricopa\", \"apnFormatted\": \"219-11-121\" }
  }"
echo
```

Expected: `{"inspectionId":"<uuid>","status":"draft","prefillRunId":"<uuid>"}` with HTTP 201 (add `-w '\n%{http_code}\n'` to see the code). A wrong secret returns `{"error":"Unauthorized"}` 401; no `apn` and no `assessor` returns 201 **without** `prefillRunId`.

3. Watch the run finish (queued → running → done within ~60 s; `next dev` runs `after()` callbacks in-process):

```bash
cat > /tmp/prefill-run-check.mjs <<'JS'
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
const [run] = await sql`
  select id, trigger, status, created_by, stages, jsonb_array_length(proposals) as proposals, finished_at
  from inspection_prefill_runs where id = ${process.argv[2]}`;
console.log(JSON.stringify(run, null, 2));
await sql.end();
JS
node --env-file=.env.local /tmp/prefill-run-check.mjs <prefillRunId>
```

Expected: `trigger: "webhook"`, `created_by: null`, `status: "done"` (or `awaiting_selection` if the permit search was ambiguous), `stages.listing.status` one of `done` / `not_found` / `error` with a summary and — when found — `links: [{ label: "Open on Zillow", url: "https://www.zillow.com/homedetails/…" }]`, `stages.permits` filled by phase 2/3.

4. Apply-on-mount: log in as that tech (or an admin) in the browser and open `http://localhost:3000/inspections/<inspectionId>`. Expected: the Prefill sources tile shows the three rows with the Zillow link opening in a new tab; prefilled fields carry the violet Listing badge (water source, bedrooms) and amber Permit badges; if the listing said "Sewer", an amber chip `Listing says "Sewer" — confirm this property is on septic` sits under Wastewater source. Reloading the page does **not** re-apply (the run now has `applied_at` set — re-run the check script to confirm `applied_at` is non-null after the page loaded).

- [ ] **Step 5: Clean up the smoke draft**

```bash
cat > /tmp/prefill-smoke-cleanup.mjs <<'JS'
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
const deleted = await sql`delete from inspections where workiz_job_id like 'PREFILL-SMOKE-%' returning id`;
console.log("deleted inspections:", deleted.map((r) => r.id));
await sql.end();
JS
node --env-file=.env.local /tmp/prefill-smoke-cleanup.mjs
```

Expected: the smoke inspection id is printed; `inspection_prefill_runs` and `inspection_records` rows cascade (FK `ON DELETE CASCADE`), and the stored permit PDFs under `inspection-media/records/<inspectionId>/` are removed by the same path the DELETE route uses (if phase 2 added storage cleanup on delete; otherwise remove the folder in the Supabase Storage UI).

- [ ] **Step 6: Commit any fixes and write the handoff**

If Steps 1–4 required changes, they are already committed with their tests. Then draft the PR description from the feature branch (do **not** push `main`) with: what changed (files above, new env var `APIFY_TOKEN` in Vercel prod/preview/dev), what was verified (the exact commands and outputs from Steps 1–4), what Daniel must do (set `APIFY_TOKEN` in Vercel before deploying; approve the deploy), known gaps (Zillow field names confirmed for one property only; `raw` listing item is not persisted on the run — no column in the contracts; multi-tank listing facts not proposed), rollback (revert the phase-4/5 commits — no migration in these phases).

---

## Self-review

**1. Spec coverage**

| Spec requirement | Task |
|---|---|
| §5.3 `ListingProvider` interface + `ListingFacts` (verbatim) | 1 |
| §5.3 Apify actor, `run-sync-get-dataset-items?token&timeout=60&memory=1024`, body `{ addresses: [full] }`, 60 s timeout | 2 |
| §5.3 defensive mapper (`waterSource`/`water`/`utilities.water`, `sewer`, `bedrooms`, `yearBuilt` case-insensitively; unmapped → null) | 1 |
| §5.3 water-source regex normalisation | 1 |
| §5.3 confidence 0.8 water / 0.85 bedrooms; sewer → warning on `facilityInfo.wastewaterSource` with the exact message | 3 |
| §7 rows "bedrooms (permit or listing)", "waterSource (listing or permit)", "listing sewer → warning" incl. permit-beats-listing | 3 (+ phase 3 `dedupeProposals`), 5 |
| §3 stages independent, run in parallel, a stage failure never fails the run | 4, 5 |
| §10 Apify error/timeout/not-found → stage `error` / `"No Zillow listing found for <address>"` | 4 |
| §2.6 / §9 tile links to the Zillow property URL, plain `<a target=_blank rel=noopener>` | 6 |
| §11 / §14 `APIFY_TOKEN` server-only, in `.env.example`, never logged | 2, 4, 7 |
| §5.3 "output field names confirmed with one real run" | 7, 11 |
| §8 webhook row: after creating the draft, if an APN is present insert a `webhook` run and `after(() => runPrefill(runId))` | 9 |
| §4 `created_by` null for webhook runs; §8 `maxDuration = 300`; never a floating promise | 9 |
| §8 "On wizard mount it fetches the latest run and applies it if unapplied" | 10 |
| §11 APN regex / address length ≤ 200 / printable ASCII on webhook input | 8 |
| §12 unit tests for water-source normalisation, mapping rows, route lifecycle; suites stay green | 1, 3, 9, 11 |
| §13 phases 4 and 5 as separate PR-able units | Tasks 1–7 / 8–11 |

Gaps, stated deliberately: `ListingFacts.raw` is "kept on the run for debugging" in the spec, but the contracts' `PrefillStage`/run row have no field for it, so it is not persisted (the shape-check script and the `evidence` strings cover debugging). The assessor `legalDescription` is not parsed into `subdivision`/`lot` for webhook runs (the permits stage falls back to the street search; the manual `Find records` path can pass them).

**2. Placeholder scan** — no "TBD/TODO/implement later"; every code step has full code; the only conditional steps are reconciliations with phase 1's not-yet-written hook/tile internals (Tasks 5, 6, 10), each with the exact code to add and a test that decides whether it is needed.

**3. Type/name consistency** — `normaliseListingItem`, `findFact`, `flattenText`, `WATER_KEYS`, `SEWER_KEYS`, `fullAddress`, `buildApifyUrl`, `zillowApifyProvider`, `ListingLookupError` (Tasks 1–2) are imported with those exact names in Tasks 3, 4, 7. `runListingStage(input, ctx, provider?)` (Task 4) is what Task 5 calls and mocks. `mapListingFacts`, `LISTING_WATER_CONFIDENCE`, `LISTING_BEDROOMS_CONFIDENCE`, `LISTING_SEWER_WARNING` (Task 3) are used in Task 4's summary expectations and Task 10's fixtures (0.8). `StageLinks` (Task 6) is used only in Task 6. `buildWebhookPrefillInput` / `WebhookPrefillSource` (Task 8) match the route's call in Task 9 (`{ apn, street, city, zip, addressVerified }`). `PrefillRunDTO` fields used in Tasks 6 and 10 fixtures match the contracts doc verbatim (`records`, `appliedAt`, `candidates`, `error`).
