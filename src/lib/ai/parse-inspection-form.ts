import Anthropic from "@anthropic-ai/sdk";
import { FIELD_CATALOG, SCAN_SYSTEM_PROMPT } from "./scan-prompt";
import type { ExtractedField, ScanResult } from "./scan-types";

const anthropic = new Anthropic();

/** All known valid field paths (top-level, not including tank array indices) */
const VALID_FIELD_PREFIXES = [
  "facilityInfo.",
  "generalTreatment.",
  "designFlow.",
  "septicTank.",
  "disposalWorks.",
];

/** Enum value normalization maps for fuzzy matching */
const ENUM_NORMALIZATIONS: Record<string, Record<string, string>> = {
  facilityCounty: {
    "la paz": "La Paz",
    "santa cruz": "Santa Cruz",
  },
  tankMaterial: {
    "pre-cast concrete": "precast_concrete",
    "precast concrete": "precast_concrete",
    concrete: "precast_concrete",
    "cast-in-place concrete": "cast_in_place",
    "cast in place": "cast_in_place",
  },
  waterSource: {
    "hauled water": "hauled_water",
    municipal: "municipal",
    "municipal system": "municipal",
    "private water company": "private_company",
    "private company": "private_company",
    "shared private well": "shared_well",
    "shared well": "shared_well",
    "private well": "private_well",
  },
  occupancyType: {
    "full time": "full_time",
    fulltime: "full_time",
    "seasonal/part time": "seasonal",
    seasonal: "seasonal",
    "part time": "seasonal",
  },
  facilityType: {
    "single family residence": "single_family",
    "single family": "single_family",
    sfr: "single_family",
    "multifamily/shared": "multifamily",
    multifamily: "multifamily",
    commercial: "commercial",
  },
  condition: {
    operational: "operational",
    "operational with concerns": "operational_with_concerns",
    "not operational": "not_operational",
  },
  capacityBasis: {
    "volume pumped": "volume_pumped",
    estimate: "estimate",
    "permit document": "permit_document",
    "not determined": "not_determined",
    "capacity not determined": "not_determined",
  },
  designFlowBasis: {
    "designated in permitting documents": "permit_documents",
    "permit documents": "permit_documents",
    "calculated or estimated": "calculated",
    calculated: "calculated",
    estimated: "calculated",
  },
  actualFlowEvaluation: {
    "actual flow did not appear to exceed design flow": "not_exceed",
    "did not exceed": "not_exceed",
    "not exceed": "not_exceed",
    "actual flow may exceed design flow": "may_exceed",
    "may exceed": "may_exceed",
  },
  disposalType: {
    trench: "trench",
    bed: "bed",
    chamber: "chamber",
    "seepage pit": "seepage_pit",
  },
  distributionMethod: {
    "diversion valve": "diversion_valve",
    pressurized: "pressurized",
    "drop box": "drop_box",
    "distribution box": "distribution_box",
    manifold: "manifold",
    "serial loading": "serial_loading",
  },
  supplyLineMaterial: {
    pvc: "pvc",
    orangeburg: "orangeburg",
    tile: "tile",
  },
  baffleMaterial: {
    "pre-cast concrete": "precast_concrete",
    "precast concrete": "precast_concrete",
    concrete: "precast_concrete",
    fiberglass: "fiberglass",
    plastic: "plastic",
    clay: "clay",
    "could not be determined": "not_determined",
    "not determined": "not_determined",
  },
  baffleCondition: {
    "present - operational": "present_operational",
    "present operational": "present_operational",
    "present - not operational": "present_not_operational",
    "present not operational": "present_not_operational",
    "not present": "not_present",
    "not determined": "not_determined",
  },
};

/**
 * Attempt to normalize an enum value using fuzzy matching.
 * Returns the normalized value, or the original if no match found.
 */
