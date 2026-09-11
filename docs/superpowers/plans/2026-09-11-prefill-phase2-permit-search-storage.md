# Property Records Prefill — Phase 2: Permit Search & Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `permits` prefill stage real — search both Maricopa ESD EDMS archives by APN (street-number fallback with scoring), download every matching permit PDF into private Supabase Storage as `inspection_records` rows, expose them through an auth-gated signed-URL route, and render permit rows / candidate picker / not-found copy / abandonment banner in the Prefill sources tile. No AI in this phase: every stored record gets `extraction_status = "pending"` (or `skipped`/`failed`).

**Architecture:** A dependency-free EDMS client (`fetch` + `AbortSignal.timeout`, one retry on network errors) parses OnBase "KeywordSearch" responses by `DisplayColumns` heading. A pure search module turns rows into `PermitCandidate`s, dedupes across archives, and applies the spec §5.2 scoring/grouping to decide `found` / `ambiguous` / `not_found`. `fetch-document.ts` takes an ephemeral document ID (never persisted), size-checks it with the POST metadata call, buffers the PDF (≤ 25 MB), uploads it to `inspection-media/records/{inspectionId}/{recordId}.pdf`, counts pages with pdf-lib, and inserts the `inspection_records` row. `permits/index.ts` orchestrates search → rank → store and replaces the phase-1 stub; the phase-1 orchestrator learns to park a run in `awaiting_selection`, and `continuePrefillAfterSelection` (reached through phase 1's already-real `/select` route) re-runs the same search and matches candidates by `key`.

**Tech Stack:** Next.js 16.1 App Router (route handlers, `after()` from `next/server`), TypeScript, Drizzle ORM over `postgres`, Supabase Storage via `createAdminClient()`, `pdf-lib`, Vitest 4 (+ jsdom / @testing-library/react for the component), `tsx` for the live smoke script.

## Global Constraints

- Branch: `feature/property-records-prefill`. Each phase is a PR from it; **never push `main`** — production deploys only with Daniel's explicit per-deploy approval.
- Consume phase-1 names verbatim from `docs/superpowers/plans/2026-09-11-prefill-shared-contracts.md`: `src/lib/prefill/types.ts` (`PrefillInput`, `PrefillAddress`, `PermitCandidate`, `PermitArchive`, `ExtractionStatus`, `InspectionRecordDTO`, `PrefillRunDTO`, `PrefillStage`, `StageStatus`, `ProposedField`, `MAX_DOCUMENTS_PER_RUN = 3`, `MAX_DOCUMENT_BYTES = 25 * 1024 * 1024`), `src/lib/db/schema.ts` (`inspectionPrefillRuns`, `inspectionRecords`), `StageContext` / `StageResult` from `src/lib/prefill/stage.ts`, `loadRunRow` / `updateRun` / `InspectionRecordRow` from `src/lib/prefill/run-store.ts`, `toInspectionRecordDTO` from `src/lib/prefill/run-dto.ts`, `normalizeStreetName` from `src/lib/prefill/input.ts`, and the route table. Phase 1's plan is `docs/superpowers/plans/2026-09-11-prefill-phase1-provenance-foundation.md` — read its Tasks 5, 8, 12 and 14 before Tasks 8, 10 and 11 here. Do not re-define any of them.
- `PermitCandidate.key` format is exactly `` `${archive}:${permitNumber}:${docType}:${docDate ?? ""}` ``.
- EDMS endpoints (spec §5.2, verified live 2026-09-11): legacy `env` base `https://edms.maricopa.gov/env/api`, `QueryID 229`, APN keyword `1264`, street keywords `1307 EnvStreetNo`, `1308 EnvStreetDir`, `1309 EnvStreet`, `1310 EnvCity`, `1311 EnvZip`, `1312 EnvLotNumber`, `1313 EnvSubdivision`, `1305 EnvPermitNumber`, `1306 EnvSepticDocType`; `eplpav` base `https://edms.maricopa.gov/eplpav/api`, `QueryID 476`, APN keyword `4647`, `4608 AddressLine1` (house #), `4609 AddressLine2` (street, no suffix), `4607 City`, `4610 Zip`, `4644 EPL_PermitNumber`, `4651 EPL_Type`, `4652 EPL_WorkClass`, `1312`/`1313` lot/subdivision.
- Search: `POST {base}/CustomQuery/KeywordSearch`, `Content-Type: application/json`, body `{"QueryID":229,"Keywords":[{"ID":1264,"Value":"219-11-121","KeywordOperator":"="}],"FromDate":null,"ToDate":null,"QueryLimit":50}`. Parse `DisplayColumnValues` **by `DisplayColumns[i].Heading`, never by index**. `*` is the wildcard (with operator `=`). Always send `QueryLimit` explicitly.
- Document: `GET {base}/Document/{encodeURIComponent(ID)}/` → `application/pdf`; `POST` same URL with body `{}` → `{ Size, ViewerMode, IsAboveDownloadThreshold }`. **Document IDs are ephemeral tokens containing non-ASCII bytes — always `encodeURIComponent` them, never persist them, always search-then-fetch in the same run.**
- Timeouts: EDMS 15 s per request (`AbortSignal.timeout(15000)`), document download 60 s; **one retry on network errors only** (never on HTTP 4xx/5xx). The whole run has a 240 s budget delivered as `ctx.signal`.
- APN must be dashed `NNN-NN-NNN[L]` for EDMS (`21911121` → 0 hits). Use `formatApn` from Task 1.
- Street-name normaliser: uppercase, strip suffixes `RD/ROAD, DR/DRIVE, ST/STREET, AVE/AVENUE, LN/LANE, BLVD, WAY, CT, PL, CIR, TRL` — phase 1's `normalizeStreetName` in `src/lib/prefill/input.ts` already does this (with a superset suffix list); reuse it, never write a second one. Scoring: `+3` street direction match, `+2` city match, `+2` ZIP match, `+3` subdivision match, `+2` lot match, `−∞` APN present and ≠ ours, `+0` APN blank. Top score `≥ 5` with a gap `≥ 3` to the next → auto-select; otherwise up to `8` candidates → `awaiting_selection`; zero rows → `not_found` with the searched terms in `stages.permits.summary`.
- Extraction ranking: `PERMIT` / `FINAL DA` / Discharge Authorization (newest first) → `PERMIT SUB` → `NOTICE OF TRANSFER` → `ABANDONMENT` (flag) → `PLAN REVIEW` / `SUB` (skipped). At most `MAX_DOCUMENTS_PER_RUN` (3) records get `extraction_status = "pending"`; the rest are stored with `"skipped"`.
- Documents larger than `MAX_DOCUMENT_BYTES` (25 MB) are listed but not downloaded (`skipped` with a note). Storage bucket `inspection-media` (private), object path `records/{inspectionId}/{recordId}.pdf`.
- Download links are plain `<a target="_blank" rel="noopener">` — **never `next/link`** (its prefetch would fire the GET and burn a signed URL).
- Outbound hosts are fixed to `edms.maricopa.gov`; user-supplied APN/address are validated (APN regex; address parts ≤ 200 chars, printable ASCII) before being placed in keyword values.
- Do **not** run `biome --write`; edit by hand in the surrounding style (2-space, double quotes, semicolons, ~100 cols).
- Test bar: `npx vitest run` shows **no new failures** vs. the ~15 pre-existing ones (nav/roles/rbac, review-actions, reopen/download routes, `inspection.test` STEP_FIELDS + tank schema). `npm run build` must pass (set placeholder `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_APP_URL` if unset).
- Commit after every task with the message given; end commit messages with the attribution trailer the session prescribes.

---

## File map

| Path | Responsibility |
|---|---|
| `src/lib/prefill/apn.ts` (new) | `formatApn()` — canonical dashed APN or `null` |
| `src/lib/prefill/permits/edms-client.ts` (new) | Archive configs, `searchKeywords`, `getDocumentInfo`, `fetchDocumentBytes`, `documentUrl`, `parseSearchResponse`, `EdmsError`, timeouts + single retry |
| `src/lib/prefill/permits/normalize.ts` (new) | `normalisePermitNumber`, `normalizeStreetName` (re-export of phase-1 `input.ts`), `normaliseStreetDir`, `splitStreetAddress`, `parseUsDate`, `decodeHtmlEntities`, `candidateKey`, `isSafeKeywordValue` |
| `src/lib/prefill/permits/doc-types.ts` (new) | `classifyDocType`, `DOC_CLASS_RANK`, `deriveEplpavDocType`, `rankForExtraction`, `isAbandonmentDocType` |
| `src/lib/prefill/permits/candidates.ts` (new) | `rowToCandidate(archive, row)` → `PermitCandidate`; `SearchHit` type |
| `src/lib/prefill/permits/search.ts` (new) | `searchPermits`, `scoreCandidate`, `dedupeHits`, `propertyGroupKey`, `decideFallback` |
| `src/lib/storage/record-storage.ts` (new) | `uploadRecordPdf`, `getRecordSignedUrl`, `recordStoragePath` |
| `src/lib/prefill/run-store.ts` (modify) | `createRecordRow` — the only `inspection_records` insert |
| `src/lib/prefill/permits/fetch-document.ts` (new) | `storeDocument` — size check → download → upload → page count → `createRecordRow` |
| `src/lib/prefill/permits/index.ts` (replace phase-1 stub) | `runPermitsStage`, `runPermitsSelection` (search → rank → store, summaries, proposals) |
| `src/lib/prefill/run-prefill.ts` (modify) | candidates → `awaiting_selection`; real `continuePrefillAfterSelection` |
| `src/lib/prefill/run-dto.ts` (modify) | `downloadUrl = ""` for unstored records; `isAbandonmentDocType` re-exported from `permits/doc-types` |
| `src/app/api/inspections/[id]/prefill/[runId]/select/route.ts` (phase 1, **unchanged**) | already validates keys, 409s, flips to `running`, `after(() => continuePrefillAfterSelection(...))` |
| `src/app/api/inspections/[id]/records/[recordId]/route.ts` (new) | auth-gated `302` to a 600-s signed URL |
| `src/components/prefill/permit-records-list.tsx` (new) | permit rows, candidate picker, copy-APN (not-found copy + abandonment banner are phase-1 tile behaviour fed by phase-2 data) |
| `src/components/prefill/prefill-sources-tile.tsx` + `prefill-panel.tsx` (modify) | `onSelectCandidates` prop; mounts `PermitRecordsList` under the Permits row |
| `scripts/prefill-permits-smoke.mts` (new) | live smoke against the real EDMS API |
| `src/lib/prefill/permits/__tests__/fixtures/*.json` (new) | recorded real API responses |

---

### Task 1: APN formatter

**Files:**
- Create: `src/lib/prefill/apn.ts`
- Test: `src/lib/prefill/__tests__/apn.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `formatApn(raw: string | null | undefined): string | null` — returns the dashed Maricopa form `NNN-NN-NNN` with an optional trailing split letter (`219-11-121`, `218-49-003B`) or `null` when the input cannot be normalised. Used by `search.ts` (Task 5) and the smoke script (Task 13).

> If phase 1 already created `src/lib/prefill/apn.ts` exporting `formatApn`, keep that file and only make sure the tests below pass against it (extend it if a case fails).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/prefill/__tests__/apn.test.ts
import { describe, expect, it } from "vitest";
import { formatApn } from "../apn";

describe("formatApn", () => {
  it("returns an already-dashed APN unchanged", () => {
    expect(formatApn("219-11-121")).toBe("219-11-121");
  });

  it("dashes an 8-digit compact APN", () => {
    expect(formatApn("21911121")).toBe("219-11-121");
  });

  it("keeps the trailing split letter and uppercases it", () => {
    expect(formatApn("218 49 003b")).toBe("218-49-003B");
    expect(formatApn("218-49-003B")).toBe("218-49-003B");
  });

  it("strips stray punctuation and whitespace", () => {
    expect(formatApn("  219.11.121- ")).toBe("219-11-121");
  });

  it("returns null for empty, undefined, too-short or non-APN input", () => {
    expect(formatApn("")).toBeNull();
    expect(formatApn(undefined)).toBeNull();
    expect(formatApn(null)).toBeNull();
    expect(formatApn("2191112")).toBeNull();
    expect(formatApn("abc")).toBeNull();
    expect(formatApn("219-11-121XY")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/prefill/__tests__/apn.test.ts`
Expected: FAIL — `Cannot find module '../apn'` (or "formatApn is not a function" if phase 1 stubbed the file).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/prefill/apn.ts
/**
 * Maricopa County APNs are book-map-parcel[split]: `NNN-NN-NNN` with an
 * optional trailing letter (219-11-121, 218-49-003B). The EDMS archives only
 * match the dashed form (`21911121` returns 0 rows), the assessor accepts
 * either — so everything downstream normalises through here.
 *
 * Returns null when the input is not an APN.
 */
export function formatApn(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const compact = raw.toUpperCase().replace(/[^0-9A-Z]/g, "");
  const match = /^(\d{3})(\d{2})(\d{3})([A-Z]?)$/.exec(compact);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}${match[4]}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/prefill/__tests__/apn.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/prefill/apn.ts src/lib/prefill/__tests__/apn.test.ts
git commit -m "feat(prefill): formatApn — canonical dashed Maricopa APN"
```

---

### Task 2: Recorded EDMS fixtures + EDMS client

**Files:**
- Create: `src/lib/prefill/permits/__tests__/fixtures/env-parcel-219-11-121.json`
- Create: `src/lib/prefill/permits/__tests__/fixtures/env-parcel-200-08-079.json`
- Create: `src/lib/prefill/permits/__tests__/fixtures/env-street-8911.json`
- Create: `src/lib/prefill/permits/__tests__/fixtures/eplpav-parcel-219-12-165.json`
- Create: `src/lib/prefill/permits/__tests__/fixtures/eplpav-owr-sample.json`
- Create: `src/lib/prefill/permits/__tests__/fixtures/eplpav-ow-nosuffix.json`
- Create: `src/lib/prefill/permits/__tests__/fixtures/eplpav-empty.json`
- Create: `src/lib/prefill/permits/__tests__/fixtures/document-info-000972.json`
- Create: `src/lib/prefill/permits/edms-client.ts`
- Test: `src/lib/prefill/permits/__tests__/edms-client.test.ts`

**Interfaces:**
- Consumes: `PermitArchive` from `src/lib/prefill/types.ts`.
- Produces (all exported from `edms-client.ts`):
  - `type EdmsArchiveId = "env" | "eplpav"`
  - `interface EdmsArchiveConfig { id: EdmsArchiveId; archive: PermitArchive; base: string; searchPageUrl: string; queryId: number; keywords: { apn: number; streetNo: number; street: number; streetDir?: number; city: number; zip: number; lot: number; subdivision: number; permitNumber: number } }`
  - `const EDMS_ARCHIVES: Record<EdmsArchiveId, EdmsArchiveConfig>`
  - `const EDMS_TIMEOUT_MS = 15_000`, `const EDMS_DOCUMENT_TIMEOUT_MS = 60_000`, `const EDMS_QUERY_LIMIT = 50`
  - `interface EdmsKeyword { id: number; value: string }`
  - `interface EdmsRow { id: string; name: string; columns: Record<string, string> }`
  - `interface EdmsSearchResult { rows: EdmsRow[]; truncated: boolean }`
  - `class EdmsError extends Error { kind: "network" | "http" | "parse"; status?: number }`
  - `parseSearchResponse(json: unknown): EdmsSearchResult`
  - `searchKeywords(archive: EdmsArchiveConfig, keywords: EdmsKeyword[], signal?: AbortSignal): Promise<EdmsSearchResult>`
  - `documentUrl(archive: EdmsArchiveConfig, documentId: string): string`
  - `getDocumentInfo(archive, documentId, signal?): Promise<{ size: number; viewerMode: string; isAboveDownloadThreshold: boolean }>`
  - `fetchDocumentBytes(archive, documentId, signal?): Promise<{ bytes: Uint8Array; contentType: string | null; filename: string | null }>`

All fixture files below are **verbatim recordings** of the real API (2026-09-11). The IDs contain non-ASCII characters (`Á`, `É`) on purpose — save the files as UTF-8 exactly as shown.

- [ ] **Step 1: Create the fixture files**

`src/lib/prefill/permits/__tests__/fixtures/env-parcel-219-11-121.json` — `POST env/api/CustomQuery/KeywordSearch` `{QueryID:229, Keywords:[{ID:1264, Value:"219-11-121", KeywordOperator:"="}], QueryLimit:50}`:

```json
{"Data":[{"ID":"AaRMGbHlt7kUlZ5k0J7ph0g0KH41YgqYhEQ6cbsucgI4Ma8tÁvHY26rpkv6FGqrk9r85t2MZo6qsSPr3QArSd2w=","Name":"EnvSeptic - 9/11/2015 - 000972 - PERMIT","DisplayType":"OleActivePage","DisplayColumnValues":[{"Value":"PERMIT","RawValue":null},{"Value":"000972","RawValue":null},{"Value":"219-11-121","RawValue":null},{"Value":"8911","RawValue":null},{"Value":"E","RawValue":null},{"Value":"CAVE CREEK RD","RawValue":null},{"Value":"CAREFREE","RawValue":null},{"Value":"","RawValue":null},{"Value":"","RawValue":null},{"Value":"","RawValue":null}]}],"Truncated":false,"DisplayColumns":[{"Heading":"EnvSepticDocType","DataType":"AlphaNumericSingleTable"},{"Heading":"EnvPermitNumber","DataType":"AlphaNumericSingleTable"},{"Heading":"ParcelNumber","DataType":"AlphaNumericSingleTable"},{"Heading":"EnvStreetNo","DataType":"AlphaNumericSingleTable"},{"Heading":"EnvStreetDir","DataType":"AlphaNumericSingleTable"},{"Heading":"EnvStreet","DataType":"AlphaNumericSingleTable"},{"Heading":"EnvCity","DataType":"AlphaNumericSingleTable"},{"Heading":"EnvZip","DataType":"AlphaNumericSingleTable"},{"Heading":"EnvLotNumber","DataType":"AlphaNumericSingleTable"},{"Heading":"EnvSubdivision","DataType":"AlphaNumericSingleTable"}]}
```

`src/lib/prefill/permits/__tests__/fixtures/env-parcel-200-08-079.json` — same query with `Value:"200-08-079"`:

```json
{"Data":[{"ID":"AcUqÁjZCRTSeTsLgUG3VkH4CcPKDEJ5wblP2NÁP0rB2KnhRrXBgYoIg2HEtzvSpCjzydYY6uFVhÁXLTUQFiIgFY=","Name":"EnvSeptic - 2/8/2018 - OW-17-00474 - PERMIT","DisplayType":"OleActivePage","DisplayColumnValues":[{"Value":"PERMIT","RawValue":null},{"Value":"OW-17-00474","RawValue":null},{"Value":"200-08-079","RawValue":null},{"Value":"8911","RawValue":null},{"Value":"W","RawValue":null},{"Value":"VILLA CHULA","RawValue":null},{"Value":"PEORIA","RawValue":null},{"Value":"85383","RawValue":null},{"Value":"2","RawValue":null},{"Value":"SUNRISE 4","RawValue":null}]},{"ID":"AaUVvUAdxsLqGiEEct5ukV47l5HlGlXDÁ5ÉRa5QqeSDvSnfwNÉHNwuFÁoqOnÁCb9cldYÉnxv2E3RÉKBdNPFR3qk=","Name":"EnvSeptic - 9/21/2022 - OWR-22-04475 - NOTICE OF TRANSFER","DisplayType":"OleActivePage","DisplayColumnValues":[{"Value":"NOTICE OF TRANSFER","RawValue":null},{"Value":"OWR-22-04475","RawValue":null},{"Value":"200-08-079","RawValue":null},{"Value":"8911","RawValue":null},{"Value":"W","RawValue":null},{"Value":"VILLA CHULA","RawValue":null},{"Value":"PEORIA","RawValue":null},{"Value":"85383","RawValue":null},{"Value":"2","RawValue":null},{"Value":"SUNRISE UNIT 4","RawValue":null}]}],"Truncated":false,"DisplayColumns":[{"Heading":"EnvSepticDocType","DataType":"AlphaNumericSingleTable"},{"Heading":"EnvPermitNumber","DataType":"AlphaNumericSingleTable"},{"Heading":"ParcelNumber","DataType":"AlphaNumericSingleTable"},{"Heading":"EnvStreetNo","DataType":"AlphaNumericSingleTable"},{"Heading":"EnvStreetDir","DataType":"AlphaNumericSingleTable"},{"Heading":"EnvStreet","DataType":"AlphaNumericSingleTable"},{"Heading":"EnvCity","DataType":"AlphaNumericSingleTable"},{"Heading":"EnvZip","DataType":"AlphaNumericSingleTable"},{"Heading":"EnvLotNumber","DataType":"AlphaNumericSingleTable"},{"Heading":"EnvSubdivision","DataType":"AlphaNumericSingleTable"}]}
```

`src/lib/prefill/permits/__tests__/fixtures/env-street-8911.json` — `Keywords:[{ID:1307, Value:"8911", KeywordOperator:"="}]` (street number only; 8 rows across 5 different streets — the ideal scoring fixture):

```json
{"Data":[{"ID":"AbBDQMk5IKdsb9Klf3bgÉPMPZEVJdXi0EkXUVlÁaysmu21nxQFdJtxgDdJbfwÁ32nSPs5ZfdNggAFwxXIriqSBs=","Name":"EnvSeptic - 9/11/2015 - 000972 - PERMIT","DisplayType":"OleActivePage","DisplayColumnValues":[{"Value":"PERMIT","RawValue":null},{"Value":"000972","RawValue":null},{"Value":"219-11-121","RawValue":null},{"Value":"8911","RawValue":null},{"Value":"E","RawValue":null},{"Value":"CAVE CREEK RD","RawValue":null},{"Value":"CAREFREE","RawValue":null},{"Value":"","RawValue":null},{"Value":"","RawValue":null},{"Value":"","RawValue":null}]},{"ID":"AebnllWWFMHy69N5Jb77uBhomumST0lKGQADgP3L2GTj0hfBx1wCPFusdabÁnsVV9xjGYROSgW1AÁlNJRWXJPj0=","Name":"EnvSeptic - 9/11/2015 - 030977 - PERMIT","DisplayType":"OleActivePage","DisplayColumnValues":[{"Value":"PERMIT","RawValue":null},{"Value":"030977","RawValue":null},{"Value":"218-49-003B","RawValue":null},{"Value":"8911","RawValue":null},{"Value":"E","RawValue":null},{"Value":"SUNLAND AVE","RawValue":null},{"Value":"MARICOPA COUNTY","RawValue":null},{"Value":"","RawValue":null},{"Value":"","RawValue":null},{"Value":"","RawValue":null}]},{"ID":"AdSZ9Unhr1OH8F3wSqaqÁboÁuIyFhÁUYUBD5Tr6fjCzfj44FDBDWTu7XckM8nZNpvLLjZBLMl5XkuYUvsZr88Xs=","Name":"EnvSeptic - 9/11/2015 - 743691 - PERMIT","DisplayType":"OleActivePage","DisplayColumnValues":[{"Value":"PERMIT","RawValue":null},{"Value":"743691","RawValue":null},{"Value":"","RawValue":null},{"Value":"8911","RawValue":null},{"Value":"E","RawValue":null},{"Value":"PRINCESS","RawValue":null},{"Value":"","RawValue":null},{"Value":"","RawValue":null},{"Value":"","RawValue":null},{"Value":"","RawValue":null}]},{"ID":"AV22YvÁTÉRMpFoCzEQs9ÉLJT9z1pheF1wqmAy6DWmIÉfgbgoyÁ3Á2urOyjpk1MjÁhAyCr9lj45LkxtnVwALhk0w=","Name":"EnvSeptic - 9/11/2015 - 851171 - PERMIT SUB","DisplayType":"OleActivePage","DisplayColumnValues":[{"Value":"PERMIT SUB","RawValue":null},{"Value":"851171","RawValue":null},{"Value":"218-49-011E","RawValue":null},{"Value":"8911","RawValue":null},{"Value":"E","RawValue":null},{"Value":"FLORIAN AVE","RawValue":null},{"Value":"MESA","RawValue":null},{"Value":"85208","RawValue":null},{"Value":"19","RawValue":null},{"Value":"BERRY ESTATES","RawValue":null}]},{"ID":"ATACzzFD1ÁgbuxwYziWaHzjGpusa1Ex48f0BvC5ÉXhÉPRCB9EoUKJH0i9Cdm8cuRTgI87zTYOp01QITÉYusOEuQ=","Name":"EnvSeptic - 2/8/2018 - OW-17-00474 - PERMIT","DisplayType":"OleActivePage","DisplayColumnValues":[{"Value":"PERMIT","RawValue":null},{"Value":"OW-17-00474","RawValue":null},{"Value":"200-08-079","RawValue":null},{"Value":"8911","RawValue":null},{"Value":"W","RawValue":null},{"Value":"VILLA CHULA","RawValue":null},{"Value":"PEORIA","RawValue":null},{"Value":"85383","RawValue":null},{"Value":"2","RawValue":null},{"Value":"SUNRISE 4","RawValue":null}]},{"ID":"ARsI5qrEpnwhbEAeEw2Z4y3sDÁRxDp5Mu0vSF4t2IDQ1dÉYP9r89bVÁermg6y6RHOfmji6Dc0emGqC7jtMI7NgA=","Name":"EnvSeptic - 10/27/2020 - OWR-20-04198 - NOTICE OF TRANSFER","DisplayType":"OleActivePage","DisplayColumnValues":[{"Value":"NOTICE OF TRANSFER","RawValue":null},{"Value":"OWR-20-04198","RawValue":null},{"Value":"","RawValue":null},{"Value":"8911","RawValue":null},{"Value":"E","RawValue":null},{"Value":"PRINCESS DR","RawValue":null},{"Value":"MESA","RawValue":null},{"Value":"85207","RawValue":null},{"Value":"","RawValue":null},{"Value":"","RawValue":null}]},{"ID":"AffkUT6MZTÉFnb5zpGxdZUKDBFSJO6DnJblPÁY7CYlvÉPBÉkdZlyL0GDuTuj117fbUDphHLEyNr9lpswWkfyysI=","Name":"EnvSeptic - 3/28/2022 - OWR-22-01478 - NOTICE OF TRANSFER","DisplayType":"OleActivePage","DisplayColumnValues":[{"Value":"NOTICE OF TRANSFER","RawValue":null},{"Value":"OWR-22-01478","RawValue":null},{"Value":"218-06-099A","RawValue":null},{"Value":"8911","RawValue":null},{"Value":"E","RawValue":null},{"Value":"PRINCESS DR","RawValue":null},{"Value":"MESA","RawValue":null},{"Value":"85207","RawValue":null},{"Value":"","RawValue":null},{"Value":"","RawValue":null}]},{"ID":"AXki8D8GruPZXj31NNpVMNBGKXFQ5qFqXAZ1xGxuQtefY1qw4c31ZjuHDHQqb5uqeR5uiPKyUF3YjfFv9SzIYbM=","Name":"EnvSeptic - 9/21/2022 - OWR-22-04475 - NOTICE OF TRANSFER","DisplayType":"OleActivePage","DisplayColumnValues":[{"Value":"NOTICE OF TRANSFER","RawValue":null},{"Value":"OWR-22-04475","RawValue":null},{"Value":"200-08-079","RawValue":null},{"Value":"8911","RawValue":null},{"Value":"W","RawValue":null},{"Value":"VILLA CHULA","RawValue":null},{"Value":"PEORIA","RawValue":null},{"Value":"85383","RawValue":null},{"Value":"2","RawValue":null},{"Value":"SUNRISE UNIT 4","RawValue":null}]}],"Truncated":false,"DisplayColumns":[{"Heading":"EnvSepticDocType","DataType":"AlphaNumericSingleTable"},{"Heading":"EnvPermitNumber","DataType":"AlphaNumericSingleTable"},{"Heading":"ParcelNumber","DataType":"AlphaNumericSingleTable"},{"Heading":"EnvStreetNo","DataType":"AlphaNumericSingleTable"},{"Heading":"EnvStreetDir","DataType":"AlphaNumericSingleTable"},{"Heading":"EnvStreet","DataType":"AlphaNumericSingleTable"},{"Heading":"EnvCity","DataType":"AlphaNumericSingleTable"},{"Heading":"EnvZip","DataType":"AlphaNumericSingleTable"},{"Heading":"EnvLotNumber","DataType":"AlphaNumericSingleTable"},{"Heading":"EnvSubdivision","DataType":"AlphaNumericSingleTable"}]}
```

`src/lib/prefill/permits/__tests__/fixtures/eplpav-parcel-219-12-165.json` — `POST eplpav/api/CustomQuery/KeywordSearch` `{QueryID:476, Keywords:[{ID:4647, Value:"219-12-165", KeywordOperator:"="}], QueryLimit:50}` (one FINAL DA; note the 22-column layout, `RawValue` epoch-ms on date columns, and that `Doc ID` is the OnBase internal number, **not** the download token):

```json
{"Data":[{"ID":"ATJHLn8CY5A1Y8Yynzki7QfQIzrW6yzÁÁkEcTjnVsaYhpy3ZfTGeMDGXbs8NVÉck4w67RDBGÉcKJÁ6WDtLUu0xo=","Name":"EPL Permit - 11/24/2025 - Permit # OW-24-00070 - Complete - OW-24-00070 FINAL DA","DisplayType":"OleActivePage","DisplayColumnValues":[{"Value":"EPL Permit","RawValue":null},{"Value":"55537133","RawValue":"55537133"},{"Value":"OW-24-00070 FINAL DA","RawValue":null},{"Value":"OW-24-00070","RawValue":null},{"Value":"ONSITE WASTEWATER","RawValue":null},{"Value":"ONSITE PERMIT","RawValue":null},{"Value":"Standard, New, Septic Tank with Additional Alternative Elements | Alternative septic system design (BioMicrobics MicroFAST 0.9) for new SFH. A previous CA (OW-18-01781) was issued for this parcel. However, a different home will now be built and thus","RawValue":null},{"Value":"Complete","RawValue":null},{"Value":"BRM Trust","RawValue":null},{"Value":"1/12/2024","RawValue":"1705017600000"},{"Value":"8/28/2025","RawValue":"1756339200000"},{"Value":"11/21/2025","RawValue":"1763683200000"},{"Value":"LEGC","RawValue":null},{"Value":"Corp","RawValue":null},{"Value":"11425","RawValue":null},{"Value":"Cottontail","RawValue":null},{"Value":"Cave Creek","RawValue":null},{"Value":"AZ","RawValue":null},{"Value":"85331","RawValue":null},{"Value":"219-12-165","RawValue":null},{"Value":"","RawValue":null},{"Value":"","RawValue":null}]}],"Truncated":false,"DisplayColumns":[{"Heading":"Document Type","DataType":"AlphaNumeric"},{"Heading":"Doc ID","DataType":"LargeNumeric"},{"Heading":"File Name","DataType":"AlphaNumericSingleTableCSInsensitiveSearch"},{"Heading":"Permit Number","DataType":"AlphaNumericSingleTable"},{"Heading":"Permit Type","DataType":"AlphaNumericSingleTable"},{"Heading":"Permit Subtype","DataType":"AlphaNumericSingleTable"},{"Heading":"Description","DataType":"AlphaNumericSingleTableCSInsensitiveSearch"},{"Heading":"Status","DataType":"AlphaNumericSingleTableCSInsensitiveSearch"},{"Heading":"Project Name","DataType":"AlphaNumericSingleTableCSInsensitiveSearch"},{"Heading":"Application Date","DataType":"Date"},{"Heading":"Issued Date","DataType":"Date"},{"Heading":"Closed Date","DataType":"Date"},{"Heading":"Contact First Name","DataType":"AlphaNumericSingleTableCSInsensitiveSearch"},{"Heading":"Contact Last Name","DataType":"AlphaNumericSingleTableCSInsensitiveSearch"},{"Heading":"Address Line 1","DataType":"AlphaNumericSingleTableCSInsensitiveSearch"},{"Heading":"Address Line 2","DataType":"AlphaNumericSingleTableCSInsensitiveSearch"},{"Heading":"City","DataType":"AlphaNumericSingleTableCSInsensitiveSearch"},{"Heading":"State","DataType":"AlphaNumericSingleTable"},{"Heading":"ZIP Code","DataType":"AlphaNumericSingleTable"},{"Heading":"Parcel Number","DataType":"AlphaNumericSingleTable"},{"Heading":"Subdivision (For Septic Only)","DataType":"AlphaNumericSingleTable"},{"Heading":"LotNumber (For Septic Only)","DataType":"AlphaNumericSingleTable"}]}
```

`src/lib/prefill/permits/__tests__/fixtures/eplpav-owr-sample.json` — three verbatim rows from the `OWR-*` (`Permit Type = ONSITE WASTEWATER REVIEW`) recording: an ABANDONMENT, a NOTICE OF TRANSFER, and a MINOR REVIEW/REMODEL with an empty File Name (used for doc-type derivation and the abandonment banner):

```json
{"Data":[{"ID":"AUKOSHmq9XXeRpLUHtN2IHz3M5cessT4Wi1NQrjlCqdmnL3bgNGF3q2DVRZa7cHsZrL6hyVwO1Ur9ez9RhYIcp4=","Name":"EPL Permit - 4/14/2025 - Permit # OWR-22-01512 - Complete - OWR-22-01512 ABANDONMENT FINAL APPROVED","DisplayType":"OleActivePage","DisplayColumnValues":[{"Value":"EPL Permit","RawValue":null},{"Value":"53962638","RawValue":"53962638"},{"Value":"OWR-22-01512 ABANDONMENT FINAL APPROVED","RawValue":null},{"Value":"OWR-22-01512","RawValue":null},{"Value":"ONSITE WASTEWATER REVIEW","RawValue":null},{"Value":"ABANDONMENT","RawValue":null},{"Value":"Standard, Closure-Abandonment, Septic Tank, Conventional Disposal, &lt;3000 Gal/Day | Abandon FAILING System &amp; Install new OSWTF permit #TBD\r\n\r\nmissing / coc\r\n\r\n12/14/22 - Reminder of Expiration for February 2023","RawValue":null},{"Value":"Complete","RawValue":null},{"Value":"95th Place LLC","RawValue":null},{"Value":"3/30/2022","RawValue":"1648598400000"},{"Value":"4/10/2025","RawValue":"1744243200000"},{"Value":"4/14/2025","RawValue":"1744588800000"},{"Value":"Michael","RawValue":null},{"Value":"Ammirati","RawValue":null},{"Value":"56","RawValue":null},{"Value":"95th","RawValue":null},{"Value":"Mesa","RawValue":null},{"Value":"AZ","RawValue":null},{"Value":"85207","RawValue":null},{"Value":"220-28-026","RawValue":null},{"Value":"","RawValue":null},{"Value":"","RawValue":null}]},{"ID":"AWwlxRHzAqiF9thsVpMÁI8E2jfsQ9UUGkn3YdaGeaYmDsZMfB7jqD9zpVI4UqEvswoTT1tw2gSJ7MsHPt5OUlLI=","Name":"EPL Permit - 7/24/2024 - Permit # OWR-24-02002 - Complete - Notice of Transfer of Ownership OWR-24-02002","DisplayType":"OleActivePage","DisplayColumnValues":[{"Value":"EPL Permit","RawValue":null},{"Value":"47452902","RawValue":"47452902"},{"Value":"Notice of Transfer of Ownership OWR-24-02002","RawValue":null},{"Value":"OWR-24-02002","RawValue":null},{"Value":"ONSITE WASTEWATER REVIEW","RawValue":null},{"Value":"NOTICE OF TRANSFER","RawValue":null},{"Value":"Standard, Transfer of Ownership, N/A |","RawValue":null},{"Value":"Complete","RawValue":null},{"Value":"SILVESTRE LOZANO","RawValue":null},{"Value":"6/12/2024","RawValue":"1718150400000"},{"Value":"","RawValue":null},{"Value":"","RawValue":null},{"Value":"Silvestre","RawValue":null},{"Value":"Lozano","RawValue":null},{"Value":"1801","RawValue":null},{"Value":"Piedmont","RawValue":null},{"Value":"Phoenix","RawValue":null},{"Value":"AZ","RawValue":null},{"Value":"85041","RawValue":null},{"Value":"300-52-045","RawValue":null},{"Value":"","RawValue":null},{"Value":"","RawValue":null}]},{"ID":"AejO0vayBwiv8lRuHoÁXL0uX3Kww08iFxALaR8VWrzÁrDsVvÁT1H8A2afc9ohC73HxRWelUVLw4PTjUÉTNnHJcY=","Name":"EPL Permit - 11/8/2024 - Permit # OWR-23-02201 - Issued -","DisplayType":"OleActivePage","DisplayColumnValues":[{"Value":"EPL Permit","RawValue":null},{"Value":"50589488","RawValue":"50589488"},{"Value":"","RawValue":null},{"Value":"OWR-23-02201","RawValue":null},{"Value":"ONSITE WASTEWATER REVIEW","RawValue":null},{"Value":"MINOR REVIEW/REMODEL","RawValue":null},{"Value":"Standard, Reconnect/Remodel Review, N/A | Resolution of NOV and Demand for Compliance EF-22-00012\r\n\r\n3/12/24 - Reminder of Expiration for JUNE 2024","RawValue":null},{"Value":"Issued","RawValue":null},{"Value":"Dathyl L Feather dba Dana&#39;s Trailer Ranch","RawValue":null},{"Value":"6/29/2023","RawValue":"1687996800000"},{"Value":"10/2/2024","RawValue":"1727827200000"},{"Value":"11/7/2024","RawValue":"1730937600000"},{"Value":"Michael","RawValue":null},{"Value":"Foy","RawValue":null},{"Value":"10712","RawValue":null},{"Value":"Apache","RawValue":null},{"Value":"Apache Junction","RawValue":null},{"Value":"AZ","RawValue":null},{"Value":"85120","RawValue":null},{"Value":"220-48-007B","RawValue":null},{"Value":"","RawValue":null},{"Value":"","RawValue":null}]}],"Truncated":false,"DisplayColumns":[{"Heading":"Document Type","DataType":"AlphaNumeric"},{"Heading":"Doc ID","DataType":"LargeNumeric"},{"Heading":"File Name","DataType":"AlphaNumericSingleTableCSInsensitiveSearch"},{"Heading":"Permit Number","DataType":"AlphaNumericSingleTable"},{"Heading":"Permit Type","DataType":"AlphaNumericSingleTable"},{"Heading":"Permit Subtype","DataType":"AlphaNumericSingleTable"},{"Heading":"Description","DataType":"AlphaNumericSingleTableCSInsensitiveSearch"},{"Heading":"Status","DataType":"AlphaNumericSingleTableCSInsensitiveSearch"},{"Heading":"Project Name","DataType":"AlphaNumericSingleTableCSInsensitiveSearch"},{"Heading":"Application Date","DataType":"Date"},{"Heading":"Issued Date","DataType":"Date"},{"Heading":"Closed Date","DataType":"Date"},{"Heading":"Contact First Name","DataType":"AlphaNumericSingleTableCSInsensitiveSearch"},{"Heading":"Contact Last Name","DataType":"AlphaNumericSingleTableCSInsensitiveSearch"},{"Heading":"Address Line 1","DataType":"AlphaNumericSingleTableCSInsensitiveSearch"},{"Heading":"Address Line 2","DataType":"AlphaNumericSingleTableCSInsensitiveSearch"},{"Heading":"City","DataType":"AlphaNumericSingleTableCSInsensitiveSearch"},{"Heading":"State","DataType":"AlphaNumericSingleTable"},{"Heading":"ZIP Code","DataType":"AlphaNumericSingleTable"},{"Heading":"Parcel Number","DataType":"AlphaNumericSingleTable"},{"Heading":"Subdivision (For Septic Only)","DataType":"AlphaNumericSingleTable"},{"Heading":"LotNumber (For Septic Only)","DataType":"AlphaNumericSingleTable"}]}
```

`src/lib/prefill/permits/__tests__/fixtures/eplpav-ow-nosuffix.json` — one verbatim `ONSITE PERMIT` row whose File Name is empty (about 28 % of ePLPAV permit rows look like this — the doc type must fall back to `PERMIT`):

```json
{"Data":[{"ID":"AawMz7XjDx99EWlcFtEbOVvÁQwkABzQYeFUCdsSW9ZAL2utJijjkcLÉfcmZTSÁzQ0eqTBfvc2Aevi1qEXVxVYÉM=","Name":"EPL Permit - 1/21/2025 - Permit # OW-21-01552 - Issued -","DisplayType":"OleActivePage","DisplayColumnValues":[{"Value":"EPL Permit","RawValue":null},{"Value":"51445547","RawValue":"51445547"},{"Value":"","RawValue":null},{"Value":"OW-21-01552","RawValue":null},{"Value":"ONSITE WASTEWATER","RawValue":null},{"Value":"ONSITE PERMIT","RawValue":null},{"Value":"Standard, New, Septic Tank with Additional Alternative Elements | Install a Alternative septic system for a single family residence. 750 GPD.\r\n\r\n04/20/22 - Reminder of Expiration for July 2022\r\n4/26/23 - Reminder of Expiration for JULY 2023\r\n\r\n4/15/2","RawValue":null},{"Value":"Issued","RawValue":null},{"Value":"WALTER A/KATHLEEN E KUNKA","RawValue":null},{"Value":"7/12/2021","RawValue":"1626048000000"},{"Value":"11/27/2024","RawValue":"1732665600000"},{"Value":"","RawValue":null},{"Value":"Stephen","RawValue":null},{"Value":"Daldrup","RawValue":null},{"Value":"38174","RawValue":null},{"Value":"Tranquil","RawValue":null},{"Value":"Carefree","RawValue":null},{"Value":"AZ","RawValue":null},{"Value":"85377","RawValue":null},{"Value":"216-23-063","RawValue":null},{"Value":"","RawValue":null},{"Value":"","RawValue":null}]}],"Truncated":false,"DisplayColumns":[{"Heading":"Document Type","DataType":"AlphaNumeric"},{"Heading":"Doc ID","DataType":"LargeNumeric"},{"Heading":"File Name","DataType":"AlphaNumericSingleTableCSInsensitiveSearch"},{"Heading":"Permit Number","DataType":"AlphaNumericSingleTable"},{"Heading":"Permit Type","DataType":"AlphaNumericSingleTable"},{"Heading":"Permit Subtype","DataType":"AlphaNumericSingleTable"},{"Heading":"Description","DataType":"AlphaNumericSingleTableCSInsensitiveSearch"},{"Heading":"Status","DataType":"AlphaNumericSingleTableCSInsensitiveSearch"},{"Heading":"Project Name","DataType":"AlphaNumericSingleTableCSInsensitiveSearch"},{"Heading":"Application Date","DataType":"Date"},{"Heading":"Issued Date","DataType":"Date"},{"Heading":"Closed Date","DataType":"Date"},{"Heading":"Contact First Name","DataType":"AlphaNumericSingleTableCSInsensitiveSearch"},{"Heading":"Contact Last Name","DataType":"AlphaNumericSingleTableCSInsensitiveSearch"},{"Heading":"Address Line 1","DataType":"AlphaNumericSingleTableCSInsensitiveSearch"},{"Heading":"Address Line 2","DataType":"AlphaNumericSingleTableCSInsensitiveSearch"},{"Heading":"City","DataType":"AlphaNumericSingleTableCSInsensitiveSearch"},{"Heading":"State","DataType":"AlphaNumericSingleTable"},{"Heading":"ZIP Code","DataType":"AlphaNumericSingleTable"},{"Heading":"Parcel Number","DataType":"AlphaNumericSingleTable"},{"Heading":"Subdivision (For Septic Only)","DataType":"AlphaNumericSingleTable"},{"Heading":"LotNumber (For Septic Only)","DataType":"AlphaNumericSingleTable"}]}
```

`src/lib/prefill/permits/__tests__/fixtures/eplpav-empty.json` — a zero-hit response (note `DisplayColumns` is `null`, not `[]`):

```json
{"Data":[],"Truncated":false,"DisplayColumns":null}
```

`src/lib/prefill/permits/__tests__/fixtures/document-info-000972.json` — `POST env/api/Document/{id}/` with body `{}` for permit 000972:

```json
{"ID":"AaRMGbHlt7kUlZ5k0J7ph0g0KH41YgqYhEQ6cbsucgI4Ma8tÁvHY26rpkv6FGqrk9r85t2MZo6qsSPr3QArSd2w=","Size":712751,"ViewerMode":"PDF","IsAboveDownloadThreshold":false}
```

(The research session did not save the OnBase keyword-schema responses as files; nothing at runtime consumes them — the keyword IDs above are the verified constants — so no keyword-schema fixture is created.)

- [ ] **Step 2: Write the failing test**

```ts
// src/lib/prefill/permits/__tests__/edms-client.test.ts
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EDMS_ARCHIVES,
  EdmsError,
  documentUrl,
  fetchDocumentBytes,
  getDocumentInfo,
  parseSearchResponse,
  searchKeywords,
} from "../edms-client";
import docInfo from "./fixtures/document-info-000972.json";
import envParcel from "./fixtures/env-parcel-219-11-121.json";
import eplEmpty from "./fixtures/eplpav-empty.json";
import eplParcel from "./fixtures/eplpav-parcel-219-12-165.json";

const mockFetch = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseSearchResponse", () => {
  it("keys every column by its DisplayColumns heading", () => {
    const { rows, truncated } = parseSearchResponse(envParcel);
    expect(truncated).toBe(false);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(envParcel.Data[0].ID);
    expect(rows[0].name).toBe("EnvSeptic - 9/11/2015 - 000972 - PERMIT");
    expect(rows[0].columns).toEqual({
      EnvSepticDocType: "PERMIT",
      EnvPermitNumber: "000972",
      ParcelNumber: "219-11-121",
      EnvStreetNo: "8911",
      EnvStreetDir: "E",
      EnvStreet: "CAVE CREEK RD",
      EnvCity: "CAREFREE",
      EnvZip: "",
      EnvLotNumber: "",
      EnvSubdivision: "",
    });
  });

  it("handles the 22-column ePLPAV layout by heading", () => {
    const { rows } = parseSearchResponse(eplParcel);
    expect(rows[0].columns["Permit Number"]).toBe("OW-24-00070");
    expect(rows[0].columns["File Name"]).toBe("OW-24-00070 FINAL DA");
    expect(rows[0].columns["Closed Date"]).toBe("11/21/2025");
    expect(rows[0].columns["Address Line 2"]).toBe("Cottontail");
    expect(rows[0].columns["Parcel Number"]).toBe("219-12-165");
  });

  it("returns no rows when Data is empty and DisplayColumns is null", () => {
    expect(parseSearchResponse(eplEmpty)).toEqual({ rows: [], truncated: false });
  });

  it("throws a parse EdmsError on a non-object body", () => {
    expect(() => parseSearchResponse("<html>")).toThrowError(EdmsError);
    expect(() => parseSearchResponse({ Message: "An error has occurred." })).toThrowError(
      /unexpected/i,
    );
  });
});

