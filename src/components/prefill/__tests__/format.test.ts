import { describe, expect, it } from "vitest";
import { formatFieldValue, formatProvenanceValue } from "@/components/prefill/format";

describe("formatFieldValue", () => {
  it("labels a checkbox array in GP402_SYSTEM_TYPES order", () => {
    expect(formatFieldValue("generalTreatment.systemTypes", ["gp402_septic_tank", "gp402_seepage_pit"])).toBe(
      "Septic Tank, Disposal by Seepage Pit",
    );
  });

  it("labels a wastewaterSource enum", () => {
    expect(formatFieldValue("facilityInfo.wastewaterSource", "residential")).toBe("Residential");
  });

  it("labels a facilityType enum", () => {
    expect(formatFieldValue("facilityInfo.facilityType", "single_family")).toBe("Single Family Residence");
  });

  it("labels a facilitySystemTypes array", () => {
    expect(formatFieldValue("facilityInfo.facilitySystemTypes", ["conventional"])).toBe("Conventional System");
  });

  it("labels a waterSource enum", () => {
    expect(formatFieldValue("facilityInfo.waterSource", "municipal")).toBe("Municipal System");
  });

  it("labels a disposalType enum", () => {
    expect(formatFieldValue("disposalWorks.disposalType", "seepage_pit")).toBe("Seepage Pit");
  });

  it("labels an occupancyType enum", () => {
    expect(formatFieldValue("facilityInfo.occupancyType", "full_time")).toBe("Full Time");
  });

  it("labels a designFlowBasis enum", () => {
    expect(formatFieldValue("designFlow.designFlowBasis", "permit_documents")).toBe(
      "Designated in permitting documents",
    );
  });

  it("labels an indexed tank's tankMaterial enum, normalising the numeric segment", () => {
    expect(formatFieldValue("septicTank.tanks.0.tankMaterial", "precast_concrete")).toBe("Pre-cast Concrete");
    expect(formatFieldValue("septicTank.tanks.3.tankMaterial", "precast_concrete")).toBe("Pre-cast Concrete");
  });

  it("labels an indexed tank's capacityBasis enum, normalising the numeric segment", () => {
    expect(formatFieldValue("septicTank.tanks.0.capacityBasis", "permit_document")).toBe("Permit Document");
    expect(formatFieldValue("septicTank.tanks.12.capacityBasis", "permit_document")).toBe("Permit Document");
  });

  it("falls back to the raw token for a value not in the field's option list", () => {
    expect(formatFieldValue("facilityInfo.wastewaterSource", "mystery")).toBe("mystery");
  });

  it("falls back to formatProvenanceValue for an unregistered field path", () => {
    expect(formatFieldValue("septicTank.tanks.0.tankDimensions", "48in dia x 6ft")).toBe(
      formatProvenanceValue("48in dia x 6ft"),
    );
    expect(formatFieldValue("septicTank.tanks.0.tankDimensions", ["a", "b"])).toBe(
      formatProvenanceValue(["a", "b"]),
    );
  });

  it("formats booleans as Yes/No regardless of field path", () => {
    expect(formatFieldValue("facilityInfo.hasSitePlan", true)).toBe("Yes");
    expect(formatFieldValue("facilityInfo.wastewaterSource", false)).toBe("No");
  });
});
