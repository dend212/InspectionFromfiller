/**
 * PDF Form Field Names & Radio Option Values
 *
 * Maps all 322 AcroForm fields in public/septic_system_insp_form_v2.pdf
 * to typed constants organized by form section.
 *
 * Radio option values were determined by mapping widget positions to
 * their on-screen labels (see scripts/map-radio-options.mts).
 */

// ---------------------------------------------------------------------------
// Radio option value helpers
// ---------------------------------------------------------------------------

/** Yes/No radio where option values vary per field */
export interface YesNoOptions {
  yes: string;
  no: string;
}

/** Yes/No/NA radio (used by some alt system fields) */
export interface YesNoNaOptions extends YesNoOptions {
  na: string;
}

/** Condition rating radio */
export interface ConditionOptions {
  operational: string;
  concerns: string;
  notOperational: string;
}

// ---------------------------------------------------------------------------
// Header fields (repeated on pages 2-9)
// ---------------------------------------------------------------------------

export const HEADER = {
  taxParcelNo: "taxParcelNo",
  inspectionDate: "inspectionDate",
  inspectorInitials: "inspectorInitials",
} as const;

// ---------------------------------------------------------------------------
// Page 2: Property / Inspector / Qualifications / Records / Cesspool
// ---------------------------------------------------------------------------

export const PROPERTY = {
  propertyName: "propertyName",
  propertyAddress: "propertyAddress",
  propertyCity: "propertyCity",
  propertyCounty: "propertyCounty",
  sellerName: "sellerName",
  sellerAddress: "sellerAddress",
  sellerCity: "sellerCity",
  sellerState: "sellerState",
  sellerZip: "sellerZip",
} as const;

export const INSPECTOR = {
  inspectorName: "inspectorName",
  inspectorAddress: "inspectorAddress",
  inspectorCity: "inspectorCity",
  inspectorState: "inspectorState",
  inspectorZip: "inspectorZip",
  inspectorCompany: "inspectorCompany",
} as const;

export const QUALIFICATIONS = {
  // Checkboxes
  adeqCourse: "qualAdeqCourse",
  professionalEngineer: "qualProfessionalEngineer",
  registeredSanitarian: "qualRegisteredSanitarian",
  wastewaterOperator: "qualWastewaterOperator",
  licensedContractor: "qualLicensedContractor",
  pumperTruck: "qualPumperTruck",
  // Text fields
  adeqCourseDescription: "adeqCourseDescription",
  adeqCourseDate: "adeqCourseDate",
  peExpirationDate: "peExpirationDate",
  rsExpirationDate: "rsExpirationDate",
  operatorGrade: "operatorGrade",
  contractorLicenseCategory: "contractorLicenseCategory",
  pumperTruckRegistration: "pumperTruckRegistration",
  employeeName: "employeeName",
} as const;

export const RECORDS = {
  /** Radio: Yes/No */
  recordsAvailable: "recordsAvailable",
  recordsAvailableOptions: { yes: "Choice1", no: "Choice2" } as YesNoOptions,
  // Checkboxes
  dischargeAuth: "recordsDischargeAuth",
  approvalOfConstruction: "recordsApprovalOfConstruction",
  sitePlan: "recordsSitePlan",
  operationDocs: "recordsOperationDocs",
  other: "recordsOther",
  // Text fields
  dischargePermitNo: "dischargePermitNo",
  approvalPermitNo: "approvalPermitNo",
  otherDescription: "recordsOtherDescription",
} as const;

export const CESSPOOL = {
  /** Radio: Yes/No */
  isCesspool: "isCesspool",
  isCesspoolOptions: { yes: "Choice1", no: "Choice2" } as YesNoOptions,
  signature: "cesspoolSignature",
  signatureDate: "cesspoolSignatureDate",
} as const;

// ---------------------------------------------------------------------------
// Page 3: Summary / Section 1 / Section 2 start
// ---------------------------------------------------------------------------