describe("searchKeywords", () => {
  it("POSTs the OnBase KeywordSearch body with QueryID, keyword IDs and QueryLimit", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(envParcel));

    const result = await searchKeywords(EDMS_ARCHIVES.env, [{ id: 1264, value: "219-11-121" }]);

    expect(result.rows).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://edms.maricopa.gov/env/api/CustomQuery/KeywordSearch");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      Accept: "application/json",
    });
    expect(JSON.parse(init.body)).toEqual({
      QueryID: 229,
      Keywords: [{ ID: 1264, Value: "219-11-121", KeywordOperator: "=" }],
      FromDate: null,
      ToDate: null,
      QueryLimit: 50,
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses the eplpav base URL and QueryID 476", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(eplParcel));
    await searchKeywords(EDMS_ARCHIVES.eplpav, [{ id: 4647, value: "219-12-165" }]);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://edms.maricopa.gov/eplpav/api/CustomQuery/KeywordSearch");
    expect(JSON.parse(init.body).QueryID).toBe(476);
  });

  it("throws an http EdmsError on non-2xx without retrying", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ Message: "An error has occurred." }, 500));
    await expect(
      searchKeywords(EDMS_ARCHIVES.env, [{ id: 1264, value: "219-11-121" }]),
    ).rejects.toMatchObject({ kind: "http", status: 500 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("retries exactly once on a network error, then succeeds", async () => {
    mockFetch
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(jsonResponse(envParcel));
    const result = await searchKeywords(EDMS_ARCHIVES.env, [{ id: 1264, value: "219-11-121" }]);
    expect(result.rows).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("gives up after the single retry with a network EdmsError", async () => {
    mockFetch.mockRejectedValue(new TypeError("fetch failed"));
    await expect(
      searchKeywords(EDMS_ARCHIVES.env, [{ id: 1264, value: "219-11-121" }]),
    ).rejects.toMatchObject({ kind: "network" });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry when the caller's signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      searchKeywords(EDMS_ARCHIVES.env, [{ id: 1264, value: "219-11-121" }], controller.signal),
    ).rejects.toMatchObject({ kind: "network" });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("documentUrl", () => {
  it("encodes the ephemeral ID (non-ASCII bytes and '=') and keeps the trailing slash", () => {
    const id = envParcel.Data[0].ID;
    const url = documentUrl(EDMS_ARCHIVES.env, id);
    expect(url).toBe(`https://edms.maricopa.gov/env/api/Document/${encodeURIComponent(id)}/`);
    expect(url).toContain("%C3%81"); // Á
    expect(url.endsWith("%3D/")).toBe(true); // trailing '='
    expect(url).not.toContain("Á");
  });
});

describe("getDocumentInfo", () => {
  it("POSTs {} to the document URL and maps Size/ViewerMode/IsAboveDownloadThreshold", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(docInfo));
    const info = await getDocumentInfo(EDMS_ARCHIVES.env, envParcel.Data[0].ID);
    expect(info).toEqual({ size: 712751, viewerMode: "PDF", isAboveDownloadThreshold: false });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(documentUrl(EDMS_ARCHIVES.env, envParcel.Data[0].ID));
    expect(init.method).toBe("POST");
    expect(init.body).toBe("{}");
  });

  it("throws a parse EdmsError when Size is missing", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ViewerMode: "PDF" }));
    await expect(getDocumentInfo(EDMS_ARCHIVES.env, "abc")).rejects.toMatchObject({
      kind: "parse",
    });
  });
});

describe("fetchDocumentBytes", () => {
  it("GETs the document, returns the bytes and the Content-Disposition filename", async () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
    mockFetch.mockResolvedValueOnce(
      new Response(pdf, {
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "content-disposition":
            'inline; filename="EnvSeptic - 9/11/2015 - 000972 - PERMIT.pdf"',
        },
      }),
    );
    const doc = await fetchDocumentBytes(EDMS_ARCHIVES.env, envParcel.Data[0].ID);
    expect(Array.from(doc.bytes)).toEqual(Array.from(pdf));
    expect(doc.contentType).toBe("application/pdf");
    expect(doc.filename).toBe("EnvSeptic - 9/11/2015 - 000972 - PERMIT.pdf");
    const [, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe("GET");
  });

  it("rejects a non-PDF body with a parse EdmsError", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("<html>login</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    await expect(fetchDocumentBytes(EDMS_ARCHIVES.env, "abc")).rejects.toMatchObject({
      kind: "parse",
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/prefill/permits/__tests__/edms-client.test.ts`
Expected: FAIL — `Cannot find module '../edms-client'`.

- [ ] **Step 4: Write the EDMS client**

```ts
// src/lib/prefill/permits/edms-client.ts
/**
 * Maricopa ESD EDMS (Hyland OnBase Public Access 19.12) JSON client.
 *
 * Two archives share one API shape:
 *   - `env`    https://edms.maricopa.gov/env/api    legacy scans, QueryID 229 "Septic Search"
 *   - `eplpav` https://edms.maricopa.gov/eplpav/api Permit Center docs (2024-06+), QueryID 476
 *
 * No login, cookies or CSRF. Verified live 2026-09-11.
 *
 * Document IDs returned by a search are EPHEMERAL tokens with non-ASCII bytes:
 * always `encodeURIComponent` them, never persist them, and always fetch in the
 * same run that searched.
 */

import type { PermitArchive } from "../types";

export type EdmsArchiveId = "env" | "eplpav";

export interface EdmsArchiveConfig {
  id: EdmsArchiveId;
  archive: PermitArchive;
  /** API base, no trailing slash */
  base: string;
  /** Human search page (EDMS has no deep links) */
  searchPageUrl: string;
  queryId: number;
  /** OnBase keyword type IDs for this archive's custom query */
  keywords: {
    apn: number;
    streetNo: number;
    street: number;
    streetDir?: number;
    city: number;
    zip: number;
    lot: number;
    subdivision: number;
    permitNumber: number;
  };
}

export const EDMS_ARCHIVES: Record<EdmsArchiveId, EdmsArchiveConfig> = {
  env: {
    id: "env",
    archive: "edms_env",
    base: "https://edms.maricopa.gov/env/api",
    searchPageUrl: "https://edms.maricopa.gov/env/",
    queryId: 229,
    keywords: {
      apn: 1264,
      streetNo: 1307,
      streetDir: 1308,
      street: 1309,
      city: 1310,
      zip: 1311,
      lot: 1312,
      subdivision: 1313,
      permitNumber: 1305,
    },
  },
  eplpav: {
    id: "eplpav",
    archive: "edms_eplpav",
    base: "https://edms.maricopa.gov/eplpav/api",
    searchPageUrl: "https://edms.maricopa.gov/eplpav/",
    queryId: 476,
    keywords: {
      apn: 4647,
      streetNo: 4608,
      street: 4609,
      city: 4607,
      zip: 4610,
      lot: 1312,
      subdivision: 1313,
      permitNumber: 4644,
    },
  },
};

/** Per-request timeout for search + metadata calls (spec §10) */
export const EDMS_TIMEOUT_MS = 15_000;
/** Per-request timeout for the PDF download (spec §10) */
export const EDMS_DOCUMENT_TIMEOUT_MS = 60_000;
/** Always sent explicitly — the server caps at 1000 */
export const EDMS_QUERY_LIMIT = 50;

export interface EdmsKeyword {
  id: number;
  /** Raw keyword value; `*` is the wildcard */
  value: string;
}

export interface EdmsRow {
  /** Ephemeral document token — never persist */
  id: string;
  name: string;
  /** DisplayColumnValues keyed by DisplayColumns[i].Heading */
  columns: Record<string, string>;
}

export interface EdmsSearchResult {
  rows: EdmsRow[];
  truncated: boolean;
}

export interface EdmsDocumentInfo {
  size: number;
  viewerMode: string;
  isAboveDownloadThreshold: boolean;
}

export interface EdmsDocumentBytes {
  bytes: Uint8Array;
  contentType: string | null;
  filename: string | null;
}

export class EdmsError extends Error {
  constructor(
    message: string,
    readonly kind: "network" | "http" | "parse",
    readonly status?: number,
  ) {
    super(message);
    this.name = "EdmsError";
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * `fetch` with a per-attempt timeout, the caller's budget signal, and exactly
 * one retry on network errors (never on HTTP status errors — those are
 * surfaced to the caller unchanged).
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal?.aborted) {
      throw new EdmsError("Prefill run budget exhausted before EDMS request", "network");
    }
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      return await fetch(url, { ...init, signal: combined });
    } catch (err) {
      lastError = err;
      if (signal?.aborted) break;
    }
  }
  throw new EdmsError(`Maricopa EDMS unreachable: ${errorMessage(lastError)}`, "network");
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Pure: turn a KeywordSearch response into heading-keyed rows. */
export function parseSearchResponse(json: unknown): EdmsSearchResult {
  if (!isRecord(json) || !Array.isArray(json.Data)) {
    throw new EdmsError("Unexpected EDMS search response shape", "parse");
  }
  const headings: string[] = Array.isArray(json.DisplayColumns)
    ? json.DisplayColumns.map((c) => (isRecord(c) && typeof c.Heading === "string" ? c.Heading : ""))
    : [];

  const rows: EdmsRow[] = [];
  for (const raw of json.Data) {
    if (!isRecord(raw) || typeof raw.ID !== "string") continue;
    const values = Array.isArray(raw.DisplayColumnValues) ? raw.DisplayColumnValues : [];
    const columns: Record<string, string> = {};
    headings.forEach((heading, i) => {
      if (!heading) return;
      const cell = values[i];
      const value = isRecord(cell) && typeof cell.Value === "string" ? cell.Value : "";
      columns[heading] = value.trim();
    });
    rows.push({ id: raw.ID, name: typeof raw.Name === "string" ? raw.Name : "", columns });
  }
  return { rows, truncated: json.Truncated === true };
}

/** `POST {base}/CustomQuery/KeywordSearch` — keywords AND together, `*` wildcard. */
export async function searchKeywords(
  archive: EdmsArchiveConfig,
  keywords: EdmsKeyword[],
  signal?: AbortSignal,
): Promise<EdmsSearchResult> {
  const body = {
    QueryID: archive.queryId,
    Keywords: keywords.map((k) => ({ ID: k.id, Value: k.value, KeywordOperator: "=" })),
    FromDate: null,
    ToDate: null,
    QueryLimit: EDMS_QUERY_LIMIT,
  };
  const res = await fetchWithRetry(
    `${archive.base}/CustomQuery/KeywordSearch`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    },
    EDMS_TIMEOUT_MS,
    signal,
  );
  if (!res.ok) {
    throw new EdmsError(`EDMS search failed (${res.status})`, "http", res.status);
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    throw new EdmsError(`EDMS search returned non-JSON: ${errorMessage(err)}`, "parse");
  }
  return parseSearchResponse(json);
}

/** `{base}/Document/{encodeURIComponent(id)}/` — the ID is never used raw. */
export function documentUrl(archive: EdmsArchiveConfig, documentId: string): string {
  return `${archive.base}/Document/${encodeURIComponent(documentId)}/`;
}

/** `POST` with `{}` returns size + viewer mode — a HEAD-equivalent before downloading. */
export async function getDocumentInfo(
  archive: EdmsArchiveConfig,
  documentId: string,
  signal?: AbortSignal,
): Promise<EdmsDocumentInfo> {
  const res = await fetchWithRetry(
    documentUrl(archive, documentId),
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: "{}",
    },
    EDMS_TIMEOUT_MS,
    signal,
  );
  if (!res.ok) {
    throw new EdmsError(`EDMS document info failed (${res.status})`, "http", res.status);
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    throw new EdmsError(`EDMS document info returned non-JSON: ${errorMessage(err)}`, "parse");
  }
  if (!isRecord(json) || typeof json.Size !== "number") {
    throw new EdmsError("EDMS document info missing Size", "parse");
  }
  return {
    size: json.Size,
    viewerMode: typeof json.ViewerMode === "string" ? json.ViewerMode : "",
    isAboveDownloadThreshold: json.IsAboveDownloadThreshold === true,
  };
}

