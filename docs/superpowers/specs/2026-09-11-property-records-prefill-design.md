# Property Records Prefill — Design

**Date:** 2026-09-11
**Status:** Approved (design), pending implementation plan
**Branch:** `feature/property-records-prefill`

## 1. Goal

When an inspection has a parcel (APN) or address, automatically pull everything the county and the market already know about the septic system and prefill the GWS-432 wizard with it — clearly marked as prefilled, with a confidence level, a colour per source, a tap-to-open explanation, and links back to every source document so the inspector can verify in one click.

Three sources, one flow:

| Source | What it gives us | Exists today? |
|---|---|---|
| **Assessor** (Maricopa Assessor ArcGIS) | owner, address, year built, subdivision/lot | Yes — `/api/apn-lookup` fills `facilityInfo.*` |
| **Permit records** (Maricopa ESD EDMS, two archives) | permit #s, dates, tank gallons/material, disposal type/dims, design flow, bedrooms, water source, cesspool, abandonment | New |
| **Listing** (Zillow via Apify) | water source (city / private co. / shared well / private well), sewer vs septic, beds/baths, year built, listing URL | New |

### Non-goals

- No permit PDFs in the customer report (app-only, for verification). A report appendix can be added later as a per-document toggle on the review page.
- No Realtor.com provider in v1 (the provider interface allows adding it).
- No server-side writes to `form_data` — the client is the single writer.
- Jobs module untouched.

## 2. User-facing behaviour

1. **Trigger.** A prefill run starts automatically when an APN lookup succeeds, automatically in the background when the Workiz webhook creates a draft that carries an APN, and manually via a **Find records** button in the sources tile (re-run, or run against a corrected address).
2. **Progress.** A **Prefill sources** tile at the top of the wizard shows one row per source — `Assessor ✓ · Listing ✓ · Permits: reading OW-17-00474…` — and fields light up as each stage finishes. The form is never blocked.
3. **Marking.** Every prefilled field gets a small coloured badge next to its label: **blue = Assessor, amber = Permit, violet = Listing, green = Scanned form** (the existing scan flow joins the same system). The badge shows the confidence (`92%`). Tapping it opens a popover (works on phones — no hover required) with: the explanation, the quoted evidence, an **Open source (p. 3)** link, and **Verify** / **Clear** buttons.
4. **Confidence gate.** Values at or above `0.75` confidence fill the field directly (badge state `prefilled`). Values below the gate — or for a field that already has a value — are **not** written; they appear as a **suggestion chip** under the field: `Suggested: 1,250 gal · 61% · permit OW-17-00474` → tap to accept. User input is never overwritten.
5. **State transitions.** Editing a prefilled field flips the badge to grey `edited`. **Verify** turns it into a neutral checkmark `verified`. **Clear** removes the badge (value stays).
6. **Links.** The tile links to the Assessor parcel page, the Zillow property URL, and each permit document (our stored copy, via a signed URL) plus **Open on Maricopa EDMS** (the EDMS search page; a copy-APN button sits beside it because EDMS has no deep links).
7. **Ambiguity.** When the APN finds nothing and the street-number fallback yields several plausible permits, the tile shows **"3 possible permits — pick the right one"** with permit #, type, date, address, subdivision/lot; extraction continues on the chosen documents.
8. **Not found / unpermitted.** The tile says exactly what was searched: `No permit records found (searched APN 219-11-121 and 8911 CAVE CREEK — 0 matches)` and offers a suggestion chip for `recordsAvailable = No`.
9. **Abandonment.** An `ABANDONMENT` document produces a red banner on the tile.
10. **Review page.** The tile and badges render identically on the admin review page (it will reuse the wizard components — see the separate review-page redesign spec).

## 3. Architecture

