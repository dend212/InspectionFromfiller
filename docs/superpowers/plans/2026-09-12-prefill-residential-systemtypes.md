# Prefill: Wastewater Source / Facility Type and GP 4.02 System Types — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prefill "Wastewater Source" (residential/commercial/other) and "Facility Type" (single_family/multifamily/commercial/other) from the county's property-use code (assessor) with Zillow's home type as corroboration/fallback; and check the "General Treatment & Disposal Type" GP 4.02 boxes (conventional, septic tank, trench/bed/chamber/seepage pit) from the facts already extracted from permits. Show human labels instead of raw enum tokens in suggestion chips and badge popovers.

**Why the residential rule is assessor-first:** every Maricopa parcel carries a Property Use Code (PUC) on the public Assessor ArcGIS layer (01xx single-family residence, 03xx multiple residential, 07xx condo/townhouse, 08xx manufactured-home land, 10xx–39xx commercial/industrial, 00xx vacant, 4xxx+ agricultural — ADOR PUC manual; live samples 219-11-121 → 0141, 216-23-063 → 0151, commercial 1511, multi-res 0336, vacant 0012). It is typed county metadata, present for off-market homes where Zillow is thin, and already fetched by the assessor stage (one more `outField`). Zillow `homeType` (SINGLE_FAMILY, TOWNHOUSE, CONDO, MANUFACTURED, MULTI_FAMILY, APARTMENT, LOT) corroborates and covers the rare parcel without a usable PUC; `SOURCE_RANK` (assessor 2 > listing 1) already prefers the assessor. Permits are deliberately NOT used for these two fields: a permit's bedrooms/design flow is only an inference, and because `SOURCE_RANK` puts permit (3) above assessor (2) any permit proposal would displace the authoritative PUC fill.

**Architecture:** assessor stage → `ParcelAttributes.PUC` → `AssessorSummary.propertyUseCode` → two extra proposals in `assessorProposals`; listing stage → `ListingFacts.homeType` → two extra proposals in `mapListingFacts`; permit mapper → new array proposal `generalTreatment.systemTypes` (+ `generalTreatment.alternativeSystem` when the permit names an alternative system); `format.ts` gains a field-aware value formatter backed by the existing constants label lists.

**Tech Stack:** TypeScript, Next.js 16, Vitest 4 (jsdom for components), zod 4.

## Global Constraints

- **Field paths / values (exact):** `facilityInfo.wastewaterSource` ∈ residential|commercial|other (`WASTEWATER_SOURCES`, `src/lib/constants/inspection.ts`); `facilityInfo.facilityType` ∈ single_family|multifamily|commercial|other (`FACILITY_TYPES`); `generalTreatment.systemTypes` = array of `GP402_SYSTEM_TYPES` values in that constant's order (`gp402_conventional, gp402_septic_tank, gp402_disposal_trench, gp402_disposal_bed, gp402_chamber, gp402_seepage_pit, …`); `generalTreatment.alternativeSystem` boolean.
- **PUC rule table (exact; `pucPrefix` = first two characters of the 4-digit code, missing/short code → no proposal):**
  | prefix | wastewaterSource | facilityType |
  |---|---|---|
  | `01` | residential @ 0.95 | single_family @ 0.95 |
  | `03` | residential @ 0.9 | multifamily @ 0.9 |
  | `07` | residential @ 0.9 | multifamily @ 0.7 |
  | `08` | residential @ 0.9 | single_family @ 0.85 |
  | `10`–`39` | commercial @ 0.9 | commercial @ 0.9 |
  | anything else (`00`, `4x`+, blank) | — | — |
  Explanation text: `Maricopa County Assessor · property use code ${code} (${PUC_LABEL[prefix]})` with labels `01` "single family residence", `03` "multiple residential", `07` "condominium / townhouse", `08` "manufactured home", `10`–`39` "commercial / industrial"; evidence `PUC: ${code}`; `sourceUrl` = `assessorParcelUrl(apn)`.
