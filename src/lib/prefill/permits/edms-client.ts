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
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "EdmsError";
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isAbortOrTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
}

/**
 * Reads a response body via `read`, mapping an abort/timeout of the caller's
 * signal or the per-attempt `AbortSignal.timeout` (still attached to the body
 * stream after `fetchWithRetry` resolves the headers) to a network EdmsError
 * instead of a raw DOMException, and any other read failure to a parse error.
 */
async function readBody<T>(
  res: Response,
  read: (r: Response) => Promise<T>,
  what: string,
): Promise<T> {
  try {
    return await read(res);
  } catch (err) {
    if (isAbortOrTimeout(err)) {
      throw new EdmsError(`${what} timed out`, "network", undefined, { cause: err });
    }
    throw new EdmsError(`${what} could not be read: ${errorMessage(err)}`, "parse", undefined, {
      cause: err,
    });
  }
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
  const budgetExhaustedMessage = "Prefill run budget exhausted before EDMS request";
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal?.aborted) {
      throw new EdmsError(budgetExhaustedMessage, "network");
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
  if (signal?.aborted) {
    throw new EdmsError(budgetExhaustedMessage, "network", undefined, { cause: lastError });
  }
  throw new EdmsError(
    `Maricopa EDMS unreachable: ${errorMessage(lastError)}`,
    "network",
    undefined,
    { cause: lastError },
  );
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
  const json = await readBody<unknown>(res, (r) => r.json(), "EDMS search response");
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
  const json = await readBody<unknown>(res, (r) => r.json(), "EDMS document info response");
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
  // RFC 5987 extended value (`filename*=UTF-8''…`) is percent-encoded — decode it.
  const extended = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (extended) {
    const raw = extended[1].trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  // Plain `filename="…"` is a literal value — never decode it (a stray `%`
  // like in "100%.pdf" isn't percent-encoding and would throw a URIError).
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain ? plain[1].trim() : null;
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
  const buffer = await readBody(res, (r) => r.arrayBuffer(), "EDMS document body");
  const bytes = new Uint8Array(buffer);
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
