/**
 * Field Mapping: Transforms InspectionFormData into pdfme inputs
 *
 * Converts the structured Zod schema shape to a flat Record<string, string>
 * that pdfme's generate() function expects as inputs.
 *
 * - Boolean checkbox fields -> "X" (checked) or "" (unchecked)
 * - Enum/select fields -> display-friendly labels
 * - String fields -> passed through directly
 * - Per-tank array data -> flattened as tank1_fieldName, tank2_fieldName, etc.
 * - Undefined/null values -> "" (empty string)
 */

import type { InspectionFormData } from "@/types/inspection";
import {
  CONDITION_OPTIONS,
  WATER_SOURCES,
  WASTEWATER_SOURCES,
  OCCUPANCY_TYPES,
  FACILITY_TYPES,
  TANK_MATERIALS,
  DISPOSAL_TYPES,
  DISTRIBUTION_METHODS,
  SUPPLY_LINE_MATERIALS,
  BAFFLE_MATERIALS,
  BAFFLE_CONDITIONS,
  DESIGN_FLOW_BASIS,
  ACTUAL_FLOW_EVALUATION,
  CAPACITY_BASIS_OPTIONS,
} from "@/lib/constants/inspection";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert boolean to "X" or "" for checkbox rendering */
function boolToX(value: boolean | undefined): string {
  return value ? "X" : "";
}

/** Convert enum value to "X" if it matches the target, "" otherwise */
function enumToX(value: string | undefined, target: string): string {
  return value === target ? "X" : "";
}

/** Look up the display label for a value in an options array */
function lookupLabel(
  options: ReadonlyArray<{ readonly value: string; readonly label: string }>,
  value: string | undefined,
): string {
  if (!value) return "";
  const found = options.find((o) => o.value === value);
  return found ? found.label : value;
}

/** Safe string accessor -- returns "" for undefined/null */
function str(value: string | undefined | null): string {
  return value ?? "";
}

