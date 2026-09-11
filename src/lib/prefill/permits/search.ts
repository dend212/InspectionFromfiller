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
