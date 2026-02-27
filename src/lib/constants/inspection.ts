// ADEQ GWS 432 Inspection Form Constants
// Field options, dropdown values, and inspector defaults

/** All 15 Arizona counties */
export const AZ_COUNTIES = [
  { value: "Apache", label: "Apache" },
  { value: "Cochise", label: "Cochise" },
  { value: "Coconino", label: "Coconino" },
  { value: "Gila", label: "Gila" },
  { value: "Graham", label: "Graham" },
  { value: "Greenlee", label: "Greenlee" },
  { value: "La Paz", label: "La Paz" },
  { value: "Maricopa", label: "Maricopa" },
  { value: "Mohave", label: "Mohave" },
  { value: "Navajo", label: "Navajo" },
  { value: "Pima", label: "Pima" },
  { value: "Pinal", label: "Pinal" },
  { value: "Santa Cruz", label: "Santa Cruz" },
  { value: "Yavapai", label: "Yavapai" },
  { value: "Yuma", label: "Yuma" },
] as const;

/** Facility types -- "Onsite Wastewater Treatment Facility Serves" on the ADEQ form */
export const FACILITY_TYPES = [
  { value: "single_family", label: "Single Family Residence" },
  { value: "multifamily", label: "Multifamily/Shared" },
  { value: "commercial", label: "Commercial" },
  { value: "other", label: "Other" },
] as const;

/** Inspection type -- not explicitly on the form but tracked internally */
export const INSPECTION_TYPES = [
  { value: "routine", label: "Routine" },
  { value: "complaint", label: "Complaint" },
  { value: "permit", label: "Permit" },
  { value: "other", label: "Other" },
] as const;

/** GP 4.02+ system types from ADEQ Section 2 */
export const GP402_SYSTEM_TYPES = [
  { value: "gp402_conventional", label: "GP 4.02 Conventional Septic Tank/Disposal System" },
  { value: "gp402_septic_tank", label: "Septic Tank" },
  { value: "gp402_disposal_trench", label: "Disposal Trench" },
  { value: "gp402_disposal_bed", label: "Disposal Bed" },
  { value: "gp402_chamber", label: "Disposal by Chamber Technology" },
  { value: "gp402_seepage_pit", label: "Disposal by Seepage Pit" },
  { value: "gp403_composting", label: "GP 4.03 Composting Toilet" },
  { value: "gp404_pressure", label: "GP 4.04 Pressure Distribution System" },
  { value: "gp405_gravelless", label: "GP 4.05 Gravelless Trench" },
  { value: "gp406_natural_evap", label: "GP 4.06 Natural Seal Evapotranspiration Bed" },
  { value: "gp407_lined_evap", label: "GP 4.07 Lined Evapotranspiration Bed" },
  { value: "gp408_mound", label: "GP 4.08 Wisconsin Mound" },
  { value: "gp409_engineered_pad", label: "GP 4.09 Engineered Pad System" },
  { value: "gp410_sand_filter", label: "GP 4.10 Intermittent Sand Filter" },
  { value: "gp411_peat_filter", label: "GP 4.11 Peat Filter" },
  { value: "gp412_textile_filter", label: "GP 4.12 Textile Filter" },
  { value: "gp413_denitrifying", label: "GP 4.13 Denitrifying System Using Separated Wastewater Streams" },
  { value: "gp414_sewage_vault", label: "GP 4.14 Sewage Vault" },
  { value: "gp415_aerobic", label: "GP 4.15 Aerobic System" },
  { value: "gp416_nitrate_filter", label: "GP 4.16 Nitrate-Reactive Media Filter" },
  { value: "gp417_cap", label: "GP 4.17 Cap System" },
  { value: "gp418_wetland", label: "GP 4.18 Constructed Wetland" },
  { value: "gp419_sand_lined", label: "GP 4.19 Sand-Lined Trench" },
  { value: "gp420_disinfection", label: "GP 4.20 Disinfection Device" },
  { value: "gp421_surface", label: "GP 4.21 Surface Disposal" },
  { value: "gp422_drip", label: "GP 4.22 Subsurface Drip Irrigation Disposal" },
  { value: "gp423_large_flow", label: "GP 4.23 Design flow 3,000 to <24,000 GPD" },
] as const;

/** Septic tank material options from Section 4F */
export const TANK_MATERIALS = [
  { value: "precast_concrete", label: "Pre-cast Concrete" },
  { value: "fiberglass", label: "Fiberglass" },
  { value: "plastic", label: "Plastic" },
  { value: "steel", label: "Steel" },
  { value: "cast_in_place", label: "Cast-in-place Concrete" },
  { value: "other", label: "Other" },
] as const;

