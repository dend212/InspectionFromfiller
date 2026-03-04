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
  mockCreateSignedUploadUrl,
} = vi.hoisted(() => {
  const mockGetUser = vi.fn();
  const mockGetSession = vi.fn();
  const mockDbSelect = vi.fn();
  const mockCreateSignedUploadUrl = vi.fn();

  const mockCreateClient = vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
  });

  const mockCreateAdminClient = vi.fn().mockReturnValue({
    storage: {
      from: () => ({ createSignedUploadUrl: mockCreateSignedUploadUrl }),
    },
  });

  return {
    mockGetUser, mockGetSession, mockCreateClient, mockCreateAdminClient,
    mockDbSelect, mockCreateSignedUploadUrl,
  };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));

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
  checkInspectionAccess: vi.fn().mockResolvedValue({ allowed: true, role: "field_tech" }),
}));

// ---------------------------------------------------------------------------
// Import handler
// ---------------------------------------------------------------------------
import { POST } from "../route";
import { checkInspectionAccess } from "@/lib/supabase/auth-helpers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeRequest(body?: unknown): Request {
  return new Request("http://localhost/api/inspections/insp-1/media/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

const USER = { id: "user-1" };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: USER } });
  mockDbSelect.mockResolvedValue([{ inspectorId: USER.id }]);
  (checkInspectionAccess as ReturnType<typeof vi.fn>).mockResolvedValue({ allowed: true, role: "field_tech" });
  mockCreateSignedUploadUrl.mockResolvedValue({
    data: { signedUrl: "https://upload.url", token: "tok123" },
    error: null,
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("POST /api/inspections/[id]/media/upload-url", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const res = await POST(makeRequest({ fileName: "photo.jpg", type: "photo" }), makeParams("insp-1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when inspection not found", async () => {
    mockDbSelect.mockResolvedValueOnce([]);
    const res = await POST(makeRequest({ fileName: "photo.jpg", type: "photo" }), makeParams("insp-1"));
    expect(res.status).toBe(404);
  });

  it("returns 403 when user has no access", async () => {
    (checkInspectionAccess as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ allowed: false, role: "field_tech" });
    const res = await POST(makeRequest({ fileName: "photo.jpg", type: "photo" }), makeParams("insp-1"));
    expect(res.status).toBe(403);
  });

  it("returns 400 when fileName is missing", async () => {
    const res = await POST(makeRequest({ type: "photo" }), makeParams("insp-1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("fileName and type are required");
  });

  it("returns 400 when type is missing", async () => {
    const res = await POST(makeRequest({ fileName: "photo.jpg" }), makeParams("insp-1"));
    expect(res.status).toBe(400);
  });

  it("returns signed upload URL successfully", async () => {
    const res = await POST(
      makeRequest({ fileName: "photo.jpg", type: "photo", label: "Tank Photo" }),
      makeParams("insp-1"),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.signedUrl).toBe("https://upload.url");
    expect(json.token).toBe("tok123");
    expect(json.storagePath).toContain("insp-1/");
    expect(json.storagePath).toContain(".jpg");
  });

  it("uses type as label when label not provided", async () => {
    const res = await POST(
      makeRequest({ fileName: "video.mp4", type: "video" }),
      makeParams("insp-1"),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.storagePath).toContain("video/");
  });

  it("returns 500 when signed URL creation fails", async () => {
    mockCreateSignedUploadUrl.mockResolvedValueOnce({
      data: null,
      error: { message: "Bucket not found" },
    });
    const res = await POST(
      makeRequest({ fileName: "photo.jpg", type: "photo" }),
      makeParams("insp-1"),
    );
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("Failed to create upload URL");
  });

  it("sanitizes file extension correctly", async () => {
    const res = await POST(
      makeRequest({ fileName: "MY_PHOTO.JPEG", type: "photo" }),
      makeParams("insp-1"),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.storagePath).toContain(".jpeg");
  });
});
