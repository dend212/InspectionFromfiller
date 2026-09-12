# Permit Authority over Notice of Transfer — Fix Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A real permit always outranks a Notice of Transfer (NOT) for the facts the prefill proposes — and a NOT never proposes the system's age — while the NOT stays listed as a record found and still supplies facts no permit supplies.

**Root cause (RCA `.superpowers/sdd/rca-dove-valley/diagnosis.md`, confirmed on prod run `76d478af`):** `mapPermitFacts` proposes `facilityInfo.facilityAge` from ANY record's `issueDate` (document kind only picks the caption verb), and `dedupeProposals` resolves two same-source ("permit") proposals purely by model confidence. On 1414 E Dove Valley Rd the NOT's typed escrow-signature date (2023-06-07 @ 0.95) beat the 2007 permit's handwritten issue date (2007-04-12 @ 0.75) and was captioned "Permit issued 06/2023 (permit OWR-23-02001)". Contributing: only pages 1–4 of the 15-page permit were read because a pump invoice's "1,500 gal" satisfied `hasCoreFacts`, so the Authorization-to-Construct stamp on p.14 (04/12/2007, typed) was never seen and the model classed the permit `other`.

**Architecture:** Proposals from the permit stage carry an `authority.docRank` (0 = permit-class, 2 = notice of transfer, 3 = abandonment …, from `DOC_CLASS_RANK`). `dedupeProposals` orders by source rank → doc rank → confidence → first-seen. The mapper never derives age from a transfer record. The extractor keeps reading a permit-class document until it has identified the permit (kind + issue date). Prompt and captions say what a NOT is.

**Tech Stack:** TypeScript, Next.js 16, Vitest 4 (jsdom for components), zod 4, `@anthropic-ai/sdk`.

## Global Constraints

- **Owner's rule (binding):** permit-class documents (model kind `approval_to_construct` / `discharge_authorization` / `final_da`, or EDMS class `permit` when the model kind is `other`) outrank Notice of Transfer documents for every field both propose. A Notice of Transfer NEVER proposes `facilityInfo.facilityAge` / `facilityInfo.facilityAgeEstimateExplanation`. A Notice of Transfer stays in the records list and may supply facts nothing else supplies (secondary).
- **No persisted-schema change:** no migration; `ProvenanceEntry` and `provenance-schema.ts` unchanged; the new `authority` lives as an optional SIBLING of `provenance` on `ProposedField` (`merge.ts:87` spreads only `provenance`; the PATCH schema strips unknown provenance keys, so never put it inside provenance).
- **Dedupe order (exact):** `SOURCE_RANK` (permit 3 > assessor 2 > listing 1 > scan 0) → lower `authority.docRank` wins, a proposal without `authority` counts as rank 0 → strictly higher confidence → first-seen. No document-date tie-break (it would flip the phase-2 `recordsAvailable` proposal — see `with-extraction.ts:93`).
- **Captions (exact):** transfer-record fact explanation `Notice of Transfer ${record.permitNumber} · p.${page} (transfer record — secondary source)`; transfer-record recordsAvailable `Notice of Transfer ${record.permitNumber} on file`; permit-class captions unchanged (`Permit ${permitNo} · ${label} p.${page}`, age `Permit issued MM/YYYY (permit N)` when kind is `other`).
- **Dove Valley fixture (use verbatim in tests; NOW = `2026-09-11T12:00:00Z`):**
  - `PERMIT_REC = { id: "rec-permit", permitNumber: "071533", docType: "PERMIT", inspectionId: "insp-1" }`; `permitFacts = { ...emptyPermitFacts(), documentKind: "other", issueDate: { value: "2007-04-12", confidence: 0.75, page: 1, evidence: "Date Issued 4/12/07", handwritten: true }, tanks: [{ capacityGal: { value: 1500, confidence: 0.72, page: 4, evidence: "1500 gal", handwritten: true }, material: null, model: null, dimensions: null }] }` → age **"19"**, explanation **"Permit issued 04/2007 (permit 071533)"**.
  - `NOT_REC = { id: "rec-not", permitNumber: "OWR-23-02001", docType: "NOTICE OF TRANSFER", inspectionId: "insp-1" }`; `notFacts = { ...emptyPermitFacts(), documentKind: "notice_of_transfer", issueDate: { value: "2023-06-07", confidence: 0.95, page: 5, evidence: "Date 6/7/2023", handwritten: false }, finalDate: { value: "2023-04-27", confidence: 0.97, page: 1, evidence: "Inspection date 4/27/2023", handwritten: false }, designFlowGpd: { value: 450, confidence: 0.97, page: 2, evidence: "Design flow 450 gpd", handwritten: false }, systemType: { value: "conventional", confidence: 0.97, page: 2, evidence: "Conventional", handwritten: false } }`.
