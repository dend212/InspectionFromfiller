import { describe, it, expect } from "vitest";
import {
  AZ_COUNTIES,
  FACILITY_TYPES,
  INSPECTION_TYPES,
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
  FACILITY_SYSTEM_TYPES,
  CAPACITY_BASIS_OPTIONS,
  DESIGN_FLOW_BASIS,
  ACTUAL_FLOW_EVALUATION,
  INSPECTOR_DEFAULTS,
  STEP_LABELS,
} from "../inspection";

// ============================================================================
// Helper: verify { value, label } shape and uniqueness
// ============================================================================

function expectValueLabelArray(
  arr: ReadonlyArray<{ readonly value: string; readonly label: string }>,
  minLength: number,
) {
  expect(arr.length).toBeGreaterThanOrEqual(minLength);

  const values = arr.map((item) => item.value);
  const unique = new Set(values);
  expect(unique.size).toBe(values.length);

  for (const item of arr) {
    expect(typeof item.value).toBe("string");
    expect(item.value.length).toBeGreaterThan(0);
    expect(typeof item.label).toBe("string");
    expect(item.label.length).toBeGreaterThan(0);
  }
}

// ============================================================================
// AZ_COUNTIES
// ============================================================================

describe("AZ_COUNTIES", () => {
  it("has all 15 Arizona counties", () => {
    expect(AZ_COUNTIES).toHaveLength(15);
  });

  it("has valid { value, label } items with unique values", () => {
    expectValueLabelArray(AZ_COUNTIES, 15);
  });

  it("includes Maricopa county", () => {
    const maricopa = AZ_COUNTIES.find((c) => c.value === "Maricopa");
    expect(maricopa).toBeDefined();
    expect(maricopa?.label).toBe("Maricopa");
  });

  it("includes all expected counties", () => {
    const expected = [
      "Apache",
      "Cochise",
      "Coconino",
      "Gila",
      "Graham",
      "Greenlee",
      "La Paz",
      "Maricopa",
      "Mohave",
      "Navajo",
      "Pima",
      "Pinal",
      "Santa Cruz",
      "Yavapai",
      "Yuma",
    ];
    const values = AZ_COUNTIES.map((c) => c.value);
    for (const county of expected) {
      expect(values).toContain(county);
    }
  });
});

// ============================================================================
// FACILITY_TYPES
// ============================================================================

describe("FACILITY_TYPES", () => {
  it("has 4 facility types", () => {
    expect(FACILITY_TYPES).toHaveLength(4);
  });

  it("has valid items with unique values", () => {
    expectValueLabelArray(FACILITY_TYPES, 4);
  });

  it("includes single_family, multifamily, commercial, other", () => {
    const values = FACILITY_TYPES.map((f) => f.value);
    expect(values).toContain("single_family");
    expect(values).toContain("multifamily");
    expect(values).toContain("commercial");
    expect(values).toContain("other");
  });
});

// ============================================================================
// INSPECTION_TYPES
// ============================================================================

describe("INSPECTION_TYPES", () => {
  it("has 4 inspection types", () => {
    expect(INSPECTION_TYPES).toHaveLength(4);
  });

  it("has valid items with unique values", () => {
    expectValueLabelArray(INSPECTION_TYPES, 4);
  });

  it("includes routine, complaint, permit, other", () => {
    const values = INSPECTION_TYPES.map((t) => t.value);
    expect(values).toContain("routine");
    expect(values).toContain("complaint");
    expect(values).toContain("permit");
    expect(values).toContain("other");
  });
});

// ============================================================================
// GP402_SYSTEM_TYPES
// ============================================================================

describe("GP402_SYSTEM_TYPES", () => {
  it("has at least 25 system types", () => {
    expect(GP402_SYSTEM_TYPES.length).toBeGreaterThanOrEqual(25);
  });

  it("has valid items with unique values", () => {
    expectValueLabelArray(GP402_SYSTEM_TYPES, 25);
  });

  it("all values start with gp4", () => {
    for (const item of GP402_SYSTEM_TYPES) {
      expect(item.value).toMatch(/^gp4/);
    }
  });

  it("includes key system types", () => {
    const values = GP402_SYSTEM_TYPES.map((t) => t.value);
    expect(values).toContain("gp402_conventional");
    expect(values).toContain("gp402_septic_tank");
    expect(values).toContain("gp415_aerobic");
    expect(values).toContain("gp422_drip");
    expect(values).toContain("gp423_large_flow");
  });
});

// ============================================================================
// TANK_MATERIALS
// ============================================================================

