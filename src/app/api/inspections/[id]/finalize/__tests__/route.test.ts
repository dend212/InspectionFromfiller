import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const {
  mockGetUser,
  mockGetSession,
  mockCreateClient,
  mockCreateAdminClient,
  mockDbSelect,
  mockDbSelectMedia,
  mockDbSelectProfile,
  mockDbUpdate,
  mockCreateSignedUrl,
  mockGenerateReport,
  mockUploadReport,
  mockBuildDownloadFilename,
} = vi.hoisted(() => {
  const mockGetUser = vi.fn();
  const mockGetSession = vi.fn();
  const mockDbSelect = vi.fn();
  const mockDbSelectMedia = vi.fn();
  const mockDbSelectProfile = vi.fn();
  const mockDbUpdate = vi.fn();
  const mockCreateSignedUrl = vi.fn();
  const mockGenerateReport = vi.fn();
  const mockUploadReport = vi.fn();
  const mockBuildDownloadFilename = vi.fn();

  const mockCreateClient = vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
  });

  const mockCreateAdminClient = vi.fn().mockReturnValue({
    storage: {
      from: () => ({ createSignedUrl: mockCreateSignedUrl }),
    },
  });

  return {
    mockGetUser, mockGetSession, mockCreateClient, mockCreateAdminClient,
    mockDbSelect, mockDbSelectMedia, mockDbSelectProfile, mockDbUpdate,
    mockCreateSignedUrl, mockGenerateReport, mockUploadReport, mockBuildDownloadFilename,
  };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));

// Track select call count to return different results for different queries
// The finalize route makes these select calls:
// 1. db.select().from(inspections).where(...).limit(1) -> inspection lookup
// 2. db.select().from(inspectionMedia).where(...) -> media rows (NO .limit())
// 3. db.select({...}).from(profiles).where(...).limit(1) -> signature lookup (conditional)
let selectCallCount = 0;
vi.mock("@/lib/db", () => {
  const makeSelectChain = () => {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    chain.from = vi.fn().mockImplementation(() => chain);
    chain.where = vi.fn().mockImplementation(() => {
      selectCallCount++;
      // 2nd call is the media query (no .limit() follows)
      if (selectCallCount === 2) return mockDbSelectMedia();
      return chain;
    });
    chain.limit = vi.fn().mockImplementation(() => {
      // If selectCallCount === 1, this is the inspection lookup
      // If selectCallCount === 3, this is the profile signature lookup
      if (selectCallCount === 1) return mockDbSelect();
      if (selectCallCount === 3) return mockDbSelectProfile();
      return mockDbSelect();
    });
    return chain;
  };
  const updateChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn(() => mockDbUpdate()),
  };
  return {
    db: {
      select: vi.fn(() => makeSelectChain()),
      update: vi.fn(() => updateChain),
    },
  };
});

vi.mock("@/lib/db/schema", () => ({
  inspections: { id: "id", inspectorId: "inspector_id", status: "status" },
  inspectionMedia: { id: "id", inspectionId: "inspection_id" },
  profiles: { id: "id", signatureDataUrl: "signature_data_url" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ _col, val })),
  and: vi.fn((...args: unknown[]) => args),
}));

vi.mock("@/lib/pdf/generate-report", () => ({
  generateReport: (...args: unknown[]) => mockGenerateReport(...args),
}));

vi.mock("@/lib/storage/pdf-storage", () => ({
  uploadReport: (...args: unknown[]) => mockUploadReport(...args),
  buildDownloadFilename: (...args: unknown[]) => mockBuildDownloadFilename(...args),
}));

vi.mock("@/components/inspection/media-gallery", () => ({}));

