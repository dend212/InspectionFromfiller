import type { InspectionMatchResult } from "@/types/inspection-matches";
import {
  BATCH_CANDIDATE_LIMIT,
  buildMatchResult,
  CANDIDATE_LIMIT,
  type MatchViewer,
  PICKER_MATCH_LIMIT,
  WIZARD_MATCH_LIMIT,
} from "./match";
import type { MatchQuery } from "./normalize";
import { findMatchCandidates } from "./store";

/**
 * Server entry points of the possible-duplicate check (duplicate-warning spec §6.4). Both throw on
 * a DB error; callers log with logDbError only.
 */

export interface MatchBatchItem {
  key: string;
  query: MatchQuery | null;
  excludeWorkizJobIds: string[];
}

const EMPTY: InspectionMatchResult = { matches: [], hiddenCount: 0, truncated: false };

const prefilter = (queries: MatchQuery[]) => ({
  houseNumbers: [...new Set(queries.flatMap((query) => (query.address ? [query.address.number] : [])))],
  apnKeys: [...new Set(queries.flatMap((query) => (query.apnKey ? [query.apnKey] : [])))],
});

/** Wizard: one SELECT, the current inspection excluded */
export async function findPossibleDuplicates(
  query: MatchQuery,
  viewer: MatchViewer,
  opts: { excludeInspectionId: string; limit?: number },
): Promise<InspectionMatchResult> {
  const { rows, capHit } = await findMatchCandidates({
    ...prefilter([query]),
    excludeInspectionId: opts.excludeInspectionId,
    limit: CANDIDATE_LIMIT,
  });
  return buildMatchResult(query, rows, viewer, { limit: opts.limit ?? WIZARD_MATCH_LIMIT, candidateCapHit: capHit });
}

/**
 * Picker: ONE SELECT for every row. If that shared pool overflows, a row's older matches may have
 * been pushed out by other rows' candidates, so each row with a query is then re-checked on its
 * own (sequentially) and its `truncated` reflects its own cap (spec §5.4).
 */
export async function findPossibleDuplicatesBatch(
  items: MatchBatchItem[],
  viewer: MatchViewer,
  opts: { limit?: number } = {},
): Promise<Map<string, InspectionMatchResult>> {
  const limit = opts.limit ?? PICKER_MATCH_LIMIT;
  const results = new Map<string, InspectionMatchResult>();
  const active: Array<MatchBatchItem & { query: MatchQuery }> = [];
  for (const item of items) {
    if (item.query) active.push({ ...item, query: item.query });
    else results.set(item.key, EMPTY);
  }
  if (active.length === 0) return results;

  const pool = await findMatchCandidates({
    ...prefilter(active.map((item) => item.query)),
    limit: BATCH_CANDIDATE_LIMIT,
  });
  for (const item of active) {
    let rows = pool.rows;
    let capHit = false;
    if (pool.capHit) {
      ({ rows, capHit } = await findMatchCandidates({ ...prefilter([item.query]), limit: CANDIDATE_LIMIT }));
    }
    results.set(
      item.key,
      buildMatchResult(item.query, rows, viewer, {
        limit,
        candidateCapHit: capHit,
        excludeWorkizJobIds: item.excludeWorkizJobIds,
      }),
    );
  }
  return results;
}
