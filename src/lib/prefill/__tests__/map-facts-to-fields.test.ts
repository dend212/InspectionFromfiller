import { describe, expect, it } from "vitest";
import { emptyPermitFacts, type PermitFacts } from "@/lib/ai/permit-extraction-schema";
import {
  NON_SEPTIC_TANK,
  SYSTEM_TYPE_MAX_CONFIDENCE,
  dedupeProposals,
  mapPermitFacts,
  permitDocDate,
  permitDocRank,
} from "@/lib/prefill/map-facts-to-fields";
import type { ProposalAuthority, ProposedField } from "@/lib/prefill/types";

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
    ["generalTreatment.systemTypes", ["gp402_conventional", "gp402_septic_tank", "gp402_seepage_pit"], 0.9],
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

  it("checks the GP 4.02 boxes from the permit's components with the disposal fact as provenance", () => {
    const p = props["generalTreatment.systemTypes"];
    expect(p.value).toEqual(["gp402_conventional", "gp402_septic_tank", "gp402_seepage_pit"]);
    // min(systemType 0.9, tank capacity 0.97, disposal 0.97) — a read fact, not capped at 0.7
    expect(p.provenance.confidence).toBe(0.9);
    expect(p.provenance.explanation).toBe(
      "Permit OW-17-00474 · GP 4.02 Conventional, Septic Tank, Disposal by Seepage Pit p.1",
    );
    expect(p.provenance.evidence).toBe("4.02 Seepage Pit Qty 2");
    expect(p.provenance.page).toBe(1);
    expect(p.provenance.sourceUrl).toBe("/api/inspections/insp-1/records/rec-1#page=1");
    // a Discharge Authorization is class 0 and is dated by its own issue date
    expect(p.authority).toEqual({ docRank: 0, docDate: "2017-05-12" });
    expect(props["generalTreatment.alternativeSystem"]).toBeUndefined();
    expect(props["includeAlternativePages"]).toBeUndefined();
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
    // a transfer record is captioned as such, never as "Permit … on file"
    const not = byPath(mapPermitFacts({ ...emptyPermitFacts(), documentKind: "notice_of_transfer" }, record));
    expect(not["facilityInfo.recordsAvailable"].provenance.explanation).toBe("Notice of Transfer OW-17-00474 on file");
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

describe("mapPermitFacts — GP 4.02 system-type boxes", () => {
  const tank = (confidence = 0.9, page = 1) => ({
    capacityGal: f(1250, confidence, page, "Septic Tank Capacity 1250"),
    material: null,
    model: null,
    dimensions: null,
  });
  const disposal = (type: "trench" | "bed" | "chamber" | "seepage_pit" | "other", confidence = 0.9, page = 1) => ({
    type: f(type, confidence, page, `4.02 ${type}`),
    count: null,
    dimensions: null,
    absorptionAreaSqft: null,
  });
  const systemTypes = (facts: PermitFacts) => byPath(mapPermitFacts(facts, record))["generalTreatment.systemTypes"];

  it.each([
    ["trench", "gp402_disposal_trench"],
    ["bed", "gp402_disposal_bed"],
    ["chamber", "gp402_chamber"],
    ["seepage_pit", "gp402_seepage_pit"],
  ] as const)("maps disposal %s → %s after the tank box", (type, token) => {
    const p = systemTypes({ ...emptyPermitFacts(), tanks: [tank()], disposal: disposal(type) });
    expect(p.value).toEqual(["gp402_septic_tank", token]);
  });

  it("ignores disposal type other and still checks the tank (plus conventional when stated)", () => {
    expect(systemTypes({ ...emptyPermitFacts(), tanks: [tank()], disposal: disposal("other") }).value).toEqual([
      "gp402_septic_tank",
    ]);
    expect(
      systemTypes({
        ...emptyPermitFacts(),
        tanks: [tank()],
        disposal: disposal("other"),
        systemType: f("conventional" as const, 0.8),
      }).value,
    ).toEqual(["gp402_conventional", "gp402_septic_tank"]);
  });

  it("proposes nothing without a tank, a disposal type or a system type", () => {
    expect(systemTypes({ ...emptyPermitFacts(), documentKind: "discharge_authorization" })).toBeUndefined();
    // a tank without a capacity fact is not a GP 4.02 septic-tank box
    expect(
      systemTypes({
        ...emptyPermitFacts(),
        tanks: [{ capacityGal: null, material: f("plastic" as const, 0.9), model: null, dimensions: null }],
      }),
    ).toBeUndefined();
    expect(byPath(mapPermitFacts(emptyPermitFacts(), record))["generalTreatment.alternativeSystem"]).toBeUndefined();
  });

  it("names no conventional box for an alternative system but flips the alternative toggle", () => {
    const facts: PermitFacts = {
      ...emptyPermitFacts(),
      documentKind: "discharge_authorization",
      tanks: [tank(0.95)],
      disposal: disposal("trench", 0.9),
      systemType: f("alternative" as const, 0.85, 2, "Aerobic Treatment Unit"),
    };
    const props = byPath(mapPermitFacts(facts, record));
    expect(props["generalTreatment.systemTypes"].value).toEqual(["gp402_septic_tank", "gp402_disposal_trench"]);
    expect(props["generalTreatment.systemTypes"].provenance.confidence).toBe(0.9);
    // Both toggles change which report pages exist, so like facilitySystemTypes they are
    // capped at SYSTEM_TYPE_MAX_CONFIDENCE — chips, never fills (audit batch 0 §3, decision 2)
    for (const path of ["generalTreatment.alternativeSystem", "includeAlternativePages"]) {
      const p = props[path];
      expect(p, path).toBeDefined();
      expect(p.kind).toBe("fill");
      expect(p.value).toBe(true);
      expect(p.provenance.confidence).toBe(SYSTEM_TYPE_MAX_CONFIDENCE);
      expect(p.provenance.page).toBe(2);
      expect(p.provenance.evidence).toBe("Aerobic Treatment Unit");
      expect(p.provenance.explanation).toBe("Permit OW-17-00474 · Discharge Authorization p.2");
      // no issueDate read → an undated DA (never the EDMS docDate)
      expect(p.authority).toEqual({ docRank: 0 });
    }
    // the Summary "System Type" suggestion is untouched
    expect(props["facilityInfo.facilitySystemTypes"].value).toEqual(["alternative"]);
  });

  it("keeps a less-sure alternative verdict's own confidence on both toggles", () => {
    const props = byPath(
      mapPermitFacts({ ...emptyPermitFacts(), systemType: f("alternative" as const, 0.55, 3) }, record),
    );
    expect(props["generalTreatment.alternativeSystem"].provenance.confidence).toBe(0.55);
    expect(props["includeAlternativePages"].provenance.confidence).toBe(0.55);
    expect(props["generalTreatment.systemTypes"]).toBeUndefined();
  });

  it("proposes neither toggle for a conventional system", () => {
    const props = byPath(mapPermitFacts(daFacts(), record, { now: NOW }));
    expect(props["generalTreatment.alternativeSystem"]).toBeUndefined();
    expect(props["includeAlternativePages"]).toBeUndefined();
  });

  it("takes the minimum confidence and falls back to the tank fact for provenance without a disposal", () => {
    const facts: PermitFacts = {
      ...emptyPermitFacts(),
      tanks: [tank(0.6, 4), tank(0.95, 5)],
      systemType: f("conventional" as const, 0.7, 1, "4.02 Conventional"),
    };
    const p = systemTypes(facts);
    expect(p.value).toEqual(["gp402_conventional", "gp402_septic_tank"]);
    // min(systemType 0.7, best tank capacity 0.95) — the weaker second tank is not a contributor
    expect(p.provenance.confidence).toBe(0.7);
    // the best tank capacity fact carries the page / evidence
    expect(p.provenance.page).toBe(5);
    expect(p.provenance.explanation).toBe("Permit OW-17-00474 · GP 4.02 Conventional, Septic Tank p.5");
    // systemType alone → its own page
    const only = systemTypes({ ...emptyPermitFacts(), systemType: f("conventional" as const, 0.8, 3) });
    expect(only.value).toEqual(["gp402_conventional"]);
    expect(only.provenance.page).toBe(3);
    expect(only.provenance.confidence).toBe(0.8);
  });
});

describe("mapPermitFacts — tanks that are not septic tanks (audit batch 0 §3b / A17)", () => {
  const tankOf = (capacity: number, model: string | null, confidence = 0.9, page = 1) => ({
    capacityGal: f(capacity, confidence, page, `${capacity} gal`),
    material: null,
    model: model ? f(model, confidence, page, model) : null,
    dimensions: null,
  });
  const pit = {
    type: f("seepage_pit" as const, 0.97, 1, "4.02 Seepage Pit"),
    count: null,
    dimensions: null,
    absorptionAreaSqft: null,
  };

  it("an ATU row does not tick the septic-tank box and is not counted as a septic tank", () => {
    // OW-24-00070 DA: a 1500-gal "BIOMICROBICS MICROFAST 0.9" (GP 4.15) beside a 1000-gal septic tank
    const facts: PermitFacts = {
      ...emptyPermitFacts(),
      documentKind: "discharge_authorization",
      tanks: [tankOf(1500, "BIOMICROBICS MICROFAST 0.9", 0.97, 1), tankOf(1000, null, 0.9, 1)],
      disposal: pit,
    };
    const props = byPath(mapPermitFacts(facts, record));
    expect(props["generalTreatment.systemTypes"].value).toEqual(["gp402_septic_tank", "gp402_seepage_pit"]);
    // the box's confidence/evidence come from the septic tank, not the ATU
    expect(props["generalTreatment.systemTypes"].provenance.confidence).toBe(0.9);
    const n = props["septicTank.numberOfTanks"];
    expect(n.value).toBe("1");
    expect(n.provenance.confidence).toBeLessThanOrEqual(0.7);
    expect(n.provenance.explanation).toBe("Permit OW-17-00474 · Discharge Authorization lists 1 tank (p.1)");
    // review round 1: the per-tank slots follow the count — the septic tank is tanks.0, the ATU
    // gets no septicTank.tanks.* slot (otherwise accepting "1" would slice(0,1) and keep the ATU)
    expect(props["septicTank.tanks.0.tankCapacity"].value).toBe("1000");
    expect(props["septicTank.tanks.0.capacityBasis"].value).toBe("permit_document");
    expect(Object.keys(props).filter((k) => k.startsWith("septicTank.tanks.1."))).toEqual([]);
  });

  it.each([
    ["dosing tank"],
    ["Pump Tank"],
    ["lift station"],
    ["sump"],
    ["Aerobic Treatment Unit"],
    ["ATU"],
    ["Infiltrator IM1530 treatment"],
  ])("a lone %j contributes no septic-tank box and no tank count", (model) => {
    const facts: PermitFacts = { ...emptyPermitFacts(), tanks: [tankOf(500, model)] };
    const props = byPath(mapPermitFacts(facts, record));
    expect(props["generalTreatment.systemTypes"]).toBeUndefined();
    expect(props["septicTank.numberOfTanks"]).toBeUndefined();
    // the form's septicTank.tanks[] holds septic tanks only — a dosing tank gets no slot
    expect(Object.keys(props).filter((k) => k.startsWith("septicTank.tanks."))).toEqual([]);
  });

  it.each([["Saturn 1000"], ["Uplift"], ["Septic Tank"], ["Infiltrator IM-1060"]])(
    "%j is a septic tank — whole-word matching, so 'sATUrn' and 'upLIFT' do not trip the exclusion",
    (model) => {
      expect(NON_SEPTIC_TANK.test(model)).toBe(false);
      const facts: PermitFacts = { ...emptyPermitFacts(), tanks: [tankOf(1000, model)] };
      const props = byPath(mapPermitFacts(facts, record));
      expect(props["generalTreatment.systemTypes"].value).toEqual(["gp402_septic_tank"]);
      expect(props["septicTank.numberOfTanks"].value).toBe("1");
      expect(props["septicTank.tanks.0.tankCapacity"].value).toBe("1000");
    },
  );

  it.each([
    ["dosing tank"],
    ["PUMP TANK"],
    ["pump"],
    ["ATU"],
    ["MicroFAST 0.9"],
    ["aerobic treatment unit"],
    ["lift station"],
    ["sump"],
  ])("%j is excluded by NON_SEPTIC_TANK", (model) => {
    expect(NON_SEPTIC_TANK.test(model)).toBe(true);
  });

  it("a lone dosing tank beside a disposal field still ticks only the disposal box", () => {
    const facts: PermitFacts = { ...emptyPermitFacts(), tanks: [tankOf(500, "dosing tank")], disposal: pit };
    expect(byPath(mapPermitFacts(facts, record))["generalTreatment.systemTypes"].value).toEqual(["gp402_seepage_pit"]);
  });

  it("caps the tank count at 0.7 whenever a non-septic tank was listed, and not otherwise", () => {
    const withDosing: PermitFacts = {
      ...emptyPermitFacts(),
      tanks: [tankOf(1250, null, 0.97), tankOf(1000, null, 0.95), tankOf(500, "dosing tank", 0.99)],
    };
    const capped = byPath(mapPermitFacts(withDosing, record))["septicTank.numberOfTanks"];
    expect(capped.value).toBe("2");
    expect(capped.provenance.confidence).toBe(0.7);
    expect(capped.provenance.explanation).toContain("lists 2 tanks");
    const plain: PermitFacts = { ...emptyPermitFacts(), tanks: [tankOf(1250, null, 0.97), tankOf(1000, "Septic Tank", 0.95)] };
    const uncapped = byPath(mapPermitFacts(plain, record))["septicTank.numberOfTanks"];
    expect(uncapped.value).toBe("2");
    expect(uncapped.provenance.confidence).toBe(0.97);
  });

  it("re-indexes the per-tank proposals over the septic tanks so the slots match the count", () => {
    // dosing tank listed between two septic tanks: septic tanks take tanks.0 and tanks.1
    const facts: PermitFacts = {
      ...emptyPermitFacts(),
      tanks: [
        tankOf(1250, null, 0.97, 1),
        tankOf(500, "dosing tank", 0.99, 2),
        { capacityGal: f(1000, 0.95, 3, "1000 gal"), material: f("plastic" as const, 0.9, 3), model: null, dimensions: null },
      ],
    };
    const props = byPath(mapPermitFacts(facts, record));
    expect(props["septicTank.numberOfTanks"].value).toBe("2");
    expect(props["septicTank.tanks.0.tankCapacity"].value).toBe("1250");
    expect(props["septicTank.tanks.0.tankCapacity"].provenance.page).toBe(1);
    expect(props["septicTank.tanks.1.tankCapacity"].value).toBe("1000");
    expect(props["septicTank.tanks.1.tankMaterial"].value).toBe("plastic");
    expect(props["septicTank.tanks.1.tankMaterial"].provenance.page).toBe(3);
    // the dosing tank's 500 gal never lands in a septic-tank slot
    expect(Object.values(props).some((p) => /^septicTank\.tanks\./.test(p.fieldPath) && p.value === "500")).toBe(false);
    expect(Object.keys(props).filter((k) => k.startsWith("septicTank.tanks.2."))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Document authority — Dove Valley (1414 E Dove Valley Rd) fixture, verbatim from the fix plan
// ---------------------------------------------------------------------------

const PERMIT_REC = { id: "rec-permit", permitNumber: "071533", docType: "PERMIT", inspectionId: "insp-1" };
const NOT_REC = { id: "rec-not", permitNumber: "OWR-23-02001", docType: "NOTICE OF TRANSFER", inspectionId: "insp-1" };

const permitFacts: PermitFacts = {
  ...emptyPermitFacts(),
  documentKind: "other",
  issueDate: { value: "2007-04-12", confidence: 0.75, page: 1, evidence: "Date Issued 4/12/07", handwritten: true },
  tanks: [
    {
      capacityGal: { value: 1500, confidence: 0.72, page: 4, evidence: "1500 gal", handwritten: true },
      material: null,
      model: null,
      dimensions: null,
    },
  ],
};

const notFacts: PermitFacts = {
  ...emptyPermitFacts(),
  documentKind: "notice_of_transfer",
  issueDate: { value: "2023-06-07", confidence: 0.95, page: 5, evidence: "Date 6/7/2023", handwritten: false },
  finalDate: { value: "2023-04-27", confidence: 0.97, page: 1, evidence: "Inspection date 4/27/2023", handwritten: false },
  designFlowGpd: { value: 450, confidence: 0.97, page: 2, evidence: "Design flow 450 gpd", handwritten: false },
  systemType: { value: "conventional", confidence: 0.97, page: 2, evidence: "Conventional", handwritten: false },
};

describe("mapPermitFacts — document authority (Dove Valley)", () => {
  it("never derives the system age from a Notice of Transfer and captions its facts as secondary", () => {
    const all = mapPermitFacts(notFacts, NOT_REC, { now: NOW });
    const props = byPath(all);
    expect(props["facilityInfo.facilityAge"]).toBeUndefined();
    expect(props["facilityInfo.facilityAgeEstimateExplanation"]).toBeUndefined();
    expect(props["designFlow.estimatedDesignFlow"].value).toBe("450");
    expect(props["designFlow.estimatedDesignFlow"].provenance.explanation).toBe(
      "Notice of Transfer OWR-23-02001 · p.2 (transfer record — secondary source)",
    );
    expect(props["facilityInfo.recordsAvailable"].provenance.explanation).toBe("Notice of Transfer OWR-23-02001 on file");
    expect(all.length).toBeGreaterThan(0);
    // NOT_REC carries no EDMS docDate, so a transfer record's authority is undated (never its issueDate)
    for (const p of all) expect(p.authority, p.fieldPath).toEqual({ docRank: 3 });
  });

  it("treats a document the model could not classify as a transfer record when EDMS filed it as one", () => {
    const all = mapPermitFacts({ ...notFacts, documentKind: "other" }, NOT_REC, { now: NOW });
    const props = byPath(all);
    expect(props["facilityInfo.facilityAge"]).toBeUndefined();
    expect(props["facilityInfo.facilityAgeEstimateExplanation"]).toBeUndefined();
    expect(props["designFlow.estimatedDesignFlow"].value).toBe("450");
    for (const p of all) expect(p.authority?.docRank, p.fieldPath).toBe(3);
  });

  it("captions a NOT's tank count, disposal type and site-plan notes as a transfer record, never as a permit", () => {
    const notWithSystem: PermitFacts = {
      ...notFacts,
      tanks: [
        {
          capacityGal: { value: 1250, confidence: 0.9, page: 3, evidence: "1250 gal tank", handwritten: false },
          material: null,
          model: null,
          dimensions: null,
        },
      ],
      disposal: {
        type: { value: "seepage_pit", confidence: 0.88, page: 3, evidence: "Seepage pit", handwritten: false },
        count: { value: 2, confidence: 0.88, page: 3, evidence: "Qty 2", handwritten: false },
        dimensions: null,
        absorptionAreaSqft: null,
      },
      notes: "Site plan attached to the transfer packet",
    };
    const all = mapPermitFacts(notWithSystem, NOT_REC, { now: NOW });
    const props = byPath(all);
    for (const p of all) expect(p.provenance.explanation, p.fieldPath).not.toMatch(/^Permit /);
    expect(props["facilityInfo.hasSitePlan"].provenance.explanation).toBe(
      "Notice of Transfer OWR-23-02001 · notes mention a site plan (transfer record — secondary source)",
    );
    expect(props["septicTank.numberOfTanks"].provenance.explanation).toBe(
      "Notice of Transfer OWR-23-02001 · lists 1 tank (p.3) (transfer record — secondary source)",
    );
    expect(props["disposalWorks.disposalType"].provenance.explanation).toBe(
      "Notice of Transfer OWR-23-02001 · p.3 · × 2 (transfer record — secondary source)",
    );
    expect(props["generalTreatment.systemTypes"].value).toEqual([
      "gp402_conventional",
      "gp402_septic_tank",
      "gp402_seepage_pit",
    ]);
    expect(props["generalTreatment.systemTypes"].provenance.confidence).toBe(0.88);
    expect(props["generalTreatment.systemTypes"].provenance.explanation).toBe(
      "Notice of Transfer OWR-23-02001 · GP 4.02 Conventional, Septic Tank, Disposal by Seepage Pit p.3 (transfer record — secondary source)",
    );
    for (const p of all) expect(p.authority?.docRank, p.fieldPath).toBe(3);
  });

  it("derives the age from a PERMIT-class record the model classed `other` and ranks it as an ATC dated by its issue date", () => {
    const all = mapPermitFacts(permitFacts, PERMIT_REC, { now: NOW });
    const props = byPath(all);
    expect(props["facilityInfo.facilityAge"].value).toBe("19");
    expect(props["facilityInfo.facilityAgeEstimateExplanation"].value).toBe("Permit issued 04/2007 (permit 071533)");
    expect(props["facilityInfo.facilityAge"].provenance.explanation).toBe("Permit issued 04/2007 (permit 071533)");
    expect(props["septicTank.tanks.0.tankCapacity"].provenance.explanation).toBe("Permit 071533 · PERMIT p.4");
    // tank only, no disposal / systemType → one box, at the tank's (sub-gate) confidence
    expect(props["generalTreatment.systemTypes"].value).toEqual(["gp402_septic_tank"]);
    expect(props["generalTreatment.systemTypes"].provenance.confidence).toBe(0.72);
    expect(props["generalTreatment.systemTypes"].provenance.explanation).toBe("Permit 071533 · GP 4.02 Septic Tank p.4");
    for (const p of all) expect(p.authority, p.fieldPath).toEqual({ docRank: 1, docDate: "2007-04-12" });
  });

  it("trusts the model over the EDMS index for a permit mis-filed as NOTICE OF TRANSFER", () => {
    const all = mapPermitFacts({ ...permitFacts, documentKind: "approval_to_construct" }, NOT_REC, { now: NOW });
    const props = byPath(all);
    expect(props["facilityInfo.facilityAge"].value).toBe("19");
    expect(props["facilityInfo.facilityAgeEstimateExplanation"].value).toBe(
      "Approval to construct issued 04/2007 (permit OWR-23-02001)",
    );
    for (const p of all) expect(p.authority?.docRank, p.fieldPath).toBe(1);
  });

  it("D7 replay order: the permit's age wins over the NOT and the NOT still supplies the design flow", () => {
    const out = dedupeProposals([
      ...mapPermitFacts(notFacts, NOT_REC, { now: NOW }),
      ...mapPermitFacts(permitFacts, PERMIT_REC, { now: NOW }),
    ]);
    const ages = out.filter((p) => p.fieldPath === "facilityInfo.facilityAge");
    expect(ages).toHaveLength(1);
    expect(ages[0].value).toBe("19");
    expect(ages[0].provenance.recordId).toBe("rec-permit");
    const flow = byPath(out)["designFlow.estimatedDesignFlow"];
    expect(flow.value).toBe("450");
    expect(flow.provenance.recordId).toBe("rec-not");
    // the permit's tank-only array beats the NOT's conventional-only array (whole value, no union)
    const boxes = out.filter((p) => p.fieldPath === "generalTreatment.systemTypes");
    expect(boxes).toHaveLength(1);
    expect(boxes[0].value).toEqual(["gp402_septic_tank"]);
    expect(boxes[0].provenance.recordId).toBe("rec-permit");
  });

  it("head-to-head: a less confident permit fact beats a more confident NOT fact", () => {
    const permitWithFlow: PermitFacts = {
      ...permitFacts,
      designFlowGpd: { value: 400, confidence: 0.7, page: 2, evidence: "400 gpd", handwritten: true },
    };
    const out = dedupeProposals([
      ...mapPermitFacts(notFacts, NOT_REC, { now: NOW }),
      ...mapPermitFacts(permitWithFlow, PERMIT_REC, { now: NOW }),
    ]);
    const flow = byPath(out)["designFlow.estimatedDesignFlow"];
    expect(flow.value).toBe("400");
    expect(flow.provenance.recordId).toBe("rec-permit");
    const boxes = byPath(out)["generalTreatment.systemTypes"];
    expect(boxes.provenance.confidence).toBe(0.72);
    expect(boxes.provenance.recordId).toBe("rec-permit");
  });
});

// ---------------------------------------------------------------------------
// Document precedence — 11420 N SAINT ANDREWS WAY: a 1975 Approval to Construct (740805,
// scanned into EDMS 2015-09-11) beside the 2016 Discharge Authorization (OW-15-00667).
// Owner's rule: newest DA on top, then the ATC, then transfers and abandonments.
// ---------------------------------------------------------------------------

const SA_NOW = new Date("2026-09-14T12:00:00Z");
const ATC_REC = { id: "rec-atc", permitNumber: "740805", docType: "PERMIT", docDate: "2015-09-11", inspectionId: "insp-1" };
const DA_REC = { id: "rec-da", permitNumber: "OW-15-00667", docType: "PERMIT", docDate: "2016-07-11", inspectionId: "insp-1" };

const atcFacts: PermitFacts = {
  ...emptyPermitFacts(),
  documentKind: "approval_to_construct",
  issueDate: f("1975-08-14", 0.99, 1, "APPROVED 8/14/75"),
  bedrooms: f(3, 0.99, 1, "3 bedrooms"),
  tanks: [{ capacityGal: f(1500, 0.99, 1, "1500 gal"), material: null, model: null, dimensions: null }],
  disposal: { ...emptyPermitFacts().disposal, type: f("seepage_pit" as const, 0.95, 1, "seepage pit") },
  hasSitePlan: f(true, 0.95, 2, "PLOT PLAN"),
};

const saDaFacts: PermitFacts = {
  ...emptyPermitFacts(),
  documentKind: "discharge_authorization",
  issueDate: f("2016-01-25", 0.9, 1, "Issued 01/25/2016"),
  bedrooms: f(5, 0.9, 1, "Bedrooms: 5"),
  designFlowGpd: f(750, 0.9, 1, "Design Flow 750 gpd"),
  tanks: [{ capacityGal: f(1500, 0.9, 1, "Septic Tank 1500"), material: null, model: null, dimensions: null }],
  waterSource: f("municipal" as const, 0.95, 1, "Water Source: Water Company"),
};

describe("permitDocRank (re-exported from permits/doc-types)", () => {
  it("is the same function the mapper uses", () => {
    expect(permitDocRank("discharge_authorization", "PERMIT")).toBe(0);
    expect(permitDocRank("approval_to_construct", "PERMIT")).toBe(1);
    expect(permitDocRank("notice_of_transfer", "PERMIT")).toBe(3);
  });
});

describe("permitDocDate", () => {
  it("dates a permit-class record by the issue date the model read", () => {
    expect(permitDocDate(saDaFacts, DA_REC, false)).toBe("2016-01-25");
    expect(permitDocDate(atcFacts, ATC_REC, false)).toBe("1975-08-14");
  });

  it("leaves a permit-class record undated when no issue date was read — never the EDMS docDate", () => {
    // the 1975 ATC carries docDate 2015-09-11 (its scan/filing date): a docDate fallback would make it "newer" than a 2007 permit
    expect(permitDocDate({ ...atcFacts, issueDate: null }, ATC_REC, false)).toBeUndefined();
    expect(permitDocDate({ ...saDaFacts, issueDate: null }, DA_REC, false)).toBeUndefined();
    expect(permitDocDate({ ...emptyPermitFacts(), documentKind: "other" }, ATC_REC, false)).toBeUndefined();
  });

  it("ignores an issue date that is not ISO yyyy-mm-dd", () => {
    expect(permitDocDate({ ...saDaFacts, issueDate: f("05/2017", 0.9) }, DA_REC, false)).toBeUndefined();
    expect(permitDocDate({ ...saDaFacts, issueDate: f("March 2017", 0.9) }, DA_REC, false)).toBeUndefined();
  });

  it("dates a transfer record by its EDMS docDate, never by the dates the model read", () => {
    const rec = { ...NOT_REC, docDate: "2023-04-27" };
    expect(permitDocDate(notFacts, rec, true)).toBe("2023-04-27");
    expect(permitDocDate({ ...notFacts, documentKind: "other" }, rec, true)).toBe("2023-04-27");
    expect(permitDocDate(notFacts, NOT_REC, true)).toBeUndefined();
    expect(permitDocDate(notFacts, { ...NOT_REC, docDate: null }, true)).toBeUndefined();
  });

  it("dates an abandonment by its EDMS docDate", () => {
    const abandonment: PermitFacts = { ...emptyPermitFacts(), documentKind: "abandonment", isAbandonment: true, issueDate: f("2015-06-01", 0.9) };
    const rec = { id: "rec-ab", permitNumber: "OWR-15-00520", docType: "ABANDONMENT", docDate: "2015-09-11", inspectionId: "insp-1" };
    expect(permitDocDate(abandonment, rec, false)).toBe("2015-09-11");
    // EDMS filed it as an abandonment but the model could not tell
    expect(permitDocDate({ ...abandonment, documentKind: "other" }, rec, false)).toBe("2015-09-11");
  });

  it("normalises a timestamp-shaped docDate to its date part", () => {
    const rec = { ...NOT_REC, docDate: "2015-09-11T00:00:00.000Z" };
    expect(permitDocDate(notFacts, rec, true)).toBe("2015-09-11");
    expect(permitDocDate(notFacts, { ...NOT_REC, docDate: "9/11/2015" }, true)).toBeUndefined();
  });
});

describe("mapPermitFacts / dedupeProposals — document precedence (Saint Andrews)", () => {
  const atc = () => mapPermitFacts(atcFacts, ATC_REC, { now: SA_NOW });
  const da = () => mapPermitFacts(saDaFacts, DA_REC, { now: SA_NOW });

  it("stamps each record's proposals with its class and date", () => {
    for (const p of atc()) expect(p.authority, p.fieldPath).toEqual({ docRank: 1, docDate: "1975-08-14" });
    for (const p of da()) expect(p.authority, p.fieldPath).toEqual({ docRank: 0, docDate: "2016-01-25" });
  });

  it.each([
    ["ATC first", () => [...atc(), ...da()]],
    ["DA first", () => [...da(), ...atc()]],
  ])("the Discharge Authorization wins every shared field, %s", (_label, proposals) => {
    const props = byPath(dedupeProposals(proposals()));
    expect(props["designFlow.numberOfBedrooms"].value).toBe("5");
    expect(props["designFlow.numberOfBedrooms"].provenance.recordId).toBe("rec-da");
    expect(props["facilityInfo.facilityAge"].value).toBe("10");
    expect(props["facilityInfo.facilityAge"].provenance.recordId).toBe("rec-da");
    expect(props["facilityInfo.facilityAgeEstimateExplanation"].value).toBe(
      "Discharge authorization issued 01/2016 (permit OW-15-00667)",
    );
    expect(props["facilityInfo.waterSource"].value).toBe("municipal");
    expect(props["facilityInfo.waterSource"].provenance.recordId).toBe("rec-da");
    expect(props["septicTank.tanks.0.tankCapacity"].value).toBe("1500");
    expect(props["septicTank.tanks.0.tankCapacity"].provenance.recordId).toBe("rec-da");
    // the ATC still supplies what the DA does not
    expect(props["facilityInfo.hasApprovalOfConstruction"].value).toBe(true);
    expect(props["facilityInfo.hasApprovalOfConstruction"].provenance.recordId).toBe("rec-atc");
    expect(props["facilityInfo.approvalPermitNo"].value).toBe("740805");
    expect(props["facilityInfo.hasSitePlan"].value).toBe(true);
    expect(props["facilityInfo.hasSitePlan"].provenance.recordId).toBe("rec-atc");
    expect(props["disposalWorks.disposalType"].provenance.recordId).toBe("rec-atc");
    expect(props["facilityInfo.hasDischargeAuth"].provenance.recordId).toBe("rec-da");
    expect(props["designFlow.estimatedDesignFlow"].value).toBe("750");
  });
});

describe("dedupeProposals — newest document wins within a class", () => {
  const withAuthority = (value: string, confidence: number, authority: ProposalAuthority): ProposedField => ({
    fieldPath: "designFlow.numberOfBedrooms",
    value,
    kind: "fill",
    provenance: { source: "permit", confidence, explanation: value },
    authority,
  });
  const winner = (proposals: ProposedField[]) => dedupeProposals(proposals).map((p) => p.value);

  it("a newer Discharge Authorization beats an older, more confident one in either order", () => {
    const older = withAuthority("old", 0.99, { docRank: 0, docDate: "2010-03-01" });
    const newer = withAuthority("new", 0.8, { docRank: 0, docDate: "2024-05-20" });
    expect(winner([older, newer])).toEqual(["new"]);
    expect(winner([newer, older])).toEqual(["new"]);
  });

  it("a dated document beats an undated one of the same class in either order", () => {
    const dated = withAuthority("dated", 0.7, { docRank: 0, docDate: "2010-03-01" });
    const undated = withAuthority("undated", 0.99, { docRank: 0 });
    expect(winner([dated, undated])).toEqual(["dated"]);
    expect(winner([undated, dated])).toEqual(["dated"]);
  });

  it("two undated documents of one class fall back to confidence, then first-seen", () => {
    expect(winner([withAuthority("a", 0.8, { docRank: 1 }), withAuthority("b", 0.9, { docRank: 1 })])).toEqual(["b"]);
    expect(winner([withAuthority("a", 0.9, { docRank: 1 }), withAuthority("b", 0.9, { docRank: 1 })])).toEqual(["a"]);
    // same date too → confidence, then first-seen
    expect(
      winner([withAuthority("a", 0.8, { docRank: 0, docDate: "2016-01-25" }), withAuthority("b", 0.9, { docRank: 0, docDate: "2016-01-25" })]),
    ).toEqual(["b"]);
    expect(
      winner([withAuthority("a", 0.9, { docRank: 0, docDate: "2016-01-25" }), withAuthority("b", 0.9, { docRank: 0, docDate: "2016-01-25" })]),
    ).toEqual(["a"]);
  });

  it("two Notices of Transfer are ordered by their EDMS docDate", () => {
    const older = withAuthority("old-not", 0.97, { docRank: 3, docDate: "2019-02-14" });
    const newer = withAuthority("new-not", 0.8, { docRank: 3, docDate: "2023-04-27" });
    expect(winner([older, newer])).toEqual(["new-not"]);
    expect(winner([newer, older])).toEqual(["new-not"]);
  });

  it("class comes before date: a newer NOT never beats an older ATC, a newer ATC never beats an older DA", () => {
    const atc2007 = withAuthority("atc-2007", 0.7, { docRank: 1, docDate: "2007-04-12" });
    const not2024 = withAuthority("not-2024", 0.99, { docRank: 3, docDate: "2024-01-01" });
    expect(winner([atc2007, not2024])).toEqual(["atc-2007"]);
    expect(winner([not2024, atc2007])).toEqual(["atc-2007"]);
    const da2010 = withAuthority("da-2010", 0.7, { docRank: 0, docDate: "2010-03-01" });
    const atc2024 = withAuthority("atc-2024", 0.99, { docRank: 1, docDate: "2024-01-01" });
    expect(winner([da2010, atc2024])).toEqual(["da-2010"]);
    expect(winner([atc2024, da2010])).toEqual(["da-2010"]);
  });

  it("never displaces the phase-2 index row (no authority) by date", () => {
    const phase2: ProposedField = {
      fieldPath: "facilityInfo.recordsAvailable",
      value: "yes",
      kind: "fill",
      provenance: {
        source: "permit",
        confidence: 1,
        explanation: "Permit OW-15-00667 (PERMIT) found on Maricopa EDMS",
        sourceUrl: "/api/inspections/insp-1/records/rec-da",
        recordId: "rec-da",
      },
    };
    const fromDa = mapPermitFacts(saDaFacts, DA_REC, { now: SA_NOW }).find(
      (p) => p.fieldPath === "facilityInfo.recordsAvailable",
    ) as ProposedField;
    expect(fromDa.authority).toEqual({ docRank: 0, docDate: "2016-01-25" });
    // phase 2's proposals always come first in withExtraction
    const first = dedupeProposals([phase2, fromDa]);
    expect(first).toHaveLength(1);
    expect(first[0]).toBe(phase2);
    const fromNot = mapPermitFacts(notFacts, { ...NOT_REC, docDate: "2023-04-27" }, { now: SA_NOW }).find(
      (p) => p.fieldPath === "facilityInfo.recordsAvailable",
    ) as ProposedField;
    expect(fromNot.authority).toEqual({ docRank: 3, docDate: "2023-04-27" });
    const second = dedupeProposals([fromNot, phase2]);
    expect(second).toHaveLength(1);
    expect(second[0]).toBe(phase2);
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

  describe("per-field source order (audit batch 0 §2.2) — property use is assessor > listing > permit", () => {
    const assessor = (fieldPath: string, value: string, confidence: number): ProposedField => ({
      fieldPath,
      value,
      kind: "fill",
      provenance: { source: "assessor", confidence, explanation: "a" },
    });
    const rankedPermit = (fieldPath: string, value: string, confidence: number): ProposedField => ({
      ...permit(fieldPath, value, confidence),
      authority: { docRank: 0 },
    });

    it("lets a confident assessor PUC beat a permit-class inference for wastewaterSource", () => {
      const puc = assessor("facilityInfo.wastewaterSource", "residential", 0.95);
      const inferred = rankedPermit("facilityInfo.wastewaterSource", "commercial", 0.7);
      expect(dedupeProposals([inferred, puc])).toEqual([puc]);
      expect(dedupeProposals([puc, inferred])).toEqual([puc]);
    });

    it("lets the listing homeType beat a more confident permit for facilityType", () => {
      const home = listing("facilityInfo.facilityType", "single_family", 0.85);
      const fromPermit = rankedPermit("facilityInfo.facilityType", "commercial", 0.9);
      expect(dedupeProposals([fromPermit, home])).toEqual([home]);
      expect(dedupeProposals([home, fromPermit])).toEqual([home]);
    });

    it("leaves every other field on the default order — permit still beats the assessor for facilityAge", () => {
      const fromPermit = rankedPermit("facilityInfo.facilityAge", "26", 0.8);
      const fromAssessor = assessor("facilityInfo.facilityAge", "28", 0.95);
      expect(dedupeProposals([fromAssessor, fromPermit])).toEqual([fromPermit]);
      expect(dedupeProposals([fromPermit, fromAssessor])).toEqual([fromPermit]);
    });
  });

  describe("document authority", () => {
    const ranked = (fieldPath: string, value: string, confidence: number, docRank: number): ProposedField => ({
      ...permit(fieldPath, value, confidence),
      authority: { docRank },
    });

    it("within one document class, strictly higher confidence wins and equal confidence keeps the first", () => {
      const higher = dedupeProposals([ranked("f", "a", 0.8, 0), ranked("f", "b", 0.9, 0)]);
      expect(higher.map((p) => p.value)).toEqual(["b"]);
      const equal = dedupeProposals([ranked("f", "a", 0.9, 0), ranked("f", "b", 0.9, 0)]);
      expect(equal.map((p) => p.value)).toEqual(["a"]);
      const equalNot = dedupeProposals([ranked("f", "a", 0.9, 3), ranked("f", "b", 0.9, 3)]);
      expect(equalNot.map((p) => p.value)).toEqual(["a"]);
    });

    it("keeps the phase-2 recordsAvailable (no authority) against both a permit and a NOT mapper proposal", () => {
      const phase2: ProposedField = {
        fieldPath: "facilityInfo.recordsAvailable",
        value: "yes",
        kind: "fill",
        provenance: {
          source: "permit",
          confidence: 1,
          explanation: "Permit 071533 (PERMIT) found on Maricopa EDMS",
          sourceUrl: "/api/inspections/insp-1/records/rec-permit",
          recordId: "rec-permit",
        },
      };
      const fromPermit = mapPermitFacts(permitFacts, PERMIT_REC, { now: NOW }).find(
        (p) => p.fieldPath === "facilityInfo.recordsAvailable",
      ) as ProposedField;
      const fromNot = mapPermitFacts(notFacts, NOT_REC, { now: NOW }).find(
        (p) => p.fieldPath === "facilityInfo.recordsAvailable",
      ) as ProposedField;
      expect(fromPermit.authority).toEqual({ docRank: 1, docDate: "2007-04-12" });
      expect(fromNot.authority).toEqual({ docRank: 3 });

      const first = dedupeProposals([phase2, fromPermit]);
      expect(first).toHaveLength(1);
      expect(first[0]).toBe(phase2);

      const second = dedupeProposals([fromNot, phase2]);
      expect(second).toHaveLength(1);
      expect(second[0]).toBe(phase2);
    });

    it("never lets a listing beat a Notice of Transfer for the same field", () => {
      const fromNot = ranked("designFlow.numberOfBedrooms", "3", 0.6, 3);
      const out = dedupeProposals([listing("designFlow.numberOfBedrooms", "4", 0.95), fromNot]);
      expect(out).toHaveLength(1);
      expect(out[0]).toBe(fromNot);
      const reversed = dedupeProposals([fromNot, listing("designFlow.numberOfBedrooms", "4", 0.95)]);
      expect(reversed[0]).toBe(fromNot);
    });
  });
});