- Never run `npm run lint`, Biome or any formatter. Focused tests only (`npx vitest run <file> --reporter=dot`) except in the gate task. `.env.local` is production — unit tests mock `@/lib/db`, `@/lib/supabase/admin`, `fetch` and the Anthropic client.
- Real exports on the branch win over plan prose — adapt and say so in the report.

---

### Task 1: Document authority in the mapper and dedupe

**Files:**
- Modify: `src/lib/prefill/types.ts` (ProposedField, ~:43-48)
- Modify: `src/lib/prefill/map-facts-to-fields.ts` (mapPermitFacts :53-133, dedupeProposals :214-236)
- Test: `src/lib/prefill/__tests__/map-facts-to-fields.test.ts` (NOT case ~:157, dedupe describe ~:241)
- Test: `src/lib/prefill/permits/__tests__/extract-records.test.ts` (D7 reuse block ~:186-240)
- Test: `src/lib/prefill/permits/__tests__/with-extraction.test.ts` (~:73-137)

**Interfaces:**
- Produces: `export interface ProposalAuthority { docRank: number }`; `ProposedField.authority?: ProposalAuthority`; `export function isTransferRecord(kind: PermitDocumentKind, docType: string): boolean`; `export function permitDocRank(kind: PermitDocumentKind, docType: string): number` (both from `map-facts-to-fields.ts`). Task 4 consumes `isTransferRecord` semantics via `classifyDocType`.

- [ ] **Step 1: Write the failing tests** in `map-facts-to-fields.test.ts` using the fixture above:
  1. `mapPermitFacts(notFacts, NOT_REC, { now: NOW })` proposes NO `facilityInfo.facilityAge` and NO `facilityInfo.facilityAgeEstimateExplanation`; still proposes `designFlow.estimatedDesignFlow` "450" whose explanation is `Notice of Transfer OWR-23-02001 · p.2 (transfer record — secondary source)`; every returned proposal has `authority.docRank === 2`; its recordsAvailable explanation is `Notice of Transfer OWR-23-02001 on file`.
  2. Same facts but `documentKind: "other"` with `docType: "NOTICE OF TRANSFER"` → still no age proposals, docRank 2.
  3. `mapPermitFacts(permitFacts, PERMIT_REC, { now: NOW })` → facilityAge "19", explanation "Permit issued 04/2007 (permit 071533)", `authority.docRank === 0` on every proposal.
  4. Mis-filed row: `documentKind: "approval_to_construct"` with `docType: "NOTICE OF TRANSFER"` → age IS proposed (verb "Approval to construct issued"), docRank 0.
  5. `dedupeProposals([...mapPermitFacts(notFacts, NOT_REC, { now: NOW }), ...mapPermitFacts(permitFacts, PERMIT_REC, { now: NOW })])` (NOT first — the D7 replay order) → exactly one `facilityInfo.facilityAge` = "19" with `provenance.recordId === "rec-permit"`; `designFlow.estimatedDesignFlow` "450" from `rec-not` survives (permit proposes none).
  6. Head-to-head: permit variant with `designFlowGpd: { value: 400, confidence: 0.7, … }` vs NOT 450 @ 0.97 → survivor "400" from `rec-permit`.
  7. Same docRank → strictly higher confidence wins; equal confidence → first-seen.
  8. Authority-less permit-source proposal (phase-2 style `facilityInfo.recordsAvailable`, conf 1, explanation containing "found on Maricopa EDMS") listed FIRST vs the PERMIT mapper's recordsAvailable (docRank 0, conf 1) → the phase-2 one survives; listed SECOND vs a NOT mapper recordsAvailable (docRank 2, conf 1) → the phase-2 one survives.
  9. A `listing` proposal never beats a NOT (`permit` source) proposal for the same field.
