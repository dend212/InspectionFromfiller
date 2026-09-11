import type { InspectionRecordRow, PrefillRunRow } from "./run-store";
import { listRecordRows, loadLatestRunRow, loadRunRow } from "./run-store";
import type {
  ExtractionStatus,
  InspectionRecordDTO,
  PermitArchive,
  PermitCandidate,
  PrefillInput,
  PrefillRunDTO,
  PrefillRunStatus,
  PrefillStages,
  PrefillTrigger,
  ProposedField,
} from "./types";
import { emptyStages } from "./types";

export function isAbandonmentDocType(docType: string): boolean {
  return /ABANDON/i.test(docType);
}

/** Never exposes storage_path — documents are reached only through the auth-gated records route */
export function toInspectionRecordDTO(row: InspectionRecordRow): InspectionRecordDTO {
  return {
    id: row.id,
    source: row.source as PermitArchive,
    permitNumber: row.permitNumber,
    docType: row.docType,
    docDate: row.docDate,
    description: row.description,
    pageCount: row.pageCount,
    sizeBytes: row.sizeBytes,
    selected: row.selected,
    extractionStatus: row.extractionStatus as ExtractionStatus,
    extractionError: row.extractionError,
    isAbandonment: isAbandonmentDocType(row.docType),
    downloadUrl: `/api/inspections/${row.inspectionId}/records/${row.id}`,
  };
}

export function toPrefillRunDTO(run: PrefillRunRow, records: InspectionRecordRow[]): PrefillRunDTO {
  const stages: PrefillStages = {
    ...emptyStages(),
    ...((run.stages ?? {}) as Partial<PrefillStages>),
  };
  return {
    id: run.id,
    inspectionId: run.inspectionId,
    trigger: run.trigger as PrefillTrigger,
    status: run.status as PrefillRunStatus,
    input: (run.input ?? {}) as PrefillInput,
    stages,
    proposals: (run.proposals ?? []) as ProposedField[],
    candidates: (run.candidates ?? []) as PermitCandidate[],
    error: run.error,
    appliedAt: run.appliedAt ? run.appliedAt.toISOString() : null,
    createdAt: run.createdAt.toISOString(),
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
    records: records.map(toInspectionRecordDTO),
  };
}

export async function loadRunDTO(runId: string): Promise<PrefillRunDTO | null> {
  const run = await loadRunRow(runId);
  if (!run) return null;
  const records = await listRecordRows(run.id);
  return toPrefillRunDTO(run, records);
}

export async function loadLatestRunDTO(inspectionId: string): Promise<PrefillRunDTO | null> {
  const run = await loadLatestRunRow(inspectionId);
  if (!run) return null;
  const records = await listRecordRows(run.id);
  return toPrefillRunDTO(run, records);
}
