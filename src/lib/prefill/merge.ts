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

type UserEntry = Omit<ProvenanceEntry, "prior">;

/**
 * The entry the user is standing on: a "suggested" entry that parked an edited one
 * (see ProvenanceEntry.prior) stands for that edited entry until the chip is resolved.
 */
function userEntryOf(existing: ProvenanceEntry | undefined): UserEntry | undefined {
  if (!existing) return undefined;
  if (existing.state === "suggested" && existing.prior) return existing.prior;
  const { prior: _nested, ...rest } = existing;
  return rest;
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
 *  - existing "verified" entry → the proposal (fill or warning) is dropped; the user confirmed the value
 *  - existing "edited" entry → left untouched when the field already holds the proposed value;
 *    otherwise the proposal becomes "suggested" with the edited entry kept in `prior` so
 *    dismissing the chip restores it. A later run replaces such a suggestion but carries
 *    the same `prior` forward (never nested) and treats it as the edited entry it stands for.
 *  - kind "warning" → handled after every fill of the same merge (order-independent): when the
 *    path already carries a fill entry (prefilled / suggested / edited — from this merge or an
 *    earlier one) the warning text is attached to it as `warning`; otherwise a warning-only
 *    provenance entry, state "suggested", no fill (audit 5.1: one provenance slot per path)
 *  - confidence ≥ PREFILL_FILL_THRESHOLD and current value empty/default → fill + "prefilled"
 *  - otherwise → "suggested"
 *  - existing "prefilled" entry is replaced only if the current value still equals its proposed
 *    value and the new confidence is higher; the same value with no better confidence is a no-op
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

  // Warnings are resolved after every fill so the outcome does not depend on stage order
  const fillProposals = proposals.filter((p) => p.kind !== "warning");
  const warningProposals = proposals.filter((p) => p.kind === "warning");

  for (const proposal of fillProposals) {
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

    const userEntry = userEntryOf(existing);
    if (userEntry?.state === "verified") {
      continue;
    }
    if (userEntry?.state === "edited") {
      if (valuesEqual(current, proposal.value)) continue;
      next[fieldPath] = { ...base, state: "suggested", value: proposal.value, prior: userEntry };
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

  for (const proposal of warningProposals) {
    const fieldPath = normalizeFieldPath(proposal.fieldPath);
    const existing = next[fieldPath];
    if (userEntryOf(existing)?.state === "verified") {
      continue;
    }
    // A fill entry already owns the slot (from this merge or an earlier one): ride on it
    if (existing && existing.kind === "fill") {
      next[fieldPath] = { ...existing, warning: proposal.provenance.explanation };
      continue;
    }
    next[fieldPath] = {
      ...proposal.provenance,
      kind: "warning",
      state: "suggested",
      value: "",
      runId: opts.runId,
      at: now,
    };
  }

  return { fills, provenance: next };
}
