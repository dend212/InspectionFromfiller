import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockLoadRunRow, mockLoadLatestRunRow, mockListRecordRows } = vi.hoisted(() => ({
  mockLoadRunRow: vi.fn(),
  mockLoadLatestRunRow: vi.fn(),
  mockListRecordRows: vi.fn(),
}));

vi.mock("@/lib/prefill/run-store", () => ({
  loadRunRow: mockLoadRunRow,
  loadLatestRunRow: mockLoadLatestRunRow,
  listRecordRows: mockListRecordRows,
}));

import { emptyPermitFacts } from "@/lib/ai/permit-extraction-schema";
import type { PermitFacts } from "@/lib/ai/permit-extraction-schema";
import type { InspectionRecordRow, PrefillRunRow } from "@/lib/prefill/run-store";
import {
  isAbandonmentDocType,
  loadLatestRunDTO,
  loadLatestRunDTOForDraft,
  loadRunDTO,
  toInspectionRecordDTO,
  toPrefillRunDTO,
} from "@/lib/prefill/run-dto";

const RUN: PrefillRunRow = {
  id: "run-1",
  inspectionId: "insp-1",
  trigger: "manual",
  status: "done",
  input: { apn: "219-11-121" },
  stages: { assessor: { status: "done", summary: "Parcel 219-11-121", links: [] } },
  proposals: [],
  candidates: [],
  error: null,
  appliedAt: null,
  createdBy: "user-1",
  createdAt: new Date("2026-09-11T10:00:00.000Z"),
  finishedAt: new Date("2026-09-11T10:00:05.000Z"),
};

const RECORD: InspectionRecordRow = {
  id: "rec-1",
  inspectionId: "insp-1",
  runId: "run-1",
  source: "edms_env",
  permitNumber: "OW-17-00474",
  docType: "ABANDONMENT",
  docDate: "2019-03-04",
  description: null,
  pageCount: 3,
  sizeBytes: 12345,
  storagePath: "records/insp-1/rec-1.pdf",
  selected: true,
  extractionStatus: "pending",
  extractionError: null,
  extracted: null,
  extractionVersion: null,
  createdAt: new Date("2026-09-11T10:00:03.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockListRecordRows.mockResolvedValue([]);
});

describe("toPrefillRunDTO", () => {
  it("serialises dates, fills missing stages and maps records", () => {
    const dto = toPrefillRunDTO(RUN, [RECORD]);
    expect(dto).toMatchObject({
      id: "run-1",
      inspectionId: "insp-1",
      trigger: "manual",
      status: "done",
      input: { apn: "219-11-121" },
      error: null,
      appliedAt: null,
      createdAt: "2026-09-11T10:00:00.000Z",
      finishedAt: "2026-09-11T10:00:05.000Z",
    });
    expect(dto.stages.assessor.status).toBe("done");
    expect(dto.stages.listing).toEqual({ status: "pending", links: [] });
    expect(dto.stages.permits).toEqual({ status: "pending", links: [] });
    expect(dto.records).toHaveLength(1);
  });

  it("tolerates a queued row whose jsonb columns are still defaults", () => {
    const dto = toPrefillRunDTO({ ...RUN, status: "queued", stages: {}, input: {}, finishedAt: null }, []);
    expect(dto.stages.assessor).toEqual({ status: "pending", links: [] });
    expect(dto.finishedAt).toBeNull();
    expect(dto.proposals).toEqual([]);
    expect(dto.candidates).toEqual([]);
  });
});

