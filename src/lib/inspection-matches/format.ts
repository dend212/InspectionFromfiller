import { getStatusConfig } from "@/lib/constants/status";
import { APP_TIME_ZONE } from "@/lib/constants/time-zone";
import type { MatchReason, VisibleInspectionMatch } from "@/types/inspection-matches";

/** Display helpers for the possible-duplicate notice (duplicate-warning spec §2.1). Client-safe. */

const DATE_ONLY = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  year: "numeric",
});

const PHOENIX_DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  month: "short",
  day: "numeric",
  year: "numeric",
});

/** Header noun from the union of the visible matches' reasons */
export function headerNoun(reasons: readonly MatchReason[]): string {
  const apn = reasons.includes("apn");
  const address = reasons.includes("address");
  if (apn && address) return "address and APN";
  return apn ? "APN" : "address";
}

export function reasonLabel(reasons: readonly MatchReason[]): string {
  const apn = reasons.includes("apn");
  const address = reasons.includes("address");
  if (apn && address) return "Same APN and address";
  return apn ? "Same APN" : "Same address";
}

/**
 * "Inspected Oct 6, 2026" from the YYYY-MM-DD inspection date (noon UTC formatted in UTC, so the
 * day never shifts), else "Created Oct 1, 2026" from createdAt in America/Phoenix; "" if neither.
 */
export function formatMatchWhen(match: Pick<VisibleInspectionMatch, "inspectionDate" | "createdAt">): string {
  if (match.inspectionDate) {
    const day = new Date(`${match.inspectionDate}T12:00:00Z`);
    if (!Number.isNaN(day.getTime())) return `Inspected ${DATE_ONLY.format(day)}`;
  }
  const created = new Date(match.createdAt);
  return Number.isNaN(created.getTime()) ? "" : `Created ${PHOENIX_DAY.format(created)}`;
}

export function inspectorLabel(match: Pick<VisibleInspectionMatch, "isOwn" | "inspectorName">): string {
  if (match.isOwn) return "you";
  return match.inspectorName?.trim() || "Unknown inspector";
}

/** "100 E Example Rd, Cave Creek · Completed · Inspected Oct 6, 2026 · Sam Sample · Same APN and address" */
export function matchDetailLine(match: VisibleInspectionMatch): string {
  const place = [match.facilityAddress, match.facilityCity].filter(Boolean).join(", ") || "No address";
  return [
    place,
    getStatusConfig(match.status).label,
    formatMatchWhen(match),
    inspectorLabel(match),
    reasonLabel(match.reasons),
  ]
    .filter(Boolean)
    .join(" · ");
}
