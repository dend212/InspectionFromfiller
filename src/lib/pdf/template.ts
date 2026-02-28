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
 * Coordinates measured from mm grid overlay on the blank PDF.
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
  textField("taxParcelNumber", 55, 10, 55, 5),
  textField("dateOfInspection", 143, 10, 40, 5),
  textField("inspectorInitials", 200, 10, 12, 5),

  // Property info
  textField("facilityName", 35, 49, 170, 5),
  textField("facilityAddress", 40, 55, 85, 5),
  textField("facilityCity", 130, 55, 30, 5),
  textField("facilityCounty", 165, 55, 40, 5),

  // Seller/Transferor info
  textField("sellerName", 48, 60, 157, 5),
  textField("sellerAddress", 50, 65, 77, 5),
  textField("sellerCity", 130, 65, 30, 5),
  textField("sellerState", 160, 65, 10, 5),
  textField("sellerZip", 177, 65, 28, 5),

  // Inspector info
  textField("inspectorName", 37, 79, 168, 5),
  textField("companyAddress", 41, 84, 82, 5),
  textField("companyCity", 130, 84, 30, 5),
  textField("companyState", 160, 84, 10, 5),
  textField("companyZip", 177, 84, 28, 5),
  textField("company", 38, 89, 167, 5),

  // Inspector qualifications checkboxes and detail fields
  // ADEQ-Recognized Course
  checkbox("hasAdeqCourse", 14.5, 109),
  textField("adeqCourseDetails", 60, 109, 96, 4.5),
  textField("adeqCourseDate", 170, 109, 36, 4.5),

  // Professional Engineer / Registered Sanitarian / WW Operator row
  checkbox("isProfessionalEngineer", 14.5, 120),
  textField("peExpirationDate", 40, 124, 25, 4),
  checkbox("isRegisteredSanitarian", 80, 120),
  textField("rsExpirationDate", 108, 124, 25, 4),
  checkbox("isWastewaterOperator", 128, 120),
  textField("operatorGrade", 155, 124, 20, 4),

  // Licensed Contractor
  checkbox("isLicensedContractor", 14.5, 132),
  textField("contractorLicenseCategory", 78, 132, 127, 4.5),

  // Pumper Truck
  checkbox("hasPumperTruck", 14.5, 140),
  textField("pumperTruckRegistration", 84, 140, 121, 4.5),

  // Employee Name
  textField("employeeName", 65, 150, 140, 4.5),

  // Records Obtained by Inspector
  checkbox("recordsAvailableYes", 148, 163),
  checkbox("recordsAvailableNo", 162, 163),

  // Discharge Auth
  checkbox("hasDischargeAuth", 20, 175),
  textField("dischargeAuthPermitNo", 36, 179, 40, 4),

  // Approval of Construction
  checkbox("hasApprovalOfConstruction", 20, 185),
  textField("approvalPermitNo", 56, 190, 40, 4),

  // Site plan, Operation docs, Other
  checkbox("hasSitePlan", 20, 195),
  checkbox("hasOperationDocs", 20, 199),
  checkbox("hasOtherRecords", 20, 203),
  textField("otherRecordsDescription", 40, 203, 165, 4.5),

  // Cesspool
  checkbox("isCesspoolYes", 103, 228),
  checkbox("isCesspoolNo", 118, 228),
];

