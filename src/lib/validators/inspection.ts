import { z } from "zod";
import { INSPECTOR_DEFAULTS } from "@/lib/constants/inspection";

// ============================================================================
// Section 1: Facility Information
// Covers: Property info, seller info, inspector info, qualifications, records
// ============================================================================

export const facilityInfoSchema = z.object({
  // Property info
  facilityName: z.string().min(1, "Facility/Property name is required"),
  facilityAddress: z.string().optional().default(""),
  facilityCity: z.string().optional().default(""),
  facilityCounty: z.string().optional().default(""),
  facilityState: z.string().optional().default("AZ"),
  facilityZip: z.string().optional().default(""),
  taxParcelNumber: z.string().optional().default(""),
  dateOfInspection: z.string().optional().default(""),

  // Seller/Transferor info
  sellerName: z.string().optional().default(""),
  sellerAddress: z.string().optional().default(""),
  sellerCity: z.string().optional().default(""),
  sellerState: z.string().optional().default(""),
  sellerZip: z.string().optional().default(""),

  // Inspector info (pre-filled from INSPECTOR_DEFAULTS + profile)
  inspectorName: z.string().min(1, "Inspector name is required"),
  company: z.string().optional().default(""),
  companyAddress: z.string().optional().default(""),
  companyCity: z.string().optional().default(""),
  companyState: z.string().optional().default(""),
  companyZip: z.string().optional().default(""),
  certificationNumber: z.string().optional().default(""),
  registrationNumber: z.string().optional().default(""),
  truckNumber: z.string().optional().default(""),
  employeeName: z.string().optional().default(""),

  // Inspector qualifications checkboxes
  hasAdeqCourse: z.boolean().optional().default(false),
  adeqCourseDetails: z.string().optional().default(""),
  adeqCourseDate: z.string().optional().default(""),
  isProfessionalEngineer: z.boolean().optional().default(false),
  peExpirationDate: z.string().optional().default(""),
  isRegisteredSanitarian: z.boolean().optional().default(false),
  rsExpirationDate: z.string().optional().default(""),
  isWastewaterOperator: z.boolean().optional().default(false),
  operatorGrade: z.string().optional().default(""),
  isLicensedContractor: z.boolean().optional().default(false),
  contractorLicenseCategory: z.string().optional().default(""),
  hasPumperTruck: z.boolean().optional().default(false),
  pumperTruckRegistration: z.string().optional().default(""),

  // Records obtained by inspector
  recordsAvailable: z.enum(["yes", "no", ""]).optional().default(""),
  hasDischargeAuth: z.boolean().optional().default(false),
  dischargeAuthPermitNo: z.string().optional().default(""),
  hasApprovalOfConstruction: z.boolean().optional().default(false),
  approvalPermitNo: z.string().optional().default(""),
  hasSitePlan: z.boolean().optional().default(false),
  hasOperationDocs: z.boolean().optional().default(false),
  hasOtherRecords: z.boolean().optional().default(false),
  otherRecordsDescription: z.string().optional().default(""),

  // Cesspool
  isCesspool: z.enum(["yes", "no", ""]).optional().default(""),

  // Section 1 -- Facility Information subsection
  waterSource: z.string().optional().default(""),
  wellDistance: z.string().optional().default(""),
  wastewaterSource: z.string().optional().default(""),
  occupancyType: z.string().optional().default(""),

  // Summary of Inspection fields
  facilityType: z.string().optional().default(""),
  facilityTypeOther: z.string().optional().default(""),
  facilitySystemTypes: z.array(z.string()).optional().default([]),
  numberOfSystems: z.string().optional().default(""),
  facilityAge: z.string().optional().default(""),
  facilityAgeEstimateExplanation: z.string().optional().default(""),

  // Overall condition ratings (Summary section)
  septicTankCondition: z.string().optional().default(""),
  disposalWorksCondition: z.string().optional().default(""),
  alternativeSystemCondition: z.string().optional().default(""),
  alternativeDisposalCondition: z.string().optional().default(""),
});

// ============================================================================
// Section 2: General Treatment and Disposal Works
// Covers: System type checkboxes (GP 4.02 - 4.23), performance assurance plan
// ============================================================================

