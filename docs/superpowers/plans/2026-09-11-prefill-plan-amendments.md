# Prefill plans — controller amendments

Resolutions of cross-plan ambiguities found after the phase plans were written. These override the plan text where they conflict. The controller hands the relevant bullet to each implementer with its task brief.

## A1. Tank fields are per-tank (`septicTank.tanks.<i>.*`) — affects Phase 1 Tasks 2/13/15 and Phase 3 Task 7

`tankCapacity`, `capacityBasis`, `tankMaterial`, `tankDimensions` exist **only** inside `tankInspectionSchema` (`septicTank.tanks[n]`), never at `septicTank.*`. Provenance keys and proposals use react-hook-form dotted form `septicTank.tanks.0.tankCapacity` (bracket form is normalised by `normalizeFieldPath`).

When a fill targets `septicTank.tanks.<i>.<field>` and the array is shorter than `i + 1`, the apply step must grow the array with **complete empty tank objects**, not `{}` — otherwise controlled inputs receive `undefined` and React warns. Do this by exporting a factory from `src/lib/validators/inspection.ts`:

```ts
/** A blank tank matching tankInspectionSchema defaults — used when the wizard or a prefill grows septicTank.tanks */
export function createEmptyTank(): InspectionFormData["septicTank"]["tanks"][number] {
  return tankInspectionSchema.parse({});
}
```

(`tankInspectionSchema.parse({})` yields every default because every field is `.optional().default(...)`.) Use it in:
- Phase 1 Task 13 (`usePrefill` apply) and Task 15 (`use-form-scan.ts` `applyFields`) wherever the tanks array is grown (replace the existing `currentTanks.push({} as …)` in `use-form-scan.ts` with `createEmptyTank()`), and
- `src/components/inspection/step-septic-tank.tsx`'s inline `emptyTank` literal (replace the literal with `createEmptyTank()` — same shape, one source of truth).

After growing the array, also set `septicTank.numberOfTanks` to `String(tanks.length)` if it is empty or smaller, so the step's sync effect does not truncate the array.

## A2. `StageContext` / `StageResult` live in `src/lib/prefill/stage.ts` — affects Phases 2–4

Phase 1 Task 1 creates `src/lib/prefill/stage.ts` exporting `StageContext`, `StageResult`. Phase 2/3/4 plans that write `import type { StageContext, StageResult } from "./run-prefill"` (or `"../run-prefill"`) must import from `"@/lib/prefill/stage"` instead. No other change.

## A3. `PrefillSourcesTile` props — affects Phases 2–4 tile edits

Phase 1 Task 12 defines the tile's props; Phase 4 Task 6 assumed `{ run, isRunning, onFindRecords, onSelectCandidates }`. Implementers of later tile tasks read the actual props from `src/components/prefill/prefill-sources-tile.tsx` as delivered by Phase 1 and adapt the plan's test/props accordingly (assertions are on rendered text/links, which do not depend on prop names).

## A4. Phase 3 field paths were retargeted in the plan text (done by the controller)

All `septicTank.tankCapacity` / `capacityBasis` / `tankMaterial` / `tankDimensions` occurrences in `2026-09-11-prefill-phase3-extraction.md` now read `septicTank.tanks.0.…`. `mapPermitFacts` maps `facts.tanks[i]` → `septicTank.tanks.<i>.*` for every extracted tank and proposes `septicTank.numberOfTanks = String(facts.tanks.length)` when ≥ 1.

## A5. Review-page plan runs after Phase 1 (or with the guarded skip)

The review-page mirror plan mounts `ProvenanceProvider` + `PrefillSourcesTile` from Phase 1. If executed before Phase 1 lands on its branch, its guarded step applies (mount nothing, leave the comment `// prefill provider mounted in prefill phase 1`) and the mount is added when the branches merge.

**A2 addendum (done by the controller):** the type-only imports in the phase 2/3/4 plan text were rewritten to `from "@/lib/prefill/stage"`. Phase 1 Task 5 additionally adds `export type { StageContext, StageResult } from "./stage";` to `src/lib/prefill/run-prefill.ts` so either import path works.

## A6. Phase 2 Task 11 must keep the `isSafeSourceUrl` link filter in the tile

The replacement `<li>` block in Phase 2 Task 11 ("Mount the list in the tile") maps over `stage.links` directly. Phase 1's delivered `prefill-sources-tile.tsx` filters stage links through `isSafeSourceUrl` (from `@/lib/prefill/provenance-schema`) before rendering, and `prefill-sources-tile.test.tsx` ("never renders an unsafe stage link …") asserts it. Implementers keep `const safeLinks = stage.links.filter(isSafeSourceUrl)` and map over `safeLinks`; the plan's block is otherwise unchanged.

