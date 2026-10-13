/**
 * Wire types for the possible-duplicate check (duplicate-warning spec §6.3): the response of
 * POST /api/inspections/[id]/matches and WorkizJobRow.possibleMatches. Client- and server-safe.
 */

export type MatchReason = "apn" | "address";

export interface InspectionMatchRequest {
  facilityAddress?: string;
  facilityCity?: string;
  facilityZip?: string;
  taxParcelNumber?: string;
}

/** A match the viewer is allowed to open */
export interface VisibleInspectionMatch {
  inspectionId: string;
  /** In-app route for THIS viewer (matchHref) */
  href: string;
  status: string;
  /** "" when null */
  facilityAddress: string;
  /** "" when null */
  facilityCity: string;
  /** formData.facilityInfo.dateOfInspection when it is YYYY-MM-DD, else null */
  inspectionDate: string | null;
  /** ISO */
  createdAt: string;
  inspectorName: string | null;
  isOwn: boolean;
  /** Non-empty; order is always ["apn", "address"] ∩ actual */
  reasons: MatchReason[];
}

export interface InspectionMatchResult {
  matches: VisibleInspectionMatch[];
  /** Matches the viewer cannot open: a count only, never any detail */
  hiddenCount: number;
  truncated: boolean;
}
