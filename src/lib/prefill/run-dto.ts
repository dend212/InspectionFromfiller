import type { PermitFacts } from "@/lib/ai/permit-extraction-schema";
import { emptyPermitFacts } from "@/lib/ai/permit-extraction-schema";
import { isTransferRecord, permitDocDate } from "./map-facts-to-fields";
import { isAbandonmentDocType, permitDocRank } from "./permits/doc-types";
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

// Shared doc-type vocabulary (permits/doc-types) — kept exported here for phase-1 importers
export { isAbandonmentDocType };

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
    // the EDMS type, or (phase 3) what the model read in a document filed under another type
    isAbandonment:
      isAbandonmentDocType(row.docType) || (row.extracted as PermitFacts | null)?.isAbandonment === true,
    documentKind: (row.extracted as PermitFacts | null)?.documentKind ?? null,
    // "" = never stored (over 25 MB / download failed) — the tile hides the link, the route 404s
    downloadUrl: row.storagePath ? `/api/inspections/${row.inspectionId}/records/${row.id}` : "",
  };
}

/**
 * The "Permit documents" list in precedence order (the owner's rule: newest Discharge
 * Authorization on top, then the Approval to Construct, then transfers and abandonments) — the
 * same scale dedupeProposals uses for a record's facts: `permitDocRank` on what the model read
 * (an unread row falls back to its EDMS class), then newest first by `permitDocDate` (issue date
 * for permit-class rows, EDMS docDate for transfers / abandonments; undated last), then DB order
 * (`createdAt`) so the result is stable. Only the DTO is ordered — `listRecordRows` keeps
 * createdAt order because that is the extraction / replay order.
 */
function sortRecordsByPrecedence(records: InspectionRecordRow[]): InspectionRecordRow[] {
  return records
    .map((row, index) => {
      const facts = (row.extracted as PermitFacts | null) ?? emptyPermitFacts();
      const kind = facts.documentKind ?? "other";
      return {
        row,
        index,
        rank: permitDocRank(kind, row.docType),
        date: permitDocDate(facts, row, isTransferRecord(kind, row.docType)),
      };
    })
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      if (a.date !== b.date) {
        if (!a.date) return 1;
        if (!b.date) return -1;
        return a.date > b.date ? -1 : 1;
      }
      const created = a.row.createdAt.getTime() - b.row.createdAt.getTime();
      return created !== 0 ? created : a.index - b.index;
    })
    .map(({ row }) => row);
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
    records: sortRecordsByPrecedence(records).map(toInspectionRecordDTO),
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

/**
 * Used by the edit page to load the prefill panel's run without letting a DB error crash
 * the page. Non-draft inspections never show the panel, so the query is skipped entirely.
 */
export async function loadLatestRunDTOForDraft(
  inspectionId: string,
  status: string,
): Promise<PrefillRunDTO | null> {
  if (status !== "draft") return null;
  try {
    return await loadLatestRunDTO(inspectionId);
  } catch (err) {
    console.error("[prefill] latest run load failed", err);
    return null;
  }
}
