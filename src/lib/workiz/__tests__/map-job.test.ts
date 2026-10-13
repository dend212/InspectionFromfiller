import { describe, expect, it } from "vitest";
import { fieldProvenanceSchema } from "@/lib/prefill/provenance-schema";
import type { FieldProvenance } from "@/lib/prefill/types";
import { WORKIZ_CF } from "@/lib/workiz/adeq";
import { mapJobToImportPlan, sanitizeProvenance } from "@/lib/workiz/map-job";
import { workizJobSchema } from "@/lib/workiz/schema";
import { BOT_NOTES, cf, fixtures, job, withAddress, withClient } from "./fixtures/jobs";

const NOW = "2026-10-13T15:00:00.000Z";
const plan = (raw: Record<string, unknown>) =>
  mapJobToImportPlan(workizJobSchema.parse(raw), { inspectorName: "Sam Sample", now: NOW });
const secondaryPaths = (p: ReturnType<typeof plan>) =>
  Object.keys(p.fieldProvenance)
    .filter((k) => k.startsWith("secondary."))
    .sort();

describe("address (spec §5.1)", () => {
  it("fills street/city/ZIP with primary prefilled 0.9 entries and matching secondary chips", () => {
    const p = plan(fixtures.importable());
    expect(p.formData.facilityInfo).toMatchObject({
      facilityAddress: "100 E Example Rd",
      facilityCity: "Cave Creek",
      facilityZip: "85331",
      facilityState: "AZ",
      facilityCounty: "",
      inspectorName: "Sam Sample",
    });
    for (const [path, value] of [
      ["facilityInfo.facilityAddress", "100 E Example Rd"],
      ["facilityInfo.facilityCity", "Cave Creek"],
      ["facilityInfo.facilityZip", "85331"],
    ]) {
      const expected = {
        source: "workiz",
        kind: "fill",
        value,
        confidence: 0.9,
        explanation: "Workiz job #4696 · service address",
        at: NOW,
      };
      expect(p.fieldProvenance[path]).toEqual({ ...expected, state: "prefilled" });
      expect(p.fieldProvenance[`secondary.${path}`]).toEqual({ ...expected, state: "suggested" });
    }
    expect(p.columns).toEqual({
      facilityAddress: "100 E Example Rd",
      facilityCity: "Cave Creek",
      facilityZip: "85331",
      customerEmail: "test.client@example.com",
      workizJobId: "AB12CD",
    });
    expect(p.columns).not.toHaveProperty("customerName");
  });

  it("appends the unit, title-cases a lower-case city and keeps the first 5 ZIP digits", () => {
    expect(plan(fixtures.unit()).formData.facilityInfo.facilityAddress).toBe("100 E Example Rd #12");
    expect(plan(fixtures.lowercaseCity()).formData.facilityInfo.facilityCity).toBe("Laveen");
    expect(plan(withAddress({ zipCode: "85331-1234" })).columns.facilityZip).toBe("85331");
  });

  it("an invalid ZIP is neither filled nor chipped, and the run gets no zipMustMatch", () => {
    const p = plan(withAddress({ zipCode: "8533" }));
    expect(p.formData.facilityInfo.facilityZip).toBe("");
    expect(p.fieldProvenance["facilityInfo.facilityZip"]).toBeUndefined();
    expect(p.fieldProvenance["secondary.facilityInfo.facilityZip"]).toBeUndefined();
    expect(p.columns.facilityZip).toBeNull();
    expect(p.prefillInput).toEqual({
      address: { streetNumber: "100", streetDir: "E", streetName: "Example Rd", city: "Cave Creek", full: "100 E Example Rd, Cave Creek, AZ" },
    });
  });

  it("state: Arizona/AZ/empty → AZ silently; anything else → AZ + non_az_state skip", () => {
    expect(plan(withAddress({ state: "arizona" })).skips).toEqual([]);
    expect(plan(withAddress({ state: "" })).skips).toEqual([]);
    const nv = plan(withAddress({ state: "NV" }));
    expect(nv.formData.facilityInfo.facilityState).toBe("AZ");
    expect(nv.skips).toContainEqual({ field: "addressDetails.state", reason: "non_az_state" });
  });

  it("builds the run input from the parsed street (unit dropped) + city + ZIP, with zipMustMatch", () => {
    expect(plan(fixtures.unit()).prefillInput).toEqual({
      address: {
        streetNumber: "100",
        streetDir: "E",
        streetName: "Example Rd",
        city: "Cave Creek",
        zip: "85331",
        full: "100 E Example Rd, Cave Creek, AZ 85331",
      },
      zipMustMatch: true,
    });
  });

  it("an address without a leading house number → no run input, but the street is still filled", () => {
    const p = plan(withAddress({ address: "Rural Route Box" }));
    expect(p.prefillInput).toBeNull();
    expect(p.formData.facilityInfo.facilityAddress).toBe("Rural Route Box");
  });
});

