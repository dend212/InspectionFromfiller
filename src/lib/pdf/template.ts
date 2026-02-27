/**
 * pdfme Template Schema for ADEQ GWS 432 Inspection Form
 *
 * Defines all field positions (in mm) across 6 PDF pages of the
 * septic_system_insp_form.pdf blank form.
 *
 * Page dimensions: US Letter = 215.9mm x 279.4mm
 * Page 1: Instructions page ("PAGE i") -- no overlays
 * Pages 2-6: Form pages 1-5 with all data fields
 *
 * Coordinates are approximate initial estimates from the form layout.
 * The pdfme Designer can be used to fine-tune positions visually.
 */

import type { Template, Font, Schema } from "@pdfme/common";

// ---------------------------------------------------------------------------
// Reusable schema factory helpers
// ---------------------------------------------------------------------------

/** Standard text field with dynamic font sizing for potential overflow */
function textField(
  name: string,
  x: number,
  y: number,
  width: number,
  height = 5,
  opts: Record<string, unknown> = {},
): Schema {
  return {
    name,
    type: "text",
    position: { x, y },
    width,
    height,
    fontSize: 10,
    dynamicFontSize: { min: 6, max: 10, fit: "horizontal" },
    fontName: "LiberationSans",
    alignment: "left",
    verticalAlignment: "middle",
    fontColor: "#000000",
    backgroundColor: "",
    lineHeight: 1,
    characterSpacing: 0,
    ...opts,
  } as Schema;
}

/** Small checkbox rendered as centered "X" text overlay */
function checkbox(name: string, x: number, y: number): Schema {
  return {
    name,
    type: "text",
    position: { x, y },
    width: 4,
    height: 4,
    fontSize: 10,
    alignment: "center",
    verticalAlignment: "middle",
    fontName: "LiberationSans",
    fontColor: "#000000",
    backgroundColor: "",
    lineHeight: 1,
    characterSpacing: 0,
  } as Schema;
}

/** Multi-line text field (comments, larger areas) */
function multilineField(
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
): Schema {
  return {
    name,
    type: "text",
    position: { x, y },
    width,
    height,
    fontSize: 9,
    dynamicFontSize: { min: 6, max: 9, fit: "horizontal" },
    fontName: "LiberationSans",
    alignment: "left",
    verticalAlignment: "top",
    fontColor: "#000000",
    backgroundColor: "",
    lineHeight: 1.2,
    characterSpacing: 0,
  } as Schema;
}

// ---------------------------------------------------------------------------
// Page 1: Instructions page (PAGE i) -- no overlays
// ---------------------------------------------------------------------------
const PAGE_1_SCHEMAS: Schema[] = [];

