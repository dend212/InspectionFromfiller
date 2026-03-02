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
import { loadPublicFile } from "./load-public-file";

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

/** Small checkbox rendered as centered "X" text overlay.
 *  y is shifted up 1mm to compensate for font metrics rendering
 *  the "X" glyph slightly below the geometric center. */
function checkbox(name: string, x: number, y: number): Schema {
  return {
    name,
    type: "text",
    position: { x: x + 4, y: y - 1 },
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
  // "TAX PARCEL NO." label at x=64, y=13.3 — data goes on the line after the label
  textField("taxParcelNumber", 90, 11.3, 27, 5),
  // "DATE OF INSPECTION:" label at x=118.8, y=13.3 — data after label
  textField("dateOfInspection", 148, 11.3, 15, 5),
  // "Initials of Inspector _______" label at x=165.3, y=13.3 — data on underline
  textField("inspectorInitials", 192, 11.3, 14, 5),

  // Property info
  // "Property Name: ____" label ends at 35.5mm; underline 36.4–201.6mm
  textField("facilityName", 37, 46.4, 164, 5),
  // "Property Address: ____" underline 39.4–99mm; "City:" 100–106mm, underline 107–145mm; "County:" 145–156mm, underline 157–201mm
  textField("facilityAddress", 40, 51.4, 59, 5),
  textField("facilityCity", 107, 51.4, 37, 5),
  textField("facilityCounty", 157, 51.4, 44, 5),

  // Seller/Transferor info
  // "Seller/Transferor Name:" label ends at 47.4mm; underline 48.2–201mm
  textField("sellerName", 48, 56.3, 153, 5),
  // "Seller/Transferor Address:" underline 51–99mm; "City:" underline 107–146mm; "State:" underline 157–164mm; "ZIP Code:" underline 180–201mm
  textField("sellerAddress", 52, 61.2, 47, 5),
  textField("sellerCity", 107, 61.2, 39, 5),
  textField("sellerState", 157, 61.2, 7, 5),
  textField("sellerZip", 180, 61.2, 21, 5),

  // Inspector info
  // "Inspector Name:" label ends at 36.5mm; underline 37.3–199.6mm
  textField("inspectorName", 38, 75.7, 162, 5),
  // "Company Address:" underline 40–99mm; "City:" underline 107–146mm; "State:" underline 157–164mm; "ZIP Code:" underline 180–201mm
  textField("companyAddress", 41, 80.7, 58, 5),
  textField("companyCity", 107, 80.7, 39, 5),
  textField("companyState", 157, 80.7, 7, 5),
  textField("companyZip", 180, 80.7, 21, 5),
  // "Company Name:" label ends at 36.6mm; underline 37.3–200.7mm
  textField("company", 38, 85.6, 163, 5),

  // Inspector qualifications checkboxes and detail fields
  // "ADEQ-Recognized Course: ____" at x=17.8, y=106.0 — checkbox at ~x=13, data after label ~x=72
  checkbox("hasAdeqCourse", 9, 104),
  textField("adeqCourseDetails", 72, 104, 80, 4.5),
  // "Date Completed: ____" — label near end of line, data after ~x=176
  textField("adeqCourseDate", 174, 104, 32, 4.5),

  // Professional Engineer / Registered Sanitarian / WW Operator row at y=115.9
  // "Professional Engineer" at x=17.8 — checkbox 5mm left
  checkbox("isProfessionalEngineer", 9, 113.9),
  // "(Expiration date:____)" at y=120.2 — data after "Expiration date:" ~x=42
  textField("peExpirationDate", 42, 118.2, 25, 4),
  // "Registered Sanitarian" at x=58.7
  checkbox("isRegisteredSanitarian", 49, 113.9),
  // Second "(Expiration date:____)" — data ~x=100
  textField("rsExpirationDate", 100, 118.2, 18, 4),
  // "Wastewater Treatment Plant Operator" at x=99.2
  checkbox("isWastewaterOperator", 91, 113.9),
  // "(Grade:____)" at x=101.6, y=120.9 — data after "Grade:" ~x=120
  textField("operatorGrade", 120, 118.9, 20, 4),

  // "Arizona Licensed Contractor for License Category: ____" at x=18.6, y=128.7
  checkbox("isLicensedContractor", 14, 126.7),
  textField("contractorLicenseCategory", 96, 126.7, 112, 4.5),

  // "Owner of pumper truck and ADEQ Truck Registration No: ____" at x=17.8, y=138.6
  checkbox("hasPumperTruck", 13, 136.6),
  textField("pumperTruckRegistration", 105, 136.6, 103, 4.5),

  // "Employee Name Performing Inspection: ____" at x=17.8, y=148.5 — data after label ~x=85
  textField("employeeName", 85, 146.5, 123, 4.5),

  // Records Obtained by Inspector
  // "Were there facility permit... records available..." at y=162.6; "Yes" at x=160.6; "No" at x=172.9
  checkbox("recordsAvailableYes", 152, 160.6),
  checkbox("recordsAvailableNo", 164, 160.6),

  // "Discharge Authorization..." at x=30.5, y=173.3
  checkbox("hasDischargeAuth", 26, 171.3),
  // "Permit No.____" at x=31.0, y=178.2 — data after "Permit No." ~x=60
  textField("dischargeAuthPermitNo", 60, 176.2, 40, 4),

  // "Approval of Construction..." at x=30.5, y=183.2
  checkbox("hasApprovalOfConstruction", 26, 181.2),
  // "January 1, 2001, Permit No." at x=31.0, y=188.1 — data after ~x=85
  textField("approvalPermitNo", 85, 186.1, 40, 4),

  // "Site plan, plot plan..." at x=30.5, y=193.1
  checkbox("hasSitePlan", 26, 191.1),
  // "Documents relating to operation..." at x=30.5, y=198.1
  checkbox("hasOperationDocs", 26, 196.1),
  // "Other: ____" at x=30.5, y=203.0
  checkbox("hasOtherRecords", 26, 201.0),
  textField("otherRecordsDescription", 46, 201.0, 162, 4.5),

  // Cesspool section
  // "Is a cesspool serving the property?" at y=224.0; "Yes" at x=76.6; "No" at x=94.5
  checkbox("isCesspoolYes", 68, 222.0),
  checkbox("isCesspoolNo", 87, 222.0),
];

// ---------------------------------------------------------------------------
// Page 3: Form Page 2 -- Summary of Inspection, Section 1 (Facility Info),
//         Section 2 (General Treatment) top portion
// ---------------------------------------------------------------------------
const PAGE_3_SCHEMAS: Schema[] = [
  // Header repeaters
  // "TAX PARCEL NO." at x=64.9, y=12.9; "DATE OF INSPECTION:" at x=118.3, y=13.2; "Initials" at x=165.3, y=13.3
  textField("taxParcelNumber_p3", 90, 10.9, 27, 5),
  textField("dateOfInspection_p3", 148, 11.2, 15, 5),
  textField("inspectorInitials_p3", 198, 11.3, 12, 5),

  // Summary of Inspection
  // "Onsite Wastewater Treatment Facility Serves" checkboxes at y=49.2
  // "Residence/Dwelling" at x=28.2 — checkbox 5mm left
  checkbox("facilityTypeResidence", 19, 47.2),
  // "Single family" at x=72.0
  checkbox("facilityTypeSingleFamily", 63, 47.2),
  // "Multi- family/Shared" at x=104.0
  checkbox("facilityTypeMultiFamily", 95, 47.2),
  // "Commercial" at x=146.9
  checkbox("facilityTypeCommercial", 138, 47.2),
  // "Other (Explain): ____" at x=28.2, y=57.5 — data after label ~x=62
  textField("facilityTypeOther", 62, 55.5, 146, 4.5),

  // Type of Facility checkboxes at y=71.5
  // "Conventional System" at x=28.2
  checkbox("facilitySystemConventional", 19, 69.5),
  // "Alternative System" at x=70.7
  checkbox("facilitySystemAlternative", 62, 69.5),
  // "Gray Water System Observed" at x=108.4
  checkbox("facilitySystemGrayWater", 100, 69.5),

  // "Number of Onsite Wastewater Systems on the property: ____" at y=78.1 — data after ~x=120
  textField("numberOfSystems", 120, 76.1, 20, 4.5),
  // "Age of inspected... Facility: ____ years" at y=88.1 — data after "Facility:" ~x=72
  textField("facilityAge", 72, 88.1, 18, 4.5),
  // "If estimated, explain how it was determined: ____" at y=93.0 — data after ~x=90
  textField("facilityAgeEstimateExplanation", 90, 91.0, 118, 4.5),

  // Condition ratings
  // Septic Tank Condition at y=109.0: "Operational" x=53.1, "Operational with concerns" x=79.3, "Not Operational" x=125.6
  checkbox("septicTankConditionOperational", 43, 107.0),
  checkbox("septicTankConditionConcerns", 70, 107.0),
  checkbox("septicTankConditionNotOp", 117, 107.0),

  // Disposal Works Condition at y=121.1: "Operational" x=58.7, "with concerns" x=84.9, "Not Op" x=131.2
  checkbox("disposalWorksConditionOperational", 50, 119.1),
  checkbox("disposalWorksConditionConcerns", 75, 119.1),
  checkbox("disposalWorksConditionNotOp", 123, 119.1),

  // Alternative System Condition at y=132.8: "Operational" x=88.2, "with concerns" x=114.4, "Not Op" x=160.8
  checkbox("altSystemConditionOperational", 80, 130.8),
  checkbox("altSystemConditionConcerns", 106, 130.8),
  checkbox("altSystemConditionNotOp", 152, 130.8),

  // Alternative Disposal Condition at y=144.1: "Operational" x=75.4, "with concerns" x=101.6, "Not Op" x=147.9
  checkbox("altDisposalConditionOperational", 67, 142.1),
  checkbox("altDisposalConditionConcerns", 93, 142.1),
  checkbox("altDisposalConditionNotOp", 139, 142.1),

  // Section 1: Facility Information
  // A) Domestic Water Source checkboxes at y=174.1
  // "Hauled Water" x=29.6, "Municipal System" x=59.5, "Private Water Company" x=95.6,
  // "Shared Private Well" x=139.0, "Private Well" x=175.2
  checkbox("waterSourceHauled", 25, 172.1),
  checkbox("waterSourceMunicipal", 55, 172.1),
  checkbox("waterSourcePrivateCompany", 91, 172.1),
  checkbox("waterSourceSharedWell", 135, 172.1),
  checkbox("waterSourcePrivateWell", 171, 172.0),
  // "If a well is nearby... distance... ____" at y=180.4 — data after ~x=115
  textField("wellDistance", 115, 178.4, 60, 4.5),

  // B) Type of Wastewater Source at y≈190
  // "Residential" at x=31.1, y=190.8; "Commercial" at x=61.2, y=190.1; "Other ____" at x=94.8, y=190.1
  checkbox("wastewaterResidential", 27, 188.8),
  checkbox("wastewaterCommercial", 57, 188.1),
  textField("wastewaterOther", 100, 188.1, 108, 4.5),

  // C) Occupancy/Use at y=197.5
  // "___ Full Time" at x=12.4 (data ~x=37); "____ Seasonal/Part Time" at x=69.8; "___ Vacant" at x=112.7; "____ Unknown" at x=139.8
  // Checkboxes go on the blank underlines before each label
  checkbox("occupancyFullTime", 16, 195.5),
  checkbox("occupancySeasonalPartTime", 71, 195.5),
  checkbox("occupancyVacant", 114, 195.5),
  checkbox("occupancyUnknown", 141, 195.5),

  // Section 2: General Treatment and Disposal Works
  // Left column GP 4.02-4.04
  // "GP 4.02 Conventional..." at x=19.7, y=215.5
  checkbox("checkbox_gp402_conventional", 15, 213.5),
  // Sub-items at x=44.2: Septic Tank y=220.4, Disposal Trench y=225.4, Disposal Bed y=230.4,
  // Chamber y=235.3, Seepage Pit y=240.3
  checkbox("checkbox_gp402_septic_tank", 40, 218.4),
  checkbox("checkbox_gp402_disposal_trench", 40, 223.4),
  checkbox("checkbox_gp402_disposal_bed", 39, 228.4),
  checkbox("checkbox_gp402_chamber", 39, 233.3),
  checkbox("checkbox_gp402_seepage_pit", 39, 238.3),
  // "GP 4.03 Composting Toilet" at x=19.7, y=244.5
  checkbox("checkbox_gp403_composting", 15, 242.5),
  // "GP 4.04 Pressure Distribution System" at x=19.7, y=249.5
  checkbox("checkbox_gp404_pressure", 15, 247.5),

  // Right column GP 4.05-4.12
  // "GP 4.05 Gravelless Trench" at x=112.2, y=215.6
  checkbox("checkbox_gp405_gravelless", 108, 213.6),
  // "GP 4.06 Natural Seal..." at x=112.2, y=220.5
  checkbox("checkbox_gp406_natural_evap", 108, 218.5),
  // "GP 4.07 Lined Evapotranspiration..." at x=112.2, y=225.5
  checkbox("checkbox_gp407_lined_evap", 108, 223.5),
  // "GP 4.08 Wisconsin Mound" at x=112.2, y=230.4
  checkbox("checkbox_gp408_mound", 108, 228.4),
  // "GP 4.09 Engineered Pad System" at x=112.2, y=235.4
  checkbox("checkbox_gp409_engineered_pad", 108, 233.4),
  // "GP 4.10 Intermittent Sand Filter" at x=112.2, y=240.3
  checkbox("checkbox_gp410_sand_filter", 108, 238.3),
  // "GP 4.11 Peat Filter" at x=112.3, y=244.6
  checkbox("checkbox_gp411_peat_filter", 108, 242.6),
  // "GP 4.12 Textile Filter" at x=112.3, y=249.3
  checkbox("checkbox_gp412_textile_filter", 108, 247.3),
];

// ---------------------------------------------------------------------------
// Page 4: Form Page 3 -- Section 2 continued (GP 4.13-4.23),
//         Section 3 (Design Flow), Section 4A-4C (Septic Tank start)
// ---------------------------------------------------------------------------
const PAGE_4_SCHEMAS: Schema[] = [
  // Header repeaters
  // "TAX PARCEL NO." at x=64.4, y=12.7
  textField("taxParcelNumber_p4", 90, 10.7, 27, 5),
  textField("dateOfInspection_p4", 148, 11.0, 15, 5),
  textField("inspectorInitials_p4", 198, 11.3, 12, 5),

  // Section 2 continued: GP 4.13-4.23 system type checkboxes
  // Left column
  // "GP 4.13..." at x=19.9, y=33.3
  checkbox("checkbox_gp413_denitrifying", 15, 31.3),
  // "GP 4.14 Sewage Vault" at x=19.9, y=43.2
  checkbox("checkbox_gp414_sewage_vault", 15, 41.2),
  // "GP 4.15 Aerobic System" at x=19.9, y=48.1
  checkbox("checkbox_gp415_aerobic", 15, 46.1),
  // "GP 4.16 Nitrate-Reactive Media Filter" at x=19.9, y=53.1
  checkbox("checkbox_gp416_nitrate_filter", 15, 51.1),
  // "GP 4.17 Cap System" at x=19.9, y=58.1
  checkbox("checkbox_gp417_cap", 15, 56.1),
  // "GP 4.18 Constructed Wetland" at x=19.9, y=63.0
  checkbox("checkbox_gp418_wetland", 15, 61.0),
  // "GP 4.19 Sand-Lined Trench" at x=19.9, y=68.0
  checkbox("checkbox_gp419_sand_lined", 15, 66.0),

  // Right column
  // "GP 4.20 Disinfection Device" at x=112.6, y=33.2
  checkbox("checkbox_gp420_disinfection", 108, 31.2),
  // "GP 4.21 Surface Disposal" at x=112.6, y=38.0
  checkbox("checkbox_gp421_surface", 108, 36.0),
  // "GP 4.22 Subsurface Drip..." at x=112.6, y=42.6
  checkbox("checkbox_gp422_drip", 108, 40.6),
  // "GP 4.23 Design flow..." at x=112.6, y=47.4
  checkbox("checkbox_gp423_large_flow", 108, 45.4),

  // Performance Assurance Plan: "Yes" at x=124.6, y=62.3; "No" at x=137.3
  checkbox("performanceAssurancePlanYes", 120, 60.3),
  checkbox("performanceAssurancePlanNo", 135, 60.3),

  // Section 3: Design Flow and Septic Tank Sizing
  // "Estimated Design Flow:" at x=25.4, y=82.6; "gallons per day" at x=77.0, y=83.4
  // Data goes between label end (~x=60) and "gallons per day" (~x=75)
  textField("estimatedDesignFlow", 60, 80.6, 15, 5),
  // "Unknown" checkbox at x=120.3, y=83.4
  checkbox("designFlowUnknown", 116, 81.4),

  // 3B: Basis for design flow
  // "Designated in permitting documents" at x=31.3, y=94.7
  checkbox("designFlowBasisPermit", 27, 92.7),
  // "Calculated or estimated..." at x=31.3, y=99.7
  checkbox("designFlowBasisCalculated", 27, 97.7),
  // "Number of bedrooms for a dwelling: ____" at x=44.0, y=104.6 — data after ~x=110
  textField("numberOfBedrooms", 110, 102.6, 20, 4),
  // "Fixture count for a dwelling: ____" at x=44.0, y=109.6 — data after ~x=105
  textField("fixtureCount", 105, 107.6, 20, 4),
  // "If not a dwelling: ____ gallons per day" at x=44.0, y=114.5 — data after ~x=80
  textField("nonDwellingGpd", 80, 112.5, 25, 4),

  // 3C: Actual flow evaluation
  // "Actual flow did not appear to exceed design flow" at x=31.3, y=124.5
  checkbox("actualFlowNotExceed", 27, 122.5),
  // "Actual flow may exceed design flow" at x=31.3, y=129.4
  checkbox("actualFlowMayExceed", 27, 127.4),
  // "Unknown" at x=31.3, y=134.4
  checkbox("actualFlowUnknown", 27, 132.4),

  // 3D: "Inspector Comments: ____" at x=25.4, y=139.3 — data after ~x=62
  multilineField("designFlowComments", 62, 137.3, 146, 10),

  // Section 4: Septic Tank Inspection and Pumping
  // 4A: Number of tanks — "1" at x=152.9, y=160.0; "2 or more" at x=170.3
  checkbox("numberOfTanks1", 148, 158.0),
  checkbox("numberOfTanks2OrMore", 166, 158.0),

  // 4B: Liquid levels
  // "B) Septic tank liquid level..." at y=166.2
  // "Primary (inlet) chamber: Scum thickness ____ inches, Sludge thickness ____ inches" at y=172.0
  // "Scum thickness" label ends ~x=92; "Sludge thickness" label ends ~x=152
  textField("tank1_primaryScumThickness", 92, 170.0, 15, 4),
  textField("tank1_primarySludgeThickness", 152, 170.0, 15, 4),
  // "Secondary (outlet) chamber: ..." at y=176.9
  textField("tank1_secondaryScumThickness", 92, 174.9, 15, 4),
  textField("tank1_secondarySludgeThickness", 152, 174.9, 15, 4),
  // "Liquid level not determined" at x=29.7, y=181.9
  checkbox("tank1_liquidLevelNotDetermined", 25, 179.9),

  // 4C: Pumping — "Yes" at x=139.3, y=191.7; "No" at x=152.0
  checkbox("tanksPumpedYes", 135, 189.7),
  checkbox("tanksPumpedNo", 148, 189.7),
  // "If yes... septic hauler company? ____" at x=26.0, y=196.8 — data after ~x=96
  textField("haulerCompany", 96, 194.8, 112, 4.5),
  // "License number issued by ADEQ: ____" at x=38.7, y=203.5 — data after ~x=92
  textField("haulerLicense", 92, 201.5, 116, 4.5),

  // Pumping not performed reasons
  // "A Discharge Authorization..." at x=31.1, y=215.0
  checkbox("pumpingNotPerformed_dischAuth", 26, 213.0),
  // "Pumping or servicing was not necessary..." at x=30.6, y=224.6
  checkbox("pumpingNotPerformed_notNecessary", 26, 222.6),
  // "No accumulation..." at x=30.6, y=234.1
  checkbox("pumpingNotPerformed_noAccumulation", 26, 232.1),

  // 4D: "Indicate the date the inspection was performed. ____" at x=12.7, y=242.0 — data after ~x=95
  textField("tankInspectionDate", 95, 240.0, 40, 4.5),
];

// ---------------------------------------------------------------------------
// Page 5: Form Page 4 -- Section 4E-4M (Tank details, deficiencies, baffles)
// ---------------------------------------------------------------------------
const PAGE_5_SCHEMAS: Schema[] = [
  // Header repeaters
  // "TAX PARCEL NO." at x=64.9, y=13.0
  textField("taxParcelNumber_p5", 90, 11.0, 27, 5),
  textField("dateOfInspection_p5", 148, 11.0, 15, 5),
  textField("inspectorInitials_p5", 198, 11.0, 12, 5),

  // 4E: Capacity
  // "The Capacity of the septic tank is ____ gallons" at x=13.2, y=29.1 — data ~x=72
  textField("tank1_tankCapacity", 72, 27.1, 25, 4.5),
  // "Measurement/dimensions of tank: ____" at x=114.6, y=28.9 — data ~x=160
  textField("tank1_tankDimensions", 160, 26.9, 45, 4.5),
  // "Volume Pumped" at x=51.0, y=34.0
  checkbox("tank1_capacityBasisVolumePumped", 47, 32.0),
  // "Estimate" at x=114.5, y=34.0
  checkbox("tank1_capacityBasisEstimate", 110, 32.0),
  // "Permit Document" at x=165.3, y=34.0
  checkbox("tank1_capacityBasisPermit", 161, 32.0),
  // "Capacity not determined (Explain): ____" at x=51.0, y=38.6 — data after ~x=105
  checkbox("tank1_capacityBasisNotDetermined", 47, 36.6),
  textField("tank1_capacityNotDeterminedReason", 105, 36.6, 103, 4),

  // 4F: Septic tank material at y=49.2
  // "Pre-cast concrete" x=32.1, "Fiberglass" x=68.6, "Plastic" x=95.2, "Steel" x=116.6, "Cast-in-place concrete" x=135.3
  checkbox("tank1_materialPrecastConcrete", 28, 47.2),
  checkbox("tank1_materialFiberglass", 64, 47.2),
  checkbox("tank1_materialPlastic", 91, 47.2),
  checkbox("tank1_materialSteel", 112, 47.2),
  checkbox("tank1_materialCastInPlace", 131, 47.2),
  // "Other (Describe): ____" at x=32.1, y=54.2
  checkbox("tank1_materialOther", 28, 52.2),
  textField("tank1_tankMaterialOther", 60, 52.2, 148, 4.5),

  // 4G: Access openings at y=61.9
  // "One" x=69.3, "Two" x=83.6, "Three" x=96.3, "Other (Describe):____" x=112.2
  checkbox("tank1_accessOne", 65, 59.9),
  checkbox("tank1_accessTwo", 79, 59.9),
  checkbox("tank1_accessThree", 92, 59.9),
  checkbox("tank1_accessOther", 108, 59.9),
  textField("tank1_accessOpeningsOther", 140, 59.9, 65, 4.5),

  // 4H: Lids & risers
  // "Present" at x=60.9, y=70.5; "Not Present" at x=78.6
  checkbox("tank1_lidsPresent", 57, 68.5),
  checkbox("tank1_lidsNotPresent", 74, 68.5),
  // "Yes" at x=89.5, y=75.4 (securely fastened); "No" at x=104.2
  checkbox("tank1_lidsSecureYes", 85, 73.4),
  checkbox("tank1_lidsSecureNo", 100, 73.4),

  // 4I: Compartments at y=87.8
  // "One" x=84.4, "Two" x=97.9, "Other (Describe): ____" x=110.7
  checkbox("tank1_compartmentsOne", 80, 85.8),
  checkbox("tank1_compartmentsTwo", 94, 84.8),
  checkbox("tank1_compartmentsOther", 107, 85.0),
  textField("tank1_compartmentsOther_text", 138, 85.0, 68, 4.5),

  // 4J: Compromised tank at y=94.2
  // "Yes" x=153.6, "No" x=166.8
  checkbox("tank1_compromisedYes", 149, 92.2),
  checkbox("tank1_compromisedNo", 163, 92.2),

  // 4K: Deficiencies — left column at x=24.6/24.5, right column at x=76.1/76.2
  // "Root invasion" x=24.6, y=111.5; "Exposed rebar" x=76.1, y=111.5
  checkbox("tank1_deficiencyRootInvasion", 20, 109.5),
  checkbox("tank1_deficiencyExposedRebar", 72, 109.5),
  // "Cracks in tank" x=24.5, y=116.4; "Damaged inlet pipe" x=76.1, y=116.4
  checkbox("tank1_deficiencyCracks", 20, 114.4),
  checkbox("tank1_deficiencyDamagedInlet", 72, 114.4),
  // "Damaged lids or risers" x=24.5, y=121.4; "Damaged outlet pipe" x=76.2, y=121.4
  checkbox("tank1_deficiencyDamagedLids", 20, 119.4),
  checkbox("tank1_deficiencyDamagedOutlet", 72, 119.4),
  // "Deteriorating concrete" x=24.5, y=126.4; "Other concerns..." x=76.1, y=126.4
  checkbox("tank1_deficiencyDeterioratingConcrete", 20, 124.4),
  checkbox("tank1_deficiencyOther", 72, 124.4),

  // 4L: Baffle/sanitary T material at y=138.4
  // "Pre-cast concrete" x=30.1, "Fiberglass" x=63.4, "Plastic" x=85.9, "Clay" x=103.5,
  // "Could not be determined..." x=119.4
  checkbox("tank1_baffleMaterialPrecast", 26, 136.4),
  checkbox("tank1_baffleMaterialFiberglass", 59, 136.4),
  checkbox("tank1_baffleMaterialPlastic", 82, 136.4),
  checkbox("tank1_baffleMaterialCite", 99, 136.4),
  checkbox("tank1_baffleMaterialNotDetermined", 115, 136.4),

  // Baffle conditions
  // Inlet baffle at y=149.4: "Present" x=55.2, "Operational" x=73.7, "Not operational" x=99.1,
  //   "Not present" x=129.3, "Not determined" x=155.5
  checkbox("tank1_inletBafflePresent", 51, 147.4),
  checkbox("tank1_inletBaffleOperational", 69, 147.4),
  checkbox("tank1_inletBaffleNotOp", 95, 147.4),
  checkbox("tank1_inletBaffleNotPresent", 125, 147.4),
  checkbox("tank1_inletBaffleNotDetermined", 151, 147.4),

  // Outlet baffle at y=159.3: "Present" x=55.4, "Operational" x=74.7, "Not operational" x=99.3,
  //   "Not present" x=129.6, "Not determined" x=155.8
  checkbox("tank1_outletBafflePresent", 51, 157.3),
  checkbox("tank1_outletBaffleOperational", 70, 157.3),
  checkbox("tank1_outletBaffleNotOp", 95, 157.3),
  checkbox("tank1_outletBaffleNotPresent", 125, 157.3),
  checkbox("tank1_outletBaffleNotDetermined", 152, 157.3),

  // Interior baffle at y=169.2: "Present" x=54.9, "Operational" x=74.3, "Not operational" x=98.8,
  //   "Not present" x=129.1, "Not determined" x=155.3
  checkbox("tank1_interiorBafflePresent", 51, 167.2),
  checkbox("tank1_interiorBaffleOperational", 70, 167.2),
  checkbox("tank1_interiorBaffleNotOp", 95, 167.2),
  checkbox("tank1_interiorBaffleNotPresent", 127, 167.2),
  checkbox("tank1_interiorBaffleNotDetermined", 151, 167.2),

  // 4M: Effluent filter at y=176.4
  // "Present" x=54.3, "Not Present" x=73.6, "Serviced" x=98.1, "Not serviced" x=127.4
  checkbox("tank1_effluentFilterPresent", 50, 174.4),
  checkbox("tank1_effluentFilterNotPresent", 69, 174.4),
  checkbox("tank1_effluentFilterServiced", 94, 174.4),
  checkbox("tank1_effluentFilterNotServiced", 125, 174.4),

  // Septic tank comments (inspector comments section) at y≈198.4
  multilineField("septicTankComments", 14, 202, 194, 14),

  // 4.1 Disposal Works section
  // "Was the location of disposal works determined?" at y=222.0
  // "Yes (see sketch on last page)" at x=30.0, y=227.3; "No (explain why): ____" at x=79.2, y=227.3
  checkbox("disposalWorksLocationYes", 26, 225.3),
  checkbox("disposalWorksLocationNo", 75, 225.3),
  textField("disposalWorksLocationNotDeterminedReason", 105, 225.3, 100, 4.5),

  // Disposal works type at y=237.6
  // "Trench" x=30.1, "Bed" x=55.5, "Chamber" x=80.9, "Seepage pit" x=106.3, "Other: ____" x=131.6
  checkbox("disposalTypeTrench", 26, 235.6),
  checkbox("disposalTypeBed", 51, 235.6),
  checkbox("disposalTypeChamber", 77, 235.6),
  checkbox("disposalTypeSeepagePit", 102, 235.6),
  checkbox("disposalTypeOther", 127, 235.5),
  textField("disposalTypeOtherText", 143, 235.5, 62, 4.5),

  // Method of distribution at y=249.0
  // "Diversion valve" x=30.1, "Drop box" x=65.0, "Distribution box" x=92.8,
  // "Manifold" x=128.9, "Serial loading" x=154.2
  checkbox("distributionDiversion", 26, 247.0),
  checkbox("distributionDropBox", 61, 247.0),
  checkbox("distributionBox", 88, 247.0),
  checkbox("distributionManifold", 125, 247.0),
  checkbox("distributionSerial", 150, 247.0),
  // "Pressurized" x=30.1, y=253.9; "Unknown" x=64.4
  checkbox("distributionPressurized", 26, 251.9),
  checkbox("distributionUnknown", 60, 251.9),
];

// ---------------------------------------------------------------------------
// Page 6: Form Page 5 -- Section 4.1 continued + Section 5 (Disposal Works
//         deficiencies, inspector comments, signature)
// ---------------------------------------------------------------------------
const PAGE_6_SCHEMAS: Schema[] = [
  // Header repeaters
  // "TAX PARCEL NO." at x=64.2, y=13.1
  textField("taxParcelNumber_p6", 90, 11.1, 27, 5),
  textField("dateOfInspection_p6", 148, 11.1, 15, 5),
  textField("inspectorInitials_p6", 198, 11.1, 12, 5),

  // Distribution component inspected at y=24.1
  // "Yes" x=82.9, "No" x=97.6
  checkbox("distributionInspectedYes", 78, 22.1),
  checkbox("distributionInspectedNo", 93, 22.1),

  // Supply line material at y=29.6
  // "PVC" x=89.5, "Orangeburg" x=105.9, "Tile" x=136.0, "Other ____" x=153.4
  checkbox("supplyLinePVC", 87, 27.6),
  checkbox("supplyLineOrangeburg", 102, 27.6),
  checkbox("supplyLineTile", 132, 27.6),
  checkbox("supplyLineOther", 149, 27.6),
  textField("supplyLineMaterialOtherText", 165, 27.6, 40, 4.5),

  // Inspection ports at y=34.9
  // "Present" x=92.0, "Not present" x=112.1
  checkbox("inspectionPortsPresent", 88, 32.9),
  checkbox("inspectionPortsNotPresent", 108, 32.9),

  // Port details
  // "Number of ports: ____" at x=55.6, y=45.3 — data after ~x=85
  textField("numberOfPorts", 85, 43.3, 15, 4),

  // Port depths at y=55.8 and y=60.8
  // "________ Port 1" x=55.7, "Port 2" x=84.8, "Port 3" x=114.0, "Port 4" x=143.1
  // Data goes before the "Port N" label, on the underline
  textField("portDepth1", 44, 53.8, 18, 4),
  textField("portDepth2", 72, 53.8, 18, 4),
  textField("portDepth3", 101, 53.8, 18, 4),
  textField("portDepth4", 130, 53.8, 18, 4),
  // "Port 5" x=55.6, "Port 6" x=84.7, "Port 7" x=113.8, "Port 8" x=143.0 at y=60.8
  textField("portDepth5", 44, 58.8, 18, 4),
  textField("portDepth6", 72, 58.8, 18, 4),
  textField("portDepth7", 101, 58.8, 18, 4),
  textField("portDepth8", 130, 58.8, 18, 4),

  // Hydraulic load test at y=68.1
  // "Yes" x=126.5, "No" x=144.0
  checkbox("hydraulicLoadTestYes", 122, 66.1),
  checkbox("hydraulicLoadTestNo", 140, 66.1),

  // Disposal works deficiency at y=74.0
  // "Yes" x=93.6, "No" x=108.4
  checkbox("hasDisposalDeficiencyYes", 89, 72.0),
  checkbox("hasDisposalDeficiencyNo", 104, 72.0),

  // Deficiency checkboxes — all at x=29.7, checkboxes 5mm left = ~24.7
  // "Crushed outlet pipe" y=84.0
  checkbox("defCrushedOutletPipe", 25, 82.0),
  // "Root invasion" y=88.9
  checkbox("defRootInvasion", 25, 86.9),
  // "High water lines..." y=93.9
  checkbox("defHighWaterLines", 25, 91.9),
  // "D-box or valve not functioning..." y=98.8
  checkbox("defDboxNotFunctioning", 25, 96.8),
  // "Surfacing..." y=103.8
  checkbox("defSurfacing", 25, 101.8),
  // "Unusually lush vegetation..." y=108.7
  checkbox("defLushVegetation", 25, 106.7),
  // "Erosion..." y=113.6
  checkbox("defErosion", 25, 111.6),
  // "Ponding water..." y=118.7
  checkbox("defPondingWater", 25, 116.7),
  // "Animal intrusion" y=123.6
  checkbox("defAnimalIntrusion", 25, 121.6),
  // "Operational (water loading) test failure" y=128.5
  checkbox("defLoadTestFailure", 25, 126.5),
  // "Could Not Determine" y=133.5
  checkbox("defCouldNotDetermine", 25, 131.5),

  // Repairs recommended at y=139.0
  // "Yes" x=157.8, "No" x=172.5
  checkbox("repairsRecommendedYes", 153, 137.0),
  checkbox("repairsRecommendedNo", 170, 137.0),

  // Inspector Comments (disposal works) at y≈144.3 — "Inspector Comments:" at x=19.1
  // Comment underlines from y≈148.6 to y≈157.0
  multilineField("disposalWorksComments", 19, 149, 189, 9),

  // Signature area
  // "Signature: ____" at x=19.1, y=204.4 — signature image on the underline ~x=48
  {
    name: "signatureImage",
    type: "image",
    position: { x: 48, y: 198 },
    width: 60,
    height: 14,
  } as Schema,
  // "Date:_____" at x=136.9, y=204.4 — data after "Date:" ~x=148
  textField("signatureDate", 148, 202.4, 50, 5),
  // "Printed name: ____" at x=19.1, y=214.4 — data after "Printed name:" ~x=55
  textField("printedName", 55, 212.4, 80, 5),
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
 * Works in both browser and server-side (Node.js / Vercel) environments.
 */
export async function loadTemplate(): Promise<LoadedTemplate> {
  if (cachedTemplate && cachedFont) {
    return { template: cachedTemplate, font: cachedFont };
  }

  // Load basePdf and fonts in parallel
  const [basePdf, regularFontData, boldFontData] = await Promise.all([
    loadPublicFile("/septic_system_insp_form.pdf"),
    loadPublicFile("/fonts/LiberationSans-Regular.ttf"),
    loadPublicFile("/fonts/LiberationSans-Bold.ttf"),
  ]);

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
