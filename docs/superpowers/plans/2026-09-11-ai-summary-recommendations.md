# AI-Drafted Summary Recommendations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an admin opens **Generate summary link**, the Recommendations textarea is pre-drafted by Claude from the inspection's tank/drainfield comments, deficiency flags and condition ratings — brief, customer-facing, editable, with a Regenerate button.

**Architecture:** A pure context builder strips the stored `formData` JSON down to the non-PII fields the model needs; `draftRecommendations()` calls `claude-sonnet-4-6` through the existing bare `new Anthropic()` pattern and post-processes the output into ≤ 5 `•` lines / ≤ 80 words. A new `POST /api/inspections/[id]/draft-recommendations` route (admin/office_staff only, 5/hour/inspection) wraps it. `GenerateSummaryDialog` auto-calls the route when no saved recommendation exists, shows a skeleton while drafting, and gets a Regenerate button guarded by a confirm when the textarea has edits.

**Tech Stack:** Next.js 16.1 App Router, React 19, TypeScript, `@anthropic-ai/sdk` 0.78, Drizzle ORM, Supabase Auth, shadcn/ui + `lucide-react`, Vitest 4 + jsdom + `@testing-library/react` + `@testing-library/user-event`.

Spec: `docs/superpowers/specs/2026-09-11-ai-summary-recommendations-design.md`.

## Global Constraints

- **Model id:** `claude-sonnet-4-6` (undated alias — never append a date suffix), `max_tokens: 300`, called via a module-level `const anthropic = new Anthropic();` exactly like `src/lib/ai/rewrite-comments.ts`. `ANTHROPIC_API_KEY` comes from the environment; never hardcode it.
- **Output contract:** plain text, every line prefixed `• `, max 5 lines, max 80 words (server-side truncation), fallback line when nothing actionable: `• System functioned normally at the time of inspection. Continue routine pumping every 3–5 years.`
- **No PII to the model:** only `septicTank.septicTankComments`, `disposalWorks.disposalWorksComments`, `facilityInfo.cesspoolComments`, per-tank `deficiency*` booleans and `compromisedTank`, `facilityInfo.septicTankCondition` / `disposalWorksCondition` / `alternativeSystemCondition`, `septicTank.tanksPumped`, `facilityInfo.isCesspool`. Never names, addresses, emails, phone numbers, permit numbers.
- **Route contract:** `POST /api/inspections/[id]/draft-recommendations` → `200 { recommendations: string }`; `401` unauthenticated; `403` unless role is `admin` or `office_staff` (field techs get 403 even if they own the inspection); `404` unknown inspection; `429` after 5 calls/hour/inspection (in-memory); `502 { error }` when the model call fails.
- **Dialog copy (exact strings):** skeleton `Drafting recommendations…`, failure notice `Couldn't draft — write your own or retry`, confirm `Replace your edits with a new draft?`, button label `Regenerate`.
- **Dialog behaviour:** auto-draft only when the loaded saved recommendation is empty; skeleton replaces the textarea while drafting; failure leaves the textarea editable and never blocks sending; **Generate Summary** stays disabled until the textarea has text (and while drafting).
- **Non-goals:** no change to the summary page, token, expiry, email flow, or DB schema. No migrations.
- **Branch:** `feature/ai-summary-recommendations`, cut from `main` (see Task 1 Step 1). Never push `main`; deploy (= push to `main`) only with Daniel's explicit per-deploy approval.
- **Toolchain gotchas (from `docs/superpowers/plans/2026-09-11-prefill-shared-contracts.md`):** run tests with `npx vitest run <path>` (quote paths containing `[id]` — zsh globs brackets). Do **not** run `npm run lint` / `biome --write` on touched files (repo is not Biome-formatted; edit by hand in the surrounding style). `npx tsc --noEmit` has pre-existing errors — the real type gate is `npm run build` with placeholder `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_APP_URL`. ~15 pre-existing vitest failures live in untouched files (nav/roles/rbac, review-actions, reopen/download routes, inspection.test) — the bar is "no new failures". If `node_modules` lacks `tus-js-client` / `@googlemaps/js-api-loader`, run `npm install`.
- **jsdom + Anthropic SDK:** `new Anthropic()` throws "running in a browser-like environment" under jsdom, so any test that imports a module constructing the client must `vi.mock("@anthropic-ai/sdk", ...)` (lib test) or mock the whole AI module (route test). Existing precedent: `src/lib/ai/__tests__/parse-inspection-form.test.ts`, `src/__tests__/security/rate-limiting.test.ts`.
- **Commits:** end every commit message with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` plus your session's `Claude-Session:` trailer.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/ai/draft-recommendations.ts` (create) | `buildRecommendationContext(formData)` — PII-free context from stored JSON; `hasActionableInput(ctx)`; `formatRecommendationInput(ctx)` — deterministic user message; `normalizeRecommendations(raw)` — bullet/line/word post-processing + fallback; `draftRecommendations(ctx)` — the model call. |
| `src/lib/ai/__tests__/draft-recommendations.test.ts` (create) | Unit tests for all of the above with the SDK mocked. |
| `src/app/api/inspections/[id]/draft-recommendations/route.ts` (create) | POST handler: auth → role → load inspection → rate limit → draft. |
| `src/app/api/inspections/[id]/draft-recommendations/__tests__/route.test.ts` (create) | 401 / 403 / 404 / 429 / 502 / 200 shape. |
| `src/components/dashboard/generate-summary-dialog.tsx` (modify) | Auto-draft on open, skeleton, failure notice, Regenerate + confirm. |
| `src/components/dashboard/__tests__/generate-summary-dialog.test.tsx` (create) | Dialog behaviour tests with `fetch` stubbed. |

Existing files consulted but **not** modified: `src/lib/ai/rewrite-comments.ts` (prompt/client style), `src/app/api/inspections/[id]/rewrite-comments/route.ts` (rate limiter), `src/app/api/inspections/[id]/generate-summary/route.ts` (role check via `getUserRole`), `src/lib/supabase/auth-helpers.ts` (`getUserRole`), `src/lib/validators/inspection.ts` (field names), `src/components/inspection/step-septic-tank.tsx` (`TANK_DEFICIENCY_ITEMS` labels, duplicated as a plain array because that file is a client component).

---

### Task 1: Context builder + prompt input formatter (PII-safe)

**Files:**
- Create: `src/lib/ai/draft-recommendations.ts`
- Test: `src/lib/ai/__tests__/draft-recommendations.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks. Reads the raw `formData` JSON shape defined by `inspectionFormSchema` in `src/lib/validators/inspection.ts` (`facilityInfo.*`, `septicTank.*`, `septicTank.tanks[].*`, `disposalWorks.*`).
- Produces (used by Tasks 2 and 3):
  - `interface RecommendationTankContext { compromisedTank: string; deficiencies: string[] }`
  - `interface RecommendationContext { septicTankComments: string; disposalWorksComments: string; cesspoolComments: string; isCesspool: string; tanksPumped: string; septicTankCondition: string; disposalWorksCondition: string; alternativeSystemCondition: string; tanks: RecommendationTankContext[] }`
  - `buildRecommendationContext(formData: unknown): RecommendationContext`
  - `hasActionableInput(ctx: RecommendationContext): boolean`
  - `formatRecommendationInput(ctx: RecommendationContext): string`

- [ ] **Step 1: Create the feature branch from `main`**

The spec is committed only on `feature/property-records-prefill` (`675f06a`); this plan file may still be an uncommitted working-tree file there. Bring both docs onto the new branch so it is self-describing. The repo has unrelated uncommitted prefill work (`CLAUDE.md`, `src/lib/db/migrations/0011_jobs_rls_and_bucket.sql`) — leave it alone; untracked/modified files simply travel with the working tree across the checkout.

```bash
cd /Users/danielendres/InspectionFromfiller
git checkout main
git checkout -b feature/ai-summary-recommendations
git checkout feature/property-records-prefill -- \
  docs/superpowers/specs/2026-09-11-ai-summary-recommendations-design.md
# The plan is either committed on the prefill branch (checkout works) or already sitting untracked in the tree
git checkout feature/property-records-prefill -- \
  docs/superpowers/plans/2026-09-11-ai-summary-recommendations.md 2>/dev/null || true
git add docs/superpowers/specs/2026-09-11-ai-summary-recommendations-design.md \
        docs/superpowers/plans/2026-09-11-ai-summary-recommendations.md
git commit -m "docs: AI summary recommendations spec + plan

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

Expected: `git log --oneline -1` shows the docs commit on `feature/ai-summary-recommendations`; `git status` shows only the pre-existing unrelated changes (`CLAUDE.md`, the 0011 migration), nothing under `docs/superpowers/`.

If you would rather not disturb the prefill checkout, use a worktree instead (`git worktree add ../InspectionFromfiller-ai-recs -b feature/ai-summary-recommendations main`, copy the two docs in, then `npm install` there before running any tests).

- [ ] **Step 2: Write the failing tests**