/** Get first initial from a name (e.g., "Daniel Endres" -> "DE") */
function getInitials(name: string): string {
  if (!name) return "";
  return name
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

// ---------------------------------------------------------------------------
// Comment overflow detection
// ---------------------------------------------------------------------------

/** Maximum character count before a comment is considered overflowing */
const COMMENT_OVERFLOW_THRESHOLD = 200;

export interface OverflowResult {
  hasOverflow: boolean;
  overflowSections: Array<{
    section: string;
    fieldName: string;
    text: string;
  }>;
}

/**
 * Detects comment fields that exceed the available space on the form.
 * Uses a character count heuristic (~200 chars for typical form fields at 10pt).
 */
export function detectCommentOverflow(
  data: InspectionFormData,
): OverflowResult {
  const overflowSections: OverflowResult["overflowSections"] = [];

  const commentFields = [
    {
      section: "Design Flow",
      fieldName: "designFlowComments",
      text: str(data.designFlow?.designFlowComments),
    },
    {
      section: "Septic Tank",
      fieldName: "septicTankComments",
      text: str(data.septicTank?.septicTankComments),
    },
    {
      section: "Disposal Works",
      fieldName: "disposalWorksComments",
      text: str(data.disposalWorks?.disposalWorksComments),
    },
  ];

  for (const field of commentFields) {
    if (field.text.length > COMMENT_OVERFLOW_THRESHOLD) {
      overflowSections.push(field);
    }
  }

  return {
    hasOverflow: overflowSections.length > 0,
    overflowSections,
  };
}

// ---------------------------------------------------------------------------
// Main mapping function
// ---------------------------------------------------------------------------

/**
 * Transforms InspectionFormData into the flat Record<string, string>
 * that pdfme's inputs array expects.
 *
 * Every key in the returned object must match a schema `name` in the
 * ADEQ_TEMPLATE_SCHEMAS defined in template.ts.
 */
export function mapFormDataToInputs(
  data: InspectionFormData,
): Record<string, string> {
  const fi = data.facilityInfo;
  const gt = data.generalTreatment;
  const df = data.designFlow;
  const st = data.septicTank;
  const dw = data.disposalWorks;

  // Detect overflow for comment substitution
  const overflow = detectCommentOverflow(data);
  const overflowFields = new Set(
    overflow.overflowSections.map((s) => s.fieldName),
  );

  // Get comment text or "See Comments" if overflow
  function commentText(fieldName: string, text: string): string {
    return overflowFields.has(fieldName) ? "See Comments" : str(text);
  }

  // Inspector initials (repeated on each page header)
  const initials = getInitials(str(fi?.inspectorName));

  // Per-tank data (support up to 3 tanks)
  const tank1 = st?.tanks?.[0];
  const tank2 = st?.tanks?.[1];
  const tank3 = st?.tanks?.[2];

  const inputs: Record<string, string> = {
    // ===================================================================
    // Page 2: Form Page 1 -- Property info, inspector, qualifications
    // ===================================================================

    // Header repeaters
    taxParcelNumber: str(fi?.taxParcelNumber),
    dateOfInspection: str(fi?.dateOfInspection),
    inspectorInitials: initials,

    // Property info
    facilityName: str(fi?.facilityName),
    facilityAddress: str(fi?.facilityAddress),
    facilityCity: str(fi?.facilityCity),
    facilityCounty: str(fi?.facilityCounty),

    // Seller/Transferor
    sellerName: str(fi?.sellerName),
    sellerAddress: str(fi?.sellerAddress),
    sellerCity: str(fi?.sellerCity),
    sellerState: str(fi?.sellerState),
    sellerZip: str(fi?.sellerZip),

    // Inspector info
    inspectorName: str(fi?.inspectorName),
    companyAddress: str(fi?.companyAddress),
    companyCity: str(fi?.companyCity),
    companyState: str(fi?.companyState),
    companyZip: str(fi?.companyZip),
    company: str(fi?.company),

    // Qualifications
    hasAdeqCourse: boolToX(fi?.hasAdeqCourse),
    adeqCourseDetails: str(fi?.adeqCourseDetails),
    adeqCourseDate: str(fi?.adeqCourseDate),

    isProfessionalEngineer: boolToX(fi?.isProfessionalEngineer),
    peExpirationDate: str(fi?.peExpirationDate),
    isRegisteredSanitarian: boolToX(fi?.isRegisteredSanitarian),
    rsExpirationDate: str(fi?.rsExpirationDate),
    isWastewaterOperator: boolToX(fi?.isWastewaterOperator),
    operatorGrade: str(fi?.operatorGrade),

    isLicensedContractor: boolToX(fi?.isLicensedContractor),
    contractorLicenseCategory: str(fi?.contractorLicenseCategory),

    hasPumperTruck: boolToX(fi?.hasPumperTruck),
    pumperTruckRegistration: str(fi?.pumperTruckRegistration),

    employeeName: str(fi?.employeeName),

    // Records obtained
    recordsAvailableYes: enumToX(fi?.recordsAvailable, "yes"),
    recordsAvailableNo: enumToX(fi?.recordsAvailable, "no"),

    hasDischargeAuth: boolToX(fi?.hasDischargeAuth),
    dischargeAuthPermitNo: str(fi?.dischargeAuthPermitNo),
    hasApprovalOfConstruction: boolToX(fi?.hasApprovalOfConstruction),
    approvalPermitNo: str(fi?.approvalPermitNo),
    hasSitePlan: boolToX(fi?.hasSitePlan),
    hasOperationDocs: boolToX(fi?.hasOperationDocs),
    hasOtherRecords: boolToX(fi?.hasOtherRecords),
    otherRecordsDescription: str(fi?.otherRecordsDescription),

    // Cesspool
    isCesspoolYes: enumToX(fi?.isCesspool, "yes"),
    isCesspoolNo: enumToX(fi?.isCesspool, "no"),

    // ===================================================================
    // Page 3: Form Page 2 -- Summary of Inspection, Section 1, Section 2 start
    // ===================================================================

    // Header repeaters (same data, different schema names per page)
    taxParcelNumber_p3: str(fi?.taxParcelNumber),
    dateOfInspection_p3: str(fi?.dateOfInspection),
    inspectorInitials_p3: initials,

    // Facility type -- "Serves" checkboxes
    facilityTypeResidence: fi?.facilityType ? "X" : "",
    facilityTypeSingleFamily: enumToX(fi?.facilityType, "single_family"),
    facilityTypeMultiFamily: enumToX(fi?.facilityType, "multifamily"),
    facilityTypeCommercial: enumToX(fi?.facilityType, "commercial"),
    facilityTypeOther: fi?.facilityType === "other" ? str(fi?.facilityTypeOther) : "",

    // Type of facility checkboxes (from facilitySystemTypes array)
    facilitySystemConventional: (fi?.facilitySystemTypes ?? []).includes(
      "conventional",
    )
      ? "X"
      : "",
    facilitySystemAlternative: (fi?.facilitySystemTypes ?? []).includes(
      "alternative",
    )
      ? "X"
      : "",
    facilitySystemGrayWater: (fi?.facilitySystemTypes ?? []).includes(
      "gray_water",
    )
      ? "X"
      : "",

    numberOfSystems: str(fi?.numberOfSystems),
    facilityAge: str(fi?.facilityAge),
    facilityAgeEstimateExplanation: str(fi?.facilityAgeEstimateExplanation),

    // Condition ratings (radio-style checkboxes)
    septicTankConditionOperational: enumToX(
      fi?.septicTankCondition,
      "operational",
    ),
    septicTankConditionConcerns: enumToX(
      fi?.septicTankCondition,
      "operational_with_concerns",
    ),
    septicTankConditionNotOp: enumToX(
      fi?.septicTankCondition,
      "not_operational",
    ),

    disposalWorksConditionOperational: enumToX(
      fi?.disposalWorksCondition,
      "operational",
    ),
    disposalWorksConditionConcerns: enumToX(
      fi?.disposalWorksCondition,
      "operational_with_concerns",
    ),
    disposalWorksConditionNotOp: enumToX(
      fi?.disposalWorksCondition,
      "not_operational",
    ),

    altSystemConditionOperational: enumToX(
      fi?.alternativeSystemCondition,
      "operational",
    ),
    altSystemConditionConcerns: enumToX(
      fi?.alternativeSystemCondition,
      "operational_with_concerns",
    ),
    altSystemConditionNotOp: enumToX(
      fi?.alternativeSystemCondition,
      "not_operational",
    ),

    altDisposalConditionOperational: enumToX(
      fi?.alternativeDisposalCondition,
      "operational",
    ),
    altDisposalConditionConcerns: enumToX(
      fi?.alternativeDisposalCondition,
      "operational_with_concerns",
    ),
    altDisposalConditionNotOp: enumToX(
      fi?.alternativeDisposalCondition,
      "not_operational",
    ),

    // Section 1: Facility Information
    // A) Water source checkboxes
    waterSourceHauled: enumToX(fi?.waterSource, "hauled_water"),
    waterSourceMunicipal: enumToX(fi?.waterSource, "municipal"),
    waterSourcePrivateCompany: enumToX(fi?.waterSource, "private_company"),
    waterSourceSharedWell: enumToX(fi?.waterSource, "shared_well"),
    waterSourcePrivateWell: enumToX(fi?.waterSource, "private_well"),
    wellDistance: str(fi?.wellDistance),

    // B) Wastewater source
    wastewaterResidential: enumToX(fi?.wastewaterSource, "residential"),
    wastewaterCommercial: enumToX(fi?.wastewaterSource, "commercial"),
    wastewaterOther:
      fi?.wastewaterSource === "other"
        ? "Other"
        : "",

    // C) Occupancy/Use
    occupancyFullTime: enumToX(fi?.occupancyType, "full_time"),
    occupancySeasonalPartTime: enumToX(fi?.occupancyType, "seasonal"),
    occupancyVacant: enumToX(fi?.occupancyType, "vacant"),
    occupancyUnknown: enumToX(fi?.occupancyType, "unknown"),

    // Section 2: GP system type checkboxes
    ...mapSystemTypeCheckboxes(gt?.systemTypes ?? []),

    // ===================================================================
    // Page 4: Form Page 3 -- Section 2 continued, Section 3, Section 4A-4C
    // ===================================================================

    // Header repeaters
    taxParcelNumber_p4: str(fi?.taxParcelNumber),
    dateOfInspection_p4: str(fi?.dateOfInspection),
    inspectorInitials_p4: initials,

    // Performance Assurance Plan
    performanceAssurancePlanYes: enumToX(
      gt?.hasPerformanceAssurancePlan,
      "yes",
    ),
    performanceAssurancePlanNo: enumToX(gt?.hasPerformanceAssurancePlan, "no"),

    // Section 3: Design Flow
    estimatedDesignFlow: str(df?.estimatedDesignFlow),
    designFlowUnknown: str(df?.estimatedDesignFlow) === "" ? "X" : "",

    // Design flow basis
    designFlowBasisPermit: enumToX(df?.designFlowBasis, "permit_documents"),
    designFlowBasisCalculated: enumToX(df?.designFlowBasis, "calculated"),
    numberOfBedrooms: str(df?.numberOfBedrooms),
    fixtureCount: str(df?.fixtureCount),
    nonDwellingGpd: str(df?.nonDwellingGpd),

    // Actual flow evaluation
    actualFlowNotExceed: enumToX(df?.actualFlowEvaluation, "not_exceed"),
    actualFlowMayExceed: enumToX(df?.actualFlowEvaluation, "may_exceed"),
    actualFlowUnknown: enumToX(df?.actualFlowEvaluation, "unknown"),

    // Design flow comments
    designFlowComments: commentText(
      "designFlowComments",
      str(df?.designFlowComments),
    ),

    // Section 4A: Number of tanks
    numberOfTanks1: enumToX(st?.numberOfTanks, "1"),
    numberOfTanks2OrMore: str(st?.numberOfTanks) !== "" && str(st?.numberOfTanks) !== "1"
      ? "X"
      : "",

    // Section 4B: Tank 1 liquid levels
    tank1_liquidLevel: str(tank1?.liquidLevel),
    tank1_primaryScumThickness: str(tank1?.primaryScumThickness),
    tank1_primarySludgeThickness: str(tank1?.primarySludgeThickness),
    tank1_secondaryScumThickness: str(tank1?.secondaryScumThickness),
    tank1_secondarySludgeThickness: str(tank1?.secondarySludgeThickness),
    tank1_liquidLevelNotDetermined: boolToX(tank1?.liquidLevelNotDetermined),

    // Section 4C: Pumping
    tanksPumpedYes: enumToX(st?.tanksPumped, "yes"),
    tanksPumpedNo: enumToX(st?.tanksPumped, "no"),
    haulerCompany: str(st?.haulerCompany),
    haulerLicense: str(st?.haulerLicense),

    // Pumping not performed reasons
    pumpingNotPerformed_dischAuth:
      str(st?.pumpingNotPerformedReason) === "discharge_auth" ? "X" : "",
    pumpingNotPerformed_notNecessary:
      str(st?.pumpingNotPerformedReason) === "not_necessary" ? "X" : "",
    pumpingNotPerformed_noAccumulation:
      str(st?.pumpingNotPerformedReason) === "no_accumulation" ? "X" : "",

    // Section 4D: Tank inspection date
    tankInspectionDate: str(st?.tankInspectionDate),

    // ===================================================================
    // Page 5: Form Page 4 -- Section 4E-4M (tank details, deficiencies, baffles)
    // ===================================================================

    // Header repeaters
    taxParcelNumber_p5: str(fi?.taxParcelNumber),
    dateOfInspection_p5: str(fi?.dateOfInspection),
    inspectorInitials_p5: initials,

    // 4E: Capacity
    tank1_tankCapacity: str(tank1?.tankCapacity),
    tank1_tankDimensions: str(tank1?.tankDimensions),
    tank1_capacityBasisVolumePumped: enumToX(
      tank1?.capacityBasis,
      "volume_pumped",
    ),
    tank1_capacityBasisEstimate: enumToX(tank1?.capacityBasis, "estimate"),
    tank1_capacityBasisPermit: enumToX(
      tank1?.capacityBasis,
      "permit_document",
    ),
    tank1_capacityBasisNotDetermined: enumToX(
      tank1?.capacityBasis,
      "not_determined",
    ),
    tank1_capacityNotDeterminedReason: str(tank1?.capacityNotDeterminedReason),

    // 4F: Tank material
    tank1_materialPrecastConcrete: enumToX(
      tank1?.tankMaterial,
      "precast_concrete",
    ),
    tank1_materialFiberglass: enumToX(tank1?.tankMaterial, "fiberglass"),
    tank1_materialPlastic: enumToX(tank1?.tankMaterial, "plastic"),
    tank1_materialSteel: enumToX(tank1?.tankMaterial, "steel"),
    tank1_materialCastInPlace: enumToX(
      tank1?.tankMaterial,
      "cast_in_place",
    ),
    tank1_materialOther: enumToX(tank1?.tankMaterial, "other"),
    tank1_tankMaterialOther: str(tank1?.tankMaterialOther),

    // 4G: Access openings
    tank1_accessOne: enumToX(tank1?.accessOpenings, "one"),
    tank1_accessTwo: enumToX(tank1?.accessOpenings, "two"),
    tank1_accessThree: enumToX(tank1?.accessOpenings, "three"),
    tank1_accessOther: enumToX(tank1?.accessOpenings, "other"),
    tank1_accessOpeningsOther: str(tank1?.accessOpeningsOther),

    // 4H: Lids & risers
    tank1_lidsPresent: enumToX(tank1?.lidsRisersPresent, "present"),
    tank1_lidsNotPresent: enumToX(tank1?.lidsRisersPresent, "not_present"),
    tank1_lidsSecureYes: enumToX(tank1?.lidsSecurelyFastened, "yes"),
    tank1_lidsSecureNo: enumToX(tank1?.lidsSecurelyFastened, "no"),

    // 4I: Compartments
    tank1_compartmentsOne: enumToX(tank1?.numberOfCompartments, "one"),
    tank1_compartmentsTwo: enumToX(tank1?.numberOfCompartments, "two"),
    tank1_compartmentsOther: enumToX(tank1?.numberOfCompartments, "other"),
    tank1_compartmentsOther_text: str(tank1?.compartmentsOther),

    // 4J: Compromised tank
    tank1_compromisedYes: enumToX(tank1?.compromisedTank, "yes"),
    tank1_compromisedNo: enumToX(tank1?.compromisedTank, "no"),

    // 4K: Deficiencies
    tank1_deficiencyRootInvasion: boolToX(tank1?.deficiencyRootInvasion),
    tank1_deficiencyExposedRebar: boolToX(tank1?.deficiencyExposedRebar),
    tank1_deficiencyCracks: boolToX(tank1?.deficiencyCracks),
    tank1_deficiencyDamagedInlet: boolToX(tank1?.deficiencyDamagedInlet),
    tank1_deficiencyDamagedLids: boolToX(tank1?.deficiencyDamagedLids),
    tank1_deficiencyDamagedOutlet: boolToX(tank1?.deficiencyDamagedOutlet),
    tank1_deficiencyDeterioratingConcrete: boolToX(
      tank1?.deficiencyDeterioratingConcrete,
    ),
    tank1_deficiencyOther: boolToX(tank1?.deficiencyOther),

    // 4L: Baffle material
    tank1_baffleMaterialPrecast: enumToX(
      tank1?.baffleMaterial,
      "precast_concrete",
    ),
    tank1_baffleMaterialFiberglass: enumToX(
      tank1?.baffleMaterial,
      "fiberglass",
    ),
    tank1_baffleMaterialPlastic: enumToX(tank1?.baffleMaterial, "plastic"),
    tank1_baffleMaterialCite: enumToX(tank1?.baffleMaterial, "clay"),
    tank1_baffleMaterialNotDetermined: enumToX(
      tank1?.baffleMaterial,
      "not_determined",
    ),

    // Baffle conditions -- Inlet
    tank1_inletBafflePresent: isBafflePresent(tank1?.inletBaffleCondition),
    tank1_inletBaffleOperational: enumToX(
      tank1?.inletBaffleCondition,
      "present_operational",
    ),
    tank1_inletBaffleNotOp: enumToX(
      tank1?.inletBaffleCondition,
      "present_not_operational",
    ),
    tank1_inletBaffleNotPresent: enumToX(
      tank1?.inletBaffleCondition,
      "not_present",
    ),
    tank1_inletBaffleNotDetermined: enumToX(
      tank1?.inletBaffleCondition,
      "not_determined",
    ),

    // Baffle conditions -- Outlet
    tank1_outletBafflePresent: isBafflePresent(tank1?.outletBaffleCondition),
    tank1_outletBaffleOperational: enumToX(
      tank1?.outletBaffleCondition,
      "present_operational",
    ),
    tank1_outletBaffleNotOp: enumToX(
      tank1?.outletBaffleCondition,
      "present_not_operational",
    ),
    tank1_outletBaffleNotPresent: enumToX(
      tank1?.outletBaffleCondition,
      "not_present",
    ),
    tank1_outletBaffleNotDetermined: enumToX(
      tank1?.outletBaffleCondition,
      "not_determined",
    ),

    // Baffle conditions -- Interior
    tank1_interiorBafflePresent: isBafflePresent(
      tank1?.interiorBaffleCondition,
    ),
    tank1_interiorBaffleOperational: enumToX(
      tank1?.interiorBaffleCondition,
      "present_operational",
    ),
    tank1_interiorBaffleNotOp: enumToX(
      tank1?.interiorBaffleCondition,
      "present_not_operational",
    ),
    tank1_interiorBaffleNotPresent: enumToX(
      tank1?.interiorBaffleCondition,
      "not_present",
    ),
    tank1_interiorBaffleNotDetermined: enumToX(
      tank1?.interiorBaffleCondition,
      "not_determined",
    ),

    // 4M: Effluent filter
    tank1_effluentFilterPresent: enumToX(
      tank1?.effluentFilterPresent,
      "present",
    ),
    tank1_effluentFilterNotPresent: enumToX(
      tank1?.effluentFilterPresent,
      "not_present",
    ),
    tank1_effluentFilterServiced: enumToX(
      tank1?.effluentFilterServiced,
      "serviced",
    ),
    tank1_effluentFilterNotServiced: enumToX(
      tank1?.effluentFilterServiced,
      "not_serviced",
    ),

    // Septic tank comments
    septicTankComments: commentText(
      "septicTankComments",
      str(st?.septicTankComments),
    ),

    // ===================================================================
    // Page 5 continued: 4.1 Disposal Works (starts on page 5)
    // ===================================================================

    // Location determined
    disposalWorksLocationYes: enumToX(
      dw?.disposalWorksLocationDetermined,
      "yes",
    ),
    disposalWorksLocationNo: enumToX(
      dw?.disposalWorksLocationDetermined,
      "no",
    ),
    disposalWorksLocationNotDeterminedReason: str(
      dw?.disposalWorksLocationNotDeterminedReason,
    ),

    // Disposal type
    disposalTypeTrench: enumToX(dw?.disposalType, "trench"),
    disposalTypeBed: enumToX(dw?.disposalType, "bed"),
    disposalTypeChamber: enumToX(dw?.disposalType, "chamber"),
    disposalTypeSeepagePit: enumToX(dw?.disposalType, "seepage_pit"),
    disposalTypeOther: enumToX(dw?.disposalType, "other"),
    disposalTypeOtherText: str(dw?.disposalTypeOther),

    // Distribution method
    distributionDiversion: enumToX(dw?.distributionMethod, "diversion_valve"),
    distributionDropBox: enumToX(dw?.distributionMethod, "drop_box"),
    distributionBox: enumToX(dw?.distributionMethod, "distribution_box"),
    distributionManifold: enumToX(dw?.distributionMethod, "manifold"),
    distributionSerial: enumToX(dw?.distributionMethod, "serial_loading"),
    distributionPressurized: enumToX(dw?.distributionMethod, "pressurized"),
    distributionUnknown: enumToX(dw?.distributionMethod, "unknown"),

    // ===================================================================
    // Page 6: Form Page 5 -- Disposal Works continued + Signature
    // ===================================================================

    // Header repeaters
    taxParcelNumber_p6: str(fi?.taxParcelNumber),
    dateOfInspection_p6: str(fi?.dateOfInspection),
    inspectorInitials_p6: initials,

    // Distribution component inspected
    distributionInspectedYes: enumToX(
      dw?.distributionComponentInspected,
      "yes",
    ),
    distributionInspectedNo: enumToX(
      dw?.distributionComponentInspected,
      "no",
    ),

    // Supply line material
    supplyLinePVC: enumToX(dw?.supplyLineMaterial, "pvc"),
    supplyLineOrangeburg: enumToX(dw?.supplyLineMaterial, "orangeburg"),
    supplyLineTile: enumToX(dw?.supplyLineMaterial, "tile"),
    supplyLineOther: enumToX(dw?.supplyLineMaterial, "other"),
    supplyLineMaterialOtherText: str(dw?.supplyLineMaterialOther),

    // Inspection ports
    inspectionPortsPresent: enumToX(dw?.inspectionPortsPresent, "present"),
    inspectionPortsNotPresent: enumToX(
      dw?.inspectionPortsPresent,
      "not_present",
    ),
    numberOfPorts: str(dw?.numberOfPorts),

    // Port depths (up to 8)
    portDepth1: str(dw?.portDepths?.[0]),
    portDepth2: str(dw?.portDepths?.[1]),
    portDepth3: str(dw?.portDepths?.[2]),
    portDepth4: str(dw?.portDepths?.[3]),
    portDepth5: str(dw?.portDepths?.[4]),
    portDepth6: str(dw?.portDepths?.[5]),
    portDepth7: str(dw?.portDepths?.[6]),
    portDepth8: str(dw?.portDepths?.[7]),

    // Hydraulic load test
    hydraulicLoadTestYes: enumToX(dw?.hydraulicLoadTestPerformed, "yes"),
    hydraulicLoadTestNo: enumToX(dw?.hydraulicLoadTestPerformed, "no"),

    // Disposal works deficiency
    hasDisposalDeficiencyYes: enumToX(dw?.hasDisposalDeficiency, "yes"),
    hasDisposalDeficiencyNo: enumToX(dw?.hasDisposalDeficiency, "no"),

    // Deficiency checkboxes
    defCrushedOutletPipe: boolToX(dw?.defCrushedOutletPipe),
    defRootInvasion: boolToX(dw?.defRootInvasion),
    defHighWaterLines: boolToX(dw?.defHighWaterLines),
    defDboxNotFunctioning: boolToX(dw?.defDboxNotFunctioning),
    defSurfacing: boolToX(dw?.defSurfacing),
    defLushVegetation: boolToX(dw?.defLushVegetation),
    defErosion: boolToX(dw?.defErosion),
    defPondingWater: boolToX(dw?.defPondingWater),
    defAnimalIntrusion: boolToX(dw?.defAnimalIntrusion),
    defLoadTestFailure: boolToX(dw?.defLoadTestFailure),
    defCouldNotDetermine: boolToX(dw?.defCouldNotDetermine),

    // Repairs recommended
    repairsRecommendedYes: enumToX(dw?.repairsRecommended, "yes"),
    repairsRecommendedNo: enumToX(dw?.repairsRecommended, "no"),

    // Inspector comments (disposal works)
    disposalWorksComments: commentText(
      "disposalWorksComments",
      str(dw?.disposalWorksComments),
    ),

    // Signature area
    // signatureImage is set/deleted externally in generate-report.ts
    signatureImage: "",
    signatureDate: str(dw?.signatureDate),
    printedName: str(dw?.printedName),
  };

  return inputs;
}

// ---------------------------------------------------------------------------
// GP 4.02-4.23 system type checkbox mapping
// ---------------------------------------------------------------------------

/**
 * Maps the systemTypes array to individual checkbox keys.
 * Each selected type value maps to its corresponding checkbox schema name.
 */
function mapSystemTypeCheckboxes(
  systemTypes: string[],
): Record<string, string> {
  const typeSet = new Set(systemTypes);

  return {
    checkbox_gp402_conventional: typeSet.has("gp402_conventional") ? "X" : "",
    checkbox_gp402_septic_tank: typeSet.has("gp402_septic_tank") ? "X" : "",
    checkbox_gp402_disposal_trench: typeSet.has("gp402_disposal_trench")
      ? "X"
      : "",
    checkbox_gp402_disposal_bed: typeSet.has("gp402_disposal_bed") ? "X" : "",
    checkbox_gp402_chamber: typeSet.has("gp402_chamber") ? "X" : "",
    checkbox_gp402_seepage_pit: typeSet.has("gp402_seepage_pit") ? "X" : "",
    checkbox_gp403_composting: typeSet.has("gp403_composting") ? "X" : "",
    checkbox_gp404_pressure: typeSet.has("gp404_pressure") ? "X" : "",
    checkbox_gp405_gravelless: typeSet.has("gp405_gravelless") ? "X" : "",
    checkbox_gp406_natural_evap: typeSet.has("gp406_natural_evap") ? "X" : "",
    checkbox_gp407_lined_evap: typeSet.has("gp407_lined_evap") ? "X" : "",
    checkbox_gp408_mound: typeSet.has("gp408_mound") ? "X" : "",
    checkbox_gp409_engineered_pad: typeSet.has("gp409_engineered_pad")
      ? "X"
      : "",
    checkbox_gp410_sand_filter: typeSet.has("gp410_sand_filter") ? "X" : "",
    checkbox_gp411_peat_filter: typeSet.has("gp411_peat_filter") ? "X" : "",
    checkbox_gp412_textile_filter: typeSet.has("gp412_textile_filter")
      ? "X"
      : "",
    checkbox_gp413_denitrifying: typeSet.has("gp413_denitrifying") ? "X" : "",
    checkbox_gp414_sewage_vault: typeSet.has("gp414_sewage_vault") ? "X" : "",
    checkbox_gp415_aerobic: typeSet.has("gp415_aerobic") ? "X" : "",
    checkbox_gp416_nitrate_filter: typeSet.has("gp416_nitrate_filter")
      ? "X"
      : "",
    checkbox_gp417_cap: typeSet.has("gp417_cap") ? "X" : "",
    checkbox_gp418_wetland: typeSet.has("gp418_wetland") ? "X" : "",
    checkbox_gp419_sand_lined: typeSet.has("gp419_sand_lined") ? "X" : "",
    checkbox_gp420_disinfection: typeSet.has("gp420_disinfection") ? "X" : "",
    checkbox_gp421_surface: typeSet.has("gp421_surface") ? "X" : "",
    checkbox_gp422_drip: typeSet.has("gp422_drip") ? "X" : "",
    checkbox_gp423_large_flow: typeSet.has("gp423_large_flow") ? "X" : "",
  };
}

// ---------------------------------------------------------------------------
// Baffle condition helpers
// ---------------------------------------------------------------------------

/**
 * Returns "X" if the baffle condition indicates the baffle is present
 * (either operational or not operational).
 */
function isBafflePresent(condition: string | undefined): string {
  if (!condition) return "";
  return condition === "present_operational" ||
    condition === "present_not_operational"
    ? "X"
    : "";
}
