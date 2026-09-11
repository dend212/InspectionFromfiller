import { describe, expect, it } from "vitest";
import {
  getPath,
  isEmptyValue,
  mergeProposals,
  normalizeFieldPath,
  valuesEqual,
} from "@/lib/prefill/merge";
import type { FieldProvenance, ProposedField, ProvenanceEntry } from "@/lib/prefill/types";
import { getDefaultFormValues } from "@/lib/validators/inspection";
import type { InspectionFormData } from "@/types/inspection";

const NOW = "2026-09-11T10:00:00.000Z";
const OPTS = { runId: "run-1", now: NOW };

function form(patch: (f: InspectionFormData) => void = () => {}): InspectionFormData {
  const f = getDefaultFormValues("Tech") as unknown as InspectionFormData;
  patch(f);
  return f;
}

function proposal(
  fieldPath: string,
  value: ProposedField["value"],
  confidence = 0.9,
  over: Partial<ProposedField> = {},
): ProposedField {
  return {
    fieldPath,
    value,
    kind: "fill",
    provenance: { source: "permit", confidence, explanation: "Permit OW-17-00474 p.1" },
    ...over,
  };
}

function entry(over: Partial<ProvenanceEntry> = {}): ProvenanceEntry {
  return {
    source: "scan",
    state: "prefilled",
    kind: "fill",
    value: "3",
    confidence: 0.8,
    explanation: "Scanned form · Page 1",
    at: "2026-09-10T00:00:00.000Z",
    ...over,
  };
}

describe("normalizeFieldPath", () => {
  it("rewrites bracket indexes to dotted segments", () => {
    expect(normalizeFieldPath("septicTank.tanks[0].tankCapacity")).toBe(
      "septicTank.tanks.0.tankCapacity",
    );
    expect(normalizeFieldPath("facilityInfo.waterSource")).toBe("facilityInfo.waterSource");
  });
});

describe("getPath", () => {
  it("reads nested and array paths in either notation", () => {
    const f = form((d) => {
      d.designFlow.numberOfBedrooms = "3";
      d.septicTank.tanks = [{ tankCapacity: "1250" } as InspectionFormData["septicTank"]["tanks"][0]];
    });
    expect(getPath(f, "designFlow.numberOfBedrooms")).toBe("3");
    expect(getPath(f, "septicTank.tanks.0.tankCapacity")).toBe("1250");
    expect(getPath(f, "septicTank.tanks[0].tankCapacity")).toBe("1250");
  });

  it("returns undefined for missing segments and non-objects", () => {
    expect(getPath({ a: 1 }, "a.b")).toBeUndefined();
    expect(getPath(null, "a")).toBeUndefined();
    expect(getPath({ a: { b: null } }, "a.b.c")).toBeUndefined();
  });
});

describe("isEmptyValue", () => {
  it("treats '', whitespace, [], false, null and undefined as empty", () => {
    for (const v of ["", "   ", [], false, null, undefined]) expect(isEmptyValue(v)).toBe(true);
  });
  it("treats '0', 'AZ', true and non-empty arrays as not empty", () => {
    for (const v of ["0", "AZ", true, ["x"]]) expect(isEmptyValue(v)).toBe(false);
  });
});

describe("valuesEqual", () => {
  it("trims strings, compares arrays element-wise, strict otherwise", () => {
    expect(valuesEqual(" 1250 ", "1250")).toBe(true);
    expect(valuesEqual(["a", "b"], ["a", "b"])).toBe(true);
    expect(valuesEqual(["a"], ["a", "b"])).toBe(false);
    expect(valuesEqual(true, true)).toBe(true);
    expect(valuesEqual("1", 1)).toBe(false);
  });
});

