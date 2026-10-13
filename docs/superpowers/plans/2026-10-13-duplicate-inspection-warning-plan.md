# Possible Duplicate Inspection Warning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a small amber, information-only notice ("This address may match another report") in wizard/review Step 1 and on every Workiz import-picker row, linking (new tab) to existing inspections whose APN or normalised street address may match.

**Architecture:** Pure, client-safe normalisation (`address-key.ts`, `normalize.ts`, `format.ts`) feeds a pure decision module (`match.ts`) that ranks candidates and splits visible from hidden matches. One bounded, parameterised Drizzle SELECT (`store.ts`) supplies candidates; `find.ts` wraps it for the wizard (one inspection) and the picker (one query for all rows). A new `POST /api/inspections/[id]/matches` route serves the wizard's live form values; `GET /api/workiz/jobs` adds the batch result per row (never cached). One React file holds the presentational `<PossibleDuplicateNotice>` and the debounced wizard container `<PossibleDuplicateWarning>`.

**Tech Stack:** Next.js 16 (App Router route handlers), React 19, react-hook-form 7, Drizzle ORM 0.45 over postgres-js, zod 4, Tailwind, lucide-react, vitest 4 + Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-10-13-duplicate-inspection-warning-design.md` (read §2, §5, §6, §8, §9 before starting any task).

## Global Constraints

- Repo `/Users/danielendres/InspectionFromfiller`, branch `feature/duplicate-inspection-warning` (already checked out). Never switch branches, never push, never deploy.
- The repo is NOT Biome-formatted. Never run `biome --write`, `biome check --write`, `npm run lint` or `npm run format`. Hand-edit in the surrounding style. The lint gate is `npx biome lint <files>` (Biome skips `.mts` files and `src/components/ui/**`).
- Never stage `CLAUDE.md` (memory-tool noise). Stage files by explicit path only; never `git add -A` / `git add .`.
- No real customer PII in repo files: synthetic fixtures only (`100 E Example Rd`, `123-45-678`, `Sam Sample`, `example.com`, ids like `6f1c2a9e-0000-4000-8000-…`).
- Known baseline: full `npx vitest run` has exactly **12** pre-existing failures (rbac.test.ts 1, inspections/[id]/download route 2, inspections/[id]/reopen route 2, layout mobile-nav 1, layout nav 2, lib/validators inspection.test.ts 2, types roles.test.ts 1, lib/constants inspection.test.ts 1). `npx tsc --noEmit` has 67 pre-existing errors, all in old test files (`src/__tests__/security/*`, `src/app/api/inspections/[id]/media/__tests__/route.test.ts`, `src/lib/pdf/__tests__/*`). `src/components/inspection/step-facility-info.tsx` has 3 pre-existing Biome findings (`noLabelWithoutControl` ×1, `useExhaustiveDependencies` ×2); the gate is "no NEW findings".
- Build check: `NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=placeholder NEXT_PUBLIC_APP_URL=http://localhost:3000 NEXT_PUBLIC_SITE_URL=http://localhost:3000 npx next build`.
- Commit trailer on every commit: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Copy strings are exact (spec §2.3) and live as exported constants in `src/components/inspection/possible-duplicate-warning.tsx`.
- Limits (spec §5.4, §6.1): `WIZARD_MATCH_LIMIT = 5`, `PICKER_MATCH_LIMIT = 3`, `CANDIDATE_LIMIT = 200`, `BATCH_CANDIDATE_LIMIT = 500`, `MATCH_FIELD_BODY_MAX = 1000`, `APN_MAX_LENGTH = 20` (existing), city key max 60 characters, `MATCH_DEBOUNCE_MS = 700`.
- Security rules (spec §8, §10, §11): a hidden match contributes only a count; DB errors are logged only through `logDbError` (never the error object, message, query or params); responses carry fixed error messages and never echo input; only house numbers and APN keys reach SQL, as bound parameters; addresses/APNs travel only in POST bodies, never URLs.
- No database migration, no new env vars, no new dependencies.

## File Map

| File | Status | Responsibility | Task |
|---|---|---|---|
| `src/lib/prefill/address-key.ts` | new | `splitUnit` (moved), `addressKey`, `addressKeysCompatible`, `SUFFIX_CANONICAL` | T1 |
| `src/lib/prefill/secondary.ts` | modify | import `splitUnit` from `./address-key` | T1 |
| `src/lib/prefill/input.ts` | modify | `export` on `STREET_SUFFIXES` | T1 |
| `src/lib/inspection-path.ts` | new | `inspectionPath(id, status, privileged)` | T2 |
| `src/lib/workiz/log-db-error.ts` | modify | optional 4th param `prefix = "workiz-import"` | T3 |
| `src/lib/workiz/custom-field-ids.ts` | new | leaf module holding `WORKIZ_CF` | T4 |
| `src/lib/workiz/adeq.ts` | modify | re-export `WORKIZ_CF`; summary gains `zip`, `apnHint` | T4 |
| `src/lib/workiz/apn-hint.ts` | modify | import `WORKIZ_CF` from the leaf | T4 |
| `src/lib/inspection-matches/store.ts` | new | `findMatchCandidates`, `candidateQuery`, `MatchCandidateRow` (server-only) | T5 |
| `src/types/inspection-matches.ts` | new | wire types | T6 |
| `src/lib/inspection-matches/normalize.ts` | new | `apnMatchKey`, `zip5`, `cityKey`, `buildMatchQuery`, `matchQueryKey`, `MATCH_FIELD_BODY_MAX` | T6 |
| `src/lib/inspection-matches/format.ts` | new | `headerNoun`, `reasonLabel`, `formatMatchWhen`, `inspectorLabel`, `matchDetailLine` | T7 |
| `src/lib/inspection-matches/match.ts` | new | `matchReasons`, `storedApnKey`, `localityCompatible`, `matchHref`, `buildMatchResult`, limits | T8 |
| `src/lib/inspection-matches/find.ts` | new | `findPossibleDuplicates`, `findPossibleDuplicatesBatch` | T9 |
| `src/components/inspection/possible-duplicate-warning.tsx` | new | copy constants, `<PossibleDuplicateNotice>`, `<PossibleDuplicateWarning>` | T10 |
| `src/app/api/inspections/[id]/matches/route.ts` | new | `POST` live-values check | T11 |
| `src/types/workiz-import.ts` | modify | `possibleMatches?`, `matchCheckFailed?` | T12 |
| `src/app/api/workiz/jobs/route.ts` | modify | batch lookup, own try/catch | T12 |
| `src/components/inspection/step-facility-info.tsx` | modify | render `<PossibleDuplicateWarning>` under Address | T13 |
| `src/components/inspection/workiz-import-picker.tsx` | modify | compact notice per row, failure line, `inspectionHref` → `inspectionPath` | T14 |
| `scripts/duplicate-match-smoke.mts`, `package.json` | new / modify | read-only live smoke `npm run smoke:matches` | T15 |
| spec §16 decision 3 | modify | record the first smoke baseline | T15 |

## Waves (tasks in one wave touch disjoint files and may run in parallel)

| Wave | Tasks | Depends on |
|---|---|---|
| 1 | T1, T2, T3, T4, T5 | — |
| 2 | T6 | T1 |
| 3 | T7, T8 | T6 (T8 also T1, T2, T5) |
| 4 | T9, T10 | T9: T5, T8 · T10: T6, T7 |
| 5 | T11, T12, T13 | T11: T3, T6, T9 · T12: T4, T6, T8, T9 · T13: T10 |
| 6 | T14, T15 | T14: T2, T10, T12 · T15: T1, T5, T6, T8, T9 |
| 7 | T16 | all |

Validation note: every code block below was applied in a throwaway worktree on 2026-10-13 and passed its own tests, the full suite (only the 12 baseline failures), `tsc` (no new errors), `biome lint` (no new findings) and the production build. The smoke ran read-only against production and printed counts only.

---

### Task T1: Address key (`address-key.ts`) and the `splitUnit` move

**Files:**
- Create: `src/lib/prefill/address-key.ts`
- Modify: `src/lib/prefill/secondary.ts` (remove the local `UNIT_WORD` + `splitUnit`, import it)
- Modify: `src/lib/prefill/input.ts:16` (`const STREET_SUFFIXES` → `export const STREET_SUFFIXES`)
- Test: `src/lib/prefill/__tests__/address-key.test.ts` (new); `src/lib/prefill/__tests__/secondary.test.ts` (unchanged, regression)

**Interfaces:**
- Consumes: `parseStreetAddress(line): { streetNumber; streetDir?; streetName } | null` and `STREET_SUFFIXES: Set<string>` from `src/lib/prefill/input.ts`.
- Produces:
  - `interface AddressKey { number: string; dir: string | null; street: string; suffix: string | null; unit: string | null }`
  - `splitUnit(line: string): { street: string; unit: string }` (code unchanged from `secondary.ts`)
  - `SUFFIX_CANONICAL: Readonly<Record<string, string>>`
  - `addressKey(line: string): AddressKey | null`
  - `addressKeysCompatible(a: AddressKey, b: AddressKey): boolean` (number + street equal; dir/suffix/unit equal or either null; NO locality)

- [ ] **Step 1: Write the failing test** — create `src/lib/prefill/__tests__/address-key.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  type AddressKey,
  addressKey,
  addressKeysCompatible,
  SUFFIX_CANONICAL,
  splitUnit,
} from "@/lib/prefill/address-key";
import { STREET_SUFFIXES } from "@/lib/prefill/input";

// Synthetic addresses only (duplicate-warning spec §12)
const key = (line: string) => addressKey(line);
const differ = (a: string, b: string) => {
  const ka = key(a);
  const kb = key(b);
  expect(ka).not.toBeNull();
  expect(kb).not.toBeNull();
  expect(addressKeysCompatible(ka as AddressKey, kb as AddressKey)).toBe(false);
};
const compatible = (a: string, b: string) => {
  expect(addressKeysCompatible(key(a) as AddressKey, key(b) as AddressKey)).toBe(true);
};

describe("splitUnit (moved from secondary.ts, unchanged)", () => {
  it("splits #, unit words followed by a unit token, and keeps Lot Rd as a street", () => {
    expect(splitUnit("100 E Example Rd #12")).toEqual({ street: "100 E Example Rd", unit: "12" });
    expect(splitUnit("100 E Example Rd Space 12")).toEqual({ street: "100 E Example Rd", unit: "12" });
    expect(splitUnit("100 E Example Rd #Space 12")).toEqual({ street: "100 E Example Rd", unit: "SPACE12" });
    expect(splitUnit("100 E Lot Rd")).toEqual({ street: "100 E Lot Rd", unit: "" });
  });
});

describe("addressKey", () => {
  it("returns null without a leading house number", () => {
    expect(key("Example Rd")).toBeNull();
    expect(key("")).toBeNull();
  });

  it("splits number, direction, street words and canonical suffix", () => {
    expect(key("100 E. Cave Creek Rd")).toEqual({ number: "100", dir: "E", street: "CAVE CREEK", suffix: "RD", unit: null });
    expect(key("100 East Example Road")).toEqual({ number: "100", dir: "E", street: "EXAMPLE", suffix: "RD", unit: null });
    expect(key("100 E South Mountain Ave")).toEqual({ number: "100", dir: "E", street: "SOUTH MOUNTAIN", suffix: "AVE", unit: null });
    expect(key("100 Broadway")).toEqual({ number: "100", dir: null, street: "BROADWAY", suffix: null, unit: null });
    expect(key("1234 N 7th")).toEqual({ number: "1234", dir: "N", street: "7TH", suffix: null, unit: null });
  });

  it("canonicalises units: #Space 12 / Space 12 / #12 → 12, #Lot 7 / Lot 7 → 7, Unit 4 → 4", () => {
    for (const line of ["100 E Example Rd #Space 12", "100 E Example Rd Space 12", "100 E Example Rd #12"]) {
      expect(key(line)?.unit).toBe("12");
    }
    expect(key("100 E Example Rd #Lot 7")?.unit).toBe("7");
    expect(key("100 E Example Rd Lot 7")?.unit).toBe("7");
    expect(key("100 E Example Rd Unit 4")?.unit).toBe("4");
    expect(key("100 E Lot Rd")).toEqual({ number: "100", dir: "E", street: "LOT", suffix: "RD", unit: null });
  });

  it("comma cut: city/state/ZIP segments are dropped, unit segments kept", () => {
    expect(key("100 E Example Rd, Cave Creek, AZ 85331")).toEqual(key("100 E Example Rd"));
    expect(key("100 E Example Rd, #12")?.unit).toBe("12");
    expect(key("100 E Example Rd, Unit 4")?.unit).toBe("4");
    expect(key("100 E Example Rd, #12, Cave Creek")).toEqual(key("100 E Example Rd #12"));
  });

  it("direction words inside the street name stay part of the name", () => {
    differ("100 W North Ln", "100 W South Ln");
    differ("100 N East St", "100 N West St");
    differ("100 N West Valley Rd", "100 N Valley Rd");
    differ("100 North Ln", "100 South Ln");
    expect(key("100 North Ln")).toEqual({ number: "100", dir: null, street: "NORTH", suffix: "LN", unit: null });
    expect(key("100 NE Way")).toEqual({ number: "100", dir: null, street: "NE", suffix: "WAY", unit: null });
  });

  it("SUFFIX_CANONICAL covers exactly STREET_SUFFIXES", () => {
    expect(Object.keys(SUFFIX_CANONICAL).sort()).toEqual([...STREET_SUFFIXES].sort());
  });
});

describe("addressKeysCompatible (§5.5 address rows, locality aside)", () => {
  it("matches abbreviation and punctuation variants", () => {
    compatible("100 E Example Rd", "100 E. Example Road"); // #6
    compatible("100 Example Rd", "100 E Example Rd"); // #8 direction missing on one side
    compatible("1234 N 7th", "1234 N 7th Ave"); // #10 suffix missing on one side
    compatible("100 E Example Rd Space 12", "100 E Example Rd"); // #12 unit missing on one side
    compatible("100 E Example Rd #Space 12", "100 E Example Rd Space 12"); // #12a
    compatible("100 E Example Rd #Lot 7", "100 E Example Rd Lot 7"); // #12b
    compatible("100 E Example Rd, Cave Creek, AZ 85331", "100 E Example Rd"); // #12c
  });

  it("rejects a different direction, suffix, unit, number or street", () => {
    differ("100 E Example Rd", "100 W Example Rd"); // #7
    differ("1234 N 7th St", "1234 N 7th Ave"); // #9
    differ("100 E Example Rd #12", "100 E Example Rd #14"); // #11
    differ("100 E Example Rd, #12", "100 E Example Rd #14"); // #12d
    differ("100 E Example Rd", "102 E Example Rd");
    differ("100 E Example Rd", "100 E Sample Rd");
  });

  it("truth table: equal / missing / different for dir, suffix and unit", () => {
    const base: AddressKey = { number: "100", dir: "E", street: "EXAMPLE", suffix: "RD", unit: "12" };
    for (const part of ["dir", "suffix", "unit"] as const) {
      expect(addressKeysCompatible(base, { ...base })).toBe(true);
      expect(addressKeysCompatible(base, { ...base, [part]: null })).toBe(true);
      expect(addressKeysCompatible({ ...base, [part]: null }, base)).toBe(true);
      expect(addressKeysCompatible(base, { ...base, [part]: "ZZ" })).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/prefill/__tests__/address-key.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/prefill/address-key"` (and `STREET_SUFFIXES` is not exported yet).

- [ ] **Step 3: Implement** — create `src/lib/prefill/address-key.ts`:

```ts
import { parseStreetAddress } from "./input";

/**
 * Comparable street-address key for the possible-duplicate check (duplicate-warning spec §5.2).
 * Pure and client-safe: the wizard computes it to dedupe requests, the server to decide matches.
 */
export interface AddressKey {
  number: string;
  /** N/S/E/W/NE/NW/SE/SW, or null when none was typed */
  dir: string | null;
  /** Uppercase street words without direction or suffix: "CAVE CREEK" */
  street: string;
  /** Canonical abbreviation ("RD"), or null when none was typed */
  suffix: string | null;
  /** "12" for "#12" / "Space 12" / "#Space 12", or null */
  unit: string | null;
}

const UNIT_WORD = /^(UNIT|APT|STE|SUITE|SPACE|SPC|LOT)$/i;