- **Zillow homeType rule table (exact; compare upper-cased):** `SINGLE_FAMILY`, `MANUFACTURED` → residential @ 0.85, single_family @ 0.85; `TOWNHOUSE` → residential @ 0.85, single_family @ 0.8; `CONDO`, `APARTMENT`, `MULTI_FAMILY` → residential @ 0.85, multifamily @ 0.8; anything else (`LOT`, `HOME_TYPE_UNKNOWN`, missing) → no proposal. Explanation `Zillow lists the home as ${humanised homeType}` (e.g. "Single Family", "Townhouse"), evidence `homeType: ${raw}`, sourceUrl = the listing url.
- **GP 4.02 array rule (exact):** from one record's `PermitFacts`: tokens = [`gp402_conventional` if `systemType.value === "conventional"`] ∪ [`gp402_septic_tank` if any `tanks[i].capacityGal` fact exists] ∪ [`DISPOSAL_TO_GP402[disposal.type.value]` where trench→`gp402_disposal_trench`, bed→`gp402_disposal_bed`, chamber→`gp402_chamber`, seepage_pit→`gp402_seepage_pit`; `other`/absent → nothing]; emit the array in `GP402_SYSTEM_TYPES` order only when non-empty; confidence = min of the contributing facts' confidences (no 0.7 cap); provenance page/evidence from the disposal fact, else the best tank fact, else systemType; explanation `${docLabel} · GP 4.02 ${labels joined ", "} p.${page}` using the existing permit/transfer caption helpers (a Notice of Transfer keeps the "(transfer record — secondary source)" suffix). Abandonment records emit nothing (existing rule). When `systemType.value === "alternative"` additionally propose `generalTreatment.alternativeSystem = true` at the systemType confidence.
- **No persisted-schema change;** array fills replace the whole array (existing merge semantics: fills land only on an empty array, otherwise a suggestion chip) — do not add union logic.
- **Human labels:** `formatFieldValue(fieldPath, value)` in `src/components/prefill/format.ts` maps enum/array tokens to labels via a registry `{ "facilityInfo.wastewaterSource": WASTEWATER_SOURCES, "facilityInfo.facilityType": FACILITY_TYPES, "generalTreatment.systemTypes": GP402_SYSTEM_TYPES, "facilityInfo.facilitySystemTypes": FACILITY_SYSTEM_TYPES, "designFlow.waterSource": WATER_SOURCE_TYPES (use the real constant name), "disposalWorks.disposalType": DISPOSAL_TYPES (real name), "facilityInfo.occupancyType": OCCUPANCY_TYPES }` (include every constant list in `src/lib/constants/inspection.ts` whose values a prefill proposal can carry; unknown paths/tokens fall back to `formatProvenanceValue`). Used by the suggestion chip text/aria-label and the badge popover value line.
- Never run `npm run lint`, Biome or any formatter. Focused tests only (`npx vitest run <file> --reporter=dot`) except in the gate. `.env.local` is production — unit tests mock `@/lib/db`, `@/lib/supabase/admin`, `fetch`; never call real services from tests. Real exports on the branch win over plan prose — adapt and say so.

---

### Task 1: Assessor property-use code → Wastewater Source + Facility Type

**Files:**
- Modify: `src/lib/prefill/assessor.ts` (`OUT_FIELDS` :12-25, `ParcelAttributes`, the summary builder)
- Modify: `src/lib/prefill/assessor-fields.ts` (`AssessorSummary`, `assessorProposals`)
- Test: `src/lib/prefill/__tests__/assessor.test.ts`, `src/lib/prefill/__tests__/assessor-fields.test.ts`
- Check (no change expected): `src/app/api/apn-lookup/route.ts` and `src/lib/prefill/run-prefill.ts` callers still type-check with the new optional field.

**Interfaces:**
- Produces: `AssessorSummary.propertyUseCode?: string` (4-char PUC as returned, trimmed); `export function propertyUseProposals(code: string | undefined, apn: string): ProposedField[]` used inside `assessorProposals`.

