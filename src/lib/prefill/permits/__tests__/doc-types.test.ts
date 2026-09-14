import { describe, expect, it } from "vitest";
import {
  DOC_CLASS_RANK,
  DOC_KIND_LABEL,
  classifyDocType,
  deriveEplpavDocType,
  isAbandonmentDocType,
  isExtractableDocType,
  isPermitClass,
  isTransferRecord,
  permitDocRank,
  rankForExtraction,
} from "../doc-types";

describe("classifyDocType", () => {
  it("maps legacy env doc types", () => {
    expect(classifyDocType("PERMIT")).toBe("permit");
    expect(classifyDocType("PERMIT SUB")).toBe("permit_sub");
    expect(classifyDocType("NOTICE OF TRANSFER")).toBe("notice_of_transfer");
    expect(classifyDocType("ABANDONMENT")).toBe("abandonment");
    expect(classifyDocType("PLAN REVIEW")).toBe("plan_review");
    expect(classifyDocType("SUB")).toBe("plan_review");
  });

  it("maps ePLPAV-derived types", () => {
    expect(classifyDocType("FINAL DA")).toBe("discharge_auth");
    expect(classifyDocType("Discharge Authorization")).toBe("discharge_auth");
    expect(classifyDocType("WELL")).toBe("other");
  });

  // A Discharge Authorization is its own class above the Approval to Construct (owner's precedence rule)
  it.each([
    ["DA", "discharge_auth"],
    ["DA FINAL", "discharge_auth"],
    ["OW-24-00070 FINAL DA", "discharge_auth"],
    ["PERMIT", "permit"],
  ])("%s → %s", (docType, cls) => {
    expect(classifyDocType(docType)).toBe(cls);
  });
});

describe("DOC_CLASS_RANK / isPermitClass", () => {
  it("ranks Discharge Authorization above Approval to Construct, then transfer, abandonment, plan review, other", () => {
    expect(DOC_CLASS_RANK.discharge_auth).toBeLessThan(DOC_CLASS_RANK.permit);
    expect(DOC_CLASS_RANK.permit).toBeLessThan(DOC_CLASS_RANK.permit_sub);
    expect(DOC_CLASS_RANK.permit_sub).toBeLessThan(DOC_CLASS_RANK.notice_of_transfer);
    expect(DOC_CLASS_RANK.notice_of_transfer).toBeLessThan(DOC_CLASS_RANK.abandonment);
    expect(DOC_CLASS_RANK.abandonment).toBeLessThan(DOC_CLASS_RANK.plan_review);
    expect(DOC_CLASS_RANK.plan_review).toBeLessThan(DOC_CLASS_RANK.other);
    expect(DOC_CLASS_RANK).toEqual({
      discharge_auth: 0,
      permit: 1,
      permit_sub: 2,
      notice_of_transfer: 3,
      abandonment: 4,
      plan_review: 5,
      other: 6,
    });
  });

  it("isPermitClass covers both the DA and the ATC classes and nothing else", () => {
    expect(isPermitClass("discharge_auth")).toBe(true);
    expect(isPermitClass("permit")).toBe(true);
    expect(isPermitClass("permit_sub")).toBe(false);
    expect(isPermitClass("notice_of_transfer")).toBe(false);
    expect(isPermitClass("abandonment")).toBe(false);
    expect(isPermitClass("plan_review")).toBe(false);
    expect(isPermitClass("other")).toBe(false);
  });
});

describe("permitDocRank", () => {
  // [model documentKind, EDMS docType, expected rank] — the model's verdict wins unless it is `other`
  it.each([
    ["discharge_authorization", "PERMIT", 0],
    ["final_da", "PERMIT", 0],
    ["approval_to_construct", "FINAL DA", 1],
    ["other", "FINAL DA", 0],
    ["other", "PERMIT", 1],
    ["notice_of_transfer", "PERMIT", 3],
    ["abandonment", "PERMIT", 4],
    ["other", "PLAN REVIEW", 5],
  ] as const)("(%s, %s) → %d", (kind, docType, rank) => {
    expect(permitDocRank(kind, docType)).toBe(rank);
  });
});

describe("DOC_KIND_LABEL / isTransferRecord", () => {
  it("names every model kind but `other` (the EDMS type stands in for that one)", () => {
    expect(DOC_KIND_LABEL).toEqual({
      approval_to_construct: "Approval to Construct",
      discharge_authorization: "Discharge Authorization",
      final_da: "Final Discharge Authorization",
      notice_of_transfer: "Notice of Transfer",
      abandonment: "Abandonment",
    });
  });

  it("isTransferRecord: the model's verdict, or the EDMS index only when the model could not tell", () => {
    expect(isTransferRecord("notice_of_transfer", "PERMIT")).toBe(true);
    expect(isTransferRecord("other", "NOTICE OF TRANSFER")).toBe(true);
    expect(isTransferRecord("other", "NOT")).toBe(true);
    expect(isTransferRecord("approval_to_construct", "NOTICE OF TRANSFER")).toBe(false);
    expect(isTransferRecord("other", "PERMIT")).toBe(false);
  });
});

