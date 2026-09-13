import type { AssessorSummary } from "./assessor-fields";
import { assessorParcelUrl, assessorProposals, propertyUseNote } from "./assessor-fields";
import { formatFullAddress, isValidApn, normalizeStreetName, parseStreetAddress } from "./input";
import type { StageContext, StageResult } from "./stage";
import type { PrefillAddress, PrefillInput } from "./types";

export const ARCGIS_PARCELS_URL =
  "https://gis.mcassessor.maricopa.gov/arcgis/rest/services/Parcels/MapServer/0/query";

const ARCGIS_TIMEOUT_MS = 10_000;

const OUT_FIELDS = [
  "OWNER_NAME",
  "PHYSICAL_ADDRESS",
  "PHYSICAL_STREET_DIR",
  "PHYSICAL_CITY",
  "PHYSICAL_ZIP",
  "JURISDICTION",
  "APN_DASH",
  "LAND_SIZE",
  "CONST_YEAR",
  "SUBNAME",
  "LOT_NUM",
  "BLOCK",
  "STR",
  "PUC",
].join(",");

/** Attributes of one feature on the Maricopa Assessor Parcels layer */
export interface ParcelAttributes {
  OWNER_NAME?: string | null;
  PHYSICAL_ADDRESS?: string | null;
  /** Compass direction of the situs street ("E" in "3402 E SELLS DR"); the address lookup filters on it */
  PHYSICAL_STREET_DIR?: string | null;
  PHYSICAL_CITY?: string | null;
  PHYSICAL_ZIP?: string | null;
  JURISDICTION?: string | null;
  APN_DASH?: string | null;
  LAND_SIZE?: number | string | null;
  CONST_YEAR?: number | string | null;
  SUBNAME?: string | null;
  LOT_NUM?: string | null;
  BLOCK?: string | null;
  STR?: string | null;
  /** Arizona DOR 4-digit Property Use Code (e.g. "0141" single family residence); no domain on the layer */
  PUC?: string | null;
}

/**
 * What the assessor learned about the parcel, for the orchestrator to hand to
 * the listing and permits stages when the run started from an APN alone (D2).
 */
export interface ResolvedParcel {
  /** Dashed APN as the assessor reports it (`APN_DASH`) */
  apn?: string;
  /** Situs address parsed from `PHYSICAL_ADDRESS` + city/zip; absent when unparseable */
  address?: PrefillAddress;
  subdivision?: string;
  lot?: string;
}

export interface AssessorStageResult extends StageResult {
  /** Present only when a parcel was found */
  resolved?: ResolvedParcel;
}

export class AssessorUnavailableError extends Error {
  constructor(status: number) {
    super(`Assessor service unavailable (HTTP ${status})`);
    this.name = "AssessorUnavailableError";
  }
}

/**
 * True for an aborted fetch. Deliberately not `instanceof Error` — in the
 * jsdom test environment (and some runtimes), DOMException does not extend
 * the realm's Error, so checking `.name` alone is what actually detects it.
 */
function isAbortError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { name?: unknown }).name === "AbortError";
}

interface QueryOptions {
  /** Outer abort (the run's 240 s budget); a 10 s per-request timeout is always applied */
  signal?: AbortSignal;
}

async function queryParcels(where: string, opts: QueryOptions = {}): Promise<ParcelAttributes[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ARCGIS_TIMEOUT_MS);
  const forwardAbort = () => controller.abort();
  if (opts.signal?.aborted) controller.abort();
  opts.signal?.addEventListener("abort", forwardAbort, { once: true });

  try {
    const params = new URLSearchParams({
      where,
      outFields: OUT_FIELDS,
      f: "json",
      returnGeometry: "false",
    });
    const response = await fetch(`${ARCGIS_PARCELS_URL}?${params}`, { signal: controller.signal });
    if (!response.ok) throw new AssessorUnavailableError(response.status);

    const data = (await response.json()) as { features?: Array<{ attributes?: ParcelAttributes }> };
    return (data.features ?? [])
      .map((f) => f.attributes)
      .filter((a): a is ParcelAttributes => Boolean(a));
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", forwardAbort);
  }
}

/** Parcel by dashed APN (`219-11-121`). Throws AssessorUnavailableError on non-2xx; null when not found. */
export async function queryParcelByApn(
  apn: string,
  opts?: QueryOptions,
): Promise<ParcelAttributes | null> {
  if (!isValidApn(apn)) throw new Error("Invalid APN format");
  const [first] = await queryParcels(`APN_DASH='${apn}'`, opts);
  return first ?? null;
}

/** Hints that disambiguate a house number + street name shared by several parcels */
export interface AddressHints {
  /** Compass direction as parsed from the input ("E"); anything but N/S/E/W/NE/NW/SE/SW is ignored */
  streetDir?: string;
  /** Input ZIP; compared on its first five digits against the layer's `PHYSICAL_ZIP` */
  zip?: string;
}

/** "e" → "E"; undefined for anything that is not a compass direction (the only form safe in a `where`) */
function normaliseDirection(dir: string | undefined): string | undefined {
  const upper = (dir ?? "").trim().toUpperCase();
  return /^(N|S|E|W|NE|NW|SE|SW)$/.test(upper) ? upper : undefined;
}

function zip5(zip: string | null | undefined): string {
  const digits = (zip ?? "").replace(/\D/g, "");
  return digits.length >= 5 ? digits.slice(0, 5) : "";
}

/**
 * Parcel by house number + street name (direction/suffix stripped from the name). Null for
 * unusable input, without a request. Phoenix streets repeat on both sides of Central
 * (3402 E Sells Dr ≠ 3402 W Sells Dr), so when the input carries a direction the layer is
 * asked for that side first and the undirected query is only the fallback; a ZIP hint then
 * picks among the rows, else the first row wins as before.
 */