## A7. `runPermitsSelection` argument order is `(input, ctx, candidateKeys)` (Phase 2 wins)

Phase 3's plan text mentions `(input, candidateKeys, ctx)`; the delivered Phase 2 signature is `(input, ctx, candidateKeys)`. Phase 3 implementers read the real signature from `src/lib/prefill/permits/index.ts`.

## A8. `searchPermits` reports partial archive failure (Phase 2 Task 5/8)

Every non-`error` outcome (`found`, `ambiguous`, `not_found`) carries `failedArchives: PermitArchive[]` — the union of archives whose query threw in **any round that ran** (empty when all succeeded). `error` is returned only when every query in the round failed (unchanged). Task 8 must render a non-empty `failedArchives` in `stages.permits.summary` — phrased as a failed query, not an outage, since a `found via street` can list `edms_env` while still showing env rows (e.g. `A query to the legacy archive (env) failed — results may be incomplete`) — so a `not_found` after an outage never reads as a confident negative. Task 5's `not_found` summary terms stay as they are.

## A9. Property grouping is house number + street; other attributes split only on contradiction (Phase 2 Task 5)

`propertyGroupKey` as a pure key over dir/city/zip5/APN splits one property whose older rows have blank fields, and always separates `edms_env` rows from `edms_eplpav` rows (eplpav has no street direction), so the eplpav FINAL DA is dropped on auto-select. Replace it with `groupByProperty(candidates)`: identity = house number + `normalizeStreetName(street)`; a candidate joins an existing group unless a populated attribute on both sides contradicts (dir, city, zip5, formatted APN — blank/undefined is compatible). Keep the −∞ APN-mismatch score. The brief's "two properties tie" test (three PRINCESS rows) becomes `found` with 3 hits; add a both-archives street-fallback test proving env + eplpav rows of one house land in one group.
## A10. Listing provider actor is `api-ninja/zillow-property-details-scraper` (Phase 4 Tasks 1, 2, 7)

Live verification 2026-09-11/12: `sian.agency/zillow-property-detail-scraper` never returns water/sewer/utilities in any lookup mode (README + live run). Zillow's MLS-sourced `resoFacts` block is served for **active/recent listings only** (an off-market parcel returns `resoFacts.waterSource: null`). On two active Carefree/Cave Creek listings, `api-ninja/zillow-property-details-scraper` returned `resoFacts.waterSource: ["City Water"]` and `resoFacts.sewer: ["Septic Tank"]` / `["None"]`, accepts a plain address, ~2 s, ~$0.015 per lookup.

- Endpoint: `POST https://api.apify.com/v2/acts/api-ninja~zillow-property-details-scraper/run-sync-get-dataset-items?token=$APIFY_TOKEN&timeout=60&memory=1024`, body `{ "property": ["<full address>"] }`. **Do not send `maxTotalChargeUsd` below 0.10** — Apify rejects it for pay-per-event actors (omit it).
- Fields: `resoFacts.waterSource` and `resoFacts.sewer` are **arrays of ARMLS strings** (take `[0]`); `bedrooms`, `bathrooms`, `yearBuilt`, `lotSize` (sqft), `lotAreaValue`/`lotAreaUnits`, `homeStatus`, `zpid`, `hdpUrl` (path — prefix `https://www.zillow.com`). The normaliser's key search must descend into `resoFacts` and unwrap single-element arrays.
- ARMLS vocabulary the water-source table must map (case-insensitive): `City Water` → `municipal`; `Pvt Water Company` / `Private Water Company` / `Water Co` → `private_company`; `Well - Shared` / `Shared Well` → `shared_well`; `Well - Pvtly Owned` / `Private Well` / bare `Well` → `private_well`; `Hauled` → `hauled_water`. Sewer: `Septic Tank` / `Septic in & Cnctd` / any `septic` → `septic`; `Sewer - Public` / `Sewer - Private` / `Public Sewer` / any `sewer` → `sewer`; `None` / empty / unknown → `unknown` (a listing that says `None` is not evidence either way — no warning).
- `.env.example` and the shape-check script name the new actor; the script's default address is an active listing pattern and prints a clear note when `homeStatus` is not `FOR_SALE`/`PENDING` (utilities will be null off-market).
