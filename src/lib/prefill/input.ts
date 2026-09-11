import { z } from "zod";
import type { PrefillAddress, PrefillInput } from "./types";

export const APN_MAX_LENGTH = 20;

/** Digits, letters, dashes, spaces; must contain a digit; max 20 chars — the same rule /api/apn-lookup has always used */
export function isValidApn(apn: string): boolean {
  return (
    apn.length > 0 &&
    apn.length <= APN_MAX_LENGTH &&
    /^[\dA-Za-z -]+$/.test(apn) &&
    /\d/.test(apn)
  );
}

const STREET_SUFFIXES = new Set([
  "RD", "ROAD", "DR", "DRIVE", "ST", "STREET", "AVE", "AVENUE", "LN", "LANE", "BLVD",
  "BOULEVARD", "WAY", "CT", "COURT", "PL", "PLACE", "CIR", "CIRCLE", "TRL", "TRAIL",
  "PKWY", "PARKWAY", "HWY", "HIGHWAY", "TER", "TERRACE", "LOOP",
]);

const DIRECTION_ABBR: Record<string, string> = {
  N: "N", S: "S", E: "E", W: "W", NE: "NE", NW: "NW", SE: "SE", SW: "SW",
  NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W",
};

const UNIT_MARKER = /^(#|UNIT|APT|STE|SUITE)$/i;

/**
 * Uppercase, keep only A–Z/0–9/space, drop a leading direction and a trailing
 * suffix: "E. Cave Creek Rd" → "CAVE CREEK". The ArcGIS layer stores the name
 * without direction or suffix, and this is the only form that may be placed in
 * a `where` clause (quotes cannot survive).
 */
export function normalizeStreetName(name: string): string {
  const words = name
    .toUpperCase()
    .replace(/['"]/g, "")
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length > 1 && DIRECTION_ABBR[words[0]]) words.shift();
  if (words.length > 1 && STREET_SUFFIXES.has(words[words.length - 1])) words.pop();
  return words.join(" ");
}

/**
 * "8911 E Cave Creek Rd #4" → { streetNumber: "8911", streetDir: "E", streetName: "Cave Creek Rd" }.
 * Null when there is no leading house number. Anything after a run of 2+ spaces
 * is dropped (the assessor appends "   CITY  ZIP" that way).
 */
export function parseStreetAddress(line: string): PrefillAddress | null {
  const ascii = line.replace(/[^\x20-\x7E]/g, " ").slice(0, 200);
  const cleaned = ascii.split(/ {2,}/)[0].replace(/\s+/g, " ").trim();
  const match = cleaned.match(/^(\d{1,8}) (.+)$/);
  if (!match) return null;

  const words = match[2].split(" ");
  let streetDir: string | undefined;
  const first = words[0].replace(/\./g, "").toUpperCase();
  if (words.length > 1 && DIRECTION_ABBR[first]) {
    streetDir = DIRECTION_ABBR[first];
    words.shift();
  }
  const unitIndex = words.findIndex((w) => UNIT_MARKER.test(w) || w.startsWith("#"));
  const streetName = (unitIndex >= 0 ? words.slice(0, unitIndex) : words).join(" ").trim();
  if (!streetName) return null;

  return { streetNumber: match[1], streetName, ...(streetDir ? { streetDir } : {}) };
}

/** "8911 E Cave Creek Rd, Carefree, AZ 85377" */
export function formatFullAddress(a: PrefillAddress): string {
  const line1 = [a.streetNumber, a.streetDir, a.streetName].filter(Boolean).join(" ");
  const stateZip = ["AZ", a.zip].filter(Boolean).join(" ");
  return [line1, a.city, stateZip].filter(Boolean).join(", ");
}

const printableAscii = /^[\x20-\x7E]*$/;

export const prefillAddressSchema = z.object({
  streetNumber: z.string().trim().regex(/^\d{1,8}$/, "Street number must be digits"),
  streetName: z.string().trim().min(1).max(80).regex(printableAscii),
  streetDir: z.string().trim().max(2).regex(printableAscii).optional(),
  city: z.string().trim().max(60).regex(printableAscii).optional(),
  zip: z.string().trim().max(10).regex(printableAscii).optional(),
  full: z.string().trim().max(200).regex(printableAscii).optional(),
});

/** Body of POST /api/inspections/[id]/prefill — everything optional; defaults come from facilityInfo */
export const prefillStartBodySchema = z.object({
  apn: z.string().trim().max(APN_MAX_LENGTH).optional(),
  address: prefillAddressSchema.optional(),
  trigger: z.enum(["apn_lookup", "manual"]).optional(),
});

export type PrefillStartBody = z.infer<typeof prefillStartBodySchema>;

/** Body wins; otherwise APN/address are derived from the inspection's facilityInfo */
export function buildPrefillInput(formData: unknown, body: PrefillStartBody): PrefillInput {
  const facility = ((formData as { facilityInfo?: Record<string, unknown> } | null)?.facilityInfo ??
    {}) as Record<string, unknown>;
  const text = (key: string): string =>
    typeof facility[key] === "string" ? (facility[key] as string).trim() : "";

  const apn = body.apn?.trim() || text("taxParcelNumber") || undefined;

  let address = body.address;
  if (!address) {
    const parsed = parseStreetAddress(text("facilityAddress"));
    if (parsed) {
      address = {
        ...parsed,
        ...(text("facilityCity") ? { city: text("facilityCity") } : {}),
        ...(text("facilityZip") ? { zip: text("facilityZip") } : {}),
      };
    }
  }
  if (address && !address.full) {
    address = { ...address, full: formatFullAddress(address) };
  }

  return { ...(apn ? { apn } : {}), ...(address ? { address } : {}) };
}
