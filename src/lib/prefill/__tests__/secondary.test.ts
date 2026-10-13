import { describe, expect, it } from "vitest";
import {
  appendSecondaryText,
  isSecondaryKey,
  isSecondaryVisible,
  SECONDARY_APPEND_PATHS,
  secondaryKey,
  secondaryValuesEqual,
} from "@/lib/prefill/secondary";
import type { ProvenanceEntry } from "@/lib/prefill/types";
import { inspectionFormSchema } from "@/lib/validators/inspection";

const AT = "2026-10-12T17:04:05.000Z";

function workiz(value: ProvenanceEntry["value"], over: Partial<ProvenanceEntry> = {}): ProvenanceEntry {
  return {
    source: "workiz",
    state: "suggested",
    kind: "fill",
    value,
    confidence: 0.85,
    explanation: "Workiz job #4696 · Water Source",
    at: AT,
    ...over,
  };
}

function primary(value: ProvenanceEntry["value"], over: Partial<ProvenanceEntry> = {}): ProvenanceEntry {
  return {
    source: "assessor",
    state: "prefilled",
    kind: "fill",
    value,
    confidence: 1,
    explanation: "Maricopa County Assessor",
    at: AT,
    ...over,
  };
}

describe("key helpers", () => {
  it("namespaces and normalises paths", () => {
    expect(secondaryKey("facilityInfo.sellerName")).toBe("secondary.facilityInfo.sellerName");
    expect(secondaryKey("septicTank.tanks[0].tankCapacity")).toBe("secondary.septicTank.tanks.0.tankCapacity");
    expect(isSecondaryKey("secondary.facilityInfo.sellerName")).toBe(true);
    expect(isSecondaryKey("facilityInfo.sellerName")).toBe(false);
  });

  it("no form root is named `secondary`, so secondary keys can never collide with a real field path", () => {
    expect(Object.keys(inspectionFormSchema.shape)).not.toContain("secondary");
  });

  it("the append paths are exactly the two comments fields", () => {
    expect([...SECONDARY_APPEND_PATHS].sort()).toEqual([
      "disposalWorks.disposalWorksComments",
      "septicTank.septicTankComments",
    ]);
  });
});

describe("appendSecondaryText", () => {
  it("replaces an empty field and appends after a blank line otherwise", () => {
    expect(appendSecondaryText("", "Roots at outlet.")).toBe("Roots at outlet.");
    expect(appendSecondaryText("   ", "Roots at outlet.")).toBe("Roots at outlet.");
    expect(appendSecondaryText(undefined, "Roots at outlet.")).toBe("Roots at outlet.");
    expect(appendSecondaryText("Baffle cracked.  \n", "Roots at outlet.")).toBe(
      "Baffle cracked.\n\nRoots at outlet.",
    );
  });
});

