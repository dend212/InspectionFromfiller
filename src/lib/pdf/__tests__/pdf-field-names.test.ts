import { describe, expect, it } from "vitest";
import * as fieldNames from "@/lib/pdf/pdf-field-names";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Recursively extracts all string values from a nested object */
function collectStringValues(obj: Record<string, unknown>, result: string[] = []): string[] {
  for (const value of Object.values(obj)) {
    if (typeof value === "string") {
      result.push(value);
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      collectStringValues(value as Record<string, unknown>, result);
    }
  }
  return result;
}

/** Recursively extracts all string values that are field names (not radio option values) */
function collectFieldNames(
  obj: Record<string, unknown>,
  parentKey: string,
  result: string[] = [],
): string[] {
  for (const [key, value] of Object.entries(obj)) {
    // Skip option objects (they contain radio values like "Choice1", not field names)
    if (key.endsWith("Options") || key === "data" || key === "fallback") continue;
    if (typeof value === "string") {
      result.push(value);
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      collectFieldNames(value as Record<string, unknown>, key, result);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PDF Field Names", () => {
  describe("constant exports", () => {
    it("exports HEADER constants", () => {
      expect(fieldNames.HEADER).toBeDefined();
      expect(fieldNames.HEADER.taxParcelNo).toBe("taxParcelNo");
      expect(fieldNames.HEADER.inspectionDate).toBe("inspectionDate");
      expect(fieldNames.HEADER.inspectorInitials).toBe("inspectorInitials");
    });

    it("exports PROPERTY constants", () => {
      expect(fieldNames.PROPERTY).toBeDefined();
      expect(fieldNames.PROPERTY.propertyName).toBe("propertyName");
      expect(fieldNames.PROPERTY.propertyAddress).toBe("propertyAddress");
      expect(fieldNames.PROPERTY.propertyCity).toBe("propertyCity");
      expect(fieldNames.PROPERTY.propertyCounty).toBe("propertyCounty");
    });

    it("exports INSPECTOR constants", () => {
      expect(fieldNames.INSPECTOR).toBeDefined();
      expect(fieldNames.INSPECTOR.inspectorName).toBe("inspectorName");
      expect(fieldNames.INSPECTOR.inspectorCompany).toBe("inspectorCompany");
    });

    it("exports QUALIFICATIONS constants", () => {
      expect(fieldNames.QUALIFICATIONS).toBeDefined();
      expect(fieldNames.QUALIFICATIONS.adeqCourse).toBe("qualAdeqCourse");
      expect(fieldNames.QUALIFICATIONS.professionalEngineer).toBe("qualProfessionalEngineer");
    });

    it("exports RECORDS constants with radio options", () => {
      expect(fieldNames.RECORDS).toBeDefined();
      expect(fieldNames.RECORDS.recordsAvailable).toBe("recordsAvailable");
      expect(fieldNames.RECORDS.recordsAvailableOptions.yes).toBe("Choice1");
      expect(fieldNames.RECORDS.recordsAvailableOptions.no).toBe("Choice2");
    });

    it("exports CESSPOOL constants with radio options", () => {
      expect(fieldNames.CESSPOOL).toBeDefined();
      expect(fieldNames.CESSPOOL.isCesspool).toBe("isCesspool");
      expect(fieldNames.CESSPOOL.isCesspoolOptions.yes).toBe("Choice1");
      expect(fieldNames.CESSPOOL.isCesspoolOptions.no).toBe("Choice2");
    });

    it("exports CONDITION_SUMMARY with 4 rating groups", () => {
      const cs = fieldNames.CONDITION_SUMMARY;
      expect(cs.septicTank).toBe("conditionSepticTank");
      expect(cs.disposalWorks).toBe("conditionDisposalWorks");
      expect(cs.altSystem).toBe("conditionAltSystem");
      expect(cs.altDisposal).toBe("conditionAltDisposal");

      // Each should have operational/concerns/notOperational options
      for (const options of [
        cs.septicTankOptions,
        cs.disposalWorksOptions,
        cs.altSystemOptions,
        cs.altDisposalOptions,
      ]) {
        expect(options.operational).toBeDefined();
        expect(options.concerns).toBeDefined();
        expect(options.notOperational).toBeDefined();
      }
    });

    it("exports GP_SYSTEM_TYPES with all 27 system types", () => {
      const gpTypes = fieldNames.GP_SYSTEM_TYPES;
      const keys = Object.keys(gpTypes);
      expect(keys.length).toBe(27);

      // Spot-check a few
      expect(gpTypes.gp402Conventional).toBe("gp402Conventional");
      expect(gpTypes.gp415Aerobic).toBe("gp415Aerobic");
      expect(gpTypes.gp423LargeFlow).toBe("gp423LargeFlow");
    });

    it("exports TANK_COUNT with radio options", () => {
      expect(fieldNames.TANK_COUNT.numberOfTanks).toBe("numberOfTanks");
      expect(fieldNames.TANK_COUNT.numberOfTanksOptions.one).toBe("Choice1");
      expect(fieldNames.TANK_COUNT.numberOfTanksOptions.two).toBe("Choice2");
    });

    it("exports PUMPING with radio options", () => {
      expect(fieldNames.PUMPING.tanksPumped).toBe("tanksPumped");
      expect(fieldNames.PUMPING.tanksPumpedOptions.yes).toBe("Choice1");
      expect(fieldNames.PUMPING.tanksPumpedOptions.no).toBe("Choice2");
    });

    it("exports ACCESS_OPENINGS with 4-option radio", () => {
      const ao = fieldNames.ACCESS_OPENINGS;
      expect(ao.accessOpenings).toBe("accessOpenings");
      expect(ao.accessOpeningsOptions.one).toBe("Choice1");
      expect(ao.accessOpeningsOptions.two).toBe("Choice2");
      expect(ao.accessOpeningsOptions.three).toBe("Choice3");
      expect(ao.accessOpeningsOptions.other).toBe("Choice4");
    });

    it("exports COMPARTMENTS with 3-option radio", () => {
      const comp = fieldNames.COMPARTMENTS;
      expect(comp.compartments).toBe("compartments");
      expect(comp.compartmentsOptions.one).toBe("Choice5");
      expect(comp.compartmentsOptions.two).toBe("Choice1");
      expect(comp.compartmentsOptions.other).toBe("Choice2");
    });

    it("exports LIDS_RISERS with two radio groups", () => {
      expect(fieldNames.LIDS_RISERS.lidsPresent).toBe("lidsPresent");
      expect(fieldNames.LIDS_RISERS.lidsSecurelyFastened).toBe("lidsSecurelyFastened");
    });

    it("exports TANK_DEFICIENCIES with 8 checkboxes", () => {
      const def = fieldNames.TANK_DEFICIENCIES;
      expect(Object.keys(def)).toHaveLength(8);
      expect(def.rootInvasion).toBe("defRootInvasion");
      expect(def.exposedRebar).toBe("defExposedRebar");
      expect(def.otherConcerns).toBe("defOtherConcerns");
    });

    it("exports BAFFLE_MATERIAL with 5 checkboxes", () => {
      const bm = fieldNames.BAFFLE_MATERIAL;
      expect(Object.keys(bm)).toHaveLength(5);
    });

    it("exports baffle condition constants", () => {
      expect(fieldNames.INLET_BAFFLE.present).toBe("inletBafflePresent");
      expect(fieldNames.OUTLET_BAFFLE.present).toBe("outletBafflePresent");
      expect(fieldNames.INTERIOR_BAFFLE.present).toBe("interiorBafflePresent");
    });

    it("exports EFFLUENT_FILTER with 4 checkboxes", () => {
      expect(Object.keys(fieldNames.EFFLUENT_FILTER)).toHaveLength(4);
    });

    it("exports DISPOSAL_LOCATION with radio options", () => {
      expect(fieldNames.DISPOSAL_LOCATION.locationDetermined).toBe("disposalWorksLocationDetermined");
      expect(fieldNames.DISPOSAL_LOCATION.locationDeterminedOptions.yes).toBe("Choice3");
      expect(fieldNames.DISPOSAL_LOCATION.locationDeterminedOptions.no).toBe("Choice1");
    });

    it("exports DISPOSAL_TYPE with 5 checkboxes", () => {
      expect(fieldNames.DISPOSAL_TYPE.trench).toBe("disposalTypeTrench");
      expect(fieldNames.DISPOSAL_TYPE.other).toBe("disposalTypeOther");
    });

    it("exports DISTRIBUTION_METHOD with 7 checkboxes", () => {
      expect(Object.keys(fieldNames.DISTRIBUTION_METHOD)).toHaveLength(7);
    });

    it("exports INSPECTION_PORTS with radio and text fields", () => {
      expect(fieldNames.INSPECTION_PORTS.present).toBe("inspectionPortsPresent");
      expect(fieldNames.INSPECTION_PORTS.numberOfPorts).toBe("numberOfPorts");
      expect(fieldNames.INSPECTION_PORTS.portDepth1).toBe("portDepth1");
      expect(fieldNames.INSPECTION_PORTS.portDepth8).toBe("portDepth8");
    });

    it("exports HYDRAULIC_LOAD with radio options", () => {
      expect(fieldNames.HYDRAULIC_LOAD.test).toBe("hydraulicLoadTest");
    });

    it("exports DISPOSAL_DEFICIENCY with 11 checkboxes plus radio", () => {
      const dd = fieldNames.DISPOSAL_DEFICIENCY;
      expect(dd.hasDeficiency).toBe("hasDisposalDeficiency");
      expect(dd.crushedOutletPipe).toBe("dwDefCrushedOutletPipe");
      expect(dd.couldNotDetermine).toBe("dwDefCouldNotDetermine");
    });

    it("exports DISPOSAL_REPAIRS with radio options", () => {
      expect(fieldNames.DISPOSAL_REPAIRS.recommended).toBe("repairsRecommended");
    });

    it("exports CONVENTIONAL_SIGNATURE", () => {
      expect(fieldNames.CONVENTIONAL_SIGNATURE.signature).toBe("conventionalSignature");
      expect(fieldNames.CONVENTIONAL_SIGNATURE.printedName).toBe("conventionalPrintedName");
    });

    it("exports ALT_SYSTEM_CHECKS with 12 radio groups", () => {
      const asc = fieldNames.ALT_SYSTEM_CHECKS;
      // Count the non-Options keys (which are field names)
      const fieldKeys = Object.keys(asc).filter((k) => !k.endsWith("Options"));
      expect(fieldKeys.length).toBe(12);
    });

    it("exports PDF_TEMPLATE_PATH", () => {
      expect(fieldNames.PDF_TEMPLATE_PATH).toBe("/septic_system_insp_form_v2.pdf");
    });
  });

  describe("field name uniqueness", () => {
    it("has no duplicate field names across all sections", () => {
      // Collect all field names (excluding radio option values)
      const exportedSections = [
        fieldNames.HEADER,
        fieldNames.PROPERTY,
        fieldNames.INSPECTOR,
        fieldNames.QUALIFICATIONS,
        fieldNames.FACILITY_SERVES,
        fieldNames.FACILITY_TYPE,
        fieldNames.FACILITY_INFO,
        fieldNames.WATER_SOURCE,
        fieldNames.WASTEWATER_SOURCE,
        fieldNames.OCCUPANCY,
        fieldNames.GP_SYSTEM_TYPES,
        fieldNames.DESIGN_FLOW,
        fieldNames.LIQUID_LEVELS,
        fieldNames.TANK_CAPACITY,
        fieldNames.TANK_MATERIAL,
        fieldNames.TANK_DEFICIENCIES,
        fieldNames.BAFFLE_MATERIAL,
        fieldNames.INLET_BAFFLE,
        fieldNames.OUTLET_BAFFLE,
        fieldNames.INTERIOR_BAFFLE,
        fieldNames.EFFLUENT_FILTER,
        fieldNames.DISPOSAL_TYPE,
        fieldNames.DISTRIBUTION_METHOD,
        fieldNames.SUPPLY_LINE,
        fieldNames.DISPOSAL_COMMENTS,
        fieldNames.SEPTIC_TANK_COMMENTS,
        fieldNames.ALT_SYSTEM_INFO,
        fieldNames.ALT_SYSTEM_COMMENTS,
        fieldNames.ALT_DISPOSAL_TYPE,
        fieldNames.ALT_DISTRIBUTION,
        fieldNames.ALT_OPERATIONAL_STATUS,
        fieldNames.ALT_SUPPLY_LINE,
        fieldNames.ALT_DISPOSAL_COMMENTS,
      ];

      const allFieldNames: string[] = [];
      for (const section of exportedSections) {
        collectFieldNames(section as Record<string, unknown>, "", allFieldNames);
      }

      const seen = new Set<string>();
      const duplicates: string[] = [];
      for (const name of allFieldNames) {
        if (seen.has(name)) {
          duplicates.push(name);
        }
        seen.add(name);
      }

      expect(duplicates).toEqual([]);
    });
  });

  describe("radio option values", () => {
    it("all YesNo option objects have yes and no properties", () => {
      const yesNoFields = [
        fieldNames.RECORDS.recordsAvailableOptions,
        fieldNames.CESSPOOL.isCesspoolOptions,
        fieldNames.PUMPING.tanksPumpedOptions,
        fieldNames.LIDS_RISERS.lidsPresentOptions,
        fieldNames.LIDS_RISERS.lidsSecurelyFastenedOptions,
        fieldNames.COMPROMISED_TANK.compromisedTankOptions,
        fieldNames.DISPOSAL_LOCATION.locationDeterminedOptions,
        fieldNames.DISTRIBUTION_INSPECTION.inspectedOptions,
        fieldNames.INSPECTION_PORTS.presentOptions,
        fieldNames.HYDRAULIC_LOAD.testOptions,
        fieldNames.DISPOSAL_DEFICIENCY.hasDeficiencyOptions,
        fieldNames.DISPOSAL_REPAIRS.recommendedOptions,
        fieldNames.PERFORMANCE_ASSURANCE.planOptions,
      ];

      for (const options of yesNoFields) {
        expect(options).toHaveProperty("yes");
        expect(options).toHaveProperty("no");
        expect(typeof options.yes).toBe("string");
        expect(typeof options.no).toBe("string");
        expect(options.yes.length).toBeGreaterThan(0);
        expect(options.no.length).toBeGreaterThan(0);
      }
    });

    it("all Condition option objects have operational, concerns, notOperational", () => {
      const conditionFields = [
        fieldNames.CONDITION_SUMMARY.septicTankOptions,
        fieldNames.CONDITION_SUMMARY.disposalWorksOptions,
        fieldNames.CONDITION_SUMMARY.altSystemOptions,
        fieldNames.CONDITION_SUMMARY.altDisposalOptions,
        fieldNames.ALT_DISPOSAL_CONDITION.conditionOptions,
      ];

      for (const options of conditionFields) {
        expect(options).toHaveProperty("operational");
        expect(options).toHaveProperty("concerns");
        expect(options).toHaveProperty("notOperational");
      }
    });

    it("radio option values are non-empty strings", () => {
      const allOptionValues = [
        ...Object.values(fieldNames.RECORDS.recordsAvailableOptions),
        ...Object.values(fieldNames.CESSPOOL.isCesspoolOptions),
        ...Object.values(fieldNames.CONDITION_SUMMARY.septicTankOptions),
        ...Object.values(fieldNames.CONDITION_SUMMARY.disposalWorksOptions),
        ...Object.values(fieldNames.TANK_COUNT.numberOfTanksOptions),
        ...Object.values(fieldNames.PUMPING.tanksPumpedOptions),
        ...Object.values(fieldNames.ACCESS_OPENINGS.accessOpeningsOptions),
        ...Object.values(fieldNames.COMPARTMENTS.compartmentsOptions),
      ];

      for (const value of allOptionValues) {
        expect(typeof value).toBe("string");
        expect(value.length).toBeGreaterThan(0);
      }
    });
  });

  describe("field name conventions", () => {
    it("all field name values are non-empty strings", () => {
      const allNames = collectFieldNames(
        fieldNames as unknown as Record<string, unknown>,
        "",
      );

      for (const name of allNames) {
        expect(typeof name).toBe("string");
        expect(name.length).toBeGreaterThan(0);
      }
    });

    it("field names use camelCase format", () => {
      const sections = [
        fieldNames.HEADER,
        fieldNames.PROPERTY,
        fieldNames.INSPECTOR,
      ];

      for (const section of sections) {
        for (const value of Object.values(section)) {
          if (typeof value === "string") {
            // Should not start with uppercase (unless it's a radio option value like "Choice1")
            if (!value.startsWith("Choice")) {
              expect(value[0]).toBe(value[0].toLowerCase());
            }
          }
        }
      }
    });
  });

  describe("type interfaces", () => {
    it("YesNoOptions has correct shape", () => {
      const opts: fieldNames.YesNoOptions = { yes: "a", no: "b" };
      expect(opts.yes).toBe("a");
      expect(opts.no).toBe("b");
    });

    it("YesNoNaOptions extends YesNoOptions with na", () => {
      const opts: fieldNames.YesNoNaOptions = { yes: "a", no: "b", na: "c" };
      expect(opts.na).toBe("c");
    });

    it("ConditionOptions has correct shape", () => {
      const opts: fieldNames.ConditionOptions = {
        operational: "a",
        concerns: "b",
        notOperational: "c",
      };
      expect(opts.operational).toBe("a");
    });
  });
});
