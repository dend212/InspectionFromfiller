import { describe, expect, it } from "vitest";
import {
  classifyDocType,
  deriveEplpavDocType,
  isAbandonmentDocType,
  isExtractableDocType,
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
    expect(classifyDocType("FINAL DA")).toBe("permit");
    expect(classifyDocType("Discharge Authorization")).toBe("permit");
    expect(classifyDocType("WELL")).toBe("other");
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
  it("orders PERMIT/FINAL DA (newest first) → PERMIT SUB → NOT → ABANDONMENT → PLAN REVIEW", () => {
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

  it("does not mutate the input", () => {
    const docs = [{ docType: "ABANDONMENT" }, { docType: "PERMIT" }];
    rankForExtraction(docs);
    expect(docs[0].docType).toBe("ABANDONMENT");
  });
});
