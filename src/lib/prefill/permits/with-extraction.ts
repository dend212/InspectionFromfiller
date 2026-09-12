// src/lib/prefill/permits/with-extraction.ts
/**
 * Phase 3 hook for the permits stage: once phase 2 has stored a run's
 * documents (stage "done"), read the pending ones with Claude and fold the
 * resulting proposals and a one-line digest into the stage result.
 * Never throws — a crash here leaves the phase-2 result intact with a note.
 */
import type { PermitFacts } from "@/lib/ai/permit-extraction-schema";
import type { StageContext, StageResult } from "@/lib/prefill/stage";
import { dedupeProposals } from "../map-facts-to-fields";
import { listRecordRows } from "../run-store";
import type { ExtractionStatus, PermitArchive } from "../types";
import {
  type ExtractRecordsResult,
  type StoredRecord,
  extractStoredRecords,
  hasReusableFacts,
} from "./extract-records";

export interface WithExtractionDeps {
  loadRecords: (runId: string) => Promise<StoredRecord[]>;
  extract: (records: StoredRecord[], ctx: StageContext) => Promise<ExtractRecordsResult>;
}

export function defaultWithExtractionDeps(): WithExtractionDeps {
  return {
    loadRecords: async (runId) => {
      const rows = await listRecordRows(runId); // phase 1 run-store: the run's rows, oldest first (= rank order)
      // `source` / `extraction_status` are text columns — narrow them to the shared vocabularies
      return rows.map((r) => ({
        id: r.id,
        inspectionId: r.inspectionId,
        permitNumber: r.permitNumber,
        docType: r.docType,
        source: r.source as PermitArchive,
        storagePath: r.storagePath,
        docDate: r.docDate,
        sizeBytes: r.sizeBytes,
        extractionStatus: r.extractionStatus as ExtractionStatus,
        extracted: (r.extracted as PermitFacts | null) ?? null,
      }));
    },
    extract: (records, ctx) => extractStoredRecords(records, ctx),
  };
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * "ABANDONMENT on file (permit X) · <phase-2 summary> · <highlights…> · N documents could not be read".
 * Phase 2 already writes an "ABANDONMENT on file (…)" part when a document's EDMS type is
 * ABANDONMENT; the banner is only added here when the model found one phase 2 did not name.
 */
export function buildExtractionSummary(base: string | undefined, x: ExtractRecordsResult): string {
  const parts: string[] = [];
  if (x.abandonmentPermits.length > 0 && !(base ?? "").includes("ABANDONMENT on file")) {
    parts.push(`ABANDONMENT on file (permit ${x.abandonmentPermits.join(", ")})`);
  }
  if (base) parts.push(base);
  parts.push(...x.highlights);
  if (x.failed > 0) parts.push(`${x.failed} document${x.failed === 1 ? "" : "s"} could not be read`);
  return parts.join(" · ");
}

function withSummary<T extends StageResult>(result: T, summary: string): T {
  return { ...result, stage: { ...result.stage, summary } };
}

/**
 * Reads the run's pending records (rank order, ≤ MAX_DOCUMENTS_PER_RUN) and
 * merges their proposals into `result` — along with the stored facts of rows
 * reused from an earlier run (D7), which are replayed rather than re-read.
 * Results that are not `done` (not found, error, awaiting selection) pass
 * through untouched.
 */
export async function withExtraction<T extends StageResult>(
  ctx: StageContext,
  result: T,
  deps: WithExtractionDeps = defaultWithExtractionDeps(),
): Promise<T> {
  if (result.stage.status !== "done") return result;
  try {
    const records = await deps.loadRecords(ctx.runId);
    if (!records.some((r) => r.extractionStatus === "pending" || hasReusableFacts(r))) return result;
    const x = await deps.extract(records, ctx);
    return {
      ...result,
      stage: {
        ...result.stage,
        summary: buildExtractionSummary(result.stage.summary, x),
        finishedAt: new Date().toISOString(), // phase 2 stamped it before extraction ran
      },
      proposals: dedupeProposals([...result.proposals, ...x.proposals]),
    };
  } catch (err) {
    console.error(`[prefill] extraction crashed for run ${ctx.runId}: ${errorMessage(err)}`);
    const note = `extraction failed: ${errorMessage(err)}`;
    return withSummary(result, result.stage.summary ? `${result.stage.summary} · ${note}` : note);
  }
}