function normalizeEnumValue(fieldPath: string, value: string): string {
  const lowerValue = value.toLowerCase().trim();

  // Determine which normalization map to use based on field path
  const fieldName = fieldPath.split(".").pop() ?? "";

  // Baffle condition fields (must check before generic condition fields)
  if (
    fieldName === "inletBaffleCondition" ||
    fieldName === "outletBaffleCondition" ||
    fieldName === "interiorBaffleCondition"
  ) {
    return ENUM_NORMALIZATIONS.baffleCondition?.[lowerValue] ?? value;
  }

  // Generic condition fields (septicTankCondition, disposalWorksCondition, etc.)
  if (fieldName.endsWith("Condition")) {
    return ENUM_NORMALIZATIONS.condition?.[lowerValue] ?? value;
  }

  // Direct field name match
  if (ENUM_NORMALIZATIONS[fieldName]) {
    return ENUM_NORMALIZATIONS[fieldName][lowerValue] ?? value;
  }

  return value;
}

/** Validate that a field path matches our known schema */
function isValidFieldPath(fieldPath: string): boolean {
  // Check for tank array paths like septicTank.tanks[0].fieldName
  if (/^septicTank\.tanks\[\d+\]\.\w+$/.test(fieldPath)) {
    return true;
  }
  return VALID_FIELD_PREFIXES.some((prefix) => fieldPath.startsWith(prefix));
}

/**
 * Parse scanned inspection form images using Claude Vision.
 * Accepts an array of image buffers with media types, sends them to Claude,
 * and returns structured field extraction results with confidence scores.
 */
export async function parseInspectionForm(
  images: Array<{
    data: Buffer;
    mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  }>,
): Promise<ScanResult> {
  const startTime = Date.now();

  // Build the image content blocks
  const imageBlocks: Anthropic.Messages.ImageBlockParam[] = images.map((img) => ({
    type: "image" as const,
    source: {
      type: "base64" as const,
      media_type: img.mediaType,
      data: img.data.toString("base64"),
    },
  }));

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8000,
    system: SCAN_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          ...imageBlocks,
          {
            type: "text" as const,
            text: `Analyze these ${images.length} page(s) of a scanned ADEQ GWS 432 inspection form. Extract all visible field values using the field catalog below.\n\n${FIELD_CATALOG}`,
          },
        ],
      },
    ],
  });

  // Extract the text response
  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from AI");
  }

  // Parse the JSON response — strip any markdown code block wrapper if present
  let jsonText = textBlock.text.trim();
  if (jsonText.startsWith("```")) {
    jsonText = jsonText.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }

  let parsed: {
    fields: Array<{ fieldPath: string; value: unknown; confidence: number; source: string }>;
  };
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error(`Failed to parse AI response as JSON: ${jsonText.slice(0, 200)}`);
  }

  if (!parsed.fields || !Array.isArray(parsed.fields)) {
    throw new Error("AI response missing 'fields' array");
  }

  // Validate and normalize each field
  const validFields: ExtractedField[] = [];

  for (const field of parsed.fields) {
    if (!field.fieldPath || !isValidFieldPath(field.fieldPath)) {
      continue; // Skip unknown field paths
    }

    if (field.confidence == null || typeof field.confidence !== "number") {
      continue;
    }

    // Normalize enum values for string fields
    let normalizedValue = field.value;
    if (typeof normalizedValue === "string") {
      normalizedValue = normalizeEnumValue(field.fieldPath, normalizedValue);
    }

    // Normalize enum values within arrays (e.g., systemTypes)
    if (Array.isArray(normalizedValue)) {
      normalizedValue = normalizedValue.map((v) =>
        typeof v === "string" ? normalizeEnumValue(field.fieldPath, v) : v,
      );
    }

    validFields.push({
      fieldPath: field.fieldPath,
      value: normalizedValue as string | boolean | string[],
      confidence: Math.max(0, Math.min(1, field.confidence)),
      source: field.source ?? "Unknown",
    });
  }

  return {
    fields: validFields,
    metadata: {
      pagesProcessed: images.length,
      totalFieldsExtracted: validFields.length,
      processingTimeMs: Date.now() - startTime,
    },
  };
}