export const generalTreatmentSchema = z.object({
  // System type selections (checkboxes -- multiple can be selected)
  systemTypes: z.array(z.string()).optional().default([]),

  // Performance assurance plan
  hasPerformanceAssurancePlan: z.enum(["yes", "no", ""]).optional().default(""),

  // Alternative system toggle (FORM-02: collapsed by default)
  alternativeSystem: z.boolean().optional().default(false),

  // Alternative system details (only shown when alternativeSystem is true)
  altSystemManufacturer: z.string().optional().default(""),
  altSystemModel: z.string().optional().default(""),
  altSystemCapacity: z.string().optional().default(""),
  altSystemDateInstalled: z.string().optional().default(""),
  altSystemCondition: z.string().optional().default(""),
  altSystemNotes: z.string().optional().default(""),
});

// ============================================================================
// Section 3: Design Flow and Septic Tank Sizing
// Covers: Design flow calculation, flow basis, actual flow evaluation
// ============================================================================

export const designFlowSchema = z.object({
  // 3A: Estimated design flow
  estimatedDesignFlow: z.string().optional().default(""),

  // 3B: Basis for design flow
  designFlowBasis: z.string().optional().default(""),
  numberOfBedrooms: z.string().optional().default(""),
  fixtureCount: z.string().optional().default(""),
  nonDwellingGpd: z.string().optional().default(""),

  // 3D: Actual flow evaluation
  actualFlowEvaluation: z.string().optional().default(""),
  designFlowComments: z.string().optional().default(""),
});

// ============================================================================
// Section 4: Septic Tank Inspection and Pumping
// Covers: Tank count, liquid levels, pumping, capacity, material, access,
//         lids/risers, compartments, deficiencies, baffles, effluent filter
// ============================================================================

const tankInspectionSchema = z.object({
  // Liquid levels (Section 4B)
  liquidLevel: z.string().optional().default(""),
  primaryScumThickness: z.string().optional().default(""),
  primarySludgeThickness: z.string().optional().default(""),
  secondaryScumThickness: z.string().optional().default(""),
  secondarySludgeThickness: z.string().optional().default(""),
  liquidLevelNotDetermined: z.boolean().optional().default(false),

  // Tank dimensions and capacity (Section 4D-E)
  tankDimensions: z.string().optional().default(""),
  tankCapacity: z.string().optional().default(""),
  capacityBasis: z.string().optional().default(""),
  capacityNotDeterminedReason: z.string().optional().default(""),

  // Material (Section 4F)
  tankMaterial: z.string().optional().default(""),
  tankMaterialOther: z.string().optional().default(""),

  // Access openings (Section 4G)
  accessOpenings: z.string().optional().default(""),
  accessOpeningsOther: z.string().optional().default(""),

  // Lids and risers (Section 4H)
  lidsRisersPresent: z.enum(["present", "not_present", ""]).optional().default(""),
  lidsSecurelyFastened: z.enum(["yes", "no", ""]).optional().default(""),

  // Compartments (Section 4I)
  numberOfCompartments: z.string().optional().default(""),
  compartmentsOther: z.string().optional().default(""),

  // Compromised tank (Section 4J)
  compromisedTank: z.enum(["yes", "no", ""]).optional().default(""),

  // Deficiencies (Section 4K) -- checkbox booleans
  deficiencyRootInvasion: z.boolean().optional().default(false),
  deficiencyExposedRebar: z.boolean().optional().default(false),
  deficiencyCracks: z.boolean().optional().default(false),
  deficiencyDamagedInlet: z.boolean().optional().default(false),
  deficiencyDamagedOutlet: z.boolean().optional().default(false),
  deficiencyDamagedLids: z.boolean().optional().default(false),
  deficiencyDeterioratingConcrete: z.boolean().optional().default(false),
  deficiencyOther: z.boolean().optional().default(false),

  // Baffles (Section 4L)
  baffleMaterial: z.string().optional().default(""),
  inletBaffleCondition: z.string().optional().default(""),
  outletBaffleCondition: z.string().optional().default(""),
  interiorBaffleCondition: z.string().optional().default(""),

  // Effluent filter (Section 4M)
  effluentFilterPresent: z.enum(["present", "not_present", ""]).optional().default(""),
  effluentFilterServiced: z.enum(["serviced", "not_serviced", ""]).optional().default(""),
});

export const septicTankSchema = z.object({
  // 4A: Number of tanks
  numberOfTanks: z.string().optional().default(""),

  // 4C: Pumping
  tanksPumped: z.enum(["yes", "no", ""]).optional().default(""),
  haulerCompany: z.string().optional().default(""),
  haulerLicense: z.string().optional().default(""),
  pumpingNotPerformedReason: z.string().optional().default(""),

  // 4D: Date of inspection (tank-specific)
  tankInspectionDate: z.string().optional().default(""),

  // Per-tank data (array of tank inspections)
  tanks: z.array(tankInspectionSchema).optional().default([]),

  // Inspector comments for Section 4
  septicTankComments: z.string().optional().default(""),
});