describe("chips (secondary only, never written to formData)", () => {
  it("date: the YYYY-MM-DD slice with the raw value as evidence; unscheduled → none", () => {
    const p = plan(fixtures.importable());
    expect(p.fieldProvenance["secondary.facilityInfo.dateOfInspection"]).toMatchObject({
      value: "2026-10-06",
      confidence: 0.9,
      explanation: "Workiz scheduled date (job #4696)",
      evidence: "date: 2026-10-06 12:00:00",
    });
    expect(p.formData.facilityInfo.dateOfInspection).toBe("");
    expect(plan(fixtures.unscheduled()).fieldProvenance["secondary.facilityInfo.dateOfInspection"]).toBeUndefined();
  });

  it("seller name: first + last, else company, else none; never fills the field", () => {
    const p = plan(fixtures.importable());
    expect(p.fieldProvenance["secondary.facilityInfo.sellerName"]).toMatchObject({
      value: "Test Client",
      confidence: 0.6,
      explanation: "Workiz client (job #4696)",
    });
    expect(p.formData.facilityInfo.sellerName).toBe("");
    const company = plan(withClient({ firstName: "", lastName: "", companyName: "Example Holdings LLC" }));
    expect(company.fieldProvenance["secondary.facilityInfo.sellerName"]?.value).toBe("Example Holdings LLC");
    const none = plan(withClient({ firstName: " ", lastName: "", companyName: "" }));
    expect(none.fieldProvenance["secondary.facilityInfo.sellerName"]).toBeUndefined();
  });

  it("email: valid → customer_email; invalid → null", () => {
    expect(plan(withClient({ email: "not-an-email" })).columns.customerEmail).toBeNull();
    expect(plan(withClient({ email: "" })).columns.customerEmail).toBeNull();
  });

  it("team: trimmed names in Workiz order, de-duplicated, capped at 200 chars; empty team → none", () => {
    expect(plan(fixtures.multiTeam()).fieldProvenance["secondary.facilityInfo.employeeName"]).toMatchObject({
      value: "Alex Tester, Sam Sample, alex Other",
      confidence: 0.8,
      explanation: "Workiz team (job #4696)",
    });
    expect(plan(fixtures.emptyTeam()).fieldProvenance["secondary.facilityInfo.employeeName"]).toBeUndefined();
    const big = plan({
      ...fixtures.importable(),
      team: Array.from({ length: 30 }, (_, i) => ({ id: i, name: `Tech Number${i}` })),
    });
    const value = big.fieldProvenance["secondary.facilityInfo.employeeName"]?.value as string;
    expect(value.length).toBeLessThanOrEqual(200);
    expect(value).not.toMatch(/[,\s]$/);
  });

  it("APN: custom field (0.7) or permit-bot note with its confidence; invalid CF → invalid_apn skip", () => {
    const fromCf = plan({ ...fixtures.importable(), customFields: [cf(WORKIZ_CF.apn, "12345670")] });
    expect(fromCf.fieldProvenance["secondary.facilityInfo.taxParcelNumber"]).toMatchObject({
      value: "123-45-670",
      confidence: 0.7,
      explanation: "Workiz APN field (job #4696)",
      evidence: "APN 123-45-670",
    });
    const fromNote = plan({ ...fixtures.importable(), notes: [BOT_NOTES.grokHigh] });
    expect(fromNote.fieldProvenance["secondary.facilityInfo.taxParcelNumber"]).toMatchObject({
      value: "123-45-678",
      confidence: 0.6,
      explanation: "Workiz note — permit bot, confidence high (job #4696)",
    });
    const unstated = plan({ ...fixtures.importable(), notes: [BOT_NOTES.noConfidence] });
    expect(unstated.fieldProvenance["secondary.facilityInfo.taxParcelNumber"]?.explanation).toBe(
      "Workiz note — permit bot, confidence not stated (job #4696)",
    );
    const invalid = plan({ ...fixtures.importable(), customFields: [cf(WORKIZ_CF.apn, "see file")] });
    expect(invalid.skips).toContainEqual({ field: WORKIZ_CF.apn, reason: "invalid_apn" });
    expect(invalid.fieldProvenance["secondary.facilityInfo.taxParcelNumber"]).toBeUndefined();
  });

  it("custom-field chips: value maps, confidences, explanations and evidence", () => {
    const p = plan({
      ...fixtures.importable(),
      customFields: [
        cf(WORKIZ_CF.waterSource, "Private Well", "Water Source "),
        cf(WORKIZ_CF.tankSize, "1,500 Gallons"),
        cf(WORKIZ_CF.effluentFilter, "Yes"),
        cf(WORKIZ_CF.flowTestCompleted, "No"),
        cf(WORKIZ_CF.tankRecommendation, "Operational W/Concerns"),
        cf(WORKIZ_CF.drainfieldRecommendation, "Non-Operational"),
        cf("CF-someCheckbox00001", true),
      ],
    });
    expect(p.fieldProvenance["secondary.facilityInfo.waterSource"]).toEqual({
      source: "workiz",
      state: "suggested",
      kind: "fill",
      value: "private_well",
      confidence: 0.85,
      explanation: "Workiz job #4696 · Water Source",
      evidence: 'Water Source: "Private Well"',
      at: NOW,
    });
    expect(p.fieldProvenance["secondary.septicTank.tanks.0.tankCapacity"]?.value).toBe("1500");
    expect(p.fieldProvenance["secondary.septicTank.tanks.0.effluentFilterPresent"]?.value).toBe("present");
    expect(p.fieldProvenance["secondary.disposalWorks.hydraulicLoadTestPerformed"]?.value).toBe("no");
    expect(p.fieldProvenance["secondary.facilityInfo.septicTankCondition"]?.value).toBe("operational_with_concerns");
    expect(p.fieldProvenance["secondary.facilityInfo.disposalWorksCondition"]?.value).toBe("not_operational");
    expect(p.skips).toEqual([]); // the checkbox CF is ignored silently
    expect(p.formData.facilityInfo.waterSource).toBe("");
  });

  it("skips unmappable values with a reason code only", () => {
    const p = plan({
      ...fixtures.importable(),
      customFields: [
        cf(WORKIZ_CF.waterSource, "Municipal / Private Water Supply"),
        cf(WORKIZ_CF.tankSize, "18"),
        cf(WORKIZ_CF.effluentFilter, ""),
        cf(WORKIZ_CF.tankRecommendation, "Needs Pumping"),
      ],
    });
    expect(p.skips).toEqual([
      { field: WORKIZ_CF.waterSource, reason: "ambiguous" },
      { field: WORKIZ_CF.tankSize, reason: "out_of_range" },
      { field: WORKIZ_CF.effluentFilter, reason: "empty" },
      { field: WORKIZ_CF.tankRecommendation, reason: "unknown_option" },
    ]);
    expect(JSON.stringify(p.skips)).not.toMatch(/Municipal|Pumping/);
  });

  it("two separate comment chips: concerns → septic tank comments, flow test description → disposal works comments", () => {
    const p = plan({
      ...fixtures.importable(),
      customFields: [
        cf(WORKIZ_CF.notableConcerns, "Inlet baffle cracked."),
        cf(WORKIZ_CF.flowTestDescription, "Ran 150 gal, no surfacing."),
      ],
    });
    expect(p.fieldProvenance["secondary.septicTank.septicTankComments"]).toMatchObject({
      value: "Inlet baffle cracked.",
      confidence: 0.8,
      explanation: "Workiz job #4696 · Notable Concerns",
    });
    expect(p.fieldProvenance["secondary.disposalWorks.disposalWorksComments"]).toMatchObject({
      value: "Ran 150 gal, no surfacing.",
      confidence: 0.8,
      explanation: "Workiz job #4696 · Flow Test Description",
    });
    expect(p.fieldProvenance["secondary.septicTank.septicTankComments"]?.evidence).toBeUndefined();
  });

  it("'none' concerns and an empty flow description are dropped", () => {
    const p = plan({
      ...fixtures.importable(),
      customFields: [cf(WORKIZ_CF.notableConcerns, "None."), cf(WORKIZ_CF.flowTestDescription, "  ")],
    });
    expect(p.fieldProvenance["secondary.septicTank.septicTankComments"]).toBeUndefined();
    expect(p.fieldProvenance["secondary.disposalWorks.disposalWorksComments"]).toBeUndefined();
  });
});

