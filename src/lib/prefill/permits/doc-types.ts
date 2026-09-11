/**
 * Document-type vocabulary across both EDMS archives and the extraction
 * ranking from spec §5.2 step 3.
 *
 * Legacy `env` rows carry `EnvSepticDocType` (PERMIT, PERMIT SUB, NOTICE OF
 * TRANSFER, ABANDONMENT, PLAN REVIEW, SUB). ePLPAV rows have no such column;
 * `deriveEplpavDocType` builds one from `Permit Subtype` + `File Name`
 * (686/1000 ONSITE PERMIT rows in the recording are "… FINAL DA", 277 have an
 * empty File Name).
 */

export type DocClass =
  | "permit"
  | "permit_sub"
  | "notice_of_transfer"
  | "abandonment"
  | "plan_review"
  | "other";

/** Lower ranks are extracted first */
export const DOC_CLASS_RANK: Record<DocClass, number> = {
  permit: 0,
  permit_sub: 1,
  notice_of_transfer: 2,
  abandonment: 3,
  plan_review: 4,
  other: 5,
};

export function classifyDocType(docType: string): DocClass {
  const t = docType.toUpperCase().trim();
  if (t.includes("ABANDON")) return "abandonment";
  if (t.includes("TRANSFER") || t === "NOT") return "notice_of_transfer";
  if (t === "PERMIT SUB") return "permit_sub";
  if (
    t.includes("PLAN REVIEW") ||
    t === "SUB" ||
    t.includes("MINOR REVIEW") ||
    t.includes("PND") ||
    t.includes("P&D")
  ) {
    return "plan_review";
  }
  if (
    t === "PERMIT" ||
    t.includes("FINAL DA") ||
    t.includes("DA FINAL") ||
    t === "DA" ||
    t.includes("DISCHARGE")
  ) {
    return "permit";
  }
  return "other";
}

export function isAbandonmentDocType(docType: string): boolean {
  return classifyDocType(docType) === "abandonment";
}

/** PLAN REVIEW / SUB / unknown types are stored but never sent to extraction */
export function isExtractableDocType(docType: string): boolean {
  const cls = classifyDocType(docType);
  return cls !== "plan_review" && cls !== "other";
}

export function deriveEplpavDocType(subtype: string, fileName: string): string {
  const sub = subtype.toUpperCase().trim();
  const name = fileName.toUpperCase();
  switch (sub) {
    case "ONSITE PERMIT":
      return /\bDA\b/.test(name) ? "FINAL DA" : "PERMIT";
    case "NOTICE OF TRANSFER":
      return "NOTICE OF TRANSFER";
    case "ABANDONMENT":
      return "ABANDONMENT";
    case "MINOR REVIEW/REMODEL":
    case "PND REVIEW":
      return "PLAN REVIEW";
    default:
      return sub || "OTHER";
  }
}

/** Stable: class rank ascending, then docDate descending (undated last). Returns a copy. */
export function rankForExtraction<T extends { docType: string; docDate?: string }>(docs: T[]): T[] {
  return docs
    .map((doc, index) => ({ doc, index }))
    .sort((a, b) => {
      const rank = DOC_CLASS_RANK[classifyDocType(a.doc.docType)] - DOC_CLASS_RANK[classifyDocType(b.doc.docType)];
      if (rank !== 0) return rank;
      const da = a.doc.docDate ?? "";
      const db = b.doc.docDate ?? "";
      if (da !== db) return da > db ? -1 : 1;
      return a.index - b.index;
    })
    .map(({ doc }) => doc);
}
