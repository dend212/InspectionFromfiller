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

import type { InspectionRecordRow, PrefillRunRow } from "@/lib/prefill/run-store";
import {
  isAbandonmentDocType,
  loadLatestRunDTO,
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
