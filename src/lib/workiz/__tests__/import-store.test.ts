import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSelectWhere, mockSelectLimit, mockReturning, mockValues } = vi.hoisted(() => ({
  mockSelectWhere: vi.fn(),
  mockSelectLimit: vi.fn(),
  mockReturning: vi.fn(),
  mockValues: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  // where() is awaited directly (findInspectionsByWorkizIds) or followed by .limit() (profile lookup).
  // A real Promise with a `limit` property (not a hand-rolled thenable; Biome bans `then` keys).
  const whereResult = () =>
    Object.assign(Promise.resolve().then(() => mockSelectWhere()), { limit: mockSelectLimit });
  const selectChain = { from: vi.fn().mockReturnThis(), where: vi.fn(whereResult) };
  const insertChain = {
    values: vi.fn((v: unknown) => {
      mockValues(v);
      return insertChain;
    }),
    returning: mockReturning,
  };
  return { db: { select: vi.fn(() => selectChain), insert: vi.fn(() => insertChain) } };
});

vi.mock("@/lib/db/schema", () => ({
  inspections: { id: "id", inspectorId: "inspector_id", status: "status", workizJobId: "workiz_job_id" },
  profiles: { id: "profile_id", fullName: "full_name" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ op: "eq", col, val })),
  inArray: vi.fn((col: unknown, vals: unknown) => ({ op: "inArray", col, vals })),
}));

import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  findInspectionsByWorkizIds,
  firstNameOf,
  insertImportedInspection,
  loadProfileFullName,
} from "@/lib/workiz/import-store";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("findInspectionsByWorkizIds", () => {
  it("skips the query for no usable ids", async () => {
    expect(await findInspectionsByWorkizIds(["", null, undefined])).toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("queries workiz_job_id IN (de-duplicated ids)", async () => {
    mockSelectWhere.mockResolvedValue([{ id: "insp-1", inspectorId: "u1", status: "draft", workizJobId: "AB12CD" }]);
    const rows = await findInspectionsByWorkizIds(["AB12CD", "JOB-AbCdEfGhIjKlMnOp", "AB12CD", ""]);
    expect(inArray).toHaveBeenCalledWith("workiz_job_id", ["AB12CD", "JOB-AbCdEfGhIjKlMnOp"]);
    expect(rows).toEqual([{ id: "insp-1", inspectorId: "u1", status: "draft", workizJobId: "AB12CD" }]);
  });
});

describe("insertImportedInspection", () => {
  it("inserts the values and returns the new id", async () => {
    mockReturning.mockResolvedValue([{ id: "insp-new" }]);
    const values = {
      inspectorId: "user-1",
      status: "draft" as const,
      formData: {},
      fieldProvenance: {},
      facilityAddress: "100 E Example Rd",
      facilityCity: "Cave Creek",
      facilityZip: "85331",
      facilityCounty: null,
      facilityName: null,
      customerEmail: "test.client@example.com",
      customerName: null,
      workizJobId: "AB12CD",
      apn: null,
    };
    expect(await insertImportedInspection(values)).toBe("insp-new");
    expect(mockValues).toHaveBeenCalledWith(values);
  });
});

describe("loadProfileFullName / firstNameOf", () => {
  it("returns the profile's full name or null", async () => {
    mockSelectLimit.mockResolvedValueOnce([{ fullName: "Sam Sample" }]).mockResolvedValueOnce([]);
    expect(await loadProfileFullName("user-1")).toBe("Sam Sample");
    expect(await loadProfileFullName("user-2")).toBeNull();
  });

  it("firstNameOf takes the first token", () => {
    expect(firstNameOf("  Sam   Sample ")).toBe("Sam");
    expect(firstNameOf("")).toBeNull();
    expect(firstNameOf(null)).toBeNull();
  });
});
