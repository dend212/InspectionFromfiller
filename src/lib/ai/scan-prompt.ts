/**
 * System prompt and field catalog for AI-powered form scan extraction.
 * Describes the ADEQ GWS 432 form structure and every extractable field
 * with its dotted path, expected type, and valid enum values.
 */

export const SCAN_SYSTEM_PROMPT = `You are an expert at reading scanned/photographed government inspection forms. You are analyzing an ADEQ GWS 432 "Property Transfer Inspection of an Onsite Wastewater Treatment Facility" form from Arizona.

The form may be photographed at various angles, rotations, or lighting conditions. Focus on accuracy — only extract values you can actually read.

IMPORTANT RULES:
- Only return fields where you can see a value written, checked, or selected. Omit blank fields entirely.
- For checkboxes: return true if checked, false if clearly unchecked and contextually relevant.
- For radio buttons (yes/no): only return a value if one option is clearly marked.
- For text fields: transcribe exactly what is written. Clean up obvious OCR artifacts but preserve the intent.
- For date fields: normalize to YYYY-MM-DD format when possible.
- For numeric fields: return as a string (e.g., "300", "3").
- For array fields (system types): return an array of the applicable enum values listed below.

CONFIDENCE SCORING:
- 1.0: Clearly printed or typed text, completely unambiguous
- 0.95: Very clear handwriting, essentially no doubt
- 0.90: Clear handwriting, high certainty
- 0.85: Legible handwriting, very likely correct
- 0.80: Legible with minor ambiguity (e.g., could be one of two similar characters)
- 0.70: Partially legible, reasonable guess
- 0.60: Difficult to read, best effort interpretation
- 0.50 or below: Very uncertain, may well be wrong

Respond with ONLY valid JSON — no markdown, no code blocks, no explanation. Use this exact format:
{
  "fields": [
    {
      "fieldPath": "facilityInfo.facilityName",
      "value": "Smith Residence",
      "confidence": 0.95,
      "source": "Page 1, Property Name field"
    }
  ]
}`;

