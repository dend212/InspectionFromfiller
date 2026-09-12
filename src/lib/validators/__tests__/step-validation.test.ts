import { describe, expect, it } from "vitest";
import { getDefaultFormValues, STEP_FIELDS } from "@/lib/validators/inspection";
import {
  allIssues,
  humanizeFieldPath,
  isEmptyFieldValue,
  STEP_COUNT,
  stepForPath,
  validateSteps,
} from "@/lib/validators/step-validation";
import type { InspectionFormData } from "@/types/inspection";

function completeForm(): InspectionFormData {
  const d = getDefaultFormValues("Dan Endres") as unknown as InspectionFormData;
  d.facilityInfo.facilityName = "Smith Residence";
  return d;
}

/** Schema-valid non-empty values for the enum-typed STEP_FIELDS entries */
const ENUM_VALUES: Record<string, string> = {
  "generalTreatment.hasPerformanceAssurancePlan": "yes",
  "septicTank.tanksPumped": "yes",
  "disposalWorks.disposalWorksLocationDetermined": "yes",
  "disposalWorks.distributionComponentInspected": "yes",
  "disposalWorks.inspectionPortsPresent": "present",
  "disposalWorks.hydraulicLoadTestPerformed": "yes",
  "disposalWorks.hasDisposalDeficiency": "no",
  "disposalWorks.repairsRecommended": "no",
  "alternativeSystem.altDisposalLocationDetermined": "yes",
};

function setPath(obj: unknown, path: string, value: unknown) {
  const segs = path.split(".");
  let cur = obj as Record<string, unknown>;
  for (const s of segs.slice(0, -1)) cur = cur[s] as Record<string, unknown>;
  cur[segs[segs.length - 1]] = value;
}

describe("validateSteps", () => {
  it("returns an entry for every step, even when the form is empty", () => {
    const result = validateSteps(getDefaultFormValues(""));
    expect(Object.keys(result).map(Number)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("buckets required-field errors into step 0", () => {
    const result = validateSteps(getDefaultFormValues(""));
    expect(result[0].errors).toEqual([
      { path: "facilityInfo.facilityName", message: "Facility/Property name is required" },
      { path: "facilityInfo.inspectorName", message: "Inspector name is required" },
    ]);
    for (let i = 1; i < STEP_COUNT; i++) expect(result[i].errors).toEqual([]);
  });

  it("is clean for a form with both required fields filled", () => {
    expect(allIssues(validateSteps(completeForm()))).toEqual([]);
  });

  it("buckets a nested tank enum error into step 3 with the full dotted path", () => {
    const form = completeForm();
    form.septicTank.tanks = [{ lidsRisersPresent: "sideways" } as never];
    const result = validateSteps(form);
    expect(result[3].errors).toHaveLength(1);
    expect(result[3].errors[0].path).toBe("septicTank.tanks.0.lidsRisersPresent");
    expect(result[0].errors).toEqual([]);
  });

  it("counts empty STEP_FIELDS per step and ignores booleans", () => {
    const form = completeForm();
    const result = validateSteps(form);
    // Step 2 (Design Flow): all 7 STEP_FIELDS are "" on a fresh form
    expect(result[2].emptyCount).toBe(STEP_FIELDS[2].length);
    form.designFlow.estimatedDesignFlow = "450";
    expect(validateSteps(form)[2].emptyCount).toBe(STEP_FIELDS[2].length - 1);
    // Step 1: generalTreatment.alternativeSystem is a boolean and never counts as empty
    expect(STEP_FIELDS[1]).toContain("generalTreatment.alternativeSystem");
    expect(result[1].emptyCount).toBe(STEP_FIELDS[1].length - 1);
  });

  it("reports zero empties and zero errors when every step field has a value", () => {
    const form = completeForm();
    for (const paths of Object.values(STEP_FIELDS)) {
      for (const p of paths) {
        const current = p.split(".").reduce<unknown>((o, s) => (o as Record<string, unknown>)?.[s], form);
        if (Array.isArray(current)) setPath(form, p, ["x"]);
        else if (typeof current === "boolean") setPath(form, p, true);
        else setPath(form, p, ENUM_VALUES[p] ?? "x");
      }
    }
    const result = validateSteps(form);
    for (let i = 0; i < STEP_COUNT; i++) {
      expect(result[i].emptyCount, `step ${i}`).toBe(0);
      expect(result[i].errors, `step ${i}`).toEqual([]);
    }
  });

  it("maps every STEP_FIELDS path to exactly one step, matching its bucket", () => {
    for (const [step, paths] of Object.entries(STEP_FIELDS)) {
      for (const p of paths) expect(stepForPath(p), p).toBe(Number(step));
    }
    expect(stepForPath("includeAlternativePages")).toBe(4);
    expect(stepForPath("nope.field")).toBeNull();
  });
});

describe("isEmptyFieldValue", () => {
  it("treats '', whitespace, [], null, undefined as empty and everything else as filled", () => {
    expect(isEmptyFieldValue("")).toBe(true);
    expect(isEmptyFieldValue("   ")).toBe(true);
    expect(isEmptyFieldValue([])).toBe(true);
    expect(isEmptyFieldValue(null)).toBe(true);
    expect(isEmptyFieldValue(undefined)).toBe(true);
    expect(isEmptyFieldValue("0")).toBe(false);
    expect(isEmptyFieldValue(false)).toBe(false);
    expect(isEmptyFieldValue(["a"])).toBe(false);
  });
});

describe("humanizeFieldPath", () => {
  it("humanizes plain and tank-indexed paths", () => {
    expect(humanizeFieldPath("facilityInfo.facilityName")).toBe("Facility Name");
    expect(humanizeFieldPath("septicTank.tanks.1.lidsRisersPresent")).toBe(
      "Tank 2 · Lids Risers Present",
    );
  });
});
