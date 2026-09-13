import { describe, expect, it } from "vitest";
import type { ListingFacts } from "@/lib/prefill/listing/provider";
import {
  LISTING_BEDROOMS_CONFIDENCE,
  LISTING_SEWER_WARNING,
  LISTING_WATER_CONFIDENCE,
  capListingProposals,
  dedupeProposals,
  listingParcelMismatchSummary,
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

  it("skips the wastewaterSource fill when the listing says sewer, keeping the warning and the facilityType fill", () => {
    const out = mapListingFacts(facts({ sewer: "sewer", homeType: "SINGLE_FAMILY" }));
    expect(out.map((p) => `${p.kind}:${p.fieldPath}`)).toEqual([
      "warning:facilityInfo.wastewaterSource",
      "fill:facilityInfo.facilityType",
    ]);
    expect(out[0]).toMatchObject({ value: "", provenance: { explanation: LISTING_SEWER_WARNING } });
    expect(out[1]).toMatchObject({
      value: "single_family",
      provenance: { confidence: 0.85, explanation: "Zillow lists the home as Single Family" },
    });
  });
});

describe("mapListingFacts — homeType canonicalisation (audit batch 0 §2 tier 2)", () => {
  it.each([
    ["SINGLE_FAMILY", "residential", 0.85, "single_family", 0.85, "Single Family"],
    ["MANUFACTURED", "residential", 0.85, "single_family", 0.85, "Manufactured"],
    ["TOWNHOUSE", "residential", 0.85, "single_family", 0.8, "Townhouse"],
    ["CONDO", "residential", 0.85, "multifamily", 0.8, "Condo"],
    ["APARTMENT", "residential", 0.85, "multifamily", 0.8, "Apartment"],
    ["MULTI_FAMILY", "residential", 0.85, "multifamily", 0.8, "Multi Family"],
    // resoFacts.homeType / propertySubType spellings and odd casing collapse onto the same rules
    ["SingleFamily", "residential", 0.85, "single_family", 0.85, "Single Family"],
    ["Single Family Residence", "residential", 0.85, "single_family", 0.85, "Single Family"],
    ["Manufactured Home", "residential", 0.85, "single_family", 0.85, "Manufactured"],
    ["Mobile Home", "residential", 0.85, "single_family", 0.85, "Manufactured"],
    ["single_family", "residential", 0.85, "single_family", 0.85, "Single Family"],
    ["Condominium", "residential", 0.85, "multifamily", 0.8, "Condo"],
    ["Townhome", "residential", 0.85, "single_family", 0.8, "Townhouse"],
    ["MultiFamily", "residential", 0.85, "multifamily", 0.8, "Multi Family"],
  ])("%j → %s @ %s / %s @ %s, explained as %j", (raw, wsValue, wsConf, ftValue, ftConf, human) => {
    const out = mapListingFacts(facts({ homeType: raw }));
    expect(out).toEqual([
      expect.objectContaining({
        fieldPath: "facilityInfo.wastewaterSource",
        value: wsValue,
        provenance: expect.objectContaining({
          confidence: wsConf,
          explanation: `Zillow lists the home as ${human}`,
          evidence: `homeType: ${raw}`,
        }),
      }),
      expect.objectContaining({
        fieldPath: "facilityInfo.facilityType",
        value: ftValue,
        provenance: expect.objectContaining({ confidence: ftConf, explanation: `Zillow lists the home as ${human}` }),
      }),
    ]);
  });

  it("proposes nothing for tokens outside the table even after canonicalisation", () => {
    expect(mapListingFacts(facts({ homeType: "Lot" }))).toEqual([]);
    expect(mapListingFacts(facts({ homeType: "HOME_TYPE_UNKNOWN" }))).toEqual([]);
    expect(mapListingFacts(facts({ homeType: "Vacant Land" }))).toEqual([]);
  });
});

