import { describe, expect, it } from "vitest";
import {
  assessorParcelUrl,
  assessorProposals,
  propertyUseNote,
  propertyUseProposals,
} from "@/lib/prefill/assessor-fields";

const SUMMARY = {
  ownerName: "JOHN DOE",
  physicalAddress: "8911 E CAVE CREEK RD",
  city: "CAREFREE",
  zip: "85377",
  county: "Maricopa",
  apnFormatted: "219-11-121",
  legalDescription: "Lot 4",
  lotSize: "43560",
  yearBuilt: "1998",
};

describe("assessorParcelUrl", () => {
  it("links to the assessor parcel page", () => {
    expect(assessorParcelUrl("219-11-121")).toBe("https://mcassessor.maricopa.gov/mcs/?q=219-11-121");
  });
  it("URL-encodes the APN", () => {
    expect(assessorParcelUrl("219 11 121")).toBe("https://mcassessor.maricopa.gov/mcs/?q=219%2011%20121");
  });
});

describe("assessorProposals", () => {
  it("proposes the seven facilityInfo fields the APN lookup writes, at confidence 1", () => {
    const proposals = assessorProposals(SUMMARY, "219-11-121");
    expect(proposals.map((p) => [p.fieldPath, p.value])).toEqual([
      ["facilityInfo.facilityName", "JOHN DOE"],
      ["facilityInfo.sellerName", "JOHN DOE"],
      ["facilityInfo.facilityAddress", "8911 E CAVE CREEK RD"],
      ["facilityInfo.facilityCity", "CAREFREE"],
      ["facilityInfo.facilityZip", "85377"],
      ["facilityInfo.facilityCounty", "Maricopa"],
      ["facilityInfo.taxParcelNumber", "219-11-121"],
    ]);
    for (const p of proposals) {
      expect(p.kind).toBe("fill");
      expect(p.provenance).toMatchObject({
        source: "assessor",
        confidence: 1,
        explanation: "Maricopa County Assessor · parcel 219-11-121",
        sourceUrl: "https://mcassessor.maricopa.gov/mcs/?q=219-11-121",
      });
    }
    expect(proposals[0].provenance.evidence).toBe("OWNER_NAME: JOHN DOE");
    // County is not read from any parcel attribute — explanation only, no synthetic evidence
    const county = proposals.find((p) => p.fieldPath === "facilityInfo.facilityCounty");
    expect(county?.provenance.evidence).toBeUndefined();
  });

  it("skips empty values and falls back to the searched APN for the parcel number", () => {
    const proposals = assessorProposals({ ...SUMMARY, ownerName: "", apnFormatted: "" }, "219-11-121");
    const paths = proposals.map((p) => p.fieldPath);
    expect(paths).not.toContain("facilityInfo.facilityName");
    expect(paths).not.toContain("facilityInfo.sellerName");
    expect(proposals.find((p) => p.fieldPath === "facilityInfo.taxParcelNumber")?.value).toBe(
      "219-11-121",
    );
  });

  it("leaves the seven parcel proposals unchanged when a PUC is present", () => {
    const base = assessorProposals(SUMMARY, "219-11-121");
    const withPuc = assessorProposals({ ...SUMMARY, propertyUseCode: "0141" }, "219-11-121");
    expect(withPuc.slice(0, base.length)).toEqual(base);
    expect(withPuc).toHaveLength(base.length + 2);
  });

  it("does not propose wastewater source or facility type without a PUC", () => {
    const paths = assessorProposals(SUMMARY, "219-11-121").map((p) => p.fieldPath);
    expect(paths).not.toContain("facilityInfo.wastewaterSource");
    expect(paths).not.toContain("facilityInfo.facilityType");
  });
});

