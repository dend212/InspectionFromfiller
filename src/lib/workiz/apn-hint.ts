import { formatApn } from "@/lib/prefill/apn";
import { WORKIZ_CF } from "./custom-field-ids";
import type { WorkizJob } from "./schema";

/**
 * APN hint for the Tax Parcel Number chip (spec §5.3): the APN custom field, else the newest
 * permit-bot note. A chip only — it never feeds the lookup (the run stays address-driven).
 */

export type NoteConfidence = "high" | "medium" | "low" | "unstated";

export type ApnHint =
  | { apn: string; confidence: number; source: "custom_field" }
  | { apn: string; confidence: number; source: "note"; noteConfidence: NoteConfidence };

export interface ApnHintResult {
  hint: ApnHint | null;
  /** The custom field held text that is not an APN (logged by the caller as `invalid_apn`) */
  customFieldInvalid: boolean;
}

export const CF_APN_CONFIDENCE = 0.7;

const NOTE_CONFIDENCE: Record<NoteConfidence, number> = {
  high: 0.6,
  medium: 0.5,
  low: 0.4,
  unstated: 0.4,
};

const PERMIT_NOTE = /^\s*Permit added\b/;
const NOTE_APN = /\bAPN[:\s]+(\d{3}-?\d{2}-?\d{3}[A-Z]?)\b/;
const NOTE_CONFIDENCE_WORD = /\bConfidence (high|medium|low)\b/i;

/** "2026-10-01 09:00:00" or ISO → ms; unparseable sorts oldest */
function noteTime(timestamp: string): number {
  const ms = Date.parse(timestamp.trim().replace(" ", "T"));
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

export function findApnHint(job: WorkizJob): ApnHintResult {
  let customFieldInvalid = false;
  const field = job.customFields.find((f) => f.id === WORKIZ_CF.apn);
  if (typeof field?.value === "string" && field.value.trim()) {
    const apn = formatApn(field.value);
    if (apn) return { hint: { apn, confidence: CF_APN_CONFIDENCE, source: "custom_field" }, customFieldInvalid };
    customFieldInvalid = true;
  }

  const newest = job.notes
    .filter((n) => PERMIT_NOTE.test(n.note) && NOTE_APN.test(n.note))
    .sort((a, b) => noteTime(b.timestamp) - noteTime(a.timestamp) || 0)[0];
  if (!newest) return { hint: null, customFieldInvalid };

  const apn = formatApn(NOTE_APN.exec(newest.note)?.[1]);
  if (!apn) return { hint: null, customFieldInvalid };
  const word = (NOTE_CONFIDENCE_WORD.exec(newest.note)?.[1]?.toLowerCase() ?? "unstated") as NoteConfidence;
  return {
    hint: { apn, confidence: NOTE_CONFIDENCE[word], source: "note", noteConfidence: word },
    customFieldInvalid,
  };
}