// ============================================================================
// Section 4.1 & 5: Disposal Works Inspection
// Covers: Disposal type, distribution method, inspection ports, deficiencies,
//         inspector comments, signature
// ============================================================================

export const disposalWorksSchema = z.object({
  // Disposal works location
  disposalWorksLocationDetermined: z.enum(["yes", "no", ""]).optional().default(""),
  disposalWorksLocationNotDeterminedReason: z.string().optional().default(""),

  // Disposal works type
  disposalType: z.string().optional().default(""),
  disposalTypeOther: z.string().optional().default(""),

  // Distribution method
  distributionMethod: z.string().optional().default(""),

  // Supply line material
  supplyLineMaterial: z.string().optional().default(""),
  supplyLineMaterialOther: z.string().optional().default(""),

  // Distribution component inspection
  distributionComponentInspected: z.enum(["yes", "no", ""]).optional().default(""),

  // Inspection ports
  inspectionPortsPresent: z.enum(["present", "not_present", ""]).optional().default(""),
  numberOfPorts: z.string().optional().default(""),
  portDepths: z.array(z.string()).optional().default([]),

  // Hydraulic load test
  hydraulicLoadTestPerformed: z.enum(["yes", "no", ""]).optional().default(""),

  // Disposal works deficiencies -- checkbox booleans
  hasDisposalDeficiency: z.enum(["yes", "no", ""]).optional().default(""),
  defCrushedOutletPipe: z.boolean().optional().default(false),
  defRootInvasion: z.boolean().optional().default(false),
  defHighWaterLines: z.boolean().optional().default(false),
  defDboxNotFunctioning: z.boolean().optional().default(false),
  defSurfacing: z.boolean().optional().default(false),
  defLushVegetation: z.boolean().optional().default(false),
  defErosion: z.boolean().optional().default(false),
  defPondingWater: z.boolean().optional().default(false),
  defAnimalIntrusion: z.boolean().optional().default(false),
  defLoadTestFailure: z.boolean().optional().default(false),
  defCouldNotDetermine: z.boolean().optional().default(false),

  // Repairs recommended
  repairsRecommended: z.enum(["yes", "no", ""]).optional().default(""),

  // Inspector comments and summary
  disposalWorksComments: z.string().optional().default(""),

  // Signature area
  signatureDate: z.string().optional().default(""),
  printedName: z.string().optional().default(""),
});

// ============================================================================
// Combined Form Schema
// ============================================================================

export const inspectionFormSchema = z.object({
  facilityInfo: facilityInfoSchema,
  generalTreatment: generalTreatmentSchema,
  designFlow: designFlowSchema,
  septicTank: septicTankSchema,
  disposalWorks: disposalWorksSchema,
});

// ============================================================================
// Per-Step Field Paths for trigger() validation
// Maps step index (0-4) to arrays of dotted field paths
// ============================================================================

export const STEP_FIELDS: Record<number, string[]> = {
  0: [
    "facilityInfo.facilityName",
    "facilityInfo.facilityAddress",
    "facilityInfo.facilityCity",
    "facilityInfo.facilityCounty",
    "facilityInfo.facilityState",
    "facilityInfo.facilityZip",
    "facilityInfo.taxParcelNumber",
    "facilityInfo.dateOfInspection",
    "facilityInfo.sellerName",
    "facilityInfo.sellerAddress",
    "facilityInfo.inspectorName",
    "facilityInfo.company",
    "facilityInfo.certificationNumber",
    "facilityInfo.registrationNumber",
    "facilityInfo.truckNumber",
    "facilityInfo.facilityType",
    "facilityInfo.waterSource",
    "facilityInfo.wastewaterSource",
    "facilityInfo.occupancyType",
    "facilityInfo.septicTankCondition",
    "facilityInfo.disposalWorksCondition",
  ],
  1: [
    "generalTreatment.systemTypes",
    "generalTreatment.hasPerformanceAssurancePlan",
    "generalTreatment.alternativeSystem",
    "generalTreatment.altSystemManufacturer",
    "generalTreatment.altSystemModel",
    "generalTreatment.altSystemCapacity",
    "generalTreatment.altSystemDateInstalled",
    "generalTreatment.altSystemCondition",
  ],
  2: [
    "designFlow.estimatedDesignFlow",
    "designFlow.designFlowBasis",
    "designFlow.numberOfBedrooms",
    "designFlow.fixtureCount",
    "designFlow.nonDwellingGpd",
    "designFlow.actualFlowEvaluation",
    "designFlow.designFlowComments",
  ],
  3: [
    "septicTank.numberOfTanks",
    "septicTank.tanksPumped",
    "septicTank.haulerCompany",
    "septicTank.haulerLicense",
    "septicTank.tankInspectionDate",
    "septicTank.septicTankComments",
  ],
  4: [
    "disposalWorks.disposalWorksLocationDetermined",
    "disposalWorks.disposalType",
    "disposalWorks.distributionMethod",
    "disposalWorks.supplyLineMaterial",
    "disposalWorks.distributionComponentInspected",
    "disposalWorks.inspectionPortsPresent",
    "disposalWorks.hydraulicLoadTestPerformed",
    "disposalWorks.hasDisposalDeficiency",
    "disposalWorks.repairsRecommended",
    "disposalWorks.disposalWorksComments",
    "disposalWorks.signatureDate",
    "disposalWorks.printedName",
  ],
};

