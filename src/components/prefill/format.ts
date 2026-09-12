import {
  DISPOSAL_TYPES,
  FACILITY_SYSTEM_TYPES,
  FACILITY_TYPES,
  GP402_SYSTEM_TYPES,
  OCCUPANCY_TYPES,
  WASTEWATER_SOURCES,
  WATER_SOURCES,
} from "@/lib/constants/inspection";
import type { ProvenanceValue } from "@/lib/prefill/types";

export function formatProvenanceValue(value: ProvenanceValue): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.join(", ");
  return value;
}

export function confidencePercent(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

interface LabelOption {
  value: string;
  label: string;
}

/**
 * Enum/checkbox-array prefill fields, keyed by the exact react-hook-form dotted path, mapped
 * to the option list (from src/lib/constants/inspection.ts) that supplies their human labels.
 */
const FIELD_VALUE_LABELS: Record<string, readonly LabelOption[]> = {
  "facilityInfo.wastewaterSource": WASTEWATER_SOURCES,
  "facilityInfo.facilityType": FACILITY_TYPES,
  "facilityInfo.waterSource": WATER_SOURCES,
  "facilityInfo.occupancyType": OCCUPANCY_TYPES,
  "facilityInfo.facilitySystemTypes": FACILITY_SYSTEM_TYPES,
  "generalTreatment.systemTypes": GP402_SYSTEM_TYPES,
  "disposalWorks.disposalType": DISPOSAL_TYPES,
};

function labelFor(options: readonly LabelOption[], token: string): string {
  return options.find((option) => option.value === token)?.label ?? token;
}

/**
 * Human label for a prefill value, aware of which field it belongs to: an enum token or an
 * array of checkbox tokens resolves through that field's option list (unrecognised tokens fall
 * back to the raw token); a field with no registered option list, or a non-string/array value
 * (e.g. a boolean), falls back to `formatProvenanceValue`.
 */
export function formatFieldValue(fieldPath: string, value: ProvenanceValue): string {
  const options = FIELD_VALUE_LABELS[fieldPath];
  if (!options) return formatProvenanceValue(value);
  if (Array.isArray(value)) return value.map((token) => labelFor(options, token)).join(", ");
  if (typeof value === "string") return labelFor(options, value);
  return formatProvenanceValue(value);
}