// ---------------------------------------------------------------------------
// Page 2: Form Page 1 -- Property info, inspector, qualifications, records, cesspool
// ---------------------------------------------------------------------------
const PAGE_2_SCHEMAS: Schema[] = [
  // Header line: Tax Parcel No. and Date of Inspection + Initials
  textField("taxParcelNumber", 55, 11, 55, 5),
  textField("dateOfInspection", 143, 11, 40, 5),
  textField("inspectorInitials", 200, 11, 12, 5),

  // Property info
  textField("facilityName", 35, 47.5, 170, 5),
  textField("facilityAddress", 40, 52.5, 85, 5),
  textField("facilityCity", 140, 52.5, 30, 5),
  textField("facilityCounty", 180, 52.5, 25, 5),

  // Seller/Transferor info
  textField("sellerName", 43, 57.2, 162, 5),
  textField("sellerAddress", 47, 62.2, 80, 5),
  textField("sellerCity", 140, 62.2, 30, 5),
  textField("sellerState", 178, 62.2, 10, 5),
  textField("sellerZip", 196, 62.2, 18, 5),

  // Inspector info
  textField("inspectorName", 37, 76.7, 168, 5),
  textField("companyAddress", 41, 81.7, 82, 5),
  textField("companyCity", 140, 81.7, 30, 5),
  textField("companyState", 178, 81.7, 10, 5),
  textField("companyZip", 196, 81.7, 18, 5),
  textField("company", 38, 86.5, 167, 5),

  // Inspector qualifications checkboxes and detail fields
  // ADEQ-Recognized Course
  checkbox("hasAdeqCourse", 14.5, 105),
  textField("adeqCourseDetails", 60, 105, 96, 4.5),
  textField("adeqCourseDate", 178, 105, 28, 4.5),

  // Professional Engineer / Registered Sanitarian / WW Operator row
  checkbox("isProfessionalEngineer", 14.5, 115),
  textField("peExpirationDate", 40, 120, 25, 4),
  checkbox("isRegisteredSanitarian", 55, 115),
  textField("rsExpirationDate", 80, 120, 25, 4),
  checkbox("isWastewaterOperator", 96, 115),
  textField("operatorGrade", 120, 120, 20, 4),

  // Licensed Contractor
  checkbox("isLicensedContractor", 14.5, 127.5),
  textField("contractorLicenseCategory", 78, 127.5, 127, 4.5),

  // Pumper Truck
  checkbox("hasPumperTruck", 14.5, 137.5),
  textField("pumperTruckRegistration", 84, 137.5, 121, 4.5),

  // Employee Name
  textField("employeeName", 65, 147.5, 140, 4.5),

  // Records Obtained by Inspector
  checkbox("recordsAvailableYes", 157, 161.5),
  checkbox("recordsAvailableNo", 169.5, 161.5),

  // Discharge Auth
  checkbox("hasDischargeAuth", 26, 172),
  textField("dischargeAuthPermitNo", 36, 177.5, 40, 4),

  // Approval of Construction
  checkbox("hasApprovalOfConstruction", 26, 182),
  textField("approvalPermitNo", 56, 187, 40, 4),

  // Site plan, Operation docs, Other
  checkbox("hasSitePlan", 26, 192),
  checkbox("hasOperationDocs", 26, 197),
  checkbox("hasOtherRecords", 26, 202),
  textField("otherRecordsDescription", 40, 202, 165, 4.5),

  // Cesspool
  checkbox("isCesspoolYes", 73, 223),
  checkbox("isCesspoolNo", 91, 223),

  // Signature and Date on page 1 (bottom)
  // Note: Page 1 has a small signature line for cesspool declaration
];