export const FACILITY_SERVES = {
  // Checkboxes
  residence: "facilityServesResidence",
  singleFamily: "facilityServesSingleFamily",
  multiFamily: "facilityServesMultiFamily",
  commercial: "facilityServesCommercial",
  other: "facilityServesOther",
  // Text
  otherExplain: "facilityServesOtherExplain",
} as const;

export const FACILITY_TYPE = {
  // Checkboxes
  conventional: "facilityTypeConventional",
  alternative: "facilityTypeAlternative",
  grayWater: "facilityTypeGrayWater",
} as const;

export const FACILITY_INFO = {
  numberOfSystems: "numberOfSystems",
  facilityAge: "facilityAge",
  facilityAgeExplanation: "facilityAgeExplanation",
} as const;

export const CONDITION_SUMMARY = {
  /** Radio: Operational / Concerns / Not Operational */
  septicTank: "conditionSepticTank",
  septicTankOptions: {
    operational: "Choice1",
    concerns: "Choice2",
    notOperational: "Choice3",
  } as ConditionOptions,

  disposalWorks: "conditionDisposalWorks",
  disposalWorksOptions: {
    operational: "Choice4",
    concerns: "Choice1",
    notOperational: "Choice2",
  } as ConditionOptions,

  altSystem: "conditionAltSystem",
  altSystemOptions: {
    operational: "Choice3",
    concerns: "Choice1",
    notOperational: "Choice2",
  } as ConditionOptions,

  altDisposal: "conditionAltDisposal",
  altDisposalOptions: {
    operational: "Choice4",
    concerns: "Choice1",
    notOperational: "Choice2",
  } as ConditionOptions,
} as const;

// Section 1A: Water source
export const WATER_SOURCE = {
  // Checkboxes
  hauled: "waterSourceHauled",
  municipal: "waterSourceMunicipal",
  privateCompany: "waterSourcePrivateCompany",
  sharedWell: "waterSourceSharedWell",
  privateWell: "waterSourcePrivateWell",
  // Text
  wellDistance: "wellDistance",
} as const;

// Section 1B: Wastewater source
export const WASTEWATER_SOURCE = {
  // Checkboxes
  residential: "wastewaterResidential",
  commercial: "wastewaterCommercial",
  other: "wastewaterOther",
  // Text
  otherText: "wastewaterOtherText",
} as const;

// Section 1C: Occupancy
export const OCCUPANCY = {
  // Checkboxes
  fullTime: "occupancyFullTime",
  seasonalPartTime: "occupancySeasonalPartTime",
  vacant: "occupancyVacant",
  unknown: "occupancyUnknown",
} as const;

// Section 2: GP system types
export const GP_SYSTEM_TYPES = {
  // Page 3 left column
  gp402Conventional: "gp402Conventional",
  gp402SepticTank: "gp402SepticTank",
  gp402DisposalTrench: "gp402DisposalTrench",
  gp402DisposalBed: "gp402DisposalBed",
  gp402Chamber: "gp402Chamber",
  gp402SeepagePit: "gp402SeepagePit",
  gp403Composting: "gp403Composting",
  gp404PressureDistribution: "gp404PressureDistribution",
  // Page 3 right column
  gp405GravellessTrench: "gp405GravellessTrench",
  gp406NaturalEvap: "gp406NaturalEvap",
  gp407LinedEvap: "gp407LinedEvap",
  gp408WisconsinMound: "gp408WisconsinMound",
  gp409EngineeredPad: "gp409EngineeredPad",
  gp410SandFilter: "gp410SandFilter",
  gp411PeatFilter: "gp411PeatFilter",
  gp412TextileFilter: "gp412TextileFilter",
  // Page 4 left column
  gp413Denitrifying: "gp413Denitrifying",
  gp414SewageVault: "gp414SewageVault",
  gp415Aerobic: "gp415Aerobic",
  gp416NitrateFilter: "gp416NitrateFilter",
  gp417Cap: "gp417Cap",
  gp418Wetland: "gp418Wetland",
  gp419SandLinedTrench: "gp419SandLinedTrench",
  // Page 4 right column
  gp420Disinfection: "gp420Disinfection",
  gp421SurfaceDisposal: "gp421SurfaceDisposal",
  gp422SubsurfaceDrip: "gp422SubsurfaceDrip",
  gp423LargeFlow: "gp423LargeFlow",
} as const;

