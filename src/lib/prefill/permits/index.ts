// src/lib/prefill/permits/index.ts
/**
 * Permits prefill stage (spec §5.2): search both EDMS archives, rank the
 * documents, download them into storage, and summarise for the tile.
 *
 * Never throws — every failure becomes a stage status. Phase 3 adds the
 * extraction step after `storeHits`; in this phase every stored document is
 * left at `extraction_status = "pending"` (or "skipped" / "failed").
 */

import type { StageContext, StageResult } from "@/lib/prefill/stage";
import {
  type ExtractionStatus,
  MAX_DOCUMENTS_PER_RUN,
  type PermitArchive,
  type PermitCandidate,
  type PrefillInput,
  type PrefillStage,
  type ProposedField,
  type StageLink,
} from "../types";
import type { SearchHit } from "./candidates";
import { isAbandonmentDocType, isExtractableDocType, rankForExtraction } from "./doc-types";
import { EDMS_ARCHIVES } from "./edms-client";
import { type StoreDocumentInput, type StoreDocumentResult, storeDocument } from "./fetch-document";
import { type PermitSearchOutcome, searchPermits } from "./search";

export const EDMS_LINKS: StageLink[] = [
  { label: "Open on Maricopa EDMS", url: EDMS_ARCHIVES.env.searchPageUrl },
  { label: "EDMS 2024+ archive", url: EDMS_ARCHIVES.eplpav.searchPageUrl },
];

export const SELECTION_STALE_MESSAGE =
  "Selected permits are no longer available on Maricopa EDMS — run Find records again";

/** Summary parts are joined with this so the tile can wrap on it */
const SUMMARY_SEPARATOR = " · ";

/** How many ranked documents the summary lists before "…" */
const SUMMARY_LIST_LIMIT = 4;

export type PermitsStageResult = StageResult & { candidates?: PermitCandidate[] };

export interface PermitsStageDeps {
  searchPermits: (input: PrefillInput, signal: AbortSignal) => Promise<PermitSearchOutcome>;
  storeDocument: (input: StoreDocumentInput) => Promise<StoreDocumentResult>;
}

