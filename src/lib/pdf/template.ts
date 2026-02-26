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
  textField("taxParcelNumber", 55, 8, 55, 5),
  textField("dateOfInspection", 143, 8, 40, 5),
  textField("inspectorInitials", 200, 8, 12, 5),

  // Property info
  textField("facilityName", 35, 34, 170, 5),
  textField("facilityAddress", 40, 39.5, 85, 5),
  textField("facilityCity", 140, 39.5, 30, 5),
  textField("facilityCounty", 180, 39.5, 25, 5),

  // Seller/Transferor info
  textField("sellerName", 43, 44.5, 162, 5),
  textField("sellerAddress", 47, 49.5, 80, 5),
  textField("sellerCity", 140, 49.5, 30, 5),
  textField("sellerState", 178, 49.5, 10, 5),
  textField("sellerZip", 196, 49.5, 18, 5),

  // Inspector info
  textField("inspectorName", 37, 57, 168, 5),
  textField("companyAddress", 41, 62, 82, 5),
  textField("companyCity", 140, 62, 30, 5),
  textField("companyState", 178, 62, 10, 5),
  textField("companyZip", 196, 62, 18, 5),
  textField("company", 38, 67, 167, 5),

  // Inspector qualifications checkboxes and detail fields
  // ADEQ-Recognized Course
  checkbox("hasAdeqCourse", 14.5, 77),
  textField("adeqCourseDetails", 60, 77, 96, 4.5),
  textField("adeqCourseDate", 178, 77, 28, 4.5),

  // Professional Engineer / Registered Sanitarian / WW Operator row
  checkbox("isProfessionalEngineer", 14.5, 83.5),
  textField("peExpirationDate", 40, 86.5, 25, 4),
  checkbox("isRegisteredSanitarian", 73, 83.5),
  textField("rsExpirationDate", 100, 86.5, 25, 4),
  checkbox("isWastewaterOperator", 133, 83.5),
  textField("operatorGrade", 163, 86.5, 20, 4),

  // Licensed Contractor
  checkbox("isLicensedContractor", 14.5, 91),
  textField("contractorLicenseCategory", 78, 91, 127, 4.5),

  // Pumper Truck
  checkbox("hasPumperTruck", 14.5, 96),
  textField("pumperTruckRegistration", 84, 96, 121, 4.5),

  // Employee Name
  textField("employeeName", 65, 101, 140, 4.5),

  // Records Obtained by Inspector
  checkbox("recordsAvailableYes", 155, 105.5),
  checkbox("recordsAvailableNo", 168, 105.5),

  // Discharge Auth
  checkbox("hasDischargeAuth", 20, 110),
  textField("dischargeAuthPermitNo", 36, 113, 40, 4),

  // Approval of Construction
  checkbox("hasApprovalOfConstruction", 20, 117),
  textField("approvalPermitNo", 56, 120, 40, 4),

  // Site plan, Operation docs, Other
  checkbox("hasSitePlan", 20, 123.5),
  checkbox("hasOperationDocs", 20, 127),
  checkbox("hasOtherRecords", 20, 130.5),
  textField("otherRecordsDescription", 40, 130.5, 165, 4.5),

  // Cesspool
  checkbox("isCesspoolYes", 65, 140),
  checkbox("isCesspoolNo", 82, 140),

  // Signature and Date on page 1 (bottom)
  // Note: Page 1 has a small signature line for cesspool declaration
];

