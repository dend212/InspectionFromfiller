import { describe, expect, it } from "vitest";
import type { ListingFacts } from "@/lib/prefill/listing/provider";
import {
  LISTING_BEDROOMS_CONFIDENCE,
  LISTING_SEWER_WARNING,
  LISTING_WATER_CONFIDENCE,
  dedupeProposals,
  mapListingFacts,
} from "@/lib/prefill/map-facts-to-fields";
import type { ProposedField } from "@/lib/prefill/types";

const URL = "https://www.zillow.com/homedetails/8911-E-Cave-Creek-Rd/7921650_zpid/";

function facts(overrides: Partial<ListingFacts> = {}): ListingFacts {
  return { provider: "zillow", url: URL, raw: {}, ...overrides };
}

describe("mapListingFacts", () => {
  it("proposes facilityInfo.waterSource at confidence 0.8 with the Zillow URL and quoted evidence", () => {
    const out = mapListingFacts(facts({ waterSource: "private_well", raw: { resoFacts: { waterSource: ["Private Well"] } } }));
    expect(out).toEqual([
      {
        fieldPath: "facilityInfo.waterSource",
        value: "private_well",
        kind: "fill",
        provenance: {
          source: "listing",
          confidence: LISTING_WATER_CONFIDENCE,
          explanation: "Zillow listing · Water source: Private Well",
          evidence: "Water: Private Well",
          sourceUrl: URL,
        },
      },
    ]);
    expect(LISTING_WATER_CONFIDENCE).toBe(0.8);
  });

  it("proposes designFlow.numberOfBedrooms as a string at confidence 0.85", () => {
    const out = mapListingFacts(facts({ bedrooms: 3 }));
    expect(out).toEqual([
      {
        fieldPath: "designFlow.numberOfBedrooms",
        value: "3",
        kind: "fill",
        provenance: {
          source: "listing",
          confidence: LISTING_BEDROOMS_CONFIDENCE,
          explanation: "Zillow listing · 3 bedrooms",
          evidence: "Bedrooms: 3",
          sourceUrl: URL,
        },
      },
    ]);
    expect(LISTING_BEDROOMS_CONFIDENCE).toBe(0.85);
  });

  it("ignores non-positive or fractional bedroom counts", () => {
    expect(mapListingFacts(facts({ bedrooms: 0 }))).toEqual([]);
    expect(mapListingFacts(facts({ bedrooms: 2.5 }))).toEqual([]);
  });

  it('adds a "warning" proposal on facilityInfo.wastewaterSource when the listing says sewer', () => {
    const out = mapListingFacts(facts({ sewer: "sewer", raw: { sewer: ["Public Sewer"] } }));
    expect(out).toEqual([
      {
        fieldPath: "facilityInfo.wastewaterSource",
        value: "",
        kind: "warning",
        provenance: {
          source: "listing",
          confidence: LISTING_WATER_CONFIDENCE,
          explanation: LISTING_SEWER_WARNING,
          evidence: "Sewer: Public Sewer",
          sourceUrl: URL,
        },
      },
    ]);
    expect(LISTING_SEWER_WARNING).toBe('Listing says "Sewer" — confirm this property is on septic');
  });

  it("proposes nothing for septic / unknown sewer and for year built, baths, lot size", () => {
    expect(mapListingFacts(facts({ sewer: "septic", yearBuilt: 1998, bathrooms: 2, lotSqft: 5000 }))).toEqual([]);
    expect(mapListingFacts(facts({ sewer: "unknown" }))).toEqual([]);
  });

  it("omits sourceUrl when the listing has no URL", () => {
    const out = mapListingFacts(facts({ url: "", bedrooms: 2 }));
    expect(out[0].provenance).not.toHaveProperty("sourceUrl");
  });

  it("returns all three proposals together, in a stable order", () => {
    const out = mapListingFacts(facts({ waterSource: "municipal", bedrooms: 4, sewer: "sewer" }));
    expect(out.map((p) => `${p.kind}:${p.fieldPath}`)).toEqual([
      "fill:facilityInfo.waterSource",
      "fill:designFlow.numberOfBedrooms",
      "warning:facilityInfo.wastewaterSource",
    ]);
  });
});