- [ ] **Step 1: Failing tests** — `assessor.test.ts`: the request's `outFields` includes `PUC`; a feature with `PUC: "0141"` yields `propertyUseCode: "0141"`; missing/null PUC → `propertyUseCode` undefined. `assessor-fields.test.ts`: `assessorProposals({...summary, propertyUseCode: "0141"}, "219-11-121")` includes `facilityInfo.wastewaterSource = "residential"` @ 0.95 and `facilityInfo.facilityType = "single_family"` @ 0.95, source `assessor`, explanation `Maricopa County Assessor · property use code 0141 (single family residence)`, evidence `PUC: 0141`; table cases `0336` → residential 0.9 / multifamily 0.9; `0712` → residential 0.9 / multifamily 0.7; `0801` → residential 0.9 / single_family 0.85; `1511` → commercial 0.9 / commercial 0.9; `2100` → commercial; `0012`, `4101`, `""`, undefined → neither field proposed; existing seven proposals unchanged. Run both files → FAIL.
- [ ] **Step 2: Implement** per the PUC table (a small `PUC_RULES` array of `{ prefixes: string[] | [from,to], wastewaterSource, wsConfidence, facilityType, ftConfidence, label }`), keeping `assessorProposals` the single entry point.
- [ ] **Step 3: Run** both files → PASS; also run `src/lib/prefill/__tests__/run-prefill.test.ts` and `src/app/api/apn-lookup/__tests__/*` if present.
- [ ] **Step 4: Commit** `feat(prefill): propose wastewater source and facility type from the assessor property-use code`.

---

### Task 2: Zillow homeType → Wastewater Source + Facility Type (fallback)

**Files:**
- Modify: `src/lib/prefill/listing/provider.ts` (`ListingFacts.homeType?: string`)
- Modify: `src/lib/prefill/listing/zillow-apify.ts` (`normaliseListingItem`: read top-level `homeType`, else `resoFacts.homeType`, else first `resoFacts.propertySubType`; store the raw string)
- Modify: `src/lib/prefill/map-facts-to-fields.ts` (`mapListingFacts`)
- Test: `src/lib/prefill/listing/__tests__/zillow-apify.test.ts` (fixture `apininja-venus-for-sale.json` has `homeType: "SINGLE_FAMILY"`), `src/lib/prefill/__tests__/map-listing-facts.test.ts`

- [ ] **Step 1: Failing tests** — normalisation yields `homeType: "SINGLE_FAMILY"` from the venus fixture and from the off-market fixture; `mapListingFacts({ …, homeType: "SINGLE_FAMILY" })` proposes `facilityInfo.wastewaterSource = "residential"` @ 0.85 and `facilityInfo.facilityType = "single_family"` @ 0.85 with explanation `Zillow lists the home as Single Family`, evidence `homeType: SINGLE_FAMILY`, source `listing`; `TOWNHOUSE` → residential 0.85 / single_family 0.8; `CONDO` → residential 0.85 / multifamily 0.8; `LOT` and missing → neither. `dedupeProposals([assessor residential 0.95, listing residential 0.85])` keeps the assessor one (existing rule — assert it). Run → FAIL.
- [ ] **Step 2: Implement** per the homeType table (a `HOME_TYPE_RULES` map; humanise the label by title-casing the token with `_` → space).
- [ ] **Step 3: Run** the files → PASS; also `src/lib/prefill/__tests__/run-prefill.listing.test.ts`.
- [ ] **Step 4: Commit** `feat(prefill): propose wastewater source and facility type from the Zillow home type`.

---

### Task 3: GP 4.02 system-type checkboxes from permit facts

**Files:**
- Modify: `src/lib/prefill/map-facts-to-fields.ts` (`mapPermitFacts`, near the existing systemType block ~:231-240)
- Test: `src/lib/prefill/__tests__/map-facts-to-fields.test.ts` (rows table ~:61-79 + key-set assertion ~:91-93, edge cases ~:181, NOT caption ~:298, D7 replay ~:352, head-to-head ~:366)