// ---------------------------------------------------------------------------
// Page 4: Section 2 cont / Section 3 / Section 4 start
// ---------------------------------------------------------------------------

export const PERFORMANCE_ASSURANCE = {
  /** Radio: Yes/No */
  plan: "performanceAssurancePlan",
  planOptions: { yes: "Choice3", no: "Choice4" } as YesNoOptions,
} as const;

// Section 3: Design Flow
export const DESIGN_FLOW = {
  estimatedDesignFlow: "estimatedDesignFlow",
  /** Checkbox */
  designFlowUnknown: "designFlowUnknown",
  // Basis checkboxes
  basisPermit: "designFlowBasisPermit",
  basisCalculated: "designFlowBasisCalculated",
  basisBedrooms: "designFlowBasisBedrooms",
  basisFixtures: "designFlowBasisFixtures",
  basisNonDwelling: "designFlowBasisNonDwelling",
  // Text fields
  numberOfBedrooms: "numberOfBedrooms",
  fixtureCount: "fixtureCount",
  nonDwellingGpd: "nonDwellingGpd",
  // Actual flow checkboxes
  actualFlowNotExceed: "actualFlowNotExceed",
  actualFlowMayExceed: "actualFlowMayExceed",
  actualFlowUnknown: "actualFlowUnknown",
  // Comments
  designFlowComments: "designFlowComments",
} as const;

// Section 4A: Number of tanks
export const TANK_COUNT = {
  /** Radio: 1 / 2+ */
  numberOfTanks: "numberOfTanks",
  numberOfTanksOptions: { one: "Choice1", two: "Choice2" } as const,
} as const;

// Section 4B: Liquid levels
export const LIQUID_LEVELS = {
  tankLiquidLevel: "tankLiquidLevel",
  primaryChamberMeasured: "primaryChamberMeasured",
  primaryScumThickness: "primaryScumThickness",
  primarySludgeThickness: "primarySludgeThickness",
  secondaryChamberMeasured: "secondaryChamberMeasured",
  secondaryScumThickness: "secondaryScumThickness",
  secondarySludgeThickness: "secondarySludgeThickness",
  liquidLevelNotDetermined: "liquidLevelNotDetermined",
} as const;

// Section 4C: Pumping
export const PUMPING = {
  /** Radio: Yes/No */
  tanksPumped: "tanksPumped",
  tanksPumpedOptions: { yes: "Choice1", no: "Choice2" } as YesNoOptions,
  haulerCompany: "haulerCompany",
  haulerLicense: "haulerLicense",
  // Not performed reason checkboxes
  notPerformedDischargeAuth: "pumpingNotPerformedDischargeAuth",
  notPerformedNotNecessary: "pumpingNotPerformedNotNecessary",
  notPerformedNoAccumulation: "pumpingNotPerformedNoAccumulation",
} as const;

// Section 4D: Inspection date
export const TANK_INSPECTION = {
  tankInspectionDate: "tankInspectionDate",
} as const;

// ---------------------------------------------------------------------------
// Page 5: Section 4E-4M
// ---------------------------------------------------------------------------

// Section 4E: Tank capacity
export const TANK_CAPACITY = {
  tankCapacity: "tankCapacity",
  tankDimensions: "tankDimensions",
  // Basis checkboxes
  basisMeasurement: "capacityBasisMeasurement",
  basisVolumePumped: "capacityBasisVolumePumped",
  basisEstimate: "capacityBasisEstimate",
  basisPermit: "capacityBasisPermit",
  basisNotDetermined: "capacityBasisNotDetermined",
  notDeterminedReason: "capacityNotDeterminedReason",
} as const;

// Section 4F: Tank material
export const TANK_MATERIAL = {
  // Checkboxes
  precastConcrete: "materialPrecastConcrete",
  fiberglass: "materialFiberglass",
  plastic: "materialPlastic",
  steel: "materialSteel",
  castInPlace: "materialCastInPlace",
  other: "materialOther",
  otherDescription: "materialOtherDescription",
} as const;