```
src/lib/prefill/
  types.ts                    ProvenanceEntry, PrefillRun, PrefillStage, ProposedField, Candidate
  run-prefill.ts              orchestrator: runs stages in parallel, persists run + records
  merge.ts                    pure: mergeProposals(formData, provenance, proposals) → {formData, provenance}
  map-facts-to-fields.ts      pure: PermitFacts | ListingFacts | AssessorFacts → ProposedField[]
  assessor.ts                 wraps existing ArcGIS query (parcel by APN, APN by address)
  listing/
    provider.ts               ListingProvider interface + normalised ListingFacts
    zillow-apify.ts           Apify actor client
  permits/
    edms-client.ts            OnBase Public Access JSON client (env + eplpav)
    search.ts                 APN search → street fallback → candidate scoring
    fetch-document.ts         GET PDF → stream to Supabase Storage → inspection_records row
    triage.ts                 pdf-lib page splitting (first pass / second pass)
src/lib/ai/
  extract-permit-facts.ts     Sonnet 4.6 structured extraction (+ Opus 5 escalation)
  permit-extraction-schema.ts Zod schema for PermitFacts
src/app/api/inspections/[id]/
  prefill/route.ts            POST  start run
  prefill/[runId]/route.ts    GET   run status + results
  prefill/[runId]/select/route.ts   POST choose candidates
  prefill/[runId]/applied/route.ts  POST mark results applied
  records/[recordId]/route.ts GET   signed URL for a stored permit PDF
src/components/prefill/
  provenance-context.tsx      ProvenanceProvider + useProvenance(fieldPath)
  provenance-badge.tsx        dot + % + popover (Verify / Clear / Open source)
  suggestion-chip.tsx
  prefill-sources-tile.tsx    per-source rows, links, candidate picker, Find records
  use-prefill.ts              start/poll/apply hook
src/components/ui/form.tsx    FormLabel renders <ProvenanceBadge>; FormItem renders <SuggestionChip>
```

All three stages are independent; each records its own status, summary, error and links on the run. A stage failure never fails the run.

## 4. Data model (migration `0015_prefill_runs_records_provenance.sql`)

### `inspection_prefill_runs`

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| inspection_id | uuid fk → inspections (cascade) | |
| trigger | text | `apn_lookup` \| `manual` \| `webhook` |
| status | text | `queued` \| `running` \| `awaiting_selection` \| `done` \| `failed` |
| input | jsonb | `{ apn, address: {streetNumber, streetName, streetDir, city, zip}, subdivision, lot }` |
| stages | jsonb | `{ assessor: Stage, listing: Stage, permits: Stage }` — `Stage = { status, startedAt, finishedAt, summary, error, links: [{label,url}] }` |
| proposals | jsonb | `ProposedField[]` (see §7) — everything the client may apply |
| candidates | jsonb | `Candidate[]` when `awaiting_selection` |
| applied_at | timestamptz null | set by the client after applying proposals |
| created_by | uuid fk → profiles null | null for webhook runs |
| created_at / finished_at | timestamptz | |

Rate limiting is DB-backed: max 3 runs per inspection per rolling hour (count rows), so it survives cold starts unlike the existing in-memory limiters.

### `inspection_records`

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| inspection_id | uuid fk (cascade) | |
| run_id | uuid fk → inspection_prefill_runs (set null) | |
| source | text | `edms_env` \| `edms_eplpav` |
| permit_number | text | e.g. `OW-17-00474`, `000972` |
| doc_type | text | `PERMIT`, `PERMIT SUB`, `NOTICE OF TRANSFER`, `ABANDONMENT`, `PLAN REVIEW`, `SUB`, or ePLPAV permit type/subtype |
| doc_date | date null | |
| description | text null | ePLPAV description / env display name |
| page_count | int null | |
| size_bytes | int null | |
| storage_path | text | `inspection-media/records/{inspectionId}/{recordId}.pdf` (private bucket, same bucket as media) |
| selected | bool default true | false for unchosen candidates |
| extraction_status | text | `pending` \| `done` \| `skipped` \| `failed` |
| extracted | jsonb null | `PermitFacts` (§6) |
| created_at | timestamptz | |

