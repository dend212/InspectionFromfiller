/**
 * Field Mapping: Transforms InspectionFormData into typed field maps
 * for pdf-lib native form filling.
 *
 * Returns separate maps for text fields, checkboxes, and radio groups.
 * Keys are the renamed PDF field names from septic_system_insp_form_v2.pdf.
 */

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
// Helpers
// ---------------------------------------------------------------------------

/** Safe string accessor — returns "" for undefined/null */
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

/** Returns true if the baffle condition indicates baffle is present */
function isBafflePresent(condition: string | string[] | undefined): boolean {
  if (Array.isArray(condition)) {
    return condition.includes("present_operational") || condition.includes("present_not_operational");
  }
  return condition === "present_operational" || condition === "present_not_operational";
}

// ---------------------------------------------------------------------------
// Comment overflow detection
// ---------------------------------------------------------------------------

const COMMENT_OVERFLOW_THRESHOLD = 200;

export interface OverflowResult {
  hasOverflow: boolean;
  overflowSections: Array<{
    section: string;
    fieldName: string;
    text: string;
  }>;
}

export function detectCommentOverflow(data: InspectionFormData): OverflowResult {
  const overflowSections: OverflowResult["overflowSections"] = [];

  const commentFields = [
    {
      section: "Design Flow",
      fieldName: "designFlowComments",
      text: str(data.designFlow?.designFlowComments),
    },
    {
      section: "Tank",
      fieldName: "septicTankComments",
      text: str(data.septicTank?.septicTankComments),
    },
    {
      section: "Drainfield",
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
// Output types
// ---------------------------------------------------------------------------

export interface FormFieldMapping {
  textFields: Record<string, string>;
  checkboxFields: Record<string, boolean>;
  radioFields: Record<string, string>;
  overflow: OverflowResult;
}

// ---------------------------------------------------------------------------
// Main mapping function
// ---------------------------------------------------------------------------

/**
 * Transforms InspectionFormData into typed field maps for pdf-lib form filling.
 *
 * Returns separate maps for text fields, checkboxes, and radio groups.
 * Every key must match a field name in septic_system_insp_form_v2.pdf.
 */
export function mapFormDataToFields(data: InspectionFormData): FormFieldMapping {
  const fi = data.facilityInfo;
  const gt = data.generalTreatment;
  const df = data.designFlow;
  const st = data.septicTank;
  const dw = data.disposalWorks;

  const overflow = detectCommentOverflow(data);
  const overflowFields = new Set(overflow.overflowSections.map((s) => s.fieldName));

  function commentText(fieldName: string, text: string): string {
    return overflowFields.has(fieldName) ? "See Comments" : str(text);
  }

  const initials = getInitials(str(fi?.inspectorName));
  const tank = st?.tanks?.[0];

  // =========================================================================
  // Text fields
  // =========================================================================

  const textFields: Record<string, string> = {
    // Header (shared across pages 2-9)
    taxParcelNo: str(fi?.taxParcelNumber),
    inspectionDate: str(fi?.dateOfInspection),
    inspectorInitials: initials,

    // Property info
    propertyName: str(fi?.facilityName),
    propertyAddress: str(fi?.facilityAddress),
    propertyCity: str(fi?.facilityCity),
    propertyCounty: str(fi?.facilityCounty),

    // Seller
    sellerName: str(fi?.sellerName),
    sellerAddress: str(fi?.sellerAddress),
    sellerCity: str(fi?.sellerCity),
    sellerState: str(fi?.sellerState),
    sellerZip: str(fi?.sellerZip),

    // Inspector
    inspectorName: str(fi?.inspectorName),
    inspectorAddress: str(fi?.companyAddress),
    inspectorCity: str(fi?.companyCity),
    inspectorState: str(fi?.companyState),
    inspectorZip: str(fi?.companyZip),
    inspectorCompany: str(fi?.company),

    // Qualifications text
    adeqCourseDescription: str(fi?.adeqCourseDetails),
    adeqCourseDate: str(fi?.adeqCourseDate),
    peExpirationDate: str(fi?.peExpirationDate),
    rsExpirationDate: str(fi?.rsExpirationDate),
    operatorGrade: str(fi?.operatorGrade),
    contractorLicenseCategory: str(fi?.contractorLicenseCategory),
    pumperTruckRegistration: str(fi?.pumperTruckRegistration),
    employeeName: str(fi?.employeeName),

    // Records text
    dischargePermitNo: str(fi?.dischargeAuthPermitNo),
    approvalPermitNo: str(fi?.approvalPermitNo),
    recordsOtherDescription: str(fi?.otherRecordsDescription),

    // Facility info
    facilityServesOtherExplain: str(fi?.facilityTypeOther),
    numberOfSystems: str(fi?.numberOfSystems),
    facilityAge: str(fi?.facilityAge),
    facilityAgeExplanation: str(fi?.facilityAgeEstimateExplanation),

    // Water source
    wellDistance: str(fi?.wellDistance),

    // Wastewater source
    wastewaterOtherText: str(fi?.wastewaterSource === "other" ? "Other" : ""),

    // Design flow
    estimatedDesignFlow: str(df?.estimatedDesignFlow),
    numberOfBedrooms: str(df?.numberOfBedrooms),
    fixtureCount: str(df?.fixtureCount),
    nonDwellingGpd: str(df?.nonDwellingGpd),
    designFlowComments: commentText("designFlowComments", str(df?.designFlowComments)),

    // Tank liquid levels
    tankLiquidLevel: str(tank?.liquidLevel),
    primaryChamberMeasured: str(tank?.primaryScumThickness ? "X" : ""),
    primaryScumThickness: str(tank?.primaryScumThickness),
    primarySludgeThickness: str(tank?.primarySludgeThickness),
    secondaryChamberMeasured: str(tank?.secondaryScumThickness ? "X" : ""),
    secondaryScumThickness: str(tank?.secondaryScumThickness),
    secondarySludgeThickness: str(tank?.secondarySludgeThickness),
    liquidLevelNotDetermined: tank?.liquidLevelNotDetermined ? "X" : "",

    // Pumping
    haulerCompany: str(st?.haulerCompany),
    haulerLicense: str(st?.haulerLicense),

    // Tank inspection date — fall back to overall inspection date if not set
    tankInspectionDate: str(st?.tankInspectionDate) || str(fi?.dateOfInspection),

    // Tank capacity
    tankCapacity: str(tank?.tankCapacity),
    tankDimensions: str(tank?.tankDimensions),
    capacityNotDeterminedReason: str(tank?.capacityNotDeterminedReason),

    // Tank material
    materialOtherDescription: str(tank?.tankMaterialOther),

    // Access openings
    accessOpeningsOtherDescription: str(tank?.accessOpeningsOther),

    // Compartments
    compartmentsOtherDescription: str(tank?.compartmentsOther),

    // Septic tank comments
    septicTankComments: commentText("septicTankComments", str(st?.septicTankComments)),

    // Disposal works
    disposalWorksLocationExplanation: str(dw?.disposalWorksLocationNotDeterminedReason),
    disposalTypeOtherDescription: str(dw?.disposalTypeOther),

    // Supply line
    supplyLineOtherDescription: str(dw?.supplyLineMaterialOther),

    // Inspection ports
    numberOfPorts: str(dw?.numberOfPorts),
    portDepth1: str(dw?.portDepths?.[0]),
    portDepth2: str(dw?.portDepths?.[1]),
    portDepth3: str(dw?.portDepths?.[2]),
    portDepth4: str(dw?.portDepths?.[3]),
    portDepth5: str(dw?.portDepths?.[4]),
    portDepth6: str(dw?.portDepths?.[5]),
    portDepth7: str(dw?.portDepths?.[6]),
    portDepth8: str(dw?.portDepths?.[7]),

    // Disposal works comments
    disposalWorksComments: commentText("disposalWorksComments", str(dw?.disposalWorksComments)),

    // Signature
    conventionalPrintedName: str(dw?.printedName),
  };

  // =========================================================================
  // Checkbox fields
  // =========================================================================

  const checkboxFields: Record<string, boolean> = {
    // Qualifications
    qualAdeqCourse: !!fi?.hasAdeqCourse,
    qualProfessionalEngineer: !!fi?.isProfessionalEngineer,
    qualRegisteredSanitarian: !!fi?.isRegisteredSanitarian,
    qualWastewaterOperator: !!fi?.isWastewaterOperator,
    qualLicensedContractor: !!fi?.isLicensedContractor,
    qualPumperTruck: !!fi?.hasPumperTruck,

    // Records
    recordsDischargeAuth: !!fi?.hasDischargeAuth,
    recordsApprovalOfConstruction: !!fi?.hasApprovalOfConstruction,
    recordsSitePlan: !!fi?.hasSitePlan,
    recordsOperationDocs: !!fi?.hasOperationDocs,
    recordsOther: !!fi?.hasOtherRecords,

    // Facility serves
    facilityServesResidence:
      fi?.facilityType === "single_family" || fi?.facilityType === "multifamily",
    facilityServesSingleFamily: fi?.facilityType === "single_family",
    facilityServesMultiFamily: fi?.facilityType === "multifamily",
    facilityServesCommercial: fi?.facilityType === "commercial",
    facilityServesOther: fi?.facilityType === "other",

    // Facility type
    facilityTypeConventional: (fi?.facilitySystemTypes ?? []).includes("conventional"),
    facilityTypeAlternative: (fi?.facilitySystemTypes ?? []).includes("alternative"),
    facilityTypeGrayWater: (fi?.facilitySystemTypes ?? []).includes("gray_water"),

    // Water source
    waterSourceHauled: fi?.waterSource === "hauled_water",
    waterSourceMunicipal: fi?.waterSource === "municipal",
    waterSourcePrivateCompany: fi?.waterSource === "private_company",
    waterSourceSharedWell: fi?.waterSource === "shared_well",
    waterSourcePrivateWell: fi?.waterSource === "private_well",

    // Wastewater source
    wastewaterResidential: fi?.wastewaterSource === "residential",
    wastewaterCommercial: fi?.wastewaterSource === "commercial",
    wastewaterOther: fi?.wastewaterSource === "other",

    // Occupancy
    occupancyFullTime: fi?.occupancyType === "full_time",
    occupancySeasonalPartTime: fi?.occupancyType === "seasonal",
    occupancyVacant: fi?.occupancyType === "vacant",
    occupancyUnknown: fi?.occupancyType === "unknown",

    // GP system types
    ...mapSystemTypeCheckboxes(gt?.systemTypes ?? []),

    // Design flow
    designFlowUnknown: df?.designFlowBasis === "unknown" || df?.actualFlowEvaluation === "unknown",
    designFlowBasisPermit: df?.designFlowBasis === "permit_documents",
    designFlowBasisCalculated: df?.designFlowBasis === "calculated",
    designFlowBasisBedrooms: !!df?.numberOfBedrooms,
    designFlowBasisFixtures: !!df?.fixtureCount,
    designFlowBasisNonDwelling: !!df?.nonDwellingGpd,
    actualFlowNotExceed: df?.actualFlowEvaluation === "not_exceed",
    actualFlowMayExceed: df?.actualFlowEvaluation === "may_exceed",
    actualFlowUnknown: df?.actualFlowEvaluation === "unknown",

    // Pumping not performed reasons
    pumpingNotPerformedDischargeAuth: st?.pumpingNotPerformedReason === "discharge_auth",
    pumpingNotPerformedNotNecessary: st?.pumpingNotPerformedReason === "not_necessary",
    pumpingNotPerformedNoAccumulation: st?.pumpingNotPerformedReason === "no_accumulation",

    // Tank capacity basis
    capacityBasisMeasurement: tank?.capacityBasis === "measurement",
    capacityBasisVolumePumped: tank?.capacityBasis === "volume_pumped",
    capacityBasisEstimate: tank?.capacityBasis === "estimate",
    capacityBasisPermit: tank?.capacityBasis === "permit_document",
    capacityBasisNotDetermined: tank?.capacityBasis === "not_determined",

    // Tank material
    materialPrecastConcrete: tank?.tankMaterial === "precast_concrete",
    materialFiberglass: tank?.tankMaterial === "fiberglass",
    materialPlastic: tank?.tankMaterial === "plastic",
    materialSteel: tank?.tankMaterial === "steel",
    materialCastInPlace: tank?.tankMaterial === "cast_in_place",
    materialOther: tank?.tankMaterial === "other",

    // Tank deficiencies
    defRootInvasion: !!tank?.deficiencyRootInvasion,
    defExposedRebar: !!tank?.deficiencyExposedRebar,
    defCracksInTank: !!tank?.deficiencyCracks,
    defDamagedInletPipe: !!tank?.deficiencyDamagedInlet,
    defDamagedLidsRisers: !!tank?.deficiencyDamagedLids,
    defDamagedOutletPipe: !!tank?.deficiencyDamagedOutlet,
    defDeterioratingConcrete: !!tank?.deficiencyDeterioratingConcrete,
    defOtherConcerns: !!tank?.deficiencyOther,

    // Baffle material (multi-select array)
    baffleMaterialPrecast: tank?.baffleMaterial?.includes("precast_concrete") ?? false,
    baffleMaterialFiberglass: tank?.baffleMaterial?.includes("fiberglass") ?? false,
    baffleMaterialPlastic: tank?.baffleMaterial?.includes("plastic") ?? false,
    baffleMaterialClay: tank?.baffleMaterial?.includes("clay") ?? false,
    baffleMaterialNotDetermined: tank?.baffleMaterial?.includes("not_determined") ?? false,

    // Inlet baffle (multi-select array)
    inletBafflePresent: isBafflePresent(tank?.inletBaffleCondition),
    inletBaffleOperational: tank?.inletBaffleCondition?.includes("present_operational") ?? false,
    inletBaffleNotOperational: tank?.inletBaffleCondition?.includes("present_not_operational") ?? false,
    inletBaffleNotPresent: tank?.inletBaffleCondition?.includes("not_present") ?? false,
    inletBaffleNotDetermined: tank?.inletBaffleCondition?.includes("not_determined") ?? false,

    // Outlet baffle (multi-select array)
    outletBafflePresent: isBafflePresent(tank?.outletBaffleCondition),
    outletBaffleOperational: tank?.outletBaffleCondition?.includes("present_operational") ?? false,
    outletBaffleNotOperational: tank?.outletBaffleCondition?.includes("present_not_operational") ?? false,
    outletBaffleNotPresent: tank?.outletBaffleCondition?.includes("not_present") ?? false,
    outletBaffleNotDetermined: tank?.outletBaffleCondition?.includes("not_determined") ?? false,

    // Interior baffle (multi-select array)
    interiorBafflePresent: isBafflePresent(tank?.interiorBaffleCondition),
    interiorBaffleOperational: tank?.interiorBaffleCondition?.includes("present_operational") ?? false,
    interiorBaffleNotOperational: tank?.interiorBaffleCondition?.includes("present_not_operational") ?? false,
    interiorBaffleNotPresent: tank?.interiorBaffleCondition?.includes("not_present") ?? false,
    interiorBaffleNotDetermined: tank?.interiorBaffleCondition?.includes("not_determined") ?? false,

    // Effluent filter
    effluentFilterPresent: tank?.effluentFilterPresent === "present",
    effluentFilterNotPresent: tank?.effluentFilterPresent === "not_present",
    effluentFilterServiced: tank?.effluentFilterServiced === "serviced",
    effluentFilterNotServiced: tank?.effluentFilterServiced === "not_serviced",

    // Disposal type
    disposalTypeTrench: dw?.disposalType === "trench",
    disposalTypeBed: dw?.disposalType === "bed",
    disposalTypeChamber: dw?.disposalType === "chamber",
    disposalTypeSeepagePit: dw?.disposalType === "seepage_pit",
    disposalTypeOther: dw?.disposalType === "other",

    // Distribution method
    distributionDiversionValve: dw?.distributionMethod === "diversion_valve",
    distributionDropBox: dw?.distributionMethod === "drop_box",
    distributionBox: dw?.distributionMethod === "distribution_box",
    distributionManifold: dw?.distributionMethod === "manifold",
    distributionSerialLoading: dw?.distributionMethod === "serial_loading",
    distributionPressurized: dw?.distributionMethod === "pressurized",
    distributionUnknown: dw?.distributionMethod === "unknown",

    // Supply line material
    supplyLinePVC: dw?.supplyLineMaterial === "pvc",
    supplyLineOrangeburg: dw?.supplyLineMaterial === "orangeburg",
    supplyLineTile: dw?.supplyLineMaterial === "tile",
    supplyLineOther: dw?.supplyLineMaterial === "other",

    // Disposal deficiencies
    dwDefCrushedOutletPipe: !!dw?.defCrushedOutletPipe,
    dwDefRootInvasion: !!dw?.defRootInvasion,
    dwDefHighWaterLines: !!dw?.defHighWaterLines,
    dwDefDboxNotFunctioning: !!dw?.defDboxNotFunctioning,
    dwDefSurfacing: !!dw?.defSurfacing,
    dwDefLushVegetation: !!dw?.defLushVegetation,
    dwDefErosion: !!dw?.defErosion,
    dwDefPondingWater: !!dw?.defPondingWater,
    dwDefAnimalIntrusion: !!dw?.defAnimalIntrusion,
    dwDefLoadTestFailure: !!dw?.defLoadTestFailure,
    dwDefCouldNotDetermine: !!dw?.defCouldNotDetermine,
  };

  // =========================================================================
  // Radio fields (value = the PDF option to select)
  // =========================================================================

  const radioFields: Record<string, string> = {};

  // Records available
  if (fi?.recordsAvailable === "yes") {
    radioFields[RECORDS.recordsAvailable] = RECORDS.recordsAvailableOptions.yes;
  } else if (fi?.recordsAvailable === "no") {
    radioFields[RECORDS.recordsAvailable] = RECORDS.recordsAvailableOptions.no;
  }

  // Cesspool
  if (fi?.isCesspool === "yes") {
    radioFields[CESSPOOL.isCesspool] = CESSPOOL.isCesspoolOptions.yes;
  } else if (fi?.isCesspool === "no") {
    radioFields[CESSPOOL.isCesspool] = CESSPOOL.isCesspoolOptions.no;
  }

  // Condition ratings
  mapConditionRadio(
    radioFields,
    CONDITION_SUMMARY.septicTank,
    CONDITION_SUMMARY.septicTankOptions,
    fi?.septicTankCondition,
  );
  mapConditionRadio(
    radioFields,
    CONDITION_SUMMARY.disposalWorks,
    CONDITION_SUMMARY.disposalWorksOptions,
    fi?.disposalWorksCondition,
  );
  mapConditionRadio(
    radioFields,
    CONDITION_SUMMARY.altSystem,
    CONDITION_SUMMARY.altSystemOptions,
    fi?.alternativeSystemCondition,
  );
  mapConditionRadio(
    radioFields,
    CONDITION_SUMMARY.altDisposal,
    CONDITION_SUMMARY.altDisposalOptions,
    fi?.alternativeDisposalCondition,
  );

  // Performance assurance plan
  mapYesNoRadio(
    radioFields,
    PERFORMANCE_ASSURANCE.plan,
    PERFORMANCE_ASSURANCE.planOptions,
    gt?.hasPerformanceAssurancePlan,
  );

  // Number of tanks
  if (st?.numberOfTanks === "1") {
    radioFields[TANK_COUNT.numberOfTanks] = TANK_COUNT.numberOfTanksOptions.one;
  } else if (st?.numberOfTanks && Number.parseInt(st.numberOfTanks, 10) >= 2) {
    radioFields[TANK_COUNT.numberOfTanks] = TANK_COUNT.numberOfTanksOptions.two;
  }

  // Tanks pumped
  mapYesNoRadio(radioFields, PUMPING.tanksPumped, PUMPING.tanksPumpedOptions, st?.tanksPumped);

  // Access openings
  if (tank?.accessOpenings === "one") {
    radioFields[ACCESS_OPENINGS.accessOpenings] = ACCESS_OPENINGS.accessOpeningsOptions.one;
  } else if (tank?.accessOpenings === "two") {
    radioFields[ACCESS_OPENINGS.accessOpenings] = ACCESS_OPENINGS.accessOpeningsOptions.two;
  } else if (tank?.accessOpenings === "three") {
    radioFields[ACCESS_OPENINGS.accessOpenings] = ACCESS_OPENINGS.accessOpeningsOptions.three;
  } else if (tank?.accessOpenings === "other") {
    radioFields[ACCESS_OPENINGS.accessOpenings] = ACCESS_OPENINGS.accessOpeningsOptions.other;
  }

  // Lids present
  if (tank?.lidsRisersPresent === "present") {
    radioFields[LIDS_RISERS.lidsPresent] = LIDS_RISERS.lidsPresentOptions.yes;
  } else if (tank?.lidsRisersPresent === "not_present") {
    radioFields[LIDS_RISERS.lidsPresent] = LIDS_RISERS.lidsPresentOptions.no;
  }

  // Lids securely fastened
  mapYesNoRadio(
    radioFields,
    LIDS_RISERS.lidsSecurelyFastened,
    LIDS_RISERS.lidsSecurelyFastenedOptions,
    tank?.lidsSecurelyFastened,
  );

  // Compartments
  if (tank?.numberOfCompartments === "one") {
    radioFields[COMPARTMENTS.compartments] = COMPARTMENTS.compartmentsOptions.one;
  } else if (tank?.numberOfCompartments === "two") {
    radioFields[COMPARTMENTS.compartments] = COMPARTMENTS.compartmentsOptions.two;
  } else if (tank?.numberOfCompartments === "other") {
    radioFields[COMPARTMENTS.compartments] = COMPARTMENTS.compartmentsOptions.other;
  }

  // Compromised tank
  mapYesNoRadio(
    radioFields,
    COMPROMISED_TANK.compromisedTank,
    COMPROMISED_TANK.compromisedTankOptions,
    tank?.compromisedTank,
  );

  // Disposal works location
  mapYesNoRadio(
    radioFields,
    DISPOSAL_LOCATION.locationDetermined,
    DISPOSAL_LOCATION.locationDeterminedOptions,
    dw?.disposalWorksLocationDetermined,
  );

  // Distribution inspected
  mapYesNoRadio(
    radioFields,
    DISTRIBUTION_INSPECTION.inspected,
    DISTRIBUTION_INSPECTION.inspectedOptions,
    dw?.distributionComponentInspected,
  );

  // Inspection ports present
  if (dw?.inspectionPortsPresent === "present") {
    radioFields[INSPECTION_PORTS.present] = INSPECTION_PORTS.presentOptions.yes;
  } else if (dw?.inspectionPortsPresent === "not_present") {
    radioFields[INSPECTION_PORTS.present] = INSPECTION_PORTS.presentOptions.no;
  }

  // Hydraulic load test
  mapYesNoRadio(
    radioFields,
    HYDRAULIC_LOAD.test,
    HYDRAULIC_LOAD.testOptions,
    dw?.hydraulicLoadTestPerformed,
  );

  // Disposal deficiency
  mapYesNoRadio(
    radioFields,
    DISPOSAL_DEFICIENCY.hasDeficiency,
    DISPOSAL_DEFICIENCY.hasDeficiencyOptions,
    dw?.hasDisposalDeficiency,
  );

  // Repairs recommended
  mapYesNoRadio(
    radioFields,
    DISPOSAL_REPAIRS.recommended,
    DISPOSAL_REPAIRS.recommendedOptions,
    dw?.repairsRecommended,
  );

  return { textFields, checkboxFields, radioFields, overflow };
}

// ---------------------------------------------------------------------------
// Radio mapping helpers
// ---------------------------------------------------------------------------

function mapYesNoRadio(
  radioFields: Record<string, string>,
  fieldName: string,
  options: { yes: string; no: string },
  value: string | undefined,
): void {
  if (value === "yes") {
    radioFields[fieldName] = options.yes;
  } else if (value === "no") {
    radioFields[fieldName] = options.no;
  }
}

function mapConditionRadio(
  radioFields: Record<string, string>,
  fieldName: string,
  options: { operational: string; concerns: string; notOperational: string },
  value: string | undefined,
): void {
  if (value === "operational") {
    radioFields[fieldName] = options.operational;
  } else if (value === "operational_with_concerns") {
    radioFields[fieldName] = options.concerns;
  } else if (value === "not_operational") {
    radioFields[fieldName] = options.notOperational;
  }
}

// ---------------------------------------------------------------------------
// GP system type checkbox mapping
// ---------------------------------------------------------------------------

function mapSystemTypeCheckboxes(systemTypes: string[]): Record<string, boolean> {
  const typeSet = new Set(systemTypes);

  return {
    [GP_SYSTEM_TYPES.gp402Conventional]: typeSet.has("gp402_conventional"),
    [GP_SYSTEM_TYPES.gp402SepticTank]: typeSet.has("gp402_septic_tank"),
    [GP_SYSTEM_TYPES.gp402DisposalTrench]: typeSet.has("gp402_disposal_trench"),
    [GP_SYSTEM_TYPES.gp402DisposalBed]: typeSet.has("gp402_disposal_bed"),
    [GP_SYSTEM_TYPES.gp402Chamber]: typeSet.has("gp402_chamber"),
    [GP_SYSTEM_TYPES.gp402SeepagePit]: typeSet.has("gp402_seepage_pit"),
    [GP_SYSTEM_TYPES.gp403Composting]: typeSet.has("gp403_composting"),
    [GP_SYSTEM_TYPES.gp404PressureDistribution]: typeSet.has("gp404_pressure"),
    [GP_SYSTEM_TYPES.gp405GravellessTrench]: typeSet.has("gp405_gravelless"),
    [GP_SYSTEM_TYPES.gp406NaturalEvap]: typeSet.has("gp406_natural_evap"),
    [GP_SYSTEM_TYPES.gp407LinedEvap]: typeSet.has("gp407_lined_evap"),
    [GP_SYSTEM_TYPES.gp408WisconsinMound]: typeSet.has("gp408_mound"),
    [GP_SYSTEM_TYPES.gp409EngineeredPad]: typeSet.has("gp409_engineered_pad"),
    [GP_SYSTEM_TYPES.gp410SandFilter]: typeSet.has("gp410_sand_filter"),
    [GP_SYSTEM_TYPES.gp411PeatFilter]: typeSet.has("gp411_peat_filter"),
    [GP_SYSTEM_TYPES.gp412TextileFilter]: typeSet.has("gp412_textile_filter"),
    [GP_SYSTEM_TYPES.gp413Denitrifying]: typeSet.has("gp413_denitrifying"),
    [GP_SYSTEM_TYPES.gp414SewageVault]: typeSet.has("gp414_sewage_vault"),
    [GP_SYSTEM_TYPES.gp415Aerobic]: typeSet.has("gp415_aerobic"),
    [GP_SYSTEM_TYPES.gp416NitrateFilter]: typeSet.has("gp416_nitrate_filter"),
    [GP_SYSTEM_TYPES.gp417Cap]: typeSet.has("gp417_cap"),
    [GP_SYSTEM_TYPES.gp418Wetland]: typeSet.has("gp418_wetland"),
    [GP_SYSTEM_TYPES.gp419SandLinedTrench]: typeSet.has("gp419_sand_lined"),
    [GP_SYSTEM_TYPES.gp420Disinfection]: typeSet.has("gp420_disinfection"),
    [GP_SYSTEM_TYPES.gp421SurfaceDisposal]: typeSet.has("gp421_surface"),
    [GP_SYSTEM_TYPES.gp422SubsurfaceDrip]: typeSet.has("gp422_drip"),
    [GP_SYSTEM_TYPES.gp423LargeFlow]: typeSet.has("gp423_large_flow"),
  };
}