- [ ] **Step 1: Failing tests** — with the existing `daFacts` fixture (tank + seepage_pit + conventional): a `generalTreatment.systemTypes` proposal `["gp402_conventional", "gp402_septic_tank", "gp402_seepage_pit"]`, confidence = min of the three facts, explanation `<docLabel> · GP 4.02 GP 4.02 Conventional Septic Tank/Disposal System, Septic Tank, Disposal by Seepage Pit p.<disposal page>` — if the doubled "GP 4.02" reads badly, use the option labels without the leading "GP 4.02" prefix for the conventional token, i.e. `… · GP 4.02 Conventional, Septic Tank, Disposal by Seepage Pit p.N` and pin that; `authority` attached; trench → `gp402_disposal_trench`, bed → `gp402_disposal_bed`, chamber → `gp402_chamber`; `disposal.type = "other"` with a tank → `["gp402_septic_tank"]` (plus conventional if stated); no tank, no disposal, no systemType → no proposal; `systemType alternative` (no conventional token) + tank + trench → `["gp402_septic_tank","gp402_disposal_trench"]` AND `generalTreatment.alternativeSystem = true`; Dove Valley `permitFacts` (tank 1500 @ 0.72, no disposal, no systemType) → `["gp402_septic_tank"]` @ 0.72 (a suggestion, below the 0.75 gate — assert only the proposal); NOT record → caption keeps the transfer suffix and docRank 2; abandonment → nothing (existing). Update the rows-table key-set assertion. Run → FAIL.
- [ ] **Step 2: Implement** with a `DISPOSAL_TO_GP402` const and a `gp402Tokens(facts)` helper that returns tokens in `GP402_SYSTEM_TYPES` order (import the constant for ordering/labels).
- [ ] **Step 3: Run** the file → PASS; also `src/lib/prefill/permits/__tests__/extract-records.test.ts` and `src/lib/prefill/__tests__/merge.test.ts`.
- [ ] **Step 4: Commit** `feat(prefill): check GP 4.02 system-type boxes from extracted permit facts`.

---

### Task 4: Human labels for enum/array values in chips and badge popovers

**Files:**
- Modify: `src/components/prefill/format.ts` (add `formatFieldValue(fieldPath, value)` + `FIELD_VALUE_LABELS` registry from `src/lib/constants/inspection.ts`)
- Modify: `src/components/prefill/suggestion-chip.tsx` (`buildSuggestionText`, aria-label → use `formatFieldValue(fieldPath, entry.value)`; thread `fieldPath` through `suggestionText`/`suggestionDisplayText`)
- Modify: `src/components/prefill/provenance-badge.tsx` (popover value line → `formatFieldValue`)
- Test: `src/components/prefill/__tests__/format.test.ts` (create), `suggestion-chip.test.tsx`, `provenance-badge.test.tsx`

- [ ] **Step 1: Failing tests** — `formatFieldValue("generalTreatment.systemTypes", ["gp402_septic_tank","gp402_seepage_pit"])` → `Septic Tank, Disposal by Seepage Pit`; `("facilityInfo.wastewaterSource","residential")` → `Residential`; `("facilityInfo.facilityType","single_family")` → `Single Family Residence`; `("facilityInfo.facilitySystemTypes",["conventional"])` → `Conventional System`; unknown path → falls back to `formatProvenanceValue`; booleans → Yes/No; chip for a `generalTreatment.systemTypes` suggestion renders `Suggested: Septic Tank, Disposal by Seepage Pit · 90% · …` and its aria-label uses the labels; badge popover shows the label. Run → FAIL.
- [ ] **Step 2: Implement** (registry keyed by field path; keep `formatProvenanceValue` for the generic case).
- [ ] **Step 3: Run** the files → PASS; also `src/components/prefill/__tests__/provenance-context.test.tsx` and `src/components/inspection/__tests__/form-provenance.test.tsx`.
- [ ] **Step 4: Commit** `feat(prefill): show human labels for enum and checkbox values in chips and popovers`.

---

### Task 5: Gate

- [ ] From the repo root: `rm -rf .next && npm run build` → passes. `npx vitest run --reporter=dot` → the ONLY failures are the 12 pre-existing ones (rbac/roles/nav/mobile-nav, download route ×2, reopen route ×2, constants STEP_LABELS, validators ×2 …) — anything else is this branch's regression: fix with a focused commit and re-run. Type check: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "$(git diff --name-only main...HEAD | sed 's/[][]/\\&/g' | paste -sd'|' -)"` must print nothing new versus main.
- [ ] Write the PR body draft to `.superpowers/sdd/wws-pr-body.md` (summary, the residential rule + why assessor-first, what changed per task, verification evidence with exact commands/counts, follow-ups, rollback = revert the merge). Do NOT push, do NOT open a PR.