describe("mapListingFacts — homeType → wastewaterSource + facilityType (task 2)", () => {
  it("SINGLE_FAMILY proposes residential @ 0.85 and single_family @ 0.85", () => {
    const out = mapListingFacts(facts({ homeType: "SINGLE_FAMILY" }));
    expect(out).toEqual([
      {
        fieldPath: "facilityInfo.wastewaterSource",
        value: "residential",
        kind: "fill",
        provenance: {
          source: "listing",
          confidence: 0.85,
          explanation: "Zillow lists the home as Single Family",
          evidence: "homeType: SINGLE_FAMILY",
          sourceUrl: URL,
        },
      },
      {
        fieldPath: "facilityInfo.facilityType",
        value: "single_family",
        kind: "fill",
        provenance: {
          source: "listing",
          confidence: 0.85,
          explanation: "Zillow lists the home as Single Family",
          evidence: "homeType: SINGLE_FAMILY",
          sourceUrl: URL,
        },
      },
    ]);
  });

  it("TOWNHOUSE proposes residential @ 0.85 and single_family @ 0.8", () => {
    const out = mapListingFacts(facts({ homeType: "TOWNHOUSE" }));
    expect(out).toEqual([
      expect.objectContaining({
        fieldPath: "facilityInfo.wastewaterSource",
        value: "residential",
        provenance: expect.objectContaining({ confidence: 0.85, explanation: "Zillow lists the home as Townhouse" }),
      }),
      expect.objectContaining({
        fieldPath: "facilityInfo.facilityType",
        value: "single_family",
        provenance: expect.objectContaining({ confidence: 0.8, explanation: "Zillow lists the home as Townhouse" }),
      }),
    ]);
  });

  it("CONDO proposes residential @ 0.85 and multifamily @ 0.8", () => {
    const out = mapListingFacts(facts({ homeType: "CONDO" }));
    expect(out).toEqual([
      expect.objectContaining({
        fieldPath: "facilityInfo.wastewaterSource",
        value: "residential",
        provenance: expect.objectContaining({ confidence: 0.85, explanation: "Zillow lists the home as Condo" }),
      }),
      expect.objectContaining({
        fieldPath: "facilityInfo.facilityType",
        value: "multifamily",
        provenance: expect.objectContaining({ confidence: 0.8, explanation: "Zillow lists the home as Condo" }),
      }),
    ]);
  });

  it("proposes nothing for LOT or a missing homeType", () => {
    expect(mapListingFacts(facts({ homeType: "LOT" }))).toEqual([]);
    expect(mapListingFacts(facts({}))).toEqual([]);
  });
});

describe("dedupeProposals — assessor property-use code beats the listing homeType fallback (existing SOURCE_RANK rule)", () => {
  it("keeps the assessor residential proposal over the listing's", () => {
    const assessorResidential: ProposedField = {
      fieldPath: "facilityInfo.wastewaterSource",
      value: "residential",
      kind: "fill",
      provenance: { source: "assessor", confidence: 0.95, explanation: "Maricopa County Assessor · property use code 0141 (single family residence)" },
    };
    const [listingResidential] = mapListingFacts(facts({ homeType: "SINGLE_FAMILY" }));
    const out = dedupeProposals([assessorResidential, listingResidential]);
    expect(out).toEqual([assessorResidential]);
  });
});

describe("dedupeProposals with listing proposals (spec §7: permit wins over listing)", () => {
  const permitWater: ProposedField = {
    fieldPath: "facilityInfo.waterSource",
    value: "municipal",
    kind: "fill",
    provenance: { source: "permit", confidence: 0.7, explanation: "Permit 000972 p.1" },
  };

  it("keeps the permit water source even when the listing is more confident", () => {
    const [listingWater] = mapListingFacts(facts({ waterSource: "private_well" }));
    const out = dedupeProposals([listingWater, permitWater]);
    expect(out).toEqual([permitWater]);
  });

  it("keeps a listing sewer warning alongside a permit fill for the same field", () => {
    const [warning] = mapListingFacts(facts({ sewer: "sewer" }));
    const permitFill: ProposedField = {
      fieldPath: "facilityInfo.wastewaterSource",
      value: "residential",
      kind: "fill",
      provenance: { source: "permit", confidence: 0.9, explanation: "Permit" },
    };
    const out = dedupeProposals([warning, permitFill]);
    expect(out).toHaveLength(2);
  });
});
