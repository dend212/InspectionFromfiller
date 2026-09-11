# Property Records Prefill — Phase 3: Extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read the permit PDFs that phase 2 stored for a prefill run with Claude Sonnet 4.6 (structured output), escalate weak handwriting to Claude Opus 5, turn the extracted facts into `ProposedField[]` for every row of spec §7, persist per-record extraction status, and prove it end-to-end on two real Maricopa parcels.

**Architecture:** A pure Zod schema (`permit-extraction-schema.ts`) drives `client.messages.parse()`; `triage.ts` splits a stored PDF into a 4–6-page first pass and an optional ≤ 20-page second pass with pdf-lib; `extract-permit-facts.ts` runs the passes, merges them field-by-field (higher confidence wins), and re-asks up to three handwritten low-confidence facts on Opus 5 with a single page; `map-facts-to-fields.ts` converts `PermitFacts` into proposals; `permits/extract-records.ts` ranks the stored records, extracts at most three, persists `extracted` / `extraction_status` / `extraction_error`, and reports progress ("Reading OW-17-00474…"). Phase 2's `runPermitsStage` (and the post-selection continuation) call `extractStoredRecords` after documents are stored; the tile shows a per-record status badge.

**Tech Stack:** Next.js 16 App Router, TypeScript, zod 4.3, `@anthropic-ai/sdk` 0.78 (`messages.parse` + `zodOutputFormat` from `@anthropic-ai/sdk/helpers/zod`), pdf-lib 1.17, Drizzle over `postgres`, Supabase Storage (private bucket `inspection-media`), Vitest 4 (jsdom) + Testing Library.

**Cost note:** Sonnet 4.6 is $3 / $15 per MTok (cache write $3.75, cache read $0.30); Opus 5 is $5 / $25 per MTok (cache write $6.25, cache read $0.50). A 4-page scanned first pass is ≈ 8–12 k input tokens + ≈ 0.8 k output ≈ **$0.02–0.06 per document**; worst case (two passes + three Opus escalations) ≈ $0.15. A whole run (≤ 3 documents) is typically < $0.10. The system prompt is cached (`cache_control: { type: "ephemeral" }`); on Sonnet 4.6 caching only takes effect when the cached prefix is ≥ 1024 tokens, so the prompt is deliberately long (Task 4 asserts ≥ 4,500 characters) and the smoke script prints `cache_read_input_tokens` so you can see it working.

## SDK facts verified against `node_modules/@anthropic-ai/sdk` 0.78.0 (2026-09-11)

- `client.messages.parse(params, options)` exists (`resources/messages/messages.d.ts:52`) and returns `ParsedMessage<T>` = `Message & { parsed_output: T | null }`. `usage`, `stop_reason` are on it as on a normal `Message`.
- `zodOutputFormat(schema)` is exported from `@anthropic-ai/sdk/helpers/zod` (package `exports` includes `./helpers/*`). It calls zod 4's native `z.toJSONSchema(schema, { reused: "ref" })`, runs `transformJSONSchema` (forces `additionalProperties: false`, keeps `anyOf` for `.nullable()`, demotes `enum` / `minimum` / `maxLength` into the property `description`), and returns `{ type: "json_schema", schema, parse }` where `parse` runs `schema.safeParse` and throws `AnthropicError("Failed to parse structured output: …")` on mismatch. Verified by running it against the contracts-doc schema shape with zod 4.3.6 (peer range `^3.25.0 || ^4.0.0`).
- The request goes in `output_config: { format: zodOutputFormat(PermitFactsSchema) }` (`OutputConfig.format?: JSONOutputFormat`).
- PDF input: `{ type: "document", source: { type: "base64", media_type: "application/pdf", data }, title? }` (`DocumentBlockParam`, `Base64PDFSource`).
- `system` accepts `Array<TextBlockParam>`; `TextBlockParam.cache_control?: { type: "ephemeral" }`.
- Per-request `RequestOptions` accept `timeout`, `maxRetries`, `signal`. The SDK's own retry (default 2) fires on connection errors **and** on 408/409/429/5xx, which is broader than spec §10's "network errors only" — hence `maxRetries: 0` plus a module-level retry on `APIConnectionError` (`APIConnectionError({ message, cause })` is its constructor signature).
- Error classes are named exports of `@anthropic-ai/sdk`: `AnthropicError` ⊃ `APIError` ⊃ { `APIConnectionError` ⊃ `APIConnectionTimeoutError`, `APIUserAbortError`, `RateLimitError`, … }. `new Anthropic()` does not throw when `ANTHROPIC_API_KEY` is unset (it fails at request time) — but it **does** throw under vitest's jsdom environment ("It looks like you're running in a browser-like environment"), which is why the extraction module builds its default client lazily and tests inject a fake client.
- Model ids `claude-sonnet-4-6` and `claude-opus-5` are accepted by the `Model` type (`(string & {})` member). Opus 5 runs adaptive thinking by default, rejects `temperature`, and can return `stop_reason: "refusal"` (→ `parsed_output` null; we treat that as "no answer").

## Global Constraints

- Model ids: extraction `claude-sonnet-4-6`; escalation `claude-opus-5` (spec §6). `max_tokens 4096`. Claude timeout **90 s per call**; **one retry on network errors only** — SDK `maxRetries: 0` (its built-in retry would also retry 429/5xx) and the module retries once on `APIConnectionError` that is not a timeout (a retried 90 s timeout would blow the 240 s run budget).
- Escalation: `handwritten === true && confidence < HANDWRITING_ESCALATION_THRESHOLD (0.6)` after both passes → re-ask on Opus with **only the page it came from and the single question**; replace only if the Opus confidence is higher; **cap 3 per document**.
- Page triage: pass 1 = pages 1–4 (`edms_env`) or 1–6 (`edms_eplpav`); pass 2 = the next ≤ 20 pages, only when pass 1 found **neither** `tanks[0].capacityGal` **nor** `disposal.type`; merge field-by-field, higher confidence wins.
- Extract at most `MAX_DOCUMENTS_PER_RUN = 3` documents per run in rank order (`PERMIT` / `FINAL DA` / Discharge Authorization newest first → `PERMIT SUB` → `NOTICE OF TRANSFER` → `ABANDONMENT` → `PLAN REVIEW` / `SUB` never); documents > `MAX_DOCUMENT_BYTES` (25 MB) are skipped with a note.
- Failures (`APIError`, schema mismatch, download failure) mark **only that record** `extraction_status = "failed"` with `extraction_error`; the stage and run continue and finish `done`.
- Mapping (spec §7): `facilityInfo.isCesspool` and `facilityInfo.facilitySystemTypes` are **suggestion-only** (confidence forced ≤ 0.7 so they never cross `PREFILL_FILL_THRESHOLD = 0.75`); `capacityBasis = "permit_document"`; `designFlowBasis = "permit_documents"`; `facilityAge` = whole years since `issueDate` as a string; explanation `"Approval to construct issued MM/YYYY (permit N)"`; `sourceUrl` = `` `/api/inspections/${inspectionId}/records/${recordId}#page=${page}` ``.
- Names come **verbatim** from `docs/superpowers/plans/2026-09-11-prefill-shared-contracts.md` (`src/lib/prefill/types.ts`, `StageContext`, `StageResult`, `PermitFactsSchema`, `mapPermitFacts`, `dedupeProposals`, `InspectionRecordDTO`).
- Never modify `PATCH /api/inspections/[id]`'s body shape; never write `form_data` server-side (proposals are applied by the client hook from phase 1).
- Do **not** run `biome --write`; edit by hand in the surrounding style. Tests: `npx vitest run <path>`. Type gate: `npm run build` (with placeholder `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_APP_URL`). Acceptance: **no new failures vs. the ~15 pre-existing** vitest failures.
- Work on branch `feature/property-records-prefill`; never push `main` without Daniel's explicit per-deploy approval.
- Storage paths are bucket-relative (e.g. `records/{inspectionId}/{recordId}.pdf`), used as `createAdminClient().storage.from("inspection-media").download(storagePath)` — same convention as `src/app/api/inspections/[id]/scan/route.ts:120`.

---

## File structure