// Section 4G: Access openings
export const ACCESS_OPENINGS = {
  /** Radio: 1 / 2 / 3 / Other */
  accessOpenings: "accessOpenings",
  accessOpeningsOptions: {
    one: "Choice1",
    two: "Choice2",
    three: "Choice3",
    other: "Choice4",
  } as const,
  otherDescription: "accessOpeningsOtherDescription",
} as const;

// Section 4H: Lids & risers
export const LIDS_RISERS = {
  /** Radio: Yes/No */
  lidsPresent: "lidsPresent",
  lidsPresentOptions: { yes: "Choice1", no: "Choice2" } as YesNoOptions,
  /** Radio: Yes/No */
  lidsSecurelyFastened: "lidsSecurelyFastened",
  lidsSecurelyFastenedOptions: {
    yes: "Choice1",
    no: "Choice2",
  } as YesNoOptions,
} as const;

// Section 4I: Compartments
export const COMPARTMENTS = {
  /** Radio: 1 / 2 / Other */
  compartments: "compartments",
  compartmentsOptions: {
    one: "Choice5",
    two: "Choice1",
    other: "Choice2",
  } as const,
  otherDescription: "compartmentsOtherDescription",
} as const;

// Section 4J: Compromised tank
export const COMPROMISED_TANK = {
  /** Radio: Yes/No */
  compromisedTank: "compromisedTank",
  compromisedTankOptions: { yes: "Choice1", no: "Choice2" } as YesNoOptions,
} as const;

// Section 4K: Tank deficiencies (all checkboxes)
export const TANK_DEFICIENCIES = {
  rootInvasion: "defRootInvasion",
  exposedRebar: "defExposedRebar",
  cracksInTank: "defCracksInTank",
  damagedInletPipe: "defDamagedInletPipe",
  damagedLidsRisers: "defDamagedLidsRisers",
  damagedOutletPipe: "defDamagedOutletPipe",
  deterioratingConcrete: "defDeterioratingConcrete",
  otherConcerns: "defOtherConcerns",
} as const;

// Section 4L: Baffle material (all checkboxes)
export const BAFFLE_MATERIAL = {
  precast: "baffleMaterialPrecast",
  fiberglass: "baffleMaterialFiberglass",
  plastic: "baffleMaterialPlastic",
  clay: "baffleMaterialClay",
  notDetermined: "baffleMaterialNotDetermined",
} as const;

// Baffle conditions (all checkboxes)
export const INLET_BAFFLE = {
  present: "inletBafflePresent",
  operational: "inletBaffleOperational",
  notOperational: "inletBaffleNotOperational",
  notPresent: "inletBaffleNotPresent",
  notDetermined: "inletBaffleNotDetermined",
} as const;

export const OUTLET_BAFFLE = {
  present: "outletBafflePresent",
  operational: "outletBaffleOperational",
  notOperational: "outletBaffleNotOperational",
  notPresent: "outletBaffleNotPresent",
  notDetermined: "outletBaffleNotDetermined",
} as const;

export const INTERIOR_BAFFLE = {
  present: "interiorBafflePresent",
  operational: "interiorBaffleOperational",
  notOperational: "interiorBaffleNotOperational",
  notPresent: "interiorBaffleNotPresent",
  notDetermined: "interiorBaffleNotDetermined",
} as const;

// Section 4M: Effluent filter (all checkboxes)
export const EFFLUENT_FILTER = {
  present: "effluentFilterPresent",
  notPresent: "effluentFilterNotPresent",
  serviced: "effluentFilterServiced",
  notServiced: "effluentFilterNotServiced",
} as const;

// Septic tank comments
export const SEPTIC_TANK_COMMENTS = {
  comments: "septicTankComments",
} as const;

// ---------------------------------------------------------------------------
// Page 5 continued / Page 6: Section 4.1 Disposal Works
// ---------------------------------------------------------------------------

