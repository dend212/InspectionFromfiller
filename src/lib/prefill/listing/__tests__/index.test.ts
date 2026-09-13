import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ListingFacts, ListingProvider } from "@/lib/prefill/listing/provider";
import type { PrefillInput } from "@/lib/prefill/types";
import { runListingStage, safeErrorMessage, summariseListing } from "../index";

const INPUT: PrefillInput = {
  apn: "219-11-121",
  address: { streetNumber: "8911", streetDir: "E", streetName: "Cave Creek Rd", city: "Carefree", zip: "85377" },
};
const FULL = "8911 E Cave Creek Rd, Carefree, AZ 85377";
const URL = "https://www.zillow.com/homedetails/7921650_zpid/";

function makeCtx() {
  return {
    inspectionId: "insp-1",
    runId: "run-1",
    signal: new AbortController().signal,
    progress: vi.fn().mockResolvedValue(undefined),
  };
}

function providerReturning(result: ListingFacts | null | Error): ListingProvider & { lookup: ReturnType<typeof vi.fn> } {
  const lookup = vi.fn();
  if (result instanceof Error) lookup.mockRejectedValue(result);
  else lookup.mockResolvedValue(result);
  return { name: "zillow", lookup };
}

beforeEach(() => {
  vi.stubEnv("APIFY_TOKEN", "apify_test_token");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("runListingStage", () => {
  it("skips when there is no address", async () => {
    const provider = providerReturning(null);
    const result = await runListingStage({ apn: "219-11-121" }, makeCtx(), provider);
    expect(result.stage).toMatchObject({ status: "skipped", summary: "No address to search", links: [] });
    expect(result.proposals).toEqual([]);
    expect(provider.lookup).not.toHaveBeenCalled();
  });

  it("skips when APIFY_TOKEN is not configured", async () => {
    vi.stubEnv("APIFY_TOKEN", "");
    const provider = providerReturning(null);
    const result = await runListingStage(INPUT, makeCtx(), provider);
    expect(result.stage).toMatchObject({ status: "skipped", summary: "Listing lookup not configured", links: [] });
    expect(provider.lookup).not.toHaveBeenCalled();
  });

  it("reports progress, passes the composed full address and the abort signal to the provider", async () => {
    const provider = providerReturning(null);
    const ctx = makeCtx();
    await runListingStage(INPUT, ctx, provider);
    expect(ctx.progress).toHaveBeenCalledWith(
      expect.objectContaining({ status: "running", summary: `Searching Zillow for ${FULL}…` }),
    );
    expect(provider.lookup).toHaveBeenCalledWith(expect.objectContaining({ ...INPUT.address, full: FULL }), ctx.signal);
  });

  it("returns not_found with the searched address when the provider returns null", async () => {
    const result = await runListingStage(INPUT, makeCtx(), providerReturning(null));
    expect(result.stage).toMatchObject({
      status: "not_found",
      summary: `No Zillow listing found for ${FULL}`,
      links: [],
    });
    expect(result.stage.startedAt).toBeTruthy();
    expect(result.stage.finishedAt).toBeTruthy();
    expect(result.proposals).toEqual([]);
  });

  it("returns done with the Zillow link, a summary and mapped proposals", async () => {
    const facts: ListingFacts = {
      provider: "zillow",
      url: URL,
      waterSource: "private_well",
      sewer: "septic",
      bedrooms: 3,
      yearBuilt: 1998,
      raw: {},
    };
    const result = await runListingStage(INPUT, makeCtx(), providerReturning(facts));
    expect(result.stage).toMatchObject({
      status: "done",
      summary: "Water: Private Well · 3 bed · Sewer: septic · Built 1998",
      links: [{ label: "Open on Zillow", url: URL }],
    });
    expect(result.proposals.map((p) => p.fieldPath)).toEqual([
      "facilityInfo.waterSource",
      "designFlow.numberOfBedrooms",
    ]);
  });

  it("passes the run's APN to the mapper and flags a listing whose parcel is not that APN", async () => {
    const facts: ListingFacts = {
      provider: "zillow",
      url: URL,
      bedrooms: 3,
      homeType: "SINGLE_FAMILY",
      parcelId: "21174047P",
      raw: {},
    };
    const result = await runListingStage(INPUT, makeCtx(), providerReturning(facts));
    expect(result.stage.status).toBe("done");
    expect(result.stage.summary).toBe("3 bed · Listing parcel 21174047P does not match APN 219-11-121");
    expect(result.proposals.length).toBeGreaterThan(0);
    for (const p of result.proposals) {
      expect(p.provenance.confidence, p.fieldPath).toBeLessThanOrEqual(0.6);
      expect(p.provenance.explanation, p.fieldPath).toContain(
        "listing parcel 21174047P ≠ APN 219-11-121 — confirm this is the right property",
      );
    }
  });

  it("leaves the summary and confidences alone when the listing parcel is the APN (dashes ignored)", async () => {
    const facts: ListingFacts = { provider: "zillow", url: URL, bedrooms: 3, parcelId: "21911121", raw: {} };
    const result = await runListingStage(INPUT, makeCtx(), providerReturning(facts));
    expect(result.stage.summary).toBe("3 bed");
    expect(result.proposals[0].provenance.confidence).toBe(0.85);
  });

  it("does not guard an address-only run (no APN to compare against) but exposes the listing parcel", async () => {
    const facts: ListingFacts = { provider: "zillow", url: URL, bedrooms: 3, parcelId: "21174047P", raw: {} };
    const result = await runListingStage({ address: INPUT.address }, makeCtx(), providerReturning(facts));
    expect(result.stage.summary).toBe("3 bed");
    expect(result.proposals[0].provenance.confidence).toBe(0.85);
    // e2e D2: the orchestrator compares this against the APN the assessor resolves
    expect(result.parcelId).toBe("21174047P");
  });

  it("carries no parcelId when the listing has none, or when nothing was found", async () => {
    const facts: ListingFacts = { provider: "zillow", url: URL, bedrooms: 3, raw: {} };
    expect((await runListingStage(INPUT, makeCtx(), providerReturning(facts))).parcelId).toBeUndefined();
    expect((await runListingStage(INPUT, makeCtx(), providerReturning(null))).parcelId).toBeUndefined();
  });

  it("returns done with no link when the listing has no URL", async () => {
    const facts: ListingFacts = { provider: "zillow", url: "", bedrooms: 2, raw: {} };
    const result = await runListingStage(INPUT, makeCtx(), providerReturning(facts));
    expect(result.stage.status).toBe("done");
    expect(result.stage.links).toEqual([]);
  });

  it("returns error (never throws) when the provider fails, with a token-free message", async () => {
    const err = new Error("fetch failed: https://api.apify.com/v2/acts/x?token=apify_test_token&timeout=60");
    const result = await runListingStage(INPUT, makeCtx(), providerReturning(err));
    expect(result.stage.status).toBe("error");
    expect(result.stage.summary).toBe("Zillow lookup failed");
    expect(result.stage.error).toBe("fetch failed: https://api.apify.com/v2/acts/x?token=***&timeout=60");
    expect(result.stage.error).not.toContain("apify_test_token");
    expect(result.proposals).toEqual([]);
  });

  it("returns error when progress persistence throws", async () => {
    const ctx = makeCtx();
    ctx.progress.mockRejectedValue(new Error("db down"));
    const result = await runListingStage(INPUT, ctx, providerReturning(null));
    expect(result.stage.status).toBe("error");
    expect(result.stage.error).toBe("db down");
  });

  it("uses input.address.full verbatim when present", async () => {
    const provider = providerReturning(null);
    const input: PrefillInput = { address: { streetNumber: "1", streetName: "Main St", full: "1 Main St, Phoenix, AZ 85001" } };
    const result = await runListingStage(input, makeCtx(), provider);
    expect(result.stage.summary).toBe("No Zillow listing found for 1 Main St, Phoenix, AZ 85001");
  });
});

describe("summariseListing", () => {
  it("joins the known facts with · and labels water sources from WATER_SOURCES", () => {
    expect(summariseListing({ provider: "zillow", url: "", waterSource: "municipal", raw: {} })).toBe("Water: Municipal System");
    expect(summariseListing({ provider: "zillow", url: "", sewer: "sewer", bedrooms: 4, raw: {} })).toBe("4 bed · Sewer: sewer");
  });

  it("falls back to a fixed line when no septic-relevant fact is present", () => {
    expect(summariseListing({ provider: "zillow", url: "", bathrooms: 2, raw: {} })).toBe("Listing found — no water/sewer/bedroom facts");
  });
});

describe("safeErrorMessage", () => {
  it("redacts token query values and handles non-Error values", () => {
    expect(safeErrorMessage(new Error("x?token=abc123&y=1"))).toBe("x?token=***&y=1");
    expect(safeErrorMessage("plain")).toBe("plain");
    expect(safeErrorMessage(undefined)).toBe("Unknown error");
  });

  it("names aborts explicitly", () => {
    expect(safeErrorMessage(new DOMException("The operation was aborted.", "AbortError"))).toBe("Timed out");
    expect(safeErrorMessage(new DOMException("timed out", "TimeoutError"))).toBe("Timed out");
  });
});