Create `src/lib/ai/__tests__/draft-recommendations.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildRecommendationContext,
  formatRecommendationInput,
  hasActionableInput,
  type RecommendationContext,
} from "@/lib/ai/draft-recommendations";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Strings that must never reach the model */
const PII_STRINGS = [
  "Jane Seller",
  "123 Main St",
  "Inspector Bob",
  "Jane's House",
  "jane@example.com",
  "480-555-0100",
  "OW-17-00474",
];

/** A stored formData blob full of PII around the fields we actually want */
const PII_FORM = {
  facilityInfo: {
    facilityName: "Jane's House",
    facilityAddress: "123 Main St",
    facilityCity: "Phoenix",
    sellerName: "Jane Seller",
    sellerAddress: "123 Main St",
    inspectorName: "Inspector Bob",
    dischargeAuthPermitNo: "OW-17-00474",
    isCesspool: "no",
    cesspoolComments: "",
    septicTankCondition: "operational_with_concerns",
    disposalWorksCondition: "operational",
    alternativeSystemCondition: "",
  },
  septicTank: {
    tanksPumped: "yes",
    haulerCompany: "Bob's Pumping jane@example.com 480-555-0100",
    septicTankComments: "  Tank is sound.  ",
    tanks: [
      {
        tankMaterial: "precast_concrete",
        compromisedTank: "no",
        deficiencyRootInvasion: false,
        deficiencyCracks: true,
        deficiencyDamagedInlet: true,
      },
    ],
  },
  disposalWorks: {
    disposalWorksComments: "",
    printedName: "Inspector Bob",
  },
};

const EMPTY_CONTEXT: RecommendationContext = {
  septicTankComments: "",
  disposalWorksComments: "",
  cesspoolComments: "",
  isCesspool: "",
  tanksPumped: "",
  septicTankCondition: "",
  disposalWorksCondition: "",
  alternativeSystemCondition: "",
  tanks: [],
};

// ---------------------------------------------------------------------------
// buildRecommendationContext
// ---------------------------------------------------------------------------

describe("buildRecommendationContext", () => {
  it("copies only the comment, flag and condition fields (trimmed)", () => {
    expect(buildRecommendationContext(PII_FORM)).toEqual({
      septicTankComments: "Tank is sound.",
      disposalWorksComments: "",
      cesspoolComments: "",
      isCesspool: "no",
      tanksPumped: "yes",
      septicTankCondition: "operational_with_concerns",
      disposalWorksCondition: "operational",
      alternativeSystemCondition: "",
      tanks: [{ compromisedTank: "no", deficiencies: ["Cracks", "Damaged Inlet"] }],
    });
  });

  it("never includes names, addresses, emails, phone numbers or permit numbers", () => {
    const serialised = JSON.stringify(buildRecommendationContext(PII_FORM));
    for (const pii of PII_STRINGS) {
      expect(serialised).not.toContain(pii);
    }
  });

  it("returns an empty context for null, undefined or malformed form data", () => {
    expect(buildRecommendationContext(null)).toEqual(EMPTY_CONTEXT);
    expect(buildRecommendationContext(undefined)).toEqual(EMPTY_CONTEXT);
    expect(buildRecommendationContext("nope")).toEqual(EMPTY_CONTEXT);
    expect(buildRecommendationContext({ septicTank: { tanks: "not-an-array" } })).toEqual(
      EMPTY_CONTEXT,
    );
  });

  it("maps every tank deficiency checkbox to its label", () => {
    const ctx = buildRecommendationContext({
      septicTank: {
        tanks: [
          {
            deficiencyRootInvasion: true,
            deficiencyExposedRebar: true,
            deficiencyCracks: true,
            deficiencyDamagedInlet: true,
            deficiencyDamagedOutlet: true,
            deficiencyDamagedLids: true,
            deficiencyDeterioratingConcrete: true,
            deficiencyOther: true,
          },
        ],
      },
    });
    expect(ctx.tanks[0].deficiencies).toEqual([
      "Root Invasion",
      "Exposed Rebar",
      "Cracks",
      "Damaged Inlet",
      "Damaged Outlet",
      "Damaged Lids",
      "Deteriorating Concrete",
      "Other Deficiency",
    ]);
  });
});

// ---------------------------------------------------------------------------
// hasActionableInput
// ---------------------------------------------------------------------------

describe("hasActionableInput", () => {
  it("is false for an empty context", () => {
    expect(hasActionableInput(EMPTY_CONTEXT)).toBe(false);
  });

  it("is true when any comment is present", () => {
    expect(hasActionableInput({ ...EMPTY_CONTEXT, septicTankComments: "x" })).toBe(true);
    expect(hasActionableInput({ ...EMPTY_CONTEXT, disposalWorksComments: "x" })).toBe(true);
    expect(hasActionableInput({ ...EMPTY_CONTEXT, cesspoolComments: "x" })).toBe(true);
  });

  it("is true for a tank deficiency or a compromised tank", () => {
    expect(
      hasActionableInput({
        ...EMPTY_CONTEXT,
        tanks: [{ compromisedTank: "", deficiencies: ["Cracks"] }],
      }),
    ).toBe(true);
    expect(
      hasActionableInput({
        ...EMPTY_CONTEXT,
        tanks: [{ compromisedTank: "yes", deficiencies: [] }],
      }),
    ).toBe(true);
  });

  it("is true for any condition other than operational", () => {
    expect(
      hasActionableInput({ ...EMPTY_CONTEXT, septicTankCondition: "operational_with_concerns" }),
    ).toBe(true);
    expect(
      hasActionableInput({ ...EMPTY_CONTEXT, disposalWorksCondition: "not_operational" }),
    ).toBe(true);
    expect(
      hasActionableInput({ ...EMPTY_CONTEXT, alternativeSystemCondition: "not_operational" }),
    ).toBe(true);
  });

  it("is false when everything is operational and nothing else is set", () => {
    expect(
      hasActionableInput({
        ...EMPTY_CONTEXT,
        tanksPumped: "yes",
        isCesspool: "no",
        septicTankCondition: "operational",
        disposalWorksCondition: "operational",
        tanks: [{ compromisedTank: "no", deficiencies: [] }],
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// formatRecommendationInput — the exact user message sent to the model
// ---------------------------------------------------------------------------

describe("formatRecommendationInput", () => {
  it("renders the exact prompt input", () => {
    const ctx = buildRecommendationContext(PII_FORM);
    expect(formatRecommendationInput(ctx)).toBe(
      [
        "Draft the customer-facing recommendations from these inspection findings.",
        "",
        "Septic tank condition: operational with concerns",
        "Disposal works condition: operational",
        "Alternative system condition: Not specified",
        "Tanks pumped: yes",
        "Cesspool: no",
        "",
        "--- Tank 1 ---",
        "Compromised tank: no",
        "Deficiencies: Cracks, Damaged Inlet",
        "",
        "Septic tank comments:",
        "Tank is sound.",
        "",
        "Disposal works comments:",
        "(none)",
        "",
        "Cesspool comments:",
        "(none)",
      ].join("\n"),
    );
  });

  it("renders (none) placeholders and no tank blocks for an empty context", () => {
    expect(formatRecommendationInput(EMPTY_CONTEXT)).toBe(
      [
        "Draft the customer-facing recommendations from these inspection findings.",
        "",
        "Septic tank condition: Not specified",
        "Disposal works condition: Not specified",
        "Alternative system condition: Not specified",
        "Tanks pumped: Not specified",
        "Cesspool: Not specified",
        "",
        "Septic tank comments:",
        "(none)",
        "",
        "Disposal works comments:",
        "(none)",
        "",
        "Cesspool comments:",
        "(none)",
      ].join("\n"),
    );
  });

  it("contains no PII", () => {
    const text = formatRecommendationInput(buildRecommendationContext(PII_FORM));
    for (const pii of PII_STRINGS) {
      expect(text).not.toContain(pii);
    }
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/lib/ai/__tests__/draft-recommendations.test.ts`

Expected: FAIL — `Failed to resolve import "@/lib/ai/draft-recommendations"` (module does not exist yet).

- [ ] **Step 4: Write the implementation**

Create `src/lib/ai/draft-recommendations.ts`:

