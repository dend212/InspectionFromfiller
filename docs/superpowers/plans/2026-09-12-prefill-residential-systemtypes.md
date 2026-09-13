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

---

## Addendum — audit batch 0 (fix wave before merge)

Source: `docs/superpowers/specs/2026-09-12-prefill-coverage-recommendations.md` §2.3, §3, §5.1 (two critic passes over the in-flight branch). Owner decision 2 defaults to the recommendation (chips).

### Task 6: Fix wave — PUC corrections, per-field source order, Zillow guard, tank exclusions, warning-on-prefilled

**Files:**
- Modify: `src/lib/prefill/assessor-fields.ts` (`PUC_RULES` ~:36-90, `assessorProposals`; add `propertyUseNote`)
- Modify: `src/lib/prefill/assessor.ts` (stage `summary` ~:239 — append the note)
- Modify: `src/lib/prefill/map-facts-to-fields.ts` (`beats()`/`SOURCE_RANK`, `HOME_TYPE_RULES`, `humaniseHomeType`, `gp402Tokens`, numberOfTanks, `alternativeSystem`, `mapListingFacts`)
- Modify: `src/lib/prefill/listing/provider.ts`, `src/lib/prefill/listing/zillow-apify.ts` (`ListingFacts.parcelId`, homeType canonicaliser), `src/lib/prefill/listing/index.ts` (pass the run's APN; note on mismatch)
- Modify: `src/lib/prefill/types.ts` (`ProvenanceEntry.warning?: string`), `src/lib/prefill/merge.ts`, `src/lib/prefill/provenance-schema.ts`, `src/components/prefill/provenance-context.tsx` (`dismissWarning`), `src/components/prefill/suggestion-chip.tsx`, `src/components/ui/form.tsx` (render the chip when `entry.warning` is set), `src/components/prefill/format.ts` (short label for `gp402_conventional`)
- Test: `src/lib/prefill/__tests__/{assessor-fields,assessor,map-facts-to-fields,map-listing-facts,merge,provenance-schema}.test.ts`, `src/lib/prefill/listing/__tests__/normalise.test.ts`, `src/lib/prefill/__tests__/run-prefill.listing.test.ts`, `src/components/prefill/__tests__/{suggestion-chip,provenance-context,format}.test.ts(x)`, `src/components/inspection/__tests__/form-provenance.test.tsx`

Each sub-item is RED → GREEN → commit (one commit per lettered item is fine; message `fix(prefill): <item> (audit batch 0)`).

- [ ] **6a — PUC table (exact).** Replace the rule set so a 4-digit code maps by its first THREE digits where noted:
  | code | wastewaterSource | facilityType | note (appended to the assessor stage summary) |
  |---|---|---|---|
  | `010`–`017` | residential 0.95 | single_family 0.95 | — |
  | `018` | residential 0.95 | single_family **0.7** | `PUC 018x — second residence on parcel; check for a second or shared system` |
  | `019` | — | — | `PUC 019x — no dwelling coded on this parcel; confirm the structure served` |
  | `03` | residential 0.9 | multifamily **0.7** | — |
  | `04`, `05`, `06` | commercial 0.9 | commercial 0.9 | — |
  | `07` | residential 0.9 | multifamily 0.7 | `PUC 07xx — condo/townhouse; confirm the system is not shared` |
  | `081`–`083` | residential 0.9 | single_family 0.85 | — |
  | `084`–`089` | residential **0.7** | — | `PUC 08xx — MH/RV park: shared or large-flow system likely (250 gpd per space); confirm facility type and number of systems` |
  | `871`, `873`, `874`, `875` | residential 0.95 | single_family 0.9 | — |
  | `872`, `877` | residential 0.9 | single_family 0.7 | `PUC 87xx — two residences on parcel; check for a second or shared system` |
  | `10`–`39` | commercial 0.9 | commercial 0.9 | — |
  | `00` | — | — | `Assessor codes this parcel vacant (PUC 00xx) — confirm the structure served` |
  | anything else / blank / not 4 digits | — | — | — |
  Labels in the explanation: 01 "single family residence", 03 "multiple residential", 04–06 "hotel / motel / resort", 07 "condominium / townhouse", 08 "manufactured home", 87 "residential, over 5 acres", 10–39 "commercial / industrial". Export `propertyUseNote(code: string | undefined): string | null`; `assessor.ts` appends it to the stage summary with ` · `. Tests: every row above (both fields + note), plus `8712` → residential 0.95 / single_family 0.9 (invert the existing "proposes nothing for 8712" test), `0197` → nothing + note, `0845` → residential 0.7 only + note, `0501` → commercial.
- [ ] **6b — per-field source order.** In `map-facts-to-fields.ts`: `const FIELD_SOURCE_RANK: Partial<Record<string, Record<PrefillSource, number>>> = { "facilityInfo.wastewaterSource": { assessor: 3, listing: 2, permit: 1, scan: 0 }, "facilityInfo.facilityType": { assessor: 3, listing: 2, permit: 1, scan: 0 } };` and `beats()` uses `(FIELD_SOURCE_RANK[p.fieldPath] ?? SOURCE_RANK)[p.provenance.source]`. Tests: assessor 0.95 beats a permit 0.7 (with `authority.docRank 0`) for `wastewaterSource`; listing 0.85 beats permit 0.9 for `facilityType`; permit 0.8 still beats assessor 0.95 for `facilityInfo.facilityAge`; swap the existing map-listing-facts dedupe test to listing 0.95 vs assessor 0.85 (assessor must still win).
- [ ] **6c — Zillow.** (i) Canonicalise before the `HOME_TYPE_RULES` lookup: upper-case, strip everything but letters, then alias `SINGLEFAMILY`/`SINGLEFAMILYRESIDENCE` → `SINGLE_FAMILY`, `CONDOMINIUM`/`CONDO` → `CONDO`, `MANUFACTUREDHOME`/`MOBILEHOME`/`MANUFACTURED` → `MANUFACTURED`, `TOWNHOME`/`TOWNHOUSE` → `TOWNHOUSE`, `MULTIFAMILY` → `MULTI_FAMILY`, `APARTMENT` → `APARTMENT`; `humaniseHomeType` upper-cases the first letter of each word. Tests: `it.each` over the six tokens, plus `"SingleFamily"`, `"Single Family Residence"`, `"Manufactured Home"`, `"single_family"`. (ii) Parcel guard: `ListingFacts.parcelId?: string` from item `parcelId` else `resoFacts.parcelNumber` (string, trimmed); `mapListingFacts(facts, opts?: { apn?: string })` — when both `facts.parcelId` and `opts.apn` are present and `norm(a) !== norm(b)` (`norm` = upper-case, strip non-alphanumerics; `21174047P` ≠ `21174047` but `211-74-047P` = `21174047P`) then every listing proposal's confidence becomes `Math.min(conf, 0.6)` and its explanation gets ` · listing parcel ${parcelId} ≠ APN ${apn} — confirm this is the right property`; the listing stage passes the run input's APN when it has one and appends `Listing parcel ${parcelId} does not match APN ${apn}` to its summary. Tests in map-listing-facts + run-prefill.listing.
- [ ] **6d — alternative pages gate.** `generalTreatment.alternativeSystem` proposed at `Math.min(systemType.confidence, 0.7)`; also propose top-level `includeAlternativePages = true` at the same confidence (both chips). Tests updated.
- [ ] **6e — tank exclusions.** `const NON_SEPTIC_TANK = /dosing|pump|lift|sump|aerobic|ATU|microfast|treatment/i;` a tank whose `model?.value` matches is not a septic tank: it never contributes `gp402_septic_tank`, and `septicTank.numberOfTanks` = count of non-excluded tanks (if the mapper currently derives it differently, adapt so the count excludes them); when at least one excluded tank exists the numberOfTanks confidence is capped at 0.7. Tests: DA with 1500-gal "BIOMICROBICS MICROFAST 0.9" + 1000-gal septic + seepage pit → systemTypes contains `gp402_septic_tank` (from the septic tank) and numberOfTanks "1" @ ≤ 0.7; a lone "dosing tank" → no `gp402_septic_tank`.
- [ ] **6f — warning on a prefilled field (audit 5.1).** `ProvenanceEntry.warning?: string` (types.ts; provenance-schema allows `warning: z.string().max(500).optional()`). `mergeProposals`: handle `kind: "warning"` proposals AFTER all fills for the same merge; if the path already has a `next[fieldPath]` from this merge, or an `existing` entry whose state is prefilled/suggested/edited, attach `warning: proposal.provenance.explanation` to that entry instead of replacing it; otherwise today's behaviour (a warning-only entry). A verified entry still drops the warning. `provenance-context.tsx`: `dismissWarning(fieldPath)` removes only `warning` (PATCH like dismiss). `form.tsx` FormItem/FormFieldGroup render `<SuggestionChip>` when `entry.state === "suggested" || entry.warning`; `suggestion-chip.tsx` renders an amber warning line with the warning text and a dismiss (× → `dismissWarning`) whenever `entry.warning` is set, in addition to (not instead of) the suggestion chip when the entry is suggested. Tests: merge (fill + warning same path, both orders → prefilled entry with `warning`; warning-only unchanged; verified drops it), provenance-schema (accepts `warning`), suggestion-chip (prefilled + warning renders the line; dismiss clears only the warning), form-provenance (badge stays "prefilled" with the warning line under it).
- [ ] **6g — small final-review items.** `gp402Tokens` returns the primary fact explicitly as `disposal ?? bestTank ?? systemType`; type `DISPOSAL_TO_GP402`/captions with `(typeof GP402_SYSTEM_TYPES)[number]["value"]`; `FIELD_VALUE_LABELS["generalTreatment.systemTypes"]` uses the short label `GP 4.02 Conventional` for `gp402_conventional` (others unchanged) so the chip reads `Suggested: GP 4.02 Conventional, Septic Tank, Disposal by Seepage Pit …`.
- [ ] Run every listed test file → PASS. Also `src/lib/prefill/__tests__/run-prefill.test.ts`, `run-prefill.permits.test.ts`, `src/lib/prefill/permits/__tests__/extract-records.test.ts`, `src/components/inspection/__tests__/step-facility-info-provenance.test.tsx`.

### Task 7: Gate (repeat of Task 5 on the fix-wave head)

- [ ] `rm -rf .next && npm run build` passes; `npx vitest run --reporter=dot` → only the 12 pre-existing failures; scoped tsc on touched files prints nothing new. Report real numbers only.
- [ ] Rewrite `.superpowers/sdd/wws-pr-body.md` from scratch for the whole branch: summary, the residential rule (assessor-first, why), the PUC table as shipped, GP 4.02 rule with exclusions, human labels, the warning-on-prefilled change (additive optional `warning` key in `field_provenance` JSON — no migration), per-commit table, verification evidence with exact commands/counts, known trade-offs (array fill replaces; permit-class array beats a NOT's longer one; chip text truncates at 60 chars), follow-ups (audit batches 1–6), rollback = revert the merge. Do NOT push, do NOT open a PR.

### Task 8: Address lookup honours street direction + ZIP; cross-stage parcel guard; two small hardenings

Found by the fix-wave e2e (`.superpowers/sdd/wws-fw-e2e.md` D1/D2) and the final review (`wws-final-review-fw.md`).

**Files:**
- Modify: `src/lib/prefill/assessor.ts` (`findParcelByAddress` :123-135, its caller ~:211, `OUT_FIELDS`, `ParcelAttributes`)
- Modify: `src/lib/prefill/run-prefill.ts` (post-fan-out parcel comparison ~:152-190), `src/lib/prefill/listing/index.ts` (expose the listing's parcel id on its stage result), `src/lib/prefill/listing/provider.ts` if a type is needed
- Modify: `src/lib/prefill/map-facts-to-fields.ts` (`NON_SEPTIC_TANK` :65; `capListingProposals` helper if not already factored out of `mapListingFacts`)
- Modify: `src/lib/prefill/merge.ts` (stale `warning` on a no-op prefilled path)
- Test: `src/lib/prefill/__tests__/assessor.test.ts`, `run-prefill.test.ts` / `run-prefill.listing.test.ts`, `map-facts-to-fields.test.ts`, `map-listing-facts.test.ts`, `merge.test.ts`, `src/lib/prefill/listing/__tests__/index.test.ts`

- [ ] **8a — street direction + ZIP (PRE-EXISTING production bug, High).** `findParcelByAddress(streetNumber, streetName, opts, hints?: { streetDir?: string; zip?: string })`: request `PHYSICAL_STREET_DIR` in `OUT_FIELDS` (add to `ParcelAttributes`); when `hints.streetDir` is set, query `PHYSICAL_STREET_NUM='…' AND PHYSICAL_STREET_NAME LIKE '…%' AND PHYSICAL_STREET_DIR='E'` first and fall back to the undirected query only on 0 rows; among the returned rows prefer the one whose `PHYSICAL_ZIP` (first 5 digits) equals `hints.zip` (first 5 digits) when a ZIP hint is given, else the first row. The caller passes `input.address.streetDir` and `input.address.zip`. Tests (mock `fetch`): "3402 E Sells Dr" with rows [154-22-029 W 85017, 170-28-066F E 85018] → 170-28-066F; direction given but the directed query returns 0 rows → undirected fallback; no direction but ZIP 85018 → the 85018 row; neither → first row (today's behaviour). Assert the exact `where` string sent.
- [ ] **8b — cross-stage parcel guard (D2).** The listing stage result carries `parcelId?: string` (from `facts.parcelId`). In `runPrefill` after `Promise.allSettled`, compute `resolvedApn = formatApn(resolved?.apn ?? input.apn)`; if the listing fulfilled with a `parcelId` and `listingParcelMismatch(parcelId, resolvedApn)` (export it from the listing module / share the `norm` helper) then: cap every proposal with `provenance.source === "listing"` at confidence `Math.min(c, 0.6)` and append ` · listing parcel ${parcelId} ≠ APN ${resolvedApn} — confirm this is the right property` to its explanation (reuse the exact helper `mapListingFacts` uses so the text is identical), and append `Listing parcel ${parcelId} does not match APN ${resolvedApn}` to `stages.listing.summary` — unless the listing stage already applied the guard against the same APN (typed-APN path), in which case do nothing (no double suffix). Tests in `run-prefill.listing.test.ts`: address-only run where the assessor resolves 154-22-029 and the listing returns parcel 17028066F → listing proposals capped + suffixed once, summary line present; typed-APN path unchanged (guard applied once by the stage, not twice).
- [ ] **8c — tank regex.** `NON_SEPTIC_TANK = /dosing|\bpump\b|pump tank|\blift\b|\bsump\b|aerobic|\bATU\b|microfast|treatment/i` — tests: "Saturn 1000" and "Uplift" are septic tanks; "dosing tank", "PUMP TANK", "ATU", "MicroFAST 0.9", "aerobic treatment unit" are excluded.
- [ ] **8d — stale warning.** In `mergeProposals`, when a fill proposal lands on a path whose existing entry is `prefilled` with the same value (the no-op path) and this merge carries no warning proposal for that path, drop `warning` from the carried-over entry. Test: run 1 attaches a warning; run 2 re-proposes the same fill without a warning → entry has no `warning`.
- [ ] Run the listed test files → PASS. Commit per lettered item: `fix(prefill): <item> (e2e follow-up)`.

### Task 9: Gate (repeat on the Task 8 head)

- [ ] Same as Task 7; refresh `.superpowers/sdd/wws-pr-body.md` (add the Task 8 commits, fix the touched-file and route counts the last review flagged, and the GP 4.02 wording "if a septic tank has a capacity fact"). Do NOT push, do NOT open a PR.
