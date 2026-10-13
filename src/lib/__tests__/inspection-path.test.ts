import { describe, expect, it } from "vitest";
import { inspectionPath } from "@/lib/inspection-path";

describe("inspectionPath", () => {
  it("opens a draft in the wizard for anyone", () => {
    expect(inspectionPath("i1", "draft", true)).toBe("/inspections/i1/edit");
    expect(inspectionPath("i1", "draft", false)).toBe("/inspections/i1/edit");
  });

  it.each(["submitted", "in_review", "completed", "sent"])(
    "%s → /review when privileged, the read-only view otherwise",
    (status) => {
      expect(inspectionPath("i1", status, true)).toBe("/review/i1");
      expect(inspectionPath("i1", status, false)).toBe("/inspections/i1");
    },
  );
});