Separate from `inspection_media` so documents can never appear in the report's photo pages.

### `inspections.field_provenance` (jsonb, default `{}`)

```ts
type ProvenanceEntry = {
  source: "assessor" | "permit" | "listing" | "scan";
  state: "prefilled" | "suggested" | "edited" | "verified";
  value: string | boolean | string[];   // the value we proposed
  confidence: number;                   // 0–1
  explanation: string;                  // "Permit OW-17-00474 · Discharge Authorization p.1"
  evidence?: string;                    // quoted text, e.g. "Septic Tank Qty 1 Capacity 1250"
  sourceUrl?: string;                   // Zillow URL, assessor page, or /api/…/records/{id}#page=3
  recordId?: string;
  page?: number;
  runId?: string;
  at: string;                           // ISO
};
type FieldProvenance = Record<string /* dotted fieldPath */, ProvenanceEntry>;
```

Stored outside `form_data`, so the inspection Zod schema, the scan flow and the PDF pipeline are unaffected. Written through a dedicated `PATCH /api/inspections/[id]/provenance` route (`{ fieldProvenance }`, whole-map replace, validated against the type above) so the existing raw-body `PATCH /api/inspections/[id]` keeps its shape. Cleared on `DELETE`; untouched by submit/finalize/return/reopen.

## 5. Sources

### 5.1 Assessor

Reuses the existing ArcGIS parcel query. Adds `findParcelByAddress(streetNumber, streetName)` (same layer, `where PHYSICAL_STREET_NUM='8911' AND PHYSICAL_STREET_NAME LIKE 'CAVE CREEK%'`) so webhook drafts without an APN — and the permit street fallback — can resolve subdivision/lot/STR. Proposals: none beyond what `/api/apn-lookup` already writes; the stage exists to record provenance (`confidence 1.0`, link `https://mcassessor.maricopa.gov/mcs/?q=<APN>` — verify URL pattern during implementation) for owner/address/year-built fields already filled by the lookup.

### 5.2 Permit records (Maricopa ESD EDMS)

Both archives are Hyland OnBase Public Access 19.12 with a public JSON API — no login, cookies, CSRF or browser needed. Verified live on 2026-09-11.

