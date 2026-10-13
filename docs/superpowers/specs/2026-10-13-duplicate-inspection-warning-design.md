# Possible Duplicate Inspection Warning — Design

**Date:** 2026-10-13
**Status:** Draft, revised after spec review. Orchestrator defaults applied (§16); the owner can override any of them.
**Branch:** `feature/duplicate-inspection-warning`

## 1. Goal

When an inspector works on an inspection whose property may already have a report, show a small amber notice: "This address may match another report". The notice links to that report inside the app, and the link opens in a **new tab**. The same check runs in two places:

1. **The inspection wizard** (Step 1, Facility Info), for every draft: blank manual drafts, Workiz-imported drafts and webhook drafts. The check runs on load and again whenever the address, city, ZIP or Tax Parcel Number changes. That includes changes made by APN Lookup, a prefill run, an accepted suggestion chip or a scan. The review editor shares the step component, so the notice also appears on `/review/{id}`.
2. **The Workiz import picker** (`/inspections/new` → **Import from Workiz**). Each job row shows the notice before anyone imports, based on the job's service address and its APN hint.

The notice is information only. It never blocks creating, importing, editing, submitting or finalising, and it never changes data.

### Non-goals

- No merging, linking or de-duplicating of inspections. Nothing is written.
- No blocking or confirmation dialog anywhere.
- No change to who can open which inspection. The notice only links to pages the viewer can already open (§8).
- No new database column, index or migration (§9).
- No fuzzy street matching beyond the normalisation rules in §5.2: no `Seventh` = `7th`, no geocoding, no edit distance.
- No notice on the dashboard tables or on `/inspections/{id}` (the field-tech PDF view).

### Small changes to existing behaviour

These are the only existing behaviours the feature touches:

1. `splitUnit` moves out of `src/lib/prefill/secondary.ts` into the new `src/lib/prefill/address-key.ts`. Its code does not change, and `secondary.ts` imports it from there. `secondary.test.ts` pins that behaviour stays the same.
2. `STREET_SUFFIXES` in `src/lib/prefill/input.ts` becomes `export const` so that a test can check the new suffix table covers it. Its value does not change.
3. The routing in `inspectionHref` (`workiz-import-picker.tsx`) moves into a shared `src/lib/inspection-path.ts`. The picker keeps exporting `inspectionHref` with the same signature, as a thin wrapper, so its tests and callers don't change.
4. `logDbError` (`src/lib/workiz/log-db-error.ts`) gains an optional 4th parameter `prefix = "workiz-import"`. Every existing call keeps its output byte for byte.
5. `WorkizJobSummary` (the server-side cached summary) gains `zip: string | null` and `apnHint: string | null`. Neither is sent to the browser (§7.3).
5a. `WORKIZ_CF` moves out of `src/lib/workiz/adeq.ts` into a new leaf module `src/lib/workiz/custom-field-ids.ts` (no imports). `adeq.ts` re-exports it (`export { WORKIZ_CF } from "./custom-field-ids"`), so `map-job.ts` and the tests keep importing it from `./adeq`; `apn-hint.ts` imports it from the leaf. Its value does not change. This avoids an `adeq.ts` ↔ `apn-hint.ts` import cycle (§7.3).
6. `GET /api/workiz/jobs` adds an optional `possibleMatches` to a row, but only when that row has at least one match. It also adds a top-level `matchCheckFailed: true`, but only when the check failed. A response with no matches looks exactly like today's.

## 2. User-facing behaviour

### 2.1 Wizard / review editor (Step 1, Facility Info)

The notice sits **directly under the Address field**, full width (`sm:col-span-2`), above City. Address is the first property field the inspector fills or checks. The notice also names the APN when the APN is what matched.