```ts
/** Tank deficiency checkbox → label (mirrors TANK_DEFICIENCY_ITEMS in step-septic-tank.tsx) */
const TANK_DEFICIENCY_LABELS: Array<[field: string, label: string]> = [
  ["deficiencyRootInvasion", "Root Invasion"],
  ["deficiencyExposedRebar", "Exposed Rebar"],
  ["deficiencyCracks", "Cracks"],
  ["deficiencyDamagedInlet", "Damaged Inlet"],
  ["deficiencyDamagedOutlet", "Damaged Outlet"],
  ["deficiencyDamagedLids", "Damaged Lids"],
  ["deficiencyDeterioratingConcrete", "Deteriorating Concrete"],
  ["deficiencyOther", "Other Deficiency"],
];

export interface RecommendationTankContext {
  compromisedTank: string;
  deficiencies: string[];
}

/** The only inspection data that is ever sent to the model — no names, addresses or identifiers. */
export interface RecommendationContext {
  septicTankComments: string;
  disposalWorksComments: string;
  cesspoolComments: string;
  isCesspool: string;
  tanksPumped: string;
  septicTankCondition: string;
  disposalWorksCondition: string;
  alternativeSystemCondition: string;
  tanks: RecommendationTankContext[];
}

type Loose = Record<string, unknown>;

function asObject(value: unknown): Loose {
  return value !== null && typeof value === "object" ? (value as Loose) : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Pull only the fields the model needs out of the stored `inspections.form_data` JSON.
 * Tolerates null / partial / malformed data (drafts, scanned forms) by returning empties.
 */
export function buildRecommendationContext(formData: unknown): RecommendationContext {
  const form = asObject(formData);
  const facility = asObject(form.facilityInfo);
  const septic = asObject(form.septicTank);
  const disposal = asObject(form.disposalWorks);
  const tanks = Array.isArray(septic.tanks) ? septic.tanks : [];

  return {
    septicTankComments: asString(septic.septicTankComments),
    disposalWorksComments: asString(disposal.disposalWorksComments),
    cesspoolComments: asString(facility.cesspoolComments),
    isCesspool: asString(facility.isCesspool),
    tanksPumped: asString(septic.tanksPumped),
    septicTankCondition: asString(facility.septicTankCondition),
    disposalWorksCondition: asString(facility.disposalWorksCondition),
    alternativeSystemCondition: asString(facility.alternativeSystemCondition),
    tanks: tanks.map((raw) => {
      const tank = asObject(raw);
      return {
        compromisedTank: asString(tank.compromisedTank),
        deficiencies: TANK_DEFICIENCY_LABELS.filter(([field]) => tank[field] === true).map(
          ([, label]) => label,
        ),
      };
    }),
  };
}

/** True when there is something for the model to work from; otherwise the caller returns the fallback. */
export function hasActionableInput(ctx: RecommendationContext): boolean {
  if (ctx.septicTankComments || ctx.disposalWorksComments || ctx.cesspoolComments) return true;
  if (ctx.tanks.some((tank) => tank.compromisedTank === "yes" || tank.deficiencies.length > 0)) {
    return true;
  }
  const isConcern = (condition: string) => condition !== "" && condition !== "operational";
  return (
    isConcern(ctx.septicTankCondition) ||
    isConcern(ctx.disposalWorksCondition) ||
    isConcern(ctx.alternativeSystemCondition)
  );
}

function humanize(value: string): string {
  return value ? value.replace(/_/g, " ") : "Not specified";
}

/** The user message sent to the model. Deterministic so tests can assert it exactly. */
export function formatRecommendationInput(ctx: RecommendationContext): string {
  const lines: string[] = [
    "Draft the customer-facing recommendations from these inspection findings.",
    "",
    `Septic tank condition: ${humanize(ctx.septicTankCondition)}`,
    `Disposal works condition: ${humanize(ctx.disposalWorksCondition)}`,
    `Alternative system condition: ${humanize(ctx.alternativeSystemCondition)}`,
    `Tanks pumped: ${ctx.tanksPumped || "Not specified"}`,
    `Cesspool: ${ctx.isCesspool || "Not specified"}`,
  ];

  ctx.tanks.forEach((tank, i) => {
    lines.push("", `--- Tank ${i + 1} ---`);
    lines.push(`Compromised tank: ${tank.compromisedTank || "Not specified"}`);
    lines.push(
      `Deficiencies: ${tank.deficiencies.length > 0 ? tank.deficiencies.join(", ") : "None noted"}`,
    );
  });

  lines.push("", "Septic tank comments:", ctx.septicTankComments || "(none)");
  lines.push("", "Disposal works comments:", ctx.disposalWorksComments || "(none)");
  lines.push("", "Cesspool comments:", ctx.cesspoolComments || "(none)");

  return lines.join("\n");
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/ai/__tests__/draft-recommendations.test.ts`

Expected: PASS — 12 tests (4 buildRecommendationContext, 5 hasActionableInput, 3 formatRecommendationInput).

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/draft-recommendations.ts src/lib/ai/__tests__/draft-recommendations.test.ts
git commit -m "feat(ai): PII-free recommendation context builder + prompt input

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Output post-processing + `draftRecommendations()` model call

**Files:**
- Modify: `src/lib/ai/draft-recommendations.ts` (append; add SDK import + client at top)
- Test: `src/lib/ai/__tests__/draft-recommendations.test.ts` (add SDK mock at top; append tests)

**Interfaces:**
- Consumes: `RecommendationContext`, `hasActionableInput`, `formatRecommendationInput` from Task 1 (same file).
- Produces (used by Task 3):
  - `const FALLBACK_RECOMMENDATION = "• System functioned normally at the time of inspection. Continue routine pumping every 3–5 years."`
  - `normalizeRecommendations(raw: string): string`
  - `draftRecommendations(ctx: RecommendationContext): Promise<string>` — rejects on API failure (the route maps that to 502).

- [ ] **Step 1: Add the SDK mock and the failing tests**

In `src/lib/ai/__tests__/draft-recommendations.test.ts`, replace the first import block (the `import { describe, expect, it } from "vitest";` line and the import from `@/lib/ai/draft-recommendations`) with:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

// `new Anthropic()` throws under jsdom ("browser-like environment") — mock the SDK before the module loads
const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

import {
  buildRecommendationContext,
  draftRecommendations,
  FALLBACK_RECOMMENDATION,
  formatRecommendationInput,
  hasActionableInput,
  normalizeRecommendations,
  type RecommendationContext,
} from "@/lib/ai/draft-recommendations";

/** Build a minimal Anthropic Messages response carrying one text block */
function mockResponse(text: string) {
  return { content: [{ type: "text", text }] };
}

beforeEach(() => {
  mockCreate.mockReset();
});
```

Then append at the end of the file:

```ts
// ---------------------------------------------------------------------------
// normalizeRecommendations — post-processing of model output
// ---------------------------------------------------------------------------

describe("normalizeRecommendations", () => {
  it("normalises -, *, numbered and existing bullets to •", () => {
    expect(
      normalizeRecommendations("- Tank is sound.\n* Replace baffle.\n1. Re-inspect.\n•  Pump."),
    ).toBe("• Tank is sound.\n• Replace baffle.\n• Re-inspect.\n• Pump.");
  });

  it("drops blank lines and surrounding whitespace", () => {
    expect(normalizeRecommendations("\n  • A  \n\n\n• B\n")).toBe("• A\n• B");
  });

  it("keeps at most 5 lines", () => {
    expect(normalizeRecommendations("1\n2\n3\n4\n5\n6\n7")).toBe("• 1\n• 2\n• 3\n• 4\n• 5");
  });

  it("truncates to 80 words across lines", () => {
    const seventyNine = Array.from({ length: 79 }, () => "a").join(" ");
    expect(normalizeRecommendations(`${seventyNine}\nb c d`)).toBe(`• ${seventyNine}\n• b`);

    const hundred = Array.from({ length: 100 }, (_, i) => `w${i + 1}`).join(" ");
    const out = normalizeRecommendations(hundred);
    expect(out.startsWith("• w1 ")).toBe(true);
    expect(out.endsWith(" w80")).toBe(true);
    expect(out).not.toContain("w81");
  });

  it("returns the fallback line when nothing is left", () => {
    expect(normalizeRecommendations("")).toBe(FALLBACK_RECOMMENDATION);
    expect(normalizeRecommendations("   \n \t \n")).toBe(FALLBACK_RECOMMENDATION);
    expect(normalizeRecommendations("- \n• ")).toBe(FALLBACK_RECOMMENDATION);
  });
});

// ---------------------------------------------------------------------------
// draftRecommendations — the model call
// ---------------------------------------------------------------------------