export async function findParcelByAddress(
  streetNumber: string,
  streetName: string,
  opts?: QueryOptions,
  hints: AddressHints = {},
): Promise<ParcelAttributes | null> {
  const number = streetNumber.trim();
  const name = normalizeStreetName(streetName);
  if (!/^\d{1,8}$/.test(number) || !name) return null;

  const undirected = `PHYSICAL_STREET_NUM='${number}' AND PHYSICAL_STREET_NAME LIKE '${name}%'`;
  const dir = normaliseDirection(hints.streetDir);
  let rows: ParcelAttributes[] = [];
  if (dir) rows = await queryParcels(`${undirected} AND PHYSICAL_STREET_DIR='${dir}'`, opts);
  if (rows.length === 0) rows = await queryParcels(undirected, opts);

  const zip = zip5(hints.zip);
  const inZip = zip ? rows.find((row) => zip5(row.PHYSICAL_ZIP) === zip) : undefined;
  return inZip ?? rows[0] ?? null;
}

/** "8911 E CAVE CREEK RD   CAREFREE  85377" → "8911 E CAVE CREEK RD" (the layer appends city/zip after runs of spaces) */
export function cleanPhysicalAddress(raw: string | null | undefined): string {
  return (raw ?? "").split(/ {2,}/)[0].trim();
}

export function mapParcelToAssessor(feature: ParcelAttributes): AssessorSummary {
  const propertyUseCode = (feature.PUC ?? "").trim();
  const legalParts = [
    feature.SUBNAME || "",
    feature.LOT_NUM ? `Lot ${feature.LOT_NUM}` : "",
    feature.BLOCK ? `Block ${feature.BLOCK}` : "",
    feature.STR ? `STR ${feature.STR}` : "",
  ].filter(Boolean);

  return {
    ownerName: feature.OWNER_NAME || "",
    physicalAddress: cleanPhysicalAddress(feature.PHYSICAL_ADDRESS),
    city: feature.PHYSICAL_CITY || "",
    zip: feature.PHYSICAL_ZIP || "",
    // The Maricopa County Assessor API only serves parcels in Maricopa
    // County, so the county is always "Maricopa". The JURISDICTION field on
    // the source record is the *city* (Phoenix, Tempe, etc.), not the
    // county — using it here previously left the County dropdown empty
    // because no value matched AZ_COUNTIES.
    county: "Maricopa",
    apnFormatted: feature.APN_DASH || "",
    legalDescription: legalParts.join(", "),
    lotSize: String(feature.LAND_SIZE || ""),
    yearBuilt: String(feature.CONST_YEAR || ""),
    ...(propertyUseCode ? { propertyUseCode } : {}),
  };
}

function resolveParcel(
  feature: ParcelAttributes,
  summary: AssessorSummary,
  apn: string,
): ResolvedParcel {
  const parsed = parseStreetAddress(summary.physicalAddress);
  let address: PrefillAddress | undefined;
  if (parsed) {
    address = {
      ...parsed,
      ...(summary.city ? { city: summary.city } : {}),
      ...(summary.zip ? { zip: summary.zip } : {}),
    };
    address.full = formatFullAddress(address);
  }
  return {
    ...(apn ? { apn } : {}),
    ...(address ? { address } : {}),
    ...(feature.SUBNAME ? { subdivision: feature.SUBNAME } : {}),
    ...(feature.LOT_NUM ? { lot: feature.LOT_NUM } : {}),
  };
}

/** Assessor stage: APN first, street-address fallback. Never throws. */
export async function runAssessorStage(
  input: PrefillInput,
  ctx: StageContext,
): Promise<AssessorStageResult> {
  const startedAt = new Date().toISOString();
  await ctx.progress({ status: "running", startedAt });
  const searched: string[] = [];

  try {
    let feature: ParcelAttributes | null = null;
    if (input.apn) {
      searched.push(`APN ${input.apn}`);
      feature = await queryParcelByApn(input.apn, { signal: ctx.signal });
    }
    if (!feature && input.address) {
      searched.push(`${input.address.streetNumber} ${input.address.streetName}`.trim());
      feature = await findParcelByAddress(
        input.address.streetNumber,
        input.address.streetName,
        { signal: ctx.signal },
        { streetDir: input.address.streetDir, zip: input.address.zip },
      );
    }

    const finishedAt = new Date().toISOString();
    if (!feature) {
      return {
        stage: {
          status: "not_found",
          startedAt,
          finishedAt,
          summary: searched.length
            ? `No parcel found (searched ${searched.join(" and ")})`
            : "No APN or street address to search",
          links: [],
        },
        proposals: [],
      };
    }

    const summary = mapParcelToAssessor(feature);
    const apn = summary.apnFormatted || input.apn || "";
    return {
      stage: {
        status: "done",
        startedAt,
        finishedAt,
        summary: [`Parcel ${apn}`, summary.physicalAddress, propertyUseNote(summary.propertyUseCode)]
          .filter(Boolean)
          .join(" · "),
        links: apn ? [{ label: "Assessor parcel page", url: assessorParcelUrl(apn) }] : [],
      },
      proposals: assessorProposals(summary, apn),
      resolved: resolveParcel(feature, summary, apn),
    };
  } catch (err) {
    console.error("[prefill:assessor]", err);
    const error =
      err instanceof AssessorUnavailableError
        ? "Assessor service unavailable — try Find records later"
        : isAbortError(err)
          ? "Assessor lookup timed out"
          : "Assessor lookup failed";
    return {
      stage: { status: "error", startedAt, finishedAt: new Date().toISOString(), error, links: [] },
      proposals: [],
    };
  }
}
