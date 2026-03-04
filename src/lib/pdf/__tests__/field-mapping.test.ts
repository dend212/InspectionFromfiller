import { describe, expect, it } from "vitest";
import {
  detectCommentOverflow,
  mapFormDataToFields,
  type FormFieldMapping,
  type OverflowResult,
} from "@/lib/pdf/field-mapping";
import {
  ACCESS_OPENINGS,
  CESSPOOL,
  COMPARTMENTS,
  COMPROMISED_TANK,
  CONDITION_SUMMARY,
  DISPOSAL_DEFICIENCY,
  DISPOSAL_LOCATION,
  DISPOSAL_REPAIRS,
  DISTRIBUTION_INSPECTION,
  GP_SYSTEM_TYPES,
  HYDRAULIC_LOAD,
  INSPECTION_PORTS,
  LIDS_RISERS,
  PERFORMANCE_ASSURANCE,
  PUMPING,
  RECORDS,
  TANK_COUNT,
} from "@/lib/pdf/pdf-field-names";
import type { InspectionFormData } from "@/types/inspection";

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

function makeEmptyFormData(): InspectionFormData {
  return {
    facilityInfo: {
      facilityName: "",
      facilityAddress: "",
      facilityCity: "",
      facilityCounty: "",
      facilityState: "AZ",
      facilityZip: "",
      taxParcelNumber: "",
      dateOfInspection: "",
      sellerName: "",
      sellerAddress: "",
      sellerCity: "",
      sellerState: "",
      sellerZip: "",
      inspectorName: "",
      company: "",
      companyAddress: "",
      companyCity: "",
      companyState: "",
      companyZip: "",
      certificationNumber: "",
      registrationNumber: "",
      truckNumber: "",
      employeeName: "",
      hasAdeqCourse: false,
      adeqCourseDetails: "",
      adeqCourseDate: "",
      isProfessionalEngineer: false,
      peExpirationDate: "",
      isRegisteredSanitarian: false,
      rsExpirationDate: "",
      isWastewaterOperator: false,
      operatorGrade: "",
      isLicensedContractor: false,
      contractorLicenseCategory: "",
      hasPumperTruck: false,
      pumperTruckRegistration: "",
      recordsAvailable: "",
      hasDischargeAuth: false,
      dischargeAuthPermitNo: "",
      hasApprovalOfConstruction: false,
      approvalPermitNo: "",
      hasSitePlan: false,
      hasOperationDocs: false,
      hasOtherRecords: false,
      otherRecordsDescription: "",
      isCesspool: "",
      waterSource: "",
      wellDistance: "",
      wastewaterSource: "",
      occupancyType: "",
      facilityType: "",
      facilityTypeOther: "",
      facilitySystemTypes: [],
      numberOfSystems: "",
      facilityAge: "",
      facilityAgeEstimateExplanation: "",
      septicTankCondition: "",
      disposalWorksCondition: "",
      alternativeSystemCondition: "",
      alternativeDisposalCondition: "",
    },
    generalTreatment: {
      systemTypes: [],
      hasPerformanceAssurancePlan: "",
      alternativeSystem: false,
      altSystemManufacturer: "",
      altSystemModel: "",
      altSystemCapacity: "",
      altSystemDateInstalled: "",
      altSystemCondition: "",
      altSystemNotes: "",
    },
    designFlow: {
      estimatedDesignFlow: "",
      designFlowBasis: "",
      numberOfBedrooms: "",
      fixtureCount: "",
      nonDwellingGpd: "",
      actualFlowEvaluation: "",
      designFlowComments: "",
    },
    septicTank: {
      numberOfTanks: "",
      tanksPumped: "",
      haulerCompany: "",
      haulerLicense: "",
      pumpingNotPerformedReason: "",
      tankInspectionDate: "",
      tanks: [],
      septicTankComments: "",
    },
    disposalWorks: {
      disposalWorksLocationDetermined: "",
      disposalWorksLocationNotDeterminedReason: "",
      disposalType: "",
      disposalTypeOther: "",
      distributionMethod: "",
      supplyLineMaterial: "",
      supplyLineMaterialOther: "",
      distributionComponentInspected: "",
      inspectionPortsPresent: "",
      numberOfPorts: "",
      portDepths: [],
      hydraulicLoadTestPerformed: "",
      hasDisposalDeficiency: "",
      defCrushedOutletPipe: false,
      defRootInvasion: false,
      defHighWaterLines: false,
      defDboxNotFunctioning: false,
      defSurfacing: false,
      defLushVegetation: false,
      defErosion: false,
      defPondingWater: false,
      defAnimalIntrusion: false,
      defLoadTestFailure: false,
      defCouldNotDetermine: false,
      repairsRecommended: "",
      disposalWorksComments: "",
      signatureDate: "",
      printedName: "",
    },
  };
}

