import type { PrefillAddress } from "../types";
import type { ListingFacts, ListingProvider, ListingWaterSource } from "./provider";

/**
 * Zillow via the Apify actor `api-ninja/zillow-property-details-scraper` (A10).
 *
 * One dataset item per address. Water source and sewer live in the MLS-sourced
 * `resoFacts` block as single-element arrays of ARMLS strings
 * (`resoFacts.waterSource: ["City Water"]`, `resoFacts.sewer: ["Septic Tank"]`)
 * and are only present for active/recent listings — an off-market parcel
 * returns `null` for both. Everything below stays defensive: facts are located
 * by a case-insensitive key search over the parcel's OWN data only — the
 * `resoFacts` subtree (deep) and the item's top-level keys — and any unmapped
 * shape yields `null` facts, never an error. The item also embeds other
 * parcels (`nearbyHomes`, `collections.modules[].propertyDetails`, comps,
 * schools …); those are never read (see `findListingFact`). Run
 * `scripts/listing-shape-check.mts` to see the real keys for one address.
 */

/** Candidate key names, matched after lower-casing and stripping non-alphanumerics. */
export const WATER_KEYS = ["waterSource", "water_source", "water", "waterUtility"];
export const SEWER_KEYS = ["sewer", "sewerType", "sewer_type", "sewerSystem"];
const BEDROOM_KEYS = ["bedrooms", "beds", "bedroomCount"];
const BATHROOM_KEYS = ["bathrooms", "baths", "bathroomCount"];
const YEAR_BUILT_KEYS = ["yearBuilt", "year_built"];
const LOT_AREA_VALUE_KEYS = ["lotAreaValue"];
const LOT_UNIT_KEYS = ["lotAreaUnits", "lotSizeUnits"];
/** Fallback text forms such as `resoFacts.lotSize: "1.08 Acres"`. */
const LOT_TEXT_KEYS = ["lotSize", "lot_size", "lotArea"];
const URL_KEYS = ["hdpUrl", "url", "detailUrl", "zillowUrl", "propertyUrl", "link"];
const ZPID_KEYS = ["zpid"];
const NOT_FOUND_KEYS = ["error", "notFound", "errorMessage"];

const ZILLOW_ORIGIN = "https://www.zillow.com";
const ZILLOW_HOMEDETAILS_RE = /^https?:\/\/(www\.)?zillow\.com\/homedetails\//i;
const ZILLOW_HOMEDETAILS_PATH_RE = /^\/homedetails\//i;
const MAX_SEARCH_DEPTH = 5;
const SQFT_PER_ACRE = 43_560;

function normKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isPresent(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/**
 * Turns a raw fact value into lower-cased text: strings as-is, string arrays
 * joined with ", ", `{ value | factValue | name }` objects by that property,
 * numbers stringified. Anything else → undefined.
 */
export function flattenText(raw: unknown): string | undefined {
  if (typeof raw === "string") return raw.trim() ? raw.trim().toLowerCase() : undefined;
  if (typeof raw === "number") return String(raw);
  if (Array.isArray(raw)) {
    const parts = raw.map(flattenText).filter((s): s is string => Boolean(s));
    return parts.length ? parts.join(", ") : undefined;
  }
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    return flattenText(obj.value ?? obj.factValue ?? obj.name);
  }
  return undefined;
}

/** `["City Water"]` → `"City Water"`; anything that is not a one-element array is returned as-is. */
export function unwrapSingle(raw: unknown): unknown {
  return Array.isArray(raw) && raw.length === 1 ? raw[0] : raw;
}

/**
 * Spec §5.3 + A10 water-source normalisation over the ARMLS vocabulary Zillow
 * serves in `resoFacts.waterSource` ("City Water", "Pvt Water Company",
 * "Well - Shared", "Well - Pvtly Owned", "Hauled"). Case-insensitive; specific
 * phrases are tested before generic ones. "None"/unknown → undefined (no fact).
 */
export function normaliseWaterSource(raw: unknown): ListingWaterSource | undefined {
  const text = flattenText(unwrapSingle(raw));
  if (!text) return undefined;
  if (/hauled/.test(text)) return "hauled_water";
  if (/shared\s*well|well\s*-\s*shared/.test(text)) return "shared_well";
  if (/city|municipal|public/.test(text)) return "municipal";
  if (/(private|pvt)\s*(water\s*)?(company|co\b)|water\s*co(mpany)?\b/.test(text)) return "private_company";
  if (/\bwell\b|pvtly\s*owned/.test(text)) return "private_well";
  return undefined;
}

/**
 * A10 sewer normalisation: any "septic" ("Septic Tank", "Septic in & Cnctd")
 * → septic; any "sewer" ("Sewer - Public", "Sewer - Private", "Public Sewer")
 * → sewer; "None"/other text → unknown (not evidence either way); no text →
 * undefined.
 */
