# Import from Workiz — Design

**Date:** 2026-10-12
**Status:** Approved by owner 2026-10-13 (all §17 decisions resolved); review findings applied (2026-10-12); ready for an implementation plan
**Branch:** `feature/workiz-import`

## 1. Goal

On **New Inspection**, let the inspector start a draft from a finished Workiz ADEQ job instead of a blank form. One tap creates the draft with the job's service address, starts the existing property-records prefill run from that address, and opens the wizard. Everything else Workiz knows about the job (scheduled date, client name, the tech's ADEQ custom fields, an APN hint) shows up as **suggestion chips** under the matching fields: they use the existing provenance system, carry a new **Workiz** source colour, and are written only when the user taps them.

The blank-form flow is unchanged. That covers **Create New Inspection**, the APN lookup box and **Find records**.

### Non-goals

- No writes to Workiz (status, notes, custom fields, attachments). Read-only API use only.
- No re-import or refresh of a job that was already imported. One inspection per Workiz job; a second import opens the existing one.
- No change to the inbound webhook `POST /api/webhooks/workiz`. Its behaviour stays as it is. It shares no new code paths, only the `workiz_job_id` key. The import stores the **same key the webhook stores** (the job's 6-character `uuid`, see §5.1 and §8.2), so neither path can create a second inspection for a job the other already imported. The only producer of that webhook, the n8n workflow "Workiz Job Poll -> Inspection App", maps `job.jobId` from the v1 `UUID` and is **inactive** (checked 2026-10-12).
- No Workiz attachments, photos, line items, payments, or inspector assignment from the Workiz team (the team only feeds a Field Technician chip, §5.1).
- No new database column and no migration (see §6.1).

### Small changes to existing behaviour

These are the only existing behaviours the feature touches, and each is required by it:

1. `<Toaster />` (from `@/components/ui/sonner`) is mounted in `src/app/(dashboard)/layout.tsx`. Today no Toaster is mounted anywhere, so every `toast()` in the app (including the existing "Failed to create inspection" and "Auto-save failed") is invisible. The import's post-redirect notices need it (§2.3).
2. `loadLatestRunDTOForDraft` (the edit page's run loader) calls `failStaleRuns(inspectionId)` first, best-effort (an error is logged and ignored). Today stale runs are only failed inside `POST /prefill`, which the tile cannot reach while a run is queued/running (§10).
3. `findParcelByAddress` gains an opt-in `AddressHints.requireZipMatch`; `runAssessorStage` sets it from a new optional run input flag `PrefillInput.zipMustMatch`, which only the import sets (§5.4). Every existing caller keeps "ZIP picks among rows, else first row".
4. `PrefillSource` gains `"workiz"`, and `field_provenance` gains `secondary.*` keys (§6). Existing entries and keys are unaffected.

## 2. User-facing behaviour

1. **Entry point.** `/inspections/new` keeps its title, copy and **Create New Inspection** button. A second, outline button, **Import from Workiz**, sits beside it (stacked under it below `sm`).
2. **Picker.** Tapping the button expands an inline panel under the buttons. The panel calls `GET /api/workiz/jobs` only now, not on page load, so a slow or broken Workiz never delays the manual flow. The panel shows:
   - a header `ADEQ jobs awaiting reports (5)` with a **Refresh** icon button;
   - a scrollable list (`max-h-[60vh] overflow-y-auto`) with one row per job: **#4696** · `100 E Example Rd, Cave Creek` · `Oct 6, 2026` · a sub-status pill (`Job Complete - Reports Required`) · a muted line `Team: Alex, Sam` (Workiz team first names; omitted when the team is empty). A job with no scheduled date shows `Unscheduled`;
   - when the current user's first name (first token of `profiles.fullName`, case-insensitive) is not among the team first names, the row shows a muted warning "You're not on this job's Workiz team" next to **Import**. It is a warning only; importing still works (§8.3);
   - a row action: **Import**; or **Open existing** (**Report submitted** when that inspection is no longer a draft) if the job was already imported and the user can open that inspection; or a disabled **Imported by another inspector** if they cannot.
3. **Import.** **Import** turns the row into `Importing…` and disables every other action on the page, including Create New Inspection, so nothing gets created twice. On success the browser goes to `/inspections/{id}/edit`. If the address could not be parsed for the records lookup, a toast says: "Imported — the street address couldn't be read, so records lookup didn't start. Enter an APN on the next screen." If the run could not be created, the toast says "Imported — records lookup couldn't start; use Find records." These toasts are fired just before `router.push` and stay visible across the navigation because the `<Toaster />` lives in the dashboard layout, which persists (see "Small changes" item 1). An import **error** is shown inline in the row (`role="alert"`) and also as a toast; the row's **Import** button comes back.
4. **In the wizard.**
   - Street, city and ZIP are already filled. Each carries the normal provenance badge: a pink dot and `90%`; the popover and the aria-label say "Workiz". When the assessor finds the parcel, its values replace them automatically, the same as any higher-confidence prefill; county, APN and owner fill from the assessor as today. If the assessor's address differs from the Workiz one in substance (a different street, or the Workiz unit/space number the assessor drops), a pink chip offers the Workiz value back (§5.1, §6.3).
   - The prefill tile shows the run that the import started. It ends in one of three states, all existing tile behaviour:
     - `done`: the mount effect (or the poll) applies it.
     - `awaiting_selection`: the permit street search found several plausible permit groups and the run waits for the user to pick one in the tile's existing permit picker. This is common for an address-only run, because the permits stage searches by street in parallel with the assessor and has no APN to anchor it. **Until the user picks, nothing from the run is applied**: the assessor's owner, county, APN, address replacement and property-use fills wait, because `usePrefill` applies only `done` runs. The Workiz address stays, and the Workiz chips (including the seller-name chip over an empty field) show. Picking a group finishes the run and applies everything. Alternatively **Find records** (enabled, since the run is not queued/running) starts a fresh run.
     - `failed`: stage errors show as today; the Workiz address and chips stay.
   - Workiz suggestions appear as pink chips that read like the permit chips: `Suggested: Private Well · 85% · Workiz job #4696 · Water Source`. Tap to accept, × to dismiss.
   - A Workiz chip and a records chip (or a records-filled value) can sit on the same field together. Example: the assessor fills **Seller Name** with the owner of record, and a pink chip under it offers the Workiz client name. Accepting a Workiz chip counts as the user's choice: a later run never silently replaces it (§6.3).
5. **Already imported.** **Open existing** routes the way the dashboard does (`handleRowClick` in `inspections-table.tsx`): a draft goes to `/inspections/{id}/edit`; a submitted or completed one goes to `/review/{id}` for admins and `/inspections/{id}` for field techs. The import endpoint never creates a second inspection for the same job (enforced by the unique `workiz_job_id`).
6. **Failure.** If Workiz is down, rate-limited, misconfigured or rejecting the token, the panel shows a one-line error with **Retry**, plus "You can still start a blank inspection with Create New Inspection." The manual button keeps working throughout.

## 3. Architecture

```
src/lib/workiz/                       NEW — server-only (route handlers import it; no "use client" file may)
  client.ts                           `import "server-only"`; GET-only Workiz v2 HTTP client: config, headers, timeout, retry/backoff, typed errors
  schema.ts                           lenient zod schema for the job fields we read → WorkizJob type
  adeq.ts                             constants (job-type ids, status, custom-field ids) + isAdeqJob / isImportable / canImportNow / toJobSummary
  adeq-jobs.ts                        listImportableAdeqJobs(): pages GET /jobs (25 s deadline), filters, 60 s cache + 15 s refresh floor + single-flight; getCachedSummary()
  custom-fields.ts                    pure value maps: Workiz option → form enum (tables in §5.2)
  apn-hint.ts                         pure: APN custom field → else latest permit-bot note
  map-job.ts                          pure: WorkizJob → ImportPlan (formData patch, primary + secondary provenance, columns, prefill input)
  import-store.ts                     DB: findInspectionsByWorkizIds, insertImportedInspection
  route-errors.ts                     WorkizError → NextResponse (shared by both routes)
  log-db-error.ts                     PII-safe DB error logger (§12): logs only SQLSTATE, constraint name and job serial
src/lib/prefill/
  secondary.ts                        NEW — `secondary.<path>` key helpers, path-aware equality, chip visibility rule
  types.ts                            PrefillSource += "workiz"; PrefillTrigger += "workiz_import"; PrefillInput += zipMustMatch?: boolean
  sources.ts                          SOURCE_META.workiz
  provenance-schema.ts                source enum += "workiz"
  map-facts-to-fields.ts              SOURCE_RANK / FIELD_SOURCE_RANK gain workiz: -1 (type completeness; never in a run)
  assessor.ts                         AddressHints.requireZipMatch (opt-in); runAssessorStage passes input.zipMustMatch
  run-dto.ts                          loadLatestRunDTOForDraft calls failStaleRuns first (best-effort)
src/app/(dashboard)/layout.tsx        mounts <Toaster />
src/app/api/workiz/
  jobs/route.ts                       NEW — GET importable ADEQ jobs (+ already-imported annotation) (maxDuration 60)
  import/route.ts                     NEW — POST {jobId}: create draft + start prefill run (maxDuration 300)
src/components/prefill/
  provenance-context.tsx              + getSecondary / acceptSecondary / dismissSecondary
  suggestion-chip.tsx                 chip body extracted to <ChipView>; + <SecondarySuggestionChip>
  format.ts                           FIELD_VALUE_LABELS += condition / effluent / hydraulic-test labels
src/components/ui/form.tsx            FormItem + FormFieldGroup also render <SecondarySuggestionChip>
src/components/inspection/
  workiz-import-picker.tsx            NEW — button + inline panel (client)
src/app/(dashboard)/inspections/new/page.tsx   renders the picker beside the existing button
scripts/workiz-adeq-smoke.mts         NEW — live read-only smoke (`npm run smoke:workiz`)
package.json                          + dependency `server-only`; + script smoke:workiz
vitest.config.ts                      alias `server-only` → an empty module so unit tests can import client.ts
.env.example                          + WORKIZ_API_V2_TOKEN, WORKIZ_API_V2_BASE
```

Unchanged on purpose: the edit page, `InspectionWizard`, `PrefillPanel`, `usePrefill`, `mergeProposals`, `dedupeProposals`, `runPrefill`, `continuePrefillAfterSelection`, every prefill route, `POST /api/inspections`, `PATCH /api/inspections/[id]`, `PATCH /api/inspections/[id]/provenance` (its schema only gains the `workiz` source) and the inbound webhook. The only existing-behaviour changes are the four in §1 "Small changes".

## 4. Data flow

```
New Inspection page            /api/workiz/jobs        Workiz v2             DB
  [Import from Workiz] ──GET──▶ auth+role ──cache miss──▶ GET /jobs?isOpen=true… (page 1..n, 25 s deadline)
                                filter ADEQ + "done pending approval", cache 60 s
                                annotate existing (workiz_job_id IN uuids∪ids) ◀──────────── inspections
  rows ◀──────────────────────── { jobs, fetchedAt, role, currentUserFirstName }

  [Import #4696] ──POST {jobId}─▶ /api/workiz/import
                                1 auth+role, zod jobId
                                2 existing by workiz_job_id IN {jobId, cachedSummary(jobId)?.uuid}? → 200 / 409
                                3 GET /jobs/{jobId} ───────────────────▶ (fresh, authoritative)
                                4 isAdeqJob and status allowed? else 422 · existing by job.uuid? → 200 / 409
                                5 mapJobToImportPlan(job)            (pure)
                                6 INSERT inspections (formData, field_provenance, columns, workiz_job_id = job.uuid)
                                    unique violation → re-select → 200 existing / 409
                                7 address parsed? createRun(trigger "workiz_import", input {address, zipMustMatch})
                                    → after(() => runPrefill(runId))
  router.push(/inspections/{id}/edit) ◀── 201 {inspectionId, prefill}

Edit page                      loadLatestRunDTOForDraft → failStaleRuns (new, best-effort) → initialRun
  usePrefill mount effect (unchanged): adopt run → poll while queued/running → applyRun on done
    run "done"               → mergeProposals(form, provenance, run.proposals): assessor 1.0 supersedes the
                               Workiz-prefilled address 0.9; `secondary.*` keys are never touched → Workiz chips stay
    run "awaiting_selection" → nothing applied until the user picks a permit group in the tile (existing picker);
                               the run then goes running → done and is applied as above
    run "failed"             → nothing applied; Workiz address + chips stay
```

Step 7 runs in `after()`, so the run is usually still going when the edit page loads. If it already finished as `done`, the mount effect applies it immediately. This is the path `use-prefill.ts` documents for runs not started by the client.

## 5. Mapping

### 5.1 Field mapping

"Fill" means written into `form_data` at import with a **primary** provenance entry (`state: "prefilled"`). "Chip" means a **secondary** provenance entry (§6) that is never written to the form until the user accepts it. `N` is the job's `serialId`.

| Workiz source | Target | Mode | Transform | Confidence | Explanation / evidence |
|---|---|---|---|---|---|
| `clientInfo.addressDetails.address` (+ `unit`) | `facilityInfo.facilityAddress`, column `facility_address` | **Fill** (primary, prefilled) **and** the same value as a secondary chip | trim, collapse whitespace; append ` #<unit>` when `unit` is non-empty | 0.9 | `Workiz job #N · service address` |
| `addressDetails.city` | `facilityInfo.facilityCity`, column `facility_city` | **Fill** + secondary chip | trim; title-case when the value is all-lower or all-upper (`laveen` → `Laveen`) | 0.9 | same |
| `addressDetails.zipCode` | `facilityInfo.facilityZip`, column `facility_zip` | **Fill** + secondary chip | `^\d{5}(-\d{4})?$` → first 5 digits; anything else → not filled, no chip | 0.9 | same |
| `addressDetails.state` | `facilityInfo.facilityState` | form default `"AZ"`, no provenance | `Arizona` / `AZ` (any case) → `AZ`; empty → `AZ`; any other value → keep `AZ`, log `non_az_state` | — | — |
| — | `facilityInfo.facilityCounty`, column `facility_county` | **not set** (left `""` / null) | the assessor stage fills `Maricopa` at 1.0 when it finds the parcel | — | see §5.4 |
| `address` + city + zip | prefill run `input.address`, `input.zipMustMatch` | run input | `parseStreetAddress(address)` + `city`/`zip`, validated with `prefillAddressSchema`, `full` via `formatFullAddress`; failure → no run (`prefill.status: "skipped"`). `zipMustMatch: true` only when a valid 5-digit ZIP was mapped (§5.4) | — | — |
| `date` (`"YYYY-MM-DD HH:MM:SS"`) | `facilityInfo.dateOfInspection` | **Chip only** | first 10 chars when they match `^\d{4}-\d{2}-\d{2}$`; `null` → no chip | 0.9 | `Workiz scheduled date (job #N)`; evidence `date: 2026-10-06 12:00:00` |
| `clientInfo.firstName` + `lastName` (else `companyName`) | `facilityInfo.sellerName` | **Chip only**; never overwrites the assessor owner | `${first} ${last}` trimmed; empty → `companyName`; both empty → no chip | 0.6 | `Workiz client (job #N)` |
| — | column `customer_name` | **not set** (null at insert) | the wizard's first autosave (about 1 s after the edit page mounts; `useAutoSave` runs without `seedFromInitial`) writes `facilityInfo.sellerName ?? null`, i.e. `""` until the owner or an accepted client name lands in Seller Name. Writing the client name at insert would be erased by that save, so it is not done | — | — |
| `clientInfo.email` | column `customer_email` | direct at insert | `z.string().email().max(254)`; invalid → null | — | send-email dialog already pre-fills from it and labels it "Pre-filled from Workiz job". The wizard PATCH never writes this column, so the value lasts |
| `team[].name` | `facilityInfo.employeeName` (Field Technician; the form says "Will be auto-filled from Workiz") | **Chip only** | trimmed non-empty names in Workiz order, de-duplicated, joined with `, `, capped at 200 chars; empty team → no chip | 0.8 | `Workiz team (job #N)` |
| `primaryPhone`, `secondaryPhone` | — | **not imported** | — | — | §5.4 |
| CF `CF-nXNayb3y6x56kpwZ` (APN), else permit-bot note | `facilityInfo.taxParcelNumber` | **Chip only**; visible only when it differs from the field (so: the assessor found a different APN, or none) | `formatApn`; invalid → no chip | 0.7 (CF) · 0.6 / 0.5 / 0.4 (note says high / medium / low or unstated) | `Workiz APN field (job #N)` or `Workiz note — permit bot, confidence high (job #N)`; evidence `APN 123-45-678` only |
| CF `CF-ypkPZr3dojlD9KnE` Water Source | `facilityInfo.waterSource` | Chip | table 5.2.1 | 0.85 | `Workiz job #N · Water Source`; evidence `Water Source: "Private Well"` |
| CF `CF-mw5dG83Z9joVbYXE` Tank Size | `septicTank.tanks.0.tankCapacity` | Chip | table 5.2.2 | 0.85 | `Workiz job #N · Tank Size` |
| CF `CF-eWzopvxv6xPQglna` Has Effluent Filter | `septicTank.tanks.0.effluentFilterPresent` | Chip | table 5.2.3 | 0.85 | `Workiz job #N · Has Effluent Filter` |
| CF `CF-JBDeg6xJWMlYV85W` Flow Test Completed | `disposalWorks.hydraulicLoadTestPerformed` | Chip | table 5.2.4 | 0.85 | `Workiz job #N · Flow Test Completed` |
| CF `CF-p2ErD5xbe36Jl1XO` Tank Recommendation | `facilityInfo.septicTankCondition` | Chip | table 5.2.5 | 0.85 | `Workiz job #N · Tank Recommendation` |
| CF `CF-y5W6qQMr9x1Rvld9` Drainfield Recommendation | `facilityInfo.disposalWorksCondition` | Chip | table 5.2.5 | 0.85 | `Workiz job #N · Drainfield Recommendation` |
| CF `CF-2AblKqxDG3YeDga1` "List all notable concerns…" | `septicTank.septicTankComments` | Chip; accept **appends** when the field already has text (§6.3) | whitespace trimmed, internal newlines kept, capped at 4,000 chars; skipped (`empty`) when empty or when it matches `^(none|n/?a|no concerns?)\.?$`i | 0.8 | `Workiz job #N · Notable Concerns` |
| CF `CF-wlovONMYrjKBp4GE` "Flow Test Description…" | `disposalWorks.disposalWorksComments` | Chip; accept **appends** when the field already has text (§6.3) | whitespace trimmed, internal newlines kept, capped at 4,000 chars; empty → skip | 0.8 | `Workiz job #N · Flow Test Description` |
| `uuid` (6 chars, e.g. `AB12CD`) | column `workiz_job_id` | direct | — | — | uniqueness key. The n8n → webhook flow stores the v1 API's 6-character job `UUID` (`job.jobId = $json.UUID`); v2 exposes the 6-character job identifier as `uuid`, so storing it shares the key with the webhook (§8.2). Existing-job lookups also match the `JOB-…` id, so the dedupe holds even if the two ever differ. A job with an empty `uuid` is rejected with 502 `workiz_bad_response` |
| `id` (`JOB-…`) | `GET /jobs/{id}`, picker, import body | — | — | — | the v2 API addresses jobs by `id` only |
| `serialId` | explanations, picker | — | — | — | — |
| everything else (`description`, other notes, checkbox CFs, line items, payments, `latitude/longitude`) | — | ignored | — | — | — |

Custom fields are matched by **id**, never by `fieldName` (several names carry trailing spaces). Checkbox custom fields (boolean values) are ignored. A value that cannot be mapped is skipped and logged as `[workiz-import] skip job=<serialId> field=<cfId> reason=<code>`. The value itself is never logged, because free text can contain PII. Reason codes: `empty`, `ambiguous`, `unknown_option`, `out_of_range`, `invalid_apn`.

Why two comment chips: the two Workiz free-text fields are different kinds of note, so each goes to the form's matching comments field. Notable concerns describe the tank and go to the septic tank section's Comments (`septicTank.septicTankComments`). The flow test description is about the hydraulic load test on the disposal works and goes to the disposal works Comments (`disposalWorks.disposalWorksComments`). Each path has its own secondary slot, so nothing collides. These are the only free-text targets, so their accept **appends** instead of replacing (§6.3). Text over 200 characters goes to the PDF overflow page, as any long comment does today.

Why the address is both a fill and a chip: the fill gives the run its starting point and lets the inspector see where they are; the chip keeps the Workiz service address reachable after the assessor's situs address replaces it. That matters when the assessor drops the Workiz unit/space number (common in mobile-home parks) or matched a different parcel. The chip is hidden while the field equals the Workiz value under address normalisation (§6.2), so "Rd" vs "RD" never shows a chip.

### 5.2 Custom-field value maps (`custom-fields.ts`)

Matching is exact after `trim()`, internal-whitespace collapse and case-folding. The option lists come from `reference/customfields.json`; the counts come from the 2026-10-10 backup (312 ADEQ jobs). They show which variants actually occur.

**5.2.1 Water Source → `facilityInfo.waterSource`** (form enum: `hauled_water | municipal | private_company | shared_well | private_well`)

| Workiz value | Form value | Note |
|---|---|---|
| `Private Well` (27) | `private_well` | |
| `Shared Private Well` (8) | `shared_well` | |
| `Hauled Water` (11) | `hauled_water` | |
| `Municipal / Private Water Supply` (137) | **skip** (`ambiguous`) | Workiz merges two separate ADEQ boxes, Municipal System and Private Water Company. Many Valley water utilities (e.g. EPCOR, Arizona Water Co.) are private companies, so picking either box would be a guess. The DA permit and the listing still propose this field. |
| `Unknown` (48) | skip (`unknown_option`) | the form has no "unknown" |
| anything else (e.g. `Yes`, 1) / empty | skip | |

**5.2.2 Tank Size → `septicTank.tanks.0.tankCapacity`** (string gallons; form presets `1000 1250 1500 2000 2500 3000`, any other number goes into the "Other" input)

| Workiz value | Form value |
|---|---|
| `1000`, `1250`, `1500`, `2000`, `2500`, `3000` | same string |
| `< 1000` (18), `>3000` (1) | skip (`unknown_option`): a bound, not a capacity |
| free text that is an integer plus an optional `gal`/`gallon(s)` suffix, commas allowed (`1,500 Gallons` ×3, `1000 gallon`, `1,500 gallons`) | the integer as a string (`"1500"`) when 300 ≤ n ≤ 10,000 |
| an integer outside 300–10,000 (`18`) | skip (`out_of_range`) |
| anything else / empty | skip |

**5.2.3 Has Effluent Filter → `septicTank.tanks.0.effluentFilterPresent`:** `Yes` → `present`, `No` → `not_present`, anything else → skip.

**5.2.4 Flow Test Completed → `disposalWorks.hydraulicLoadTestPerformed`:** `Yes` → `yes`, `No` → `no`, anything else → skip. (Workiz's "flow test" is the ADEQ hydraulic load test.)

**5.2.5 Tank / Drainfield Recommendation → `facilityInfo.septicTankCondition` / `facilityInfo.disposalWorksCondition`** (`CONDITION_OPTIONS`)

| Workiz value | Form value |
|---|---|
| `Operational` | `operational` |
| `Operational W/Concerns` | `operational_with_concerns` |
| `Non-Operational` | `not_operational` |
| anything else / empty | skip |

`format.ts` gains labels so chips read naturally: `facilityInfo.septicTankCondition` and `facilityInfo.disposalWorksCondition` → `CONDITION_OPTIONS`; `septicTank.tanks.*.effluentFilterPresent` → Present / Not Present; `disposalWorks.hydraulicLoadTestPerformed` → Yes / No.

### 5.3 APN hint (`apn-hint.ts`)

1. The `APN` custom field (`CF-nXNayb3y6x56kpwZ`), when `formatApn(value)` is non-null. Confidence 0.7.
2. Otherwise the **newest** note (by `timestamp`) whose text starts with `Permit added` (with or without `by Grok Bot`) and contains `\bAPN[:\s]+(\d{3}-?\d{2}-?\d{3}[A-Z]?)\b`. Live notes use three shapes: `Permit added by Grok Bot. Confidence high. APN 123-45-678, …`, `Permit added. Confidence high. APN 123-45-678K, …`, and `Permit added. Confidence high … (APN 123-45-678Z, …)`. Take the first `APN` match in that note. Its `Confidence (high|medium|low)` sets the confidence: 0.6 / 0.5 / 0.4, and 0.4 when no confidence is stated. Duplicate bot notes (the same note posted three times in one sample) collapse naturally because only the newest is used.
3. Otherwise no chip.

The hint never feeds the lookup. The import's run is address-driven, as the user decided (§17 item 5, resolved). The hint stays a chip only. The run's `awaiting_selection` behaviour is therefore the same as for the existing manual address flow. If the address lookup fails or the run parks in `awaiting_selection`, accepting the APN chip puts it in **Tax Parcel Number**, and the next **Find records** then runs APN-first, which anchors the permit search on the parcel. That is existing `PrefillPanel.findRecords` behaviour.

### 5.4 Decisions this section rests on

- **County is left blank at import.** `mapParcelToAssessor` returns `"Maricopa"` only for parcels on the Maricopa layer. In the backup, about 3% of ADEQ jobs sit outside Maricopa (Black Canyon City, Apache Junction, Florence, San Tan, Maricopa city). A Maricopa default would be wrong for those, and the assessor fills it at 1.0 for the rest.
- **The import's assessor lookup requires a ZIP match.** `findParcelByAddress` searches only the Maricopa layer by house number plus street-name prefix, and today returns `rows[0]` when no row matches the ZIP. For a Florence `123 W Main St`, some Maricopa `123 W MAIN ST` would win at 1.0 and replace the real address, owner, APN and county. So the import sets `input.zipMustMatch: true` whenever Workiz gave a valid ZIP, and `runAssessorStage` passes `{ requireZipMatch: true }`: when the ZIP hint is present and no row's `PHYSICAL_ZIP` matches, the lookup returns `null` and the stage reports `not_found`, with `searched` showing `… (ZIP 85xxx)`. Out-of-county jobs and wrong-ZIP jobs then keep the Workiz address, and the user can enter an APN and use **Find records** (manual runs never set the flag). The permits stage needs no flag: its street fallback already requires a city or ZIP match before auto-selecting (`search.ts`, "Street + direction + one of city/ZIP"). `continuePrefillAfterSelection` re-runs only the permits search, so the flag has no effect there.
- **Email goes to `inspections.customer_email`.** The wizard form has no customer email field. The send-email dialog already pre-fills its recipient from this column and flags it as "Pre-filled from Workiz job" (`isFromWorkiz = !!workizJobId`), which is the chip's job for that value.
- **Phone is not imported.** No form field, report field or column takes a customer phone (`alternativeSystem.contactPhone` is the inspector's organisation contact). Adding a column only to store it is out of scope, and the phone stays in Workiz.
- **Facility name is not proposed.** On the ADEQ form it is the owner of record, which the assessor fills. When the assessor finds nothing, the inspector types it, exactly as in today's manual flow.
- **The date is used as-is.** Workiz `date` is account-local wall-clock time with no offset (live samples: 08:00, 10:00, 12:00 starts). Slicing the date part avoids any UTC shift. No conversion is needed for `America/Phoenix` (no DST).

## 6. Provenance: the one-slot conflict

### 6.1 The problem

`FieldProvenance` holds **one** entry per field path. Several Workiz targets are also proposed by the run: `sellerName` (assessor, 1.0), `taxParcelNumber` (assessor, 1.0), the three address fields (assessor, 1.0), `waterSource` (permit, listing) and `septicTank.tanks.0.tankCapacity` (permit). Traced through the existing code:

- If Workiz chips were written into the primary slot at import, the first merge would destroy them. With an empty field and assessor confidence 1.0, `mergeProposals` takes the `fill()` branch and replaces the slot. The client name would disappear in exactly the case it matters.
- If Workiz were a fourth run stage, `dedupeProposals` keeps one proposal per `kind:fieldPath`, so the owner and the client name cannot both survive. A later **Find records** builds a new run without the Workiz proposals unless every run re-fetches Workiz. That contradicts "one inspection per job, no re-import" and makes every run depend on Workiz being up.
- An `alt` property riding on the primary entry, like `warning` does, would have to be carried through every replacement branch of `mergeProposals` (`suggest`, `fill`, the edited→`prior` branch, the warning-only branch). It would also be lost by `dismissSuggestion`/`clear`, which delete the entry. That is the most delicate code in the feature, for no gain.
- A new jsonb column would need a migration. The edit and review pages `db.select()` every inspections column, so if the schema field shipped before the migration, every inspection page would break. It would also need a second whole-map PATCH payload.

### 6.2 Chosen design: a secondary slot as a namespaced key

Workiz suggestions live in the **same** `field_provenance` map under the key `secondary.<fieldPath>`, for example `secondary.facilityInfo.sellerName`. Each value is an ordinary `ProvenanceEntry`:

```ts
{ source: "workiz", state: "suggested", kind: "fill", value, confidence, explanation, evidence?, at }
```

There is no `runId` and no `sourceUrl`: no Workiz web-URL format was verified, so no link is offered.

Why this is the smallest correct change:

- **The merge never touches them.** `mergeProposals` copies the map and writes only proposal paths, and no proposal path starts with `secondary.`. Re-running **Find records** leaves them exactly as they were, which satisfies "re-shown, not lost".
- **Persistence is free.** `ProvenanceProvider` already debounces a whole-map `PATCH /provenance`. The existing `fieldPathKeySchema` regex (`^[A-Za-z][A-Za-z0-9_.]*$`, max 120) accepts the keys. The longest, `secondary.septicTank.tanks.0.effluentFilterPresent`, is 50 chars. Fourteen keys at most (ten record-type chips, three address chips, the team chip) count against `MAX_PROVENANCE_ENTRIES` (500).
- **Nothing else sees them.** Badges, primary chips, the prefilled→edited watch (`key === changed || key.startsWith(changed + ".")`), the APN lookup and the scan flow all address real form paths, and no form root is named `secondary`. A unit test pins that.
- **No migration, no new route, no new column.** The import route writes the initial map at INSERT time.

`src/lib/prefill/secondary.ts` owns the namespace:

```ts
export const SECONDARY_PREFIX = "secondary.";
export const secondaryKey = (fieldPath: string) => `${SECONDARY_PREFIX}${normalizeFieldPath(fieldPath)}`;
export const isSecondaryKey = (key: string) => key.startsWith(SECONDARY_PREFIX);
/**
 * Path-aware equality:
 *  - taxParcelNumber: formatApn() on both sides
 *  - facilityAddress: parseStreetAddress() on both sides, then compare number + direction +
 *    normalizeStreetName(streetName) + the unit token (uppercased, "#"/UNIT/APT/STE/SPACE/LOT stripped);
 *    falls back to trimmed, case-insensitive, whitespace-collapsed text when either side does not parse
 *  - facilityZip: first 5 digits
 *  - other strings: trimmed + case-insensitive; else valuesEqual
 */
export function secondaryValuesEqual(fieldPath: string, a: unknown, b: unknown): boolean;
/** Chip visibility rule, below — pure, unit-tested */
export function isSecondaryVisible(args: {
  fieldPath: string; secondary?: ProvenanceEntry; primary?: ProvenanceEntry; currentValue: unknown;
}): boolean;
```

Any future code that iterates `field_provenance`, such as a "12 fields prefilled" counter, must skip `isSecondaryKey`. The helper's doc comment, a test (§13) and §16 say so.

### 6.3 Precedence and lifecycle rules

| Situation | Behaviour |
|---|---|
| **Address** (street, city, ZIP) | Workiz is a primary **fill** at import (`prefilled`, 0.9) **and** a secondary chip with the same value. The run's assessor proposal (1.0) takes the existing `existing.state === "prefilled"`, value unchanged, higher-confidence branch and replaces the primary. If the user edited the address first, the assessor value becomes the usual chip. No merge change is needed. The secondary stays hidden while the field equals it under `secondaryValuesEqual` (so a case/suffix-only difference shows nothing) and appears when the assessor's value differs in substance: a dropped unit, a different street, city or ZIP. |
| **Every other Workiz value** | Secondary chip only, never auto-filled, whatever its confidence. |
| Chip **visible** when | the secondary exists **and** the field's current value ≠ its value (`secondaryValuesEqual`) **and** the primary entry is not `verified` **and** the primary is not itself a visible `suggested` chip with an equal value (no duplicate chips) **and**, for the two comments paths (`septicTank.septicTankComments`, `disposalWorks.disposalWorksComments`) only, the field does not already contain the Workiz text (trimmed substring check). Works the same in read-only mode, with buttons disabled like the existing chip. |
| **Accept** (`acceptSecondary`) | `ensureTankArrayCapacity(form, [path])`; new value = the secondary value, except for the two comments paths (`septicTank.septicTankComments`, `disposalWorks.disposalWorksComments`) when the field is non-empty: `current.trimEnd() + "\n\n" + workiz` (never replaces typed or AI-written findings). `form.setValue(path, newValue, { shouldDirty, shouldValidate })`. Primary := `{ ...secondary, value: newValue, state: "edited", at: now }` (source stays `workiz`), carrying over any `warning` from the old primary and dropping its `prior`. `edited` is deliberate: it is the user's choice, so `mergeProposals`' edited branch keeps it on every later run and shows a differing records value as an ordinary chip (with `prior` = the Workiz entry, so dismissing that chip restores the Workiz value). Writing `prefilled` instead would let the import's own run (still running while the inspector taps chips on the Facility step) silently overwrite the accepted client name with the owner at 1.0 (`merge.ts` prefilled + unchanged + higher-confidence → `fill()`). The badge then reads `edited`, and its popover still says Workiz. The secondary key is **kept** and stays hidden while the field equals it. |
| **Dismiss** (`dismissSecondary`) | deletes the secondary key, permanently for this inspection. |
| **Later Find records** | the primary slot follows the existing rules. An accepted Workiz value is `edited`, so a records value never replaces it; if the records value differs it appears as a normal records chip under the field. An un-accepted Workiz chip is untouched by the merge and stays visible while it differs from whatever the run fills. |
| **Verify** the field | the Workiz chip hides, as the merge drops proposals for verified fields. **Clear** on the badge removes the verified entry, and the chip can show again. |
| `sellerName` before the run is applied | the field is empty (also for as long as the run waits in `awaiting_selection`), so the chip is visible. If accepted, the field keeps the client name when the run later applies, and the owner of record shows as a records chip. If not accepted, the owner fills the field and the client-name chip stays under it. |
| APN chip | hidden when it equals the field's APN (dashes and case normalised); shown when the assessor found a different APN or none. Hence "only if it differs". While the run waits in `awaiting_selection` the assessor's APN is not applied yet, so the chip shows even if the assessor will agree; it hides once the run applies. |
| Team chip on `employeeName` | the field defaults to the importer's name (`getDefaultFormValues`); the chip shows when the Workiz team differs and replaces the field on accept (it is a short field, not free text). |

### 6.4 Code changes for the secondary slot

- `ProvenanceContextValue` gains `getSecondary(path)`, `acceptSecondary(path)` and `dismissSecondary(path)`, plus no-op versions in `NOOP_PROVENANCE`. All three go through the existing `update()`, so they mark the map dirty and persist through the same debounced PATCH. `acceptSecondary` follows the Accept row of §6.3 (primary written as `edited`; append rule for the comments path).
- `suggestion-chip.tsx`: the body of the current chip moves into a presentational `<ChipView entry fieldPath onAccept onDismiss readOnly />`. `<SuggestionChip>` keeps its behaviour and tests. The new `<SecondarySuggestionChip fieldPath>` watches the field value (`useWatch`), applies `isSecondaryVisible`, and renders `ChipView` with `SOURCE_META.workiz` styling.
- `form.tsx`: `FormItem` (outside groups) and `FormFieldGroup` render `<SecondarySuggestionChip fieldPath={name} />` after the existing chip whenever `getSecondary(name)` exists, **independently** of the primary entry's state. Today `FormItem` renders a chip only for `suggested` or `warning` primaries; the secondary chip must also render when the primary is absent, `prefilled` or `edited`. The component returns `null` when the chip is not visible.
- `types.ts`: `PrefillSource = "assessor" | "permit" | "listing" | "scan" | "workiz"`. `provenance-schema.ts` adds `"workiz"` to the source enum.
- `sources.ts`: `workiz: { label: "Workiz", dotClass: "bg-pink-500", accentClass: "border-pink-300 text-pink-900 bg-pink-50" }`. Pink is distinct from blue, amber, violet and green, and is not the destructive red. Colour is never the only signal: the badge's visible text is the confidence (or `edited`/`verified`), and its aria-label and popover name "Workiz"; the chip's visible text includes "Workiz job #N". The badge component is not changed.
- `map-facts-to-fields.ts`: `SOURCE_RANK.workiz = -1` and `workiz: -1` in each `FIELD_SOURCE_RANK` row. These are needed only because the records are `Record<PrefillSource, number>`; Workiz never enters `dedupeProposals`.

## 7. Workiz API client

### 7.1 Facts (verified live, read-only, 2026-10-12)

- Base `https://api.workiz.com/crm/api/v2` (override: `WORKIZ_API_V2_BASE`), header `Authorization: Bearer <WORKIZ_API_V2_TOKEN>`.
- **User-Agent:** Cloudflare returned **403 HTML** for `Python-urllib/3.12` and **200** for Node's default fetch UA and for `SewerTime-InspectionFormFiller/1.0`. The client always sends `User-Agent: SewerTime-InspectionFormFiller/1.0` and `Accept: application/json`, so a runtime UA change cannot break it.
- `GET /jobs?isOpen=true&pageSize=300&page=1&dateProperty=date&dateOperator=next&date=2020-01-01&field=created&order=ASC`. Pages are **1-based**. `field=created&order=ASC` keeps page boundaries stable. The response is `{ pageSize, page, totalResults, hasMore, data }`. Live: 353 open jobs over 2 pages, about 5.2 s and about 1.5 MB in total. `isOpen=true` **includes** `done pending approval` (64 such jobs, 5 of them ADEQ). Some open jobs have `date: null`.
- `GET /jobs/{id}` (`JOB-…`) returns the same job shape. The API has no server-side status or job-type filter, so filtering happens in our code.
- 429 appears after about 6–7 rapid pages (see the shared analytics client), with a JSON body `{statusCode:429}`. No `Retry-After` header was observed, so the client honours it only if present.

### 7.2 `client.ts`

```ts
export class WorkizError extends Error { code: WorkizErrorCode; status?: number }
type WorkizErrorCode = "not_configured" | "auth_failed" | "not_found" | "rate_limited" | "unavailable" | "bad_response";

export function getWorkizConfig(): { token: string; base: string } | null;   // null → not_configured
export async function workizGet<T>(path: string, query: Record<string, string>, opts?: { signal?: AbortSignal }): Promise<T>;
```

- The file starts with `import "server-only"`, so a client bundle that reaches it, even transitively, fails the build.
- `getWorkizConfig()` `trim()`s `WORKIZ_API_V2_TOKEN` (a trailing newline from a pasted env value otherwise causes bearer 401s) and returns `null` when it is empty after trimming. `WORKIZ_API_V2_BASE` is trimmed, a trailing `/` is removed, and a value that does not start with `https://` makes the config `null` (logged once as `[workiz] WORKIZ_API_V2_BASE rejected: not https`), so an override can never send the bearer token in cleartext.
- **GET only.** No other method is exported, and a unit test asserts `fetch` was only ever called with `GET`. The token's actual scope is unknown and may allow writes.
- Per-request timeout 15 s, using `AbortController` combined with the caller's signal.
- Error mapping:
  - 401 → `auth_failed`.
  - 403 with a JSON body → `auth_failed`; 403 non-JSON (Cloudflare) → `unavailable`.
  - 404 → `not_found`.
  - 429 → retry; after the retries, `rate_limited`.
  - 5xx, network error, timeout, or a non-JSON 200 → retry once, then `unavailable`.
  - JSON that fails the zod schema → `bad_response`.
- Retries: 429 waits `min(Retry-After, 5) s` when present, else 1 s, then 2 s (2 retries). 5xx, network and timeout errors get 1 retry after 1 s. The total added wait is capped at 6 s, so an interactive request never hangs.
- Logging: `[workiz] GET /jobs page=2 → 429 (retry 1)`, i.e. path template, status and attempt only. Never the token, query values, or response body.
- `encodeURIComponent` on the path id. The base comes from the environment only (no SSRF surface).

### 7.3 `schema.ts` (lenient, at the boundary)

zod `workizJobSchema` with `.passthrough()`. It covers only the fields we read, all optional or nullable with safe defaults: `id`, `uuid`, `serialId`, `status`, `subStatus {id,name} | null`, `jobType {id,name}`, `date`, `customFields[{id, fieldName, value: string | boolean | null}]`, `notes[{note, timestamp}]`, `team[{id, name}]`, `clientInfo {firstName, lastName, companyName, email, addressDetails {address, unit, city, state, zipCode}}`. A list page whose `data` is not an array → `bad_response`. A single job that fails the schema is dropped from the list and logged by serial only. On import, it gives 502 `bad_response`.

### 7.4 `adeq.ts` and `adeq-jobs.ts`

```ts
export const WORKIZ_STATUS_DONE_PENDING_APPROVAL = "done pending approval";      // exact, lowercase, top-level status
export const ADEQ_JOB_TYPE_IDS = new Set(["JT-a5DbVzyREDgGvdWK" /* "ADEQ Septic Inspection " */, "JT-ly4RYx5nKd2z30dw" /* "ADEQ Inspection - Online Booking" */]);
export const isAdeqJob = (j: WorkizJob) => ADEQ_JOB_TYPE_IDS.has(j.jobType?.id ?? "") || (j.jobType?.name ?? "").trim().startsWith("ADEQ");
export const isImportable = (j: WorkizJob) => isAdeqJob(j) && j.status === WORKIZ_STATUS_DONE_PENDING_APPROVAL;   // the picker's filter
/** Import-time re-check: also allows "Done", because a job can move on between listing and import */
export const IMPORT_ALLOWED_STATUSES = new Set([WORKIZ_STATUS_DONE_PENDING_APPROVAL, "Done"]);   // exact match
export const canImportNow = (j: WorkizJob) => isAdeqJob(j) && IMPORT_ALLOWED_STATUSES.has(j.status ?? "");
```

`listImportableAdeqJobs({ refresh })`:
- pages until `hasMore` is false or the page is empty, with a hard cap of 10 pages and 500 ms between pages;
- has an **overall deadline of 25 s**: one `AbortSignal` (`AbortSignal.timeout(25_000)`, combined with each request's own 15 s timeout) covers every page and retry wait; when it fires the call fails with `unavailable`, so a degraded Workiz cannot keep the picker spinning for minutes;
- filters with `isImportable`;
- maps to a server-side `WorkizJobSummary { id, uuid, serialId, street, city, scheduledDate, subStatus, teamFirstNames }` (`teamFirstNames`: first token of each trimmed `team[].name`, de-duplicated);
- sorts by `scheduledDate` descending (nulls last), then `serialId` descending.

`getCachedSummary(id)` returns the cached summary for a `JOB-…` id (or `undefined`) without any network call; the import route uses it for the `uuid` pre-check.

**Cache:** one module-level `{ at, rows }` entry with a 60 s TTL, plus one in-flight promise shared by concurrent callers (single-flight). Only the summaries are cached: no client name, email, phone or notes. `refresh: true` skips the TTL **only when the cache is at least 15 s old** (`REFRESH_FLOOR_MS = 15_000`); within the floor it returns the cached rows, so repeated Refresh taps or a script cannot keep re-pulling every open job against the rate limit shared with other Workiz integrations. A refresh still joins an in-flight request. Failures are never cached. The cache is per serverless instance, which is acceptable for a 60 s freshness target.

## 8. API

### 8.1 `GET /api/workiz/jobs[?refresh=1]`

`export const maxDuration = 60;` (the 25 s listing deadline plus the DB lookup fit well inside it).

**Auth:** Supabase `getUser()` → 401 `{ error: "Unauthorized" }`. Then `getUserRole()` must be `admin` or `field_tech` (§8.3) → otherwise 403 `{ error: "Forbidden" }`.

**200**
```json
{
  "jobs": [
    {
      "id": "JOB-AbCdEfGhIjKlMnOp",
      "serialId": 4696,
      "street": "100 E Example Rd",
      "city": "Cave Creek",
      "scheduledDate": "2026-10-06",
      "subStatus": "Job Complete - Reports Required",
      "teamFirstNames": ["Alex", "Sam"],
      "existing": null
    },
    {
      "id": "JOB-QrStUvWxYz012345",
      "serialId": 4667,
      "street": "200 W Sample Ave",
      "city": "Surprise",
      "scheduledDate": "2026-09-28",
      "subStatus": "Job Complete",
      "teamFirstNames": ["Sam"],
      "existing": { "canOpen": true, "inspectionId": "6f1c…", "status": "submitted" }
    },
    {
      "id": "JOB-ZyXwVuTsRqPoNmLk",
      "serialId": 4650,
      "street": "300 N Demo Ln",
      "city": "Laveen",
      "scheduledDate": "2026-09-20",
      "subStatus": null,
      "teamFirstNames": [],
      "existing": { "canOpen": false }
    }
  ],
  "fetchedAt": "2026-10-12T17:04:05.000Z",
  "role": "field_tech",
  "currentUserFirstName": "Sam"
}
```

`existing` is computed per request and never cached. One query, `SELECT id, inspector_id, status, workiz_job_id FROM inspections WHERE workiz_job_id IN (<uuids ∪ ids>)`, matches the `uuid` (what both the import and the webhook store) and also the `JOB-…` id, so the lookup does not depend on either writer's format. `canOpen = inspector_id === user.id || role === "admin"`, the same rule as `checkInspectionAccess` restricted to the roles these routes admit. When `canOpen` is false, `existing` is exactly `{ "canOpen": false }`: no inspection id or status leaks to a field tech. `uuid` is not returned. `status` drives the picker's routing (§9).

**Errors** (body `{ error, code }`, with user-safe messages and nothing from Workiz forwarded):

| Condition | Status | `code` |
|---|---|---|
| token unset | 503 | `workiz_not_configured` |
| Workiz 401 / 403-JSON | 502 | `workiz_auth_failed` |
| Workiz 429 after retries | 503 (+ `retryAfterSeconds: 60`) | `workiz_rate_limited` |
| timeout / 5xx / network / Cloudflare HTML | 502 | `workiz_unavailable` |
| unparseable response | 502 | `workiz_bad_response` |
| DB error on the existing-lookup | 500 | `internal` (logged with `logDbError`, §12) |

### 8.2 `POST /api/workiz/import`

`export const maxDuration = 300;` (the run continues in `after()`, as in the prefill route).

**Body** (`workizImportBodySchema`, strict): `{ "jobId": "JOB-AbCdEfGhIjKlMnOp" }`, where `jobId` must match `^JOB-[A-Za-z0-9]{6,40}$`. Anything else → 400 `{ error: "Invalid request", code: "invalid_request", details }`.

**Auth:** same as 8.1. The inspector is always the current user, with name `profiles.fullName ?? user_metadata.full_name ?? ""`, the same as `POST /api/inspections`.

**Existing-job checks** (each returns 200 `{ inspectionId, existing: true, status }` when the user can open the match, else 409 `already_imported` with no id):
1. Before calling Workiz: `workiz_job_id IN (jobId, getCachedSummary(jobId)?.uuid)`. A cache miss only means this check uses the id alone.
2. After `GET /jobs/{jobId}`: `workiz_job_id IN (job.uuid, job.id)`.
3. On a unique violation at INSERT (`isUniqueViolation`, which reads `err.cause.code`): re-select by `job.uuid`.

**Steps:** see §4. After the fetch: `isAdeqJob(job)` else 422 `not_adeq_job`; `IMPORT_ALLOWED_STATUSES.has(job.status)` else 422 `not_importable`. INSERT values:
- `inspectorId`: user.id
- `status`: `"draft"`
- `formData`: `getDefaultFormValues(inspectorName)` with the address fill applied
- `fieldProvenance`: the primary address entries plus the `secondary.*` entries, validated with `fieldProvenanceSchema` before insert; an entry that fails is dropped and logged by path
- `facilityAddress`, `facilityCity`, `facilityZip`: from Workiz; `facilityCounty: null`, `facilityName: null`
- `customerEmail` (validated); `customerName: null` (§5.1)
- `workizJobId`: `job.uuid`
- `apn`: null. The run sets it through `setInspectionApnIfNull`; the unverified hint is never written here.

Run: `createRun({ inspectionId, trigger: "workiz_import", input: { address, zipMustMatch }, createdBy: user.id })`, then `after(() => runPrefill(runId))`. A brand-new inspection cannot trip `countRunsInLastHour` or `findActiveRun`, so those checks are skipped. A `createRun` failure is logged with `logDbError`; the inspection is kept and `prefill.status` is `"failed"`.

**DB errors:** every catch in both routes logs through `logDbError(scope, err, { serialId })`, never `console.error(err)` and never `err.message` (§12). An unexpected error returns 500 `{ error: "Something went wrong", code: "internal" }`; DB error text is never returned to the client.

**Responses**

| Case | Status | Body |
|---|---|---|
| created, run started | 201 | `{ "inspectionId": "…", "existing": false, "prefill": { "status": "started", "runId": "…" } }` |
| created, address not parseable | 201 | `{ …, "prefill": { "status": "skipped", "reason": "address_unparseable" } }` |
| created, run creation failed | 201 | `{ …, "prefill": { "status": "failed" } }` |
| already imported, user can open it (any of the three existing-job checks) | 200 | `{ "inspectionId": "…", "existing": true, "status": "draft" }` |
| already imported by someone the user cannot see | 409 | `{ "error": "This Workiz job was already imported by another inspector", "code": "already_imported" }` |
| Workiz 404 | 404 | `{ "error": "Workiz job not found", "code": "workiz_job_not_found" }` |
| not an ADEQ job type | 422 | `{ "error": "Only ADEQ inspection jobs can be imported", "code": "not_adeq_job" }` |
| ADEQ job in another status (Canceled, Submitted, …) | 422 | `{ "error": "This Workiz job isn't ready to import", "code": "not_importable" }` |
| job without a `uuid` | 502 | `{ …, "code": "workiz_bad_response" }` |
| Workiz errors | as in 8.1 | as in 8.1 |

The server re-checks the type **and** the status. `Done` is allowed as well as `done pending approval`, because a job can legitimately move on between listing and import. Anything else (Canceled, Submitted, …) is refused, so a hand-crafted `jobId` cannot pull client name and email of a job the user could never see in the list, or import a pumping job.

### 8.3 Who can import

**`admin` and `field_tech` only**, the roles the nav offers New Inspection to (`src/types/roles.ts`). `office_staff` and users with no role claim get 403:
- the importer becomes the inspector (owner) of the draft, and office staff do not perform inspections, so an office-staff import would produce a draft owned by the wrong person;
- `POST /api/inspections` accepts any signed-in user and `/inspections/new` has no role gate, but that is the manual path, which stays as it is; the Workiz routes expose Workiz client data and are new, so they follow the nav's rule;
- a user with no role claim is an unprovisioned account (`getUserRole` returns null), and denying it Workiz data is the least-privilege default.

Field techs see every importable ADEQ job, not only their own: Workiz `team` entries are names only and cannot be reliably matched to app profiles, and SewerTime's techs share the ADEQ queue. To keep the wrong person from importing by accident, each row shows the team's first names and warns when the current user is not on the team (§2.2). The list returns only serial, street, city, date, sub-status and team first names.

**Recovery when the wrong person imported a job:** the importer (field techs may delete their own drafts) or an admin deletes the draft with the existing delete action (`DELETE /api/inspections/[id]`). That frees `workiz_job_id`, and the right tech imports the job again. There is no reassign UI (out of scope, §15).

## 9. Picker component (`workiz-import-picker.tsx`)

```ts
export function WorkizImportPicker(props: { disabled?: boolean; onBusyChange?: (busy: boolean) => void }): JSX.Element
```

- State machine: `closed → loading → ready | empty | error`, and `importing(jobId)`. The open panel is a `Card` (`w-full max-w-xl`). It uses existing `Button`, `Badge` and `lucide-react` icons and adds no new UI dependency.
- `onBusyChange(true)` while importing. The page then disables **Create New Inspection**, and the page's own `isCreating` disables the picker. That is the only change to the page's existing handler.
- Dates render from the `YYYY-MM-DD` string. The client formats `new Date(\`${d}T12:00:00Z\`)` with `Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" })`, so the date never shifts.
- Error copy, keyed by `code`:
  - `workiz_not_configured` → "Workiz import isn't set up on this server yet."
  - `workiz_auth_failed` → "Workiz rejected the app's credentials — ask an admin to check the Workiz API token."
  - `workiz_rate_limited` → "Workiz is busy — try again in a minute."
  - `workiz_unavailable` / `workiz_bad_response` / other → "Couldn't reach Workiz — try again."
  - Import errors show the server's `error` inline under the row (`role="alert"`, cleared on the next attempt) and in a toast (`sonner`, visible because the dashboard layout now mounts `<Toaster />`), and reset the row.
- 201 → `router.push(\`/inspections/${inspectionId}/edit\`)`, after firing the `prefill.status` toast from §2.3 when it is `skipped` or `failed`. 200 (`existing: true`) and **Open existing** route by `status` exactly like `handleRowClick` in `inspections-table.tsx`: `draft` → `/inspections/{id}/edit`; otherwise `/review/{id}` for admins, `/inspections/{id}` for field techs. The picker learns the role from a `role` field the jobs route adds to its response (`"admin" | "field_tech"`). A non-draft existing inspection's button reads **Report submitted**. A 409 marks the row "Imported by another inspector".
- Team line and not-on-team warning (§2.2): the jobs response also carries `currentUserFirstName` (first token of `profiles.fullName`, or `null`); with `null` the warning is not shown.
- Accessibility: the list is a `<ul role="list">`; each action is a real `<button>` with an `aria-label` such as "Import Workiz job 4696, 100 E Example Rd"; the panel's loading and error states use `aria-live="polite"`.
- All Workiz text renders as React text. There is no `dangerouslySetInnerHTML`.

## 10. Caching, rate limits, and the run limit

- **Workiz:** the 60 s server cache plus single-flight means repeated picker opens cost one listing per instance per minute, and **Refresh** cannot force more than one listing per instance per 15 s (§7.4). Import costs exactly one `GET /jobs/{id}`, and does not call it at all when the pre-check finds an existing inspection. Workiz's limit is shared with the SewerTime analytics client (and the future FSM CRM client); the refresh floor, the 25 s listing deadline and backoff (§7.2) bound our share, and the `rate_limited` error tells the user to wait a minute.
- **Prefill run limit:** the import's run counts toward `MAX_PREFILL_RUNS_PER_HOUR = 3` for that inspection, leaving 2 manual **Find records** runs in the first hour. While the import's run is queued or running, the tile disables **Find records** (and the route would answer 409 "A prefill run is already in progress"). A run in `awaiting_selection` is not active, so **Find records** is enabled and starts a fresh run, as today.
- **Stuck runs:** if the `after()` job is dropped after the import's 201, the run stays `queued` and the tile polls it. `failStaleRuns` used to run only inside `POST /prefill`, which the tile cannot reach while a run is queued. With the change in §1 "Small changes" item 2, the edit page's loader fails runs older than 5 minutes, so reloading the page after 5 minutes shows the run as failed ("Timed out") and re-enables **Find records**. Polling itself does not fail stale runs; an open page keeps showing "running" until reloaded. This is the same for client-started runs and is accepted.

## 11. Failure handling

| Failure | Result |
|---|---|
| Workiz down / 401 / 429 / timeout while listing | panel error + Retry within the 25 s deadline; manual flow unaffected; nothing cached |
| Workiz fails during import | no inspection created; inline row error + toast; the user can retry or go manual |
| Address missing or unparseable (6 of 312 backup jobs lack a leading house number) | inspection created with whatever address there is; no run; toast says to enter an APN |
| `createRun` throws | inspection kept; `prefill.status: "failed"`; tile shows its intro and **Find records** works |
| Run fails or finds no parcel | inspection keeps the Workiz address (still `prefilled` Workiz 0.9); the tile shows the stage errors and summaries as today; Workiz chips unaffected |
| Run parks in `awaiting_selection` (ambiguous permit street search) | nothing from the run is applied until the user picks a permit group in the tile; Workiz address and chips stay; **Find records** can start a fresh run instead (§2.4) |
| Job outside Maricopa, or Workiz ZIP wrong | `zipMustMatch` makes the assessor report `not_found` instead of matching a same-number, same-street parcel in another ZIP; the Workiz address stays; the user enters an APN and uses **Find records** (§5.4) |
| Assessor matches a different parcel inside the same ZIP | existing address-path risk; the tile prints what was searched; the Workiz address chip (a different street) and a differing Workiz APN chip surface the mismatch |
| `after()` job dropped, run stuck `queued` | reload after 5 minutes shows it failed and re-enables **Find records** (§10) |
| A job fails the zod schema | dropped from the list (logged by serial); import returns 502 `workiz_bad_response` |
| Concurrent imports of the same job | the unique index on `workiz_job_id` (both store `uuid`) lets one INSERT win; the loser re-selects and returns 200 `existing` (or 409) |
| Webhook fires for a job already imported (if the n8n flow is ever re-enabled) | the webhook's `eq(workizJobId, job.jobId)` check finds the import's row because both store the 6-character job uuid → `duplicate: true`, no second inspection |
| Provenance PATCH later fails | existing provider retry/re-arm behaviour; secondary keys ride the same map |

## 12. Security

- **Token:** `WORKIZ_API_V2_TOKEN` is read from `process.env` only inside `src/lib/workiz/client.ts`. It is never `NEXT_PUBLIC_`, so Next never inlines it into a client bundle. It is never logged or returned. `client.ts` starts with `import "server-only"`: Next 16 aliases that module for server and client bundles itself (`create-compiler-aliases.js`), so any client bundle that reaches the file, even transitively, fails the build. The `server-only` package (0.0.1, React team) is still added as a dependency so that `tsc`, vitest (aliased to an empty module in `vitest.config.ts`) and the `tsx` smoke script (run with `NODE_OPTIONS=--conditions=react-server`, which selects the package's empty `react-server` export) can resolve it. A boundary unit test also fails if any `"use client"` file, or anything under `src/components/`, imports `@/lib/workiz/*` directly; it is a second check, not the main one. The base URL must be `https://` (§7.2).
- **AuthN/AuthZ:** both routes call `supabase.auth.getUser()` (401), then require `admin` or `field_tech` (403, §8.3). "Open existing" follows `checkInspectionAccess` semantics; the list never returns another inspector's inspection id to a user who cannot open it; and the edit page still enforces ownership on its own.
- **Input validation:** zod strict body with a `jobId` regex; the id is `encodeURIComponent`'d into the path. All Workiz responses go through the lenient zod schema before use. Mapped values are bounded by `provenanceValueSchema` and validated with `fieldProvenanceSchema` before the INSERT.
- **SSRF:** none. The base URL is environment-controlled and no URL is taken from a request.
- **PII:** the list returns street, city, serial, date, sub-status and team (staff) first names only. The cache holds the same summaries. Logs carry serial or job id, path templates, status codes and reason codes, never names, emails, phones, addresses, note text or custom-field values. Client name and email are stored on the inspection (name in a secondary provenance entry, email in `customer_email`), as the webhook already does.
- **PII in DB errors:** Drizzle 0.45 wraps a failed query in `DrizzleQueryError`, whose `message` is `Failed query: <sql>\nparams: <params>`. For the import INSERT the params hold the client email, the street address, the whole `formData` and the provenance map (with the client name and tech notes); for `createRun` they hold the address input. So no catch in `src/lib/workiz/*` or the two routes may `console.*` the error object, its `message`, `query` or `params`. They call `logDbError(scope, err, { serialId })` from `log-db-error.ts`, which logs only `[workiz-import] db error scope=<scope> job=<serialId> code=<err.cause?.code ?? err.code ?? "unknown"> constraint=<err.cause?.constraint_name ?? "-">`. Responses carry fixed messages only (unlike the existing routes, which return `err.message` in 500s; that pattern must not be copied). Existing prefill logging (e.g. `failRun` in `run-prefill.ts`) is out of scope.
- **Upstream errors:** Workiz bodies are never forwarded; the client gets fixed messages and codes.
- **CSRF:** same posture as `POST /api/inspections`: JSON body, Supabase SSR cookies (SameSite=Lax), and no state change on GET.
- **Least privilege at Workiz:** the client can only issue GET. If Workiz offers read-only tokens, issue one for this app. This is a rollout recommendation; nothing in the app depends on it.

## 13. Testing

All tests use vitest, mocking `@/lib/db`, `@/lib/supabase/server`, `@/lib/workiz/client` and `next/server`'s `after` the way `src/app/api/inspections/[id]/prefill/__tests__/route.test.ts` does. Fixtures are **synthetic**: built from the live shape, with fake names (`Test Client`), `example.com` emails, `555-01xx` phones, `100 E Example Rd` addresses and `123-45-678` APNs. No real job data goes into the repo.

| File | Covers |
|---|---|
| `src/lib/workiz/__tests__/fixtures/jobs.ts` | builders: importable ADEQ job, Online-Booking ADEQ job, non-ADEQ job, ADEQ `Submitted` / `Canceled` / `Done` jobs, `date: null`, `subStatus: null`, empty `uuid`, lowercase city, `latitude: -1`, unit, empty and multi-member team, all CF variants from §5.2, the three bot-note shapes plus a duplicate note, CF APN, invalid APN, a non-Maricopa city with its ZIP |
| `client.test.ts` | headers (Bearer, UA, Accept); base override; base not `https://` → `not_configured`, no fetch; token with surrounding whitespace/newline is trimmed in the header; whitespace-only token → `not_configured`; GET-only; 1-based paging until `hasMore=false`; exact query string; 429 → Retry-After honoured and capped → `rate_limited`; 401 / 403-JSON → `auth_failed` with no retry; 403-HTML → `unavailable`; 5xx retried once; timeout; non-JSON 200; missing token → `not_configured` with no fetch; the token never appears in any `console.*` call |
| `adeq.test.ts` | `isAdeqJob` by id and by trimmed name; exact status match for `isImportable` (`Done`, `done`, `Done pending approval` are rejected); `canImportNow` accepts `done pending approval` and `Done`, rejects `Canceled`, `Submitted`, `done`; summary mapping incl. `teamFirstNames` |
| `adeq-jobs.test.ts` | filtering; sort order; 60 s TTL with fake timers; single-flight (two concurrent calls → one fetch sequence); `refresh` within 15 s of the last fetch returns the cached rows with no fetch, and after 15 s refetches; failures not cached; 10-page cap; 25 s overall deadline (fake timers, a never-resolving page) → `unavailable`; `getCachedSummary` hit and miss |
| `log-db-error.test.ts` | given a `DrizzleQueryError`-shaped error whose `message`/`params` contain the fixture client name, email and street, the single `console.error` call contains only scope, serial, SQLSTATE and constraint, and none of those strings |
| `custom-fields.test.ts` | every row of the §5.2 tables, including each skip reason |
| `apn-hint.test.ts` | CF wins over note; newest note wins; the three note shapes; suffix letter; confidence words; invalid → none |
| `map-job.test.ts` | §5.1 end to end: address fill + primary entries at 0.9 + matching address secondaries; city casing; ZIP+4; state mapping; unit; unparseable address → no prefill input; `zipMustMatch` true only with a valid ZIP; name fallback; email validation; `customerName` not set; team chip (order, de-dup, empty team → none); two separate comment chips (concerns → `septicTank.septicTankComments`, flow test description → `disposalWorks.disposalWorksComments`, neither combined); `none` concerns dropped, empty flow description dropped; date slicing; `workizJobId` = `uuid`; every secondary key and entry shape; output passes `fieldProvenanceSchema` |
| `src/app/api/workiz/jobs/__tests__/route.test.ts` | 401, 403 for `office_staff` and for no role, 200 shape incl. `role` and `currentUserFirstName`, `existing` per role (`canOpen: true` carries id + status; `canOpen: false` is exactly `{ canOpen: false }`), uuid ∪ id lookup, each Workiz error → status/code, `refresh=1`, `maxDuration === 60`, DB error → 500 with a fixed message |
| `src/app/api/workiz/import/__tests__/route.test.ts` | 400 bad body; 401; 403 (`office_staff`, no role); pre-check existing by id and by cached uuid → 200 without calling Workiz; 409 for another inspector's draft (no id in the body); 404; 422 non-ADEQ; 422 `not_importable` for `Canceled` and `Submitted`, `Done` accepted; empty `uuid` → 502; happy path inserts `workizJobId: job.uuid`, `customerName: null` and the expected values, calls `createRun({ trigger: "workiz_import", input: { address, zipMustMatch: true } })` and schedules `after(runPrefill)`, 201; unparseable → 201 skipped, no `createRun`; `createRun` throws a `DrizzleQueryError`-shaped error with PII params → 201 failed, inspection kept, no `console.*` argument contains the fixture name, email or street; INSERT throws the same shape (non-unique) → 500 fixed message, same log assertion; unique violation → re-select → 200; `maxDuration === 300` |
| `src/app/api/webhooks/workiz/__tests__/route.test.ts` (+1) | regression: an inspection imported for job X (stored `workiz_job_id` = X's uuid), then the webhook POSTed with `job.jobId` = X's uuid → `duplicate: true`, no INSERT |
| `src/lib/prefill/__tests__/secondary.test.ts` | key helpers; `secondaryValuesEqual` for APN, address (`Rd` vs `RD` equal; dropped unit differs; different street differs; unparseable fallback), ZIP; `isSecondaryVisible` truth table (absent, equal, normalised equal, primary verified, duplicate primary chip, differing, either comments field already containing the text); no form root named `secondary` (from `inspectionFormSchema.shape`) |
| `merge.test.ts` (+2) | `secondary.*` entries come through `mergeProposals` byte-for-byte, including when the primary path is filled, suggested and edited; **regression**: after `acceptSecondary` on `facilityInfo.sellerName` (primary `edited`, source `workiz`, value "Test Client"), merging a run with the assessor owner at 1.0 leaves the field "Test Client" and produces a `suggested` owner entry with `prior` = the Workiz entry |
| `assessor.test.ts` (+) | `findParcelByAddress` with `requireZipMatch`: rows in another ZIP only → `null`; a row in the ZIP → that row; without the hint → `rows[0]` as today; no ZIP + hint → behaves as today. `runAssessorStage` with `input.zipMustMatch` on a non-Maricopa fixture → `not_found` and `searched` mentions the ZIP |
| `run-dto.test.ts` (+) | `loadLatestRunDTOForDraft` calls `failStaleRuns` before loading; a `failStaleRuns` error is logged and the run still loads |
| `provenance-schema.test.ts` / `sources.test.ts` / `format.test.ts` (+) | `workiz` source accepted; `secondary.` keys accepted; `SOURCE_META.workiz`; new value labels |
| `provenance-context.test.tsx` (+) | `acceptSecondary` writes the value, sets the primary to `edited` Workiz, keeps the secondary, grows tanks, persists; both comments paths append to existing text and replace only when empty; `dismissSecondary` removes and persists; read-only no-ops |
| `suggestion-chip.test.tsx` (+) | `<SecondarySuggestionChip>` visibility, text, pink accent, accept/dismiss; the existing chip is unchanged |
| `form.test.tsx` (+) | `FormItem` and `FormFieldGroup` render `<SecondarySuggestionChip>` when a secondary exists and the primary is absent, `prefilled` or `edited`, and alongside the primary chip when the primary is `suggested` |
| `src/components/inspection/__tests__/workiz-import-picker.test.tsx` | not fetched until opened; loading; rows (serial, address, formatted date, sub-status, `Unscheduled`, team line, not-on-team warning shown/hidden/omitted when `currentUserFirstName` is null); Open existing routes by status and role (draft → edit; submitted → `/review` for admin, `/inspections/{id}` for field tech; label "Report submitted"); disabled "another inspector"; import → `router.push`; `skipped`/`failed` prefill → toast text; import error → inline `role="alert"` text is **rendered**; 409; error copy per code + Retry; empty state; busy callback |
| `src/app/(dashboard)/inspections/new/__tests__/page.test.tsx` | Create New Inspection still POSTs `/api/inspections` and routes; buttons disable each other while busy; a failed create renders the toast text (Toaster mounted in the test harness) |
| `src/app/(dashboard)/__tests__/layout.test.tsx` | with `@/lib/supabase/server`, `Header` and `Nav` mocked, `render(await DashboardLayout({ children }))` contains the sonner toaster region |
| `src/lib/workiz/__tests__/boundary.test.ts` | no client file imports `@/lib/workiz/*` directly (second check behind `server-only`) |

**Live smoke:** `scripts/workiz-adeq-smoke.mts`, run with `"smoke:workiz": "NODE_OPTIONS=--conditions=react-server tsx --env-file=.env.local scripts/workiz-adeq-smoke.mts"`. It is read-only and calls `listImportableAdeqJobs` and `getJob` for the first result. It prints counts (open jobs, pages, ms, ADEQ, importable) and, per job, only the serial, job-type id, sub-status, scheduled date, the list of secondary paths it would produce, and skip reason codes. It never prints names, addresses, emails, phones or notes. Expected on 2026-10-12: 5 importable jobs, all `JT-a5DbVzyREDgGvdWK`.

**Verification before merge:** `npx vitest run`, `npx tsc --noEmit`, `npx biome check <changed files>` (no `--write`; `npm run lint` writes, so don't run it — the repo is not Biome-formatted), `npm run build`, `npm run smoke:workiz`.

Then an end-to-end check on a preview deployment with the token set, driven by the agent through the Playwright MCP browser (the repo has no Playwright dependency, and none is added). Signed in as an admin test account:
1. Open the picker; check rows, team line and the not-on-team warning.
2. Import one job. **Choose the job first:** prefer one whose report is already completed in the app or on paper, or coordinate a window with the tech on that job's team, because during the test a real tech would see "Imported by another inspector".
3. Wait for the run to reach `done`, `awaiting_selection` (pick a group) or `failed`. Check that the address is replaced by the assessor (or kept, for `not_found`), the Workiz chips render, accepting the seller-name chip survives the run applying, accept and dismiss persist across a reload, and **Find records** keeps the chips.
4. Trigger an import error (e.g. import a job that was just imported from a second tab) and check the inline row error and the toast both render.

**Cleanup** (single production database): wait until the run is `done` or `failed`, never while the `after()` job may still be writing. List the run's `inspection_records.storage_path` values and remove those objects from Supabase Storage with a service-role script, because deleting the inspection cascades the rows but not the stored PDFs. Then delete the inspection (`DELETE /api/inspections/[id]` as admin), which frees `workiz_job_id` for the real import. Confirm with one read-only query that no row holds that job's `workiz_job_id`.

## 14. Rollout

1. **Environment variables**, server-only and marked sensitive in Vercel: `WORKIZ_API_V2_TOKEN` (the 64-hex bearer, not the `KEY-…` id) in **Production** and **Preview**, and in `.env.local` for development. `WORKIZ_API_V2_BASE` is optional; default `https://api.workiz.com/crm/api/v2`; only `https://` values are accepted. Add both to `.env.example` under the existing Workiz block, and note that `WORKIZ_API_SECRET` / `WORKIZ_API_TOKEN` are the n8n v1 credentials and are unrelated. Without the token, the picker shows "not set up" and nothing else is affected.
   - **How to set it:** use the Vercel REST API (`POST /v10/projects/{project}/env` with `type: "sensitive"`, `target: ["production","preview"]`) or `vercel env add … --value`, never `vercel env add` with piped stdin (under agents it has stored empty values). Build the value without a trailing newline.
   - **How to verify it:** sensitive values cannot be read back, so check the stored value's length where the API reports it, then deploy a preview and run one live call through the app (open the picker signed in, or hit `GET /api/workiz/jobs` with a session). A 200 with rows proves the token; `workiz_auth_failed` means a bad value. `getWorkizConfig()` trims the token anyway (§7.2).
2. **Dependency:** `npm install server-only` (adds `server-only@0.0.1` to `dependencies`).
3. **No migration.** No new column; `inspection_prefill_runs.trigger` is unconstrained text, so `workiz_import` needs no DDL, and `PrefillInput.zipMustMatch` lives in the existing `input` jsonb.
4. Deploy to preview → smoke + e2e + cleanup (§13) → merge.
5. **Rollback:** revert the feature commits (the Toaster mount, the stale-run sweep on page load and the opt-in ZIP hint can stay or go with them; none holds data). Keep `"workiz"` in the provenance-schema source enum (or strip `source = 'workiz'` entries with SQL first). Otherwise `PATCH /provenance` rejects the whole map for every draft that holds Workiz entries, and provenance saves for those drafts fail. Imported inspections remain ordinary drafts.

## 15. Out of scope

- Writing anything back to Workiz (status → Done, notes, the report PDF, the APN custom field).
- Workiz attachments, photos, videos and the photo checkbox custom fields.
- Changes to the inbound webhook. It still fills the form directly, which differs from this design; unifying the two is a follow-up.
- Re-import, refresh, or "pull latest from Workiz" for an imported inspection.
- Choosing or reassigning the inspector at import, and any reassign UI (recovery is delete + re-import, §8.3).
- Storing the customer phone; facility name from Workiz; `septicTank.tankInspectionDate` from the scheduled date; `capacityBasis` for the tank size.
- Non-ADEQ job types; jobs in any status other than `done pending approval` in the picker.
- County from geocoding (`latitude/longitude`, often `-1`); a deep link to the Workiz job page.
- Applying assessor/listing proposals while a run waits in `awaiting_selection` (the `runPrefill` doc comment suggests the client could; `usePrefill` applies only `done` runs, and changing that affects every run).
- Changing `PATCH /api/inspections/[id]` so it only overwrites `customer_name` when `sellerName` is non-empty.
- Removing stored permit PDFs when an inspection is deleted (existing gap; the e2e cleanup does it by hand).
- Making the poll fail stale runs (only the page load does, §10).

## 16. Open risks

- **Workiz contract drift.** Custom-field ids are account-specific. If a field is recreated, its chip silently stops appearing. The smoke script's per-job secondary-path list catches this. A status rename (e.g. `Done Pending Approval`) would empty the picker; the exact-match test documents the dependency.
- **Payload growth.** Listing pulls every open job (about 1.5 MB / 5 s today) because the API has no server-side status filter. If open jobs grow a lot, switch to `dateProperty=date&dateOperator=between` over the last 12 months. That is a one-line change in `adeq-jobs.ts`.
- **Shared rate limit** with other Workiz integrations. Mitigated by the cache, the 15 s refresh floor, the 25 s deadline and backoff, not eliminated.
- **The secondary namespace is a convention.** Code that iterates `field_provenance` must skip `isSecondaryKey`. Pinned by tests and the helper's doc comment.
- **`awaiting_selection` is common for imports.** An address-only run often parks waiting for a permit pick, and then none of the assessor results are applied until the user picks. The tile's existing picker is the only prompt; inspectors need to know to look at it. the owner chose to keep the run address-driven (§17 item 5), so this matches the existing manual address flow.
- **Accepted Workiz values are sticky.** Accepting a Workiz chip writes an `edited` entry, so a later run shows a differing records value as a chip instead of replacing it. This differs from accepting a records chip (which writes `prefilled` and can be superseded), and is deliberate: a Workiz value is the inspector's own job data.
- **`customer_name` stays blank** until Seller Name holds a value (existing PATCH behaviour: every autosave writes `sellerName ?? null`). After the owner or an accepted client name lands in Seller Name, the dashboard search shows that name.
- **Same-ZIP wrong parcel.** `zipMustMatch` stops cross-ZIP matches, but a same-number, same-street-prefix parcel in the same ZIP can still win (existing address-path behaviour). The Workiz address chip and APN chip are the visible signals.
- **v1 `UUID` = v2 `uuid` is inferred**, not checked against the v1 API (the n8n flow is inactive). Lookups match both `uuid` and the `JOB-…` id, so the import can never duplicate itself; only the import → webhook direction relies on the equality, and only if the n8n flow is re-enabled.
- **Timestamps.** `updatedAt` and `utcUpdatedAt` differ by +14 h in the backup (unexplained). This design reads only `date`, which is wall-clock time.

## 17. Owner decisions (resolved 2026-10-13)

All questions raised during design were answered by the owner on 2026-10-13. Nothing is open.

1. **Water Source "Municipal / Private Water Supply"** (137 of 232 non-empty answers in the backup): **skipped**, no chip (ambiguous between Municipal System and Private Water Company). Resolved: skip.
2. **Tech notes: split into two chips.** Workiz "notable concerns" is a chip on the septic tank comments field (`septicTank.septicTankComments`). Workiz "flow test description" is a chip on the disposal works comments field (`disposalWorks.disposalWorksComments`). Accept appends and never wipes existing text; a chip hides when its field already contains the text. Resolved: split (§5.1, §6.3).
3. **Access: `admin` and `field_tech` only**; `office_staff` and users with no role get 403. Field techs see all importable ADEQ jobs, and each row warns when the current user is not on the Workiz team. Resolved: confirmed (§2.2, §8.3).
4. **Customer phone: skipped** (no column). Email goes to `customer_email`. Resolved: confirmed.
5. **APN hint: chip only.** The run stays address-driven (the owner's earlier explicit choice) and is not given `input.apn`. When the run parks in `awaiting_selection`, behaviour is the same as the existing manual address flow (§2.4). Resolved: confirmed.
6. **Spec status: approved by the owner on 2026-10-13.**
