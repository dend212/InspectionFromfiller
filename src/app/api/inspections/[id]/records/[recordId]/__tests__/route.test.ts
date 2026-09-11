import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks (same shape as the download route test)
// ---------------------------------------------------------------------------
const {
  mockGetUser,
  mockGetSession,
  mockCreateClient,
  mockSelectInspection,
  mockSelectRecord,
  mockGetRecordSignedUrl,
  mockWhere,
  state,
} = vi.hoisted(() => {
  const mockGetUser = vi.fn();
  const mockGetSession = vi.fn();
  const mockSelectInspection = vi.fn();
  const mockSelectRecord = vi.fn();
  const mockGetRecordSignedUrl = vi.fn();
  const mockWhere = vi.fn();
  const mockCreateClient = vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
  });
  return {
    mockGetUser,
    mockGetSession,
    mockCreateClient,
    mockSelectInspection,
    mockSelectRecord,
    mockGetRecordSignedUrl,
    mockWhere,
    state: { selectCall: 0 },
  };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));

// 1st select = inspection lookup, 2nd select = record lookup (both end in .limit(1)).
// `where` is a shared spy so a test can inspect exactly what each query was scoped by.
vi.mock("@/lib/db", () => {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: mockWhere.mockReturnThis(),
    limit: vi.fn(() => (++state.selectCall === 1 ? mockSelectInspection() : mockSelectRecord())),
  };
  return { db: { select: vi.fn(() => chain) } };
});

vi.mock("@/lib/db/schema", () => ({
  inspections: { id: "id", inspectorId: "inspector_id" },
  inspectionRecords: { id: "id", inspectionId: "inspection_id", storagePath: "storage_path" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ _col, val })),
  and: vi.fn((...conds: unknown[]) => ({ and: conds })),
}));

vi.mock("@/lib/supabase/auth-helpers", () => ({
  checkInspectionAccess: vi.fn().mockResolvedValue({ allowed: true, role: "admin" }),
}));

vi.mock("@/lib/storage/record-storage", () => ({
  RECORD_SIGNED_URL_TTL_SECONDS: 600,
  getRecordSignedUrl: (...args: unknown[]) => mockGetRecordSignedUrl(...args),
}));

// ---------------------------------------------------------------------------
// Import handler
// ---------------------------------------------------------------------------
import { and, eq } from "drizzle-orm";
import { inspectionRecords } from "@/lib/db/schema";
import { checkInspectionAccess } from "@/lib/supabase/auth-helpers";
import { GET } from "../route";

function makeParams(id: string, recordId: string) {
  return { params: Promise.resolve({ id, recordId }) };
}

const USER = { id: "user-1" };
const INSPECTION = { id: "insp-1", inspectorId: "user-1" };
const RECORD = { storagePath: "records/insp-1/rec-1.pdf" };

beforeEach(() => {
  vi.clearAllMocks();
  state.selectCall = 0;
  mockGetUser.mockResolvedValue({ data: { user: USER } });
  mockSelectInspection.mockResolvedValue([INSPECTION]);
  mockSelectRecord.mockResolvedValue([RECORD]);
  (checkInspectionAccess as ReturnType<typeof vi.fn>).mockResolvedValue({ allowed: true, role: "admin" });
  mockGetRecordSignedUrl.mockResolvedValue("https://storage.example/signed/rec-1.pdf?token=abc");
});

describe("GET /api/inspections/[id]/records/[recordId]", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const res = await GET(new Request("http://localhost"), makeParams("insp-1", "rec-1"));
    expect(res.status).toBe(401);
    expect(mockGetRecordSignedUrl).not.toHaveBeenCalled();
  });

  it("returns 404 when the inspection does not exist", async () => {
    mockSelectInspection.mockResolvedValueOnce([]);
    const res = await GET(new Request("http://localhost"), makeParams("insp-1", "rec-1"));
    expect(res.status).toBe(404);
  });

  it("returns 403 when the caller may not view the inspection (wrong-owner tech)", async () => {
    (checkInspectionAccess as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      allowed: false,
      role: "field_tech",
    });
    const res = await GET(new Request("http://localhost"), makeParams("insp-1", "rec-1"));
    expect(res.status).toBe(403);
    expect(mockGetRecordSignedUrl).not.toHaveBeenCalled();
  });

  it("returns 404 when the record is not found for this inspection", async () => {
    mockSelectRecord.mockResolvedValueOnce([]);
    const res = await GET(new Request("http://localhost"), makeParams("insp-1", "rec-other"));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Record not found");
  });

  it("returns 404 when the document was never stored (storage_path empty)", async () => {
    mockSelectRecord.mockResolvedValueOnce([{ storagePath: "" }]);
    const res = await GET(new Request("http://localhost"), makeParams("insp-1", "rec-1"));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Document was not stored");
    expect(mockGetRecordSignedUrl).not.toHaveBeenCalled();
  });

  it("302-redirects to a 600-second signed URL with no-store caching", async () => {
    const res = await GET(new Request("http://localhost"), makeParams("insp-1", "rec-1"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://storage.example/signed/rec-1.pdf?token=abc");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mockGetRecordSignedUrl).toHaveBeenCalledWith("records/insp-1/rec-1.pdf", 600);
  });

  it("scopes the record lookup to both the record id and the inspection id from the URL", async () => {
    await GET(new Request("http://localhost"), makeParams("insp-1", "rec-1"));
    // where() call 0 is the inspection lookup; call 1 is the record lookup. This fails
    // if a refactor ever drops the inspectionId clause, since the actual arg would then
    // be a bare eq() instead of and(eq(id), eq(inspectionId)).
    const recordWhereArg = mockWhere.mock.calls[1]?.[0];
    expect(recordWhereArg).toEqual(
      and(eq(inspectionRecords.id, "rec-1"), eq(inspectionRecords.inspectionId, "insp-1")),
    );
  });

  it("returns 500 when signing fails", async () => {
    mockGetRecordSignedUrl.mockRejectedValueOnce(new Error("Signed URL creation failed: boom"));
    const res = await GET(new Request("http://localhost"), makeParams("insp-1", "rec-1"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("Signed URL creation failed");
  });
});