// ---------------------------------------------------------------------------
// Page 3: Form Page 2 -- Summary of Inspection, Section 1 (Facility Info),
//         Section 2 (General Treatment) top portion
// ---------------------------------------------------------------------------
const PAGE_3_SCHEMAS: Schema[] = [
  // Header repeaters
  textField("taxParcelNumber_p3", 55, 11, 55, 5),
  textField("dateOfInspection_p3", 143, 11, 40, 5),
  textField("inspectorInitials_p3", 200, 11, 12, 5),

  // Summary of Inspection
  // "Onsite Wastewater Treatment Facility Serves" checkboxes
  checkbox("facilityTypeResidence", 23, 48),
  checkbox("facilityTypeSingleFamily", 68, 48),
  checkbox("facilityTypeMultiFamily", 100, 48),
  checkbox("facilityTypeCommercial", 142, 48),
  textField("facilityTypeOther", 40, 56.5, 165, 4.5),

  // Type of Facility checkboxes
  checkbox("facilitySystemConventional", 23, 70.5),
  checkbox("facilitySystemAlternative", 66, 70.5),
  checkbox("facilitySystemGrayWater", 104, 70.5),

  // Number of systems and age
  textField("numberOfSystems", 102, 77, 30, 4.5),
  textField("facilityAge", 85, 87, 15, 4.5),
  textField("facilityAgeEstimateExplanation", 72, 92, 133, 4.5),

  // Condition ratings
  // Septic Tank Condition
  checkbox("septicTankConditionOperational", 49, 108),
  checkbox("septicTankConditionConcerns", 75, 108),
  checkbox("septicTankConditionNotOp", 122, 108),

  // Disposal Works Condition
  checkbox("disposalWorksConditionOperational", 55, 120),
  checkbox("disposalWorksConditionConcerns", 81, 120),
  checkbox("disposalWorksConditionNotOp", 128, 120),

  // Alternative System Condition
  checkbox("altSystemConditionOperational", 84, 131.5),
  checkbox("altSystemConditionConcerns", 110.5, 131.5),
  checkbox("altSystemConditionNotOp", 157, 131.5),

  // Alternative Disposal Condition
  checkbox("altDisposalConditionOperational", 71.5, 143),
  checkbox("altDisposalConditionConcerns", 98, 143),
  checkbox("altDisposalConditionNotOp", 144, 143),

  // Section 1: Facility Information
  // A) Domestic Water Source checkboxes
  checkbox("waterSourceHauled", 25.5, 173),
  checkbox("waterSourceMunicipal", 55.5, 173),
  checkbox("waterSourcePrivateCompany", 91.5, 173),
  checkbox("waterSourceSharedWell", 135, 173),
  checkbox("waterSourcePrivateWell", 171, 173),
  textField("wellDistance", 108, 179.5, 75, 4.5),

  // B) Type of Wastewater Source
  checkbox("wastewaterResidential", 25.5, 190),
  checkbox("wastewaterCommercial", 55.5, 190),
  textField("wastewaterOther", 115, 190, 90, 4.5),

  // C) Occupancy/Use
  checkbox("occupancyFullTime", 47, 196.5),
  checkbox("occupancySeasonalPartTime", 69, 196.5),
  checkbox("occupancyVacant", 126, 196.5),
  checkbox("occupancyUnknown", 139, 196.5),

  // Section 2: General Treatment and Disposal Works
  // GP 4.02 system type checkboxes (left column)
  checkbox("checkbox_gp402_conventional", 16.5, 214.5),
  checkbox("checkbox_gp402_septic_tank", 41, 219.5),
  checkbox("checkbox_gp402_disposal_trench", 41, 224.5),
  checkbox("checkbox_gp402_disposal_bed", 41, 229.5),
  checkbox("checkbox_gp402_chamber", 41, 234.5),
  checkbox("checkbox_gp402_seepage_pit", 41, 239.5),
  checkbox("checkbox_gp403_composting", 16.5, 244.5),
  checkbox("checkbox_gp404_pressure", 16.5, 249.5),

  // GP 4.05+ system type checkboxes (right column)
  checkbox("checkbox_gp405_gravelless", 109, 214.5),
  checkbox("checkbox_gp406_natural_evap", 109, 219.5),
  checkbox("checkbox_gp407_lined_evap", 109, 224.5),
  checkbox("checkbox_gp408_mound", 109, 229.5),
  checkbox("checkbox_gp409_engineered_pad", 109, 234.5),
  checkbox("checkbox_gp410_sand_filter", 109, 239.5),
  checkbox("checkbox_gp411_peat_filter", 109, 244.5),
  checkbox("checkbox_gp412_textile_filter", 109, 249.5),
];