describe("TANK_MATERIALS", () => {
  it("has 6 materials", () => {
    expect(TANK_MATERIALS).toHaveLength(6);
  });

  it("has valid items with unique values", () => {
    expectValueLabelArray(TANK_MATERIALS, 6);
  });

  it("includes common materials", () => {
    const values = TANK_MATERIALS.map((m) => m.value);
    expect(values).toContain("precast_concrete");
    expect(values).toContain("fiberglass");
    expect(values).toContain("plastic");
    expect(values).toContain("steel");
    expect(values).toContain("other");
  });
});

// ============================================================================
// DISPOSAL_TYPES
// ============================================================================

describe("DISPOSAL_TYPES", () => {
  it("has 5 disposal types", () => {
    expect(DISPOSAL_TYPES).toHaveLength(5);
  });

  it("has valid items with unique values", () => {
    expectValueLabelArray(DISPOSAL_TYPES, 5);
  });
});

// ============================================================================
// DISTRIBUTION_METHODS
// ============================================================================

describe("DISTRIBUTION_METHODS", () => {
  it("has 7 methods", () => {
    expect(DISTRIBUTION_METHODS).toHaveLength(7);
  });

  it("has valid items with unique values", () => {
    expectValueLabelArray(DISTRIBUTION_METHODS, 7);
  });
});

// ============================================================================
// SUPPLY_LINE_MATERIALS
// ============================================================================

describe("SUPPLY_LINE_MATERIALS", () => {
  it("has 4 materials", () => {
    expect(SUPPLY_LINE_MATERIALS).toHaveLength(4);
  });

  it("has valid items with unique values", () => {
    expectValueLabelArray(SUPPLY_LINE_MATERIALS, 4);
  });

  it("includes pvc", () => {
    const values = SUPPLY_LINE_MATERIALS.map((m) => m.value);
    expect(values).toContain("pvc");
  });
});

// ============================================================================
// CONDITION_OPTIONS
// ============================================================================

describe("CONDITION_OPTIONS", () => {
  it("has 3 conditions", () => {
    expect(CONDITION_OPTIONS).toHaveLength(3);
  });

  it("has valid items with unique values", () => {
    expectValueLabelArray(CONDITION_OPTIONS, 3);
  });

  it("includes operational, operational_with_concerns, not_operational", () => {
    const values = CONDITION_OPTIONS.map((c) => c.value);
    expect(values).toContain("operational");
    expect(values).toContain("operational_with_concerns");
    expect(values).toContain("not_operational");
  });
});

// ============================================================================
// BAFFLE_MATERIALS
// ============================================================================

describe("BAFFLE_MATERIALS", () => {
  it("has 5 baffle materials", () => {
    expect(BAFFLE_MATERIALS).toHaveLength(5);
  });

  it("has valid items with unique values", () => {
    expectValueLabelArray(BAFFLE_MATERIALS, 5);
  });
});

// ============================================================================
// BAFFLE_CONDITIONS
// ============================================================================

describe("BAFFLE_CONDITIONS", () => {
  it("has 4 conditions", () => {
    expect(BAFFLE_CONDITIONS).toHaveLength(4);
  });

  it("has valid items with unique values", () => {
    expectValueLabelArray(BAFFLE_CONDITIONS, 4);
  });

  it("includes present_operational and not_present", () => {
    const values = BAFFLE_CONDITIONS.map((c) => c.value);
    expect(values).toContain("present_operational");
    expect(values).toContain("not_present");
  });
});

// ============================================================================
// WATER_SOURCES
// ============================================================================

describe("WATER_SOURCES", () => {
  it("has 5 water sources", () => {
    expect(WATER_SOURCES).toHaveLength(5);
  });

  it("has valid items with unique values", () => {
    expectValueLabelArray(WATER_SOURCES, 5);
  });
});

// ============================================================================
// WASTEWATER_SOURCES
// ============================================================================

describe("WASTEWATER_SOURCES", () => {
  it("has 3 sources", () => {
    expect(WASTEWATER_SOURCES).toHaveLength(3);
  });

  it("has valid items with unique values", () => {
    expectValueLabelArray(WASTEWATER_SOURCES, 3);
  });
});

// ============================================================================
// OCCUPANCY_TYPES
// ============================================================================

describe("OCCUPANCY_TYPES", () => {
  it("has 4 types", () => {
    expect(OCCUPANCY_TYPES).toHaveLength(4);
  });

  it("has valid items with unique values", () => {
    expectValueLabelArray(OCCUPANCY_TYPES, 4);
  });

  it("includes full_time, seasonal, vacant, unknown", () => {
    const values = OCCUPANCY_TYPES.map((o) => o.value);
    expect(values).toContain("full_time");
    expect(values).toContain("seasonal");
    expect(values).toContain("vacant");
    expect(values).toContain("unknown");
  });
});

