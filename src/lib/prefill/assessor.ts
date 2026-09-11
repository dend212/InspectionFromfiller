import type { AssessorSummary } from "./assessor-fields";
import { assessorParcelUrl, assessorProposals } from "./assessor-fields";
import { isValidApn, normalizeStreetName } from "./input";
import type { StageContext, StageResult } from "./stage";
import type { PrefillInput } from "./types";

export const ARCGIS_PARCELS_URL =
  "https://gis.mcassessor.maricopa.gov/arcgis/rest/services/Parcels/MapServer/0/query";

const ARCGIS_TIMEOUT_MS = 10_000;

const OUT_FIELDS = [
  "OWNER_NAME",
  "PHYSICAL_ADDRESS",
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
].join(",");

/** Attributes of one feature on the Maricopa Assessor Parcels layer */
export interface ParcelAttributes {
  OWNER_NAME?: string | null;
  PHYSICAL_ADDRESS?: string | null;
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

/** Parcel by house number + street name (direction/suffix stripped). Null for unusable input, without a request. */
export async function findParcelByAddress(
  streetNumber: string,
  streetName: string,
  opts?: QueryOptions,
): Promise<ParcelAttributes | null> {
  const number = streetNumber.trim();
  const name = normalizeStreetName(streetName);
  if (!/^\d{1,8}$/.test(number) || !name) return null;
  const [first] = await queryParcels(
    `PHYSICAL_STREET_NUM='${number}' AND PHYSICAL_STREET_NAME LIKE '${name}%'`,
    opts,
  );
  return first ?? null;
}

/** "8911 E CAVE CREEK RD   CAREFREE  85377" → "8911 E CAVE CREEK RD" (the layer appends city/zip after runs of spaces) */
export function cleanPhysicalAddress(raw: string | null | undefined): string {
  return (raw ?? "").split(/ {2,}/)[0].trim();
}

export function mapParcelToAssessor(feature: ParcelAttributes): AssessorSummary {
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
  };
}

/** Assessor stage: APN first, street-address fallback. Never throws. */
export async function runAssessorStage(
  input: PrefillInput,
  ctx: StageContext,
): Promise<StageResult> {
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
      feature = await findParcelByAddress(input.address.streetNumber, input.address.streetName, {
        signal: ctx.signal,
      });
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
        summary: [`Parcel ${apn}`, summary.physicalAddress].filter(Boolean).join(" · "),
        links: apn ? [{ label: "Assessor parcel page", url: assessorParcelUrl(apn) }] : [],
      },
      proposals: assessorProposals(summary, apn),
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