// ---------------------------------------------------------------------------
// Import handler
// ---------------------------------------------------------------------------
import { POST } from "../route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fakeAccessToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64");
  return `${header}.${body}.fakesig`;
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeRequest(body?: unknown): Request {
  return new Request("http://localhost/api/inspections/insp-1/finalize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

const USER = { id: "admin-1" };
const INSPECTION = {
  id: "insp-1",
  inspectorId: "tech-1",
  status: "in_review",
  formData: { facilityInfo: { facilityName: "Test" }, disposalWorks: {} },
  facilityAddress: "123 Main St",
  completedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  selectCallCount = 0;
  mockGetUser.mockResolvedValue({ data: { user: USER } });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: fakeAccessToken({ user_role: "admin" }) } },
  });
  mockDbSelect.mockResolvedValue([INSPECTION]);
  mockDbSelectMedia.mockResolvedValue([]);
  mockDbSelectProfile.mockResolvedValue([{ signatureDataUrl: null }]);
  mockDbUpdate.mockResolvedValue([{ id: "insp-1" }]);
  mockCreateSignedUrl.mockResolvedValue({ data: { signedUrl: "https://signed.url" } });
  mockGenerateReport.mockResolvedValue(new Uint8Array([1, 2, 3]));
  mockUploadReport.mockResolvedValue("reports/insp-1/report.pdf");
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("POST /api/inspections/[id]/finalize", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const res = await POST(makeRequest(), makeParams("insp-1"));
    expect(res.status).toBe(401);
  });

  it("returns 403 when user is field_tech (not admin)", async () => {
    mockGetSession.mockResolvedValueOnce({
      data: { session: { access_token: fakeAccessToken({ user_role: "field_tech" }) } },
    });
    const res = await POST(makeRequest(), makeParams("insp-1"));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("admin only");
  });

  it("returns 403 when user is office_staff (not admin)", async () => {
    mockGetSession.mockResolvedValueOnce({
      data: { session: { access_token: fakeAccessToken({ user_role: "office_staff" }) } },
    });
    const res = await POST(makeRequest(), makeParams("insp-1"));
    expect(res.status).toBe(403);
  });

  it("returns 404 when inspection not found", async () => {
    mockDbSelect.mockResolvedValueOnce([]);
    const res = await POST(makeRequest(), makeParams("insp-1"));
    expect(res.status).toBe(404);
  });

  it("returns 409 when inspection is not in_review", async () => {
    mockDbSelect.mockResolvedValueOnce([{ ...INSPECTION, status: "draft" }]);
    const res = await POST(makeRequest(), makeParams("insp-1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("not in review");
  });

  it("returns 400 when inspection has no form data", async () => {
    mockDbSelect.mockResolvedValueOnce([{ ...INSPECTION, formData: null }]);
    const res = await POST(makeRequest(), makeParams("insp-1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("no form data");
  });

  it("successfully finalizes an in_review inspection", async () => {
    const res = await POST(makeRequest(), makeParams("insp-1"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("completed");
    expect(json.pdfPath).toBe("reports/insp-1/report.pdf");
  });

  it("returns 500 when PDF generation fails", async () => {
    mockGenerateReport.mockRejectedValueOnce(new Error("Font not found"));
    const res = await POST(makeRequest(), makeParams("insp-1"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("PDF generation failed");
  });

  it("returns 500 when PDF upload fails", async () => {
    mockUploadReport.mockRejectedValueOnce(new Error("Storage unavailable"));
    const res = await POST(makeRequest(), makeParams("insp-1"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("PDF upload failed");
  });

  it("returns 409 when atomic transition fails (concurrent finalize)", async () => {
    mockDbUpdate.mockResolvedValueOnce([]); // concurrent update already transitioned
    const res = await POST(makeRequest(), makeParams("insp-1"));
    expect(res.status).toBe(409);
  });

  it("accepts selectedMediaIds to filter photos", async () => {
    mockDbSelectMedia.mockResolvedValueOnce([
      { id: "m1", type: "photo", storagePath: "path1", label: null, sortOrder: 0, createdAt: new Date() },
      { id: "m2", type: "photo", storagePath: "path2", label: null, sortOrder: 1, createdAt: new Date() },
    ]);
    const res = await POST(
      makeRequest({ selectedMediaIds: ["m1"] }),
      makeParams("insp-1"),
    );
    expect(res.status).toBe(200);
  });

  it("returns 403 when session decode fails", async () => {
    mockGetSession.mockResolvedValueOnce({
      data: { session: { access_token: "bad.token" } },
    });
    const res = await POST(makeRequest(), makeParams("insp-1"));
    expect(res.status).toBe(403);
  });
});
