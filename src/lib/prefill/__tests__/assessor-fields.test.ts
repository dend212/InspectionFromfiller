import { describe, expect, it } from "vitest";
import { assessorParcelUrl, assessorProposals } from "@/lib/prefill/assessor-fields";

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
});
