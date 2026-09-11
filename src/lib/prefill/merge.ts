import type { InspectionFormData } from "@/types/inspection";
import { PREFILL_FILL_THRESHOLD } from "./types";
import type { FieldProvenance, ProposedField, ProvenanceEntry } from "./types";

export interface MergeResult {
  /** Field paths whose value changed and must be `form.setValue`d */
  fills: Array<{ fieldPath: string; value: ProposedField["value"] }>;
  provenance: FieldProvenance;
}

/** `septicTank.tanks[0].tankCapacity` → `septicTank.tanks.0.tankCapacity` (react-hook-form's dotted form) */
export function normalizeFieldPath(path: string): string {
  return path.replace(/\[(\d+)\]/g, ".$1");
}

/** Read a dotted path from form data */
export function getPath(obj: unknown, path: string): unknown {
  let current: unknown = obj;
  for (const segment of normalizeFieldPath(path).split(".")) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** "", [], false, undefined, null are empty; "0" is not */
export function isEmptyValue(v: unknown): boolean {
  if (v === undefined || v === null || v === false) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/** Loose equality for form values: trimmed strings, element-wise arrays, strict otherwise */
export function valuesEqual(a: unknown, b: unknown): boolean {
  if (typeof a === "string" && typeof b === "string") return a.trim() === b.trim();
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => item === b[i]);
  }
  return a === b;
}

/**
 * Pure. Applies the spec §7 merge rules:
 *  - kind "warning" → provenance entry state "suggested", no fill
 *  - confidence ≥ PREFILL_FILL_THRESHOLD and current value empty/default → fill + "prefilled"
 *  - otherwise → "suggested"
 *  - existing "verified"/"edited" entry → new proposal becomes "suggested"
 *  - existing "prefilled" entry is replaced only if the current value still equals its proposed value and the new confidence is higher
 *  - a field that already holds the proposed value gets a "prefilled" entry without a fill (nothing is overwritten)
 */
export function mergeProposals(
  formData: InspectionFormData,
  provenance: FieldProvenance,
  proposals: ProposedField[],
  opts: { runId: string; now?: string },
): MergeResult {
  const now = opts.now ?? new Date().toISOString();
  const next: FieldProvenance = { ...provenance };
  const fills: MergeResult["fills"] = [];

  for (const proposal of proposals) {
    const fieldPath = normalizeFieldPath(proposal.fieldPath);
    const existing = next[fieldPath];
    const current = getPath(formData, fieldPath);
    const base: Omit<ProvenanceEntry, "state" | "value"> = {
      ...proposal.provenance,
      kind: proposal.kind,
      runId: opts.runId,
      at: now,
    };
    const suggest = (): void => {
      next[fieldPath] = { ...base, state: "suggested", value: proposal.value };
    };
    const fill = (): void => {
      next[fieldPath] = { ...base, state: "prefilled", value: proposal.value };
      if (!valuesEqual(current, proposal.value)) {
        fills.push({ fieldPath, value: proposal.value });
      }
    };

    if (proposal.kind === "warning") {
      next[fieldPath] = { ...base, state: "suggested", value: "" };
      continue;
    }
    if (existing?.state === "verified" || existing?.state === "edited") {
      suggest();
      continue;
    }
    if (proposal.provenance.confidence < PREFILL_FILL_THRESHOLD) {
      suggest();
      continue;
    }
    if (existing?.state === "prefilled") {
      // The provider flips prefilled → edited when the user changes a value; this is the defensive check
      if (!valuesEqual(current, existing.value)) {
        suggest();
        continue;
      }
      if (proposal.provenance.confidence > existing.confidence) {
        fill();
        continue;
      }
      if (valuesEqual(proposal.value, current)) {
        continue; // same value, no better confidence — keep the existing entry
      }
      suggest();
      continue;
    }
    if (isEmptyValue(current) || valuesEqual(current, proposal.value)) {
      fill();
      continue;
    }
    suggest();
  }

  return { fills, provenance: next };
}
