import { describe, expect, it } from "vitest";
import { emptyPermitFacts, type PermitFacts } from "@/lib/ai/permit-extraction-schema";
import { dedupeProposals, mapPermitFacts } from "@/lib/prefill/map-facts-to-fields";
import type { ProposedField } from "@/lib/prefill/types";

const f = <T>(value: T, confidence = 0.9, page = 1, evidence = `ev:${String(value)}`) => ({
  value,
  confidence,
  page,
  evidence,
  handwritten: false,
});

const record = {
  id: "rec-1",
  permitNumber: "OW-17-00474",
  docType: "PERMIT",
  inspectionId: "insp-1",
};
const NOW = new Date("2026-09-11T12:00:00Z");

/** Discharge Authorization with every fact populated */
function daFacts(): PermitFacts {
  return {
    ...emptyPermitFacts(),
    permitNumber: f("OW-17-00474", 0.98, 1, "Permit No. OW-17-00474"),
    documentKind: "discharge_authorization",
    issueDate: f("2017-05-12", 0.95, 1, "Date Issued: 05/12/2017"),
    designFlowGpd: f(450, 0.96, 1, "Design Flow 450 gpd"),
    bedrooms: f(3, 0.96, 1, "Bedrooms: 3"),
    tanks: [
      {
        capacityGal: f(1250, 0.97, 1, "4.02 A314 Septic Tank Qty 1 Capacity 1250"),
        material: f("precast_concrete" as const, 0.85, 2, "Tank: precast concrete"),
        model: null,
        dimensions: null,
      },
    ],
    disposal: {
      type: f("seepage_pit" as const, 0.97, 1, "4.02 Seepage Pit Qty 2"),
      count: f(2, 0.97, 1, "Qty 2"),
      dimensions: f("Overall 28'0\" Effective 24'0\"", 0.95, 1),
      absorptionAreaSqft: null,
    },
    waterSource: f("private_well" as const, 0.9, 1, "Water Supply: Private Well"),
    isCesspool: f(true, 0.9, 1, "CESSPOOL"),
    hasSitePlan: f(true, 0.8, 3, "SITE PLAN"),
    systemType: f("conventional" as const, 0.9, 1, "4.02 Conventional"),
    notes: "",
  };
}

function byPath(proposals: ProposedField[]): Record<string, ProposedField> {
  return Object.fromEntries(proposals.map((p) => [p.fieldPath, p]));
}

describe("mapPermitFacts — spec §7 table", () => {
  const props = byPath(mapPermitFacts(daFacts(), record, { now: NOW }));

  // [fieldPath, value, confidence]
  const rows: Array<[string, ProposedField["value"], number]> = [
    ["facilityInfo.recordsAvailable", "yes", 1],
    ["facilityInfo.hasDischargeAuth", true, 0.98],
    ["facilityInfo.dischargeAuthPermitNo", "OW-17-00474", 0.98],
    ["facilityInfo.hasSitePlan", true, 0.8],
    ["facilityInfo.facilityAge", "9", 0.95],
    ["facilityInfo.facilityAgeEstimateExplanation", "Discharge authorization issued 05/2017 (permit OW-17-00474)", 0.95],
    ["septicTank.tanks.0.tankCapacity", "1250", 0.97],
    ["septicTank.tanks.0.capacityBasis", "permit_document", 0.97],
    ["septicTank.tanks.0.tankMaterial", "precast_concrete", 0.85],
    ["septicTank.numberOfTanks", "1", 0.97],
    ["disposalWorks.disposalType", "seepage_pit", 0.97],
    ["designFlow.numberOfBedrooms", "3", 0.96],
    ["designFlow.estimatedDesignFlow", "450", 0.96],
    ["designFlow.designFlowBasis", "permit_documents", 0.96],
    ["facilityInfo.waterSource", "private_well", 0.9],
    ["facilityInfo.isCesspool", "yes", 0.7],
    ["facilityInfo.facilitySystemTypes", ["conventional"], 0.7],
  ];

  it.each(rows)("%s → %j @ %d", (fieldPath, value, confidence) => {
    const p = props[fieldPath];
    expect(p, fieldPath).toBeDefined();
    expect(p.kind).toBe("fill");
    expect(p.value).toEqual(value);
    expect(p.provenance.confidence).toBeCloseTo(confidence, 5);
    expect(p.provenance.source).toBe("permit");
    expect(p.provenance.recordId).toBe("rec-1");
  });

  it("proposes exactly the table's fields and nothing for isAbandonment", () => {
    expect(Object.keys(props).sort()).toEqual(rows.map((r) => r[0]).sort());
  });

  it("links every proposal to the stored record page", () => {
    expect(props["septicTank.tanks.0.tankCapacity"].provenance.sourceUrl).toBe(
      "/api/inspections/insp-1/records/rec-1#page=1",
    );
    expect(props["septicTank.tanks.0.tankCapacity"].provenance.page).toBe(1);
    expect(props["septicTank.tanks.0.tankMaterial"].provenance.sourceUrl).toBe(
      "/api/inspections/insp-1/records/rec-1#page=2",
    );
    expect(props["facilityInfo.hasSitePlan"].provenance.page).toBe(3);
  });

  it("carries verbatim evidence and a one-line explanation", () => {
    const cap = props["septicTank.tanks.0.tankCapacity"].provenance;
    expect(cap.evidence).toBe("4.02 A314 Septic Tank Qty 1 Capacity 1250");
    expect(cap.explanation).toBe("Permit OW-17-00474 · Discharge Authorization p.1");
  });

  it("puts disposal count and dimensions into the explanation, not the value", () => {
    const d = props["disposalWorks.disposalType"];
    expect(d.value).toBe("seepage_pit");
    expect(d.provenance.explanation).toContain("× 2");
    expect(d.provenance.explanation).toContain("Overall 28'0\" Effective 24'0\"");
  });

  it("caps cesspool and system type at 0.7 even when the model is sure (suggestion only)", () => {
    expect(props["facilityInfo.isCesspool"].provenance.confidence).toBe(0.7);
    expect(props["facilityInfo.facilitySystemTypes"].provenance.confidence).toBe(0.7);
    const lowSure = byPath(mapPermitFacts({ ...daFacts(), isCesspool: f(true, 0.5) }, record));
    expect(lowSure["facilityInfo.isCesspool"].provenance.confidence).toBe(0.5);
  });
});