// ---------------------------------------------------------------------------
// Page 3: Form Page 2 -- Summary of Inspection, Section 1 (Facility Info),
//         Section 2 (General Treatment) top portion
// ---------------------------------------------------------------------------
const PAGE_3_SCHEMAS: Schema[] = [
  // Header repeaters
  textField("taxParcelNumber_p3", 55, 10, 55, 5),
  textField("dateOfInspection_p3", 143, 10, 40, 5),
  textField("inspectorInitials_p3", 200, 10, 12, 5),

  // Summary of Inspection
  // "Onsite Wastewater Treatment Facility Serves" checkboxes
  checkbox("facilityTypeResidence", 14, 47),
  checkbox("facilityTypeSingleFamily", 65, 47),
  checkbox("facilityTypeMultiFamily", 100, 47),
  checkbox("facilityTypeCommercial", 150, 47),
  textField("facilityTypeOther", 40, 53, 165, 4.5),

  // Type of Facility checkboxes
  checkbox("facilitySystemConventional", 20, 63),
  checkbox("facilitySystemAlternative", 87, 63),
  checkbox("facilitySystemGrayWater", 136, 63),

  // Number of systems and age
  textField("numberOfSystems", 102, 70, 30, 4.5),
  textField("facilityAge", 85, 80, 15, 4.5),
  textField("facilityAgeEstimateExplanation", 72, 86, 133, 4.5),

  // Condition ratings
  // Septic Tank Condition
  checkbox("septicTankConditionOperational", 83, 108),
  checkbox("septicTankConditionConcerns", 110, 108),
  checkbox("septicTankConditionNotOp", 140, 108),

  // Disposal Works Condition
  checkbox("disposalWorksConditionOperational", 88, 130),
  checkbox("disposalWorksConditionConcerns", 118, 130),
  checkbox("disposalWorksConditionNotOp", 148, 130),

  // Alternative System Condition
  checkbox("altSystemConditionOperational", 108, 140),
  checkbox("altSystemConditionConcerns", 130, 140),
  checkbox("altSystemConditionNotOp", 165, 140),

  // Alternative Disposal Condition
  checkbox("altDisposalConditionOperational", 102, 150),
  checkbox("altDisposalConditionConcerns", 130, 150),
  checkbox("altDisposalConditionNotOp", 160, 150),

  // Section 1: Facility Information
  // A) Domestic Water Source checkboxes
  checkbox("waterSourceHauled", 17, 180),
  checkbox("waterSourceMunicipal", 58, 180),
  checkbox("waterSourcePrivateCompany", 102, 180),
  checkbox("waterSourceSharedWell", 137, 180),
  checkbox("waterSourcePrivateWell", 175, 180),
  textField("wellDistance", 108, 185, 75, 4.5),

  // B) Type of Wastewater Source
  checkbox("wastewaterResidential", 20, 195),
  checkbox("wastewaterCommercial", 80, 195),
  textField("wastewaterOther", 115, 195, 90, 4.5),

  // C) Occupancy/Use
  checkbox("occupancyFullTime", 73, 201),
  checkbox("occupancySeasonalPartTime", 108, 201),
  checkbox("occupancyVacant", 138, 201),
  checkbox("occupancyUnknown", 167, 201),

  // Section 2: General Treatment and Disposal Works
  // GP 4.02 system type checkboxes (left column)
  checkbox("checkbox_gp402_conventional", 13, 218),
  checkbox("checkbox_gp402_septic_tank", 28, 225),
  checkbox("checkbox_gp402_disposal_trench", 28, 231),
  checkbox("checkbox_gp402_disposal_bed", 28, 237),
  checkbox("checkbox_gp402_chamber", 28, 242),
  checkbox("checkbox_gp402_seepage_pit", 28, 247),
  checkbox("checkbox_gp403_composting", 13, 253),
  checkbox("checkbox_gp404_pressure", 13, 259),

  // GP 4.05+ system type checkboxes (right column)
  checkbox("checkbox_gp405_gravelless", 123, 218),
  checkbox("checkbox_gp406_natural_evap", 123, 225),
  checkbox("checkbox_gp407_lined_evap", 123, 231),
  checkbox("checkbox_gp408_mound", 123, 237),
  checkbox("checkbox_gp409_engineered_pad", 123, 242),
  checkbox("checkbox_gp410_sand_filter", 123, 247),
  checkbox("checkbox_gp411_peat_filter", 123, 253),
  checkbox("checkbox_gp412_textile_filter", 123, 259),
];