// ---------------------------------------------------------------------------
// Page 3: Form Page 2 -- Summary of Inspection, Section 1 (Facility Info),
//         Section 2 (General Treatment) top portion
// ---------------------------------------------------------------------------
const PAGE_3_SCHEMAS: Schema[] = [
  // Header repeaters
  textField("taxParcelNumber_p3", 55, 8, 55, 5),
  textField("dateOfInspection_p3", 143, 8, 40, 5),
  textField("inspectorInitials_p3", 200, 8, 12, 5),

  // Summary of Inspection
  // "Onsite Wastewater Treatment Facility Serves" checkboxes
  checkbox("facilityTypeResidence", 20, 36),
  checkbox("facilityTypeSingleFamily", 74, 36),
  checkbox("facilityTypeMultiFamily", 107, 36),
  checkbox("facilityTypeCommercial", 157, 36),
  textField("facilityTypeOther", 40, 41, 165, 4.5),

  // Type of Facility checkboxes
  checkbox("facilitySystemConventional", 20, 47),
  checkbox("facilitySystemAlternative", 87, 47),
  checkbox("facilitySystemGrayWater", 136, 47),

  // Number of systems and age
  textField("numberOfSystems", 102, 50, 30, 4.5),
  textField("facilityAge", 85, 54, 15, 4.5),
  textField("facilityAgeEstimateExplanation", 72, 57, 133, 4.5),

  // Condition ratings
  // Septic Tank Condition
  checkbox("septicTankConditionOperational", 62, 62.5),
  checkbox("septicTankConditionConcerns", 95, 62.5),
  checkbox("septicTankConditionNotOp", 150, 62.5),

  // Disposal Works Condition
  checkbox("disposalWorksConditionOperational", 67, 67),
  checkbox("disposalWorksConditionConcerns", 100, 67),
  checkbox("disposalWorksConditionNotOp", 155, 67),

  // Alternative System Condition
  checkbox("altSystemConditionOperational", 76, 71),
  checkbox("altSystemConditionConcerns", 109, 71),
  checkbox("altSystemConditionNotOp", 164, 71),

  // Alternative Disposal Condition
  checkbox("altDisposalConditionOperational", 72, 75),
  checkbox("altDisposalConditionConcerns", 104, 75),
  checkbox("altDisposalConditionNotOp", 160, 75),

  // Section 1: Facility Information
  // A) Domestic Water Source checkboxes
  checkbox("waterSourceHauled", 17, 85),
  checkbox("waterSourceMunicipal", 52, 85),
  checkbox("waterSourcePrivateCompany", 91, 85),
  checkbox("waterSourceSharedWell", 137, 85),
  checkbox("waterSourcePrivateWell", 175, 85),
  textField("wellDistance", 108, 89, 75, 4.5),

  // B) Type of Wastewater Source
  checkbox("wastewaterResidential", 20, 93.5),
  checkbox("wastewaterCommercial", 52, 93.5),
  textField("wastewaterOther", 115, 93.5, 90, 4.5),

  // C) Occupancy/Use
  checkbox("occupancyFullTime", 31, 97),
  checkbox("occupancySeasonalPartTime", 64, 97),
  checkbox("occupancyVacant", 114, 97),
  checkbox("occupancyUnknown", 147, 97),

  // Section 2: General Treatment and Disposal Works
  // GP 4.02 system type checkboxes (left column)
  checkbox("checkbox_gp402_conventional", 13, 105),
  checkbox("checkbox_gp402_septic_tank", 28, 109),
  checkbox("checkbox_gp402_disposal_trench", 28, 113),
  checkbox("checkbox_gp402_disposal_bed", 28, 117),
  checkbox("checkbox_gp402_chamber", 28, 121),
  checkbox("checkbox_gp402_seepage_pit", 28, 125),
  checkbox("checkbox_gp403_composting", 13, 129),
  checkbox("checkbox_gp404_pressure", 13, 133),

  // GP 4.05+ system type checkboxes (right column)
  checkbox("checkbox_gp405_gravelless", 113, 105),
  checkbox("checkbox_gp406_natural_evap", 113, 109),
  checkbox("checkbox_gp407_lined_evap", 113, 113),
  checkbox("checkbox_gp408_mound", 113, 117),
  checkbox("checkbox_gp409_engineered_pad", 113, 121),
  checkbox("checkbox_gp410_sand_filter", 113, 125),
  checkbox("checkbox_gp411_peat_filter", 113, 129),
  checkbox("checkbox_gp412_textile_filter", 113, 133),
];