- [ ] **Step 2: Run** `npx vitest run src/lib/prefill/__tests__/map-facts-to-fields.test.ts --reporter=dot` → FAIL (no `authority`, age proposed from NOT, dedupe by confidence).
- [ ] **Step 3: Implement** — `types.ts`:
```ts
/** Which document class a permit-stage proposal came from; lower outranks higher (see DOC_CLASS_RANK) */
export interface ProposalAuthority {
  docRank: number;
}

export interface ProposedField {
  fieldPath: string;
  value: ProvenanceValue;
  kind: ProposalKind;
  provenance: Omit<ProvenanceEntry, "state" | "value" | "at" | "kind">;
  /** Permit-stage record proposals only; absent elsewhere (dedupe treats absent as rank 0) */
  authority?: ProposalAuthority;
}
```
`map-facts-to-fields.ts` (import `classifyDocType`, `DOC_CLASS_RANK` from `./permits/doc-types` and `PermitDocumentKind` from `@/lib/ai/permit-extraction-schema`):
```ts
const AUTHORITATIVE_KINDS: ReadonlySet<PermitDocumentKind> = new Set([
  "approval_to_construct",
  "discharge_authorization",
  "final_da",
]);

/** A Notice of Transfer by the model's verdict, or by the EDMS index when the model could not tell */
export function isTransferRecord(kind: PermitDocumentKind, docType: string): boolean {
  return kind === "notice_of_transfer" || (kind === "other" && classifyDocType(docType) === "notice_of_transfer");
}

/** Authority of a record's facts: what the model read outranks the EDMS index; lower wins */
export function permitDocRank(kind: PermitDocumentKind, docType: string): number {
  if (AUTHORITATIVE_KINDS.has(kind)) return DOC_CLASS_RANK.permit;
  if (kind === "notice_of_transfer") return DOC_CLASS_RANK.notice_of_transfer;
  if (kind === "abandonment") return DOC_CLASS_RANK.abandonment;
  return DOC_CLASS_RANK[classifyDocType(docType)];
}
```
Inside `mapPermitFacts`: `const transfer = isTransferRecord(facts.documentKind, record.docType); const authority: ProposalAuthority = { docRank: permitDocRank(facts.documentKind, record.docType) };` — `prov()` explanation becomes `transfer ? \`Notice of Transfer ${record.permitNumber} · p.${fact.page} (transfer record — secondary source)\` : \`Permit ${permitNo} · ${label} p.${fact.page}\``; `fill()` pushes `{ fieldPath, value, kind: "fill", provenance, authority }` (EVERY proposal in this function must go through `fill` so all carry authority — check the tanks/disposal/systemType/site-plan-notes pushes); recordsAvailable explanation `transfer ? \`Notice of Transfer ${record.permitNumber} on file\` : \`Permit ${permitNo} on file (${label})\``; age block guard becomes `if (facts.issueDate && !transfer)`. Dedupe:
```ts
function docRankOf(p: ProposedField): number {
  return p.authority?.docRank ?? 0;
}

/** True when `p` should replace `cur` for the same `kind:fieldPath` */
function beats(p: ProposedField, cur: ProposedField): boolean {
  const rankDiff = SOURCE_RANK[p.provenance.source] - SOURCE_RANK[cur.provenance.source];
  if (rankDiff !== 0) return rankDiff > 0;
  const docDiff = docRankOf(p) - docRankOf(cur);
  if (docDiff !== 0) return docDiff < 0;
  return p.provenance.confidence > cur.provenance.confidence;
}

/**
 * Combine stage proposals per `kind:fieldPath`: higher SOURCE_RANK wins (permit > assessor >
 * listing > scan); within a source the more authoritative document wins (lower
 * `authority.docRank`; no authority = rank 0, i.e. the EDMS index row); then strictly higher
 * confidence; then first-seen. Warnings never collide with fills. Output keeps first-seen order.
 */
export function dedupeProposals(proposals: ProposedField[]): ProposedField[] {
  const best = new Map<string, ProposedField>();
  for (const p of proposals) {
    const key = `${p.kind}:${p.fieldPath}`;
    const cur = best.get(key);
    if (!cur || beats(p, cur)) best.set(key, p);
  }
  return [...best.values()];
}
```
- [ ] **Step 4: Run** the file → PASS. Update any existing assertion on NOT caption text deliberately (say so in the report).
- [ ] **Step 5: Extend** `extract-records.test.ts` D7 block: a reused `done` NOT row (facts = `notFacts`) plus a freshly extracted PERMIT row (`extract` mocked to resolve `permitFacts`) → after `dedupeProposals`, exactly one `facilityInfo.facilityAge` and it is "19" from the permit record. Extend `with-extraction.test.ts`: the phase-2 recordsAvailable proposal (explanation containing "found on Maricopa EDMS", record download-route sourceUrl) survives against the mapper's recordsAvailable. Run both files → PASS. Also run `src/lib/prefill/__tests__/merge.test.ts`, `run-prefill.permits.test.ts`, `run-dto.test.ts`, `src/lib/prefill/permits/__tests__/index.test.ts` for shape fallout → PASS.
- [ ] **Step 6: Commit** `fix(prefill): permit-class records outrank a Notice of Transfer; never derive age from a transfer record`.