// ============================================================================
// FACILITY_SYSTEM_TYPES
// ============================================================================

describe("FACILITY_SYSTEM_TYPES", () => {
  it("has 3 types", () => {
    expect(FACILITY_SYSTEM_TYPES).toHaveLength(3);
  });

  it("has valid items with unique values", () => {
    expectValueLabelArray(FACILITY_SYSTEM_TYPES, 3);
  });

  it("includes conventional, alternative, gray_water", () => {
    const values = FACILITY_SYSTEM_TYPES.map((t) => t.value);
    expect(values).toContain("conventional");
    expect(values).toContain("alternative");
    expect(values).toContain("gray_water");
  });
});

// ============================================================================
// CAPACITY_BASIS_OPTIONS
// ============================================================================

describe("CAPACITY_BASIS_OPTIONS", () => {
  it("has 4 options", () => {
    expect(CAPACITY_BASIS_OPTIONS).toHaveLength(4);
  });

  it("has valid items with unique values", () => {
    expectValueLabelArray(CAPACITY_BASIS_OPTIONS, 4);
  });
});

// ============================================================================
// DESIGN_FLOW_BASIS
// ============================================================================

describe("DESIGN_FLOW_BASIS", () => {
  it("has 3 options", () => {
    expect(DESIGN_FLOW_BASIS).toHaveLength(3);
  });

  it("has valid items with unique values", () => {
    expectValueLabelArray(DESIGN_FLOW_BASIS, 3);
  });
});

// ============================================================================
// ACTUAL_FLOW_EVALUATION
// ============================================================================

describe("ACTUAL_FLOW_EVALUATION", () => {
  it("has 3 options", () => {
    expect(ACTUAL_FLOW_EVALUATION).toHaveLength(3);
  });

  it("has valid items with unique values", () => {
    expectValueLabelArray(ACTUAL_FLOW_EVALUATION, 3);
  });
});

// ============================================================================
// INSPECTOR_DEFAULTS
// ============================================================================

describe("INSPECTOR_DEFAULTS", () => {
  it("has correct company name", () => {
    expect(INSPECTOR_DEFAULTS.company).toBe("SewerTime Septic");
  });

  it("has correct company address", () => {
    expect(INSPECTOR_DEFAULTS.companyAddress).toBe("33645 N Cave Creek Rd");
  });

  it("has correct company city", () => {
    expect(INSPECTOR_DEFAULTS.companyCity).toBe("Cave Creek");
  });

  it("has correct company state", () => {
    expect(INSPECTOR_DEFAULTS.companyState).toBe("AZ");
  });

  it("has correct company zip", () => {
    expect(INSPECTOR_DEFAULTS.companyZip).toBe("85331");
  });

  it("has correct certification number", () => {
    expect(INSPECTOR_DEFAULTS.certificationNumber).toBe("NAWT #15805");
  });

  it("has correct registration number", () => {
    expect(INSPECTOR_DEFAULTS.registrationNumber).toBe("CR-37");
  });

  it("has correct truck number", () => {
    expect(INSPECTOR_DEFAULTS.truckNumber).toBe("ADEQ Truck #2833");
  });

  it("has all expected keys", () => {
    const keys = Object.keys(INSPECTOR_DEFAULTS);
    expect(keys).toContain("company");
    expect(keys).toContain("companyAddress");
    expect(keys).toContain("companyCity");
    expect(keys).toContain("companyState");
    expect(keys).toContain("companyZip");
    expect(keys).toContain("certificationNumber");
    expect(keys).toContain("registrationNumber");
    expect(keys).toContain("truckNumber");
    expect(keys).toHaveLength(8);
  });
});

// ============================================================================
// STEP_LABELS
// ============================================================================

describe("STEP_LABELS", () => {
  it("has 5 step labels", () => {
    expect(STEP_LABELS).toHaveLength(5);
  });

  it("has correct labels in order", () => {
    expect(STEP_LABELS[0]).toBe("Facility Info");
    expect(STEP_LABELS[1]).toBe("General Treatment");
    expect(STEP_LABELS[2]).toBe("Design Flow");
    expect(STEP_LABELS[3]).toBe("Septic Tank");
    expect(STEP_LABELS[4]).toBe("Disposal Works");
  });

  it("all labels are non-empty strings", () => {
    for (const label of STEP_LABELS) {
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });
});