// ============================================================================
// Default Form Values (pre-filled with inspector info per FORM-04)
// ============================================================================

export function getDefaultFormValues(inspectorName: string) {
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
      inspectorName,
      company: INSPECTOR_DEFAULTS.company,
      companyAddress: INSPECTOR_DEFAULTS.companyAddress,
      companyCity: INSPECTOR_DEFAULTS.companyCity,
      companyState: INSPECTOR_DEFAULTS.companyState,
      companyZip: INSPECTOR_DEFAULTS.companyZip,
      certificationNumber: INSPECTOR_DEFAULTS.certificationNumber,
      registrationNumber: INSPECTOR_DEFAULTS.registrationNumber,
      truckNumber: INSPECTOR_DEFAULTS.truckNumber,
      employeeName: inspectorName,
      hasAdeqCourse: true,
      adeqCourseDetails: "NAWT 15805 ITC",
      adeqCourseDate: "",
      isProfessionalEngineer: false,
      peExpirationDate: "",
      isRegisteredSanitarian: false,
      rsExpirationDate: "",
      isWastewaterOperator: false,
      operatorGrade: "",
      isLicensedContractor: true,
      contractorLicenseCategory: INSPECTOR_DEFAULTS.registrationNumber,
      hasPumperTruck: true,
      pumperTruckRegistration: INSPECTOR_DEFAULTS.truckNumber,
      recordsAvailable: "" as const,
      hasDischargeAuth: false,
      dischargeAuthPermitNo: "",
      hasApprovalOfConstruction: false,
      approvalPermitNo: "",
      hasSitePlan: false,
      hasOperationDocs: false,
      hasOtherRecords: false,
      otherRecordsDescription: "",
      isCesspool: "" as const,
      waterSource: "",
      wellDistance: "",
      wastewaterSource: "",
      occupancyType: "",
      facilityType: "",
      facilityTypeOther: "",
      facilitySystemTypes: [] as string[],
      numberOfSystems: "",
      facilityAge: "",
      facilityAgeEstimateExplanation: "",
      septicTankCondition: "",
      disposalWorksCondition: "",
      alternativeSystemCondition: "",
      alternativeDisposalCondition: "",
    },
    generalTreatment: {
      systemTypes: [] as string[],
      hasPerformanceAssurancePlan: "" as const,
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
      tanksPumped: "" as const,
      haulerCompany: "Sewer Time Septic & Drain",
      haulerLicense: "2833",
      pumpingNotPerformedReason: "",
      tankInspectionDate: "",
      tanks: [],
      septicTankComments: "",
    },
    disposalWorks: {
      disposalWorksLocationDetermined: "" as const,
      disposalWorksLocationNotDeterminedReason: "",
      disposalType: "",
      disposalTypeOther: "",
      distributionMethod: "",
      supplyLineMaterial: "",
      supplyLineMaterialOther: "",
      distributionComponentInspected: "" as const,
      inspectionPortsPresent: "" as const,
      numberOfPorts: "",
      portDepths: [] as string[],
      hydraulicLoadTestPerformed: "" as const,
      hasDisposalDeficiency: "" as const,
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
      repairsRecommended: "" as const,
      disposalWorksComments: "",
      signatureDate: "",
      printedName: inspectorName,
    },
  };
}