function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
  return match ? decodeURIComponent(match[1].trim()) : null;
}

/** `GET` the PDF. Buffers the whole body (callers gate size at 25 MB first). */
export async function fetchDocumentBytes(
  archive: EdmsArchiveConfig,
  documentId: string,
  signal?: AbortSignal,
): Promise<EdmsDocumentBytes> {
  const res = await fetchWithRetry(
    documentUrl(archive, documentId),
    { method: "GET", headers: { Accept: "application/pdf" } },
    EDMS_DOCUMENT_TIMEOUT_MS,
    signal,
  );
  if (!res.ok) {
    throw new EdmsError(`EDMS document download failed (${res.status})`, "http", res.status);
  }
  const contentType = res.headers.get("content-type");
  const bytes = new Uint8Array(await res.arrayBuffer());
  const looksLikePdf =
    bytes.length >= 5 &&
    bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  if (!looksLikePdf) {
    throw new EdmsError(
      `EDMS returned ${contentType ?? "unknown content"} instead of a PDF`,
      "parse",
    );
  }
  return {
    bytes,
    contentType,
    filename: filenameFromDisposition(res.headers.get("content-disposition")),
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/prefill/permits/__tests__/edms-client.test.ts`
Expected: PASS (15 tests). If TypeScript complains about the JSON imports, `resolveJsonModule` is already `true` in `tsconfig.json`; the `// @vitest-environment node` pragma keeps Node's native `fetch`/`Response`/`AbortSignal.any` (jsdom's are incomplete).

- [ ] **Step 6: Commit**

```bash
git add src/lib/prefill/permits/edms-client.ts src/lib/prefill/permits/__tests__/
git commit -m "feat(prefill): OnBase EDMS JSON client with recorded fixtures"
```

---

### Task 3: Normalisers and document-type classification

**Files:**
- Create: `src/lib/prefill/permits/normalize.ts`
- Create: `src/lib/prefill/permits/doc-types.ts`
- Test: `src/lib/prefill/permits/__tests__/normalize.test.ts`
- Test: `src/lib/prefill/permits/__tests__/doc-types.test.ts`

**Interfaces:**
- Consumes: `PermitArchive` from `src/lib/prefill/types.ts`.
- Consumes: `normalizeStreetName` from phase-1 `src/lib/prefill/input.ts` (re-exported here so every permits module imports one normaliser).
- Produces (`normalize.ts`): `normalisePermitNumber(raw): string`, `normalizeStreetName(raw): string` (re-export), `normaliseStreetDir(raw): string`, `splitStreetAddress(streetAddress?: string): { number: string; dir: string; street: string }`, `normaliseSubdivision(raw): string`, `normaliseLot(raw): string`, `zip5(raw): string`, `parseUsDate(raw?: string): string | undefined`, `decodeHtmlEntities(raw): string`, `candidateKey(archive, permitNumber, docType, docDate?): string`, `isSafeKeywordValue(v): boolean`.
- Produces (`doc-types.ts`): `type DocClass`, `DOC_CLASS_RANK`, `classifyDocType(docType): DocClass`, `isAbandonmentDocType(docType): boolean`, `isExtractableDocType(docType): boolean`, `deriveEplpavDocType(subtype, fileName): string`, `rankForExtraction<T extends { docType: string; docDate?: string }>(docs: T[]): T[]`.

- [ ] **Step 1: Write the failing normaliser test**

```ts
// src/lib/prefill/permits/__tests__/normalize.test.ts
import { describe, expect, it } from "vitest";
import {
  candidateKey,
  decodeHtmlEntities,
  isSafeKeywordValue,
  normaliseLot,
  normalisePermitNumber,
  normaliseStreetDir,
  normalizeStreetName,
  normaliseSubdivision,
  parseUsDate,
  splitStreetAddress,
  zip5,
} from "../normalize";

describe("normalisePermitNumber", () => {
  it("strips punctuation and uppercases so OW-17-00474 ≡ OW1700474", () => {
    expect(normalisePermitNumber("OW-17-00474")).toBe("OW1700474");
    expect(normalisePermitNumber("ow1700474")).toBe("OW1700474");
    expect(normalisePermitNumber(" 000972 ")).toBe("000972");
  });
});

describe("normalizeStreetName (re-exported from phase-1 input.ts)", () => {
  it("uppercases and strips a trailing suffix", () => {
    expect(normalizeStreetName("Cave Creek Rd")).toBe("CAVE CREEK");
    expect(normalizeStreetName("CAVE CREEK ROAD")).toBe("CAVE CREEK");
    expect(normalizeStreetName("Princess Dr.")).toBe("PRINCESS");
    expect(normalizeStreetName("Sunland Avenue")).toBe("SUNLAND");
    expect(normalizeStreetName("Villa Chula")).toBe("VILLA CHULA");
    expect(normalizeStreetName("95th")).toBe("95TH");
  });

  it("strips a leading direction token if the caller left it in", () => {
    expect(normalizeStreetName("E Cave Creek Rd")).toBe("CAVE CREEK");
    expect(normalizeStreetName("W Villa Chula")).toBe("VILLA CHULA");
  });

  it("never strips the only token", () => {
    expect(normalizeStreetName("Way")).toBe("WAY");
    expect(normalizeStreetName("E")).toBe("E");
  });
});

describe("normaliseStreetDir", () => {
  it("maps spelled-out and abbreviated directions to N/S/E/W/NE/NW/SE/SW", () => {
    expect(normaliseStreetDir("e")).toBe("E");
    expect(normaliseStreetDir("West")).toBe("W");
    expect(normaliseStreetDir("NW")).toBe("NW");
    expect(normaliseStreetDir("")).toBe("");
    expect(normaliseStreetDir("Cave")).toBe("");
  });
});

describe("splitStreetAddress", () => {
  it("splits number / direction / street", () => {
    expect(splitStreetAddress("8911 E CAVE CREEK RD")).toEqual({
      number: "8911",
      dir: "E",
      street: "CAVE CREEK RD",
    });
    expect(splitStreetAddress("11425 Cottontail")).toEqual({
      number: "11425",
      dir: "",
      street: "COTTONTAIL",
    });
    expect(splitStreetAddress(undefined)).toEqual({ number: "", dir: "", street: "" });
  });
});

describe("normaliseSubdivision / normaliseLot / zip5", () => {
  it("treats SUNRISE 4 and SUNRISE UNIT 4 as the same subdivision", () => {
    expect(normaliseSubdivision("SUNRISE 4")).toBe(normaliseSubdivision("Sunrise Unit 4"));
  });
  it("drops leading zeros on lots and keeps letters", () => {
    expect(normaliseLot("002")).toBe("2");
    expect(normaliseLot("19A")).toBe("19A");
  });
  it("keeps only the 5-digit ZIP", () => {
    expect(zip5("85087-8650")).toBe("85087");
    expect(zip5(" 85383 ")).toBe("85383");
  });
});

describe("parseUsDate", () => {
  it("converts M/D/YYYY to ISO and passes ISO through", () => {
    expect(parseUsDate("9/11/2015")).toBe("2015-09-11");
    expect(parseUsDate("11/21/2025")).toBe("2025-11-21");
    expect(parseUsDate("2025-11-21")).toBe("2025-11-21");
  });
  it("returns undefined for blank or garbage", () => {
    expect(parseUsDate("")).toBeUndefined();
    expect(parseUsDate(undefined)).toBeUndefined();
    expect(parseUsDate("13/45/2025")).toBeUndefined();
    expect(parseUsDate("soon")).toBeUndefined();
  });
});

describe("decodeHtmlEntities", () => {
  it("decodes the entities EDMS emits and collapses CRLF runs", () => {
    expect(
      decodeHtmlEntities("&lt;3000 Gal/Day | Abandon &amp; Install\r\n\r\nmissing &#39;coc&#39;"),
    ).toBe("<3000 Gal/Day | Abandon & Install missing 'coc'");
  });
});

describe("candidateKey", () => {
  it("follows the shared-contract format archive:permit:docType:date", () => {
    expect(candidateKey("edms_env", "OW-17-00474", "PERMIT", "2018-02-08")).toBe(
      "edms_env:OW-17-00474:PERMIT:2018-02-08",
    );
    expect(candidateKey("edms_eplpav", "OW-24-00070", "FINAL DA", undefined)).toBe(
      "edms_eplpav:OW-24-00070:FINAL DA:",
    );
  });
});

describe("isSafeKeywordValue", () => {
  it("accepts printable ASCII up to 200 chars and rejects the rest", () => {
    expect(isSafeKeywordValue("8911")).toBe(true);
    expect(isSafeKeywordValue("CAVE CREEK*")).toBe(true);
    expect(isSafeKeywordValue("")).toBe(false);
    expect(isSafeKeywordValue("a".repeat(201))).toBe(false);
    expect(isSafeKeywordValue("café")).toBe(false);
    expect(isSafeKeywordValue("line\nbreak")).toBe(false);
  });
});
```

- [ ] **Step 2: Write the failing doc-types test**

```ts
// src/lib/prefill/permits/__tests__/doc-types.test.ts
import { describe, expect, it } from "vitest";
import {
  classifyDocType,
  deriveEplpavDocType,
  isAbandonmentDocType,
  isExtractableDocType,
  rankForExtraction,
} from "../doc-types";

describe("classifyDocType", () => {
  it("maps legacy env doc types", () => {
    expect(classifyDocType("PERMIT")).toBe("permit");
    expect(classifyDocType("PERMIT SUB")).toBe("permit_sub");
    expect(classifyDocType("NOTICE OF TRANSFER")).toBe("notice_of_transfer");
    expect(classifyDocType("ABANDONMENT")).toBe("abandonment");
    expect(classifyDocType("PLAN REVIEW")).toBe("plan_review");
    expect(classifyDocType("SUB")).toBe("plan_review");
  });

  it("maps ePLPAV-derived types", () => {
    expect(classifyDocType("FINAL DA")).toBe("permit");
    expect(classifyDocType("Discharge Authorization")).toBe("permit");
    expect(classifyDocType("WELL")).toBe("other");
  });
});

describe("deriveEplpavDocType", () => {
  it("uses the File Name suffix for ONSITE PERMIT rows", () => {
    expect(deriveEplpavDocType("ONSITE PERMIT", "OW-24-00070 FINAL DA")).toBe("FINAL DA");
    expect(deriveEplpavDocType("ONSITE PERMIT", "OW-20-01479 DA FINAL")).toBe("FINAL DA");
    expect(deriveEplpavDocType("ONSITE PERMIT", "00964 DA")).toBe("FINAL DA");
    expect(deriveEplpavDocType("ONSITE PERMIT", "FINAL DA.PDF")).toBe("FINAL DA");
    expect(deriveEplpavDocType("ONSITE PERMIT", "")).toBe("PERMIT");
  });

  it("maps review subtypes", () => {
    expect(deriveEplpavDocType("NOTICE OF TRANSFER", "Notice of Transfer of Ownership OWR-24-02002")).toBe(
      "NOTICE OF TRANSFER",
    );
    expect(deriveEplpavDocType("ABANDONMENT", "OWR-22-01512 ABANDONMENT FINAL APPROVED")).toBe(
      "ABANDONMENT",
    );
    expect(deriveEplpavDocType("MINOR REVIEW/REMODEL", "")).toBe("PLAN REVIEW");
    expect(deriveEplpavDocType("PND REVIEW", "")).toBe("PLAN REVIEW");
    expect(deriveEplpavDocType("WELL", "")).toBe("WELL");
    expect(deriveEplpavDocType("", "")).toBe("OTHER");
  });
});

describe("isAbandonmentDocType / isExtractableDocType", () => {
  it("flags abandonment and excludes plan reviews from extraction", () => {
    expect(isAbandonmentDocType("ABANDONMENT")).toBe(true);
    expect(isAbandonmentDocType("PERMIT")).toBe(false);
    expect(isExtractableDocType("PERMIT")).toBe(true);
    expect(isExtractableDocType("NOTICE OF TRANSFER")).toBe(true);
    expect(isExtractableDocType("ABANDONMENT")).toBe(true);
    expect(isExtractableDocType("PLAN REVIEW")).toBe(false);
    expect(isExtractableDocType("WELL")).toBe(false);
  });
});

describe("rankForExtraction", () => {
  it("orders PERMIT/FINAL DA (newest first) → PERMIT SUB → NOT → ABANDONMENT → PLAN REVIEW", () => {
    const docs = [
      { id: "plan", docType: "PLAN REVIEW", docDate: "2024-01-01" },
      { id: "not", docType: "NOTICE OF TRANSFER", docDate: "2022-09-21" },
      { id: "old-permit", docType: "PERMIT", docDate: "2015-09-11" },
      { id: "aband", docType: "ABANDONMENT", docDate: "2025-04-14" },
      { id: "sub", docType: "PERMIT SUB", docDate: "2019-01-01" },
      { id: "new-da", docType: "FINAL DA", docDate: "2025-11-21" },
      { id: "undated-permit", docType: "PERMIT" },
    ];
    expect(rankForExtraction(docs).map((d) => d.id)).toEqual([
      "new-da",
      "old-permit",
      "undated-permit",
      "sub",
      "not",
      "aband",
      "plan",
    ]);
  });

  it("does not mutate the input", () => {
    const docs = [{ docType: "ABANDONMENT" }, { docType: "PERMIT" }];
    rankForExtraction(docs);
    expect(docs[0].docType).toBe("ABANDONMENT");
  });
});
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `npx vitest run src/lib/prefill/permits/__tests__/normalize.test.ts src/lib/prefill/permits/__tests__/doc-types.test.ts`
Expected: FAIL — cannot find `../normalize` / `../doc-types`.

- [ ] **Step 4: Write `normalize.ts`**

```ts
// src/lib/prefill/permits/normalize.ts
/**
 * Pure string normalisers shared by the EDMS search, scoring, candidate
 * keys and the candidate picker UI. No imports from server-only modules so
 * the client component and the smoke script can use them too.
 */

import type { PermitArchive } from "../types";

/** "OW-17-00474" ≡ "OW1700474" ≡ "ow-17-00474" */
export function normalisePermitNumber(raw: string): string {
  return raw.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

// Phase 1 already normalises street names for the assessor query (uppercase,
// drop leading direction + trailing suffix — a superset of the spec's list).
// One implementation, re-exported so the permits code and the UI share it.
export { normalizeStreetName } from "../input";

const DIRECTIONS: Record<string, string> = {
  N: "N", S: "S", E: "E", W: "W", NE: "NE", NW: "NW", SE: "SE", SW: "SW",
  NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W",
  NORTHEAST: "NE", NORTHWEST: "NW", SOUTHEAST: "SE", SOUTHWEST: "SW",
};

function tokens(raw: string): string[] {
  return raw.toUpperCase().replace(/[^0-9A-Z ]+/g, " ").split(/\s+/).filter(Boolean);
}

/** "east" → "E"; anything that is not a direction → "" */
export function normaliseStreetDir(raw: string): string {
  const t = raw.trim().toUpperCase().replace(/\./g, "");
  return DIRECTIONS[t] ?? "";
}

/** "8911 E CAVE CREEK RD" → { number: "8911", dir: "E", street: "CAVE CREEK RD" } */
export function splitStreetAddress(streetAddress?: string): {
  number: string;
  dir: string;
  street: string;
} {
  const parts = tokens(streetAddress ?? "");
  if (parts.length === 0) return { number: "", dir: "", street: "" };
  const number = /^\d/.test(parts[0]) ? (parts.shift() as string) : "";
  const dir = parts.length > 1 && DIRECTIONS[parts[0]] ? (parts.shift() as string) : "";
  return { number, dir, street: parts.join(" ") };
}

/** "SUNRISE 4" ≡ "SUNRISE UNIT 4" — uppercase, drop the word UNIT, keep alphanumerics */
export function normaliseSubdivision(raw: string): string {
  return raw.toUpperCase().replace(/\bUNIT\b/g, "").replace(/[^0-9A-Z]/g, "");
}

/** "002" → "2", "19A" → "19A" */
export function normaliseLot(raw: string): string {
  return raw.toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/^0+(?=\d)/, "");
}

/** "85087-8650" → "85087" */
export function zip5(raw: string): string {
  const match = /\d{5}/.exec(raw);
  return match ? match[0] : "";
}

/** "9/11/2015" → "2015-09-11"; ISO passes through; anything else → undefined */
export function parseUsDate(raw?: string): string | undefined {
  if (!raw) return undefined;
  const value = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (!match) return undefined;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  return `${match[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** EDMS descriptions carry `&lt;`, `&amp;`, `&#39;` and CRLF runs */
export function decodeHtmlEntities(raw: string): string {
  return raw
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Shared-contract key: `${archive}:${permitNumber}:${docType}:${docDate ?? ""}` */
export function candidateKey(
  archive: PermitArchive,
  permitNumber: string,
  docType: string,
  docDate?: string,
): string {
  return `${archive}:${permitNumber}:${docType}:${docDate ?? ""}`;
}

/** Only printable ASCII, 1–200 chars, may be placed in an EDMS keyword value */
export function isSafeKeywordValue(value: string): boolean {
  return value.length > 0 && value.length <= 200 && /^[\x20-\x7E]+$/.test(value);
}
```

- [ ] **Step 5: Write `doc-types.ts`**

```ts
// src/lib/prefill/permits/doc-types.ts
/**
 * Document-type vocabulary across both EDMS archives and the extraction
 * ranking from spec §5.2 step 3.
 *
 * Legacy `env` rows carry `EnvSepticDocType` (PERMIT, PERMIT SUB, NOTICE OF
 * TRANSFER, ABANDONMENT, PLAN REVIEW, SUB). ePLPAV rows have no such column;
 * `deriveEplpavDocType` builds one from `Permit Subtype` + `File Name`
 * (686/1000 ONSITE PERMIT rows in the recording are "… FINAL DA", 277 have an
 * empty File Name).
 */

export type DocClass =
  | "permit"
  | "permit_sub"
  | "notice_of_transfer"
  | "abandonment"
  | "plan_review"
  | "other";

/** Lower ranks are extracted first */
export const DOC_CLASS_RANK: Record<DocClass, number> = {
  permit: 0,
  permit_sub: 1,
  notice_of_transfer: 2,
  abandonment: 3,
  plan_review: 4,
  other: 5,
};

export function classifyDocType(docType: string): DocClass {
  const t = docType.toUpperCase().trim();
  if (t.includes("ABANDON")) return "abandonment";
  if (t.includes("TRANSFER") || t === "NOT") return "notice_of_transfer";
  if (t === "PERMIT SUB") return "permit_sub";
  if (
    t.includes("PLAN REVIEW") ||
    t === "SUB" ||
    t.includes("MINOR REVIEW") ||
    t.includes("PND") ||
    t.includes("P&D")
  ) {
    return "plan_review";
  }
  if (
    t === "PERMIT" ||
    t.includes("FINAL DA") ||
    t.includes("DA FINAL") ||
    t === "DA" ||
    t.includes("DISCHARGE")
  ) {
    return "permit";
  }
  return "other";
}

export function isAbandonmentDocType(docType: string): boolean {
  return classifyDocType(docType) === "abandonment";
}

/** PLAN REVIEW / SUB / unknown types are stored but never sent to extraction */
export function isExtractableDocType(docType: string): boolean {
  const cls = classifyDocType(docType);
  return cls !== "plan_review" && cls !== "other";
}

export function deriveEplpavDocType(subtype: string, fileName: string): string {
  const sub = subtype.toUpperCase().trim();
  const name = fileName.toUpperCase();
  switch (sub) {
    case "ONSITE PERMIT":
      return /\bDA\b/.test(name) ? "FINAL DA" : "PERMIT";
    case "NOTICE OF TRANSFER":
      return "NOTICE OF TRANSFER";
    case "ABANDONMENT":
      return "ABANDONMENT";
    case "MINOR REVIEW/REMODEL":
    case "PND REVIEW":
      return "PLAN REVIEW";
    default:
      return sub || "OTHER";
  }
}

/** Stable: class rank ascending, then docDate descending (undated last). Returns a copy. */
export function rankForExtraction<T extends { docType: string; docDate?: string }>(docs: T[]): T[] {
  return docs
    .map((doc, index) => ({ doc, index }))
    .sort((a, b) => {
      const rank = DOC_CLASS_RANK[classifyDocType(a.doc.docType)] - DOC_CLASS_RANK[classifyDocType(b.doc.docType)];
      if (rank !== 0) return rank;
      const da = a.doc.docDate ?? "";
      const db = b.doc.docDate ?? "";
      if (da !== db) return da > db ? -1 : 1;
      return a.index - b.index;
    })
    .map(({ doc }) => doc);
}
```

- [ ] **Step 6: Run both tests to verify they pass**

Run: `npx vitest run src/lib/prefill/permits/__tests__/normalize.test.ts src/lib/prefill/permits/__tests__/doc-types.test.ts`
Expected: PASS (normalize 14 tests, doc-types 7 tests).

- [ ] **Step 7: Commit**

```bash
git add src/lib/prefill/permits/normalize.ts src/lib/prefill/permits/doc-types.ts src/lib/prefill/permits/__tests__/normalize.test.ts src/lib/prefill/permits/__tests__/doc-types.test.ts
git commit -m "feat(prefill): permit/street normalisers and EDMS doc-type ranking"
```

---

### Task 4: EDMS rows → `PermitCandidate`

**Files:**
- Create: `src/lib/prefill/permits/candidates.ts`
- Test: `src/lib/prefill/permits/__tests__/candidates.test.ts`

**Interfaces:**
- Consumes: `PermitCandidate` (`src/lib/prefill/types.ts`); `EdmsArchiveConfig`, `EdmsRow`, `parseSearchResponse` (Task 2); `candidateKey`, `decodeHtmlEntities`, `normaliseStreetDir`, `parseUsDate` (Task 3); `deriveEplpavDocType` (Task 3).
- Produces: `interface SearchHit { candidate: PermitCandidate; documentId: string }` (the `documentId` is the ephemeral EDMS token — it lives only in memory for the run), `rowToCandidate(archive: EdmsArchiveConfig, row: EdmsRow): PermitCandidate | null`, `rowsToHits(archive: EdmsArchiveConfig, rows: EdmsRow[]): SearchHit[]`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/prefill/permits/__tests__/candidates.test.ts
import { describe, expect, it } from "vitest";
import { rowToCandidate, rowsToHits } from "../candidates";
import { EDMS_ARCHIVES, parseSearchResponse } from "../edms-client";
import envParcel from "./fixtures/env-parcel-200-08-079.json";
import envSingle from "./fixtures/env-parcel-219-11-121.json";
import eplNoSuffix from "./fixtures/eplpav-ow-nosuffix.json";
import eplOwr from "./fixtures/eplpav-owr-sample.json";
import eplParcel from "./fixtures/eplpav-parcel-219-12-165.json";

describe("rowToCandidate (env)", () => {
  it("maps the legacy columns, derives the date from Name and builds the key", () => {
    const [row] = parseSearchResponse(envParcel).rows;
    expect(rowToCandidate(EDMS_ARCHIVES.env, row)).toEqual({
      key: "edms_env:OW-17-00474:PERMIT:2018-02-08",
      archive: "edms_env",
      permitNumber: "OW-17-00474",
      docType: "PERMIT",
      docDate: "2018-02-08",
      description: "EnvSeptic - 2/8/2018 - OW-17-00474 - PERMIT",
      streetAddress: "8911 W VILLA CHULA",
      city: "PEORIA",
      zip: "85383",
      subdivision: "SUNRISE 4",
      lot: "2",
      apn: "200-08-079",
      score: 0,
    });
  });

  it("leaves blank columns undefined", () => {
    const [row] = parseSearchResponse(envSingle).rows;
    const c = rowToCandidate(EDMS_ARCHIVES.env, row);
    expect(c?.zip).toBeUndefined();
    expect(c?.lot).toBeUndefined();
    expect(c?.subdivision).toBeUndefined();
    expect(c?.apn).toBe("219-11-121");
    expect(c?.streetAddress).toBe("8911 E CAVE CREEK RD");
  });

  it("returns null when the permit number is missing", () => {
    const [row] = parseSearchResponse(envSingle).rows;
    expect(
      rowToCandidate(EDMS_ARCHIVES.env, { ...row, columns: { ...row.columns, EnvPermitNumber: "" } }),
    ).toBeNull();
  });
});

describe("rowToCandidate (eplpav)", () => {
  it("derives FINAL DA, uses Closed Date, decodes the description and uppercases the address", () => {
    const [row] = parseSearchResponse(eplParcel).rows;
    const c = rowToCandidate(EDMS_ARCHIVES.eplpav, row);
    expect(c).toMatchObject({
      key: "edms_eplpav:OW-24-00070:FINAL DA:2025-11-21",
      archive: "edms_eplpav",
      permitNumber: "OW-24-00070",
      docType: "FINAL DA",
      docDate: "2025-11-21",
      streetAddress: "11425 COTTONTAIL",
      city: "Cave Creek",
      zip: "85331",
      apn: "219-12-165",
      score: 0,
    });
    expect(c?.description).toMatch(/^Standard, New, Septic Tank with Additional Alternative Elements/);
    expect(c?.description?.length).toBeLessThanOrEqual(300);
  });

  it("falls back to PERMIT + Issued Date when File Name and Closed Date are empty", () => {
    const [row] = parseSearchResponse(eplNoSuffix).rows;
    expect(rowToCandidate(EDMS_ARCHIVES.eplpav, row)).toMatchObject({
      key: "edms_eplpav:OW-21-01552:PERMIT:2024-11-27",
      docType: "PERMIT",
      docDate: "2024-11-27",
      streetAddress: "38174 TRANQUIL",
    });
  });

  it("maps ABANDONMENT / NOTICE OF TRANSFER / PLAN REVIEW rows and decodes entities", () => {
    const rows = parseSearchResponse(eplOwr).rows;
    const [abandonment, transfer, minor] = rows.map((r) => rowToCandidate(EDMS_ARCHIVES.eplpav, r));
    expect(abandonment?.docType).toBe("ABANDONMENT");
    expect(abandonment?.description).toContain("<3000 Gal/Day | Abandon FAILING System & Install");
    expect(transfer?.docType).toBe("NOTICE OF TRANSFER");
    expect(transfer?.docDate).toBe("2024-06-12"); // no closed/issued date → application date
    expect(minor?.docType).toBe("PLAN REVIEW");
  });
});

describe("rowsToHits", () => {
  it("keeps the ephemeral document ID next to each candidate and drops unmappable rows", () => {
    const rows = parseSearchResponse(envParcel).rows;
    const hits = rowsToHits(EDMS_ARCHIVES.env, rows);
    expect(hits).toHaveLength(2);
    expect(hits[0].documentId).toBe(envParcel.Data[0].ID);
    expect(hits[1].candidate.permitNumber).toBe("OWR-22-04475");
    expect(rowsToHits(EDMS_ARCHIVES.env, [{ id: "x", name: "", columns: {} }])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/prefill/permits/__tests__/candidates.test.ts`
Expected: FAIL — `Cannot find module '../candidates'`.

- [ ] **Step 3: Write `candidates.ts`**

```ts
// src/lib/prefill/permits/candidates.ts
/**
 * Converts heading-keyed EDMS rows into the shared `PermitCandidate` shape.
 * The ephemeral document token travels alongside as `SearchHit.documentId`
 * and is never written anywhere.
 */

import type { PermitCandidate } from "../types";
import { deriveEplpavDocType } from "./doc-types";
import type { EdmsArchiveConfig, EdmsRow } from "./edms-client";
import { candidateKey, decodeHtmlEntities, normaliseStreetDir, parseUsDate } from "./normalize";

export interface SearchHit {
  candidate: PermitCandidate;
  /** Ephemeral EDMS token — in-memory only, never persisted */
  documentId: string;
}

const ENV_NAME_DATE = /^EnvSeptic - (\d{1,2}\/\d{1,2}\/\d{4}) - /;

function orUndefined(value: string | undefined): string | undefined {
  return value ? value : undefined;
}

function envCandidate(archive: EdmsArchiveConfig, row: EdmsRow): PermitCandidate | null {
  const c = row.columns;
  const permitNumber = c.EnvPermitNumber;
  if (!permitNumber) return null;
  const docType = c.EnvSepticDocType || "PERMIT";
  const docDate = parseUsDate(ENV_NAME_DATE.exec(row.name)?.[1]);
  const streetAddress = [c.EnvStreetNo, normaliseStreetDir(c.EnvStreetDir ?? ""), c.EnvStreet]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();
  return {
    key: candidateKey(archive.archive, permitNumber, docType, docDate),
    archive: archive.archive,
    permitNumber,
    docType,
    docDate,
    description: orUndefined(row.name),
    streetAddress: orUndefined(streetAddress),
    city: orUndefined(c.EnvCity),
    zip: orUndefined(c.EnvZip),
    subdivision: orUndefined(c.EnvSubdivision),
    lot: orUndefined(c.EnvLotNumber),
    apn: orUndefined(c.ParcelNumber),
    score: 0,
  };
}

function eplpavCandidate(archive: EdmsArchiveConfig, row: EdmsRow): PermitCandidate | null {
  const c = row.columns;
  const permitNumber = c["Permit Number"];
  if (!permitNumber) return null;
  const docType = deriveEplpavDocType(c["Permit Subtype"] ?? "", c["File Name"] ?? "");
  const docDate =
    parseUsDate(c["Closed Date"]) ?? parseUsDate(c["Issued Date"]) ?? parseUsDate(c["Application Date"]);
  const description = decodeHtmlEntities(c.Description ?? "").slice(0, 300);
  const streetAddress = [c["Address Line 1"], c["Address Line 2"]]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();
  return {
    key: candidateKey(archive.archive, permitNumber, docType, docDate),
    archive: archive.archive,
    permitNumber,
    docType,
    docDate,
    description: orUndefined(description),
    streetAddress: orUndefined(streetAddress),
    city: orUndefined(c.City),
    zip: orUndefined(c["ZIP Code"]),
    subdivision: orUndefined(c["Subdivision (For Septic Only)"]),
    lot: orUndefined(c["LotNumber (For Septic Only)"]),
    apn: orUndefined(c["Parcel Number"]),
    score: 0,
  };
}

export function rowToCandidate(archive: EdmsArchiveConfig, row: EdmsRow): PermitCandidate | null {
  return archive.id === "env" ? envCandidate(archive, row) : eplpavCandidate(archive, row);
}

export function rowsToHits(archive: EdmsArchiveConfig, rows: EdmsRow[]): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const row of rows) {
    const candidate = rowToCandidate(archive, row);
    if (candidate) hits.push({ candidate, documentId: row.id });
  }
  return hits;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/prefill/permits/__tests__/candidates.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/prefill/permits/candidates.ts src/lib/prefill/permits/__tests__/candidates.test.ts
git commit -m "feat(prefill): map EDMS rows to PermitCandidate with ephemeral document IDs"
```

---

### Task 5: Permit search — APN on both archives, street fallback, scoring

**Files:**
- Create: `src/lib/prefill/permits/search.ts`
- Test: `src/lib/prefill/permits/__tests__/search.test.ts`

**Interfaces:**
- Consumes: `PrefillInput`, `PermitCandidate` (`types.ts`); `formatApn` (Task 1); `EDMS_ARCHIVES`, `searchKeywords`, `EdmsArchiveConfig`, `EdmsKeyword`, `EdmsSearchResult` (Task 2); normalisers (Task 3); `SearchHit`, `rowsToHits` (Task 4).
- Produces:
  ```ts
  export type PermitSearchOutcome =
    | { kind: "found"; via: "apn" | "street"; hits: SearchHit[]; searched: string[] }
    | { kind: "ambiguous"; hits: SearchHit[]; searched: string[] }
    | { kind: "not_found"; searched: string[] }
    | { kind: "error"; message: string; searched: string[] };
  export interface SearchDeps { search: (archive: EdmsArchiveConfig, keywords: EdmsKeyword[], signal?: AbortSignal) => Promise<EdmsSearchResult> }
  export const AUTO_SELECT_MIN_SCORE = 5, AUTO_SELECT_MIN_GAP = 3, MAX_CANDIDATES = 8, APN_MATCH_SCORE = 10;
  export const EDMS_UNAVAILABLE_MESSAGE = "Maricopa EDMS unavailable — try Find records later";
  export function scoreCandidate(candidate: PermitCandidate, input: PrefillInput): number;
  export function dedupeHits(hits: SearchHit[]): SearchHit[];
  export function propertyGroupKey(candidate: PermitCandidate): string;
  export function decideFallback(hits: SearchHit[], input: PrefillInput): { kind: "found" | "ambiguous"; hits: SearchHit[] };
  export function searchPermits(input: PrefillInput, signal: AbortSignal, deps?: SearchDeps): Promise<PermitSearchOutcome>;
  ```
  `searched` holds the human-readable terms for the tile copy (`"APN 219-11-121"`, `"8911 CAVE CREEK"`).

**Design notes (decisions the spec leaves open):**
- *Dedupe key* is `normalisePermitNumber + ":" + docType + ":" + docDate`, not the permit number alone: an approval scan in `env` and a FINAL DA in `eplpav` for the same permit are two different documents and both must survive. `env` wins ties.
- *Grouping for auto-select*: rows are grouped by property (`propertyGroupKey` = normalised street + number + direction + city + ZIP + APN) and the score/gap rule is applied to **groups**, so a property's PERMIT + NOTICE OF TRANSFER (identical scores) auto-selects as a set instead of tying itself into `awaiting_selection`. Candidates shown to the user are still individual documents (at most 8).
- An APN on the row that **equals** ours adds `APN_MATCH_SCORE` (10). A different APN scores `-Infinity` (spec).
- Defensive street filter: rows whose normalised street does not start with our normalised street name, or whose number differs, are dropped even if EDMS returned them.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/prefill/permits/__tests__/search.test.ts
// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { PrefillInput } from "../../types";
import { rowsToHits } from "../candidates";
import {
  EDMS_ARCHIVES,
  type EdmsArchiveConfig,
  type EdmsKeyword,
  parseSearchResponse,
} from "../edms-client";
import { decideFallback, dedupeHits, scoreCandidate, searchPermits } from "../search";
import env200 from "./fixtures/env-parcel-200-08-079.json";
import env219 from "./fixtures/env-parcel-219-11-121.json";
import envStreet from "./fixtures/env-street-8911.json";
import eplEmpty from "./fixtures/eplpav-empty.json";
import eplParcel from "./fixtures/eplpav-parcel-219-12-165.json";

const signal = new AbortController().signal;

/** Fake `searchKeywords`: routes by archive + whether the APN keyword is present */
function fakeSearch(responses: {
  envApn?: unknown;
  eplApn?: unknown;
  envStreet?: unknown;
  eplStreet?: unknown;
}) {
  return vi.fn(async (archive: EdmsArchiveConfig, keywords: EdmsKeyword[]) => {
    const isApn = keywords.some((k) => k.id === archive.keywords.apn);
    const pick =
      archive.id === "env"
        ? isApn
          ? responses.envApn
          : responses.envStreet
        : isApn
          ? responses.eplApn
          : responses.eplStreet;
    if (pick instanceof Error) throw pick;
    return parseSearchResponse(pick ?? eplEmpty);
  });
}

const caveCreek: PrefillInput = {
  apn: "219-11-121",
  address: {
    streetNumber: "8911",
    streetName: "Cave Creek Rd",
    streetDir: "E",
    city: "Carefree",
    zip: "85377",
  },
};

const princess = (apn?: string): PrefillInput => ({
  apn,
  address: { streetNumber: "8911", streetName: "Princess Dr", streetDir: "E", city: "Mesa", zip: "85207" },
});

describe("scoreCandidate", () => {
  const streetHits = rowsToHits(EDMS_ARCHIVES.env, parseSearchResponse(envStreet).rows);
  const byPermit = (n: string) => {
    const hit = streetHits.find((h) => h.candidate.permitNumber === n);
    if (!hit) throw new Error(`fixture missing ${n}`);
    return hit.candidate;
  };

  it("adds direction, city and ZIP points", () => {
    // OWR-20-04198: 8911 E PRINCESS DR, MESA 85207, no APN -> 3 + 2 + 2
    expect(scoreCandidate(byPermit("OWR-20-04198"), princess())).toBe(7);
    // 743691: 8911 E PRINCESS, no city/zip -> direction only
    expect(scoreCandidate(byPermit("743691"), princess())).toBe(3);
  });

  it("returns -Infinity when the row's APN differs from ours", () => {
    expect(scoreCandidate(byPermit("OWR-22-01478"), princess("999-99-999"))).toBe(-Infinity);
  });

  it("adds APN_MATCH_SCORE when the row's APN equals ours", () => {
    expect(scoreCandidate(byPermit("OWR-22-01478"), princess("218-06-099A"))).toBe(17);
  });

  it("adds subdivision and lot points, tolerating 'UNIT'", () => {
    const input: PrefillInput = {
      address: {
        streetNumber: "8911",
        streetName: "Villa Chula",
        streetDir: "W",
        city: "Peoria",
        zip: "85383",
      },
      subdivision: "Sunrise Unit 4",
      lot: "2",
    };
    expect(scoreCandidate(byPermit("OW-17-00474"), input)).toBe(3 + 2 + 2 + 3 + 2);
  });
});

describe("dedupeHits", () => {
  it("drops a second copy of the same permit/docType/date and prefers env", () => {
    const envHits = rowsToHits(EDMS_ARCHIVES.env, parseSearchResponse(env200).rows);
    const duplicate = {
      candidate: {
        ...envHits[0].candidate,
        archive: "edms_eplpav" as const,
        permitNumber: "ow1700474",
      },
      documentId: "other-token",
    };
    const result = dedupeHits([duplicate, ...envHits]);
    expect(result).toHaveLength(2);
    expect(result[0].candidate.archive).toBe("edms_eplpav");
    expect(dedupeHits([...envHits, duplicate])[0].candidate.archive).toBe("edms_env");
  });

  it("keeps a FINAL DA and a PERMIT for the same permit number", () => {
    const envHits = rowsToHits(EDMS_ARCHIVES.env, parseSearchResponse(env219).rows);
    const finalDa = {
      candidate: {
        ...envHits[0].candidate,
        archive: "edms_eplpav" as const,
        docType: "FINAL DA",
        docDate: "2025-11-21",
      },
      documentId: "t",
    };
    expect(dedupeHits([...envHits, finalDa])).toHaveLength(2);
  });
});

describe("decideFallback", () => {
  const streetHits = rowsToHits(EDMS_ARCHIVES.env, parseSearchResponse(envStreet).rows);
  const princessHits = streetHits.filter((h) => h.candidate.streetAddress?.includes("PRINCESS"));

  it("is ambiguous when two properties tie at the top", () => {
    const result = decideFallback(princessHits, princess());
    expect(result.kind).toBe("ambiguous");
    expect(result.hits.map((h) => h.candidate.permitNumber)).toEqual([
      "OWR-22-01478",
      "OWR-20-04198",
      "743691",
    ]);
    expect(result.hits.map((h) => h.candidate.score)).toEqual([7, 7, 3]);
  });

  it("auto-selects the whole property group when it wins by 3 or more", () => {
    const result = decideFallback(princessHits, princess("218-06-099A"));
    expect(result.kind).toBe("found");
    expect(result.hits.map((h) => h.candidate.permitNumber)).toEqual(["OWR-22-01478"]);
  });

  it("excludes APN mismatches before deciding", () => {
    const result = decideFallback(princessHits, princess("999-99-999"));
    expect(result.kind).toBe("found");
    expect(result.hits.map((h) => h.candidate.permitNumber)).toEqual(["OWR-20-04198"]);
  });

  it("keeps a property's multiple documents together", () => {
    const villaHits = streetHits.filter((h) => h.candidate.streetAddress?.includes("VILLA CHULA"));
    const result = decideFallback(villaHits, {
      address: {
        streetNumber: "8911",
        streetName: "Villa Chula",
        streetDir: "W",
        city: "Peoria",
        zip: "85383",
      },
    });
    expect(result.kind).toBe("found");
    expect(result.hits).toHaveLength(2);
  });

  it("is ambiguous when the only group scores below 5", () => {
    const only = streetHits.filter((h) => h.candidate.permitNumber === "743691");
    expect(decideFallback(only, princess()).kind).toBe("ambiguous");
  });
});

describe("searchPermits", () => {
  it("finds by APN on env, searching both archives with the dashed APN", async () => {
    const search = fakeSearch({ envApn: env219, eplApn: eplEmpty });
    const outcome = await searchPermits({ apn: "21911121" }, signal, { search });
    expect(outcome).toMatchObject({ kind: "found", via: "apn", searched: ["APN 219-11-121"] });
    if (outcome.kind !== "found") throw new Error("unreachable");
    expect(outcome.hits.map((h) => h.candidate.permitNumber)).toEqual(["000972"]);
    expect(outcome.hits[0].candidate.score).toBe(10);
    expect(search).toHaveBeenCalledTimes(2);
    expect(search).toHaveBeenCalledWith(
      EDMS_ARCHIVES.env,
      [{ id: 1264, value: "219-11-121" }],
      signal,
    );
    expect(search).toHaveBeenCalledWith(
      EDMS_ARCHIVES.eplpav,
      [{ id: 4647, value: "219-11-121" }],
      signal,
    );
  });

  it("merges APN hits from both archives", async () => {
    const search = fakeSearch({ envApn: env200, eplApn: eplParcel });
    const outcome = await searchPermits({ apn: "200-08-079" }, signal, { search });
    if (outcome.kind !== "found") throw new Error(`expected found, got ${outcome.kind}`);
    expect(outcome.hits.map((h) => h.candidate.key)).toEqual([
      "edms_env:OW-17-00474:PERMIT:2018-02-08",
      "edms_env:OWR-22-04475:NOTICE OF TRANSFER:2022-09-21",
      "edms_eplpav:OW-24-00070:FINAL DA:2025-11-21",
    ]);
  });

  it("falls back to street number + normalised street wildcard and auto-selects", async () => {
    const search = fakeSearch({
      envApn: eplEmpty,
      eplApn: eplEmpty,
      envStreet: envStreet,
      eplStreet: eplEmpty,
    });
    const outcome = await searchPermits(caveCreek, signal, { search });
    expect(outcome).toMatchObject({
      kind: "found",
      via: "street",
      searched: ["APN 219-11-121", "8911 CAVE CREEK"],
    });
    if (outcome.kind !== "found") throw new Error("unreachable");
    expect(outcome.hits.map((h) => h.candidate.permitNumber)).toEqual(["000972"]);
    expect(search).toHaveBeenCalledWith(
      EDMS_ARCHIVES.env,
      [
        { id: 1307, value: "8911" },
        { id: 1309, value: "CAVE CREEK*" },
      ],
      signal,
    );
    expect(search).toHaveBeenCalledWith(
      EDMS_ARCHIVES.eplpav,
      [
        { id: 4608, value: "8911" },
        { id: 4609, value: "CAVE CREEK*" },
      ],
      signal,
    );
  });

  it("returns ambiguous candidates (at most 8) when the street fallback ties", async () => {
    const search = fakeSearch({ envStreet: envStreet });
    const outcome = await searchPermits(princess(), signal, { search });
    expect(outcome.kind).toBe("ambiguous");
    if (outcome.kind !== "ambiguous") throw new Error("unreachable");
    expect(outcome.hits).toHaveLength(3);
    expect(outcome.searched).toEqual(["8911 PRINCESS"]);
    // APN search is skipped entirely when there is no APN
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("is not_found when both searches return nothing", async () => {
    const search = fakeSearch({});
    const outcome = await searchPermits(caveCreek, signal, { search });
    expect(outcome).toEqual({
      kind: "not_found",
      searched: ["APN 219-11-121", "8911 CAVE CREEK"],
    });
  });

  it("is not_found with no terms when there is nothing valid to search", async () => {
    const search = fakeSearch({});
    const outcome = await searchPermits(
      { apn: "nope", address: { streetNumber: "", streetName: "" } },
      signal,
      { search },
    );
    expect(outcome).toEqual({ kind: "not_found", searched: [] });
    expect(search).not.toHaveBeenCalled();
  });

  it("tolerates one archive failing when the other has rows", async () => {
    const search = fakeSearch({ envApn: env219, eplApn: new Error("boom") });
    const outcome = await searchPermits({ apn: "219-11-121" }, signal, { search });
    expect(outcome.kind).toBe("found");
  });

  it("is an error when every search attempt failed", async () => {
    const search = fakeSearch({ envApn: new Error("down"), eplApn: new Error("down") });
    const outcome = await searchPermits({ apn: "219-11-121" }, signal, { search });
    expect(outcome).toMatchObject({
      kind: "error",
      message: expect.stringContaining("Maricopa EDMS unavailable"),
    });
  });

  it("refuses a street number that is not a house number instead of sending it", async () => {
    const search = fakeSearch({});
    const outcome = await searchPermits(
      { address: { streetNumber: "8911; DROP TABLE", streetName: "Cave Creek" } },
      signal,
      { search },
    );
    expect(outcome).toEqual({ kind: "not_found", searched: [] });
    expect(search).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/prefill/permits/__tests__/search.test.ts`
Expected: FAIL — `Cannot find module '../search'`.

- [ ] **Step 3: Write `search.ts`**

```ts
// src/lib/prefill/permits/search.ts
/**
 * Spec §5.2 search algorithm:
 *   1. APN on `env` + `eplpav` in parallel -> merge -> dedupe.
 *   2. Zero rows -> street fallback (number + normalised street wildcard) on
 *      both archives -> score -> auto-select / candidates.
 *   3. Zero rows -> not_found with the searched terms.
 *
 * Pure apart from the injected `search` dependency so it is unit-tested
 * against recorded fixtures and reused by the /select continuation.
 */

import { formatApn } from "../apn";
import type { PermitCandidate, PrefillInput } from "../types";
import { type SearchHit, rowsToHits } from "./candidates";
import {
  EDMS_ARCHIVES,
  type EdmsArchiveConfig,
  type EdmsKeyword,
  type EdmsSearchResult,
  searchKeywords,
} from "./edms-client";
import {
  isSafeKeywordValue,
  normaliseLot,
  normalisePermitNumber,
  normaliseStreetDir,
  normalizeStreetName,
  normaliseSubdivision,
  splitStreetAddress,
  zip5,
} from "./normalize";

export type PermitSearchOutcome =
  | { kind: "found"; via: "apn" | "street"; hits: SearchHit[]; searched: string[] }
  | { kind: "ambiguous"; hits: SearchHit[]; searched: string[] }
  | { kind: "not_found"; searched: string[] }
  | { kind: "error"; message: string; searched: string[] };

export interface SearchDeps {
  search: (
    archive: EdmsArchiveConfig,
    keywords: EdmsKeyword[],
    signal?: AbortSignal,
  ) => Promise<EdmsSearchResult>;
}

const defaultDeps: SearchDeps = { search: searchKeywords };

export const AUTO_SELECT_MIN_SCORE = 5;
export const AUTO_SELECT_MIN_GAP = 3;
export const MAX_CANDIDATES = 8;
export const APN_MATCH_SCORE = 10;
export const EDMS_UNAVAILABLE_MESSAGE = "Maricopa EDMS unavailable — try Find records later";

/** Spec scoring table (+ APN equality bonus). -Infinity = exclude. */
export function scoreCandidate(candidate: PermitCandidate, input: PrefillInput): number {
  const ourApn = formatApn(input.apn);
  let score = 0;
  if (candidate.apn) {
    const theirApn = formatApn(candidate.apn);
    if (ourApn && theirApn && theirApn !== ourApn) return -Infinity;
    if (ourApn && theirApn === ourApn) score += APN_MATCH_SCORE;
  }
  const addr = input.address;
  const theirs = splitStreetAddress(candidate.streetAddress);
  const ourDir = normaliseStreetDir(addr?.streetDir ?? "");
  if (ourDir && theirs.dir && ourDir === theirs.dir) score += 3;
  if (
    addr?.city &&
    candidate.city &&
    addr.city.trim().toUpperCase() === candidate.city.trim().toUpperCase()
  ) {
    score += 2;
  }
  if (addr?.zip && candidate.zip && zip5(addr.zip) && zip5(addr.zip) === zip5(candidate.zip)) {
    score += 2;
  }
  if (
    input.subdivision &&
    candidate.subdivision &&
    normaliseSubdivision(input.subdivision) === normaliseSubdivision(candidate.subdivision)
  ) {
    score += 3;
  }
  if (input.lot && candidate.lot && normaliseLot(input.lot) === normaliseLot(candidate.lot)) {
    score += 2;
  }
  return score;
}

/** Same document seen twice (e.g. in both archives) -> keep the first occurrence. */
export function dedupeHits(hits: SearchHit[]): SearchHit[] {
  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (const hit of hits) {
    const c = hit.candidate;
    const key = `${normalisePermitNumber(c.permitNumber)}:${c.docType.toUpperCase()}:${c.docDate ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }
  return out;
}

/** Rows describing the same property share this key regardless of doc type. */
export function propertyGroupKey(candidate: PermitCandidate): string {
  const parts = splitStreetAddress(candidate.streetAddress);
  return [
    normalizeStreetName(parts.street),
    parts.number,
    parts.dir,
    (candidate.city ?? "").trim().toUpperCase(),
    zip5(candidate.zip ?? ""),
    formatApn(candidate.apn) ?? "",
  ].join("|");
}

function matchesStreet(candidate: PermitCandidate, input: PrefillInput): boolean {
  const addr = input.address;
  if (!addr) return true;
  const theirs = splitStreetAddress(candidate.streetAddress);
  if (theirs.number && addr.streetNumber && theirs.number !== addr.streetNumber.trim()) {
    return false;
  }
  const ours = normalizeStreetName(addr.streetName);
  return ours === "" || normalizeStreetName(theirs.street).startsWith(ours);
}

/** Spec §5.2 step 2 decision, applied to property groups (see design notes). */
export function decideFallback(
  hits: SearchHit[],
  input: PrefillInput,
): { kind: "found" | "ambiguous"; hits: SearchHit[] } {
  const scored = hits
    .filter((h) => matchesStreet(h.candidate, input))
    .map((h) => ({
      ...h,
      candidate: { ...h.candidate, score: scoreCandidate(h.candidate, input) },
    }))
    .filter((h) => Number.isFinite(h.candidate.score));

  const groups = new Map<string, { score: number; hits: SearchHit[] }>();
  for (const hit of scored) {
    const key = propertyGroupKey(hit.candidate);
    const group = groups.get(key) ?? { score: -Infinity, hits: [] };
    group.score = Math.max(group.score, hit.candidate.score);
    group.hits.push(hit);
    groups.set(key, group);
  }
  const ranked = [...groups.values()].sort((a, b) => b.score - a.score);
  const [top, second] = ranked;
  if (
    top &&
    top.score >= AUTO_SELECT_MIN_SCORE &&
    (!second || top.score - second.score >= AUTO_SELECT_MIN_GAP)
  ) {
    return { kind: "found", hits: top.hits };
  }
  const candidates = ranked
    .flatMap((g) => g.hits)
    .sort(
      (a, b) =>
        b.candidate.score - a.candidate.score ||
        (b.candidate.docDate ?? "").localeCompare(a.candidate.docDate ?? ""),
    )
    .slice(0, MAX_CANDIDATES);
  return { kind: "ambiguous", hits: candidates };
}

interface ArchiveQuery {
  archive: EdmsArchiveConfig;
  keywords: EdmsKeyword[];
}

/** Runs the queries in parallel; returns merged hits and how many queries failed. */
async function runQueries(
  queries: ArchiveQuery[],
  signal: AbortSignal,
  deps: SearchDeps,
): Promise<{ hits: SearchHit[]; failures: number }> {
  const settled = await Promise.allSettled(
    queries.map((q) => deps.search(q.archive, q.keywords, signal)),
  );
  const hits: SearchHit[] = [];
  let failures = 0;
  settled.forEach((result, i) => {
    if (result.status === "fulfilled") {
      hits.push(...rowsToHits(queries[i].archive, result.value.rows));
    } else {
      failures++;
      console.warn(`[prefill/permits] ${queries[i].archive.id} search failed:`, result.reason);
    }
  });
  return { hits: dedupeHits(hits), failures };
}

export async function searchPermits(
  input: PrefillInput,
  signal: AbortSignal,
  deps: SearchDeps = defaultDeps,
): Promise<PermitSearchOutcome> {
  const searched: string[] = [];
  let totalFailures = 0;
  let totalQueries = 0;

  // 1. APN on both archives
  const apn = formatApn(input.apn);
  if (apn && isSafeKeywordValue(apn)) {
    searched.push(`APN ${apn}`);
    const queries: ArchiveQuery[] = [
      {
        archive: EDMS_ARCHIVES.env,
        keywords: [{ id: EDMS_ARCHIVES.env.keywords.apn, value: apn }],
      },
      {
        archive: EDMS_ARCHIVES.eplpav,
        keywords: [{ id: EDMS_ARCHIVES.eplpav.keywords.apn, value: apn }],
      },
    ];
    const { hits, failures } = await runQueries(queries, signal, deps);
    totalFailures += failures;
    totalQueries += queries.length;
    if (hits.length > 0) {
      return {
        kind: "found",
        via: "apn",
        hits: hits.map((h) => ({ ...h, candidate: { ...h.candidate, score: APN_MATCH_SCORE } })),
        searched,
      };
    }
  }

  // 2. Street fallback — the house number must look like one (digits + optional letter)
  const number = (input.address?.streetNumber ?? "").trim().toUpperCase();
  const street = normalizeStreetName(input.address?.streetName ?? "");
  if (/^\d{1,8}[A-Z]?$/.test(number) && street && isSafeKeywordValue(`${street}*`)) {
    searched.push(`${number} ${street}`);
    const queries: ArchiveQuery[] = [
      {
        archive: EDMS_ARCHIVES.env,
        keywords: [
          { id: EDMS_ARCHIVES.env.keywords.streetNo, value: number },
          { id: EDMS_ARCHIVES.env.keywords.street, value: `${street}*` },
        ],
      },
      {
        archive: EDMS_ARCHIVES.eplpav,
        keywords: [
          { id: EDMS_ARCHIVES.eplpav.keywords.streetNo, value: number },
          { id: EDMS_ARCHIVES.eplpav.keywords.street, value: `${street}*` },
        ],
      },
    ];
    const { hits, failures } = await runQueries(queries, signal, deps);
    totalFailures += failures;
    totalQueries += queries.length;
    if (hits.length > 0) {
      const decision = decideFallback(hits, input);
      if (decision.hits.length > 0) {
        return decision.kind === "found"
          ? { kind: "found", via: "street", hits: decision.hits, searched }
          : { kind: "ambiguous", hits: decision.hits, searched };
      }
    }
  }

  if (totalQueries > 0 && totalFailures === totalQueries) {
    return { kind: "error", message: EDMS_UNAVAILABLE_MESSAGE, searched };
  }
  return { kind: "not_found", searched };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/prefill/permits/__tests__/search.test.ts`
Expected: PASS (18 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/prefill/permits/search.ts src/lib/prefill/permits/__tests__/search.test.ts
git commit -m "feat(prefill): permit search — APN on both archives, scored street fallback"
```

---

### Task 6: Record storage helpers (upload + 600-s signed URL)

**Files:**
- Create: `src/lib/storage/record-storage.ts`
- Test: `src/lib/storage/__tests__/record-storage.test.ts`

**Interfaces:**
- Consumes: `createAdminClient` (`src/lib/supabase/admin.ts`).
- Produces: `RECORD_BUCKET = "inspection-media"`, `RECORD_SIGNED_URL_TTL_SECONDS = 600`, `recordStoragePath(inspectionId, recordId): string` (`records/{inspectionId}/{recordId}.pdf`), `uploadRecordPdf(storagePath, bytes: Uint8Array): Promise<void>`, `getRecordSignedUrl(storagePath, expiresInSeconds = 600): Promise<string>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/storage/__tests__/record-storage.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUpload = vi.fn();
const mockCreateSignedUrl = vi.fn();
const mockFrom = vi.fn(() => ({ upload: mockUpload, createSignedUrl: mockCreateSignedUrl }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ storage: { from: mockFrom } })),
}));

import {
  RECORD_SIGNED_URL_TTL_SECONDS,
  getRecordSignedUrl,
  recordStoragePath,
  uploadRecordPdf,
} from "../record-storage";

beforeEach(() => {
  mockUpload.mockReset();
  mockCreateSignedUrl.mockReset();
  mockFrom.mockClear();
});

describe("recordStoragePath", () => {
  it("nests under records/{inspectionId}/{recordId}.pdf (bucket not included)", () => {
    expect(recordStoragePath("insp-1", "rec-9")).toBe("records/insp-1/rec-9.pdf");
  });
});

describe("uploadRecordPdf", () => {
  it("uploads to the private inspection-media bucket as application/pdf with upsert", async () => {
    mockUpload.mockResolvedValue({ error: null });
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    await uploadRecordPdf("records/insp-1/rec-9.pdf", bytes);
    expect(mockFrom).toHaveBeenCalledWith("inspection-media");
    expect(mockUpload).toHaveBeenCalledWith("records/insp-1/rec-9.pdf", bytes, {
      contentType: "application/pdf",
      upsert: true,
    });
  });

  it("throws with the storage error message", async () => {
    mockUpload.mockResolvedValue({ error: { message: "Bucket not found" } });
    await expect(uploadRecordPdf("records/x/y.pdf", new Uint8Array())).rejects.toThrow(
      "Record upload failed: Bucket not found",
    );
  });
});

describe("getRecordSignedUrl", () => {
  it("defaults to a 600-second inline signed URL", async () => {
    mockCreateSignedUrl.mockResolvedValue({ data: { signedUrl: "https://signed/x.pdf" }, error: null });
    await expect(getRecordSignedUrl("records/insp-1/rec-9.pdf")).resolves.toBe("https://signed/x.pdf");
    expect(RECORD_SIGNED_URL_TTL_SECONDS).toBe(600);
    expect(mockCreateSignedUrl).toHaveBeenCalledWith("records/insp-1/rec-9.pdf", 600);
  });

  it("throws with the storage error message", async () => {
    mockCreateSignedUrl.mockResolvedValue({ data: null, error: { message: "Object not found" } });
    await expect(getRecordSignedUrl("records/x/y.pdf")).rejects.toThrow(
      "Signed URL creation failed: Object not found",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/storage/__tests__/record-storage.test.ts`
Expected: FAIL — `Cannot find module '../record-storage'`.

- [ ] **Step 3: Write `record-storage.ts`**

```ts
// src/lib/storage/record-storage.ts
/**
 * Storage helpers for permit documents pulled from Maricopa EDMS.
 *
 * Same private bucket as photos/reports, separate `records/` prefix so the
 * documents never leak into the report's photo pages. Signed URLs are short
 * (10 minutes) because they are handed out per click by the auth-gated
 * /api/inspections/[id]/records/[recordId] route.
 */

import { createAdminClient } from "@/lib/supabase/admin";

export const RECORD_BUCKET = "inspection-media";
export const RECORD_SIGNED_URL_TTL_SECONDS = 600;

export function recordStoragePath(inspectionId: string, recordId: string): string {
  return `records/${inspectionId}/${recordId}.pdf`;
}

export async function uploadRecordPdf(storagePath: string, bytes: Uint8Array): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.storage.from(RECORD_BUCKET).upload(storagePath, bytes, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (error) {
    throw new Error(`Record upload failed: ${error.message}`);
  }
}

export async function getRecordSignedUrl(
  storagePath: string,
  expiresInSeconds: number = RECORD_SIGNED_URL_TTL_SECONDS,
): Promise<string> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.storage
    .from(RECORD_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);
  if (error || !data) {
    throw new Error(`Signed URL creation failed: ${error?.message ?? "no data"}`);
  }
  return data.signedUrl;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/storage/__tests__/record-storage.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/storage/record-storage.ts src/lib/storage/__tests__/record-storage.test.ts
git commit -m "feat(storage): permit record upload + 10-minute signed URL helpers"
```

---

### Task 7: Fetch a permit document into storage + `inspection_records` row

**Files:**
- Modify: `src/lib/prefill/run-store.ts` (phase-1 file — add `NewInspectionRecordRow` + `createRecordRow`; phase 1 has no record insert)
- Modify: `src/lib/prefill/__tests__/run-store.test.ts` (phase-1 test — append one case)
- Create: `src/lib/prefill/permits/fetch-document.ts`
- Test: `src/lib/prefill/permits/__tests__/fetch-document.test.ts`

**Interfaces:**
- Consumes: `MAX_DOCUMENT_BYTES`, `ExtractionStatus` (`types.ts`); `inspectionRecords` (`src/lib/db/schema.ts`, phase 1) + `db` (inside `run-store.ts` only); `SearchHit` (Task 4); `EDMS_ARCHIVES`, `getDocumentInfo`, `fetchDocumentBytes` (Task 2); `recordStoragePath`, `uploadRecordPdf` (Task 6); `pdf-lib`.
- Produces:
  ```ts
  // run-store.ts additions
  export type NewInspectionRecordRow = typeof inspectionRecords.$inferInsert;
  export async function createRecordRow(row: NewInspectionRecordRow): Promise<string>; // returns the id
  // fetch-document.ts
  export type NewInspectionRecord = NewInspectionRecordRow;
  export interface StoreDocumentInput { inspectionId: string; runId: string; hit: SearchHit; extractionStatus: ExtractionStatus; extractionError?: string | null; signal: AbortSignal }
  export interface StoreDocumentResult { recordId: string; stored: boolean; sizeBytes: number | null; pageCount: number | null; extractionStatus: ExtractionStatus; error?: string }
  export interface StoreDocumentDeps { getDocumentInfo; fetchDocumentBytes; upload(storagePath, bytes): Promise<void>; insertRecord(row: NewInspectionRecord): Promise<void>; countPages(bytes): Promise<number | null>; newId(): string }
  export function countPdfPages(bytes: Uint8Array): Promise<number | null>;
  export function storeDocument(input: StoreDocumentInput, deps?: StoreDocumentDeps): Promise<StoreDocumentResult>;
  ```
  Every outcome inserts exactly one `inspection_records` row: stored documents get `storage_path = records/{inspectionId}/{recordId}.pdf`, `size_bytes`, `page_count`; a document that was **not** stored (over 25 MB, download or upload failure) still gets a row with `storage_path = ""` so the tile can list it — `""` is the "not stored" marker the records route (Task 9) and the DTO mapper (Task 10) key off.

**Why buffered, not streamed:** the size gate guarantees ≤ 25 MB, `pdf-lib` needs the whole file for the page count anyway, and one `Uint8Array` is simpler to test than a tee'd `ReadableStream`. Page count is still computed *after* the upload succeeds, as the spec says.

- [ ] **Step 0a: Add the record insert to phase 1's run store (failing test first)**

Append to `src/lib/prefill/__tests__/run-store.test.ts` (it already mocks `@/lib/db` with an `insert().values().returning()` chain — `mockValues` / `mockReturning` are the hoisted spies; add `createRecordRow` to the existing import line from `@/lib/prefill/run-store`):

```ts
describe("createRecordRow", () => {
  it("inserts the row and returns the new id", async () => {
    mockReturning.mockResolvedValueOnce([{ id: "rec-1" }]);
    const row = {
      inspectionId: "insp-1",
      runId: "run-1",
      source: "edms_env",
      permitNumber: "OW-17-00474",
      docType: "PERMIT",
      docDate: "2018-02-08",
      description: null,
      pageCount: 21,
      sizeBytes: 1968056,
      storagePath: "records/insp-1/rec-1.pdf",
      selected: true,
      extractionStatus: "pending",
      extractionError: null,
      extracted: null,
    };
    await expect(createRecordRow(row)).resolves.toBe("rec-1");
    expect(mockValues).toHaveBeenCalledWith(row);
  });
});
```

Run: `npx vitest run src/lib/prefill/__tests__/run-store.test.ts` — expected: FAIL (`createRecordRow` is not exported).

- [ ] **Step 0b: Implement `createRecordRow`**

Append to `src/lib/prefill/run-store.ts` (next to `listRecordRows`):

```ts
export type NewInspectionRecordRow = typeof inspectionRecords.$inferInsert;

/** Inserts one stored/skipped/failed permit document row; returns its id */
export async function createRecordRow(row: NewInspectionRecordRow): Promise<string> {
  const [created] = await db
    .insert(inspectionRecords)
    .values(row)
    .returning({ id: inspectionRecords.id });
  return created.id;
}
```

Run: `npx vitest run src/lib/prefill/__tests__/run-store.test.ts` — expected: PASS (phase 1's cases + 1).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/prefill/permits/__tests__/fetch-document.test.ts
// @vitest-environment node
import { PDFDocument } from "pdf-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_DOCUMENT_BYTES } from "../../types";
import type { SearchHit } from "../candidates";
import { EDMS_ARCHIVES } from "../edms-client";
import { type StoreDocumentDeps, countPdfPages, storeDocument } from "../fetch-document";

// fetch-document.ts imports the run store for its default deps; keep the real
// Drizzle client out of the test process.
vi.mock("@/lib/prefill/run-store", () => ({ createRecordRow: vi.fn() }));

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // %PDF-1.4

const hit: SearchHit = {
  documentId: "ephemeral-Á-token=",
  candidate: {
    key: "edms_env:OW-17-00474:PERMIT:2018-02-08",
    archive: "edms_env",
    permitNumber: "OW-17-00474",
    docType: "PERMIT",
    docDate: "2018-02-08",
    description: "EnvSeptic - 2/8/2018 - OW-17-00474 - PERMIT",
    streetAddress: "8911 W VILLA CHULA",
    city: "PEORIA",
    zip: "85383",
    apn: "200-08-079",
    score: 10,
  },
};

function makeDeps(overrides: Partial<StoreDocumentDeps> = {}): StoreDocumentDeps {
  return {
    getDocumentInfo: vi.fn().mockResolvedValue({ size: 8, viewerMode: "PDF", isAboveDownloadThreshold: false }),
    fetchDocumentBytes: vi.fn().mockResolvedValue({ bytes: PDF_BYTES, contentType: "application/pdf", filename: "x.pdf" }),
    upload: vi.fn().mockResolvedValue(undefined),
    insertRecord: vi.fn().mockResolvedValue(undefined),
    countPages: vi.fn().mockResolvedValue(21),
    newId: () => "rec-1",
    ...overrides,
  };
}

const baseInput = {
  inspectionId: "insp-1",
  runId: "run-1",
  hit,
  extractionStatus: "pending" as const,
  signal: new AbortController().signal,
};

describe("storeDocument", () => {
  let deps: StoreDocumentDeps;
  beforeEach(() => {
    deps = makeDeps();
  });

  it("size-checks, downloads, uploads, counts pages after upload and inserts the row", async () => {
    const result = await storeDocument(baseInput, deps);

    expect(deps.getDocumentInfo).toHaveBeenCalledWith(EDMS_ARCHIVES.env, "ephemeral-Á-token=", baseInput.signal);
    expect(deps.fetchDocumentBytes).toHaveBeenCalledWith(EDMS_ARCHIVES.env, "ephemeral-Á-token=", baseInput.signal);
    expect(deps.upload).toHaveBeenCalledWith("records/insp-1/rec-1.pdf", PDF_BYTES);
    const uploadOrder = (deps.upload as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    const countOrder = (deps.countPages as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    expect(uploadOrder).toBeLessThan(countOrder);

    expect(deps.insertRecord).toHaveBeenCalledTimes(1);
    expect(deps.insertRecord).toHaveBeenCalledWith({
      id: "rec-1",
      inspectionId: "insp-1",
      runId: "run-1",
      source: "edms_env",
      permitNumber: "OW-17-00474",
      docType: "PERMIT",
      docDate: "2018-02-08",
      description: "EnvSeptic - 2/8/2018 - OW-17-00474 - PERMIT",
      pageCount: 21,
      sizeBytes: 8,
      storagePath: "records/insp-1/rec-1.pdf",
      selected: true,
      extractionStatus: "pending",
      extractionError: null,
      extracted: null,
    });
    expect(result).toEqual({
      recordId: "rec-1",
      stored: true,
      sizeBytes: 8,
      pageCount: 21,
      extractionStatus: "pending",
    });
  });

  it("never persists the ephemeral document ID anywhere in the row", async () => {
    await storeDocument(baseInput, deps);
    const row = (deps.insertRecord as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(JSON.stringify(row)).not.toContain("ephemeral");
  });

  it("skips documents over MAX_DOCUMENT_BYTES without downloading, still inserting a row", async () => {
    deps = makeDeps({
      getDocumentInfo: vi.fn().mockResolvedValue({ size: MAX_DOCUMENT_BYTES + 1, viewerMode: "PDF", isAboveDownloadThreshold: true }),
    });
    const result = await storeDocument(baseInput, deps);
    expect(deps.fetchDocumentBytes).not.toHaveBeenCalled();
    expect(deps.upload).not.toHaveBeenCalled();
    expect(deps.insertRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        storagePath: "",
        sizeBytes: MAX_DOCUMENT_BYTES + 1,
        pageCount: null,
        extractionStatus: "skipped",
        extractionError: expect.stringContaining("Larger than 25 MB (25.0 MB)"),
      }),
    );
    expect(result).toMatchObject({ stored: false, extractionStatus: "skipped" });
  });

  it("marks the row failed when the download fails", async () => {
    deps = makeDeps({ fetchDocumentBytes: vi.fn().mockRejectedValue(new Error("EDMS document download failed (500)")) });
    const result = await storeDocument(baseInput, deps);
    expect(deps.upload).not.toHaveBeenCalled();
    expect(deps.insertRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        storagePath: "",
        extractionStatus: "failed",
        extractionError: "Download failed: EDMS document download failed (500)",
      }),
    );
    expect(result).toMatchObject({ stored: false, extractionStatus: "failed", error: expect.stringContaining("Download failed") });
  });

  it("marks the row failed when the upload fails", async () => {
    deps = makeDeps({ upload: vi.fn().mockRejectedValue(new Error("Record upload failed: quota")) });
    const result = await storeDocument(baseInput, deps);
    expect(deps.insertRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        storagePath: "",
        extractionStatus: "failed",
        extractionError: "Storage upload failed: Record upload failed: quota",
      }),
    );
    expect(result.stored).toBe(false);
  });

  it("still downloads when the metadata call fails", async () => {
    deps = makeDeps({ getDocumentInfo: vi.fn().mockRejectedValue(new Error("EDMS document info failed (500)")) });
    const result = await storeDocument(baseInput, deps);
    expect(result.stored).toBe(true);
    expect(deps.insertRecord).toHaveBeenCalledWith(expect.objectContaining({ sizeBytes: 8 }));
  });

  it("enforces the size cap on the actual bytes when the metadata under-reported", async () => {
    const big = new Uint8Array(MAX_DOCUMENT_BYTES + 1);
    big.set([0x25, 0x50, 0x44, 0x46]);
    deps = makeDeps({ fetchDocumentBytes: vi.fn().mockResolvedValue({ bytes: big, contentType: "application/pdf", filename: null }) });
    const result = await storeDocument(baseInput, deps);
    expect(deps.upload).not.toHaveBeenCalled();
    expect(result).toMatchObject({ stored: false, extractionStatus: "skipped" });
  });

  it("carries a caller-supplied skipped status + reason onto a stored document", async () => {
    await storeDocument(
      { ...baseInput, extractionStatus: "skipped", extractionError: "Over the 3-document limit" },
      deps,
    );
    expect(deps.insertRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        storagePath: "records/insp-1/rec-1.pdf",
        extractionStatus: "skipped",
        extractionError: "Over the 3-document limit",
      }),
    );
  });
});

describe("countPdfPages", () => {
  it("counts pages of a real PDF", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.addPage();
    doc.addPage();
    const bytes = await doc.save();
    await expect(countPdfPages(new Uint8Array(bytes))).resolves.toBe(3);
  });

  it("returns null for bytes pdf-lib cannot parse", async () => {
    await expect(countPdfPages(new Uint8Array([1, 2, 3]))).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/prefill/permits/__tests__/fetch-document.test.ts`
Expected: FAIL — `Cannot find module '../fetch-document'`.

- [ ] **Step 3: Write `fetch-document.ts`**

```ts
// src/lib/prefill/permits/fetch-document.ts
/**
 * Pull one EDMS document into Supabase Storage and record it as an
 * `inspection_records` row.
 *
 *   POST {Document}/ (size)  ->  GET {Document}/ (bytes, ≤ 25 MB)
 *   -> storage upload records/{inspectionId}/{recordId}.pdf
 *   -> pdf-lib page count -> insert row
 *
 * Every path inserts exactly one row. Documents that could not be stored
 * (too large, download/upload failure) get `storage_path = ""` plus a
 * human-readable `extraction_error`, so the tile can list them and the
 * records route can refuse them.
 */

import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { recordStoragePath, uploadRecordPdf } from "@/lib/storage/record-storage";
import { type NewInspectionRecordRow, createRecordRow } from "../run-store";
import { type ExtractionStatus, MAX_DOCUMENT_BYTES } from "../types";
import type { SearchHit } from "./candidates";
import {
  EDMS_ARCHIVES,
  type EdmsArchiveConfig,
  fetchDocumentBytes,
  getDocumentInfo,
} from "./edms-client";

export type NewInspectionRecord = NewInspectionRecordRow;

export interface StoreDocumentInput {
  inspectionId: string;
  runId: string;
  hit: SearchHit;
  /** "pending" for the ranked-for-extraction docs, "skipped" (with a reason) for the rest */
  extractionStatus: ExtractionStatus;
  extractionError?: string | null;
  signal: AbortSignal;
}

export interface StoreDocumentResult {
  recordId: string;
  stored: boolean;
  sizeBytes: number | null;
  pageCount: number | null;
  extractionStatus: ExtractionStatus;
  error?: string;
}

export interface StoreDocumentDeps {
  getDocumentInfo: typeof getDocumentInfo;
  fetchDocumentBytes: typeof fetchDocumentBytes;
  upload: (storagePath: string, bytes: Uint8Array) => Promise<void>;
  insertRecord: (row: NewInspectionRecord) => Promise<void>;
  countPages: (bytes: Uint8Array) => Promise<number | null>;
  newId: () => string;
}

/** Page count via pdf-lib; null when the file is not parseable (row still stored). */
export async function countPdfPages(bytes: Uint8Array): Promise<number | null> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    return doc.getPageCount();
  } catch {
    return null;
  }
}

const defaultDeps: StoreDocumentDeps = {
  getDocumentInfo,
  fetchDocumentBytes,
  upload: uploadRecordPdf,
  insertRecord: async (row) => {
    await createRecordRow(row);
  },
  countPages: countPdfPages,
  newId: () => randomUUID(),
};

function archiveFor(hit: SearchHit): EdmsArchiveConfig {
  return hit.candidate.archive === "edms_env" ? EDMS_ARCHIVES.env : EDMS_ARCHIVES.eplpav;
}

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function tooLargeMessage(bytes: number): string {
  return `Larger than 25 MB (${megabytes(bytes)}) — open it on Maricopa EDMS`;
}

export async function storeDocument(
  input: StoreDocumentInput,
  deps: StoreDocumentDeps = defaultDeps,
): Promise<StoreDocumentResult> {
  const { hit, signal } = input;
  const candidate = hit.candidate;
  const archive = archiveFor(hit);
  const recordId = deps.newId();

  // Row template — note: no EDMS document ID anywhere in here.
  const base: NewInspectionRecord = {
    id: recordId,
    inspectionId: input.inspectionId,
    runId: input.runId,
    source: candidate.archive,
    permitNumber: candidate.permitNumber,
    docType: candidate.docType,
    docDate: candidate.docDate ?? null,
    description: candidate.description ?? null,
    pageCount: null,
    sizeBytes: null,
    storagePath: "",
    selected: true,
    extractionStatus: input.extractionStatus,
    extractionError: input.extractionError ?? null,
    extracted: null,
  };

  const notStored = async (
    extractionStatus: ExtractionStatus,
    error: string,
    sizeBytes: number | null,
  ): Promise<StoreDocumentResult> => {
    await deps.insertRecord({ ...base, sizeBytes, extractionStatus, extractionError: error });
    return { recordId, stored: false, sizeBytes, pageCount: null, extractionStatus, error };
  };

  // 1. Size gate (metadata POST). A metadata failure is not fatal — the GET decides.
  let reportedSize: number | null = null;
  try {
    reportedSize = (await deps.getDocumentInfo(archive, hit.documentId, signal)).size;
  } catch (err) {
    console.warn(`[prefill/permits] document info failed for ${candidate.permitNumber}:`, err);
  }
  if (reportedSize !== null && reportedSize > MAX_DOCUMENT_BYTES) {
    return notStored("skipped", tooLargeMessage(reportedSize), reportedSize);
  }

  // 2. Download
  let bytes: Uint8Array;
  try {
    ({ bytes } = await deps.fetchDocumentBytes(archive, hit.documentId, signal));
  } catch (err) {
    return notStored("failed", `Download failed: ${errorMessage(err)}`, reportedSize);
  }
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
    return notStored("skipped", tooLargeMessage(bytes.byteLength), bytes.byteLength);
  }

  // 3. Upload
  const storagePath = recordStoragePath(input.inspectionId, recordId);
  try {
    await deps.upload(storagePath, bytes);
  } catch (err) {
    return notStored("failed", `Storage upload failed: ${errorMessage(err)}`, bytes.byteLength);
  }

  // 4. Page count after the upload, then the row
  const pageCount = await deps.countPages(bytes);
  await deps.insertRecord({ ...base, storagePath, sizeBytes: bytes.byteLength, pageCount });
  return {
    recordId,
    stored: true,
    sizeBytes: bytes.byteLength,
    pageCount,
    extractionStatus: input.extractionStatus,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/prefill/permits/__tests__/fetch-document.test.ts`
Expected: PASS (10 tests). Every test injects `deps`, and `@/lib/prefill/run-store` is mocked so the real Drizzle client is never constructed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/prefill/run-store.ts src/lib/prefill/__tests__/run-store.test.ts src/lib/prefill/permits/fetch-document.ts src/lib/prefill/permits/__tests__/fetch-document.test.ts
git commit -m "feat(prefill): download permit PDFs to storage and insert inspection_records rows"
```

---

### Task 8: `runPermitsStage` / `runPermitsSelection` — search → rank → store

**Files:**
- Modify (replace the phase-1 stub wholesale): `src/lib/prefill/permits/index.ts`
- Test: `src/lib/prefill/permits/__tests__/index.test.ts`

**Interfaces:**
- Consumes: `StageContext`, `StageResult` (type-only, from phase-1 `src/lib/prefill/stage.ts`); `MAX_DOCUMENTS_PER_RUN`, `PermitCandidate`, `PrefillInput`, `PrefillStage`, `ProposedField`, `StageLink`, `ExtractionStatus` (`types.ts`); `searchPermits`, `PermitSearchOutcome` (Task 5); `storeDocument`, `StoreDocumentInput`, `StoreDocumentResult` (Task 7); `rankForExtraction`, `isExtractableDocType`, `isAbandonmentDocType` (Task 3); `SearchHit` (Task 4); `EDMS_ARCHIVES` (Task 2).
- Produces:
  ```ts
  export const EDMS_LINKS: StageLink[];   // "Open on Maricopa EDMS" (env) + "EDMS 2024+ archive" (eplpav)
  export type PermitsStageResult = StageResult & { candidates?: PermitCandidate[] };
  export interface PermitsStageDeps {
    searchPermits: (input: PrefillInput, signal: AbortSignal) => Promise<PermitSearchOutcome>;
    storeDocument: (input: StoreDocumentInput) => Promise<StoreDocumentResult>;
  }
  export function notFoundSummary(searched: string[]): string;
  export function runPermitsStage(input: PrefillInput, ctx: StageContext, deps?: PermitsStageDeps): Promise<PermitsStageResult>;
  export function runPermitsSelection(input: PrefillInput, ctx: StageContext, candidateKeys: string[], deps?: PermitsStageDeps): Promise<StageResult>;
  ```
  `runPermitsStage` never throws. When it returns `candidates` (non-empty) the stage status is `"pending"` and the orchestrator (Task 10) puts the run into `awaiting_selection`. Proposals emitted in this phase: only `facilityInfo.recordsAvailable` — `"yes"` at confidence `1.0` when permits were found, `"no"` at confidence `0.6` (below the fill gate, so it renders as a suggestion chip — spec §2.8) when nothing was found.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/prefill/permits/__tests__/index.test.ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StageContext } from "@/lib/prefill/stage";
import type { PermitCandidate } from "../../types";
import type { SearchHit } from "../candidates";
import type { StoreDocumentInput, StoreDocumentResult } from "../fetch-document";
import { type PermitsStageDeps, notFoundSummary, runPermitsSelection, runPermitsStage } from "../index";

// index.ts → fetch-document.ts → run-store.ts → Drizzle; keep the DB out of the test process
vi.mock("@/lib/prefill/run-store", () => ({ createRecordRow: vi.fn() }));

function hit(over: Partial<PermitCandidate> & { permitNumber: string; docType: string }): SearchHit {
  const candidate: PermitCandidate = {
    key: `edms_env:${over.permitNumber}:${over.docType}:${over.docDate ?? ""}`,
    archive: "edms_env",
    streetAddress: "8911 W VILLA CHULA",
    city: "PEORIA",
    zip: "85383",
    apn: "200-08-079",
    score: 10,
    ...over,
  };
  return { candidate, documentId: `token-${over.permitNumber}` };
}

const PERMIT = hit({ permitNumber: "OW-17-00474", docType: "PERMIT", docDate: "2018-02-08" });
const TRANSFER = hit({ permitNumber: "OWR-22-04475", docType: "NOTICE OF TRANSFER", docDate: "2022-09-21" });
const ABANDON = hit({ permitNumber: "OWR-22-01512", docType: "ABANDONMENT", docDate: "2025-04-14" });
const PLAN = hit({ permitNumber: "OWR-23-02201", docType: "PLAN REVIEW", docDate: "2024-11-07" });

function makeCtx(): StageContext & { progress: ReturnType<typeof vi.fn>; controller: AbortController } {
  const controller = new AbortController();
  return {
    inspectionId: "insp-1",
    runId: "run-1",
    signal: controller.signal,
    progress: vi.fn().mockResolvedValue(undefined),
    controller,
  };
}

function storedResult(input: StoreDocumentInput, n: number): StoreDocumentResult {
  return {
    recordId: `rec-${n}`,
    stored: true,
    sizeBytes: 1000,
    pageCount: 8,
    extractionStatus: input.extractionStatus,
  };
}

function makeDeps(over: Partial<PermitsStageDeps> = {}): PermitsStageDeps & {
  storeDocument: ReturnType<typeof vi.fn>;
  searchPermits: ReturnType<typeof vi.fn>;
} {
  let n = 0;
  return {
    searchPermits: vi.fn().mockResolvedValue({ kind: "not_found", searched: [] }),
    storeDocument: vi.fn(async (input: StoreDocumentInput) => storedResult(input, ++n)),
    ...over,
  } as never;
}

const input = { apn: "200-08-079" };

describe("runPermitsStage", () => {
  let ctx: ReturnType<typeof makeCtx>;
  beforeEach(() => {
    ctx = makeCtx();
  });

  it("stores found documents in extraction rank order and proposes recordsAvailable = yes", async () => {
    const deps = makeDeps({
      searchPermits: vi.fn().mockResolvedValue({
        kind: "found",
        via: "apn",
        hits: [TRANSFER, PERMIT],
        searched: ["APN 200-08-079"],
      }),
    });
    const result = await runPermitsStage(input, ctx, deps);

    expect(deps.storeDocument).toHaveBeenCalledTimes(2);
    const calls = deps.storeDocument.mock.calls.map((c) => c[0] as StoreDocumentInput);
    expect(calls.map((c) => c.hit.candidate.permitNumber)).toEqual(["OW-17-00474", "OWR-22-04475"]);
    expect(calls.every((c) => c.extractionStatus === "pending")).toBe(true);
    expect(calls[0]).toMatchObject({ inspectionId: "insp-1", runId: "run-1", signal: ctx.signal });

    expect(result.stage.status).toBe("done");
    expect(result.stage.summary).toBe(
      "2 permit documents found: OW-17-00474 PERMIT, OWR-22-04475 NOTICE OF TRANSFER",
    );
    expect(result.stage.links.map((l) => l.url)).toEqual([
      "https://edms.maricopa.gov/env/",
      "https://edms.maricopa.gov/eplpav/",
    ]);
    expect(result.stage.startedAt).toBeTruthy();
    expect(result.stage.finishedAt).toBeTruthy();
    expect(result.candidates).toBeUndefined();

    expect(result.proposals).toEqual([
      {
        fieldPath: "facilityInfo.recordsAvailable",
        value: "yes",
        kind: "fill",
        provenance: {
          source: "permit",
          confidence: 1,
          explanation: "Permit OW-17-00474 (PERMIT) found on Maricopa EDMS",
          sourceUrl: "/api/inspections/insp-1/records/rec-1",
          recordId: "rec-1",
          runId: "run-1",
        },
      },
    ]);

    // progress: running → per-document download lines
    expect(ctx.progress).toHaveBeenCalledWith(
      expect.objectContaining({ status: "running", summary: "Searching Maricopa EDMS…" }),
    );
    expect(ctx.progress).toHaveBeenCalledWith(
      expect.objectContaining({ summary: "Downloading 1 of 2: OW-17-00474 PERMIT…" }),
    );
  });

  it("caps pending extraction at MAX_DOCUMENTS_PER_RUN and skips non-extractable types", async () => {
    const many = [
      PLAN,
      ABANDON,
      TRANSFER,
      PERMIT,
      hit({ permitNumber: "000972", docType: "PERMIT", docDate: "2015-09-11" }),
    ];
    const deps = makeDeps({
      searchPermits: vi.fn().mockResolvedValue({ kind: "found", via: "apn", hits: many, searched: ["APN x"] }),
    });
    const result = await runPermitsStage(input, ctx, deps);
    const calls = deps.storeDocument.mock.calls.map((c) => c[0] as StoreDocumentInput);
    expect(calls.map((c) => [c.hit.candidate.permitNumber, c.extractionStatus, c.extractionError])).toEqual([
      ["OW-17-00474", "pending", null],
      ["000972", "pending", null],
      ["OWR-22-04475", "pending", null],
      ["OWR-22-01512", "skipped", "Over the 3-document extraction limit"],
      ["OWR-23-02201", "skipped", "PLAN REVIEW documents are not extracted"],
    ]);
    expect(result.stage.summary).toContain("5 permit documents found");
    expect(result.stage.summary).toContain("ABANDONMENT on file (OWR-22-01512)");
  });

  it("frees the extraction slot when a pending document fails to store", async () => {
    let n = 0;
    const deps = makeDeps({
      searchPermits: vi.fn().mockResolvedValue({
        kind: "found",
        via: "apn",
        hits: [PERMIT, hit({ permitNumber: "A", docType: "PERMIT" }), hit({ permitNumber: "B", docType: "PERMIT" }), hit({ permitNumber: "C", docType: "PERMIT" })],
        searched: ["APN x"],
      }),
      storeDocument: vi.fn(async (i: StoreDocumentInput) => {
        n++;
        if (n === 1) {
          return { recordId: "rec-1", stored: false, sizeBytes: null, pageCount: null, extractionStatus: "failed", error: "Download failed: 500" };
        }
        return storedResult(i, n);
      }),
    });
    const result = await runPermitsStage(input, ctx, deps);
    const statuses = deps.storeDocument.mock.calls.map((c) => (c[0] as StoreDocumentInput).extractionStatus);
    expect(statuses).toEqual(["pending", "pending", "pending", "pending"]);
    expect(result.stage.summary).toContain("1 download failed");
    // the proposal links to the first *stored* record
    expect(result.proposals[0].provenance.recordId).toBe("rec-2");
  });

  it("returns candidates with a pending stage when the fallback is ambiguous", async () => {
    const deps = makeDeps({
      searchPermits: vi.fn().mockResolvedValue({
        kind: "ambiguous",
        hits: [PERMIT, TRANSFER, ABANDON],
        searched: ["8911 PRINCESS"],
      }),
    });
    const result = await runPermitsStage(input, ctx, deps);
    expect(deps.storeDocument).not.toHaveBeenCalled();
    expect(result.stage.status).toBe("pending");
    expect(result.stage.summary).toBe("3 possible permits — pick the right one");
    expect(result.candidates?.map((c) => c.key)).toEqual([PERMIT, TRANSFER, ABANDON].map((h) => h.candidate.key));
    expect(result.proposals).toEqual([]);
  });

  it("reports not_found with the searched terms and suggests recordsAvailable = no", async () => {
    const deps = makeDeps({
      searchPermits: vi.fn().mockResolvedValue({
        kind: "not_found",
        searched: ["APN 219-11-121", "8911 CAVE CREEK"],
      }),
    });
    const result = await runPermitsStage(input, ctx, deps);
    expect(result.stage.status).toBe("not_found");
    expect(result.stage.summary).toBe(
      "No permit records found (searched APN 219-11-121 and 8911 CAVE CREEK — 0 matches)",
    );
    expect(result.proposals).toEqual([
      {
        fieldPath: "facilityInfo.recordsAvailable",
        value: "no",
        kind: "fill",
        provenance: {
          source: "permit",
          confidence: 0.6,
          explanation:
            "No permit records found on Maricopa EDMS (searched APN 219-11-121 and 8911 CAVE CREEK)",
          sourceUrl: "https://edms.maricopa.gov/env/",
          runId: "run-1",
        },
      },
    ]);
  });

  it("proposes nothing when there was nothing to search", async () => {
    const result = await runPermitsStage({}, ctx, makeDeps());
    expect(result.stage.status).toBe("not_found");
    expect(result.stage.summary).toBe(notFoundSummary([]));
    expect(result.proposals).toEqual([]);
  });

  it("maps a search error onto the stage without throwing", async () => {
    const deps = makeDeps({
      searchPermits: vi.fn().mockResolvedValue({
        kind: "error",
        message: "Maricopa EDMS unavailable — try Find records later",
        searched: ["APN 200-08-079"],
      }),
    });
    const result = await runPermitsStage(input, ctx, deps);
    expect(result.stage).toMatchObject({
      status: "error",
      error: "Maricopa EDMS unavailable — try Find records later",
    });
    expect(result.proposals).toEqual([]);
  });

  it("survives a thrown storeDocument and an unexpected search exception", async () => {
    const deps = makeDeps({
      searchPermits: vi.fn().mockResolvedValue({ kind: "found", via: "apn", hits: [PERMIT], searched: ["APN x"] }),
      storeDocument: vi.fn().mockRejectedValue(new Error("db down")),
    });
    const result = await runPermitsStage(input, ctx, deps);
    expect(result.stage.status).toBe("done");
    expect(result.stage.summary).toContain("1 download failed");

    const boom = makeDeps({ searchPermits: vi.fn().mockRejectedValue(new Error("kaboom")) });
    const crashed = await runPermitsStage(input, ctx, boom);
    expect(crashed.stage).toMatchObject({ status: "error", error: "kaboom" });
  });

  it("stops downloading once the run budget signal fires", async () => {
    const deps = makeDeps({
      searchPermits: vi.fn().mockResolvedValue({ kind: "found", via: "apn", hits: [PERMIT, TRANSFER], searched: ["APN x"] }),
      storeDocument: vi.fn(async (i: StoreDocumentInput) => {
        ctx.controller.abort();
        return storedResult(i, 1);
      }),
    });
    const result = await runPermitsStage(input, ctx, deps);
    expect(deps.storeDocument).toHaveBeenCalledTimes(1);
    expect(result.stage.summary).toContain("1 not downloaded (out of time)");
  });
});

describe("runPermitsSelection", () => {
  it("re-runs the search and stores only the chosen candidate keys", async () => {
    const ctx = makeCtx();
    const deps = makeDeps({
      searchPermits: vi.fn().mockResolvedValue({
        kind: "ambiguous",
        hits: [PERMIT, TRANSFER, ABANDON],
        searched: ["8911 PRINCESS"],
      }),
    });
    const result = await runPermitsSelection(input, ctx, [TRANSFER.candidate.key, ABANDON.candidate.key], deps);
    expect(deps.searchPermits).toHaveBeenCalledWith(input, ctx.signal);
    const stored = deps.storeDocument.mock.calls.map((c) => (c[0] as StoreDocumentInput).hit.candidate.permitNumber);
    expect(stored).toEqual(["OWR-22-04475", "OWR-22-01512"]);
    expect(result.stage.status).toBe("done");
    expect(result.proposals[0]).toMatchObject({ fieldPath: "facilityInfo.recordsAvailable", value: "yes" });
  });

  it("errors when none of the chosen keys are in the fresh results", async () => {
    const ctx = makeCtx();
    const deps = makeDeps({
      searchPermits: vi.fn().mockResolvedValue({ kind: "ambiguous", hits: [PERMIT], searched: ["x"] }),
    });
    const result = await runPermitsSelection(input, ctx, ["edms_env:NOPE:PERMIT:"], deps);
    expect(deps.storeDocument).not.toHaveBeenCalled();
    expect(result.stage).toMatchObject({
      status: "error",
      error: "Selected permits are no longer available on Maricopa EDMS — run Find records again",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/prefill/permits/__tests__/index.test.ts`
Expected: FAIL — the phase-1 stub returns `{ status: "skipped", summary: "Not available yet" }` and exports no `runPermitsSelection` / `notFoundSummary`.

- [ ] **Step 3: Replace `permits/index.ts`** (the whole file — the phase-1 stub body goes away)

```ts
// src/lib/prefill/permits/index.ts
/**
 * Permits prefill stage (spec §5.2): search both EDMS archives, rank the
 * documents, download them into storage, and summarise for the tile.
 *
 * Never throws — every failure becomes a stage status. Phase 3 adds the
 * extraction step after `storeHits`; in this phase every stored document is
 * left at `extraction_status = "pending"` (or "skipped" / "failed").
 */

import type { StageContext, StageResult } from "@/lib/prefill/stage";
import {
  type ExtractionStatus,
  MAX_DOCUMENTS_PER_RUN,
  type PermitCandidate,
  type PrefillInput,
  type PrefillStage,
  type ProposedField,
  type StageLink,
} from "../types";
import type { SearchHit } from "./candidates";
import { isAbandonmentDocType, isExtractableDocType, rankForExtraction } from "./doc-types";
import { EDMS_ARCHIVES } from "./edms-client";
import { type StoreDocumentInput, type StoreDocumentResult, storeDocument } from "./fetch-document";
import { type PermitSearchOutcome, searchPermits } from "./search";

export const EDMS_LINKS: StageLink[] = [
  { label: "Open on Maricopa EDMS", url: EDMS_ARCHIVES.env.searchPageUrl },
  { label: "EDMS 2024+ archive", url: EDMS_ARCHIVES.eplpav.searchPageUrl },
];

export const SELECTION_STALE_MESSAGE =
  "Selected permits are no longer available on Maricopa EDMS — run Find records again";

export type PermitsStageResult = StageResult & { candidates?: PermitCandidate[] };

export interface PermitsStageDeps {
  searchPermits: (input: PrefillInput, signal: AbortSignal) => Promise<PermitSearchOutcome>;
  storeDocument: (input: StoreDocumentInput) => Promise<StoreDocumentResult>;
}

const defaultDeps: PermitsStageDeps = {
  searchPermits: (input, signal) => searchPermits(input, signal),
  storeDocument: (input) => storeDocument(input),
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

export function notFoundSummary(searched: string[]): string {
  if (searched.length === 0) {
    return "No permit records searched — add an APN or street address and run Find records";
  }
  return `No permit records found (searched ${searched.join(" and ")} — 0 matches)`;
}

function recordsAvailableProposal(
  value: "yes" | "no",
  confidence: number,
  explanation: string,
  runId: string,
  link: { sourceUrl: string; recordId?: string },
): ProposedField {
  return {
    fieldPath: "facilityInfo.recordsAvailable",
    value,
    kind: "fill",
    provenance: {
      source: "permit",
      confidence,
      explanation,
      sourceUrl: link.sourceUrl,
      ...(link.recordId ? { recordId: link.recordId } : {}),
      runId,
    },
  };
}

interface StageClock {
  startedAt: string;
}

function finishStage(clock: StageClock, partial: Partial<PrefillStage>): PrefillStage {
  return {
    status: "done",
    links: EDMS_LINKS,
    startedAt: clock.startedAt,
    finishedAt: new Date().toISOString(),
    ...partial,
  };
}

interface StoreOutcome {
  hit: SearchHit;
  result: StoreDocumentResult | null;
  error?: string;
}

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

  return { stage: finishStage(clock, { status: "done", summary: parts.join(" · ") }), proposals };
}

export async function runPermitsStage(
  input: PrefillInput,
  ctx: StageContext,
  deps: PermitsStageDeps = defaultDeps,
): Promise<PermitsStageResult> {
  const clock: StageClock = { startedAt: new Date().toISOString() };
  try {
    await ctx.progress({
      status: "running",
      startedAt: clock.startedAt,
      summary: "Searching Maricopa EDMS…",
      links: EDMS_LINKS,
    });
    const outcome = await deps.searchPermits(input, ctx.signal);
    switch (outcome.kind) {
      case "error":
        return {
          stage: finishStage(clock, { status: "error", error: outcome.message, summary: outcome.message }),
          proposals: [],
        };
      case "not_found": {
        const summary = notFoundSummary(outcome.searched);
        const proposals: ProposedField[] =
          outcome.searched.length === 0
            ? []
            : [
                recordsAvailableProposal(
                  "no",
                  0.6,
                  `No permit records found on Maricopa EDMS (searched ${outcome.searched.join(" and ")})`,
                  ctx.runId,
                  { sourceUrl: EDMS_ARCHIVES.env.searchPageUrl },
                ),
              ];
        return { stage: finishStage(clock, { status: "not_found", summary }), proposals };
      }
      case "ambiguous":
        return {
          stage: finishStage(clock, {
            status: "pending",
            summary: `${outcome.hits.length} possible permits — pick the right one`,
          }),
          proposals: [],
          candidates: outcome.hits.map((h) => h.candidate),
        };
      case "found":
        return storeHits(outcome.hits, ctx, deps, clock);
    }
  } catch (err) {
    console.error("[prefill/permits] stage crashed:", err);
    return {
      stage: finishStage(clock, {
        status: "error",
        error: errorMessage(err),
        summary: "Permit search failed",
      }),
      proposals: [],
    };
  }
}

/**
 * /select continuation: EDMS document IDs are ephemeral, so re-run the same
 * search and match the chosen candidates by their stable `key`.
 */
export async function runPermitsSelection(
  input: PrefillInput,
  ctx: StageContext,
  candidateKeys: string[],
  deps: PermitsStageDeps = defaultDeps,
): Promise<StageResult> {
  const clock: StageClock = { startedAt: new Date().toISOString() };
  try {
    await ctx.progress({
      status: "running",
      startedAt: clock.startedAt,
      summary: "Fetching the selected permits…",
      links: EDMS_LINKS,
    });
    const outcome = await deps.searchPermits(input, ctx.signal);
    const fresh = outcome.kind === "found" || outcome.kind === "ambiguous" ? outcome.hits : [];
    const wanted = new Set(candidateKeys);
    const selected = fresh.filter((h) => wanted.has(h.candidate.key));
    if (selected.length === 0) {
      return {
        stage: finishStage(clock, {
          status: "error",
          error: SELECTION_STALE_MESSAGE,
          summary: SELECTION_STALE_MESSAGE,
        }),
        proposals: [],
      };
    }
    const { stage, proposals } = await storeHits(selected, ctx, deps, clock);
    return { stage, proposals };
  } catch (err) {
    console.error("[prefill/permits] selection crashed:", err);
    return {
      stage: finishStage(clock, {
        status: "error",
        error: errorMessage(err),
        summary: "Fetching the selected permits failed",
      }),
      proposals: [],
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/prefill/permits/__tests__/index.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Run the whole permits folder together**

Run: `npx vitest run src/lib/prefill`
Expected: all green except phase-1's `run-prefill.test.ts` assertion that `stages.permits` equals the `"Not available yet"` stub — that expectation is retired in Task 10 (it now asserts the real stage result).

- [ ] **Step 6: Commit**

```bash
git add src/lib/prefill/permits/index.ts src/lib/prefill/permits/__tests__/index.test.ts
git commit -m "feat(prefill): permits stage — search, rank, store, summaries and selection continuation"
```

---

### Task 9: `GET /api/inspections/[id]/records/[recordId]` — 302 to a signed URL

**Files:**
- Create: `src/app/api/inspections/[id]/records/[recordId]/route.ts`
- Test: `src/app/api/inspections/[id]/records/[recordId]/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `createClient` (`src/lib/supabase/server.ts`), `checkInspectionAccess` (`src/lib/supabase/auth-helpers.ts`), `db`, `inspections`, `inspectionRecords` (phase-1 schema), `getRecordSignedUrl`, `RECORD_SIGNED_URL_TTL_SECONDS` (Task 6).
- Produces: route handler `GET(request, { params: Promise<{ id: string; recordId: string }> })` → `302` with `Location: <signed URL>` (600 s), `401` unauthenticated, `403` no access, `404` inspection / record missing or record not stored (`storage_path = ""`), `500` signing failure. This is the URL the tile's `<a target="_blank" rel="noopener">` opens and the `downloadUrl` in `InspectionRecordDTO`.
- Access rule is "may view" (owner or admin/office_staff). The route mirrors its closest sibling, `/api/inspections/[id]/download` (`createClient` + `checkInspectionAccess`), so its test follows that file's mocking pattern; phase 1's `requireInspectionAccess(id, "view")` (`src/lib/prefill/route-access.ts`) enforces the identical rule and may be used instead if you prefer — pick one, do not mix.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/api/inspections/[id]/records/[recordId]/__tests__/route.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks (same shape as the download route test)
// ---------------------------------------------------------------------------
const {
  mockGetUser,
  mockGetSession,
  mockCreateClient,
  mockSelectInspection,
  mockSelectRecord,
  mockGetRecordSignedUrl,
  state,
} = vi.hoisted(() => {
  const mockGetUser = vi.fn();
  const mockGetSession = vi.fn();
  const mockSelectInspection = vi.fn();
  const mockSelectRecord = vi.fn();
  const mockGetRecordSignedUrl = vi.fn();
  const mockCreateClient = vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
  });
  return {
    mockGetUser,
    mockGetSession,
    mockCreateClient,
    mockSelectInspection,
    mockSelectRecord,
    mockGetRecordSignedUrl,
    state: { selectCall: 0 },
  };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));

// 1st select = inspection lookup, 2nd select = record lookup (both end in .limit(1))
vi.mock("@/lib/db", () => {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(() => (++state.selectCall === 1 ? mockSelectInspection() : mockSelectRecord())),
  };
  return { db: { select: vi.fn(() => chain) } };
});

vi.mock("@/lib/db/schema", () => ({
  inspections: { id: "id", inspectorId: "inspector_id" },
  inspectionRecords: { id: "id", inspectionId: "inspection_id", storagePath: "storage_path" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ _col, val })),
  and: vi.fn((...conds: unknown[]) => ({ and: conds })),
}));

vi.mock("@/lib/supabase/auth-helpers", () => ({
  checkInspectionAccess: vi.fn().mockResolvedValue({ allowed: true, role: "admin" }),
}));

vi.mock("@/lib/storage/record-storage", () => ({
  RECORD_SIGNED_URL_TTL_SECONDS: 600,
  getRecordSignedUrl: (...args: unknown[]) => mockGetRecordSignedUrl(...args),
}));

// ---------------------------------------------------------------------------
// Import handler
// ---------------------------------------------------------------------------
import { checkInspectionAccess } from "@/lib/supabase/auth-helpers";
import { GET } from "../route";

function makeParams(id: string, recordId: string) {
  return { params: Promise.resolve({ id, recordId }) };
}

const USER = { id: "user-1" };
const INSPECTION = { id: "insp-1", inspectorId: "user-1" };
const RECORD = { storagePath: "records/insp-1/rec-1.pdf" };

beforeEach(() => {
  vi.clearAllMocks();
  state.selectCall = 0;
  mockGetUser.mockResolvedValue({ data: { user: USER } });
  mockSelectInspection.mockResolvedValue([INSPECTION]);
  mockSelectRecord.mockResolvedValue([RECORD]);
  (checkInspectionAccess as ReturnType<typeof vi.fn>).mockResolvedValue({ allowed: true, role: "admin" });
  mockGetRecordSignedUrl.mockResolvedValue("https://storage.example/signed/rec-1.pdf?token=abc");
});

describe("GET /api/inspections/[id]/records/[recordId]", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const res = await GET(new Request("http://localhost"), makeParams("insp-1", "rec-1"));
    expect(res.status).toBe(401);
    expect(mockGetRecordSignedUrl).not.toHaveBeenCalled();
  });

  it("returns 404 when the inspection does not exist", async () => {
    mockSelectInspection.mockResolvedValueOnce([]);
    const res = await GET(new Request("http://localhost"), makeParams("insp-1", "rec-1"));
    expect(res.status).toBe(404);
  });

  it("returns 403 when the caller may not view the inspection (wrong-owner tech)", async () => {
    (checkInspectionAccess as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      allowed: false,
      role: "field_tech",
    });
    const res = await GET(new Request("http://localhost"), makeParams("insp-1", "rec-1"));
    expect(res.status).toBe(403);
    expect(mockGetRecordSignedUrl).not.toHaveBeenCalled();
  });

  it("returns 404 when the record is not found for this inspection", async () => {
    mockSelectRecord.mockResolvedValueOnce([]);
    const res = await GET(new Request("http://localhost"), makeParams("insp-1", "rec-other"));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Record not found");
  });

  it("returns 404 when the document was never stored (storage_path empty)", async () => {
    mockSelectRecord.mockResolvedValueOnce([{ storagePath: "" }]);
    const res = await GET(new Request("http://localhost"), makeParams("insp-1", "rec-1"));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Document was not stored");
    expect(mockGetRecordSignedUrl).not.toHaveBeenCalled();
  });

  it("302-redirects to a 600-second signed URL with no-store caching", async () => {
    const res = await GET(new Request("http://localhost"), makeParams("insp-1", "rec-1"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://storage.example/signed/rec-1.pdf?token=abc");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mockGetRecordSignedUrl).toHaveBeenCalledWith("records/insp-1/rec-1.pdf", 600);
  });

  it("returns 500 when signing fails", async () => {
    mockGetRecordSignedUrl.mockRejectedValueOnce(new Error("Signed URL creation failed: boom"));
    const res = await GET(new Request("http://localhost"), makeParams("insp-1", "rec-1"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("Signed URL creation failed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "src/app/api/inspections/[id]/records/[recordId]/__tests__/route.test.ts"`
Expected: FAIL — `Cannot find module '../route'`.

- [ ] **Step 3: Write the route**

```ts
// src/app/api/inspections/[id]/records/[recordId]/route.ts
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { inspectionRecords, inspections } from "@/lib/db/schema";
import { RECORD_SIGNED_URL_TTL_SECONDS, getRecordSignedUrl } from "@/lib/storage/record-storage";
import { checkInspectionAccess } from "@/lib/supabase/auth-helpers";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/inspections/[id]/records/[recordId]
 * 302 → 10-minute signed URL for a stored permit PDF.
 * Access: inspection owner, admin, or office_staff (same rule as /download).
 *
 * Linked from the tile with a plain <a target="_blank" rel="noopener"> — never
 * next/link, whose prefetch would fire this GET and burn a signed URL.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; recordId: string }> },
) {
  const { id, recordId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [inspection] = await db
    .select({ id: inspections.id, inspectorId: inspections.inspectorId })
    .from(inspections)
    .where(eq(inspections.id, id))
    .limit(1);

  if (!inspection) {
    return NextResponse.json({ error: "Inspection not found" }, { status: 404 });
  }

  const { allowed } = await checkInspectionAccess(supabase, user.id, inspection.inspectorId);
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Scope the record to this inspection so a record ID from another
  // inspection can never be reached through an inspection the caller may view.
  const [record] = await db
    .select({ storagePath: inspectionRecords.storagePath })
    .from(inspectionRecords)
    .where(and(eq(inspectionRecords.id, recordId), eq(inspectionRecords.inspectionId, id)))
    .limit(1);

  if (!record) {
    return NextResponse.json({ error: "Record not found" }, { status: 404 });
  }
  if (!record.storagePath) {
    return NextResponse.json({ error: "Document was not stored" }, { status: 404 });
  }

  let signedUrl: string;
  try {
    signedUrl = await getRecordSignedUrl(record.storagePath, RECORD_SIGNED_URL_TTL_SECONDS);
  } catch (err) {
    console.error("Record signed URL generation failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.redirect(signedUrl, {
    status: 302,
    headers: { "Cache-Control": "no-store" },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run "src/app/api/inspections/[id]/records/[recordId]/__tests__/route.test.ts"`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/inspections/[id]/records/[recordId]/"
git commit -m "feat(api): auth-gated signed-URL redirect for stored permit records"
```

---

### Task 10: Wire the permits stage into the orchestrator (`awaiting_selection`, real `continuePrefillAfterSelection`, DTO `downloadUrl`)

**Files:**
- Modify: `src/lib/prefill/run-prefill.ts` (phase-1 Task 5 file — `runPrefill` learns about candidates; `continuePrefillAfterSelection` becomes real)
- Modify: `src/lib/prefill/run-dto.ts` (phase-1 Task 5 file — `downloadUrl = ""` for records that were never stored; `isAbandonmentDocType` re-exported from `permits/doc-types`)
- Modify: `src/lib/prefill/__tests__/run-prefill.test.ts` (phase-1 test — retire the one assertion that pinned the permits stub)
- Test: `src/lib/prefill/__tests__/run-prefill.permits.test.ts`
- Test: `src/lib/prefill/__tests__/run-dto.records.test.ts`

**Interfaces:**
- Consumes: phase-1 `loadRunRow`, `updateRun`, `PrefillRunRow`, `InspectionRecordRow` (`src/lib/prefill/run-store.ts`); `StageContext`, `StageResult` (`src/lib/prefill/stage.ts`); `runAssessorStage` (`assessor.ts`); `runListingStage` (`listing/index.ts`, still the phase-1 stub); `runPermitsStage`, `runPermitsSelection` (Task 8); `isAbandonmentDocType` (Task 3); `emptyStages`, `PrefillInput`, `PrefillStages`, `ProposedField`, `PermitCandidate` (`types.ts`).
- Produces: `runPrefill(runId)` persists `status: "awaiting_selection"` + `candidates` (and `finishedAt: null`) when the permits stage returns candidates; `continuePrefillAfterSelection(runId, candidateKeys)` re-runs the permit search for a `running` run, stores the chosen documents, and finishes the run with the assessor/listing proposals kept; `toInspectionRecordDTO(row)` sets `downloadUrl: ""` when `row.storagePath === ""`.
- **`/select` route: no change.** Phase 1's `src/app/api/inspections/[id]/prefill/[runId]/select/route.ts` already validates `{ candidateKeys }` (1–3), checks `awaiting_selection` (409), flips the run to `running` and calls `after(() => continuePrefillAfterSelection(runId, keys))`; its tests stay as they are. The route "becomes real" purely by this task making the continuation real. `usePrefill().selectCandidates` (phase 1) already POSTs it and sets the run back to `running`, which resumes polling.

- [ ] **Step 1: Write the failing orchestrator test** (same mocking style as phase 1's `run-prefill.test.ts`)

```ts
// src/lib/prefill/__tests__/run-prefill.permits.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockLoadRunRow,
  mockUpdateRun,
  mockRunAssessorStage,
  mockRunListingStage,
  mockRunPermitsStage,
  mockRunPermitsSelection,
} = vi.hoisted(() => ({
  mockLoadRunRow: vi.fn(),
  mockUpdateRun: vi.fn(),
  mockRunAssessorStage: vi.fn(),
  mockRunListingStage: vi.fn(),
  mockRunPermitsStage: vi.fn(),
  mockRunPermitsSelection: vi.fn(),
}));

vi.mock("@/lib/prefill/run-store", () => ({
  loadRunRow: mockLoadRunRow,
  updateRun: mockUpdateRun,
}));
vi.mock("@/lib/prefill/assessor", () => ({ runAssessorStage: mockRunAssessorStage }));
vi.mock("@/lib/prefill/listing", () => ({ runListingStage: mockRunListingStage }));
vi.mock("@/lib/prefill/permits", () => ({
  runPermitsStage: mockRunPermitsStage,
  runPermitsSelection: mockRunPermitsSelection,
}));

import { continuePrefillAfterSelection, runPrefill } from "@/lib/prefill/run-prefill";
import type { StageContext } from "@/lib/prefill/stage";
import type { PermitCandidate, PrefillInput, ProposedField } from "@/lib/prefill/types";

const RUN = {
  id: "run-1",
  inspectionId: "insp-1",
  trigger: "manual",
  status: "queued",
  input: { apn: "219-11-121", address: { streetNumber: "8911", streetName: "Princess Dr" } },
  stages: {},
  proposals: [],
  candidates: [],
  error: null,
  appliedAt: null,
  createdBy: "user-1",
  createdAt: new Date(),
  finishedAt: null,
};

const CANDIDATE: PermitCandidate = {
  key: "edms_env:OWR-20-04198:NOTICE OF TRANSFER:2020-10-27",
  archive: "edms_env",
  permitNumber: "OWR-20-04198",
  docType: "NOTICE OF TRANSFER",
  docDate: "2020-10-27",
  streetAddress: "8911 E PRINCESS DR",
  city: "MESA",
  zip: "85207",
  score: 7,
};

const ASSESSOR_PROPOSAL: ProposedField = {
  fieldPath: "facilityInfo.taxParcelNumber",
  value: "219-11-121",
  kind: "fill",
  provenance: { source: "assessor", confidence: 1, explanation: "Assessor" },
};

const PERMIT_PROPOSAL: ProposedField = {
  fieldPath: "facilityInfo.recordsAvailable",
  value: "yes",
  kind: "fill",
  provenance: { source: "permit", confidence: 1, explanation: "Permit found" },
};

function lastPatch() {
  const call = mockUpdateRun.mock.calls[mockUpdateRun.mock.calls.length - 1];
  return call[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadRunRow.mockResolvedValue(RUN);
  mockUpdateRun.mockResolvedValue(undefined);
  mockRunAssessorStage.mockResolvedValue({
    stage: { status: "done", summary: "Parcel 219-11-121", links: [] },
    proposals: [ASSESSOR_PROPOSAL],
  });
  mockRunListingStage.mockResolvedValue({
    stage: { status: "skipped", summary: "Not available yet", links: [] },
    proposals: [],
  });
  mockRunPermitsStage.mockResolvedValue({
    stage: { status: "done", summary: "1 permit document found: 000972 PERMIT", links: [] },
    proposals: [PERMIT_PROPOSAL],
  });
  mockRunPermitsSelection.mockResolvedValue({
    stage: { status: "done", summary: "1 permit document found: OWR-20-04198 NOTICE OF TRANSFER", links: [] },
    proposals: [PERMIT_PROPOSAL],
  });
});

describe("runPrefill — permits stage", () => {
  it("passes the run input and a StageContext to the permits stage and finishes done", async () => {
    await runPrefill("run-1");

    const [input, ctx] = mockRunPermitsStage.mock.calls[0] as [PrefillInput, StageContext];
    expect(input).toEqual(RUN.input);
    expect(ctx).toMatchObject({ inspectionId: "insp-1", runId: "run-1" });
    expect(ctx.signal).toBeInstanceOf(AbortSignal);

    const final = lastPatch();
    expect(final.status).toBe("done");
    expect(final.stages.permits.summary).toContain("000972");
    expect(final.proposals).toEqual([ASSESSOR_PROPOSAL, PERMIT_PROPOSAL]);
    expect(final.candidates).toEqual([]);
    expect(final.finishedAt).toBeInstanceOf(Date);
  });

  it("persists a permits progress update mid-run", async () => {
    mockRunPermitsStage.mockImplementationOnce(async (_input: PrefillInput, ctx: StageContext) => {
      await ctx.progress({ status: "running", summary: "Searching Maricopa EDMS…" });
      return { stage: { status: "done", summary: "0", links: [] }, proposals: [] };
    });
    await runPrefill("run-1");
    const progressCall = mockUpdateRun.mock.calls.find(
      (c) => c[1].stages?.permits?.summary === "Searching Maricopa EDMS…",
    );
    expect(progressCall).toBeDefined();
  });

  it("moves the run to awaiting_selection with the candidates when the stage returns them", async () => {
    mockRunPermitsStage.mockResolvedValueOnce({
      stage: { status: "pending", summary: "3 possible permits — pick the right one", links: [] },
      proposals: [],
      candidates: [CANDIDATE],
    });
    await runPrefill("run-1");
    const final = lastPatch();
    expect(final).toMatchObject({
      status: "awaiting_selection",
      candidates: [CANDIDATE],
      finishedAt: null,
    });
    // assessor proposals are persisted now so the client can apply them while waiting
    expect(final.proposals).toEqual([ASSESSOR_PROPOSAL]);
    expect(final.stages.permits.status).toBe("pending");
  });
});

describe("continuePrefillAfterSelection", () => {
  it("re-runs the permit search for the chosen keys and merges proposals", async () => {
    mockLoadRunRow.mockResolvedValueOnce({
      ...RUN,
      status: "running",
      candidates: [CANDIDATE],
      proposals: [ASSESSOR_PROPOSAL],
      stages: { assessor: { status: "done", links: [] }, listing: { status: "skipped", links: [] }, permits: { status: "pending", links: [] } },
    });
    await continuePrefillAfterSelection("run-1", [CANDIDATE.key]);

    expect(mockRunPermitsSelection).toHaveBeenCalledTimes(1);
    const [input, ctx, keys] = mockRunPermitsSelection.mock.calls[0] as [PrefillInput, StageContext, string[]];
    expect(input).toEqual(RUN.input);
    expect(ctx).toMatchObject({ inspectionId: "insp-1", runId: "run-1" });
    expect(ctx.signal).toBeInstanceOf(AbortSignal);
    expect(keys).toEqual([CANDIDATE.key]);

    const final = lastPatch();
    expect(final).toMatchObject({ status: "done", candidates: [] });
    expect(final.finishedAt).toBeInstanceOf(Date);
    expect(final.stages.assessor.status).toBe("done");
    expect(final.stages.permits.summary).toContain("OWR-20-04198");
    expect(final.proposals).toEqual([ASSESSOR_PROPOSAL, PERMIT_PROPOSAL]);
    expect(mockRunPermitsStage).not.toHaveBeenCalled();
  });

  it("persists permit progress while the selection is being fetched", async () => {
    mockLoadRunRow.mockResolvedValueOnce({ ...RUN, status: "running" });
    mockRunPermitsSelection.mockImplementationOnce(
      async (_i: PrefillInput, ctx: StageContext) => {
        await ctx.progress({ status: "running", summary: "Fetching the selected permits…" });
        return { stage: { status: "done", links: [] }, proposals: [] };
      },
    );
    await continuePrefillAfterSelection("run-1", [CANDIDATE.key]);
    expect(
      mockUpdateRun.mock.calls.find(
        (c) => c[1].stages?.permits?.summary === "Fetching the selected permits…",
      ),
    ).toBeDefined();
  });

  it("does nothing when the run is missing or not running", async () => {
    mockLoadRunRow.mockResolvedValueOnce(null);
    await continuePrefillAfterSelection("run-1", [CANDIDATE.key]);
    mockLoadRunRow.mockResolvedValueOnce({ ...RUN, status: "done" });
    await continuePrefillAfterSelection("run-1", [CANDIDATE.key]);
    expect(mockRunPermitsSelection).not.toHaveBeenCalled();
    expect(mockUpdateRun).not.toHaveBeenCalled();
  });

  it("marks the run failed if the continuation throws", async () => {
    mockLoadRunRow.mockResolvedValueOnce({ ...RUN, status: "running" });
    mockRunPermitsSelection.mockRejectedValueOnce(new Error("unexpected"));
    await continuePrefillAfterSelection("run-1", [CANDIDATE.key]);
    expect(lastPatch()).toMatchObject({ status: "failed", error: "unexpected" });
    expect(lastPatch().finishedAt).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 2: Write the failing DTO test**

```ts
// src/lib/prefill/__tests__/run-dto.records.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prefill/run-store", () => ({
  listRecordRows: vi.fn(),
  loadLatestRunRow: vi.fn(),
  loadRunRow: vi.fn(),
}));

import { isAbandonmentDocType, toInspectionRecordDTO } from "@/lib/prefill/run-dto";
import type { InspectionRecordRow } from "@/lib/prefill/run-store";

const ROW: InspectionRecordRow = {
  id: "rec-1",
  inspectionId: "insp-1",
  runId: "run-1",
  source: "edms_env",
  permitNumber: "OWR-22-01512",
  docType: "ABANDONMENT",
  docDate: "2025-04-14",
  description: null,
  pageCount: 4,
  sizeBytes: 255378,
  storagePath: "records/insp-1/rec-1.pdf",
  selected: true,
  extractionStatus: "pending",
  extractionError: null,
  extracted: null,
  createdAt: new Date("2026-09-11T10:00:03.000Z"),
};

describe("toInspectionRecordDTO (phase 2)", () => {
  it("links stored documents and flags abandonment from the doc type", () => {
    expect(toInspectionRecordDTO(ROW)).toEqual({
      id: "rec-1",
      source: "edms_env",
      permitNumber: "OWR-22-01512",
      docType: "ABANDONMENT",
      docDate: "2025-04-14",
      description: null,
      pageCount: 4,
      sizeBytes: 255378,
      selected: true,
      extractionStatus: "pending",
      extractionError: null,
      isAbandonment: true,
      downloadUrl: "/api/inspections/insp-1/records/rec-1",
    });
  });

  it("leaves downloadUrl empty for a record that was never stored", () => {
    const dto = toInspectionRecordDTO({
      ...ROW,
      storagePath: "",
      pageCount: null,
      extractionStatus: "skipped",
      extractionError: "Larger than 25 MB (25.0 MB) — open it on Maricopa EDMS",
    });
    expect(dto.downloadUrl).toBe("");
    expect(dto.extractionError).toContain("Larger than 25 MB");
  });

  it("isAbandonmentDocType comes from permits/doc-types (shared vocabulary)", () => {
    expect(isAbandonmentDocType("abandonment")).toBe(true);
    expect(isAbandonmentDocType("NOTICE OF TRANSFER")).toBe(false);
  });
});
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `npx vitest run src/lib/prefill/__tests__/run-prefill.permits.test.ts src/lib/prefill/__tests__/run-dto.records.test.ts`
Expected: FAIL — `awaiting_selection` is never written; `continuePrefillAfterSelection` writes `status: "failed"` without calling `runPermitsSelection`; `downloadUrl` is non-empty for the unstored row.

- [ ] **Step 4: Modify `run-dto.ts`**

Replace the phase-1 `isAbandonmentDocType` function and the `downloadUrl` line:

```ts
// src/lib/prefill/run-dto.ts — imports: add
import { isAbandonmentDocType } from "./permits/doc-types";

// … delete the local `export function isAbandonmentDocType` and re-export the shared one:
export { isAbandonmentDocType };

/** Never exposes storage_path — documents are reached only through the auth-gated records route */
export function toInspectionRecordDTO(row: InspectionRecordRow): InspectionRecordDTO {
  return {
    id: row.id,
    source: row.source as PermitArchive,
    permitNumber: row.permitNumber,
    docType: row.docType,
    docDate: row.docDate,
    description: row.description,
    pageCount: row.pageCount,
    sizeBytes: row.sizeBytes,
    selected: row.selected,
    extractionStatus: row.extractionStatus as ExtractionStatus,
    extractionError: row.extractionError,
    isAbandonment: isAbandonmentDocType(row.docType),
    // "" = never stored (over 25 MB / download failed) — the tile hides the link, the route 404s
    downloadUrl: row.storagePath ? `/api/inspections/${row.inspectionId}/records/${row.id}` : "",
  };
}
```

Everything else in `run-dto.ts` (`toPrefillRunDTO`, `loadRunDTO`, `loadLatestRunDTO`) is unchanged.

- [ ] **Step 5: Modify `run-prefill.ts`**

Replace the whole file with the version below — it is phase 1's orchestrator (including its amendment-A2 re-export of the stage types) plus (a) a `PermitsStageResult` type for the permits slot, (b) `awaiting_selection` handling, (c) shared `makeContext` / `failRun` helpers, and (d) the real `continuePrefillAfterSelection`:

```ts
// src/lib/prefill/run-prefill.ts
import { runAssessorStage } from "./assessor";
import { runListingStage } from "./listing";
import { runPermitsSelection, runPermitsStage } from "./permits";
import type { PrefillRunRow } from "./run-store";
import { loadRunRow, updateRun } from "./run-store";
import type { StageContext, StageResult } from "./stage";
import type { PermitCandidate, PrefillInput, PrefillStages, ProposedField } from "./types";
import { emptyStages } from "./types";

// Amendment A2: either import path for the stage contracts keeps working
export type { StageContext, StageResult } from "./stage";

/** Hard stop for a whole run; whatever finished is persisted */
export const PREFILL_TOTAL_BUDGET_MS = 240_000;

const STAGE_NAMES: Array<keyof PrefillStages> = ["assessor", "listing", "permits"];

type PermitsStageResult = StageResult & { candidates?: PermitCandidate[] };

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/** Builds the StageContext for one stage; `progress` persists a snapshot of all stages. */
function makeContext(
  run: PrefillRunRow,
  runId: string,
  stages: PrefillStages,
  signal: AbortSignal,
  name: keyof PrefillStages,
): StageContext {
  return {
    inspectionId: run.inspectionId,
    runId,
    signal,
    progress: async (patch) => {
      stages[name] = { ...stages[name], ...patch };
      await updateRun(runId, { stages: { ...stages } });
    },
  };
}

async function failRun(runId: string, stages: PrefillStages, err: unknown): Promise<void> {
  console.error("[prefill] run failed", runId, err);
  try {
    await updateRun(runId, {
      status: "failed",
      stages: { ...stages },
      error: errorMessage(err, "Prefill failed"),
      finishedAt: new Date(),
    });
  } catch (persistErr) {
    console.error("[prefill] could not record failure", runId, persistErr);
  }
}

/**
 * Runs all stages for a run row that is `queued`, persisting progress after each stage.
 * Safe to call from `after()`. Never throws; on unexpected error marks the run `failed`.
 * When the permits stage returns candidates the run parks in `awaiting_selection`
 * (assessor/listing proposals are persisted so the client can apply them meanwhile)
 * and resumes through `continuePrefillAfterSelection`.
 */
export async function runPrefill(runId: string): Promise<void> {
  let run: PrefillRunRow | null;
  try {
    run = await loadRunRow(runId);
  } catch (err) {
    console.error("[prefill] could not load run", runId, err);
    return;
  }
  if (!run || run.status !== "queued") return;

  const input = (run.input ?? {}) as PrefillInput;
  const stages = emptyStages();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PREFILL_TOTAL_BUDGET_MS);
  const ctx = (name: keyof PrefillStages) => makeContext(run, runId, stages, controller.signal, name);

  try {
    await updateRun(runId, { status: "running", stages: { ...stages } });

    const settled = await Promise.allSettled<StageResult | PermitsStageResult>([
      runAssessorStage(input, ctx("assessor")),
      runListingStage(input, ctx("listing")),
      runPermitsStage(input, ctx("permits")),
    ]);

    const proposals: ProposedField[] = [];
    let candidates: PermitCandidate[] = [];
    settled.forEach((result, i) => {
      const name = STAGE_NAMES[i];
      if (result.status === "fulfilled") {
        stages[name] = result.value.stage;
        proposals.push(...result.value.proposals);
        if (name === "permits") {
          candidates = (result.value as PermitsStageResult).candidates ?? [];
        }
      } else {
        // Stage modules are contracted never to throw; this is the belt-and-braces path
        stages[name] = {
          ...stages[name],
          status: "error",
          error: errorMessage(result.reason, "Stage failed"),
          finishedAt: new Date().toISOString(),
          links: stages[name].links ?? [],
        };
      }
    });

    const awaiting = candidates.length > 0;
    await updateRun(runId, {
      status: awaiting ? "awaiting_selection" : "done",
      stages: { ...stages },
      proposals,
      candidates,
      finishedAt: awaiting ? null : new Date(),
    });
  } catch (err) {
    await failRun(runId, stages, err);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Called by POST /prefill/[runId]/select via after(). The route has already
 * validated the keys and flipped the run to `running`. EDMS document IDs are
 * ephemeral, so the permits module re-runs the same search and matches the
 * chosen candidates by their stable `key`, then stores them. Proposals from the
 * other stages (persisted at `awaiting_selection`) are kept; permit proposals
 * are replaced by the selection's.
 */
export async function continuePrefillAfterSelection(
  runId: string,
  candidateKeys: string[],
): Promise<void> {
  let run: PrefillRunRow | null;
  try {
    run = await loadRunRow(runId);
  } catch (err) {
    console.error("[prefill] could not load run for selection", runId, err);
    return;
  }
  if (!run || run.status !== "running") return;

  const input = (run.input ?? {}) as PrefillInput;
  const stages: PrefillStages = { ...emptyStages(), ...((run.stages ?? {}) as Partial<PrefillStages>) };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PREFILL_TOTAL_BUDGET_MS);

  try {
    const selection = await runPermitsSelection(
      input,
      makeContext(run, runId, stages, controller.signal, "permits"),
      candidateKeys,
    );
    stages.permits = selection.stage;

    const kept = ((run.proposals ?? []) as ProposedField[]).filter(
      (p) => p.provenance.source !== "permit",
    );
    await updateRun(runId, {
      status: "done",
      stages: { ...stages },
      proposals: [...kept, ...selection.proposals],
      candidates: [],
      finishedAt: new Date(),
    });
  } catch (err) {
    await failRun(runId, stages, err);
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 6: Retire the stub assertion in phase 1's `run-prefill.test.ts`**

In `src/lib/prefill/__tests__/run-prefill.test.ts`:

1. Next to the existing `vi.mock("@/lib/prefill/assessor", …)` add mocks for the other two stages so the test never touches EDMS:

```ts
const { mockRunListingStage, mockRunPermitsStage } = vi.hoisted(() => ({
  mockRunListingStage: vi.fn(async () => ({
    stage: { status: "skipped", summary: "Not available yet", links: [] },
    proposals: [],
  })),
  mockRunPermitsStage: vi.fn(async () => ({
    stage: { status: "not_found", summary: "No permit records found", links: [] },
    proposals: [],
  })),
}));
vi.mock("@/lib/prefill/listing", () => ({ runListingStage: mockRunListingStage }));
vi.mock("@/lib/prefill/permits", () => ({
  runPermitsStage: mockRunPermitsStage,
  runPermitsSelection: vi.fn(),
}));
```

2. Change the single line

```ts
    expect(final.stages.permits).toEqual({ status: "skipped", summary: "Not available yet", links: [] });
```

to

```ts
    expect(final.stages.permits).toEqual({ status: "not_found", summary: "No permit records found", links: [] });
```

3. If phase 1's file has a `continuePrefillAfterSelection` test asserting the `"Candidate selection is not available yet"` failure, delete that test (the behaviour is now covered by `run-prefill.permits.test.ts`).

- [ ] **Step 7: Run the orchestrator + DTO tests**

Run: `npx vitest run src/lib/prefill/__tests__/`
Expected: PASS — `run-prefill.permits.test.ts` (7 tests), `run-dto.records.test.ts` (3 tests), phase-1's `run-prefill.test.ts` / `run-dto.test.ts` still green (phase 1's DTO fixture has a non-empty `storagePath`, so its `downloadUrl` expectation holds).

- [ ] **Step 8: Commit**

```bash
git add src/lib/prefill/run-prefill.ts src/lib/prefill/run-dto.ts src/lib/prefill/__tests__/run-prefill.test.ts src/lib/prefill/__tests__/run-prefill.permits.test.ts src/lib/prefill/__tests__/run-dto.records.test.ts
git commit -m "feat(prefill): permits stage drives awaiting_selection; real post-selection continuation; unstored records have no download link"
```

---

### Task 11: Tile UI — permit rows, candidate picker, copy-APN

**Files:**
- Create: `src/components/prefill/permit-records-list.tsx`
- Modify: `src/components/prefill/prefill-sources-tile.tsx` (phase-1 Task 12 file: new optional `onSelectCandidates` prop; mount the list under the Permits row)
- Modify: `src/components/prefill/prefill-panel.tsx` (phase-1 Task 14 file: pass `prefill.selectCandidates` through)
- Test: `src/components/prefill/__tests__/permit-records-list.test.tsx`
- Test: `src/components/prefill/__tests__/prefill-sources-tile.permits.test.tsx`

**Interfaces:**
- Consumes: `PrefillRunDTO`, `InspectionRecordDTO`, `PermitCandidate`, `MAX_DOCUMENTS_PER_RUN` (`types.ts`); `propertyGroupKey` (Task 5, pure); `rankForExtraction` (Task 3, pure); `Button` (`@/components/ui/button`); `toast` (`sonner`); `lucide-react`; phase-1 `PrefillSourcesTile({ run, isRunning, canRun, error, onFindRecords })`, `PrefillPanel`, `usePrefill().selectCandidates(keys)`.
- Produces: `PermitRecordsList({ run, onSelectCandidates, disabled? })`, `formatDocDate(iso?: string | null): string`, `formatBytes(n?: number | null): string`, `groupCandidates(candidates): CandidateGroup[]` (`{ key, label, detail, candidates }`); `PrefillSourcesTileProps.onSelectCandidates?: (keys: string[]) => Promise<void> | void`.

**What renders where (nothing duplicated with phase 1):** phase 1's Permits row already shows the status icon, `stageSummary(stage)` — this is where Task 8's not-found copy `No permit records found (searched APN 219-11-121 and 8911 CAVE CREEK — 0 matches)` appears — and `stage.links` as plain `<a target="_blank" rel="noopener noreferrer">` (Task 8's **Open on Maricopa EDMS** / **EDMS 2024+ archive**). Phase 1's tile also already renders the red abandonment `Banner` when `run.records.some(r => r.isAbandonment)`, which Task 10's DTO now sets from the doc type. `PermitRecordsList` therefore adds, beneath the Permits row: one row per record (permit #, type, date, page count, size, status, a plain new-tab **Open PDF** link when stored, a red **ABANDONMENT** tag on abandonment rows), the candidate picker (one radio per property group + **Use selected**), and a **Copy APN** button (EDMS has no deep links; the user pastes the APN into the EDMS search page).

- [ ] **Step 1: Write the failing component test**

```tsx
// src/components/prefill/__tests__/permit-records-list.test.tsx
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InspectionRecordDTO, PermitCandidate, PrefillRunDTO } from "@/lib/prefill/types";
import { emptyStages } from "@/lib/prefill/types";

const { mockToastSuccess, mockToastError } = vi.hoisted(() => ({
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: mockToastSuccess, error: mockToastError } }));

import {
  PermitRecordsList,
  formatBytes,
  formatDocDate,
  groupCandidates,
} from "../permit-records-list";

function record(over: Partial<InspectionRecordDTO> & { id: string }): InspectionRecordDTO {
  return {
    source: "edms_env",
    permitNumber: "OW-17-00474",
    docType: "PERMIT",
    docDate: "2018-02-08",
    description: null,
    pageCount: 21,
    sizeBytes: 1968056,
    selected: true,
    extractionStatus: "pending",
    extractionError: null,
    isAbandonment: false,
    downloadUrl: `/api/inspections/insp-1/records/${over.id}`,
    ...over,
  };
}

function candidate(
  over: Partial<PermitCandidate> & { permitNumber: string; docType: string },
): PermitCandidate {
  return {
    key: `edms_env:${over.permitNumber}:${over.docType}:${over.docDate ?? ""}`,
    archive: "edms_env",
    streetAddress: "8911 E PRINCESS DR",
    city: "MESA",
    zip: "85207",
    score: 7,
    ...over,
  };
}

function run(over: Partial<PrefillRunDTO> = {}): PrefillRunDTO {
  return {
    id: "run-1",
    inspectionId: "insp-1",
    trigger: "manual",
    status: "done",
    input: { apn: "219-11-121" },
    stages: {
      ...emptyStages(),
      permits: { status: "done", links: [], summary: "1 permit document found" },
    },
    proposals: [],
    candidates: [],
    error: null,
    appliedAt: null,
    createdAt: "2026-09-11T10:00:00Z",
    finishedAt: "2026-09-11T10:00:30Z",
    records: [],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("formatters", () => {
  it("formats ISO dates as M/D/YYYY without timezone drift and sizes in KB/MB", () => {
    expect(formatDocDate("2018-02-08")).toBe("2/8/2018");
    expect(formatDocDate(null)).toBe("");
    expect(formatBytes(147386)).toBe("144 KB");
    expect(formatBytes(1968056)).toBe("1.9 MB");
    expect(formatBytes(null)).toBe("");
  });
});

describe("PermitRecordsList — records", () => {
  it("renders one row per record with permit #, type, date, page count and a plain new-tab link", () => {
    render(
      <PermitRecordsList
        run={run({
          records: [
            record({ id: "rec-1" }),
            record({
              id: "rec-2",
              permitNumber: "OWR-22-04475",
              docType: "NOTICE OF TRANSFER",
              docDate: "2022-09-21",
              pageCount: 5,
              sizeBytes: 147386,
            }),
          ],
        })}
        onSelectCandidates={vi.fn()}
      />,
    );
    const rows = within(screen.getByRole("list", { name: /permit documents/i })).getAllByRole(
      "listitem",
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("OW-17-00474");
    expect(rows[0]).toHaveTextContent("PERMIT");
    expect(rows[0]).toHaveTextContent("2/8/2018");
    expect(rows[0]).toHaveTextContent("21 pages");
    expect(rows[0]).toHaveTextContent("1.9 MB");
    expect(rows[0]).toHaveTextContent("Queued for extraction");

    const link = within(rows[0]).getByRole("link", { name: /open pdf/i });
    expect(link).toHaveAttribute("href", "/api/inspections/insp-1/records/rec-1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(rows[1]).toHaveTextContent("144 KB");
  });

  it("shows the reason instead of a link for a document that was not stored", () => {
    render(
      <PermitRecordsList
        run={run({
          records: [
            record({
              id: "rec-3",
              downloadUrl: "",
              pageCount: null,
              sizeBytes: 26214401,
              extractionStatus: "skipped",
              extractionError: "Larger than 25 MB (25.0 MB) — open it on Maricopa EDMS",
            }),
            record({
              id: "rec-4",
              downloadUrl: "",
              pageCount: null,
              extractionStatus: "failed",
              extractionError: "Download failed: EDMS document download failed (500)",
            }),
          ],
        })}
        onSelectCandidates={vi.fn()}
      />,
    );
    expect(screen.queryByRole("link", { name: /open pdf/i })).toBeNull();
    expect(screen.getByText(/Larger than 25 MB/)).toBeInTheDocument();
    expect(screen.getByText(/Download failed: .* — re-run Find records/)).toBeInTheDocument();
  });

  it("tags abandonment rows (the tile's banner is phase 1's — no second alert here)", () => {
    render(
      <PermitRecordsList
        run={run({
          records: [
            record({
              id: "rec-5",
              permitNumber: "OWR-22-01512",
              docType: "ABANDONMENT",
              docDate: "2025-04-14",
              isAbandonment: true,
            }),
          ],
        })}
        onSelectCandidates={vi.fn()}
      />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    const row = screen.getByRole("listitem");
    expect(within(row).getByText("ABANDONMENT", { selector: "span.uppercase" })).toBeInTheDocument();
    expect(row).toHaveTextContent("4/14/2025");
  });

  it("renders no list and no picker for an empty done run", () => {
    render(<PermitRecordsList run={run()} onSelectCandidates={vi.fn()} />);
    expect(screen.queryByRole("list", { name: /permit documents/i })).toBeNull();
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });
});

describe("PermitRecordsList — candidate picker", () => {
  const candidates = [
    candidate({
      permitNumber: "OWR-22-01478",
      docType: "NOTICE OF TRANSFER",
      docDate: "2022-03-28",
      apn: "218-06-099A",
    }),
    candidate({ permitNumber: "OWR-20-04198", docType: "NOTICE OF TRANSFER", docDate: "2020-10-27" }),
    candidate({
      permitNumber: "743691",
      docType: "PERMIT",
      docDate: "2015-09-11",
      streetAddress: "8911 E PRINCESS",
      city: undefined,
      zip: undefined,
      score: 3,
    }),
  ];

  it("groups candidates by property and lists their documents", () => {
    const groups = groupCandidates(candidates);
    expect(groups).toHaveLength(3);
    expect(groups[0].label).toBe("8911 E PRINCESS DR, MESA 85207");
    expect(groups[0].detail).toContain("APN 218-06-099A");
    expect(groups[0].candidates.map((c) => c.permitNumber)).toEqual(["OWR-22-01478"]);
  });

  it("renders a radio per property group and sends the chosen group's keys", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn().mockResolvedValue(undefined);
    render(
      <PermitRecordsList
        run={run({
          status: "awaiting_selection",
          candidates,
          stages: {
            ...emptyStages(),
            permits: { status: "pending", links: [], summary: "3 possible permits — pick the right one" },
          },
        })}
        onSelectCandidates={onSelect}
      />,
    );
    expect(screen.getByText("3 possible permits — pick the right one")).toBeInTheDocument();
    const radios = within(screen.getByRole("radiogroup")).getAllByRole("radio");
    expect(radios).toHaveLength(3);

    const useSelected = screen.getByRole("button", { name: /use selected/i });
    expect(useSelected).toBeDisabled();

    await user.click(radios[1]);
    expect(useSelected).toBeEnabled();
    await user.click(useSelected);
    expect(onSelect).toHaveBeenCalledWith([candidates[1].key]);
  });

  it("caps a large group at MAX_DOCUMENTS_PER_RUN keys in extraction rank order", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const big = [
      candidate({ permitNumber: "P1", docType: "PLAN REVIEW", docDate: "2024-01-01" }),
      candidate({ permitNumber: "P2", docType: "NOTICE OF TRANSFER", docDate: "2022-01-01" }),
      candidate({ permitNumber: "P3", docType: "PERMIT", docDate: "2015-01-01" }),
      candidate({ permitNumber: "P4", docType: "FINAL DA", docDate: "2025-01-01" }),
    ];
    render(
      <PermitRecordsList
        run={run({ status: "awaiting_selection", candidates: big })}
        onSelectCandidates={onSelect}
      />,
    );
    await user.click(screen.getByRole("radio"));
    await user.click(screen.getByRole("button", { name: /use selected/i }));
    expect(onSelect).toHaveBeenCalledWith([
      "edms_env:P4:FINAL DA:2025-01-01",
      "edms_env:P3:PERMIT:2015-01-01",
      "edms_env:P2:NOTICE OF TRANSFER:2022-01-01",
    ]);
  });

  it("disables the button when the list is disabled (run in flight / read-only)", () => {
    render(
      <PermitRecordsList
        run={run({ status: "awaiting_selection", candidates })}
        onSelectCandidates={vi.fn()}
        disabled
      />,
    );
    expect(screen.getByRole("button", { name: /use selected/i })).toBeDisabled();
  });

  it("does not show the picker once the run is no longer awaiting selection", () => {
    render(
      <PermitRecordsList run={run({ status: "done", candidates })} onSelectCandidates={vi.fn()} />,
    );
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });
});

describe("PermitRecordsList — copy APN", () => {
  it("copies the APN to the clipboard and toasts", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(
      <PermitRecordsList run={run({ input: { apn: "219-11-121" } })} onSelectCandidates={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: /copy apn 219-11-121/i }));
    expect(writeText).toHaveBeenCalledWith("219-11-121");
    expect(mockToastSuccess).toHaveBeenCalled();
  });

  it("hides the copy button when the run has no APN", () => {
    render(<PermitRecordsList run={run({ input: {} })} onSelectCandidates={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /copy apn/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/prefill/__tests__/permit-records-list.test.tsx`
Expected: FAIL — `Cannot find module '../permit-records-list'`.

- [ ] **Step 3: Write the component**

```tsx
// src/components/prefill/permit-records-list.tsx
"use client";

import { Copy, ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { rankForExtraction } from "@/lib/prefill/permits/doc-types";
import { propertyGroupKey } from "@/lib/prefill/permits/search";
import {
  type InspectionRecordDTO,
  MAX_DOCUMENTS_PER_RUN,
  type PermitCandidate,
  type PrefillRunDTO,
} from "@/lib/prefill/types";

export interface PermitRecordsListProps {
  run: PrefillRunDTO;
  /** usePrefill().selectCandidates — POSTs /prefill/[runId]/select and resumes polling */
  onSelectCandidates: (keys: string[]) => Promise<void> | void;
  /** True while a run is in flight or on read-only views — the picker cannot submit */
  disabled?: boolean;
}

export interface CandidateGroup {
  key: string;
  /** "8911 E PRINCESS DR, MESA 85207" */
  label: string;
  /** "Subdivision SUNRISE 4 · Lot 2 · APN 200-08-079" */
  detail: string;
  candidates: PermitCandidate[];
}

/** "2018-02-08" → "2/8/2018" (string split — no Date/timezone drift) */
export function formatDocDate(iso?: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${Number(m)}/${Number(d)}/${y}`;
}

export function formatBytes(n?: number | null): string {
  if (n === null || n === undefined) return "";
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

export function groupCandidates(candidates: PermitCandidate[]): CandidateGroup[] {
  const groups = new Map<string, CandidateGroup>();
  for (const c of candidates) {
    const key = propertyGroupKey(c);
    let group = groups.get(key);
    if (!group) {
      const place = [c.streetAddress, [c.city, c.zip].filter(Boolean).join(" ")]
        .filter(Boolean)
        .join(", ");
      const detail = [
        c.subdivision ? `Subdivision ${c.subdivision}` : "",
        c.lot ? `Lot ${c.lot}` : "",
        c.apn ? `APN ${c.apn}` : "No APN on record",
      ]
        .filter(Boolean)
        .join(" · ");
      group = { key, label: place || "Address not recorded", detail, candidates: [] };
      groups.set(key, group);
    }
    group.candidates.push(c);
  }
  return [...groups.values()];
}

function statusLabel(r: InspectionRecordDTO): string {
  switch (r.extractionStatus) {
    case "pending":
      return "Queued for extraction";
    case "done":
      return "Extracted";
    case "failed":
      return `${r.extractionError ?? "Failed"} — re-run Find records`;
    default:
      return r.extractionError ?? "Not extracted";
  }
}

export function PermitRecordsList({ run, onSelectCandidates, disabled }: PermitRecordsListProps) {
  const [chosenGroup, setChosenGroup] = useState<string | null>(null);
  const groups = useMemo(() => groupCandidates(run.candidates), [run.candidates]);
  const showPicker = run.status === "awaiting_selection" && groups.length > 0;
  const apn = run.input.apn;

  const handleUseSelected = async () => {
    const group = groups.find((g) => g.key === chosenGroup);
    if (!group) return;
    const keys = rankForExtraction(group.candidates)
      .slice(0, MAX_DOCUMENTS_PER_RUN)
      .map((c) => c.key);
    await onSelectCandidates(keys);
  };

  const handleCopyApn = async () => {
    if (!apn) return;
    try {
      await navigator.clipboard.writeText(apn);
      toast.success(`Copied ${apn} — paste it into the EDMS parcel search`);
    } catch {
      toast.error("Could not copy — select the APN and copy it manually");
    }
  };

  if (run.records.length === 0 && !showPicker && !apn) return null;

  return (
    <div className="space-y-3 pl-6 text-sm" data-slot="permit-records-list">
      {run.records.length > 0 && (
        <ul aria-label="Permit documents" className="space-y-1.5">
          {run.records.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="font-medium">{r.permitNumber}</span>
              {r.isAbandonment ? (
                <span className="rounded bg-red-100 px-1 text-xs font-semibold uppercase text-red-800">
                  {r.docType}
                </span>
              ) : (
                <span className="text-muted-foreground">{r.docType}</span>
              )}
              {r.docDate && (
                <span className="text-muted-foreground">{formatDocDate(r.docDate)}</span>
              )}
              {r.pageCount !== null && (
                <span className="text-muted-foreground">
                  {r.pageCount} page{r.pageCount === 1 ? "" : "s"}
                </span>
              )}
              {r.sizeBytes !== null && (
                <span className="text-muted-foreground">{formatBytes(r.sizeBytes)}</span>
              )}
              <span className="text-xs text-muted-foreground">{statusLabel(r)}</span>
              {r.downloadUrl && (
                // Plain anchor on purpose: next/link would prefetch the GET and burn a signed URL.
                <a
                  href={r.downloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                >
                  Open PDF
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}

      {showPicker && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
          <p className="mb-2 font-medium text-amber-900">
            {run.stages.permits.summary ??
              `${run.candidates.length} possible permits — pick the right one`}
          </p>
          <div role="radiogroup" aria-label="Possible permits" className="space-y-2">
            {groups.map((g) => (
              <label key={g.key} className="flex cursor-pointer items-start gap-2">
                <input
                  type="radio"
                  name={`permit-candidate-${run.id}`}
                  value={g.key}
                  checked={chosenGroup === g.key}
                  onChange={() => setChosenGroup(g.key)}
                  className="mt-1"
                />
                <span>
                  <span className="block font-medium">{g.label}</span>
                  <span className="block text-xs text-muted-foreground">{g.detail}</span>
                  <span className="block text-xs">
                    {g.candidates
                      .map(
                        (c) =>
                          `${c.permitNumber} · ${c.docType}${c.docDate ? ` · ${formatDocDate(c.docDate)}` : ""}`,
                      )
                      .join(" | ")}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <Button
            type="button"
            size="sm"
            className="mt-3"
            disabled={!chosenGroup || disabled}
            onClick={handleUseSelected}
          >
            Use selected
          </Button>
        </div>
      )}

      {apn && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1.5 px-2"
          onClick={handleCopyApn}
          aria-label={`Copy APN ${apn}`}
        >
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          Copy APN {apn}
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/prefill/__tests__/permit-records-list.test.tsx`
Expected: PASS (12 tests).

- [ ] **Step 5: Write the failing tile test**

```tsx
// src/components/prefill/__tests__/prefill-sources-tile.permits.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PrefillRunDTO } from "@/lib/prefill/types";
import { emptyStages } from "@/lib/prefill/types";

const { mockList } = vi.hoisted(() => ({
  mockList: vi.fn(() => <div data-testid="permit-records-list" />),
}));
vi.mock("@/components/prefill/permit-records-list", () => ({ PermitRecordsList: mockList }));

import { PrefillSourcesTile } from "../prefill-sources-tile";

const notFoundRun: PrefillRunDTO = {
  id: "run-1",
  inspectionId: "insp-1",
  trigger: "manual",
  status: "done",
  input: { apn: "219-11-121", address: { streetNumber: "8911", streetName: "Cave Creek Rd" } },
  stages: {
    ...emptyStages(),
    permits: {
      status: "not_found",
      summary: "No permit records found (searched APN 219-11-121 and 8911 CAVE CREEK — 0 matches)",
      links: [{ label: "Open on Maricopa EDMS", url: "https://edms.maricopa.gov/env/" }],
    },
  },
  proposals: [],
  candidates: [],
  error: null,
  appliedAt: null,
  createdAt: "2026-09-11T10:00:00Z",
  finishedAt: "2026-09-11T10:00:30Z",
  records: [],
};

const onSelectCandidates = vi.fn();
const tileProps = {
  run: notFoundRun,
  isRunning: false,
  canRun: true,
  error: null,
  onFindRecords: vi.fn(),
  onSelectCandidates,
};

describe("PrefillSourcesTile — permits", () => {
  it("shows the not-found copy with the searched terms and the EDMS link on the Permits row", () => {
    render(<PrefillSourcesTile {...tileProps} />);
    expect(
      screen.getByText(/No permit records found \(searched APN 219-11-121 and 8911 CAVE CREEK — 0 matches\)/),
    ).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /open on maricopa edms/i });
    expect(link).toHaveAttribute("href", "https://edms.maricopa.gov/env/");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("mounts PermitRecordsList with the run, the selection handler and the running flag", () => {
    mockList.mockClear();
    render(<PrefillSourcesTile {...tileProps} isRunning />);
    expect(screen.getByTestId("permit-records-list")).toBeInTheDocument();
    const props = mockList.mock.calls[0][0] as {
      run: PrefillRunDTO;
      onSelectCandidates: unknown;
      disabled: boolean;
    };
    expect(props.run).toBe(notFoundRun);
    expect(props.onSelectCandidates).toBe(onSelectCandidates);
    expect(props.disabled).toBe(true);
  });

  it("disables the list when no selection handler is provided (read-only views)", () => {
    mockList.mockClear();
    render(<PrefillSourcesTile {...tileProps} onSelectCandidates={undefined} />);
    const props = mockList.mock.calls[0][0] as { disabled: boolean };
    expect(props.disabled).toBe(true);
  });

  it("does not mount PermitRecordsList when there is no run yet", () => {
    mockList.mockClear();
    render(<PrefillSourcesTile {...tileProps} run={null} />);
    expect(mockList).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/components/prefill/__tests__/prefill-sources-tile.permits.test.tsx`
Expected: FAIL — `permit-records-list` is never rendered (the first test passes already: phase 1's row renders the summary and links).

- [ ] **Step 7: Mount the list in the tile and thread the handler from the panel**

In `src/components/prefill/prefill-sources-tile.tsx`:

1. Import:

```tsx
import { PermitRecordsList } from "@/components/prefill/permit-records-list";
```

2. Extend the props interface (optional so the read-only review page can omit it):

```tsx
export interface PrefillSourcesTileProps {
  run: PrefillRunDTO | null;
  isRunning: boolean;
  /** False on non-drafts / read-only views — the button is disabled */
  canRun: boolean;
  /** Hook-level error (409 / 429 / network) shown above the rows */
  error: string | null;
  onFindRecords: () => void;
  /** usePrefill().selectCandidates; omit on read-only views — the picker then cannot submit */
  onSelectCandidates?: (keys: string[]) => Promise<void> | void;
}
```

and destructure it: `export function PrefillSourcesTile({ run, isRunning, canRun, error, onFindRecords, onSelectCandidates }: PrefillSourcesTileProps)`.

3. Inside the `STAGE_ROWS.map(...)` `<li>`, directly after the closing `</div>` of the `min-w-0 flex-1` block (i.e. still inside the `<li>`, after the summary + links), the `permits` row gets the list. The complete `<li>` becomes:

```tsx
                  <li
                    key={key}
                    className="flex flex-col gap-1 text-sm"
                    data-stage={key}
                    data-status={stage.status}
                  >
                    <div className="flex items-start gap-2">
                      <StageIcon status={stage.status} />
                      <div className="min-w-0 flex-1">
                        <span className="font-medium">{label}</span>
                        <span className="text-muted-foreground"> · {stageSummary(stage)}</span>
                        {stage.links.length > 0 && (
                          <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1">
                            {stage.links.map((link) => (
                              <a
                                key={link.url}
                                href={link.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-primary underline underline-offset-2"
                              >
                                {link.label}
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    {key === "permits" && (
                      <PermitRecordsList
                        run={run}
                        onSelectCandidates={onSelectCandidates ?? (() => undefined)}
                        disabled={isRunning || !onSelectCandidates}
                      />
                    )}
                  </li>
```

(`run` is non-null inside this branch — the `<ul>` only renders when `run` is truthy.) Nothing else in the tile changes; phase 1's tests keep passing because the row text, links and banners are untouched.

In `src/components/prefill/prefill-panel.tsx`, pass the hook action through — the tile element becomes:

```tsx
      <PrefillSourcesTile
        run={prefill.run}
        isRunning={prefill.isRunning}
        canRun
        error={prefill.error}
        onFindRecords={() => {
          void prefill.start({ trigger: "manual" });
        }}
        onSelectCandidates={(keys) => prefill.selectCandidates(keys)}
      />
```

- [ ] **Step 8: Run the prefill component tests**

Run: `npx vitest run src/components/prefill/`
Expected: PASS — phase-1 tile/badge/chip/panel tests unchanged, plus the two new files (12 + 4 tests).

- [ ] **Step 9: Commit**

```bash
git add src/components/prefill/permit-records-list.tsx src/components/prefill/prefill-sources-tile.tsx src/components/prefill/prefill-panel.tsx src/components/prefill/__tests__/permit-records-list.test.tsx src/components/prefill/__tests__/prefill-sources-tile.permits.test.tsx
git commit -m "feat(prefill-ui): permit record rows, candidate picker and copy-APN under the Permits row"
```

---

### Task 12: Live smoke script against the real EDMS API

**Files:**
- Create: `scripts/prefill-permits-smoke.mts`
- Modify: `package.json` (`tsx` dev dependency + `smoke:permits` script)

**Interfaces:**
- Consumes: `formatApn` (Task 1); `EDMS_ARCHIVES`, `getDocumentInfo`, `fetchDocumentBytes` (Task 2); `rankForExtraction`, `isExtractableDocType` (Task 3); `searchPermits` (Task 5); `MAX_DOCUMENT_BYTES`, `MAX_DOCUMENTS_PER_RUN`, `PrefillInput` (`types.ts`). Only pure/relative-import modules — **no** `@/lib/db`, no storage, so nothing is written except optional PDFs to a local directory.
- Produces: `npm run smoke:permits` (alias for `npx tsx scripts/prefill-permits-smoke.mts`) printing candidates and the extraction ranking for parcels `219-11-121` and `200-08-079` (defaults), any APNs passed as arguments, `--fallback` to exercise the street search with the APN blanked, and `--download` to fetch the PDFs into `SMOKE_OUT_DIR` (default `$TMPDIR/prefill-permits-smoke`). Exit code 1 when a built-in parcel does not yield its expected permit.

- [ ] **Step 1: Add `tsx` and the npm script**

`tsx` is not in `node_modules/.bin` (checked 2026-09-11) even though older scripts say `npx tsx …`. Pin it:

```bash
npm install -D tsx
```

Then in `package.json` `"scripts"` add (keep the existing keys):

```json
"smoke:permits": "tsx scripts/prefill-permits-smoke.mts"
```

- [ ] **Step 2: Write the script**

```ts
// scripts/prefill-permits-smoke.mts
/**
 * Live smoke test for the phase-2 permit search against the REAL Maricopa
 * EDMS API (both archives). Read-only unless --download is given, and even
 * then it only writes PDFs to a local directory — never Storage or the DB.
 *
 * Usage:
 *   npm run smoke:permits                       # 219-11-121 and 200-08-079
 *   npm run smoke:permits -- 219-12-165         # any APN(s)
 *   npm run smoke:permits -- --fallback         # blank the APN, exercise the street search
 *   npm run smoke:permits -- --download         # also download the PDFs
 *   SMOKE_OUT_DIR=/path npm run smoke:permits -- --download
 *
 * Expected (verified 2026-09-11):
 *   219-11-121 → env 000972 PERMIT (2015-09-11 scan, 8911 E CAVE CREEK RD, CAREFREE)
 *   200-08-079 → env OW-17-00474 PERMIT (2018-02-08) + OWR-22-04475 NOTICE OF TRANSFER (2022-09-21)
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatApn } from "../src/lib/prefill/apn";
import { isExtractableDocType, rankForExtraction } from "../src/lib/prefill/permits/doc-types";
import {
  EDMS_ARCHIVES,
  fetchDocumentBytes,
  getDocumentInfo,
} from "../src/lib/prefill/permits/edms-client";
import { searchPermits } from "../src/lib/prefill/permits/search";
import type { SearchHit } from "../src/lib/prefill/permits/candidates";
import {
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENTS_PER_RUN,
  type PrefillInput,
} from "../src/lib/prefill/types";

interface KnownParcel {
  input: PrefillInput;
  expectPermits: string[];
}

const KNOWN: Record<string, KnownParcel> = {
  "219-11-121": {
    input: {
      apn: "219-11-121",
      address: { streetNumber: "8911", streetName: "Cave Creek Rd", streetDir: "E", city: "Carefree" },
    },
    expectPermits: ["000972"],
  },
  "200-08-079": {
    input: {
      apn: "200-08-079",
      address: { streetNumber: "8911", streetName: "Villa Chula", streetDir: "W", city: "Peoria", zip: "85383" },
      subdivision: "Sunrise 4",
      lot: "2",
    },
    expectPermits: ["OW-17-00474", "OWR-22-04475"],
  },
};

const args = process.argv.slice(2);
const download = args.includes("--download");
const fallback = args.includes("--fallback");
const apns = args.filter((a) => !a.startsWith("--"));
const targets = apns.length > 0 ? apns : Object.keys(KNOWN);
const outDir = process.env.SMOKE_OUT_DIR ?? join(tmpdir(), "prefill-permits-smoke");

function archiveFor(hit: SearchHit) {
  return hit.candidate.archive === "edms_env" ? EDMS_ARCHIVES.env : EDMS_ARCHIVES.eplpav;
}

function safeName(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, "_");
}

async function downloadHits(apn: string, hits: SearchHit[], signal: AbortSignal): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  for (const hit of hits) {
    const { permitNumber, docType } = hit.candidate;
    const archive = archiveFor(hit);
    const info = await getDocumentInfo(archive, hit.documentId, signal);
    const mb = (info.size / (1024 * 1024)).toFixed(1);
    if (info.size > MAX_DOCUMENT_BYTES) {
      console.log(`    ${permitNumber} ${docType}: ${mb} MB — over the 25 MB cap, skipped`);
      continue;
    }
    const started = Date.now();
    const doc = await fetchDocumentBytes(archive, hit.documentId, signal);
    const file = join(outDir, safeName(`${apn}-${permitNumber}-${docType}.pdf`));
    writeFileSync(file, doc.bytes);
    console.log(
      `    ${permitNumber} ${docType}: ${doc.bytes.byteLength} bytes in ${Date.now() - started} ms` +
        ` (server said ${info.size}; filename "${doc.filename ?? "?"}") → ${file}`,
    );
  }
}

async function main(): Promise<number> {
  let failures = 0;
  const controller = new AbortController();
  const budget = setTimeout(() => controller.abort(), 240_000);

  for (const raw of targets) {
    const apn = formatApn(raw);
    const known = apn ? KNOWN[apn] : undefined;
    const input: PrefillInput = known?.input ?? { apn: apn ?? raw };
    const effective: PrefillInput = fallback ? { ...input, apn: undefined } : input;

    console.log(`\n=== ${raw}${fallback ? " (street fallback — APN blanked)" : ""} ===`);
    if (fallback && !effective.address) {
      console.log("  no address known for this APN — nothing to search");
      continue;
    }
    const started = Date.now();
    const outcome = await searchPermits(effective, controller.signal);
    console.log(`  outcome: ${outcome.kind}${"via" in outcome ? ` via ${outcome.via}` : ""} in ${Date.now() - started} ms`);
    console.log(`  searched: ${outcome.searched.join(" | ") || "(nothing)"}`);
    if (outcome.kind === "error") {
      console.log(`  error: ${outcome.message}`);
      failures++;
      continue;
    }
    if (outcome.kind === "not_found") {
      if (known) failures++;
      continue;
    }

    const hits = outcome.hits;
    console.log(`  ${outcome.kind === "ambiguous" ? "candidates" : "documents"} (${hits.length}):`);
    for (const h of hits) {
      const c = h.candidate;
      console.log(
        `    [${c.archive}] ${c.permitNumber.padEnd(13)} ${c.docType.padEnd(20)} ${c.docDate ?? "          "}` +
          `  ${(c.streetAddress ?? "").padEnd(26)} ${(c.city ?? "").padEnd(14)} ${c.zip ?? "     "}` +
          `  apn=${c.apn ?? "-"} score=${c.score} key=${c.key}`,
      );
    }

    if (outcome.kind === "found") {
      const ranked = rankForExtraction(hits.map((h) => ({ h, docType: h.candidate.docType, docDate: h.candidate.docDate })));
      let pending = 0;
      console.log("  extraction ranking:");
      for (const { h } of ranked) {
        const { permitNumber, docType } = h.candidate;
        let status = "skipped (not extractable)";
        if (isExtractableDocType(docType)) {
          status = pending < MAX_DOCUMENTS_PER_RUN ? "pending" : "skipped (over limit)";
          if (status === "pending") pending++;
        }
        console.log(`    ${permitNumber} ${docType} → ${status}`);
      }
      if (known) {
        const got = new Set(hits.map((h) => h.candidate.permitNumber));
        for (const expected of known.expectPermits) {
          if (!got.has(expected)) {
            console.log(`  MISSING expected permit ${expected}`);
            failures++;
          }
        }
      }
      if (download) {
        console.log(`  downloading to ${outDir}:`);
        await downloadHits(apn ?? raw, hits, controller.signal);
      }
    }
  }

  clearTimeout(budget);
  console.log(`\n${failures === 0 ? "OK" : `${failures} problem(s)`}`);
  return failures === 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
```

- [ ] **Step 3: Run it against the live API (read-only)**

Run: `npm run smoke:permits`
Expected output (times vary; IDs are not printed):

```
=== 219-11-121 ===
  outcome: found via apn in ~600 ms
  searched: APN 219-11-121
  documents (1):
    [edms_env] 000972        PERMIT               2015-09-11  8911 E CAVE CREEK RD       CAREFREE              apn=219-11-121 score=10 key=edms_env:000972:PERMIT:2015-09-11
  extraction ranking:
    000972 PERMIT → pending

=== 200-08-079 ===
  outcome: found via apn in ~700 ms
  searched: APN 200-08-079
  documents (2):
    [edms_env] OW-17-00474   PERMIT               2018-02-08  8911 W VILLA CHULA         PEORIA         85383  apn=200-08-079 score=10 key=edms_env:OW-17-00474:PERMIT:2018-02-08
    [edms_env] OWR-22-04475  NOTICE OF TRANSFER   2022-09-21  8911 W VILLA CHULA         PEORIA         85383  apn=200-08-079 score=10 key=edms_env:OWR-22-04475:NOTICE OF TRANSFER:2022-09-21
  extraction ranking:
    OW-17-00474 PERMIT → pending
    OWR-22-04475 NOTICE OF TRANSFER → pending

OK
```

- [ ] **Step 4: Exercise the street fallback and the ePLPAV archive**

Run: `npm run smoke:permits -- --fallback`
Expected: both parcels report `outcome: found via street`, `searched: 8911 CAVE CREEK` / `8911 VILLA CHULA`, and the same permits (the row APN equals the blanked-out one, so the score is direction + city [+ ZIP/subdivision/lot] without the APN bonus — 5 for Cave Creek, 12 for Villa Chula), `OK`.

Run: `npm run smoke:permits -- 219-12-165`
Expected: `found via apn`, one `[edms_eplpav] OW-24-00070 FINAL DA 2025-11-21 11425 COTTONTAIL Cave Creek 85331`, ranking `pending`.

- [ ] **Step 5: Download check (writes PDFs to a local directory only)**

Run: `SMOKE_OUT_DIR=/private/tmp/claude-501/-Users-danielendres/848c657c-f691-45f7-bd73-e7c3d9514d56/scratchpad/smoke-permits npm run smoke:permits -- --download`
Expected: three files — `219-11-121-000972-PERMIT.pdf` (712,751 bytes, filename `EnvSeptic - 9/11/2015 - 000972 - PERMIT.pdf`), `200-08-079-OW-17-00474-PERMIT.pdf` (1,968,056 bytes), `200-08-079-OWR-22-04475-NOTICE_OF_TRANSFER.pdf` (147,386 bytes); `file <name>.pdf` reports `PDF document`. Then `npm run smoke:permits -- 219-12-165 --download` fetches the 17.8 MB FINAL DA (well under the 25 MB cap) in a few seconds.

- [ ] **Step 6: Commit**

```bash
git add scripts/prefill-permits-smoke.mts package.json package-lock.json
git commit -m "chore(prefill): live EDMS permit-search smoke script (+ tsx dev dependency)"
```

---

### Task 13: Type gate, full test run, PR

**Files:** none new.

- [ ] **Step 1: Production build (the real type gate)**

Run (placeholders are fine for the build):

```bash
NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL:-https://placeholder.supabase.co} \
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:-placeholder} \
NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL:-http://localhost:3000} \
npm run build
```

Expected: `✓ Compiled successfully`, the route list includes `ƒ /api/inspections/[id]/records/[recordId]` (new) next to phase 1's `ƒ /api/inspections/[id]/prefill/[runId]/select`. Fix any type error in files this plan touched (never with `// @ts-ignore`); ignore `npx tsc --noEmit` noise from pre-existing files.

- [ ] **Step 2: Full Vitest run against the acceptance bar**

Run: `npx vitest run 2>&1 | tail -40`
Expected: every new test file passes —

```
src/lib/prefill/__tests__/apn.test.ts
src/lib/prefill/permits/__tests__/edms-client.test.ts
src/lib/prefill/permits/__tests__/normalize.test.ts
src/lib/prefill/permits/__tests__/doc-types.test.ts
src/lib/prefill/permits/__tests__/candidates.test.ts
src/lib/prefill/permits/__tests__/search.test.ts
src/lib/storage/__tests__/record-storage.test.ts
src/lib/prefill/permits/__tests__/fetch-document.test.ts
src/lib/prefill/permits/__tests__/index.test.ts
src/app/api/inspections/[id]/records/[recordId]/__tests__/route.test.ts
src/lib/prefill/__tests__/run-prefill.permits.test.ts
src/lib/prefill/__tests__/run-dto.records.test.ts
src/components/prefill/__tests__/permit-records-list.test.tsx
src/components/prefill/__tests__/prefill-sources-tile.permits.test.tsx
```

— and the only failing files are the ~15 pre-existing ones (`nav`/`roles`/`rbac`, `review-actions`, `reopen`/`download` routes, `validators/inspection.test` STEP_FIELDS + tank schema). Any failure in a file touched by phases 1–2 is a regression: fix it before moving on.

- [ ] **Step 3: Security pass (spec §11) — confirm by reading, then tick**

- Outbound hosts: only `edms.maricopa.gov` appears in `src/lib/prefill/permits/edms-client.ts`; no other module builds an EDMS URL.
- `encodeURIComponent` is the only way a document ID reaches a URL (`documentUrl`); `grep -rn "documentId" src/lib/prefill/permits/fetch-document.ts` shows it is never placed in the row.
- APN goes through `formatApn` and street parts through `normalizeStreetName` / the house-number regex / `isSafeKeywordValue` before any keyword value.
- `records/[recordId]` re-checks `checkInspectionAccess` and scopes the record to the inspection; `select` re-checks owner-of-draft / privileged.
- Nothing from EDMS is rendered as HTML (`decodeHtmlEntities` produces plain text rendered through React).

- [ ] **Step 4: Open the PR (do not merge, do not push `main`)**

```bash
git push -u origin feature/property-records-prefill
gh pr create --base main --head feature/property-records-prefill \
  --title "Prefill phase 2: Maricopa EDMS permit search & storage" \
  --body "$(cat <<'EOF'
## Summary
- OnBase EDMS JSON client for both Maricopa archives (recorded fixtures, 15 s timeout, single retry)
- APN search on both archives → dedupe → scored street fallback → auto-select / candidate picker / not found
- Permit PDFs downloaded (≤ 25 MB) to private storage `records/{inspectionId}/{recordId}.pdf` + `inspection_records` rows (`extraction_status = pending`, no AI yet)
- `/select` continues a run by candidate key; `GET …/records/[recordId]` 302s to a 600 s signed URL
- Tile: per-record rows with plain new-tab links, candidate picker, copy-APN, abandonment banner, not-found copy

## Test plan
- [ ] `npm run build` green
- [ ] `npx vitest run` — no new failures vs. the ~15 pre-existing
- [ ] `npm run smoke:permits` (+ `--fallback`, `219-12-165`, `--download`) output matches Task 12
- [ ] Manual: wizard → Find records on an inspection with APN 200-08-079 → two rows appear, Open PDF opens the signed URL in a new tab, Copy APN toasts

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Production deploy (`main`) only after Daniel's explicit approval.

---

## Self-review

**1. Spec coverage (phase 2 scope: §13 item 2, §5.2, §2.6–2.9, §8 select/records routes, §10–11 permit rows, §12 unit/EDMS/route/component tests, §14 Fluid Compute note):**

| Requirement | Task |
|---|---|
| §5.2 endpoints, keyword IDs, `QueryLimit`, parse by heading, `*` wildcard | 2 |
| §5.2 document GET/POST size check, `encodeURIComponent`, IDs never persisted | 2, 7 |
| §5.2 dashed APN (`21911121` → 0 hits) | 1, 5 |
| §5.2 step 1: APN on both archives in parallel, dedupe by normalised permit # (extended with doc type + date — see Task 5 notes) | 5 |
| §5.2 step 2: street fallback, suffix list, scoring table, `≥ 5` / gap `≥ 3`, ≤ 8 candidates, `not_found` with searched terms | 3, 5, 8 |
| §5.2 step 3: ranking, max 3 extracted, rest `skipped` | 3, 8 |
| §5.2 step 4: 25 MB cap, storage path, `page_count` via pdf-lib after upload | 6, 7 |
| §2.6 links: stored copy via signed URL, Open on Maricopa EDMS, copy-APN | 8 (links), 9 (route), 11 (UI) |
| §2.7 ambiguity: "N possible permits — pick the right one" with permit #, type, date, address, subdivision/lot | 8, 11 |
| §2.8 not found copy + `recordsAvailable = No` suggestion chip | 8 (summary + 0.6-confidence proposal), 11 (row) |
| §2.9 abandonment banner | 8 (summary), 10 (`isAbandonment` DTO feeds phase 1's tile banner), 11 (red tag on the row) |
| §8 `/select` (`{ candidateKeys }`, 409, `after()`) — phase 1's route, made real by Task 10's continuation; `records/[recordId]` 302 600 s; `maxDuration = 300` (phase 1's route) | 9, 10 |
| §8 plain `<a target="_blank" rel="noopener">`, never `next/link` | 9 (comment), 11 |
| §10 EDMS unreachable → stage error "Maricopa EDMS unavailable — try Find records later"; download fails → `failed` row with retry note; 15 s / 60 s timeouts; one retry on network errors; 240 s budget via `ctx.signal` | 2, 5, 7, 8, 10 |
| §11 fixed hosts, ID encoding, input validation, private bucket + auth-gated route, RBAC 401/403 tests | 2, 5, 9, 10, 13 |
| §12 unit (scoring auto-select/ambiguous/not-found/APN mismatch; street normaliser), EDMS fixtures (219-11-121 → 1, 200-08-079 → 2, street 8911 → 8), routes (auth matrix, 409, 302), components (rows, picker, not-found, banner), smoke script | 2–5, 9–12 |
| §14 `maxDuration = 300` needs Fluid Compute | 10 (route) — **confirm Fluid Compute is on in the Vercel project settings before the phase-2 deploy** |
| Spec §4 `selected = false` for unchosen candidates | Not implemented: unchosen candidates are never downloaded, so no row exists for them (all inserted rows are `selected = true`). Noted as an intentional simplification. |

**2. Placeholder scan:** no "TBD/TODO/implement later", no "add error handling"; every code step is complete. The phase-1 touch points (Tasks 8, 10, 11) were re-aligned against the phase-1 plan as written (`stage.ts`, `run-store.ts`, `run-dto.ts`, `input.ts`, the tile's real props, the already-real `/select` route) and show the complete resulting code.

**3. Type consistency (checked):** `SearchHit { candidate, documentId }` (Task 4) is what `search.ts` returns, `storeDocument` consumes and `index.ts` ranks; `runPermitsSelection(input, ctx, candidateKeys)` is the order used in Task 8's tests and Task 10's `continuePrefillAfterSelection` (phase 3's plan mentions `(input, candidateKeys, ctx)` but defers to phase 2's order); `toInspectionRecordDTO(row)` sets `downloadUrl: ""` for `storagePath === ""`, which Task 9 turns into a 404 and Task 11 hides; `StageContext`/`StageResult` are imported from `@/lib/prefill/stage` everywhere (amendment A2); `EDMS_LINKS` labels in Task 8 are what Task 11's tile test looks for; `notFoundSummary` text is identical in Tasks 8 and 11; `MAX_DOCUMENTS_PER_RUN` / `MAX_DOCUMENT_BYTES` come from `types.ts` everywhere; `PermitCandidate.key` is built only by `candidateKey()` (Task 3) and matched verbatim in Task 8/10.