// ---------------------------------------------------------------------------
// Page 4: Form Page 3 -- Section 2 continued (GP 4.13-4.23),
//         Section 3 (Design Flow), Section 4A-4C (Septic Tank start)
// ---------------------------------------------------------------------------
const PAGE_4_SCHEMAS: Schema[] = [
  // Header repeaters
  textField("taxParcelNumber_p4", 55, 11, 55, 5),
  textField("dateOfInspection_p4", 143, 11, 40, 5),
  textField("inspectorInitials_p4", 200, 11, 12, 5),

  // Section 2 continued: GP 4.13-4.23 system type checkboxes
  // Left column
  checkbox("checkbox_gp413_denitrifying", 16.5, 32.5),
  checkbox("checkbox_gp414_sewage_vault", 16.5, 42.5),
  checkbox("checkbox_gp415_aerobic", 16.5, 47.5),
  checkbox("checkbox_gp416_nitrate_filter", 16.5, 52.5),
  checkbox("checkbox_gp417_cap", 16.5, 57.5),
  checkbox("checkbox_gp418_wetland", 16.5, 62.5),
  checkbox("checkbox_gp419_sand_lined", 16.5, 67.5),

  // Right column
  checkbox("checkbox_gp420_disinfection", 109, 33),
  checkbox("checkbox_gp421_surface", 109, 37.5),
  checkbox("checkbox_gp422_drip", 109, 42.5),
  checkbox("checkbox_gp423_large_flow", 109, 47),

  // Performance Assurance Plan
  checkbox("performanceAssurancePlanYes", 122, 61.5),
  checkbox("performanceAssurancePlanNo", 135, 61.5),

  // Section 3: Design Flow and Septic Tank Sizing
  // 3A: Estimated Design Flow
  textField("estimatedDesignFlow", 58, 82.5, 35, 5),
  checkbox("designFlowUnknown", 116, 82.5),

  // 3B: Basis for design flow
  checkbox("designFlowBasisPermit", 26, 94),
  checkbox("designFlowBasisCalculated", 26, 99),
  textField("numberOfBedrooms", 80, 103.5, 35, 4),
  textField("fixtureCount", 80, 108.5, 35, 4),
  textField("nonDwellingGpd", 57, 113.5, 25, 4),

  // 3C: Actual flow evaluation
  checkbox("actualFlowNotExceed", 28, 123.5),
  checkbox("actualFlowMayExceed", 28, 128.5),
  checkbox("actualFlowUnknown", 28, 133.5),

  // 3D: Inspector Comments (design flow)
  multilineField("designFlowComments", 50, 138, 155, 9),

  // Section 4: Septic Tank Inspection and Pumping
  // 4A: Number of tanks
  checkbox("numberOfTanks1", 149.5, 159),
  checkbox("numberOfTanks2OrMore", 167, 159),

  // 4B: Liquid levels
  textField("tank1_liquidLevel", 162, 166, 30, 4.5),
  textField("tank1_primaryScumThickness", 88, 171, 15, 4),
  textField("tank1_primarySludgeThickness", 140, 171, 15, 4),
  textField("tank1_secondaryScumThickness", 88, 176, 15, 4),
  textField("tank1_secondarySludgeThickness", 140, 176, 15, 4),
  checkbox("tank1_liquidLevelNotDetermined", 26, 181),

  // 4C: Pumping
  checkbox("tanksPumpedYes", 137, 191.5),
  checkbox("tanksPumpedNo", 149.5, 191.5),
  textField("haulerCompany", 92, 196.5, 113, 4.5),
  textField("haulerLicense", 72, 203, 133, 4.5),

  // Pumping not performed reasons (checkboxes)
  checkbox("pumpingNotPerformed_dischAuth", 25, 215),
  checkbox("pumpingNotPerformed_notNecessary", 25, 224.5),
  checkbox("pumpingNotPerformed_noAccumulation", 25, 234),

  // 4D: Date of inspection for tank
  textField("tankInspectionDate", 80, 241.5, 40, 4.5),
];