export function normaliseSewer(raw: unknown): "septic" | "sewer" | "unknown" | undefined {
  const text = flattenText(unwrapSingle(raw));
  if (!text) return undefined;
  if (/septic|cesspool|on-?site/.test(text)) return "septic";
  if (/sewer|public|city|municipal/.test(text)) return "sewer";
  return "unknown";
}

/**
 * Breadth-first search for the first non-empty value whose key (or
 * `factLabel`/`label`/`name` in a label/value pair) matches one of `candidates`.
 * Shallower matches win. Depth-limited so a huge dossier stays cheap.
 */
export function findFact(raw: unknown, candidates: string[]): unknown {
  const wanted = new Set(candidates.map(normKey));
  const queue: Array<{ node: unknown; depth: number }> = [{ node: raw, depth: 0 }];
  while (queue.length) {
    const { node, depth } = queue.shift() as { node: unknown; depth: number };
    if (!node || typeof node !== "object" || depth > MAX_SEARCH_DEPTH) continue;
    if (Array.isArray(node)) {
      for (const item of node) queue.push({ node: item, depth: depth + 1 });
      continue;
    }
    const obj = node as Record<string, unknown>;
    const label = obj.factLabel ?? obj.label ?? obj.name;
    if (typeof label === "string" && wanted.has(normKey(label))) {
      const v = obj.factValue ?? obj.value;
      if (isPresent(v)) return v;
    }
    for (const [key, v] of Object.entries(obj)) {
      if (wanted.has(normKey(key)) && isPresent(v)) return v;
    }
    for (const v of Object.values(obj)) {
      if (v && typeof v === "object") queue.push({ node: v, depth: depth + 1 });
    }
  }
  return undefined;
}

function toNumber(raw: unknown): number | undefined {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw === "string") {
    const n = Number.parseFloat(raw.replace(/[^\d.]/g, ""));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function toInteger(raw: unknown): number | undefined {
  const n = toNumber(raw);
  return n === undefined ? undefined : Math.round(n);
}

function toLotSqft(value: unknown, units: unknown): number | undefined {
  const n = toNumber(value);
  if (n === undefined || n <= 0) return undefined;
  const unitText = flattenText(units) ?? (typeof value === "string" ? value.toLowerCase() : "");
  if (/acre/.test(unitText)) return Math.round(n * SQFT_PER_ACRE);
  return Math.round(n);
}

/**
 * Lot size in square feet (A10): the actor's top-level numeric `lotSize` is
 * already sqft; otherwise `lotAreaValue` + `lotAreaUnits` (Acres × 43 560);
 * otherwise a text form such as "1.08 Acres".
 */
function findLotSqft(item: Record<string, unknown>): number | undefined {
  const direct = item.lotSize;
  if (typeof direct === "number" && Number.isFinite(direct) && direct > 0) return Math.round(direct);
  const units = findListingFact(item, LOT_UNIT_KEYS);
  const areaValue = findListingFact(item, LOT_AREA_VALUE_KEYS);
  if (areaValue !== undefined) {
    const sqft = toLotSqft(areaValue, units);
    if (sqft !== undefined) return sqft;
  }
  return toLotSqft(findListingFact(item, LOT_TEXT_KEYS), undefined);
}

/**
 * Reads a fact from the parcel's OWN data only: the MLS-sourced `resoFacts`
 * subtree first (searched deep — that is where water/sewer live and where the
 * `atAGlanceFacts` label/value pairs sit), then the item's own top-level keys.
 * It never descends into any other subtree: `nearbyHomes`, `collections`,
 * `comps`, `schools` … describe OTHER properties, and a whole-item search
 * would hand an off-market parcel (own value `null`, A10) a neighbour's
 * bedrooms/bathrooms/lot at fill confidence. Single-element arrays are
 * unwrapped.
 */
export function findListingFact(item: Record<string, unknown>, candidates: string[]): unknown {
  const reso = item.resoFacts;
  const fromReso = reso && typeof reso === "object" ? findFact(reso, candidates) : undefined;
  if (fromReso !== undefined) return unwrapSingle(fromReso);
  const wanted = new Set(candidates.map(normKey));
  for (const [key, v] of Object.entries(item)) {
    if (wanted.has(normKey(key)) && isPresent(v)) return unwrapSingle(v);
  }
  return undefined;
}

/** Absolute Zillow home-details URL from an absolute URL or an `hdpUrl` path. */
function toZillowUrl(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  if (ZILLOW_HOMEDETAILS_RE.test(trimmed)) return trimmed;
  if (ZILLOW_HOMEDETAILS_PATH_RE.test(trimmed)) return `${ZILLOW_ORIGIN}${trimmed}`;
  return undefined;
}

/** Same own-data scope as `findListingFact`: a neighbour's `hdpUrl`/`zpid` is never borrowed. */
function findListingUrl(item: Record<string, unknown>): string | undefined {
  for (const key of URL_KEYS) {
    const url = toZillowUrl(findListingFact(item, [key]));
    if (url) return url;
  }
  const zpid = findListingFact(item, ZPID_KEYS);
  if (typeof zpid === "number" || (typeof zpid === "string" && /^\d+$/.test(zpid))) {
    return `${ZILLOW_ORIGIN}/homedetails/${zpid}_zpid/`;
  }
  return undefined;
}

/**
 * Maps one dataset item to `ListingFacts`. Returns null when the item is not an
 * object, looks like a not-found/error row, or carries neither a Zillow URL
 * nor any fact we care about.
 */
export function normaliseListingItem(raw: unknown): ListingFacts | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;

  const url = findListingUrl(item);
  const waterSource = normaliseWaterSource(findListingFact(item, WATER_KEYS));
  const sewer = normaliseSewer(findListingFact(item, SEWER_KEYS));
  const bedrooms = toInteger(findListingFact(item, BEDROOM_KEYS));
  const bathrooms = toNumber(findListingFact(item, BATHROOM_KEYS));
  const yearBuilt = toInteger(findListingFact(item, YEAR_BUILT_KEYS));
  const lotSqft = findLotSqft(item);

  const hasFacts =
    waterSource !== undefined ||
    sewer !== undefined ||
    bedrooms !== undefined ||
    yearBuilt !== undefined;

  // An error/not-found row without a resolvable URL is "no listing".
  const looksLikeError = NOT_FOUND_KEYS.some((k) => isPresent(item[k]));
  if (!url && (looksLikeError || !hasFacts)) return null;
  if (looksLikeError && !hasFacts) return null;

  const facts: ListingFacts = { provider: "zillow", url: url ?? "", raw: item };
  if (waterSource !== undefined) facts.waterSource = waterSource;
  if (sewer !== undefined) facts.sewer = sewer;
  if (bedrooms !== undefined) facts.bedrooms = bedrooms;
  if (bathrooms !== undefined) facts.bathrooms = bathrooms;
  if (yearBuilt !== undefined) facts.yearBuilt = yearBuilt;
  if (lotSqft !== undefined) facts.lotSqft = lotSqft;
  return facts;
}