export const FIELD_CATALOG = `
FIELD CATALOG — every extractable field with its path, type, and valid values:

═══════════════════════════════════════════════════════════════
SECTION: facilityInfo (Page 1-2 of form)
═══════════════════════════════════════════════════════════════

--- Property Information ---
facilityInfo.facilityName (string): Property/Facility Name
facilityInfo.facilityAddress (string): Street Address
facilityInfo.facilityCity (string): City
facilityInfo.facilityCounty (enum): County — one of: Apache, Cochise, Coconino, Gila, Graham, Greenlee, La Paz, Maricopa, Mohave, Navajo, Pima, Pinal, Santa Cruz, Yavapai, Yuma
facilityInfo.facilityZip (string): ZIP Code
facilityInfo.taxParcelNumber (string): Tax Parcel Number / APN
facilityInfo.dateOfInspection (string): Date of Inspection (YYYY-MM-DD)

--- Seller/Transferor ---
facilityInfo.sellerName (string): Seller/Transferor Name
facilityInfo.sellerAddress (string): Seller Address
facilityInfo.sellerCity (string): Seller City
facilityInfo.sellerState (string): Seller State abbreviation
facilityInfo.sellerZip (string): Seller ZIP

--- Inspector Info ---
facilityInfo.inspectorName (string): Inspector Name
facilityInfo.company (string): Company Name
facilityInfo.companyAddress (string): Company Address
facilityInfo.companyCity (string): Company City
facilityInfo.companyState (string): Company State
facilityInfo.companyZip (string): Company ZIP
facilityInfo.certificationNumber (string): Certification Number
facilityInfo.registrationNumber (string): License/Registration Number
facilityInfo.truckNumber (string): Truck Registration Number
facilityInfo.employeeName (string): Employee Name

--- Inspector Qualifications (checkboxes) ---
facilityInfo.hasAdeqCourse (boolean): Completed ADEQ-approved course
facilityInfo.adeqCourseDetails (string): Course details/number
facilityInfo.adeqCourseDate (string): Course completion date (YYYY-MM-DD)
facilityInfo.isProfessionalEngineer (boolean): Registered Professional Engineer
facilityInfo.peExpirationDate (string): PE expiration date (YYYY-MM-DD)
facilityInfo.isRegisteredSanitarian (boolean): Registered Sanitarian
facilityInfo.rsExpirationDate (string): RS expiration date (YYYY-MM-DD)
facilityInfo.isWastewaterOperator (boolean): Certified Wastewater Treatment Plant Operator
facilityInfo.operatorGrade (string): Operator Grade
facilityInfo.isLicensedContractor (boolean): Licensed Contractor
facilityInfo.contractorLicenseCategory (string): License Category
facilityInfo.hasPumperTruck (boolean): Registered Pumper Truck
facilityInfo.pumperTruckRegistration (string): Pumper Truck Registration Number

--- Records Obtained by Inspector ---
facilityInfo.recordsAvailable (enum): "yes" or "no"
facilityInfo.hasDischargeAuth (boolean): Has Discharge Authorization
facilityInfo.dischargeAuthPermitNo (string): Discharge Auth Permit Number
facilityInfo.hasApprovalOfConstruction (boolean): Has Approval of Construction
facilityInfo.approvalPermitNo (string): Approval Permit Number
facilityInfo.hasSitePlan (boolean): Has Site Plan / As-Built Drawings
facilityInfo.hasOperationDocs (boolean): Has Operation & Maintenance Documents
facilityInfo.hasOtherRecords (boolean): Has Other Records
facilityInfo.otherRecordsDescription (string): Description of other records

--- Cesspool ---
facilityInfo.isCesspool (enum): "yes" or "no"

--- Facility Details (Section 1) ---
facilityInfo.waterSource (enum): Domestic water source — one of: hauled_water, municipal, private_company, shared_well, private_well
facilityInfo.wellDistance (string): Distance between well and system (feet)
facilityInfo.wastewaterSource (enum): one of: residential, commercial, other
facilityInfo.occupancyType (enum): one of: full_time, seasonal, vacant, unknown

--- Summary of Inspection ---
facilityInfo.facilityType (enum): one of: single_family, multifamily, commercial, other
facilityInfo.facilityTypeOther (string): If Other, describe
facilityInfo.facilitySystemTypes (string[]): Array of: conventional, alternative, gray_water
facilityInfo.numberOfSystems (string): Number of onsite systems
facilityInfo.facilityAge (string): Approximate age of facility/system
facilityInfo.facilityAgeEstimateExplanation (string): How age was estimated

--- Overall Condition Ratings ---
facilityInfo.septicTankCondition (enum): one of: operational, operational_with_concerns, not_operational
facilityInfo.disposalWorksCondition (enum): one of: operational, operational_with_concerns, not_operational
facilityInfo.alternativeSystemCondition (enum): one of: operational, operational_with_concerns, not_operational
facilityInfo.alternativeDisposalCondition (enum): one of: operational, operational_with_concerns, not_operational

═══════════════════════════════════════════════════════════════
SECTION: generalTreatment (Page 2-3 of form, Section 2)
═══════════════════════════════════════════════════════════════

generalTreatment.systemTypes (string[]): Array of checked system types. Valid values:
  gp402_conventional, gp402_septic_tank, gp402_disposal_trench, gp402_disposal_bed,
  gp402_chamber, gp402_seepage_pit, gp403_composting, gp404_pressure,
  gp405_gravelless, gp406_natural_evap, gp407_lined_evap, gp408_mound,
  gp409_engineered_pad, gp410_sand_filter, gp411_peat_filter, gp412_textile_filter,
  gp413_denitrifying, gp414_sewage_vault, gp415_aerobic, gp416_nitrate_filter,
  gp417_cap, gp418_wetland, gp419_sand_lined, gp420_disinfection,
  gp421_surface, gp422_drip, gp423_large_flow

generalTreatment.hasPerformanceAssurancePlan (enum): "yes" or "no"
generalTreatment.alternativeSystem (boolean): Alternative system present

--- Alternative System Details (if present) ---
generalTreatment.altSystemManufacturer (string): Manufacturer
generalTreatment.altSystemModel (string): Model
generalTreatment.altSystemCapacity (string): Capacity
generalTreatment.altSystemDateInstalled (string): Date installed (YYYY-MM-DD)
generalTreatment.altSystemCondition (enum): one of: operational, operational_with_concerns, not_operational
generalTreatment.altSystemNotes (string): Notes

═══════════════════════════════════════════════════════════════
SECTION: designFlow (Page 3 of form, Section 3)
═══════════════════════════════════════════════════════════════

designFlow.estimatedDesignFlow (string): Estimated design flow in GPD
designFlow.designFlowBasis (enum): one of: permit_documents, calculated, unknown
designFlow.numberOfBedrooms (string): Number of bedrooms
designFlow.fixtureCount (string): Number of fixtures
designFlow.nonDwellingGpd (string): Non-dwelling GPD
designFlow.actualFlowEvaluation (enum): one of: not_exceed, may_exceed, unknown
designFlow.designFlowComments (string): Comments on design flow

═══════════════════════════════════════════════════════════════
SECTION: septicTank (Pages 3-4 of form, Section 4)
═══════════════════════════════════════════════════════════════

septicTank.numberOfTanks (string): Number of septic tanks (1-3)
septicTank.tankInspectionDate (string): Date of tank inspection (YYYY-MM-DD)
septicTank.tanksPumped (enum): "yes" or "no"
septicTank.haulerCompany (string): Pumping hauler company name
septicTank.haulerLicense (string): Hauler license number
septicTank.pumpingNotPerformedReason (string): Why pumping not performed
septicTank.septicTankComments (string): Inspector comments for Section 4

--- Per-Tank Data (use tanks[0] for first tank, tanks[1] for second, etc.) ---

septicTank.tanks[0].liquidLevel (string): Liquid level (inches from top)
septicTank.tanks[0].primaryScumThickness (string): Primary compartment scum thickness
septicTank.tanks[0].primarySludgeThickness (string): Primary compartment sludge thickness
septicTank.tanks[0].secondaryScumThickness (string): Secondary compartment scum thickness
septicTank.tanks[0].secondarySludgeThickness (string): Secondary compartment sludge thickness
septicTank.tanks[0].liquidLevelNotDetermined (boolean): Could not determine liquid level

septicTank.tanks[0].tankDimensions (string): Tank dimensions (e.g., "5x8x5")
septicTank.tanks[0].tankCapacity (string): Tank capacity in gallons
septicTank.tanks[0].capacityBasis (enum): one of: volume_pumped, estimate, permit_document, not_determined
septicTank.tanks[0].capacityNotDeterminedReason (string): Why capacity not determined

septicTank.tanks[0].tankMaterial (enum): one of: precast_concrete, fiberglass, plastic, steel, cast_in_place, other
septicTank.tanks[0].tankMaterialOther (string): If other material, describe

septicTank.tanks[0].accessOpenings (string): Description of access openings
septicTank.tanks[0].accessOpeningsOther (string): Other access opening details

septicTank.tanks[0].lidsRisersPresent (enum): "present" or "not_present"
septicTank.tanks[0].lidsSecurelyFastened (enum): "yes" or "no"

septicTank.tanks[0].numberOfCompartments (string): Number of compartments
septicTank.tanks[0].compartmentsOther (string): Other compartment details

septicTank.tanks[0].compromisedTank (enum): "yes" or "no"

--- Tank Deficiencies (checkboxes) ---
septicTank.tanks[0].deficiencyRootInvasion (boolean)
septicTank.tanks[0].deficiencyExposedRebar (boolean)
septicTank.tanks[0].deficiencyCracks (boolean)
septicTank.tanks[0].deficiencyDamagedInlet (boolean)
septicTank.tanks[0].deficiencyDamagedOutlet (boolean)
septicTank.tanks[0].deficiencyDamagedLids (boolean)
septicTank.tanks[0].deficiencyDeterioratingConcrete (boolean)
septicTank.tanks[0].deficiencyOther (boolean)

--- Baffles (Section 4L) ---
septicTank.tanks[0].baffleMaterial (string[]): array of: precast_concrete, fiberglass, plastic, clay, not_determined — multiple may be selected
septicTank.tanks[0].inletBaffleCondition (string[]): array of: present, operational, not_operational, not_present, not_determined — independent checkboxes, multiple may be selected (e.g. ["present", "not_determined"])
septicTank.tanks[0].outletBaffleCondition (string[]): array of: present, operational, not_operational, not_present, not_determined — independent checkboxes, multiple may be selected
septicTank.tanks[0].interiorBaffleCondition (string[]): array of: present, operational, not_operational, not_present, not_determined — independent checkboxes, multiple may be selected

--- Effluent Filter (Section 4M) ---
septicTank.tanks[0].effluentFilterPresent (enum): "present" or "not_present"
septicTank.tanks[0].effluentFilterServiced (enum): "serviced" or "not_serviced"

NOTE: For multiple tanks, use tanks[1], tanks[2] with the same field names.

═══════════════════════════════════════════════════════════════
SECTION: disposalWorks (Pages 4-5 of form, Sections 4.1 & 5)
═══════════════════════════════════════════════════════════════

disposalWorks.disposalWorksLocationDetermined (enum): "yes" or "no"
disposalWorks.disposalWorksLocationNotDeterminedReason (string): Why location not determined

disposalWorks.disposalType (enum): one of: trench, bed, chamber, seepage_pit, other
disposalWorks.disposalTypeOther (string): If other, describe
disposalWorks.distributionMethod (enum): one of: diversion_valve, pressurized, drop_box, distribution_box, manifold, serial_loading, unknown

disposalWorks.supplyLineMaterial (enum): one of: pvc, orangeburg, tile, other
disposalWorks.supplyLineMaterialOther (string): If other, describe

disposalWorks.distributionComponentInspected (enum): "yes" or "no"

disposalWorks.inspectionPortsPresent (enum): "present" or "not_present"
disposalWorks.numberOfPorts (string): Number of inspection ports
disposalWorks.portDepths (string[]): Array of depth measurements for each port

disposalWorks.hydraulicLoadTestPerformed (enum): "yes" or "no"

--- Disposal Works Deficiencies (checkboxes) ---
disposalWorks.hasDisposalDeficiency (enum): "yes" or "no"
disposalWorks.defCrushedOutletPipe (boolean)
disposalWorks.defRootInvasion (boolean)
disposalWorks.defHighWaterLines (boolean)
disposalWorks.defDboxNotFunctioning (boolean)
disposalWorks.defSurfacing (boolean)
disposalWorks.defLushVegetation (boolean)
disposalWorks.defErosion (boolean)
disposalWorks.defPondingWater (boolean)
disposalWorks.defAnimalIntrusion (boolean)
disposalWorks.defLoadTestFailure (boolean)
disposalWorks.defCouldNotDetermine (boolean)

disposalWorks.repairsRecommended (enum): "yes" or "no"
disposalWorks.disposalWorksComments (string): Inspector comments for disposal works

--- Signature ---
disposalWorks.signatureDate (string): Signature date (YYYY-MM-DD)
disposalWorks.printedName (string): Inspector printed name
`;