export const DISPOSAL_LOCATION = {
  /** Radio: Yes/No */
  locationDetermined: "disposalWorksLocationDetermined",
  locationDeterminedOptions: {
    yes: "Choice3",
    no: "Choice1",
  } as YesNoOptions,
  locationExplanation: "disposalWorksLocationExplanation",
} as const;

export const DISPOSAL_TYPE = {
  // Checkboxes
  trench: "disposalTypeTrench",
  bed: "disposalTypeBed",
  chamber: "disposalTypeChamber",
  seepagePit: "disposalTypeSeepagePit",
  other: "disposalTypeOther",
  otherDescription: "disposalTypeOtherDescription",
} as const;

export const DISTRIBUTION_METHOD = {
  // Checkboxes
  diversionValve: "distributionDiversionValve",
  dropBox: "distributionDropBox",
  box: "distributionBox",
  manifold: "distributionManifold",
  serialLoading: "distributionSerialLoading",
  pressurized: "distributionPressurized",
  unknown: "distributionUnknown",
} as const;

// Page 6
export const DISTRIBUTION_INSPECTION = {
  /** Radio: Yes/No */
  inspected: "distributionInspected",
  inspectedOptions: { yes: "Choice3", no: "Choice1" } as YesNoOptions,
} as const;

export const SUPPLY_LINE = {
  // Checkboxes
  pvc: "supplyLinePVC",
  orangeburg: "supplyLineOrangeburg",
  tile: "supplyLineTile",
  other: "supplyLineOther",
  otherDescription: "supplyLineOtherDescription",
} as const;

export const INSPECTION_PORTS = {
  /** Radio: Yes/No */
  present: "inspectionPortsPresent",
  presentOptions: { yes: "Choice2", no: "Choice1" } as YesNoOptions,
  numberOfPorts: "numberOfPorts",
  portDepth1: "portDepth1",
  portDepth2: "portDepth2",
  portDepth3: "portDepth3",
  portDepth4: "portDepth4",
  portDepth5: "portDepth5",
  portDepth6: "portDepth6",
  portDepth7: "portDepth7",
  portDepth8: "portDepth8",
} as const;

export const HYDRAULIC_LOAD = {
  /** Radio: Yes/No */
  test: "hydraulicLoadTest",
  testOptions: { yes: "Choice2", no: "Choice1" } as YesNoOptions,
} as const;

export const DISPOSAL_DEFICIENCY = {
  /** Radio: Yes/No */
  hasDeficiency: "hasDisposalDeficiency",
  hasDeficiencyOptions: { yes: "Choice3", no: "Choice1" } as YesNoOptions,
  // Deficiency checkboxes
  crushedOutletPipe: "dwDefCrushedOutletPipe",
  rootInvasion: "dwDefRootInvasion",
  highWaterLines: "dwDefHighWaterLines",
  dboxNotFunctioning: "dwDefDboxNotFunctioning",
  surfacing: "dwDefSurfacing",
  lushVegetation: "dwDefLushVegetation",
  erosion: "dwDefErosion",
  pondingWater: "dwDefPondingWater",
  animalIntrusion: "dwDefAnimalIntrusion",
  loadTestFailure: "dwDefLoadTestFailure",
  couldNotDetermine: "dwDefCouldNotDetermine",
} as const;

export const DISPOSAL_REPAIRS = {
  /** Radio: Yes/No */
  recommended: "repairsRecommended",
  recommendedOptions: { yes: "Choice2", no: "Choice1" } as YesNoOptions,
} as const;

export const DISPOSAL_COMMENTS = {
  comments: "disposalWorksComments",
} as const;

// Conventional signature block
export const CONVENTIONAL_SIGNATURE = {
  signature: "conventionalSignature",
  signatureDate: "conventionalSignatureDate",
  printedName: "conventionalPrintedName",
} as const;

// ---------------------------------------------------------------------------
// Page 7: Section 5 Alternative System
// ---------------------------------------------------------------------------

