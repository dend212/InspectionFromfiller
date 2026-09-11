import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockExecute, mockLimit, mockReturning, mockUpdateWhere, mockSet, mockValues } = vi.hoisted(
  () => ({
    mockExecute: vi.fn(),
    mockLimit: vi.fn(),
    mockReturning: vi.fn(),
    mockUpdateWhere: vi.fn(),
    mockSet: vi.fn(),
    mockValues: vi.fn(),
  }),
);

vi.mock("@/lib/db", () => {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn(() => mockLimit()),
  };
  const insertChain = {
    values: vi.fn((v: unknown) => {
      mockValues(v);
      return insertChain;
    }),
    returning: vi.fn(() => mockReturning()),
  };
  const updateChain = {
    set: vi.fn((v: unknown) => {
      mockSet(v);
      return updateChain;
    }),
    where: vi.fn(() => mockUpdateWhere()),
  };
  return {
    db: {
      execute: vi.fn((q: unknown) => mockExecute(q)),
      select: vi.fn(() => selectChain),
      insert: vi.fn(() => insertChain),
      update: vi.fn(() => updateChain),
    },
  };
});

import {
  countRunsInLastHour,
  createRecordRow,
  createRun,
  failStaleRuns,
  findActiveRun,
  listRecordRows,
  loadLatestRunRow,
  loadRunRow,
  markRunApplied,
  updateRun,
} from "@/lib/prefill/run-store";

beforeEach(() => {
  vi.clearAllMocks();
  mockExecute.mockResolvedValue([]);
  mockLimit.mockResolvedValue([]);
  mockReturning.mockResolvedValue([{ id: "run-1" }]);
  mockUpdateWhere.mockResolvedValue(undefined);
});

describe("run-store", () => {
  it("countRunsInLastHour reads the count column", async () => {
    mockExecute.mockResolvedValueOnce([{ n: 2 }]);
    expect(await countRunsInLastHour("insp-1")).toBe(2);
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it("countRunsInLastHour returns 0 for an empty result", async () => {
    expect(await countRunsInLastHour("insp-1")).toBe(0);
  });

  it("failStaleRuns issues one UPDATE", async () => {
    await failStaleRuns("insp-1");
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it("findActiveRun returns the row or null", async () => {
    expect(await findActiveRun("insp-1")).toBeNull();
    mockLimit.mockResolvedValueOnce([{ id: "run-9" }]);
    expect(await findActiveRun("insp-1")).toEqual({ id: "run-9" });
  });

  it("createRun inserts a queued row with empty stages and returns its id", async () => {
    const id = await createRun({
      inspectionId: "insp-1",
      trigger: "apn_lookup",
      input: { apn: "219-11-121" },
      createdBy: "user-1",
    });
    expect(id).toBe("run-1");
    expect(mockValues).toHaveBeenCalledWith({
      inspectionId: "insp-1",
      trigger: "apn_lookup",
      status: "queued",
      input: { apn: "219-11-121" },
      stages: {
        assessor: { status: "pending", links: [] },
        listing: { status: "pending", links: [] },
        permits: { status: "pending", links: [] },
      },
      createdBy: "user-1",
    });
  });

  it("loadRunRow / loadLatestRunRow return the first row or null", async () => {
    expect(await loadRunRow("run-1")).toBeNull();
    mockLimit.mockResolvedValueOnce([{ id: "run-1" }]);
    expect(await loadRunRow("run-1")).toEqual({ id: "run-1" });
    mockLimit.mockResolvedValueOnce([{ id: "run-2" }]);
    expect(await loadLatestRunRow("insp-1")).toEqual({ id: "run-2" });
  });

  it("updateRun and markRunApplied write through set()", async () => {
    await updateRun("run-1", { status: "done", error: null });
    expect(mockSet).toHaveBeenCalledWith({ status: "done", error: null });
    await markRunApplied("run-1");
    expect(mockSet).toHaveBeenLastCalledWith({ appliedAt: expect.any(Date) });
  });

  it("listRecordRows returns the rows", async () => {
    mockLimit.mockResolvedValueOnce([{ id: "rec-1" }]);
    expect(await listRecordRows("run-1")).toEqual([{ id: "rec-1" }]);
  });
});

describe("createRecordRow", () => {
  it("inserts the row and returns the new id", async () => {
    mockReturning.mockResolvedValueOnce([{ id: "rec-1" }]);
    const row = {
      inspectionId: "insp-1",
      runId: "run-1",
      source: "edms_env",
      permitNumber: "OW-17-00474",
      docType: "PERMIT",
      docDate: "2018-02-08",
      description: null,
      pageCount: 21,
      sizeBytes: 1968056,
      storagePath: "records/insp-1/rec-1.pdf",
      selected: true,
      extractionStatus: "pending",
      extractionError: null,
      extracted: null,
    };
    await expect(createRecordRow(row)).resolves.toBe("rec-1");
    expect(mockValues).toHaveBeenCalledWith(row);
  });
});