---

### Task 2: Prompt — a Notice of Transfer has no permit issue date

**Files:**
- Modify: `src/lib/ai/permit-extraction-prompt.ts` (layout 4 at ~:21, "issueDate / finalDate" bullet at ~:35)
- Test: `src/lib/ai/__tests__/permit-extraction-prompt.test.ts` (+ its `__snapshots__` file)

- [ ] **Step 1: Failing test** — `expect(PERMIT_EXTRACTION_SYSTEM_PROMPT).toContain("never emit issueDate")` and `.toContain("never an application, plan-check, signature, escrow or transfer date")`. Run the file → FAIL.
- [ ] **Step 2: Implement** — replace layout 4 with exactly:
`4. "Notice of Transfer" (a CivicPlus web-form email printout; numbers like OWR-23-02001). Records a property-transfer inspection: address, parcel, inspector, the transfer inspection date and the permit it references. A Notice of Transfer is NOT a permit and has no permit issue date — the dates it prints are submission, signature or escrow dates — so never emit issueDate for it. Report its own number as permitNumber, the transfer inspection date as finalDate, and system facts (tank, disposal, design flow, bedrooms, water source, system type) only when they are explicitly stated on the page; they are secondary to any permit on file.`
Replace the issueDate / finalDate bullet with exactly:
`- issueDate: the date the county approved or issued the permit itself — the Approval to Construct approval date or the Discharge Authorization / Final DA issuance date — never an application, plan-check, signature, escrow or transfer date. finalDate: the final inspection date (on a Notice of Transfer, the transfer inspection date). Both ISO yyyy-mm-dd. If only the month and year are legible, use the first of the month and lower the confidence. Never guess a year from context.`
- [ ] **Step 3: Run** the test file → the new assertions PASS and the snapshot FAILS; update the snapshot deliberately (`npx vitest run src/lib/ai/__tests__/permit-extraction-prompt.test.ts -u`), re-run → PASS. Confirm the prompt is still ≥ 1024 tokens (it only grew).
- [ ] **Step 4: Commit** `fix(ai): tell the extractor a Notice of Transfer has no permit issue date`.

---

### Task 3: Keep reading a permit-class document until the permit is identified

**Files:**
- Modify: `src/lib/ai/permit-facts-utils.ts` (next to `hasCoreFacts` ~:128)
- Modify: `src/lib/ai/extract-permit-facts.ts` (second-pass condition ~:348; `ExtractPermitFactsMeta` has `docType`)
- Modify: `src/lib/ai/permit-extraction-prompt.ts` (pass-2 user-message line ~:82)
- Test: `src/lib/ai/__tests__/permit-facts-utils.test.ts`, `src/lib/ai/__tests__/extract-permit-facts.test.ts`, `src/lib/ai/__tests__/permit-extraction-prompt.test.ts`

**Interfaces:**
- Produces: `export function hasPermitIdentity(facts: PermitFacts): boolean` in `permit-facts-utils.ts`.