| File | Responsibility | Task |
|---|---|---|
| `src/lib/ai/permit-extraction-schema.ts` | `PermitFactsSchema` (verbatim), `PermitFacts`, `Fact<T>`, `EscalationAnswerSchema`, `emptyPermitFacts()` | 1 |
| `src/lib/ai/permit-facts-utils.ts` | Fact path registry (`FACT_SPECS`, `tankFactSpecs`), `getFactAt` / `setFactAt`, `mergePermitFacts`, `hasCoreFacts`, `rebasePages`, `coerceFactValue` | 2 |
| `src/lib/prefill/permits/triage.ts` | `planPasses`, `loadPdfDocument`, `buildSubPdf` (pdf-lib) | 3 |
| `src/lib/ai/permit-extraction-prompt.ts` | Full system prompt, per-pass user message, escalation prompts | 4 |
| `src/lib/ai/extract-permit-facts.ts` | `extractPermitFactsFromPdf` — passes, merge, escalation, usage/cost, `ExtractionError` | 5, 6 |
| `src/lib/prefill/map-facts-to-fields.ts` | `mapPermitFacts`, `dedupeProposals` (every §7 row) | 7 |
| `src/lib/prefill/permits/extract-records.ts` | `rankRecordsForExtraction` (over phase 2's `rankForExtraction`), `extractStoredRecords` (download → extract → persist → proposals → progress) | 8 |
| `src/lib/prefill/permits/with-extraction.ts` | `withExtraction` hook: reload the run's records, extract pending ones, fold proposals + summary into the stage result | 9 |
| `src/lib/prefill/permits/index.ts` + `run-dto.ts` (phase 2, modified) | `storeHits` (shared by `runPermitsStage` / `runPermitsSelection`) returns through `withExtraction`; DTO `isAbandonment` from extracted facts | 9 |
| `src/components/prefill/record-extraction-badge.tsx` + tile edit | Per-record extraction status in the Prefill sources tile | 10 |
| `scripts/prefill-extract-smoke.mts` | Live run against parcels 219-11-121 and 200-08-079 | 11 |

Test files sit next to their modules in `__tests__/` folders, matching the repo (`src/lib/ai/__tests__/parse-inspection-form.test.ts`).

## Integration contract with phases 1–2 (what this plan consumes)

From `src/lib/prefill/types.ts` (phase 1): `ProposedField`, `ProvenanceEntry`, `PrefillSource`, `PrefillStage`, `PermitArchive`, `ExtractionStatus`, `InspectionRecordDTO`, `MAX_DOCUMENTS_PER_RUN`, `MAX_DOCUMENT_BYTES`, `HANDWRITING_ESCALATION_THRESHOLD`. From `src/lib/prefill/stage.ts` (phase 1 Task 1, amendment A2): `StageContext`, `StageResult`. From `src/lib/prefill/run-store.ts` (phase 1 Task 5): `listRecordRows(runId)`, `InspectionRecordRow`. From `src/lib/prefill/run-dto.ts` (phase 1 Task 5, modified by phase 2): `toInspectionRecordDTO(row)`.

From `src/lib/db/schema.ts` (phase 1 migration 0015): `inspectionRecords` with columns `extractionStatus`, `extractionError`, `extracted`, `storagePath`, `sizeBytes`, `docDate`, `source`, `permitNumber`, `docType`.

From phase 2 (`docs/superpowers/plans/2026-09-11-prefill-phase2-permit-search-storage.md`, file map): `src/lib/prefill/permits/index.ts` exports `runPermitsStage(input, ctx, deps?)` (search → rank → `storeDocument` → returns `PermitsStageResult = StageResult & { candidates? }`) and `runPermitsSelection(input, ctx, candidateKeys, deps?)` (called by `continuePrefillAfterSelection` in `run-prefill.ts`), both ending in the internal `storeHits(...)`; `storeDocument` in `permits/fetch-document.ts` inserts each `inspection_records` row with `extraction_status` `"pending"` for the top `MAX_DOCUMENTS_PER_RUN` by `rankForExtraction` and `"skipped"` for the rest (or over-size documents); `permits/doc-types.ts` exports `classifyDocType`, `isExtractableDocType`, `rankForExtraction`, `isAbandonmentDocType`; `run-dto.ts`'s `toInspectionRecordDTO(row)` sets `isAbandonment: isAbandonmentDocType(row.docType)` and `downloadUrl` (`""` for unstored rows); `src/lib/storage/record-storage.ts` exports `RECORD_BUCKET`; `src/components/prefill/permit-records-list.tsx` (`PermitRecordsList({ run, onSelectCandidates, disabled })`) renders one `<li>` per `run.records` entry with a plain-text `statusLabel(r)` span that phase 3 replaces with a badge. Phase 3 never re-decides what phase 2 stored: it reads only records that are still `"pending"` (Task 8), hooks `storeHits`' return (Task 9) and adds a badge to the record row (Task 10).

---

### Task 1: PermitFacts schema + escalation answer schema

**Files:**
- Create: `src/lib/ai/permit-extraction-schema.ts`
- Test: `src/lib/ai/__tests__/permit-extraction-schema.test.ts`

**Interfaces:**
- Consumes: nothing project-specific (zod 4, SDK helper).
- Produces: `PermitFactsSchema`, `type PermitFacts`, `type Fact<T>`, `EscalationAnswerSchema`, `type EscalationAnswer`, `emptyPermitFacts(): PermitFacts`, `type PermitDocumentKind`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/ai/__tests__/permit-extraction-schema.test.ts
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { describe, expect, it } from "vitest";
import {
  EscalationAnswerSchema,
  PermitFactsSchema,
  emptyPermitFacts,
} from "@/lib/ai/permit-extraction-schema";

/** A Discharge Authorization as Sonnet would return it for OW-17-00474 */
export const daSample = {
  permitNumber: {
    value: "OW-17-00474",
    confidence: 0.98,
    page: 1,
    evidence: "Permit No. OW-17-00474",
    handwritten: false,
  },
  documentKind: "discharge_authorization",
  issueDate: {
    value: "2017-05-12",
    confidence: 0.95,
    page: 1,
    evidence: "Date Issued: 05/12/2017",
    handwritten: false,
  },
  finalDate: null,
  contractor: {
    value: "Desert Septic LLC",
    confidence: 0.9,
    page: 1,
    evidence: "Contractor: Desert Septic LLC",
    handwritten: false,
  },
  designFlowGpd: {
    value: 450,
    confidence: 0.96,
    page: 1,
    evidence: "Design Flow 450 gpd",
    handwritten: false,
  },
  bedrooms: {
    value: 3,
    confidence: 0.96,
    page: 1,
    evidence: "Bedrooms: 3",
    handwritten: false,
  },
  tanks: [
    {
      capacityGal: {
        value: 1250,
        confidence: 0.97,
        page: 1,
        evidence: "4.02 A314 Septic Tank Qty 1 Capacity 1250",
        handwritten: false,
      },
      material: {
        value: "precast_concrete",
        confidence: 0.85,
        page: 2,
        evidence: "Tank: precast concrete",
        handwritten: false,
      },
      model: null,
      dimensions: null,
    },
  ],
  disposal: {
    type: {
      value: "seepage_pit",
      confidence: 0.97,
      page: 1,
      evidence: "4.02 Seepage Pit Qty 2 Overall 28'0\" Effective 24'0\"",
      handwritten: false,
    },
    count: {
      value: 2,
      confidence: 0.97,
      page: 1,
      evidence: "Seepage Pit Qty 2",
      handwritten: false,
    },
    dimensions: {
      value: "Overall 28'0\" Effective 24'0\"",
      confidence: 0.95,
      page: 1,
      evidence: "Overall 28'0\" Effective 24'0\"",
      handwritten: false,
    },
    absorptionAreaSqft: null,
  },
  waterSource: {
    value: "private_well",
    confidence: 0.9,
    page: 1,
    evidence: "Water Supply: Private Well",
    handwritten: false,
  },
  isCesspool: null,
  isAbandonment: false,
  hasSitePlan: {
    value: true,
    confidence: 0.8,
    page: 3,
    evidence: "SITE PLAN (drawing)",
    handwritten: false,
  },
  systemType: {
    value: "conventional",
    confidence: 0.9,
    page: 1,
    evidence: "4.02 Conventional",
    handwritten: false,
  },
  notes: "Capacity from the General Permits Authorized table.",
};

describe("PermitFactsSchema", () => {
  it("parses a Discharge Authorization sample", () => {
    const parsed = PermitFactsSchema.parse(daSample);
    expect(parsed.tanks[0].capacityGal?.value).toBe(1250);
    expect(parsed.disposal.type?.value).toBe("seepage_pit");
    expect(parsed.documentKind).toBe("discharge_authorization");
  });

  it("parses the empty facts object", () => {
    expect(PermitFactsSchema.parse(emptyPermitFacts())).toEqual(emptyPermitFacts());
  });

  it("rejects an unknown disposal type", () => {
    const bad = {
      ...daSample,
      disposal: { ...daSample.disposal, type: { ...daSample.disposal.type, value: "leach_line" } },
    };
    expect(PermitFactsSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects evidence longer than 300 characters", () => {
    const bad = {
      ...daSample,
      permitNumber: { ...daSample.permitNumber, evidence: "x".repeat(301) },
    };
    expect(PermitFactsSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a non-positive page number", () => {
    const bad = { ...daSample, bedrooms: { ...daSample.bedrooms, page: 0 } };
    expect(PermitFactsSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects confidence above 1", () => {
    const bad = { ...daSample, bedrooms: { ...daSample.bedrooms, confidence: 1.2 } };
    expect(PermitFactsSchema.safeParse(bad).success).toBe(false);
  });
});

describe("zodOutputFormat(PermitFactsSchema)", () => {
  it("builds a strict json_schema and round-trips a sample through parse()", () => {
    const format = zodOutputFormat(PermitFactsSchema);
    expect(format.type).toBe("json_schema");
    expect(format.schema.type).toBe("object");
    expect(format.schema.additionalProperties).toBe(false);
    const parsed = format.parse(JSON.stringify(daSample));
    expect(parsed.permitNumber?.value).toBe("OW-17-00474");
  });

  it("throws on a schema mismatch", () => {
    const format = zodOutputFormat(PermitFactsSchema);
    expect(() => format.parse(JSON.stringify({ ...daSample, documentKind: "letter" }))).toThrow(
      /Failed to parse structured output/,
    );
  });
});

describe("EscalationAnswerSchema", () => {
  it("parses a found answer and a not-found answer", () => {
    expect(
      EscalationAnswerSchema.parse({
        found: true,
        value: "1200",
        confidence: 0.82,
        evidence: "Septic tank 1200 gal",
        handwritten: true,
      }).value,
    ).toBe("1200");
    expect(
      EscalationAnswerSchema.parse({
        found: false,
        value: "",
        confidence: 0,
        evidence: "",
        handwritten: false,
      }).found,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/ai/__tests__/permit-extraction-schema.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/ai/permit-extraction-schema"`.

- [ ] **Step 3: Write the schema module**

```ts
// src/lib/ai/permit-extraction-schema.ts
/**
 * Zod schema for the facts Claude extracts from a Maricopa ESD permit PDF.
 * Verbatim from docs/superpowers/plans/2026-09-11-prefill-shared-contracts.md;
 * `zodOutputFormat(PermitFactsSchema)` is what we hand to `messages.parse()`.
 */
import { z } from "zod";

const fact = <T extends z.ZodTypeAny>(v: T) =>
  z.object({
    value: v,
    confidence: z.number().min(0).max(1),
    page: z.number().int().positive(),
    evidence: z.string().max(300),
    handwritten: z.boolean(),
  });

export const PermitFactsSchema = z.object({
  permitNumber: fact(z.string()).nullable(),
  documentKind: z.enum([
    "approval_to_construct",
    "discharge_authorization",
    "final_da",
    "notice_of_transfer",
    "abandonment",
    "other",
  ]),
  issueDate: fact(z.string()).nullable(), // ISO yyyy-mm-dd
  finalDate: fact(z.string()).nullable(),
  contractor: fact(z.string()).nullable(),
  designFlowGpd: fact(z.number()).nullable(),
  bedrooms: fact(z.number().int()).nullable(),
  tanks: z.array(
    z.object({
      capacityGal: fact(z.number()).nullable(),
      material: fact(z.enum(["precast_concrete", "fiberglass", "plastic", "steel", "cast_in_place", "other"])).nullable(),
      model: fact(z.string()).nullable(),
      dimensions: fact(z.string()).nullable(),
    }),
  ),
  disposal: z.object({
    type: fact(z.enum(["trench", "bed", "chamber", "seepage_pit", "other"])).nullable(),
    count: fact(z.number().int()).nullable(),
    dimensions: fact(z.string()).nullable(),
    absorptionAreaSqft: fact(z.number()).nullable(),
  }),
  waterSource: fact(z.enum(["municipal", "private_company", "shared_well", "private_well", "hauled_water"])).nullable(),
  isCesspool: fact(z.boolean()).nullable(),
  isAbandonment: z.boolean(),
  hasSitePlan: fact(z.boolean()).nullable(),
  systemType: fact(z.enum(["conventional", "alternative"])).nullable(),
  notes: z.string().max(500),
});

export type PermitFacts = z.infer<typeof PermitFactsSchema>;
export type Fact<T> = { value: T; confidence: number; page: number; evidence: string; handwritten: boolean };
export type PermitDocumentKind = PermitFacts["documentKind"];

/**
 * Reply shape for a single-field escalation question on the stronger model.
 * `value` is always a string as written on the page; the caller coerces it
 * to the field's type (see permit-facts-utils.ts → coerceFactValue).
 */
export const EscalationAnswerSchema = z.object({
  found: z.boolean(),
  value: z.string(),
  confidence: z.number().min(0).max(1),
  evidence: z.string().max(300),
  handwritten: z.boolean(),
});

export type EscalationAnswer = z.infer<typeof EscalationAnswerSchema>;

/** A facts object with nothing found — what a pass that read nothing collapses to. */
export function emptyPermitFacts(): PermitFacts {
  return {
    permitNumber: null,
    documentKind: "other",
    issueDate: null,
    finalDate: null,
    contractor: null,
    designFlowGpd: null,
    bedrooms: null,
    tanks: [],
    disposal: { type: null, count: null, dimensions: null, absorptionAreaSqft: null },
    waterSource: null,
    isCesspool: null,
    isAbandonment: false,
    hasSitePlan: null,
    systemType: null,
    notes: "",
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/ai/__tests__/permit-extraction-schema.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/permit-extraction-schema.ts src/lib/ai/__tests__/permit-extraction-schema.test.ts
git commit -m "feat(prefill): PermitFacts zod schema + escalation answer schema"
```

---

### Task 2: Fact path utilities — merge, rebase, coerce

**Files:**
- Create: `src/lib/ai/permit-facts-utils.ts`
- Test: `src/lib/ai/__tests__/permit-facts-utils.test.ts`

**Interfaces:**
- Consumes: `PermitFacts`, `Fact<T>`, `emptyPermitFacts` (Task 1).
- Produces: `type FactValue = string | number | boolean`; `type FactKind`; `interface FactSpec { path; question; kind }`; `FACT_SPECS`; `tankFactSpecs(index)`; `allFactSpecs(facts)`; `getFactAt(facts, path)`; `setFactAt(facts, path, fact)`; `mergePermitFacts(a, b)`; `hasCoreFacts(facts)`; `rebasePages(facts, pageNumbers)`; `coerceFactValue(kind, raw)`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/ai/__tests__/permit-facts-utils.test.ts
import { describe, expect, it } from "vitest";
import { emptyPermitFacts, type PermitFacts } from "@/lib/ai/permit-extraction-schema";
import {
  allFactSpecs,
  coerceFactValue,
  getFactAt,
  hasCoreFacts,
  mergePermitFacts,
  rebasePages,
  setFactAt,
  tankFactSpecs,
} from "@/lib/ai/permit-facts-utils";

const f = <T>(value: T, confidence = 0.9, page = 1, handwritten = false) => ({
  value,
  confidence,
  page,
  evidence: `ev:${String(value)}`,
  handwritten,
});

function withTank(facts: PermitFacts, capacity: number, confidence = 0.9): PermitFacts {
  return {
    ...facts,
    tanks: [{ capacityGal: f(capacity, confidence), material: null, model: null, dimensions: null }],
  };
}

describe("fact path registry", () => {
  it("lists tank specs per tank index", () => {
    const facts = withTank(emptyPermitFacts(), 1000);
    const paths = allFactSpecs(facts).map((s) => s.path);
    expect(paths).toContain("permitNumber");
    expect(paths).toContain("disposal.type");
    expect(paths).toContain("tanks.0.capacityGal");
    expect(paths).not.toContain("tanks.1.capacityGal");
    expect(tankFactSpecs(1).map((s) => s.path)).toEqual([
      "tanks.1.capacityGal",
      "tanks.1.material",
      "tanks.1.model",
      "tanks.1.dimensions",
    ]);
  });

  it("gets and sets facts by dotted path", () => {
    const facts = withTank(emptyPermitFacts(), 1000);
    expect(getFactAt(facts, "tanks.0.capacityGal")?.value).toBe(1000);
    expect(getFactAt(facts, "disposal.type")).toBeNull();
    expect(getFactAt(facts, "tanks.4.capacityGal")).toBeNull();
    setFactAt(facts, "disposal.type", f("trench"));
    expect(facts.disposal.type?.value).toBe("trench");
    setFactAt(facts, "tanks.0.capacityGal", f(1250, 0.95));
    expect(facts.tanks[0].capacityGal?.value).toBe(1250);
  });
});

describe("mergePermitFacts", () => {
  it("keeps the higher-confidence fact per path and unions tanks", () => {
    const a = withTank({ ...emptyPermitFacts(), permitNumber: f("000972", 0.6) }, 1000, 0.5);
    const b: PermitFacts = {
      ...withTank(emptyPermitFacts(), 1200, 0.9),
      permitNumber: f("000972", 0.4),
      disposal: { ...emptyPermitFacts().disposal, type: f("seepage_pit", 0.8) },
      tanks: [
        { capacityGal: f(1200, 0.9), material: null, model: null, dimensions: null },
        { capacityGal: f(500, 0.7), material: null, model: null, dimensions: null },
      ],
    };
    const merged = mergePermitFacts(a, b);
    expect(merged.permitNumber?.confidence).toBe(0.6);
    expect(merged.tanks[0].capacityGal?.value).toBe(1200);
    expect(merged.tanks[1].capacityGal?.value).toBe(500);
    expect(merged.disposal.type?.value).toBe("seepage_pit");
  });

  it("prefers a known documentKind, ORs isAbandonment and joins notes", () => {
    const a = { ...emptyPermitFacts(), documentKind: "other" as const, notes: "first" };
    const b = { ...emptyPermitFacts(), documentKind: "abandonment" as const, isAbandonment: true, notes: "second" };
    const merged = mergePermitFacts(a, b);
    expect(merged.documentKind).toBe("abandonment");
    expect(merged.isAbandonment).toBe(true);
    expect(merged.notes).toBe("first second");
  });
});

describe("hasCoreFacts", () => {
  it("is true when a tank capacity or a disposal type exists", () => {
    expect(hasCoreFacts(emptyPermitFacts())).toBe(false);
    expect(hasCoreFacts(withTank(emptyPermitFacts(), 1000))).toBe(true);
    expect(
      hasCoreFacts({ ...emptyPermitFacts(), disposal: { ...emptyPermitFacts().disposal, type: f("bed") } }),
    ).toBe(true);
  });
});

describe("rebasePages", () => {
  it("maps sub-PDF page numbers back to the source document", () => {
    const facts: PermitFacts = {
      ...withTank(emptyPermitFacts(), 1000),
      permitNumber: f("X", 0.9, 2),
      hasSitePlan: f(true, 0.8, 3),
    };
    const rebased = rebasePages(facts, [5, 6, 7]);
    expect(rebased.permitNumber?.page).toBe(6);
    expect(rebased.hasSitePlan?.page).toBe(7);
    expect(rebased.tanks[0].capacityGal?.page).toBe(5);
    // out-of-range page from the model clamps to the last page shown
    const clamped = rebasePages({ ...facts, permitNumber: f("X", 0.9, 9) }, [5, 6, 7]);
    expect(clamped.permitNumber?.page).toBe(7);
    // does not mutate the input
    expect(facts.permitNumber?.page).toBe(2);
  });
});

describe("coerceFactValue", () => {
  it("coerces by kind and rejects junk", () => {
    expect(coerceFactValue({ type: "number" }, "1,250 gal")).toBe(1250);
    expect(coerceFactValue({ type: "integer" }, "3 bedrooms")).toBe(3);
    expect(coerceFactValue({ type: "boolean" }, "Yes")).toBe(true);
    expect(coerceFactValue({ type: "boolean" }, "maybe")).toBeNull();
    expect(coerceFactValue({ type: "enum", values: ["seepage_pit", "trench"] }, "Seepage Pit")).toBe("seepage_pit");
    expect(coerceFactValue({ type: "enum", values: ["seepage_pit", "trench"] }, "leach line")).toBeNull();
    expect(coerceFactValue({ type: "string" }, "  OW-17-00474 ")).toBe("OW-17-00474");
    expect(coerceFactValue({ type: "string" }, "   ")).toBeNull();
    expect(coerceFactValue({ type: "number" }, "n/a")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/ai/__tests__/permit-facts-utils.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/ai/permit-facts-utils"`.

- [ ] **Step 3: Write the utilities module**

```ts
// src/lib/ai/permit-facts-utils.ts
/**
 * Helpers that operate on the PermitFacts shape: a registry of every fact
 * path (used for escalation and page re-basing), a field-by-field merge of
 * two extraction passes, and coercion of a free-text escalation answer.
 */
import type { Fact, PermitFacts } from "./permit-extraction-schema";

export type FactValue = string | number | boolean;

export type FactKind =
  | { type: "string" }
  | { type: "number" }
  | { type: "integer" }
  | { type: "boolean" }
  | { type: "enum"; values: readonly string[] };

export interface FactSpec {
  /** Dotted path into PermitFacts; tanks use a numeric segment, e.g. "tanks.0.capacityGal" */
  path: string;
  /** The single question asked when this fact is escalated */
  question: string;
  kind: FactKind;
}

export const TANK_MATERIAL_VALUES = ["precast_concrete", "fiberglass", "plastic", "steel", "cast_in_place", "other"] as const;
export const DISPOSAL_TYPE_VALUES = ["trench", "bed", "chamber", "seepage_pit", "other"] as const;
export const WATER_SOURCE_VALUES = ["municipal", "private_company", "shared_well", "private_well", "hauled_water"] as const;
export const SYSTEM_TYPE_VALUES = ["conventional", "alternative"] as const;

/** Top-level (non-tank) fact specs */
export const FACT_SPECS: readonly FactSpec[] = [
  { path: "permitNumber", question: "What is the permit number printed or written on this page? Keep dashes exactly as shown.", kind: { type: "string" } },
  { path: "issueDate", question: "What is the approval / issue date on this page? Answer as an ISO date (yyyy-mm-dd).", kind: { type: "string" } },
  { path: "finalDate", question: "What is the final inspection or final discharge authorization date on this page? Answer as an ISO date (yyyy-mm-dd).", kind: { type: "string" } },
  { path: "contractor", question: "Who is the installing contractor named on this page?", kind: { type: "string" } },
  { path: "designFlowGpd", question: "What is the design flow in gallons per day on this page? Answer with digits only.", kind: { type: "number" } },
  { path: "bedrooms", question: "How many bedrooms does this page say the dwelling has? Answer with digits only.", kind: { type: "integer" } },
  { path: "disposal.type", question: "What type of disposal works does this page specify? Answer with one of: trench, bed, chamber, seepage_pit, other.", kind: { type: "enum", values: DISPOSAL_TYPE_VALUES } },
  { path: "disposal.count", question: "How many disposal units (trenches, pits or beds) does this page specify? Answer with digits only.", kind: { type: "integer" } },
  { path: "disposal.dimensions", question: "What are the disposal works dimensions exactly as written on this page?", kind: { type: "string" } },
  { path: "disposal.absorptionAreaSqft", question: "What absorption area in square feet is printed on this page? Answer with digits only.", kind: { type: "number" } },
  { path: "waterSource", question: "What is the domestic water source on this page? Answer with one of: municipal, private_company, shared_well, private_well, hauled_water.", kind: { type: "enum", values: WATER_SOURCE_VALUES } },
  { path: "isCesspool", question: "Does this page describe the system as a cesspool or cesspit? Answer true or false.", kind: { type: "boolean" } },
  { path: "hasSitePlan", question: "Is this page a site plan / plot plan / as-built drawing of the lot showing the septic system layout? Answer true or false.", kind: { type: "boolean" } },
  { path: "systemType", question: "Is the system on this page conventional or alternative? Answer with one of: conventional, alternative.", kind: { type: "enum", values: SYSTEM_TYPE_VALUES } },
];

export function tankFactSpecs(index: number): FactSpec[] {
  const p = `tanks.${index}`;
  const n = index + 1;
  return [
    { path: `${p}.capacityGal`, question: `What is the capacity in gallons of septic tank #${n} on this page? Answer with digits only.`, kind: { type: "number" } },
    { path: `${p}.material`, question: `What is septic tank #${n} made of? Answer with one of: precast_concrete, fiberglass, plastic, steel, cast_in_place, other.`, kind: { type: "enum", values: TANK_MATERIAL_VALUES } },
    { path: `${p}.model`, question: `What make or model is listed for septic tank #${n} on this page?`, kind: { type: "string" } },
    { path: `${p}.dimensions`, question: `What are the dimensions of septic tank #${n} exactly as written on this page?`, kind: { type: "string" } },
  ];
}

/** Every fact path present in `facts` (tank paths expand per tank) */
export function allFactSpecs(facts: PermitFacts): FactSpec[] {
  return [...FACT_SPECS, ...facts.tanks.flatMap((_, i) => tankFactSpecs(i))];
}

export function getFactAt(facts: PermitFacts, path: string): Fact<FactValue> | null {
  let cur: unknown = facts;
  for (const seg of path.split(".")) {
    if (cur == null || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return (cur as Fact<FactValue> | null | undefined) ?? null;
}

/** Mutates `facts`. No-op when the parent object does not exist (e.g. a tank index that is not there). */
export function setFactAt(facts: PermitFacts, path: string, fact: Fact<FactValue> | null): void {
  const segs = path.split(".");
  let cur: unknown = facts;
  for (const seg of segs.slice(0, -1)) {
    cur = (cur as Record<string, unknown>)[seg];
    if (cur == null || typeof cur !== "object") return;
  }
  (cur as Record<string, unknown>)[segs[segs.length - 1]] = fact;
}

function pickFact<T>(x: Fact<T> | null, y: Fact<T> | null): Fact<T> | null {
  if (!x) return y;
  if (!y) return x;
  return y.confidence > x.confidence ? y : x;
}

/** Field-by-field merge of two passes: the higher-confidence fact wins; tanks merge index-wise. */
export function mergePermitFacts(a: PermitFacts, b: PermitFacts): PermitFacts {
  const tankCount = Math.max(a.tanks.length, b.tanks.length);
  const tanks = Array.from({ length: tankCount }, (_, i) => {
    const ta = a.tanks[i];
    const tb = b.tanks[i];
    return {
      capacityGal: pickFact(ta?.capacityGal ?? null, tb?.capacityGal ?? null),
      material: pickFact(ta?.material ?? null, tb?.material ?? null),
      model: pickFact(ta?.model ?? null, tb?.model ?? null),
      dimensions: pickFact(ta?.dimensions ?? null, tb?.dimensions ?? null),
    };
  });
  return {
    permitNumber: pickFact(a.permitNumber, b.permitNumber),
    documentKind: a.documentKind !== "other" ? a.documentKind : b.documentKind,
    issueDate: pickFact(a.issueDate, b.issueDate),
    finalDate: pickFact(a.finalDate, b.finalDate),
    contractor: pickFact(a.contractor, b.contractor),
    designFlowGpd: pickFact(a.designFlowGpd, b.designFlowGpd),
    bedrooms: pickFact(a.bedrooms, b.bedrooms),
    tanks,
    disposal: {
      type: pickFact(a.disposal.type, b.disposal.type),
      count: pickFact(a.disposal.count, b.disposal.count),
      dimensions: pickFact(a.disposal.dimensions, b.disposal.dimensions),
      absorptionAreaSqft: pickFact(a.disposal.absorptionAreaSqft, b.disposal.absorptionAreaSqft),
    },
    waterSource: pickFact(a.waterSource, b.waterSource),
    isCesspool: pickFact(a.isCesspool, b.isCesspool),
    isAbandonment: a.isAbandonment || b.isAbandonment,
    hasSitePlan: pickFact(a.hasSitePlan, b.hasSitePlan),
    systemType: pickFact(a.systemType, b.systemType),
    notes: [a.notes, b.notes].filter(Boolean).join(" ").slice(0, 500),
  };
}

/** Spec §6: a second pass is only needed when pass 1 found neither a tank capacity nor a disposal type. */
export function hasCoreFacts(facts: PermitFacts): boolean {
  return facts.tanks[0]?.capacityGal != null || facts.disposal.type != null;
}

/**
 * The model reports pages relative to the sub-PDF it was shown. `pageNumbers[i]`
 * is the source-document page number of sub-PDF page i+1. Returns a new object.
 */
export function rebasePages(facts: PermitFacts, pageNumbers: number[]): PermitFacts {
  const out: PermitFacts = JSON.parse(JSON.stringify(facts));
  const last = pageNumbers[pageNumbers.length - 1];
  for (const spec of allFactSpecs(out)) {
    const fact = getFactAt(out, spec.path);
    if (!fact) continue;
    setFactAt(out, spec.path, { ...fact, page: pageNumbers[fact.page - 1] ?? last });
  }
  return out;
}

/** Turn an escalation answer (free text as written) into the field's value type; null when it does not fit. */
export function coerceFactValue(kind: FactKind, raw: string): FactValue | null {
  const s = raw.trim();
  if (!s) return null;
  switch (kind.type) {
    case "string":
      return s;
    case "number": {
      const n = Number(s.replace(/[^0-9.-]/g, ""));
      return Number.isFinite(n) && s.replace(/[^0-9]/g, "").length > 0 ? n : null;
    }
    case "integer": {
      const digits = s.replace(/[^0-9-]/g, "");
      const n = Number.parseInt(digits, 10);
      return Number.isFinite(n) ? n : null;
    }
    case "boolean": {
      const l = s.toLowerCase();
      if (["true", "yes", "y"].includes(l)) return true;
      if (["false", "no", "n"].includes(l)) return false;
      return null;
    }
    case "enum": {
      const l = s.toLowerCase().replace(/[\s-]+/g, "_");
      return kind.values.includes(l) ? l : null;
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/ai/__tests__/permit-facts-utils.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/permit-facts-utils.ts src/lib/ai/__tests__/permit-facts-utils.test.ts
git commit -m "feat(prefill): permit fact path registry, pass merge, page rebase, answer coercion"
```

---

### Task 3: Page triage with pdf-lib

**Files:**
- Create: `src/lib/prefill/permits/triage.ts`
- Test: `src/lib/prefill/permits/__tests__/triage.test.ts`

**Interfaces:**
- Consumes: `PermitArchive` from `src/lib/prefill/types.ts`.
- Produces: `FIRST_PASS_PAGES_ENV = 4`, `FIRST_PASS_PAGES_EPLPAV = 6`, `SECOND_PASS_MAX_PAGES = 20`; `interface TriagePlan { first: number[]; second: number[]; pageCount: number }`; `planPasses(pageCount, archive): TriagePlan`; `loadPdfDocument(bytes): Promise<PDFDocument>`; `buildSubPdf(doc, pageNumbers): Promise<Uint8Array>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/prefill/permits/__tests__/triage.test.ts
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { buildSubPdf, loadPdfDocument, planPasses } from "@/lib/prefill/permits/triage";

/** A PDF whose page N is (100+N) points wide so we can tell pages apart after copying */
async function makePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 1; i <= pages; i++) doc.addPage([100 + i, 200]);
  return new Uint8Array(await doc.save());
}

describe("planPasses", () => {
  it("uses pages 1–4 then the rest for legacy env documents", () => {
    expect(planPasses(7, "edms_env")).toEqual({ first: [1, 2, 3, 4], second: [5, 6, 7], pageCount: 7 });
  });

  it("uses pages 1–6 for ePLPAV documents and caps the second pass at 20 pages", () => {
    const plan = planPasses(54, "edms_eplpav");
    expect(plan.first).toEqual([1, 2, 3, 4, 5, 6]);
    expect(plan.second[0]).toBe(7);
    expect(plan.second).toHaveLength(20);
    expect(plan.second[19]).toBe(26);
  });

  it("has an empty second pass for short documents", () => {
    expect(planPasses(3, "edms_env")).toEqual({ first: [1, 2, 3], second: [], pageCount: 3 });
    expect(planPasses(4, "edms_env").second).toEqual([]);
  });
});

describe("buildSubPdf", () => {
  it("copies exactly the requested 1-based pages in order", async () => {
    const doc = await loadPdfDocument(await makePdf(7));
    expect(doc.getPageCount()).toBe(7);
    const sub = await PDFDocument.load(await buildSubPdf(doc, [5, 6, 7]));
    expect(sub.getPageCount()).toBe(3);
    expect(sub.getPage(0).getWidth()).toBe(105);
    expect(sub.getPage(2).getWidth()).toBe(107);
  });

  it("ignores out-of-range pages and throws when nothing is left", async () => {
    const doc = await loadPdfDocument(await makePdf(2));
    const sub = await PDFDocument.load(await buildSubPdf(doc, [1, 9]));
    expect(sub.getPageCount()).toBe(1);
    await expect(buildSubPdf(doc, [9])).rejects.toThrow(/no valid pages/);
  });

  it("rejects bytes that are not a PDF with a readable message", async () => {
    await expect(loadPdfDocument(new Uint8Array([1, 2, 3]))).rejects.toThrow(/Could not open PDF/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/prefill/permits/__tests__/triage.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/prefill/permits/triage"`.

- [ ] **Step 3: Write the triage module**

```ts
// src/lib/prefill/permits/triage.ts
/**
 * Page triage for permit extraction (spec §6). We never send a whole 50-page
 * FINAL DA to Claude: pass 1 is the typed cover pages, pass 2 (only when pass 1
 * found no tank capacity and no disposal type) is the next ≤ 20 pages.
 * pdf-lib copies page ranges into a fresh sub-PDF; no text-layer dependency.
 */
import { PDFDocument } from "pdf-lib";
import type { PermitArchive } from "../types";

export const FIRST_PASS_PAGES_ENV = 4;
export const FIRST_PASS_PAGES_EPLPAV = 6;
export const SECOND_PASS_MAX_PAGES = 20;

export interface TriagePlan {
  /** 1-based page numbers for pass 1 */
  first: number[];
  /** 1-based page numbers for pass 2 (empty when there is nothing left) */
  second: number[];
  pageCount: number;
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let p = from; p <= to; p++) out.push(p);
  return out;
}

export function planPasses(pageCount: number, archive: PermitArchive): TriagePlan {
  const firstLen = Math.min(pageCount, archive === "edms_eplpav" ? FIRST_PASS_PAGES_EPLPAV : FIRST_PASS_PAGES_ENV);
  const secondLen = Math.min(SECOND_PASS_MAX_PAGES, Math.max(0, pageCount - firstLen));
  return {
    first: range(1, firstLen),
    second: range(firstLen + 1, firstLen + secondLen),
    pageCount,
  };
}

export async function loadPdfDocument(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { ignoreEncryption: true });
  } catch (err) {
    throw new Error(`Could not open PDF: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Copies the given 1-based pages of `src` into a new PDF, in the order given. */
export async function buildSubPdf(src: PDFDocument, pageNumbers: number[]): Promise<Uint8Array> {
  const total = src.getPageCount();
  const indices = pageNumbers.map((p) => p - 1).filter((i) => i >= 0 && i < total);
  if (indices.length === 0) throw new Error("buildSubPdf: no valid pages requested");
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, indices);
  for (const page of pages) out.addPage(page);
  return new Uint8Array(await out.save());
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/prefill/permits/__tests__/triage.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/prefill/permits/triage.ts src/lib/prefill/permits/__tests__/triage.test.ts
git commit -m "feat(prefill): pdf-lib page triage for permit extraction passes"
```

---

### Task 4: System prompt and message builders

**Files:**
- Create: `src/lib/ai/permit-extraction-prompt.ts`
- Test: `src/lib/ai/__tests__/permit-extraction-prompt.test.ts` (+ generated `src/lib/ai/__tests__/__snapshots__/permit-extraction-prompt.test.ts.snap`)

**Interfaces:**
- Consumes: `FactSpec`, `FactValue` (Task 2); `PermitArchive` (types.ts).
- Produces: `PERMIT_EXTRACTION_SYSTEM_PROMPT: string`; `ESCALATION_SYSTEM_PROMPT: string`; `interface PassMessageMeta { permitNumber; docType; archive; pageNumbers: number[]; totalPages: number; pass: 1 | 2 }`; `buildPassUserMessage(meta): string`; `buildEscalationUserMessage(spec, previous: { value: FactValue; confidence: number } | null): string`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/ai/__tests__/permit-extraction-prompt.test.ts
import { describe, expect, it } from "vitest";
import {
  ESCALATION_SYSTEM_PROMPT,
  PERMIT_EXTRACTION_SYSTEM_PROMPT,
  buildEscalationUserMessage,
  buildPassUserMessage,
} from "@/lib/ai/permit-extraction-prompt";
import { FACT_SPECS } from "@/lib/ai/permit-facts-utils";

describe("PERMIT_EXTRACTION_SYSTEM_PROMPT", () => {
  it("matches the committed snapshot (prompt changes must be deliberate)", () => {
    expect(PERMIT_EXTRACTION_SYSTEM_PROMPT).toMatchSnapshot();
  });

  it("is long enough to be cached on Sonnet 4.6 (≥ 1024 tokens ≈ 4,500 chars)", () => {
    expect(PERMIT_EXTRACTION_SYSTEM_PROMPT.length).toBeGreaterThanOrEqual(4500);
  });

  it("describes the Maricopa ESD layouts, calibration, no-invention and evidence rules", () => {
    const p = PERMIT_EXTRACTION_SYSTEM_PROMPT;
    expect(p).toContain("Approval to Construct Individual Sewage Disposal System");
    expect(p).toContain("General Permits Authorized");
    expect(p).toContain("4.02 A314 Septic Tank Qty 1 Capacity 1250");
    expect(p).toContain("Seepage Pit Qty 2 Overall 28'0\" Effective 24'0\"");
    expect(p).toContain("Inspection Measurements");
    expect(p).toContain("Notice of Transfer");
    expect(p).toContain("CivicPlus");
    expect(p).toMatch(/0\.95.*typed/i);
    expect(p).toMatch(/0\.70.*0\.84/);
    expect(p).toContain("0.50 to 0.69");
    expect(p).toContain("Never invent a value");
    expect(p).toContain("verbatim quote");
    expect(p).toContain("1-based page number");
    expect(p).toContain("isCesspool");
    expect(p).toContain("isAbandonment");
    // no template-literal hazards leaked into the text
    expect(p).not.toContain("${");
    expect(p).not.toContain("`");
  });
});

describe("buildPassUserMessage", () => {
  const base = {
    permitNumber: "OW-17-00474",
    docType: "PERMIT",
    archive: "edms_env" as const,
    totalPages: 7,
  };

  it("names the page range, archive and EDMS metadata for pass 1", () => {
    const text = buildPassUserMessage({ ...base, pageNumbers: [1, 2, 3, 4], pass: 1 });
    expect(text).toContain("pages 1–4 of a 7-page document");
    expect(text).toContain('permit number "OW-17-00474"');
    expect(text).toContain('document type "PERMIT"');
    expect(text).toContain("env (legacy)");
    expect(text).toContain("1-based within THIS attachment");
    expect(text).not.toContain("did not state a tank capacity");
  });

  it("tells pass 2 why it is being asked and names the eplpav archive", () => {
    const text = buildPassUserMessage({
      ...base,
      archive: "edms_eplpav",
      totalPages: 30,
      pageNumbers: [7, 8, 9],
      pass: 2,
    });
    expect(text).toContain("pages 7–9 of a 30-page document");
    expect(text).toContain("eplpav (Permit Center)");
    expect(text).toContain("did not state a tank capacity or a disposal type");
  });
});

describe("buildEscalationUserMessage", () => {
  it("asks exactly one question and shows the previous weak reading", () => {
    const spec = FACT_SPECS.find((s) => s.path === "designFlowGpd")!;
    const text = buildEscalationUserMessage(spec, { value: 300, confidence: 0.45 });
    expect(text).toContain(spec.question);
    expect(text).toContain('"300"');
    expect(text).toContain("45%");
    expect(text.match(/\?/g)?.length).toBe(1);
  });

  it("omits the previous reading when none exists", () => {
    const spec = FACT_SPECS.find((s) => s.path === "permitNumber")!;
    expect(buildEscalationUserMessage(spec, null)).not.toContain("previous reading");
  });
});

describe("ESCALATION_SYSTEM_PROMPT", () => {
  it("frames a single-page, single-question task with honest confidence", () => {
    expect(ESCALATION_SYSTEM_PROMPT).toContain("ONE question");
    expect(ESCALATION_SYSTEM_PROMPT).toContain("found = false");
    expect(ESCALATION_SYSTEM_PROMPT).toContain("Never guess");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/ai/__tests__/permit-extraction-prompt.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/ai/permit-extraction-prompt"`.

- [ ] **Step 3: Write the prompt module (full text)**

```ts
// src/lib/ai/permit-extraction-prompt.ts
/**
 * Prompts for permit-record extraction (spec §6 "Prompt contract").
 *
 * The system prompt is sent with `cache_control: { type: "ephemeral" }`; on
 * Sonnet 4.6 a cached prefix must be ≥ 1024 tokens, so keep this long. The
 * test asserts a snapshot — change it deliberately, then update the snapshot.
 */
import type { PermitArchive } from "@/lib/prefill/types";
import type { FactSpec, FactValue } from "./permit-facts-utils";

export const PERMIT_EXTRACTION_SYSTEM_PROMPT = `You are extracting structured facts from Maricopa County (Arizona) Environmental Services Department (MCESD) onsite wastewater / septic permit documents for a licensed inspector who is filling out an ADEQ GWS 432 Property Transfer Inspection report. The pages you receive are scans or native PDFs pulled from the county's EDMS archives. Your output is validated against a strict JSON schema, and the inspector will open the exact page you cite to verify every value, so precision, verbatim evidence and honest confidence matter far more than completeness. A wrong value costs more than a missing one.

DOCUMENT LAYOUTS YOU WILL SEE

1. "Approval to Construct Individual Sewage Disposal System" (legacy, 1970s through the 2000s; permit numbers like 000972, 97-01234 or 000972-ISD). A typed county form, usually completed by hand: applicant/owner, site address, subdivision and lot, assessor parcel number, number of bedrooms, "Septic tank ____ gal", tank material (precast concrete, fiberglass, plastic, steel, cast-in-place), disposal works ("seepage pit", "leach line" / "trench", "bed", "chamber") with dimensions such as "2 pits 5' dia x 30' deep" or "150 lin ft trench", design flow in gpd, water supply (city / water company / private well / shared well / hauled), installer or contractor, an approval date and an inspector signature. The issue date is the date the county signed the approval, not the application date and not a plan-check date. Later pages may hold an inspection card with a final inspection date, a plot plan / site plan sketch, soil percolation data, or plan-check notes. Handwriting on these forms is often faint; a "1" and a "7" or a "0" and a "6" are commonly confused, so compare digit shapes against other digits on the same page.

2. "Discharge Authorization" (2010s onward; permit numbers OW-YY-NNNNN such as OW-17-00474, sometimes with an R suffix for revisions, e.g. OWR-22-04475). Fully typed. A "General Permits Authorized" table lists one row per component, for example "4.02 A314 Septic Tank Qty 1 Capacity 1250" and "4.02 Seepage Pit Qty 2 Overall 28'0" Effective 24'0"" or "4.02 Disposal Trench Qty 3 Length 60'" or "4.02 Chamber Bed Qty 1 Area 400 sq ft". Also present: design flow (gpd), bedrooms, water source, the issuance date, the contractor and a reference to the Approval to Construct. Treat the table's Capacity as the tank capacity in gallons, the row Qty as the disposal count, and the Overall / Effective / Length / Area figures as the disposal dimensions (copy them verbatim into dimensions; put a printed square-foot area into absorptionAreaSqft).

3. "FINAL DA" / Final Discharge Authorization (ePLPAV Permit Center, 2024 onward; permit numbers OW-24-…, OW-25-…, OW-26-…; sometimes 40 to 60 pages of native text). The first pages carry the discharge authorization letter; an "Inspection Measurements" or as-built table follows with the installed tank size, material and manufacturer and the measured disposal dimensions. Prefer as-built measured values over designed values when both appear, and say so in notes.

4. "Notice of Transfer" (a CivicPlus web-form email printout). Records a property-transfer inspection: address, parcel, inspector, date and the permit referenced. It rarely carries tank or disposal data; extract the permit number and dates only, unless system facts are explicitly stated on the page.

5. "Abandonment" / Permit to Abandon / Abandonment Notice. Documents the decommissioning of a septic system (tank pumped and crushed or filled with slurry). Set isAbandonment to true and extract the dates and the permit number; do not report the abandoned tank's capacity or disposal works as current system facts (leave tanks empty and disposal null).

6. Anything else: plan review letters, correction notices, a "PERMIT SUB" resubmittal, soil reports, an engineer's site plan or a fee receipt. Use documentKind "other" and extract only what is plainly stated on the pages.

WHAT TO EXTRACT
- permitNumber: exactly as printed, keeping dashes and prefixes (OW-17-00474, not OW1700474).
- documentKind: from the title of the FIRST page you were given. A DA packet that also contains an older Approval to Construct is a discharge_authorization.
- issueDate / finalDate: ISO yyyy-mm-dd. If only the month and year are legible, use the first of the month and lower the confidence. Never guess a year from context.
- designFlowGpd, bedrooms, tanks (capacityGal, material, model, dimensions), disposal (type, count, dimensions, absorptionAreaSqft), waterSource, isCesspool, hasSitePlan, systemType.
- Every tank listed on the document gets its own entry in tanks; a "1500 gal two-compartment tank" is ONE tank. A dosing or pump tank with its own listed capacity is a separate tank entry with model "dosing tank".
- disposal.type: "trench" for leach lines / leach fields / disposal trenches, "bed" for leach beds / disposal beds, "chamber" for chamber technology (Infiltrator, Quick4), "seepage_pit" for pits / dry wells / seepage pits, otherwise "other".
- systemType: "alternative" only when the document names an alternative technology (aerobic treatment unit, ATU, mound, pressure distribution, drip, sand filter, textile filter, peat filter, ET bed, disinfection). Chambers, seepage pits, trenches and beds behind a septic tank are "conventional".
- isCesspool: true only if the document itself describes the system as a cesspool or cesspit. This flag voids the inspection report, so never infer it.
- hasSitePlan: true only when one of the pages you were given is a drawing or sketch of the lot showing the system layout.
- notes: one or two sentences with anything an inspector should know (for example "Tank capacity is from the as-built table; the design called for 1000 gal." or "Disposal dimensions are handwritten and partly illegible.").

EVIDENCE AND PAGE
- For every fact, page is the 1-based page number WITHIN THE DOCUMENT YOU WERE GIVEN (its first page is page 1), and evidence is a verbatim quote of at most 300 characters of the text that supports the value, exactly as it appears on the page including the field label ("Septic Tank Qty 1 Capacity 1250", "Septic tank 1200 gal"). Do not paraphrase the evidence and do not quote text from a different page.
- handwritten is true when the value was read from handwriting (including a typed form whose blanks were filled by hand); false when the value itself is typed or printed.

CONFIDENCE CALIBRATION (0 to 1)
- 0.95 to 1.0: typed or printed and unambiguous.
- 0.85 to 0.94: clear handwriting, or a typed value with a minor doubt such as a faint scan or a partially cut-off field.
- 0.70 to 0.84: legible handwriting with some ambiguity (a digit that could be read two ways).
- 0.50 to 0.69: hard to read; your best reading of ambiguous digits or a smudged word. Anything you had to squint at is ≤ 0.6.
- below 0.50: mostly a guess. Prefer returning null over any value below 0.40.
- A value that is inferred rather than read (for example bedrooms derived from the design flow, or a tank size assumed from the bedroom count) is not allowed; return null instead.

RULES
- Never invent a value. If a field is not on the pages you were given, return null for that field (or an empty tanks array). Blank form fields are null, not 0 and not an empty string.
- Do not convert units: report gallons as gallons and dimensions as written. Do not compute an absorption area unless it is printed.
- When two pages disagree, report the value from the most authoritative page (a Discharge Authorization or an as-built table beats an application or a plan-check note) and mention the disagreement in notes.
- Do not use the EDMS index metadata you are told about (permit number, document type) as evidence; report what the pages actually say and let the metadata only help you disambiguate.
- Output only the JSON object required by the schema. Do not add commentary outside it.`;

export const ESCALATION_SYSTEM_PROMPT = `You are reading a single page from a Maricopa County septic permit document. The page may be handwritten or a poor-quality scan. You will be asked ONE question about it and nothing else. Look carefully at the handwriting: compare digit shapes against other digits on the same page, use the labels printed next to the value, and use plausibility (a 1000-gallon septic tank is common and a 100-gallon tank is not; a permit year matches the form's revision date and the dates around it). If the value is not on this page, answer found = false with an empty value and zero confidence. Report confidence honestly on a 0 to 1 scale (0.95 and above only for typed, clear text; 0.7 to 0.85 for clear handwriting; 0.6 and below when digits are ambiguous), and quote the surrounding text verbatim as evidence (at most 300 characters). Set handwritten to true when the value is handwritten. Never guess a value you cannot actually see.`;

export interface PassMessageMeta {
  permitNumber: string;
  docType: string;
  archive: PermitArchive;
  /** Source-document page numbers contained in the attachment, in order */
  pageNumbers: number[];
  totalPages: number;
  pass: 1 | 2;
}

export function buildPassUserMessage(meta: PassMessageMeta): string {
  const first = meta.pageNumbers[0];
  const last = meta.pageNumbers[meta.pageNumbers.length - 1];
  const archive = meta.archive === "edms_env" ? "env (legacy)" : "eplpav (Permit Center)";
  const lines = [
    `Extract the facts from the attached PDF. It contains pages ${first}–${last} of a ${meta.totalPages}-page document from the Maricopa County EDMS "${archive}" archive.`,
    `EDMS index metadata for this document: permit number "${meta.permitNumber}", document type "${meta.docType}". Use the metadata only to disambiguate; report what the pages actually say.`,
    meta.pass === 2
      ? "The first pages of this document did not state a tank capacity or a disposal type. Look for them on these later pages (inspection cards, as-built tables, plot plans, plan-check notes)."
      : "",
    "Page numbers in your answer are 1-based within THIS attachment (its first page is page 1).",
  ];
  return lines.filter(Boolean).join("\n\n");
}

export function buildEscalationUserMessage(
  spec: FactSpec,
  previous: { value: FactValue; confidence: number } | null,
): string {
  const lines = [spec.question];
  if (previous) {
    lines.push(
      `A first reading of this page produced "${String(previous.value)}" at ${Math.round(previous.confidence * 100)}% confidence. Do not assume it is right; read the page fresh.`,
    );
  }
  lines.push("Answer only the field described by the schema.");
  return lines.join("\n\n");
}
```

- [ ] **Step 4: Run the test to verify it passes (writes the snapshot on first run)**

Run: `npx vitest run src/lib/ai/__tests__/permit-extraction-prompt.test.ts`
Expected: PASS (8 tests); `1 snapshot written`. Open `src/lib/ai/__tests__/__snapshots__/permit-extraction-prompt.test.ts.snap` and confirm it contains the full prompt.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/permit-extraction-prompt.ts src/lib/ai/__tests__/permit-extraction-prompt.test.ts src/lib/ai/__tests__/__snapshots__/permit-extraction-prompt.test.ts.snap
git commit -m "feat(prefill): permit extraction system prompt + pass/escalation message builders"
```

---

### Task 5: `extractPermitFactsFromPdf` — Sonnet passes, merge, usage, errors

**Files:**
- Create: `src/lib/ai/extract-permit-facts.ts`
- Test: `src/lib/ai/__tests__/extract-permit-facts.test.ts`

**Interfaces:**
- Consumes: `PermitFactsSchema`, `PermitFacts` (Task 1); `hasCoreFacts`, `mergePermitFacts`, `rebasePages` (Task 2); `planPasses`, `loadPdfDocument`, `buildSubPdf` (Task 3); `PERMIT_EXTRACTION_SYSTEM_PROMPT`, `buildPassUserMessage`, `PassMessageMeta` (Task 4); `PermitArchive` (types.ts).
- Produces: `EXTRACTION_MODEL = "claude-sonnet-4-6"`, `ESCALATION_MODEL = "claude-opus-5"`, `EXTRACTION_MAX_TOKENS = 4096`, `EXTRACTION_TIMEOUT_MS = 90_000`, `MAX_ESCALATIONS_PER_DOCUMENT = 3`, `MODEL_PRICING`; `interface ModelCallUsage`; `interface ExtractionUsage { calls: ModelCallUsage[]; estimatedCostUsd: number }`; `estimateCostUsd(calls)`; `class ExtractionError extends Error`; `toExtractionError(err)`; `interface ExtractPermitFactsMeta { permitNumber; docType; archive }`; `interface ExtractPermitFactsOptions { signal?; client?; escalate? }`; `interface ExtractPermitFactsResult { facts; passes: 1 | 2; escalations: number; pageCount: number; usage: ExtractionUsage }`; `extractPermitFactsFromPdf(pdfBytes, meta, opts?)`.

Design notes: the client is injectable (`opts.client`) so tests pass a fake `{ messages: { parse } }` and never mock the SDK module; SDK error classes are imported as named exports and matched with `instanceof` (verified: `new APIError(500, undefined, "boom", undefined).message === "500 boom"`). Retries: `maxRetries: 0` on every request (the SDK default would retry 429/5xx too) plus one in-module retry on `APIConnectionError` that is not `APIConnectionTimeoutError` — spec §10 "one retry on network errors only". `Buffer` is fine — these modules run in the Node runtime of route handlers and `after()`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/ai/__tests__/extract-permit-facts.test.ts
import type Anthropic from "@anthropic-ai/sdk";
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AnthropicError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import {
  ESCALATION_MODEL,
  EXTRACTION_MODEL,
  ExtractionError,
  estimateCostUsd,
  extractPermitFactsFromPdf,
} from "@/lib/ai/extract-permit-facts";
import { emptyPermitFacts, type PermitFacts } from "@/lib/ai/permit-extraction-schema";

/** Page N is (100+N) points wide so we can tell which page was attached */
async function makePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 1; i <= pages; i++) doc.addPage([100 + i, 200]);
  return new Uint8Array(await doc.save());
}

const sonnetUsage = {
  input_tokens: 10_000,
  output_tokens: 1_000,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 10_000,
};
const opusUsage = {
  input_tokens: 2_000,
  output_tokens: 200,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

function reply(parsed: unknown, extra: Record<string, unknown> = {}) {
  return { parsed_output: parsed, stop_reason: "end_turn", usage: sonnetUsage, content: [], ...extra };
}

function opusReply(answer: unknown) {
  return { parsed_output: answer, stop_reason: "end_turn", usage: opusUsage, content: [] };
}

function fakeClient(...replies: Array<object | Error>) {
  const parse = vi.fn();
  for (const r of replies) {
    if (r instanceof Error) parse.mockRejectedValueOnce(r);
    else parse.mockResolvedValueOnce(r);
  }
  return { client: { messages: { parse } } as unknown as Anthropic, parse };
}

// biome-ignore lint/suspicious/noExplicitAny: reading back untyped mock call args
async function attachedPdf(call: any): Promise<PDFDocument> {
  const block = call.messages[0].content.find((b: { type: string }) => b.type === "document");
  // Buffer is a Node-realm Uint8Array; under jsdom pdf-lib's instanceof check needs this realm's
  return PDFDocument.load(new Uint8Array(Buffer.from(block.source.data, "base64")));
}

// biome-ignore lint/suspicious/noExplicitAny: reading back untyped mock call args
function attachedText(call: any): string {
  return call.messages[0].content.find((b: { type: string }) => b.type === "text").text;
}

const f = <T>(value: T, confidence = 0.9, page = 1, handwritten = false) => ({
  value,
  confidence,
  page,
  evidence: `ev:${String(value)}`,
  handwritten,
});

function withCapacity(
  facts: PermitFacts,
  gal: number,
  page = 1,
  confidence = 0.9,
  handwritten = false,
): PermitFacts {
  return {
    ...facts,
    tanks: [{ capacityGal: f(gal, confidence, page, handwritten), material: null, model: null, dimensions: null }],
  };
}

const meta = { permitNumber: "000972", docType: "PERMIT", archive: "edms_env" as const };

describe("extractPermitFactsFromPdf — passes", () => {
  it("runs a single Sonnet pass over pages 1–4 when they carry core facts", async () => {
    const { client, parse } = fakeClient(reply(withCapacity(emptyPermitFacts(), 1200)));
    const result = await extractPermitFactsFromPdf(await makePdf(7), meta, { client, escalate: false });

    expect(result.passes).toBe(1);
    expect(result.pageCount).toBe(7);
    expect(result.facts.tanks[0].capacityGal?.value).toBe(1200);
    expect(parse).toHaveBeenCalledTimes(1);

    const [params, options] = parse.mock.calls[0];
    expect(params.model).toBe(EXTRACTION_MODEL);
    expect(params.max_tokens).toBe(4096);
    expect(params.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(params.system[0].text).toContain("General Permits Authorized");
    expect(params.output_config.format.type).toBe("json_schema");
    expect(options).toEqual({ timeout: 90_000, maxRetries: 0, signal: undefined });
    expect((await attachedPdf(params)).getPageCount()).toBe(4);
    expect(attachedText(params)).toContain("pages 1–4 of a 7-page document");
  });

  it("runs a second pass over the remaining pages when pass 1 has no capacity and no disposal type, and rebases pages", async () => {
    const pass1 = { ...emptyPermitFacts(), permitNumber: f("000972", 0.9, 1) };
    const pass2: PermitFacts = {
      ...withCapacity(emptyPermitFacts(), 1200, 2),
      disposal: { ...emptyPermitFacts().disposal, type: f("seepage_pit", 0.8, 3) },
    };
    const { client, parse } = fakeClient(reply(pass1), reply(pass2));
    const result = await extractPermitFactsFromPdf(await makePdf(7), meta, { client, escalate: false });

    expect(result.passes).toBe(2);
    expect(parse).toHaveBeenCalledTimes(2);
    const second = parse.mock.calls[1][0];
    expect((await attachedPdf(second)).getPageCount()).toBe(3);
    expect((await attachedPdf(second)).getPage(0).getWidth()).toBe(105);
    expect(attachedText(second)).toContain("pages 5–7 of a 7-page document");
    expect(attachedText(second)).toContain("did not state a tank capacity");
    // pass-2 page 2 → source page 6; pass-2 page 3 → source page 7
    expect(result.facts.tanks[0].capacityGal?.page).toBe(6);
    expect(result.facts.disposal.type?.page).toBe(7);
    expect(result.facts.permitNumber?.value).toBe("000972");
  });

  it("does not run a second pass when the document has no more pages", async () => {
    const { client, parse } = fakeClient(reply(emptyPermitFacts()));
    const result = await extractPermitFactsFromPdf(await makePdf(3), meta, { client, escalate: false });
    expect(result.passes).toBe(1);
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("uses pages 1–6 for ePLPAV documents", async () => {
    const { client, parse } = fakeClient(reply(withCapacity(emptyPermitFacts(), 1250)));
    await extractPermitFactsFromPdf(await makePdf(54), { ...meta, archive: "edms_eplpav" }, { client, escalate: false });
    expect((await attachedPdf(parse.mock.calls[0][0])).getPageCount()).toBe(6);
  });

  it("accumulates usage and estimates cost", async () => {
    const { client } = fakeClient(reply(emptyPermitFacts()), reply(withCapacity(emptyPermitFacts(), 1000)));
    const result = await extractPermitFactsFromPdf(await makePdf(7), meta, { client, escalate: false });
    expect(result.usage.calls).toHaveLength(2);
    expect(result.usage.calls[0]).toEqual({
      model: EXTRACTION_MODEL,
      inputTokens: 10_000,
      outputTokens: 1_000,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 10_000,
    });
    // per call: 10k×$3 + 1k×$15 + 10k×$0.30 per MTok = $0.048
    expect(result.usage.estimatedCostUsd).toBeCloseTo(0.096, 4);
  });
});

describe("estimateCostUsd", () => {
  it("prices Sonnet and Opus calls separately", () => {
    expect(
      estimateCostUsd([
        { model: EXTRACTION_MODEL, inputTokens: 10_000, outputTokens: 1_000, cacheCreationInputTokens: 0, cacheReadInputTokens: 10_000 },
        { model: ESCALATION_MODEL, inputTokens: 2_000, outputTokens: 200, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
      ]),
    ).toBeCloseTo(0.048 + 0.015, 4);
  });
});

describe("extractPermitFactsFromPdf — failures", () => {
  it("maps SDK errors to ExtractionError with a human message", async () => {
    const cases: Array<[Error, RegExp]> = [
      [new APIError(500, undefined, "boom", undefined), /Claude API error: 500 boom/],
      [new RateLimitError(429, undefined, "slow down", new Headers()), /rate limit/i],
      [new APIConnectionTimeoutError(), /timed out after 90 s/],
      [new APIUserAbortError(), /time budget/],
      [new AnthropicError("Failed to parse structured output: bad\nValidation issues:\n  - x"), /Schema mismatch: Failed to parse structured output: bad$/],
    ];
    for (const [err, pattern] of cases) {
      const { client } = fakeClient(err);
      const promise = extractPermitFactsFromPdf(await makePdf(2), meta, { client, escalate: false });
      await expect(promise).rejects.toBeInstanceOf(ExtractionError);
      await expect(promise).rejects.toThrow(pattern);
    }
  });

  it("fails when the reply was cut off or unparsed", async () => {
    const cut = fakeClient(reply(withCapacity(emptyPermitFacts(), 1), { stop_reason: "max_tokens" }));
    await expect(extractPermitFactsFromPdf(await makePdf(2), meta, { client: cut.client })).rejects.toThrow(/max_tokens/);
    const empty = fakeClient(reply(null, { stop_reason: "refusal" }));
    await expect(extractPermitFactsFromPdf(await makePdf(2), meta, { client: empty.client })).rejects.toThrow(
      /no structured output \(stop_reason: refusal\)/,
    );
  });

  it("fails fast on bytes that are not a PDF", async () => {
    const { client, parse } = fakeClient();
    await expect(extractPermitFactsFromPdf(new Uint8Array([1, 2, 3]), meta, { client })).rejects.toThrow(
      /Could not open PDF/,
    );
    expect(parse).not.toHaveBeenCalled();
  });

  it("retries once on a connection error, but not on a timeout or an HTTP error", async () => {
    const ok = reply(withCapacity(emptyPermitFacts(), 1200));
    const retried = fakeClient(new APIConnectionError({ message: "ECONNRESET" }), ok);
    const result = await extractPermitFactsFromPdf(await makePdf(2), meta, { client: retried.client, escalate: false });
    expect(result.facts.tanks[0].capacityGal?.value).toBe(1200);
    expect(retried.parse).toHaveBeenCalledTimes(2);

    const twice = fakeClient(new APIConnectionError({ message: "a" }), new APIConnectionError({ message: "b" }));
    await expect(extractPermitFactsFromPdf(await makePdf(2), meta, { client: twice.client })).rejects.toThrow(/^b$/);
    expect(twice.parse).toHaveBeenCalledTimes(2);

    for (const err of [new APIConnectionTimeoutError(), new APIError(500, undefined, "boom", undefined)]) {
      const once = fakeClient(err, ok);
      await expect(extractPermitFactsFromPdf(await makePdf(2), meta, { client: once.client })).rejects.toBeInstanceOf(ExtractionError);
      expect(once.parse).toHaveBeenCalledTimes(1);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/ai/__tests__/extract-permit-facts.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/ai/extract-permit-facts"`.

- [ ] **Step 3: Write the extraction module (escalation is wired in Task 6; for now `escalations` is 0)**

```ts
// src/lib/ai/extract-permit-facts.ts
/**
 * Structured extraction of PermitFacts from a stored Maricopa ESD permit PDF
 * (spec §6). Sonnet 4.6 reads a first-pass sub-PDF (pages 1–4 / 1–6) and, when
 * that yields neither a tank capacity nor a disposal type, a second sub-PDF of
 * the next ≤ 20 pages; the passes merge field-by-field (higher confidence
 * wins). Handwritten facts under HANDWRITING_ESCALATION_THRESHOLD are re-asked
 * on Opus 5 with only their page and a single question (max 3 per document).
 */
import Anthropic, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AnthropicError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { buildSubPdf, loadPdfDocument, planPasses } from "@/lib/prefill/permits/triage";
import type { PermitArchive } from "@/lib/prefill/types";
import {
  PERMIT_EXTRACTION_SYSTEM_PROMPT,
  buildPassUserMessage,
  type PassMessageMeta,
} from "./permit-extraction-prompt";
import { PermitFactsSchema, type PermitFacts } from "./permit-extraction-schema";
import { hasCoreFacts, mergePermitFacts, rebasePages } from "./permit-facts-utils";

// Built lazily: constructing the SDK client at import time throws under vitest's jsdom
// environment ("browser-like environment"); tests inject `opts.client` instead.
let defaultClient: Anthropic | undefined;
function getClient(): Anthropic {
  defaultClient ??= new Anthropic();
  return defaultClient;
}

export const EXTRACTION_MODEL = "claude-sonnet-4-6";
export const ESCALATION_MODEL = "claude-opus-5";
export const EXTRACTION_MAX_TOKENS = 4096;
export const EXTRACTION_TIMEOUT_MS = 90_000;
export const MAX_ESCALATIONS_PER_DOCUMENT = 3;

/** USD per million tokens (platform.claude.com/docs/en/pricing, checked 2026-09-11) */
export const MODEL_PRICING: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  [EXTRACTION_MODEL]: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  [ESCALATION_MODEL]: { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
};

export interface ModelCallUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export interface ExtractionUsage {
  calls: ModelCallUsage[];
  estimatedCostUsd: number;
}

export function estimateCostUsd(calls: ModelCallUsage[]): number {
  let usd = 0;
  for (const c of calls) {
    const p = MODEL_PRICING[c.model] ?? MODEL_PRICING[EXTRACTION_MODEL];
    usd +=
      (c.inputTokens * p.input +
        c.outputTokens * p.output +
        c.cacheCreationInputTokens * p.cacheWrite +
        c.cacheReadInputTokens * p.cacheRead) /
      1_000_000;
  }
  return Math.round(usd * 10_000) / 10_000;
}

/** Any failure of one document's extraction. The message is safe to store in `extraction_error`. */
export class ExtractionError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ExtractionError";
    if (cause !== undefined) this.cause = cause;
  }
}

export function toExtractionError(err: unknown): ExtractionError {
  if (err instanceof ExtractionError) return err;
  if (err instanceof APIUserAbortError) {
    return new ExtractionError("Prefill time budget exceeded before extraction finished", err);
  }
  if (err instanceof APIConnectionTimeoutError) {
    return new ExtractionError(`Claude timed out after ${EXTRACTION_TIMEOUT_MS / 1000} s`, err);
  }
  if (err instanceof RateLimitError) {
    return new ExtractionError("Claude rate limit reached — try Find records again in a minute", err);
  }
  if (err instanceof APIConnectionError) return new ExtractionError(err.message, err);
  // APIError.message already carries the status ("500 boom")
  if (err instanceof APIError) return new ExtractionError(`Claude API error: ${err.message}`, err);
  // zodOutputFormat().parse throws a bare AnthropicError when the JSON does not match the schema
  if (err instanceof AnthropicError) {
    return new ExtractionError(`Schema mismatch: ${err.message.split("\n")[0]}`, err);
  }
  return new ExtractionError(err instanceof Error ? err.message : String(err), err);
}

/** Runs one Claude call; spec §10: one retry on network errors only (never on HTTP status, never on a timeout). */
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof APIConnectionError && !(err instanceof APIConnectionTimeoutError)) {
      try {
        return await fn();
      } catch (retryErr) {
        throw toExtractionError(retryErr);
      }
    }
    throw toExtractionError(err);
  }
}

function recordUsage(calls: ModelCallUsage[], model: string, usage: Anthropic.Messages.Usage | undefined): void {
  if (!usage) return;
  calls.push({
    model,
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
  });
}

export interface ExtractPermitFactsMeta {
  permitNumber: string;
  docType: string;
  archive: PermitArchive;
}

export interface ExtractPermitFactsOptions {
  /** The run's 240 s budget signal */
  signal?: AbortSignal;
  /** Injected in tests; defaults to the module client */
  client?: Anthropic;
  /** Default true; false skips the Opus escalation */
  escalate?: boolean;
}

export interface ExtractPermitFactsResult {
  facts: PermitFacts;
  passes: 1 | 2;
  escalations: number;
  pageCount: number;
  usage: ExtractionUsage;
}

async function runPass(
  client: Anthropic,
  subPdf: Uint8Array,
  meta: PassMessageMeta,
  signal: AbortSignal | undefined,
  calls: ModelCallUsage[],
): Promise<PermitFacts> {
  const message = await guarded(() =>
    client.messages.parse(
      {
        model: EXTRACTION_MODEL,
        max_tokens: EXTRACTION_MAX_TOKENS,
        system: [
          {
            type: "text",
            text: PERMIT_EXTRACTION_SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: Buffer.from(subPdf).toString("base64"),
                },
                title: `${meta.permitNumber} ${meta.docType}`,
              },
              { type: "text", text: buildPassUserMessage(meta) },
            ],
          },
        ],
        output_config: { format: zodOutputFormat(PermitFactsSchema) },
      },
      { timeout: EXTRACTION_TIMEOUT_MS, maxRetries: 0, signal },
    ),
  );
  recordUsage(calls, EXTRACTION_MODEL, message.usage);
  if (message.stop_reason === "max_tokens") {
    throw new ExtractionError("Claude reply was cut off (max_tokens)");
  }
  if (!message.parsed_output) {
    throw new ExtractionError(
      `Claude returned no structured output (stop_reason: ${message.stop_reason ?? "unknown"})`,
    );
  }
  return rebasePages(message.parsed_output, meta.pageNumbers);
}

/**
 * Extract PermitFacts from one stored permit PDF. Throws ExtractionError; the
 * caller marks the record `failed` and moves on.
 */
export async function extractPermitFactsFromPdf(
  pdfBytes: Uint8Array,
  meta: ExtractPermitFactsMeta,
  opts: ExtractPermitFactsOptions = {},
): Promise<ExtractPermitFactsResult> {
  const client = opts.client ?? getClient();
  const calls: ModelCallUsage[] = [];

  let doc: Awaited<ReturnType<typeof loadPdfDocument>>;
  try {
    doc = await loadPdfDocument(pdfBytes);
  } catch (err) {
    throw new ExtractionError(err instanceof Error ? err.message : String(err), err);
  }
  const plan = planPasses(doc.getPageCount(), meta.archive);

  let facts = await runPass(
    client,
    await buildSubPdf(doc, plan.first),
    { ...meta, pageNumbers: plan.first, totalPages: plan.pageCount, pass: 1 },
    opts.signal,
    calls,
  );
  let passes: 1 | 2 = 1;

  if (!hasCoreFacts(facts) && plan.second.length > 0) {
    const more = await runPass(
      client,
      await buildSubPdf(doc, plan.second),
      { ...meta, pageNumbers: plan.second, totalPages: plan.pageCount, pass: 2 },
      opts.signal,
      calls,
    );
    facts = mergePermitFacts(facts, more);
    passes = 2;
  }

  const escalations = 0; // Task 6 replaces this with escalateWeakHandwriting(...)

  return {
    facts,
    passes,
    escalations,
    pageCount: plan.pageCount,
    usage: { calls, estimatedCostUsd: estimateCostUsd(calls) },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/ai/__tests__/extract-permit-facts.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/extract-permit-facts.ts src/lib/ai/__tests__/extract-permit-facts.test.ts
git commit -m "feat(prefill): Sonnet structured extraction of permit facts with two-pass triage"
```

---

### Task 6: Opus 5 escalation of weak handwriting

**Files:**
- Modify: `src/lib/ai/extract-permit-facts.ts`
- Test: `src/lib/ai/__tests__/extract-permit-facts.test.ts` (append a `describe`)

**Interfaces:**
- Consumes: `HANDWRITING_ESCALATION_THRESHOLD` (types.ts); `EscalationAnswerSchema`, `EscalationAnswer`, `Fact` (Task 1); `allFactSpecs`, `getFactAt`, `setFactAt`, `coerceFactValue`, `FactSpec`, `FactValue` (Task 2); `ESCALATION_SYSTEM_PROMPT`, `buildEscalationUserMessage` (Task 4).
- Produces: `escalations` in `ExtractPermitFactsResult` becomes the number of Opus answers received; facts replaced only when Opus is more confident.

- [ ] **Step 1: Append the failing tests**

```ts
// append to src/lib/ai/__tests__/extract-permit-facts.test.ts
describe("extractPermitFactsFromPdf — Opus escalation", () => {
  const weakCapacity = () => withCapacity(emptyPermitFacts(), 1200, 2, 0.5, true);
  const found = (value: string, confidence: number) => ({
    found: true,
    value,
    confidence,
    evidence: `Septic tank ${value} gal`,
    handwritten: true,
  });

  it("re-asks a handwritten fact below 0.6 on Opus with only its page and replaces it when Opus is more confident", async () => {
    const { client, parse } = fakeClient(reply(weakCapacity()), opusReply(found("1250", 0.8)));
    const result = await extractPermitFactsFromPdf(await makePdf(7), meta, { client });

    expect(parse).toHaveBeenCalledTimes(2);
    const [params, options] = parse.mock.calls[1];
    expect(params.model).toBe(ESCALATION_MODEL);
    expect(options).toEqual({ timeout: 90_000, maxRetries: 0, signal: undefined });
    const page = await attachedPdf(params);
    expect(page.getPageCount()).toBe(1);
    expect(page.getPage(0).getWidth()).toBe(102); // source page 2
    expect(attachedText(params)).toContain("capacity in gallons of septic tank #1");
    expect(attachedText(params)).toContain('"1200"');
    expect(params.output_config.format.type).toBe("json_schema");

    expect(result.escalations).toBe(1);
    expect(result.facts.tanks[0].capacityGal).toEqual({
      value: 1250,
      confidence: 0.8,
      page: 2,
      evidence: "Septic tank 1250 gal",
      handwritten: true,
    });
    expect(result.usage.calls.map((c) => c.model)).toEqual([EXTRACTION_MODEL, ESCALATION_MODEL]);
  });

  it("keeps the Sonnet value when Opus is not more confident, says not found, or answers unusably", async () => {
    for (const answer of [found("1250", 0.4), { ...found("", 0), found: false }, found("twelve hundred", 0.9)]) {
      const { client } = fakeClient(reply(weakCapacity()), opusReply(answer));
      const result = await extractPermitFactsFromPdf(await makePdf(7), meta, { client });
      expect(result.escalations).toBe(1);
      expect(result.facts.tanks[0].capacityGal?.value).toBe(1200);
      expect(result.facts.tanks[0].capacityGal?.confidence).toBe(0.5);
    }
  });

  it("does not escalate typed facts, or handwritten facts at or above the threshold", async () => {
    for (const facts of [
      withCapacity(emptyPermitFacts(), 1200, 2, 0.3, false),
      withCapacity(emptyPermitFacts(), 1200, 2, 0.6, true),
    ]) {
      const { client, parse } = fakeClient(reply(facts));
      const result = await extractPermitFactsFromPdf(await makePdf(7), meta, { client });
      expect(parse).toHaveBeenCalledTimes(1);
      expect(result.escalations).toBe(0);
    }
  });

  it("caps escalations at 3 per document, weakest first", async () => {
    // a typed tank capacity keeps hasCoreFacts true so no second Sonnet pass runs
    const facts: PermitFacts = {
      ...withCapacity(emptyPermitFacts(), 1000, 1, 0.95, false),
      permitNumber: f("000972", 0.5, 1, true),
      issueDate: f("2000-03-01", 0.3, 1, true),
      bedrooms: f(3, 0.55, 1, true),
      designFlowGpd: f(450, 0.2, 1, true),
      contractor: f("Smith", 0.45, 1, true),
    };
    const notFound = { found: false, value: "", confidence: 0, evidence: "", handwritten: false };
    const { client, parse } = fakeClient(reply(facts), opusReply(notFound), opusReply(notFound), opusReply(notFound));
    const result = await extractPermitFactsFromPdf(await makePdf(7), meta, { client });
    expect(parse).toHaveBeenCalledTimes(4);
    expect(result.escalations).toBe(3);
    const questions = parse.mock.calls.slice(1).map((c) => attachedText(c[0]));
    expect(questions[0]).toContain("design flow");
    expect(questions[1]).toContain("approval / issue date");
    expect(questions[2]).toContain("installing contractor");
  });

  it("escalate: false skips Opus entirely", async () => {
    const { client, parse } = fakeClient(reply(weakCapacity()));
    const result = await extractPermitFactsFromPdf(await makePdf(7), meta, { client, escalate: false });
    expect(parse).toHaveBeenCalledTimes(1);
    expect(result.escalations).toBe(0);
  });

  it("keeps the Sonnet facts when Opus fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { client } = fakeClient(reply(weakCapacity()), new APIError(529, undefined, "overloaded", undefined));
    const result = await extractPermitFactsFromPdf(await makePdf(7), meta, { client });
    expect(result.escalations).toBe(0);
    expect(result.facts.tanks[0].capacityGal?.value).toBe(1200);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("escalation of tanks.0.capacityGal failed"));
    warn.mockRestore();
  });
});
```

- [ ] **Step 2: Run the test to verify the new cases fail**

Run: `npx vitest run src/lib/ai/__tests__/extract-permit-facts.test.ts`
Expected: FAIL — the escalation `describe` fails (`parse` called 1 time instead of 2; `escalations` is 0).

- [ ] **Step 3: Add the escalation code**

Add these imports to `src/lib/ai/extract-permit-facts.ts`:

```ts
import { HANDWRITING_ESCALATION_THRESHOLD, type PermitArchive } from "@/lib/prefill/types";
import {
  ESCALATION_SYSTEM_PROMPT,
  PERMIT_EXTRACTION_SYSTEM_PROMPT,
  buildEscalationUserMessage,
  buildPassUserMessage,
  type PassMessageMeta,
} from "./permit-extraction-prompt";
import {
  EscalationAnswerSchema,
  PermitFactsSchema,
  type EscalationAnswer,
  type Fact,
  type PermitFacts,
} from "./permit-extraction-schema";
import {
  allFactSpecs,
  coerceFactValue,
  getFactAt,
  hasCoreFacts,
  mergePermitFacts,
  rebasePages,
  setFactAt,
  type FactSpec,
  type FactValue,
} from "./permit-facts-utils";
import type { PDFDocument } from "pdf-lib";
```

(replace the earlier `import type { PermitArchive } …`, `import { PERMIT_EXTRACTION_SYSTEM_PROMPT, … }`, `import { PermitFactsSchema, … }` and `import { hasCoreFacts, … }` lines with the versions above).

Add these two functions after `runPass`:

```ts
async function askEscalation(
  client: Anthropic,
  pagePdf: Uint8Array,
  spec: FactSpec,
  current: Fact<FactValue>,
  signal: AbortSignal | undefined,
  calls: ModelCallUsage[],
): Promise<EscalationAnswer | null> {
  const message = await guarded(() =>
    client.messages.parse(
      {
        model: ESCALATION_MODEL,
        max_tokens: EXTRACTION_MAX_TOKENS,
        // Under Opus 5's 512-token cache minimum, so no cache_control — it would be silently ignored.
        system: ESCALATION_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: Buffer.from(pagePdf).toString("base64"),
                },
              },
              { type: "text", text: buildEscalationUserMessage(spec, current) },
            ],
          },
        ],
        output_config: { format: zodOutputFormat(EscalationAnswerSchema) },
      },
      { timeout: EXTRACTION_TIMEOUT_MS, maxRetries: 0, signal },
    ),
  );
  recordUsage(calls, ESCALATION_MODEL, message.usage);
  return message.parsed_output ?? null;
}

/**
 * Spec §6: every handwritten fact with confidence < 0.6 (weakest first, max 3)
 * is re-asked on Opus with only its page. The Opus answer replaces the fact
 * only when it is more confident. An Opus failure ends escalation but keeps
 * the Sonnet facts. Returns the number of answers received.
 */
async function escalateWeakHandwriting(
  client: Anthropic,
  doc: PDFDocument,
  facts: PermitFacts,
  signal: AbortSignal | undefined,
  calls: ModelCallUsage[],
): Promise<number> {
  const weak = allFactSpecs(facts)
    .map((spec) => ({ spec, fact: getFactAt(facts, spec.path) }))
    .filter(
      (x): x is { spec: FactSpec; fact: Fact<FactValue> } =>
        x.fact != null && x.fact.handwritten && x.fact.confidence < HANDWRITING_ESCALATION_THRESHOLD,
    )
    .sort((a, b) => a.fact.confidence - b.fact.confidence)
    .slice(0, MAX_ESCALATIONS_PER_DOCUMENT);

  let answered = 0;
  for (const { spec, fact } of weak) {
    let answer: EscalationAnswer | null;
    try {
      answer = await askEscalation(client, await buildSubPdf(doc, [fact.page]), spec, fact, signal, calls);
    } catch (err) {
      console.warn(
        `[prefill] escalation of ${spec.path} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      break;
    }
    answered++;
    if (!answer?.found) continue;
    const value = coerceFactValue(spec.kind, answer.value);
    if (value === null || answer.confidence <= fact.confidence) continue;
    setFactAt(facts, spec.path, {
      value,
      confidence: answer.confidence,
      page: fact.page,
      evidence: answer.evidence,
      handwritten: answer.handwritten,
    });
  }
  return answered;
}
```

Replace the placeholder line in `extractPermitFactsFromPdf`:

```ts
  const escalations =
    opts.escalate === false ? 0 : await escalateWeakHandwriting(client, doc, facts, opts.signal, calls);
```

- [ ] **Step 4: Run the whole file to verify it passes**

Run: `npx vitest run src/lib/ai/__tests__/extract-permit-facts.test.ts`
Expected: PASS (16 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/extract-permit-facts.ts src/lib/ai/__tests__/extract-permit-facts.test.ts
git commit -m "feat(prefill): escalate weak handwritten facts to Opus 5 (single page, single question, max 3)"
```

---

### Task 7: `mapPermitFacts` + `dedupeProposals` (every row of spec §7)

**Files:**
- Create: `src/lib/prefill/map-facts-to-fields.ts`
- Test: `src/lib/prefill/__tests__/map-facts-to-fields.test.ts`

**Interfaces:**
- Consumes: `PermitFacts`, `Fact`, `PermitDocumentKind` (Task 1); `ProposedField`, `PrefillSource` (types.ts).
- Produces: `interface PermitRecordRef { id; permitNumber; docType; inspectionId }`; `mapPermitFacts(facts, record, opts?: { now?: Date }): ProposedField[]`; `dedupeProposals(proposals): ProposedField[]`; `CESSPOOL_MAX_CONFIDENCE = 0.7`; `SYSTEM_TYPE_MAX_CONFIDENCE = 0.7`. (`mapListingFacts` is phase 4 and lives in the same file later.)

Field-path notes checked against `src/lib/validators/inspection.ts` and amendment A1/A4 (`docs/superpowers/plans/2026-09-11-prefill-plan-amendments.md`): tank fields exist only per tank, so proposals use the dotted react-hook-form paths `septicTank.tanks.<i>.tankCapacity` / `capacityBasis` / `tankMaterial` / `tankDimensions` for **every** extracted tank (the client apply step grows the array with `createEmptyTank()`); `facilityInfo.recordsAvailable` and `facilityInfo.isCesspool` are `"yes" | "no" | ""` enums (so the cesspool suggestion proposes `"yes"`, not `true`); `facilityInfo.hasSitePlan`, `hasApprovalOfConstruction`, `hasDischargeAuth` are booleans; `septicTank.tanks.0.tankCapacity`, `numberOfTanks`, `designFlow.estimatedDesignFlow`, `numberOfBedrooms`, `facilityInfo.facilityAge` are strings; `facilityInfo.facilitySystemTypes` is `string[]`. Enum values match `src/lib/constants/inspection.ts` (`TANK_MATERIALS`, `DISPOSAL_TYPES`, `WATER_SOURCES`, `CAPACITY_BASIS_OPTIONS` → `permit_document`, `DESIGN_FLOW_BASIS` → `permit_documents`, `FACILITY_SYSTEM_TYPES`).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/prefill/__tests__/map-facts-to-fields.test.ts
import { describe, expect, it } from "vitest";
import { emptyPermitFacts, type PermitFacts } from "@/lib/ai/permit-extraction-schema";
import { dedupeProposals, mapPermitFacts } from "@/lib/prefill/map-facts-to-fields";
import type { ProposedField } from "@/lib/prefill/types";

const f = <T>(value: T, confidence = 0.9, page = 1, evidence = `ev:${String(value)}`) => ({
  value,
  confidence,
  page,
  evidence,
  handwritten: false,
});

const record = {
  id: "rec-1",
  permitNumber: "OW-17-00474",
  docType: "PERMIT",
  inspectionId: "insp-1",
};
const NOW = new Date("2026-09-11T12:00:00Z");

/** Discharge Authorization with every fact populated */
function daFacts(): PermitFacts {
  return {
    ...emptyPermitFacts(),
    permitNumber: f("OW-17-00474", 0.98, 1, "Permit No. OW-17-00474"),
    documentKind: "discharge_authorization",
    issueDate: f("2017-05-12", 0.95, 1, "Date Issued: 05/12/2017"),
    designFlowGpd: f(450, 0.96, 1, "Design Flow 450 gpd"),
    bedrooms: f(3, 0.96, 1, "Bedrooms: 3"),
    tanks: [
      {
        capacityGal: f(1250, 0.97, 1, "4.02 A314 Septic Tank Qty 1 Capacity 1250"),
        material: f("precast_concrete" as const, 0.85, 2, "Tank: precast concrete"),
        model: null,
        dimensions: null,
      },
    ],
    disposal: {
      type: f("seepage_pit" as const, 0.97, 1, "4.02 Seepage Pit Qty 2"),
      count: f(2, 0.97, 1, "Qty 2"),
      dimensions: f("Overall 28'0\" Effective 24'0\"", 0.95, 1),
      absorptionAreaSqft: null,
    },
    waterSource: f("private_well" as const, 0.9, 1, "Water Supply: Private Well"),
    isCesspool: f(true, 0.9, 1, "CESSPOOL"),
    hasSitePlan: f(true, 0.8, 3, "SITE PLAN"),
    systemType: f("conventional" as const, 0.9, 1, "4.02 Conventional"),
    notes: "",
  };
}

function byPath(proposals: ProposedField[]): Record<string, ProposedField> {
  return Object.fromEntries(proposals.map((p) => [p.fieldPath, p]));
}

describe("mapPermitFacts — spec §7 table", () => {
  const props = byPath(mapPermitFacts(daFacts(), record, { now: NOW }));

  // [fieldPath, value, confidence]
  const rows: Array<[string, ProposedField["value"], number]> = [
    ["facilityInfo.recordsAvailable", "yes", 1],
    ["facilityInfo.hasDischargeAuth", true, 0.98],
    ["facilityInfo.dischargeAuthPermitNo", "OW-17-00474", 0.98],
    ["facilityInfo.hasSitePlan", true, 0.8],
    ["facilityInfo.facilityAge", "9", 0.95],
    ["facilityInfo.facilityAgeEstimateExplanation", "Discharge authorization issued 05/2017 (permit OW-17-00474)", 0.95],
    ["septicTank.tanks.0.tankCapacity", "1250", 0.97],
    ["septicTank.tanks.0.capacityBasis", "permit_document", 0.97],
    ["septicTank.tanks.0.tankMaterial", "precast_concrete", 0.85],
    ["septicTank.numberOfTanks", "1", 0.97],
    ["disposalWorks.disposalType", "seepage_pit", 0.97],
    ["designFlow.numberOfBedrooms", "3", 0.96],
    ["designFlow.estimatedDesignFlow", "450", 0.96],
    ["designFlow.designFlowBasis", "permit_documents", 0.96],
    ["facilityInfo.waterSource", "private_well", 0.9],
    ["facilityInfo.isCesspool", "yes", 0.7],
    ["facilityInfo.facilitySystemTypes", ["conventional"], 0.7],
  ];

  it.each(rows)("%s → %j @ %d", (fieldPath, value, confidence) => {
    const p = props[fieldPath];
    expect(p, fieldPath).toBeDefined();
    expect(p.kind).toBe("fill");
    expect(p.value).toEqual(value);
    expect(p.provenance.confidence).toBeCloseTo(confidence, 5);
    expect(p.provenance.source).toBe("permit");
    expect(p.provenance.recordId).toBe("rec-1");
  });

  it("proposes exactly the table's fields and nothing for isAbandonment", () => {
    expect(Object.keys(props).sort()).toEqual(rows.map((r) => r[0]).sort());
  });

  it("links every proposal to the stored record page", () => {
    expect(props["septicTank.tanks.0.tankCapacity"].provenance.sourceUrl).toBe(
      "/api/inspections/insp-1/records/rec-1#page=1",
    );
    expect(props["septicTank.tanks.0.tankCapacity"].provenance.page).toBe(1);
    expect(props["septicTank.tanks.0.tankMaterial"].provenance.sourceUrl).toBe(
      "/api/inspections/insp-1/records/rec-1#page=2",
    );
    expect(props["facilityInfo.hasSitePlan"].provenance.page).toBe(3);
  });

  it("carries verbatim evidence and a one-line explanation", () => {
    const cap = props["septicTank.tanks.0.tankCapacity"].provenance;
    expect(cap.evidence).toBe("4.02 A314 Septic Tank Qty 1 Capacity 1250");
    expect(cap.explanation).toBe("Permit OW-17-00474 · Discharge Authorization p.1");
  });

  it("puts disposal count and dimensions into the explanation, not the value", () => {
    const d = props["disposalWorks.disposalType"];
    expect(d.value).toBe("seepage_pit");
    expect(d.provenance.explanation).toContain("× 2");
    expect(d.provenance.explanation).toContain("Overall 28'0\" Effective 24'0\"");
  });

  it("caps cesspool and system type at 0.7 even when the model is sure (suggestion only)", () => {
    expect(props["facilityInfo.isCesspool"].provenance.confidence).toBe(0.7);
    expect(props["facilityInfo.facilitySystemTypes"].provenance.confidence).toBe(0.7);
    const lowSure = byPath(mapPermitFacts({ ...daFacts(), isCesspool: f(true, 0.5) }, record));
    expect(lowSure["facilityInfo.isCesspool"].provenance.confidence).toBe(0.5);
  });
});

describe("mapPermitFacts — document kinds", () => {
  it("maps an approval_to_construct to the approval fields with the spec's explanation", () => {
    const facts: PermitFacts = {
      ...emptyPermitFacts(),
      documentKind: "approval_to_construct",
      permitNumber: f("000972", 0.8, 1),
      issueDate: f("2000-03-15", 0.85, 1),
    };
    const props = byPath(mapPermitFacts(facts, { ...record, permitNumber: "000972" }, { now: NOW }));
    expect(props["facilityInfo.hasApprovalOfConstruction"].value).toBe(true);
    expect(props["facilityInfo.approvalPermitNo"].value).toBe("000972");
    expect(props["facilityInfo.hasDischargeAuth"]).toBeUndefined();
    expect(props["facilityInfo.facilityAge"].value).toBe("26");
    expect(props["facilityInfo.facilityAgeEstimateExplanation"].value).toBe(
      "Approval to construct issued 03/2000 (permit 000972)",
    );
    expect(props["facilityInfo.facilityAge"].provenance.explanation).toBe(
      "Approval to construct issued 03/2000 (permit 000972)",
    );
  });

  it("treats final_da like a discharge authorization", () => {
    const props = byPath(mapPermitFacts({ ...daFacts(), documentKind: "final_da" }, record, { now: NOW }));
    expect(props["facilityInfo.hasDischargeAuth"].value).toBe(true);
    expect(props["facilityInfo.dischargeAuthPermitNo"].value).toBe("OW-17-00474");
    expect(props["facilityInfo.facilityAgeEstimateExplanation"].value).toBe(
      "Discharge authorization issued 05/2017 (permit OW-17-00474)",
    );
  });

  it("proposes no permit-number fields for notice_of_transfer / other, but still recordsAvailable", () => {
    for (const documentKind of ["notice_of_transfer", "other"] as const) {
      const props = byPath(mapPermitFacts({ ...emptyPermitFacts(), documentKind }, record));
      expect(Object.keys(props)).toEqual(["facilityInfo.recordsAvailable"]);
    }
  });

  it("falls back to the EDMS permit number when the model found none", () => {
    const facts: PermitFacts = { ...emptyPermitFacts(), documentKind: "discharge_authorization" };
    const props = byPath(mapPermitFacts(facts, record));
    expect(props["facilityInfo.dischargeAuthPermitNo"].value).toBe("OW-17-00474");
    expect(props["facilityInfo.dischargeAuthPermitNo"].provenance.confidence).toBe(0.9);
    expect(props["facilityInfo.dischargeAuthPermitNo"].provenance.evidence).toBe("EDMS index: OW-17-00474");
  });

  it("uses the EDMS docType as the label when documentKind is other", () => {
    const props = byPath(mapPermitFacts({ ...emptyPermitFacts(), documentKind: "other" }, { ...record, docType: "PLAN REVIEW" }));
    expect(props["facilityInfo.recordsAvailable"].provenance.explanation).toBe("Permit OW-17-00474 on file (PLAN REVIEW)");
  });
});

describe("mapPermitFacts — edge cases", () => {
  it("computes whole years since the issue date (birthday not yet reached)", () => {
    const facts: PermitFacts = { ...emptyPermitFacts(), issueDate: f("2000-12-01", 0.9) };
    expect(byPath(mapPermitFacts(facts, record, { now: NOW }))["facilityInfo.facilityAge"].value).toBe("25");
  });

  it("skips the age fields when the issue date is not a real date", () => {
    const facts: PermitFacts = { ...emptyPermitFacts(), issueDate: f("March 2000", 0.9) };
    expect(byPath(mapPermitFacts(facts, record))["facilityInfo.facilityAge"]).toBeUndefined();
  });

  it("infers hasSitePlan at 0.6 from the notes when the model gave no verdict", () => {
    const facts: PermitFacts = { ...emptyPermitFacts(), notes: "Page 4 is an engineer's site plan." };
    const p = byPath(mapPermitFacts(facts, record))["facilityInfo.hasSitePlan"];
    expect(p.value).toBe(true);
    expect(p.provenance.confidence).toBe(0.6);
  });

  it("proposes nothing for isCesspool false and rounds numeric values", () => {
    const facts: PermitFacts = {
      ...emptyPermitFacts(),
      isCesspool: f(false, 0.9),
      designFlowGpd: f(449.6, 0.9),
      tanks: [{ capacityGal: f(1249.5, 0.9), material: null, model: null, dimensions: null }],
    };
    const props = byPath(mapPermitFacts(facts, record));
    expect(props["facilityInfo.isCesspool"]).toBeUndefined();
    expect(props["designFlow.estimatedDesignFlow"].value).toBe("450");
    expect(props["septicTank.tanks.0.tankCapacity"].value).toBe("1250");
  });

  it("counts every tank for numberOfTanks", () => {
    const facts: PermitFacts = {
      ...emptyPermitFacts(),
      tanks: [
        { capacityGal: f(1000, 0.9), material: null, model: null, dimensions: null },
        { capacityGal: null, material: f("plastic" as const, 0.7, 2), model: null, dimensions: null },
      ],
    };
    const props = byPath(mapPermitFacts(facts, record));
    const p = props["septicTank.numberOfTanks"];
    expect(p.value).toBe("2");
    expect(p.provenance.confidence).toBe(0.9);
    expect(p.provenance.explanation).toContain("lists 2 tanks");
    // amendment A4: every tank gets its own septicTank.tanks.<i>.* proposals
    expect(props["septicTank.tanks.0.tankCapacity"].value).toBe("1000");
    expect(props["septicTank.tanks.0.capacityBasis"].value).toBe("permit_document");
    expect(props["septicTank.tanks.1.tankMaterial"].value).toBe("plastic");
    expect(props["septicTank.tanks.1.tankMaterial"].provenance.page).toBe(2);
    expect(props["septicTank.tanks.1.tankCapacity"]).toBeUndefined();
  });

  it("proposes tank dimensions as written", () => {
    const facts: PermitFacts = {
      ...emptyPermitFacts(),
      tanks: [{ capacityGal: null, material: null, model: null, dimensions: f("5' x 8' x 5'", 0.8) }],
    };
    const props = byPath(mapPermitFacts(facts, record));
    expect(props["septicTank.tanks.0.tankDimensions"].value).toBe("5' x 8' x 5'");
    expect(props["septicTank.numberOfTanks"].value).toBe("1");
  });
});

describe("dedupeProposals", () => {
  const permit = (fieldPath: string, value: string, confidence: number): ProposedField => ({
    fieldPath,
    value,
    kind: "fill",
    provenance: { source: "permit", confidence, explanation: "p" },
  });
  const listing = (fieldPath: string, value: string, confidence: number): ProposedField => ({
    fieldPath,
    value,
    kind: "fill",
    provenance: { source: "listing", confidence, explanation: "l" },
  });

  it("lets permit beat listing for the same field regardless of confidence", () => {
    const out = dedupeProposals([listing("designFlow.numberOfBedrooms", "4", 0.95), permit("designFlow.numberOfBedrooms", "3", 0.7)]);
    expect(out).toHaveLength(1);
    expect(out[0].value).toBe("3");
  });

  it("keeps the higher confidence within one source and preserves first-seen order", () => {
    const out = dedupeProposals([
      permit("septicTank.tanks.0.tankCapacity", "1000", 0.6),
      permit("facilityInfo.waterSource", "private_well", 0.9),
      permit("septicTank.tanks.0.tankCapacity", "1250", 0.97),
    ]);
    expect(out.map((p) => [p.fieldPath, p.value])).toEqual([
      ["septicTank.tanks.0.tankCapacity", "1250"],
      ["facilityInfo.waterSource", "private_well"],
    ]);
  });

  it("keeps a warning and a fill for the same field apart", () => {
    const warning: ProposedField = {
      fieldPath: "facilityInfo.wastewaterSource",
      value: "",
      kind: "warning",
      provenance: { source: "listing", confidence: 0.8, explanation: 'Listing says "Sewer"' },
    };
    const out = dedupeProposals([warning, permit("facilityInfo.wastewaterSource", "residential", 0.9)]);
    expect(out).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/prefill/__tests__/map-facts-to-fields.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/prefill/map-facts-to-fields"`.

- [ ] **Step 3: Write the mapping module**

```ts
// src/lib/prefill/map-facts-to-fields.ts
/**
 * Pure mapping from extracted facts to ProposedField[] (spec §7). The client
 * hook merges these into the form (merge.ts); nothing here writes anywhere.
 */
import type { Fact, PermitDocumentKind, PermitFacts } from "@/lib/ai/permit-extraction-schema";
import type { PrefillSource, ProposedField } from "./types";

export interface PermitRecordRef {
  id: string;
  permitNumber: string;
  docType: string;
  inspectionId: string;
}

export interface MapPermitFactsOptions {
  /** Injected in tests; defaults to `new Date()` */
  now?: Date;
}

/** Spec §7: cesspool and system type are suggestion-only — kept under PREFILL_FILL_THRESHOLD (0.75) */
export const CESSPOOL_MAX_CONFIDENCE = 0.7;
export const SYSTEM_TYPE_MAX_CONFIDENCE = 0.7;

const DOC_KIND_LABEL: Record<Exclude<PermitDocumentKind, "other">, string> = {
  approval_to_construct: "Approval to Construct",
  discharge_authorization: "Discharge Authorization",
  final_da: "Final Discharge Authorization",
  notice_of_transfer: "Notice of Transfer",
  abandonment: "Abandonment",
};

type Provenance = ProposedField["provenance"];

function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return null;
  const d = new Date(`${value.trim()}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Whole years from `from` to `now` (UTC), never negative */
function wholeYearsBetween(from: Date, now: Date): number {
  let years = now.getUTCFullYear() - from.getUTCFullYear();
  const beforeAnniversary =
    now.getUTCMonth() < from.getUTCMonth() ||
    (now.getUTCMonth() === from.getUTCMonth() && now.getUTCDate() < from.getUTCDate());
  if (beforeAnniversary) years -= 1;
  return Math.max(0, years);
}

export function mapPermitFacts(
  facts: PermitFacts,
  record: PermitRecordRef,
  opts: MapPermitFactsOptions = {},
): ProposedField[] {
  const out: ProposedField[] = [];
  const label = facts.documentKind === "other" ? record.docType : DOC_KIND_LABEL[facts.documentKind];
  const permitNo = facts.permitNumber?.value.trim() || record.permitNumber;
  const url = (page: number) => `/api/inspections/${record.inspectionId}/records/${record.id}#page=${page}`;

  const prov = (fact: Fact<unknown>, extra: Partial<Provenance> = {}): Provenance => ({
    source: "permit",
    confidence: fact.confidence,
    explanation: `Permit ${permitNo} · ${label} p.${fact.page}`,
    evidence: fact.evidence || undefined,
    sourceUrl: url(fact.page),
    recordId: record.id,
    page: fact.page,
    ...extra,
  });
  const fill = (fieldPath: string, value: ProposedField["value"], provenance: Provenance) =>
    out.push({ fieldPath, value, kind: "fill", provenance });

  // §7 row: any selected permit found → recordsAvailable "yes" (conf 1.0)
  fill("facilityInfo.recordsAvailable", "yes", {
    source: "permit",
    confidence: 1,
    explanation: `Permit ${permitNo} on file (${label})`,
    sourceUrl: url(1),
    recordId: record.id,
    page: 1,
  });

  // §7 rows: permit # by document kind (the EDMS index is typed metadata → 0.9 when the model found none)
  const permitFact: Fact<string> = facts.permitNumber ?? {
    value: record.permitNumber,
    confidence: 0.9,
    page: 1,
    evidence: `EDMS index: ${record.permitNumber}`,
    handwritten: false,
  };
  if (facts.documentKind === "approval_to_construct") {
    fill("facilityInfo.hasApprovalOfConstruction", true, prov(permitFact));
    fill("facilityInfo.approvalPermitNo", permitNo, prov(permitFact));
  } else if (facts.documentKind === "discharge_authorization" || facts.documentKind === "final_da") {
    fill("facilityInfo.hasDischargeAuth", true, prov(permitFact));
    fill("facilityInfo.dischargeAuthPermitNo", permitNo, prov(permitFact));
  }

  // §7 row: site plan page detected (model verdict, else the notes mention one)
  if (facts.hasSitePlan?.value === true) {
    fill("facilityInfo.hasSitePlan", true, prov(facts.hasSitePlan));
  } else if (facts.hasSitePlan == null && /site plan|as-built|plot plan/i.test(facts.notes)) {
    fill("facilityInfo.hasSitePlan", true, {
      source: "permit",
      confidence: 0.6,
      explanation: `Permit ${permitNo} · notes mention a site plan`,
      evidence: facts.notes.slice(0, 300),
      sourceUrl: url(1),
      recordId: record.id,
      page: 1,
    });
  }

  // §7 row: issueDate → facilityAge (years) + explanation "Approval to construct issued MM/YYYY (permit N)"
  if (facts.issueDate) {
    const issued = parseIsoDate(facts.issueDate.value);
    if (issued) {
      const years = wholeYearsBetween(issued, opts.now ?? new Date());
      const mmYYYY = `${String(issued.getUTCMonth() + 1).padStart(2, "0")}/${issued.getUTCFullYear()}`;
      const verb =
        facts.documentKind === "approval_to_construct"
          ? "Approval to construct issued"
          : facts.documentKind === "discharge_authorization" || facts.documentKind === "final_da"
            ? "Discharge authorization issued"
            : "Permit issued";
      const explanation = `${verb} ${mmYYYY} (permit ${permitNo})`;
      fill("facilityInfo.facilityAge", String(years), prov(facts.issueDate, { explanation }));
      fill("facilityInfo.facilityAgeEstimateExplanation", explanation, prov(facts.issueDate, { explanation }));
    }
  }

  // §7 rows + amendment A1/A4: every extracted tank → septicTank.tanks.<i>.* (react-hook-form dotted form)
  facts.tanks.forEach((tank, i) => {
    const base = `septicTank.tanks.${i}`;
    if (tank.capacityGal) {
      fill(`${base}.tankCapacity`, String(Math.round(tank.capacityGal.value)), prov(tank.capacityGal));
      fill(`${base}.capacityBasis`, "permit_document", prov(tank.capacityGal));
    }
    if (tank.material) fill(`${base}.tankMaterial`, tank.material.value, prov(tank.material));
    if (tank.dimensions) fill(`${base}.tankDimensions`, tank.dimensions.value, prov(tank.dimensions));
  });
  if (facts.tanks.length > 0) {
    const best = facts.tanks
      .flatMap((t) => [t.capacityGal, t.material, t.model, t.dimensions])
      .filter((x): x is NonNullable<typeof x> => x != null)
      .sort((a, b) => b.confidence - a.confidence)[0];
    if (best) {
      const n = facts.tanks.length;
      fill("septicTank.numberOfTanks", String(n), prov(best, {
        explanation: `Permit ${permitNo} · ${label} lists ${n} tank${n === 1 ? "" : "s"} (p.${best.page})`,
      }));
    }
  }

  // §7 row: disposal.type — count and dimensions go into the explanation, not a field
  if (facts.disposal.type) {
    const detail = [
      facts.disposal.count ? `× ${facts.disposal.count.value}` : "",
      facts.disposal.dimensions ? facts.disposal.dimensions.value : "",
    ].filter(Boolean);
    const explanation = `Permit ${permitNo} · ${label} p.${facts.disposal.type.page}${detail.length ? ` · ${detail.join(" · ")}` : ""}`;
    fill("disposalWorks.disposalType", facts.disposal.type.value, prov(facts.disposal.type, { explanation }));
  }

  // §7 row: bedrooms (permit wins over listing — enforced in dedupeProposals)
  if (facts.bedrooms) {
    fill("designFlow.numberOfBedrooms", String(facts.bedrooms.value), prov(facts.bedrooms));
  }

  // §7 row: design flow + basis
  if (facts.designFlowGpd) {
    fill("designFlow.estimatedDesignFlow", String(Math.round(facts.designFlowGpd.value)), prov(facts.designFlowGpd));
    fill("designFlow.designFlowBasis", "permit_documents", prov(facts.designFlowGpd));
  }

  // §7 row: water source (permit wins over listing — dedupeProposals)
  if (facts.waterSource) {
    fill("facilityInfo.waterSource", facts.waterSource.value, prov(facts.waterSource));
  }

  // §7 row: isCesspool true → ALWAYS a suggestion (form enum is "yes"/"no"); it voids the report pages
  if (facts.isCesspool?.value === true) {
    fill("facilityInfo.isCesspool", "yes", prov(facts.isCesspool, {
      confidence: Math.min(facts.isCesspool.confidence, CESSPOOL_MAX_CONFIDENCE),
    }));
  }

  // §7 row: systemType → suggestion only
  if (facts.systemType) {
    fill("facilityInfo.facilitySystemTypes", [facts.systemType.value], prov(facts.systemType, {
      confidence: Math.min(facts.systemType.confidence, SYSTEM_TYPE_MAX_CONFIDENCE),
    }));
  }

  // §7 row: isAbandonment → tile banner only, no proposal
  return out;
}

const SOURCE_RANK: Record<PrefillSource, number> = { permit: 3, assessor: 2, listing: 1, scan: 0 };

/**
 * Combine stage proposals: permit beats listing for the same fieldPath; higher
 * confidence wins within a source. Warnings never collide with fills.
 * Output keeps first-seen order per key.
 */
export function dedupeProposals(proposals: ProposedField[]): ProposedField[] {
  const best = new Map<string, ProposedField>();
  for (const p of proposals) {
    const key = `${p.kind}:${p.fieldPath}`;
    const cur = best.get(key);
    if (!cur) {
      best.set(key, p);
      continue;
    }
    const rankDiff = SOURCE_RANK[p.provenance.source] - SOURCE_RANK[cur.provenance.source];
    if (rankDiff > 0 || (rankDiff === 0 && p.provenance.confidence > cur.provenance.confidence)) {
      best.set(key, p);
    }
  }
  return [...best.values()];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/prefill/__tests__/map-facts-to-fields.test.ts`
Expected: PASS (36 tests: 17 table rows + 19 others).

- [ ] **Step 5: Commit**

```bash
git add src/lib/prefill/map-facts-to-fields.ts src/lib/prefill/__tests__/map-facts-to-fields.test.ts
git commit -m "feat(prefill): map permit facts to form proposals (spec §7) + dedupe across sources"
```

---

### Task 8: `extractStoredRecords` — rank, download, extract, persist, propose

**Files:**
- Create: `src/lib/prefill/permits/extract-records.ts`
- Test: `src/lib/prefill/permits/__tests__/extract-records.test.ts`

**Interfaces:**
- Consumes: `extractPermitFactsFromPdf`, `ExtractionError`, `ExtractPermitFactsResult` (Tasks 5–6); `PermitFacts` (Task 1); `mapPermitFacts` (Task 7); `isExtractableDocType`, `rankForExtraction` from phase 2's `src/lib/prefill/permits/doc-types.ts` (`rankForExtraction<T extends { docType: string; docDate?: string }>(docs: T[]): T[]` — class rank ascending, newest first); `StageContext` (`src/lib/prefill/stage.ts`, amendment A2); `ProposedField`, `PermitArchive`, `ExtractionStatus`, `MAX_DOCUMENTS_PER_RUN`, `MAX_DOCUMENT_BYTES` (types.ts); `db`, `inspectionRecords` (phase 1 schema); `createAdminClient`; `RECORD_BUCKET` from phase 2's `src/lib/storage/record-storage.ts` (`"inspection-media"`; records live at `records/{inspectionId}/{recordId}.pdf`, bucket-relative).
- Produces: `interface StoredRecord { id; inspectionId; permitNumber; docType; source: PermitArchive; storagePath; docDate: string | null; sizeBytes: number | null; extractionStatus: ExtractionStatus }`; `interface RecordExtractionPatch { extractionStatus; extractionError?; extracted? }`; `interface ExtractRecordsDeps { loadPdf; extract; persist; log }`; `defaultExtractRecordsDeps()`; `interface ExtractRecordsResult { proposals; done; failed; skipped; abandonmentPermits: string[]; estimatedCostUsd; highlights: string[] }`; `rankRecordsForExtraction(records)`; `extractStoredRecords(records, ctx, deps?)`; `describeFacts(permitNumber, facts)`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/prefill/permits/__tests__/extract-records.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

// extract-records imports db/admin/storage for its default deps only; the tests inject deps, so stub the modules
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/storage/record-storage", () => ({ RECORD_BUCKET: "inspection-media" }));

import { ExtractionError } from "@/lib/ai/extract-permit-facts";
import { emptyPermitFacts, type PermitFacts } from "@/lib/ai/permit-extraction-schema";
import {
  describeFacts,
  extractStoredRecords,
  rankRecordsForExtraction,
  type ExtractRecordsDeps,
  type StoredRecord,
} from "@/lib/prefill/permits/extract-records";
import type { StageContext } from "@/lib/prefill/stage";

const f = <T>(value: T, confidence = 0.9, page = 1) => ({ value, confidence, page, evidence: `ev:${String(value)}`, handwritten: false });

function rec(over: Partial<StoredRecord> & { id: string }): StoredRecord {
  return {
    inspectionId: "insp-1",
    permitNumber: "OW-17-00474",
    docType: "PERMIT",
    source: "edms_env",
    storagePath: `records/insp-1/${over.id}.pdf`,
    docDate: "2017-05-12",
    sizeBytes: 500_000,
    extractionStatus: "pending",
    ...over,
  };
}

const daFacts: PermitFacts = {
  ...emptyPermitFacts(),
  documentKind: "discharge_authorization",
  permitNumber: f("OW-17-00474", 0.98),
  tanks: [{ capacityGal: f(1250, 0.97), material: null, model: null, dimensions: null }],
  disposal: { ...emptyPermitFacts().disposal, type: f("seepage_pit" as const, 0.97), count: f(2, 0.97), dimensions: null, absorptionAreaSqft: null },
  designFlowGpd: f(450, 0.96),
};

function ctx(over: Partial<StageContext> = {}): StageContext & { progress: ReturnType<typeof vi.fn> } {
  return {
    inspectionId: "insp-1",
    runId: "run-1",
    signal: new AbortController().signal,
    progress: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as StageContext & { progress: ReturnType<typeof vi.fn> };
}

function deps(over: Partial<ExtractRecordsDeps> = {}) {
  const d = {
    loadPdf: vi.fn().mockResolvedValue(new Uint8Array([37, 80, 68, 70])),
    extract: vi.fn().mockResolvedValue({
      facts: daFacts,
      passes: 1,
      escalations: 0,
      pageCount: 4,
      usage: { calls: [], estimatedCostUsd: 0.04 },
    }),
    persist: vi.fn().mockResolvedValue(undefined),
    log: vi.fn(),
    ...over,
  };
  return d as ExtractRecordsDeps & { [K in keyof ExtractRecordsDeps]: ReturnType<typeof vi.fn> };
}

describe("rankRecordsForExtraction", () => {
  it("orders PERMIT/FINAL DA (newest first) → PERMIT SUB → NOTICE OF TRANSFER and never PLAN REVIEW / SUB", () => {
    const records = [
      rec({ id: "sub", docType: "SUB" }),
      rec({ id: "old", docType: "PERMIT", docDate: "2000-03-15" }),
      rec({ id: "transfer", docType: "NOTICE OF TRANSFER", docDate: "2021-01-01" }),
      rec({ id: "new", docType: "FINAL DA", docDate: "2017-05-12" }),
      rec({ id: "psub", docType: "PERMIT SUB", docDate: "2016-01-01" }),
      rec({ id: "big", docType: "PERMIT", docDate: "2024-01-01", sizeBytes: 30 * 1024 * 1024 }),
      rec({ id: "done-before", docType: "PERMIT", docDate: "2025-01-01", extractionStatus: "skipped" }),
    ];
    const { toExtract, toSkip } = rankRecordsForExtraction(records);
    expect(toExtract.map((r) => r.id)).toEqual(["new", "old", "psub"]);
    expect(toSkip.map((s) => [s.record.id, s.reason])).toEqual([
      ["sub", "SUB documents are not read"],
      ["transfer", "Only the first 3 documents are read per run"],
      ["big", "Document is larger than 25 MB"],
    ]);
  });

  it("only considers records phase 2 left as pending", () => {
    const { toExtract, toSkip } = rankRecordsForExtraction([
      rec({ id: "already", extractionStatus: "done" }),
      rec({ id: "skipped-by-p2", extractionStatus: "skipped" }),
      rec({ id: "unstored", storagePath: "" }),
      rec({ id: "todo" }),
    ]);
    expect(toExtract.map((r) => r.id)).toEqual(["todo"]);
    expect(toSkip.map((s) => [s.record.id, s.reason])).toEqual([["unstored", "Document was not stored"]]);
  });

  it("extracts an ABANDONMENT record last and skips unknown types", () => {
    const { toExtract, toSkip } = rankRecordsForExtraction([
      rec({ id: "ab", docType: "ABANDONMENT", docDate: "2022-01-01" }),
      rec({ id: "odd", docType: "FEE RECEIPT" }),
      rec({ id: "p", docType: "PERMIT", docDate: "2001-01-01" }),
    ]);
    expect(toExtract.map((r) => r.id)).toEqual(["p", "ab"]);
    expect(toSkip.map((s) => s.reason)).toEqual(["FEE RECEIPT documents are not read"]);
  });
});

describe("extractStoredRecords", () => {
  beforeEach(() => vi.clearAllMocks());

  it("downloads, extracts, persists `done` with the facts, reports progress and returns proposals", async () => {
    const d = deps();
    const c = ctx();
    const result = await extractStoredRecords([rec({ id: "r1" })], c, d);

    expect(d.loadPdf).toHaveBeenCalledWith("records/insp-1/r1.pdf");
    expect(d.extract).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      { permitNumber: "OW-17-00474", docType: "PERMIT", archive: "edms_env" },
      { signal: c.signal },
    );
    expect(c.progress).toHaveBeenCalledWith({ status: "running", summary: "Reading OW-17-00474…" });
    expect(d.persist).toHaveBeenCalledWith("r1", { extractionStatus: "done", extractionError: null, extracted: daFacts });
    expect(result.done).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.estimatedCostUsd).toBeCloseTo(0.04, 5);
    const cap = result.proposals.find((p) => p.fieldPath === "septicTank.tanks.0.tankCapacity");
    expect(cap?.value).toBe("1250");
    expect(cap?.provenance.sourceUrl).toBe("/api/inspections/insp-1/records/r1#page=1");
    expect(result.highlights).toEqual(["OW-17-00474: 1,250 gal tank · 2 seepage pits · 450 gpd design flow"]);
    expect(d.log).toHaveBeenCalledWith(expect.stringContaining("OW-17-00474: 1 pass(es), 0 escalation(s)"));
  });

  it("marks a record failed with the ExtractionError message and continues with the next one", async () => {
    const d = deps();
    d.extract
      .mockRejectedValueOnce(new ExtractionError("Claude API error: 500 boom"))
      .mockResolvedValueOnce({ facts: daFacts, passes: 1, escalations: 0, pageCount: 4, usage: { calls: [], estimatedCostUsd: 0.03 } });
    const result = await extractStoredRecords(
      [rec({ id: "r1", docDate: "2020-01-01" }), rec({ id: "r2", docDate: "2019-01-01" })],
      ctx(),
      d,
    );
    expect(d.persist).toHaveBeenCalledWith("r1", { extractionStatus: "failed", extractionError: "Claude API error: 500 boom" });
    expect(d.persist).toHaveBeenCalledWith("r2", expect.objectContaining({ extractionStatus: "done" }));
    expect(result.failed).toBe(1);
    expect(result.done).toBe(1);
    expect(result.proposals.length).toBeGreaterThan(0);
  });

  it("marks a record failed when the download fails", async () => {
    const d = deps({ loadPdf: vi.fn().mockRejectedValue(new Error("Object not found")) });
    const result = await extractStoredRecords([rec({ id: "r1" })], ctx(), d);
    expect(d.persist).toHaveBeenCalledWith("r1", { extractionStatus: "failed", extractionError: "Object not found" });
    expect(result.failed).toBe(1);
    expect(d.extract).not.toHaveBeenCalled();
  });

  it("persists `skipped` with the reason for records beyond the cap or of unread types", async () => {
    const d = deps();
    await extractStoredRecords(
      [rec({ id: "a", docDate: "2020-01-01" }), rec({ id: "b", docDate: "2019-01-01" }), rec({ id: "c", docDate: "2018-01-01" }), rec({ id: "d", docDate: "2017-01-01" }), rec({ id: "plan", docType: "PLAN REVIEW" })],
      ctx(),
      d,
    );
    expect(d.persist).toHaveBeenCalledWith("d", { extractionStatus: "skipped", extractionError: "Only the first 3 documents are read per run" });
    expect(d.persist).toHaveBeenCalledWith("plan", { extractionStatus: "skipped", extractionError: "PLAN REVIEW documents are not read" });
    expect(d.extract).toHaveBeenCalledTimes(3);
  });

  it("flags abandonment documents and proposes nothing from them", async () => {
    const facts: PermitFacts = { ...emptyPermitFacts(), documentKind: "abandonment", isAbandonment: true, permitNumber: f("AB-01", 0.9) };
    const d = deps({ extract: vi.fn().mockResolvedValue({ facts, passes: 1, escalations: 0, pageCount: 2, usage: { calls: [], estimatedCostUsd: 0.01 } }) });
    const result = await extractStoredRecords([rec({ id: "ab", docType: "ABANDONMENT", permitNumber: "AB-01" })], ctx(), d);
    expect(result.abandonmentPermits).toEqual(["AB-01"]);
    expect(result.proposals).toEqual([]);
    expect(result.highlights).toEqual([]);
    expect(result.done).toBe(1);
  });

  it("fails remaining records without calling Claude once the run budget is exhausted", async () => {
    const controller = new AbortController();
    controller.abort();
    const d = deps();
    const result = await extractStoredRecords([rec({ id: "r1" })], ctx({ signal: controller.signal }), d);
    expect(d.extract).not.toHaveBeenCalled();
    expect(d.persist).toHaveBeenCalledWith("r1", {
      extractionStatus: "failed",
      extractionError: "Prefill time budget exceeded before this document was read",
    });
    expect(result.failed).toBe(1);
  });
});

describe("describeFacts", () => {
  it("summarises the key facts in one line and says when nothing was found", () => {
    expect(describeFacts("000972", { ...emptyPermitFacts(), tanks: [{ capacityGal: f(1200), material: null, model: null, dimensions: null }], disposal: { ...emptyPermitFacts().disposal, type: f("seepage_pit" as const) } })).toBe(
      "000972: 1,200 gal tank · seepage pit",
    );
    expect(describeFacts("000972", emptyPermitFacts())).toBe("000972: no system facts found");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/prefill/permits/__tests__/extract-records.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/prefill/permits/extract-records"`.

- [ ] **Step 3: Write the module**

```ts
// src/lib/prefill/permits/extract-records.ts
/**
 * Runs extraction over the permit documents a run has stored (spec §5.2 step 3,
 * §6, §10): ranks them, reads at most MAX_DOCUMENTS_PER_RUN, persists each
 * record's extraction status/facts, and turns the facts into proposals.
 * Every failure is per-record; this function never throws.
 */
import { eq } from "drizzle-orm";
import {
  ExtractionError,
  type ExtractPermitFactsResult,
  extractPermitFactsFromPdf,
} from "@/lib/ai/extract-permit-facts";
import type { PermitFacts } from "@/lib/ai/permit-extraction-schema";
import { db } from "@/lib/db";
import { inspectionRecords } from "@/lib/db/schema";
import { RECORD_BUCKET } from "@/lib/storage/record-storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { mapPermitFacts } from "../map-facts-to-fields";
import type { StageContext } from "@/lib/prefill/stage";
import {
  type ExtractionStatus,
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENTS_PER_RUN,
  type PermitArchive,
  type ProposedField,
} from "../types";
import { isExtractableDocType, rankForExtraction } from "./doc-types";

export interface StoredRecord {
  id: string;
  inspectionId: string;
  permitNumber: string;
  docType: string;
  source: PermitArchive;
  /** Bucket-relative path in `inspection-media` */
  storagePath: string;
  docDate: string | null;
  sizeBytes: number | null;
  /** Phase 2 stores at most MAX_DOCUMENTS_PER_RUN records as "pending" and the rest as "skipped" */
  extractionStatus: ExtractionStatus;
}

export interface RecordExtractionPatch {
  extractionStatus: ExtractionStatus;
  extractionError?: string | null;
  extracted?: PermitFacts | null;
}

export interface ExtractRecordsDeps {
  loadPdf: (storagePath: string) => Promise<Uint8Array>;
  extract: (
    bytes: Uint8Array,
    meta: { permitNumber: string; docType: string; archive: PermitArchive },
    opts: { signal: AbortSignal },
  ) => Promise<ExtractPermitFactsResult>;
  persist: (recordId: string, patch: RecordExtractionPatch) => Promise<void>;
  log: (line: string) => void;
}

export interface ExtractRecordsResult {
  proposals: ProposedField[];
  done: number;
  failed: number;
  skipped: number;
  /** Permit numbers of documents that record an abandonment (tile banner) */
  abandonmentPermits: string[];
  estimatedCostUsd: number;
  /** One line per read document for the stage summary */
  highlights: string[];
}

export function defaultExtractRecordsDeps(): ExtractRecordsDeps {
  return {
    loadPdf: async (storagePath) => {
      const { data, error } = await createAdminClient().storage.from(RECORD_BUCKET).download(storagePath);
      if (error || !data) {
        throw new ExtractionError(`Could not download stored document: ${error?.message ?? "empty response"}`);
      }
      return new Uint8Array(await data.arrayBuffer());
    },
    extract: (bytes, meta, opts) => extractPermitFactsFromPdf(bytes, meta, opts),
    persist: async (recordId, patch) => {
      await db
        .update(inspectionRecords)
        .set({
          extractionStatus: patch.extractionStatus,
          extractionError: patch.extractionError ?? null,
          ...(patch.extracted !== undefined ? { extracted: patch.extracted } : {}),
        })
        .where(eq(inspectionRecords.id, recordId));
    },
    log: (line) => console.info(line),
  };
}

function skipReason(r: StoredRecord): string {
  if (!r.storagePath) return "Document was not stored";
  if ((r.sizeBytes ?? 0) > MAX_DOCUMENT_BYTES) {
    return `Document is larger than ${Math.round(MAX_DOCUMENT_BYTES / 1024 / 1024)} MB`;
  }
  if (!isExtractableDocType(r.docType)) return `${r.docType} documents are not read`;
  return `Only the first ${MAX_DOCUMENTS_PER_RUN} documents are read per run`;
}

/**
 * Which pending records to read (rank order, ≤ MAX_DOCUMENTS_PER_RUN) and which
 * pending records to mark skipped. Records phase 2 already marked
 * skipped/failed/done are left alone.
 */
export function rankRecordsForExtraction(records: StoredRecord[]): {
  toExtract: StoredRecord[];
  toSkip: Array<{ record: StoredRecord; reason: string }>;
} {
  const pending = records.filter((r) => r.extractionStatus === "pending");
  // phase 2 marks an unstored document (storage_path "") failed/skipped, but never trust a blank path
  const eligible = pending.filter(
    (r) => r.storagePath !== "" && isExtractableDocType(r.docType) && (r.sizeBytes ?? 0) <= MAX_DOCUMENT_BYTES,
  );
  // phase 2's ranking (class rank, then newest first) wants `docDate?: string`, DB rows carry null
  const ranked = rankForExtraction(eligible.map((r) => ({ ...r, docDate: r.docDate ?? undefined })));
  const toExtract = ranked
    .slice(0, MAX_DOCUMENTS_PER_RUN)
    .map((r) => eligible.find((e) => e.id === r.id) as StoredRecord);
  const chosen = new Set(toExtract.map((r) => r.id));
  const toSkip = pending.filter((r) => !chosen.has(r.id)).map((record) => ({ record, reason: skipReason(record) }));
  return { toExtract, toSkip };
}

const DISPOSAL_LABEL: Record<string, string> = {
  trench: "trench",
  bed: "bed",
  chamber: "chamber",
  seepage_pit: "seepage pit",
  other: "disposal works",
};

/** "OW-17-00474: 1,250 gal tank · 2 seepage pits · 450 gpd design flow" */
export function describeFacts(permitNumber: string, facts: PermitFacts): string {
  const bits: string[] = [];
  const gal = facts.tanks[0]?.capacityGal?.value;
  if (gal != null) bits.push(`${Math.round(gal).toLocaleString("en-US")} gal tank`);
  if (facts.disposal.type) {
    const n = facts.disposal.count?.value;
    const label = DISPOSAL_LABEL[facts.disposal.type.value] ?? facts.disposal.type.value;
    bits.push(n != null && n > 1 ? `${n} ${label}s` : label);
  }
  if (facts.designFlowGpd) bits.push(`${Math.round(facts.designFlowGpd.value)} gpd design flow`);
  if (facts.isAbandonment) bits.push("ABANDONMENT");
  return `${permitNumber}: ${bits.length ? bits.join(" · ") : "no system facts found"}`;
}

export async function extractStoredRecords(
  records: StoredRecord[],
  ctx: StageContext,
  deps: ExtractRecordsDeps = defaultExtractRecordsDeps(),
): Promise<ExtractRecordsResult> {
  const { toExtract, toSkip } = rankRecordsForExtraction(records);
  const result: ExtractRecordsResult = {
    proposals: [],
    done: 0,
    failed: 0,
    skipped: 0,
    abandonmentPermits: [],
    estimatedCostUsd: 0,
    highlights: [],
  };

  for (const { record, reason } of toSkip) {
    await deps.persist(record.id, { extractionStatus: "skipped", extractionError: reason });
    result.skipped++;
  }

  for (const record of toExtract) {
    if (ctx.signal.aborted) {
      await deps.persist(record.id, {
        extractionStatus: "failed",
        extractionError: "Prefill time budget exceeded before this document was read",
      });
      result.failed++;
      continue;
    }
    await ctx.progress({ status: "running", summary: `Reading ${record.permitNumber}…` });
    try {
      const bytes = await deps.loadPdf(record.storagePath);
      const { facts, usage, passes, escalations } = await deps.extract(
        bytes,
        { permitNumber: record.permitNumber, docType: record.docType, archive: record.source },
        { signal: ctx.signal },
      );
      await deps.persist(record.id, { extractionStatus: "done", extractionError: null, extracted: facts });
      result.done++;
      result.estimatedCostUsd += usage.estimatedCostUsd;
      if (facts.isAbandonment) {
        result.abandonmentPermits.push(record.permitNumber);
      } else {
        result.proposals.push(
          ...mapPermitFacts(facts, {
            id: record.id,
            permitNumber: record.permitNumber,
            docType: record.docType,
            inspectionId: ctx.inspectionId,
          }),
        );
      }
      if (!facts.isAbandonment) result.highlights.push(describeFacts(record.permitNumber, facts));
      const tokens = usage.calls.reduce(
        (n, c) => n + c.inputTokens + c.outputTokens + c.cacheReadInputTokens + c.cacheCreationInputTokens,
        0,
      );
      deps.log(
        `[prefill] ${record.permitNumber}: ${passes} pass(es), ${escalations} escalation(s), ${tokens.toLocaleString("en-US")} tokens ≈ $${usage.estimatedCostUsd.toFixed(4)}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await deps.persist(record.id, { extractionStatus: "failed", extractionError: message.slice(0, 500) });
      result.failed++;
      deps.log(`[prefill] ${record.permitNumber}: extraction failed — ${message}`);
    }
  }

  return result;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/prefill/permits/__tests__/extract-records.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/prefill/permits/extract-records.ts src/lib/prefill/permits/__tests__/extract-records.test.ts
git commit -m "feat(prefill): rank stored permit records, extract up to 3, persist status + proposals"
```

---

### Task 9: Wire extraction into the permits stage (initial run + post-selection)

**Files:**
- Create: `src/lib/prefill/permits/with-extraction.ts`
- Modify: `src/lib/prefill/permits/index.ts` (phase 2 — the `return` of its internal `storeHits(...)`, which both `runPermitsStage` and `runPermitsSelection` funnel through)
- Modify: `src/lib/prefill/run-dto.ts` (phase 1/2 — `toInspectionRecordDTO`'s `isAbandonment`)
- Test: `src/lib/prefill/permits/__tests__/with-extraction.test.ts`; phase 2's `src/lib/prefill/permits/__tests__/index.test.ts` and `src/lib/prefill/__tests__/run-dto.records.test.ts` (one added case each)

**Interfaces:**
- Consumes: `extractStoredRecords`, `StoredRecord`, `ExtractRecordsResult` (Task 8); `dedupeProposals` (Task 7); `StageContext`, `StageResult` (`@/lib/prefill/stage`); `PermitArchive`, `ExtractionStatus` (types.ts); `listRecordRows(runId): Promise<InspectionRecordRow[]>` and `InspectionRecordRow` (phase 1's `src/lib/prefill/run-store.ts` — rows ordered by `createdAt`); phase 2's `src/lib/prefill/permits/index.ts` — `runPermitsStage(input, ctx, deps?)`, `runPermitsSelection(input, ctx, candidateKeys, deps?)`, and their shared internal `storeHits(hits, ctx, deps, clock): Promise<PermitsStageResult>` whose last line is `return { stage: finishStage(clock, { status: "done", summary: parts.join(" · ") }), proposals };` — and `isAbandonmentDocType` (doc-types.ts).
- Produces: `withExtraction(ctx, result, deps?)`, `buildExtractionSummary(base, x)`, `WithExtractionDeps`, `defaultWithExtractionDeps()`; `runPermitsStage` / `runPermitsSelection` now include extraction (unchanged signatures); `InspectionRecordDTO.isAbandonment` is also true when the extracted facts say so.

Why a hook that reloads the run's records from the DB instead of threading phase 2's `StoreOutcome[]` through: `storeHits` is the one place both the initial stage and the post-selection continuation end ("documents stored under `ctx.runId`, status `done`"), `storeDocument` already persisted every row with the right `extraction_status`, and re-reading them keeps the hook independent of phase 2's internals (the smoke script's single `runPermitsStage` call then exercises the full path).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/prefill/permits/__tests__/with-extraction.test.ts
import { describe, expect, it, vi } from "vitest";

// the default deps read rows through phase 1's run-store (which imports db); the tests inject deps
vi.mock("@/lib/prefill/run-store", () => ({ listRecordRows: vi.fn() }));

import type { StoredRecord } from "@/lib/prefill/permits/extract-records";
import {
  buildExtractionSummary,
  withExtraction,
  type WithExtractionDeps,
} from "@/lib/prefill/permits/with-extraction";
import type { StageContext, StageResult } from "@/lib/prefill/stage";
import type { ProposedField } from "@/lib/prefill/types";

const ctx: StageContext = {
  inspectionId: "insp-1",
  runId: "run-1",
  signal: new AbortController().signal,
  progress: vi.fn().mockResolvedValue(undefined),
};

const record = (over: Partial<StoredRecord> & { id: string }): StoredRecord => ({
  inspectionId: "insp-1",
  permitNumber: "OW-17-00474",
  docType: "PERMIT",
  source: "edms_env",
  storagePath: `records/insp-1/${over.id}.pdf`,
  docDate: "2017-05-12",
  sizeBytes: 1000,
  extractionStatus: "pending",
  ...over,
});

const fill = (fieldPath: string, value: string, confidence: number): ProposedField => ({
  fieldPath,
  value,
  kind: "fill",
  provenance: { source: "permit", confidence, explanation: "x" },
});

const done: StageResult = {
  stage: {
    status: "done",
    summary: "2 permits found",
    links: [{ label: "Open on Maricopa EDMS", url: "https://edms.maricopa.gov/env/" }],
  },
  proposals: [fill("facilityInfo.recordsAvailable", "yes", 1)],
};

const extraction = {
  proposals: [fill("septicTank.tanks.0.tankCapacity", "1250", 0.97), fill("facilityInfo.recordsAvailable", "yes", 1)],
  done: 1,
  failed: 0,
  skipped: 1,
  abandonmentPermits: [] as string[],
  estimatedCostUsd: 0.04,
  highlights: ["OW-17-00474: 1,250 gal tank · 2 seepage pits"],
};

function deps(over: Partial<WithExtractionDeps> = {}) {
  const d = {
    loadRecords: vi.fn().mockResolvedValue([record({ id: "r1" }), record({ id: "r2", extractionStatus: "skipped" })]),
    extract: vi.fn().mockResolvedValue(extraction),
    ...over,
  };
  return d as WithExtractionDeps & { [K in keyof WithExtractionDeps]: ReturnType<typeof vi.fn> };
}

describe("withExtraction", () => {
  it("extracts the run's pending records and folds proposals + highlights into the stage result", async () => {
    const d = deps();
    const out = await withExtraction(ctx, done, d);
    expect(d.loadRecords).toHaveBeenCalledWith("run-1");
    expect(d.extract).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: "r1", extractionStatus: "pending" })]),
      ctx,
    );
    expect(out.stage.status).toBe("done");
    expect(out.stage.summary).toBe("2 permits found · OW-17-00474: 1,250 gal tank · 2 seepage pits");
    expect(out.stage.links).toEqual(done.stage.links);
    expect(out.stage.finishedAt).toBeTruthy();
    expect(out.proposals.map((p) => p.fieldPath)).toEqual([
      "facilityInfo.recordsAvailable",
      "septicTank.tanks.0.tankCapacity",
    ]);
  });

  it("leaves not_found / error / running / skipped results alone and preserves extra fields", async () => {
    for (const status of ["not_found", "error", "running", "skipped"] as const) {
      const d = deps();
      const result: StageResult & { candidates: unknown[] } = { stage: { status, links: [] }, proposals: [], candidates: [] };
      expect(await withExtraction(ctx, result, d)).toBe(result);
      expect(d.loadRecords).not.toHaveBeenCalled();
    }
  });

  it("returns the input unchanged when nothing is pending", async () => {
    const d = deps({ loadRecords: vi.fn().mockResolvedValue([record({ id: "r2", extractionStatus: "skipped" })]) });
    expect(await withExtraction(ctx, done, d)).toBe(done);
    expect(d.extract).not.toHaveBeenCalled();
  });

  it("keeps the stage done and notes the problem when extraction crashes", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = deps({ extract: vi.fn().mockRejectedValue(new Error("db down")) });
    const out = await withExtraction(ctx, done, d);
    expect(out.stage.status).toBe("done");
    expect(out.stage.summary).toBe("2 permits found · extraction failed: db down");
    expect(out.proposals).toEqual(done.proposals);
    error.mockRestore();
  });
});

describe("buildExtractionSummary", () => {
  it("puts an abandonment banner first, then the base summary, highlights and failures", () => {
    expect(
      buildExtractionSummary("3 permits found", {
        ...extraction,
        failed: 1,
        abandonmentPermits: ["AB-01"],
        highlights: ["000972: 1,200 gal tank · seepage pit"],
      }),
    ).toBe(
      "ABANDONMENT on file (permit AB-01) · 3 permits found · 000972: 1,200 gal tank · seepage pit · 1 document could not be read",
    );
    expect(buildExtractionSummary(undefined, { ...extraction, highlights: [], done: 0, failed: 2 })).toBe(
      "2 documents could not be read",
    );
  });

  it("does not repeat an abandonment banner phase 2 already wrote", () => {
    expect(
      buildExtractionSummary("1 permit document found: OWR-22-01512 ABANDONMENT · ABANDONMENT on file (OWR-22-01512)", {
        ...extraction,
        proposals: [],
        highlights: [],
        abandonmentPermits: ["OWR-22-01512"],
      }),
    ).toBe("1 permit document found: OWR-22-01512 ABANDONMENT · ABANDONMENT on file (OWR-22-01512)");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/prefill/permits/__tests__/with-extraction.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/prefill/permits/with-extraction"`.

- [ ] **Step 3: Write the hook module**

```ts
// src/lib/prefill/permits/with-extraction.ts
/**
 * Phase 3 hook for the permits stage: once phase 2 has stored a run's
 * documents (stage "done"), read the pending ones with Claude and fold the
 * resulting proposals and a one-line digest into the stage result.
 * Never throws — a crash here leaves the phase-2 result intact with a note.
 */
import { dedupeProposals } from "../map-facts-to-fields";
import { listRecordRows } from "../run-store";
import type { StageContext, StageResult } from "@/lib/prefill/stage";
import type { ExtractionStatus, PermitArchive } from "../types";
import { type ExtractRecordsResult, type StoredRecord, extractStoredRecords } from "./extract-records";

export interface WithExtractionDeps {
  loadRecords: (runId: string) => Promise<StoredRecord[]>;
  extract: (records: StoredRecord[], ctx: StageContext) => Promise<ExtractRecordsResult>;
}

export function defaultWithExtractionDeps(): WithExtractionDeps {
  return {
    loadRecords: async (runId) => {
      const rows = await listRecordRows(runId); // phase 1 run-store: the run's rows, oldest first (= rank order)
      return rows.map((r) => ({
        id: r.id,
        inspectionId: r.inspectionId,
        permitNumber: r.permitNumber,
        docType: r.docType,
        source: r.source as PermitArchive,
        storagePath: r.storagePath,
        docDate: r.docDate,
        sizeBytes: r.sizeBytes,
        extractionStatus: r.extractionStatus as ExtractionStatus,
      }));
    },
    extract: (records, ctx) => extractStoredRecords(records, ctx),
  };
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * "ABANDONMENT on file (permit X) · <phase-2 summary> · <highlights…> · N documents could not be read".
 * Phase 2 already writes an "ABANDONMENT on file (…)" part when a document's EDMS type is
 * ABANDONMENT; the banner is only added here when the model found one phase 2 did not name.
 */
export function buildExtractionSummary(base: string | undefined, x: ExtractRecordsResult): string {
  const parts: string[] = [];
  if (x.abandonmentPermits.length > 0 && !(base ?? "").includes("ABANDONMENT on file")) {
    parts.push(`ABANDONMENT on file (permit ${x.abandonmentPermits.join(", ")})`);
  }
  if (base) parts.push(base);
  parts.push(...x.highlights);
  if (x.failed > 0) parts.push(`${x.failed} document${x.failed === 1 ? "" : "s"} could not be read`);
  return parts.join(" · ");
}

function withSummary<T extends StageResult>(result: T, summary: string): T {
  return { ...result, stage: { ...result.stage, summary } };
}

/**
 * Reads the run's pending records (rank order, ≤ MAX_DOCUMENTS_PER_RUN) and
 * merges their proposals into `result`. Results that are not `done` (not
 * found, error, awaiting selection) pass through untouched.
 */
export async function withExtraction<T extends StageResult>(
  ctx: StageContext,
  result: T,
  deps: WithExtractionDeps = defaultWithExtractionDeps(),
): Promise<T> {
  if (result.stage.status !== "done") return result;
  try {
    const records = await deps.loadRecords(ctx.runId);
    if (!records.some((r) => r.extractionStatus === "pending")) return result;
    const x = await deps.extract(records, ctx);
    return {
      ...result,
      stage: {
        ...result.stage,
        summary: buildExtractionSummary(result.stage.summary, x),
        finishedAt: new Date().toISOString(), // phase 2 stamped it before extraction ran
      },
      proposals: dedupeProposals([...result.proposals, ...x.proposals]),
    };
  } catch (err) {
    console.error(`[prefill] extraction crashed for run ${ctx.runId}: ${errorMessage(err)}`);
    const note = `extraction failed: ${errorMessage(err)}`;
    return withSummary(result, result.stage.summary ? `${result.stage.summary} · ${note}` : note);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/prefill/permits/__tests__/with-extraction.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Call the hook from phase 2's `storeHits`**

In `src/lib/prefill/permits/index.ts` (phase 2) make two edits — phase 2's exported functions and their signatures do not change:

1. Add the import next to the other `./` imports:

```ts
import { withExtraction } from "./with-extraction";
```

2. In the internal `storeHits(hits, ctx, deps, clock)` (the function both `runPermitsStage`'s `case "found"` and `runPermitsSelection` call), replace its last statement

```ts
  return { stage: finishStage(clock, { status: "done", summary: parts.join(" · ") }), proposals };
```

with

```ts
  // phase 3: read the pending documents and fold their proposals into the result
  return withExtraction(ctx, { stage: finishStage(clock, { status: "done", summary: parts.join(" · ") }), proposals });
```

(`withExtraction<T extends StageResult>` returns `Promise<T>`, so the function's declared `Promise<PermitsStageResult>` still type-checks.) The `storeHits` function is otherwise phase 2's verbatim — for reference, its full body after the edit:

```ts
/** Rank → decide extraction slot → store each document, reporting progress. */
async function storeHits(
  hits: SearchHit[],
  ctx: StageContext,
  deps: PermitsStageDeps,
  clock: StageClock,
): Promise<PermitsStageResult> {
  const ranked = rankForExtraction(
    hits.map((hit) => ({ hit, docType: hit.candidate.docType, docDate: hit.candidate.docDate })),
  ).map((r) => r.hit);

  const outcomes: StoreOutcome[] = [];
  let pendingStored = 0;
  let notDownloaded = 0;

  for (const [index, hit] of ranked.entries()) {
    if (ctx.signal.aborted) {
      notDownloaded = ranked.length - index;
      break;
    }
    const { permitNumber, docType } = hit.candidate;
    let extractionStatus: ExtractionStatus = "skipped";
    let extractionError: string | null = null;
    if (!isExtractableDocType(docType)) {
      extractionError = `${docType} documents are not extracted`;
    } else if (pendingStored >= MAX_DOCUMENTS_PER_RUN) {
      extractionError = `Over the ${MAX_DOCUMENTS_PER_RUN}-document extraction limit`;
    } else {
      extractionStatus = "pending";
    }

    await ctx.progress({
      status: "running",
      summary: `Downloading ${index + 1} of ${ranked.length}: ${permitNumber} ${docType}…`,
    });

    try {
      const result = await deps.storeDocument({
        inspectionId: ctx.inspectionId,
        runId: ctx.runId,
        hit,
        extractionStatus,
        extractionError,
        signal: ctx.signal,
      });
      if (result.stored && extractionStatus === "pending") pendingStored++;
      outcomes.push({ hit, result });
    } catch (err) {
      console.error(`[prefill/permits] storing ${permitNumber} threw:`, err);
      outcomes.push({ hit, result: null, error: errorMessage(err) });
    }
  }

  const stored = outcomes.filter((o) => o.result?.stored);
  const failed = outcomes.filter((o) => !o.result || o.result.extractionStatus === "failed").length;
  const tooLarge = outcomes.filter(
    (o) => o.result && !o.result.stored && o.result.extractionStatus === "skipped",
  ).length;
  const abandonments = hits
    .filter((h) => isAbandonmentDocType(h.candidate.docType))
    .map((h) => h.candidate.permitNumber);

  const listed = ranked.slice(0, 4).map((h) => `${h.candidate.permitNumber} ${h.candidate.docType}`);
  const parts = [
    `${plural(hits.length, "permit document")} found: ${listed.join(", ")}${ranked.length > 4 ? ", …" : ""}`,
  ];
  if (tooLarge > 0) parts.push(`${tooLarge} over 25 MB not downloaded`);
  if (failed > 0) parts.push(`${failed} download failed`);
  if (notDownloaded > 0) parts.push(`${notDownloaded} not downloaded (out of time)`);
  if (abandonments.length > 0) parts.push(`ABANDONMENT on file (${abandonments.join(", ")})`);

  const first = ranked[0].candidate;
  const firstStored = stored[0]?.result ?? null;
  const proposals: ProposedField[] = [
    recordsAvailableProposal(
      "yes",
      1,
      `Permit ${first.permitNumber} (${first.docType}) found on Maricopa EDMS`,
      ctx.runId,
      firstStored
        ? {
            sourceUrl: `/api/inspections/${ctx.inspectionId}/records/${firstStored.recordId}`,
            recordId: firstStored.recordId,
          }
        : { sourceUrl: EDMS_ARCHIVES.env.searchPageUrl },
    ),
  ];

  // phase 3: read the pending documents and fold their proposals into the result
  return withExtraction(ctx, { stage: finishStage(clock, { status: "done", summary: parts.join(" · ") }), proposals });
}
```

`run-prefill.ts`'s `continuePrefillAfterSelection` already calls `runPermitsSelection` — nothing to change there; it gets extraction for free. Phase 2's `recordsAvailable = "yes"` proposal and Task 7's are both `source: "permit"` at confidence 1, so `dedupeProposals` keeps phase 2's (first seen).

- [ ] **Step 6: Keep phase 2's stage tests green and assert the hand-off**

Phase 2's `src/lib/prefill/permits/__tests__/index.test.ts` runs in the node environment with `@/lib/db` mocked as `{ db: { insert: vi.fn() } }`, so the hook's default `loadRecords` would throw there (and `withExtraction` would swallow it into the summary, breaking the summary assertions). Mock the hook to a pass-through — add next to that file's existing `vi.mock("@/lib/db", …)`:

```ts
import { withExtraction } from "../with-extraction";

vi.mock("../with-extraction", () => ({
  withExtraction: vi.fn(async (_ctx: unknown, result: unknown) => result),
}));
```

and append one case inside its `describe("runPermitsStage", …)` block (it reuses that file's `makeDeps`, `makeCtx` → `ctx`, `PERMIT`, `input`, and `runPermitsSelection` imports):

```ts
  it("hands the stored result to phase 3's withExtraction on the initial run and on selection", async () => {
    vi.mocked(withExtraction).mockClear();
    const deps = makeDeps({
      searchPermits: vi.fn().mockResolvedValue({
        kind: "found",
        via: "apn",
        hits: [PERMIT],
        searched: ["APN 200-08-079"],
      }),
    });
    const result = await runPermitsStage(input, ctx, deps);
    expect(result.stage.status).toBe("done");
    expect(withExtraction).toHaveBeenCalledTimes(1);
    expect(withExtraction).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ stage: expect.objectContaining({ status: "done" }) }),
    );

    await runPermitsSelection(input, ctx, [PERMIT.candidate.key], deps);
    expect(withExtraction).toHaveBeenCalledTimes(2);
  });
```

Run: `npx vitest run src/lib/prefill/permits/__tests__/index.test.ts`
Expected: PASS (phase 2's 11 cases + this one).

- [ ] **Step 7: Abandonment banner from extracted facts**

In `src/lib/prefill/run-dto.ts`, `toInspectionRecordDTO(row: InspectionRecordRow)` (phase 1, modified by phase 2) sets `isAbandonment: isAbandonmentDocType(row.docType),`. Change that property to:

```ts
    isAbandonment:
      isAbandonmentDocType(row.docType) || (row.extracted as PermitFacts | null)?.isAbandonment === true,
```

and add `import type { PermitFacts } from "@/lib/ai/permit-extraction-schema";` to the file's imports. The tile's red banner keys off `run.records.some((r) => r.isAbandonment)` (phase 1), so an abandonment the model found in a document filed under another type now shows too. Append inside the `describe("toInspectionRecordDTO (phase 2)", …)` block of phase 2's `src/lib/prefill/__tests__/run-dto.records.test.ts` (it defines a `ROW: InspectionRecordRow` fixture with `docType: "ABANDONMENT"`):

```ts
  it("flags abandonment from the extracted facts even when the EDMS type is PERMIT", async () => {
    const { emptyPermitFacts } = await import("@/lib/ai/permit-extraction-schema");
    const dto = toInspectionRecordDTO({
      ...ROW,
      docType: "PERMIT",
      extractionStatus: "done",
      extracted: { ...emptyPermitFacts(), isAbandonment: true },
    });
    expect(dto.isAbandonment).toBe(true);
    expect(toInspectionRecordDTO({ ...ROW, docType: "PERMIT" }).isAbandonment).toBe(false);
  });
```

Run: `npx vitest run src/lib/prefill/__tests__/run-dto.records.test.ts`
Expected: PASS (phase 2's 3 cases + this one).

- [ ] **Step 8: Commit**

```bash
git add src/lib/prefill/permits/with-extraction.ts src/lib/prefill/permits/__tests__/with-extraction.test.ts src/lib/prefill/permits/index.ts src/lib/prefill/permits/__tests__/index.test.ts src/lib/prefill/run-dto.ts src/lib/prefill/__tests__/run-dto.records.test.ts
git commit -m "feat(prefill): run extraction after permit documents are stored (initial run + selection)"
```

---

### Task 10: Per-record extraction status in the Prefill sources tile

**Files:**
- Create: `src/components/prefill/record-extraction-badge.tsx`
- Modify: `src/components/prefill/permit-records-list.tsx` (phase 2 — replace its `statusLabel` span in the per-record `<li>`)
- Test: `src/components/prefill/__tests__/record-extraction-badge.test.tsx`

**Interfaces:**
- Consumes: `InspectionRecordDTO` (types.ts: `extractionStatus`, `extractionError`, `permitNumber`); `Badge` from `src/components/ui/badge.tsx` (variants `outline`, `success`, `warning`, `destructive` exist there); phase 2's `PermitRecordsList({ run, onSelectCandidates, disabled })` (one `<li>` per `run.records` entry; `run.stages.permits.summary` carries the "Reading …" progress text).
- Produces: `RecordExtractionBadge({ record, reading? })`; `isRecordBeingRead(record, summary)`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/prefill/__tests__/record-extraction-badge.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RecordExtractionBadge, isRecordBeingRead } from "@/components/prefill/record-extraction-badge";

describe("RecordExtractionBadge", () => {
  it.each([
    ["pending", "Queued"],
    ["done", "Read"],
    ["skipped", "Not read"],
    ["failed", "Read failed"],
  ] as const)("renders %s as %s", (extractionStatus, label) => {
    render(<RecordExtractionBadge record={{ extractionStatus, extractionError: null }} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("shows 'Reading…' for the pending record currently being read", () => {
    render(<RecordExtractionBadge record={{ extractionStatus: "pending", extractionError: null }} reading />);
    expect(screen.getByText("Reading…")).toBeInTheDocument();
  });

  it("ignores `reading` once the record is no longer pending", () => {
    render(<RecordExtractionBadge record={{ extractionStatus: "done", extractionError: null }} reading />);
    expect(screen.getByText("Read")).toBeInTheDocument();
  });

  it("exposes the failure or skip reason as title and accessible label", () => {
    render(
      <RecordExtractionBadge
        record={{ extractionStatus: "failed", extractionError: "Claude API error: 500 boom" }}
      />,
    );
    const badge = screen.getByText("Read failed");
    expect(badge).toHaveAttribute("title", "Claude API error: 500 boom");
    expect(badge).toHaveAttribute("aria-label", "Read failed: Claude API error: 500 boom");
  });
});

describe("isRecordBeingRead", () => {
  const rec = { permitNumber: "OW-17-00474", extractionStatus: "pending" as const };
  it("is true only for a pending record named in a 'Reading …' summary", () => {
    expect(isRecordBeingRead(rec, "Reading OW-17-00474…")).toBe(true);
    expect(isRecordBeingRead(rec, "Reading 000972…")).toBe(false);
    expect(isRecordBeingRead(rec, "2 permits found")).toBe(false);
    expect(isRecordBeingRead(rec, undefined)).toBe(false);
    expect(isRecordBeingRead({ ...rec, extractionStatus: "done" }, "Reading OW-17-00474…")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/prefill/__tests__/record-extraction-badge.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/prefill/record-extraction-badge"`.

- [ ] **Step 3: Write the badge component**

```tsx
// src/components/prefill/record-extraction-badge.tsx
"use client";

import { Badge } from "@/components/ui/badge";
import type { InspectionRecordDTO } from "@/lib/prefill/types";

type Status = InspectionRecordDTO["extractionStatus"];

const LABELS: Record<Status, { text: string; variant: "outline" | "success" | "warning" | "destructive" }> = {
  pending: { text: "Queued", variant: "outline" },
  done: { text: "Read", variant: "success" },
  skipped: { text: "Not read", variant: "outline" },
  failed: { text: "Read failed", variant: "destructive" },
};

/** True when the permits stage summary ("Reading OW-17-00474…") names this pending record */
export function isRecordBeingRead(
  record: Pick<InspectionRecordDTO, "permitNumber" | "extractionStatus">,
  summary: string | undefined,
): boolean {
  return (
    record.extractionStatus === "pending" &&
    !!summary &&
    summary.startsWith("Reading ") &&
    summary.includes(record.permitNumber)
  );
}

export function RecordExtractionBadge({
  record,
  reading = false,
}: {
  record: Pick<InspectionRecordDTO, "extractionStatus" | "extractionError">;
  reading?: boolean;
}) {
  if (reading && record.extractionStatus === "pending") {
    return (
      <Badge variant="warning" aria-label="Reading document">
        Reading…
      </Badge>
    );
  }
  const { text, variant } = LABELS[record.extractionStatus];
  const reason = record.extractionError ?? undefined;
  return (
    <Badge variant={variant} title={reason} aria-label={reason ? `${text}: ${reason}` : text}>
      {text}
    </Badge>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/prefill/__tests__/record-extraction-badge.test.tsx`
Expected: PASS (8 tests).

- [ ] **Step 5: Replace the plain-text status in the permit row with the badge**

Open phase 2's `src/components/prefill/permit-records-list.tsx` (`PermitRecordsList({ run, onSelectCandidates, disabled })`). It renders one `<li>` per `run.records` entry and a module-private `statusLabel(r)` that returns "Queued for extraction" / "Extracted" / `${extractionError ?? "Failed"} — re-run Find records` / `extractionError ?? "Not extracted"`. Make three edits:

1. Add the import next to the other component imports:

```tsx
import { RecordExtractionBadge, isRecordBeingRead } from "./record-extraction-badge";
```

2. Delete the `statusLabel` function entirely.

3. In the `<li>`, replace the line

```tsx
              <span className="text-xs text-muted-foreground">{statusLabel(r)}</span>
```

with

```tsx
              <RecordExtractionBadge
                record={r}
                reading={isRecordBeingRead(r, run.stages.permits.summary)}
              />
              {r.extractionStatus === "failed" && (
                <span className="text-xs text-muted-foreground">
                  {r.extractionError ?? "Failed"} — re-run Find records
                </span>
              )}
              {r.extractionStatus === "skipped" && r.extractionError && (
                <span className="text-xs text-muted-foreground">{r.extractionError}</span>
              )}
```

The badge sits in the same flex row as the doc-type/date/size chips; the failure/skip reason keeps phase 2's wording so its existing test (`/Download failed: .* — re-run Find records/`) still passes.

- [ ] **Step 6: Update phase 2's list test for the new labels and add the extraction cases**

In `src/components/prefill/__tests__/permit-records-list.test.tsx` (phase 2) change the one assertion on the old text:

```tsx
    expect(rows[0]).toHaveTextContent("Queued for extraction");
```

to

```tsx
    expect(rows[0]).toHaveTextContent("Queued");
```

and append these cases inside its `describe("PermitRecordsList — records", …)` block (they reuse that file's `run()` and `record()` fixture helpers):

```tsx
  it("shows each record's extraction status and the failure reason", () => {
    render(
      <PermitRecordsList
        run={run({
          records: [
            record({ id: "r1", permitNumber: "OW-17-00474", extractionStatus: "done", extractionError: null }),
            record({ id: "r2", permitNumber: "000972", extractionStatus: "failed", extractionError: "Claude API error: 500 boom" }),
            record({ id: "r3", permitNumber: "OW-24-00001", extractionStatus: "skipped", extractionError: "Only the first 3 documents are read per run" }),
          ],
        })}
        onSelectCandidates={vi.fn()}
      />,
    );
    expect(screen.getByText("Read")).toBeInTheDocument();
    expect(screen.getByText("Read failed")).toBeInTheDocument();
    expect(screen.getByText("Claude API error: 500 boom — re-run Find records")).toBeInTheDocument();
    expect(screen.getByText("Not read")).toBeInTheDocument();
    expect(screen.getByText("Only the first 3 documents are read per run")).toBeInTheDocument();
  });

  it("marks the record named in a running 'Reading …' summary", () => {
    render(
      <PermitRecordsList
        run={run({
          status: "running",
          stages: { ...emptyStages(), permits: { status: "running", links: [], summary: "Reading OW-17-00474…" } },
          records: [record({ id: "r1", permitNumber: "OW-17-00474", extractionStatus: "pending", extractionError: null })],
        })}
        onSelectCandidates={vi.fn()}
      />,
    );
    expect(screen.getByText("Reading…")).toBeInTheDocument();
  });
```

Run: `npx vitest run src/components/prefill/__tests__/permit-records-list.test.tsx src/components/prefill/__tests__/record-extraction-badge.test.tsx`
Expected: PASS (phase 2's cases with the one changed assertion + 2 new + 8 badge tests).

- [ ] **Step 7: Commit**

```bash
git add src/components/prefill/record-extraction-badge.tsx src/components/prefill/__tests__/record-extraction-badge.test.tsx src/components/prefill/permit-records-list.tsx src/components/prefill/__tests__/permit-records-list.test.tsx
git commit -m "feat(prefill): show per-record extraction status in the permit records list"
```

---

### Task 11: Live smoke script, type gate, full test run

**Files:**
- Create: `scripts/prefill-extract-smoke.mts`

**Interfaces:**
- Consumes: `runPermitsStage` (phase 2 + Task 9), `db`, `inspectionPrefillRuns`, `inspectionRecords`, `inspections` (schema), `createAdminClient`, `emptyStages` (types.ts), `PermitFacts` (Task 1).
- Produces: a manual, paid, end-to-end check that prints proposals, per-record extraction status, and the `[prefill] …tokens ≈ $…` usage lines. Exit code 0 when every expectation holds, 2 otherwise.

There is no unit test for this task — it is the live integration check spec §12 asks for before the phase merges. Run it once per parcel, read the output, and paste the summary into the PR.

- [ ] **Step 1: Write the script**

```ts
// scripts/prefill-extract-smoke.mts
/**
 * Live smoke test for phase 3 (spec §12): runs the REAL permits stage — EDMS
 * search, document download to Supabase Storage, Claude extraction — for two
 * known parcels and prints the proposals, each record's extraction status and
 * key facts, and the "[prefill] … tokens ≈ $…" usage lines from extract-records.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/prefill-extract-smoke.mts [--inspection <uuid>] [--apn 219-11-121] [--apn 200-08-079] [--cleanup]
 *   (or: node --env-file=.env.local --import tsx scripts/prefill-extract-smoke.mts …)
 *
 * Requires .env.local (npx vercel env pull .env.local) with ANTHROPIC_API_KEY,
 * DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Spends real
 * money (≈ $0.05–0.20 per parcel) and inserts real rows (inspection_prefill_runs,
 * inspection_records, storage objects) against the chosen inspection — the most
 * recent draft unless --inspection is given. --cleanup deletes what it created.
 *
 * Expected (spec §12): 219-11-121 → permit 000972, 1,200 gal, seepage pit, issued 2000;
 *                      200-08-079 → OW-17-00474, 1,250 gal, 2 seepage pits, design flow.
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { desc, eq, inArray } from "drizzle-orm";
import type { PermitFacts } from "../src/lib/ai/permit-extraction-schema";
import type { PrefillStage, ProposedField } from "../src/lib/prefill/types";

// tsx resolves the "@/…" aliases inside these modules; the script itself uses file URLs
// like scripts/test-pdf-gen.mts does.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mod = (p: string) => import(pathToFileURL(join(root, p)).href);

const { db } = await mod("src/lib/db/index.ts");
const { inspectionPrefillRuns, inspectionRecords, inspections } = await mod("src/lib/db/schema.ts");
const { createAdminClient } = await mod("src/lib/supabase/admin.ts");
const { RECORD_BUCKET } = await mod("src/lib/storage/record-storage.ts");
const { runPermitsStage } = await mod("src/lib/prefill/permits/index.ts");
const { emptyStages } = await mod("src/lib/prefill/types.ts");

interface Expectation {
  apn: string;
  permit: string;
  tankGal: number;
  disposal: string;
  issueYear?: number;
  designFlow?: boolean;
}

const EXPECTATIONS: Expectation[] = [
  { apn: "219-11-121", permit: "000972", tankGal: 1200, disposal: "seepage_pit", issueYear: 2000 },
  { apn: "200-08-079", permit: "OW-17-00474", tankGal: 1250, disposal: "seepage_pit", designFlow: true },
];

const { values: args } = parseArgs({
  options: {
    inspection: { type: "string" },
    apn: { type: "string", multiple: true },
    cleanup: { type: "boolean", default: false },
  },
});

for (const key of ["ANTHROPIC_API_KEY", "DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[key]) {
    console.error(`Missing ${key} — run: npx vercel env pull .env.local`);
    process.exit(1);
  }
}

let inspectionId = args.inspection;
if (!inspectionId) {
  const [latest] = await db
    .select({ id: inspections.id })
    .from(inspections)
    .where(eq(inspections.status, "draft"))
    .orderBy(desc(inspections.createdAt))
    .limit(1);
  if (!latest) {
    console.error("No draft inspection found — pass --inspection <uuid>");
    process.exit(1);
  }
  inspectionId = latest.id as string;
}
console.log(`Inspection: ${inspectionId}`);

const wanted = args.apn?.length ? EXPECTATIONS.filter((e) => args.apn?.includes(e.apn)) : EXPECTATIONS;
let failures = 0;
const createdRunIds: string[] = [];

const normalise = (n: string) => n.replace(/[^A-Z0-9]/gi, "").toUpperCase();

for (const exp of wanted) {
  console.log(`\n=== APN ${exp.apn} ===`);
  const [run] = await db
    .insert(inspectionPrefillRuns)
    .values({ inspectionId, trigger: "manual", status: "running", input: { apn: exp.apn }, stages: emptyStages() })
    .returning({ id: inspectionPrefillRuns.id });
  createdRunIds.push(run.id);

  const controller = new AbortController();
  const budget = setTimeout(() => controller.abort(), 240_000);
  const started = Date.now();
  const result: { stage: PrefillStage; proposals: ProposedField[] } = await runPermitsStage(
    { apn: exp.apn },
    {
      inspectionId,
      runId: run.id,
      signal: controller.signal,
      progress: async (stage: Partial<PrefillStage>) => {
        console.log(`  [progress] ${JSON.stringify(stage)}`);
      },
    },
  );
  clearTimeout(budget);

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`Stage: ${result.stage.status} — ${result.stage.summary ?? ""} (${secs} s)`);
  for (const link of result.stage.links) console.log(`  link: ${link.label} → ${link.url}`);
  if (result.stage.error) console.log(`  error: ${result.stage.error}`);

  await db
    .update(inspectionPrefillRuns)
    .set({
      status: "done",
      stages: { ...emptyStages(), permits: result.stage },
      proposals: result.proposals,
      finishedAt: new Date(),
    })
    .where(eq(inspectionPrefillRuns.id, run.id));

  const records = await db.select().from(inspectionRecords).where(eq(inspectionRecords.runId, run.id));
  console.log(`Records (${records.length}):`);
  for (const r of records) {
    const x = r.extracted as PermitFacts | null;
    const facts = x
      ? `kind=${x.documentKind} tank=${x.tanks[0]?.capacityGal?.value ?? "-"} disposal=${x.disposal.type?.value ?? "-"}×${x.disposal.count?.value ?? "-"} flow=${x.designFlowGpd?.value ?? "-"} issued=${x.issueDate?.value ?? "-"}`
      : "";
    console.log(
      `  ${r.permitNumber.padEnd(14)} ${r.docType.padEnd(22)} ${String(r.pageCount ?? "?").padStart(3)} pp  ${r.extractionStatus.padEnd(8)} ${r.extractionError ?? ""} ${facts}`,
    );
  }

  console.log(`Proposals (${result.proposals.length}):`);
  for (const p of result.proposals) {
    console.log(
      `  ${p.fieldPath.padEnd(46)} ${JSON.stringify(p.value).padEnd(22)} ${(p.provenance.confidence * 100).toFixed(0).padStart(3)}%  ${p.provenance.explanation}`,
    );
  }

  const byPath = new Map(result.proposals.map((p) => [p.fieldPath, p]));
  const check = (label: string, ok: boolean, actual: unknown) => {
    console.log(`  ${ok ? "PASS " : "CHECK"} ${label}${ok ? "" : ` (got ${JSON.stringify(actual)})`}`);
    if (!ok) failures++;
  };
  const permitNos = records.map((r) => r.permitNumber as string);
  check(`permit ${exp.permit} stored`, permitNos.some((n) => normalise(n) === normalise(exp.permit)), permitNos);
  check(
    `tank ${exp.tankGal} gal`,
    byPath.get("septicTank.tanks.0.tankCapacity")?.value === String(exp.tankGal),
    byPath.get("septicTank.tanks.0.tankCapacity")?.value,
  );
  check(
    `disposal ${exp.disposal}`,
    byPath.get("disposalWorks.disposalType")?.value === exp.disposal,
    byPath.get("disposalWorks.disposalType")?.value,
  );
  if (exp.issueYear) {
    const explanation = byPath.get("facilityInfo.facilityAgeEstimateExplanation")?.value;
    check(`issued ${exp.issueYear}`, typeof explanation === "string" && explanation.includes(String(exp.issueYear)), explanation);
  }
  if (exp.designFlow) {
    check("design flow proposed", byPath.has("designFlow.estimatedDesignFlow"), undefined);
  }
}

if (args.cleanup) {
  const recs = await db
    .select({ id: inspectionRecords.id, storagePath: inspectionRecords.storagePath })
    .from(inspectionRecords)
    .where(inArray(inspectionRecords.runId, createdRunIds));
  if (recs.length > 0) {
    const { error } = await createAdminClient()
      .storage.from(RECORD_BUCKET)
      .remove(recs.map((r) => r.storagePath as string));
    if (error) console.warn(`storage cleanup: ${error.message}`);
    await db.delete(inspectionRecords).where(inArray(inspectionRecords.id, recs.map((r) => r.id as string)));
  }
  await db.delete(inspectionPrefillRuns).where(inArray(inspectionPrefillRuns.id, createdRunIds));
  console.log(`\nCleaned up ${createdRunIds.length} run(s) and ${recs.length} record(s).`);
} else {
  console.log(
    `\nLeft run(s) ${createdRunIds.join(", ")} in place — open the inspection's Prefill sources tile to see them; re-run with --cleanup to delete.`,
  );
}

console.log(failures ? `\n${failures} expectation(s) need a look.` : "\nAll expectations met.");
process.exit(failures ? 2 : 0);
```

- [ ] **Step 2: Pull env and run the smoke script against both parcels**

```bash
[ -f .env.local ] || npx vercel env pull .env.local
npx tsx --env-file=.env.local scripts/prefill-extract-smoke.mts
```

Expected output (values from the 2026-09-11 research; permit 000972's exact tank/disposal figures are handwritten, so a `CHECK` line there with a close reading is acceptable — `PASS` for OW-17-00474 is required):

```
Inspection: <uuid>

=== APN 219-11-121 ===
  [progress] {"status":"running","summary":"Searching Maricopa EDMS…"}
  [progress] {"status":"running","summary":"Reading 000972…"}
[prefill] 000972: 1 pass(es), 1 escalation(s), 12,3xx tokens ≈ $0.04xx
Stage: done — 1 permit found · 000972: 1,200 gal tank · seepage pit (2x.x s)
Records (1):
  000972         PERMIT                  4 pp  done      kind=approval_to_construct tank=1200 disposal=seepage_pit×1 flow=- issued=2000-xx-xx
Proposals (…):
  facilityInfo.recordsAvailable                  "yes"                  100%  Permit 000972 on file (Approval to Construct)
  facilityInfo.hasApprovalOfConstruction         true                    9x%  Permit 000972 · Approval to Construct p.1
  …
  PASS  permit 000972 stored
  PASS  tank 1200 gal
  PASS  disposal seepage_pit
  PASS  issued 2000

=== APN 200-08-079 ===
  …
  PASS  permit OW-17-00474 stored
  PASS  tank 1250 gal
  PASS  disposal seepage_pit
  PASS  design flow proposed

All expectations met.
```

Also confirm in the `[prefill]` lines that the second document's Sonnet call shows `cache_read_input_tokens > 0` — look at the run's usage: on the second parcel the system prompt should be served from cache (the line's cost is lower than the first). If every call shows `cache_creation` only, the system prompt is under 1024 tokens — lengthen it (Task 4) rather than shipping uncached.

Then delete the smoke rows:

```bash
npx tsx --env-file=.env.local scripts/prefill-extract-smoke.mts --cleanup
```

Expected: the same PASS lines, then `Cleaned up 2 run(s) and N record(s).`

- [ ] **Step 3: Type gate**

```bash
NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL:-https://placeholder.supabase.co} \
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:-placeholder} \
NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL:-http://localhost:3000} \
npm run build
```

Expected: `✓ Compiled successfully` with no type errors in `src/lib/ai/*`, `src/lib/prefill/**`, `src/components/prefill/*`. (Pre-existing `npx tsc --noEmit` noise is not the gate; `next build` is.)

- [ ] **Step 4: Full test run — acceptance bar**

```bash
npx vitest run 2>&1 | tail -40
```

Expected: every new file passes (`permit-extraction-schema`, `permit-facts-utils`, `permit-extraction-prompt`, `extract-permit-facts`, `triage`, `map-facts-to-fields`, `extract-records`, `index.extraction`, `record-extraction-badge`, phase 2's `permit-records-list`), and the failure list is the same ~15 pre-existing failures (nav/roles/rbac, review-actions, reopen/download routes, `inspection.test` STEP_FIELDS + tank schema). **Any failure in a file this plan touched or created is a blocker.** If unsure which failures are pre-existing, do not `git stash` (the stash is shared across worktrees and sessions); instead check the baseline in a separate worktree — `git worktree add ../iff-baseline de3d3bc && (cd ../iff-baseline && npm install && npx vitest run 2>&1 | grep FAIL)` — and diff the failing-file lists.

- [ ] **Step 5: Commit**

```bash
git add scripts/prefill-extract-smoke.mts
git commit -m "chore(prefill): live extraction smoke script for parcels 219-11-121 and 200-08-079"
```

- [ ] **Step 6: Open the PR (do not merge or deploy)**

```bash
git push -u origin feature/property-records-prefill
gh pr create --base main --title "Prefill phase 3: permit extraction (Sonnet 4.6 + Opus 5 escalation)" --body-file - <<'EOF'
## Phase 3 — Extraction

- `PermitFactsSchema` (zod 4) + `messages.parse()` structured output on `claude-sonnet-4-6`, PDF sent as a base64 document block, cached system prompt, 90 s timeout, 1 retry.
- Page triage with pdf-lib (pages 1–4 / 1–6 first, ≤ 20 more only when no tank capacity and no disposal type); passes merged field-by-field.
- Opus 5 escalation of handwritten facts < 0.6 (single page, single question, ≤ 3 per document).
- `mapPermitFacts` covers every spec §7 row (table-driven test); `dedupeProposals` lets permit beat listing.
- `extractStoredRecords` reads ≤ 3 pending records per run, persists `extracted` / `extraction_status` / `extraction_error`, reports "Reading …" progress; wired into `runPermitsStage` and the post-selection path.
- Tile shows per-record status badges + failure reasons.

## Smoke (real API, `scripts/prefill-extract-smoke.mts`)
<paste the PASS/CHECK lines and the [prefill] cost lines here>

## Tests
`npx vitest run`: no new failures vs. the ~15 pre-existing. `npm run build`: passes.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

Production deploys only with Daniel's explicit approval — pushing `main` is not part of this plan.

---

## Self-review (done while writing; fixes applied inline)

**1. Spec coverage — spec §6, §7, §10–§13 item 3 against the tasks**

| Spec requirement | Task |
|---|---|
| §6 model `claude-sonnet-4-6`, `messages.parse()` + Zod schema, base64 `document` block, `max_tokens 4096`, cached system prompt | 5 (`runPass`), 4 (prompt ≥ 1024 tokens so the cache marker is honoured on Sonnet 4.6) |
| §6 `PermitFactsSchema` verbatim (contracts version, incl. `hasSitePlan`) | 1 |
| §6 triage: pass 1 = pages 1–4 (`env`) / 1–6 (`eplpav`); pass 2 = next ≤ 20 pages only when no `tanks[0].capacityGal` and no `disposal.type`; merge field-by-field, higher confidence wins | 3 (`planPasses`, `buildSubPdf`), 2 (`hasCoreFacts`, `mergePermitFacts`, `rebasePages`), 5 |
| §6 escalation: `handwritten && confidence < 0.6` → `claude-opus-5`, single page + single question, replace only if more confident, cap 3 | 6 (`escalateWeakHandwriting`, `askEscalation`), 2 (`FACT_SPECS` questions, `coerceFactValue`) |
| §6 prompt contract: Maricopa ESD layouts (ATC, DA "General Permits Authorized" rows, FINAL DA "Inspection Measurements", Notice of Transfer CivicPlus, Abandonment), calibration bands, no invention, page + verbatim evidence, cesspool/abandonment flags | 4 (full text + snapshot test) |
| §6 / §10 failures (`APIError`, schema mismatch, download failure) → record `failed` with message; run continues; 90 s timeout; one retry on network errors only; 240 s budget via `ctx.signal` | 5 (`toExtractionError`, `guarded`, `maxRetries: 0`), 8 (`extractStoredRecords` per-record try/catch + abort check), 9 (`withExtraction` never throws) |
| §5.2 step 3 / §6: at most 3 documents per run in rank order; `PLAN REVIEW` / `SUB` never; > 25 MB skipped with a note; `ABANDONMENT` flagged | 8 (`rankRecordsForExtraction` over phase 2's `rankForExtraction`, only `pending` records), 9 (`buildExtractionSummary` banner text), DTO `isAbandonment` |
| §7 every table row (`recordsAvailable`, approval/DA permit #, site plan, `facilityAge` + explanation, tank capacity + `permit_document`, material, `numberOfTanks`, disposal type with dims in explanation, bedrooms, design flow + `permit_documents`, water source, cesspool ≤ 0.7 suggestion, system type ≤ 0.7 suggestion, `isAbandonment` → banner only); `sourceUrl` `/api/inspections/{id}/records/{recordId}#page={page}`; permit beats listing | 7 (`mapPermitFacts`, `dedupeProposals`, table-driven test) |
| §2.2 progress "Permits: reading OW-17-00474…" | 8 (`ctx.progress({ summary: "Reading …" })`), 10 (`isRecordBeingRead`) |
| Tile shows per-record extraction status | 10 |
| §12 unit tests: schema vs sample outputs, prompt snapshot, escalation trigger logic, mocked Anthropic client, `map-facts-to-fields` every row | 1, 4, 6, 5, 7 |
| §12 live smoke `219-11-121` (000972, 1,200 gal, pit, 2000) and `200-08-079` (OW-17-00474, 1,250 gal, 2 pits, design flow) printing proposals + usage/cost | 11 |
| Existing suites stay green; `next build` passes | 11 |

Not in this phase (by design): the rate limit (spec §6 "shares the run's 3/hour/inspection limit") lives in phase 2's `POST /prefill` route; listing proposals and the sewer warning are phase 4. Per amendment A1/A4 the §7 "top-level tank fields" do not exist in the form, so `mapPermitFacts` proposes `septicTank.tanks.<i>.*` for every extracted tank instead (the client grows the array with `createEmptyTank()`).

Two deliberate deviations, both flagged in the tasks: `facilityInfo.isCesspool` is proposed as `"yes"` (the form field is a `"yes" | "no" | ""` enum in `src/lib/validators/inspection.ts`, not a boolean as §7 shorthand suggests); the SDK's `maxRetries` is `0` with a module-level connection-error retry, because the SDK's retry also covers 429/5xx, which §10 excludes.

**2. Placeholder scan** — no "TBD/TODO/implement later"; every code step contains the full code; the only names not defined in this plan are phase-2 names, each cited with its phase-2 file and checked against `docs/superpowers/plans/2026-09-11-prefill-phase2-permit-search-storage.md` as written on 2026-09-11 (`storeHits`, `storeDocument`, `PermitsStageResult`, `rankForExtraction`, `isExtractableDocType`, `isAbandonmentDocType`, `PermitRecordsList`, the index test's `makeDeps` / `makeCtx` / `PERMIT` / `input`). Task 9 step 7 and Task 10 steps 5–6 were re-checked against phase 2's finished plan text: `toInspectionRecordDTO` + its `ROW` fixture in `run-dto.records.test.ts`, `statusLabel` in `permit-records-list.tsx`, and the list test's `run()` / `record()` helpers and its "Queued for extraction" assertion.

**3. Type consistency** — checked pairwise: `StoredRecord` (Task 8) fields = what `defaultWithExtractionDeps` (Task 9) maps and what the tests construct; `ExtractRecordsResult` (Task 8) = the Task 9 fixture; `ExtractPermitFactsResult` (Task 5) = what Task 8's `deps.extract` mock returns (incl. `pageCount`); `ExtractPermitFactsOptions.signal` matches Task 8's `{ signal: ctx.signal }`; `PassMessageMeta` (Task 4) = what `runPass` (Task 5) builds; `FactSpec.question` strings in Task 2 are what Task 6's tests assert (`"design flow"`, `"approval / issue date"`, `"installing contractor"`, `"capacity in gallons of septic tank #1"`); `PermitRecordRef` (Task 7) = the object Task 8 passes to `mapPermitFacts`; `StageContext` / `StageResult` are imported from `@/lib/prefill/stage` everywhere (amendment A2; type-only); `RecordExtractionBadge` props use `InspectionRecordDTO["extractionStatus"]`, whose values are exactly `pending | done | skipped | failed`.

**4. Dry run of the code in this plan** — every `// src/…` code block above was extracted verbatim into a scratch project (with stubs for phase 1's `types.ts` / `stage.ts` / `run-store.ts`, phase 2's `doc-types.ts` copied from its plan, and stubbed `db` / `createAdminClient` / `RECORD_BUCKET`), `node_modules` symlinked, the repo's `vitest.config.ts` + `tsconfig.json` reused: `npx vitest run` → **9 files, 106 tests passed** (counts per file match the "Expected" lines above), `npx tsc --noEmit` → clean. Two things that dry run caught and that are already fixed in the text: `new Anthropic()` at import time throws under vitest's jsdom environment (hence the lazy `getClient()`), and a `Buffer` is not `instanceof` jsdom's `Uint8Array` for pdf-lib (hence `new Uint8Array(Buffer.from(…))` in the test helper). Not covered by the dry run: Task 9's edits to phase 2's files and Task 10's tile edit (they need phase 2's code), and the live smoke script.
