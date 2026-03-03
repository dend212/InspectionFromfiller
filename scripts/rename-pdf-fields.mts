/**
 * Renames all 322 form fields in septic_system_insp_26.pdf to semantic names.
 * Produces public/septic_system_insp_form_v2.pdf as the new template.
 *
 * Run once: npx tsx scripts/rename-pdf-fields.mts
 */
import { PDFDocument, PDFName, PDFHexString } from "pdf-lib";
import fs from "fs";

// ─── Complete rename map: oldName → newName ─────────────────────────────────
// Organized by page. See scripts/field-catalog.txt for positions.

const RENAME_MAP: Record<string, string> = {
  // ── Multi-page header fields (pages 2-9) ──
  "TaxParcel": "taxParcelNo",
  "InspDate": "inspectionDate",
  "Initials of Inspector": "inspectorInitials",

  // ── Page 2: Property / Inspector / Qualifications / Records / Cesspool ──
  "PropName": "propertyName",
  "PropAddress": "propertyAddress",
  "PropCity": "propertyCity",
  "PropCounty": "propertyCounty",
  "PropSellName": "sellerName",
  "PropSellAddress": "sellerAddress",
  "PropSellCity": "sellerCity",
  "PropState": "sellerState",
  "PropZIP": "sellerZip",
  "InsName": "inspectorName",
  "InsAddress": "inspectorAddress",
  "InsCity": "inspectorCity",
  "InsState": "inspectorState",
  "InsZIP": "inspectorZip",
  "InsComp": "inspectorCompany",

  // Qualifications
  "Check Box233": "qualAdeqCourse",
  "Text234": "adeqCourseDescription",
  "Date Completed": "adeqCourseDate",
  "Check Box235": "qualProfessionalEngineer",
  "Check Box236": "qualRegisteredSanitarian",
  "Check Box237": "qualWastewaterOperator",
  "Date241_af_date": "peExpirationDate",
  "Date242_af_date": "rsExpirationDate",
  "Grade": "operatorGrade",
  "Check Box238": "qualLicensedContractor",
  "Text243": "contractorLicenseCategory",
  "Check Box239": "qualPumperTruck",
  "Owner of pumper truck and ADEQ Truck Registration No": "pumperTruckRegistration",
  "Employee Name Performing Inspection": "employeeName",

  // Records
  "Records": "recordsAvailable",
  "Discharge Authorization or Verification issued on or after January 1 2001 pursuant to R189A301D2c": "recordsDischargeAuth",
  "Permit No": "dischargePermitNo",
  "Approval of Construction or other official permitting documents issued by ADEQ or its delegated county agency before": "recordsApprovalOfConstruction",
  "January 1 2001 Permit No": "approvalPermitNo",
  "Site plan plot plan asbuilt drawings or similar documents": "recordsSitePlan",
  "Documents relating to operation andor maintenance alternative systems": "recordsOperationDocs",
  "Other": "recordsOther",
  "1": "recordsOtherDescription",

  // Cesspool
  "GroupB": "isCesspool",
  "Signature290": "cesspoolSignature",
  "DATE": "cesspoolSignatureDate",

  // ── Page 3: Summary / Section 1 / Section 2 start ──

  // Facility Serves
  "Check Box246": "facilityServesResidence",
  "Check Box247": "facilityServesSingleFamily",
  "Check Box248": "facilityServesMultiFamily",
  "Check Box249": "facilityServesCommercial",
  "Check Box250": "facilityServesOther",
  "Text255": "facilityServesOtherExplain",

  // Type of Facility
  "Check Box251": "facilityTypeConventional",
  "Check Box252": "facilityTypeAlternative",
  "Gray Water System Observed": "facilityTypeGrayWater",

  // Numbers and age
  "Number of OnSite Wastewater Systems on the property": "numberOfSystems",
  "Age of inspected OnSite Wastewater Treatment Facility": "facilityAge",
  "If estimated explain how it was determined": "facilityAgeExplanation",

  // Condition summary radio groups
  "Group1": "conditionSepticTank",
  "Group2": "conditionDisposalWorks",
  "Group3": "conditionAltSystem",
  "Group444": "conditionAltDisposal",

  // Section 1A: Water source
  "Check Box256": "waterSourceHauled",
  "Check Box257": "waterSourceMunicipal",
  "Check Box258": "waterSourcePrivateCompany",
  "Shared Private Well": "waterSourceSharedWell",
  "Private Well": "waterSourcePrivateWell",
  "If a well is nearby state the distance from Well to Wastewater System": "wellDistance",

  // Section 1B: Wastewater source
  "Check Box259": "wastewaterResidential",
  "Check Box260": "wastewaterCommercial",
  "Check Box261": "wastewaterOther",
  "Other_2": "wastewaterOtherText",

  // Section 1C: Occupancy
  "Check Box26": "occupancyFullTime",
  "Check Box27": "occupancySeasonalPartTime",
  "Check Box28": "occupancyVacant",
  "Check Box29": "occupancyUnknown",

  // Section 2: GP system types (left column, page 3)
  "Check Box30": "gp402Conventional",
  "Check Box31": "gp402SepticTank",
  "Check Box32": "gp402DisposalTrench",
  "Check Box33": "gp402DisposalBed",
  "Check Box34": "gp402Chamber",
  "Check Box35": "gp402SeepagePit",
  "Check Box44": "gp403Composting",
  "Check Box45": "gp404PressureDistribution",

  // Section 2: GP system types (right column, page 3)
  "Check Box36": "gp405GravellessTrench",
  "Check Box37": "gp406NaturalEvap",
  "Check Box38": "gp407LinedEvap",
  "Check Box39": "gp408WisconsinMound",
  "Check Box40": "gp409EngineeredPad",
  "Check Box41": "gp410SandFilter",
  "Check Box42": "gp411PeatFilter",
  "Check Box43": "gp412TextileFilter",

  // ── Page 4: Section 2 cont / Section 3 / Section 4 start ──

  // GP system types continued (left column)
  "Check Box46": "gp413Denitrifying",
  "Check Box47": "gp414SewageVault",
  "Check Box48": "gp415Aerobic",
  "Check Box49": "gp416NitrateFilter",
  "Check Box50": "gp417Cap",
  "Check Box51": "gp418Wetland",
  "Check Box52": "gp419SandLinedTrench",

  // GP system types continued (right column)
  "Check Box53": "gp420Disinfection",
  "Check Box54": "gp421SurfaceDisposal",
  "Check Box55": "gp422SubsurfaceDrip",
  "Check Box55__1": "gp423LargeFlow",

  // Performance assurance plan
  "GroupC": "performanceAssurancePlan",

  // Section 3: Design Flow
  "Text264": "estimatedDesignFlow",
  "Unknown": "designFlowUnknown",
  "Check Box57": "designFlowBasisPermit",
  "Check Box58": "designFlowBasisCalculated",
  "Check Box59": "designFlowBasisBedrooms",
  "Calculated or estimated based on check all that apply": "numberOfBedrooms",
  "Check Box60": "designFlowBasisFixtures",
  "Fixture count for a dwelling": "fixtureCount",
  "Check Box61": "designFlowBasisNonDwelling",
  "If not a dwelling": "nonDwellingGpd",
  "Check Box62": "actualFlowNotExceed",
  "Check Box63": "actualFlowMayExceed",
  "Check Box64": "actualFlowUnknown",
  "Inspector Comments": "designFlowComments",

  // Section 4A: Number of tanks
  "Group5": "numberOfTanks",

  // Section 4B: Liquid levels
  "Liquid Level": "tankLiquidLevel",
  "a111": "primaryChamberMeasured",
  "Text293": "primaryScumThickness",
  "Text269": "primarySludgeThickness",
  "a222": "secondaryChamberMeasured",
  "Text294": "secondaryScumThickness",
  "Text295": "secondarySludgeThickness",
  "a333": "liquidLevelNotDetermined",

  // Section 4C: Pumping
  "Group4": "tanksPumped",
  "HaulerCoName": "haulerCompany",
  "HaulerCoLicense": "haulerLicense",

  // Pumping not performed reasons
  "ay": "pumpingNotPerformedDischargeAuth",
  "ey": "pumpingNotPerformedNotNecessary",
  "aye": "pumpingNotPerformedNoAccumulation",

  // Section 4D: Inspection date
  "Date267_af_date": "tankInspectionDate",

  // ── Page 5: Section 4E-4M / Section 4.1 start ──

  // Section 4E: Tank capacity
  "Text266": "tankCapacity",
  "Measurementdimensions of tank dimensions": "tankDimensions",
  "g": "capacityBasisMeasurement",
  "h": "capacityBasisVolumePumped",
  "i": "capacityBasisEstimate",
  "j": "capacityBasisPermit",
  "k": "capacityBasisNotDetermined",
  "Capacity not determined  Please explain": "capacityNotDeterminedReason",

  // Section 4F: Tank material
  "l": "materialPrecastConcrete",
  "Fiberglass": "materialFiberglass",
  "Plastic": "materialPlastic",
  "Steel": "materialSteel",
  "Castinplace concrete": "materialCastInPlace",
  "m": "materialOther",
  "Other Describe": "materialOtherDescription",

  // Section 4G: Access openings
  "Group6": "accessOpenings",
  "Other Describe_2": "accessOpeningsOtherDescription",

  // Section 4H: Lids & risers
  "12334": "lidsPresent",
  "1233445": "lidsSecurelyFastened",

  // Section 4I: Compartments
  "Group7": "compartments",
  "Text312": "compartmentsOtherDescription",

  // Section 4J: Compromised tank
  "Group8": "compromisedTank",

  // Section 4K: Tank deficiencies
  "q": "defRootInvasion",
  "u": "defExposedRebar",
  "r": "defCracksInTank",
  "v": "defDamagedInletPipe",
  "000": "defDamagedLidsRisers",
  "s": "defDamagedOutletPipe",
  "p": "defDeterioratingConcrete",
  "t": "defOtherConcerns",

  // Section 4L: Baffle material
  "w": "baffleMaterialPrecast",
  "x": "baffleMaterialFiberglass",
  "y": "baffleMaterialPlastic",
  "z": "baffleMaterialClay",
  "aa": "baffleMaterialNotDetermined",

  // Inlet baffle condition
  "bb": "inletBafflePresent",
  "cc": "inletBaffleOperational",
  "dd": "inletBaffleNotOperational",
  "ee": "inletBaffleNotPresent",
  "ff": "inletBaffleNotDetermined",

  // Outlet baffle condition
  "gg": "outletBafflePresent",
  "hh": "outletBaffleOperational",
  "ii": "outletBaffleNotOperational",
  "jj": "outletBaffleNotPresent",
  "kk": "outletBaffleNotDetermined",

  // Interior baffle condition
  "ll": "interiorBafflePresent",
  "mm": "interiorBaffleOperational",
  "nn": "interiorBaffleNotOperational",
  "o": "interiorBaffleNotPresent",
  "oo": "interiorBaffleNotDetermined",

  // Section 4M: Effluent filter
  "pp": "effluentFilterPresent",
  "qq": "effluentFilterNotPresent",
  "rr": "effluentFilterServiced",
  "ss": "effluentFilterNotServiced",

  // Septic tank comments
  "Text270": "septicTankComments",

  // Section 4.1: Disposal works location
  "GroupXY": "disposalWorksLocationDetermined",
  "Text7": "disposalWorksLocationExplanation",

  // Disposal type
  "Check Box16": "disposalTypeTrench",
  "Check Box3": "disposalTypeBed",
  "Check Box4": "disposalTypeChamber",
  "Check Box5": "disposalTypeSeepagePit",
  "Check Box6": "disposalTypeOther",
  "Text8": "disposalTypeOtherDescription",

  // Distribution method
  "Check Box9": "distributionDiversionValve",
  "Check Box10": "distributionDropBox",
  "Check Box11": "distributionBox",
  "Check Box12": "distributionManifold",
  "Check Box13": "distributionSerialLoading",
  "Check Box14": "distributionPressurized",
  "Check Box15": "distributionUnknown",

  // ── Page 6: Section 4.1 continued / Signature ──

  // Distribution inspected
  "GroupXYZ": "distributionInspected",

  // Supply line material
  "b1": "supplyLinePVC",
  "b2": "supplyLineOrangeburg",
  "b3": "supplyLineTile",
  "b4": "supplyLineOther",
  "Other_3": "supplyLineOtherDescription",

  // Inspection ports
  "GroupXYZZ": "inspectionPortsPresent",
  "Number of ports": "numberOfPorts",
  "Port 1": "portDepth1",
  "Port 2": "portDepth2",
  "Port 3": "portDepth3",
  "Port 4": "portDepth4",
  "Port 5": "portDepth5",
  "Port 6": "portDepth6",
  "Port 7": "portDepth7",
  "Port 8": "portDepth8",

  // Hydraulic load test
  "hydload": "hydraulicLoadTest",

  // Disposal deficiency
  "defic": "hasDisposalDeficiency",

  // Disposal works deficiency checkboxes
  "b5": "dwDefCrushedOutletPipe",
  "b6": "dwDefRootInvasion",
  "b7": "dwDefHighWaterLines",
  "b8": "dwDefDboxNotFunctioning",
  "b9": "dwDefSurfacing",
  "b10": "dwDefLushVegetation",
  "b11": "dwDefErosion",
  "b12": "dwDefPondingWater",
  "b13": "dwDefAnimalIntrusion",
  "b14": "dwDefLoadTestFailure",
  "b15": "dwDefCouldNotDetermine",

  // Repairs recommended
  "repairsdw": "repairsRecommended",

  // Disposal works comments
  "Text273": "disposalWorksComments",

  // Conventional signature block
  "Signature17": "conventionalSignature",
  "Date": "conventionalSignatureDate",
  "Printed name": "conventionalPrintedName",

  // ── Page 7: Section 5 Alternative System ──

  // Alternative system info
  "Text274": "altQualifiedInspector",
  "No Explain": "altManufacturer",
  "Text275": "altModelCapacity",
  "Type of Treatment Equipment PresenT": "altTreatmentEquipmentType",

  // Alternative system radio groups
  "Aerator": "altAeratorWorking",
  "system": "altSystemMaintained",
  "pumpsystems": "altPumpSystems",
  "pump": "altPumpOperating",
  "hl_alarm": "altHighLevelAlarm",
  "alarmspumps": "altAlarmsSeparateCircuits",
  "wiring": "altWiringProtected",
  "audvis": "altAudibleVisualAlarm",
  "pumpcy": "altPumpCycleDesigned",
  "riser": "altRiserToGrade",
  "tank": "altTankWatertight",
  "vent": "altCheckValveVent",

  // Alternative system comments
  "Text276": "altInspectorComments",

  // Section 5.1: Alternative disposal works
  "dwloc": "altDisposalLocationDetermined",
  "Text18": "altDisposalLocationExplanation",

  // Alt disposal type
  "za": "altDisposalTypeTrench",
  "zc": "altDisposalTypeBed",
  "ze": "altDisposalTypeChamber",
  "zf": "altDisposalTypeSeepagePit",
  "zb": "altDisposalTypeDrip",
  "zd": "altDisposalTypeLowPressure",

  // Alt distribution method
  "zg": "altDistDiversionValve",
  "zi": "altDistDropBox",
  "zk": "altDistBox",
  "zm": "altDistManifold",
  "Serial loading": "altDistSerialLoading",
  "Check Box20": "altDistPressurized",
  "zj": "altDistUnknown",
  "zl": "altDistOther",

  // Alt distribution component inspection
  "distcomp": "altDistCompInspected",
  "Text298": "altDistCompYesDescription",
  "Text299": "altDistCompNoExplanation",
  "Text300": "altDistCompDetails",

  // Alt operational status
  "zp": "altStatusOperational",
  "zq": "altStatusConcerns",
  "Not Operational_5": "altStatusNotOperational",
  "zr": "altStatusCouldNotDetermine",
  "Text301": "altStatusExplanation",

  // Alt supply line material
  "zs": "altSupplyLinePVC",
  "zt": "altSupplyLineOrangeburg",
  "zu": "altSupplyLineTile",
  "zv": "altSupplyLineOther",
  "Other_4": "altSupplyLineOtherDescription",

  // ── Page 8: Section 5.1 continued / Signatures ──

  // Alt inspection ports
  "insports": "altInspectionPortsPresent",
  "Number of ports_2": "altNumberOfPorts",
  "Text302": "altPortDepth1",
  "Text303": "altPortDepth2",
  "Text304": "altPortDepth3",
  "Text305": "altPortDepth4",
  "Text306": "altPortDepth5",
  "Text307": "altPortDepth6",
  "Text308": "altPortDepth7",
  "Text309": "altPortDepth8",

  // Alt operational test
  "optest": "altOperationalTest",
  "Text21": "altOperationalTestExplanation",

  // Alt deficiency
  "deficiency": "altHasDeficiency",

  // Alt deficiency checkboxes
  "zy": "altDefCrushedOutletPipe",
  "11": "altDefRootInvasion",
  "22": "altDefHighWaterLines",
  "33": "altDefDboxNotFunctioning",
  "44": "altDefSurfacing",
  "55": "altDefLushVegetation",
  "66": "altDefErosion",
  "77": "altDefPondingWater",
  "88": "altDefAnimalIntrusion",
  "99": "altDefLoadTestFailure",
  "100": "altDefOtherProblems",
  "Text310": "altDefOtherProblemsDescription",
  "101": "altDefCouldNotDetermine",
  "Text311": "altDefCouldNotDetermineExplanation",

  // Alt repairs
  "repairs": "altRepairs",

  // Alt disposal condition
  "condition": "altDisposalCondition",

  // Alt disposal comments
  "Text282": "altDisposalComments",

  // Conventional inspector repeat signature (page 8)
  "Signature22": "conventionalSignature2",
  "Date_3": "conventionalSignatureDate2",
  "Text283": "conventionalPrintedName2",

  // Alternative system inspector block
  "Text284": "altOrgResponsible",
  "Text285": "altContactName",
  "Text287": "altContactPhone",
  "Text286": "altContactEmail",
  "Signature1": "altSystemInspectorSignature",
  "Date2_af_date": "altSystemInspectorDate",
};