// ---------------------------------------------------------------------------
// Page 5: Form Page 4 -- Section 4E-4M (Tank details, deficiencies, baffles)
// ---------------------------------------------------------------------------
const PAGE_5_SCHEMAS: Schema[] = [
  // Header repeaters
  textField("taxParcelNumber_p5", 55, 11, 55, 5),
  textField("dateOfInspection_p5", 143, 11, 40, 5),
  textField("inspectorInitials_p5", 200, 11, 12, 5),

  // 4E: Capacity
  textField("tank1_tankCapacity", 62, 29, 25, 4.5),
  textField("tank1_tankDimensions", 153, 29, 45, 4.5),
  checkbox("tank1_capacityBasisVolumePumped", 47.5, 34),
  checkbox("tank1_capacityBasisEstimate", 112, 34),
  checkbox("tank1_capacityBasisPermit", 163, 34),
  checkbox("tank1_capacityBasisNotDetermined", 47.5, 38.5),
  textField("tank1_capacityNotDeterminedReason", 91, 38.5, 114, 4),

  // 4F: Septic tank material
  checkbox("tank1_materialPrecastConcrete", 26.5, 48.5),
  checkbox("tank1_materialFiberglass", 64, 48.5),
  checkbox("tank1_materialPlastic", 90.5, 48.5),
  checkbox("tank1_materialSteel", 112, 48.5),
  checkbox("tank1_materialCastInPlace", 130.5, 48.5),
  checkbox("tank1_materialOther", 27, 53.5),
  textField("tank1_tankMaterialOther", 50, 53.5, 155, 4.5),

  // 4G: Access openings
  checkbox("tank1_accessOne", 65, 61),
  checkbox("tank1_accessTwo", 80, 61),
  checkbox("tank1_accessThree", 93, 61),
  checkbox("tank1_accessOther", 108, 61),
  textField("tank1_accessOpeningsOther", 127, 61, 78, 4.5),

  // 4H: Lids & risers
  checkbox("tank1_lidsPresent", 57, 69.5),
  checkbox("tank1_lidsNotPresent", 75, 69.5),
  checkbox("tank1_lidsSecureYes", 86, 74.5),
  checkbox("tank1_lidsSecureNo", 101, 74.5),

  // 4I: Compartments
  checkbox("tank1_compartmentsOne", 81, 87),
  checkbox("tank1_compartmentsTwo", 94, 87),
  checkbox("tank1_compartmentsOther", 108, 87),
  textField("tank1_compartmentsOther_text", 130, 87, 75, 4.5),

  // 4J: Compromised tank
  checkbox("tank1_compromisedYes", 150, 93.5),
  checkbox("tank1_compromisedNo", 163.5, 93.5),

  // 4K: Deficiencies
  checkbox("tank1_deficiencyRootInvasion", 20, 110.5),
  checkbox("tank1_deficiencyExposedRebar", 72.5, 110.5),
  checkbox("tank1_deficiencyCracks", 20, 115.5),
  checkbox("tank1_deficiencyDamagedInlet", 72.5, 115.5),
  checkbox("tank1_deficiencyDamagedLids", 20, 120.5),
  checkbox("tank1_deficiencyDamagedOutlet", 72.5, 120.5),
  checkbox("tank1_deficiencyDeterioratingConcrete", 20, 125.5),
  checkbox("tank1_deficiencyOther", 72.5, 125.5),

  // 4L: Baffle/sanitary T material
  checkbox("tank1_baffleMaterialPrecast", 26.5, 137.5),
  checkbox("tank1_baffleMaterialFiberglass", 60, 137.5),
  checkbox("tank1_baffleMaterialPlastic", 82.5, 137.5),
  checkbox("tank1_baffleMaterialCite", 100, 137.5),
  checkbox("tank1_baffleMaterialNotDetermined", 116, 137.5),

  // Baffle conditions
  // Inlet baffle
  checkbox("tank1_inletBafflePresent", 50, 148.5),
  checkbox("tank1_inletBaffleOperational", 69, 148.5),
  checkbox("tank1_inletBaffleNotOp", 94, 148.5),
  checkbox("tank1_inletBaffleNotPresent", 125, 148.5),
  checkbox("tank1_inletBaffleNotDetermined", 151, 148.5),

  // Outlet baffle
  checkbox("tank1_outletBafflePresent", 51, 158.5),
  checkbox("tank1_outletBaffleOperational", 70.5, 158.5),
  checkbox("tank1_outletBaffleNotOp", 95, 158.5),
  checkbox("tank1_outletBaffleNotPresent", 125.5, 158.5),
  checkbox("tank1_outletBaffleNotDetermined", 151.5, 158.5),

  // Interior baffle
  checkbox("tank1_interiorBafflePresent", 50.5, 168),
  checkbox("tank1_interiorBaffleOperational", 70, 168),
  checkbox("tank1_interiorBaffleNotOp", 94.5, 168),
  checkbox("tank1_interiorBaffleNotPresent", 125, 168),
  checkbox("tank1_interiorBaffleNotDetermined", 151, 168),

  // 4M: Effluent filter
  checkbox("tank1_effluentFilterPresent", 51, 175.5),
  checkbox("tank1_effluentFilterNotPresent", 70, 175.5),
  checkbox("tank1_effluentFilterServiced", 94, 175.5),
  checkbox("tank1_effluentFilterNotServiced", 123, 175.5),

  // Septic tank comments (inspector comments section)
  multilineField("septicTankComments", 14, 203, 192, 14),

  // 4.1 Disposal Works section (starts on this page)
  // Location determined
  checkbox("disposalWorksLocationYes", 26, 226.5),
  checkbox("disposalWorksLocationNo", 75.5, 226.5),
  textField(
    "disposalWorksLocationNotDeterminedReason",
    105,
    226.5,
    100,
    4.5,
  ),

  // Disposal works type
  checkbox("disposalTypeTrench", 26.5, 236.5),
  checkbox("disposalTypeBed", 52, 236.5),
  checkbox("disposalTypeChamber", 77, 236.5),
  checkbox("disposalTypeSeepagePit", 103, 236.5),
  checkbox("disposalTypeOther", 128, 236.5),
  textField("disposalTypeOtherText", 145, 237, 60, 4.5),

  // Method of distribution
  checkbox("distributionDiversion", 26.5, 248),
  checkbox("distributionDropBox", 61.5, 248),
  checkbox("distributionBox", 89, 248),
  checkbox("distributionManifold", 125.5, 248),
  checkbox("distributionSerial", 150.5, 248),
  checkbox("distributionPressurized", 26.5, 253),
  checkbox("distributionUnknown", 61, 253),
];

