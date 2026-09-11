import type { ListingFacts, ListingWaterSource } from "./provider";

/**
 * Zillow via the Apify actor `sian.agency/zillow-property-detail-scraper`.
 *
 * The actor's output shape is not published, so everything below is defensive:
 * facts are located by a case-insensitive deep key search (`findFact`) and any
 * unmapped shape yields `null` facts, never an error. Run
 * `scripts/listing-shape-check.mts` to see the real keys for one address.
 */

/** Candidate key names, matched after lower-casing and stripping non-alphanumerics. */
export const WATER_KEYS = ["waterSource", "water_source", "water", "waterUtility"];
export const SEWER_KEYS = ["sewer", "sewerType", "sewer_type", "sewerSystem"];
const BEDROOM_KEYS = ["bedrooms", "beds", "bedroomCount"];
const BATHROOM_KEYS = ["bathrooms", "baths", "bathroomCount"];
const YEAR_BUILT_KEYS = ["yearBuilt", "year_built"];
const LOT_VALUE_KEYS = ["lotAreaValue", "lotSize", "lot_size", "lotArea"];
const LOT_UNIT_KEYS = ["lotAreaUnits", "lotSizeUnits"];
const URL_KEYS = ["hdpUrl", "url", "detailUrl", "zillowUrl", "propertyUrl", "link"];
const ZPID_KEYS = ["zpid"];
const NOT_FOUND_KEYS = ["error", "notFound", "errorMessage"];

const ZILLOW_HOMEDETAILS_RE = /^https?:\/\/(www\.)?zillow\.com\/homedetails\//i;
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

/** Spec §5.3 water-source normalisation. Specific phrases are tested before generic ones. */
export function normaliseWaterSource(raw: unknown): ListingWaterSource | undefined {
  const text = flattenText(raw);
  if (!text) return undefined;
  if (/hauled/.test(text)) return "hauled_water";
  if (/shared\s*well/.test(text)) return "shared_well";
  if (/city|municipal|public/.test(text)) return "municipal";
  if (/private\s*(water\s*)?company|water\s*co\b/.test(text)) return "private_company";
  if (/\bwell\b/.test(text)) return "private_well";
  return undefined;
}

export function normaliseSewer(raw: unknown): "septic" | "sewer" | "unknown" | undefined {
  const text = flattenText(raw);
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
  if (n === undefined) return undefined;
  const unitText = flattenText(units) ?? (typeof value === "string" ? value.toLowerCase() : "");
  if (/acre/.test(unitText)) return Math.round(n * SQFT_PER_ACRE);
  return Math.round(n);
}

function findListingUrl(raw: unknown): string | undefined {
  for (const key of URL_KEYS) {
    const v = findFact(raw, [key]);
    if (typeof v === "string" && ZILLOW_HOMEDETAILS_RE.test(v)) return v;
  }
  const zpid = findFact(raw, ZPID_KEYS);
  if (typeof zpid === "number" || (typeof zpid === "string" && /^\d+$/.test(zpid))) {
    return `https://www.zillow.com/homedetails/${zpid}_zpid/`;
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
  const waterSource = normaliseWaterSource(findFact(item, WATER_KEYS));
  const sewer = normaliseSewer(findFact(item, SEWER_KEYS));
  const bedrooms = toInteger(findFact(item, BEDROOM_KEYS));
  const bathrooms = toNumber(findFact(item, BATHROOM_KEYS));
  const yearBuilt = toInteger(findFact(item, YEAR_BUILT_KEYS));
  const lotSqft = toLotSqft(findFact(item, LOT_VALUE_KEYS), findFact(item, LOT_UNIT_KEYS));

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
