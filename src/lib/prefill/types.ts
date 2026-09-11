/** Where a prefilled value came from. Colours/labels in ./sources.ts */
export type PrefillSource = "assessor" | "permit" | "listing" | "scan";

/** Lifecycle of a provenance entry for one field */
export type ProvenanceState = "prefilled" | "suggested" | "edited" | "verified";

export type ProvenanceValue = string | boolean | string[];

/** `fill` proposes a value; `warning` only carries a message (never writes a value) */
export type ProposalKind = "fill" | "warning";

export interface ProvenanceEntry {
  source: PrefillSource;
  state: ProvenanceState;
  kind: ProposalKind;
  /** The value we proposed (for `warning`, the empty string) */
  value: ProvenanceValue;
  /** 0–1 */
  confidence: number;
  /** One line shown in the popover, e.g. "Permit OW-17-00474 · Discharge Authorization p.1" */
  explanation: string;
  /** Verbatim quote from the source, if any */
  evidence?: string;
  /** Link to the source: Zillow URL, assessor page, or /api/inspections/{id}/records/{recordId}#page=N */
  sourceUrl?: string;
  recordId?: string;
  page?: number;
  runId?: string;
  /** ISO timestamp of when the entry was written/updated */
  at: string;
}

/** Keyed by dotted form field path, e.g. "septicTank.tankCapacity" */
export type FieldProvenance = Record<string, ProvenanceEntry>;

/** What a prefill stage proposes for one field; the client merges these into the form */
export interface ProposedField {
  fieldPath: string;
  value: ProvenanceValue;
  kind: ProposalKind;
  provenance: Omit<ProvenanceEntry, "state" | "value" | "at" | "kind">;
}

export type PrefillTrigger = "apn_lookup" | "manual" | "webhook";
export type PrefillRunStatus = "queued" | "running" | "awaiting_selection" | "done" | "failed";
export type StageStatus = "pending" | "running" | "done" | "not_found" | "error" | "skipped";

export interface StageLink {
  label: string;
  url: string;
}

export interface PrefillStage {
  status: StageStatus;
  startedAt?: string;
  finishedAt?: string;
  /** One line for the tile, e.g. "2 permits found" / "No Zillow listing found for 8911 E Cave Creek Rd" */
  summary?: string;
  error?: string;
  links: StageLink[];
}

export interface PrefillStages {
  assessor: PrefillStage;
  listing: PrefillStage;
  permits: PrefillStage;
}

export interface PrefillAddress {
  streetNumber: string;
  streetName: string;
  streetDir?: string;
  city?: string;
  zip?: string;
  /** Single-line address for the listing lookup, e.g. "8911 E Cave Creek Rd, Carefree, AZ 85377" */
  full?: string;
}

export interface PrefillInput {
  apn?: string;
  address?: PrefillAddress;
  subdivision?: string;
  lot?: string;
}

export type PermitArchive = "edms_env" | "edms_eplpav";

/**
 * A permit document we might extract from. `key` is stable across searches
 * (EDMS document IDs are ephemeral and are never persisted).
 */
export interface PermitCandidate {
  /** `${archive}:${permitNumber}:${docType}:${docDate ?? ""}` */
  key: string;
  archive: PermitArchive;
  permitNumber: string;
  docType: string;
  docDate?: string;
  description?: string;
  streetAddress?: string;
  city?: string;
  zip?: string;
  subdivision?: string;
  lot?: string;
  apn?: string;
  score: number;
}

export type ExtractionStatus = "pending" | "done" | "skipped" | "failed";

export interface InspectionRecordDTO {
  id: string;
  source: PermitArchive;
  permitNumber: string;
  docType: string;
  docDate: string | null;
  description: string | null;
  pageCount: number | null;
  sizeBytes: number | null;
  selected: boolean;
  extractionStatus: ExtractionStatus;
  extractionError: string | null;
  isAbandonment: boolean;
  /** Auth-gated route that 302s to a signed URL */
  downloadUrl: string;
}

export interface PrefillRunDTO {
  id: string;
  inspectionId: string;
  trigger: PrefillTrigger;
  status: PrefillRunStatus;
  input: PrefillInput;
  stages: PrefillStages;
  proposals: ProposedField[];
  candidates: PermitCandidate[];
  error: string | null;
  appliedAt: string | null;
  createdAt: string;
  finishedAt: string | null;
  records: InspectionRecordDTO[];
}

/** Values at or above this confidence fill the field directly; below → suggestion chip */
export const PREFILL_FILL_THRESHOLD = 0.75;
/** Handwritten facts below this confidence are re-asked on the stronger model */
export const HANDWRITING_ESCALATION_THRESHOLD = 0.6;
/** Max prefill runs per inspection per rolling hour */
export const MAX_PREFILL_RUNS_PER_HOUR = 3;
/** Max permit documents extracted per run */
export const MAX_DOCUMENTS_PER_RUN = 3;
/** Skip documents larger than this (bytes) — Claude request cap is 32 MB */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

export function emptyStages(): PrefillStages {
  const s = (): PrefillStage => ({ status: "pending", links: [] });
  return { assessor: s(), listing: s(), permits: s() };
}
