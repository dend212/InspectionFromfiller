/**
 * Test script: generates a fully-filled ADEQ inspection PDF
 * and writes it to scripts/test-output.pdf for visual verification.
 *
 * Usage: npx tsx scripts/test-pdf-gen.mts
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// We need tsconfig path aliases. tsx handles .mts natively with ESM.
// Use relative imports since @ aliases may not resolve outside Next.js bundler.

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, "..");

// Dynamic imports with relative paths
const { generateReport } = await import(
  pathToFileURL(join(root, "src/lib/pdf/generate-report.ts")).href
);
const { inspectionFormSchema } = await import(
  pathToFileURL(join(root, "src/lib/validators/inspection.ts")).href
);

// Build comprehensive test data covering every section
const testFormData = inspectionFormSchema.parse({
  facilityInfo: {
    facilityName: "Desert Ridge Estates HOA",
    facilityAddress: "4521 N Scottsdale Rd",
    facilityCity: "Scottsdale",
    facilityCounty: "Maricopa",
    facilityState: "AZ",
    facilityZip: "85251",
    taxParcelNumber: "123-45-678A",
    dateOfInspection: "2026-03-02",

    sellerName: "John A. Smith",
    sellerAddress: "4521 N Scottsdale Rd",
    sellerCity: "Scottsdale",
    sellerState: "AZ",
    sellerZip: "85251",

    inspectorName: "Daniel Endres",
    company: "SewerTime Septic",
    companyAddress: "2375 E Camelback Rd",
    companyCity: "Phoenix",
    companyState: "AZ",
    companyZip: "85016",
    certificationNumber: "NAWT #15805",
    registrationNumber: "CR-37",
    truckNumber: "ADEQ Truck #2833",
    employeeName: "Mike Johnson",

    hasAdeqCourse: true,
    adeqCourseDetails: "Advanced Septic System Inspection",
    adeqCourseDate: "2025-06-15",
    isProfessionalEngineer: true,
    peExpirationDate: "2027-12-31",
    isRegisteredSanitarian: true,
    rsExpirationDate: "2028-06-30",
    isWastewaterOperator: true,
    operatorGrade: "Grade IV",
    isLicensedContractor: true,
    contractorLicenseCategory: "CR-37 Septic & Sewer",
    hasPumperTruck: true,
    pumperTruckRegistration: "REG-2833",

    recordsAvailable: "yes",
    hasDischargeAuth: true,
    dischargeAuthPermitNo: "AZ-2024-0456",
    hasApprovalOfConstruction: true,
    approvalPermitNo: "MC-2023-7890",
    hasSitePlan: true,
    hasOperationDocs: true,
    hasOtherRecords: true,
    otherRecordsDescription: "Previous inspection report from 2020",

    isCesspool: "no",
    waterSource: "municipal",
    wellDistance: "150 feet",
    wastewaterSource: "residential",
    occupancyType: "full_time",

    facilityType: "single_family",
    facilityTypeOther: "",
    facilitySystemTypes: ["conventional"],
    numberOfSystems: "1",
    facilityAge: "12",
    facilityAgeEstimateExplanation: "Per county records, built 2014",

    septicTankCondition: "operational",
    disposalWorksCondition: "operational_with_concerns",
    alternativeSystemCondition: "not_operational",
    alternativeDisposalCondition: "operational",
  },

  generalTreatment: {
    systemTypes: ["gp402_conventional", "gp402_septic_tank", "gp402_disposal_trench", "gp403_composting", "gp405_gravelless", "gp413_denitrifying", "gp420_disinfection"],
    hasPerformanceAssurancePlan: "no",
    alternativeSystem: false,
  },

  designFlow: {
    estimatedDesignFlow: "300",
    designFlowBasis: "permit_documents",
    numberOfBedrooms: "4",
    fixtureCount: "18",
    nonDwellingGpd: "0",
    actualFlowEvaluation: "not_exceed",
    designFlowComments:
      "Design flow of 300 GPD based on 4 bedrooms per ADEQ standards. Actual usage appears consistent with a family of four.",
  },

  septicTank: {
    numberOfTanks: "1",
    tanksPumped: "yes",
    haulerCompany: "SewerTime Septic",
    haulerLicense: "CR-37",
    pumpingNotPerformedReason: "",
    tankInspectionDate: "2026-03-02",

    tanks: [
      {
        liquidLevel: "Normal",
        primaryScumThickness: '2"',
        primarySludgeThickness: '4"',
        secondaryScumThickness: '1"',
        secondarySludgeThickness: '2"',
        liquidLevelNotDetermined: false,

        tankDimensions: "5' x 8' x 5'",
        tankCapacity: "1000",
        capacityBasis: "volume_pumped",
        capacityNotDeterminedReason: "",

        tankMaterial: "precast_concrete",
        tankMaterialOther: "",

        accessOpenings: "two",
        accessOpeningsOther: "",

        lidsRisersPresent: "present",
        lidsSecurelyFastened: "yes",

        numberOfCompartments: "two",
        compartmentsOther: "",

        compromisedTank: "no",
        deficiencyRootInvasion: true,
        deficiencyExposedRebar: true,
        deficiencyCracks: true,
        deficiencyDamagedInlet: true,
        deficiencyDamagedOutlet: false,
        deficiencyDamagedLids: false,
        deficiencyDeterioratingConcrete: true,
        deficiencyOther: true,

        baffleMaterial: "plastic",
        inletBaffleCondition: "present_operational",
        outletBaffleCondition: "present_operational",
        interiorBaffleCondition: "not_present",

        effluentFilterPresent: "present",
        effluentFilterServiced: "serviced",
      },
    ],

    septicTankComments:
      "Tank is in good overall condition. No signs of structural damage. Baffles intact. Effluent filter was cleaned during this inspection.",
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
    portDepths: ['12"', '11"', '12"', '13"'],

    hydraulicLoadTestPerformed: "yes",

    hasDisposalDeficiency: "yes",
    defCrushedOutletPipe: true,
    defRootInvasion: true,
    defHighWaterLines: true,
    defDboxNotFunctioning: true,
    defSurfacing: true,
    defLushVegetation: true,
    defErosion: true,
    defPondingWater: true,
    defAnimalIntrusion: true,
    defLoadTestFailure: true,
    defCouldNotDetermine: true,

    repairsRecommended: "yes",

    disposalWorksComments:
      "Disposal field is functioning properly. All four inspection ports were accessible. Hydraulic load test passed with no surfacing observed after 300 gallon discharge.",

    signatureDate: "03/02/2026",
    printedName: "Daniel Endres",
    signatureDataUrl: "",
  },
});

console.log("Generating PDF with comprehensive test data...");

try {
  const pdfData = await generateReport(testFormData, null);
  const outPath = join(root, "scripts", "test-output.pdf");
  writeFileSync(outPath, pdfData);
  console.log(`PDF generated successfully: ${outPath}`);
  console.log(`Size: ${(pdfData.length / 1024).toFixed(1)} KB`);
} catch (err) {
  console.error("PDF generation failed:", err);
  process.exit(1);
}