describe("mapPermitFacts — document kinds", () => {
  it("maps an approval_to_construct to the approval fields with the spec's explanation", () => {
    const facts: PermitFacts = {
      ...emptyPermitFacts(),
      documentKind: "approval_to_construct",
      permitNumber: f("000972", 0.8, 1),
      issueDate: f("2000-03-15", 0.85, 1),
    };
    const props = byPath(mapPermitFacts(facts, { ...record, permitNumber: "000972" }, { now: NOW }));
    expect(props["facilityInfo.hasApprovalOfConstruction"].value).toBe(true);
    expect(props["facilityInfo.approvalPermitNo"].value).toBe("000972");
    expect(props["facilityInfo.hasDischargeAuth"]).toBeUndefined();
    expect(props["facilityInfo.facilityAge"].value).toBe("26");
    expect(props["facilityInfo.facilityAgeEstimateExplanation"].value).toBe(
      "Approval to construct issued 03/2000 (permit 000972)",
    );
    expect(props["facilityInfo.facilityAge"].provenance.explanation).toBe(
      "Approval to construct issued 03/2000 (permit 000972)",
    );
  });

  it("treats final_da like a discharge authorization", () => {
    const props = byPath(mapPermitFacts({ ...daFacts(), documentKind: "final_da" }, record, { now: NOW }));
    expect(props["facilityInfo.hasDischargeAuth"].value).toBe(true);
    expect(props["facilityInfo.dischargeAuthPermitNo"].value).toBe("OW-17-00474");
    expect(props["facilityInfo.facilityAgeEstimateExplanation"].value).toBe(
      "Discharge authorization issued 05/2017 (permit OW-17-00474)",
    );
  });

  it("proposes no permit-number fields for notice_of_transfer / other, but still recordsAvailable", () => {
    for (const documentKind of ["notice_of_transfer", "other"] as const) {
      const props = byPath(mapPermitFacts({ ...emptyPermitFacts(), documentKind }, record));
      expect(Object.keys(props)).toEqual(["facilityInfo.recordsAvailable"]);
    }
  });

  it("falls back to the EDMS permit number when the model found none", () => {
    const facts: PermitFacts = { ...emptyPermitFacts(), documentKind: "discharge_authorization" };
    const props = byPath(mapPermitFacts(facts, record));
    expect(props["facilityInfo.dischargeAuthPermitNo"].value).toBe("OW-17-00474");
    expect(props["facilityInfo.dischargeAuthPermitNo"].provenance.confidence).toBe(0.9);
    expect(props["facilityInfo.dischargeAuthPermitNo"].provenance.evidence).toBe("EDMS index: OW-17-00474");
  });

  it("uses the EDMS docType as the label when documentKind is other", () => {
    const props = byPath(mapPermitFacts({ ...emptyPermitFacts(), documentKind: "other" }, { ...record, docType: "PLAN REVIEW" }));
    expect(props["facilityInfo.recordsAvailable"].provenance.explanation).toBe("Permit OW-17-00474 on file (PLAN REVIEW)");
  });
});

