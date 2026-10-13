import { inspectionPath } from "@/lib/inspection-path";
import { addressKey, addressKeysCompatible } from "@/lib/prefill/address-key";
import type {
  InspectionMatchResult,
  MatchReason,
  VisibleInspectionMatch,
} from "@/types/inspection-matches";
import { apnMatchKey, cityKey, type MatchQuery, zip5 } from "./normalize";
import type { MatchCandidateRow } from "./store";

/**
 * The possible-duplicate decision (duplicate-warning spec §5.3–§5.4, §8). Pure. buildMatchResult
 * is the ONLY place that splits visible from hidden matches: a hidden match contributes a count
 * and nothing else.
 */

export const WIZARD_MATCH_LIMIT = 5;
export const PICKER_MATCH_LIMIT = 3;
export const CANDIDATE_LIMIT = 200;
export const BATCH_CANDIDATE_LIMIT = 500;

export interface MatchViewer {
  userId: string;
  /** admin/office staff (wizard route) or admin (picker route) */
  privileged: boolean;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** The form APN is authoritative; the write-once column only counts when the form key is null */
export function storedApnKey(row: MatchCandidateRow): string | null {
  return apnMatchKey(row.taxParcelNumber) ?? apnMatchKey(row.apn);
}

/** Equal ZIPs; different ZIPs only with equal cities; a missing ZIP → cities decide when both exist */
export function localityCompatible(query: MatchQuery, row: MatchCandidateRow): boolean {
  const rowZip = zip5(row.facilityZip);
  const rowCity = cityKey(row.facilityCity);
  const bothCities = query.city !== null && rowCity !== null;
  const citiesEqual = bothCities && query.city === rowCity;
  if (query.zip5 !== null && rowZip !== null) return query.zip5 === rowZip || citiesEqual;
  return bothCities ? citiesEqual : true;
}

/** Order is always ["apn", "address"] ∩ actual */
export function matchReasons(query: MatchQuery, row: MatchCandidateRow): MatchReason[] {
  const reasons: MatchReason[] = [];
  if (query.apnKey !== null && query.apnKey === storedApnKey(row)) reasons.push("apn");
  if (query.address) {
    const stored = addressKey(row.facilityAddress ?? "");
    if (stored && addressKeysCompatible(query.address, stored) && localityCompatible(query, row)) {
      reasons.push("address");
    }
  }
  return reasons;
}

/**
 * inspectionPath, except another inspector's draft opens /review/{id}: the edit page's first
 * autosave tick would re-save its stale snapshot over the owner's edits (spec §2.1).
 */
export function matchHref(row: MatchCandidateRow, viewer: MatchViewer): string {
  if (row.status === "draft" && row.inspectorId !== viewer.userId) return `/review/${row.id}`;
  return inspectionPath(row.id, row.status, viewer.privileged);
}

const rank = (reasons: MatchReason[]): number => (reasons.length === 2 ? 0 : reasons[0] === "apn" ? 1 : 2);

function toVisible(row: MatchCandidateRow, reasons: MatchReason[], viewer: MatchViewer): VisibleInspectionMatch {
  return {
    inspectionId: row.id,
    href: matchHref(row, viewer),
    status: row.status,
    facilityAddress: row.facilityAddress ?? "",
    facilityCity: row.facilityCity ?? "",
    inspectionDate: row.inspectionDate && DATE_ONLY.test(row.inspectionDate) ? row.inspectionDate : null,
    createdAt: row.createdAt.toISOString(),
    inspectorName: row.inspectorName,
    isOwn: row.inspectorId === viewer.userId,
    reasons,
  };
}

export function buildMatchResult(
  query: MatchQuery,
  rows: MatchCandidateRow[],
  viewer: MatchViewer,
  opts: { limit: number; candidateCapHit: boolean; excludeWorkizJobIds?: string[] },
): InspectionMatchResult {
  // A picker row's own import is skipped: its Open existing button already covers it
  const ownImport = new Set((opts.excludeWorkizJobIds ?? []).filter(Boolean));
  const matched = rows
    .filter((row) => !(row.workizJobId && ownImport.has(row.workizJobId)))
    .map((row) => ({ row, reasons: matchReasons(query, row) }))
    .filter((m) => m.reasons.length > 0)
    .sort((a, b) => rank(a.reasons) - rank(b.reasons) || b.row.createdAt.getTime() - a.row.createdAt.getTime());

  // canOpen = checkInspectionAccess: owner, or privileged
  const visible = matched.filter((m) => m.row.inspectorId === viewer.userId || viewer.privileged);
  return {
    matches: visible.slice(0, opts.limit).map((m) => toVisible(m.row, m.reasons, viewer)),
    hiddenCount: matched.length - visible.length,
    truncated: visible.length > opts.limit || opts.candidateCapHit,
  };
}
