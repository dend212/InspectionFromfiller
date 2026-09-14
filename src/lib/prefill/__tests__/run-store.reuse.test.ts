/**
 * D7 (e2e): a second Find records must reuse an inspection's already-stored
 * permit document instead of downloading it again — the run-store lookup and
 * re-parent helpers behind that.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockLimit, mockUpdateWhere, mockSet, mockWhere } = vi.hoisted(() => ({
  mockLimit: vi.fn(),
  mockUpdateWhere: vi.fn(),
  mockSet: vi.fn(),
  mockWhere: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn((cond: unknown) => {
      mockWhere(cond);
      return selectChain;
    }),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn(() => mockLimit()),
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
      select: vi.fn(() => selectChain),
      update: vi.fn(() => updateChain),
    },
  };
});

import { PgDialect } from "drizzle-orm/pg-core";
import { findStoredRecordByIdentity, reuseRecordRow } from "@/lib/prefill/run-store";

beforeEach(() => {
  vi.clearAllMocks();
  mockLimit.mockResolvedValue([]);
  mockUpdateWhere.mockResolvedValue(undefined);
});

function lastWhere(): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(mockWhere.mock.calls.at(-1)?.[0]);
}

const identity = {
  source: "edms_env" as const,
  permitNumber: "OW-17-00474",
  docType: "PERMIT",
  docDate: "2018-02-08" as string | null,
};

describe("findStoredRecordByIdentity", () => {
  it("returns the newest stored row matching inspection + source + permit + doc type + doc date", async () => {
    mockLimit.mockResolvedValueOnce([{ id: "rec-old", storagePath: "records/insp-1/rec-old.pdf" }]);
    const row = await findStoredRecordByIdentity("insp-1", identity);
    expect(row).toEqual({ id: "rec-old", storagePath: "records/insp-1/rec-old.pdf" });
    const { sql, params } = lastWhere();
    expect(sql).toContain('"inspection_id" = ');
    expect(sql).toContain('"source" = ');
    expect(sql).toContain('"permit_number" = ');
    expect(sql).toContain('"doc_type" = ');
    expect(sql).toContain('"doc_date" = ');
    // never-stored rows (over 25 MB / failed download) have storage_path "" and must not be reused
    expect(sql).toContain('"storage_path" <> ');
    expect(params).toEqual(["insp-1", "edms_env", "OW-17-00474", "PERMIT", "2018-02-08", ""]);
  });

  it("matches a null doc date with IS NULL (never `= null`) and returns null when nothing matches", async () => {
    expect(await findStoredRecordByIdentity("insp-1", { ...identity, docDate: null })).toBeNull();
    const { sql, params } = lastWhere();
    expect(sql).toContain('"doc_date" is null');
    expect(params).toEqual(["insp-1", "edms_env", "OW-17-00474", "PERMIT", ""]);
  });

  it("never filters on extraction_version — the stored PDF is reused whatever its facts were read under", async () => {
    mockLimit.mockResolvedValueOnce([{ id: "rec-old", extractionStatus: "done", extractionVersion: null }]);
    const row = await findStoredRecordByIdentity("insp-1", identity);
    expect(row).toMatchObject({ id: "rec-old", extractionVersion: null });
    expect(lastWhere().sql).not.toContain("extraction_version");
  });
});

describe("reuseRecordRow", () => {
  it("re-parents the row onto the new run with the run's extraction status and re-selects it", async () => {
    await reuseRecordRow("rec-old", { runId: "run-2", extractionStatus: "pending", extractionError: null });
    expect(mockSet).toHaveBeenCalledWith({
      runId: "run-2",
      extractionStatus: "pending",
      extractionError: null,
      selected: true,
    });
    expect(mockUpdateWhere).toHaveBeenCalledTimes(1);
  });

  it("drops the facts and their version stamp when re-queueing a row read under an older extraction version", async () => {
    await reuseRecordRow("rec-old", {
      runId: "run-2",
      extractionStatus: "pending",
      extractionError: null,
      extracted: null,
      extractionVersion: null,
    });
    expect(mockSet).toHaveBeenCalledWith({
      runId: "run-2",
      extractionStatus: "pending",
      extractionError: null,
      extracted: null,
      extractionVersion: null,
      selected: true,
    });
  });
});