/** "100 E Example Rd Space 12" → { street: "100 E Example Rd", unit: "12" } */
export function splitUnit(line: string): { street: string; unit: string } {
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

/** Every STREET_SUFFIXES entry → its canonical abbreviation (a test pins the key set) */
export const SUFFIX_CANONICAL: Readonly<Record<string, string>> = {
  ROAD: "RD", RD: "RD", STREET: "ST", ST: "ST", AVENUE: "AVE", AVE: "AVE", DRIVE: "DR", DR: "DR",
  LANE: "LN", LN: "LN", BOULEVARD: "BLVD", BLVD: "BLVD", COURT: "CT", CT: "CT", PLACE: "PL",
  PL: "PL", CIRCLE: "CIR", CIR: "CIR", TRAIL: "TRL", TRL: "TRL", PARKWAY: "PKWY", PKWY: "PKWY",
  HIGHWAY: "HWY", HWY: "HWY", TERRACE: "TER", TER: "TER", WAY: "WAY", LOOP: "LOOP",
};

const SUFFIXES = new Map(Object.entries(SUFFIX_CANONICAL));

/** "100 North Ln" parses as dir N + street "Ln": the direction word was the street name */
const DIRECTION_WORD: Record<string, string> = { N: "NORTH", S: "SOUTH", E: "EAST", W: "WEST" };

const UNIT_SEGMENT = /^(#\s*[A-Za-z0-9-]{1,8}|(UNIT|APT|STE|SUITE|SPACE|SPC|LOT)\s+#?[A-Za-z0-9-]{1,8})$/i;

/** "100 E Example Rd, #12, Cave Creek, AZ 85331" → "100 E Example Rd #12" */
function cutAtComma(line: string): string {
  const [first, ...rest] = line.split(",");
  const kept = [first];
  for (const segment of rest) {
    const trimmed = segment.trim();
    if (!UNIT_SEGMENT.test(trimmed)) break;
    kept.push(trimmed);
  }
  return kept.join(" ");
}

const UNIT_PREFIX = /^(SUITE|STE|SPACE|SPC|UNIT|APT|LOT)(.+)$/;

/** "SPACE12" / "#12" / "12" → "12"; empty → null */
function canonicalUnit(raw: string): string | null {
  const unit = raw.toUpperCase().replace(/[#\s]/g, "");
  return (UNIT_PREFIX.exec(unit)?.[2] ?? unit) || null;
}

/** Null when the line has no leading house number (no key → no address matching) */
export function addressKey(line: string): AddressKey | null {
  const split = splitUnit(cutAtComma(line));
  const parsed = parseStreetAddress(split.street);
  if (!parsed) return null;

  // Own street-word step: normalizeStreetName would drop a second direction word ("W North Ln" → "LN")
  const words = parsed.streetName
    .toUpperCase()
    .replace(/['"]/g, "")
    .replace(/[^A-Z0-9]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  let dir = parsed.streetDir ?? null;
  let suffix: string | null = null;
  const last = words[words.length - 1];
  if (dir && words.length === 1 && SUFFIXES.has(last)) {
    suffix = SUFFIXES.get(last) ?? null;
    words[0] = DIRECTION_WORD[dir] ?? dir;
    dir = null;
  } else if (words.length >= 2 && SUFFIXES.has(last)) {
    suffix = SUFFIXES.get(last) ?? null;
    words.pop();
  }
  const street = words.join(" ");
  if (!street) return null;
  return { number: parsed.streetNumber, dir, street, suffix, unit: canonicalUnit(split.unit) };
}

const sameOrMissing = (a: string | null, b: string | null): boolean => a === null || b === null || a === b;

/** §5.3 address rule without locality: number and street equal; dir/suffix/unit equal or missing */
export function addressKeysCompatible(a: AddressKey, b: AddressKey): boolean {
  return (
    a.number === b.number &&
    a.street === b.street &&
    sameOrMissing(a.dir, b.dir) &&
    sameOrMissing(a.suffix, b.suffix) &&
    sameOrMissing(a.unit, b.unit)
  );
}
```

Then in `src/lib/prefill/input.ts` change line 16 from `const STREET_SUFFIXES = new Set([` to:

```ts
export const STREET_SUFFIXES = new Set([
```

Then in `src/lib/prefill/secondary.ts`:
1. Add as the first import line: `import { splitUnit } from "./address-key";`
2. Delete the whole block from `const UNIT_WORD = /^(UNIT|APT|STE|SUITE|SPACE|SPC|LOT)$/i;` through the closing `}` of `function splitUnit(...)` (the 18 lines directly above `function addressesEqual`). `addressesEqual` keeps calling `splitUnit` unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/prefill/__tests__/address-key.test.ts src/lib/prefill/__tests__/secondary.test.ts src/lib/prefill/__tests__/input.test.ts`
Expected: PASS (3 files; address-key 10 tests, secondary 22, input 16).

- [ ] **Step 5: Lint and type-check**

Run: `npx biome lint src/lib/prefill/address-key.ts src/lib/prefill/__tests__/address-key.test.ts src/lib/prefill/secondary.ts src/lib/prefill/input.ts`
Expected: no errors/warnings.
Run: `npx tsc --noEmit 2>&1 | grep -E "src/lib/prefill/(address-key|secondary|input)"`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/lib/prefill/address-key.ts src/lib/prefill/__tests__/address-key.test.ts src/lib/prefill/secondary.ts src/lib/prefill/input.ts
git commit -m "feat(dup-warning): normalised address key; move splitUnit to address-key

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task T2: `inspectionPath` (shared handleRowClick routing)

**Files:**
- Create: `src/lib/inspection-path.ts`
- Test: `src/lib/__tests__/inspection-path.test.ts`

**Interfaces:**
- Produces: `inspectionPath(id: string, status: string, privileged: boolean): string` — `draft` → `/inspections/{id}/edit`; else privileged → `/review/{id}`; else `/inspections/{id}`. (The picker switches to it in T14; `match.ts` uses it in T8.)

- [ ] **Step 1: Write the failing test** — create `src/lib/__tests__/inspection-path.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { inspectionPath } from "@/lib/inspection-path";

describe("inspectionPath", () => {
  it("opens a draft in the wizard for anyone", () => {
    expect(inspectionPath("i1", "draft", true)).toBe("/inspections/i1/edit");
    expect(inspectionPath("i1", "draft", false)).toBe("/inspections/i1/edit");
  });

  it.each(["submitted", "in_review", "completed", "sent"])(
    "%s → /review when privileged, the read-only view otherwise",
    (status) => {
      expect(inspectionPath("i1", status, true)).toBe("/review/i1");
      expect(inspectionPath("i1", status, false)).toBe("/inspections/i1");
    },
  );
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/__tests__/inspection-path.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/inspection-path"`.

- [ ] **Step 3: Implement** — create `src/lib/inspection-path.ts`:

```ts
/**
 * In-app route for an inspection, the routing of handleRowClick in
 * src/components/dashboard/inspections-table.tsx: drafts open the wizard, everything else the
 * review editor for admin/office staff and the read-only view for the field-tech owner.
 */
export function inspectionPath(id: string, status: string, privileged: boolean): string {
  if (status === "draft") return `/inspections/${id}/edit`;
  return privileged ? `/review/${id}` : `/inspections/${id}`;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lib/__tests__/inspection-path.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Lint**

Run: `npx biome lint src/lib/inspection-path.ts src/lib/__tests__/inspection-path.test.ts`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/inspection-path.ts src/lib/__tests__/inspection-path.test.ts
git commit -m "feat(dup-warning): shared inspectionPath routing helper

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task T3: `logDbError` optional prefix

**Files:**
- Modify: `src/lib/workiz/log-db-error.ts`
- Test: `src/lib/workiz/__tests__/log-db-error.test.ts` (append one test)

**Interfaces:**
- Produces: `logDbError(scope: string, err: unknown, ctx: { serialId?: number | null } = {}, prefix = "workiz-import"): void` — every existing call keeps its exact output; T11 calls it with `"inspection-matches"`.

- [ ] **Step 1: Write the failing test** — append inside the existing `describe("logDbError", …)` block of `src/lib/workiz/__tests__/log-db-error.test.ts` (before its final `});`):

```ts
  it("uses the given prefix, defaulting to [workiz-import], and still logs no PII", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logDbError("match_lookup", drizzleError({ code: "57014" }), {}, "inspection-matches");
    logDbError("jobs_match_lookup", drizzleError({ code: "57014" }));
    expect(spy.mock.calls[0]).toEqual([
      "[inspection-matches] db error scope=match_lookup job=- code=57014 constraint=-",
    ]);
    expect(spy.mock.calls[1]).toEqual([
      "[workiz-import] db error scope=jobs_match_lookup job=- code=57014 constraint=-",
    ]);
    const logged = JSON.stringify(spy.mock.calls);
    for (const value of PII) expect(logged).not.toContain(value);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/workiz/__tests__/log-db-error.test.ts`
Expected: FAIL — the first call logs `[workiz-import] db error scope=match_lookup …` instead of `[inspection-matches] …` (TS also flags the 4th argument, vitest still runs).

- [ ] **Step 3: Implement** — in `src/lib/workiz/log-db-error.ts`:

Replace the end of the header comment

```ts
 * never log the error object, its message, query or params: only this line.
 */
```

with

```ts
 * never log the error object, its message, query or params: only this line. `prefix` lets other
 * features (the possible-duplicate check passes "inspection-matches") reuse the same safe line.
 */
```

Replace the signature tail

```ts
  ctx: { serialId?: number | null } = {},
): void {
```

with

```ts
  ctx: { serialId?: number | null } = {},
  prefix = "workiz-import",
): void {
```

and in the `console.error` template replace `` `[workiz-import] db error scope=`` with `` `[${prefix}] db error scope=``.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lib/workiz/__tests__/log-db-error.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Lint**

Run: `npx biome lint src/lib/workiz/log-db-error.ts src/lib/workiz/__tests__/log-db-error.test.ts`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/workiz/log-db-error.ts src/lib/workiz/__tests__/log-db-error.test.ts
git commit -m "feat(dup-warning): optional log prefix for logDbError

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task T4: Workiz summary `zip` + `apnHint`; `WORKIZ_CF` leaf module

**Files:**
- Create: `src/lib/workiz/custom-field-ids.ts`
- Modify: `src/lib/workiz/adeq.ts`, `src/lib/workiz/apn-hint.ts:2`
- Test: `src/lib/workiz/__tests__/adeq.test.ts`

**Interfaces:**
- Consumes: existing `formatWorkizZip(zip: string): string | null` (`custom-fields.ts`), `findApnHint(job): { hint: { apn: string; … } | null; … }` (`apn-hint.ts`).
- Produces: `WorkizJobSummary` gains `zip: string | null` and `apnHint: string | null` (server-side only, never on the wire); `WORKIZ_CF` importable from `./custom-field-ids` and still from `./adeq` (same object).

- [ ] **Step 1: Write the failing test** — edit `src/lib/workiz/__tests__/adeq.test.ts`:

Replace the line `import { fixtures, job } from "./fixtures/jobs";` with:

```ts
import { WORKIZ_CF as LEAF_WORKIZ_CF } from "@/lib/workiz/custom-field-ids";
import { BOT_NOTES, cf, fixtures, job, withAddress } from "./fixtures/jobs";
```

In the existing `it("toJobSummary carries only summary fields", …)` `toEqual`, add two keys after `teamFirstNames: ["Alex", "Sam"],`:

```ts
      zip: "85331",
      apnHint: null,
```

Append inside `describe("summary helpers", …)` (before its closing `});`), and add a new `describe` after it:

```ts
  it("toJobSummary adds the server-side zip (5 digits, ZIP+4 → first 5, invalid → null)", () => {
    expect(toJobSummary(job()).zip).toBe("85331");
    expect(toJobSummary(parse(withAddress({ zipCode: "85331-1234" }))).zip).toBe("85331");
    expect(toJobSummary(parse(withAddress({ zipCode: "8533" }))).zip).toBeNull();
    expect(toJobSummary(parse(withAddress({ zipCode: "" }))).zip).toBeNull();
  });

  it("toJobSummary adds the apnHint: custom field, else newest bot note, else null", () => {
    expect(toJobSummary(job({ customFields: [cf(WORKIZ_CF.apn, "12345670")] })).apnHint).toBe("123-45-670");
    expect(toJobSummary(job({ notes: [BOT_NOTES.grokHigh, BOT_NOTES.noConfidence] })).apnHint).toBe("123-45-679");
    expect(toJobSummary(job()).apnHint).toBeNull();
  });
});

describe("WORKIZ_CF leaf module", () => {
  it("adeq re-exports the very same object", () => {
    expect(WORKIZ_CF).toBe(LEAF_WORKIZ_CF);
  });
```

(the final `});` of the file then closes the new describe).

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/workiz/__tests__/adeq.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/workiz/custom-field-ids"`.

- [ ] **Step 3: Implement**

Create `src/lib/workiz/custom-field-ids.ts`:

```ts
/**
 * Workiz custom-field ids (account-specific). A leaf module with no imports so apn-hint.ts and
 * adeq.ts can both use it without an adeq ↔ apn-hint import cycle. adeq.ts re-exports it.
 * Custom fields are matched by id, never by fieldName (several names carry trailing spaces).
 */
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
```

In `src/lib/workiz/adeq.ts`:
1. Replace the first import line with:

```ts
import { findApnHint } from "./apn-hint";
import { formatWorkizCity, formatWorkizStreet, formatWorkizZip } from "./custom-fields";
```

2. Replace the whole `/** Custom fields are matched by id … */ export const WORKIZ_CF = { … } as const;` block with:

```ts
export { WORKIZ_CF } from "./custom-field-ids";
```

3. In `interface WorkizJobSummary`, after `teamFirstNames: string[];` add:

```ts
  /** 5-digit ZIP or null; server-side only (feeds the possible-duplicate check, never the wire) */
  zip: string | null;
  /** Formatted APN from the custom field or the newest permit-bot note; server-side only */
  apnHint: string | null;
```

4. In `toJobSummary`, after `teamFirstNames: teamFirstNames(job),` add:

```ts
    zip: formatWorkizZip(address.zipCode),
    apnHint: findApnHint(job).hint?.apn ?? null,
```

In `src/lib/workiz/apn-hint.ts` replace `import { WORKIZ_CF } from "./adeq";` with:

```ts
import { WORKIZ_CF } from "./custom-field-ids";
```

(Dependency graph is now `custom-field-ids ← apn-hint ← adeq`: no cycle. `map-job.ts`, fixtures and other tests keep importing `WORKIZ_CF` from `./adeq`.)

- [ ] **Step 4: Run the Workiz suites to verify they pass**

Run: `npx vitest run src/lib/workiz src/app/api/workiz`
Expected: PASS (14 files, 0 failures; the jobs route test still passes because summaries are not on the wire).

- [ ] **Step 5: Lint and type-check**

Run: `npx biome lint src/lib/workiz/custom-field-ids.ts src/lib/workiz/adeq.ts src/lib/workiz/apn-hint.ts src/lib/workiz/__tests__/adeq.test.ts`
Expected: clean.
Run: `npx tsc --noEmit 2>&1 | grep -E "src/lib/workiz|src/app/api/workiz"`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/lib/workiz/custom-field-ids.ts src/lib/workiz/adeq.ts src/lib/workiz/apn-hint.ts src/lib/workiz/__tests__/adeq.test.ts
git commit -m "feat(dup-warning): server-side zip and apnHint on Workiz job summaries

Moves WORKIZ_CF to a leaf module so adeq.ts can use findApnHint without an
import cycle; adeq.ts re-exports it unchanged.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task T5: Candidate SELECT (`store.ts`)

**Files:**
- Create: `src/lib/inspection-matches/store.ts`
- Test: `src/lib/inspection-matches/__tests__/store.test.ts`

**Interfaces:**
- Consumes: `db` (`@/lib/db`), `inspections`, `profiles` (`@/lib/db/schema`).
- Produces:
  - `interface MatchCandidateRow { id; inspectorId; status; facilityAddress: string | null; facilityCity: string | null; facilityZip: string | null; apn: string | null; taxParcelNumber: string | null; inspectionDate: string | null; createdAt: Date; workizJobId: string | null; inspectorName: string | null }`
  - `interface CandidateQueryArgs { houseNumbers: string[]; apnKeys: string[]; excludeInspectionId?: string; limit: number }`
  - `findMatchCandidates(args: CandidateQueryArgs): Promise<{ rows: MatchCandidateRow[]; capHit: boolean }>` (queries `LIMIT limit + 1`; `rows.length <= limit`)
  - `candidateQuery(database, args)` (builder, for `.toSQL()` tests; `null` when both lists are empty) and `CANDIDATE_FIELDS`.

- [ ] **Step 1: Write the failing test** — create `src/lib/inspection-matches/__tests__/store.test.ts`:

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRows, mockSelect } = vi.hoisted(() => ({ mockRows: vi.fn(), mockSelect: vi.fn() }));

// The mocked executor: select().from().leftJoin().where().orderBy().limit() → rows
vi.mock("@/lib/db", () => {
  const chain = {
    from: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => mockRows()),
  };
  mockSelect.mockImplementation(() => chain);
  return { db: { select: mockSelect } };
});

import { inspections } from "@/lib/db/schema";
import {
  CANDIDATE_FIELDS,
  candidateQuery,
  findMatchCandidates,
  type MatchCandidateRow,
} from "@/lib/inspection-matches/store";

// A real Drizzle instance over a client that never connects: only .toSQL() is used
const offlineDb = drizzle(postgres("postgres://user:pass@127.0.0.1:1/none", { prepare: false }));
const EXCLUDE = "6f1c2a9e-0000-4000-8000-000000000001";

const toSql = (args: Parameters<typeof candidateQuery>[1]) => {
  const query = candidateQuery(offlineDb, args);
  if (!query) throw new Error("expected a query");
  return query.toSQL();
};

function row(id: string): MatchCandidateRow {
  return {
    id,
    inspectorId: "user-1",
    status: "completed",
    facilityAddress: "100 E Example Rd",
    facilityCity: "Cave Creek",
    facilityZip: "85331",
    apn: null,
    taxParcelNumber: "123-45-678",
    inspectionDate: "2026-10-06",
    createdAt: new Date("2026-10-06T19:12:00.000Z"),
    workizJobId: null,
    inspectorName: "Sam Sample",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("candidateQuery SQL", () => {
  it("renders the three prefilter expressions, the exclusion, ORDER BY … DESC and LIMIT limit+1 — values only in params", () => {
    const { sql, params } = toSql({
      houseNumbers: ["100", "2040"],
      apnKeys: ["12345678"],
      excludeInspectionId: EXCLUDE,
      limit: 200,
    });
    expect(sql).toContain(`substring("inspections"."facility_address" from '^[[:space:]]*([0-9]{1,8})[[:space:]]')`);
    expect(sql).toContain(`upper(regexp_replace(coalesce("inspections"."apn", ''), '[^0-9A-Za-z]', '', 'g'))`);
    expect(sql).toContain(
      `upper(regexp_replace(coalesce("inspections"."form_data" -> 'facilityInfo' ->> 'taxParcelNumber', ''), '[^0-9A-Za-z]', '', 'g'))`,
    );
    expect(sql).toContain(`"inspections"."id" <> $`);
    expect(sql).toContain(`left join "profiles" on "profiles"."id" = "inspections"."inspector_id"`);
    expect(sql).toMatch(/order by "inspections"\."created_at" desc limit \$\d+$/);
    expect(params).toEqual(expect.arrayContaining([EXCLUDE, "100", "2040", "12345678", 201]));
    for (const value of [EXCLUDE, "2040", "12345678"]) expect(sql).not.toContain(value);
  });

  it("leaves out the APN branches without APN keys, and the address branch without house numbers", () => {
    const addressOnly = toSql({ houseNumbers: ["100"], apnKeys: [], limit: 5 }).sql;
    expect(addressOnly).toContain("substring(");
    expect(addressOnly).not.toContain("regexp_replace");
    expect(addressOnly).not.toContain("<>");
    const apnOnly = toSql({ houseNumbers: [], apnKeys: ["12345678"], limit: 5 }).sql;
    expect(apnOnly).not.toContain("substring(");
    expect(apnOnly.match(/regexp_replace/g)).toHaveLength(2);
  });

  it("returns null with nothing to match on", () => {
    expect(candidateQuery(offlineDb, { houseNumbers: [], apnKeys: [], limit: 5 })).toBeNull();
  });

  it("selects createdAt through the typed timestamp column, which maps to a UTC Date", () => {
    expect(CANDIDATE_FIELDS.createdAt).toBe(inspections.createdAt);
    const mapped = inspections.createdAt.mapFromDriverValue("2026-10-06 19:12:00");
    expect(mapped).toBeInstanceOf(Date);
    expect((mapped as Date).toISOString()).toBe("2026-10-06T19:12:00.000Z");
  });
});

describe("findMatchCandidates", () => {
  it("both lists empty → no query", async () => {
    expect(await findMatchCandidates({ houseNumbers: [], apnKeys: [], limit: 5 })).toEqual({ rows: [], capHit: false });
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("limit + 1 rows → capHit and the extra row dropped", async () => {
    mockRows.mockResolvedValue([row("a"), row("b"), row("c")]);
    const result = await findMatchCandidates({ houseNumbers: ["100"], apnKeys: [], limit: 2 });
    expect(result.capHit).toBe(true);
    expect(result.rows.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("exactly limit rows → not capped", async () => {
    mockRows.mockResolvedValue([row("a"), row("b")]);
    const result = await findMatchCandidates({ houseNumbers: ["100"], apnKeys: [], limit: 2 });
    expect(result).toEqual({ rows: [row("a"), row("b")], capHit: false });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/inspection-matches/__tests__/store.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/inspection-matches/store"`.

- [ ] **Step 3: Implement** — create `src/lib/inspection-matches/store.ts`:

```ts
import "server-only";
import { and, desc, eq, inArray, ne, or, type SQL, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import { inspections, profiles } from "@/lib/db/schema";

/**
 * The possible-duplicate check's only DB access (duplicate-warning spec §7.1): one bounded
 * SELECT. The WHERE is a SUPERSET prefilter — match.ts decides. Only house numbers (^\d{1,8}$)
 * and APN keys ([0-9A-Z]{6,20}) reach SQL, always as bound parameters. Callers log failures with
 * logDbError only: a Drizzle error message carries these params.
 */

export interface MatchCandidateRow {
  id: string;
  inspectorId: string;
  status: string;
  facilityAddress: string | null;
  facilityCity: string | null;
  facilityZip: string | null;
  apn: string | null;
  taxParcelNumber: string | null;
  inspectionDate: string | null;
  createdAt: Date;
  workizJobId: string | null;
  inspectorName: string | null;
}

export interface CandidateQueryArgs {
  houseNumbers: string[];
  apnKeys: string[];
  excludeInspectionId?: string;
  limit: number;
}

const FORM_APN = sql`${inspections.formData} -> 'facilityInfo' ->> 'taxParcelNumber'`;

/** Same leading-number rule as parseStreetAddress; [[:space:]]* also skips tabs/newlines */
const HOUSE_NUMBER = sql`substring(${inspections.facilityAddress} from '^[[:space:]]*([0-9]{1,8})[[:space:]]')`;

const compactApn = (value: SQL) => sql`upper(regexp_replace(coalesce(${value}, ''), '[^0-9A-Za-z]', '', 'g'))`;

/** Typed columns so createdAt goes through the timestamp mapper and arrives as a Date */
export const CANDIDATE_FIELDS = {
  id: inspections.id,
  inspectorId: inspections.inspectorId,
  status: inspections.status,
  facilityAddress: inspections.facilityAddress,
  facilityCity: inspections.facilityCity,
  facilityZip: inspections.facilityZip,
  apn: inspections.apn,
  taxParcelNumber: sql<string | null>`${FORM_APN}`,
  inspectionDate: sql<string | null>`${inspections.formData} -> 'facilityInfo' ->> 'dateOfInspection'`,
  createdAt: inspections.createdAt,
  workizJobId: inspections.workizJobId,
  inspectorName: profiles.fullName,
};

type AnyPgDatabase = PgDatabase<PgQueryResultHKT, Record<string, unknown>>;

/** The SELECT builder (exported so a test can inspect `.toSQL()`); null when nothing to match on */
export function candidateQuery(database: AnyPgDatabase, args: CandidateQueryArgs) {
  const branches: SQL[] = [];
  if (args.houseNumbers.length > 0) branches.push(inArray(HOUSE_NUMBER, args.houseNumbers));
  if (args.apnKeys.length > 0) {
    branches.push(inArray(compactApn(sql`${inspections.apn}`), args.apnKeys));
    branches.push(inArray(compactApn(FORM_APN), args.apnKeys));
  }
  if (branches.length === 0) return null;
  const anyBranch = or(...branches);
  const where = args.excludeInspectionId ? and(ne(inspections.id, args.excludeInspectionId), anyBranch) : anyBranch;
  return database
    .select(CANDIDATE_FIELDS)
    .from(inspections)
    .leftJoin(profiles, eq(profiles.id, inspections.inspectorId))
    .where(where)
    .orderBy(desc(inspections.createdAt))
    .limit(args.limit + 1);
}

/** Asks for limit + 1 rows: capHit only when the extra row came back (it is then dropped) */
export async function findMatchCandidates(
  args: CandidateQueryArgs,
): Promise<{ rows: MatchCandidateRow[]; capHit: boolean }> {
  const query = candidateQuery(db, args);
  if (!query) return { rows: [], capHit: false };
  const rows: MatchCandidateRow[] = await query;
  const capHit = rows.length > args.limit;
  return { rows: capHit ? rows.slice(0, args.limit) : rows, capHit };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lib/inspection-matches/__tests__/store.test.ts`
Expected: PASS (7 tests). The offline Drizzle client never connects; only `.toSQL()` is used.

- [ ] **Step 5: Lint and type-check**

Run: `npx biome lint src/lib/inspection-matches/store.ts src/lib/inspection-matches/__tests__/store.test.ts`
Expected: clean.
Run: `npx tsc --noEmit 2>&1 | grep "src/lib/inspection-matches"`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/lib/inspection-matches/store.ts src/lib/inspection-matches/__tests__/store.test.ts
git commit -m "feat(dup-warning): bounded, parameterised candidate SELECT

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task T6: Wire types and query normalisation (`normalize.ts`)

**Files:**
- Create: `src/types/inspection-matches.ts`
- Create: `src/lib/inspection-matches/normalize.ts`
- Test: `src/lib/inspection-matches/__tests__/normalize.test.ts`

**Interfaces:**
- Consumes: `addressKey`, `AddressKey` (T1); `APN_MAX_LENGTH` (`input.ts`).
- Produces (types): `MatchReason`, `InspectionMatchRequest`, `VisibleInspectionMatch`, `InspectionMatchResult` exactly as spec §6.3.
- Produces (functions/constants): `MATCH_FIELD_BODY_MAX = 1000`, `CITY_MAX_LENGTH = 60`, `interface MatchQuery { address: AddressKey | null; zip5: string | null; city: string | null; apnKey: string | null }`, `apnMatchKey(raw: string | null | undefined): string | null`, `zip5(raw: string | null | undefined): string | null`, `cityKey(raw: string | null | undefined): string | null`, `buildMatchQuery(input: InspectionMatchRequest): MatchQuery | null`, `matchQueryKey(query: MatchQuery | null): string`.

- [ ] **Step 1: Write the failing test** — create `src/lib/inspection-matches/__tests__/normalize.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  apnMatchKey,
  buildMatchQuery,
  cityKey,
  matchQueryKey,
  zip5,
} from "@/lib/inspection-matches/normalize";

describe("apnMatchKey", () => {
  it("dashed, compact, spaced and lowercase-letter forms give the same key", () => {
    expect(apnMatchKey("123-45-678")).toBe("12345678");
    expect(apnMatchKey("12345678")).toBe("12345678");
    expect(apnMatchKey(" 123 45 678 ")).toBe("12345678");
    expect(apnMatchKey("123-45-678a")).toBe("12345678A");
    expect(apnMatchKey("123-45-678A")).toBe("12345678A");
  });

  it.each(["N/A", "TBD", "0", "00000000", "pending", "", "123456789012345678901", "123-45-678 & 123-45-679"])(
    "%j → null",
    (raw) => {
      expect(apnMatchKey(raw)).toBeNull();
    },
  );

  it("null / undefined → null", () => {
    expect(apnMatchKey(null)).toBeNull();
    expect(apnMatchKey(undefined)).toBeNull();
  });
});

describe("zip5 / cityKey", () => {
  it.each([["85331", "85331"], ["85331-1234", "85331"], ["853311234", "85331"], [" 85331 ", "85331"]])(
    "zip5(%j) → %j",
    (raw, expected) => {
      expect(zip5(raw)).toBe(expected);
    },
  );

  it.each(["8533", "ABCDE", "", "85331 AZ"])("zip5(%j) → null", (raw) => {
    expect(zip5(raw)).toBeNull();
  });

  it("cityKey collapses whitespace, lowercases, and drops empty or over-long values", () => {
    expect(cityKey("  Cave   Creek ")).toBe("cave creek");
    expect(cityKey("")).toBeNull();
    expect(cityKey("   ")).toBeNull();
    expect(cityKey("x".repeat(61))).toBeNull();
    expect(cityKey("x".repeat(60))).toBe("x".repeat(60));
  });
});

describe("buildMatchQuery", () => {
  it("null without a house-number address and without a usable APN (§5.5 #17)", () => {
    expect(buildMatchQuery({})).toBeNull();
    expect(buildMatchQuery({ facilityAddress: "Example Rd", taxParcelNumber: "" })).toBeNull();
    expect(buildMatchQuery({ facilityAddress: "", taxParcelNumber: "N/A", facilityZip: "85331" })).toBeNull();
  });

  it("APN only, address only, and both", () => {
    expect(buildMatchQuery({ taxParcelNumber: "123-45-678" })).toEqual({
      address: null,
      zip5: null,
      city: null,
      apnKey: "12345678",
    });
    expect(buildMatchQuery({ facilityAddress: "100 E Example Rd", facilityCity: "Cave Creek", facilityZip: "85331" })).toEqual({
      address: { number: "100", dir: "E", street: "EXAMPLE", suffix: "RD", unit: null },
      zip5: "85331",
      city: "cave creek",
      apnKey: null,
    });
  });

  it("an over-long APN or city is ignored for that field only", () => {
    const query = buildMatchQuery({
      facilityAddress: "100 E Example Rd",
      facilityCity: "c".repeat(61),
      taxParcelNumber: "123-45-678 see permit 9",
    });
    expect(query?.apnKey).toBeNull();
    expect(query?.city).toBeNull();
    expect(query?.address).not.toBeNull();
  });
});

describe("matchQueryKey", () => {
  it("is empty for null, equal for Rd/Road and for whitespace or case changes", () => {
    expect(matchQueryKey(null)).toBe("");
    const a = buildMatchQuery({ facilityAddress: "100 E Example Rd", facilityCity: "Cave Creek", facilityZip: "85331" });
    const b = buildMatchQuery({ facilityAddress: "100 e example road", facilityCity: " cave  creek", facilityZip: "85331-1234" });
    expect(matchQueryKey(a)).toBe(matchQueryKey(b));
  });

  it("is stable across property order and changes with any normalised part", () => {
    const base = buildMatchQuery({ facilityAddress: "100 E Example Rd", taxParcelNumber: "123-45-678" });
    if (!base) throw new Error("expected a query");
    const reordered = { apnKey: base.apnKey, city: base.city, zip5: base.zip5, address: base.address };
    expect(matchQueryKey(reordered)).toBe(matchQueryKey(base));
    expect(matchQueryKey({ ...base, apnKey: "12345679" })).not.toBe(matchQueryKey(base));
    expect(matchQueryKey(buildMatchQuery({ facilityAddress: "102 E Example Rd", taxParcelNumber: "123-45-678" }))).not.toBe(
      matchQueryKey(base),
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/inspection-matches/__tests__/normalize.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/inspection-matches/normalize"`.

- [ ] **Step 3: Implement** — create `src/types/inspection-matches.ts`:

```ts
/**
 * Wire types for the possible-duplicate check (duplicate-warning spec §6.3): the response of
 * POST /api/inspections/[id]/matches and WorkizJobRow.possibleMatches. Client- and server-safe.
 */

export type MatchReason = "apn" | "address";

export interface InspectionMatchRequest {
  facilityAddress?: string;
  facilityCity?: string;
  facilityZip?: string;
  taxParcelNumber?: string;
}

/** A match the viewer is allowed to open */
export interface VisibleInspectionMatch {
  inspectionId: string;
  /** In-app route for THIS viewer (matchHref) */
  href: string;
  status: string;
  /** "" when null */
  facilityAddress: string;
  /** "" when null */
  facilityCity: string;
  /** formData.facilityInfo.dateOfInspection when it is YYYY-MM-DD, else null */
  inspectionDate: string | null;
  /** ISO */
  createdAt: string;
  inspectorName: string | null;
  isOwn: boolean;
  /** Non-empty; order is always ["apn", "address"] ∩ actual */
  reasons: MatchReason[];
}

export interface InspectionMatchResult {
  matches: VisibleInspectionMatch[];
  /** Matches the viewer cannot open: a count only, never any detail */
  hiddenCount: number;
  truncated: boolean;
}
```

and `src/lib/inspection-matches/normalize.ts`:

```ts
import { type AddressKey, addressKey } from "@/lib/prefill/address-key";
import { APN_MAX_LENGTH } from "@/lib/prefill/input";
import type { InspectionMatchRequest } from "@/types/inspection-matches";

/**
 * Input normalisation for the possible-duplicate check (duplicate-warning spec §5.2). Pure and
 * client-safe: the wizard builds the same query to decide whether (and when) to ask the server.
 */

/** Body-size bound per field only; an over-long value is ignored per field, never rejected */
export const MATCH_FIELD_BODY_MAX = 1000;
export const CITY_MAX_LENGTH = 60;

export interface MatchQuery {
  address: AddressKey | null;
  zip5: string | null;
  city: string | null;
  apnKey: string | null;
}

/** "123-45-678" / "12345678" / "123 45 678" → "12345678"; null for N/A, TBD, 0, too long/short */
export function apnMatchKey(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length > APN_MAX_LENGTH) return null;
  const key = trimmed.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (key.length < 6 || key.length > APN_MAX_LENGTH || !/\d/.test(key) || /^0+$/.test(key)) return null;
  return key;
}

/** "85331" / "85331-1234" / "853311234" → "85331"; anything else → null */
export function zip5(raw: string | null | undefined): string | null {
  const match = /^(\d{5})(-?\d{4})?$/.exec((raw ?? "").trim());
  return match ? match[1] : null;
}

/** Whitespace-collapsed, lowercase; empty or over 60 characters → null */
export function cityKey(raw: string | null | undefined): string | null {
  const city = (raw ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  return city && city.length <= CITY_MAX_LENGTH ? city : null;
}

/** Null when there is neither a house-number address nor a usable APN (then nothing is checked) */
export function buildMatchQuery(input: InspectionMatchRequest): MatchQuery | null {
  const address = addressKey(input.facilityAddress ?? "");
  const apnKey = apnMatchKey(input.taxParcelNumber);
  if (!address && !apnKey) return null;
  return { address, zip5: zip5(input.facilityZip), city: cityKey(input.facilityCity), apnKey };
}

/** Stable string for a query ("" for null): equal keys never trigger a second request */
export function matchQueryKey(query: MatchQuery | null): string {
  if (!query) return "";
  const a = query.address;
  return JSON.stringify([
    a ? [a.number, a.dir, a.street, a.suffix, a.unit] : null,
    query.zip5,
    query.city,
    query.apnKey,
  ]);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lib/inspection-matches/__tests__/normalize.test.ts`
Expected: PASS (24 tests).

- [ ] **Step 5: Lint and type-check**

Run: `npx biome lint src/types/inspection-matches.ts src/lib/inspection-matches/normalize.ts src/lib/inspection-matches/__tests__/normalize.test.ts`
Expected: clean.
Run: `npx tsc --noEmit 2>&1 | grep -E "src/lib/inspection-matches|src/types/inspection-matches"`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/types/inspection-matches.ts src/lib/inspection-matches/normalize.ts src/lib/inspection-matches/__tests__/normalize.test.ts
git commit -m "feat(dup-warning): wire types and match-query normalisation

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task T7: Display helpers (`format.ts`)

**Files:**
- Create: `src/lib/inspection-matches/format.ts`
- Test: `src/lib/inspection-matches/__tests__/format.test.ts`

**Interfaces:**
- Consumes: `getStatusConfig` (`@/lib/constants/status`), `APP_TIME_ZONE` (`@/lib/constants/time-zone`), types from T6.
- Produces: `headerNoun(reasons: readonly MatchReason[]): string` ("address and APN" / "APN" / "address"), `reasonLabel(reasons): string`, `formatMatchWhen(match: Pick<VisibleInspectionMatch, "inspectionDate" | "createdAt">): string`, `inspectorLabel(match: Pick<VisibleInspectionMatch, "isOwn" | "inspectorName">): string`, `matchDetailLine(match: VisibleInspectionMatch): string` (parts joined with ` · `).

- [ ] **Step 1: Write the failing test** — create `src/lib/inspection-matches/__tests__/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  formatMatchWhen,
  headerNoun,
  inspectorLabel,
  matchDetailLine,
  reasonLabel,
} from "@/lib/inspection-matches/format";
import type { VisibleInspectionMatch } from "@/types/inspection-matches";

function match(over: Partial<VisibleInspectionMatch> = {}): VisibleInspectionMatch {
  return {
    inspectionId: "6f1c2a9e-0000-4000-8000-000000000001",
    href: "/review/6f1c2a9e-0000-4000-8000-000000000001",
    status: "completed",
    facilityAddress: "100 E Example Rd",
    facilityCity: "Cave Creek",
    inspectionDate: "2026-10-06",
    createdAt: "2026-10-06T19:12:00.000Z",
    inspectorName: "Sam Sample",
    isOwn: false,
    reasons: ["apn", "address"],
    ...over,
  };
}

describe("headerNoun / reasonLabel", () => {
  it("names both, APN only or address only", () => {
    expect(headerNoun(["apn", "address"])).toBe("address and APN");
    expect(headerNoun(["address", "apn", "address"])).toBe("address and APN");
    expect(headerNoun(["apn"])).toBe("APN");
    expect(headerNoun(["address"])).toBe("address");
    expect(reasonLabel(["apn", "address"])).toBe("Same APN and address");
    expect(reasonLabel(["apn"])).toBe("Same APN");
    expect(reasonLabel(["address"])).toBe("Same address");
  });
});

describe("formatMatchWhen", () => {
  it("uses the inspection date without shifting the day", () => {
    expect(formatMatchWhen(match())).toBe("Inspected Oct 6, 2026");
  });

  it("falls back to createdAt in America/Phoenix (a UTC-midnight timestamp is the previous Phoenix day)", () => {
    expect(formatMatchWhen(match({ inspectionDate: null, createdAt: "2026-10-02T00:00:00.000Z" }))).toBe(
      "Created Oct 1, 2026",
    );
  });

  it("is empty when neither date is usable", () => {
    expect(formatMatchWhen(match({ inspectionDate: null, createdAt: "not a date" }))).toBe("");
  });
});

describe("inspectorLabel / matchDetailLine", () => {
  it("you for own matches, the name otherwise, Unknown inspector without a profile", () => {
    expect(inspectorLabel(match({ isOwn: true }))).toBe("you");
    expect(inspectorLabel(match())).toBe("Sam Sample");
    expect(inspectorLabel(match({ inspectorName: null }))).toBe("Unknown inspector");
  });

  it("joins address, status label, date, inspector and reason", () => {
    expect(matchDetailLine(match())).toBe(
      "100 E Example Rd, Cave Creek · Completed · Inspected Oct 6, 2026 · Sam Sample · Same APN and address",
    );
    expect(matchDetailLine(match({ status: "submitted", reasons: ["address"], isOwn: true }))).toBe(
      "100 E Example Rd, Cave Creek · In Review · Inspected Oct 6, 2026 · you · Same address",
    );
    expect(matchDetailLine(match({ facilityAddress: "", facilityCity: "" }))).toMatch(/^No address · /);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/inspection-matches/__tests__/format.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/inspection-matches/format"`.

- [ ] **Step 3: Implement** — create `src/lib/inspection-matches/format.ts`:

```ts
import { getStatusConfig } from "@/lib/constants/status";
import { APP_TIME_ZONE } from "@/lib/constants/time-zone";
import type { MatchReason, VisibleInspectionMatch } from "@/types/inspection-matches";

/** Display helpers for the possible-duplicate notice (duplicate-warning spec §2.1). Client-safe. */

const DATE_ONLY = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  year: "numeric",
});

const PHOENIX_DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  month: "short",
  day: "numeric",
  year: "numeric",
});

/** Header noun from the union of the visible matches' reasons */
export function headerNoun(reasons: readonly MatchReason[]): string {
  const apn = reasons.includes("apn");
  const address = reasons.includes("address");
  if (apn && address) return "address and APN";
  return apn ? "APN" : "address";
}

export function reasonLabel(reasons: readonly MatchReason[]): string {
  const apn = reasons.includes("apn");
  const address = reasons.includes("address");
  if (apn && address) return "Same APN and address";
  return apn ? "Same APN" : "Same address";
}

/**
 * "Inspected Oct 6, 2026" from the YYYY-MM-DD inspection date (noon UTC formatted in UTC, so the
 * day never shifts), else "Created Oct 1, 2026" from createdAt in America/Phoenix; "" if neither.
 */
export function formatMatchWhen(match: Pick<VisibleInspectionMatch, "inspectionDate" | "createdAt">): string {
  if (match.inspectionDate) {
    const day = new Date(`${match.inspectionDate}T12:00:00Z`);
    if (!Number.isNaN(day.getTime())) return `Inspected ${DATE_ONLY.format(day)}`;
  }
  const created = new Date(match.createdAt);
  return Number.isNaN(created.getTime()) ? "" : `Created ${PHOENIX_DAY.format(created)}`;
}

export function inspectorLabel(match: Pick<VisibleInspectionMatch, "isOwn" | "inspectorName">): string {
  if (match.isOwn) return "you";
  return match.inspectorName?.trim() || "Unknown inspector";
}

/** "100 E Example Rd, Cave Creek · Completed · Inspected Oct 6, 2026 · Sam Sample · Same APN and address" */
export function matchDetailLine(match: VisibleInspectionMatch): string {
  const place = [match.facilityAddress, match.facilityCity].filter(Boolean).join(", ") || "No address";
  return [
    place,
    getStatusConfig(match.status).label,
    formatMatchWhen(match),
    inspectorLabel(match),
    reasonLabel(match.reasons),
  ]
    .filter(Boolean)
    .join(" · ");
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lib/inspection-matches/__tests__/format.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Lint**

Run: `npx biome lint src/lib/inspection-matches/format.ts src/lib/inspection-matches/__tests__/format.test.ts`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/inspection-matches/format.ts src/lib/inspection-matches/__tests__/format.test.ts
git commit -m "feat(dup-warning): notice display helpers

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task T8: Matching rules, ranking and the visible/hidden split (`match.ts`)

**Files:**
- Create: `src/lib/inspection-matches/match.ts`
- Test: `src/lib/inspection-matches/__tests__/match.test.ts`

**Interfaces:**
- Consumes: `inspectionPath` (T2); `addressKey`, `addressKeysCompatible` (T1); `apnMatchKey`, `cityKey`, `zip5`, `MatchQuery` (T6); `MatchCandidateRow` type (T5); wire types (T6).
- Produces: `WIZARD_MATCH_LIMIT = 5`, `PICKER_MATCH_LIMIT = 3`, `CANDIDATE_LIMIT = 200`, `BATCH_CANDIDATE_LIMIT = 500`, `interface MatchViewer { userId: string; privileged: boolean }`, `storedApnKey(row): string | null`, `localityCompatible(query, row): boolean`, `matchReasons(query, row): MatchReason[]`, `matchHref(row, viewer): string`, `buildMatchResult(query, rows, viewer, opts: { limit: number; candidateCapHit: boolean; excludeWorkizJobIds?: string[] }): InspectionMatchResult`.

- [ ] **Step 1: Write the failing test** — create `src/lib/inspection-matches/__tests__/match.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildMatchResult,
  localityCompatible,
  type MatchViewer,
  matchHref,
  matchReasons,
  storedApnKey,
} from "@/lib/inspection-matches/match";
import { buildMatchQuery, type MatchQuery } from "@/lib/inspection-matches/normalize";
import type { MatchCandidateRow } from "@/lib/inspection-matches/store";
import type { InspectionMatchRequest } from "@/types/inspection-matches";

// Synthetic fixtures only (spec §12)
const ADMIN: MatchViewer = { userId: "admin-1", privileged: true };
const TECH: MatchViewer = { userId: "tech-1", privileged: false };

let seq = 0;
function stored(over: Partial<MatchCandidateRow> = {}): MatchCandidateRow {
  seq += 1;
  return {
    id: `6f1c2a9e-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    inspectorId: "admin-1",
    status: "completed",
    facilityAddress: null,
    facilityCity: null,
    facilityZip: null,
    apn: null,
    taxParcelNumber: null,
    inspectionDate: null,
    createdAt: new Date("2026-10-06T19:12:00.000Z"),
    workizJobId: null,
    inspectorName: "Sam Sample",
    ...over,
  };
}

function q(input: InspectionMatchRequest): MatchQuery {
  const query = buildMatchQuery(input);
  if (!query) throw new Error("expected a query");
  return query;
}

const addr = (facilityAddress: string, facilityZip = "", facilityCity = "") => ({ facilityAddress, facilityZip, facilityCity });
const reasons = (input: InspectionMatchRequest, row: Partial<MatchCandidateRow>) => matchReasons(q(input), stored(row));

describe("matchReasons — §5.5 examples", () => {
  it.each<[string, InspectionMatchRequest, Partial<MatchCandidateRow>, string[]]>([
    ["#1 dashed vs compact APN", { taxParcelNumber: "123-45-678" }, { taxParcelNumber: "12345678" }, ["apn"]],
    ["#2 split-parcel letter differs", { taxParcelNumber: "123-45-678A" }, { taxParcelNumber: "123-45-678" }, []],
    ["#5 column fallback when the form APN is empty", { taxParcelNumber: "123-45-678" }, { apn: "123-45-678" }, ["apn"]],
    ["#5a stale column ignored when the form APN is usable", { taxParcelNumber: "123-45-678" }, { taxParcelNumber: "123-45-679", apn: "123-45-678" }, []],
    ["#6 abbreviation variants", addr("100 E Example Rd", "85331"), { facilityAddress: "100 E. Example Road", facilityZip: "85331" }, ["address"]],
    ["#7 direction differs", addr("100 E Example Rd", "85331"), { facilityAddress: "100 W Example Rd", facilityZip: "85331" }, []],
    ["#8 direction missing on one side", addr("100 Example Rd", "85331"), { facilityAddress: "100 E Example Rd", facilityZip: "85331" }, ["address"]],
    ["#9 suffix differs", addr("1234 N 7th St", "85014"), { facilityAddress: "1234 N 7th Ave", facilityZip: "85014" }, []],
    ["#10 suffix missing on one side", addr("1234 N 7th", "85014"), { facilityAddress: "1234 N 7th Ave", facilityZip: "85014" }, ["address"]],
    ["#11 unit differs", addr("100 E Example Rd #12", "85331"), { facilityAddress: "100 E Example Rd #14", facilityZip: "85331" }, []],
    ["#12 unit missing on one side", addr("100 E Example Rd Space 12", "85331"), { facilityAddress: "100 E Example Rd", facilityZip: "85331" }, ["address"]],
    ["#12a Workiz #Space 12", addr("100 E Example Rd #Space 12", "85331"), { facilityAddress: "100 E Example Rd Space 12", facilityZip: "85331" }, ["address"]],
    ["#12b #Lot 7", addr("100 E Example Rd #Lot 7", "85331"), { facilityAddress: "100 E Example Rd Lot 7", facilityZip: "85331" }, ["address"]],
    ["#12c comma cut", addr("100 E Example Rd, Cave Creek, AZ 85331"), { facilityAddress: "100 E Example Rd", facilityZip: "85331" }, ["address"]],
    ["#12d unit kept through the comma cut", addr("100 E Example Rd, #12", "85331"), { facilityAddress: "100 E Example Rd #14", facilityZip: "85331" }, []],
    ["#12e North vs South Ln", addr("100 W North Ln", "85331"), { facilityAddress: "100 W South Ln", facilityZip: "85331" }, []],
    ["#12f East vs West St", addr("100 N East St", "85014"), { facilityAddress: "100 N West St", facilityZip: "85014" }, []],
    ["#12g West Valley vs Valley", addr("100 N West Valley Rd", "85331"), { facilityAddress: "100 N Valley Rd", facilityZip: "85331" }, []],
    ["#12h direction-word streets", addr("100 North Ln", "85331"), { facilityAddress: "100 South Ln", facilityZip: "85331" }, []],
    ["#13 ZIPs differ, cities equal", addr("100 E Example Rd", "85331", "Cave Creek"), { facilityAddress: "100 E Example Rd", facilityZip: "85377", facilityCity: "Cave Creek" }, ["address"]],
    ["#13a ZIPs differ, cities differ", addr("100 E Example Rd", "85331", "Cave Creek"), { facilityAddress: "100 E Example Rd", facilityZip: "85377", facilityCity: "Carefree" }, []],
    ["#13b ZIPs differ, no input city", addr("100 E Example Rd", "85331"), { facilityAddress: "100 E Example Rd", facilityZip: "85377", facilityCity: "Cave Creek" }, []],
    ["#14 no ZIP, cities equal", addr("100 E Example Rd", "", "cave creek"), { facilityAddress: "100 E Example Rd", facilityZip: "85331", facilityCity: "Cave Creek" }, ["address"]],
    ["#15 no ZIP, cities differ", addr("100 E Example Rd", "", "Carefree"), { facilityAddress: "100 E Example Rd", facilityZip: "85331", facilityCity: "Cave Creek" }, []],
    ["#16 locality unknown", addr("100 E Example Rd"), { facilityAddress: "100 E Example Rd", facilityZip: "85331", facilityCity: "Cave Creek" }, ["address"]],
    ["#18 different APN, same address", { ...addr("100 E Example Rd", "85331"), taxParcelNumber: "123-45-678" }, { facilityAddress: "100 E Example Rd", facilityZip: "85331", taxParcelNumber: "123-45-679" }, ["address"]],
    ["#19 same APN and address", { ...addr("100 E Example Rd", "85331"), taxParcelNumber: "123-45-678" }, { facilityAddress: "100 E Example Rd", facilityZip: "85331", taxParcelNumber: "123-45-678" }, ["apn", "address"]],
  ])("%s", (_label, input, row, expected) => {
    expect(reasons(input, row)).toEqual(expected);
  });

  it("#3 N/A never matches; #4 an input without an APN key never checks APNs", () => {
    expect(buildMatchQuery({ taxParcelNumber: "N/A" })).toBeNull();
    expect(reasons(addr("100 E Example Rd", "85331"), { apn: "123-45-678", facilityAddress: "200 E Example Rd" })).toEqual([]);
  });

  it("#5b an over-long input APN still lets the address match", () => {
    expect(
      reasons(
        { ...addr("100 E Example Rd", "85331"), taxParcelNumber: "123-45-678 & 123-45-679" },
        { facilityAddress: "100 E Example Rd", facilityZip: "85331", taxParcelNumber: "123-45-678" },
      ),
    ).toEqual(["address"]);
  });
});

describe("storedApnKey", () => {
  it("form key first; the column only when the form key is null", () => {
    expect(storedApnKey(stored({ taxParcelNumber: "123-45-679", apn: "123-45-678" }))).toBe("12345679");
    expect(storedApnKey(stored({ taxParcelNumber: "", apn: "123-45-678" }))).toBe("12345678");
    expect(storedApnKey(stored({ taxParcelNumber: "N/A", apn: "123-45-678" }))).toBe("12345678");
    expect(storedApnKey(stored({}))).toBeNull();
  });
});

describe("localityCompatible truth table", () => {
  const base = { facilityAddress: "100 E Example Rd" };
  it.each<[string, string, string, string, boolean]>([
    ["85331", "Cave Creek", "85331", "Carefree", true],
    ["85331", "Cave Creek", "85377", "Cave Creek", true],
    ["85331", "Cave Creek", "85377", "Carefree", false],
    ["85331", "", "85377", "Cave Creek", false],
    ["85331", "Cave Creek", "85377", "", false],
    ["", "Cave Creek", "85331", "Cave Creek", true],
    ["", "Carefree", "85331", "Cave Creek", false],
    ["", "", "85331", "Cave Creek", true],
    ["85331", "Cave Creek", "", "Carefree", false],
    ["85331", "Cave Creek", "", "", true],
  ])("input %s/%s vs stored %s/%s → %s", (zip, city, rowZip, rowCity, expected) => {
    const query = q({ ...base, facilityZip: zip, facilityCity: city });
    expect(localityCompatible(query, stored({ ...base, facilityZip: rowZip, facilityCity: rowCity }))).toBe(expected);
  });
});

describe("matchHref", () => {
  it("own draft → edit; another's draft → review; non-draft → inspectionPath", () => {
    expect(matchHref(stored({ id: "d1", status: "draft", inspectorId: "tech-1" }), TECH)).toBe("/inspections/d1/edit");
    expect(matchHref(stored({ id: "d2", status: "draft", inspectorId: "tech-9" }), ADMIN)).toBe("/review/d2");
    expect(matchHref(stored({ id: "s1", status: "submitted", inspectorId: "tech-9" }), ADMIN)).toBe("/review/s1");
    expect(matchHref(stored({ id: "s2", status: "submitted", inspectorId: "tech-1" }), TECH)).toBe("/inspections/s2");
    expect(matchHref(stored({ id: "d3", status: "draft", inspectorId: "admin-1" }), ADMIN)).toBe("/inspections/d3/edit");
  });
});

describe("buildMatchResult", () => {
  const input = q({ ...addr("100 E Example Rd", "85331"), taxParcelNumber: "123-45-678" });
  const at = (iso: string) => new Date(iso);
  const both = (over: Partial<MatchCandidateRow> = {}) =>
    stored({ facilityAddress: "100 E Example Rd", facilityZip: "85331", taxParcelNumber: "123-45-678", ...over });
  const apnOnly = (over: Partial<MatchCandidateRow> = {}) => stored({ facilityAddress: "9 W Other St", taxParcelNumber: "123-45-678", ...over });
  const addressOnly = (over: Partial<MatchCandidateRow> = {}) => stored({ facilityAddress: "100 E Example Rd", facilityZip: "85331", ...over });
  const opts = { limit: 5, candidateCapHit: false };

  it("ranks both → apn → address, then newest first, and drops non-matches", () => {
    const rows = [
      addressOnly({ id: "addr-new", createdAt: at("2026-10-10T00:00:00Z") }),
      apnOnly({ id: "apn", createdAt: at("2026-10-01T00:00:00Z") }),
      both({ id: "both-old", createdAt: at("2026-09-01T00:00:00Z") }),
      both({ id: "both-new", createdAt: at("2026-10-01T00:00:00Z") }),
      stored({ id: "none", facilityAddress: "5 S Elsewhere Ave" }),
    ];
    const result = buildMatchResult(input, rows, ADMIN, opts);
    expect(result.matches.map((m) => m.inspectionId)).toEqual(["both-new", "both-old", "apn", "addr-new"]);
    expect(result.matches[0].reasons).toEqual(["apn", "address"]);
    expect(result).toMatchObject({ hiddenCount: 0, truncated: false });
  });

  it("limits visible matches and marks truncated when more exist or the candidate cap was hit", () => {
    const rows = [both(), both(), both(), both()];
    expect(buildMatchResult(input, rows, ADMIN, { limit: 3, candidateCapHit: false })).toMatchObject({ truncated: true });
    expect(buildMatchResult(input, rows, ADMIN, { limit: 3, candidateCapHit: false }).matches).toHaveLength(3);
    expect(buildMatchResult(input, rows, ADMIN, { limit: 4, candidateCapHit: false }).truncated).toBe(false);
    expect(buildMatchResult(input, rows, ADMIN, { limit: 4, candidateCapHit: true }).truncated).toBe(true);
  });

  it("no-leak: a field tech gets only a count for other inspectors' matches", () => {
    const hidden = both({
      id: "6f1c2a9e-0000-4000-8000-00000000beef",
      inspectorId: "tech-9",
      facilityAddress: "100 E Example Rd",
      facilityCity: "Hiddenville",
      inspectionDate: "2026-09-30",
      inspectorName: "Pat Private",
    });
    const own = both({ inspectorId: "tech-1", facilityCity: "Cave Creek" });
    const result = buildMatchResult(input, [hidden, own, both({ inspectorId: "tech-8" })], TECH, opts);
    expect(result.hiddenCount).toBe(2);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({ isOwn: true, inspectorName: "Sam Sample" });
    const json = JSON.stringify(result);
    for (const leak of ["00000000beef", "Hiddenville", "Pat Private", "2026-09-30"]) expect(json).not.toContain(leak);
  });

  it("privileged viewers see every match with its href", () => {
    const result = buildMatchResult(input, [both({ id: "x1", inspectorId: "tech-9", status: "draft" })], ADMIN, opts);
    expect(result.hiddenCount).toBe(0);
    expect(result.matches[0]).toMatchObject({ inspectionId: "x1", href: "/review/x1", isOwn: false });
  });

  it("excludeWorkizJobIds skips only that job's own import", () => {
    const rows = [both({ id: "own-import", workizJobId: "AB12CD" }), both({ id: "other", workizJobId: "ZZ99ZZ" })];
    const result = buildMatchResult(input, rows, ADMIN, { ...opts, excludeWorkizJobIds: ["AB12CD", "JOB-AbCdEfGhIjKlMnOp"] });
    expect(result.matches.map((m) => m.inspectionId)).toEqual(["other"]);
  });

  it("maps the wire fields: empty strings for null text, ISO createdAt, invalid inspection date → null", () => {
    const [m] = buildMatchResult(input, [both({ facilityCity: null, inspectionDate: "10/06/2026" })], ADMIN, opts).matches;
    expect(m.facilityCity).toBe("");
    expect(m.inspectionDate).toBeNull();
    expect(m.createdAt).toBe("2026-10-06T19:12:00.000Z");
    const [dated] = buildMatchResult(input, [both({ inspectionDate: "2026-10-06" })], ADMIN, opts).matches;
    expect(dated.inspectionDate).toBe("2026-10-06");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/inspection-matches/__tests__/match.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/inspection-matches/match"`.

- [ ] **Step 3: Implement** — create `src/lib/inspection-matches/match.ts`:

```ts
import { inspectionPath } from "@/lib/inspection-path";
import { addressKey, addressKeysCompatible } from "@/lib/prefill/address-key";
import type {
  InspectionMatchResult,
  MatchReason,
  VisibleInspectionMatch,
} from "@/types/inspection-matches";
import { apnMatchKey, cityKey, type MatchQuery, zip5 } from "./normalize";
import type { MatchCandidateRow } from "./store";

/**
 * The possible-duplicate decision (duplicate-warning spec §5.3–§5.4, §8). Pure. buildMatchResult
 * is the ONLY place that splits visible from hidden matches: a hidden match contributes a count
 * and nothing else.
 */

export const WIZARD_MATCH_LIMIT = 5;
export const PICKER_MATCH_LIMIT = 3;
export const CANDIDATE_LIMIT = 200;
export const BATCH_CANDIDATE_LIMIT = 500;

export interface MatchViewer {
  userId: string;
  /** admin/office staff (wizard route) or admin (picker route) */
  privileged: boolean;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** The form APN is authoritative; the write-once column only counts when the form key is null */
export function storedApnKey(row: MatchCandidateRow): string | null {
  return apnMatchKey(row.taxParcelNumber) ?? apnMatchKey(row.apn);
}

/** Equal ZIPs; different ZIPs only with equal cities; a missing ZIP → cities decide when both exist */
export function localityCompatible(query: MatchQuery, row: MatchCandidateRow): boolean {
  const rowZip = zip5(row.facilityZip);
  const rowCity = cityKey(row.facilityCity);
  const bothCities = query.city !== null && rowCity !== null;
  const citiesEqual = bothCities && query.city === rowCity;
  if (query.zip5 !== null && rowZip !== null) return query.zip5 === rowZip || citiesEqual;
  return bothCities ? citiesEqual : true;
}

/** Order is always ["apn", "address"] ∩ actual */
export function matchReasons(query: MatchQuery, row: MatchCandidateRow): MatchReason[] {
  const reasons: MatchReason[] = [];
  if (query.apnKey !== null && query.apnKey === storedApnKey(row)) reasons.push("apn");
  if (query.address) {
    const stored = addressKey(row.facilityAddress ?? "");
    if (stored && addressKeysCompatible(query.address, stored) && localityCompatible(query, row)) {
      reasons.push("address");
    }
  }
  return reasons;
}

/**
 * inspectionPath, except another inspector's draft opens /review/{id}: the edit page's first
 * autosave tick would re-save its stale snapshot over the owner's edits (spec §2.1).
 */
export function matchHref(row: MatchCandidateRow, viewer: MatchViewer): string {
  if (row.status === "draft" && row.inspectorId !== viewer.userId) return `/review/${row.id}`;
  return inspectionPath(row.id, row.status, viewer.privileged);
}

const rank = (reasons: MatchReason[]): number => (reasons.length === 2 ? 0 : reasons[0] === "apn" ? 1 : 2);

function toVisible(row: MatchCandidateRow, reasons: MatchReason[], viewer: MatchViewer): VisibleInspectionMatch {
  return {
    inspectionId: row.id,
    href: matchHref(row, viewer),
    status: row.status,
    facilityAddress: row.facilityAddress ?? "",
    facilityCity: row.facilityCity ?? "",
    inspectionDate: row.inspectionDate && DATE_ONLY.test(row.inspectionDate) ? row.inspectionDate : null,
    createdAt: row.createdAt.toISOString(),
    inspectorName: row.inspectorName,
    isOwn: row.inspectorId === viewer.userId,
    reasons,
  };
}

export function buildMatchResult(
  query: MatchQuery,
  rows: MatchCandidateRow[],
  viewer: MatchViewer,
  opts: { limit: number; candidateCapHit: boolean; excludeWorkizJobIds?: string[] },
): InspectionMatchResult {
  // A picker row's own import is skipped: its Open existing button already covers it
  const ownImport = new Set((opts.excludeWorkizJobIds ?? []).filter(Boolean));
  const matched = rows
    .filter((row) => !(row.workizJobId && ownImport.has(row.workizJobId)))
    .map((row) => ({ row, reasons: matchReasons(query, row) }))
    .filter((m) => m.reasons.length > 0)
    .sort((a, b) => rank(a.reasons) - rank(b.reasons) || b.row.createdAt.getTime() - a.row.createdAt.getTime());

  // canOpen = checkInspectionAccess: owner, or privileged
  const visible = matched.filter((m) => m.row.inspectorId === viewer.userId || viewer.privileged);
  return {
    matches: visible.slice(0, opts.limit).map((m) => toVisible(m.row, m.reasons, viewer)),
    hiddenCount: matched.length - visible.length,
    truncated: visible.length > opts.limit || opts.candidateCapHit,
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lib/inspection-matches/__tests__/match.test.ts`
Expected: PASS (47 tests).

- [ ] **Step 5: Lint and type-check**

Run: `npx biome lint src/lib/inspection-matches/match.ts src/lib/inspection-matches/__tests__/match.test.ts`
Expected: clean.
Run: `npx tsc --noEmit 2>&1 | grep "src/lib/inspection-matches"`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/lib/inspection-matches/match.ts src/lib/inspection-matches/__tests__/match.test.ts
git commit -m "feat(dup-warning): matching rules, ranking and no-leak visible/hidden split

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task T9: Wizard and batch entry points (`find.ts`)

**Files:**
- Create: `src/lib/inspection-matches/find.ts`
- Test: `src/lib/inspection-matches/__tests__/find.test.ts`

**Interfaces:**
- Consumes: `findMatchCandidates` (T5); `buildMatchResult`, limits, `MatchViewer` (T8); `MatchQuery` (T6).
- Produces:
  - `interface MatchBatchItem { key: string; query: MatchQuery | null; excludeWorkizJobIds: string[] }`
  - `findPossibleDuplicates(query: MatchQuery, viewer: MatchViewer, opts: { excludeInspectionId: string; limit?: number }): Promise<InspectionMatchResult>` (limit default 5; candidate cap 200)
  - `findPossibleDuplicatesBatch(items: MatchBatchItem[], viewer: MatchViewer, opts?: { limit?: number }): Promise<Map<string, InspectionMatchResult>>` (limit default 3; ONE store call at cap 500; on overflow, one sequential call per item with a query at cap 200)
  - Both throw on DB errors (callers log via `logDbError`).

- [ ] **Step 1: Write the failing test** — create `src/lib/inspection-matches/__tests__/find.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindCandidates } = vi.hoisted(() => ({ mockFindCandidates: vi.fn() }));

vi.mock("@/lib/inspection-matches/store", () => ({ findMatchCandidates: mockFindCandidates }));

import { findPossibleDuplicates, findPossibleDuplicatesBatch } from "@/lib/inspection-matches/find";
import type { MatchViewer } from "@/lib/inspection-matches/match";
import { buildMatchQuery, type MatchQuery } from "@/lib/inspection-matches/normalize";
import type { MatchCandidateRow } from "@/lib/inspection-matches/store";
import type { InspectionMatchRequest } from "@/types/inspection-matches";

const ADMIN: MatchViewer = { userId: "admin-1", privileged: true };
const SELF = "6f1c2a9e-0000-4000-8000-000000000000";

function q(input: InspectionMatchRequest): MatchQuery {
  const query = buildMatchQuery(input);
  if (!query) throw new Error("expected a query");
  return query;
}

function stored(id: string, over: Partial<MatchCandidateRow> = {}): MatchCandidateRow {
  return {
    id,
    inspectorId: "admin-1",
    status: "completed",
    facilityAddress: "100 E Example Rd",
    facilityCity: "Cave Creek",
    facilityZip: "85331",
    apn: null,
    taxParcelNumber: "123-45-678",
    inspectionDate: "2026-10-06",
    createdAt: new Date("2026-10-06T19:12:00.000Z"),
    workizJobId: null,
    inspectorName: "Sam Sample",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFindCandidates.mockResolvedValue({ rows: [], capHit: false });
});

describe("findPossibleDuplicates", () => {
  it("passes the house number, APN key, excluded id and the 200-row cap", async () => {
    mockFindCandidates.mockResolvedValue({ rows: [stored("m1")], capHit: false });
    const result = await findPossibleDuplicates(
      q({ facilityAddress: "100 E Example Rd", facilityZip: "85331", taxParcelNumber: "123-45-678" }),
      ADMIN,
      { excludeInspectionId: SELF },
    );
    expect(mockFindCandidates).toHaveBeenCalledWith({
      houseNumbers: ["100"],
      apnKeys: ["12345678"],
      excludeInspectionId: SELF,
      limit: 200,
    });
    expect(result.matches.map((m) => m.inspectionId)).toEqual(["m1"]);
  });

  it("caps visible matches at 5 by default and reports the candidate cap", async () => {
    const rows = Array.from({ length: 7 }, (_, i) => stored(`m${i}`));
    mockFindCandidates.mockResolvedValue({ rows, capHit: false });
    const result = await findPossibleDuplicates(q({ taxParcelNumber: "123-45-678" }), ADMIN, { excludeInspectionId: SELF });
    expect(result.matches).toHaveLength(5);
    expect(result.truncated).toBe(true);
    mockFindCandidates.mockResolvedValue({ rows: [stored("m1")], capHit: true });
    expect((await findPossibleDuplicates(q({ taxParcelNumber: "123-45-678" }), ADMIN, { excludeInspectionId: SELF })).truncated).toBe(true);
  });
});

describe("findPossibleDuplicatesBatch", () => {
  const items = [
    { key: "JOB-A", query: q({ facilityAddress: "100 E Example Rd", facilityZip: "85331" }), excludeWorkizJobIds: ["AA11", "JOB-A"] },
    { key: "JOB-B", query: q({ facilityAddress: "200 W Sample St", taxParcelNumber: "123-45-679" }), excludeWorkizJobIds: ["BB22", "JOB-B"] },
    { key: "JOB-C", query: null, excludeWorkizJobIds: ["JOB-C"] },
  ];

  it("makes ONE store call with the union of house numbers and APN keys, then splits rows per item", async () => {
    mockFindCandidates.mockResolvedValue({
      rows: [
        stored("a-match"),
        stored("a-own-import", { workizJobId: "AA11" }),
        stored("b-match", { facilityAddress: "9 N Other Ave", taxParcelNumber: "123-45-679" }),
      ],
      capHit: false,
    });
    const results = await findPossibleDuplicatesBatch(items, ADMIN, { limit: 3 });
    expect(mockFindCandidates).toHaveBeenCalledTimes(1);
    expect(mockFindCandidates).toHaveBeenCalledWith({ houseNumbers: ["100", "200"], apnKeys: ["12345679"], limit: 500 });
    expect(results.get("JOB-A")?.matches.map((m) => m.inspectionId)).toEqual(["a-match"]);
    expect(results.get("JOB-B")?.matches.map((m) => m.inspectionId)).toEqual(["b-match"]);
    expect(results.get("JOB-C")).toEqual({ matches: [], hiddenCount: 0, truncated: false });
  });

  it("no store call when no item has a query", async () => {
    const results = await findPossibleDuplicatesBatch([items[2]], ADMIN);
    expect(mockFindCandidates).not.toHaveBeenCalled();
    expect(results.get("JOB-C")?.matches).toEqual([]);
  });

  it("batch overflow: one store call per item with a query; truncated comes from each item's own call", async () => {
    mockFindCandidates
      .mockResolvedValueOnce({ rows: [], capHit: true })
      .mockResolvedValueOnce({ rows: [stored("a-match")], capHit: false })
      .mockResolvedValueOnce({ rows: [stored("b-match", { taxParcelNumber: "123-45-679" })], capHit: true });
    const results = await findPossibleDuplicatesBatch(items, ADMIN, { limit: 3 });
    expect(mockFindCandidates).toHaveBeenCalledTimes(3);
    expect(mockFindCandidates).toHaveBeenNthCalledWith(2, { houseNumbers: ["100"], apnKeys: [], limit: 200 });
    expect(mockFindCandidates).toHaveBeenNthCalledWith(3, { houseNumbers: ["200"], apnKeys: ["12345679"], limit: 200 });
    expect(results.get("JOB-A")).toMatchObject({ truncated: false });
    expect(results.get("JOB-A")?.matches.map((m) => m.inspectionId)).toEqual(["a-match"]);
    expect(results.get("JOB-B")).toMatchObject({ truncated: true });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/inspection-matches/__tests__/find.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/inspection-matches/find"`.

- [ ] **Step 3: Implement** — create `src/lib/inspection-matches/find.ts`:

```ts
import type { InspectionMatchResult } from "@/types/inspection-matches";
import {
  BATCH_CANDIDATE_LIMIT,
  buildMatchResult,
  CANDIDATE_LIMIT,
  type MatchViewer,
  PICKER_MATCH_LIMIT,
  WIZARD_MATCH_LIMIT,
} from "./match";
import type { MatchQuery } from "./normalize";
import { findMatchCandidates } from "./store";

/**
 * Server entry points of the possible-duplicate check (duplicate-warning spec §6.4). Both throw on
 * a DB error; callers log with logDbError only.
 */

export interface MatchBatchItem {
  key: string;
  query: MatchQuery | null;
  excludeWorkizJobIds: string[];
}

const EMPTY: InspectionMatchResult = { matches: [], hiddenCount: 0, truncated: false };

const prefilter = (queries: MatchQuery[]) => ({
  houseNumbers: [...new Set(queries.flatMap((query) => (query.address ? [query.address.number] : [])))],
  apnKeys: [...new Set(queries.flatMap((query) => (query.apnKey ? [query.apnKey] : [])))],
});

/** Wizard: one SELECT, the current inspection excluded */
export async function findPossibleDuplicates(
  query: MatchQuery,
  viewer: MatchViewer,
  opts: { excludeInspectionId: string; limit?: number },
): Promise<InspectionMatchResult> {
  const { rows, capHit } = await findMatchCandidates({
    ...prefilter([query]),
    excludeInspectionId: opts.excludeInspectionId,
    limit: CANDIDATE_LIMIT,
  });
  return buildMatchResult(query, rows, viewer, { limit: opts.limit ?? WIZARD_MATCH_LIMIT, candidateCapHit: capHit });
}

/**
 * Picker: ONE SELECT for every row. If that shared pool overflows, a row's older matches may have
 * been pushed out by other rows' candidates, so each row with a query is then re-checked on its
 * own (sequentially) and its `truncated` reflects its own cap (spec §5.4).
 */
export async function findPossibleDuplicatesBatch(
  items: MatchBatchItem[],
  viewer: MatchViewer,
  opts: { limit?: number } = {},
): Promise<Map<string, InspectionMatchResult>> {
  const limit = opts.limit ?? PICKER_MATCH_LIMIT;
  const results = new Map<string, InspectionMatchResult>();
  const active: Array<MatchBatchItem & { query: MatchQuery }> = [];
  for (const item of items) {
    if (item.query) active.push({ ...item, query: item.query });
    else results.set(item.key, EMPTY);
  }
  if (active.length === 0) return results;

  const pool = await findMatchCandidates({
    ...prefilter(active.map((item) => item.query)),
    limit: BATCH_CANDIDATE_LIMIT,
  });
  for (const item of active) {
    let rows = pool.rows;
    let capHit = false;
    if (pool.capHit) {
      ({ rows, capHit } = await findMatchCandidates({ ...prefilter([item.query]), limit: CANDIDATE_LIMIT }));
    }
    results.set(
      item.key,
      buildMatchResult(item.query, rows, viewer, {
        limit,
        candidateCapHit: capHit,
        excludeWorkizJobIds: item.excludeWorkizJobIds,
      }),
    );
  }
  return results;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lib/inspection-matches`
Expected: PASS (5 files: store, normalize, format, match, find).

- [ ] **Step 5: Lint**

Run: `npx biome lint src/lib/inspection-matches/find.ts src/lib/inspection-matches/__tests__/find.test.ts`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/inspection-matches/find.ts src/lib/inspection-matches/__tests__/find.test.ts
git commit -m "feat(dup-warning): wizard lookup and one-query picker batch

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task T10: `<PossibleDuplicateNotice>` and `<PossibleDuplicateWarning>`

**Files:**
- Create: `src/components/inspection/possible-duplicate-warning.tsx`
- Test: `src/components/inspection/__tests__/possible-duplicate-warning.test.tsx`

**Interfaces:**
- Consumes: `headerNoun`, `matchDetailLine` (T7); `buildMatchQuery`, `matchQueryKey`, `MATCH_FIELD_BODY_MAX` (T6); wire types (T6); `cn` (`@/lib/utils`); `InspectionFormData` (`@/types/inspection`).
- Produces (exports used by T13/T14 and tests): `headerSingle(noun)`, `headerMultiple(noun)`, `PICKER_HEADER_SINGLE`, `PICKER_HEADER_MULTIPLE`, `hiddenOnly(n)`, `hiddenTail(n)`, `MORE_MATCHES`, `MATCH_CHECK_FAILED`, `MATCH_ANNOUNCEMENT`, `NEW_TAB_SUFFIX`, `MATCH_DEBOUNCE_MS = 700`, `PossibleDuplicateNotice({ result: InspectionMatchResult; variant?: "default" | "compact" })`, `PossibleDuplicateWarning({ inspectionId: string })` (must render inside a react-hook-form `FormProvider`).
- Behaviour notes: the single-anchor layout is used when there is exactly one visible match, `hiddenCount === 0` and not `truncated` (a truncated single result uses the list layout so the "more" line is not inside the link). The container's result is tagged with the key it answers and also cleared on every key change, so an old notice never shows for new values (spec §2.1). The first effect run (mount) fetches immediately; later key changes wait `MATCH_DEBOUNCE_MS`.

- [ ] **Step 1: Write the failing test** — create `src/components/inspection/__tests__/possible-duplicate-warning.test.tsx`:

```tsx
import { act, render, screen } from "@testing-library/react";
import { FormProvider, type UseFormReturn, useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  hiddenOnly,
  hiddenTail,
  MATCH_ANNOUNCEMENT,
  MATCH_DEBOUNCE_MS,
  MORE_MATCHES,
  PICKER_HEADER_MULTIPLE,
  PICKER_HEADER_SINGLE,
  PossibleDuplicateNotice,
  PossibleDuplicateWarning,
} from "@/components/inspection/possible-duplicate-warning";
import { getDefaultFormValues } from "@/lib/validators/inspection";
import type { InspectionFormData } from "@/types/inspection";
import type { InspectionMatchResult, VisibleInspectionMatch } from "@/types/inspection-matches";

// Synthetic fixtures only (spec §12)
const INSPECTION_ID = "6f1c2a9e-0000-4000-8000-0000000000aa";

function match(over: Partial<VisibleInspectionMatch> = {}): VisibleInspectionMatch {
  return {
    inspectionId: "6f1c2a9e-0000-4000-8000-000000000001",
    href: "/review/6f1c2a9e-0000-4000-8000-000000000001",
    status: "completed",
    facilityAddress: "100 E Example Rd",
    facilityCity: "Cave Creek",
    inspectionDate: "2026-10-06",
    createdAt: "2026-10-06T19:12:00.000Z",
    inspectorName: "Sam Sample",
    isOwn: false,
    reasons: ["apn", "address"],
    ...over,
  };
}

const result = (over: Partial<InspectionMatchResult> = {}): InspectionMatchResult => ({
  matches: [match()],
  hiddenCount: 0,
  truncated: false,
  ...over,
});

describe("PossibleDuplicateNotice", () => {
  it("one visible match: the whole box is ONE new-tab link with the header and detail line", () => {
    render(<PossibleDuplicateNotice result={result()} />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    const link = links[0];
    expect(link).toHaveAttribute("href", "/review/6f1c2a9e-0000-4000-8000-000000000001");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAccessibleName(/This address and APN may match another report/);
    expect(link).toHaveAccessibleName(/\(opens in a new tab\)/);
    expect(link).toHaveTextContent(
      "100 E Example Rd, Cave Creek · Completed · Inspected Oct 6, 2026 · Sam Sample · Same APN and address",
    );
  });

  it("names only the APN or only the address when that is all that matched", () => {
    const { rerender } = render(<PossibleDuplicateNotice result={result({ matches: [match({ reasons: ["apn"] })] })} />);
    expect(screen.getByRole("link")).toHaveAccessibleName(/^This APN may match another report/);
    rerender(<PossibleDuplicateNotice result={result({ matches: [match({ reasons: ["address"] })] })} />);
    expect(screen.getByRole("link")).toHaveAccessibleName(/^This address may match another report/);
  });

  it("falls back to Created … in America/Phoenix without an inspection date", () => {
    render(
      <PossibleDuplicateNotice result={result({ matches: [match({ inspectionDate: null, createdAt: "2026-10-02T00:00:00.000Z" })] })} />,
    );
    expect(screen.getByRole("link")).toHaveTextContent("Created Oct 1, 2026");
  });

  it("several matches: plain-text header and one link per item", () => {
    render(
      <PossibleDuplicateNotice
        result={result({ matches: [match(), match({ inspectionId: "m2", href: "/review/m2", reasons: ["address"] })] })}
      />,
    );
    const header = screen.getByText("This address and APN may match other reports:");
    expect(header.closest("a")).toBeNull();
    const links = screen.getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/review/6f1c2a9e-0000-4000-8000-000000000001", "/review/m2"]);
    for (const link of links) expect(link).toHaveAttribute("target", "_blank");
  });

  it("hidden only: no link, the exact count copy, and no detail at all", () => {
    const { container } = render(<PossibleDuplicateNotice result={result({ matches: [], hiddenCount: 1 })} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(hiddenOnly(1))).toBeInTheDocument();
    expect(container).not.toHaveTextContent("Example");
    expect(hiddenOnly(3)).toBe("May match 3 reports by other inspectors");
  });

  it("mixed: links, then the hidden tail; truncated adds the more line", () => {
    render(<PossibleDuplicateNotice result={result({ hiddenCount: 2, truncated: true })} />);
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByText(hiddenTail(2))).toBeInTheDocument();
    expect(screen.getByText(MORE_MATCHES)).toBeInTheDocument();
    expect(hiddenTail(1)).toBe("+ 1 more by another inspector");
  });

  it("renders nothing for an empty result", () => {
    const { container } = render(<PossibleDuplicateNotice result={result({ matches: [] })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("compact variant uses the picker copy", () => {
    const { rerender } = render(<PossibleDuplicateNotice result={result()} variant="compact" />);
    expect(screen.getByRole("link")).toHaveAccessibleName(new RegExp(`^${PICKER_HEADER_SINGLE}`));
    rerender(<PossibleDuplicateNotice result={result({ matches: [match(), match({ inspectionId: "m2" })] })} variant="compact" />);
    expect(screen.getByText(PICKER_HEADER_MULTIPLE)).toBeInTheDocument();
  });
});

describe("PossibleDuplicateWarning (container)", () => {
  const fetchMock = vi.fn();
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
  let form: UseFormReturn<InspectionFormData> | undefined;

  function Harness({ facility = {}, disabled = false }: { facility?: Record<string, string>; disabled?: boolean }) {
    const defaults = getDefaultFormValues("Tech") as unknown as InspectionFormData;
    const methods = useForm<InspectionFormData>({
      defaultValues: { ...defaults, facilityInfo: { ...defaults.facilityInfo, ...facility } },
    });
    form = methods;
    return (
      <FormProvider {...methods}>
        <fieldset disabled={disabled}>
          <PossibleDuplicateWarning inspectionId={INSPECTION_ID} />
        </fieldset>
      </FormProvider>
    );
  }

  const ADDRESS = { facilityAddress: "100 E Example Rd", facilityCity: "Cave Creek", facilityZip: "85331" };
  const flush = () => act(async () => {});
  const advance = (ms: number) => act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  const setField = (name: "facilityAddress" | "taxParcelNumber" | "facilityCity", value: string) =>
    act(() => {
      form?.setValue(`facilityInfo.${name}`, value);
    });
  const sentBody = (call: number) => JSON.parse(fetchMock.mock.calls[call][1].body as string);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(ok(result()));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    form = undefined;
  });

  it("no request for a blank draft", async () => {
    render(<Harness />);
    await advance(MATCH_DEBOUNCE_MS * 2);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("checks at once on mount with the trimmed values and shows the notice", async () => {
    render(<Harness facility={{ ...ADDRESS, facilityAddress: "  100 E Example Rd ", taxParcelNumber: "123-45-678" }} />);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/inspections/${INSPECTION_ID}/matches`);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST" });
    expect(sentBody(0)).toEqual({ ...ADDRESS, taxParcelNumber: "123-45-678" });
    expect(screen.getByRole("link")).toHaveAttribute("target", "_blank");
  });

  it("debounces a changed address, and a suffix-only edit (Rd → Road) sends nothing", async () => {
    render(<Harness facility={ADDRESS} />);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await setField("facilityAddress", "100 E Example Road");
    await advance(MATCH_DEBOUNCE_MS * 2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link")).toBeInTheDocument();

    await setField("facilityAddress", "102 E Example Rd");
    await advance(MATCH_DEBOUNCE_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentBody(1).facilityAddress).toBe("102 E Example Rd");
  });

  it("an APN set through form.setValue (as APN Lookup does) triggers a check", async () => {
    render(<Harness />);
    await flush();
    await setField("taxParcelNumber", "123-45-678");
    await advance(MATCH_DEBOUNCE_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentBody(0).taxParcelNumber).toBe("123-45-678");
  });

  it("removes the old notice at once when the key changes, before the new check answers", async () => {
    render(<Harness facility={ADDRESS} />);
    await flush();
    expect(screen.getByRole("link")).toBeInTheDocument();
    await setField("facilityAddress", "104 E Example Rd");
    expect(screen.queryByRole("link")).toBeNull();
    fetchMock.mockResolvedValueOnce(ok(result({ matches: [] })));
    await advance(MATCH_DEBOUNCE_MS);
    expect(screen.queryByRole("link")).toBeNull();
    // Restoring the old values does not bring the old notice back before the new check answers
    await setField("facilityAddress", "100 E Example Rd");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("ignores a stale response that arrives after a newer key", async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => {
      resolveFirst = resolve;
    }));
    render(<Harness facility={ADDRESS} />);
    await flush();
    await setField("facilityAddress", "106 E Example Rd");
    fetchMock.mockResolvedValueOnce(ok(result({ matches: [] })));
    await advance(MATCH_DEBOUNCE_MS);
    await act(async () => {
      resolveFirst(ok(result()));
    });
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("aborts the request on unmount", async () => {
    fetchMock.mockImplementationOnce(() => new Promise(() => {}));
    const { unmount } = render(<Harness facility={ADDRESS} />);
    await flush();
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);
  });

  it.each([
    ["a 500", () => Promise.resolve({ ok: false, status: 500, json: async () => ({ error: "x" }) })],
    ["a network error", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["a 200 with {}", () => Promise.resolve(ok({}))],
    ["a 200 with []", () => Promise.resolve(ok([]))],
    ["a reply without json()", () => Promise.resolve({ ok: true, status: 200, text: async () => "" })],
  ])("%s renders nothing and does not throw", async (_label, reply) => {
    fetchMock.mockImplementationOnce(reply);
    const { container } = render(<Harness facility={ADDRESS} />);
    await flush();
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.querySelector('[data-slot="possible-duplicate-warning"]')).toBeNull();
  });

  it("slices each value to 1,000 characters before sending", async () => {
    render(<Harness facility={{ ...ADDRESS, facilityCity: "c".repeat(1500) }} />);
    await flush();
    expect(sentBody(0).facilityCity).toHaveLength(1000);
  });

  it("keeps a polite live region in the tree before any result, then announces a match", async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => {
      resolveFirst = resolve;
    }));
    const { container } = render(<Harness facility={ADDRESS} />);
    const region = container.querySelector('[data-slot="possible-duplicate-announcement"]');
    expect(region).not.toBeNull();
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toBeVisible();
    expect(region).toHaveTextContent("");
    await act(async () => {
      resolveFirst(ok(result({ matches: [], hiddenCount: 1 })));
    });
    expect(region).toHaveTextContent(MATCH_ANNOUNCEMENT);
  });

  it("still links from inside a disabled fieldset (read-only review)", async () => {
    render(<Harness facility={ADDRESS} disabled />);
    await flush();
    const link = screen.getByRole("link");
    expect(link.closest("fieldset")).toBeDisabled();
    expect(link).toHaveAttribute("href", "/review/6f1c2a9e-0000-4000-8000-000000000001");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/inspection/__tests__/possible-duplicate-warning.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/inspection/possible-duplicate-warning"`.

- [ ] **Step 3: Implement** — create `src/components/inspection/possible-duplicate-warning.tsx`:

```tsx
"use client";

import { AlertTriangle, ExternalLink } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { headerNoun, matchDetailLine } from "@/lib/inspection-matches/format";
import {
  buildMatchQuery,
  MATCH_FIELD_BODY_MAX,
  matchQueryKey,
} from "@/lib/inspection-matches/normalize";
import { cn } from "@/lib/utils";
import type { InspectionMatchRequest, InspectionMatchResult } from "@/types/inspection-matches";
import type { InspectionFormData } from "@/types/inspection";

/** Exact copy (duplicate-warning spec §2.3) */
export const headerSingle = (noun: string): string => `This ${noun} may match another report`;
export const headerMultiple = (noun: string): string => `This ${noun} may match other reports:`;
export const PICKER_HEADER_SINGLE = "May match an existing report";
export const PICKER_HEADER_MULTIPLE = "May match existing reports:";
export const hiddenOnly = (n: number): string =>
  n === 1 ? "May match a report by another inspector" : `May match ${n} reports by other inspectors`;
export const hiddenTail = (n: number): string =>
  n === 1 ? "+ 1 more by another inspector" : `+ ${n} more by other inspectors`;
export const MORE_MATCHES = "More matches exist — search the dashboard for this address.";
export const MATCH_CHECK_FAILED = "Couldn't check for matching reports.";
export const MATCH_ANNOUNCEMENT = "Possible matching report found";
export const NEW_TAB_SUFFIX = "(opens in a new tab)";

export const MATCH_DEBOUNCE_MS = 700;

const BOX = "rounded-md border border-amber-300 bg-amber-50 dark:border-amber-700/60 dark:bg-amber-950/30";
const HEADER_TEXT = "font-medium text-amber-900 dark:text-amber-200";
const MUTED_TEXT = "text-amber-800/90 dark:text-amber-300/90";

function NewTabSuffix() {
  return <span className="sr-only"> {NEW_TAB_SUFFIX}</span>;
}

interface PossibleDuplicateNoticeProps {
  result: InspectionMatchResult;
  /** compact = a Workiz picker row */
  variant?: "default" | "compact";
}

/**
 * Amber "may match another report" box. Information only: every link is a plain new-tab anchor
 * (no next/link prefetch of other inspections). Hidden matches render as a count, never a link.
 */
export function PossibleDuplicateNotice({ result, variant = "default" }: PossibleDuplicateNoticeProps) {
  const { matches, hiddenCount, truncated } = result;
  if (matches.length + hiddenCount === 0) return null;

  const compact = variant === "compact";
  const box = cn(BOX, "flex items-start gap-2", compact ? "px-2 py-1.5 text-xs" : "px-3 py-2 text-sm");
  const detail = cn("block", MUTED_TEXT, !compact && "text-xs");
  const icon = (
    <AlertTriangle
      aria-hidden="true"
      className={cn("mt-0.5 shrink-0 text-amber-600 dark:text-amber-400", compact ? "size-3.5" : "size-4")}
    />
  );
  const noun = headerNoun(matches.flatMap((match) => match.reasons));

  // One openable match and nothing else: the whole box is the link
  if (matches.length === 1 && hiddenCount === 0 && !truncated) {
    const match = matches[0];
    return (
      <a
        data-slot="possible-duplicate-warning"
        href={match.href}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(box, "hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:hover:bg-amber-950/50")}
      >
        {icon}
        <span className="min-w-0">
          <span className={cn("flex items-center gap-1", HEADER_TEXT)}>
            {compact ? PICKER_HEADER_SINGLE : headerSingle(noun)}
            <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
          </span>
          <span className={detail}>{matchDetailLine(match)}</span>
        </span>
        <NewTabSuffix />
      </a>
    );
  }

  if (matches.length === 0) {
    return (
      <div data-slot="possible-duplicate-warning" className={box}>
        {icon}
        <p className={HEADER_TEXT}>{hiddenOnly(hiddenCount)}</p>
      </div>
    );
  }

  return (
    <div data-slot="possible-duplicate-warning" className={box}>
      {icon}
      <div className="min-w-0 flex-1">
        <p className={HEADER_TEXT}>{compact ? PICKER_HEADER_MULTIPLE : headerMultiple(noun)}</p>
        {/* biome-ignore lint/a11y/noRedundantRoles: Safari drops list semantics under list-style:none */}
        {/* biome-ignore lint/a11y/useSemanticElements: same element; it already is a <ul> */}
        <ul role="list" className="mt-1 space-y-1">
          {matches.map((match) => (
            <li key={match.inspectionId}>
              <a
                href={match.href}
                target="_blank"
                rel="noopener noreferrer"
                className={cn("inline-flex items-start gap-1 underline-offset-2 hover:underline", HEADER_TEXT, "font-normal")}
              >
                <span>{matchDetailLine(match)}</span>
                <ExternalLink aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
                <NewTabSuffix />
              </a>
            </li>
          ))}
          {hiddenCount > 0 && <li className={MUTED_TEXT}>{hiddenTail(hiddenCount)}</li>}
          {truncated && <li className={MUTED_TEXT}>{MORE_MATCHES}</li>}
        </ul>
      </div>
    </div>
  );
}

type MatchFields = Required<InspectionMatchRequest>;

const clip = (value: unknown): string => (typeof value === "string" ? value.trim().slice(0, MATCH_FIELD_BODY_MAX) : "");

function isMatchResult(body: unknown): body is InspectionMatchResult {
  if (!body || typeof body !== "object") return false;
  const candidate = body as Partial<InspectionMatchResult>;
  return Array.isArray(candidate.matches) && typeof candidate.hiddenCount === "number";
}

/** Any failure (non-2xx, bad JSON, wrong shape, abort, network) → null: the notice stays hidden */
async function fetchMatches(
  inspectionId: string,
  fields: MatchFields,
  signal: AbortSignal,
): Promise<InspectionMatchResult | null> {
  try {
    const res = await fetch(`/api/inspections/${encodeURIComponent(inspectionId)}/matches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
      signal,
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (!isMatchResult(body)) return null;
    return { matches: body.matches, hiddenCount: body.hiddenCount, truncated: body.truncated === true };
  } catch {
    return null;
  }
}

/**
 * Wizard/review Step 1 container (spec §9.2): watches the four property fields, asks the server
 * on mount and then (debounced) whenever the normalised key changes, and hides the previous
 * notice at once when the key changes.
 */
export function PossibleDuplicateWarning({ inspectionId }: { inspectionId: string }) {
  const { control } = useFormContext<InspectionFormData>();
  const [facilityAddress, facilityCity, facilityZip, taxParcelNumber] = useWatch({
    control,
    name: [
      "facilityInfo.facilityAddress",
      "facilityInfo.facilityCity",
      "facilityInfo.facilityZip",
      "facilityInfo.taxParcelNumber",
    ],
  });
  const fields: MatchFields = {
    facilityAddress: clip(facilityAddress),
    facilityCity: clip(facilityCity),
    facilityZip: clip(facilityZip),
    taxParcelNumber: clip(taxParcelNumber),
  };
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;

  const key = useMemo(
    () => matchQueryKey(buildMatchQuery({ facilityAddress, facilityCity, facilityZip, taxParcelNumber })),
    [facilityAddress, facilityCity, facilityZip, taxParcelNumber],
  );

  // Tagged with the key it answers, so a result never shows for different values
  const [result, setResult] = useState<{ key: string; value: InspectionMatchResult } | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    const immediate = !mountedRef.current;
    mountedRef.current = true;
    setResult(null);
    if (key === "") return;

    const controller = new AbortController();
    const run = () => {
      void fetchMatches(inspectionId, fieldsRef.current, controller.signal).then((value) => {
        if (value && !controller.signal.aborted) setResult({ key, value });
      });
    };
    const timer = immediate ? undefined : setTimeout(run, MATCH_DEBOUNCE_MS);
    if (immediate) run();
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, inspectionId]);

  const current = result && result.key === key ? result.value : null;
  const found = !!current && current.matches.length + current.hiddenCount > 0;

  return (
    <>
      <div className="empty:hidden sm:col-span-2">{current && <PossibleDuplicateNotice result={current} />}</div>
      <span className="sr-only" aria-live="polite" data-slot="possible-duplicate-announcement">
        {found ? MATCH_ANNOUNCEMENT : ""}
      </span>
    </>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/components/inspection/__tests__/possible-duplicate-warning.test.tsx`
Expected: PASS (23 tests).

- [ ] **Step 5: Lint and type-check**

Run: `npx biome lint src/components/inspection/possible-duplicate-warning.tsx src/components/inspection/__tests__/possible-duplicate-warning.test.tsx`
Expected: clean (the two `biome-ignore` comments on the `<ul role="list">` mirror the picker's existing ones).
Run: `npx tsc --noEmit 2>&1 | grep possible-duplicate`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/components/inspection/possible-duplicate-warning.tsx src/components/inspection/__tests__/possible-duplicate-warning.test.tsx
git commit -m "feat(dup-warning): possible-duplicate notice and debounced wizard container

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task T11: `POST /api/inspections/[id]/matches`

**Files:**
- Create: `src/app/api/inspections/[id]/matches/route.ts`
- Test: `src/app/api/inspections/[id]/matches/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `requireInspectionAccess(id, "view")` (`@/lib/prefill/route-access`, returns `{ ok: true, userId, isPrivileged, inspection } | { ok: false, response }`); `findPossibleDuplicates` (T9); `buildMatchQuery`, `MATCH_FIELD_BODY_MAX` (T6); `logDbError(..., "inspection-matches")` (T3).
- Produces: `POST` only. 404 for non-UUID id (before any query); access gate 401/403/404 passed through; 400 `{ error: "Invalid request" }` for bad JSON / unknown key / non-string / > 1,000 chars; 200 `InspectionMatchResult` (`Cache-Control: no-store`); 500 `{ error: "Couldn't check for matching reports", code: "internal" }`. The zod schema is NOT exported (Next.js route files may only export route fields).

- [ ] **Step 1: Write the failing test** — create `src/app/api/inspections/[id]/matches/__tests__/route.test.ts` (it mocks the access gate and the SELECT; the real `find.ts`/`match.ts` run, so the no-leak rule is tested end to end):

```ts
import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAccess, mockFindCandidates } = vi.hoisted(() => ({
  mockAccess: vi.fn(),
  mockFindCandidates: vi.fn(),
}));

vi.mock("@/lib/prefill/route-access", () => ({ requireInspectionAccess: mockAccess }));
// The real find.ts + match.ts run; only the SELECT is mocked
vi.mock("@/lib/inspection-matches/store", () => ({ findMatchCandidates: mockFindCandidates }));

import type { MatchCandidateRow } from "@/lib/inspection-matches/store";
import { POST } from "../route";

// Synthetic fixtures only (spec §12)
const ID = "6f1c2a9e-0000-4000-8000-0000000000aa";
const HIDDEN_ID = "6f1c2a9e-0000-4000-8000-00000000beef";
const OWN_ID = "6f1c2a9e-0000-4000-8000-000000000001";

const granted = (userId: string, isPrivileged: boolean) => ({
  ok: true,
  userId,
  isPrivileged,
  inspection: { inspectorId: userId, status: "draft" },
});
const denied = (status: number, error: string) => ({ ok: false, response: NextResponse.json({ error }, { status }) });

function stored(over: Partial<MatchCandidateRow> = {}): MatchCandidateRow {
  return {
    id: OWN_ID,
    inspectorId: "tech-1",
    status: "completed",
    facilityAddress: "100 E Example Rd",
    facilityCity: "Cave Creek",
    facilityZip: "85331",
    apn: null,
    taxParcelNumber: "123-45-678",
    inspectionDate: "2026-10-06",
    createdAt: new Date("2026-10-06T19:12:00.000Z"),
    workizJobId: null,
    inspectorName: "Sam Sample",
    ...over,
  };
}

const BODY = { facilityAddress: "100 E Example Rd", facilityCity: "Cave Creek", facilityZip: "85331", taxParcelNumber: "123-45-678" };

const call = (body: unknown, id = ID, raw = false) =>
  POST(
    new Request(`http://localhost/api/inspections/${id}/matches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: raw ? (body as string) : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockAccess.mockResolvedValue(granted("tech-1", false));
  mockFindCandidates.mockResolvedValue({ rows: [], capHit: false });
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/inspections/[id]/matches", () => {
  it("404 for a non-UUID id, before any auth or DB call", async () => {
    const res = await call(BODY, "not-a-uuid");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Inspection not found" });
    expect(mockAccess).not.toHaveBeenCalled();
    expect(mockFindCandidates).not.toHaveBeenCalled();
  });

  it.each([
    [401, "Unauthorized"],
    [404, "Inspection not found"],
    [403, "Forbidden"],
  ])("passes the access gate's %i through", async (status, error) => {
    mockAccess.mockResolvedValue(denied(status, error));
    const res = await call(BODY);
    expect(res.status).toBe(status);
    expect(mockFindCandidates).not.toHaveBeenCalled();
  });

  it("asks for view access to this inspection", async () => {
    await call(BODY);
    expect(mockAccess).toHaveBeenCalledWith(ID, "view");
  });

  it.each([
    ["invalid JSON", "{not json", true],
    ["an unknown key", { ...BODY, customerEmail: "test.client@example.com" }, false],
    ["a non-string", { facilityAddress: 100 }, false],
    ["a field over 1,000 characters", { facilityAddress: `100 E Example Rd ${"x".repeat(1000)}` }, false],
  ])("400 for %s, without echoing the input", async (_label, body, raw) => {
    const res = await call(body, ID, raw as boolean);
    expect(res.status).toBe(400);
    const text = JSON.stringify(await res.json());
    expect(text).toBe(JSON.stringify({ error: "Invalid request" }));
    expect(mockFindCandidates).not.toHaveBeenCalled();
  });

  it("an empty query → 200 empty with no store call", async () => {
    const res = await call({ facilityAddress: "Example Rd", taxParcelNumber: "N/A" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ matches: [], hiddenCount: 0, truncated: false });
    expect(mockFindCandidates).not.toHaveBeenCalled();
  });

  it("a 25-character APN is ignored but the address is still checked", async () => {
    mockFindCandidates.mockResolvedValue({ rows: [stored({ taxParcelNumber: null })], capHit: false });
    const res = await call({ ...BODY, taxParcelNumber: "123-45-678 see the permit" });
    expect(res.status).toBe(200);
    expect(mockFindCandidates).toHaveBeenCalledWith(expect.objectContaining({ houseNumbers: ["100"], apnKeys: [] }));
    expect((await res.json()).matches[0].reasons).toEqual(["address"]);
  });

  it("excludes the inspection itself and sends no-store", async () => {
    const res = await call(BODY);
    expect(mockFindCandidates).toHaveBeenCalledWith({
      houseNumbers: ["100"],
      apnKeys: ["12345678"],
      excludeInspectionId: ID,
      limit: 200,
    });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it.each([
    ["admin", "admin-1"],
    ["office staff", "office-1"],
  ])("%s gets full details and links for another inspector's match", async (_role, userId) => {
    mockAccess.mockResolvedValue(granted(userId, true));
    mockFindCandidates.mockResolvedValue({ rows: [stored({ inspectorId: "tech-9" })], capHit: false });
    const body = await (await call(BODY)).json();
    expect(body).toEqual({
      matches: [
        {
          inspectionId: OWN_ID,
          href: `/review/${OWN_ID}`,
          status: "completed",
          facilityAddress: "100 E Example Rd",
          facilityCity: "Cave Creek",
          inspectionDate: "2026-10-06",
          createdAt: "2026-10-06T19:12:00.000Z",
          inspectorName: "Sam Sample",
          isOwn: false,
          reasons: ["apn", "address"],
        },
      ],
      hiddenCount: 0,
      truncated: false,
    });
  });

  it("a field tech sees their own match in full and only a count for another inspector's", async () => {
    mockFindCandidates.mockResolvedValue({
      rows: [
        stored(),
        stored({ id: HIDDEN_ID, inspectorId: "tech-9", facilityCity: "Hiddenville", inspectorName: "Pat Private" }),
      ],
      capHit: false,
    });
    const body = await (await call(BODY)).json();
    expect(body.hiddenCount).toBe(1);
    expect(body.matches).toHaveLength(1);
    expect(body.matches[0]).toMatchObject({ inspectionId: OWN_ID, isOwn: true, href: `/inspections/${OWN_ID}` });
    const text = JSON.stringify(body);
    for (const leak of [HIDDEN_ID, "Hiddenville", "Pat Private"]) expect(text).not.toContain(leak);
  });

  it("a DB error → 500 with a fixed message; the log line carries no address or APN", async () => {
    const err = Object.assign(new Error(`Failed query: select … params: 100,12345678,${BODY.facilityAddress}`), {
      query: "select …",
      params: ["100", "12345678"],
      cause: { code: "57014" },
    });
    mockFindCandidates.mockRejectedValue(err);
    const res = await call(BODY);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Couldn't check for matching reports", code: "internal" });
    expect(errorSpy).toHaveBeenCalledWith("[inspection-matches] db error scope=match_lookup job=- code=57014 constraint=-");
    const logged = JSON.stringify(errorSpy.mock.calls);
    for (const leak of ["Example Rd", "12345678", "123-45-678", "Failed query"]) expect(logged).not.toContain(leak);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run "src/app/api/inspections/[id]/matches"`
Expected: FAIL — `Failed to resolve import "../route"`.

- [ ] **Step 3: Implement** — create `src/app/api/inspections/[id]/matches/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { findPossibleDuplicates } from "@/lib/inspection-matches/find";
import { buildMatchQuery, MATCH_FIELD_BODY_MAX } from "@/lib/inspection-matches/normalize";
import { requireInspectionAccess } from "@/lib/prefill/route-access";
import { logDbError } from "@/lib/workiz/log-db-error";
import type { InspectionMatchResult } from "@/types/inspection-matches";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const matchField = z.string().max(MATCH_FIELD_BODY_MAX).optional();

/** Body-size caps only: an unusable value is ignored per field by buildMatchQuery, never rejected */
const inspectionMatchRequestSchema = z
  .object({
    facilityAddress: matchField,
    facilityCity: matchField,
    facilityZip: matchField,
    taxParcelNumber: matchField,
  })
  .strict();

const NO_STORE = { "Cache-Control": "no-store" };
const EMPTY: InspectionMatchResult = { matches: [], hiddenCount: 0, truncated: false };

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

/**
 * POST /api/inspections/[id]/matches — possible-duplicate check for the live Step 1 values
 * (duplicate-warning spec §6.1). A POST so addresses and APNs stay out of URLs and logs. Changes
 * nothing. Responses carry fixed messages only; the input is never echoed.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return json({ error: "Inspection not found" }, 404);

  const access = await requireInspectionAccess(id, "view");
  if (!access.ok) return access.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
  const parsed = inspectionMatchRequestSchema.safeParse(body);
  if (!parsed.success) return json({ error: "Invalid request" }, 400);

  const query = buildMatchQuery(parsed.data);
  if (!query) return json(EMPTY);

  try {
    const result = await findPossibleDuplicates(
      query,
      { userId: access.userId, privileged: access.isPrivileged },
      { excludeInspectionId: id },
    );
    return json(result);
  } catch (err) {
    logDbError("match_lookup", err, {}, "inspection-matches");
    return json({ error: "Couldn't check for matching reports", code: "internal" }, 500);
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run "src/app/api/inspections/[id]/matches"`
Expected: PASS (16 tests).

- [ ] **Step 5: Lint and type-check**

Run: `npx biome lint "src/app/api/inspections/[id]/matches/route.ts" "src/app/api/inspections/[id]/matches/__tests__/route.test.ts"`
Expected: clean.
Run: `npx tsc --noEmit 2>&1 | grep "matches/"`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/inspections/[id]/matches/route.ts" "src/app/api/inspections/[id]/matches/__tests__/route.test.ts"
git commit -m "feat(dup-warning): POST /api/inspections/[id]/matches

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task T12: `GET /api/workiz/jobs` batch matches + wire type additions

**Files:**
- Modify: `src/types/workiz-import.ts`
- Modify: `src/app/api/workiz/jobs/route.ts`
- Test: `src/app/api/workiz/jobs/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `findPossibleDuplicatesBatch` (T9), `PICKER_MATCH_LIMIT` (T8), `buildMatchQuery` (T6), `WorkizJobSummary.zip/apnHint` (T4), `InspectionMatchResult` (T6).
- Produces: `WorkizJobRow.possibleMatches?: InspectionMatchResult` (present only when `matches.length + hiddenCount > 0`); `WorkizJobsResponse.matchCheckFailed?: true` (present only on lookup failure). Existing bodies are byte-for-byte unchanged when there are no matches.

- [ ] **Step 1: Write the failing test** — edit `src/app/api/workiz/jobs/__tests__/route.test.ts`:

1. Replace the `vi.hoisted` block with:

```ts
const { mockGetUser, mockGetUserRole, mockList, mockFind, mockLoadName, mockBatch } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockGetUserRole: vi.fn(),
  mockList: vi.fn(),
  mockFind: vi.fn(),
  mockLoadName: vi.fn(),
  mockBatch: vi.fn(),
}));
```

2. Directly above `vi.mock("@/lib/workiz/import-store", …)` add:

```ts
vi.mock("@/lib/inspection-matches/find", () => ({ findPossibleDuplicatesBatch: mockBatch }));
```

3. Replace `import { fixtures, job } from "@/lib/workiz/__tests__/fixtures/jobs";` with:

```ts
import { CF_IDS, cf, fixtures, job, withAddress } from "@/lib/workiz/__tests__/fixtures/jobs";
```

and replace `import { GET, maxDuration } from "../route";` with:

```ts
import type { InspectionMatchResult } from "@/types/inspection-matches";
import { GET, maxDuration } from "../route";
```

4. In `beforeEach`, after `mockLoadName.mockResolvedValue("Sam Sample");` add:

```ts
  mockBatch.mockResolvedValue(new Map());
```

5. Append inside the top-level `describe("GET /api/workiz/jobs", …)` (before its final `});`):

```ts
  describe("possible duplicates", () => {
    const MATCH: InspectionMatchResult = {
      matches: [
        {
          inspectionId: "6f1c2a9e-0000-4000-8000-000000000001",
          href: "/inspections/6f1c2a9e-0000-4000-8000-000000000001",
          status: "completed",
          facilityAddress: "100 E Example Rd",
          facilityCity: "Cave Creek",
          inspectionDate: "2026-10-06",
          createdAt: "2026-10-06T19:12:00.000Z",
          inspectorName: "Sam Sample",
          isOwn: true,
          reasons: ["address"],
        },
      ],
      hiddenCount: 0,
      truncated: false,
    };
    const EMPTY: InspectionMatchResult = { matches: [], hiddenCount: 0, truncated: false };

    it("makes one batch call with street + #unit, city, zip, apnHint and both Workiz ids excluded", async () => {
      const unitRow = toJobSummary(
        workizJobSchema.parse(
          withAddress({ unit: "12" }, { customFields: [cf(CF_IDS.apn, "12345670")] }),
        ),
      );
      mockList.mockResolvedValue({ rows: [unitRow, ROW_C], fetchedAt: FETCHED_AT });
      await GET(request());
      expect(mockBatch).toHaveBeenCalledTimes(1);
      const [items, viewer, opts] = mockBatch.mock.calls[0];
      expect(viewer).toEqual({ userId: "user-1", privileged: false });
      expect(opts).toEqual({ limit: 3 });
      expect(items[0]).toEqual({
        key: "JOB-AbCdEfGhIjKlMnOp",
        query: {
          address: { number: "100", dir: "E", street: "EXAMPLE", suffix: "RD", unit: "12" },
          zip5: "85331",
          city: "cave creek",
          apnKey: "12345670",
        },
        excludeWorkizJobIds: ["AB12CD", "JOB-AbCdEfGhIjKlMnOp"],
      });
      expect(items[1]).toMatchObject({ key: "JOB-Unscheduled000001", excludeWorkizJobIds: ["UN12CD", "JOB-Unscheduled000001"] });
    });

    it("admins are privileged viewers", async () => {
      mockGetUserRole.mockResolvedValue("admin");
      await GET(request());
      expect(mockBatch.mock.calls[0][1]).toEqual({ userId: "user-1", privileged: true });
    });

    it("a row with matches carries possibleMatches; rows with an empty result do not", async () => {
      mockBatch.mockResolvedValue(new Map([["JOB-AbCdEfGhIjKlMnOp", MATCH], ["JOB-OnlineBooking00001", EMPTY]]));
      const body = await (await GET(request())).json();
      expect(body.jobs[0].possibleMatches).toEqual(MATCH);
      expect("possibleMatches" in body.jobs[1]).toBe(false);
      expect("possibleMatches" in body.jobs[2]).toBe(false);
      expect(body.matchCheckFailed).toBeUndefined();
    });

    it("a hidden-only result (field tech) is passed through as a count", async () => {
      mockBatch.mockResolvedValue(new Map([["JOB-AbCdEfGhIjKlMnOp", { matches: [], hiddenCount: 2, truncated: false }]]));
      const body = await (await GET(request())).json();
      expect(body.jobs[0].possibleMatches).toEqual({ matches: [], hiddenCount: 2, truncated: false });
    });

    it("a failed lookup → 200 with the jobs, matchCheckFailed: true and only the fixed log line", async () => {
      const err = Object.assign(new Error("Failed query: select … params: 100,12345670"), { cause: { code: "57014" } });
      mockBatch.mockRejectedValue(err);
      const res = await GET(request());
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.jobs).toHaveLength(3);
      expect(body.matchCheckFailed).toBe(true);
      expect(body.jobs.some((j: Record<string, unknown>) => "possibleMatches" in j)).toBe(false);
      expect(errorSpy).toHaveBeenCalledWith(
        "[workiz-import] db error scope=jobs_match_lookup job=- code=57014 constraint=-",
      );
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("Failed query");
    });

    it("matches are recomputed on every request, refresh=1 included (never cached)", async () => {
      await GET(request());
      await GET(request("?refresh=1"));
      expect(mockBatch).toHaveBeenCalledTimes(2);
      expect(mockList).toHaveBeenLastCalledWith({ refresh: true });
    });

    it("the lookup never runs when the Workiz listing fails", async () => {
      mockList.mockRejectedValue(new WorkizError("unavailable"));
      await GET(request());
      expect(mockBatch).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/app/api/workiz/jobs`
Expected: FAIL — the new cases fail (`mockBatch` never called, no `possibleMatches`, no `matchCheckFailed`); the existing cases still pass.

- [ ] **Step 3: Implement**

In `src/types/workiz-import.ts`:
1. After the header comment add:

```ts

import type { InspectionMatchResult } from "./inspection-matches";
```

2. In `interface WorkizJobRow`, after `existing: WorkizExisting | null;` add:

```ts
  /** Present only when the row has at least one possible duplicate (other than its own import) */
  possibleMatches?: InspectionMatchResult;
```

3. In `interface WorkizJobsResponse`, after `truncated?: boolean;` add:

```ts
  /** Present (true) only when the possible-duplicate lookup failed; the jobs are still listed */
  matchCheckFailed?: true;
```

Replace the whole of `src/app/api/workiz/jobs/route.ts` with:

```ts
import { NextResponse } from "next/server";
import { findPossibleDuplicatesBatch } from "@/lib/inspection-matches/find";
import { PICKER_MATCH_LIMIT } from "@/lib/inspection-matches/match";
import { buildMatchQuery } from "@/lib/inspection-matches/normalize";
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
import type { InspectionMatchResult } from "@/types/inspection-matches";
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
 * `existing` and `possibleMatches` are computed per request and never cached. A failed
 * possible-duplicate lookup never hides the list: it only sets `matchCheckFailed`.
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
    // Only the error's class name — and kept out of the console call so T23's `\berr\b` grep stays clean
    const errorName = err instanceof Error ? err.name : "unknown";
    console.error(`[workiz] job list failed: ${errorName}`);
    return internalErrorResponse();
  }

  // Informational only: its own catch, so a failure never turns into a 500
  const matchLookup = findPossibleDuplicatesBatch(
    list.rows.map((row) => ({
      key: row.id,
      query: buildMatchQuery({
        facilityAddress: row.street,
        facilityCity: row.city,
        facilityZip: row.zip ?? "",
        taxParcelNumber: row.apnHint ?? "",
      }),
      excludeWorkizJobIds: [row.uuid, row.id].filter(Boolean),
    })),
    // Same rule as existingFor: the picker admits only admin and field_tech
    { userId: auth.user.id, privileged: auth.role === "admin" },
    { limit: PICKER_MATCH_LIMIT },
  ).catch((err: unknown) => {
    logDbError("jobs_match_lookup", err);
    return null;
  });

  let matches: ImportedInspectionRow[];
  let fullName: string | null;
  let possible: Map<string, InspectionMatchResult> | null;
  try {
    [matches, fullName, possible] = await Promise.all([
      findInspectionsByWorkizIds(list.rows.flatMap((row) => [row.uuid, row.id])),
      loadProfileFullName(auth.user.id),
      matchLookup,
    ]);
  } catch (err) {
    logDbError("jobs_existing_lookup", err);
    return internalErrorResponse();
  }

  const jobs: WorkizJobRow[] = list.rows.map((row) => {
    const possibleMatches = possible?.get(row.id);
    return {
      id: row.id,
      serialId: row.serialId,
      street: row.street,
      city: row.city,
      scheduledDate: row.scheduledDate,
      subStatus: row.subStatus,
      teamFirstNames: row.teamFirstNames,
      existing: existingFor(row, matches, auth.user.id, auth.role),
      ...(possibleMatches && possibleMatches.matches.length + possibleMatches.hiddenCount > 0
        ? { possibleMatches }
        : {}),
    };
  });

  const body: WorkizJobsResponse = {
    jobs,
    fetchedAt: new Date(list.fetchedAt).toISOString(),
    role: auth.role,
    currentUserFirstName: firstNameOf(fullName),
    ...(list.truncated ? { truncated: true } : {}),
    ...(possible === null ? { matchCheckFailed: true as const } : {}),
  };
  return NextResponse.json(body);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/app/api/workiz`
Expected: PASS (jobs route 24 tests; import route unchanged).

- [ ] **Step 5: Lint and type-check**

Run: `npx biome lint src/types/workiz-import.ts src/app/api/workiz/jobs/route.ts src/app/api/workiz/jobs/__tests__/route.test.ts`
Expected: clean.
Run: `npx tsc --noEmit 2>&1 | grep -E "workiz"`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/types/workiz-import.ts src/app/api/workiz/jobs/route.ts src/app/api/workiz/jobs/__tests__/route.test.ts
git commit -m "feat(dup-warning): possible matches on Workiz picker rows

One batch SELECT per request, never cached; a failed lookup keeps the list
and sets matchCheckFailed.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task T13: Render the warning under Address in Step 1

**Files:**
- Modify: `src/components/inspection/step-facility-info.tsx`
- Test: `src/components/inspection/__tests__/step-facility-info-duplicate.test.tsx` (new); existing `step-facility-info-provenance.test.tsx`, `step-read-only.test.tsx`, `src/components/review/__tests__/*` must stay green unchanged.

**Interfaces:**
- Consumes: `PossibleDuplicateWarning({ inspectionId })` (T10).
- Produces: the notice as a grid child right after the Address `FormField`, before City; also on `/review/{id}` (shared step).

- [ ] **Step 1: Write the failing test** — create `src/components/inspection/__tests__/step-facility-info-duplicate.test.tsx`:

```tsx
import { act, cleanup, render, screen } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StepFacilityInfo } from "@/components/inspection/step-facility-info";
import { Form } from "@/components/ui/form";
import { getDefaultFormValues } from "@/lib/validators/inspection";
import type { InspectionFormData } from "@/types/inspection";
import type { InspectionMatchResult } from "@/types/inspection-matches";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/inspection/media-gallery", () => ({ MediaGallery: () => <div /> }));
vi.mock("@/components/inspection/photo-capture", () => ({ PhotoCapture: () => <div /> }));

// Synthetic fixtures only (duplicate-warning spec §12)
const INSPECTION_ID = "6f1c2a9e-0000-4000-8000-0000000000aa";
const RESULT: InspectionMatchResult = {
  matches: [
    {
      inspectionId: "6f1c2a9e-0000-4000-8000-000000000001",
      href: "/review/6f1c2a9e-0000-4000-8000-000000000001",
      status: "completed",
      facilityAddress: "100 E Example Rd",
      facilityCity: "Cave Creek",
      inspectionDate: "2026-10-06",
      createdAt: "2026-10-06T19:12:00.000Z",
      inspectorName: "Sam Sample",
      isOwn: false,
      reasons: ["address"],
    },
  ],
  hiddenCount: 0,
  truncated: false,
};

function Harness({ address, readOnly = false }: { address: string; readOnly?: boolean }) {
  const defaults = getDefaultFormValues("Tech") as unknown as InspectionFormData;
  const form = useForm<InspectionFormData>({
    defaultValues: { ...defaults, facilityInfo: { ...defaults.facilityInfo, facilityAddress: address } },
  });
  return (
    <Form {...form}>
      <StepFacilityInfo inspectionId={INSPECTION_ID} readOnly={readOnly} />
    </Form>
  );
}

const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
  String(input).endsWith("/matches") ? { ok: true, status: 200, json: async () => RESULT } : { ok: false },
);

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockClear();
});

describe("StepFacilityInfo possible-duplicate warning", () => {
  it("shows the new-tab notice directly under Address, before City", async () => {
    render(<Harness address="100 E Example Rd" />);
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledWith(`/api/inspections/${INSPECTION_ID}/matches`, expect.objectContaining({ method: "POST" }));
    const link = screen.getByRole("link", { name: /This address may match another report/ });
    expect(link).toHaveAttribute("target", "_blank");
    const address = document.querySelector('input[name="facilityInfo.facilityAddress"]') as HTMLElement;
    const city = document.querySelector('input[name="facilityInfo.facilityCity"]') as HTMLElement;
    expect(address.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(link.compareDocumentPosition(city) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("still links on the read-only review step", async () => {
    render(<Harness address="100 E Example Rd" readOnly />);
    await act(async () => {});
    expect(screen.getByRole("link", { name: /may match another report/ })).toHaveAttribute(
      "href",
      "/review/6f1c2a9e-0000-4000-8000-000000000001",
    );
  });

  it("a blank draft makes no match request", async () => {
    render(<Harness address="" />);
    await act(async () => {});
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/matches"))).toBe(false);
    expect(screen.queryByRole("link", { name: /may match/ })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/inspection/__tests__/step-facility-info-duplicate.test.tsx`
Expected: FAIL — 2 tests fail (no `/matches` request, no link); "a blank draft makes no match request" passes.

- [ ] **Step 3: Implement** — in `src/components/inspection/step-facility-info.tsx`:

1. After `import { PhotoCapture } from "@/components/inspection/photo-capture";` add:

```tsx
import { PossibleDuplicateWarning } from "@/components/inspection/possible-duplicate-warning";
```

2. Directly after the Address field block (the `FormField` whose `name="facilityInfo.facilityAddress"`, ending with `</FormItem>`, `)}`, `/>`) and before the City `FormField`, insert:

```tsx

          <PossibleDuplicateWarning inspectionId={inspectionId} />
```

Do not wrap it in a `FormItem`.

- [ ] **Step 4: Run the component suites to verify they pass**

Run: `npx vitest run src/components/inspection src/components/review`
Expected: PASS, 0 failures (the new file 3 tests; existing harnesses seed empty facility fields or stub `fetch` with shapes the container ignores).

- [ ] **Step 5: Lint**

Run: `npx biome lint src/components/inspection/step-facility-info.tsx src/components/inspection/__tests__/step-facility-info-duplicate.test.tsx`
Expected: only the 3 pre-existing `step-facility-info.tsx` findings (`noLabelWithoutControl` ×1, `useExhaustiveDependencies` ×2, line numbers shifted by the edit); nothing new.

- [ ] **Step 6: Commit**

```bash
git add src/components/inspection/step-facility-info.tsx src/components/inspection/__tests__/step-facility-info-duplicate.test.tsx
git commit -m "feat(dup-warning): show possible-duplicate notice under Step 1 Address

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task T14: Workiz picker rows show the compact notice

**Files:**
- Modify: `src/components/inspection/workiz-import-picker.tsx`
- Test: `src/components/inspection/__tests__/workiz-import-picker.test.tsx`

**Interfaces:**
- Consumes: `PossibleDuplicateNotice`, `MATCH_CHECK_FAILED` (T10); `inspectionPath` (T2); `WorkizJobRow.possibleMatches`, `WorkizJobsResponse.matchCheckFailed` (T12).
- Produces: `inspectionHref(id, status, role)` keeps its signature and outputs (now `inspectionPath(id, status, role === "admin")`).

- [ ] **Step 1: Write the failing test** — edit `src/components/inspection/__tests__/workiz-import-picker.test.tsx`:

1. Replace `import type { WorkizJobRow, WorkizJobsResponse } from "@/types/workiz-import";` with:

```tsx
import type { InspectionMatchResult, VisibleInspectionMatch } from "@/types/inspection-matches";
import type { WorkizJobRow, WorkizJobsResponse } from "@/types/workiz-import";
```

2. Directly above the existing `import {` + `formatScheduledDate,` block add:

```tsx
import {
  MATCH_CHECK_FAILED,
  PICKER_HEADER_MULTIPLE,
  PICKER_HEADER_SINGLE,
} from "@/components/inspection/possible-duplicate-warning";
```

3. Append at the end of the file:

```tsx
describe("WorkizImportPicker possible duplicates", () => {
  function match(over: Partial<VisibleInspectionMatch> = {}): VisibleInspectionMatch {
    return {
      inspectionId: "6f1c2a9e-0000-4000-8000-000000000001",
      href: "/inspections/6f1c2a9e-0000-4000-8000-000000000001",
      status: "completed",
      facilityAddress: "100 E Example Rd",
      facilityCity: "Cave Creek",
      inspectionDate: "2026-10-06",
      createdAt: "2026-10-06T19:12:00.000Z",
      inspectorName: "Sam Sample",
      isOwn: true,
      reasons: ["address"],
      ...over,
    };
  }
  const matches = (over: Partial<InspectionMatchResult> = {}): InspectionMatchResult => ({
    matches: [match()],
    hiddenCount: 0,
    truncated: false,
    ...over,
  });
  const rowItem = async () => (await screen.findByText("#4696")).closest("li") as HTMLElement;

  it("a row with one match shows the compact notice as a single new-tab link; Import stays enabled", async () => {
    render(<WorkizImportPicker />);
    await openPanel(reply(200, jobs({ jobs: [row({ possibleMatches: matches() })] })));
    const item = within(await rowItem());
    const link = item.getByRole("link", { name: new RegExp(PICKER_HEADER_SINGLE) });
    expect(link).toHaveAttribute("href", "/inspections/6f1c2a9e-0000-4000-8000-000000000001");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveTextContent("Inspected Oct 6, 2026 · you · Same address");
    expect(item.getByRole("button", { name: /^Import Workiz job 4696/ })).toBeEnabled();
  });

  it("several matches: the multiple header and one link each", async () => {
    render(<WorkizImportPicker />);
    await openPanel(
      reply(200, jobs({ jobs: [row({ possibleMatches: matches({ matches: [match(), match({ inspectionId: "m2", href: "/inspections/m2" })] }) })] })),
    );
    const item = within(await rowItem());
    expect(item.getByText(PICKER_HEADER_MULTIPLE)).toBeInTheDocument();
    expect(item.getAllByRole("link")).toHaveLength(2);
  });

  it("clicking a match link never navigates the picker (no router.push)", async () => {
    render(<WorkizImportPicker />);
    const user = await openPanel(reply(200, jobs({ jobs: [row({ possibleMatches: matches() })] })));
    const link = within(await rowItem()).getByRole("link");
    // jsdom cannot open a new tab; stop the default so only app handlers run
    link.addEventListener("click", (event) => event.preventDefault());
    await user.click(link);
    expect(mockPush).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a hidden-only row shows the count copy with no link", async () => {
    render(<WorkizImportPicker />);
    await openPanel(reply(200, jobs({ jobs: [row({ possibleMatches: matches({ matches: [], hiddenCount: 1 }) })] })));
    const item = within(await rowItem());
    expect(item.getByText("May match a report by another inspector")).toBeInTheDocument();
    expect(item.queryByRole("link")).toBeNull();
  });

  it("an already-imported row still shows matches with other inspections", async () => {
    render(<WorkizImportPicker />);
    await openPanel(
      reply(200, jobs({ jobs: [row({ existing: { canOpen: true, inspectionId: "i9", status: "draft" }, possibleMatches: matches() })] })),
    );
    const item = within(await rowItem());
    expect(item.getByRole("button", { name: /Open the inspection/ })).toBeInTheDocument();
    expect(item.getByRole("link")).toBeInTheDocument();
  });

  it("matchCheckFailed shows the muted line above the list; rows without matches show no notice", async () => {
    render(<WorkizImportPicker />);
    await openPanel(reply(200, jobs({ matchCheckFailed: true })));
    expect(await screen.findByText(MATCH_CHECK_FAILED)).toBeInTheDocument();
    expect(document.querySelector('[data-slot="possible-duplicate-warning"]')).toBeNull();
  });

  it("no failure line by default", async () => {
    render(<WorkizImportPicker />);
    await openPanel();
    await screen.findByText("#4696");
    expect(screen.queryByText(MATCH_CHECK_FAILED)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/inspection/__tests__/workiz-import-picker.test.tsx`
Expected: FAIL — the new cases (no notice, no failure line); the existing 29 cases pass.

- [ ] **Step 3: Implement** — in `src/components/inspection/workiz-import-picker.tsx`:

1. After `import { toast } from "sonner";` add:

```tsx
import { MATCH_CHECK_FAILED, PossibleDuplicateNotice } from "@/components/inspection/possible-duplicate-warning";
```

and after `import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";` add:

```tsx
import { inspectionPath } from "@/lib/inspection-path";
```

2. Replace the body of `inspectionHref`:

```tsx
/** Same routing as handleRowClick in src/components/dashboard/inspections-table.tsx */
export function inspectionHref(id: string, status: string, role: WorkizImporterRole): string {
  return inspectionPath(id, status, role === "admin");
}
```

3. Directly before `{panel.kind === "ready" && panel.data.jobs.length === 0 && (` insert:

```tsx
              {panel.kind === "ready" && panel.data.matchCheckFailed && (
                <p className="mb-2 text-xs text-muted-foreground">{MATCH_CHECK_FAILED}</p>
              )}

```

4. Directly after the team line block

```tsx
                          {job.teamFirstNames.length > 0 && (
                            <p className="text-xs text-muted-foreground">Team: {job.teamFirstNames.join(", ")}</p>
                          )}
```

insert:

```tsx
                          {job.possibleMatches && (
                            <PossibleDuplicateNotice result={job.possibleMatches} variant="compact" />
                          )}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/components/inspection/__tests__/workiz-import-picker.test.tsx`
Expected: PASS (36 tests, including the unchanged `inspectionHref` routing test).

- [ ] **Step 5: Lint**

Run: `npx biome lint src/components/inspection/workiz-import-picker.tsx src/components/inspection/__tests__/workiz-import-picker.test.tsx`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/inspection/workiz-import-picker.tsx src/components/inspection/__tests__/workiz-import-picker.test.tsx
git commit -m "feat(dup-warning): compact possible-duplicate notice on Workiz picker rows

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task T15: Read-only live smoke (`npm run smoke:matches`) and baseline

**Files:**
- Create: `scripts/duplicate-match-smoke.mts`
- Modify: `package.json` (scripts)
- Modify: `docs/superpowers/specs/2026-10-13-duplicate-inspection-warning-design.md` (§16 decision 3: record the baseline)

**Interfaces:**
- Consumes: `findPossibleDuplicates`, `findPossibleDuplicatesBatch` (T9); `CANDIDATE_LIMIT`, `localityCompatible`, `MatchViewer` (T8); `apnMatchKey`, `buildMatchQuery` (T6); `findMatchCandidates` (T5); `addressKey`, `addressKeysCompatible` (T1); `db`, `inspections`.
- Produces: counts only (rows, rows with matches, pairs by reason, max per row, `rejectedByLocalityOnly`, batch count, timings). Never addresses, APNs, names or ids. SELECT only.

This task has no unit test (it is the live check of spec §12); its verification is running it.

- [ ] **Step 1: Create the script** — `scripts/duplicate-match-smoke.mts`:

```ts
// scripts/duplicate-match-smoke.mts
/**
 * Live, READ-ONLY smoke test for the possible-duplicate warning (duplicate-warning spec §12).
 * Builds each inspection's query from its own saved values, runs the real findPossibleDuplicates
 * as an admin viewer, then one findPossibleDuplicatesBatch over every row, and counts address
 * candidates rejected ONLY by the locality rule. Never writes anything.
 *
 * Prints COUNTS ONLY — never addresses, APNs, names or ids.
 *
 * Usage: npm run smoke:matches   (needs DATABASE_URL in .env.local)
 * Reference (spec §5.6, earlier rule set): 133 rows, 17 with matches, max 2 per row.
 */

import { asc, sql } from "drizzle-orm";
import { db } from "../src/lib/db";
import { inspections } from "../src/lib/db/schema";
import { findPossibleDuplicates, findPossibleDuplicatesBatch } from "../src/lib/inspection-matches/find";
import { CANDIDATE_LIMIT, localityCompatible, type MatchViewer } from "../src/lib/inspection-matches/match";
import { apnMatchKey, buildMatchQuery } from "../src/lib/inspection-matches/normalize";
import { findMatchCandidates } from "../src/lib/inspection-matches/store";
import { addressKey, addressKeysCompatible } from "../src/lib/prefill/address-key";

const ADMIN: MatchViewer = { userId: "00000000-0000-4000-8000-000000000000", privileged: true };

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is missing — set it in .env.local");
    process.exit(1);
  }

  const rows = await db
    .select({
      id: inspections.id,
      facilityAddress: inspections.facilityAddress,
      facilityCity: inspections.facilityCity,
      facilityZip: inspections.facilityZip,
      apn: inspections.apn,
      formApn: sql<string | null>`${inspections.formData} -> 'facilityInfo' ->> 'taxParcelNumber'`,
    })
    .from(inspections)
    .orderBy(asc(inspections.createdAt));

  const queries = rows.map((row) => ({
    row,
    query: buildMatchQuery({
      facilityAddress: row.facilityAddress ?? "",
      facilityCity: row.facilityCity ?? "",
      facilityZip: row.facilityZip ?? "",
      // The same form-first fallback the stored side uses (spec §5.1)
      taxParcelNumber: apnMatchKey(row.formApn) ? (row.formApn ?? "") : (row.apn ?? ""),
    }),
  }));

  let withQuery = 0;
  let withMatches = 0;
  let maxPerRow = 0;
  const pairs = { both: 0, apn: 0, address: 0 };
  let rejectedByLocalityOnly = 0;
  const started = Date.now();
  for (const { row, query } of queries) {
    if (!query) continue;
    withQuery += 1;
    const result = await findPossibleDuplicates(query, ADMIN, { excludeInspectionId: row.id, limit: CANDIDATE_LIMIT });
    if (result.matches.length > 0) withMatches += 1;
    maxPerRow = Math.max(maxPerRow, result.matches.length);
    for (const match of result.matches) {
      if (match.reasons.length === 2) pairs.both += 1;
      else if (match.reasons[0] === "apn") pairs.apn += 1;
      else pairs.address += 1;
    }

    if (query.address) {
      const { rows: candidates } = await findMatchCandidates({
        houseNumbers: [query.address.number],
        apnKeys: [],
        excludeInspectionId: row.id,
        limit: CANDIDATE_LIMIT,
      });
      for (const candidate of candidates) {
        const stored = addressKey(candidate.facilityAddress ?? "");
        if (stored && addressKeysCompatible(query.address, stored) && !localityCompatible(query, candidate)) {
          rejectedByLocalityOnly += 1;
        }
      }
    }
  }
  const totalMs = Date.now() - started;

  const batchStarted = Date.now();
  const batch = await findPossibleDuplicatesBatch(
    queries.map(({ row, query }) => ({ key: row.id, query, excludeWorkizJobIds: [] })),
    ADMIN,
    { limit: CANDIDATE_LIMIT },
  );
  const batchMs = Date.now() - batchStarted;
  // The batch has no self-exclusion (the picker has no inspection yet): drop each row's own match
  let batchWithMatches = 0;
  for (const [id, result] of batch) {
    if (result.matches.some((match) => match.inspectionId !== id)) batchWithMatches += 1;
  }

  console.log(`rows: ${rows.length} · with a usable query: ${withQuery}`);
  console.log(`rows with matches: ${withMatches} · max matches per row: ${maxPerRow}`);
  console.log(`directed pairs — apn+address: ${pairs.both} · apn only: ${pairs.apn} · address only: ${pairs.address}`);
  console.log(`rejectedByLocalityOnly (directed): ${rejectedByLocalityOnly}`);
  console.log(`batch rows with matches (self excluded): ${batchWithMatches}`);
  console.log(`total ${totalMs} ms (per-row checks) · batch ${batchMs} ms`);
  process.exit(0);
}

main().catch((err: unknown) => {
  // Class name only: a Drizzle error message carries query params
  console.error(`smoke failed: ${err instanceof Error ? err.name : "unknown"}`);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script** — in `package.json`, change the `smoke:workiz` line to end with a comma and add after it:

```json
    "smoke:matches": "NODE_OPTIONS=--conditions=react-server tsx --env-file=.env.local scripts/duplicate-match-smoke.mts"
```

- [ ] **Step 3: Run it (read-only)**

Run: `npm run smoke:matches`
Expected (measured during planning on 2026-10-13; small drift is normal as reports are added):

```
rows: 133 · with a usable query: 129
rows with matches: 15 · max matches per row: 2
directed pairs — apn+address: 14 · apn only: 4 · address only: 0
rejectedByLocalityOnly (directed): 0
batch rows with matches (self excluded): 15
total ~40000 ms (per-row checks) · batch ~350 ms
```

The per-row total is dominated by network round trips (about 260 sequential SELECTs); the batch line is the picker's real cost. Confirm the output contains only counts. `batch rows with matches` must equal `rows with matches`; a difference means the batch path and the single path disagree (a bug).

- [ ] **Step 4: Record the baseline** — in the spec, append to §16 decision 3 (after "…replacing the earlier-rule figures of §5.6."):

```markdown
   **Baseline (first `npm run smoke:matches` on the shipped code, <date>):** <rows> rows, <with matches> with matches, max <n> per row; directed pairs apn+address <a>, apn only <b>, address only <c>; `rejectedByLocalityOnly` <r>.
```

filled with the numbers Step 3 printed. If `rejectedByLocalityOnly` is a meaningful share of address candidates, flag it to the owner (spec §12).

- [ ] **Step 5: Lint** — Biome skips `.mts`; type-check the script instead:

Run: `npx tsc --noEmit 2>&1 | grep duplicate-match-smoke`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add scripts/duplicate-match-smoke.mts package.json docs/superpowers/specs/2026-10-13-duplicate-inspection-warning-design.md
git commit -m "chore(dup-warning): read-only live smoke and recorded baseline

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task T16: Full verification

**Files:** none changed (fix-forward only if a gate fails, in the task that owns the file, with its own commit).

- [ ] **Step 1: Full test suite**

Run: `npx vitest run 2>&1 | tail -40`
Expected: `Tests  12 failed | … passed`, and the failing tests are exactly the 12 baseline ones (rbac.test.ts 1, inspections/[id]/download route 2, inspections/[id]/reopen route 2, layout mobile-nav 1, layout nav 2, lib/validators inspection.test.ts 2, types roles.test.ts 1, lib/constants inspection.test.ts 1). Any other failure is a regression: fix it.

- [ ] **Step 2: Type-check — no new errors**

Run: `npx tsc --noEmit 2>&1 | grep "error TS" | sed 's/(.*//' | sort | uniq -c`
Expected: exactly these counts (all pre-existing):

```
   4 src/__tests__/security/auth-bypass.test.ts
   8 src/__tests__/security/file-upload.test.ts
  10 src/__tests__/security/helpers.ts
   2 src/__tests__/security/input-validation.test.ts
  27 src/app/api/inspections/[id]/media/__tests__/route.test.ts
   2 src/lib/pdf/__tests__/cesspool-integration.test.ts
  12 src/lib/pdf/__tests__/field-mapping.test.ts
   2 src/lib/pdf/__tests__/generate-report.test.ts
```

- [ ] **Step 3: Lint every changed file**

Run:

```bash
npx biome lint $(git diff --name-only main...HEAD -- '*.ts' '*.tsx')
```

Expected: only the 3 pre-existing findings in `src/components/inspection/step-facility-info.tsx` (`noLabelWithoutControl` ×1, `useExhaustiveDependencies` ×2). No other findings.

- [ ] **Step 4: Production build**

Run:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=placeholder NEXT_PUBLIC_APP_URL=http://localhost:3000 NEXT_PUBLIC_SITE_URL=http://localhost:3000 npx next build
```

Expected: build succeeds; `.next/server/app/api/inspections/[id]/matches/route.js` exists.

- [ ] **Step 5: Security self-check (read the diff)**

Run: `git diff main...HEAD -- src ':!**/__tests__/**' | grep -nE "dangerouslySetInnerHTML|console\.(log|error)\(.*err\b|params\)|\.message"`
Expected: no output (only `logDbError` logs DB failures; no error text in responses).

- [ ] **Step 6: Confirm scope and cleanliness**

Run: `git status --short` and `git log --oneline main..HEAD`
Expected: only `CLAUDE.md` may show as modified (never staged); one commit per task T1–T15 on top of the spec and plan commits. Nothing pushed.

No push and no deploy: the preview deployment, end-to-end Playwright pass and cleanup of spec §12 are run by the orchestrator after this plan completes.

---

## Self-Review (spec coverage)

| Spec item | Task |
|---|---|
| §1 small changes 1–2 (`splitUnit` move, `STREET_SUFFIXES` export) | T1 |
| §1 small change 3 (`inspectionPath`, picker wrapper) | T2, T14 |
| §1 small change 4 (`logDbError` prefix) | T3 |
| §1 small changes 5, 5a (summary `zip`/`apnHint`, `WORKIZ_CF` leaf) | T4 |
| §1 small change 6, §6.2 (jobs route additions) | T12 |
| §2.1 wizard/review notice, placement, key-change clearing, read-only links | T10, T13 |
| §2.2 picker block, failure line, Import never disabled | T10, T14 |
| §2.3 exact copy constants | T10 |
| §5.1–§5.5 matching rules and every example row | T1, T6, T8 |
| §5.4 ranking, limits, batch overflow, exclusions | T8, T9 |
| §6.1 route contract (UUID 404, auth, strict body, per-field ignore, no-store, 500) | T11 |
| §6.3 wire types | T6, T12 |
| §7.1 single SELECT, superset prefilter, parameterised, server-only | T5 |
| §8 no-leak split, link targets, draft deviation | T8, T11, T12 |
| §9.1–§9.4 components and integrations | T10, T13, T14 |
| §10 error handling and PII-safe logging | T3, T11, T12 |
| §12 unit tests, live smoke, verification gates | T1–T16 |
| §16 decision 3 baseline | T15 |

Deliberate refinement: the single-anchor layout additionally requires `!truncated` (T10) so the "more matches" line never sits inside a link; with today's data `truncated` is unreachable for a single match.
