import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetUser, mockGetUserRole, mockList, mockFind, mockLoadName } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockGetUserRole: vi.fn(),
  mockList: vi.fn(),
  mockFind: vi.fn(),
  mockLoadName: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({ auth: { getUser: mockGetUser } }),
}));
vi.mock("@/lib/supabase/auth-helpers", () => ({ getUserRole: mockGetUserRole }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/workiz/adeq-jobs", () => ({ listImportableAdeqJobs: mockList }));
vi.mock("@/lib/workiz/import-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workiz/import-store")>();
  return { ...actual, findInspectionsByWorkizIds: mockFind, loadProfileFullName: mockLoadName };
});

import { toJobSummary } from "@/lib/workiz/adeq";
import { WorkizError, type WorkizErrorCode } from "@/lib/workiz/client";
import { fixtures, job } from "@/lib/workiz/__tests__/fixtures/jobs";
import { workizJobSchema } from "@/lib/workiz/schema";
import { GET, maxDuration } from "../route";

const USER = { id: "user-1", email: "tech@example.com" };
const FETCHED_AT = Date.parse("2026-10-12T17:04:05.000Z");
const ROW_A = toJobSummary(job());
const ROW_B = toJobSummary(workizJobSchema.parse(fixtures.onlineBooking()));
const ROW_C = toJobSummary(workizJobSchema.parse(fixtures.unscheduled()));

const request = (query = "") => new Request(`http://localhost/api/workiz/jobs${query}`);

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: USER } });
  mockGetUserRole.mockResolvedValue("field_tech");
  mockList.mockResolvedValue({ rows: [ROW_A, ROW_B, ROW_C], fetchedAt: FETCHED_AT });
  mockFind.mockResolvedValue([]);
  mockLoadName.mockResolvedValue("Sam Sample");
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/workiz/jobs", () => {
  it("exports maxDuration 60", () => {
    expect(maxDuration).toBe(60);
  });

  it("401 when signed out", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await GET(request());
    expect(res.status).toBe(401);
    expect(mockList).not.toHaveBeenCalled();
  });

  it.each(["office_staff", null])("403 for role %s", async (role) => {
    mockGetUserRole.mockResolvedValue(role);
    expect((await GET(request())).status).toBe(403);
    expect(mockList).not.toHaveBeenCalled();
  });

  it("200 with summary rows, fetchedAt, role and currentUserFirstName — and no uuid", async () => {
    const res = await GET(request());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      jobs: [
        {
          id: "JOB-AbCdEfGhIjKlMnOp",
          serialId: 4696,
          street: "100 E Example Rd",
          city: "Cave Creek",
          scheduledDate: "2026-10-06",
          subStatus: "Job Complete - Reports Required",
          teamFirstNames: ["Alex", "Sam"],
          existing: null,
        },
        expect.objectContaining({ id: "JOB-OnlineBooking00001", existing: null }),
        expect.objectContaining({ id: "JOB-Unscheduled000001", scheduledDate: null }),
      ],
      fetchedAt: "2026-10-12T17:04:05.000Z",
      role: "field_tech",
      currentUserFirstName: "Sam",
    });
    expect(JSON.stringify(body)).not.toContain("AB12CD");
    expect(mockList).toHaveBeenCalledWith({ refresh: false });
  });

  it("includes truncated: true only when the listing was cut at the page cap", async () => {
    expect((await (await GET(request())).json()).truncated).toBeUndefined();
    mockList.mockResolvedValue({ rows: [ROW_A], fetchedAt: FETCHED_AT, truncated: true });
    expect((await (await GET(request())).json()).truncated).toBe(true);
  });

  it("looks existing inspections up by uuid ∪ JOB- id", async () => {
    await GET(request());
    const ids = mockFind.mock.calls[0][0] as string[];
    expect(ids).toEqual(expect.arrayContaining(["AB12CD", "JOB-AbCdEfGhIjKlMnOp", "OB12CD", "JOB-OnlineBooking00001"]));
  });

  it("existing: own → canOpen with id + status; another inspector's → exactly { canOpen: false }", async () => {
    mockFind.mockResolvedValue([
      { id: "insp-own", inspectorId: "user-1", status: "submitted", workizJobId: "AB12CD" },
      { id: "insp-other", inspectorId: "user-2", status: "draft", workizJobId: "JOB-OnlineBooking00001" },
    ]);
    const body = await (await GET(request())).json();
    expect(body.jobs[0].existing).toEqual({ canOpen: true, inspectionId: "insp-own", status: "submitted" });
    expect(body.jobs[1].existing).toEqual({ canOpen: false });
    expect(JSON.stringify(body)).not.toContain("insp-other");
  });

  it("admins can open anyone's import", async () => {
    mockGetUserRole.mockResolvedValue("admin");
    mockFind.mockResolvedValue([{ id: "insp-other", inspectorId: "user-2", status: "draft", workizJobId: "AB12CD" }]);
    const body = await (await GET(request())).json();
    expect(body.role).toBe("admin");
    expect(body.jobs[0].existing).toEqual({ canOpen: true, inspectionId: "insp-other", status: "draft" });
  });

  it("currentUserFirstName is null without a profile name", async () => {
    mockLoadName.mockResolvedValue(null);
    expect((await (await GET(request())).json()).currentUserFirstName).toBeNull();
  });

  it("refresh=1 asks for a refresh", async () => {
    await GET(request("?refresh=1"));
    expect(mockList).toHaveBeenCalledWith({ refresh: true });
  });

  it.each<[WorkizErrorCode, number, string]>([
    ["not_configured", 503, "workiz_not_configured"],
    ["auth_failed", 502, "workiz_auth_failed"],
    ["rate_limited", 503, "workiz_rate_limited"],
    ["unavailable", 502, "workiz_unavailable"],
    ["bad_response", 502, "workiz_bad_response"],
  ])("Workiz %s → %i %s", async (code, status, bodyCode) => {
    mockList.mockRejectedValue(new WorkizError(code));
    const res = await GET(request());
    expect(res.status).toBe(status);
    expect((await res.json()).code).toBe(bodyCode);
  });

  it("a DB error → 500 with a fixed message, logged through logDbError only", async () => {
    const err = Object.assign(new Error("Failed query: select … params: AB12CD"), { cause: { code: "08006" } });
    mockFind.mockRejectedValue(err);
    const res = await GET(request());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Something went wrong", code: "internal" });
    expect(errorSpy).toHaveBeenCalledWith(
      "[workiz-import] db error scope=jobs_existing_lookup job=- code=08006 constraint=-",
    );
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("Failed query");
  });
});
