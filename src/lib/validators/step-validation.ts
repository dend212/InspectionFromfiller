import { inspectionFormSchema, STEP_FIELDS } from "@/lib/validators/inspection";

/** One validator error, addressed by dotted form path (e.g. `septicTank.tanks.0.lidsRisersPresent`) */
export interface StepIssue {
  path: string;
  message: string;
}

export interface StepValidation {
  /** Zod issues whose path falls inside this step */
  errors: StepIssue[];
  /** STEP_FIELDS entries for this step whose value is "", [], null or undefined */
  emptyCount: number;
}

/** Keyed by step index 0–5 (STEP_LABELS order); every step is always present */
export type StepValidationResult = Record<number, StepValidation>;

export const STEP_COUNT = 6;

/** Top-level form keys that live in a step but are not listed in STEP_FIELDS */
const EXTRA_STEP_KEYS: Record<string, number> = {
  // The "Add Alternative System Pages" switch renders at the bottom of Disposal Works
  includeAlternativePages: 4,
};

/** Top-level form key (`facilityInfo`, `septicTank`, …) → step index, derived from STEP_FIELDS */
const STEP_BY_PREFIX: Record<string, number> = (() => {
  const map: Record<string, number> = { ...EXTRA_STEP_KEYS };
  for (const [step, paths] of Object.entries(STEP_FIELDS)) {
    for (const p of paths) {
      const prefix = p.split(".")[0];
      if (!(prefix in map)) map[prefix] = Number(step);
    }
  }
  return map;
})();

/** Step index for a dotted field path, or null when the prefix is unknown */
export function stepForPath(path: string): number | null {
  const step = STEP_BY_PREFIX[path.split(".")[0]];
  return step === undefined ? null : step;
}

/** Read a dotted path (array indices allowed) from a plain object */
export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const seg of path.split(".")) {
    if (cur === null || cur === undefined) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/**
 * "", [], null and undefined are empty. Booleans are never empty: an unchecked
 * box is an answer ("no"), not a gap — so a section can reach "complete".
 */
export function isEmptyFieldValue(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/**
 * Runs the full inspection schema once and buckets the result per wizard step.
 * Pure: safe to call on every (debounced) form change.
 */
export function validateSteps(formData: unknown): StepValidationResult {
  const result: StepValidationResult = {};
  for (let i = 0; i < STEP_COUNT; i++) result[i] = { errors: [], emptyCount: 0 };

  const parsed = inspectionFormSchema.safeParse(formData);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.map(String).join(".");
      const step = stepForPath(path);
      if (step === null) continue;
      result[step].errors.push({ path, message: issue.message });
    }
  }

  for (let i = 0; i < STEP_COUNT; i++) {
    for (const path of STEP_FIELDS[i] ?? []) {
      if (isEmptyFieldValue(getPath(formData, path))) result[i].emptyCount += 1;
    }
  }

  return result;
}

/** Flat list of every error across steps, in step order — what the finalize dialog shows */
export function allIssues(result: StepValidationResult): Array<StepIssue & { step: number }> {
  const out: Array<StepIssue & { step: number }> = [];
  for (let i = 0; i < STEP_COUNT; i++) {
    for (const e of result[i].errors) out.push({ ...e, step: i });
  }
  return out;
}

/** "septicTank.tanks.0.lidsRisersPresent" → "Tank 1 · Lids Risers Present" */
export function humanizeFieldPath(path: string): string {
  const segs = path.split(".");
  const words = (s: string) =>
    s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
  const last = words(segs[segs.length - 1]);
  const tankIdx = segs.indexOf("tanks");
  if (tankIdx > -1 && /^\d+$/.test(segs[tankIdx + 1] ?? "")) {
    return `Tank ${Number(segs[tankIdx + 1]) + 1} · ${last}`;
  }
  return last;
}
