import { describe, expect, it } from "vitest";
import { EDITED_DOT_CLASS, SOURCE_META, VERIFIED_DOT_CLASS } from "@/lib/prefill/sources";
import {
  emptyStages,
  MAX_PREFILL_RUNS_PER_HOUR,
  PREFILL_FILL_THRESHOLD,
} from "@/lib/prefill/types";

describe("SOURCE_META", () => {
  it("has a label, dot colour and accent for every source", () => {
    for (const source of ["assessor", "permit", "listing", "scan"] as const) {
      expect(SOURCE_META[source].label).toBeTruthy();
      expect(SOURCE_META[source].dotClass).toMatch(/^bg-/);
      expect(SOURCE_META[source].accentClass).toContain("border-");
    }
  });

  it("uses the spec colours", () => {
    expect(SOURCE_META.assessor.dotClass).toBe("bg-blue-500");
    expect(SOURCE_META.permit.dotClass).toBe("bg-amber-500");
    expect(SOURCE_META.listing.dotClass).toBe("bg-violet-500");
    expect(SOURCE_META.scan.dotClass).toBe("bg-green-600");
    expect(EDITED_DOT_CLASS).toBe("bg-gray-400");
    expect(VERIFIED_DOT_CLASS).toBe("bg-emerald-600");
  });
});

describe("types helpers", () => {
  it("emptyStages returns three independent pending stages with empty links", () => {
    const stages = emptyStages();
    expect(Object.keys(stages).sort()).toEqual(["assessor", "listing", "permits"]);
    for (const stage of Object.values(stages)) {
      expect(stage).toEqual({ status: "pending", links: [] });
    }
    expect(stages.assessor).not.toBe(stages.listing);
    expect(stages.assessor.links).not.toBe(stages.listing.links);
  });

  it("exposes the spec thresholds", () => {
    expect(PREFILL_FILL_THRESHOLD).toBe(0.75);
    expect(MAX_PREFILL_RUNS_PER_HOUR).toBe(3);
  });
});