// ---------------------------------------------------------------------------
// Page 4: Form Page 3 -- Section 2 continued (GP 4.13-4.23),
//         Section 3 (Design Flow), Section 4A-4C (Septic Tank start)
// ---------------------------------------------------------------------------
const PAGE_4_SCHEMAS: Schema[] = [
  // Header repeaters
  textField("taxParcelNumber_p4", 55, 8, 55, 5),
  textField("dateOfInspection_p4", 143, 8, 40, 5),
  textField("inspectorInitials_p4", 200, 8, 12, 5),

  // Section 2 continued: GP 4.13-4.23 system type checkboxes
  // Left column
  checkbox("checkbox_gp413_denitrifying", 13, 17),
  checkbox("checkbox_gp414_sewage_vault", 13, 22),
  checkbox("checkbox_gp415_aerobic", 13, 26),
  checkbox("checkbox_gp416_nitrate_filter", 13, 30),
  checkbox("checkbox_gp417_cap", 13, 34),
  checkbox("checkbox_gp418_wetland", 13, 38),
  checkbox("checkbox_gp419_sand_lined", 13, 42),

  // Right column
  checkbox("checkbox_gp420_disinfection", 113, 17),
  checkbox("checkbox_gp421_surface", 113, 22),
  checkbox("checkbox_gp422_drip", 113, 26),
  checkbox("checkbox_gp423_large_flow", 113, 30),

  // Performance Assurance Plan
  checkbox("performanceAssurancePlanYes", 155, 37),
  checkbox("performanceAssurancePlanNo", 168, 37),

  // Section 3: Design Flow and Septic Tank Sizing
  // 3A: Estimated Design Flow
  textField("estimatedDesignFlow", 58, 48, 35, 5),
  checkbox("designFlowUnknown", 118, 48),

  // 3B: Basis for design flow
  checkbox("designFlowBasisPermit", 20, 54),
  checkbox("designFlowBasisCalculated", 20, 58),
  textField("numberOfBedrooms", 80, 62, 35, 4),
  textField("fixtureCount", 80, 66, 35, 4),
  textField("nonDwellingGpd", 57, 70, 25, 4),

  // 3C: Actual flow evaluation
  checkbox("actualFlowNotExceed", 20, 76),
  checkbox("actualFlowMayExceed", 20, 80),
  checkbox("actualFlowUnknown", 20, 84),

  // 3D: Inspector Comments (design flow)
  multilineField("designFlowComments", 50, 88, 155, 9),

  // Section 4: Septic Tank Inspection and Pumping
  // 4A: Number of tanks
  checkbox("numberOfTanks1", 155, 100),
  checkbox("numberOfTanks2OrMore", 168, 100),

  // 4B: Liquid levels
  textField("tank1_liquidLevel", 156, 105, 30, 4.5),
  textField("tank1_primaryScumThickness", 95, 109, 15, 4),
  textField("tank1_primarySludgeThickness", 155, 109, 15, 4),
  textField("tank1_secondaryScumThickness", 95, 113, 15, 4),
  textField("tank1_secondarySludgeThickness", 155, 113, 15, 4),
  checkbox("tank1_liquidLevelNotDetermined", 20, 117),

  // 4C: Pumping
  checkbox("tanksPumpedYes", 155, 124),
  checkbox("tanksPumpedNo", 168, 124),
  textField("haulerCompany", 92, 128, 113, 4.5),
  textField("haulerLicense", 72, 132, 133, 4.5),

  // Pumping not performed reasons (checkboxes)
  checkbox("pumpingNotPerformed_dischAuth", 18, 137),
  checkbox("pumpingNotPerformed_notNecessary", 18, 142),
  checkbox("pumpingNotPerformed_noAccumulation", 18, 147),

  // 4D: Date of inspection for tank
  textField("tankInspectionDate", 80, 152, 40, 4.5),
];

