import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrefillAddress } from "@/lib/prefill/types";
import {
  APIFY_ACTOR_ID,
  ListingLookupError,
  buildApifyUrl,
  fullAddress,
  zillowApifyProvider,
} from "../zillow-apify";

const ADDRESS: PrefillAddress = {
  streetNumber: "8911",
  streetDir: "E",
  streetName: "Cave Creek Rd",
  city: "Carefree",
  zip: "85377",
};
const FULL = "8911 E Cave Creek Rd, Carefree, AZ 85377";

const mockFetch = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APIFY_TOKEN", "apify_test_token_123");
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("fullAddress", () => {
  it("prefers address.full when present", () => {
    expect(fullAddress({ ...ADDRESS, full: "  1 Main St, Phoenix, AZ 85001 " })).toBe(
      "1 Main St, Phoenix, AZ 85001",
    );
  });

  it("composes number + dir + street, city, AZ zip", () => {
    expect(fullAddress(ADDRESS)).toBe(FULL);
  });

  it("omits missing city/zip and the direction", () => {
    expect(fullAddress({ streetNumber: "12", streetName: "Oak Ave" })).toBe("12 Oak Ave, AZ");
    expect(fullAddress({ streetNumber: "12", streetName: "Oak Ave", city: "Mesa" })).toBe("12 Oak Ave, Mesa, AZ");
  });

  it("returns null without a street number or street name", () => {
    expect(fullAddress({ streetNumber: "", streetName: "Oak Ave" })).toBeNull();
    expect(fullAddress({ streetNumber: "12", streetName: "" })).toBeNull();
  });
});

describe("buildApifyUrl", () => {
  it("targets run-sync-get-dataset-items with token, timeout=60 and memory=1024", () => {
    const url = new URL(buildApifyUrl("tok"));
    expect(url.origin).toBe("https://api.apify.com");
    expect(url.pathname).toBe(`/v2/acts/${APIFY_ACTOR_ID}/run-sync-get-dataset-items`);
    expect(url.searchParams.get("token")).toBe("tok");
    expect(url.searchParams.get("timeout")).toBe("60");
    expect(url.searchParams.get("memory")).toBe("1024");
    expect(APIFY_ACTOR_ID).toBe("api-ninja~zillow-property-details-scraper");
    expect(url.searchParams.has("maxTotalChargeUsd")).toBe(false);
  });
});

describe("zillowApifyProvider.lookup", () => {
  it("POSTs { property: [full] } and returns the first item normalised", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse([
        { zpid: 1, hdpUrl: "/homedetails/1_zpid/", bedrooms: 3, resoFacts: { waterSource: ["City Water"], sewer: ["Septic Tank"] } },
      ]),
    );

    const facts = await zillowApifyProvider.lookup(ADDRESS, new AbortController().signal);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(buildApifyUrl("apify_test_token_123"));
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ property: [FULL] });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(facts).toMatchObject({
      url: "https://www.zillow.com/homedetails/1_zpid/",
      waterSource: "municipal",
      sewer: "septic",
      bedrooms: 3,
    });
  });

  it("returns null for an empty dataset (not found — Apify does not charge)", async () => {
    mockFetch.mockResolvedValue(jsonResponse([]));
    await expect(zillowApifyProvider.lookup(ADDRESS, new AbortController().signal)).resolves.toBeNull();
  });

  it("returns null when the dataset is not an array or the item is unmappable", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "bad" }));
    await expect(zillowApifyProvider.lookup(ADDRESS, new AbortController().signal)).resolves.toBeNull();
    mockFetch.mockResolvedValueOnce(jsonResponse([{ error: "Property not found" }]));
    await expect(zillowApifyProvider.lookup(ADDRESS, new AbortController().signal)).resolves.toBeNull();
  });

  it("returns null without calling Apify when no address can be composed", async () => {
    await expect(
      zillowApifyProvider.lookup({ streetNumber: "", streetName: "" }, new AbortController().signal),
    ).resolves.toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws ListingLookupError with the status on non-2xx, without leaking the token", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: { message: "Insufficient credit" } }, 402));
    const err = await zillowApifyProvider.lookup(ADDRESS, new AbortController().signal).catch((e) => e);
    expect(err).toBeInstanceOf(ListingLookupError);
    expect(err.status).toBe(402);
    expect(err.message).toBe("Apify responded 402");
    expect(err.message).not.toContain("apify_test_token_123");
  });

  it("throws when APIFY_TOKEN is missing, without calling fetch", async () => {
    vi.stubEnv("APIFY_TOKEN", "");
    await expect(zillowApifyProvider.lookup(ADDRESS, new AbortController().signal)).rejects.toThrow(
      "APIFY_TOKEN is not configured",
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("propagates an abort from the caller's signal", async () => {
    const controller = new AbortController();
    mockFetch.mockImplementation((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
    );
    const pending = zillowApifyProvider.lookup(ADDRESS, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow(/aborted/);
  });
});
