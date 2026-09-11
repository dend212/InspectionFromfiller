import { describe, expect, it } from "vitest";
import {
  findFact,
  flattenText,
  normaliseListingItem,
  normaliseSewer,
  normaliseWaterSource,
} from "../zillow-apify";

describe("normaliseWaterSource (spec §5.3)", () => {
  it.each([
    ["City Water", "municipal"],
    ["Public", "municipal"],
    ["municipal", "municipal"],
    ["Private Water Company", "private_company"],
    ["EPCOR Water Co", "private_company"],
    ["Shared Well", "shared_well"],
    ["Well", "private_well"],
    ["Private Well", "private_well"],
    ["Hauled Water", "hauled_water"],
  ])("maps %j → %s", (raw, expected) => {
    expect(normaliseWaterSource(raw)).toBe(expected);
  });

  it("accepts arrays (Zillow resoFacts style) and label/value objects", () => {
    expect(normaliseWaterSource(["Public"])).toBe("municipal");
    expect(normaliseWaterSource({ factLabel: "Water", factValue: "Private Well" })).toBe("private_well");
  });

  it("returns undefined for unknown, empty or non-text values", () => {
    expect(normaliseWaterSource("Other")).toBeUndefined();
    expect(normaliseWaterSource("")).toBeUndefined();
    expect(normaliseWaterSource(true)).toBeUndefined();
    expect(normaliseWaterSource(undefined)).toBeUndefined();
  });
});

describe("normaliseSewer", () => {
  it.each([
    ["Septic Tank", "septic"],
    ["Septic", "septic"],
    ["Public Sewer", "sewer"],
    ["Sewer in & Connected", "sewer"],
    ["Sewer", "sewer"],
    ["None", "unknown"],
    [["Septic Tank"], "septic"],
  ])("maps %j → %s", (raw, expected) => {
    expect(normaliseSewer(raw)).toBe(expected);
  });

  it("returns undefined when there is no text", () => {
    expect(normaliseSewer(undefined)).toBeUndefined();
    expect(normaliseSewer("")).toBeUndefined();
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

  it("finds label/value pairs inside arrays (atAGlanceFacts style)", () => {
    const raw = { atAGlanceFacts: [{ factLabel: "Sewer", factValue: "Septic Tank" }] };
    expect(findFact(raw, ["sewer"])).toBe("Septic Tank");
  });

  it("prefers shallower matches and skips empty values", () => {
    const raw = { water: "", nested: { water: "Well" }, deeper: { x: { water: "City" } } };
    expect(findFact(raw, ["water"])).toBe("Well");
  });

  it("returns undefined when nothing matches", () => {
    expect(findFact({ a: 1 }, ["sewer"])).toBeUndefined();
    expect(findFact(null, ["sewer"])).toBeUndefined();
  });
});

describe("normaliseListingItem", () => {
  it("maps a flat item", () => {
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

  it("never picks a photo URL as the listing URL", () => {
    const facts = normaliseListingItem({
      zpid: 1,
      photos: [{ url: "https://photos.zillowstatic.com/fp/abc.jpg" }],
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
    expect(normaliseListingItem(null)).toBeNull();
    expect(normaliseListingItem(undefined)).toBeNull();
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
