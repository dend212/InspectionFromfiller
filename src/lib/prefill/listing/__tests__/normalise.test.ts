import { describe, expect, it } from "vitest";
import {
  findFact,
  flattenText,
  normaliseListingItem,
  normaliseSewer,
  normaliseWaterSource,
} from "../zillow-apify";
import offMarket from "./fixtures/apininja-off-market.json";
import venusForSale from "./fixtures/apininja-venus-for-sale.json";

describe("normaliseWaterSource (spec §5.3 + A10 ARMLS vocabulary)", () => {
  it.each([
    // ARMLS strings as served in resoFacts.waterSource (A10)
    ["City Water", "municipal"],
    ["Pvt Water Company", "private_company"],
    ["Private Water Company", "private_company"],
    ["Water Co", "private_company"],
    ["Well - Shared", "shared_well"],
    ["Shared Well", "shared_well"],
    ["Well - Pvtly Owned", "private_well"],
    ["Private Well", "private_well"],
    ["Well", "private_well"],
    ["Hauled", "hauled_water"],
    // spec §5.3 generic phrases
    ["Public", "municipal"],
    ["municipal", "municipal"],
    ["EPCOR Water Co", "private_company"],
    ["Hauled Water", "hauled_water"],
    // case-insensitive
    ["CITY WATER", "municipal"],
    ["pvt water company", "private_company"],
    ["well - shared", "shared_well"],
  ])("maps %j → %s", (raw, expected) => {
    expect(normaliseWaterSource(raw)).toBe(expected);
  });

  it("unwraps single-element arrays (Zillow resoFacts style) and label/value objects", () => {
    expect(normaliseWaterSource(["City Water"])).toBe("municipal");
    expect(normaliseWaterSource(["Well - Shared"])).toBe("shared_well");
    expect(normaliseWaterSource({ factLabel: "Water", factValue: "Private Well" })).toBe("private_well");
  });

  it("returns undefined for None, unknown, empty, null or non-text values", () => {
    expect(normaliseWaterSource("None")).toBeUndefined();
    expect(normaliseWaterSource(["None"])).toBeUndefined();
    expect(normaliseWaterSource("Other")).toBeUndefined();
    expect(normaliseWaterSource("")).toBeUndefined();
    expect(normaliseWaterSource([])).toBeUndefined();
    expect(normaliseWaterSource(null)).toBeUndefined();
    expect(normaliseWaterSource(true)).toBeUndefined();
    expect(normaliseWaterSource(undefined)).toBeUndefined();
  });
});

describe("normaliseSewer (A10 ARMLS vocabulary)", () => {
  it.each([
    ["Septic Tank", "septic"],
    ["Septic in & Cnctd", "septic"],
    ["Septic", "septic"],
    ["Sewer - Public", "sewer"],
    ["Sewer - Private", "sewer"],
    ["Public Sewer", "sewer"],
    ["Sewer in & Connected", "sewer"],
    ["Sewer", "sewer"],
    ["None", "unknown"],
    ["Other", "unknown"],
    [["Septic Tank"], "septic"],
    [["None"], "unknown"],
    ["SEPTIC TANK", "septic"],
  ])("maps %j → %s", (raw, expected) => {
    expect(normaliseSewer(raw)).toBe(expected);
  });

  it("returns undefined when there is no text", () => {
    expect(normaliseSewer(undefined)).toBeUndefined();
    expect(normaliseSewer(null)).toBeUndefined();
    expect(normaliseSewer("")).toBeUndefined();
    expect(normaliseSewer([])).toBeUndefined();
  });
});

describe("flattenText", () => {
  it("lower-cases strings, joins string arrays, reads value/factValue/name", () => {
    expect(flattenText("Public Sewer")).toBe("public sewer");
    expect(flattenText(["Public", "Well"])).toBe("public, well");
    expect(flattenText({ value: "City" })).toBe("city");
    expect(flattenText({ factValue: "City" })).toBe("city");
    expect(flattenText({ name: "City" })).toBe("city");
    expect(flattenText(42)).toBe("42");
  });

  it("returns undefined for empty / non-text", () => {
    expect(flattenText("")).toBeUndefined();
    expect(flattenText([])).toBeUndefined();
    expect(flattenText(null)).toBeUndefined();
    expect(flattenText({ other: 1 })).toBeUndefined();
  });
});

