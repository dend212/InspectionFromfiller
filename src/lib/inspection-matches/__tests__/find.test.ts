import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindCandidates } = vi.hoisted(() => ({ mockFindCandidates: vi.fn() }));

vi.mock("@/lib/inspection-matches/store", () => ({ findMatchCandidates: mockFindCandidates }));

import { findPossibleDuplicates, findPossibleDuplicatesBatch } from "@/lib/inspection-matches/find";
import type { MatchViewer } from "@/lib/inspection-matches/match";
import { buildMatchQuery, type MatchQuery } from "@/lib/inspection-matches/normalize";
import type { MatchCandidateRow } from "@/lib/inspection-matches/store";
import type { InspectionMatchRequest } from "@/types/inspection-matches";

const ADMIN: MatchViewer = { userId: "admin-1", privileged: true };
const SELF = "6f1c2a9e-0000-4000-8000-000000000000";

function q(input: InspectionMatchRequest): MatchQuery {
  const query = buildMatchQuery(input);
  if (!query) throw new Error("expected a query");
  return query;
}

function stored(id: string, over: Partial<MatchCandidateRow> = {}): MatchCandidateRow {
  return {
    id,
    inspectorId: "admin-1",
    status: "completed",
    facilityAddress: "100 E Example Rd",
    facilityCity: "Cave Creek",
    facilityZip: "85331",
    apn: null,
    taxParcelNumber: "123-45-678",
    inspectionDate: "2026-10-06",
    createdAt: new Date("2026-10-06T19:12:00.000Z"),
    workizJobId: null,
    inspectorName: "Sam Sample",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFindCandidates.mockResolvedValue({ rows: [], capHit: false });
});

describe("findPossibleDuplicates", () => {
  it("passes the house number, APN key, excluded id and the 200-row cap", async () => {
    mockFindCandidates.mockResolvedValue({ rows: [stored("m1")], capHit: false });
    const result = await findPossibleDuplicates(
      q({ facilityAddress: "100 E Example Rd", facilityZip: "85331", taxParcelNumber: "123-45-678" }),
      ADMIN,
      { excludeInspectionId: SELF },
    );
    expect(mockFindCandidates).toHaveBeenCalledWith({
      houseNumbers: ["100"],
      apnKeys: ["12345678"],
      excludeInspectionId: SELF,
      limit: 200,
    });
    expect(result.matches.map((m) => m.inspectionId)).toEqual(["m1"]);
  });

  it("caps visible matches at 5 by default and reports the candidate cap", async () => {
    const rows = Array.from({ length: 7 }, (_, i) => stored(`m${i}`));
    mockFindCandidates.mockResolvedValue({ rows, capHit: false });
    const result = await findPossibleDuplicates(q({ taxParcelNumber: "123-45-678" }), ADMIN, { excludeInspectionId: SELF });
    expect(result.matches).toHaveLength(5);
    expect(result.truncated).toBe(true);
    mockFindCandidates.mockResolvedValue({ rows: [stored("m1")], capHit: true });
    expect((await findPossibleDuplicates(q({ taxParcelNumber: "123-45-678" }), ADMIN, { excludeInspectionId: SELF })).truncated).toBe(true);
  });
});

describe("findPossibleDuplicatesBatch", () => {
  const items = [
    { key: "JOB-A", query: q({ facilityAddress: "100 E Example Rd", facilityZip: "85331" }), excludeWorkizJobIds: ["AA11", "JOB-A"] },
    { key: "JOB-B", query: q({ facilityAddress: "200 W Sample St", taxParcelNumber: "123-45-679" }), excludeWorkizJobIds: ["BB22", "JOB-B"] },
    { key: "JOB-C", query: null, excludeWorkizJobIds: ["JOB-C"] },
  ];

  it("makes ONE store call with the union of house numbers and APN keys, then splits rows per item", async () => {
    mockFindCandidates.mockResolvedValue({
      rows: [
        stored("a-match"),
        stored("a-own-import", { workizJobId: "AA11" }),
        stored("b-match", { facilityAddress: "9 N Other Ave", taxParcelNumber: "123-45-679" }),
      ],
      capHit: false,
    });
    const results = await findPossibleDuplicatesBatch(items, ADMIN, { limit: 3 });
    expect(mockFindCandidates).toHaveBeenCalledTimes(1);
    expect(mockFindCandidates).toHaveBeenCalledWith({ houseNumbers: ["100", "200"], apnKeys: ["12345679"], limit: 500 });
    expect(results.get("JOB-A")?.matches.map((m) => m.inspectionId)).toEqual(["a-match"]);
    expect(results.get("JOB-B")?.matches.map((m) => m.inspectionId)).toEqual(["b-match"]);
    expect(results.get("JOB-C")).toEqual({ matches: [], hiddenCount: 0, truncated: false });
  });

  it("no store call when no item has a query", async () => {
    const results = await findPossibleDuplicatesBatch([items[2]], ADMIN);
    expect(mockFindCandidates).not.toHaveBeenCalled();
    expect(results.get("JOB-C")?.matches).toEqual([]);
  });

  it("batch overflow: one store call per item with a query; truncated comes from each item's own call", async () => {
    mockFindCandidates
      .mockResolvedValueOnce({ rows: [], capHit: true })
      .mockResolvedValueOnce({ rows: [stored("a-match")], capHit: false })
      .mockResolvedValueOnce({ rows: [stored("b-match", { taxParcelNumber: "123-45-679" })], capHit: true });
    const results = await findPossibleDuplicatesBatch(items, ADMIN, { limit: 3 });
    expect(mockFindCandidates).toHaveBeenCalledTimes(3);
    expect(mockFindCandidates).toHaveBeenNthCalledWith(2, { houseNumbers: ["100"], apnKeys: [], limit: 200 });
    expect(mockFindCandidates).toHaveBeenNthCalledWith(3, { houseNumbers: ["200"], apnKeys: ["12345679"], limit: 200 });
    expect(results.get("JOB-A")).toMatchObject({ truncated: false });
    expect(results.get("JOB-A")?.matches.map((m) => m.inspectionId)).toEqual(["a-match"]);
    expect(results.get("JOB-B")).toMatchObject({ truncated: true });
  });
});