// ─── Rename fields ──────────────────────────────────────────────────────────

async function main() {
  const pdfBytes = fs.readFileSync("septic_system_insp_26.pdf");
  const doc = await PDFDocument.load(pdfBytes);
  const form = doc.getForm();
  const fields = form.getFields();

  let renamed = 0;
  let skipped = 0;
  const unmapped: string[] = [];

  for (const field of fields) {
    const oldName = field.getName();
    const newName = RENAME_MAP[oldName];

    if (!newName) {
      unmapped.push(oldName);
      skipped++;
      continue;
    }

    // Rename by modifying the /T entry in the field's dictionary
    const dict = field.acroField.dict;
    dict.set(PDFName.of("T"), PDFHexString.fromText(newName));
    renamed++;
  }

  console.log(`Renamed ${renamed} fields, skipped ${skipped}`);
  if (unmapped.length > 0) {
    console.log(`Unmapped fields: ${unmapped.join(", ")}`);
  }

  // Save the renamed PDF
  const outputPath = "public/septic_system_insp_form_v2.pdf";
  const savedBytes = await doc.save();
  fs.writeFileSync(outputPath, savedBytes);
  console.log(`Saved renamed PDF to ${outputPath}`);

  // Verify by re-reading
  const verifyDoc = await PDFDocument.load(fs.readFileSync(outputPath));
  const verifyForm = verifyDoc.getForm();
  const verifyFields = verifyForm.getFields();
  console.log(`\nVerification: ${verifyFields.length} fields in output PDF`);

  // Check for any duplicates
  const names = verifyFields.map((f) => f.getName());
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  if (dupes.length > 0) {
    console.error(`DUPLICATE NAMES: ${[...new Set(dupes)].join(", ")}`);
  } else {
    console.log("No duplicate field names.");
  }

  // Print all renamed fields for verification
  console.log("\n=== All fields in output PDF ===");
  for (const f of verifyFields) {
    console.log(`  ${f.constructor.name.replace("PDF", "").padEnd(12)} ${f.getName()}`);
  }
}

main().catch(console.error);