describe("findFact", () => {
  it("finds a top-level key case-insensitively and ignoring underscores", () => {
    expect(findFact({ WaterSource: "Public" }, ["waterSource"])).toBe("Public");
    expect(findFact({ water_source: "Public" }, ["waterSource"])).toBe("Public");
  });

  it("finds nested keys (resoFacts.sewer, utilities.water)", () => {
    expect(findFact({ resoFacts: { sewer: ["Septic Tank"] } }, ["sewer"])).toEqual(["Septic Tank"]);
    expect(findFact({ utilities: { water: "City" } }, ["water"])).toBe("City");
  });

  it("descends into resoFacts on the real api-ninja shape", () => {
    expect(findFact(venusForSale, ["waterSource"])).toEqual(["City Water"]);
    expect(findFact(venusForSale, ["sewer"])).toEqual(["Septic Tank"]);
  });

  it("finds label/value pairs inside arrays (atAGlanceFacts style)", () => {
    const raw = { atAGlanceFacts: [{ factLabel: "Sewer", factValue: "Septic Tank" }] };
    expect(findFact(raw, ["sewer"])).toBe("Septic Tank");
  });

  it("prefers shallower matches and skips empty values", () => {
    const raw = { water: "", nested: { water: "Well" }, deeper: { x: { water: "City" } } };
    expect(findFact(raw, ["water"])).toBe("Well");
  });

  it("returns undefined when nothing matches or the value is null", () => {
    expect(findFact({ a: 1 }, ["sewer"])).toBeUndefined();
    expect(findFact({ resoFacts: { sewer: null } }, ["sewer"])).toBeUndefined();
    expect(findFact(null, ["sewer"])).toBeUndefined();
  });
});

describe("normaliseListingItem — recorded api-ninja fixtures", () => {
  it("maps the active FOR_SALE listing (8956 E Venus Dr, Carefree)", () => {
    const facts = normaliseListingItem(venusForSale);
    expect(facts).not.toBeNull();
    expect(facts).toMatchObject({
      provider: "zillow",
      url: "https://www.zillow.com/homedetails/8956-E-Venus-Dr-Carefree-AZ-85377/8078782_zpid/",
      waterSource: "municipal",
      sewer: "septic",
      bedrooms: 4,
      bathrooms: 2,
      yearBuilt: 1980,
      lotSqft: 47023,
    });
    expect(facts?.url.endsWith("/8078782_zpid/")).toBe(true);
    expect(facts?.raw).toBe(venusForSale);
  });

  it("maps an off-market item: null resoFacts utilities → no water/sewer facts, never a throw", () => {
    const facts = normaliseListingItem(offMarket);
    expect(facts).not.toBeNull();
    expect(facts?.waterSource).toBeUndefined();
    expect(facts?.sewer).toBeUndefined();
    expect(facts).toMatchObject({
      url: "https://www.zillow.com/homedetails/1234-E-Example-Ln-Cave-Creek-AZ-85331/12345678_zpid/",
      bedrooms: 3,
      bathrooms: 2.5,
      yearBuilt: 1998,
      lotSqft: 40075, // 0.92 acres × 43 560 (top-level lotSize is null)
    });
  });
});

