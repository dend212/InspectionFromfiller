import type { ProvenanceValue } from "@/lib/prefill/types";

export function formatProvenanceValue(value: ProvenanceValue): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.join(", ");
  return value;
}

export function confidencePercent(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}