function makeFullFormData(): InspectionFormData {
  return {
    facilityInfo: {
      facilityName: "Test Property",
      facilityAddress: "123 Main St",
      facilityCity: "Phoenix",
      facilityCounty: "Maricopa",
      facilityState: "AZ",
      facilityZip: "85001",
      taxParcelNumber: "123-45-678",
      dateOfInspection: "03/01/2026",
      sellerName: "John Seller",
      sellerAddress: "456 Oak Ave",
      sellerCity: "Tempe",
      sellerState: "AZ",
      sellerZip: "85281",
      inspectorName: "Daniel Endres",
      company: "SewerTime Septic",
      companyAddress: "2375 E Camelback Rd",
      companyCity: "Phoenix",
      companyState: "AZ",
      companyZip: "85016",
      certificationNumber: "NAWT #15805",
      registrationNumber: "CR-37",
      truckNumber: "ADEQ Truck #2833",
      employeeName: "Daniel Endres",
      hasAdeqCourse: true,
      adeqCourseDetails: "NAWT 15805 ITC",
      adeqCourseDate: "01/15/2024",
      isProfessionalEngineer: false,
      peExpirationDate: "",
      isRegisteredSanitarian: false,
      rsExpirationDate: "",
      isWastewaterOperator: false,
      operatorGrade: "",
      isLicensedContractor: true,
      contractorLicenseCategory: "CR-37",
      hasPumperTruck: true,
      pumperTruckRegistration: "ADEQ Truck #2833",
      recordsAvailable: "yes",
      hasDischargeAuth: true,
      dischargeAuthPermitNo: "DAP-001",
      hasApprovalOfConstruction: true,
      approvalPermitNo: "AC-002",
      hasSitePlan: true,
      hasOperationDocs: true,
      hasOtherRecords: true,
      otherRecordsDescription: "Maintenance records",
      isCesspool: "no",
      waterSource: "private_well",
      wellDistance: "100 ft",
      wastewaterSource: "residential",
      occupancyType: "full_time",
      facilityType: "single_family",
      facilityTypeOther: "",
      facilitySystemTypes: ["conventional"],
      numberOfSystems: "1",
      facilityAge: "15 years",
      facilityAgeEstimateExplanation: "Per county records",
      septicTankCondition: "operational",
      disposalWorksCondition: "operational_with_concerns",
      alternativeSystemCondition: "",
      alternativeDisposalCondition: "",
    },
    generalTreatment: {
      systemTypes: ["gp402_conventional", "gp402_septic_tank"],
      hasPerformanceAssurancePlan: "yes",
      alternativeSystem: false,
      altSystemManufacturer: "",
      altSystemModel: "",
      altSystemCapacity: "",
      altSystemDateInstalled: "",
      altSystemCondition: "",
      altSystemNotes: "",
    },
    designFlow: {
      estimatedDesignFlow: "300",
      designFlowBasis: "calculated",
      numberOfBedrooms: "3",
      fixtureCount: "12",
      nonDwellingGpd: "",
      actualFlowEvaluation: "not_exceed",
      designFlowComments: "Standard residential design flow",
    },
    septicTank: {
      numberOfTanks: "1",
      tanksPumped: "yes",
      haulerCompany: "Sewer Time Septic & Drain",
      haulerLicense: "2833",
      pumpingNotPerformedReason: "",
      tankInspectionDate: "03/01/2026",
      tanks: [
        {
          liquidLevel: "Normal",
          primaryScumThickness: "2 inches",
          primarySludgeThickness: "4 inches",
          secondaryScumThickness: "",
          secondarySludgeThickness: "",
          liquidLevelNotDetermined: false,
          tankDimensions: "5x8x5",
          tankCapacity: "1000",
          capacityBasis: "measurement",
          capacityNotDeterminedReason: "",
          tankMaterial: "precast_concrete",
          tankMaterialOther: "",
          accessOpenings: "two",
          accessOpeningsOther: "",
          lidsRisersPresent: "present",
          lidsSecurelyFastened: "yes",
          numberOfCompartments: "one",
          compartmentsOther: "",
          compromisedTank: "no",
          deficiencyRootInvasion: false,
          deficiencyExposedRebar: false,
          deficiencyCracks: false,
          deficiencyDamagedInlet: false,
          deficiencyDamagedOutlet: false,
          deficiencyDamagedLids: false,
          deficiencyDeterioratingConcrete: false,
          deficiencyOther: false,
          baffleMaterial: "precast_concrete",
          inletBaffleCondition: "present_operational",
          outletBaffleCondition: "present_operational",
          interiorBaffleCondition: "not_present",
          effluentFilterPresent: "present",
          effluentFilterServiced: "serviced",
        },
      ],
      septicTankComments: "Tank in good condition",
    },
    disposalWorks: {
      disposalWorksLocationDetermined: "yes",
      disposalWorksLocationNotDeterminedReason: "",
      disposalType: "trench",
      disposalTypeOther: "",
      distributionMethod: "distribution_box",
      supplyLineMaterial: "pvc",
      supplyLineMaterialOther: "",
      distributionComponentInspected: "yes",
      inspectionPortsPresent: "present",
      numberOfPorts: "4",
      portDepths: ["12", "14", "12", "13"],
      hydraulicLoadTestPerformed: "yes",
      hasDisposalDeficiency: "no",
      defCrushedOutletPipe: false,
      defRootInvasion: false,
      defHighWaterLines: false,
      defDboxNotFunctioning: false,
      defSurfacing: false,
      defLushVegetation: false,
      defErosion: false,
      defPondingWater: false,
      defAnimalIntrusion: false,
      defLoadTestFailure: false,
      defCouldNotDetermine: false,
      repairsRecommended: "no",
      disposalWorksComments: "Disposal works functioning properly",
      signatureDate: "03/01/2026",
      printedName: "Daniel Endres",
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("mapFormDataToFields", () => {
  describe("with empty form data", () => {
    it("returns valid FormFieldMapping with empty strings for text fields", () => {
      const data = makeEmptyFormData();
      const result = mapFormDataToFields(data);

      expect(result).toHaveProperty("textFields");
      expect(result).toHaveProperty("checkboxFields");
      expect(result).toHaveProperty("radioFields");
      expect(result).toHaveProperty("overflow");

      // All text field values should be empty strings
      for (const [, value] of Object.entries(result.textFields)) {
        expect(value).toBe("");
      }
    });

    it("returns all checkbox fields as false", () => {
      const data = makeEmptyFormData();
      const result = mapFormDataToFields(data);

      for (const [, value] of Object.entries(result.checkboxFields)) {
        expect(value).toBe(false);
      }
    });

    it("returns no radio field selections", () => {
      const data = makeEmptyFormData();
      const result = mapFormDataToFields(data);

      expect(Object.keys(result.radioFields)).toHaveLength(0);
    });

    it("has no overflow", () => {
      const data = makeEmptyFormData();
      const result = mapFormDataToFields(data);

      expect(result.overflow.hasOverflow).toBe(false);
      expect(result.overflow.overflowSections).toHaveLength(0);
    });
  });

  describe("text field mapping with full data", () => {
    let result: FormFieldMapping;

    beforeAll(() => {
      result = mapFormDataToFields(makeFullFormData());
    });

    it("maps header fields correctly", () => {
      expect(result.textFields.taxParcelNo).toBe("123-45-678");
      expect(result.textFields.inspectionDate).toBe("03/01/2026");
      expect(result.textFields.inspectorInitials).toBe("DE");
    });

    it("maps property info fields", () => {
      expect(result.textFields.propertyName).toBe("Test Property");
      expect(result.textFields.propertyAddress).toBe("123 Main St");
      expect(result.textFields.propertyCity).toBe("Phoenix");
      expect(result.textFields.propertyCounty).toBe("Maricopa");
    });

    it("maps seller fields", () => {
      expect(result.textFields.sellerName).toBe("John Seller");
      expect(result.textFields.sellerAddress).toBe("456 Oak Ave");
      expect(result.textFields.sellerCity).toBe("Tempe");
      expect(result.textFields.sellerState).toBe("AZ");
      expect(result.textFields.sellerZip).toBe("85281");
    });

    it("maps inspector fields", () => {
      expect(result.textFields.inspectorName).toBe("Daniel Endres");
      expect(result.textFields.inspectorAddress).toBe("2375 E Camelback Rd");
      expect(result.textFields.inspectorCity).toBe("Phoenix");
      expect(result.textFields.inspectorState).toBe("AZ");
      expect(result.textFields.inspectorZip).toBe("85016");
      expect(result.textFields.inspectorCompany).toBe("SewerTime Septic");
    });

    it("maps qualification text fields", () => {
      expect(result.textFields.adeqCourseDescription).toBe("NAWT 15805 ITC");
      expect(result.textFields.adeqCourseDate).toBe("01/15/2024");
      expect(result.textFields.contractorLicenseCategory).toBe("CR-37");
      expect(result.textFields.pumperTruckRegistration).toBe("ADEQ Truck #2833");
      expect(result.textFields.employeeName).toBe("Daniel Endres");
    });

    it("maps records text fields", () => {
      expect(result.textFields.dischargePermitNo).toBe("DAP-001");
      expect(result.textFields.approvalPermitNo).toBe("AC-002");
      expect(result.textFields.recordsOtherDescription).toBe("Maintenance records");
    });

    it("maps facility info text fields", () => {
      expect(result.textFields.numberOfSystems).toBe("1");
      expect(result.textFields.facilityAge).toBe("15 years");
      expect(result.textFields.facilityAgeExplanation).toBe("Per county records");
    });

    it("maps water source distance", () => {
      expect(result.textFields.wellDistance).toBe("100 ft");
    });

    it("maps design flow text fields", () => {
      expect(result.textFields.estimatedDesignFlow).toBe("300");
      expect(result.textFields.numberOfBedrooms).toBe("3");
      expect(result.textFields.fixtureCount).toBe("12");
    });

    it("maps tank-related text fields", () => {
      expect(result.textFields.tankLiquidLevel).toBe("Normal");
      expect(result.textFields.primaryScumThickness).toBe("2 inches");
      expect(result.textFields.primarySludgeThickness).toBe("4 inches");
      expect(result.textFields.tankCapacity).toBe("1000");
      expect(result.textFields.tankDimensions).toBe("5x8x5");
    });

    it("maps pumping text fields", () => {
      expect(result.textFields.haulerCompany).toBe("Sewer Time Septic & Drain");
      expect(result.textFields.haulerLicense).toBe("2833");
    });

    it("maps tank inspection date", () => {
      expect(result.textFields.tankInspectionDate).toBe("03/01/2026");
    });

    it("falls back to overall inspection date when tank inspection date is empty", () => {
      const data = makeFullFormData();
      data.septicTank.tankInspectionDate = "";
      const r = mapFormDataToFields(data);
      expect(r.textFields.tankInspectionDate).toBe("03/01/2026");
    });

    it("maps disposal works text fields", () => {
      expect(result.textFields.numberOfPorts).toBe("4");
      expect(result.textFields.portDepth1).toBe("12");
      expect(result.textFields.portDepth2).toBe("14");
      expect(result.textFields.portDepth3).toBe("12");
      expect(result.textFields.portDepth4).toBe("13");
    });

    it("maps port depths with missing ports as empty strings", () => {
      expect(result.textFields.portDepth5).toBe("");
      expect(result.textFields.portDepth6).toBe("");
      expect(result.textFields.portDepth7).toBe("");
      expect(result.textFields.portDepth8).toBe("");
    });

    it("maps signature printed name", () => {
      expect(result.textFields.conventionalPrintedName).toBe("Daniel Endres");
    });
  });

  describe("inspector initials", () => {
    it("generates correct initials from full name", () => {
      const data = makeEmptyFormData();
      data.facilityInfo.inspectorName = "Daniel Endres";
      const result = mapFormDataToFields(data);
      expect(result.textFields.inspectorInitials).toBe("DE");
    });

    it("generates single initial from single name", () => {
      const data = makeEmptyFormData();
      data.facilityInfo.inspectorName = "Daniel";
      const result = mapFormDataToFields(data);
      expect(result.textFields.inspectorInitials).toBe("D");
    });

    it("generates three initials from triple-barrel name", () => {
      const data = makeEmptyFormData();
      data.facilityInfo.inspectorName = "John Paul Smith";
      const result = mapFormDataToFields(data);
      expect(result.textFields.inspectorInitials).toBe("JPS");
    });

    it("returns empty string for empty inspector name", () => {
      const data = makeEmptyFormData();
      data.facilityInfo.inspectorName = "";
      const result = mapFormDataToFields(data);
      expect(result.textFields.inspectorInitials).toBe("");
    });

    it("uppercases initials even if name is lowercase", () => {
      const data = makeEmptyFormData();
      data.facilityInfo.inspectorName = "john smith";
      const result = mapFormDataToFields(data);
      expect(result.textFields.inspectorInitials).toBe("JS");
    });
  });

  describe("checkbox field mapping", () => {
    it("maps qualification checkboxes", () => {
      const data = makeFullFormData();
      const result = mapFormDataToFields(data);

      expect(result.checkboxFields.qualAdeqCourse).toBe(true);
      expect(result.checkboxFields.qualProfessionalEngineer).toBe(false);
      expect(result.checkboxFields.qualRegisteredSanitarian).toBe(false);
      expect(result.checkboxFields.qualWastewaterOperator).toBe(false);
      expect(result.checkboxFields.qualLicensedContractor).toBe(true);
      expect(result.checkboxFields.qualPumperTruck).toBe(true);
    });

    it("maps records checkboxes", () => {
      const data = makeFullFormData();
      const result = mapFormDataToFields(data);

      expect(result.checkboxFields.recordsDischargeAuth).toBe(true);
      expect(result.checkboxFields.recordsApprovalOfConstruction).toBe(true);
      expect(result.checkboxFields.recordsSitePlan).toBe(true);
      expect(result.checkboxFields.recordsOperationDocs).toBe(true);
      expect(result.checkboxFields.recordsOther).toBe(true);
    });

    it("maps facility serves checkboxes for single_family", () => {
      const data = makeEmptyFormData();
      data.facilityInfo.facilityType = "single_family";
      const result = mapFormDataToFields(data);

      expect(result.checkboxFields.facilityServesResidence).toBe(true);
      expect(result.checkboxFields.facilityServesSingleFamily).toBe(true);
      expect(result.checkboxFields.facilityServesMultiFamily).toBe(false);
      expect(result.checkboxFields.facilityServesCommercial).toBe(false);
      expect(result.checkboxFields.facilityServesOther).toBe(false);
    });

    it("maps facility serves checkboxes for multifamily", () => {
      const data = makeEmptyFormData();
      data.facilityInfo.facilityType = "multifamily";
      const result = mapFormDataToFields(data);

      expect(result.checkboxFields.facilityServesResidence).toBe(true);
      expect(result.checkboxFields.facilityServesSingleFamily).toBe(false);
      expect(result.checkboxFields.facilityServesMultiFamily).toBe(true);
    });

    it("maps facility serves checkboxes for commercial", () => {
      const data = makeEmptyFormData();
      data.facilityInfo.facilityType = "commercial";
      const result = mapFormDataToFields(data);

      expect(result.checkboxFields.facilityServesResidence).toBe(false);
      expect(result.checkboxFields.facilityServesCommercial).toBe(true);
    });

    it("maps facility type checkboxes", () => {
      const data = makeEmptyFormData();
      data.facilityInfo.facilitySystemTypes = ["conventional", "alternative"];
      const result = mapFormDataToFields(data);

      expect(result.checkboxFields.facilityTypeConventional).toBe(true);
      expect(result.checkboxFields.facilityTypeAlternative).toBe(true);
      expect(result.checkboxFields.facilityTypeGrayWater).toBe(false);
    });

    it("maps water source checkboxes", () => {
      const data = makeEmptyFormData();
      data.facilityInfo.waterSource = "private_well";
      const result = mapFormDataToFields(data);

      expect(result.checkboxFields.waterSourcePrivateWell).toBe(true);
      expect(result.checkboxFields.waterSourceMunicipal).toBe(false);
      expect(result.checkboxFields.waterSourceHauled).toBe(false);
      expect(result.checkboxFields.waterSourcePrivateCompany).toBe(false);
      expect(result.checkboxFields.waterSourceSharedWell).toBe(false);
    });

    it("maps wastewater source checkboxes", () => {
      const data = makeEmptyFormData();
      data.facilityInfo.wastewaterSource = "commercial";
      const result = mapFormDataToFields(data);

      expect(result.checkboxFields.wastewaterCommercial).toBe(true);
      expect(result.checkboxFields.wastewaterResidential).toBe(false);
      expect(result.checkboxFields.wastewaterOther).toBe(false);
    });

    it("maps occupancy checkboxes", () => {
      const data = makeEmptyFormData();
      data.facilityInfo.occupancyType = "seasonal";
      const result = mapFormDataToFields(data);

      expect(result.checkboxFields.occupancySeasonalPartTime).toBe(true);
      expect(result.checkboxFields.occupancyFullTime).toBe(false);
      expect(result.checkboxFields.occupancyVacant).toBe(false);
      expect(result.checkboxFields.occupancyUnknown).toBe(false);
    });

    it("maps GP system type checkboxes", () => {
      const data = makeEmptyFormData();
      data.generalTreatment.systemTypes = [
        "gp402_conventional",
        "gp405_gravelless",
        "gp415_aerobic",
      ];
      const result = mapFormDataToFields(data);

      expect(result.checkboxFields[GP_SYSTEM_TYPES.gp402Conventional]).toBe(true);
      expect(result.checkboxFields[GP_SYSTEM_TYPES.gp405GravellessTrench]).toBe(true);
      expect(result.checkboxFields[GP_SYSTEM_TYPES.gp415Aerobic]).toBe(true);
      expect(result.checkboxFields[GP_SYSTEM_TYPES.gp402SepticTank]).toBe(false);
      expect(result.checkboxFields[GP_SYSTEM_TYPES.gp410SandFilter]).toBe(false);
    });

    it("maps all 27 GP system type checkboxes when all selected", () => {
      const data = makeEmptyFormData();
      data.generalTreatment.systemTypes = [
        "gp402_conventional", "gp402_septic_tank", "gp402_disposal_trench",
        "gp402_disposal_bed", "gp402_chamber", "gp402_seepage_pit",
        "gp403_composting", "gp404_pressure", "gp405_gravelless",
        "gp406_natural_evap", "gp407_lined_evap", "gp408_mound",
        "gp409_engineered_pad", "gp410_sand_filter", "gp411_peat_filter",
        "gp412_textile_filter", "gp413_denitrifying", "gp414_sewage_vault",
        "gp415_aerobic", "gp416_nitrate_filter", "gp417_cap",
        "gp418_wetland", "gp419_sand_lined", "gp420_disinfection",
        "gp421_surface", "gp422_drip", "gp423_large_flow",
      ];
      const result = mapFormDataToFields(data);

      // Every GP system type checkbox should be true
      for (const key of Object.values(GP_SYSTEM_TYPES)) {
        expect(result.checkboxFields[key]).toBe(true);
      }
    });

    it("maps design flow checkboxes", () => {
      const data = makeFullFormData();
      const result = mapFormDataToFields(data);

      expect(result.checkboxFields.designFlowBasisCalculated).toBe(true);
      expect(result.checkboxFields.designFlowBasisBedrooms).toBe(true);
      expect(result.checkboxFields.designFlowBasisFixtures).toBe(true);
      expect(result.checkboxFields.designFlowBasisNonDwelling).toBe(false);
      expect(result.checkboxFields.actualFlowNotExceed).toBe(true);
      expect(result.checkboxFields.actualFlowMayExceed).toBe(false);
    });

    it("maps design flow unknown checkbox", () => {
      const data = makeEmptyFormData();
      data.designFlow.designFlowBasis = "unknown";
      const result = mapFormDataToFields(data);
      expect(result.checkboxFields.designFlowUnknown).toBe(true);
    });

    it("maps actual flow unknown checkbox", () => {
      const data = makeEmptyFormData();
      data.designFlow.actualFlowEvaluation = "unknown";
      const result = mapFormDataToFields(data);
      expect(result.checkboxFields.actualFlowUnknown).toBe(true);
      expect(result.checkboxFields.designFlowUnknown).toBe(true);
    });

    it("maps pumping not performed reason checkboxes", () => {
      const data = makeEmptyFormData();
      data.septicTank.pumpingNotPerformedReason = "discharge_auth";
      let result = mapFormDataToFields(data);
      expect(result.checkboxFields.pumpingNotPerformedDischargeAuth).toBe(true);
      expect(result.checkboxFields.pumpingNotPerformedNotNecessary).toBe(false);

      data.septicTank.pumpingNotPerformedReason = "not_necessary";
      result = mapFormDataToFields(data);
      expect(result.checkboxFields.pumpingNotPerformedNotNecessary).toBe(true);

      data.septicTank.pumpingNotPerformedReason = "no_accumulation";
      result = mapFormDataToFields(data);
      expect(result.checkboxFields.pumpingNotPerformedNoAccumulation).toBe(true);
    });

    it("maps tank material checkboxes", () => {
      const data = makeFullFormData();
      const result = mapFormDataToFields(data);

      expect(result.checkboxFields.materialPrecastConcrete).toBe(true);
      expect(result.checkboxFields.materialFiberglass).toBe(false);
      expect(result.checkboxFields.materialPlastic).toBe(false);
      expect(result.checkboxFields.materialSteel).toBe(false);
      expect(result.checkboxFields.materialCastInPlace).toBe(false);
      expect(result.checkboxFields.materialOther).toBe(false);
    });

    it("maps tank deficiency checkboxes", () => {
      const data = makeEmptyFormData();
      data.septicTank.tanks = [
        {
          liquidLevel: "",
          primaryScumThickness: "",
          primarySludgeThickness: "",
          secondaryScumThickness: "",
          secondarySludgeThickness: "",
          liquidLevelNotDetermined: false,
          tankDimensions: "",
          tankCapacity: "",
          capacityBasis: "",
          capacityNotDeterminedReason: "",
          tankMaterial: "",
          tankMaterialOther: "",
          accessOpenings: "",
          accessOpeningsOther: "",
          lidsRisersPresent: "",
          lidsSecurelyFastened: "",
          numberOfCompartments: "",
          compartmentsOther: "",
          compromisedTank: "",
          deficiencyRootInvasion: true,
          deficiencyExposedRebar: true,
          deficiencyCracks: false,
          deficiencyDamagedInlet: false,
          deficiencyDamagedOutlet: false,
          deficiencyDamagedLids: false,
          deficiencyDeterioratingConcrete: true,
          deficiencyOther: false,
          baffleMaterial: "",
          inletBaffleCondition: "",
          outletBaffleCondition: "",
          interiorBaffleCondition: "",
          effluentFilterPresent: "",
          effluentFilterServiced: "",
        },
      ];
      const result = mapFormDataToFields(data);

      expect(result.checkboxFields.defRootInvasion).toBe(true);
      expect(result.checkboxFields.defExposedRebar).toBe(true);
      expect(result.checkboxFields.defDeterioratingConcrete).toBe(true);
      expect(result.checkboxFields.defCracksInTank).toBe(false);
      expect(result.checkboxFields.defDamagedInletPipe).toBe(false);
    });

    it("maps baffle condition checkboxes correctly", () => {
      const data = makeFullFormData();
      const result = mapFormDataToFields(data);

      // Inlet baffle: present_operational
      expect(result.checkboxFields.inletBafflePresent).toBe(true);
      expect(result.checkboxFields.inletBaffleOperational).toBe(true);
      expect(result.checkboxFields.inletBaffleNotOperational).toBe(false);
      expect(result.checkboxFields.inletBaffleNotPresent).toBe(false);
      expect(result.checkboxFields.inletBaffleNotDetermined).toBe(false);

      // Outlet baffle: present_operational
      expect(result.checkboxFields.outletBafflePresent).toBe(true);
      expect(result.checkboxFields.outletBaffleOperational).toBe(true);

      // Interior baffle: not_present
      expect(result.checkboxFields.interiorBafflePresent).toBe(false);
      expect(result.checkboxFields.interiorBaffleNotPresent).toBe(true);
    });

    it("maps baffle present correctly for present_not_operational", () => {
      const data = makeFullFormData();
      data.septicTank.tanks[0].inletBaffleCondition = "present_not_operational";
      const result = mapFormDataToFields(data);

      expect(result.checkboxFields.inletBafflePresent).toBe(true);
      expect(result.checkboxFields.inletBaffleOperational).toBe(false);
      expect(result.checkboxFields.inletBaffleNotOperational).toBe(true);
    });

    it("maps effluent filter checkboxes", () => {
      const data = makeFullFormData();
      const result = mapFormDataToFields(data);

      expect(result.checkboxFields.effluentFilterPresent).toBe(true);
      expect(result.checkboxFields.effluentFilterNotPresent).toBe(false);
      expect(result.checkboxFields.effluentFilterServiced).toBe(true);
      expect(result.checkboxFields.effluentFilterNotServiced).toBe(false);
    });

    it("maps disposal type checkboxes", () => {
      const data = makeFullFormData();
      const result = mapFormDataToFields(data);

      expect(result.checkboxFields.disposalTypeTrench).toBe(true);
      expect(result.checkboxFields.disposalTypeBed).toBe(false);
      expect(result.checkboxFields.disposalTypeChamber).toBe(false);
      expect(result.checkboxFields.disposalTypeSeepagePit).toBe(false);
      expect(result.checkboxFields.disposalTypeOther).toBe(false);
    });

    it("maps distribution method checkboxes", () => {
      const data = makeFullFormData();
      const result = mapFormDataToFields(data);

      expect(result.checkboxFields.distributionBox).toBe(true);
      expect(result.checkboxFields.distributionDiversionValve).toBe(false);
      expect(result.checkboxFields.distributionDropBox).toBe(false);
      expect(result.checkboxFields.distributionManifold).toBe(false);
      expect(result.checkboxFields.distributionSerialLoading).toBe(false);
      expect(result.checkboxFields.distributionPressurized).toBe(false);
      expect(result.checkboxFields.distributionUnknown).toBe(false);
    });

    it("maps supply line material checkboxes", () => {
      const data = makeFullFormData();
      const result = mapFormDataToFields(data);

      expect(result.checkboxFields.supplyLinePVC).toBe(true);
      expect(result.checkboxFields.supplyLineOrangeburg).toBe(false);
      expect(result.checkboxFields.supplyLineTile).toBe(false);
      expect(result.checkboxFields.supplyLineOther).toBe(false);
    });

    it("maps disposal deficiency checkboxes when deficiencies exist", () => {
      const data = makeEmptyFormData();
      data.disposalWorks.defCrushedOutletPipe = true;
      data.disposalWorks.defSurfacing = true;
      data.disposalWorks.defErosion = true;
      const result = mapFormDataToFields(data);

      expect(result.checkboxFields.dwDefCrushedOutletPipe).toBe(true);
      expect(result.checkboxFields.dwDefSurfacing).toBe(true);
      expect(result.checkboxFields.dwDefErosion).toBe(true);
      expect(result.checkboxFields.dwDefRootInvasion).toBe(false);
      expect(result.checkboxFields.dwDefPondingWater).toBe(false);
    });
  });

  describe("radio field mapping", () => {
    it("maps records available radio", () => {
      const data = makeEmptyFormData();
      data.facilityInfo.recordsAvailable = "yes";
      let result = mapFormDataToFields(data);
      expect(result.radioFields[RECORDS.recordsAvailable]).toBe(RECORDS.recordsAvailableOptions.yes);

      data.facilityInfo.recordsAvailable = "no";
      result = mapFormDataToFields(data);
      expect(result.radioFields[RECORDS.recordsAvailable]).toBe(RECORDS.recordsAvailableOptions.no);
    });

    it("does not set radio when records available is empty", () => {
      const data = makeEmptyFormData();
      const result = mapFormDataToFields(data);
      expect(result.radioFields[RECORDS.recordsAvailable]).toBeUndefined();
    });

    it("maps cesspool radio", () => {
      const data = makeEmptyFormData();
      data.facilityInfo.isCesspool = "yes";
      let result = mapFormDataToFields(data);
      expect(result.radioFields[CESSPOOL.isCesspool]).toBe(CESSPOOL.isCesspoolOptions.yes);

      data.facilityInfo.isCesspool = "no";
      result = mapFormDataToFields(data);
      expect(result.radioFields[CESSPOOL.isCesspool]).toBe(CESSPOOL.isCesspoolOptions.no);
    });

    it("maps condition summary radios", () => {
      const data = makeFullFormData();
      const result = mapFormDataToFields(data);

      expect(result.radioFields[CONDITION_SUMMARY.septicTank]).toBe(
        CONDITION_SUMMARY.septicTankOptions.operational,
      );
      expect(result.radioFields[CONDITION_SUMMARY.disposalWorks]).toBe(
        CONDITION_SUMMARY.disposalWorksOptions.concerns,
      );
    });

    it("maps condition radio for not_operational", () => {
      const data = makeEmptyFormData();
      data.facilityInfo.septicTankCondition = "not_operational";
      const result = mapFormDataToFields(data);
      expect(result.radioFields[CONDITION_SUMMARY.septicTank]).toBe(
        CONDITION_SUMMARY.septicTankOptions.notOperational,
      );
    });

    it("maps performance assurance plan radio", () => {
      const data = makeEmptyFormData();
      data.generalTreatment.hasPerformanceAssurancePlan = "yes";
      let result = mapFormDataToFields(data);
      expect(result.radioFields[PERFORMANCE_ASSURANCE.plan]).toBe(
        PERFORMANCE_ASSURANCE.planOptions.yes,
      );

      data.generalTreatment.hasPerformanceAssurancePlan = "no";
      result = mapFormDataToFields(data);
      expect(result.radioFields[PERFORMANCE_ASSURANCE.plan]).toBe(
        PERFORMANCE_ASSURANCE.planOptions.no,
      );
    });

    it("maps number of tanks radio", () => {
      const data = makeEmptyFormData();
      data.septicTank.numberOfTanks = "1";
      let result = mapFormDataToFields(data);
      expect(result.radioFields[TANK_COUNT.numberOfTanks]).toBe(
        TANK_COUNT.numberOfTanksOptions.one,
      );

      data.septicTank.numberOfTanks = "2";
      result = mapFormDataToFields(data);
      expect(result.radioFields[TANK_COUNT.numberOfTanks]).toBe(
        TANK_COUNT.numberOfTanksOptions.two,
      );

      data.septicTank.numberOfTanks = "3";
      result = mapFormDataToFields(data);
      expect(result.radioFields[TANK_COUNT.numberOfTanks]).toBe(
        TANK_COUNT.numberOfTanksOptions.two,
      );
    });

    it("maps tanks pumped radio", () => {
      const data = makeEmptyFormData();
      data.septicTank.tanksPumped = "yes";
      let result = mapFormDataToFields(data);
      expect(result.radioFields[PUMPING.tanksPumped]).toBe(PUMPING.tanksPumpedOptions.yes);

      data.septicTank.tanksPumped = "no";
      result = mapFormDataToFields(data);
      expect(result.radioFields[PUMPING.tanksPumped]).toBe(PUMPING.tanksPumpedOptions.no);
    });

    it("maps access openings radio", () => {
      const data = makeFullFormData();
      const result = mapFormDataToFields(data);

      expect(result.radioFields[ACCESS_OPENINGS.accessOpenings]).toBe(
        ACCESS_OPENINGS.accessOpeningsOptions.two,
      );
    });

    it("maps all access openings options", () => {
      const data = makeFullFormData();

      for (const [key, expected] of [
        ["one", ACCESS_OPENINGS.accessOpeningsOptions.one],
        ["two", ACCESS_OPENINGS.accessOpeningsOptions.two],
        ["three", ACCESS_OPENINGS.accessOpeningsOptions.three],
        ["other", ACCESS_OPENINGS.accessOpeningsOptions.other],
      ] as const) {
        data.septicTank.tanks[0].accessOpenings = key;
        const result = mapFormDataToFields(data);
        expect(result.radioFields[ACCESS_OPENINGS.accessOpenings]).toBe(expected);
      }
    });

    it("maps lids present radio", () => {
      const data = makeFullFormData();
      let result = mapFormDataToFields(data);
      expect(result.radioFields[LIDS_RISERS.lidsPresent]).toBe(
        LIDS_RISERS.lidsPresentOptions.yes,
      );

      data.septicTank.tanks[0].lidsRisersPresent = "not_present";
      result = mapFormDataToFields(data);
      expect(result.radioFields[LIDS_RISERS.lidsPresent]).toBe(
        LIDS_RISERS.lidsPresentOptions.no,
      );
    });

    it("maps lids securely fastened radio", () => {
      const data = makeFullFormData();
      const result = mapFormDataToFields(data);
      expect(result.radioFields[LIDS_RISERS.lidsSecurelyFastened]).toBe(
        LIDS_RISERS.lidsSecurelyFastenedOptions.yes,
      );
    });

    it("maps compartments radio", () => {
      const data = makeFullFormData();
      let result = mapFormDataToFields(data);
      expect(result.radioFields[COMPARTMENTS.compartments]).toBe(
        COMPARTMENTS.compartmentsOptions.one,
      );

      data.septicTank.tanks[0].numberOfCompartments = "two";
      result = mapFormDataToFields(data);
      expect(result.radioFields[COMPARTMENTS.compartments]).toBe(
        COMPARTMENTS.compartmentsOptions.two,
      );

      data.septicTank.tanks[0].numberOfCompartments = "other";
      result = mapFormDataToFields(data);
      expect(result.radioFields[COMPARTMENTS.compartments]).toBe(
        COMPARTMENTS.compartmentsOptions.other,
      );
    });

    it("maps compromised tank radio", () => {
      const data = makeFullFormData();
      const result = mapFormDataToFields(data);
      expect(result.radioFields[COMPROMISED_TANK.compromisedTank]).toBe(
        COMPROMISED_TANK.compromisedTankOptions.no,
      );
    });

    it("maps disposal location radio", () => {
      const data = makeFullFormData();
      const result = mapFormDataToFields(data);
      expect(result.radioFields[DISPOSAL_LOCATION.locationDetermined]).toBe(
        DISPOSAL_LOCATION.locationDeterminedOptions.yes,
      );
    });

    it("maps distribution inspected radio", () => {
      const data = makeFullFormData();
      const result = mapFormDataToFields(data);
      expect(result.radioFields[DISTRIBUTION_INSPECTION.inspected]).toBe(
        DISTRIBUTION_INSPECTION.inspectedOptions.yes,
      );
    });

    it("maps inspection ports present radio", () => {
      const data = makeFullFormData();
      let result = mapFormDataToFields(data);
      expect(result.radioFields[INSPECTION_PORTS.present]).toBe(
        INSPECTION_PORTS.presentOptions.yes,
      );

      data.disposalWorks.inspectionPortsPresent = "not_present";
      result = mapFormDataToFields(data);
      expect(result.radioFields[INSPECTION_PORTS.present]).toBe(
        INSPECTION_PORTS.presentOptions.no,
      );
    });

    it("maps hydraulic load test radio", () => {
      const data = makeFullFormData();
      const result = mapFormDataToFields(data);
      expect(result.radioFields[HYDRAULIC_LOAD.test]).toBe(
        HYDRAULIC_LOAD.testOptions.yes,
      );
    });

    it("maps disposal deficiency radio", () => {
      const data = makeFullFormData();
      const result = mapFormDataToFields(data);
      expect(result.radioFields[DISPOSAL_DEFICIENCY.hasDeficiency]).toBe(
        DISPOSAL_DEFICIENCY.hasDeficiencyOptions.no,
      );
    });

    it("maps repairs recommended radio", () => {
      const data = makeFullFormData();
      const result = mapFormDataToFields(data);
      expect(result.radioFields[DISPOSAL_REPAIRS.recommended]).toBe(
        DISPOSAL_REPAIRS.recommendedOptions.no,
      );
    });
  });

  describe("null/undefined handling", () => {
    it("handles undefined facilityInfo gracefully", () => {
      const data = makeEmptyFormData();
      // @ts-expect-error Testing runtime safety
      data.facilityInfo = undefined;
      const result = mapFormDataToFields(data);
      expect(result.textFields.propertyName).toBe("");
      expect(result.textFields.inspectorInitials).toBe("");
    });

    it("handles undefined septicTank gracefully", () => {
      const data = makeEmptyFormData();
      // @ts-expect-error Testing runtime safety
      data.septicTank = undefined;
      const result = mapFormDataToFields(data);
      expect(result.textFields.haulerCompany).toBe("");
    });

    it("handles undefined disposalWorks gracefully", () => {
      const data = makeEmptyFormData();
      // @ts-expect-error Testing runtime safety
      data.disposalWorks = undefined;
      const result = mapFormDataToFields(data);
      expect(result.textFields.numberOfPorts).toBe("");
    });

    it("handles undefined designFlow gracefully", () => {
      const data = makeEmptyFormData();
      // @ts-expect-error Testing runtime safety
      data.designFlow = undefined;
      const result = mapFormDataToFields(data);
      expect(result.textFields.estimatedDesignFlow).toBe("");
    });

    it("handles empty tanks array gracefully", () => {
      const data = makeEmptyFormData();
      data.septicTank.tanks = [];
      const result = mapFormDataToFields(data);
      expect(result.textFields.tankCapacity).toBe("");
      expect(result.textFields.tankLiquidLevel).toBe("");
    });
  });

  describe("special characters in field values", () => {
    it("passes through special characters in text fields", () => {
      const data = makeEmptyFormData();
      data.facilityInfo.facilityName = "O'Brien & Sons (LLC) — Test™";
      data.facilityInfo.facilityAddress = '123 "Main" St, #4';
      const result = mapFormDataToFields(data);

      expect(result.textFields.propertyName).toBe("O'Brien & Sons (LLC) — Test™");
      expect(result.textFields.propertyAddress).toBe('123 "Main" St, #4');
    });

    it("handles unicode characters", () => {
      const data = makeEmptyFormData();
      data.facilityInfo.facilityName = "José García Propiedad";
      data.facilityInfo.sellerName = "田中太郎";
      const result = mapFormDataToFields(data);

      expect(result.textFields.propertyName).toBe("José García Propiedad");
      expect(result.textFields.sellerName).toBe("田中太郎");
    });

    it("handles newlines in comment text fields", () => {
      const data = makeEmptyFormData();
      data.designFlow.designFlowComments = "Line 1\nLine 2\nLine 3";
      const result = mapFormDataToFields(data);
      expect(result.textFields.designFlowComments).toBe("Line 1\nLine 2\nLine 3");
    });
  });

  describe("wastewater source 'other' text mapping", () => {
    it("sets wastewaterOtherText to 'Other' when source is 'other'", () => {
      const data = makeEmptyFormData();
      data.facilityInfo.wastewaterSource = "other";
      const result = mapFormDataToFields(data);
      expect(result.textFields.wastewaterOtherText).toBe("Other");
    });

    it("sets wastewaterOtherText to empty when source is not 'other'", () => {
      const data = makeEmptyFormData();
      data.facilityInfo.wastewaterSource = "residential";
      const result = mapFormDataToFields(data);
      expect(result.textFields.wastewaterOtherText).toBe("");
    });
  });

  describe("capacity basis checkbox mapping", () => {
    it("maps all capacity basis options correctly", () => {
      const data = makeFullFormData();

      const basisOptions = [
        { value: "measurement", field: "capacityBasisMeasurement" },
        { value: "volume_pumped", field: "capacityBasisVolumePumped" },
        { value: "estimate", field: "capacityBasisEstimate" },
        { value: "permit_document", field: "capacityBasisPermit" },
        { value: "not_determined", field: "capacityBasisNotDetermined" },
      ];

      for (const opt of basisOptions) {
        data.septicTank.tanks[0].capacityBasis = opt.value;
        const result = mapFormDataToFields(data);
        expect(result.checkboxFields[opt.field]).toBe(true);
        // All others should be false
        for (const other of basisOptions) {
          if (other.field !== opt.field) {
            expect(result.checkboxFields[other.field]).toBe(false);
          }
        }
      }
    });
  });

  describe("primary/secondary chamber measured indicators", () => {
    it("sets primaryChamberMeasured to X when scum thickness is provided", () => {
      const data = makeFullFormData();
      const result = mapFormDataToFields(data);
      expect(result.textFields.primaryChamberMeasured).toBe("X");
    });

    it("leaves primaryChamberMeasured empty when no scum thickness", () => {
      const data = makeFullFormData();
      data.septicTank.tanks[0].primaryScumThickness = "";
      const result = mapFormDataToFields(data);
      expect(result.textFields.primaryChamberMeasured).toBe("");
    });

    it("sets liquidLevelNotDetermined when indicated", () => {
      const data = makeFullFormData();
      data.septicTank.tanks[0].liquidLevelNotDetermined = true;
      const result = mapFormDataToFields(data);
      expect(result.textFields.liquidLevelNotDetermined).toBe("X");
    });
  });
});

// ---------------------------------------------------------------------------
// Comment overflow detection
// ---------------------------------------------------------------------------

describe("detectCommentOverflow", () => {
  it("returns no overflow for short comments", () => {
    const data = makeEmptyFormData();
    data.designFlow.designFlowComments = "Short comment";
    data.septicTank.septicTankComments = "Another short one";
    data.disposalWorks.disposalWorksComments = "Brief note";
    const result = detectCommentOverflow(data);

    expect(result.hasOverflow).toBe(false);
    expect(result.overflowSections).toHaveLength(0);
  });

  it("detects overflow when design flow comment exceeds threshold", () => {
    const data = makeEmptyFormData();
    data.designFlow.designFlowComments = "A".repeat(201);
    const result = detectCommentOverflow(data);

    expect(result.hasOverflow).toBe(true);
    expect(result.overflowSections).toHaveLength(1);
    expect(result.overflowSections[0].section).toBe("Design Flow");
    expect(result.overflowSections[0].fieldName).toBe("designFlowComments");
  });

  it("detects overflow for septic tank comments", () => {
    const data = makeEmptyFormData();
    data.septicTank.septicTankComments = "B".repeat(250);
    const result = detectCommentOverflow(data);

    expect(result.hasOverflow).toBe(true);
    expect(result.overflowSections).toHaveLength(1);
    expect(result.overflowSections[0].section).toBe("Tank");
  });

  it("detects overflow for disposal works comments", () => {
    const data = makeEmptyFormData();
    data.disposalWorks.disposalWorksComments = "C".repeat(300);
    const result = detectCommentOverflow(data);

    expect(result.hasOverflow).toBe(true);
    expect(result.overflowSections).toHaveLength(1);
    expect(result.overflowSections[0].section).toBe("Drainfield");
  });

  it("detects multiple overflowing sections", () => {
    const data = makeEmptyFormData();
    data.designFlow.designFlowComments = "A".repeat(201);
    data.septicTank.septicTankComments = "B".repeat(201);
    data.disposalWorks.disposalWorksComments = "C".repeat(201);
    const result = detectCommentOverflow(data);

    expect(result.hasOverflow).toBe(true);
    expect(result.overflowSections).toHaveLength(3);
  });

  it("does not overflow at exactly 200 characters", () => {
    const data = makeEmptyFormData();
    data.designFlow.designFlowComments = "A".repeat(200);
    const result = detectCommentOverflow(data);
    expect(result.hasOverflow).toBe(false);
  });

  it("overflows at 201 characters", () => {
    const data = makeEmptyFormData();
    data.designFlow.designFlowComments = "A".repeat(201);
    const result = detectCommentOverflow(data);
    expect(result.hasOverflow).toBe(true);
  });

  it("replaces overflowing comment text with 'See Comments' in field mapping", () => {
    const data = makeEmptyFormData();
    const longComment = "A".repeat(300);
    data.designFlow.designFlowComments = longComment;
    const result = mapFormDataToFields(data);

    expect(result.textFields.designFlowComments).toBe("See Comments");
    expect(result.overflow.hasOverflow).toBe(true);
    expect(result.overflow.overflowSections[0].text).toBe(longComment);
  });

  it("keeps short comment text as-is in field mapping", () => {
    const data = makeEmptyFormData();
    data.designFlow.designFlowComments = "Short note";
    const result = mapFormDataToFields(data);
    expect(result.textFields.designFlowComments).toBe("Short note");
  });
});
