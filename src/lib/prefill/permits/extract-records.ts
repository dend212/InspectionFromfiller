/**
 * Runs extraction over the permit documents a run has stored (spec §5.2 step 3,
 * §6, §10): ranks them, reads at most MAX_DOCUMENTS_PER_RUN, persists each
 * record's extraction status/facts, and turns the facts into proposals.
 * Every failure is per-record; this function never throws.
 */
import { eq } from "drizzle-orm";
import {
  ExtractionError,
  type ExtractPermitFactsResult,
  extractPermitFactsFromPdf,
} from "@/lib/ai/extract-permit-facts";
import type { PermitFacts } from "@/lib/ai/permit-extraction-schema";
import { db } from "@/lib/db";
import { inspectionRecords } from "@/lib/db/schema";
import { RECORD_BUCKET } from "@/lib/storage/record-storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { mapPermitFacts } from "../map-facts-to-fields";
import type { StageContext } from "@/lib/prefill/stage";
import {
  type ExtractionStatus,
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENTS_PER_RUN,
  type PermitArchive,
  type ProposedField,
} from "../types";
import { isExtractableDocType, rankForExtraction } from "./doc-types";

export interface StoredRecord {
  id: string;
  inspectionId: string;
  permitNumber: string;
  docType: string;
  source: PermitArchive;
  /** Bucket-relative path in `inspection-media` */
  storagePath: string;
  docDate: string | null;
  sizeBytes: number | null;
  /** Phase 2 stores at most MAX_DOCUMENTS_PER_RUN records as "pending" and the rest as "skipped" */
  extractionStatus: ExtractionStatus;
}

export interface RecordExtractionPatch {
  extractionStatus: ExtractionStatus;
  extractionError?: string | null;
  extracted?: PermitFacts | null;
}

export interface ExtractRecordsDeps {
  loadPdf: (storagePath: string) => Promise<Uint8Array>;
  extract: (
    bytes: Uint8Array,
    meta: { permitNumber: string; docType: string; archive: PermitArchive },
    opts: { signal: AbortSignal },
  ) => Promise<ExtractPermitFactsResult>;
  persist: (recordId: string, patch: RecordExtractionPatch) => Promise<void>;
  log: (line: string) => void;
}

export interface ExtractRecordsResult {
  proposals: ProposedField[];
  done: number;
  failed: number;
  skipped: number;
  /** Permit numbers of documents that record an abandonment (tile banner) */
  abandonmentPermits: string[];
  estimatedCostUsd: number;
  /** One line per read document for the stage summary */
  highlights: string[];
}

export function defaultExtractRecordsDeps(): ExtractRecordsDeps {
  return {
    loadPdf: async (storagePath) => {
      const { data, error } = await createAdminClient().storage.from(RECORD_BUCKET).download(storagePath);
      if (error || !data) {
        throw new ExtractionError(`Could not download stored document: ${error?.message ?? "empty response"}`);
      }
      return new Uint8Array(await data.arrayBuffer());
    },
    extract: (bytes, meta, opts) => extractPermitFactsFromPdf(bytes, meta, opts),
    persist: async (recordId, patch) => {
      await db
        .update(inspectionRecords)
        .set({
          extractionStatus: patch.extractionStatus,
          extractionError: patch.extractionError ?? null,
          ...(patch.extracted !== undefined ? { extracted: patch.extracted } : {}),
        })
        .where(eq(inspectionRecords.id, recordId));
    },
    log: (line) => console.info(line),
  };
}

function skipReason(r: StoredRecord): string {
  if (!r.storagePath) return "Document was not stored";
  if ((r.sizeBytes ?? 0) > MAX_DOCUMENT_BYTES) {
    return `Document is larger than ${Math.round(MAX_DOCUMENT_BYTES / 1024 / 1024)} MB`;
  }
  if (!isExtractableDocType(r.docType)) return `${r.docType} documents are not read`;
  return `Only the first ${MAX_DOCUMENTS_PER_RUN} documents are read per run`;
}

/**
 * Which pending records to read (rank order, ≤ MAX_DOCUMENTS_PER_RUN) and which
 * pending records to mark skipped. Records phase 2 already marked
 * skipped/failed/done are left alone.
 */