/** Disposal works types from Section 4.1 */
export const DISPOSAL_TYPES = [
  { value: "trench", label: "Trench" },
  { value: "bed", label: "Bed" },
  { value: "chamber", label: "Chamber" },
  { value: "seepage_pit", label: "Seepage Pit" },
  { value: "other", label: "Other" },
] as const;

/** Distribution method options from Section 4.1 */
export const DISTRIBUTION_METHODS = [
  { value: "diversion_valve", label: "Diversion Valve" },
  { value: "pressurized", label: "Pressurized" },
  { value: "drop_box", label: "Drop Box" },
  { value: "distribution_box", label: "Distribution Box" },
  { value: "manifold", label: "Manifold" },
  { value: "serial_loading", label: "Serial Loading" },
  { value: "unknown", label: "Unknown" },
] as const;

/** Supply line material options from Section 4.1 */
export const SUPPLY_LINE_MATERIALS = [
  { value: "pvc", label: "PVC" },
  { value: "orangeburg", label: "Orangeburg" },
  { value: "tile", label: "Tile" },
  { value: "other", label: "Other" },
] as const;

/** Condition rating options used across multiple sections */
export const CONDITION_OPTIONS = [
  { value: "operational", label: "Operational" },
  { value: "operational_with_concerns", label: "Operational with Concerns" },
  { value: "not_operational", label: "Not Operational" },
  { value: "not_applicable", label: "N/A" },
] as const;

/** Baffle/sanitary T material from Section 4L */
export const BAFFLE_MATERIALS = [
  { value: "precast_concrete", label: "Pre-cast Concrete" },
  { value: "fiberglass", label: "Fiberglass" },
  { value: "plastic", label: "Plastic" },
  { value: "clay", label: "Clay" },
  { value: "not_determined", label: "Could not be determined" },
] as const;

/** Baffle condition options from Section 4L */
export const BAFFLE_CONDITIONS = [
  { value: "present_operational", label: "Present - Operational" },
  { value: "present_not_operational", label: "Present - Not Operational" },
  { value: "not_present", label: "Not Present" },
  { value: "not_determined", label: "Not Determined" },
] as const;

/** Domestic water source options from Section 1A */
export const WATER_SOURCES = [
  { value: "hauled_water", label: "Hauled Water" },
  { value: "municipal", label: "Municipal System" },
  { value: "private_company", label: "Private Water Company" },
  { value: "shared_well", label: "Shared Private Well" },
  { value: "private_well", label: "Private Well" },
] as const;

/** Wastewater source type from Section 1B */
export const WASTEWATER_SOURCES = [
  { value: "residential", label: "Residential" },
  { value: "commercial", label: "Commercial" },
  { value: "other", label: "Other" },
] as const;

/** Occupancy/Use type from Section 1C */
export const OCCUPANCY_TYPES = [
  { value: "full_time", label: "Full Time" },
  { value: "seasonal", label: "Seasonal/Part Time" },
  { value: "vacant", label: "Vacant" },
  { value: "unknown", label: "Unknown" },
] as const;

/** Facility type checkboxes from Summary of Inspection */
export const FACILITY_SYSTEM_TYPES = [
  { value: "conventional", label: "Conventional System" },
  { value: "alternative", label: "Alternative System" },
  { value: "gray_water", label: "Gray Water System Observed" },
] as const;

/** Capacity basis options from Section 4E */
export const CAPACITY_BASIS_OPTIONS = [
  { value: "volume_pumped", label: "Volume Pumped" },
  { value: "estimate", label: "Estimate" },
  { value: "permit_document", label: "Permit Document" },
  { value: "not_determined", label: "Capacity not determined" },
] as const;

/** Design flow basis options from Section 3B */
export const DESIGN_FLOW_BASIS = [
  { value: "permit_documents", label: "Designated in permitting documents" },
  { value: "calculated", label: "Calculated or estimated" },
  { value: "unknown", label: "Unknown" },
] as const;

/** Actual flow evaluation from Section 3D */
export const ACTUAL_FLOW_EVALUATION = [
  { value: "not_exceed", label: "Actual flow did not appear to exceed design flow" },
  { value: "may_exceed", label: "Actual flow may exceed design flow" },
  { value: "unknown", label: "Unknown" },
] as const;

/** Hardcoded SewerTime Septic inspector defaults (FORM-04) */
export const INSPECTOR_DEFAULTS = {
  company: "SewerTime Septic",
  companyAddress: "2375 E Camelback Rd",
  companyCity: "Phoenix",
  companyState: "AZ",
  companyZip: "85016",
  certificationNumber: "NAWT #15805",
  registrationNumber: "CR-37",
  truckNumber: "ADEQ Truck #2833",
} as const;

/** Step labels for the 5-step wizard (matching ADEQ form sections) */
export const STEP_LABELS = [
  "Facility Info",
  "General Treatment",
  "Design Flow",
  "Septic Tank",
  "Disposal Works",
] as const;
