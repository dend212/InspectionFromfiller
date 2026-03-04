import { describe, it, expect } from "vitest";
import {
  facilityInfoSchema,
  generalTreatmentSchema,
  designFlowSchema,
  septicTankSchema,
  disposalWorksSchema,
  inspectionFormSchema,
  STEP_FIELDS,
  getDefaultFormValues,
} from "../inspection";
import { INSPECTOR_DEFAULTS } from "@/lib/constants/inspection";

// ============================================================================
// facilityInfoSchema
// ============================================================================

describe("facilityInfoSchema", () => {
  const minValid = {
    facilityName: "Test Property",
    inspectorName: "John Doe",
  };

  it("accepts minimal valid data with defaults applied", () => {
    const result = facilityInfoSchema.safeParse(minValid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.facilityName).toBe("Test Property");
      expect(result.data.inspectorName).toBe("John Doe");
      // Defaults
      expect(result.data.facilityState).toBe("AZ");
      expect(result.data.facilityAddress).toBe("");
      expect(result.data.facilityCity).toBe("");
      expect(result.data.facilityCounty).toBe("");
      expect(result.data.facilityZip).toBe("");
      expect(result.data.taxParcelNumber).toBe("");
      expect(result.data.dateOfInspection).toBe("");
      expect(result.data.sellerName).toBe("");
      expect(result.data.hasAdeqCourse).toBe(false);
      expect(result.data.isProfessionalEngineer).toBe(false);
      expect(result.data.recordsAvailable).toBe("");
      expect(result.data.isCesspool).toBe("");
      expect(result.data.facilitySystemTypes).toEqual([]);
    }
  });

  describe("required fields", () => {
    it("rejects missing facilityName", () => {
      const result = facilityInfoSchema.safeParse({
        inspectorName: "John Doe",
      });
      expect(result.success).toBe(false);
    });

    it("rejects empty facilityName", () => {
      const result = facilityInfoSchema.safeParse({
        facilityName: "",
        inspectorName: "John Doe",
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing inspectorName", () => {
      const result = facilityInfoSchema.safeParse({
        facilityName: "Test",
      });
      expect(result.success).toBe(false);
    });

    it("rejects empty inspectorName", () => {
      const result = facilityInfoSchema.safeParse({
        facilityName: "Test",
        inspectorName: "",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("optional string fields default to empty string", () => {
    const optionalStringFields = [
      "facilityAddress",
      "facilityCity",
      "facilityCounty",
      "facilityZip",
      "taxParcelNumber",
      "dateOfInspection",
      "sellerName",
      "sellerAddress",
      "sellerCity",
      "sellerState",
      "sellerZip",
      "company",
      "companyAddress",
      "companyCity",
      "companyState",
      "companyZip",
      "certificationNumber",
      "registrationNumber",
      "truckNumber",
      "employeeName",
      "adeqCourseDetails",
      "adeqCourseDate",
      "peExpirationDate",
      "rsExpirationDate",
      "operatorGrade",
      "contractorLicenseCategory",
      "pumperTruckRegistration",
      "dischargeAuthPermitNo",
      "approvalPermitNo",
      "otherRecordsDescription",
      "waterSource",
      "wellDistance",
      "wastewaterSource",
      "occupancyType",
      "facilityType",
      "facilityTypeOther",
      "numberOfSystems",
      "facilityAge",
      "facilityAgeEstimateExplanation",
      "septicTankCondition",
      "disposalWorksCondition",
      "alternativeSystemCondition",
      "alternativeDisposalCondition",
    ];

    for (const field of optionalStringFields) {
      it(`defaults ${field} to ""`, () => {
        const result = facilityInfoSchema.safeParse(minValid);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data[field as keyof typeof result.data]).toBe("");
        }
      });
    }
  });

  describe("optional boolean fields default to false", () => {
    const booleanFields = [
      "hasAdeqCourse",
      "isProfessionalEngineer",
      "isRegisteredSanitarian",
      "isWastewaterOperator",
      "isLicensedContractor",
      "hasPumperTruck",
      "hasDischargeAuth",
      "hasApprovalOfConstruction",
      "hasSitePlan",
      "hasOperationDocs",
      "hasOtherRecords",
    ];

    for (const field of booleanFields) {
      it(`defaults ${field} to false`, () => {
        const result = facilityInfoSchema.safeParse(minValid);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data[field as keyof typeof result.data]).toBe(false);
        }
      });
    }
  });

  describe("enum fields", () => {
    it("accepts valid recordsAvailable values", () => {
      for (const val of ["yes", "no", ""] as const) {
        const result = facilityInfoSchema.safeParse({
          ...minValid,
          recordsAvailable: val,
        });
        expect(result.success).toBe(true);
      }
    });

    it("rejects invalid recordsAvailable value", () => {
      const result = facilityInfoSchema.safeParse({
        ...minValid,
        recordsAvailable: "maybe",
      });
      expect(result.success).toBe(false);
    });

    it("accepts valid isCesspool values", () => {
      for (const val of ["yes", "no", ""] as const) {
        const result = facilityInfoSchema.safeParse({
          ...minValid,
          isCesspool: val,
        });
        expect(result.success).toBe(true);
      }
    });

    it("rejects invalid isCesspool value", () => {
      const result = facilityInfoSchema.safeParse({
        ...minValid,
        isCesspool: "unknown",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("array fields", () => {
    it("defaults facilitySystemTypes to empty array", () => {
      const result = facilityInfoSchema.safeParse(minValid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.facilitySystemTypes).toEqual([]);
      }
    });

    it("accepts facilitySystemTypes with values", () => {
      const result = facilityInfoSchema.safeParse({
        ...minValid,
        facilitySystemTypes: ["conventional", "alternative"],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.facilitySystemTypes).toEqual([
          "conventional",
          "alternative",
        ]);
      }
    });
  });

  it("accepts fully populated data", () => {
    const fullData = {
      ...minValid,
      facilityAddress: "123 Main St",
      facilityCity: "Phoenix",
      facilityCounty: "Maricopa",
      facilityState: "AZ",
      facilityZip: "85001",
      taxParcelNumber: "123-45-678",
      dateOfInspection: "2026-03-03",
      sellerName: "Jane Seller",
      sellerAddress: "456 Oak Ave",
      sellerCity: "Tempe",
      sellerState: "AZ",
      sellerZip: "85281",
      company: "SewerTime",
      companyAddress: "789 Test Blvd",
      companyCity: "Scottsdale",
      companyState: "AZ",
      companyZip: "85251",
      certificationNumber: "NAWT #15805",
      registrationNumber: "CR-37",
      truckNumber: "2833",
      employeeName: "John Doe",
      hasAdeqCourse: true,
      adeqCourseDetails: "NAWT 15805 ITC",
      adeqCourseDate: "2024-01-15",
      isProfessionalEngineer: false,
      isRegisteredSanitarian: false,
      isWastewaterOperator: true,
      operatorGrade: "Grade 1",
      isLicensedContractor: true,
      contractorLicenseCategory: "CR-37",
      hasPumperTruck: true,
      pumperTruckRegistration: "2833",
      recordsAvailable: "yes" as const,
      hasDischargeAuth: true,
      dischargeAuthPermitNo: "DIS-001",
      hasApprovalOfConstruction: true,
      approvalPermitNo: "APP-001",
      hasSitePlan: true,
      hasOperationDocs: true,
      hasOtherRecords: true,
      otherRecordsDescription: "Additional docs",
      isCesspool: "no" as const,
      waterSource: "municipal",
      wellDistance: "200ft",
      wastewaterSource: "residential",
      occupancyType: "full_time",
      facilityType: "single_family",
      facilityTypeOther: "",
      facilitySystemTypes: ["conventional"],
      numberOfSystems: "1",
      facilityAge: "20",
      facilityAgeEstimateExplanation: "Per permit records",
      septicTankCondition: "operational",
      disposalWorksCondition: "operational",
      alternativeSystemCondition: "",
      alternativeDisposalCondition: "",
    };
    const result = facilityInfoSchema.safeParse(fullData);
    expect(result.success).toBe(true);
  });

  it("facilityState defaults to AZ", () => {
    const result = facilityInfoSchema.safeParse(minValid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.facilityState).toBe("AZ");
    }
  });
});

// ============================================================================
// generalTreatmentSchema
// ============================================================================

describe("generalTreatmentSchema", () => {
  it("accepts empty object with defaults", () => {
    const result = generalTreatmentSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.systemTypes).toEqual([]);
      expect(result.data.hasPerformanceAssurancePlan).toBe("");
      expect(result.data.alternativeSystem).toBe(false);
      expect(result.data.altSystemManufacturer).toBe("");
      expect(result.data.altSystemModel).toBe("");
      expect(result.data.altSystemCapacity).toBe("");
      expect(result.data.altSystemDateInstalled).toBe("");
      expect(result.data.altSystemCondition).toBe("");
      expect(result.data.altSystemNotes).toBe("");
    }
  });

  it("accepts valid systemTypes array", () => {
    const result = generalTreatmentSchema.safeParse({
      systemTypes: ["gp402_conventional", "gp404_pressure"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.systemTypes).toEqual([
        "gp402_conventional",
        "gp404_pressure",
      ]);
    }
  });

  describe("hasPerformanceAssurancePlan enum", () => {
    it("accepts yes, no, and empty string", () => {
      for (const val of ["yes", "no", ""] as const) {
        const result = generalTreatmentSchema.safeParse({
          hasPerformanceAssurancePlan: val,
        });
        expect(result.success).toBe(true);
      }
    });

    it("rejects invalid value", () => {
      const result = generalTreatmentSchema.safeParse({
        hasPerformanceAssurancePlan: "maybe",
      });
      expect(result.success).toBe(false);
    });
  });

  it("accepts alternativeSystem as boolean", () => {
    const result = generalTreatmentSchema.safeParse({
      alternativeSystem: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.alternativeSystem).toBe(true);
    }
  });

  it("accepts fully populated alternative system data", () => {
    const result = generalTreatmentSchema.safeParse({
      systemTypes: ["gp415_aerobic"],
      hasPerformanceAssurancePlan: "yes",
      alternativeSystem: true,
      altSystemManufacturer: "AquaSafe",
      altSystemModel: "AS-500",
      altSystemCapacity: "500 GPD",
      altSystemDateInstalled: "2020-06-15",
      altSystemCondition: "operational",
      altSystemNotes: "Annual maintenance required",
    });
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// designFlowSchema
// ============================================================================

describe("designFlowSchema", () => {
  it("accepts empty object with defaults", () => {
    const result = designFlowSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.estimatedDesignFlow).toBe("");
      expect(result.data.designFlowBasis).toBe("");
      expect(result.data.numberOfBedrooms).toBe("");
      expect(result.data.fixtureCount).toBe("");
      expect(result.data.nonDwellingGpd).toBe("");
      expect(result.data.actualFlowEvaluation).toBe("");
      expect(result.data.designFlowComments).toBe("");
    }
  });

  it("accepts fully populated data", () => {
    const result = designFlowSchema.safeParse({
      estimatedDesignFlow: "300",
      designFlowBasis: "calculated",
      numberOfBedrooms: "3",
      fixtureCount: "12",
      nonDwellingGpd: "0",
      actualFlowEvaluation: "not_exceed",
      designFlowComments: "Standard residential flow",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.estimatedDesignFlow).toBe("300");
      expect(result.data.numberOfBedrooms).toBe("3");
    }
  });

  it("all fields are optional strings defaulting to empty", () => {
    const result = designFlowSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      const keys = Object.keys(result.data);
      for (const key of keys) {
        expect(result.data[key as keyof typeof result.data]).toBe("");
      }
    }
  });
});

// ============================================================================
// septicTankSchema (including nested tankInspection)
// ============================================================================

describe("septicTankSchema", () => {
  it("accepts empty object with defaults", () => {
    const result = septicTankSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.numberOfTanks).toBe("");
      expect(result.data.tanksPumped).toBe("");
      expect(result.data.haulerCompany).toBe("");
      expect(result.data.haulerLicense).toBe("");
      expect(result.data.pumpingNotPerformedReason).toBe("");
      expect(result.data.tankInspectionDate).toBe("");
      expect(result.data.tanks).toEqual([]);
      expect(result.data.septicTankComments).toBe("");
    }
  });

  describe("tanksPumped enum", () => {
    it("accepts yes, no, and empty string", () => {
      for (const val of ["yes", "no", ""] as const) {
        const result = septicTankSchema.safeParse({ tanksPumped: val });
        expect(result.success).toBe(true);
      }
    });

    it("rejects invalid value", () => {
      const result = septicTankSchema.safeParse({
        tanksPumped: "partial",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("tanks array (nested tankInspectionSchema)", () => {
    const validTank = {
      liquidLevel: "normal",
      primaryScumThickness: "2 inches",
      primarySludgeThickness: "6 inches",
      secondaryScumThickness: "1 inch",
      secondarySludgeThickness: "3 inches",
      liquidLevelNotDetermined: false,
      tankDimensions: "5x8",
      tankCapacity: "1000 gallons",
      capacityBasis: "volume_pumped",
      capacityNotDeterminedReason: "",
      tankMaterial: "precast_concrete",
      tankMaterialOther: "",
      accessOpenings: "2",
      accessOpeningsOther: "",
      lidsRisersPresent: "present" as const,
      lidsSecurelyFastened: "yes" as const,
      numberOfCompartments: "2",
      compartmentsOther: "",
      compromisedTank: "no" as const,
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
      effluentFilterPresent: "present" as const,
      effluentFilterServiced: "serviced" as const,
    };

    it("accepts a tank with full data", () => {
      const result = septicTankSchema.safeParse({
        tanks: [validTank],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tanks).toHaveLength(1);
        expect(result.data.tanks[0].tankMaterial).toBe("precast_concrete");
      }
    });

    it("accepts an empty tank with defaults", () => {
      const result = septicTankSchema.safeParse({
        tanks: [{}],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        const tank = result.data.tanks[0];
        expect(tank.liquidLevel).toBe("");
        expect(tank.liquidLevelNotDetermined).toBe(false);
        expect(tank.tankCapacity).toBe("");
        expect(tank.tankMaterial).toBe("");
        expect(tank.lidsRisersPresent).toBe("");
        expect(tank.lidsSecurelyFastened).toBe("");
        expect(tank.compromisedTank).toBe("");
        expect(tank.deficiencyRootInvasion).toBe(false);
        expect(tank.deficiencyExposedRebar).toBe(false);
        expect(tank.deficiencyCracks).toBe(false);
        expect(tank.deficiencyDamagedInlet).toBe(false);
        expect(tank.deficiencyDamagedOutlet).toBe(false);
        expect(tank.deficiencyDamagedLids).toBe(false);
        expect(tank.deficiencyDeterioratingConcrete).toBe(false);
        expect(tank.deficiencyOther).toBe(false);
        expect(tank.effluentFilterPresent).toBe("");
        expect(tank.effluentFilterServiced).toBe("");
      }
    });

    it("accepts multiple tanks", () => {
      const result = septicTankSchema.safeParse({
        tanks: [{}, {}, {}],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tanks).toHaveLength(3);
      }
    });

    describe("tank enum fields", () => {
      it("lidsRisersPresent accepts present, not_present, empty", () => {
        for (const val of ["present", "not_present", ""] as const) {
          const result = septicTankSchema.safeParse({
            tanks: [{ lidsRisersPresent: val }],
          });
          expect(result.success).toBe(true);
        }
      });

      it("lidsRisersPresent rejects invalid value", () => {
        const result = septicTankSchema.safeParse({
          tanks: [{ lidsRisersPresent: "unknown" }],
        });
        expect(result.success).toBe(false);
      });

      it("lidsSecurelyFastened accepts yes, no, empty", () => {
        for (const val of ["yes", "no", ""] as const) {
          const result = septicTankSchema.safeParse({
            tanks: [{ lidsSecurelyFastened: val }],
          });
          expect(result.success).toBe(true);
        }
      });

      it("compromisedTank accepts yes, no, empty", () => {
        for (const val of ["yes", "no", ""] as const) {
          const result = septicTankSchema.safeParse({
            tanks: [{ compromisedTank: val }],
          });
          expect(result.success).toBe(true);
        }
      });

      it("compromisedTank rejects invalid value", () => {
        const result = septicTankSchema.safeParse({
          tanks: [{ compromisedTank: "maybe" }],
        });
        expect(result.success).toBe(false);
      });

      it("effluentFilterPresent accepts present, not_present, empty", () => {
        for (const val of ["present", "not_present", ""] as const) {
          const result = septicTankSchema.safeParse({
            tanks: [{ effluentFilterPresent: val }],
          });
          expect(result.success).toBe(true);
        }
      });

      it("effluentFilterServiced accepts serviced, not_serviced, empty", () => {
        for (const val of ["serviced", "not_serviced", ""] as const) {
          const result = septicTankSchema.safeParse({
            tanks: [{ effluentFilterServiced: val }],
          });
          expect(result.success).toBe(true);
        }
      });

      it("effluentFilterServiced rejects invalid value", () => {
        const result = septicTankSchema.safeParse({
          tanks: [{ effluentFilterServiced: "cleaned" }],
        });
        expect(result.success).toBe(false);
      });
    });
  });
});

// ============================================================================
// disposalWorksSchema
// ============================================================================

describe("disposalWorksSchema", () => {
  it("accepts empty object with defaults", () => {
    const result = disposalWorksSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.disposalWorksLocationDetermined).toBe("");
      expect(result.data.disposalWorksLocationNotDeterminedReason).toBe("");
      expect(result.data.disposalType).toBe("");
      expect(result.data.disposalTypeOther).toBe("");
      expect(result.data.distributionMethod).toBe("");
      expect(result.data.supplyLineMaterial).toBe("");
      expect(result.data.supplyLineMaterialOther).toBe("");
      expect(result.data.distributionComponentInspected).toBe("");
      expect(result.data.inspectionPortsPresent).toBe("");
      expect(result.data.numberOfPorts).toBe("");
      expect(result.data.portDepths).toEqual([]);
      expect(result.data.hydraulicLoadTestPerformed).toBe("");
      expect(result.data.hasDisposalDeficiency).toBe("");
      expect(result.data.repairsRecommended).toBe("");
      expect(result.data.disposalWorksComments).toBe("");
      expect(result.data.signatureDate).toBe("");
      expect(result.data.printedName).toBe("");
      expect(result.data.signatureDataUrl).toBe("");
    }
  });

  describe("deficiency boolean fields default to false", () => {
    const deficiencyFields = [
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
    ];

    for (const field of deficiencyFields) {
      it(`defaults ${field} to false`, () => {
        const result = disposalWorksSchema.safeParse({});
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data[field as keyof typeof result.data]).toBe(false);
        }
      });
    }
  });

  describe("enum fields", () => {
    const enumFields = [
      "disposalWorksLocationDetermined",
      "distributionComponentInspected",
      "hydraulicLoadTestPerformed",
      "hasDisposalDeficiency",
      "repairsRecommended",
    ];

    for (const field of enumFields) {
      it(`${field} accepts yes, no, empty`, () => {
        for (const val of ["yes", "no", ""] as const) {
          const result = disposalWorksSchema.safeParse({ [field]: val });
          expect(result.success).toBe(true);
        }
      });

      it(`${field} rejects invalid value`, () => {
        const result = disposalWorksSchema.safeParse({
          [field]: "invalid",
        });
        expect(result.success).toBe(false);
      });
    }

    it("inspectionPortsPresent accepts present, not_present, empty", () => {
      for (const val of ["present", "not_present", ""] as const) {
        const result = disposalWorksSchema.safeParse({
          inspectionPortsPresent: val,
        });
        expect(result.success).toBe(true);
      }
    });

    it("inspectionPortsPresent rejects invalid value", () => {
      const result = disposalWorksSchema.safeParse({
        inspectionPortsPresent: "unknown",
      });
      expect(result.success).toBe(false);
    });
  });

  it("portDepths accepts array of strings", () => {
    const result = disposalWorksSchema.safeParse({
      portDepths: ["12 inches", "18 inches", "24 inches"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.portDepths).toEqual([
        "12 inches",
        "18 inches",
        "24 inches",
      ]);
    }
  });

  it("accepts fully populated data", () => {
    const fullData = {
      disposalWorksLocationDetermined: "yes" as const,
      disposalWorksLocationNotDeterminedReason: "",
      disposalType: "trench",
      disposalTypeOther: "",
      distributionMethod: "diversion_valve",
      supplyLineMaterial: "pvc",
      supplyLineMaterialOther: "",
      distributionComponentInspected: "yes" as const,
      inspectionPortsPresent: "present" as const,
      numberOfPorts: "3",
      portDepths: ["12", "18"],
      hydraulicLoadTestPerformed: "yes" as const,
      hasDisposalDeficiency: "no" as const,
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
      repairsRecommended: "no" as const,
      disposalWorksComments: "System in good condition",
      signatureDate: "2026-03-03",
      printedName: "John Doe",
      signatureDataUrl: "data:image/png;base64,abc123",
    };
    const result = disposalWorksSchema.safeParse(fullData);
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// inspectionFormSchema (combined)
// ============================================================================

describe("inspectionFormSchema", () => {
  const minValid = {
    facilityInfo: {
      facilityName: "Test Property",
      inspectorName: "John Doe",
    },
    generalTreatment: {},
    designFlow: {},
    septicTank: {},
    disposalWorks: {},
  };

  it("accepts minimal valid combined form data", () => {
    const result = inspectionFormSchema.safeParse(minValid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.facilityInfo.facilityName).toBe("Test Property");
      expect(result.data.generalTreatment.systemTypes).toEqual([]);
      expect(result.data.designFlow.estimatedDesignFlow).toBe("");
      expect(result.data.septicTank.tanks).toEqual([]);
      expect(result.data.disposalWorks.disposalType).toBe("");
    }
  });

  it("rejects missing facilityInfo", () => {
    const { facilityInfo, ...rest } = minValid;
    const result = inspectionFormSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing generalTreatment", () => {
    const { generalTreatment, ...rest } = minValid;
    const result = inspectionFormSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing designFlow", () => {
    const { designFlow, ...rest } = minValid;
    const result = inspectionFormSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing septicTank", () => {
    const { septicTank, ...rest } = minValid;
    const result = inspectionFormSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing disposalWorks", () => {
    const { disposalWorks, ...rest } = minValid;
    const result = inspectionFormSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects when facilityInfo has invalid required fields", () => {
    const result = inspectionFormSchema.safeParse({
      ...minValid,
      facilityInfo: { facilityName: "", inspectorName: "John" },
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// STEP_FIELDS
// ============================================================================

describe("STEP_FIELDS", () => {
  it("has entries for steps 0 through 4", () => {
    expect(Object.keys(STEP_FIELDS).map(Number).sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it("step 0 contains facilityInfo fields", () => {
    for (const field of STEP_FIELDS[0]) {
      expect(field).toMatch(/^facilityInfo\./);
    }
  });

  it("step 1 contains generalTreatment fields", () => {
    for (const field of STEP_FIELDS[1]) {
      expect(field).toMatch(/^generalTreatment\./);
    }
  });

  it("step 2 contains designFlow fields", () => {
    for (const field of STEP_FIELDS[2]) {
      expect(field).toMatch(/^designFlow\./);
    }
  });

  it("step 3 contains septicTank fields", () => {
    for (const field of STEP_FIELDS[3]) {
      expect(field).toMatch(/^septicTank\./);
    }
  });

  it("step 4 contains disposalWorks fields", () => {
    for (const field of STEP_FIELDS[4]) {
      expect(field).toMatch(/^disposalWorks\./);
    }
  });

  it("all field paths are non-empty strings", () => {
    for (const step of Object.values(STEP_FIELDS)) {
      for (const field of step) {
        expect(typeof field).toBe("string");
        expect(field.length).toBeGreaterThan(0);
        expect(field).toContain(".");
      }
    }
  });

  it("no duplicate fields within a step", () => {
    for (const [step, fields] of Object.entries(STEP_FIELDS)) {
      const unique = new Set(fields);
      expect(unique.size).toBe(fields.length);
    }
  });
});

// ============================================================================
// getDefaultFormValues
// ============================================================================

describe("getDefaultFormValues", () => {
  it("returns correct structure with inspector name", () => {
    const defaults = getDefaultFormValues("John Doe");
    expect(defaults.facilityInfo.inspectorName).toBe("John Doe");
    expect(defaults.facilityInfo.employeeName).toBe("John Doe");
    expect(defaults.disposalWorks.printedName).toBe("John Doe");
  });

  it("pre-fills company info from INSPECTOR_DEFAULTS", () => {
    const defaults = getDefaultFormValues("Tech Name");
    expect(defaults.facilityInfo.company).toBe(INSPECTOR_DEFAULTS.company);
    expect(defaults.facilityInfo.companyAddress).toBe(INSPECTOR_DEFAULTS.companyAddress);
    expect(defaults.facilityInfo.companyCity).toBe(INSPECTOR_DEFAULTS.companyCity);
    expect(defaults.facilityInfo.companyState).toBe(INSPECTOR_DEFAULTS.companyState);
    expect(defaults.facilityInfo.companyZip).toBe(INSPECTOR_DEFAULTS.companyZip);
    expect(defaults.facilityInfo.certificationNumber).toBe(
      INSPECTOR_DEFAULTS.certificationNumber,
    );
    expect(defaults.facilityInfo.registrationNumber).toBe(
      INSPECTOR_DEFAULTS.registrationNumber,
    );
    expect(defaults.facilityInfo.truckNumber).toBe(INSPECTOR_DEFAULTS.truckNumber);
  });

  it("sets default qualification flags", () => {
    const defaults = getDefaultFormValues("Tech");
    expect(defaults.facilityInfo.hasAdeqCourse).toBe(true);
    expect(defaults.facilityInfo.adeqCourseDetails).toBe("NAWT 15805 ITC");
    expect(defaults.facilityInfo.isLicensedContractor).toBe(true);
    expect(defaults.facilityInfo.contractorLicenseCategory).toBe(
      INSPECTOR_DEFAULTS.registrationNumber,
    );
    expect(defaults.facilityInfo.hasPumperTruck).toBe(true);
    expect(defaults.facilityInfo.pumperTruckRegistration).toBe(
      INSPECTOR_DEFAULTS.truckNumber,
    );
    expect(defaults.facilityInfo.isProfessionalEngineer).toBe(false);
    expect(defaults.facilityInfo.isRegisteredSanitarian).toBe(false);
    expect(defaults.facilityInfo.isWastewaterOperator).toBe(false);
  });

  it("sets facilityState to AZ", () => {
    const defaults = getDefaultFormValues("Tech");
    expect(defaults.facilityInfo.facilityState).toBe("AZ");
  });

  it("sets hauler defaults for septic tank", () => {
    const defaults = getDefaultFormValues("Tech");
    expect(defaults.septicTank.haulerCompany).toBe("Sewer Time Septic & Drain");
    expect(defaults.septicTank.haulerLicense).toBe("2833");
    expect(defaults.septicTank.tanks).toEqual([]);
  });

  it("initializes all array fields as empty arrays", () => {
    const defaults = getDefaultFormValues("Tech");
    expect(defaults.facilityInfo.facilitySystemTypes).toEqual([]);
    expect(defaults.generalTreatment.systemTypes).toEqual([]);
    expect(defaults.disposalWorks.portDepths).toEqual([]);
    expect(defaults.septicTank.tanks).toEqual([]);
  });

  it("initializes enum-like fields as empty strings", () => {
    const defaults = getDefaultFormValues("Tech");
    expect(defaults.facilityInfo.recordsAvailable).toBe("");
    expect(defaults.facilityInfo.isCesspool).toBe("");
    expect(defaults.generalTreatment.hasPerformanceAssurancePlan).toBe("");
    expect(defaults.septicTank.tanksPumped).toBe("");
    expect(defaults.disposalWorks.disposalWorksLocationDetermined).toBe("");
    expect(defaults.disposalWorks.hasDisposalDeficiency).toBe("");
    expect(defaults.disposalWorks.repairsRecommended).toBe("");
  });

  it("output validates against inspectionFormSchema when facilityName is filled in", () => {
    const defaults = getDefaultFormValues("Test Inspector");
    // facilityName defaults to "" which fails min(1), so fill it in like the form would
    defaults.facilityInfo.facilityName = "123 Test Property";
    const result = inspectionFormSchema.safeParse(defaults);
    expect(result.success).toBe(true);
  });

  it("output fails validation when facilityName is empty (by design)", () => {
    const defaults = getDefaultFormValues("Test Inspector");
    const result = inspectionFormSchema.safeParse(defaults);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("facilityInfo.facilityName");
    }
  });

  it("works with empty string inspector name (schema would reject)", () => {
    const defaults = getDefaultFormValues("");
    expect(defaults.facilityInfo.inspectorName).toBe("");
    // The schema would reject this, but getDefaultFormValues is just a data builder
    const result = inspectionFormSchema.safeParse(defaults);
    expect(result.success).toBe(false);
  });
});
