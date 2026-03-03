import { describe, it, expect } from "vitest";
import { SCAN_SYSTEM_PROMPT, FIELD_CATALOG } from "@/lib/ai/scan-prompt";
import {
  AZ_COUNTIES,
  GP402_SYSTEM_TYPES,
  TANK_MATERIALS,
  DISPOSAL_TYPES,
  DISTRIBUTION_METHODS,
  SUPPLY_LINE_MATERIALS,
  CONDITION_OPTIONS,
  BAFFLE_MATERIALS,
  BAFFLE_CONDITIONS,
  WATER_SOURCES,
  WASTEWATER_SOURCES,
  OCCUPANCY_TYPES,
  FACILITY_TYPES,
  FACILITY_SYSTEM_TYPES,
  CAPACITY_BASIS_OPTIONS,
  DESIGN_FLOW_BASIS,
  ACTUAL_FLOW_EVALUATION,
} from "@/lib/constants/inspection";

// ---------------------------------------------------------------------------
// 1. SCAN_SYSTEM_PROMPT validation
// ---------------------------------------------------------------------------
describe("SCAN_SYSTEM_PROMPT", () => {
  it("is a non-empty string", () => {
    expect(typeof SCAN_SYSTEM_PROMPT).toBe("string");
    expect(SCAN_SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });

  it("mentions ADEQ and GWS 432", () => {
    expect(SCAN_SYSTEM_PROMPT).toContain("ADEQ");
    expect(SCAN_SYSTEM_PROMPT).toContain("GWS 432");
  });

  it("mentions JSON output", () => {
    expect(SCAN_SYSTEM_PROMPT).toContain("JSON");
  });

  it("mentions confidence scoring", () => {
    expect(SCAN_SYSTEM_PROMPT).toContain("confidence");
    expect(SCAN_SYSTEM_PROMPT).toContain("CONFIDENCE SCORING");
  });

  it.each(["1.0", "0.95", "0.90", "0.85", "0.80", "0.70", "0.60", "0.50"])(
    "contains confidence level %s in the rubric",
    (level) => {
      expect(SCAN_SYSTEM_PROMPT).toContain(level);
    },
  );

  it("instructs to omit blank fields", () => {
    expect(SCAN_SYSTEM_PROMPT.toLowerCase()).toContain("omit blank fields");
  });

  it("instructs to respond with only valid JSON", () => {
    expect(SCAN_SYSTEM_PROMPT).toMatch(/respond with only valid json/i);
  });

  it("provides a sample JSON response structure", () => {
    expect(SCAN_SYSTEM_PROMPT).toContain('"fields"');
    expect(SCAN_SYSTEM_PROMPT).toContain('"fieldPath"');
    expect(SCAN_SYSTEM_PROMPT).toContain('"value"');
    expect(SCAN_SYSTEM_PROMPT).toContain('"confidence"');
    expect(SCAN_SYSTEM_PROMPT).toContain('"source"');
  });
});

// ---------------------------------------------------------------------------
// 2. FIELD_CATALOG validation
// ---------------------------------------------------------------------------
describe("FIELD_CATALOG", () => {
  it("is a non-empty string", () => {
    expect(typeof FIELD_CATALOG).toBe("string");
    expect(FIELD_CATALOG.length).toBeGreaterThan(0);
  });

  // ---- Section presence ----
  describe("form sections", () => {
    it.each([
      "facilityInfo",
      "generalTreatment",
      "designFlow",
      "septicTank",
      "disposalWorks",
    ])("contains the %s section header", (section) => {
      expect(FIELD_CATALOG).toContain(`SECTION: ${section}`);
    });
  });

  // ---- Critical field paths ----
  describe("critical field paths", () => {
    it.each([
      "facilityInfo.facilityName",
      "facilityInfo.facilityAddress",
      "facilityInfo.facilityCounty",
      "generalTreatment.systemTypes",
      "designFlow.estimatedDesignFlow",
      "septicTank.numberOfTanks",
      "septicTank.tanks[0].tankMaterial",
      "disposalWorks.disposalType",
      "disposalWorks.repairsRecommended",
    ])("contains field path %s", (path) => {
      expect(FIELD_CATALOG).toContain(path);
    });
  });

  // ---- AZ county names ----
  describe("AZ counties", () => {
    it.each(AZ_COUNTIES.map((c) => c.value))(
      "contains county: %s",
      (county) => {
        expect(FIELD_CATALOG).toContain(county);
      },
    );

    it("lists all 15 counties", () => {
      const allPresent = AZ_COUNTIES.every((c) =>
        FIELD_CATALOG.includes(c.value),
      );
      expect(allPresent).toBe(true);
    });
  });

  // ---- GP 4.02+ system type values ----
  describe("GP 4.02+ system type enum values", () => {
    it.each(GP402_SYSTEM_TYPES.map((s) => s.value))(
      "contains system type: %s",
      (value) => {
        expect(FIELD_CATALOG).toContain(value);
      },
    );
  });

  // ---- Tank material enum values ----
  describe("tank material enum values", () => {
    it.each(TANK_MATERIALS.map((m) => m.value))(
      "contains tank material: %s",
      (value) => {
        expect(FIELD_CATALOG).toContain(value);
      },
    );
  });

  // ---- Condition enum values ----
  describe("condition enum values", () => {
    it.each(CONDITION_OPTIONS.map((c) => c.value))(
      "contains condition: %s",
      (value) => {
        expect(FIELD_CATALOG).toContain(value);
      },
    );
  });

  // ---- Disposal type values ----
  describe("disposal type enum values", () => {
    it.each(DISPOSAL_TYPES.map((d) => d.value))(
      "contains disposal type: %s",
      (value) => {
        expect(FIELD_CATALOG).toContain(value);
      },
    );
  });

  // ---- Distribution method values ----
  describe("distribution method enum values", () => {
    it.each(DISTRIBUTION_METHODS.map((d) => d.value))(
      "contains distribution method: %s",
      (value) => {
        expect(FIELD_CATALOG).toContain(value);
      },
    );
  });

  // ---- Water source values ----
  describe("water source enum values", () => {
    it.each(WATER_SOURCES.map((w) => w.value))(
      "contains water source: %s",
      (value) => {
        expect(FIELD_CATALOG).toContain(value);
      },
    );
  });

  // ---- Supply line material values ----
  describe("supply line material enum values", () => {
    it.each(SUPPLY_LINE_MATERIALS.map((s) => s.value))(
      "contains supply line material: %s",
      (value) => {
        expect(FIELD_CATALOG).toContain(value);
      },
    );
  });

  // ---- Baffle material values ----
  describe("baffle material enum values", () => {
    it.each(BAFFLE_MATERIALS.map((b) => b.value))(
      "contains baffle material: %s",
      (value) => {
        expect(FIELD_CATALOG).toContain(value);
      },
    );
  });

  // ---- Baffle condition values ----
  describe("baffle condition enum values", () => {
    it.each(BAFFLE_CONDITIONS.map((b) => b.value))(
      "contains baffle condition: %s",
      (value) => {
        expect(FIELD_CATALOG).toContain(value);
      },
    );
  });

  // ---- Wastewater source values ----
  describe("wastewater source enum values", () => {
    it.each(WASTEWATER_SOURCES.map((w) => w.value))(
      "contains wastewater source: %s",
      (value) => {
        expect(FIELD_CATALOG).toContain(value);
      },
    );
  });

  // ---- Occupancy type values ----
  describe("occupancy type enum values", () => {
    it.each(OCCUPANCY_TYPES.map((o) => o.value))(
      "contains occupancy type: %s",
      (value) => {
        expect(FIELD_CATALOG).toContain(value);
      },
    );
  });

  // ---- Facility type values ----
  describe("facility type enum values", () => {
    it.each(FACILITY_TYPES.map((f) => f.value))(
      "contains facility type: %s",
      (value) => {
        expect(FIELD_CATALOG).toContain(value);
      },
    );
  });

  // ---- Facility system type values ----
  describe("facility system type enum values", () => {
    it.each(FACILITY_SYSTEM_TYPES.map((f) => f.value))(
      "contains facility system type: %s",
      (value) => {
        expect(FIELD_CATALOG).toContain(value);
      },
    );
  });

  // ---- Capacity basis values ----
  describe("capacity basis enum values", () => {
    it.each(CAPACITY_BASIS_OPTIONS.map((c) => c.value))(
      "contains capacity basis: %s",
      (value) => {
        expect(FIELD_CATALOG).toContain(value);
      },
    );
  });

  // ---- Design flow basis values ----
  describe("design flow basis enum values", () => {
    it.each(DESIGN_FLOW_BASIS.map((d) => d.value))(
      "contains design flow basis: %s",
      (value) => {
        expect(FIELD_CATALOG).toContain(value);
      },
    );
  });

  // ---- Actual flow evaluation values ----
  describe("actual flow evaluation enum values", () => {
    it.each(ACTUAL_FLOW_EVALUATION.map((a) => a.value))(
      "contains actual flow evaluation: %s",
      (value) => {
        expect(FIELD_CATALOG).toContain(value);
      },
    );
  });

  // ---- Tank deficiency checkbox fields ----
  describe("tank deficiency checkbox fields", () => {
    it.each([
      "deficiencyRootInvasion",
      "deficiencyExposedRebar",
      "deficiencyCracks",
      "deficiencyDamagedInlet",
      "deficiencyDamagedOutlet",
      "deficiencyDamagedLids",
      "deficiencyDeterioratingConcrete",
      "deficiencyOther",
    ])("contains tank deficiency field: %s", (field) => {
      expect(FIELD_CATALOG).toContain(field);
    });
  });

  // ---- Disposal works deficiency checkbox fields ----
  describe("disposal works deficiency checkbox fields", () => {
    it.each([
      "defCrushedOutletPipe",
      "defRootInvasion",
      "defHighWaterLines",
      "defDboxNotFunctioning",
      "defSurfacing",
      "defLushVegetation",
      "defErosion",
      "defPondingWater",
      "defAnimalIntrusion",
      "defLoadTestFailure",
      "defCouldNotDetermine",
    ])("contains disposal deficiency field: %s", (field) => {
      expect(FIELD_CATALOG).toContain(field);
    });
  });
});

// ---------------------------------------------------------------------------
// 3. Consistency checks: constants <-> field catalog sync
// ---------------------------------------------------------------------------
describe("FIELD_CATALOG <-> constants consistency", () => {
  /**
   * Helper: extracts every value from a readonly array of {value, label}
   * and asserts each appears somewhere in the FIELD_CATALOG string.
   */
  const assertAllValuesInCatalog = (
    constantName: string,
    items: ReadonlyArray<{ readonly value: string }>,
  ) => {
    const missing = items
      .map((item) => item.value)
      .filter((v) => !FIELD_CATALOG.includes(v));
    expect(
      missing,
      `${constantName} values missing from FIELD_CATALOG: [${missing.join(", ")}]`,
    ).toEqual([]);
  };

  it("every AZ_COUNTIES value appears in FIELD_CATALOG", () => {
    assertAllValuesInCatalog("AZ_COUNTIES", AZ_COUNTIES);
  });

  it("every GP402_SYSTEM_TYPES value appears in FIELD_CATALOG", () => {
    assertAllValuesInCatalog("GP402_SYSTEM_TYPES", GP402_SYSTEM_TYPES);
  });

  it("every TANK_MATERIALS value appears in FIELD_CATALOG", () => {
    assertAllValuesInCatalog("TANK_MATERIALS", TANK_MATERIALS);
  });

  it("every DISPOSAL_TYPES value appears in FIELD_CATALOG", () => {
    assertAllValuesInCatalog("DISPOSAL_TYPES", DISPOSAL_TYPES);
  });

  it("every DISTRIBUTION_METHODS value appears in FIELD_CATALOG", () => {
    assertAllValuesInCatalog("DISTRIBUTION_METHODS", DISTRIBUTION_METHODS);
  });

  it("every SUPPLY_LINE_MATERIALS value appears in FIELD_CATALOG", () => {
    assertAllValuesInCatalog("SUPPLY_LINE_MATERIALS", SUPPLY_LINE_MATERIALS);
  });

  it("every CONDITION_OPTIONS value appears in FIELD_CATALOG", () => {
    assertAllValuesInCatalog("CONDITION_OPTIONS", CONDITION_OPTIONS);
  });

  it("every BAFFLE_MATERIALS value appears in FIELD_CATALOG", () => {
    assertAllValuesInCatalog("BAFFLE_MATERIALS", BAFFLE_MATERIALS);
  });

  it("every BAFFLE_CONDITIONS value appears in FIELD_CATALOG", () => {
    assertAllValuesInCatalog("BAFFLE_CONDITIONS", BAFFLE_CONDITIONS);
  });

  it("every WATER_SOURCES value appears in FIELD_CATALOG", () => {
    assertAllValuesInCatalog("WATER_SOURCES", WATER_SOURCES);
  });

  it("every WASTEWATER_SOURCES value appears in FIELD_CATALOG", () => {
    assertAllValuesInCatalog("WASTEWATER_SOURCES", WASTEWATER_SOURCES);
  });

  it("every OCCUPANCY_TYPES value appears in FIELD_CATALOG", () => {
    assertAllValuesInCatalog("OCCUPANCY_TYPES", OCCUPANCY_TYPES);
  });

  it("every FACILITY_TYPES value appears in FIELD_CATALOG", () => {
    assertAllValuesInCatalog("FACILITY_TYPES", FACILITY_TYPES);
  });

  it("every FACILITY_SYSTEM_TYPES value appears in FIELD_CATALOG", () => {
    assertAllValuesInCatalog("FACILITY_SYSTEM_TYPES", FACILITY_SYSTEM_TYPES);
  });

  it("every CAPACITY_BASIS_OPTIONS value appears in FIELD_CATALOG", () => {
    assertAllValuesInCatalog("CAPACITY_BASIS_OPTIONS", CAPACITY_BASIS_OPTIONS);
  });

  it("every DESIGN_FLOW_BASIS value appears in FIELD_CATALOG", () => {
    assertAllValuesInCatalog("DESIGN_FLOW_BASIS", DESIGN_FLOW_BASIS);
  });

  it("every ACTUAL_FLOW_EVALUATION value appears in FIELD_CATALOG", () => {
    assertAllValuesInCatalog("ACTUAL_FLOW_EVALUATION", ACTUAL_FLOW_EVALUATION);
  });
});