describe("secondaryValuesEqual", () => {
  it("APN: dashes and case normalised", () => {
    expect(secondaryValuesEqual("facilityInfo.taxParcelNumber", "12345678a", "123-45-678A")).toBe(true);
    expect(secondaryValuesEqual("facilityInfo.taxParcelNumber", "123-45-678", "123-45-679")).toBe(false);
  });

  it("address: suffix/case differences are equal; a dropped unit or a different street differs", () => {
    const path = "facilityInfo.facilityAddress";
    expect(secondaryValuesEqual(path, "100 E Example Rd", "100 E EXAMPLE RD")).toBe(true);
    expect(secondaryValuesEqual(path, "100 E Example Road", "100 E EXAMPLE RD")).toBe(true);
    expect(secondaryValuesEqual(path, "100 E Example Rd #12", "100 E EXAMPLE RD")).toBe(false);
    expect(secondaryValuesEqual(path, "100 E Example Rd #12", "100 E Example Rd Space 12")).toBe(true);
    expect(secondaryValuesEqual(path, "100 E Example Rd", "102 E Example Rd")).toBe(false);
    expect(secondaryValuesEqual(path, "100 E Example Rd", "100 E Sample Rd")).toBe(false);
  });

  it("address: falls back to loose text when either side does not parse", () => {
    const path = "facilityInfo.facilityAddress";
    expect(secondaryValuesEqual(path, "Rural Route  Box", "rural route box")).toBe(true);
    expect(secondaryValuesEqual(path, "Rural Route Box", "100 E Example Rd")).toBe(false);
  });

  it("ZIP: first five digits", () => {
    expect(secondaryValuesEqual("facilityInfo.facilityZip", "85331-1234", "85331")).toBe(true);
    expect(secondaryValuesEqual("facilityInfo.facilityZip", "85331", "85332")).toBe(false);
  });

  it("other strings: trimmed, whitespace-collapsed, case-insensitive; non-strings use valuesEqual", () => {
    expect(secondaryValuesEqual("facilityInfo.facilityCity", " cave  creek ", "Cave Creek")).toBe(true);
    expect(secondaryValuesEqual("facilityInfo.waterSource", "private_well", "shared_well")).toBe(false);
    expect(secondaryValuesEqual("x.flag", true, true)).toBe(true);
    expect(secondaryValuesEqual("x.flag", true, "true")).toBe(false);
  });
});

describe("isSecondaryVisible (spec §6.3 truth table)", () => {
  const water = "facilityInfo.waterSource";

  it("hidden when there is no secondary", () => {
    expect(isSecondaryVisible({ fieldPath: water, currentValue: "" })).toBe(false);
  });

  it("visible when the field is empty or differs", () => {
    expect(isSecondaryVisible({ fieldPath: water, secondary: workiz("private_well"), currentValue: "" })).toBe(true);
    expect(
      isSecondaryVisible({
        fieldPath: water,
        secondary: workiz("private_well"),
        primary: primary("municipal", { source: "permit" }),
        currentValue: "municipal",
      }),
    ).toBe(true);
  });

  it("hidden when the field already equals it (also under normalisation)", () => {
    expect(isSecondaryVisible({ fieldPath: water, secondary: workiz("private_well"), currentValue: "private_well" })).toBe(false);
    expect(
      isSecondaryVisible({
        fieldPath: "facilityInfo.facilityAddress",
        secondary: workiz("100 E Example Rd"),
        currentValue: "100 E EXAMPLE RD",
      }),
    ).toBe(false);
  });

  it("hidden while the primary is verified", () => {
    expect(
      isSecondaryVisible({
        fieldPath: water,
        secondary: workiz("private_well"),
        primary: primary("municipal", { state: "verified" }),
        currentValue: "municipal",
      }),
    ).toBe(false);
  });

  it("hidden when the primary is a visible suggested chip with the same value (no duplicate chips)", () => {
    expect(
      isSecondaryVisible({
        fieldPath: water,
        secondary: workiz("private_well"),
        primary: primary("private_well", { state: "suggested", source: "permit" }),
        currentValue: "",
      }),
    ).toBe(false);
  });

  it("visible when the primary suggests a different value", () => {
    expect(
      isSecondaryVisible({
        fieldPath: water,
        secondary: workiz("private_well"),
        primary: primary("shared_well", { state: "suggested", source: "permit" }),
        currentValue: "",
      }),
    ).toBe(true);
  });

  it.each(["septicTank.septicTankComments", "disposalWorks.disposalWorksComments"])(
    "%s: hidden when the field already contains the Workiz text",
    (path) => {
      const secondary = workiz("Roots at outlet.");
      expect(isSecondaryVisible({ fieldPath: path, secondary, currentValue: "Baffle cracked.\n\nRoots at outlet." })).toBe(false);
      expect(isSecondaryVisible({ fieldPath: path, secondary, currentValue: "Baffle cracked." })).toBe(true);
    },
  );

  it("a warning-kind secondary never shows", () => {
    expect(
      isSecondaryVisible({ fieldPath: water, secondary: workiz("", { kind: "warning" }), currentValue: "" }),
    ).toBe(false);
  });
});