describe("whole plan", () => {
  it("every key and entry passes fieldProvenanceSchema; secondary keys are the expected set", () => {
    const p = plan({
      ...fixtures.importable(),
      notes: [BOT_NOTES.grokHigh],
      customFields: [
        cf(WORKIZ_CF.waterSource, "Private Well"),
        cf(WORKIZ_CF.tankSize, "1500"),
        cf(WORKIZ_CF.effluentFilter, "Yes"),
        cf(WORKIZ_CF.flowTestCompleted, "Yes"),
        cf(WORKIZ_CF.tankRecommendation, "Operational"),
        cf(WORKIZ_CF.drainfieldRecommendation, "Operational"),
        cf(WORKIZ_CF.notableConcerns, "Inlet baffle cracked."),
        cf(WORKIZ_CF.flowTestDescription, "Ran 150 gal."),
      ],
    });
    expect(fieldProvenanceSchema.safeParse(p.fieldProvenance).success).toBe(true);
    expect(secondaryPaths(p)).toEqual(
      [
        "secondary.disposalWorks.disposalWorksComments",
        "secondary.disposalWorks.hydraulicLoadTestPerformed",
        "secondary.facilityInfo.dateOfInspection",
        "secondary.facilityInfo.disposalWorksCondition",
        "secondary.facilityInfo.employeeName",
        "secondary.facilityInfo.facilityAddress",
        "secondary.facilityInfo.facilityCity",
        "secondary.facilityInfo.facilityZip",
        "secondary.facilityInfo.sellerName",
        "secondary.facilityInfo.septicTankCondition",
        "secondary.facilityInfo.taxParcelNumber",
        "secondary.facilityInfo.waterSource",
        "secondary.septicTank.septicTankComments",
        "secondary.septicTank.tanks.0.effluentFilterPresent",
        "secondary.septicTank.tanks.0.tankCapacity",
      ].sort(),
    );
    for (const e of Object.values(p.fieldProvenance)) {
      expect(e.source).toBe("workiz");
      expect(e.runId).toBeUndefined();
      expect(e.sourceUrl).toBeUndefined();
    }
  });

  it("workizJobId is the 6-char uuid, not the JOB- id", () => {
    expect(plan(fixtures.importable()).columns.workizJobId).toBe("AB12CD");
  });

  it("uses the job serial in explanations, '?' when absent", () => {
    const p = mapJobToImportPlan(job({ serialId: null }), { inspectorName: "Sam Sample", now: NOW });
    expect(p.fieldProvenance["facilityInfo.facilityAddress"]?.explanation).toBe("Workiz job #? · service address");
  });
});

describe("sanitizeProvenance", () => {
  it("keeps valid entries and reports the paths of invalid ones", () => {
    const good = plan(fixtures.importable()).fieldProvenance;
    const bad: FieldProvenance = {
      ...good,
      "secondary.facilityInfo.sellerName": { ...good["secondary.facilityInfo.sellerName"], value: "x".repeat(6000) },
      "bad key!": good["facilityInfo.facilityAddress"],
    };
    const { map, dropped } = sanitizeProvenance(bad);
    expect(dropped.sort()).toEqual(["bad key!", "secondary.facilityInfo.sellerName"]);
    expect(map["facilityInfo.facilityAddress"]).toEqual(good["facilityInfo.facilityAddress"]);
    expect(fieldProvenanceSchema.safeParse(map).success).toBe(true);
  });
});
