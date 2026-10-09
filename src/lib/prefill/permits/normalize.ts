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
import { normalizeStreetName } from "../input";
export { normalizeStreetName };

const DIRECTIONS: Record<string, string> = {
  N: "N",
  S: "S",
  E: "E",
  W: "W",
  NE: "NE",
  NW: "NW",
  SE: "SE",
  SW: "SW",
  NORTH: "N",
  SOUTH: "S",
  EAST: "E",
  WEST: "W",
  NORTHEAST: "NE",
  NORTHWEST: "NW",
  SOUTHEAST: "SE",
  SOUTHWEST: "SW",
};

function tokens(raw: string): string[] {
  return raw
    .toUpperCase()
    .replace(/[^0-9A-Z ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** "east" → "E"; anything that is not a direction → "" */
export function normaliseStreetDir(raw: string): string {
  const t = raw.trim().toUpperCase().replace(/\./g, "");
  return DIRECTIONS[t] ?? "";
}

const SUFFIX_SHORT: Record<string, string> = {
  RD: "RD",
  ROAD: "RD",
  DR: "DR",
  DRIVE: "DR",
  ST: "ST",
  STREET: "ST",
  AVE: "AVE",
  AVENUE: "AVE",
  LN: "LN",
  LANE: "LN",
  BLVD: "BLVD",
  BOULEVARD: "BLVD",
  WAY: "WAY",
  WY: "WAY",
  CT: "CT",
  COURT: "CT",
  PL: "PL",
  PLACE: "PL",
  CIR: "CIR",
  CIRCLE: "CIR",
  TRL: "TRL",
  TRAIL: "TRL",
  PKWY: "PKWY",
  PARKWAY: "PKWY",
  HWY: "HWY",
  HIGHWAY: "HWY",
  TER: "TER",
  TERRACE: "TER",
  LOOP: "LOOP",
};

/** The trailing street suffix in short form ("104TH PLACE" → "PL"); "" when there is none */
export function streetSuffix(street: string): string {
  const words = tokens(street);
  return words.length > 1 ? (SUFFIX_SHORT[words[words.length - 1]] ?? "") : "";
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
  return raw
    .toUpperCase()
    .replace(/\bUNIT\b/g, "")
    .replace(/[^0-9A-Z]/g, "");
}

const ROMAN_NUMERALS: Record<string, string> = {
  I: "1",
  II: "2",
  III: "3",
  IV: "4",
  V: "5",
  VI: "6",
  VII: "7",
  VIII: "8",
  IX: "9",
  X: "10",
};

/**
 * Subdivision identity, for telling two rows apart: normaliseSubdivision with
 * whole-word roman numerals read as digits, so "SAGUARO WEST II" and "SAGUARO WEST 2"
 * name the same subdivision. Scoring keeps using normaliseSubdivision.
 */
export function subdivisionIdentity(raw: string): string {
  const digits = raw
    .toUpperCase()
    .replace(/\b(?:X|IX|VIII|VII|VI|V|IV|III|II|I)\b/g, (token) => ROMAN_NUMERALS[token] ?? token);
  return normaliseSubdivision(digits);
}

/** "002" → "2", "19A" → "19A" */
export function normaliseLot(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/^0+(?=\d)/, "");
}

/** "85087-8650" → "85087" */
export function zip5(raw: string): string {
  const match = /\d{5}/.exec(raw);
  return match ? match[0] : "";
}

/**
 * How two Maricopa parcel numbers relate. Book-map-parcel[split]: a lot that is
 * split or re-drawn keeps its book-map-parcel digits and takes a new trailing
 * letter, so a decades-old permit routinely names a parcel that no longer
 * exists (509 W Lavitt Ln is `211-23-049L` today; its 2001 permit says
 * `211-23-049J`, and the assessor's live layer has no J at all).
 *
 * - `exact`     same parcel
 * - `split`     same book-map-parcel, different split letter — very likely the same dirt
 * - `same_map`  same book and map — same neighbourhood, no more than that
 * - `different` different book or map
 * - `unknown`   one side is missing or unparseable
 */
export type ApnRelation = "exact" | "split" | "same_map" | "different" | "unknown";

export function apnRelation(ours?: string | null, theirs?: string | null): ApnRelation {
  const a = apnParts(ours);
  const b = apnParts(theirs);
  if (!a || !b) return "unknown";
  if (a.full === b.full) return "exact";
  if (a.book === b.book && a.map === b.map && a.parcel === b.parcel) return "split";
  if (a.book === b.book && a.map === b.map) return "same_map";
  return "different";
}

function apnParts(
  raw?: string | null,
): { book: string; map: string; parcel: string; full: string } | null {
  if (!raw) return null;
  const compact = raw.toUpperCase().replace(/[^0-9A-Z]/g, "");
  const match = /^(\d{3})(\d{2})(\d{3})([A-Z]?)$/.exec(compact);
  if (!match) return null;
  return { book: match[1], map: match[2], parcel: match[3], full: compact };
}

/** Optimal string alignment distance (Levenshtein + adjacent transposition), capped at `max`. */
export function editDistance(a: string, b: string, max = 4): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d = Math.min(d, prev2[j - 2] + 1);
      }
      row.push(d);
      if (d < best) best = d;
    }
    if (best > max) return max + 1;
    prev2 = prev;
    prev = row;
  }
  return prev[b.length];
}

/** "375TH" ≡ "375" ≡ "375 TH" — ordinal suffixes carry no information here. */
function streetTokens(name: string): string[] {
  return normalizeStreetName(name)
    .split(" ")
    .map((w) => w.replace(/^(\d+)(ST|ND|RD|TH)$/, "$1"))
    .filter((w) => w !== "ST" && w !== "ND" && w !== "RD" && w !== "TH")
    .filter(Boolean);
}

export const STREET_EXACT_SCORE = 4;
export const STREET_PREFIX_SCORE = 3;
export const STREET_NEAR_SCORE = 2;
export const STREET_TOKEN_SCORE = 1;

/**
 * 0–4 on how much two street names agree, after direction and suffix are
 * stripped. Tolerates the ways an address reaches us wrong: a typo, a
 * transposition, a dropped or added word, "375TH" vs "375". 0 means unrelated.
 */
export function streetSimilarity(ours: string, theirs: string): number {
  const a = streetTokens(ours);
  const b = streetTokens(theirs);
  if (a.length === 0 || b.length === 0) return 0;
  const joinedA = a.join("");
  const joinedB = b.join("");
  if (joinedA === joinedB) return STREET_EXACT_SCORE;
  if (joinedA.startsWith(joinedB) || joinedB.startsWith(joinedA)) {
    return Math.min(joinedA.length, joinedB.length) >= 3 ? STREET_PREFIX_SCORE : 0;
  }
  // One typo per ~6 characters, never more than 2 — "LAVVIT"≈"LAVITT", not "MAIN"≈"MAIP".
  const budget = Math.min(2, Math.floor(Math.min(joinedA.length, joinedB.length) / 6) + 1);
  if (editDistance(joinedA, joinedB, budget) <= budget) return STREET_NEAR_SCORE;
  const shared = a.filter((w) => b.includes(w)).length;
  if (shared > 0 && shared * 2 >= Math.min(a.length, b.length)) return STREET_TOKEN_SCORE;
  return 0;
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