describe("deriveEplpavDocType", () => {
  it("uses the File Name suffix for ONSITE PERMIT rows", () => {
    expect(deriveEplpavDocType("ONSITE PERMIT", "OW-24-00070 FINAL DA")).toBe("FINAL DA");
    expect(deriveEplpavDocType("ONSITE PERMIT", "OW-20-01479 DA FINAL")).toBe("FINAL DA");
    expect(deriveEplpavDocType("ONSITE PERMIT", "00964 DA")).toBe("FINAL DA");
    expect(deriveEplpavDocType("ONSITE PERMIT", "FINAL DA.PDF")).toBe("FINAL DA");
    expect(deriveEplpavDocType("ONSITE PERMIT", "")).toBe("PERMIT");
  });

  it("maps review subtypes", () => {
    expect(deriveEplpavDocType("NOTICE OF TRANSFER", "Notice of Transfer of Ownership OWR-24-02002")).toBe(
      "NOTICE OF TRANSFER",
    );
    expect(deriveEplpavDocType("ABANDONMENT", "OWR-22-01512 ABANDONMENT FINAL APPROVED")).toBe(
      "ABANDONMENT",
    );
    expect(deriveEplpavDocType("MINOR REVIEW/REMODEL", "")).toBe("PLAN REVIEW");
    expect(deriveEplpavDocType("PND REVIEW", "")).toBe("PLAN REVIEW");
    expect(deriveEplpavDocType("WELL", "")).toBe("WELL");
    expect(deriveEplpavDocType("", "")).toBe("OTHER");
  });
});

describe("isAbandonmentDocType / isExtractableDocType", () => {
  it("flags abandonment and excludes plan reviews from extraction", () => {
    expect(isAbandonmentDocType("ABANDONMENT")).toBe(true);
    expect(isAbandonmentDocType("PERMIT")).toBe(false);
    expect(isExtractableDocType("PERMIT")).toBe(true);
    expect(isExtractableDocType("NOTICE OF TRANSFER")).toBe(true);
    expect(isExtractableDocType("ABANDONMENT")).toBe(true);
    expect(isExtractableDocType("PLAN REVIEW")).toBe(false);
    expect(isExtractableDocType("WELL")).toBe(false);
  });
});

describe("rankForExtraction", () => {
  it("orders FINAL DA → PERMIT (newest first within a class) → PERMIT SUB → NOT → ABANDONMENT → PLAN REVIEW", () => {
    const docs = [
      { id: "plan", docType: "PLAN REVIEW", docDate: "2024-01-01" },
      { id: "not", docType: "NOTICE OF TRANSFER", docDate: "2022-09-21" },
      { id: "old-permit", docType: "PERMIT", docDate: "2015-09-11" },
      { id: "aband", docType: "ABANDONMENT", docDate: "2025-04-14" },
      { id: "sub", docType: "PERMIT SUB", docDate: "2019-01-01" },
      { id: "new-da", docType: "FINAL DA", docDate: "2025-11-21" },
      { id: "undated-permit", docType: "PERMIT" },
    ];
    expect(rankForExtraction(docs).map((d) => d.id)).toEqual([
      "new-da",
      "old-permit",
      "undated-permit",
      "sub",
      "not",
      "aband",
      "plan",
    ]);
  });

  it("puts an older FINAL DA before a newer PERMIT — class before date", () => {
    const docs = [
      { id: "new-permit", docType: "PERMIT", docDate: "2024-01-01" },
      { id: "old-da", docType: "FINAL DA", docDate: "2016-07-11" },
    ];
    expect(rankForExtraction(docs).map((d) => d.id)).toEqual(["old-da", "new-permit"]);
  });

  it("puts a same-date FINAL DA before the PERMIT whichever way they came in", () => {
    const permit = { id: "permit", docType: "PERMIT", docDate: "2016-07-11" };
    const da = { id: "da", docType: "FINAL DA", docDate: "2016-07-11" };
    expect(rankForExtraction([permit, da]).map((d) => d.id)).toEqual(["da", "permit"]);
    expect(rankForExtraction([da, permit]).map((d) => d.id)).toEqual(["da", "permit"]);
  });

  it("does not mutate the input", () => {
    const docs = [{ docType: "ABANDONMENT" }, { docType: "PERMIT" }];
    rankForExtraction(docs);
    expect(docs[0].docType).toBe("ABANDONMENT");
  });
});