// ---------------------------------------------------------------------------
// Page 4: Form Page 3 -- Section 2 continued (GP 4.13-4.23),
//         Section 3 (Design Flow), Section 4A-4C (Septic Tank start)
// ---------------------------------------------------------------------------
const PAGE_4_SCHEMAS: Schema[] = [
  // Header repeaters
  textField("taxParcelNumber_p4", 55, 10, 55, 5),
  textField("dateOfInspection_p4", 143, 10, 40, 5),
  textField("inspectorInitials_p4", 200, 10, 12, 5),

  // Section 2 continued: GP 4.13-4.23 system type checkboxes
  // Left column
  checkbox("checkbox_gp413_denitrifying", 13, 27),
  checkbox("checkbox_gp414_sewage_vault", 13, 35),
  checkbox("checkbox_gp415_aerobic", 13, 41),
  checkbox("checkbox_gp416_nitrate_filter", 13, 47),
  checkbox("checkbox_gp417_cap", 13, 53),
  checkbox("checkbox_gp418_wetland", 13, 59),
  checkbox("checkbox_gp419_sand_lined", 13, 65),

  // Right column
  checkbox("checkbox_gp420_disinfection", 113, 27),
  checkbox("checkbox_gp421_surface", 113, 35),
  checkbox("checkbox_gp422_drip", 113, 41),
  checkbox("checkbox_gp423_large_flow", 113, 47),

  // Performance Assurance Plan
  checkbox("performanceAssurancePlanYes", 140, 62),
  checkbox("performanceAssurancePlanNo", 155, 62),

  // Section 3: Design Flow and Septic Tank Sizing
  // 3A: Estimated Design Flow
  textField("estimatedDesignFlow", 65, 82, 35, 5),
  checkbox("designFlowUnknown", 125, 82),

  // 3B: Basis for design flow
  checkbox("designFlowBasisPermit", 20, 96),
  checkbox("designFlowBasisCalculated", 20, 101),
  textField("numberOfBedrooms", 80, 108, 35, 4),
  textField("fixtureCount", 80, 114, 35, 4),
  textField("nonDwellingGpd", 57, 119, 25, 4),

  // 3C: Actual flow evaluation
  checkbox("actualFlowNotExceed", 20, 126),
  checkbox("actualFlowMayExceed", 20, 132),
  checkbox("actualFlowUnknown", 20, 137),

  // 3D: Inspector Comments (design flow)
  multilineField("designFlowComments", 50, 142, 155, 12),

  // Section 4: Septic Tank Inspection and Pumping
  // 4A: Number of tanks
  checkbox("numberOfTanks1", 145, 163),
  checkbox("numberOfTanks2OrMore", 162, 163),

  // 4B: Liquid levels
  textField("tank1_liquidLevel", 156, 170, 30, 4.5),
  textField("tank1_primaryScumThickness", 105, 177, 15, 4),
  textField("tank1_primarySludgeThickness", 155, 177, 15, 4),
  textField("tank1_secondaryScumThickness", 105, 183, 15, 4),
  textField("tank1_secondarySludgeThickness", 155, 183, 15, 4),
  checkbox("tank1_liquidLevelNotDetermined", 20, 188),

  // 4C: Pumping
  checkbox("tanksPumpedYes", 138, 194),
  checkbox("tanksPumpedNo", 155, 194),
  textField("haulerCompany", 92, 201, 113, 4.5),
  textField("haulerLicense", 72, 207, 133, 4.5),

  // Pumping not performed reasons (checkboxes)
  checkbox("pumpingNotPerformed_dischAuth", 18, 220),
  checkbox("pumpingNotPerformed_notNecessary", 18, 229),
  checkbox("pumpingNotPerformed_noAccumulation", 18, 238),

  // 4D: Date of inspection for tank
  textField("tankInspectionDate", 80, 248, 40, 4.5),
];

