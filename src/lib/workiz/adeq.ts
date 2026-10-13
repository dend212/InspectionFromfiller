import { findApnHint } from "./apn-hint";
import { formatWorkizCity, formatWorkizStreet, formatWorkizZip } from "./custom-fields";
import type { WorkizJob } from "./schema";

/** Exact, lowercase, top-level Workiz status (spec §7.4) — a rename would empty the picker */
export const WORKIZ_STATUS_DONE_PENDING_APPROVAL = "done pending approval";

export const ADEQ_JOB_TYPE_IDS: ReadonlySet<string> = new Set([
  "JT-a5DbVzyREDgGvdWK", // "ADEQ Septic Inspection "
  "JT-ly4RYx5nKd2z30dw", // "ADEQ Inspection - Online Booking"
]);

/** Import-time re-check also allows "Done": a job can move on between listing and import */
export const IMPORT_ALLOWED_STATUSES: ReadonlySet<string> = new Set([
  WORKIZ_STATUS_DONE_PENDING_APPROVAL,
  "Done",
]);

export { WORKIZ_CF } from "./custom-field-ids";

export const isAdeqJob = (job: WorkizJob): boolean =>
  ADEQ_JOB_TYPE_IDS.has(job.jobType?.id ?? "") || (job.jobType?.name ?? "").trim().startsWith("ADEQ");

/** The picker's filter */
export const isImportable = (job: WorkizJob): boolean =>
  isAdeqJob(job) && job.status === WORKIZ_STATUS_DONE_PENDING_APPROVAL;

export const canImportNow = (job: WorkizJob): boolean =>
  isAdeqJob(job) && IMPORT_ALLOWED_STATUSES.has(job.status);

/** Workiz `date` is account-local wall-clock "YYYY-MM-DD HH:MM:SS"; slicing avoids any UTC shift */
export function scheduledDateOf(job: WorkizJob): string | null {
  const day = (job.date ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/** Trimmed, non-empty team names in Workiz order, de-duplicated */
export function teamNames(job: WorkizJob): string[] {
  const names = job.team.map((member) => member.name.replace(/\s+/g, " ").trim()).filter(Boolean);
  return [...new Set(names)];
}

/** First token of each team name, de-duplicated case-insensitively (first spelling wins) */
export function teamFirstNames(job: WorkizJob): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of teamNames(job)) {
    const first = name.split(" ")[0];
    const key = first.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(first);
  }
  return out;
}

/** Server-side summary: no client name, email, phone or notes (the list cache holds only these) */
export interface WorkizJobSummary {
  id: string;
  uuid: string;
  serialId: number | null;
  street: string;
  city: string;
  scheduledDate: string | null;
  subStatus: string | null;
  teamFirstNames: string[];
  /** 5-digit ZIP or null; server-side only (feeds the possible-duplicate check, never the wire) */
  zip: string | null;
  /** Formatted APN from the custom field or the newest permit-bot note; server-side only */
  apnHint: string | null;
}

export function toJobSummary(job: WorkizJob): WorkizJobSummary {
  const address = job.clientInfo.addressDetails;
  return {
    id: job.id,
    uuid: job.uuid,
    serialId: job.serialId,
    street: formatWorkizStreet(address.address, address.unit),
    city: formatWorkizCity(address.city),
    scheduledDate: scheduledDateOf(job),
    subStatus: job.subStatus?.name.trim() || null,
    teamFirstNames: teamFirstNames(job),
    zip: formatWorkizZip(address.zipCode),
    apnHint: findApnHint(job).hint?.apn ?? null,
  };
}