describe("toPrefillRunDTO — record precedence", () => {
  const f = (value: string) => ({ value, confidence: 0.9, page: 1, evidence: `ev:${value}`, handwritten: false });
  const facts = (over: Partial<PermitFacts>): PermitFacts => ({ ...emptyPermitFacts(), ...over });
  /** Unread PERMIT row by default; `createdAt` = insertion (extraction / replay) order */
  const row = (over: Partial<InspectionRecordRow> & { id: string; at: number }): InspectionRecordRow => {
    const { at, ...rest } = over;
    return {
      ...RECORD,
      docType: "PERMIT",
      docDate: null,
      extracted: null,
      createdAt: new Date(`2026-09-11T10:00:0${at}.000Z`),
      ...rest,
    };
  };
  const ids = (records: InspectionRecordRow[]) => toPrefillRunDTO(RUN, records).records.map((r) => r.id);

  it("orders DA → ATC → NOT → abandonment by the kind the model read, not by createdAt", () => {
    // DB order (createdAt asc) is the extraction order — the abandonment was stored first, the DA last
    const records = [
      row({ id: "aband", at: 1, docType: "ABANDONMENT", docDate: "2015-11-02", extracted: facts({ documentKind: "abandonment", isAbandonment: true }) }),
      row({ id: "not", at: 2, docType: "NOTICE OF TRANSFER", docDate: "2020-10-27", extracted: facts({ documentKind: "notice_of_transfer" }) }),
      row({ id: "atc", at: 3, docType: "PERMIT", docDate: "2015-09-11", extracted: facts({ documentKind: "approval_to_construct", issueDate: f("1975-06-12") }) }),
      // Filed under PERMIT in EDMS — the model's verdict, not the index type, puts it on top
      row({ id: "da", at: 4, docType: "PERMIT", docDate: "2016-01-25", extracted: facts({ documentKind: "discharge_authorization", issueDate: f("2016-01-25") }) }),
    ];
    const dto = toPrefillRunDTO(RUN, records);
    expect(dto.records.map((r) => r.id)).toEqual(["da", "atc", "not", "aband"]);
    expect(dto.records.map((r) => r.documentKind)).toEqual([
      "discharge_authorization",
      "approval_to_construct",
      "notice_of_transfer",
      "abandonment",
    ]);
  });

  it("puts the newest DA first by the issue date the model read; an unread DA (no issue date) sorts last in its class", () => {
    // EDMS docDate is the scan / filing date, never the issue date — it must not order permit-class rows
    const records = [
      row({ id: "da-2016", at: 1, docType: "FINAL DA", docDate: "2026-01-01", extracted: facts({ documentKind: "final_da", issueDate: f("2016-01-25") }) }),
      row({ id: "da-unread", at: 2, docType: "FINAL DA", docDate: "2027-01-01" }),
      row({ id: "da-2024", at: 3, docType: "FINAL DA", docDate: "2016-01-01", extracted: facts({ documentKind: "discharge_authorization", issueDate: f("2024-03-02") }) }),
      row({ id: "atc", at: 4, docType: "PERMIT", extracted: facts({ documentKind: "approval_to_construct", issueDate: f("2015-06-01") }) }),
    ];
    expect(ids(records)).toEqual(["da-2024", "da-2016", "da-unread", "atc"]);
  });

  it("dates transfers by the EDMS docDate and sorts an unread row after dated siblings by its EDMS class", () => {
    const records = [
      // Unread PERMIT: EDMS class permit, undated — after the dated ATC even though its docDate is newer
      row({ id: "unread-permit", at: 1, docType: "PERMIT", docDate: "2025-01-01" }),
      // A transfer is dated by the index, not by whatever date the model read off it
      row({ id: "not-2020", at: 2, docType: "NOTICE OF TRANSFER", docDate: "2020-10-27", extracted: facts({ documentKind: "notice_of_transfer", issueDate: f("2024-01-01") }) }),
      row({ id: "not-2022", at: 3, docType: "NOTICE OF TRANSFER", docDate: "2022-03-28" }),
      row({ id: "atc-1975", at: 4, docType: "PERMIT", docDate: "2015-09-11", extracted: facts({ documentKind: "approval_to_construct", issueDate: f("1975-06-12") }) }),
    ];
    const dto = toPrefillRunDTO(RUN, records);
    expect(dto.records.map((r) => r.id)).toEqual(["atc-1975", "unread-permit", "not-2022", "not-2020"]);
    expect(dto.records.find((r) => r.id === "unread-permit")?.documentKind).toBeNull();
    expect(dto.records.find((r) => r.id === "not-2022")?.documentKind).toBeNull();
  });

  it("falls back to createdAt (DB order) for rows nothing else separates", () => {
    const records = [
      row({ id: "second", at: 2 }),
      row({ id: "first", at: 1 }),
      row({ id: "third", at: 3 }),
    ];
    expect(ids(records)).toEqual(["first", "second", "third"]);
  });
});

describe("toInspectionRecordDTO", () => {
  it("builds the auth-gated download URL and flags abandonment documents", () => {
    const dto = toInspectionRecordDTO(RECORD);
    expect(dto.downloadUrl).toBe("/api/inspections/insp-1/records/rec-1");
    expect(dto.isAbandonment).toBe(true);
    expect(dto.docDate).toBe("2019-03-04");
    expect(dto).not.toHaveProperty("storagePath");
  });

  it("isAbandonmentDocType is case-insensitive", () => {
    expect(isAbandonmentDocType("Abandonment")).toBe(true);
    expect(isAbandonmentDocType("PERMIT")).toBe(false);
  });
});

describe("loadRunDTO / loadLatestRunDTO", () => {
  it("returns null when the run does not exist", async () => {
    mockLoadRunRow.mockResolvedValueOnce(null);
    expect(await loadRunDTO("nope")).toBeNull();
    mockLoadLatestRunRow.mockResolvedValueOnce(null);
    expect(await loadLatestRunDTO("insp-1")).toBeNull();
  });

  it("joins the records for the run", async () => {
    mockLoadRunRow.mockResolvedValueOnce(RUN);
    mockListRecordRows.mockResolvedValueOnce([RECORD]);
    const dto = await loadRunDTO("run-1");
    expect(mockListRecordRows).toHaveBeenCalledWith("run-1");
    expect(dto?.records[0].id).toBe("rec-1");
    mockLoadLatestRunRow.mockResolvedValueOnce(RUN);
    const latest = await loadLatestRunDTO("insp-1");
    expect(latest?.id).toBe("run-1");
  });
});

describe("loadLatestRunDTOForDraft", () => {
  it("skips the query entirely for a non-draft inspection", async () => {
    const result = await loadLatestRunDTOForDraft("insp-1", "submitted");
    expect(result).toBeNull();
    expect(mockLoadLatestRunRow).not.toHaveBeenCalled();
  });

  it("loads the latest run for a draft inspection", async () => {
    mockLoadLatestRunRow.mockResolvedValueOnce(RUN);
    const result = await loadLatestRunDTOForDraft("insp-1", "draft");
    expect(result?.id).toBe("run-1");
  });

  it("swallows a DB error and returns null instead of throwing", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockLoadLatestRunRow.mockRejectedValueOnce(new Error("connection reset"));
    const result = await loadLatestRunDTOForDraft("insp-1", "draft");
    expect(result).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[prefill] latest run load failed",
      expect.any(Error),
    );
    consoleErrorSpy.mockRestore();
  });
});