// ---------------------------------------------------------------------------
// Page 5: Form Page 4 -- Section 4E-4M (Tank details, deficiencies, baffles)
// ---------------------------------------------------------------------------
const PAGE_5_SCHEMAS: Schema[] = [
  // Header repeaters
  textField("taxParcelNumber_p5", 55, 10, 55, 5),
  textField("dateOfInspection_p5", 143, 10, 40, 5),
  textField("inspectorInitials_p5", 200, 10, 12, 5),

  // 4E: Capacity
  textField("tank1_tankCapacity", 67, 27, 25, 4.5),
  textField("tank1_tankDimensions", 155, 27, 45, 4.5),
  checkbox("tank1_capacityBasisVolumePumped", 36, 33),
  checkbox("tank1_capacityBasisEstimate", 80, 33),
  checkbox("tank1_capacityBasisPermit", 113, 33),
  checkbox("tank1_capacityBasisNotDetermined", 36, 39),
  textField("tank1_capacityNotDeterminedReason", 91, 39, 114, 4),

  // 4F: Septic tank material
  checkbox("tank1_materialPrecastConcrete", 20, 48),
  checkbox("tank1_materialFiberglass", 62, 48),
  checkbox("tank1_materialPlastic", 95, 48),
  checkbox("tank1_materialSteel", 122, 48),
  checkbox("tank1_materialCastInPlace", 148, 48),
  checkbox("tank1_materialOther", 20, 54),
  textField("tank1_tankMaterialOther", 50, 54, 155, 4.5),

  // 4G: Access openings
  checkbox("tank1_accessOne", 90, 65),
  checkbox("tank1_accessTwo", 112, 65),
  checkbox("tank1_accessThree", 133, 65),
  checkbox("tank1_accessOther", 160, 65),
  textField("tank1_accessOpeningsOther", 180, 65, 25, 4.5),

  // 4H: Lids & risers
  checkbox("tank1_lidsPresent", 85, 75),
  checkbox("tank1_lidsNotPresent", 110, 75),
  checkbox("tank1_lidsSecureYes", 110, 80),
  checkbox("tank1_lidsSecureNo", 130, 80),

  // 4I: Compartments
  checkbox("tank1_compartmentsOne", 108, 91),
  checkbox("tank1_compartmentsTwo", 128, 91),
  checkbox("tank1_compartmentsOther", 148, 91),
  textField("tank1_compartmentsOther_text", 175, 91, 30, 4.5),

  // 4J: Compromised tank
  checkbox("tank1_compromisedYes", 148, 100),
  checkbox("tank1_compromisedNo", 168, 100),

  // 4K: Deficiencies
  checkbox("tank1_deficiencyRootInvasion", 16, 117),
  checkbox("tank1_deficiencyExposedRebar", 113, 117),
  checkbox("tank1_deficiencyCracks", 16, 123),
  checkbox("tank1_deficiencyDamagedInlet", 113, 123),
  checkbox("tank1_deficiencyDamagedLids", 16, 128),
  checkbox("tank1_deficiencyDamagedOutlet", 113, 128),
  checkbox("tank1_deficiencyDeterioratingConcrete", 16, 133),
  checkbox("tank1_deficiencyOther", 113, 133),

  // 4L: Baffle/sanitary T material
  checkbox("tank1_baffleMaterialPrecast", 20, 142),
  checkbox("tank1_baffleMaterialFiberglass", 85, 142),
  checkbox("tank1_baffleMaterialPlastic", 112, 142),
  checkbox("tank1_baffleMaterialCite", 140, 142),
  checkbox("tank1_baffleMaterialNotDetermined", 165, 142),

  // Baffle conditions
  // Inlet baffle
  checkbox("tank1_inletBafflePresent", 82, 155),
  checkbox("tank1_inletBaffleOperational", 108, 155),
  checkbox("tank1_inletBaffleNotOp", 140, 155),
  checkbox("tank1_inletBaffleNotPresent", 168, 155),
  checkbox("tank1_inletBaffleNotDetermined", 190, 155),

  // Outlet baffle
  checkbox("tank1_outletBafflePresent", 82, 163),
  checkbox("tank1_outletBaffleOperational", 108, 163),
  checkbox("tank1_outletBaffleNotOp", 140, 163),
  checkbox("tank1_outletBaffleNotPresent", 168, 163),
  checkbox("tank1_outletBaffleNotDetermined", 190, 163),

  // Interior baffle
  checkbox("tank1_interiorBafflePresent", 82, 170),
  checkbox("tank1_interiorBaffleOperational", 108, 170),
  checkbox("tank1_interiorBaffleNotOp", 140, 170),
  checkbox("tank1_interiorBaffleNotPresent", 168, 170),
  checkbox("tank1_interiorBaffleNotDetermined", 190, 170),

  // 4M: Effluent filter
  checkbox("tank1_effluentFilterPresent", 80, 180),
  checkbox("tank1_effluentFilterNotPresent", 108, 180),
  checkbox("tank1_effluentFilterServiced", 140, 180),
  checkbox("tank1_effluentFilterNotServiced", 168, 180),

  // Septic tank comments (inspector comments section)
  multilineField("septicTankComments", 14, 202, 192, 17),

  // 4.1 Disposal Works section (starts on this page)
  // Location determined
  checkbox("disposalWorksLocationYes", 20, 230),
  checkbox("disposalWorksLocationNo", 105, 230),
  textField(
    "disposalWorksLocationNotDeterminedReason",
    120,
    230,
    85,
    4.5,
  ),

  // Disposal works type
  checkbox("disposalTypeTrench", 20, 242),
  checkbox("disposalTypeBed", 60, 242),
  checkbox("disposalTypeChamber", 95, 242),
  checkbox("disposalTypeSeepagePit", 125, 242),
  checkbox("disposalTypeOther", 155, 242),
  textField("disposalTypeOtherText", 172, 242, 33, 4.5),

  // Method of distribution
  checkbox("distributionDiversion", 17, 253),
  checkbox("distributionDropBox", 75, 253),
  checkbox("distributionBox", 108, 253),
  checkbox("distributionManifold", 140, 253),
  checkbox("distributionSerial", 170, 253),
  checkbox("distributionPressurized", 17, 259),
  checkbox("distributionUnknown", 75, 259),
];