// ---------------------------------------------------------------------------
// Page 5: Form Page 4 -- Section 4E-4M (Tank details, deficiencies, baffles)
// ---------------------------------------------------------------------------
const PAGE_5_SCHEMAS: Schema[] = [
  // Header repeaters
  textField("taxParcelNumber_p5", 55, 8, 55, 5),
  textField("dateOfInspection_p5", 143, 8, 40, 5),
  textField("inspectorInitials_p5", 200, 8, 12, 5),

  // 4E: Capacity
  textField("tank1_tankCapacity", 67, 17, 25, 4.5),
  textField("tank1_tankDimensions", 155, 17, 45, 4.5),
  checkbox("tank1_capacityBasisVolumePumped", 36, 21),
  checkbox("tank1_capacityBasisEstimate", 80, 21),
  checkbox("tank1_capacityBasisPermit", 113, 21),
  checkbox("tank1_capacityBasisNotDetermined", 36, 25),
  textField("tank1_capacityNotDeterminedReason", 91, 25, 114, 4),

  // 4F: Septic tank material
  checkbox("tank1_materialPrecastConcrete", 20, 32),
  checkbox("tank1_materialFiberglass", 62, 32),
  checkbox("tank1_materialPlastic", 95, 32),
  checkbox("tank1_materialSteel", 122, 32),
  checkbox("tank1_materialCastInPlace", 148, 32),
  checkbox("tank1_materialOther", 20, 36),
  textField("tank1_tankMaterialOther", 50, 36, 155, 4.5),

  // 4G: Access openings
  checkbox("tank1_accessOne", 67, 41),
  checkbox("tank1_accessTwo", 88, 41),
  checkbox("tank1_accessThree", 109, 41),
  checkbox("tank1_accessOther", 138, 41),
  textField("tank1_accessOpeningsOther", 168, 41, 37, 4.5),

  // 4H: Lids & risers
  checkbox("tank1_lidsPresent", 57, 46),
  checkbox("tank1_lidsNotPresent", 78, 46),
  checkbox("tank1_lidsSecureYes", 122, 49),
  checkbox("tank1_lidsSecureNo", 137, 49),

  // 4I: Compartments
  checkbox("tank1_compartmentsOne", 76, 55),
  checkbox("tank1_compartmentsTwo", 97, 55),
  checkbox("tank1_compartmentsOther", 118, 55),
  textField("tank1_compartmentsOther_text", 155, 55, 50, 4.5),

  // 4J: Compromised tank
  checkbox("tank1_compromisedYes", 157, 59),
  checkbox("tank1_compromisedNo", 172, 59),

  // 4K: Deficiencies
  checkbox("tank1_deficiencyRootInvasion", 16, 67),
  checkbox("tank1_deficiencyExposedRebar", 113, 67),
  checkbox("tank1_deficiencyCracks", 16, 71),
  checkbox("tank1_deficiencyDamagedInlet", 113, 71),
  checkbox("tank1_deficiencyDamagedLids", 16, 75),
  checkbox("tank1_deficiencyDamagedOutlet", 113, 75),
  checkbox("tank1_deficiencyDeterioratingConcrete", 16, 79),
  checkbox("tank1_deficiencyOther", 113, 79),

  // 4L: Baffle/sanitary T material
  checkbox("tank1_baffleMaterialPrecast", 20, 86),
  checkbox("tank1_baffleMaterialFiberglass", 62, 86),
  checkbox("tank1_baffleMaterialPlastic", 95, 86),
  checkbox("tank1_baffleMaterialCite", 122, 86),
  checkbox("tank1_baffleMaterialNotDetermined", 148, 86),

  // Baffle conditions
  // Inlet baffle
  checkbox("tank1_inletBafflePresent", 47, 92),
  checkbox("tank1_inletBaffleOperational", 72, 92),
  checkbox("tank1_inletBaffleNotOp", 112, 92),
  checkbox("tank1_inletBaffleNotPresent", 148, 92),
  checkbox("tank1_inletBaffleNotDetermined", 180, 92),

  // Outlet baffle
  checkbox("tank1_outletBafflePresent", 47, 97),
  checkbox("tank1_outletBaffleOperational", 72, 97),
  checkbox("tank1_outletBaffleNotOp", 112, 97),
  checkbox("tank1_outletBaffleNotPresent", 148, 97),
  checkbox("tank1_outletBaffleNotDetermined", 180, 97),

  // Interior baffle
  checkbox("tank1_interiorBafflePresent", 47, 102),
  checkbox("tank1_interiorBaffleOperational", 72, 102),
  checkbox("tank1_interiorBaffleNotOp", 112, 102),
  checkbox("tank1_interiorBaffleNotPresent", 148, 102),
  checkbox("tank1_interiorBaffleNotDetermined", 180, 102),

  // 4M: Effluent filter
  checkbox("tank1_effluentFilterPresent", 52, 107),
  checkbox("tank1_effluentFilterNotPresent", 78, 107),
  checkbox("tank1_effluentFilterServiced", 112, 107),
  checkbox("tank1_effluentFilterNotServiced", 142, 107),

  // Septic tank comments (inspector comments section)
  multilineField("septicTankComments", 14, 118, 192, 20),

  // 4.1 Disposal Works section (starts on this page)
  // Location determined
  checkbox("disposalWorksLocationYes", 20, 143),
  checkbox("disposalWorksLocationNo", 72, 143),
  textField(
    "disposalWorksLocationNotDeterminedReason",
    105,
    143,
    100,
    4.5,
  ),

  // Disposal works type
  checkbox("disposalTypeTrench", 20, 149),
  checkbox("disposalTypeBed", 47, 149),
  checkbox("disposalTypeChamber", 74, 149),
  checkbox("disposalTypeSeepagePit", 111, 149),
  checkbox("disposalTypeOther", 148, 149),
  textField("disposalTypeOtherText", 165, 149, 40, 4.5),

  // Method of distribution
  checkbox("distributionDiversion", 17, 155),
  checkbox("distributionDropBox", 55, 155),
  checkbox("distributionBox", 92, 155),
  checkbox("distributionManifold", 130, 155),
  checkbox("distributionSerial", 162, 155),
  checkbox("distributionPressurized", 17, 159),
  checkbox("distributionUnknown", 55, 159),
];