export function rankRecordsForExtraction(records: StoredRecord[]): {
  toExtract: StoredRecord[];
  toSkip: Array<{ record: StoredRecord; reason: string }>;
} {
  const pending = records.filter((r) => r.extractionStatus === "pending");
  // phase 2 marks an unstored document (storage_path "") failed/skipped, but never trust a blank path
  const eligible = pending.filter(
    (r) => r.storagePath !== "" && isExtractableDocType(r.docType) && (r.sizeBytes ?? 0) <= MAX_DOCUMENT_BYTES,
  );
  // phase 2's ranking (class rank, then newest first) wants `docDate?: string`, DB rows carry null
  const ranked = rankForExtraction(eligible.map((r) => ({ ...r, docDate: r.docDate ?? undefined })));
  const toExtract = ranked
    .slice(0, MAX_DOCUMENTS_PER_RUN)
    .map((r) => eligible.find((e) => e.id === r.id) as StoredRecord);
  const chosen = new Set(toExtract.map((r) => r.id));
  const toSkip = pending.filter((r) => !chosen.has(r.id)).map((record) => ({ record, reason: skipReason(record) }));
  return { toExtract, toSkip };
}

const DISPOSAL_LABEL: Record<string, string> = {
  trench: "trench",
  bed: "bed",
  chamber: "chamber",
  seepage_pit: "seepage pit",
  other: "disposal works",
};

/** "OW-17-00474: 1,250 gal tank · 2 seepage pits · 450 gpd design flow" */
export function describeFacts(permitNumber: string, facts: PermitFacts): string {
  const bits: string[] = [];
  const gal = facts.tanks[0]?.capacityGal?.value;
  if (gal != null) bits.push(`${Math.round(gal).toLocaleString("en-US")} gal tank`);
  if (facts.disposal.type) {
    const n = facts.disposal.count?.value;
    const label = DISPOSAL_LABEL[facts.disposal.type.value] ?? facts.disposal.type.value;
    bits.push(n != null && n > 1 ? `${n} ${label}s` : label);
  }
  if (facts.designFlowGpd) bits.push(`${Math.round(facts.designFlowGpd.value)} gpd design flow`);
  if (facts.isAbandonment) bits.push("ABANDONMENT");
  return `${permitNumber}: ${bits.length ? bits.join(" · ") : "no system facts found"}`;
}

export async function extractStoredRecords(
  records: StoredRecord[],
  ctx: StageContext,
  deps: ExtractRecordsDeps = defaultExtractRecordsDeps(),
): Promise<ExtractRecordsResult> {
  const { toExtract, toSkip } = rankRecordsForExtraction(records);
  const result: ExtractRecordsResult = {
    proposals: [],
    done: 0,
    failed: 0,
    skipped: 0,
    abandonmentPermits: [],
    estimatedCostUsd: 0,
    highlights: [],
  };

  for (const { record, reason } of toSkip) {
    await deps.persist(record.id, { extractionStatus: "skipped", extractionError: reason });
    result.skipped++;
  }

  for (const record of toExtract) {
    if (ctx.signal.aborted) {
      await deps.persist(record.id, {
        extractionStatus: "failed",
        extractionError: "Prefill time budget exceeded before this document was read",
      });
      result.failed++;
      continue;
    }
    await ctx.progress({ status: "running", summary: `Reading ${record.permitNumber}…` });
    try {
      const bytes = await deps.loadPdf(record.storagePath);
      const { facts, usage, passes, escalations } = await deps.extract(
        bytes,
        { permitNumber: record.permitNumber, docType: record.docType, archive: record.source },
        { signal: ctx.signal },
      );
      await deps.persist(record.id, { extractionStatus: "done", extractionError: null, extracted: facts });
      result.done++;
      result.estimatedCostUsd += usage.estimatedCostUsd;
      if (facts.isAbandonment) {
        result.abandonmentPermits.push(record.permitNumber);
      } else {
        result.proposals.push(
          ...mapPermitFacts(facts, {
            id: record.id,
            permitNumber: record.permitNumber,
            docType: record.docType,
            inspectionId: ctx.inspectionId,
          }),
        );
      }
      if (!facts.isAbandonment) result.highlights.push(describeFacts(record.permitNumber, facts));
      const tokens = usage.calls.reduce(
        (n, c) => n + c.inputTokens + c.outputTokens + c.cacheReadInputTokens + c.cacheCreationInputTokens,
        0,
      );
      deps.log(
        `[prefill] ${record.permitNumber}: ${passes} pass(es), ${escalations} escalation(s), ${tokens.toLocaleString("en-US")} tokens ≈ $${usage.estimatedCostUsd.toFixed(4)}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await deps.persist(record.id, { extractionStatus: "failed", extractionError: message.slice(0, 500) });
      result.failed++;
      deps.log(`[prefill] ${record.permitNumber}: extraction failed — ${message}`);
    }
  }

  return result;
}