describe("normaliseListingItem — shapes", () => {
  it("maps a flat item with an absolute hdpUrl and acre lot", () => {
    const facts = normaliseListingItem({
      hdpUrl: "https://www.zillow.com/homedetails/8911-E-Cave-Creek-Rd-Carefree-AZ-85377/7921650_zpid/",
      waterSource: ["Private Well"],
      sewer: ["Septic Tank"],
      bedrooms: 3,
      bathrooms: 2,
      yearBuilt: 1998,
      lotAreaValue: 1.2,
      lotAreaUnits: "Acres",
    });
    expect(facts).toMatchObject({
      provider: "zillow",
      url: "https://www.zillow.com/homedetails/8911-E-Cave-Creek-Rd-Carefree-AZ-85377/7921650_zpid/",
      waterSource: "private_well",
      sewer: "septic",
      bedrooms: 3,
      bathrooms: 2,
      yearBuilt: 1998,
      lotSqft: 52272,
    });
  });

  it("prefixes a path-only hdpUrl with https://www.zillow.com", () => {
    const facts = normaliseListingItem({ hdpUrl: "/homedetails/1-Main-St/42_zpid/", bedrooms: 2 });
    expect(facts?.url).toBe("https://www.zillow.com/homedetails/1-Main-St/42_zpid/");
  });

  it("prefers the numeric top-level lotSize (sqft) over lotAreaValue", () => {
    const facts = normaliseListingItem({ zpid: 1, lotSize: 47023, lotAreaValue: 1.0795, lotAreaUnits: "Acres" });
    expect(facts?.lotSqft).toBe(47023);
  });

  it("falls back to a string lotSize like \"1.08 Acres\" or square-foot values", () => {
    expect(normaliseListingItem({ zpid: 1, resoFacts: { lotSize: "1.08 Acres" } })?.lotSqft).toBe(47045);
    expect(normaliseListingItem({ zpid: 1, lotAreaValue: 9000, lotAreaUnits: "Square Feet" })?.lotSqft).toBe(9000);
  });

  it("maps a nested resoFacts item and builds the URL from zpid when no URL key exists", () => {
    const facts = normaliseListingItem({
      zpid: 7921650,
      resoFacts: { waterSource: ["Public"], sewer: ["Public Sewer"], bedrooms: "4", yearBuilt: "2001" },
    });
    expect(facts).toMatchObject({
      url: "https://www.zillow.com/homedetails/7921650_zpid/",
      waterSource: "municipal",
      sewer: "sewer",
      bedrooms: 4,
      yearBuilt: 2001,
    });
  });

  it("maps every A10 water/sewer row through resoFacts arrays", () => {
    const rows: Array<[string, string, string, string]> = [
      ["City Water", "municipal", "Septic Tank", "septic"],
      ["Pvt Water Company", "private_company", "Septic in & Cnctd", "septic"],
      ["Well - Shared", "shared_well", "Sewer - Public", "sewer"],
      ["Well - Pvtly Owned", "private_well", "Sewer - Private", "sewer"],
      ["Hauled", "hauled_water", "Public Sewer", "sewer"],
    ];
    for (const [water, expectedWater, sewer, expectedSewer] of rows) {
      const facts = normaliseListingItem({ zpid: 1, resoFacts: { waterSource: [water], sewer: [sewer] } });
      expect(facts?.waterSource, water).toBe(expectedWater);
      expect(facts?.sewer, sewer).toBe(expectedSewer);
    }
  });

  it("treats sewer \"None\" as unknown and water \"None\" as no fact", () => {
    const facts = normaliseListingItem({ zpid: 1, resoFacts: { waterSource: ["None"], sewer: ["None"] } });
    expect(facts?.waterSource).toBeUndefined();
    expect(facts?.sewer).toBe("unknown");
  });

  it("never picks a photo URL as the listing URL", () => {
    const facts = normaliseListingItem({
      zpid: 1,
      photos: [{ url: "https://photos.zillowstatic.com/fp/abc.jpg" }],
      desktopWebHdpImageLink: "https://photos.zillowstatic.com/fp/abc-p_h.jpg",
      bedrooms: 2,
    });
    expect(facts?.url).toBe("https://www.zillow.com/homedetails/1_zpid/");
  });

  it("keeps the raw item", () => {
    const raw = { zpid: 5, bedrooms: 1 };
    expect(normaliseListingItem(raw)?.raw).toBe(raw);
  });

  it("returns null for not-found / error items and non-objects", () => {
    expect(normaliseListingItem({ error: "Property not found", input: "1 Nowhere Rd" })).toBeNull();
    expect(normaliseListingItem({ unrelated: true })).toBeNull();
    expect(normaliseListingItem("string")).toBeNull();
    expect(normaliseListingItem([venusForSale])).toBeNull();
    expect(normaliseListingItem(null)).toBeNull();
    expect(normaliseListingItem(undefined)).toBeNull();
  });

  it("yields null facts (not a throw) for unmapped shapes with a URL", () => {
    const facts = normaliseListingItem({
      zpid: 9,
      resoFacts: { waterSource: { weird: true }, sewer: true, bedrooms: "many", yearBuilt: {} },
    });
    expect(facts).toEqual({ provider: "zillow", url: "https://www.zillow.com/homedetails/9_zpid/", raw: expect.any(Object) });
  });

  it("returns facts with no septic fields when only a URL is known", () => {
    const facts = normaliseListingItem({ url: "https://www.zillow.com/homedetails/9_zpid/" });
    expect(facts).toEqual({
      provider: "zillow",
      url: "https://www.zillow.com/homedetails/9_zpid/",
      raw: { url: "https://www.zillow.com/homedetails/9_zpid/" },
    });
  });
});