export const ALT_SYSTEM_INFO = {
  qualifiedInspector: "altQualifiedInspector",
  manufacturer: "altManufacturer",
  modelCapacity: "altModelCapacity",
  treatmentEquipmentType: "altTreatmentEquipmentType",
} as const;

/** Alt system radio groups — mostly Yes/No, one is Yes/No/N/A */
export const ALT_SYSTEM_CHECKS = {
  aeratorWorking: "altAeratorWorking",
  aeratorWorkingOptions: {
    yes: "Choice2",
    no: "Choice1",
    na: "Choice3",
  } as YesNoNaOptions,

  systemMaintained: "altSystemMaintained",
  systemMaintainedOptions: { yes: "Choice4", no: "Choice1" } as YesNoOptions,

  pumpSystems: "altPumpSystems",
  pumpSystemsOptions: { yes: "Choice2", no: "Choice1" } as YesNoOptions,

  pumpOperating: "altPumpOperating",
  pumpOperatingOptions: { yes: "Choice3", no: "Choice1" } as YesNoOptions,

  highLevelAlarm: "altHighLevelAlarm",
  highLevelAlarmOptions: { yes: "Choice2", no: "Choice1" } as YesNoOptions,

  alarmsSeparateCircuits: "altAlarmsSeparateCircuits",
  alarmsSeparateCircuitsOptions: {
    yes: "Choice3",
    no: "Choice1",
  } as YesNoOptions,

  wiringProtected: "altWiringProtected",
  wiringProtectedOptions: { yes: "Choice2", no: "Choice1" } as YesNoOptions,

  audibleVisualAlarm: "altAudibleVisualAlarm",
  audibleVisualAlarmOptions: { yes: "Choice3", no: "Choice1" } as YesNoOptions,

  pumpCycleDesigned: "altPumpCycleDesigned",
  pumpCycleDesignedOptions: { yes: "Choice2", no: "Choice1" } as YesNoOptions,

  riserToGrade: "altRiserToGrade",
  riserToGradeOptions: { yes: "Choice3", no: "Choice1" } as YesNoOptions,

  tankWatertight: "altTankWatertight",
  tankWatertightOptions: { yes: "Choice2", no: "Choice1" } as YesNoOptions,

  checkValveVent: "altCheckValveVent",
  checkValveVentOptions: { yes: "Choice3", no: "Choice1" } as YesNoOptions,
} as const;

export const ALT_SYSTEM_COMMENTS = {
  comments: "altInspectorComments",
} as const;

// Section 5.1: Alternative disposal works
export const ALT_DISPOSAL_LOCATION = {
  /** Radio: Yes/No */
  locationDetermined: "altDisposalLocationDetermined",
  locationDeterminedOptions: {
    yes: "Choice2",
    no: "Choice1",
  } as YesNoOptions,
  locationExplanation: "altDisposalLocationExplanation",
} as const;

export const ALT_DISPOSAL_TYPE = {
  // Checkboxes
  trench: "altDisposalTypeTrench",
  bed: "altDisposalTypeBed",
  chamber: "altDisposalTypeChamber",
  seepagePit: "altDisposalTypeSeepagePit",
  drip: "altDisposalTypeDrip",
  lowPressure: "altDisposalTypeLowPressure",
} as const;

export const ALT_DISTRIBUTION = {
  // Checkboxes
  diversionValve: "altDistDiversionValve",
  dropBox: "altDistDropBox",
  box: "altDistBox",
  manifold: "altDistManifold",
  serialLoading: "altDistSerialLoading",
  pressurized: "altDistPressurized",
  unknown: "altDistUnknown",
  other: "altDistOther",
} as const;

export const ALT_DIST_COMP = {
  /** Radio: Yes/No */
  inspected: "altDistCompInspected",
  inspectedOptions: { yes: "Choice3", no: "Choice1" } as YesNoOptions,
  yesDescription: "altDistCompYesDescription",
  noExplanation: "altDistCompNoExplanation",
  details: "altDistCompDetails",
} as const;

