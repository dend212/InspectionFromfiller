import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRows, mockSelect } = vi.hoisted(() => ({ mockRows: vi.fn(), mockSelect: vi.fn() }));

// The mocked executor: select().from().leftJoin().where().orderBy().limit() → rows
vi.mock("@/lib/db", () => {
  const chain = {
    from: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => mockRows()),
  };
  mockSelect.mockImplementation(() => chain);
  return { db: { select: mockSelect } };
});

import { inspections } from "@/lib/db/schema";
import {
  CANDIDATE_FIELDS,
  candidateQuery,
  findMatchCandidates,
  type MatchCandidateRow,
} from "@/lib/inspection-matches/store";

// A real Drizzle instance over a client that never connects: only .toSQL() is used
const offlineDb = drizzle(postgres("postgres://user:pass@127.0.0.1:1/none", { prepare: false }));
const EXCLUDE = "6f1c2a9e-0000-4000-8000-000000000001";

const toSql = (args: Parameters<typeof candidateQuery>[1]) => {
  const query = candidateQuery(offlineDb, args);
  if (!query) throw new Error("expected a query");
  return query.toSQL();
};

function row(id: string): MatchCandidateRow {
  return {
    id,
    inspectorId: "user-1",
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
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("candidateQuery SQL", () => {
  it("renders the three prefilter expressions, the exclusion, ORDER BY … DESC and LIMIT limit+1 — values only in params", () => {
    const { sql, params } = toSql({
      houseNumbers: ["100", "2040"],
      apnKeys: ["12345678"],
      excludeInspectionId: EXCLUDE,
      limit: 200,
    });
    expect(sql).toContain(`substring("inspections"."facility_address" from '^[[:space:]]*([0-9]{1,8})[[:space:]]')`);
    expect(sql).toContain(`upper(regexp_replace(coalesce("inspections"."apn", ''), '[^0-9A-Za-z]', '', 'g'))`);
    expect(sql).toContain(
      `upper(regexp_replace(coalesce("inspections"."form_data" -> 'facilityInfo' ->> 'taxParcelNumber', ''), '[^0-9A-Za-z]', '', 'g'))`,
    );
    expect(sql).toContain(`"inspections"."id" <> $`);
    expect(sql).toContain(`left join "profiles" on "profiles"."id" = "inspections"."inspector_id"`);
    expect(sql).toMatch(/order by "inspections"\."created_at" desc limit \$\d+$/);
    expect(params).toEqual(expect.arrayContaining([EXCLUDE, "100", "2040", "12345678", 201]));
    for (const value of [EXCLUDE, "2040", "12345678"]) expect(sql).not.toContain(value);
  });

  it("leaves out the APN branches without APN keys, and the address branch without house numbers", () => {
    const addressOnly = toSql({ houseNumbers: ["100"], apnKeys: [], limit: 5 }).sql;
    expect(addressOnly).toContain("substring(");
    expect(addressOnly).not.toContain("regexp_replace");
    expect(addressOnly).not.toContain("<>");
    const apnOnly = toSql({ houseNumbers: [], apnKeys: ["12345678"], limit: 5 }).sql;
    expect(apnOnly).not.toContain("substring(");
    expect(apnOnly.match(/regexp_replace/g)).toHaveLength(2);
  });

  it("returns null with nothing to match on", () => {
    expect(candidateQuery(offlineDb, { houseNumbers: [], apnKeys: [], limit: 5 })).toBeNull();
  });

  it("selects createdAt through the typed timestamp column, which maps to a UTC Date", () => {
    expect(CANDIDATE_FIELDS.createdAt).toBe(inspections.createdAt);
    const mapped = inspections.createdAt.mapFromDriverValue("2026-10-06 19:12:00");
    expect(mapped).toBeInstanceOf(Date);
    expect((mapped as Date).toISOString()).toBe("2026-10-06T19:12:00.000Z");
  });
});

describe("findMatchCandidates", () => {
  it("both lists empty → no query", async () => {
    expect(await findMatchCandidates({ houseNumbers: [], apnKeys: [], limit: 5 })).toEqual({ rows: [], capHit: false });
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("limit + 1 rows → capHit and the extra row dropped", async () => {
    mockRows.mockResolvedValue([row("a"), row("b"), row("c")]);
    const result = await findMatchCandidates({ houseNumbers: ["100"], apnKeys: [], limit: 2 });
    expect(result.capHit).toBe(true);
    expect(result.rows.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("exactly limit rows → not capped", async () => {
    mockRows.mockResolvedValue([row("a"), row("b")]);
    const result = await findMatchCandidates({ houseNumbers: ["100"], apnKeys: [], limit: 2 });
    expect(result).toEqual({ rows: [row("a"), row("b")], capHit: false });
  });
});