// ---------------------------------------------------------------------------
// Page 6: Form Page 5 -- Section 4.1 continued + Section 5 (Disposal Works
//         deficiencies, inspector comments, signature)
// ---------------------------------------------------------------------------
const PAGE_6_SCHEMAS: Schema[] = [
  // Header repeaters
  textField("taxParcelNumber_p6", 55, 8, 55, 5),
  textField("dateOfInspection_p6", 143, 8, 40, 5),
  textField("inspectorInitials_p6", 200, 8, 12, 5),

  // Distribution component inspected
  checkbox("distributionInspectedYes", 72, 14),
  checkbox("distributionInspectedNo", 90, 14),

  // Supply line material
  checkbox("supplyLinePVC", 72, 18),
  checkbox("supplyLineOrangeburg", 92, 18),
  checkbox("supplyLineTile", 130, 18),
  checkbox("supplyLineOther", 155, 18),
  textField("supplyLineMaterialOtherText", 172, 18, 33, 4.5),

  // Inspection ports
  checkbox("inspectionPortsPresent", 72, 23),
  checkbox("inspectionPortsNotPresent", 96, 23),

  // Port details
  textField("numberOfPorts", 60, 28, 15, 4),
  // Port depths (8 ports)
  textField("portDepth1", 26, 33, 18, 4),
  textField("portDepth2", 68, 33, 18, 4),
  textField("portDepth3", 111, 33, 18, 4),
  textField("portDepth4", 155, 33, 18, 4),
  textField("portDepth5", 26, 37, 18, 4),
  textField("portDepth6", 68, 37, 18, 4),
  textField("portDepth7", 111, 37, 18, 4),
  textField("portDepth8", 155, 37, 18, 4),

  // Hydraulic load test
  checkbox("hydraulicLoadTestYes", 155, 42),
  checkbox("hydraulicLoadTestNo", 172, 42),

  // Disposal works deficiency
  checkbox("hasDisposalDeficiencyYes", 82, 46),
  checkbox("hasDisposalDeficiencyNo", 100, 46),

  // Deficiency checkboxes (list)
  checkbox("defCrushedOutletPipe", 17, 51),
  checkbox("defRootInvasion", 17, 55),
  checkbox("defHighWaterLines", 17, 59),
  checkbox("defDboxNotFunctioning", 17, 63),
  checkbox("defSurfacing", 17, 67),
  checkbox("defLushVegetation", 17, 71),
  checkbox("defErosion", 17, 75),
  checkbox("defPondingWater", 17, 79),
  checkbox("defAnimalIntrusion", 17, 83),
  checkbox("defLoadTestFailure", 17, 87),
  checkbox("defCouldNotDetermine", 17, 91),

  // Repairs recommended
  checkbox("repairsRecommendedYes", 160, 95),
  checkbox("repairsRecommendedNo", 178, 95),

  // Inspector Comments (disposal works)
  multilineField("disposalWorksComments", 19, 100, 186, 14),

  // Signature area
  {
    name: "signatureImage",
    type: "image",
    position: { x: 19, y: 128 },
    width: 60,
    height: 18,
  } as Schema,
  textField("signatureDate", 145, 133, 50, 5),
  textField("printedName", 43, 141, 80, 5),
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