// ---------------------------------------------------------------------------
// Page 6: Form Page 5 -- Section 4.1 continued + Section 5 (Disposal Works
//         deficiencies, inspector comments, signature)
// ---------------------------------------------------------------------------
const PAGE_6_SCHEMAS: Schema[] = [
  // Header repeaters
  textField("taxParcelNumber_p6", 55, 11, 55, 5),
  textField("dateOfInspection_p6", 143, 11, 40, 5),
  textField("inspectorInitials_p6", 200, 11, 12, 5),

  // Distribution component inspected
  checkbox("distributionInspectedYes", 79.5, 23),
  checkbox("distributionInspectedNo", 94, 23),

  // Supply line material
  checkbox("supplyLinePVC", 86, 28.5),
  checkbox("supplyLineOrangeburg", 103, 28.5),
  checkbox("supplyLineTile", 133, 28.5),
  checkbox("supplyLineOther", 150, 28.5),
  textField("supplyLineMaterialOtherText", 162, 28.5, 43, 4.5),

  // Inspection ports
  checkbox("inspectionPortsPresent", 88.5, 34),
  checkbox("inspectionPortsNotPresent", 109, 34),

  // Port details
  textField("numberOfPorts", 78, 44.5, 15, 4),
  // Port depths (8 ports)
  textField("portDepth1", 42, 55, 18, 4),
  textField("portDepth2", 70.5, 55, 18, 4),
  textField("portDepth3", 99.5, 55, 18, 4),
  textField("portDepth4", 129, 55, 18, 4),
  textField("portDepth5", 42, 60, 18, 4),
  textField("portDepth6", 70.5, 60, 18, 4),
  textField("portDepth7", 99.5, 60, 18, 4),
  textField("portDepth8", 129, 60, 18, 4),

  // Hydraulic load test
  checkbox("hydraulicLoadTestYes", 123, 67),
  checkbox("hydraulicLoadTestNo", 140.5, 67),

  // Disposal works deficiency
  checkbox("hasDisposalDeficiencyYes", 89.5, 73),
  checkbox("hasDisposalDeficiencyNo", 105, 73),

  // Deficiency checkboxes (list)
  checkbox("defCrushedOutletPipe", 26, 83),
  checkbox("defRootInvasion", 26, 88),
  checkbox("defHighWaterLines", 26, 93),
  checkbox("defDboxNotFunctioning", 26, 98),
  checkbox("defSurfacing", 26, 103),
  checkbox("defLushVegetation", 26, 108),
  checkbox("defErosion", 26, 113),
  checkbox("defPondingWater", 26, 118),
  checkbox("defAnimalIntrusion", 26, 123),
  checkbox("defLoadTestFailure", 26, 128),
  checkbox("defCouldNotDetermine", 26, 133),

  // Repairs recommended
  checkbox("repairsRecommendedYes", 154.5, 138),
  checkbox("repairsRecommendedNo", 169, 138),

  // Inspector Comments (disposal works)
  multilineField("disposalWorksComments", 19, 147.5, 186, 14),

  // Signature area
  {
    name: "signatureImage",
    type: "image",
    position: { x: 19, y: 197 },
    width: 60,
    height: 12,
  } as Schema,
  textField("signatureDate", 145, 203.5, 50, 5),
  textField("printedName", 43, 213.5, 80, 5),
];