// ---------------------------------------------------------------------------
// Page 6: Form Page 5 -- Section 4.1 continued + Section 5 (Disposal Works
//         deficiencies, inspector comments, signature)
// ---------------------------------------------------------------------------
const PAGE_6_SCHEMAS: Schema[] = [
  // Header repeaters
  textField("taxParcelNumber_p6", 55, 10, 55, 5),
  textField("dateOfInspection_p6", 143, 10, 40, 5),
  textField("inspectorInitials_p6", 200, 10, 12, 5),

  // Distribution component inspected
  checkbox("distributionInspectedYes", 100, 26),
  checkbox("distributionInspectedNo", 118, 26),

  // Supply line material
  checkbox("supplyLinePVC", 72, 32),
  checkbox("supplyLineOrangeburg", 92, 32),
  checkbox("supplyLineTile", 130, 32),
  checkbox("supplyLineOther", 155, 32),
  textField("supplyLineMaterialOtherText", 172, 32, 33, 4.5),

  // Inspection ports
  checkbox("inspectionPortsPresent", 72, 38),
  checkbox("inspectionPortsNotPresent", 105, 38),

  // Port details
  textField("numberOfPorts", 60, 45, 15, 4),
  // Port depths (8 ports)
  textField("portDepth1", 26, 52, 18, 4),
  textField("portDepth2", 68, 52, 18, 4),
  textField("portDepth3", 111, 52, 18, 4),
  textField("portDepth4", 155, 52, 18, 4),
  textField("portDepth5", 26, 58, 18, 4),
  textField("portDepth6", 68, 58, 18, 4),
  textField("portDepth7", 111, 58, 18, 4),
  textField("portDepth8", 155, 58, 18, 4),

  // Hydraulic load test
  checkbox("hydraulicLoadTestYes", 130, 70),
  checkbox("hydraulicLoadTestNo", 148, 70),

  // Disposal works deficiency
  checkbox("hasDisposalDeficiencyYes", 115, 80),
  checkbox("hasDisposalDeficiencyNo", 130, 80),

  // Deficiency checkboxes (list)
  checkbox("defCrushedOutletPipe", 17, 87),
  checkbox("defRootInvasion", 17, 93),
  checkbox("defHighWaterLines", 17, 98),
  checkbox("defDboxNotFunctioning", 17, 103),
  checkbox("defSurfacing", 17, 108),
  checkbox("defLushVegetation", 17, 113),
  checkbox("defErosion", 17, 118),
  checkbox("defPondingWater", 17, 123),
  checkbox("defAnimalIntrusion", 17, 128),
  checkbox("defLoadTestFailure", 17, 133),
  checkbox("defCouldNotDetermine", 17, 138),

  // Repairs recommended
  checkbox("repairsRecommendedYes", 148, 142),
  checkbox("repairsRecommendedNo", 168, 142),

  // Inspector Comments (disposal works)
  multilineField("disposalWorksComments", 19, 148, 186, 17),

  // Signature area
  {
    name: "signatureImage",
    type: "image",
    position: { x: 19, y: 205 },
    width: 60,
    height: 12,
  } as Schema,
  textField("signatureDate", 145, 208, 50, 5),
  textField("printedName", 55, 220, 80, 5),
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
