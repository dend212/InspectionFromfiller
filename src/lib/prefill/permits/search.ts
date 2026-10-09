// src/lib/prefill/permits/search.ts
/**
 * Spec §5.2 search algorithm, as amended 2026-10-09 (plan amendment A12):
 *   1. APN on `env` + `eplpav` in parallel -> merge -> dedupe. A permit-class
 *      row (PERMIT, Discharge Authorization) settles the search.
 *   2. Otherwise the APN rows (any row that is not permit-class: a transfer, an
 *      abandonment, a PERMIT SUB) are kept as the parcel's record, and the street
 *      and house-number rounds run. Their rows can only add permit-class documents
 *      that corroborate the parcel (`corroboratesParcel`): a legacy permit with a
 *      blank parcel number is found this way, and nothing else about the parcel
 *      changes.
 *   3. No APN rows: street fallback -> score -> auto-select / candidates, as
 *      before. APN rows with nothing corroborated: found via apn. Neither: not_found
 *      with the searched terms, or an error when every query failed.
 *
 * Pure apart from the injected `search` dependency so it is unit-tested
 * against recorded fixtures and reused by the /select continuation.
 */

import { formatApn } from "../apn";
import type { PermitArchive, PermitCandidate, PrefillInput } from "../types";
import { rowsToHits, type SearchHit } from "./candidates";
import { classifyDocType, isPermitClass } from "./doc-types";
import {
  EDMS_ARCHIVES,
  type EdmsArchiveConfig,
  type EdmsKeyword,
  type EdmsSearchResult,
  searchKeywords,
} from "./edms-client";
import {
  apnRelation,
  isSafeKeywordValue,
  normaliseLot,
  normalisePermitNumber,
  normaliseStreetDir,
  normaliseSubdivision,
  normalizeStreetName,
  STREET_EXACT_SCORE,
  splitStreetAddress,
  streetSimilarity,
  streetSuffix,
  subdivisionIdentity,
  zip5,
} from "./normalize";

/**
 * `failedArchives` lists every archive whose query threw during the search
 * (empty when all succeeded) so the tile never renders a confident negative
 * after an outage. `error` is reserved for "every query failed".
 */
export type PermitSearchOutcome =
  | {
      kind: "found";
      /** Which round produced the hits — `number` is the house-number-only round */
      via: "apn" | "street" | "number";
      hits: SearchHit[];
      searched: string[];
      failedArchives: PermitArchive[];
    }
  | {
      kind: "ambiguous";
      via: "street" | "number";
      hits: SearchHit[];
      searched: string[];
      failedArchives: PermitArchive[];
    }
  | { kind: "not_found"; searched: string[]; failedArchives: PermitArchive[] }
  | { kind: "error"; message: string; searched: string[] };

export interface SearchDeps {
  search: (
    archive: EdmsArchiveConfig,
    keywords: EdmsKeyword[],
    signal?: AbortSignal,
  ) => Promise<EdmsSearchResult>;
}

const defaultDeps: SearchDeps = { search: searchKeywords };

/** Street + direction + one of city/ZIP. A direction and an exact street alone (7) is not enough. */
export const AUTO_SELECT_MIN_SCORE = 9;
export const AUTO_SELECT_MIN_GAP = 3;
export const MAX_CANDIDATES = 8;
export const APN_MATCH_SCORE = 10;
/** Same book-map-parcel, different split letter — the permit predates a lot split. */
export const APN_SPLIT_SCORE = 1;
/**
 * A different book or map. Enough to keep the row out of auto-select on its own
 * (a full street match is 11) while still letting it reach the picker, because
 * the parcel number on a permit is only as current as the day it was filed.
 */
export const APN_MISMATCH_PENALTY = -8;
export const EDMS_UNAVAILABLE_MESSAGE = "Maricopa EDMS unavailable — try Find records later";

