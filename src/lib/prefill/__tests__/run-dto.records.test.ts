import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prefill/run-store", () => ({
  listRecordRows: vi.fn(),
  loadLatestRunRow: vi.fn(),
  loadRunRow: vi.fn(),
}));

import { isAbandonmentDocType, toInspectionRecordDTO } from "@/lib/prefill/run-dto";
import type { InspectionRecordRow } from "@/lib/prefill/run-store";

const ROW: InspectionRecordRow = {
  id: "rec-1",
  inspectionId: "insp-1",
  runId: "run-1",
  source: "edms_env",
  permitNumber: "OWR-22-01512",
  docType: "ABANDONMENT",
  docDate: "2025-04-14",
  description: null,
  pageCount: 4,
  sizeBytes: 255378,
  storagePath: "records/insp-1/rec-1.pdf",
  selected: true,
  extractionStatus: "pending",
  extractionError: null,
  extracted: null,
  extractionVersion: null,
  createdAt: new Date("2026-09-11T10:00:03.000Z"),
};

describe("toInspectionRecordDTO (phase 2)", () => {
  it("links stored documents and flags abandonment from the doc type", () => {
    expect(toInspectionRecordDTO(ROW)).toEqual({
      id: "rec-1",
      source: "edms_env",
      permitNumber: "OWR-22-01512",
      docType: "ABANDONMENT",
      docDate: "2025-04-14",
      description: null,
      pageCount: 4,
      sizeBytes: 255378,
      selected: true,
      extractionStatus: "pending",
      extractionError: null,
      isAbandonment: true,
      documentKind: null,
      downloadUrl: "/api/inspections/insp-1/records/rec-1",
    });
  });

  it("leaves downloadUrl empty for a record that was never stored", () => {
    const dto = toInspectionRecordDTO({
      ...ROW,
      storagePath: "",
      pageCount: null,
      extractionStatus: "skipped",
      extractionError: "Larger than 25 MB (25.0 MB) — open it on Maricopa EDMS",
    });
    expect(dto.downloadUrl).toBe("");
    expect(dto.extractionError).toContain("Larger than 25 MB");
  });

  it("isAbandonmentDocType comes from permits/doc-types (shared vocabulary)", () => {
    expect(isAbandonmentDocType("abandonment")).toBe(true);
    expect(isAbandonmentDocType("NOTICE OF TRANSFER")).toBe(false);
  });

  it("flags abandonment from the extracted facts even when the EDMS type is PERMIT", async () => {
    const { emptyPermitFacts } = await import("@/lib/ai/permit-extraction-schema");
    const dto = toInspectionRecordDTO({
      ...ROW,
      docType: "PERMIT",
      extractionStatus: "done",
      extracted: { ...emptyPermitFacts(), isAbandonment: true },
    });
    expect(dto.isAbandonment).toBe(true);
    expect(toInspectionRecordDTO({ ...ROW, docType: "PERMIT" }).isAbandonment).toBe(false);
  });

  it("exposes the kind the model read (null until the document is read)", async () => {
    const { emptyPermitFacts } = await import("@/lib/ai/permit-extraction-schema");
    expect(toInspectionRecordDTO(ROW).documentKind).toBeNull();
    expect(
      toInspectionRecordDTO({
        ...ROW,
        docType: "PERMIT",
        extractionStatus: "done",
        extracted: { ...emptyPermitFacts(), documentKind: "discharge_authorization" },
      }).documentKind,
    ).toBe("discharge_authorization");
  });
});