describe("propertyUseProposals (assessor PUC → wastewater source + facility type)", () => {
  const APN = "219-11-121";
  const URL = "https://mcassessor.maricopa.gov/mcs/?q=219-11-121";

  function pair(code: string | undefined) {
    const proposals = propertyUseProposals(code, APN);
    const ws = proposals.find((p) => p.fieldPath === "facilityInfo.wastewaterSource");
    const ft = proposals.find((p) => p.fieldPath === "facilityInfo.facilityType");
    return { proposals, ws, ft };
  }

  it("proposes residential / single_family at 0.95 for a 01xx single family residence with full provenance", () => {
    const all = assessorProposals({ ...SUMMARY, propertyUseCode: "0141" }, APN);
    const proposals = all.filter(
      (p) => p.fieldPath === "facilityInfo.wastewaterSource" || p.fieldPath === "facilityInfo.facilityType",
    );
    const ws = proposals.find((p) => p.fieldPath === "facilityInfo.wastewaterSource");
    const ft = proposals.find((p) => p.fieldPath === "facilityInfo.facilityType");
    expect(proposals).toHaveLength(2);
    expect(ws).toMatchObject({
      fieldPath: "facilityInfo.wastewaterSource",
      value: "residential",
      kind: "fill",
      provenance: {
        source: "assessor",
        confidence: 0.95,
        explanation: "Maricopa County Assessor · property use code 0141 (single family residence)",
        evidence: "PUC: 0141",
        sourceUrl: URL,
      },
    });
    expect(ft).toMatchObject({
      fieldPath: "facilityInfo.facilityType",
      value: "single_family",
      kind: "fill",
      provenance: {
        source: "assessor",
        confidence: 0.95,
        explanation: "Maricopa County Assessor · property use code 0141 (single family residence)",
        evidence: "PUC: 0141",
        sourceUrl: URL,
      },
    });
  });

  it.each([
    ["0100", "residential", 0.95, "single_family", 0.95, "single family residence"],
    ["0171", "residential", 0.95, "single_family", 0.95, "single family residence"],
    ["0181", "residential", 0.95, "single_family", 0.7, "single family residence"],
    ["0336", "residential", 0.9, "multifamily", 0.7, "multiple residential"],
    ["0401", "commercial", 0.9, "commercial", 0.9, "hotel / motel / resort"],
    ["0501", "commercial", 0.9, "commercial", 0.9, "hotel / motel / resort"],
    ["0610", "commercial", 0.9, "commercial", 0.9, "hotel / motel / resort"],
    ["0712", "residential", 0.9, "multifamily", 0.7, "condominium / townhouse"],
    ["0812", "residential", 0.9, "single_family", 0.85, "manufactured home"],
    ["0831", "residential", 0.9, "single_family", 0.85, "manufactured home"],
    ["8712", "residential", 0.95, "single_family", 0.9, "residential, over 5 acres"],
    ["8730", "residential", 0.95, "single_family", 0.9, "residential, over 5 acres"],
    ["8741", "residential", 0.95, "single_family", 0.9, "residential, over 5 acres"],
    ["8755", "residential", 0.95, "single_family", 0.9, "residential, over 5 acres"],
    ["8721", "residential", 0.9, "single_family", 0.7, "residential, over 5 acres"],
    ["8770", "residential", 0.9, "single_family", 0.7, "residential, over 5 acres"],
    ["1000", "commercial", 0.9, "commercial", 0.9, "commercial / industrial"],
    ["1511", "commercial", 0.9, "commercial", 0.9, "commercial / industrial"],
    ["2100", "commercial", 0.9, "commercial", 0.9, "commercial / industrial"],
    ["3999", "commercial", 0.9, "commercial", 0.9, "commercial / industrial"],
  ])("maps PUC %s → %s @ %s / %s @ %s", (code, wsValue, wsConf, ftValue, ftConf, label) => {
    const { proposals, ws, ft } = pair(code);
    expect(proposals).toHaveLength(2);
    expect(ws?.value).toBe(wsValue);
    expect(ws?.provenance.confidence).toBe(wsConf);
    expect(ft?.value).toBe(ftValue);
    expect(ft?.provenance.confidence).toBe(ftConf);
    for (const p of proposals) {
      expect(p.kind).toBe("fill");
      expect(p.provenance).toMatchObject({
        source: "assessor",
        explanation: `Maricopa County Assessor · property use code ${code} (${label})`,
        evidence: `PUC: ${code}`,
        sourceUrl: URL,
      });
    }
  });

  it("084x–089x (MH/RV park) proposes only wastewaterSource residential at 0.7 — never a facility type", () => {
    for (const code of ["0845", "0840", "0899"]) {
      const { proposals, ws, ft } = pair(code);
      expect(proposals, code).toHaveLength(1);
      expect(ws, code).toMatchObject({
        value: "residential",
        kind: "fill",
        provenance: {
          source: "assessor",
          confidence: 0.7,
          explanation: `Maricopa County Assessor · property use code ${code} (manufactured home)`,
          evidence: `PUC: ${code}`,
          sourceUrl: URL,
        },
      });
      expect(ft, code).toBeUndefined();
    }
  });

  it.each([["0012"], ["0197"], ["0190"], ["0801"], ["4101"], ["8550"], ["8700"], ["8760"], [""], ["01"], ["  "], [undefined]])(
    "proposes nothing for %j (vacant, misc residential improvement, agricultural, unlisted, blank or short)",
    (code) => {
      expect(propertyUseProposals(code as string | undefined, APN)).toEqual([]);
    },
  );

  it("trims and reads the prefix from the first two characters only", () => {
    const { ws, ft } = pair(" 0141 ");
    expect(ws?.value).toBe("residential");
    expect(ft?.value).toBe("single_family");
    expect(ws?.provenance.evidence).toBe("PUC: 0141");
  });
});

describe("propertyUseNote (assessor tile note for codes that need a closer look)", () => {
  it.each([
    ["0181", "PUC 018x — second residence on parcel; check for a second or shared system"],
    ["0197", "PUC 019x — no dwelling coded on this parcel; confirm the structure served"],
    ["0712", "PUC 07xx — condo/townhouse; confirm the system is not shared"],
    [
      "0845",
      "PUC 08xx — MH/RV park: shared or large-flow system likely (250 gpd per space); confirm facility type and number of systems",
    ],
    ["0899", "PUC 08xx — MH/RV park: shared or large-flow system likely (250 gpd per space); confirm facility type and number of systems"],
    ["8721", "PUC 87xx — two residences on parcel; check for a second or shared system"],
    ["8770", "PUC 87xx — two residences on parcel; check for a second or shared system"],
    ["0012", "Assessor codes this parcel vacant (PUC 00xx) — confirm the structure served"],
    [" 0012 ", "Assessor codes this parcel vacant (PUC 00xx) — confirm the structure served"],
  ])("notes %s", (code, note) => {
    expect(propertyUseNote(code)).toBe(note);
  });

  it.each([["0141"], ["0336"], ["0501"], ["0812"], ["8712"], ["1511"], ["4101"], ["0801"], [""], ["01"], [undefined]])(
    "has no note for %j",
    (code) => {
      expect(propertyUseNote(code as string | undefined)).toBeNull();
    },
  );
});