/** Spec scoring table, with the street name and the parcel number as graded signals. */
export function scoreCandidate(candidate: PermitCandidate, input: PrefillInput): number {
  const ourApn = formatApn(input.apn);
  let score = 0;
  if (candidate.apn && ourApn) {
    switch (apnRelation(ourApn, candidate.apn)) {
      case "exact":
        score += APN_MATCH_SCORE;
        break;
      case "split":
        score += APN_SPLIT_SCORE;
        break;
      case "different":
        score += APN_MISMATCH_PENALTY;
        break;
      // "same_map" (same neighbourhood) and "unparseable" say nothing either way.
      default:
        break;
    }
  }
  const addr = input.address;
  const theirs = splitStreetAddress(candidate.streetAddress);
  score += streetSimilarity(addr?.streetName ?? "", theirs.street);
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

/** Attributes that split a property group only when populated on both sides. */
function propertyAttributes(candidate: PermitCandidate, dir: string): string[] {
  return [
    normaliseStreetDir(dir),
    (candidate.city ?? "").trim().toUpperCase(),
    zip5(candidate.zip ?? ""),
    formatApn(candidate.apn) ?? "",
  ];
}

/**
 * Rows describing the same property, regardless of doc type. Identity is the
 * house number + normalised street; a row joins a group unless direction,
 * city, ZIP5 or APN is populated on both sides and differs (blank is
 * compatible). So a legacy PERMIT with no city/ZIP/APN sits with the
 * property's later NOTICE OF TRANSFER, and an eplpav row (its address never
 * carries a direction) sits with the env rows of the same house.
 */
export function groupByProperty(candidates: PermitCandidate[]): PermitCandidate[][] {
  const groups: { identity: string; attrs: string[]; members: PermitCandidate[] }[] = [];
  for (const candidate of candidates) {
    const parts = splitStreetAddress(candidate.streetAddress);
    const identity = `${parts.number}|${normalizeStreetName(parts.street)}`;
    const attrs = propertyAttributes(candidate, parts.dir);
    const group = groups.find(
      (g) => g.identity === identity && g.attrs.every((v, i) => !v || !attrs[i] || v === attrs[i]),
    );
    if (group) {
      group.members.push(candidate);
      group.attrs = group.attrs.map((v, i) => v || attrs[i]);
    } else {
      groups.push({ identity, attrs, members: [candidate] });
    }
  }
  return groups.map((g) => g.members);
}

/**
 * House number must agree; the street name only has to be recognisable
 * (`streetSimilarity` tolerates a typo, a transposition, a dropped word and
 * ordinal spellings). The house-number-only round skips this entirely — there
 * the street is what the tech is being asked to judge.
 */
function matchesStreet(candidate: PermitCandidate, input: PrefillInput): boolean {
  const addr = input.address;
  if (!addr) return true;
  const theirs = splitStreetAddress(candidate.streetAddress);
  const ourNumber = addr.streetNumber.trim().toUpperCase();
  if (theirs.number && ourNumber && theirs.number !== ourNumber) {
    return false;
  }
  return (
    normalizeStreetName(addr.streetName) === "" ||
    streetSimilarity(addr.streetName, theirs.street) > 0
  );
}

/** Spec §5.2 step 2 decision, applied to property groups (see design notes). */
export function decideFallback(
  hits: SearchHit[],
  input: PrefillInput,
  { requireStreetMatch = true }: { requireStreetMatch?: boolean } = {},
): { kind: "found" | "ambiguous"; hits: SearchHit[] } {
  const scored = hits
    .filter((h) => !requireStreetMatch || matchesStreet(h.candidate, input))
    .map((h) => ({
      ...h,
      candidate: { ...h.candidate, score: scoreCandidate(h.candidate, input) },
    }))
    .filter((h) => Number.isFinite(h.candidate.score));

  const groups = groupByProperty(scored.map((h) => h.candidate)).map((members) => {
    const hits = scored.filter((h) => members.includes(h.candidate));
    return { score: Math.max(...hits.map((h) => h.candidate.score)), hits };
  });
  const ranked = groups.sort((a, b) => b.score - a.score);
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

/** Runs the queries in parallel; returns merged hits and the archives whose query threw. */
async function runQueries(
  queries: ArchiveQuery[],
  signal: AbortSignal,
  deps: SearchDeps,
): Promise<{ hits: SearchHit[]; failedArchives: PermitArchive[] }> {
  const settled = await Promise.allSettled(
    queries.map((q) => deps.search(q.archive, q.keywords, signal)),
  );
  const hits: SearchHit[] = [];
  const failedArchives: PermitArchive[] = [];
  settled.forEach((result, i) => {
    if (result.status === "fulfilled") {
      hits.push(...rowsToHits(queries[i].archive, result.value.rows));
    } else {
      failedArchives.push(queries[i].archive.archive);
      console.warn(`[prefill/permits] ${queries[i].archive.id} search failed:`, result.reason);
    }
  });
  return { hits: dedupeHits(hits), failedArchives };
}

/** A permit or a Discharge Authorization identifies the permit; a transfer or abandonment only records one */
const identifiesPermit = (hit: SearchHit): boolean =>
  isPermitClass(classifyDocType(hit.candidate.docType));

/** The APN rows as the search reports them: each one matched the parcel by its APN */
const asParcelHits = (hits: SearchHit[]): SearchHit[] =>
  hits.map((h) => ({ ...h, candidate: { ...h.candidate, score: APN_MATCH_SCORE } }));

/** EDMS writes "MARICOPA COUNTY" for an unincorporated address; that is no city to compare */
const cityOf = (raw?: string): string => {
  const city = (raw ?? "").trim().toUpperCase();
  return city === "MARICOPA COUNTY" ? "" : city;
};

/**
 * Can this row be tied to the parcel the APN named? A legacy permit often carries a
 * blank or retired parcel number, so the test works from the address and the
 * attributes that identify a parcel. Every populated attribute must agree: house
 * number, street name with its suffix, direction, city, ZIP, lot and subdivision. The
 * APN contradicts when it sits in another book or map, or in the same map under a
 * different parcel number. The row also needs a positive match: the APN itself (exact,
 * or a split letter), or a lot or subdivision on a street whose suffix agrees. A blank
 * lot, subdivision and APN is not enough.
 */
export function corroboratesParcel(candidate: PermitCandidate, input: PrefillInput): boolean {
  const addr = input.address;
  if (!addr || !isPermitClass(classifyDocType(candidate.docType))) return false;

  const theirs = splitStreetAddress(candidate.streetAddress);
  if (!theirs.number || theirs.number !== addr.streetNumber.trim().toUpperCase()) return false;
  if (streetSimilarity(addr.streetName, theirs.street) !== STREET_EXACT_SCORE) return false;

  const ourDir = normaliseStreetDir(addr.streetDir ?? "");
  const theirDir = normaliseStreetDir(theirs.dir);
  if (ourDir && theirDir && ourDir !== theirDir) return false;
  const ourCity = cityOf(addr.city);
  const theirCity = cityOf(candidate.city);
  if (ourCity && theirCity && ourCity !== theirCity) return false;
  const ourZip = zip5(addr.zip ?? "");
  const theirZip = zip5(candidate.zip ?? "");
  if (ourZip && theirZip && ourZip !== theirZip) return false;

  const apn = apnRelation(formatApn(input.apn), formatApn(candidate.apn));
  if (apn === "different" || apn === "same_map") return false;
  const apnMatches = apn === "exact" || apn === "split";

  // "104TH ST" and "104TH PL" can share a house number and a subdivision and still be two
  // streets. A lot or subdivision identifies the parcel only when both suffixes agree,
  // unless the APN itself matches.
  const ourSuffix = streetSuffix(addr.streetName);
  const theirSuffix = streetSuffix(theirs.street);
  const suffixesAgree = ourSuffix !== "" && ourSuffix === theirSuffix;
  const trusted = apnMatches || suffixesAgree;

  let positive = apnMatches;
  if (input.lot && candidate.lot) {
    if (normaliseLot(input.lot) !== normaliseLot(candidate.lot)) return false;
    if (trusted) positive = true;
  }
  if (input.subdivision && candidate.subdivision) {
    if (subdivisionIdentity(input.subdivision) !== subdivisionIdentity(candidate.subdivision)) {
      return false;
    }
    if (trusted) positive = true;
  }
  return positive;
}

/**
 * One street or house-number round's answer. Without APN rows it is the score-and-group
 * decision it always was. With APN rows the parcel is already named, so the round may
 * only add permit-class rows that corroborate it; when it adds none, the caller moves on
 * and the APN rows stand. The APN rows are not filtered, scored, or grouped by address
 * here: they keep the score the APN round gives them.
 */
function decideRound(
  hits: SearchHit[],
  input: PrefillInput,
  parcelRecords: SearchHit[],
  via: "street" | "number",
  searched: string[],
  failedArchives: PermitArchive[],
  opts: { requireStreetMatch?: boolean } = {},
): PermitSearchOutcome | null {
  if (parcelRecords.length > 0) {
    const permits = hits
      .filter((h) => corroboratesParcel(h.candidate, input))
      .map((h) => ({
        ...h,
        candidate: { ...h.candidate, score: scoreCandidate(h.candidate, input) },
      }));
    if (permits.length === 0) return null;
    return {
      kind: "found",
      via,
      hits: dedupeHits([...asParcelHits(parcelRecords), ...permits]),
      searched,
      failedArchives,
    };
  }
  const decision = decideFallback(hits, input, opts);
  if (decision.hits.length === 0) return null;
  return decision.kind === "found"
    ? { kind: "found", via, hits: decision.hits, searched, failedArchives }
    : { kind: "ambiguous", via, hits: decision.hits, searched, failedArchives };
}

export async function searchPermits(
  input: PrefillInput,
  signal: AbortSignal,
  deps: SearchDeps = defaultDeps,
): Promise<PermitSearchOutcome> {
  const searched: string[] = [];
  // Accumulated across rounds: a not_found is only as good as the queries that ran
  const failedArchives: PermitArchive[] = [];
  let totalFailures = 0;
  let totalQueries = 0;
  const recordRound = (round: { failedArchives: PermitArchive[] }, queryCount: number) => {
    totalQueries += queryCount;
    totalFailures += round.failedArchives.length;
    for (const archive of round.failedArchives) {
      if (!failedArchives.includes(archive)) failedArchives.push(archive);
    }
  };

  // 1. APN on both archives
  const apn = formatApn(input.apn);
  let parcelRecords: SearchHit[] = [];
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
    const round = await runQueries(queries, signal, deps);
    recordRound(round, queries.length);
    if (round.hits.some(identifiesPermit)) {
      return {
        kind: "found",
        via: "apn",
        hits: round.hits.map((h) => ({
          ...h,
          candidate: { ...h.candidate, score: APN_MATCH_SCORE },
        })),
        searched,
        failedArchives,
      };
    }
    parcelRecords = round.hits;
  }

  // 2. Street fallback — the house number must look like one (digits + optional letter).
  //    Skipped once the caller's budget has expired: the requests could only reject.
  const number = (input.address?.streetNumber ?? "").trim().toUpperCase();
  const street = normalizeStreetName(input.address?.streetName ?? "");
  if (
    !signal.aborted &&
    /^\d{1,8}[A-Z]?$/.test(number) &&
    street &&
    isSafeKeywordValue(`${street}*`)
  ) {
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
    const round = await runQueries(queries, signal, deps);
    recordRound(round, queries.length);
    if (round.hits.length > 0) {
      const outcome = decideRound(
        round.hits,
        input,
        parcelRecords,
        "street",
        searched,
        failedArchives,
      );
      if (outcome) return outcome;
    }
  }

  // 3. House number alone — the street keyword is the brittle part of round 2
  //    (EDMS stores the name the county typed decades ago, we hold whatever the
  //    tech typed today). A number is 8–40 rows countywide, so rank them here
  //    and let the picker settle it rather than reporting a false negative. With APN rows
  //    present, only corroborated permits are added (see decideRound).
  if (!signal.aborted && /^\d{1,8}[A-Z]?$/.test(number) && isSafeKeywordValue(number)) {
    searched.push(number);
    const queries: ArchiveQuery[] = [
      {
        archive: EDMS_ARCHIVES.env,
        keywords: [{ id: EDMS_ARCHIVES.env.keywords.streetNo, value: number }],
      },
      {
        archive: EDMS_ARCHIVES.eplpav,
        keywords: [{ id: EDMS_ARCHIVES.eplpav.keywords.streetNo, value: number }],
      },
    ];
    const round = await runQueries(queries, signal, deps);
    recordRound(round, queries.length);
    if (round.hits.length > 0) {
      const outcome = decideRound(
        round.hits,
        input,
        parcelRecords,
        "number",
        searched,
        failedArchives,
        { requireStreetMatch: false },
      );
      if (outcome) return outcome;
    }
  }

  // Only the parcel's own non-permit rows matched and no permit corroborated them: report
  // them with the APN round's hits and scores. failedArchives still covers the later rounds.
  if (parcelRecords.length > 0) {
    return {
      kind: "found",
      via: "apn",
      hits: asParcelHits(parcelRecords),
      searched,
      failedArchives,
    };
  }
  if (totalQueries > 0 && totalFailures === totalQueries) {
    return { kind: "error", message: EDMS_UNAVAILABLE_MESSAGE, searched };
  }
  return { kind: "not_found", searched, failedArchives };
}
