import { type AddressKey, addressKey } from "@/lib/prefill/address-key";
import { APN_MAX_LENGTH } from "@/lib/prefill/input";
import type { InspectionMatchRequest } from "@/types/inspection-matches";

/**
 * Input normalisation for the possible-duplicate check (duplicate-warning spec §5.2). Pure and
 * client-safe: the wizard builds the same query to decide whether (and when) to ask the server.
 */

/** Body-size bound per field only; an over-long value is ignored per field, never rejected */
export const MATCH_FIELD_BODY_MAX = 1000;
export const CITY_MAX_LENGTH = 60;

export interface MatchQuery {
  address: AddressKey | null;
  zip5: string | null;
  city: string | null;
  apnKey: string | null;
}

/** "123-45-678" / "12345678" / "123 45 678" → "12345678"; null for N/A, TBD, 0, too long/short */
export function apnMatchKey(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length > APN_MAX_LENGTH) return null;
  const key = trimmed.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (key.length < 6 || key.length > APN_MAX_LENGTH || !/\d/.test(key) || /^0+$/.test(key)) return null;
  return key;
}

/** "85331" / "85331-1234" / "853311234" → "85331"; anything else → null */
export function zip5(raw: string | null | undefined): string | null {
  const match = /^(\d{5})(-?\d{4})?$/.exec((raw ?? "").trim());
  return match ? match[1] : null;
}

/** Whitespace-collapsed, lowercase; empty or over 60 characters → null */
export function cityKey(raw: string | null | undefined): string | null {
  const city = (raw ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  return city && city.length <= CITY_MAX_LENGTH ? city : null;
}

/** Null when there is neither a house-number address nor a usable APN (then nothing is checked) */
export function buildMatchQuery(input: InspectionMatchRequest): MatchQuery | null {
  const address = addressKey(input.facilityAddress ?? "");
  const apnKey = apnMatchKey(input.taxParcelNumber);
  if (!address && !apnKey) return null;
  return { address, zip5: zip5(input.facilityZip), city: cityKey(input.facilityCity), apnKey };
}

/** Stable string for a query ("" for null): equal keys never trigger a second request */
export function matchQueryKey(query: MatchQuery | null): string {
  if (!query) return "";
  const a = query.address;
  return JSON.stringify([
    a ? [a.number, a.dir, a.street, a.suffix, a.unit] : null,
    query.zip5,
    query.city,
    query.apnKey,
  ]);
}
