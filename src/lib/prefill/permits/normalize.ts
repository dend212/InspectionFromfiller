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