export const ALT_OPERATIONAL_STATUS = {
  // Checkboxes (not a radio — these are individual checkboxes)
  operational: "altStatusOperational",
  concerns: "altStatusConcerns",
  notOperational: "altStatusNotOperational",
  couldNotDetermine: "altStatusCouldNotDetermine",
  explanation: "altStatusExplanation",
} as const;

export const ALT_SUPPLY_LINE = {
  // Checkboxes
  pvc: "altSupplyLinePVC",
  orangeburg: "altSupplyLineOrangeburg",
  tile: "altSupplyLineTile",
  other: "altSupplyLineOther",
  otherDescription: "altSupplyLineOtherDescription",
} as const;

// ---------------------------------------------------------------------------
// Page 8: Section 5.1 continued / Signatures
// ---------------------------------------------------------------------------

export const ALT_INSPECTION_PORTS = {
  /** Radio: Yes/No */
  present: "altInspectionPortsPresent",
  presentOptions: { yes: "Choice2", no: "Choice1" } as YesNoOptions,
  numberOfPorts: "altNumberOfPorts",
  portDepth1: "altPortDepth1",
  portDepth2: "altPortDepth2",
  portDepth3: "altPortDepth3",
  portDepth4: "altPortDepth4",
  portDepth5: "altPortDepth5",
  portDepth6: "altPortDepth6",
  portDepth7: "altPortDepth7",
  portDepth8: "altPortDepth8",
} as const;

export const ALT_OPERATIONAL_TEST = {
  /** Radio: Yes/No */
  test: "altOperationalTest",
  testOptions: { yes: "Choice3", no: "Choice1" } as YesNoOptions,
  explanation: "altOperationalTestExplanation",
} as const;

export const ALT_DEFICIENCY = {
  /** Radio: Yes/No */
  hasDeficiency: "altHasDeficiency",
  hasDeficiencyOptions: { yes: "Choice2", no: "Choice1" } as YesNoOptions,
  // Deficiency checkboxes
  crushedOutletPipe: "altDefCrushedOutletPipe",
  rootInvasion: "altDefRootInvasion",
  highWaterLines: "altDefHighWaterLines",
  dboxNotFunctioning: "altDefDboxNotFunctioning",
  surfacing: "altDefSurfacing",
  lushVegetation: "altDefLushVegetation",
  erosion: "altDefErosion",
  pondingWater: "altDefPondingWater",
  animalIntrusion: "altDefAnimalIntrusion",
  loadTestFailure: "altDefLoadTestFailure",
  otherProblems: "altDefOtherProblems",
  otherProblemsDescription: "altDefOtherProblemsDescription",
  couldNotDetermine: "altDefCouldNotDetermine",
  couldNotDetermineExplanation: "altDefCouldNotDetermineExplanation",
} as const;

export const ALT_REPAIRS = {
  /** Radio: Yes/No */
  repairs: "altRepairs",
  repairsOptions: { yes: "Choice4", no: "Choice1" } as YesNoOptions,
} as const;

export const ALT_DISPOSAL_CONDITION = {
  /** Radio: Operational / Concerns / Not Operational */
  condition: "altDisposalCondition",
  conditionOptions: {
    operational: "Choice1",
    concerns: "Choice2",
    notOperational: "Choice3",
  } as ConditionOptions,
} as const;

export const ALT_DISPOSAL_COMMENTS = {
  comments: "altDisposalComments",
} as const;

// Conventional inspector repeat signature (page 8)
export const CONVENTIONAL_SIGNATURE_2 = {
  signature: "conventionalSignature2",
  signatureDate: "conventionalSignatureDate2",
  printedName: "conventionalPrintedName2",
} as const;

// Alternative system inspector block
export const ALT_SYSTEM_INSPECTOR = {
  orgResponsible: "altOrgResponsible",
  contactName: "altContactName",
  contactPhone: "altContactPhone",
  contactEmail: "altContactEmail",
  signature: "altSystemInspectorSignature",
  signatureDate: "altSystemInspectorDate",
} as const;

// ---------------------------------------------------------------------------
// Template path
// ---------------------------------------------------------------------------

export const PDF_TEMPLATE_PATH = "/septic_system_insp_form_v2.pdf";