const defaultDeps: PermitsStageDeps = {
  searchPermits: (input, signal) => searchPermits(input, signal),
  storeDocument: (input) => storeDocument(input),
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

export function notFoundSummary(searched: string[]): string {
  if (searched.length === 0) {
    return "No permit records searched — add an APN or street address and run Find records";
  }
  return `No permit records found (searched ${searched.join(" and ")} — 0 matches)`;
}

const ARCHIVE_LABELS: Record<PermitArchive, string> = {
  edms_env: "the legacy archive (env)",
  edms_eplpav: "the 2024+ archive (eplpav)",
};

/**
 * Amendment A8: a query that threw is phrased as a failed query, not an
 * outage — a `found via street` can still carry env rows while listing env.
 * Returns null when every query succeeded.
 */
export function failedArchivesNote(failedArchives: PermitArchive[]): string | null {
  if (failedArchives.length === 0) return null;
  const labels = failedArchives.map((a) => ARCHIVE_LABELS[a]);
  const subject =
    labels.length === 1 ? `A query to ${labels[0]}` : `Queries to ${labels.join(" and ")}`;
  return `${subject} failed — results may be incomplete`;
}

function withNote(summary: string, note: string | null): string {
  return note ? `${summary}${SUMMARY_SEPARATOR}${note}` : summary;
}

function recordsAvailableProposal(
  value: "yes" | "no",
  confidence: number,
  explanation: string,
  runId: string,
  link: { sourceUrl: string; recordId?: string },
): ProposedField {
  return {
    fieldPath: "facilityInfo.recordsAvailable",
    value,
    kind: "fill",
    provenance: {
      source: "permit",
      confidence,
      explanation,
      sourceUrl: link.sourceUrl,
      ...(link.recordId ? { recordId: link.recordId } : {}),
      runId,
    },
  };
}

interface StageClock {
  startedAt: string;
}

function finishStage(clock: StageClock, partial: Partial<PrefillStage>): PrefillStage {
  return {
    status: "done",
    links: EDMS_LINKS,
    startedAt: clock.startedAt,
    finishedAt: new Date().toISOString(),
    ...partial,
  };
}

function errorResult(clock: StageClock, error: string, summary: string): StageResult {
  return { stage: finishStage(clock, { status: "error", error, summary }), proposals: [] };
}

interface StoreOutcome {
  hit: SearchHit;
  result: StoreDocumentResult | null;
  error?: string;
}

/** Rank → decide extraction slot → store each document, reporting progress. */
async function storeHits(
  hits: SearchHit[],
  ctx: StageContext,
  deps: PermitsStageDeps,
  clock: StageClock,
  note: string | null,
): Promise<StageResult> {
  const ranked = rankForExtraction(
    hits.map((hit) => ({ hit, docType: hit.candidate.docType, docDate: hit.candidate.docDate })),
  ).map((r) => r.hit);

  const outcomes: StoreOutcome[] = [];
  let pendingStored = 0;
  let notDownloaded = 0;

  for (const [index, hit] of ranked.entries()) {
    if (ctx.signal.aborted) {
      notDownloaded = ranked.length - index;
      break;
    }
    const { permitNumber, docType } = hit.candidate;
    let extractionStatus: ExtractionStatus = "skipped";
    let extractionError: string | null = null;
    if (!isExtractableDocType(docType)) {
      extractionError = `${docType} documents are not extracted`;
    } else if (pendingStored >= MAX_DOCUMENTS_PER_RUN) {
      extractionError = `Over the ${MAX_DOCUMENTS_PER_RUN}-document extraction limit`;
    } else {
      extractionStatus = "pending";
    }

    await ctx.progress({
      status: "running",
      summary: `Downloading ${index + 1} of ${ranked.length}: ${permitNumber} ${docType}…`,
    });

    try {
      const result = await deps.storeDocument({
        inspectionId: ctx.inspectionId,
        runId: ctx.runId,
        hit,
        extractionStatus,
        extractionError,
        signal: ctx.signal,
      });
      // A pending doc that failed to store frees its slot for the next one
      if (result.stored && extractionStatus === "pending") pendingStored++;
      outcomes.push({ hit, result });
    } catch (err) {
      console.error(`[prefill/permits] storing ${permitNumber} threw:`, err);
      outcomes.push({ hit, result: null, error: errorMessage(err) });
    }
  }

  const stored = outcomes.filter((o) => o.result?.stored);
  const failed = outcomes.filter((o) => !o.result || o.result.extractionStatus === "failed").length;
  const tooLarge = outcomes.filter(
    (o) => o.result && !o.result.stored && o.result.extractionStatus === "skipped",
  ).length;
  const abandonments = hits
    .filter((h) => isAbandonmentDocType(h.candidate.docType))
    .map((h) => h.candidate.permitNumber);

  const listed = ranked
    .slice(0, SUMMARY_LIST_LIMIT)
    .map((h) => `${h.candidate.permitNumber} ${h.candidate.docType}`);
  const overflow = ranked.length > SUMMARY_LIST_LIMIT ? ", …" : "";
  const headline = `${plural(hits.length, "permit document")} found: ${listed.join(", ")}${overflow}`;
  const parts = [headline];
  if (tooLarge > 0) parts.push(`${tooLarge} over 25 MB not downloaded`);
  if (failed > 0) parts.push(`${failed} download failed`);
  if (notDownloaded > 0) parts.push(`${notDownloaded} not downloaded (out of time)`);
  if (abandonments.length > 0) parts.push(`ABANDONMENT on file (${abandonments.join(", ")})`);
  if (note) parts.push(note);

  const first = ranked[0].candidate;
  const firstStored = stored[0]?.result ?? null;
  const proposals: ProposedField[] = [
    recordsAvailableProposal(
      "yes",
      1,
      `Permit ${first.permitNumber} (${first.docType}) found on Maricopa EDMS`,
      ctx.runId,
      firstStored
        ? {
            sourceUrl: `/api/inspections/${ctx.inspectionId}/records/${firstStored.recordId}`,
            recordId: firstStored.recordId,
          }
        : { sourceUrl: EDMS_ARCHIVES.env.searchPageUrl },
    ),
  ];

  return {
    stage: finishStage(clock, { status: "done", summary: parts.join(SUMMARY_SEPARATOR) }),
    proposals,
  };
}

export async function runPermitsStage(
  input: PrefillInput,
  ctx: StageContext,
  deps: PermitsStageDeps = defaultDeps,
): Promise<PermitsStageResult> {
  const clock: StageClock = { startedAt: new Date().toISOString() };
  try {
    await ctx.progress({
      status: "running",
      startedAt: clock.startedAt,
      summary: "Searching Maricopa EDMS…",
      links: EDMS_LINKS,
    });
    const outcome = await deps.searchPermits(input, ctx.signal);
    switch (outcome.kind) {
      case "error":
        return errorResult(clock, outcome.message, outcome.message);
      case "not_found": {
        const note = failedArchivesNote(outcome.failedArchives);
        const summary = withNote(notFoundSummary(outcome.searched), note);
        // Only suggest "no" when we actually searched something and every query ran —
        // a negative after a partial outage is exactly the confident negative A8 forbids.
        const proposals: ProposedField[] =
          outcome.searched.length === 0 || note
            ? []
            : [
                recordsAvailableProposal(
                  "no",
                  0.6,
                  `No permit records found on Maricopa EDMS (searched ${outcome.searched.join(" and ")})`,
                  ctx.runId,
                  { sourceUrl: EDMS_ARCHIVES.env.searchPageUrl },
                ),
              ];
        return { stage: finishStage(clock, { status: "not_found", summary }), proposals };
      }
      case "ambiguous":
        return {
          stage: finishStage(clock, {
            status: "pending",
            summary: withNote(
              `${outcome.hits.length} possible permits — pick the right one`,
              failedArchivesNote(outcome.failedArchives),
            ),
          }),
          proposals: [],
          candidates: outcome.hits.map((h) => h.candidate),
        };
      case "found": {
        const note = failedArchivesNote(outcome.failedArchives);
        return storeHits(outcome.hits, ctx, deps, clock, note);
      }
    }
  } catch (err) {
    console.error("[prefill/permits] stage crashed:", err);
    return errorResult(clock, errorMessage(err), "Permit search failed");
  }
}

/**
 * /select continuation: EDMS document IDs are ephemeral, so re-run the same
 * search and match the chosen candidates by their stable `key`.
 */
export async function runPermitsSelection(
  input: PrefillInput,
  ctx: StageContext,
  candidateKeys: string[],
  deps: PermitsStageDeps = defaultDeps,
): Promise<StageResult> {
  const clock: StageClock = { startedAt: new Date().toISOString() };
  try {
    await ctx.progress({
      status: "running",
      startedAt: clock.startedAt,
      summary: "Fetching the selected permits…",
      links: EDMS_LINKS,
    });
    const outcome = await deps.searchPermits(input, ctx.signal);
    if (outcome.kind === "error") {
      return errorResult(clock, outcome.message, outcome.message);
    }
    const fresh = outcome.kind === "not_found" ? [] : outcome.hits;
    const wanted = new Set(candidateKeys);
    const selected = fresh.filter((h) => wanted.has(h.candidate.key));
    if (selected.length === 0) {
      return errorResult(clock, SELECTION_STALE_MESSAGE, SELECTION_STALE_MESSAGE);
    }
    return storeHits(selected, ctx, deps, clock, failedArchivesNote(outcome.failedArchives));
  } catch (err) {
    console.error("[prefill/permits] selection crashed:", err);
    return errorResult(clock, errorMessage(err), "Fetching the selected permits failed");
  }
}