describe("mapPermitFacts — edge cases", () => {
  it("computes whole years since the issue date (birthday not yet reached)", () => {
    const facts: PermitFacts = { ...emptyPermitFacts(), issueDate: f("2000-12-01", 0.9) };
    expect(byPath(mapPermitFacts(facts, record, { now: NOW }))["facilityInfo.facilityAge"].value).toBe("25");
  });

  it("skips the age fields when the issue date is not a real date", () => {
    const facts: PermitFacts = { ...emptyPermitFacts(), issueDate: f("March 2000", 0.9) };
    expect(byPath(mapPermitFacts(facts, record))["facilityInfo.facilityAge"]).toBeUndefined();
  });

  it("infers hasSitePlan at 0.6 from the notes when the model gave no verdict", () => {
    const facts: PermitFacts = { ...emptyPermitFacts(), notes: "Page 4 is an engineer's site plan." };
    const p = byPath(mapPermitFacts(facts, record))["facilityInfo.hasSitePlan"];
    expect(p.value).toBe(true);
    expect(p.provenance.confidence).toBe(0.6);
  });

  it("proposes nothing for isCesspool false and rounds numeric values", () => {
    const facts: PermitFacts = {
      ...emptyPermitFacts(),
      isCesspool: f(false, 0.9),
      designFlowGpd: f(449.6, 0.9),
      tanks: [{ capacityGal: f(1249.5, 0.9), material: null, model: null, dimensions: null }],
    };
    const props = byPath(mapPermitFacts(facts, record));
    expect(props["facilityInfo.isCesspool"]).toBeUndefined();
    expect(props["designFlow.estimatedDesignFlow"].value).toBe("450");
    expect(props["septicTank.tanks.0.tankCapacity"].value).toBe("1250");
  });

  it("counts every tank for numberOfTanks", () => {
    const facts: PermitFacts = {
      ...emptyPermitFacts(),
      tanks: [
        { capacityGal: f(1000, 0.9), material: null, model: null, dimensions: null },
        { capacityGal: null, material: f("plastic" as const, 0.7, 2), model: null, dimensions: null },
      ],
    };
    const props = byPath(mapPermitFacts(facts, record));
    const p = props["septicTank.numberOfTanks"];
    expect(p.value).toBe("2");
    expect(p.provenance.confidence).toBe(0.9);
    expect(p.provenance.explanation).toContain("lists 2 tanks");
    // amendment A4: every tank gets its own septicTank.tanks.<i>.* proposals
    expect(props["septicTank.tanks.0.tankCapacity"].value).toBe("1000");
    expect(props["septicTank.tanks.0.capacityBasis"].value).toBe("permit_document");
    expect(props["septicTank.tanks.1.tankMaterial"].value).toBe("plastic");
    expect(props["septicTank.tanks.1.tankMaterial"].provenance.page).toBe(2);
    expect(props["septicTank.tanks.1.tankCapacity"]).toBeUndefined();
  });

  it("proposes tank dimensions as written", () => {
    const facts: PermitFacts = {
      ...emptyPermitFacts(),
      tanks: [{ capacityGal: null, material: null, model: null, dimensions: f("5' x 8' x 5'", 0.8) }],
    };
    const props = byPath(mapPermitFacts(facts, record));
    expect(props["septicTank.tanks.0.tankDimensions"].value).toBe("5' x 8' x 5'");
    expect(props["septicTank.numberOfTanks"].value).toBe("1");
  });
});

describe("dedupeProposals", () => {
  const permit = (fieldPath: string, value: string, confidence: number): ProposedField => ({
    fieldPath,
    value,
    kind: "fill",
    provenance: { source: "permit", confidence, explanation: "p" },
  });
  const listing = (fieldPath: string, value: string, confidence: number): ProposedField => ({
    fieldPath,
    value,
    kind: "fill",
    provenance: { source: "listing", confidence, explanation: "l" },
  });

  it("lets permit beat listing for the same field regardless of confidence", () => {
    const out = dedupeProposals([listing("designFlow.numberOfBedrooms", "4", 0.95), permit("designFlow.numberOfBedrooms", "3", 0.7)]);
    expect(out).toHaveLength(1);
    expect(out[0].value).toBe("3");
  });

  it("keeps the higher confidence within one source and preserves first-seen order", () => {
    const out = dedupeProposals([
      permit("septicTank.tanks.0.tankCapacity", "1000", 0.6),
      permit("facilityInfo.waterSource", "private_well", 0.9),
      permit("septicTank.tanks.0.tankCapacity", "1250", 0.97),
    ]);
    expect(out.map((p) => [p.fieldPath, p.value])).toEqual([
      ["septicTank.tanks.0.tankCapacity", "1250"],
      ["facilityInfo.waterSource", "private_well"],
    ]);
  });

  it("keeps a warning and a fill for the same field apart", () => {
    const warning: ProposedField = {
      fieldPath: "facilityInfo.wastewaterSource",
      value: "",
      kind: "warning",
      provenance: { source: "listing", confidence: 0.8, explanation: 'Listing says "Sewer"' },
    };
    const out = dedupeProposals([warning, permit("facilityInfo.wastewaterSource", "residential", 0.9)]);
    expect(out).toHaveLength(2);
  });
});