describe("draftRecommendations", () => {
  const ctx: RecommendationContext = {
    ...EMPTY_CONTEXT,
    septicTankComments: "Inlet baffle is deteriorated.",
    tanks: [{ compromisedTank: "no", deficiencies: ["Damaged Inlet"] }],
  };

  it("calls claude-sonnet-4-6 with a cached system prompt and the formatted input", async () => {
    mockCreate.mockResolvedValueOnce(mockResponse("• Replace the inlet baffle."));

    await draftRecommendations(ctx);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const args = mockCreate.mock.calls[0][0];
    expect(args.model).toBe("claude-sonnet-4-6");
    expect(args.max_tokens).toBe(300);
    expect(args.system).toHaveLength(1);
    expect(args.system[0].type).toBe("text");
    expect(args.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(args.system[0].text).toContain("Start every line with \"• \"");
    expect(args.messages).toEqual([{ role: "user", content: formatRecommendationInput(ctx) }]);
  });

  it("normalises the model output", async () => {
    mockCreate.mockResolvedValueOnce(
      mockResponse("- Replace the inlet baffle.\n- Pump every 3–5 years."),
    );

    await expect(draftRecommendations(ctx)).resolves.toBe(
      "• Replace the inlet baffle.\n• Pump every 3–5 years.",
    );
  });

  it("returns the fallback without calling the model when there is nothing actionable", async () => {
    await expect(draftRecommendations(EMPTY_CONTEXT)).resolves.toBe(FALLBACK_RECOMMENDATION);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns the fallback when the model returns no text block", async () => {
    mockCreate.mockResolvedValueOnce({ content: [] });

    await expect(draftRecommendations(ctx)).resolves.toBe(FALLBACK_RECOMMENDATION);
  });

  it("propagates API errors to the caller", async () => {
    mockCreate.mockRejectedValueOnce(new Error("overloaded"));

    await expect(draftRecommendations(ctx)).rejects.toThrow("overloaded");
  });

  it("never sends names, addresses or identifiers to the model", async () => {
    mockCreate.mockResolvedValueOnce(mockResponse("• Fine."));

    await draftRecommendations(buildRecommendationContext(PII_FORM));

    const sent = JSON.stringify(mockCreate.mock.calls[0][0]);
    for (const pii of PII_STRINGS) {
      expect(sent).not.toContain(pii);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `npx vitest run src/lib/ai/__tests__/draft-recommendations.test.ts`

Expected: 23 tests, **11 failed / 12 passed** — the Task 1 tests still pass; every `normalizeRecommendations` test fails with `TypeError: normalizeRecommendations is not a function` and every `draftRecommendations` test with `TypeError: draftRecommendations is not a function` (Vitest's ESM transform turns the missing named exports into `undefined` rather than failing the import).

- [ ] **Step 3: Write the implementation**

At the very top of `src/lib/ai/draft-recommendations.ts` (before `TANK_DEFICIENCY_LABELS`) add:

```ts
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();
```

Then append at the end of the file:

```ts
export const FALLBACK_RECOMMENDATION =
  "• System functioned normally at the time of inspection. Continue routine pumping every 3–5 years.";

const MAX_LINES = 5;
const MAX_WORDS = 80;

const SYSTEM_PROMPT = `You write the "Recommendations" box on a customer-facing septic inspection summary page for an Arizona septic company. The reader is a home buyer or seller, not an inspector.

You are given the inspector's field comments, flagged deficiencies and overall condition ratings from an ADEQ GWS 432 Property Transfer Inspection.

Rules:
- Output 2 to 5 short lines and nothing else — no heading, no intro, no closing sentence
- Start every line with "• "
- Keep the whole response under 60 words
- Present tense, plain language; no jargon, no ADEQ section numbers, no pricing
- Lead with what the customer should do; most important item first
- Do not start lines with "We recommend" or "It is recommended" — state the action directly
- Use only findings present in the input; never invent findings
- If the input contains nothing actionable, output exactly this single line:
${FALLBACK_RECOMMENDATION}

Example output:
• Tank is structurally sound; pump every 3–5 years.
• Inlet baffle is deteriorated — replace before sale.
• Drainfield shows early ponding; limit water use and re-inspect in 12 months.`;

/**
 * Coerce model output into the summary-page contract: every line `• `-prefixed,
 * at most 5 lines and 80 words, fallback line when nothing usable remains.
 */
export function normalizeRecommendations(raw: string): string {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•·▪‣]+|\d+[.)])\s*/, "").trim())
    .filter((line) => line.length > 0)
    .slice(0, MAX_LINES);

  const kept: string[] = [];
  let budget = MAX_WORDS;
  for (const line of lines) {
    if (budget <= 0) break;
    const words = line.split(/\s+/);
    if (words.length <= budget) {
      kept.push(line);
      budget -= words.length;
    } else {
      kept.push(words.slice(0, budget).join(" "));
      budget = 0;
    }
  }

  if (kept.length === 0) return FALLBACK_RECOMMENDATION;
  return kept.map((line) => `• ${line}`).join("\n");
}

/**
 * Draft customer-facing recommendations from the inspection context using Claude.
 * Skips the model entirely when there is nothing actionable. Throws on API failure.
 */
export async function draftRecommendations(ctx: RecommendationContext): Promise<string> {
  if (!hasActionableInput(ctx)) return FALLBACK_RECOMMENDATION;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 300,
    // cache_control is a silent no-op below Sonnet 4.6's 1024-token minimum; kept so the
    // prompt caches automatically if it grows (expect cache_read_input_tokens: 0 today).
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: formatRecommendationInput(ctx) }],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  const text = textBlock && textBlock.type === "text" ? textBlock.text : "";
  return normalizeRecommendations(text);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/ai/__tests__/draft-recommendations.test.ts`

Expected: PASS — 23 tests (12 from Task 1 + 5 normalizeRecommendations + 6 draftRecommendations).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/draft-recommendations.ts src/lib/ai/__tests__/draft-recommendations.test.ts
git commit -m "feat(ai): draftRecommendations via claude-sonnet-4-6 with bullet/word post-processing

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `POST /api/inspections/[id]/draft-recommendations` route

**Files:**
- Create: `src/app/api/inspections/[id]/draft-recommendations/route.ts`
- Test: `src/app/api/inspections/[id]/draft-recommendations/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `buildRecommendationContext(formData: unknown): RecommendationContext` and `draftRecommendations(ctx): Promise<string>` from `@/lib/ai/draft-recommendations` (Tasks 1–2); `getUserRole(supabase)` from `@/lib/supabase/auth-helpers`; `createClient()` from `@/lib/supabase/server`; `db` + `inspections` from `@/lib/db` / `@/lib/db/schema`.
- Produces (used by Tasks 4–5): `POST /api/inspections/{id}/draft-recommendations` with an empty body → `200 { recommendations: string }` | `401` | `403` | `404` | `429 { error }` | `502 { error }`.

- [ ] **Step 1: Write the failing tests**

Create `src/app/api/inspections/[id]/draft-recommendations/__tests__/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted so the factories below can reference them
// ---------------------------------------------------------------------------

const { mockGetUser, mockGetSession, mockCreateClient, mockDbSelect, mockBuildContext, mockDraft } =
  vi.hoisted(() => {
    const mockGetUser = vi.fn();
    const mockGetSession = vi.fn();
    const mockDbSelect = vi.fn();
    const mockBuildContext = vi.fn();
    const mockDraft = vi.fn();
    const mockCreateClient = vi.fn().mockResolvedValue({
      auth: { getUser: mockGetUser, getSession: mockGetSession },
    });
    return { mockGetUser, mockGetSession, mockCreateClient, mockDbSelect, mockBuildContext, mockDraft };
  });

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));

// The AI module constructs `new Anthropic()` at import time, which throws under jsdom — mock it whole
vi.mock("@/lib/ai/draft-recommendations", () => ({
  buildRecommendationContext: mockBuildContext,
  draftRecommendations: mockDraft,
}));

vi.mock("@/lib/db", () => {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(() => mockDbSelect()),
  };
  return { db: { select: vi.fn(() => selectChain) } };
});

vi.mock("@/lib/db/schema", () => ({
  inspections: { id: "id", formData: "form_data" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ _col, val })),
}));

// ---------------------------------------------------------------------------
// Import the handler under test
// ---------------------------------------------------------------------------
import { POST } from "../route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeAccessToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64");
  return `${header}.${body}.fakesig`;
}

function makeRequest(id: string): Request {
  return new Request(`http://localhost/api/inspections/${id}/draft-recommendations`, {
    method: "POST",
  });
}

function makeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

/** The rate limiter is keyed by inspection id and lives for the whole test file — give each test its own id */
let seq = 0;
const nextId = () => `insp-${++seq}`;

const VALID_USER = { id: "user-1", email: "admin@sewertime.com" };
const FORM_DATA = { septicTank: { septicTankComments: "Tank is sound." } };
const CONTEXT = { marker: "built-context" };