| | Legacy `env` | `eplpav` |
|---|---|---|
| Base | `https://edms.maricopa.gov/env/api` | `https://edms.maricopa.gov/eplpav/api` |
| Coverage | scans from ~1970s through OW-24 issued before 2024-06-15 | Permit Center docs closed on/after 2024-06-17 (OW-20…OW-26) |
| Query | `QueryID 229` "Septic Search" | `QueryID 476` "Permit Document" |
| APN keyword | `1264 ParcelNumber` | `4647 EPL_ParcelNumber` |
| Street keywords | `1307 EnvStreetNo`, `1308 EnvStreetDir`, `1309 EnvStreet`, `1310 EnvCity`, `1311 EnvZip`, `1312 EnvLotNumber`, `1313 EnvSubdivision`, `1305 EnvPermitNumber`, `1306 EnvSepticDocType` | `4608 AddressLine1` (house #), `4609 AddressLine2` (street, no suffix), `4607 City`, `4610 Zip`, `4644 EPL_PermitNumber`, `4651 EPL_Type`, `4652 EPL_WorkClass`, `1312`/`1313` lot/subdivision |

**Search** — `POST {base}/CustomQuery/KeywordSearch`, `Content-Type: application/json`:
```json
{"QueryID":229,"Keywords":[{"ID":1264,"Value":"219-11-121","KeywordOperator":"="}],"FromDate":null,"ToDate":null,"QueryLimit":50}
```
Response `{ Data: [{ ID, Name, DisplayColumnValues: [{Value}…] }], Truncated, DisplayColumns: [{Heading}] }`. Column order follows `DisplayColumns`; parse by heading, not index. Keywords AND together; `*` wildcard; case-insensitive. Set `QueryLimit` explicitly (server caps at 1000).

**Document** — `GET {base}/Document/{encodeURIComponent(ID)}/` returns `application/pdf` (`Content-Disposition` carries the display name). `POST` same URL with `{}` returns `{ Size, ViewerMode, IsAboveDownloadThreshold }` for size checks before download. **IDs are ephemeral tokens with non-ASCII bytes** — always search then fetch in the same run; never persist an ID.

**Parcel format** must be dashed `NNN-NN-NNN[L]`; `21911121` → 0 hits. Use the existing APN formatter.

**Search algorithm (`permits/search.ts`)**
1. Search `env` and `eplpav` by APN in parallel. Merge, dedupe by normalised permit # (`OW-17-00474` ≡ `OW1700474`).
2. If zero rows: street fallback on both archives — `EnvStreetNo = <number>` + `EnvStreet LIKE '<streetName>*'` (street name normalised: uppercase, suffix stripped: RD/ROAD, DR/DRIVE, ST/STREET, AVE/AVENUE, LN/LANE, BLVD, WAY, CT, PL, CIR, TRL). Score each row: +3 street direction match, +2 city match, +2 ZIP match, +3 subdivision match, +2 lot match, −∞ APN present and ≠ ours, +0 APN blank. Top score ≥ 5 with a gap ≥ 3 to the next → auto-select; otherwise up to 8 candidates → `awaiting_selection`. If zero rows → `not_found` with the searched terms in `stages.permits.summary`.
3. Rank selected documents for extraction: `PERMIT` / `FINAL DA` / Discharge Authorization (newest first) → `PERMIT SUB` → `NOTICE OF TRANSFER` → `ABANDONMENT` (flag; extract dates only) → `PLAN REVIEW` / `SUB` (skipped). Extract at most **3** documents per run; the rest are stored and listed with `extraction_status = skipped`.
4. Download every selected document up to 25 MB (larger documents are listed in the tile but skipped with a note — the Claude request cap is 32 MB and pdf-lib page splitting needs the whole file in memory). Stream the response body to Supabase Storage; record `page_count` via pdf-lib after upload.

### 5.3 Listing (Zillow via Apify)

`ListingProvider` interface: `lookup({ streetAddress, city, state, zip }) → ListingFacts | null` where

```ts
type ListingFacts = {
  provider: "zillow"; url: string;
  waterSource?: "municipal" | "private_company" | "shared_well" | "private_well" | "hauled_water";
  sewer?: "septic" | "sewer" | "unknown";
  bedrooms?: number; bathrooms?: number; yearBuilt?: number; lotSqft?: number;
  raw: Record<string, unknown>;                // kept on the run for debugging
};
```

Provider v1: Apify actor `sian.agency/zillow-property-detail-scraper` (address input; ~$0.017/lookup; not charged when not found) called with `POST https://api.apify.com/v2/acts/sian.agency~zillow-property-detail-scraper/run-sync-get-dataset-items?token=$APIFY_TOKEN&timeout=60&memory=1024` and body `{ "addresses": ["8911 E Cave Creek Rd, Carefree, AZ 85377"] }`. The exact output field names are confirmed with one real run during implementation; the mapper is defensive (looks for `waterSource` / `water` / `utilities.water`, `sewer`, `bedrooms`, `yearBuilt` case-insensitively) and any unmapped shape yields `null` facts, never an error. Alternative actors if this one degrades: `api-ninja/zillow-property-details-scraper`, `axesso_data/zillow-property-details-scraper-v2` (URL/ZPID input).

Water-source normalisation: `city|municipal|public` → `municipal`; `private (water )?company|water co` → `private_company`; `shared well` → `shared_well`; `well|private well` → `private_well`; `hauled` → `hauled_water`. Listing proposals carry `confidence 0.8` (`waterSource`) / `0.85` (`bedrooms`) — listing data can be stale, but above the fill gate. A listing that says `sewer` proposes nothing but adds a **warning** proposal on `facilityInfo.wastewaterSource` rendered as an amber chip: `Listing says "Sewer" — confirm this property is on septic`.

## 6. Extraction (`src/lib/ai/extract-permit-facts.ts`)

Model: `claude-sonnet-4-6` (per app convention, undated alias), structured output via `client.messages.parse()` with the Zod schema below; PDF sent as a base64 `document` block; `max_tokens 4096`; system prompt cached (`cache_control` on the system block).

```ts
const fact = <T>(v: z.ZodType<T>) => z.object({
  value: v, confidence: z.number().min(0).max(1), page: z.number().int().positive(),
  evidence: z.string().max(300), handwritten: z.boolean(),
});
export const PermitFactsSchema = z.object({
  permitNumber: fact(z.string()).nullable(),
  documentKind: z.enum(["approval_to_construct","discharge_authorization","final_da","notice_of_transfer","abandonment","other"]),
  issueDate: fact(z.string()).nullable(),         // ISO date
  finalDate: fact(z.string()).nullable(),
  contractor: fact(z.string()).nullable(),
  designFlowGpd: fact(z.number()).nullable(),
  bedrooms: fact(z.number().int()).nullable(),
  tanks: z.array(z.object({
    capacityGal: fact(z.number()).nullable(),
    material: fact(z.enum(["precast_concrete","fiberglass","plastic","steel","cast_in_place","other"])).nullable(),
    model: fact(z.string()).nullable(),
    dimensions: fact(z.string()).nullable(),
  })),
  disposal: z.object({
    type: fact(z.enum(["trench","bed","chamber","seepage_pit","other"])).nullable(),
    count: fact(z.number().int()).nullable(),
    dimensions: fact(z.string()).nullable(),
    absorptionAreaSqft: fact(z.number()).nullable(),
  }),
  waterSource: fact(z.enum(["municipal","private_company","shared_well","private_well","hauled_water"])).nullable(),
  isCesspool: fact(z.boolean()).nullable(),
  isAbandonment: z.boolean(),
  systemType: fact(z.enum(["conventional","alternative"])).nullable(),
  notes: z.string().max(500),
});
```

**Page triage (`permits/triage.ts`)** — pdf-lib copies page ranges into a small sub-PDF:
- Pass 1: pages 1–4 (the typed Approval-to-Construct / Discharge Authorization page plus checklist). Pass 2 (remaining pages, ≤ 20 more) only if pass 1 returned no `tanks[0].capacityGal` and no `disposal.type`. Two passes are merged field-by-field, higher confidence wins.
- Native-text ePLPAV PDFs (FINAL DA, 17 MB / 54 pp seen in research): pass 1 = pages 1–6, which contain the DA and "Inspection Measurements" as-built table. No text-layer extraction dependency is added; the sub-PDF keeps token cost bounded.
- **Escalation**: any field with `handwritten: true` and `confidence < 0.6` after both passes is re-asked on `claude-opus-5` with only the page it came from and the single question; the Opus answer replaces it if its confidence is higher. Cap 3 escalations per document.

Cost at Sonnet rates: ~$0.02–0.06 per document typical, ~$0.15 worst case; whole run typically < $0.10.

**Prompt contract:** the system prompt describes Maricopa ESD document layouts (Approval to Construct Individual Sewage Disposal System; Discharge Authorization "General Permits Authorized" table — `4.02 A314 Septic Tank Qty 1 Capacity 1250`, `Seepage Pit Qty 2 Overall 28'0" Effective 24'0"`; FINAL DA "Inspection Measurements"; Notice of Transfer CivicPlus email form), instructs confidence calibration (typed = 0.9+, clear handwriting 0.7–0.85, ambiguous digits ≤ 0.6), forbids inventing values, requires page and verbatim evidence for every fact, and flags cesspool/abandonment. Rate limit: shares the run's 3/hour/inspection limit. Failures (`APIError`, schema mismatch) mark the record `extraction_status = failed` with a message; the run continues.

## 7. Mapping & merge

`map-facts-to-fields.ts` turns facts into `ProposedField[]`:

```ts
type ProposedField = { fieldPath: string; value: string | boolean | string[]; provenance: Omit<ProvenanceEntry,"state"|"value"|"at">; kind: "fill" | "warning" };
```

| Fact | fieldPath(s) | Value / note |
|---|---|---|
| any selected permit found | `facilityInfo.recordsAvailable` | `"yes"` (conf 1.0) |
| `approval_to_construct` permit # | `facilityInfo.hasApprovalOfConstruction` = true, `facilityInfo.approvalPermitNo` | permit # |
| `discharge_authorization` / `final_da` permit # | `facilityInfo.hasDischargeAuth` = true, `facilityInfo.dischargeAuthPermitNo` | permit # |
| site plan page detected (`notes` mentions site plan or doc has an engineer's plan page) | `facilityInfo.hasSitePlan` | true, conf from model |
| `issueDate` | `facilityInfo.facilityAge`, `facilityInfo.facilityAgeEstimateExplanation` | years since issue as a string (`"26"`); explanation `"Approval to construct issued 03/2000 (permit 000972)"` |
| `tanks[0].capacityGal` | `septicTank.tankCapacity`, `septicTank.capacityBasis` | `"1250"`, `"permit_document"` |
| `tanks[0].material` | `septicTank.tankMaterial` | enum value |
| `tanks.length` | `septicTank.numberOfTanks` | `"1"` / `"2"` |
| `disposal.type` | `disposalWorks.disposalType` | enum value; `dimensions` go into the explanation, not a field |
| `bedrooms` (permit or listing) | `designFlow.numberOfBedrooms` | permit wins over listing when both exist |
| `designFlowGpd` | `designFlow.estimatedDesignFlow`, `designFlow.designFlowBasis` | `"900"`, `"permit_documents"` |
| `waterSource` (listing or permit) | `facilityInfo.waterSource` | permit wins over listing |
| `isCesspool` true | `facilityInfo.isCesspool` | **always a suggestion** (kind `fill`, confidence forced ≤ 0.7) — never auto-set, because it voids the report pages |
| `systemType` | `facilityInfo.facilitySystemTypes` | suggestion only |
| listing `sewer = "sewer"` | `facilityInfo.wastewaterSource` | `kind: "warning"` chip, no value |
| `isAbandonment` | — | tile banner only |

Tank-level fields for `septicTank.tanks[n].*` (multi-tank UI) are **not** proposed in v1 — the top-level tank fields cover the report; multi-tank mapping is a follow-up.

**Merge (`merge.ts`, pure, unit-tested, used by the client hook):**
- `kind: "warning"` → provenance entry with `state: "suggested"` and the message; never writes a value.
- `confidence ≥ 0.75` **and** current form value is empty / default → write value, `state: "prefilled"`.
- Otherwise → `state: "suggested"` (chip). If an entry for the field already exists in state `verified` or `edited`, the new proposal becomes a suggestion, never a fill.
- Higher confidence replaces an existing `prefilled` entry for the same field only if the current form value still equals the earlier proposed value.
- Existing scan flow: `use-form-scan.applyFields` also writes `state: "prefilled"` entries with `source: "scan"` using the scan's own confidence and `source` description as the explanation.

## 8. API

All routes use the existing JWT-role checks; a user may run prefill on an inspection they may PATCH (owner of a draft, or admin/office_staff).

| Route | Method | Body / response |
|---|---|---|
| `/api/inspections/[id]/prefill` | POST | `{ apn?, address? }` (defaults from the inspection's `facilityInfo`) → `201 { runId }`. Validates APN format; 429 when > 3 runs/hour for the inspection; 409 if a run is already `running`. Creates the row, then `after(() => runPrefill(runId))`. `export const maxDuration = 300`. |
| `/api/inspections/[id]/prefill/[runId]` | GET | run row (status, stages, proposals, candidates, records list with links). Client polls every 2 s while `queued|running`, stops on `done|failed|awaiting_selection`. |
| `/api/inspections/[id]/prefill/[runId]/select` | POST | `{ recordIds: string[] }` → marks records selected, continues extraction via `after()`, run → `running`. |
| `/api/inspections/[id]/prefill/[runId]/applied` | POST | sets `applied_at`. |
| `/api/inspections/[id]/records/[recordId]` | GET | `302` to a 10-minute signed URL. Linked with plain `<a target="_blank" rel="noopener">` (never `next/link`, whose prefetch would fire the GET). |
| `/api/inspections/[id]/provenance` | PATCH | `{ fieldProvenance }` — whole-map replace, same access rule as the inspection PATCH. |
| `/api/inspections/[id]/prefill/latest` | GET | most recent run for the inspection (or `null`) — used on wizard mount. |
| `/api/webhooks/workiz` | POST | after creating the draft, if an APN is present: insert a `webhook` run and `after(() => runPrefill(runId))`. |

The **client hook** (`use-prefill.ts`) starts runs, polls, and when a run is `done` with `applied_at = null` runs `mergeProposals` against the live react-hook-form values, `setValue`s the fills, updates the provenance context, lets autosave PATCH `formData` and the provenance provider PATCH `fieldProvenance`, then POSTs `/applied`. On wizard mount it fetches the latest run and applies it if unapplied (this is how webhook-triggered runs reach the form).

Background execution uses `after()` from `next/server` — never a floating promise (Vercel freezes the function once the response is sent).

## 9. Provenance UI

- `ProvenanceProvider` wraps the wizard (and the review page) with the map plus `verify(fieldPath)`, `clear(fieldPath)`, `acceptSuggestion(fieldPath)`, `dismissSuggestion(fieldPath)`. It subscribes to `form.watch` and flips `prefilled → edited` when a field's value diverges from `entry.value`.
- `FormLabel` (`ui/form.tsx`) reads `useProvenance(name)` from the `FormField` context and appends `<ProvenanceBadge>` when an entry exists; `FormItem` appends `<SuggestionChip>` for `state: "suggested"`. No per-field changes across the six step components.
- Badge: 8 px dot in the source colour + `92%` text; grey for `edited`, checkmark for `verified`. Colours are tokens in `src/lib/prefill/sources.ts` (`assessor: blue-500`, `permit: amber-500`, `listing: violet-500`, `scan: green-600`). Popover uses radix `Popover` (from the installed `radix-ui` package; shadcn `popover.tsx` generated into `ui/`), opens on tap and hover.
- Tile (`prefill-sources-tile.tsx`): collapsible card above step 1; rows for Assessor / Listing / Permits with status icon, one-line summary, links; candidate picker (radio list + "Use selected"); red abandonment banner; **Find records** button (disabled while running; shows remaining runs when rate-limited); last-run timestamp.
- Accessibility: badge is a `<button aria-label="Prefilled from permit records, 92% confidence">`; chips are buttons; colour is never the only signal (text always present).

## 10. Failure handling

| Failure | Behaviour |
|---|---|
| EDMS unreachable / non-200 | permits stage `error`, message `Maricopa EDMS unavailable — try Find records later`; other stages unaffected |
| EDMS returns rows but download fails | record row with `extraction_status: failed`; tile shows the row with a retry-on-rerun note |
| Apify error / timeout / not found | listing stage `error` or `summary: "No Zillow listing found for <address>"` |
| Claude error / schema mismatch | record `failed`; run still `done` |
| Run crashes (unhandled) | `status: failed`, `error` stored; 409 lock released; client shows "Prefill failed — Find records to retry" |
| Timeouts | EDMS 15 s per request, document download 60 s, Apify 60 s, Claude 90 s per call; one retry on network errors only |
| Total budget | hard stop at 240 s; whatever finished is persisted |

## 11. Security

- `APIFY_TOKEN` and `ANTHROPIC_API_KEY` are server-only; `APIFY_TOKEN` added to `.env.example`.
- Outbound calls go only to the fixed hosts `edms.maricopa.gov`, `gis.mcassessor.maricopa.gov`, `api.apify.com`, `api.anthropic.com`; document IDs are taken only from our own search responses and `encodeURIComponent`-ed; user-supplied APN/address are validated (APN regex, address length ≤ 200, printable ASCII) before being placed in query values.
- Stored PDFs live in the private bucket and are only reachable through the auth-gated signed-URL route; the download route re-checks the caller's access to the inspection.
- Prefill routes reuse the RBAC tests' patterns (unauthenticated 401, wrong-owner tech 403).
- Rate limits: 3 runs/hour/inspection (DB) and the existing per-user in-memory limiter on the AI calls.
- Extracted values are validated by the Zod schema; model output is never executed or rendered as HTML.

## 12. Testing

- **Unit:** `search.ts` scoring (auto-select, ambiguous, not found, APN-mismatch exclusion); `map-facts-to-fields` (every row of the §7 table); `merge.ts` (fill vs suggest, no-clobber, edited/verified protection, higher-confidence replacement); water-source normalisation; street-name normalisation.
- **EDMS client:** fixtures recorded from the real API during research (parcel `219-11-121` → 1 hit; `200-08-079` → `OW-17-00474` + `OWR-22-04475`; street `8911` → 8 rows) with `fetch` mocked.
- **Extraction:** schema validation against sample outputs; prompt snapshot; escalation trigger logic; mocked Anthropic client.
- **Routes:** auth matrix, rate limit, 409 lock, run lifecycle, select flow, applied flag, records download 302.
- **Components:** badge states/colours, popover actions, chip accept/dismiss, tile rows/candidate picker/not-found copy, `FormLabel` renders nothing when no entry.
- **Live integration (manual, before each phase's merge):** `scripts/prefill-smoke.ts` against parcels `219-11-121` (expect permit `000972`, 1,200 gal, disposal pit, issue 2000) and `200-08-079` (expect `OW-17-00474`, 1,250 gal, 2 seepage pits, design flow) using the real keys; prints proposals and cost from `usage`.
- Existing suites must stay green (`next build` type gate + `vitest`; ~15 known pre-existing failures are excluded from the bar).

## 13. Phasing

Each phase is a PR from `feature/property-records-prefill`; production deploys only with Daniel's explicit approval per deploy.

1. **Provenance foundation** — migration (`field_provenance`, tables), `ProvenanceProvider`, badge/chip/tile shells, `FormLabel`/`FormItem` hooks, `merge.ts`, PATCH support; wire the existing APN lookup (assessor) and scan flow to write provenance.
2. **Permit search & storage** — EDMS client, search/scoring/fallback, document download to storage, records table, run lifecycle routes, tile rows with links and the candidate picker. No AI yet.
3. **Extraction** — Sonnet structured extraction, page triage, escalation, mapping, proposals applied through the hook; smoke script.
4. **Listing** — Apify Zillow provider, water-source/bedroom proposals, sewer warning.
5. **Webhook trigger** — Workiz draft creation starts a background run; apply-on-mount.

## 14. Environment

| Var | Where | Purpose |
|---|---|---|
| `APIFY_TOKEN` | Vercel prod + local | Apify REST calls (new) |
| `ANTHROPIC_API_KEY` | existing | extraction |
| Supabase vars | existing | storage + DB |

`maxDuration = 300` requires Vercel Fluid Compute (default on current projects) — confirm in the project settings during phase 2.

## 15. Assumptions & risks

- EDMS API shapes are undocumented and could change; the client parses by column heading and every stage degrades gracefully. Fixtures make regressions obvious.
- The Zillow actor's output shape is confirmed during phase 4; the mapper tolerates unknown shapes.
- Legacy handwritten permits may extract nothing usable; that yields suggestions or nothing, never wrong fills above the gate.
- `mcassessor.maricopa.gov` parcel-page URL pattern is verified in phase 1; fallback is the ArcGIS feature's `APN_DASH` shown as text.