// ---------------------------------------------------------------------------
// Apify client
// ---------------------------------------------------------------------------

/** A10: `api-ninja/zillow-property-details-scraper` (~$0.015 per lookup, pay-per-event). */
export const APIFY_ACTOR_ID = "api-ninja~zillow-property-details-scraper";
const APIFY_RUN_SYNC_URL = `https://api.apify.com/v2/acts/${APIFY_ACTOR_ID}/run-sync-get-dataset-items`;
/** Spec §10: Apify 60 s. The actor's own `timeout` query param matches. */
export const APIFY_TIMEOUT_MS = 60_000;

export class ListingLookupError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ListingLookupError";
    this.status = status;
  }
}

/**
 * The token travels only in the query string of this URL — never log or persist
 * the URL. Never add `maxTotalChargeUsd`: Apify rejects it below 0.10 for
 * pay-per-event actors (A10).
 */
export function buildApifyUrl(token: string): string {
  const params = new URLSearchParams({ token, timeout: "60", memory: "1024" });
  return `${APIFY_RUN_SYNC_URL}?${params}`;
}

/**
 * Single-line address for the actor's `property` input:
 * "8911 E Cave Creek Rd, Carefree, AZ 85377". The app is Maricopa-only, so the
 * state is always AZ. Returns null when there is no street number or name.
 */
export function fullAddress(address: PrefillAddress): string | null {
  const explicit = address.full?.trim();
  if (explicit) return explicit;
  const number = address.streetNumber?.trim();
  const name = address.streetName?.trim();
  if (!number || !name) return null;
  const street = [number, address.streetDir?.trim(), name].filter(Boolean).join(" ");
  const stateZip = ["AZ", address.zip?.trim()].filter(Boolean).join(" ");
  return [street, address.city?.trim(), stateZip].filter(Boolean).join(", ");
}

export const zillowApifyProvider: ListingProvider = {
  name: "zillow",
  async lookup(address: PrefillAddress, signal: AbortSignal): Promise<ListingFacts | null> {
    const token = process.env.APIFY_TOKEN;
    if (!token) throw new ListingLookupError("APIFY_TOKEN is not configured");
    const full = fullAddress(address);
    if (!full) return null;

    const res = await fetch(buildApifyUrl(token), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ property: [full] }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(APIFY_TIMEOUT_MS)]),
    });
    if (!res.ok) throw new ListingLookupError(`Apify responded ${res.status}`, res.status);

    const items: unknown = await res.json();
    if (!Array.isArray(items) || items.length === 0) return null;
    return normaliseListingItem(items[0]);
  },
};