function sessionWithRole(role: string | null) {
  return { data: { session: { access_token: fakeAccessToken({ user_role: role }) } } };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  mockGetUser.mockResolvedValue({ data: { user: VALID_USER } });
  mockGetSession.mockResolvedValue(sessionWithRole("admin"));
  mockDbSelect.mockResolvedValue([{ formData: FORM_DATA }]);
  mockBuildContext.mockReturnValue(CONTEXT);
  mockDraft.mockResolvedValue("• Pump every 3–5 years.");
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/inspections/[id]/draft-recommendations", () => {
  describe("Authentication & Authorization", () => {
    it("returns 401 when user is not authenticated", async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: null } });
      const id = nextId();

      const res = await POST(makeRequest(id), makeParams(id));

      expect(res.status).toBe(401);
      expect(mockDraft).not.toHaveBeenCalled();
    });

    it("returns 403 for field_tech role", async () => {
      mockGetSession.mockResolvedValueOnce(sessionWithRole("field_tech"));
      const id = nextId();

      const res = await POST(makeRequest(id), makeParams(id));

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toMatch(/admin or office staff/i);
      expect(mockDraft).not.toHaveBeenCalled();
    });

    it("returns 403 when there is no session", async () => {
      mockGetSession.mockResolvedValueOnce({ data: { session: null } });
      const id = nextId();

      const res = await POST(makeRequest(id), makeParams(id));

      expect(res.status).toBe(403);
    });

    it("allows admin role", async () => {
      const id = nextId();

      const res = await POST(makeRequest(id), makeParams(id));

      expect(res.status).toBe(200);
    });

    it("allows office_staff role", async () => {
      mockGetSession.mockResolvedValueOnce(sessionWithRole("office_staff"));
      const id = nextId();

      const res = await POST(makeRequest(id), makeParams(id));

      expect(res.status).toBe(200);
    });
  });

  describe("Inspection lookup", () => {
    it("returns 404 when the inspection does not exist", async () => {
      mockDbSelect.mockResolvedValueOnce([]);
      const id = nextId();

      const res = await POST(makeRequest(id), makeParams(id));

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toBe("Inspection not found");
      expect(mockDraft).not.toHaveBeenCalled();
    });
  });

  describe("Drafting", () => {
    it("returns { recommendations } built from the inspection's form data", async () => {
      const id = nextId();

      const res = await POST(makeRequest(id), makeParams(id));

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ recommendations: "• Pump every 3–5 years." });
      expect(mockBuildContext).toHaveBeenCalledWith(FORM_DATA);
      expect(mockDraft).toHaveBeenCalledWith(CONTEXT);
    });

    it("returns 502 when the model call fails", async () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      mockDraft.mockRejectedValueOnce(new Error("overloaded"));
      const id = nextId();

      const res = await POST(makeRequest(id), makeParams(id));

      expect(res.status).toBe(502);
      const json = await res.json();
      expect(json.error).toMatch(/couldn't draft/i);
      consoleError.mockRestore();
    });
  });

  describe("Rate limiting", () => {
    it("allows 5 drafts per inspection then returns 429", async () => {
      const id = nextId();

      for (let i = 0; i < 5; i++) {
        const res = await POST(makeRequest(id), makeParams(id));
        expect(res.status).toBe(200);
      }

      const res = await POST(makeRequest(id), makeParams(id));

      expect(res.status).toBe(429);
      const json = await res.json();
      expect(json.error).toMatch(/rate limit/i);
      expect(mockDraft).toHaveBeenCalledTimes(5);
    });

    it("tracks the limit per inspection", async () => {
      const first = nextId();
      for (let i = 0; i < 5; i++) {
        await POST(makeRequest(first), makeParams(first));
      }

      const other = nextId();
      const res = await POST(makeRequest(other), makeParams(other));

      expect(res.status).toBe(200);
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run "src/app/api/inspections/[id]/draft-recommendations/__tests__/route.test.ts"`

Expected: FAIL — `Failed to resolve import "../route"` (route file does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/app/api/inspections/[id]/draft-recommendations/route.ts`:

```ts
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { buildRecommendationContext, draftRecommendations } from "@/lib/ai/draft-recommendations";
import { db } from "@/lib/db";
import { inspections } from "@/lib/db/schema";
import { getUserRole } from "@/lib/supabase/auth-helpers";
import { createClient } from "@/lib/supabase/server";

/** Simple in-memory rate limiter: inspectionId → timestamps (same shape as rewrite-comments) */
const draftTimestamps = new Map<string, number[]>();
const MAX_DRAFTS_PER_HOUR = 5;
const ONE_HOUR_MS = 60 * 60 * 1000;

function checkRateLimit(inspectionId: string): boolean {
  const now = Date.now();
  const timestamps = draftTimestamps.get(inspectionId) ?? [];
  const recent = timestamps.filter((t) => now - t < ONE_HOUR_MS);
  if (recent.length >= MAX_DRAFTS_PER_HOUR) {
    return false;
  }
  recent.push(now);
  draftTimestamps.set(inspectionId, recent);
  return true;
}

/**
 * POST /api/inspections/[id]/draft-recommendations
 * Drafts customer-facing summary recommendations from the inspection's comments using Claude.
 * Allowed: admin or office_staff only. No request body.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = await getUserRole(supabase);
  if (role !== "admin" && role !== "office_staff") {
    return NextResponse.json({ error: "Forbidden: admin or office staff only" }, { status: 403 });
  }

  const [inspection] = await db
    .select({ formData: inspections.formData })
    .from(inspections)
    .where(eq(inspections.id, id))
    .limit(1);

  if (!inspection) {
    return NextResponse.json({ error: "Inspection not found" }, { status: 404 });
  }

  if (!checkRateLimit(id)) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Maximum 5 drafts per hour per inspection." },
      { status: 429 },
    );
  }

  try {
    const context = buildRecommendationContext(inspection.formData);
    const recommendations = await draftRecommendations(context);
    return NextResponse.json({ recommendations });
  } catch (err) {
    console.error("[draft-recommendations] AI error:", err);
    return NextResponse.json({ error: "Couldn't draft recommendations" }, { status: 502 });
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run "src/app/api/inspections/[id]/draft-recommendations/__tests__/route.test.ts"`

Expected: PASS — 10 tests.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/inspections/[id]/draft-recommendations/route.ts" \
        "src/app/api/inspections/[id]/draft-recommendations/__tests__/route.test.ts"
git commit -m "feat(api): POST /api/inspections/[id]/draft-recommendations (admin/office, 5/hr)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Dialog auto-draft, skeleton and failure notice

**Files:**
- Modify: `src/components/dashboard/generate-summary-dialog.tsx` (whole file replaced below)
- Test: `src/components/dashboard/__tests__/generate-summary-dialog.test.tsx` (create)

**Interfaces:**
- Consumes: `POST /api/inspections/{id}/draft-recommendations` → `{ recommendations }` (Task 3); existing `GET /api/inspections/{id}/generate-summary` → `{ recommendations }`.
- Produces (extended in Task 5): component state `isDrafting: boolean`, `draftError: string | null`, `requestDraft(): Promise<void>` (a `useCallback` keyed on `inspectionId`), module constant `DRAFT_ERROR_MESSAGE`. Public props of `GenerateSummaryDialog` are unchanged (`inspectionId`, `facilityAddress`, `open`, `onOpenChange`, `onSummaryGenerated`), so `src/app/(dashboard)/inspections/[id]/inspection-pdf-view.tsx` needs no change.

- [ ] **Step 1: Write the failing tests**

Create `src/components/dashboard/__tests__/generate-summary-dialog.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { GenerateSummaryDialog } from "@/components/dashboard/generate-summary-dialog";

// ── Helpers ────────────────────────────────────────────────────────────────────

type DraftResponse = { ok: boolean; recommendations?: string };

const defaultProps = {
  inspectionId: "insp-1",
  facilityAddress: "123 Main St",
  open: true,
  onOpenChange: vi.fn(),
  onSummaryGenerated: vi.fn(),
};

/**
 * Routes the dialog's fetches:
 *   GET  …/generate-summary        → { recommendations: saved }
 *   POST …/draft-recommendations   → next entry of `drafts` (last entry repeats)
 * A draft entry may be a pending promise to hold the skeleton open.
 */
function mockFetch({
  saved = "",
  drafts = [{ ok: true, recommendations: "• Default draft." }],
}: {
  saved?: string;
  drafts?: Array<DraftResponse | Promise<DraftResponse>>;
} = {}) {
  let draftIndex = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/draft-recommendations")) {
      const draft = await drafts[Math.min(draftIndex, drafts.length - 1)];
      draftIndex += 1;
      return {
        ok: draft.ok,
        json: async () => ({
          recommendations: draft.recommendations ?? "",
          error: draft.ok ? undefined : "Rate limit exceeded",
        }),
      };
    }
    if (url.endsWith("/generate-summary") && (init?.method ?? "GET") === "GET") {
      return { ok: true, json: async () => ({ recommendations: saved }) };
    }
    return { ok: true, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function draftCallCount(fetchMock: ReturnType<typeof mockFetch>): number {
  return fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/draft-recommendations"))
    .length;
}

const generateButton = () => screen.getByRole("button", { name: /generate summary/i });

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("GenerateSummaryDialog — AI draft", () => {
  it("auto-drafts when there is no saved recommendation", async () => {
    const fetchMock = mockFetch({ saved: "", drafts: [{ ok: true, recommendations: "• Pump the tank." }] });

    render(<GenerateSummaryDialog {...defaultProps} />);

    await waitFor(() =>
      expect(screen.getByLabelText("Recommendations")).toHaveValue("• Pump the tank."),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/inspections/insp-1/draft-recommendations",
      expect.objectContaining({ method: "POST" }),
    );
    expect(draftCallCount(fetchMock)).toBe(1);
    expect(generateButton()).not.toBeDisabled();
  });

  it("does not auto-draft when a saved recommendation exists", async () => {
    const fetchMock = mockFetch({ saved: "Saved text" });

    render(<GenerateSummaryDialog {...defaultProps} />);

    await waitFor(() => expect(screen.getByLabelText("Recommendations")).toHaveValue("Saved text"));
    expect(draftCallCount(fetchMock)).toBe(0);
  });

  it("shows the skeleton while drafting, then fills the textarea", async () => {
    let resolveDraft!: (value: DraftResponse) => void;
    const pending = new Promise<DraftResponse>((resolve) => {
      resolveDraft = resolve;
    });
    mockFetch({ saved: "", drafts: [pending] });

    render(<GenerateSummaryDialog {...defaultProps} />);

    expect(await screen.findByText("Drafting recommendations…")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(generateButton()).toBeDisabled();

    resolveDraft({ ok: true, recommendations: "• Pump the tank." });

    await waitFor(() =>
      expect(screen.getByLabelText("Recommendations")).toHaveValue("• Pump the tank."),
    );
    expect(screen.queryByText("Drafting recommendations…")).not.toBeInTheDocument();
    expect(generateButton()).not.toBeDisabled();
  });

  it("shows the failure notice and leaves the textarea empty and editable", async () => {
    mockFetch({ saved: "", drafts: [{ ok: false }] });
    const user = userEvent.setup();

    render(<GenerateSummaryDialog {...defaultProps} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't draft — write your own or retry",
    );
    const field = screen.getByLabelText("Recommendations");
    expect(field).toHaveValue("");
    expect(field).not.toBeDisabled();
    expect(generateButton()).toBeDisabled();

    await user.type(field, "Manual note");

    expect(field).toHaveValue("Manual note");
    expect(generateButton()).not.toBeDisabled();
  });

  it("treats an empty draft as a failure", async () => {
    mockFetch({ saved: "", drafts: [{ ok: true, recommendations: "   " }] });

    render(<GenerateSummaryDialog {...defaultProps} />);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByLabelText("Recommendations")).toHaveValue("");
    expect(generateButton()).toBeDisabled();
  });

  it("still lets the user generate the summary after a draft failure", async () => {
    const fetchMock = mockFetch({ saved: "", drafts: [{ ok: false }] });
    const user = userEvent.setup();
    const onSummaryGenerated = vi.fn();

    render(<GenerateSummaryDialog {...defaultProps} onSummaryGenerated={onSummaryGenerated} />);

    await screen.findByRole("alert");
    await user.type(screen.getByLabelText("Recommendations"), "Manual note");

    // The POST to generate-summary falls through mockFetch's default branch and returns {} —
    // override it for this one call so the dialog gets a summaryUrl back.
    fetchMock.mockImplementationOnce(async () => ({
      ok: true,
      json: async () => ({ summaryUrl: "http://localhost/summary/tok" }),
    }));
    await user.click(generateButton());

    await waitFor(() => expect(onSummaryGenerated).toHaveBeenCalledWith("http://localhost/summary/tok"));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/dashboard/__tests__/generate-summary-dialog.test.tsx`

Expected: **5 failed / 1 passed** — "auto-drafts when there is no saved recommendation" times out waiting for `• Pump the tank.`; "shows the skeleton…" fails on `findByText("Drafting recommendations…")`; "shows the failure notice…", "treats an empty draft…" and "still lets the user generate…" fail on `findByRole("alert")`. "does not auto-draft…" passes already (current code never drafts).

- [ ] **Step 3: Write the implementation**

Replace the entire contents of `src/components/dashboard/generate-summary-dialog.tsx` with:

```tsx
"use client";

import { Link2, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const DRAFT_ERROR_MESSAGE = "Couldn't draft — write your own or retry";

interface GenerateSummaryDialogProps {
  inspectionId: string;
  facilityAddress: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSummaryGenerated: (summaryUrl: string) => void;
}

export function GenerateSummaryDialog({
  inspectionId,
  facilityAddress,
  open,
  onOpenChange,
  onSummaryGenerated,
}: GenerateSummaryDialogProps) {
  const [recommendations, setRecommendations] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isDrafting, setIsDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  // Ask Claude for a draft. On failure the textarea keeps whatever it had and the notice shows.
  const requestDraft = useCallback(async () => {
    setIsDrafting(true);
    setDraftError(null);
    try {
      const res = await fetch(`/api/inspections/${inspectionId}/draft-recommendations`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Draft failed");
      const data: { recommendations?: string } = await res.json();
      const draft = (data.recommendations || "").trim();
      if (!draft) throw new Error("Empty draft");
      setRecommendations(draft);
    } catch {
      setDraftError(DRAFT_ERROR_MESSAGE);
    } finally {
      setIsDrafting(false);
    }
  }, [inspectionId]);

  // Pre-populate with most recent recommendations when dialog opens; auto-draft only when there are none
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setIsGenerating(false);
    setDraftError(null);
    setIsLoading(true);

    fetch(`/api/inspections/${inspectionId}/generate-summary`)
      .then((res) => (res.ok ? res.json() : { recommendations: "" }))
      .catch(() => ({ recommendations: "" }))
      .then((data: { recommendations?: string }) => {
        if (cancelled) return;
        const saved = data.recommendations || "";
        setRecommendations(saved);
        setIsLoading(false);
        if (!saved) return requestDraft();
      });

    return () => {
      cancelled = true;
    };
  }, [open, inspectionId, requestDraft]);

  const handleGenerate = async () => {
    if (!recommendations.trim() || isGenerating) return;
    setIsGenerating(true);

    try {
      const res = await fetch(`/api/inspections/${inspectionId}/generate-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recommendations: recommendations.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to generate summary");
      }

      const { summaryUrl } = await res.json();

      toast.success("Summary page created");
      onOpenChange(false);
      onSummaryGenerated(summaryUrl);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate summary");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Link2 className="size-5" />
            Generate Inspection Summary Page
          </AlertDialogTitle>
          <AlertDialogDescription>
            Create a shareable summary page for{" "}
            <span className="font-medium text-foreground">
              {facilityAddress || "this inspection"}
            </span>
            . The customer will see status indicators, inspector comments, and your
            recommendations below.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="recommendations">Recommendations</Label>
            {isDrafting ? (
              <div
                role="status"
                aria-live="polite"
                className="space-y-2 rounded-md border border-input px-3 py-2"
              >
                <div className="h-3 w-11/12 animate-pulse rounded bg-muted" />
                <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
                <div className="h-3 w-3/5 animate-pulse rounded bg-muted" />
                <p className="pt-1 text-xs text-muted-foreground">Drafting recommendations…</p>
              </div>
            ) : (
              <Textarea
                id="recommendations"
                value={recommendations}
                onChange={(e) => setRecommendations(e.target.value)}
                placeholder="e.g., Tank replacement recommended within 12 months. Schedule drainfield repair before rainy season."
                rows={5}
              />
            )}
            {draftError && (
              <p role="alert" className="text-xs text-destructive">
                {draftError}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              These recommendations will be displayed prominently on the customer summary page.
            </p>
          </div>
        </div>

        <AlertDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isGenerating}>
            Cancel
          </Button>
          <Button
            onClick={handleGenerate}
            disabled={!recommendations.trim() || isGenerating || isDrafting}
          >
            {isGenerating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Link2 className="size-4" />
            )}
            Generate Summary
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

Notes for the implementer:
- `isLoading` is kept (it gates the Regenerate button in Task 5).
- The `cancelled` flag matters: React StrictMode double-runs effects in dev, and without it the auto-draft would fire twice and burn two of the five hourly drafts.
- The GET failure path now also auto-drafts (a missing/failed saved recommendation is "empty").

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/dashboard/__tests__/generate-summary-dialog.test.tsx`

Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/generate-summary-dialog.tsx \
        src/components/dashboard/__tests__/generate-summary-dialog.test.tsx
git commit -m "feat(dashboard): auto-draft summary recommendations with skeleton + failure notice

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Regenerate button with edit-guard confirm, then full verification

**Files:**
- Modify: `src/components/dashboard/generate-summary-dialog.tsx` (whole file replaced below)
- Test: `src/components/dashboard/__tests__/generate-summary-dialog.test.tsx` (append a `describe` block)

**Interfaces:**
- Consumes: Task 4's `requestDraft`, `isDrafting`, `isLoading`, `draftError`, `DRAFT_ERROR_MESSAGE`, and the test file's `mockFetch` / `draftCallCount` / `generateButton` / `DraftResponse` / `defaultProps` helpers.
- Produces: a `Regenerate` button (accessible name `Regenerate`) next to the label; `lastDraft: string | null` state (the last text Claude produced); `handleRegenerate()` which calls `window.confirm("Replace your edits with a new draft?")` when `recommendations.trim() !== "" && recommendations !== lastDraft`.

- [ ] **Step 1: Append the failing tests**

Append to the end of `src/components/dashboard/__tests__/generate-summary-dialog.test.tsx`:

```tsx
describe("GenerateSummaryDialog — Regenerate", () => {
  const regenerateButton = () => screen.getByRole("button", { name: /regenerate/i });

  it("asks before replacing saved text and keeps it when cancelled", async () => {
    const fetchMock = mockFetch({ saved: "Saved text" });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();

    render(<GenerateSummaryDialog {...defaultProps} />);
    await waitFor(() => expect(screen.getByLabelText("Recommendations")).toHaveValue("Saved text"));

    await user.click(regenerateButton());

    expect(confirmSpy).toHaveBeenCalledWith("Replace your edits with a new draft?");
    expect(draftCallCount(fetchMock)).toBe(0);
    expect(screen.getByLabelText("Recommendations")).toHaveValue("Saved text");
  });

  it("replaces saved text with a fresh draft when confirmed", async () => {
    const fetchMock = mockFetch({
      saved: "Saved text",
      drafts: [{ ok: true, recommendations: "• Fresh draft." }],
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();

    render(<GenerateSummaryDialog {...defaultProps} />);
    await waitFor(() => expect(screen.getByLabelText("Recommendations")).toHaveValue("Saved text"));

    await user.click(regenerateButton());

    await waitFor(() =>
      expect(screen.getByLabelText("Recommendations")).toHaveValue("• Fresh draft."),
    );
    expect(draftCallCount(fetchMock)).toBe(1);
  });

  it("regenerates an untouched AI draft without asking", async () => {
    const fetchMock = mockFetch({
      saved: "",
      drafts: [
        { ok: true, recommendations: "• First draft." },
        { ok: true, recommendations: "• Second draft." },
      ],
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();

    render(<GenerateSummaryDialog {...defaultProps} />);
    await waitFor(() =>
      expect(screen.getByLabelText("Recommendations")).toHaveValue("• First draft."),
    );

    await user.click(regenerateButton());

    await waitFor(() =>
      expect(screen.getByLabelText("Recommendations")).toHaveValue("• Second draft."),
    );
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(draftCallCount(fetchMock)).toBe(2);
  });

  it("asks before regenerating once the AI draft has been edited", async () => {
    const fetchMock = mockFetch({ saved: "", drafts: [{ ok: true, recommendations: "• First draft." }] });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();

    render(<GenerateSummaryDialog {...defaultProps} />);
    const field = await screen.findByDisplayValue("• First draft.");
    await user.type(field, " Edited.");

    await user.click(regenerateButton());

    expect(confirmSpy).toHaveBeenCalledWith("Replace your edits with a new draft?");
    expect(draftCallCount(fetchMock)).toBe(1);
    expect(field).toHaveValue("• First draft. Edited.");
  });

  it("keeps the current text and shows the notice when regenerate fails", async () => {
    mockFetch({ saved: "Saved text", drafts: [{ ok: false }] });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();

    render(<GenerateSummaryDialog {...defaultProps} />);
    await waitFor(() => expect(screen.getByLabelText("Recommendations")).toHaveValue("Saved text"));

    await user.click(regenerateButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't draft — write your own or retry",
    );
    expect(screen.getByLabelText("Recommendations")).toHaveValue("Saved text");
    expect(generateButton()).not.toBeDisabled();
  });

  it("disables Regenerate while a draft is in flight", async () => {
    let resolveDraft!: (value: DraftResponse) => void;
    const pending = new Promise<DraftResponse>((resolve) => {
      resolveDraft = resolve;
    });
    mockFetch({ saved: "", drafts: [pending] });

    render(<GenerateSummaryDialog {...defaultProps} />);

    expect(await screen.findByText("Drafting recommendations…")).toBeInTheDocument();
    expect(regenerateButton()).toBeDisabled();

    resolveDraft({ ok: true, recommendations: "• Done." });

    await waitFor(() => expect(regenerateButton()).not.toBeDisabled());
  });
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `npx vitest run src/components/dashboard/__tests__/generate-summary-dialog.test.tsx`

Expected: the 6 Task 4 tests PASS; all 6 "Regenerate" tests FAIL with `Unable to find an accessible element with the role "button" and name /regenerate/i`.

- [ ] **Step 3: Write the implementation**

Replace the entire contents of `src/components/dashboard/generate-summary-dialog.tsx` with:

```tsx
"use client";

import { Link2, Loader2, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const DRAFT_ERROR_MESSAGE = "Couldn't draft — write your own or retry";
const REGENERATE_CONFIRM_MESSAGE = "Replace your edits with a new draft?";

interface GenerateSummaryDialogProps {
  inspectionId: string;
  facilityAddress: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSummaryGenerated: (summaryUrl: string) => void;
}

export function GenerateSummaryDialog({
  inspectionId,
  facilityAddress,
  open,
  onOpenChange,
  onSummaryGenerated,
}: GenerateSummaryDialogProps) {
  const [recommendations, setRecommendations] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isDrafting, setIsDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  // The last text Claude produced — anything different in the textarea counts as a user edit
  const [lastDraft, setLastDraft] = useState<string | null>(null);

  // Ask Claude for a draft. On failure the textarea keeps whatever it had and the notice shows.
  const requestDraft = useCallback(async () => {
    setIsDrafting(true);
    setDraftError(null);
    try {
      const res = await fetch(`/api/inspections/${inspectionId}/draft-recommendations`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Draft failed");
      const data: { recommendations?: string } = await res.json();
      const draft = (data.recommendations || "").trim();
      if (!draft) throw new Error("Empty draft");
      setRecommendations(draft);
      setLastDraft(draft);
    } catch {
      setDraftError(DRAFT_ERROR_MESSAGE);
    } finally {
      setIsDrafting(false);
    }
  }, [inspectionId]);

  // Pre-populate with most recent recommendations when dialog opens; auto-draft only when there are none
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setIsGenerating(false);
    setDraftError(null);
    setLastDraft(null);
    setIsLoading(true);

    fetch(`/api/inspections/${inspectionId}/generate-summary`)
      .then((res) => (res.ok ? res.json() : { recommendations: "" }))
      .catch(() => ({ recommendations: "" }))
      .then((data: { recommendations?: string }) => {
        if (cancelled) return;
        const saved = data.recommendations || "";
        setRecommendations(saved);
        setIsLoading(false);
        if (!saved) return requestDraft();
      });

    return () => {
      cancelled = true;
    };
  }, [open, inspectionId, requestDraft]);

  const handleRegenerate = async () => {
    const hasEdits = recommendations.trim() !== "" && recommendations !== lastDraft;
    if (hasEdits && !window.confirm(REGENERATE_CONFIRM_MESSAGE)) return;
    await requestDraft();
  };

  const handleGenerate = async () => {
    if (!recommendations.trim() || isGenerating) return;
    setIsGenerating(true);

    try {
      const res = await fetch(`/api/inspections/${inspectionId}/generate-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recommendations: recommendations.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to generate summary");
      }

      const { summaryUrl } = await res.json();

      toast.success("Summary page created");
      onOpenChange(false);
      onSummaryGenerated(summaryUrl);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate summary");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Link2 className="size-5" />
            Generate Inspection Summary Page
          </AlertDialogTitle>
          <AlertDialogDescription>
            Create a shareable summary page for{" "}
            <span className="font-medium text-foreground">
              {facilityAddress || "this inspection"}
            </span>
            . The customer will see status indicators, inspector comments, and your
            recommendations below.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="recommendations">Recommendations</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleRegenerate}
                disabled={isDrafting || isLoading || isGenerating}
                className="gap-1.5"
              >
                {isDrafting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                Regenerate
              </Button>
            </div>
            {isDrafting ? (
              <div
                role="status"
                aria-live="polite"
                className="space-y-2 rounded-md border border-input px-3 py-2"
              >
                <div className="h-3 w-11/12 animate-pulse rounded bg-muted" />
                <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
                <div className="h-3 w-3/5 animate-pulse rounded bg-muted" />
                <p className="pt-1 text-xs text-muted-foreground">Drafting recommendations…</p>
              </div>
            ) : (
              <Textarea
                id="recommendations"
                value={recommendations}
                onChange={(e) => setRecommendations(e.target.value)}
                placeholder="e.g., Tank replacement recommended within 12 months. Schedule drainfield repair before rainy season."
                rows={5}
              />
            )}
            {draftError && (
              <p role="alert" className="text-xs text-destructive">
                {draftError}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              These recommendations will be displayed prominently on the customer summary page.
            </p>
          </div>
        </div>

        <AlertDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isGenerating}>
            Cancel
          </Button>
          <Button
            onClick={handleGenerate}
            disabled={!recommendations.trim() || isGenerating || isDrafting}
          >
            {isGenerating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Link2 className="size-4" />
            )}
            Generate Summary
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

Diff from Task 4, for reviewers: `Sparkles` import; `REGENERATE_CONFIRM_MESSAGE`; `lastDraft` state (set in `requestDraft` on success, reset to `null` on open); `handleRegenerate`; the label row becomes a flex row containing the `Regenerate` button. Everything else is byte-identical.

- [ ] **Step 4: Run the dialog tests to verify they pass**

Run: `npx vitest run src/components/dashboard/__tests__/generate-summary-dialog.test.tsx`

Expected: PASS — 12 tests.

- [ ] **Step 5: Run every test file this feature touches**

Run:

```bash
npx vitest run \
  src/lib/ai/__tests__/draft-recommendations.test.ts \
  "src/app/api/inspections/[id]/draft-recommendations/__tests__/route.test.ts" \
  src/components/dashboard/__tests__/generate-summary-dialog.test.tsx
```

Expected: 3 files, 45 tests, all PASS.

- [ ] **Step 6: Run the full suite and the production build**

Run: `npx vitest run 2>&1 | tail -30`

Expected: the only failures are the ~15 pre-existing ones in untouched files (nav/roles/rbac, review-actions, reopen/download routes, `inspection.test` STEP_FIELDS + tank schema). No failure may mention `draft-recommendations`, `generate-summary-dialog`, or `generate-summary`. If a previously-passing file now fails, fix it before continuing.

Run:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co \
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=placeholder \
NEXT_PUBLIC_APP_URL=http://localhost:3000 \
npm run build 2>&1 | tail -25
```

Expected: `✓ Compiled successfully` with `/api/inspections/[id]/draft-recommendations` listed among the routes, and no type errors. (Do **not** run `npm run lint` — it rewrites files.)

- [ ] **Step 7: Commit**

```bash
git add src/components/dashboard/generate-summary-dialog.tsx \
        src/components/dashboard/__tests__/generate-summary-dialog.test.tsx
git commit -m "feat(dashboard): Regenerate button for AI summary recommendations with edit guard

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 8: Manual check against real data (spec §4 "Manual")**

```bash
ls .env.local >/dev/null 2>&1 || npx vercel env pull .env.local   # needs ANTHROPIC_API_KEY + Supabase vars
rm -rf .next; lsof -ti :3000 | xargs -r kill; npm run dev
```

1. Log in as an admin, open a **finalized** inspection that has real tank/drainfield comments, click **Generate summary link**.
2. Confirm: skeleton with `Drafting recommendations…` appears, then 2–5 `•` lines land in the textarea within ~2–4 s; they read as plain-language customer guidance with no names/addresses, no pricing, no ADEQ section numbers.
3. Edit a word, click **Regenerate** → confirm prompt appears; accept → fresh draft replaces the text.
4. Click **Regenerate** four more times → the 6th call in the hour shows `Couldn't draft — write your own or retry` (429) and the previous text stays; **Generate Summary** still works.
5. Open the dialog on an inspection that already has a saved summary → its saved recommendation loads and no draft request fires (check the Network tab: no `draft-recommendations` call).
6. Open the dialog as a field tech (or hit the route with a field-tech session via curl) → 403; the dialog shows the failure notice and stays usable.

Record what you saw in the PR description. Then open the PR against `main` and stop — deployment (push to `main`) needs Daniel's explicit approval.

```bash
git push -u origin feature/ai-summary-recommendations
gh pr create --base main --title "AI-drafted summary recommendations" --body "$(cat <<'EOF'
## Summary
- New `src/lib/ai/draft-recommendations.ts`: PII-free context from `form_data`, `claude-sonnet-4-6` call, `•`-bullet / 5-line / 80-word post-processing with a fallback line
- New `POST /api/inspections/[id]/draft-recommendations`: admin/office_staff only, 5/hour/inspection in-memory limiter, `{ recommendations }`
- `GenerateSummaryDialog`: auto-drafts when no saved recommendation, skeleton while drafting, inline failure notice, Regenerate button with edit-guard confirm

## Test plan
- [ ] `npx vitest run` — no new failures (45 new tests across 3 files)
- [ ] `npm run build` passes
- [ ] Manual: finalized inspection → Generate summary link → draft appears, Regenerate + confirm, 429 notice after 5, saved recommendation skips auto-draft, field tech gets 403

No migrations. Rollback = revert.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**1. Spec coverage**

| Spec requirement | Task |
|---|---|
| §2.1 Auto-draft only when the loaded saved recommendation is empty; skeleton `Drafting recommendations…`; textarea fills when the draft arrives; nothing auto-generated if a previous recommendation exists | Task 4 (tests: "auto-drafts when there is no saved recommendation", "does not auto-draft…", "shows the skeleton…") |
| §2.2 Regenerate (sparkles icon, next to the textarea); confirm `Replace your edits with a new draft?` when the textarea has user edits | Task 5 (`Sparkles` icon; `hasEdits` guard; 4 confirm tests) |
| §2.3 Failure → inline `Couldn't draft — write your own or retry`, textarea empty and editable, never blocks sending | Task 4 ("shows the failure notice…", "still lets the user generate the summary after a draft failure"); Task 5 ("keeps the current text… when regenerate fails") |
| §2.4 Output: `•` lines, 2–5 lines, ≤ 60 words (prompt), present tense, no jargon/pricing/ADEQ numbers, no "we recommend"; fallback line when nothing actionable | Task 2 (`SYSTEM_PROMPT` rules + example; `normalizeRecommendations`; `FALLBACK_RECOMMENDATION`; `hasActionableInput` short-circuit) |
| §3 Context fields exactly as listed; no personal data | Task 1 (`buildRecommendationContext`, PII tests on context, prompt input, and the actual `messages.create` args in Task 2) |
| §3 `claude-sonnet-4-6`, bare `new Anthropic()`, `max_tokens 300`, cached system prompt, server-side ≤ 5 lines / ≤ 80 words truncate+trim | Task 2 (asserted in "calls claude-sonnet-4-6 with a cached system prompt…" and the normalise tests) |
| §3 Route mirrors rewrite-comments: JWT role check (admin \| office_staff), loads the inspection, 5/hour/inspection in-memory limiter, `{ recommendations }`, 429 / 502 | Task 3 (10 route tests incl. 401/403/404/429/502/200 shape, per-inspection limit) |
| §4 Tests: context omits PII; prompt snapshot; post-processing with mocked client; route 401/403/429/200; dialog auto-draft-only-when-empty, skeleton→filled, Regenerate-with-edits confirm, failure leaves textarea editable, Generate disabled until text | Tasks 1–5 as above; Generate-disabled asserted in Task 4 ("shows the skeleton…", "shows the failure notice…", "treats an empty draft as a failure") |
| §4 Manual check on a finalized inspection | Task 5 Step 8 |
| §5 Single small PR, no migrations, deploy with Daniel's approval, rollback = revert | Task 5 Step 8 + Global Constraints |
| Non-goals: no summary page / token / expiry / email changes; no extra storage | No task touches those files; drafts live only in component state |

Gaps: none found. One deliberate interpretation: on **Regenerate** failure the existing textarea text is kept (spec §2.3 describes the auto-draft case, where the textarea is empty anyway); the plan states and tests this.

**2. Placeholder scan** — searched for "TBD", "TODO", "implement later", "fill in", "similar to Task", "add error handling", "add validation", "handle edge cases", "write tests for": none present. Every code step shows the full file or an exact insertion with full code; every run step names the exact command and expected result.

**3. Type consistency**

- `RecommendationContext` / `RecommendationTankContext` field names are identical in Task 1's interface, Task 1's tests (`EMPTY_CONTEXT`), Task 2's tests, and `formatRecommendationInput`.
- `buildRecommendationContext(formData: unknown)` and `draftRecommendations(ctx: RecommendationContext): Promise<string>` are the names used by the route (Task 3) and mocked under the same names in the route test.
- `FALLBACK_RECOMMENDATION` is exported in Task 2 and imported by the Task 2 tests; the literal matches the spec's fallback string and the last "Rules" line of `SYSTEM_PROMPT` (interpolated, so they cannot drift).
- Route response key `recommendations` matches what `requestDraft` reads (`data.recommendations`) in Tasks 4–5 and what the dialog tests' `mockFetch` returns.
- Task 5's component is a strict superset of Task 4's (listed diff), so the Task 4 tests keep passing unchanged; the helpers Task 5's tests use (`mockFetch`, `draftCallCount`, `generateButton`, `DraftResponse`, `defaultProps`) are all defined in Task 4's test file.
- Test counts: Task 1 = 12, Task 2 adds 11 (23), Task 3 = 10, Task 4 = 6, Task 5 adds 6 (12) → 45 across the three files, matching Step 5 of Task 5.

**4. Dry run (done while writing the plan, outside the repo)** — every code block above was extracted verbatim from this file into a scratch directory wired to the project's `node_modules`, `src/` aliases and tsconfig, and run task by task: each "verify it fails" step produced the failure described, each "verify it passes" step produced the stated count (12 → 23 → 10 → 6 → 12), and `tsc --noEmit` over the six new/changed files under the project's `strict` settings reported zero errors. The `npm run build` gate and the manual check (Task 5 Steps 6 and 8) were not part of the dry run and remain for the implementer.