| Situation | What renders |
|---|---|
| No house-number address and no usable APN typed yet (a fresh blank draft) | nothing, and no request |
| Check running, or finished with no match | nothing (no spinner; the field stays clean) |
| Values changed since the last check (a different normalised key, §9.2) | the previous notice is removed **at once**, before the new check returns; it comes back only if the new check matches. Edits that leave the key unchanged (`Rd` → `Road`) keep the notice in place |
| **Exactly one** match the viewer can open, and nothing hidden | one amber box. The **whole box is one link** (`<a target="_blank" rel="noopener noreferrer">`): header `This address and APN may match another report` with an external-link icon, then a detail line `100 E Example Rd, Cave Creek · Completed · Inspected Oct 6, 2026 · Sam Sample · Same APN and address` |
| **Two or more** matches the viewer can open | amber box. Header (plain text, not a link) `This address may match other reports:` followed by a list. **Each item is its own new-tab link** with the same detail line. At most 5 items; when more exist, a last muted line reads `More matches exist — search the dashboard for this address.` |
| Matches the viewer **cannot** open (another inspector's report, viewer is a field tech) | a **non-linked** line in the same box: `May match a report by another inspector` (or `May match 3 reports by other inspectors`). No address, status, date, name or id |
| Both kinds | the list of links, then the non-linked line as the last item: `+ 1 more by another inspector` |
| Check failed (network, 5xx) | nothing. The check runs again on the next relevant change and whenever Step 1 mounts again |

**Header noun.** The header takes the union of the visible matches' reasons: both reasons → "address and APN"; APN only → "APN"; address only → "address". When only hidden matches exist, the hidden-only copy above is used and the reasons are never named.

**Detail line parts:**
- `facilityAddress, facilityCity`, or `No address` when both are empty.
- Status label from `getStatusConfig(status).label` (`src/lib/constants/status.ts`), so `submitted`/`in_review` → "In Review".
- `Inspected Oct 6, 2026` when the matched report has a `dateOfInspection` (`YYYY-MM-DD`, formatted at noon UTC in UTC so the day never shifts, the same technique as the picker's `formatScheduledDate`). Otherwise `Created Oct 1, 2026` from `created_at`, formatted in `APP_TIME_ZONE` (America/Phoenix).
- Inspector: `profiles.full_name`; `you` when the viewer owns the match; `Unknown inspector` when the profile is missing.
- Reason: `Same APN and address`, `Same APN`, or `Same address`.

**Link target** (the routing of `handleRowClick` in `inspections-table.tsx`, with one deliberate deviation): a draft **the viewer owns** opens `/inspections/{id}/edit`; any other status opens `/review/{id}` for admin and office staff and `/inspections/{id}` for its field-tech owner. **Deviation:** a draft the viewer does **not** own (only possible for admin/office staff) opens `/review/{id}`, not the edit page. The edit page mounts `InspectionWizard`, whose `useAutoSave` runs without `seedFromInitial`, so its first tick PATCHes the whole `formData` loaded at open; any later `setValue` in that tab would then save its stale snapshot over the owner's edits. This feature sends people into a second draft for the same property, which is exactly when two people work on it at once. `/review/{id}` accepts drafts for privileged viewers and seeds autosave (`seedFromInitial: true`), so opening it writes nothing. The server computes the `href` for the viewer (§6.1, `matchHref` in §6.4).

The links work in read-only mode too. The step's `<fieldset disabled>` disables form controls only, not anchors, so a completed report on the review page still links to its possible duplicate.

**Not dismissable.** The box is compact (one header line plus one line per match, `text-sm`/`text-xs`), it disappears as soon as the normalised values change and stays away unless the new values match, and nothing is stored. Every stored value a match can rest on is one that someone can correct in the form: the write-once `apn` column only counts when the stored form APN is empty or unusable (§5.1), so a stale column value can never cause a match that no edit can clear. A dismiss button would need per-session storage to stop the box returning on every step change, and that adds state for little benefit. See §16, decision 4.

### 2.2 Workiz import picker

Under a job row's team line, a compact amber block (`text-xs`) shows the same content as the wizard notice:
- One match the viewer can open: the header line `May match an existing report` plus the detail line, all as one new-tab link.
- Several: header `May match existing reports:`, then at most **3** linked items, plus the hidden line and the "more" line where they apply.
- Hidden only: `May match a report by another inspector`.

The block never disables **Import**. Rows that are already imported (`existing` set) still show matches with **other** inspections; the job's own imported inspection is excluded (§5.4) because the row's **Open existing** button already covers it.

If the match lookup fails but the Workiz listing succeeded, the list still renders, and a single muted line above it reads `Couldn't check for matching reports.` A failed informational check never hides the job list.

### 2.3 Copy (exact strings, exported as constants from `possible-duplicate-warning.tsx`)

| Constant | Text |
|---|---|
| `headerSingle(noun)` | `This ${noun} may match another report` |
| `headerMultiple(noun)` | `This ${noun} may match other reports:` |
| `PICKER_HEADER_SINGLE` | `May match an existing report` |
| `PICKER_HEADER_MULTIPLE` | `May match existing reports:` |
| `hiddenOnly(n)` | `May match a report by another inspector` (n = 1) / `May match ${n} reports by other inspectors` |
| `hiddenTail(n)` | `+ 1 more by another inspector` / `+ ${n} more by other inspectors` |
| `MORE_MATCHES` | `More matches exist — search the dashboard for this address.` |
| `MATCH_CHECK_FAILED` | `Couldn't check for matching reports.` |
| `MATCH_ANNOUNCEMENT` (screen readers only, live region §9.2) | `Possible matching report found` |
| link suffix (screen readers only) | `(opens in a new tab)` |

## 3. Architecture

```
src/lib/prefill/
  address-key.ts                NEW — pure, client-safe: splitUnit (moved), addressKey(), addressKeysCompatible(), SUFFIX_CANONICAL
  secondary.ts                  imports splitUnit from address-key.ts (no behaviour change)
  input.ts                      `export` on STREET_SUFFIXES (value unchanged)
src/lib/inspection-matches/
  normalize.ts                  NEW — pure, client-safe: apnMatchKey, zip5, cityKey, buildMatchQuery, matchQueryKey
  match.ts                      NEW — pure: candidateKeys, storedApnKey, matchReasons, matchHref, buildMatchResult (ranking, limits, viewer split)
  format.ts                     NEW — pure, client-safe: headerNoun, reasonLabel, formatMatchWhen
  store.ts                      NEW — `import "server-only"`; findMatchCandidates() (one bounded SELECT)
  find.ts                       NEW — server: findPossibleDuplicates(), findPossibleDuplicatesBatch()
src/lib/inspection-path.ts      NEW — inspectionPath(id, status, privileged): the handleRowClick routing
src/lib/workiz/
  custom-field-ids.ts           NEW — leaf module: WORKIZ_CF (moved from adeq.ts, value unchanged)
  adeq.ts                       WorkizJobSummary += zip, apnHint; toJobSummary fills them; re-exports WORKIZ_CF
  apn-hint.ts                   imports WORKIZ_CF from ./custom-field-ids (breaks the adeq ↔ apn-hint cycle)
  log-db-error.ts               optional `prefix` parameter
src/types/inspection-matches.ts NEW — wire types (client and server)
src/types/workiz-import.ts      WorkizJobRow += possibleMatches?; WorkizJobsResponse += matchCheckFailed?
src/app/api/inspections/[id]/matches/route.ts   NEW — POST: live form values in, matches out
src/app/api/workiz/jobs/route.ts                adds the batch match lookup (per request, never cached)
src/components/inspection/
  possible-duplicate-warning.tsx  NEW — <PossibleDuplicateNotice> (presentational) + <PossibleDuplicateWarning> (wizard container)
  step-facility-info.tsx          renders <PossibleDuplicateWarning inspectionId /> under the Address field
  workiz-import-picker.tsx        renders <PossibleDuplicateNotice variant="compact" /> per row; inspectionHref delegates to inspectionPath
scripts/duplicate-match-smoke.mts NEW — read-only live smoke (`npm run smoke:matches`), aggregates only
package.json                      + script smoke:matches
```

Unchanged on purpose: the database schema, `POST /api/inspections`, `PATCH /api/inspections/[id]` (it already syncs `facility_address`/`facility_city`/`facility_zip` on every autosave), `POST /api/workiz/import`, the webhook, `usePrefill`, `mergeProposals`, the provenance system, `checkInspectionAccess` and `requireInspectionAccess` (reused as they are).

### Why a POST with live values (not a GET on the saved row)

- The wizard needs the **live** form values. APN Lookup and a finished prefill run write into the form via `setValue`, and the autosave PATCH lands about 1 s later. A GET on the saved row would lag behind, and would miss a value that is never saved (for example while autosave is failing).
- The picker has no inspection yet, so the matching logic must accept plain values anyway. Both callers share `findPossibleDuplicates*`.
- **POST keeps addresses and APNs out of URLs.** Vercel request logs and browser history record path and query, never bodies. The route changes no state; the CSRF posture is the same as the other JSON routes (SameSite=Lax Supabase cookies, JSON body).
- The route is nested under `[id]` so the server can (a) exclude the current inspection and (b) require that the caller can view that inspection. A caller cannot run the check against an inspection id they cannot see.

## 4. Data flow

```
Wizard / review (client)                     POST /api/inspections/{id}/matches            DB
  useWatch(facilityAddress, facilityCity,
           facilityZip, taxParcelNumber)
  query = buildMatchQuery(values)  ── null ─▶ render nothing, no request
  key = matchQueryKey(query)
  mount: request now · later changes: 700 ms debounce · same key: no request · new key aborts the old one
        ──POST { facilityAddress, facilityCity, facilityZip, taxParcelNumber }──▶
                                             id is a UUID? else 404
                                             requireInspectionAccess(id, "view") → 401/403/404
                                             zod strict body (types + 1,000-char body caps) → 400
                                             buildMatchQuery (server is authoritative; over-long
                                                values give a null key for that field only)
                                             null → 200 empty, no query
                                             findMatchCandidates({ houseNumbers:[n], apnKeys:[k],
                                                excludeInspectionId:id, limit:200 }) ─────────▶ one SELECT (LIMIT 201)
                                             matchReasons per row (pure, JS) → rank → split by viewer
  <PossibleDuplicateNotice> ◀── 200 { matches ≤5, hiddenCount, truncated }

Picker (client)                              GET /api/workiz/jobs
  [Import from Workiz] ──GET──▶              auth (admin | field_tech)
                                             listImportableAdeqJobs (60 s cache, unchanged)
                                             Promise.all([
                                               findInspectionsByWorkizIds(...),            (unchanged)
                                               loadProfileFullName(...),                   (unchanged)
                                               findPossibleDuplicatesBatch(items) ─ own try/catch ─▶ one SELECT
                                             ])
  rows (+ possibleMatches when non-empty) ◀── { jobs, …, matchCheckFailed? }
```

## 5. Matching rules

### 5.1 What is compared

**The input side** is four strings: the live form values in the wizard, or the Workiz summary in the picker (`street` with ` #unit`, `city`, `zip`, `apnHint`).

**The stored side** (each existing inspection):

| Value | Source | Why |
|---|---|---|
| address | column `facility_address` | `PATCH /api/inspections/[id]` writes it from `formData.facilityInfo.facilityAddress` on every autosave; the import and the webhook write it at insert. Prod 2026-10-13: 128/132 populated, **0** rows where the column differs from the form value. |
| city | column `facility_city` | same sync; 128/132 populated |
| ZIP | column `facility_zip` | same sync; 128/132 populated, 0 rows differ from the form; 3 of 128 are not plain 5-digit |
| APN | `formData.facilityInfo.taxParcelNumber`; column `apn` **only as a fallback** | The form value is the one the user sees and edits (127/132 populated). The column is written only once, by a prefill run (`setInspectionApnIfNull` updates only `WHERE apn IS NULL`, and `recordInspectionApn` may write a typed APN the inspector later corrects) or the webhook, and never by PATCH (14/132 populated, and all 14 equal the form value today). The form value is authoritative. The stored APN key is `apnMatchKey(form value)` when that is non-null; **only when it is null** (form field empty or unusable) is `apnMatchKey(column apn)` used instead. A stale column value therefore never matches once the form holds a usable APN. |
| date | `formData.facilityInfo.dateOfInspection` | display only; kept only when it matches `^\d{4}-\d{2}-\d{2}$` (104/132 populated) |
| inspector | `profiles.full_name` via `inspector_id` | display only |

Every status counts (`draft`, `submitted`, `in_review`, `completed`, `sent`). The current inspection is always excluded.

### 5.2 Normalisation (`normalize.ts`, `address-key.ts`)

**APN key** `apnMatchKey(raw)`: trim; a trimmed value longer than `APN_MAX_LENGTH` (20) gives `null` (the same cap as `isValidApn`, so a multi-parcel entry like `123-45-678 & 123-45-679` or an APN with a trailing note never yields a bogus concatenated key). Otherwise uppercase, then drop everything except `A–Z` and `0–9`. The key is used only when it is 6–20 characters long, contains a digit, and is not all zeros. Otherwise it is `null` (so `N/A`, `TBD`, `0`, `pending` never match). The same function is applied to the input and, in JS, to both stored APN values. `formatApn` is deliberately **not** required: it accepts only the Maricopa `NNN-NN-NNN[A]` shape, and other counties' APNs would never match. The SQL side uses the same transformation, `upper(regexp_replace(x, '[^0-9A-Za-z]', '', 'g'))`, which gives the same result for the ASCII values these fields hold.

**Address key** `addressKey(line)`, built on the existing `splitUnit` and `parseStreetAddress`, with its own street-word step:
1. **Comma cut.** Split the line on `,`. Keep the first segment, then keep each following segment **while** it is a unit token (trimmed, case-insensitive: `^#\s*[A-Za-z0-9-]{1,8}$` or `^(UNIT|APT|STE|SUITE|SPACE|SPC|LOT)\s+#?[A-Za-z0-9-]{1,8}$`); stop at the first segment that is not. Join the kept segments with a space. So `100 E Example Rd, Cave Creek, AZ 85331` → `100 E Example Rd`, and `100 E Example Rd, #12, Cave Creek` → `100 E Example Rd #12`. Without this, `parseStreetAddress` (which only cuts at 2+ spaces) keeps `Example Rd, Cave Creek, AZ 85331` as the street name and a pasted full address never matches.
2. `splitUnit(line)` (moved from `secondary.ts`, code unchanged) separates `#12`, `Unit 4`, `Space 12`, `Lot 7` and the like → `{ street, unit }`.
3. **Unit canonicalisation** (in `addressKey`, after `splitUnit`): uppercase, drop `#`, then drop a leading `SUITE|STE|SPACE|SPC|UNIT|APT|LOT` when something remains after it. `splitUnit` returns `SPACE12` for `100 E Example Rd #Space 12` (the shape `formatWorkizStreet` produces when the Workiz unit field holds `Space 12`) but `12` for a typed `100 E Example Rd Space 12`; both become `12`. Likewise `#Lot 7` / `Lot 7` / `#7` → `7`. An empty result → `null`.
4. `parseStreetAddress(street)` (`input.ts`) → `{ streetNumber, streetDir?, streetName }`, or `null` when there is no leading house number. No key → no address matching.
5. **Street words** (in `address-key.ts`, **not** `normalizeStreetName`): uppercase `streetName`, remove `'` and `"`, turn every other non-`A–Z0–9` character into a space, split on whitespace. `normalizeStreetName` is deliberately not reused: it drops a leading direction word a second time after `parseStreetAddress` already took one, which collapses `100 W North Ln` and `100 W South Ln` to `LN`, `100 N East St` and `100 N West St` to `ST`, and `100 N West Valley Rd` and `100 N Valley Rd` to `VALLEY`.
6. `suffix`: when there are 2 or more words and the last is in `SUFFIX_CANONICAL`, pop it and map it to its canonical abbreviation; otherwise `null`. `SUFFIX_CANONICAL` maps every entry of `STREET_SUFFIXES`: `ROAD→RD, RD→RD, STREET→ST, ST→ST, AVENUE→AVE, AVE→AVE, DRIVE→DR, DR→DR, LANE→LN, LN→LN, BOULEVARD→BLVD, BLVD→BLVD, COURT→CT, CT→CT, PLACE→PL, PL→PL, CIRCLE→CIR, CIR→CIR, TRAIL→TRL, TRL→TRL, PARKWAY→PKWY, PKWY→PKWY, HIGHWAY→HWY, HWY→HWY, TERRACE→TER, TER→TER, WAY→WAY, LOOP→LOOP`. A test asserts that its keys equal `STREET_SUFFIXES`.
7. **Direction-word street names.** When `parseStreetAddress` took a direction and exactly one word remains and that word is in `SUFFIX_CANONICAL` (`100 North Ln` parses as dir `N`, street `Ln`), the direction was the name: `dir = null`, `street` = the full direction word (`N→NORTH, S→SOUTH, E→EAST, W→WEST`; `NE`/`NW`/`SE`/`SW` kept as is), `suffix` = that word's canonical form. So `100 North Ln` → street `NORTH`, suffix `LN`, and it does not match `100 South Ln`.
8. `street` = the remaining words joined with a space. Result: `{ number, dir: streetDir ?? null, street, suffix, unit }`. An empty `street` → `null`.

Examples: `E. Cave Creek Rd` → dir `E`, street `CAVE CREEK`, suffix `RD`; `100 E South Mountain Ave` → street `SOUTH MOUNTAIN`, suffix `AVE`; `100 Broadway` → street `BROADWAY`, suffix `null`.

The suffix is kept as its own part of the key. Without it, Phoenix's `N 7th St` and `N 7th Ave` (different streets about a mile apart, sometimes in the same ZIP) would both become `7TH`.

**ZIP** `zip5(raw)`: trimmed value matches `^(\d{5})(-?\d{4})?$` → the first 5 digits; otherwise `null`.
**City** `cityKey(raw)`: collapse whitespace, trim, lowercase; empty → `null`.

### 5.3 Rules (`match.ts`)

A stored inspection matches when **either** reason holds:

- **`apn`**: the input APN key is non-null and equals the stored APN key, where the stored APN key is the form APN key when non-null and otherwise the column APN key (§5.1). A stored row with form APN `B` and column APN `A` does **not** match input `A`.
- **`address`**: both address keys are non-null **and**
  - `number` is equal, **and**
  - `street` is equal, **and**
  - `dir` is equal, or one side has none, **and**
  - `suffix` is equal, or one side has none, **and**
  - `unit` is equal, or one side has none, **and**
  - **locality**:
    - both ZIPs present and equal → passes;
    - both ZIPs present and different → passes **only** when both cities are present and equal (prefill fills the ZIP from the assessor situs while Workiz and typed ZIPs come from the customer, and in rural Maricopa/Yavapai these can differ for the same parcel; a house number on the same street in the same city is still worth a look);
    - a ZIP missing on either side → if both cities are present they must be equal, otherwise (locality unknown on at least one side) it passes.

A missing direction, suffix, unit or locality is treated as **compatible** on purpose. The notice says "may match". A half-typed address should surface a candidate, and typing more narrows it on the next check.

The APN and address reasons are independent. A row matching on address whose APN differs from the input's APN still matches on `address`. This is deliberate: a different APN at the same address is either a typo or a split parcel, and both are worth a look.

### 5.4 Ranking, limits and exclusions

- Order: matches with both reasons first, then `apn` only, then `address` only; within each group, newest `created_at` first.
- Candidate query cap: `CANDIDATE_LIMIT = 200` rows (wizard) / `BATCH_CANDIDATE_LIMIT = 500` (picker), ordered by `created_at DESC`. The SELECT asks for `cap + 1` rows; the cap counts as hit (`capHit`) only when `cap + 1` rows come back, and the extra row is dropped before matching.
- Result: at most `limit` visible matches (5 in the wizard, 3 per picker row). `hiddenCount` counts **every** hidden match among the candidates. `truncated` is true when more visible matches exist than are returned, **or** when the candidate cap was hit.
- **Batch overflow.** The picker's single query shares one candidate pool across all rows, so when it overflows, older genuine matches for one row may have been pushed out by other rows' candidates, and nothing tells which rows lost any. `findPossibleDuplicatesBatch` therefore does not mark every row `truncated`; it falls back to one `findMatchCandidates` call per item that has a query (sequential, `CANDIDATE_LIMIT` each, so each row's `truncated` reflects its own cap). At 133 rows and a 500 cap this path is unreachable for years; it exists so the "more matches" line never lies, and it is covered by a mocked-store test.
- Wizard: `id <> {current id}`.
- Picker: a stored row whose `workiz_job_id` is that job's `uuid` or its `JOB-…` id is skipped for **that job only**. Those are the job's own import, which **Open existing** already shows.

### 5.5 Examples

All values are synthetic. "Input" is what is typed or comes from Workiz; "Stored" is an existing inspection.

| # | Input | Stored | Result |
|---|---|---|---|
| 1 | APN `123-45-678` | form APN `12345678` | match, `apn` |
| 2 | APN `123-45-678A` | form APN `123-45-678` | no match (split parcel letter differs) |
| 3 | APN `N/A` | form APN `N/A` | no match (key too short) |
| 4 | APN `` | column `apn` `123-45-678`, form APN empty | the input has no key, so no APN check |
| 5 | APN `123-45-678` | form APN empty, column `apn` `123-45-678` | match, `apn` (column fallback) |
| 5a | APN `123-45-678` | form APN `123-45-679`, column `apn` `123-45-678` (stale) | no APN match (the form APN is usable, so the column is ignored) |
| 5b | APN `123-45-678 & 123-45-679` (23 characters), `100 E Example Rd`, 85331 | `100 E Example Rd`, 85331, APN `123-45-678` | match, `address` only (the over-long APN gives no key; the address still checks) |
| 6 | `100 E Example Rd`, 85331 | `100 E. Example Road`, 85331 | match, `address` |
| 7 | `100 E Example Rd`, 85331 | `100 W Example Rd`, 85331 | no match (direction differs) |
| 8 | `100 Example Rd`, 85331 | `100 E Example Rd`, 85331 | match (direction missing on one side) |
| 9 | `1234 N 7th St`, 85014 | `1234 N 7th Ave`, 85014 | no match (suffix differs) |
| 10 | `1234 N 7th`, 85014 | `1234 N 7th Ave`, 85014 | match (suffix missing on one side) |
| 11 | `100 E Example Rd #12` | `100 E Example Rd #14`, same ZIP | no match (unit differs) |
| 12 | `100 E Example Rd Space 12` | `100 E Example Rd`, same ZIP | match (unit missing on one side) |
| 12a | `100 E Example Rd #Space 12` (Workiz street + unit) | `100 E Example Rd Space 12`, same ZIP | match (both units canonicalise to `12`) |
| 12b | `100 E Example Rd #Lot 7` | `100 E Example Rd Lot 7`, same ZIP | match (both units `7`) |
| 12c | `100 E Example Rd, Cave Creek, AZ 85331` | `100 E Example Rd`, 85331 | match, `address` (comma cut) |
| 12d | `100 E Example Rd, #12` | `100 E Example Rd #14`, same ZIP | no match (unit `12` kept through the comma cut, differs) |
| 12e | `100 W North Ln`, 85331 | `100 W South Ln`, 85331 | no match (streets `NORTH` vs `SOUTH`) |
| 12f | `100 N East St`, 85014 | `100 N West St`, 85014 | no match (streets `EAST` vs `WEST`) |
| 12g | `100 N West Valley Rd`, 85331 | `100 N Valley Rd`, 85331 | no match (streets `WEST VALLEY` vs `VALLEY`) |
| 12h | `100 North Ln`, 85331 | `100 South Ln`, 85331 | no match (direction-word street names, §5.2 step 7) |
| 13 | `100 E Example Rd`, 85331, Cave Creek | `100 E Example Rd`, 85377, Cave Creek | match (ZIPs differ but both cities present and equal) |
| 13a | `100 E Example Rd`, 85331, Cave Creek | `100 E Example Rd`, 85377, Carefree | no match (ZIPs differ, cities differ) |
| 13b | `100 E Example Rd`, 85331, no city | `100 E Example Rd`, 85377, Cave Creek | no match (ZIPs differ and the cities cannot confirm) |
| 14 | `100 E Example Rd`, no ZIP, `cave creek` | `100 E Example Rd`, 85331, `Cave Creek` | match (no ZIP on one side → cities compared, equal) |
| 15 | `100 E Example Rd`, no ZIP, Carefree | `100 E Example Rd`, 85331, Cave Creek | no match (cities differ) |
| 16 | `100 E Example Rd`, no ZIP, no city | `100 E Example Rd`, 85331, Cave Creek | match (locality unknown → compatible) |
| 17 | `Example Rd` (no house number), APN empty | anything | no request at all (`buildMatchQuery` → `null`) |
| 18 | `100 E Example Rd`, 85331, APN `123-45-678` | `100 E Example Rd`, 85331, APN `123-45-679` | match, `address` only |
| 19 | `100 E Example Rd`, 85331, APN `123-45-678` | `100 E Example Rd`, 85331, APN `123-45-678` | match, `apn` + `address` (ranked first) |

### 5.6 Measured against production (read-only, 2026-10-13)

The rules were run as a prototype over every row against every other row. The prototype used the repo's real `parseStreetAddress`/`normalizeStreetName` plus the suffix and key rules above, and printed aggregates only. Results: **133** inspections; **17** would show the notice; **9** pairs match on APN and address; **1** pair matches on address only (one side has no APN); **0** on APN only; at most **2** matches for any one inspection; **0** pairs were rejected only by the direction or suffix rule. Of the APN pairs, the two reports in a pair are 0–64 days apart, and in 7 of 9 pairs both are completed. These are re-inspections or re-issued reports at the same property, which is exactly what the notice is for. 4 rows have no address and 4 have no 5-digit ZIP.

**These figures predate the review revisions** and used the earlier rule set: `normalizeStreetName` for the street, no comma cut, no unit canonicalisation, a match on either stored APN, no over-long-APN cap, and "ZIP decides" locality. The revisions loosen some cases (comma cut, unit canonicalisation, equal-city-different-ZIP) and tighten others (direction-word streets, stale column APN, over-long APN), so the counts may shift in either direction. The prototype also did not count pairs rejected **only** by locality. The live smoke (§12) re-measures with the shipped code, prints `rejectedByLocalityOnly` (candidate pairs that pass every address rule except locality) next to the match counts, and its first run replaces these numbers as the baseline in §16 decision 3.

## 6. API

### 6.1 `POST /api/inspections/[id]/matches`

**Params:** `id` must match the UUID regex `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` (case-insensitive). Anything else gets 404 `{ "error": "Inspection not found" }` before any query runs, so a malformed id never reaches Postgres as a `22P02` 500.

**Auth:** `requireInspectionAccess(id, "view")` (`src/lib/prefill/route-access.ts`). That gives 401 when signed out, 404 when the inspection is missing, and 403 when the caller is neither the owner nor admin/office staff (`checkInspectionAccess` rules). It returns `userId` and `isPrivileged`, which are the only viewer facts the route needs.

**Body** (`inspectionMatchRequestSchema`, zod `.strict()`, all optional):
```json
{ "facilityAddress": "100 E Example Rd", "facilityCity": "Cave Creek", "facilityZip": "85331", "taxParcelNumber": "123-45-678" }
```
Each field is `z.string().max(MATCH_FIELD_BODY_MAX)` with `MATCH_FIELD_BODY_MAX = 1000`, a body-size bound only. The form schema (`src/lib/validators/inspection.ts`) has no length limits and the inputs have no `maxLength`, so the route must **not** reject a value just because it is longer than a usable one: a pasted APN with a trailing note or a ZIP like `85331-1234 AZ` would otherwise turn off the whole check, address included, for that draft. Instead `buildMatchQuery` gives a `null` key for that field only: APN over `APN_MAX_LENGTH` (20) → `null` (§5.2); a ZIP that fails `zip5` → `null`; a city over 60 characters → `null`; `parseStreetAddress` already reads at most the first 200 characters of an address. The other fields are still checked. The client slices each value to `MATCH_FIELD_BODY_MAX` before sending (§9.2), so a normal client never gets a 400. Invalid JSON, a non-string, an unknown key or a value over 1,000 characters gives 400 `{ "error": "Invalid request" }`, with no echo of the input.

**200** (`InspectionMatchResult`, header `Cache-Control: no-store`):
```json
{
  "matches": [
    {
      "inspectionId": "6f1c2a9e-0000-4000-8000-000000000001",
      "href": "/review/6f1c2a9e-0000-4000-8000-000000000001",
      "status": "completed",
      "facilityAddress": "100 E Example Rd",
      "facilityCity": "Cave Creek",
      "inspectionDate": "2026-10-06",
      "createdAt": "2026-10-06T19:12:00.000Z",
      "inspectorName": "Sam Sample",
      "isOwn": false,
      "reasons": ["apn", "address"]
    }
  ],
  "hiddenCount": 0,
  "truncated": false
}
```
When `buildMatchQuery` returns `null`, the route answers `{ "matches": [], "hiddenCount": 0, "truncated": false }` and runs no query.

**500:** a DB error is logged with `logDbError("match_lookup", err, {}, "inspection-matches")` and the response is `{ "error": "Couldn't check for matching reports", "code": "internal" }`. The error text is never returned (§10).

No `maxDuration` export is needed: one SELECT of a few milliseconds.

### 6.2 `GET /api/workiz/jobs` additions

Auth, caching, errors and every existing field stay unchanged (Workiz import spec §8.1). After the listing:

- `items = list.rows.map(row => ({ key: row.id, query: buildMatchQuery({ facilityAddress: row.street, facilityCity: row.city, facilityZip: row.zip ?? "", taxParcelNumber: row.apnHint ?? "" }), excludeWorkizJobIds: [row.uuid, row.id].filter(Boolean) }))`.
- `findPossibleDuplicatesBatch(items, { userId, privileged: role === "admin" }, { limit: 3 })` runs inside the existing `Promise.all`, in **its own** try/catch. On failure it calls `logDbError("jobs_match_lookup", err)` (the `[workiz-import]` prefix), sets `matchCheckFailed: true` and gives every row no matches. The rest of the response is built as today.
- A row gets `possibleMatches: InspectionMatchResult` only when `matches.length + hiddenCount > 0`. Otherwise the key is absent.
- `existing` is unchanged and still decides **Import** / **Open existing**.

The match result is computed per request and is **never** stored in the 60 s Workiz cache. A report saved a second ago shows on the next picker open, and the cache holds no inspection data. Only `zip` and `apnHint` join the cached summaries. Both are derived from the same job object the summary already reads, so caching them costs no extra Workiz call.

`privileged` is `role === "admin"` here because the picker admits only `admin` and `field_tech`. That is the same rule as `existingFor` in this route.

### 6.3 Wire types (`src/types/inspection-matches.ts`)

```ts
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
  /** In-app route for THIS viewer (inspectionPath) */
  href: string;
  status: string;
  facilityAddress: string;          // "" when null
  facilityCity: string;             // "" when null
  /** formData.facilityInfo.dateOfInspection when it is YYYY-MM-DD, else null */
  inspectionDate: string | null;
  createdAt: string;                // ISO
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

`src/types/workiz-import.ts`: `WorkizJobRow.possibleMatches?: InspectionMatchResult`; `WorkizJobsResponse.matchCheckFailed?: true`.

### 6.4 Server functions

```ts
// normalize.ts (pure)
export interface MatchQuery { address: AddressKey | null; zip5: string | null; city: string | null; apnKey: string | null }
export function buildMatchQuery(input: InspectionMatchRequest): MatchQuery | null;   // null when address and apnKey are both null
export function matchQueryKey(query: MatchQuery | null): string;                     // stable JSON, "" for null

// store.ts (server-only)
export interface MatchCandidateRow {
  id: string; inspectorId: string; status: string;
  facilityAddress: string | null; facilityCity: string | null; facilityZip: string | null;
  apn: string | null; taxParcelNumber: string | null; inspectionDate: string | null;
  createdAt: Date; workizJobId: string | null; inspectorName: string | null;
}
export async function findMatchCandidates(args: {
  houseNumbers: string[]; apnKeys: string[]; excludeInspectionId?: string; limit: number;
}): Promise<{ rows: MatchCandidateRow[]; capHit: boolean }>;   // queries LIMIT limit+1; rows.length <= limit

// match.ts (pure)
export interface MatchViewer { userId: string; privileged: boolean }
export function matchReasons(query: MatchQuery, row: MatchCandidateRow): MatchReason[];
export function storedApnKey(row: MatchCandidateRow): string | null;   // form key ?? column key (§5.1)
export function localityCompatible(query: MatchQuery, row: MatchCandidateRow): boolean;   // §5.3 locality rule
export function matchHref(row: MatchCandidateRow, viewer: MatchViewer): string;
//   draft && row.inspectorId !== viewer.userId → `/review/${row.id}` (§2.1 deviation); else inspectionPath(...)
export function buildMatchResult(query: MatchQuery, rows: MatchCandidateRow[], viewer: MatchViewer,
  opts: { limit: number; candidateCapHit: boolean; excludeWorkizJobIds?: string[] }): InspectionMatchResult;

// find.ts (server)
export async function findPossibleDuplicates(query: MatchQuery, viewer: MatchViewer,
  opts: { excludeInspectionId: string; limit?: number }): Promise<InspectionMatchResult>;          // limit default 5
export async function findPossibleDuplicatesBatch(
  items: Array<{ key: string; query: MatchQuery | null; excludeWorkizJobIds: string[] }>,
  viewer: MatchViewer, opts: { limit?: number }): Promise<Map<string, InspectionMatchResult>>;   // ONE query for all items

// src/lib/inspection-path.ts
export function inspectionPath(id: string, status: string, privileged: boolean): string;   // handleRowClick routing, unchanged
```

`matchHref` is the only place the draft deviation lives; `inspectionPath` and the picker's `inspectionHref` keep exactly today's outputs. A non-owned visible row always means a privileged viewer (field techs only see their own rows), so `/review/{id}` is always reachable for it.

`canOpen(row) = row.inspectorId === viewer.userId || viewer.privileged`. This is `checkInspectionAccess` exactly, since privileged means admin or office staff in the wizard route and admin in the picker route (which admits no office staff).

## 7. Query and data access

### 7.1 The single SELECT (`store.ts`, Drizzle query builder, all values parameterised)

The query is built with **`db.select({...})`**, not `db.execute(sql…)`: the typed columns (`inspections.id`, `inspections.inspectorId`, `inspections.status`, `inspections.facilityAddress`, `inspections.facilityCity`, `inspections.facilityZip`, `inspections.apn`, `inspections.createdAt`, `inspections.workizJobId`, `profiles.fullName`) map to the camelCase `MatchCandidateRow` keys, and the two jsonb extractions are `sql<string | null>\`…\`` fields (`taxParcelNumber`, `inspectionDate`). This matters for `createdAt`: the drizzle postgres-js driver installs a transparent parser for timestamp OIDs (`node_modules/drizzle-orm/postgres-js/driver.js`), so a raw `db.execute` row would carry snake_case keys and a timestamp **string**; only the `timestamp("created_at")` column mapper turns it into a `Date` (as UTC). The `where` uses `ne(inspections.id, exclude)`, `or(...)` and `inArray(sql\`…\`, values)`, `orderBy(desc(inspections.createdAt))`, `.limit(limit + 1)`. The SQL it renders is equivalent to:

```sql
SELECT i.id, i.inspector_id, i.status, i.facility_address, i.facility_city, i.facility_zip, i.apn,
       i.form_data -> 'facilityInfo' ->> 'taxParcelNumber'  AS tax_parcel_number,
       i.form_data -> 'facilityInfo' ->> 'dateOfInspection' AS inspection_date,
       i.created_at, i.workiz_job_id, p.full_name           AS inspector_name
FROM inspections i
LEFT JOIN profiles p ON p.id = i.inspector_id
WHERE i.id <> $exclude                                                         -- wizard only
  AND (
        substring(i.facility_address from '^[[:space:]]*([0-9]{1,8})[[:space:]]') IN ($n1, …)    -- if houseNumbers non-empty
     OR upper(regexp_replace(coalesce(i.apn, ''), '[^0-9A-Za-z]', '', 'g')) IN ($k1, …)           -- if apnKeys non-empty
     OR upper(regexp_replace(coalesce(i.form_data -> 'facilityInfo' ->> 'taxParcelNumber', ''),
                             '[^0-9A-Za-z]', '', 'g')) IN ($k1, …)                                 -- if apnKeys non-empty
      )
ORDER BY i.created_at DESC
LIMIT $limit_plus_1
```

- A branch is added only when its list is non-empty, and the function returns `{ rows: [], capHit: false }` without querying when both lists are empty. Drizzle's handling of an empty `inArray` never comes into play.
- The house-number prefilter is a **superset** filter: the authoritative decision is `matchReasons` in JS (`addressKey`, built on `parseStreetAddress`). The prefilter cannot be stricter than the JS check: `parseStreetAddress` also needs `^\d{1,8} ` after collapsing whitespace, and the `^[[:space:]]*` anchor accepts leading spaces, tabs and newlines (unlike `btrim`, which strips only spaces).
- The APN branches are also a superset: both stored APNs are offered to SQL, and the JS rule then applies the form-first fallback of §5.1 and the length cap of §5.2. Replicating the "form key usable" test in SQL is not worth it for a prefilter.
- Only the extracted fields are selected, never the whole `form_data`, so the payload stays small and no PII beyond the displayed fields leaves the database.
- `store.ts` starts with `import "server-only"` (already a dependency; vitest aliases it to a stub).

### 7.2 Performance

Measured read-only on production, 2026-10-13: `inspections` had **132** rows at the first count (7 draft, 1 in_review, 124 completed) and 133 an hour later, at 80 kB heap / 928 kB with TOAST. The population figures in §5.1 are from the 132-row count. Rows were created 2026-03-03 → 2026-10-13, about 19 per month. Indexes: the primary key and the unique `workiz_job_id` only. `EXPLAIN (ANALYZE, BUFFERS)` of the query above (two house numbers, one APN key): **Seq Scan, 3.3 ms execution, 318 shared-buffer hits**, including de-TOASTing `form_data` for the APN expression.

**Decision: no index and no migration.** Every row is scanned and every row de-TOASTs `form_data` (about 7 kB per row) for the jsonb APN expression, so the cost grows roughly linearly. At the current growth rate the table reaches about 1,000 rows in 3–4 years, where linear scaling of 3.3 ms gives roughly **25 ms** per check: still fine for a debounced, informational request. An index would need expression indexes on the house-number expression and on the jsonb APN expression, plus a remote migration to apply and verify, for no measurable gain today. **Revisit at about 2,000–5,000 rows** (roughly 50–125 ms per check). The fix then is either two expression indexes on exactly the expressions above (written here so a future index matches them character for character), or, better, syncing the `apn` column from the form on PATCH so the jsonb branch can be dropped and a plain column index used.

Call volume:
- Wizard: one request on Step 1 mount, then at most one per 700 ms of edits, and **only** when the normalised key changes. Typing in other fields, autosave and suffix-only edits (`Rd` → `Road`) change nothing. A new request aborts the previous one.
- Picker: exactly one extra SELECT per `GET /api/workiz/jobs`, for all rows together (no N+1). It runs in parallel with the existing lookups. The only exception is the batch-overflow fallback (§5.4), unreachable at today's volume.

### 7.3 Workiz summary additions (`adeq.ts`)

`toJobSummary` adds:
- `zip: formatWorkizZip(address.zipCode)`, the existing helper (5 digits or `null`).
- `apnHint: findApnHint(job).hint?.apn ?? null`, the existing helper (custom field, else the newest permit-bot note; already `formatApn`-formatted).

**Import cycle.** `apn-hint.ts` imports `WORKIZ_CF` from `./adeq` today, so `adeq.ts` importing `findApnHint` from `./apn-hint` would create a cycle that works only because `WORKIZ_CF` happens to be read inside a function. To avoid it, `WORKIZ_CF` moves to the leaf module `src/lib/workiz/custom-field-ids.ts` (§1 item 5a): `apn-hint.ts` imports it from there, and `adeq.ts` re-exports it for its existing importers (`map-job.ts`, tests). The dependency graph is then `custom-field-ids ← apn-hint ← adeq`, with no cycle. `toJobSummary` stays the single summary builder (it is also what `listImportableAdeqJobs` caches).

These stay server-side. `WorkizJobRow` (the wire row) does not gain them, and the browser only sees the match result.

## 8. Authorization and no-leak rules

| Viewer | Wizard route | Picker |
|---|---|---|
| Not signed in | 401 | 401 (unchanged) |
| Signed in, cannot view inspection `[id]` | 403 (404 if missing) | — |
| `admin` | full details + links for every match | full details + links |
| `office_staff` | full details + links (review editor) | 403 (unchanged; picker is admin/field_tech only) |
| `field_tech` / no role, own matches | full details + links (`isOwn: true`, inspector `you`) | full details + links |
| `field_tech` / no role, someone else's match | **`hiddenCount` only** | **`hiddenCount` only** |

- A hidden match contributes **nothing but a count**: no id, href, status, address, city, date, inspector, reason or `workiz_job_id`. Since reasons are not returned for hidden matches, the viewer learns only that some report shares a value they typed themselves.
- `buildMatchResult` is the single place that splits visible from hidden, so the rule is tested once and holds for both routes.
- The wizard route requires view access to `[id]`. A field tech can only run checks from their own inspections, and the check never returns that inspection itself.
- **Accepted residual risk:** any signed-in field tech can learn *whether* some inspection exists for an address or APN they type (an existence oracle). The orchestrator accepted this default. The app is internal (13 staff accounts), and the warning exists precisely to tell people a report may already exist. There is no rate limiter, matching the other internal routes.
- Links only point to pages whose own guards already allow the viewer (edit page: owner/privileged; `/review`: privileged; `/inspections/{id}`: owner). The notice grants no access.
- New-tab links use `rel="noopener noreferrer"`.

## 9. Components

### 9.1 `<PossibleDuplicateNotice>` (presentational)

```ts
export function PossibleDuplicateNotice(props: {
  result: InspectionMatchResult;
  variant?: "default" | "compact";   // compact = picker row
}): JSX.Element | null               // null when matches.length + hiddenCount === 0
```

- Box styles copy the existing cesspool notice in `step-facility-info.tsx`: `rounded-md border border-amber-300 bg-amber-50 dark:border-amber-700/60 dark:bg-amber-950/30`, `AlertTriangle` in `text-amber-600 dark:text-amber-400`, and text in `text-amber-900 dark:text-amber-200` / `text-amber-800/90 dark:text-amber-300/90`. Default: `px-3 py-2 text-sm`; compact: `px-2 py-1.5 text-xs`.
- `data-slot="possible-duplicate-warning"`.
- Links: `<a href={match.href} target="_blank" rel="noopener noreferrer">` plus a `lucide-react` `ExternalLink` icon (`aria-hidden`) and `<span className="sr-only">(opens in a new tab)</span>`. A plain `<a>`, not `next/link`: a new-tab navigation gains nothing from client routing, and it avoids `next/link`'s prefetch GET of other inspections' pages.
- Exactly one visible match and `hiddenCount === 0`: the header **and** the detail line sit inside one anchor, so a click anywhere on the box opens the match. Otherwise the header is plain text and the list is a `<ul role="list">` of anchors. Its hidden line and "more" line are `<li>` with no anchor.
- All values render as React text. There is no `dangerouslySetInnerHTML`.
- Helpers from `src/lib/inspection-matches/format.ts`: `headerNoun(reasons)`, `reasonLabel(reasons)`, and `formatMatchWhen(match)` (`Inspected …` / `Created …`).

### 9.2 `<PossibleDuplicateWarning>` (wizard container)

```ts
export function PossibleDuplicateWarning(props: { inspectionId: string }): JSX.Element
```

- `useWatch` on `facilityInfo.facilityAddress`, `.facilityCity`, `.facilityZip`, `.taxParcelNumber` (inside the form context the step already has).
- `query = useMemo(() => buildMatchQuery(values))`; `key = matchQueryKey(query)`.
- Effect on `key`:
  - **Any** key change first clears the result (`null`) at once, so a notice for the old values never stays on screen while the new check is pending (§2.1). A re-render with the same key does nothing.
  - `""` → result stays `null`, abort any request, no fetch.
  - First non-empty key after mount → fetch immediately.
  - Later key changes → 700 ms debounce (`MATCH_DEBOUNCE_MS`).
  - Each fetch uses a fresh `AbortController` and aborts the previous one; unmounting aborts too.
  - A response whose key is no longer current is ignored.
- Fetch: `POST /api/inspections/${inspectionId}/matches` with the **trimmed raw** values, each sliced to `MATCH_FIELD_BODY_MAX` (1,000) characters so the body never fails the route's schema (the server normalises again and ignores an unusable field without dropping the others, §6.1; the client key only dedupes requests).
- `200` → parse the body and store it **only** when it has the expected shape: `Array.isArray(body.matches) && typeof body.hiddenCount === "number"` (and `truncated` coerced with `body.truncated === true`). Any other body, any other status, a JSON parse error, `AbortError` or a network error → result `null` (renders nothing). Nothing is logged in the browser. The shape check matters because existing test harnesses stub `fetch` with replies such as `{ ok: true, json: async () => ({}) }` (`review-editor.test.tsx`, `review-editor-autosave.test.tsx`), and a `{}` body stored as a result would make `result.matches.length` throw during render.
- Render, as a fragment of two siblings:
  - `<div className="sm:col-span-2 empty:hidden">{result && <PossibleDuplicateNotice result={result} />}</div>`: the visual box, **not** a live region. `empty:hidden` avoids an empty grid row when there is nothing to show.
  - `<span className="sr-only" aria-live="polite" data-slot="possible-duplicate-announcement">{announcement}</span>`: always rendered (never `display:none`, so it stays in the accessibility tree before any result arrives). `announcement` is `MATCH_ANNOUNCEMENT` when the result has at least one match (visible or hidden), otherwise `""`. Text inserted into a region that only becomes visible in the same update is often not announced by VoiceOver/NVDA, so the live region must exist first. `sr-only` is absolutely positioned, so it takes no grid track.
- It works the same when the step is read-only (review page, completed/sent).

### 9.3 `step-facility-info.tsx`

Insert `<PossibleDuplicateWarning inspectionId={inspectionId} />` as a grid child right after the Address `FormField` and before City. It is not placed inside a `FormItem`, so the provenance chips and the `FormItem` layout are untouched. A new blank draft has empty fields, so the component never fetches until a house-number address or a usable APN appears.

### 9.4 `workiz-import-picker.tsx`

- Under the team line of each row: `{job.possibleMatches && <PossibleDuplicateNotice result={job.possibleMatches} variant="compact" />}`.
- `panel.data.matchCheckFailed` → one muted line `MATCH_CHECK_FAILED` above the list, next to the existing `truncated` line.
- `inspectionHref(id, status, role)` becomes `inspectionPath(id, status, role === "admin")`, with the same outputs as today.
- The import, the busy state and the Open existing behaviour are unchanged. A match link is an anchor that opens in a new tab, so it is never disabled by `locked` and never navigates the picker page.

## 10. Error handling and logging

| Failure | Result |
|---|---|
| Match route: DB error | 500 fixed message. `[inspection-matches] db error scope=match_lookup job=- code=<SQLSTATE> constraint=-` only. The Drizzle error message holds the query params (the typed address and APN), so the error object, its `message`, `query` and `params` are never logged |
| Match route: malformed id / bad body | 404 / 400, input not echoed |
| Match route: one field too long or unusable | that field gives a `null` key; the others are still checked (200) |
| Wizard: any non-200, a 200 with an unexpected body, or a network error | renders nothing; retried on the next key change or Step 1 remount |
| Wizard: user types fast | debounce + abort; stale responses ignored |
| Picker: match lookup throws | jobs still listed, `matchCheckFailed: true`, the muted line shows, and `[workiz-import] db error scope=jobs_match_lookup …` is logged |
| Picker: Workiz listing fails | unchanged (Workiz import spec §11); the match lookup never runs |
| Matched report deleted between check and click | the target page's existing redirect (`/inspections` or `/review`) |
| Viewer's role changes mid-session | the next check uses the new JWT claim; links were only ever to pages the old role could open, and those pages re-check on load |

## 11. Security summary

- AuthN/AuthZ as in §8, reusing `requireInspectionAccess` / `checkInspectionAccess` and `requireWorkizImporter` without changing them.
- Input: zod strict body with a 1,000-character cap per field (unusable values are ignored per field, not rejected, §6.1). House numbers (`^\d{1,8}$`) and APN keys (`[0-9A-Z]{6,20}`) are the only values that reach SQL, always as bound parameters through Drizzle. No string interpolation into SQL.
- No PII in URLs (POST body), logs (§10) or caches (the Workiz cache gains only a ZIP and a formatted APN hint, both property identifiers already implied by the cached street).
- Responses carry fixed error messages only (unlike the older inspection routes, which return `err.message` in 500s; that pattern is not copied).
- No new secrets, env vars or third-party calls.

## 12. Testing

vitest throughout, mocking `@/lib/db`, `@/lib/supabase/server` and `@/lib/supabase/auth-helpers` the way the existing route tests do. Fixtures are **synthetic only** (`100 E Example Rd`, `123-45-678`, `Sam Sample`, `example.com`). No production values go into the repo.

| File | Covers |
|---|---|
| `src/lib/prefill/__tests__/address-key.test.ts` | `addressKey` for every §5.5 address row, plus: no house number → null; `E.`/`East` → `E`; `Road`/`Rd` → suffix `RD`; a single-word street keeps its word and has no suffix (`100 Broadway`); `Space 12`, `#12`, `Unit 4`, `Lot 7` units; `Lot Rd` is a street, not a unit; **unit canonicalisation**: `#Space 12`, `Space 12`, `#12` → `12` and `#Lot 7`, `Lot 7` → `7`; **comma cut**: `100 E Example Rd, Cave Creek, AZ 85331` gives the same key as `100 E Example Rd`, and `100 E Example Rd, #12` / `100 E Example Rd, Unit 4` keep units `12` / `4`; **direction-word streets**: `100 W North Ln` vs `100 W South Ln`, `100 N East St` vs `100 N West St`, `100 N West Valley Rd` vs `100 N Valley Rd`, and `100 North Ln` vs `100 South Ln` all give different keys, `100 E South Mountain Ave` → street `SOUTH MOUNTAIN`; `SUFFIX_CANONICAL` keys equal `STREET_SUFFIXES`; `addressKeysCompatible` truth table (dir/suffix/unit equal, missing, different) |
| `src/lib/prefill/__tests__/secondary.test.ts` (unchanged) | still passes after `splitUnit` moves (regression) |
| `src/lib/inspection-matches/__tests__/normalize.test.ts` | `apnMatchKey` (dashed/compact/spaced/lowercase letter → the same key; `N/A`, `TBD`, `0`, `00000000`, 21 characters → null; a 23-character `123-45-678 & 123-45-679` → null); `buildMatchQuery` with a 25-character APN and a valid address → `apnKey` null, `address` non-null; a city over 60 characters → `city` null; `zip5` (`85331`, `85331-1234`, `853311234` → `85331`; `8533`, `ABCDE`, `""` → null); `cityKey`; `buildMatchQuery` null cases (example 17) and mixed cases; `matchQueryKey` stable across key order and equal for `Rd`/`Road` |
| `src/lib/inspection-matches/__tests__/match.test.ts` | every §5.5 row through `matchReasons`; column-APN fallback only when the form APN key is null (form `B` + column `A`, input `A` → no `apn` match; form empty or `N/A` + column `A`, input `A` → match); locality truth table (ZIPs equal; ZIPs differ with equal / different / missing cities; one ZIP missing with equal / different / missing cities); reasons order; `matchHref`: own draft → `/inspections/{id}/edit`, another's draft for a privileged viewer → `/review/{id}`, non-draft → `inspectionPath` output; ranking (both → apn → address, then `createdAt` desc); limit and `truncated` (more visible than the limit; candidate cap hit); `hiddenCount` counts all hidden; **no-leak**: for a non-owner field-tech viewer the serialised result contains none of the hidden row's id, address, city, inspector name or date strings; owner gets `isOwn: true`; privileged viewer sees everything; `href` via `inspectionPath` for draft/submitted × privileged/not; `excludeWorkizJobIds` skips only that job's own import; an invalid `inspectionDate` (`10/06/2026`) → null |
| `src/lib/inspection-matches/__tests__/store.test.ts` | with a real Drizzle instance over an unconnected `postgres()` client, `.toSQL()` of the `db.select` builder contains the three expressions of §7.1 (including the `^[[:space:]]*` anchor), the `<>` exclusion, `ORDER BY … DESC` and `LIMIT` with `limit + 1` in `params`, with all values in `params` and none inline; the APN branches are left out when `apnKeys` is empty and the address branch when `houseNumbers` is empty; both empty → `{ rows: [], capHit: false }` with no query; with a mocked executor, `limit + 1` returned rows → `capHit: true` and `limit` rows, exactly `limit` rows → `capHit: false`; a `createdAt` from the column mapper is a `Date` |
| `src/lib/inspection-matches/__tests__/find.test.ts` | `findPossibleDuplicates` passes `excludeInspectionId` and caps; `findPossibleDuplicatesBatch` makes **one** store call for N items (union of house numbers and APN keys), splits the rows per item, applies the per-item `excludeWorkizJobIds`, and gives items with a `null` query an empty result; **batch overflow**: when the batch store call reports `capHit`, it makes one store call per item with a query and each item's `truncated` comes from its own call (an item whose own call is not capped is not `truncated`) |
| `src/lib/__tests__/inspection-path.test.ts` | draft → edit for anyone; non-draft → `/review` when privileged, `/inspections/{id}` otherwise |
| `src/lib/workiz/__tests__/log-db-error.test.ts` (+) | the default prefix is unchanged; a custom prefix is used; still no PII from `message`/`params` |
| `src/app/api/inspections/[id]/matches/__tests__/route.test.ts` | non-UUID id → 404 with no DB call; 401; 404 missing; 403 field tech on another's inspection; 400 bad JSON / unknown key / non-string / a field over 1,000 characters (no echo); **a 25-character APN plus a valid address → 200 with the address matches** (the store receives the house number and no APN key); empty query → 200 empty with no store call; **self is excluded** (`excludeInspectionId === id` reaches the store); admin and office staff get full details; field tech gets `hiddenCount` for another inspector's match and full details for their own; the body never contains a hidden row's id/address (string search on the JSON); DB error with a `DrizzleQueryError`-shaped error whose params hold the fixture address → 500 fixed message, and no `console.*` argument contains the address or APN; `Cache-Control: no-store` |
| `src/app/api/workiz/jobs/__tests__/route.test.ts` (+) | mocks `@/lib/inspection-matches/find`. The existing cases keep their exact bodies (no `possibleMatches`, no `matchCheckFailed` when the batch returns empty results). New cases: a row with matches carries `possibleMatches`; one batch call per request with the expected items (street + `#unit`, city, zip, apnHint, both Workiz ids excluded); field tech sees `hiddenCount` only; batch throws → 200 with the jobs, `matchCheckFailed: true`, and only the fixed `[workiz-import]` log line; `refresh=1` still works and matches are recomputed per request (not cached) |
| `src/lib/workiz/__tests__/adeq.test.ts` (+) | `toJobSummary` includes `zip` (5 digits / null for ZIP+4 → first 5, invalid → null) and `apnHint` (custom field, note, none). The existing `toEqual` for the unit fixture gains the two fields. `WORKIZ_CF` imported from `./adeq` and from `./custom-field-ids` is the same object |
| `src/components/inspection/__tests__/possible-duplicate-warning.test.tsx` | Notice: single visible match → exactly one anchor, `target="_blank"`, `rel="noopener noreferrer"`, `href` from the result, accessible name includes the header and "(opens in a new tab)", detail text (address, "Completed", "Inspected Oct 6, 2026", inspector, "Same APN and address"); `Created …` fallback in America/Phoenix (a UTC-midnight `createdAt` shows the previous Phoenix day); multiple → header not a link and one anchor per item; hidden-only → **no anchor**, exact hidden copy, no address text; mixed → hidden tail line; `truncated` → the "more" line; empty → renders nothing; compact variant copy. Container (fake timers, mocked `fetch`): no fetch for an empty draft; a fetch on mount when values exist; debounced refetch on address change; no refetch for `Rd` → `Road`; an APN set via `form.setValue` (as APN Lookup does) triggers a check; a stale response is ignored after a newer key; **after a key change and before the new response, the old links are gone** (fake timers: change the house number, assert no anchor before advancing past the debounce); abort on unmount; 500 and network error render nothing; **a 200 with body `{}` renders nothing and does not throw**; a value over 1,000 characters is sliced before sending; the `aria-live` element exists and is not `display:none` before any result arrives, and holds `MATCH_ANNOUNCEMENT` once a match arrives; still renders inside a disabled `<fieldset>` and the link stays clickable |
| `src/components/inspection/__tests__/step-facility-info-provenance.test.tsx` and `step-read-only.test.tsx` (unchanged) | still pass: default values are empty, so the warning never fetches. If a harness seeds an address, the container's shape check turns any stub reply that is not a well-formed `InspectionMatchResult` into "render nothing": `{ ok: false }` (non-200), `{ ok: true, text }` with no `json` (parse error), and `{ ok: true, json: async () => ({}) }` or `[]` (wrong shape) |
| `src/components/review/__tests__/review-editor.test.tsx`, `review-editor-autosave.test.tsx` (unchanged) | still pass; their `fetch` stub returns a 200 with `{}`, which the shape check ignores. Today they seed only the top-level `facilityAddress`, not `facilityInfo.facilityAddress`, so the warning does not fetch at all; the shape check keeps them safe if that changes |
| `src/components/inspection/__tests__/workiz-import-picker.test.tsx` (+) | a row with `possibleMatches` renders the compact notice with new-tab anchors; hidden-only row has no anchor; **Import** stays enabled next to a notice; clicking a match link does not call `router.push`; `matchCheckFailed` shows the muted line; rows without `possibleMatches` are unchanged; `inspectionHref` outputs unchanged |

**Live smoke (read-only):** `scripts/duplicate-match-smoke.mts`, run with `"smoke:matches": "NODE_OPTIONS=--conditions=react-server tsx --env-file=.env.local scripts/duplicate-match-smoke.mts"`. For every inspection it builds the query from the row's own saved values and runs the real `findPossibleDuplicates` as an admin viewer. It then runs one `findPossibleDuplicatesBatch` with all rows. It also counts `rejectedByLocalityOnly`: candidate pairs that pass every address rule except locality, computed by calling `findMatchCandidates` for each row and applying `addressKeysCompatible` and `localityCompatible` to the candidates directly. It prints only counts (rows, rows with matches, pairs by reason, max matches per row, `rejectedByLocalityOnly`, total ms, batch ms) and **never** addresses, APNs, names or ids. Reference point (§5.6, earlier rule set): 133 rows, 17 with matches, max 2. The revised rules can move these in either direction, so the first run's numbers are recorded in §16 decision 3 as the new baseline. After that, a large deviation in the ratio means a rule or SQL regression. The `rejectedByLocalityOnly` count is recorded next to the baseline; if it is a meaningful share of the address candidates, the locality rule is revisited with the owner.

**Verification before merge:** `npx vitest run` (exactly the 12 known baseline failures, no new ones); `npx tsc --noEmit` (no new errors outside the known old test files); `npx biome lint <changed files>` (no `--write`; the repo is not Biome-formatted); the build command with placeholder `NEXT_PUBLIC_*` env vars; `npm run smoke:matches`.

**End-to-end** on a preview deployment, driven through the Playwright MCP browser, signed in as an admin test account:
1. Create a blank inspection and type the address of an existing completed report (pick one from the dashboard). After about 1 s the notice appears under Address. Click it, and a new tab opens `/review/{id}` for that report while the wizard tab stays put.
2. Change the house number: the notice disappears. Restore it, then enter the report's APN instead of the address: the notice shows "APN".
3. Open the Workiz picker: rows render; any row whose address has a report shows the compact notice; its link opens in a new tab.
4. Sign in as a field-tech test account, repeat step 1 against a report owned by another account: only "May match a report by another inspector" shows, with no link, and the network response holds only `hiddenCount`.

**Cleanup:** delete the blank test inspections with the existing delete action as admin (they have no stored files). Confirm with one read-only count that they are gone.

## 13. Rollout

1. No env vars, no dependency, no migration.
2. Deploy to preview → smoke + e2e + cleanup (§12) → merge (push to main deploys production, per the repo's existing flow).
3. **Rollback:** revert the feature commits. Nothing is stored, so no data needs cleaning. The `splitUnit` move, the `STREET_SUFFIXES` export, the `WORKIZ_CF` move to `custom-field-ids.ts`, the `inspectionPath` extraction and the `logDbError` prefix can stay or go; none changes behaviour.

## 14. Out of scope

- Dashboard/list badges for possible duplicates, a "duplicates" filter, or a duplicates report.
- Merging, linking ("re-inspection of …") or marking a match as "not a duplicate".
- Dismissing the notice (§2.1).
- Fuzzy street names (`Seventh` vs `7th`, `Saint` vs `St`), typo tolerance, geocoding or parcel-polygon overlap.
- Matching on owner/seller name, customer email or Workiz job id beyond excluding the job's own import.
- Syncing the `inspections.apn` column from the form on PATCH (it stays written once by the run or the webhook; §5.1 uses it only when the form APN is unusable, and §7.2 names this sync as the scaling fix).
- Splitting a multi-parcel APN field (`123-45-678 & 123-45-679`) into several keys. Such a value gives no APN key on either side (§5.2); the address still checks.
- Checks in the Jobs module, the webhook or `POST /api/workiz/import` (the import still never blocks; the imported draft shows the notice in the wizard).
- Rate limiting the match route.
- Fixing the existing autosave-on-open race in the edit page itself (opening a draft there mounts the wizard, whose first autosave tick re-saves the loaded values). This feature avoids feeding it: match links send a non-owned draft to `/review/{id}` instead (§2.1), and only the viewer's own drafts open in `/edit`.

## 15. Open risks

- **Re-inspections look like duplicates.** On today's data, 17 of 133 reports (13%) would show the notice, nearly all genuine repeat reports at the same property. That is the intended signal, but inspectors will see it often on repeat customers. The copy says "may match" for that reason.
- **Field techs mostly see the non-linked line.** All 133 existing reports belong to one account, so for any field tech every match is "by another inspector". That is the correct access rule, but the notice will rarely be clickable for field techs until they own reports.
- **Locality-unknown matches are loose.** An address typed without ZIP or city matches the same street and number in any city until a ZIP or city is entered. This is bounded by the data: at most 3 rows share a house number today.
- **Equal city overrides a ZIP mismatch.** Two different properties with the same number, street and city but different ZIPs would match. In the Phoenix-area grid a house number on a given street is unique within a city, so this is far more often the same parcel with a customer-vs-situs ZIP difference; the smoke's `rejectedByLocalityOnly` and match counts show how often it fires.
- **Unit canonicalisation is a prefix strip.** A unit literally named like `SPACEX` would compare as `X`. No such unit is known; accepted.
- **Suffix-less input is loose.** `1234 N 7th` matches both `7th St` and `7th Ave` in the same ZIP until a suffix is typed. Accepted, since it is a "may match" notice.
- **APN hint from Workiz notes can be low-confidence.** A picker match whose reason is `apn` may come from a "Confidence low" bot note. The address reason, when present, corroborates it. The notice never acts on the hint.
- **Non-ASCII whitespace** in a stored address could make the SQL prefilter miss a row the JS rule would match (Postgres `[[:space:]]` vs the JS ASCII clean-up). No such row exists today; the smoke counts would reveal a drift.

## 16. Decisions (orchestrator defaults; owner may override)

1. **Scope of matching:** every inspection in every status, excluding the current one (and, in the picker, the job's own import). Default applied.
2. **APN source:** the form `taxParcelNumber` (authoritative, 127/132 populated); the `apn` column (14/132) only when the stored form APN key is null. Compared by compact alphanumeric key (raw value ≤ 20 characters), not Maricopa-only formatting. Default applied, narrowed after review so a stale write-once column value cannot cause a permanent false match.
3. **Address rule:** house number + street words (comma cut, `splitUnit` with unit canonicalisation, `parseStreetAddress`, own street-word step instead of `normalizeStreetName`, §5.2), plus direction/suffix/unit compatibility, plus locality: equal ZIPs; or different ZIPs with equal cities; or, when a ZIP is missing, equal cities when both are present. Default applied, plus suffix comparison (justified in §5.2) and the equal-city exception (§5.3). The first `npm run smoke:matches` run on the shipped code (§12) is recorded here as the baseline, replacing the earlier-rule figures of §5.6.
4. **Not dismissable**, compact, purely informational. Default applied.
5. **Surfaces:** wizard Step 1 for all drafts, the review editor (free via the shared step) and every Workiz picker row. The field-tech PDF view and the dashboards are excluded. Default applied.
6. **Picker design:** server-side batch in `GET /api/workiz/jobs` (one query, per request, never cached), not lazy per-row calls from the browser. That design costs one SELECT instead of N requests, keeps the 60 s Workiz cache free of inspection data, and keeps the no-leak rule in one server function.
7. **Field techs** get a count-only, non-linked line for other inspectors' matches; admin and office staff get full details and links. Default applied; the existence-oracle risk is accepted (§8).
8. **No index, no migration** (3.3 ms seq scan at 133 rows, roughly 25 ms at 1,000; revisit at about 2,000–5,000 rows, §7.2).
9. **Draft match links:** the viewer's own draft opens `/edit`; another inspector's draft opens `/review/{id}` so opening it never writes (§2.1).
