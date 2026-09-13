import { WATER_SOURCES } from "@/lib/constants/inspection";
import type { StageContext, StageResult } from "@/lib/prefill/stage";
import { listingParcelMismatch, mapListingFacts } from "../map-facts-to-fields";
import type { PrefillInput, PrefillStage, StageLink } from "../types";
import type { ListingFacts, ListingProvider } from "./provider";
import { fullAddress, zillowApifyProvider } from "./zillow-apify";

/** One line for the tile, e.g. "Water: Private Well · 3 bed · Sewer: septic · Built 1998". */
export function summariseListing(facts: ListingFacts): string {
  const parts: string[] = [];
  if (facts.waterSource) {
    const label = WATER_SOURCES.find((w) => w.value === facts.waterSource)?.label ?? facts.waterSource;
    parts.push(`Water: ${label}`);
  }
  if (typeof facts.bedrooms === "number") parts.push(`${facts.bedrooms} bed`);
  if (facts.sewer) parts.push(`Sewer: ${facts.sewer}`);
  if (typeof facts.yearBuilt === "number") parts.push(`Built ${facts.yearBuilt}`);
  return parts.length ? parts.join(" · ") : "Listing found — no water/sewer/bedroom facts";
}

/**
 * True for an aborted/timed-out fetch. Checks `.name` rather than
 * `instanceof DOMException` — in jsdom (and across realms) the abort reason
 * need not be an instance of this module's DOMException (see assessor.ts).
 */
function isAbortLike(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const name = (err as { name?: unknown }).name;
  return name === "AbortError" || name === "TimeoutError";
}

/** Error text safe to persist on the run: no token, aborts named. */
export function safeErrorMessage(err: unknown): string {
  if (isAbortLike(err)) return "Timed out";
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (!message) return "Unknown error";
  return message.replace(/token=[^&\s]+/g, "token=***");
}

function finished(stage: Omit<PrefillStage, "finishedAt">): PrefillStage {
  return { ...stage, finishedAt: new Date().toISOString() };
}

/**
 * Listing stage (spec §5.3). Never throws — every outcome is a StageResult.
 * `provider` is injectable for tests; production uses the Apify Zillow actor.
 */
export async function runListingStage(
  input: PrefillInput,
  ctx: StageContext,
  provider: ListingProvider = zillowApifyProvider,
): Promise<StageResult> {
  const startedAt = new Date().toISOString();
  const address = input.address;
  const full = address ? fullAddress(address) : null;

  if (!address || !full) {
    return {
      stage: finished({ status: "skipped", startedAt, summary: "No address to search", links: [] }),
      proposals: [],
    };
  }
  if (!process.env.APIFY_TOKEN) {
    return {
      stage: finished({ status: "skipped", startedAt, summary: "Listing lookup not configured", links: [] }),
      proposals: [],
    };
  }

  try {
    await ctx.progress({ status: "running", startedAt, summary: `Searching Zillow for ${full}…`, links: [] });

    const facts = await provider.lookup({ ...address, full }, ctx.signal);
    if (!facts) {
      return {
        stage: finished({ status: "not_found", startedAt, summary: `No Zillow listing found for ${full}`, links: [] }),
        proposals: [],
      };
    }

    const links: StageLink[] = facts.url ? [{ label: "Open on Zillow", url: facts.url }] : [];
    // Parcel guard: the mapper caps every proposal; the tile says why in one line
    const apn = input.apn;
    const summary = listingParcelMismatch(facts.parcelId, apn)
      ? `${summariseListing(facts)} · Listing parcel ${facts.parcelId} does not match APN ${apn}`
      : summariseListing(facts);
    return {
      stage: finished({ status: "done", startedAt, summary, links }),
      proposals: mapListingFacts(facts, apn ? { apn } : {}),
    };
  } catch (err) {
    return {
      stage: finished({
        status: "error",
        startedAt,
        summary: "Zillow lookup failed",
        error: safeErrorMessage(err),
        links: [],
      }),
      proposals: [],
    };
  }
}