describe("mergeProposals", () => {
  it("turns a warning into a suggested entry with an empty value and no fill", () => {
    const warning: ProposedField = {
      fieldPath: "facilityInfo.wastewaterSource",
      value: "",
      kind: "warning",
      provenance: {
        source: "listing",
        confidence: 0.8,
        explanation: 'Listing says "Sewer" — confirm this property is on septic',
      },
    };
    const { fills, provenance } = mergeProposals(form(), {}, [warning], OPTS);
    expect(fills).toEqual([]);
    expect(provenance["facilityInfo.wastewaterSource"]).toMatchObject({
      state: "suggested",
      kind: "warning",
      value: "",
      runId: "run-1",
      at: NOW,
    });
  });

  it("fills an empty field when confidence meets the threshold", () => {
    const { fills, provenance } = mergeProposals(
      form(),
      {},
      [proposal("designFlow.numberOfBedrooms", "3", 0.75)],
      OPTS,
    );
    expect(fills).toEqual([{ fieldPath: "designFlow.numberOfBedrooms", value: "3" }]);
    expect(provenance["designFlow.numberOfBedrooms"]).toMatchObject({
      source: "permit",
      state: "prefilled",
      kind: "fill",
      value: "3",
      confidence: 0.75,
      runId: "run-1",
      at: NOW,
    });
  });

  it("suggests instead of filling below the threshold", () => {
    const { fills, provenance } = mergeProposals(
      form(),
      {},
      [proposal("designFlow.numberOfBedrooms", "3", 0.61)],
      OPTS,
    );
    expect(fills).toEqual([]);
    expect(provenance["designFlow.numberOfBedrooms"].state).toBe("suggested");
  });

  it("never overwrites a different existing value — it suggests", () => {
    const f = form((d) => {
      d.designFlow.numberOfBedrooms = "4";
    });
    const { fills, provenance } = mergeProposals(
      f,
      {},
      [proposal("designFlow.numberOfBedrooms", "3", 0.95)],
      OPTS,
    );
    expect(fills).toEqual([]);
    expect(provenance["designFlow.numberOfBedrooms"]).toMatchObject({
      state: "suggested",
      value: "3",
    });
  });

  it("records a prefilled entry without a fill when the field already holds the proposed value", () => {
    const f = form((d) => {
      d.facilityInfo.facilityName = "JOHN DOE";
    });
    const { fills, provenance } = mergeProposals(
      f,
      {},
      [proposal("facilityInfo.facilityName", "JOHN DOE", 1)],
      OPTS,
    );
    expect(fills).toEqual([]);
    expect(provenance["facilityInfo.facilityName"].state).toBe("prefilled");
  });

  it("turns proposals for verified or edited fields into suggestions", () => {
    const f = form((d) => {
      d.designFlow.numberOfBedrooms = "3";
    });
    for (const state of ["verified", "edited"] as const) {
      const existing: FieldProvenance = { "designFlow.numberOfBedrooms": entry({ state }) };
      const { fills, provenance } = mergeProposals(
        f,
        existing,
        [proposal("designFlow.numberOfBedrooms", "5", 0.99)],
        OPTS,
      );
      expect(fills).toEqual([]);
      expect(provenance["designFlow.numberOfBedrooms"]).toMatchObject({
        state: "suggested",
        value: "5",
        source: "permit",
      });
    }
  });

  it("replaces a prefilled entry with a higher-confidence proposal while the value is still ours", () => {
    const f = form((d) => {
      d.designFlow.numberOfBedrooms = "3";
    });
    const existing: FieldProvenance = {
      "designFlow.numberOfBedrooms": entry({ value: "3", confidence: 0.8 }),
    };
    const { fills, provenance } = mergeProposals(
      f,
      existing,
      [proposal("designFlow.numberOfBedrooms", "4", 0.95)],
      OPTS,
    );
    expect(fills).toEqual([{ fieldPath: "designFlow.numberOfBedrooms", value: "4" }]);
    expect(provenance["designFlow.numberOfBedrooms"]).toMatchObject({
      source: "permit",
      state: "prefilled",
      value: "4",
      confidence: 0.95,
    });
  });

  it("leaves a prefilled entry untouched when the same value arrives with no better confidence", () => {
    const f = form((d) => {
      d.designFlow.numberOfBedrooms = "3";
    });
    const old = entry({ value: "3", confidence: 0.8 });
    const existing: FieldProvenance = { "designFlow.numberOfBedrooms": old };
    for (const confidence of [0.8, 0.76]) {
      const { fills, provenance } = mergeProposals(
        f,
        existing,
        [proposal("designFlow.numberOfBedrooms", "3", confidence)],
        OPTS,
      );
      expect(fills).toEqual([]);
      expect(provenance["designFlow.numberOfBedrooms"]).toBe(old);
    }
  });

  it("suggests when a prefilled field was changed by the user since", () => {
    const f = form((d) => {
      d.designFlow.numberOfBedrooms = "6";
    });
    const existing: FieldProvenance = {
      "designFlow.numberOfBedrooms": entry({ value: "3", confidence: 0.8 }),
    };
    const { fills, provenance } = mergeProposals(
      f,
      existing,
      [proposal("designFlow.numberOfBedrooms", "4", 0.99)],
      OPTS,
    );
    expect(fills).toEqual([]);
    expect(provenance["designFlow.numberOfBedrooms"].state).toBe("suggested");
  });

  it("re-evaluates an existing suggestion and fills once the field is empty", () => {
    const existing: FieldProvenance = {
      "designFlow.numberOfBedrooms": entry({ state: "suggested", value: "3" }),
    };
    const { fills, provenance } = mergeProposals(
      form(),
      existing,
      [proposal("designFlow.numberOfBedrooms", "3", 0.9)],
      OPTS,
    );
    expect(fills).toEqual([{ fieldPath: "designFlow.numberOfBedrooms", value: "3" }]);
    expect(provenance["designFlow.numberOfBedrooms"].state).toBe("prefilled");
  });

  it("normalises bracket paths in keys and fills", () => {
    const f = form((d) => {
      d.septicTank.tanks = [{} as InspectionFormData["septicTank"]["tanks"][0]];
    });
    const { fills, provenance } = mergeProposals(
      f,
      {},
      [proposal("septicTank.tanks[0].tankCapacity", "1250", 0.9)],
      OPTS,
    );
    expect(fills).toEqual([{ fieldPath: "septicTank.tanks.0.tankCapacity", value: "1250" }]);
    expect(Object.keys(provenance)).toEqual(["septicTank.tanks.0.tankCapacity"]);
  });

  it("does not mutate its inputs", () => {
    const existing: FieldProvenance = { "facilityInfo.waterSource": entry({ value: "well" }) };
    const snapshot = JSON.stringify(existing);
    mergeProposals(form(), existing, [proposal("designFlow.numberOfBedrooms", "3")], OPTS);
    expect(JSON.stringify(existing)).toBe(snapshot);
  });

  it("uses the current time when opts.now is omitted", () => {
    const before = Date.now();
    const { provenance } = mergeProposals(form(), {}, [proposal("designFlow.numberOfBedrooms", "3")], {
      runId: "run-2",
    });
    const at = Date.parse(provenance["designFlow.numberOfBedrooms"].at);
    expect(at).toBeGreaterThanOrEqual(before);
    expect(provenance["designFlow.numberOfBedrooms"].runId).toBe("run-2");
  });
});
