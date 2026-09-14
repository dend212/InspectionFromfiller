/**
 * Document-type vocabulary across both EDMS archives and the extraction
 * ranking from spec §5.2 step 3.
 *
 * Legacy `env` rows carry `EnvSepticDocType` (PERMIT, PERMIT SUB, NOTICE OF
 * TRANSFER, ABANDONMENT, PLAN REVIEW, SUB). ePLPAV rows have no such column;
 * `deriveEplpavDocType` builds one from `Permit Subtype` + `File Name`
 * (686/1000 ONSITE PERMIT rows in the recording are "… FINAL DA", 277 have an
 * empty File Name).
 *
 * Owner's precedence rule (2026-09-14): the newest Discharge Authorization on
 * top, then the Approval to Construct, then Notices of Transfer and
 * abandonments — so a DA is its own class above `permit` (the ATC), and the
 * same scale orders extraction and the mapper's proposal authority.
 */
import type { PermitDocumentKind } from "@/lib/ai/permit-extraction-schema";

export type DocClass =
  | "discharge_auth"
  | "permit"
  | "permit_sub"
  | "notice_of_transfer"
  | "abandonment"
  | "plan_review"
  | "other";

/** Lower ranks are extracted first and outrank higher ones in dedupeProposals */
export const DOC_CLASS_RANK: Record<DocClass, number> = {
  discharge_auth: 0,
  permit: 1,
  permit_sub: 2,
  notice_of_transfer: 3,
  abandonment: 4,
  plan_review: 5,
  other: 6,
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
  if (t === "PERMIT") return "permit";
  if (t.includes("FINAL DA") || t.includes("DA FINAL") || t === "DA" || t.includes("DISCHARGE")) {
    return "discharge_auth";
  }
  return "other";
}

/** A Discharge Authorization or an Approval to Construct — the two classes that identify the permit itself */
export function isPermitClass(cls: DocClass): boolean {
  return cls === "discharge_auth" || cls === "permit";
}

/** What the inspector reads for the model's verdict; `other` has no label — the EDMS type stands in */
export const DOC_KIND_LABEL: Record<Exclude<PermitDocumentKind, "other">, string> = {
  approval_to_construct: "Approval to Construct",
  discharge_authorization: "Discharge Authorization",
  final_da: "Final Discharge Authorization",
  notice_of_transfer: "Notice of Transfer",
  abandonment: "Abandonment",
};

/** A Notice of Transfer by the model's verdict, or by the EDMS index when the model could not tell */
export function isTransferRecord(kind: PermitDocumentKind, docType: string): boolean {
  return kind === "notice_of_transfer" || (kind === "other" && classifyDocType(docType) === "notice_of_transfer");
}

export function isAbandonmentDocType(docType: string): boolean {
  return classifyDocType(docType) === "abandonment";
}

/**
 * Authority of a record's facts: what the model read outranks the EDMS index — a document the
 * model classed `other` falls back to its EDMS type. Lower wins (DOC_CLASS_RANK scale).
 */
export function permitDocRank(kind: PermitDocumentKind, docType: string): number {
  switch (kind) {
    case "discharge_authorization":
    case "final_da":
      return DOC_CLASS_RANK.discharge_auth;
    case "approval_to_construct":
      return DOC_CLASS_RANK.permit;
    case "notice_of_transfer":
      return DOC_CLASS_RANK.notice_of_transfer;
    case "abandonment":
      return DOC_CLASS_RANK.abandonment;
    default:
      return DOC_CLASS_RANK[classifyDocType(docType)];
  }
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

/**
 * Stable: class rank ascending (DA → PERMIT → PERMIT SUB → NOT → ABANDONMENT → …), then
 * docDate descending within a class (undated last). An older FINAL DA therefore sorts
 * before a newer PERMIT. Returns a copy.
 */
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
