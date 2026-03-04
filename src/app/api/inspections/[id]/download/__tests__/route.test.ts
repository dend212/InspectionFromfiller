import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const {
  mockGetUser,
  mockGetSession,
  mockCreateClient,
  mockDbSelect,
  mockGetReportDownloadUrl,
  mockBuildDownloadFilename,
} = vi.hoisted(() => {
  const mockGetUser = vi.fn();
  const mockGetSession = vi.fn();
  const mockDbSelect = vi.fn();
  const mockGetReportDownloadUrl = vi.fn();
  const mockBuildDownloadFilename = vi.fn();

  const mockCreateClient = vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
  });

  return {
    mockGetUser, mockGetSession, mockCreateClient, mockDbSelect,
    mockGetReportDownloadUrl, mockBuildDownloadFilename,
  };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));

vi.mock("@/lib/db", () => {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(() => mockDbSelect()),
  };
  return {
    db: { select: vi.fn(() => selectChain) },
  };
});

vi.mock("@/lib/db/schema", () => ({
  inspections: { id: "id", inspectorId: "inspector_id" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ _col, val })),
}));

vi.mock("@/lib/supabase/auth-helpers", () => ({
  checkInspectionAccess: vi.fn().mockResolvedValue({ allowed: true, role: "admin" }),
}));

vi.mock("@/lib/storage/pdf-storage", () => ({
  getReportDownloadUrl: (...args: unknown[]) => mockGetReportDownloadUrl(...args),
  buildDownloadFilename: (...args: unknown[]) => mockBuildDownloadFilename(...args),
}));

// ---------------------------------------------------------------------------
// Import handler
// ---------------------------------------------------------------------------
import { GET } from "../route";
import { checkInspectionAccess } from "@/lib/supabase/auth-helpers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

const USER = { id: "user-1" };
const INSPECTION = {
  id: "insp-1",
  inspectorId: "user-1",
  finalizedPdfPath: "reports/insp-1/report.pdf",
  facilityAddress: "123 Main St",
  completedAt: new Date("2026-02-26"),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: USER } });
  mockDbSelect.mockResolvedValue([INSPECTION]);
  (checkInspectionAccess as ReturnType<typeof vi.fn>).mockResolvedValue({ allowed: true, role: "admin" });
  mockBuildDownloadFilename.mockReturnValue("123-Main-St_ADEQ_2026-02-26.pdf");
  mockGetReportDownloadUrl.mockResolvedValue("https://signed.download.url");
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("GET /api/inspections/[id]/download", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const res = await GET(new Request("http://localhost"), makeParams("insp-1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when inspection not found", async () => {
    mockDbSelect.mockResolvedValueOnce([]);
    const res = await GET(new Request("http://localhost"), makeParams("insp-1"));
    expect(res.status).toBe(404);
  });

  it("returns 403 when user has no access", async () => {
    (checkInspectionAccess as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ allowed: false, role: "field_tech" });
    const res = await GET(new Request("http://localhost"), makeParams("insp-1"));
    expect(res.status).toBe(403);
  });

  it("returns 404 when no finalized PDF exists", async () => {
    mockDbSelect.mockResolvedValueOnce([{ ...INSPECTION, finalizedPdfPath: null }]);
    const res = await GET(new Request("http://localhost"), makeParams("insp-1"));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain("No finalized PDF");
  });

  it("returns download URL and filename", async () => {
    const res = await GET(new Request("http://localhost"), makeParams("insp-1"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.downloadUrl).toBe("https://signed.download.url");
    expect(json.filename).toBe("123-Main-St_ADEQ_2026-02-26.pdf");
  });

  it("returns 500 when download URL generation fails", async () => {
    mockGetReportDownloadUrl.mockRejectedValueOnce(new Error("Storage error"));
    const res = await GET(new Request("http://localhost"), makeParams("insp-1"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("Download URL generation failed");
  });

  it("handles non-Error throws in download URL generation", async () => {
    mockGetReportDownloadUrl.mockRejectedValueOnce("string error");
    const res = await GET(new Request("http://localhost"), makeParams("insp-1"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("Unknown error");
  });
});