- [ ] **Step 1: Failing tests** — `hasPermitIdentity`: false for `{ documentKind: "other", issueDate: <fact> }`, false for `{ documentKind: "approval_to_construct", issueDate: null }`, true for `{ documentKind: "approval_to_construct", issueDate: <fact> }`. In `extract-permit-facts.test.ts` (mocked Anthropic client, 15-page `docType: "PERMIT"`): pass 1 returns `permitFacts` (core facts present, kind `other`) → a SECOND `runPass` call happens covering the pages `planPasses` puts in `second`, and the merged result takes pass 2's `documentKind: "approval_to_construct"` and its typed `issueDate` 2007-04-12 @ 0.97 (over the handwritten 0.75); same pass-1 facts for `docType: "NOTICE OF TRANSFER"` → NO second call; pass 1 with kind `approval_to_construct` + issueDate + core facts → NO second call; pass 1 lacking core facts → second call as before. In the prompt test: the pass-2 user message mentions "Approval to Construct" / "documentKind". Run → FAIL.
- [ ] **Step 2: Implement** —
```ts
/** Owner rule: a permit-class document is read further until the permit itself is identified. */
export function hasPermitIdentity(facts: PermitFacts): boolean {
  return facts.documentKind !== "other" && facts.issueDate != null;
}
```
In `extractPermitFacts` (import `classifyDocType` from `@/lib/prefill/permits/doc-types`):
```ts
  const permitClass = classifyDocType(meta.docType) === "permit";
  const needsSecondPass =
    plan.second.length > 0 && (!hasCoreFacts(facts) || (permitClass && !hasPermitIdentity(facts)));
  if (needsSecondPass) { …existing pass-2 block… }
```
`mergePermitFacts` already keeps a positive kind over `other` (:105) and the higher-confidence `issueDate` (`pickFact`) — do not change it; assert it in the test. Pass-2 user message (replace the `meta.pass === 2` string):
`"The first pages of this document did not settle its tank capacity / disposal type and/or its permit identity. Look for tank capacity and disposal type on these later pages (inspection cards, as-built tables, plot plans, plan-check notes). If any of these pages is an Approval / Authorization to Construct, a Discharge Authorization or a Final DA — including a county approval stamp — report that documentKind and the county approval/issue date as issueDate; otherwise report documentKind for these pages on their own."`
- [ ] **Step 3: Run** the three files → PASS (update the user-message snapshot deliberately if one exists). Note in the report: cost impact = one extra ≤20-page pass (≈ $0.03–0.10) only for permit-class documents whose first pages did not identify the permit.
- [ ] **Step 4: Commit** `fix(ai): read a permit-class document past page 4 until the permit is identified`.

---

### Task 4: Captions and UI — a Notice of Transfer is a transfer record

**Files:**
- Modify: `src/lib/prefill/permits/index.ts` (recordsAvailable caption ~:214-220)
- Modify: `src/components/prefill/permit-records-list.tsx` (import at :7; row label ~:131)
- Test: `src/lib/prefill/permits/__tests__/index.test.ts`, `src/components/prefill/__tests__/permit-records-list.test.tsx`

- [ ] **Step 1: Failing tests** — `index.test.ts`: when the top-ranked hit is a NOTICE OF TRANSFER (no permit-class hit), the recordsAvailable explanation is `Notice of Transfer OWR-23-02001 found on Maricopa EDMS (transfer record — no permit found)`; with a PERMIT present the caption stays `Permit 071533 (PERMIT) found on Maricopa EDMS`. `permit-records-list.test.tsx`: a NOTICE OF TRANSFER row renders the text `transfer record — used only for facts no permit states`; a PERMIT row does not; both still render the extraction badge and the Open PDF link. Run → FAIL.
- [ ] **Step 2: Implement** — `index.ts`: `const firstIsTransfer = classifyDocType(first.docType) === "notice_of_transfer";` and pick the caption accordingly (`classifyDocType` is exported from `./doc-types`). `permit-records-list.tsx`: add `classifyDocType` to the existing `@/lib/prefill/permits/doc-types` import; after the docType text render `{classifyDocType(r.docType) === "notice_of_transfer" && <span className="text-muted-foreground"> · transfer record — used only for facts no permit states</span>}` (match the row's existing classes/markup).
- [ ] **Step 3: Run** both files → PASS. Also run `src/components/prefill/__tests__/prefill-sources-tile.permits.test.tsx`.
- [ ] **Step 4: Commit** `fix(prefill): caption a Notice of Transfer as a transfer record in the tile and records list`.

---

### Task 5: Gate

- [ ] From the repo root: `rm -rf .next && npm run build` → passes. `npx vitest run --reporter=dot` → the ONLY failures are the pre-existing 12 (rbac/roles/nav/mobile-nav, download route ×2, reopen route ×2, constants STEP_LABELS, validators ×2 …) — anything else is this branch's regression: fix with a focused commit and re-run. `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "$(git diff --name-only main...HEAD | tr '\n' '|' )"` style check: no NEW type errors in files this branch touched. (Use `-E`, not `-F` — `-F` treats the pipe-joined file list as one literal fixed string rather than alternation, so it reports "no match" unconditionally and proves nothing.)
- [ ] Write the PR body draft to `.superpowers/sdd/fixnot-pr-body.md` (summary, root cause, what changed, verification evidence with exact commands/counts, cost note from Task 3, follow-ups: `constructionDate` as a secondary age source, let higher authority replace an already-prefilled value, persist token cost per stage, listing cache; rollback = revert the merge). Do NOT push, do NOT open a PR.