describe("mapListingFacts — parcel guard (listing parcel vs the run's APN)", () => {
  const MISMATCH = " · listing parcel 21174047P ≠ APN 211-74-047 — confirm this is the right property";

  it("caps every listing proposal at 0.6 and says why when the listing parcel is not the APN", () => {
    const out = mapListingFacts(
      facts({ parcelId: "21174047P", waterSource: "private_well", bedrooms: 3, sewer: "sewer", homeType: "SINGLE_FAMILY" }),
      { apn: "211-74-047" },
    );
    expect(out.map((p) => `${p.kind}:${p.fieldPath}`)).toEqual([
      "fill:facilityInfo.waterSource",
      "fill:designFlow.numberOfBedrooms",
      "warning:facilityInfo.wastewaterSource",
      "fill:facilityInfo.facilityType",
    ]);
    for (const p of out) {
      expect(p.provenance.confidence, p.fieldPath).toBe(0.6);
      expect(p.provenance.explanation, p.fieldPath).toMatch(new RegExp(`${MISMATCH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
    }
    expect(out[0].provenance.explanation).toBe(`Zillow listing · Water source: Private Well${MISMATCH}`);
    expect(out[2].provenance.explanation).toBe(`${LISTING_SEWER_WARNING}${MISMATCH}`);
  });

  it("never raises a confidence to the cap", () => {
    const [p] = mapListingFacts(facts({ parcelId: "1", bedrooms: 3 }), { apn: "2" });
    expect(p.provenance.confidence).toBe(0.6);
    // a proposal already below the cap keeps its own confidence
    const low = mapListingFacts(facts({ parcelId: "1", homeType: "TOWNHOUSE" }), { apn: "2" });
    expect(low.map((p) => p.provenance.confidence)).toEqual([0.6, 0.6]);
  });

  it("compares with dashes and case stripped but keeps a letter suffix — 211-74-047P is 21174047P, 21174047 is not", () => {
    const same = mapListingFacts(facts({ parcelId: "21174047P", bedrooms: 3 }), { apn: "211-74-047P" });
    expect(same[0].provenance.confidence).toBe(LISTING_BEDROOMS_CONFIDENCE);
    expect(same[0].provenance.explanation).toBe("Zillow listing · 3 bedrooms");
    const lower = mapListingFacts(facts({ parcelId: "21174047p", bedrooms: 3 }), { apn: "211-74-047P" });
    expect(lower[0].provenance.confidence).toBe(LISTING_BEDROOMS_CONFIDENCE);
    const different = mapListingFacts(facts({ parcelId: "21174047P", bedrooms: 3 }), { apn: "211-74-047" });
    expect(different[0].provenance.confidence).toBe(0.6);
  });

  it("does nothing without both a listing parcel and a run APN", () => {
    expect(mapListingFacts(facts({ bedrooms: 3 }), { apn: "211-74-047" })[0].provenance.confidence).toBe(
      LISTING_BEDROOMS_CONFIDENCE,
    );
    expect(mapListingFacts(facts({ parcelId: "21174047P", bedrooms: 3 }))[0].provenance.confidence).toBe(
      LISTING_BEDROOMS_CONFIDENCE,
    );
    expect(mapListingFacts(facts({ parcelId: "21174047P", bedrooms: 3 }), {})[0].provenance.confidence).toBe(
      LISTING_BEDROOMS_CONFIDENCE,
    );
    expect(mapListingFacts(facts({ parcelId: "  ", bedrooms: 3 }), { apn: "211-74-047" })[0].provenance.confidence).toBe(
      LISTING_BEDROOMS_CONFIDENCE,
    );
  });
});

describe("capListingProposals / listingParcelMismatchSummary — the guard the orchestrator re-applies (e2e D2)", () => {
  const permit: ProposedField = {
    fieldPath: "septicTank.tankCapacity",
    value: "1250",
    kind: "fill",
    provenance: { source: "permit", confidence: 0.9, explanation: "Permit OW-17-00474 p.1" },
  };

  it("produces exactly the proposals mapListingFacts produces for the same mismatch", () => {
    const f = facts({ parcelId: "17028066F", waterSource: "municipal", bedrooms: 4, sewer: "sewer", homeType: "SINGLE_FAMILY" });
    const viaMapper = mapListingFacts(f, { apn: "154-22-029" });
    const viaHelper = capListingProposals(mapListingFacts(f), "17028066F", "154-22-029");
    expect(viaHelper).toEqual(viaMapper);
    expect(viaHelper[0].provenance.explanation).toBe(
      "Zillow listing · Water source: Municipal System · listing parcel 17028066F ≠ APN 154-22-029 — confirm this is the right property",
    );
  });

  it("touches only listing proposals and leaves the rest as they are", () => {
    const listing = mapListingFacts(facts({ bedrooms: 4 }));
    const out = capListingProposals([permit, ...listing], "17028066F", "154-22-029");
    expect(out[0]).toBe(permit);
    expect(out[1].provenance.confidence).toBe(0.6);
  });

  it("the tile line matches the one the listing stage writes on the typed-APN path", () => {
    expect(listingParcelMismatchSummary("17028066F", "154-22-029")).toBe(
      "Listing parcel 17028066F does not match APN 154-22-029",
    );
  });
});

describe("dedupeProposals — assessor property-use code beats the listing homeType fallback (per-field source order)", () => {
  it("keeps the assessor residential proposal over the listing's even when the listing is more confident", () => {
    const assessorResidential: ProposedField = {
      fieldPath: "facilityInfo.wastewaterSource",
      value: "residential",
      kind: "fill",
      provenance: { source: "assessor", confidence: 0.85, explanation: "Maricopa County Assessor · property use code 0141 (single family residence)" },
    };
    const [mapped] = mapListingFacts(facts({ homeType: "SINGLE_FAMILY" }));
    const listingResidential: ProposedField = {
      ...mapped,
      provenance: { ...mapped.provenance, confidence: 0.95 },
    };
    expect(dedupeProposals([assessorResidential, listingResidential])).toEqual([assessorResidential]);
    expect(dedupeProposals([listingResidential, assessorResidential])).toEqual([assessorResidential]);
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
