import { describe, expect, it } from "vitest";
import {
  formatWorkizCity,
  formatWorkizStreet,
  formatWorkizZip,
  mapCondition,
  mapEffluentFilter,
  mapFlowTestCompleted,
  mapFreeText,
  mapTankSize,
  mapWaterSource,
  normalizeOption,
} from "@/lib/workiz/custom-fields";

const ok = (value: string) => ({ ok: true, value });
const skip = (reason: string) => ({ ok: false, reason });

describe("normalizeOption", () => {
  it("trims, collapses internal whitespace and lower-cases", () => {
    expect(normalizeOption("  Shared   Private\tWell ")).toBe("shared private well");
  });
});

describe("mapWaterSource (§5.2.1)", () => {
  it.each([
    ["Private Well", ok("private_well")],
    ["private well ", ok("private_well")],
    ["Shared Private Well", ok("shared_well")],
    ["Hauled Water", ok("hauled_water")],
    ["Municipal / Private Water Supply", skip("ambiguous")],
    ["Unknown", skip("unknown_option")],
    ["Yes", skip("unknown_option")],
    ["", skip("empty")],
    ["   ", skip("empty")],
  ])("%j → %j", (raw, expected) => {
    expect(mapWaterSource(raw)).toEqual(expected);
  });
});

describe("mapTankSize (§5.2.2)", () => {
  it.each([
    ["1000", ok("1000")],
    ["1250", ok("1250")],
    ["1500", ok("1500")],
    ["2000", ok("2000")],
    ["2500", ok("2500")],
    ["3000", ok("3000")],
    ["1,500 Gallons", ok("1500")],
    ["1000 gallon", ok("1000")],
    ["1,500 gallons", ok("1500")],
    ["750 gal", ok("750")],
    ["300", ok("300")],
    ["10,000", ok("10000")],
    ["< 1000", skip("unknown_option")],
    [">3000", skip("unknown_option")],
    ["18", skip("out_of_range")],
    ["12000", skip("out_of_range")],
    ["big", skip("unknown_option")],
    ["", skip("empty")],
  ])("%j → %j", (raw, expected) => {
    expect(mapTankSize(raw)).toEqual(expected);
  });
});

describe("mapEffluentFilter / mapFlowTestCompleted (§5.2.3, §5.2.4)", () => {
  it("maps Yes/No and skips anything else", () => {
    expect(mapEffluentFilter("Yes")).toEqual(ok("present"));
    expect(mapEffluentFilter(" no ")).toEqual(ok("not_present"));
    expect(mapEffluentFilter("Maybe")).toEqual(skip("unknown_option"));
    expect(mapEffluentFilter("")).toEqual(skip("empty"));
    expect(mapFlowTestCompleted("YES")).toEqual(ok("yes"));
    expect(mapFlowTestCompleted("No")).toEqual(ok("no"));
    expect(mapFlowTestCompleted("N/A")).toEqual(skip("unknown_option"));
    expect(mapFlowTestCompleted("")).toEqual(skip("empty"));
  });
});

describe("mapCondition (§5.2.5)", () => {
  it.each([
    ["Operational", ok("operational")],
    ["Operational W/Concerns", ok("operational_with_concerns")],
    ["operational w/concerns", ok("operational_with_concerns")],
    ["Non-Operational", ok("not_operational")],
    ["Needs Pumping", skip("unknown_option")],
    ["", skip("empty")],
  ])("%j → %j", (raw, expected) => {
    expect(mapCondition(raw)).toEqual(expected);
  });
});

describe("mapFreeText", () => {
  it("trims, collapses runs of spaces/tabs and keeps internal newlines", () => {
    expect(mapFreeText("  Baffle   cracked.\r\n\tRoots at outlet.  ")).toEqual(
      ok("Baffle cracked.\n Roots at outlet."),
    );
  });

  it("caps at 4,000 characters", () => {
    const result = mapFreeText("a".repeat(5000));
    expect(result.ok && result.value.length).toBe(4000);
  });

  it("drops empty text", () => {
    expect(mapFreeText("  ")).toEqual(skip("empty"));
  });

  it("drops none / n/a / no concerns answers only when asked (notable concerns)", () => {
    for (const raw of ["None", "none.", "N/A", "n/a", "NA", "No concern", "no concerns."]) {
      expect(mapFreeText(raw, { dropNoneAnswers: true })).toEqual(skip("empty"));
    }
    expect(mapFreeText("None", { dropNoneAnswers: false })).toEqual(ok("None"));
    expect(mapFreeText("None of the risers are sealed", { dropNoneAnswers: true })).toEqual(
      ok("None of the risers are sealed"),
    );
  });
});

describe("address formatters (§5.1)", () => {
  it("formatWorkizStreet trims, collapses whitespace and appends #unit", () => {
    expect(formatWorkizStreet("  100  E Example   Rd ", "")).toBe("100 E Example Rd");
    expect(formatWorkizStreet("100 E Example Rd", " 12 ")).toBe("100 E Example Rd #12");
    expect(formatWorkizStreet("100 E Example Rd", "#12")).toBe("100 E Example Rd #12");
    expect(formatWorkizStreet("", "")).toBe("");
  });

  it("formatWorkizCity title-cases only all-lower or all-upper values", () => {
    expect(formatWorkizCity("laveen")).toBe("Laveen");
    expect(formatWorkizCity("CAVE CREEK")).toBe("Cave Creek");
    expect(formatWorkizCity(" McDowell  Mountain ")).toBe("McDowell Mountain");
    expect(formatWorkizCity("")).toBe("");
  });

  it("formatWorkizZip keeps 5-digit and ZIP+4 (first five), rejects the rest", () => {
    expect(formatWorkizZip("85331")).toBe("85331");
    expect(formatWorkizZip(" 85331-1234 ")).toBe("85331");
    expect(formatWorkizZip("8533")).toBeNull();
    expect(formatWorkizZip("AZ 85331")).toBeNull();
    expect(formatWorkizZip("")).toBeNull();
  });
});