// ---------------------------------------------------------------------------
// Exported schema array: one inner array per PDF page (6 total)
// ---------------------------------------------------------------------------
export const ADEQ_TEMPLATE_SCHEMAS: Schema[][] = [
  PAGE_1_SCHEMAS, // Page 1: Instructions (no overlays)
  PAGE_2_SCHEMAS, // Page 2: Form page 1
  PAGE_3_SCHEMAS, // Page 3: Form page 2
  PAGE_4_SCHEMAS, // Page 4: Form page 3
  PAGE_5_SCHEMAS, // Page 5: Form page 4
  PAGE_6_SCHEMAS, // Page 6: Form page 5
];

// ---------------------------------------------------------------------------
// Template + Font loader with caching
// ---------------------------------------------------------------------------

/** Cached template and font data */
let cachedTemplate: Template | null = null;
let cachedFont: Font | null = null;

export interface LoadedTemplate {
  template: Template;
  font: Font;
}

/**
 * Loads the ADEQ form template with basePdf and fonts.
 * Caches the result so subsequent calls do not re-fetch.
 *
 * Must be called in a browser environment (uses fetch()).
 */
export async function loadTemplate(): Promise<LoadedTemplate> {
  if (cachedTemplate && cachedFont) {
    return { template: cachedTemplate, font: cachedFont };
  }

  // Fetch basePdf and fonts in parallel
  const [pdfResponse, regularFontResponse, boldFontResponse] =
    await Promise.all([
      fetch("/septic_system_insp_form.pdf"),
      fetch("/fonts/LiberationSans-Regular.ttf"),
      fetch("/fonts/LiberationSans-Bold.ttf"),
    ]);

  if (!pdfResponse.ok) {
    throw new Error(
      `Failed to load base PDF: ${pdfResponse.status} ${pdfResponse.statusText}`,
    );
  }
  if (!regularFontResponse.ok) {
    throw new Error(
      `Failed to load regular font: ${regularFontResponse.status}`,
    );
  }
  if (!boldFontResponse.ok) {
    throw new Error(`Failed to load bold font: ${boldFontResponse.status}`);
  }

  const basePdf = await pdfResponse.arrayBuffer();
  const regularFontData = await regularFontResponse.arrayBuffer();
  const boldFontData = await boldFontResponse.arrayBuffer();

  const template: Template = {
    basePdf: new Uint8Array(basePdf),
    schemas: ADEQ_TEMPLATE_SCHEMAS,
  };

  const font: Font = {
    LiberationSans: {
      data: regularFontData,
      fallback: true,
    },
    LiberationSansBold: {
      data: boldFontData,
    },
  };

  cachedTemplate = template;
  cachedFont = font;

  return { template, font };
}

/**
 * Clears the cached template and font data.
 * Useful for testing or when the template needs to be reloaded.
 */
export function clearTemplateCache(): void {
  cachedTemplate = null;
  cachedFont = null;
}
