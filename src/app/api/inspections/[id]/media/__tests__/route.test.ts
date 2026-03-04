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
  mockDbInsert,
  mockDbUpdate,
  mockDbDelete,
  mockCreateSignedUrl,
  mockStorageRemove,
} = vi.hoisted(() => {
  const mockGetUser = vi.fn();
  const mockGetSession = vi.fn();
  const mockDbSelect = vi.fn();
  const mockDbInsert = vi.fn();
  const mockDbUpdate = vi.fn();
  const mockDbDelete = vi.fn();
  const mockCreateSignedUrl = vi.fn();
  const mockStorageRemove = vi.fn();

  const mockCreateClient = vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
  });

  const mockCreateAdminClient = vi.fn().mockReturnValue({
    storage: {
      from: () => ({
        createSignedUrl: mockCreateSignedUrl,
        remove: mockStorageRemove,
      }),
    },
  });

  return {
    mockGetUser, mockGetSession, mockCreateClient, mockCreateAdminClient,
    mockDbSelect, mockDbInsert, mockDbUpdate, mockDbDelete,
    mockCreateSignedUrl, mockStorageRemove,
  };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));

// We need the select chain to return inspection first, then media records
let selectCallCount = 0;
vi.mock("@/lib/db", () => {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(() => mockDbSelect()),
    orderBy: vi.fn(() => mockDbSelect()),
  };
  const insertChain = {
    values: vi.fn().mockReturnThis(),
    returning: vi.fn(() => mockDbInsert()),
  };
  const updateChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn(() => mockDbUpdate()),
  };
  const deleteChain = {
    where: vi.fn(() => mockDbDelete()),
  };
  return {
    db: {
      select: vi.fn(() => selectChain),
      insert: vi.fn(() => insertChain),
      update: vi.fn(() => updateChain),
      delete: vi.fn(() => deleteChain),
    },
  };
});

vi.mock("@/lib/db/schema", () => ({
  inspections: { id: "id", inspectorId: "inspector_id" },
  inspectionMedia: { id: "id", inspectionId: "inspection_id", sortOrder: "sort_order", createdAt: "created_at" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ _col, val })),
  and: vi.fn((...args: unknown[]) => args),
  asc: vi.fn((col: unknown) => ({ col, dir: "asc" })),
}));

vi.mock("@/lib/supabase/auth-helpers", () => ({
  checkInspectionAccess: vi.fn().mockResolvedValue({ allowed: true, role: "field_tech" }),
}));

// ---------------------------------------------------------------------------
// Import handlers
// ---------------------------------------------------------------------------
import { DELETE, GET, PATCH, POST } from "../route";
import { checkInspectionAccess } from "@/lib/supabase/auth-helpers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeRequest(body?: unknown): Request {
  return new Request("http://localhost/api/inspections/insp-1/media", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

const USER = { id: "user-1" };
const INSPECTION = { inspectorId: "user-1" };

beforeEach(() => {
  vi.clearAllMocks();
  selectCallCount = 0;
  mockGetUser.mockResolvedValue({ data: { user: USER } });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: "fake.token.here" } },
  });
  mockDbSelect.mockResolvedValue([INSPECTION]);
  mockCreateSignedUrl.mockResolvedValue({ data: { signedUrl: "https://signed.url" } });
  mockStorageRemove.mockResolvedValue({ error: null });
  (checkInspectionAccess as ReturnType<typeof vi.fn>).mockResolvedValue({ allowed: true, role: "field_tech" });
});

// ===========================================================================
// POST /api/inspections/[id]/media
// ===========================================================================
describe("POST /api/inspections/[id]/media", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const res = await POST(makeRequest({ storagePath: "path", type: "photo" }), makeParams("insp-1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when inspection not found", async () => {
    mockDbSelect.mockResolvedValueOnce([]);
    const res = await POST(makeRequest({ storagePath: "path", type: "photo" }), makeParams("insp-1"));
    expect(res.status).toBe(404);
  });

  it("returns 403 when user has no access", async () => {
    (checkInspectionAccess as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ allowed: false, role: "field_tech" });
    const res = await POST(makeRequest({ storagePath: "path", type: "photo" }), makeParams("insp-1"));
    expect(res.status).toBe(403);
  });

  it("returns 400 when storagePath is missing", async () => {
    const res = await POST(makeRequest({ type: "photo" }), makeParams("insp-1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("storagePath and type are required");
  });

  it("returns 400 when type is missing", async () => {
    const res = await POST(makeRequest({ storagePath: "path" }), makeParams("insp-1"));
    expect(res.status).toBe(400);
  });

  it("creates media record and returns 201", async () => {
    const record = { id: "m1", type: "photo", storagePath: "path", label: null, sortOrder: 0, createdAt: new Date().toISOString() };
    mockDbInsert.mockResolvedValueOnce([record]);
    const res = await POST(makeRequest({ storagePath: "path", type: "photo", label: "Tank Photo" }), makeParams("insp-1"));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.id).toBe("m1");
    expect(json.signedUrl).toBe("https://signed.url");
  });

  it("does not create signed URL for video type", async () => {
    const record = { id: "m2", type: "video", storagePath: "path", label: null };
    mockDbInsert.mockResolvedValueOnce([record]);
    const res = await POST(makeRequest({ storagePath: "path", type: "video" }), makeParams("insp-1"));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.signedUrl).toBeNull();
  });
});

// ===========================================================================
// GET /api/inspections/[id]/media
// ===========================================================================
describe("GET /api/inspections/[id]/media", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const res = await GET(new Request("http://localhost"), makeParams("insp-1"));
    expect(res.status).toBe(401);
  });

  it("returns media records with signed URLs for photos", async () => {
    // First select call = inspection, second (via orderBy) = media records
    mockDbSelect
      .mockResolvedValueOnce([INSPECTION]) // verifyAccess
      .mockResolvedValueOnce([
        { id: "m1", type: "photo", storagePath: "p1", label: null, sortOrder: 0, createdAt: new Date() },
        { id: "m2", type: "video", storagePath: "v1", label: null, sortOrder: 1, createdAt: new Date() },
      ]);
    const res = await GET(new Request("http://localhost"), makeParams("insp-1"));
    expect(res.status).toBe(200);
  });

  it("returns empty array when no media exists", async () => {
    mockDbSelect
      .mockResolvedValueOnce([INSPECTION])
      .mockResolvedValueOnce([]);
    const res = await GET(new Request("http://localhost"), makeParams("insp-1"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual([]);
  });
});

// ===========================================================================
// PATCH /api/inspections/[id]/media
// ===========================================================================
describe("PATCH /api/inspections/[id]/media", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const res = await PATCH(makeRequest({ mediaId: "m1", label: "New Label" }), makeParams("insp-1"));
    expect(res.status).toBe(401);
  });

  it("returns 400 when mediaId is missing", async () => {
    const res = await PATCH(makeRequest({ label: "New Label" }), makeParams("insp-1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("mediaId and label are required");
  });

  it("returns 400 when label is not a string", async () => {
    const res = await PATCH(makeRequest({ mediaId: "m1", label: 123 }), makeParams("insp-1"));
    expect(res.status).toBe(400);
  });

  it("returns 404 when media record not found", async () => {
    mockDbUpdate.mockResolvedValueOnce([]);
    const res = await PATCH(makeRequest({ mediaId: "m1", label: "New" }), makeParams("insp-1"));
    expect(res.status).toBe(404);
  });

  it("updates media label and returns updated record", async () => {
    const updated = { id: "m1", label: "Updated Label" };
    mockDbUpdate.mockResolvedValueOnce([updated]);
    const res = await PATCH(makeRequest({ mediaId: "m1", label: "Updated Label" }), makeParams("insp-1"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.label).toBe("Updated Label");
  });
});

// ===========================================================================
// DELETE /api/inspections/[id]/media
// ===========================================================================
describe("DELETE /api/inspections/[id]/media", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const res = await DELETE(makeRequest({ mediaId: "m1" }), makeParams("insp-1"));
    expect(res.status).toBe(401);
  });

  it("returns 400 when mediaId is missing", async () => {
    const res = await DELETE(makeRequest({}), makeParams("insp-1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("mediaId is required");
  });

  it("returns 404 when media record not found", async () => {
    // verifyAccess select returns inspection, then media select returns empty
    mockDbSelect
      .mockResolvedValueOnce([INSPECTION]) // verifyAccess
      .mockResolvedValueOnce([]); // media lookup
    const res = await DELETE(makeRequest({ mediaId: "m1" }), makeParams("insp-1"));
    expect(res.status).toBe(404);
  });

  it("deletes media record and removes from storage", async () => {
    mockDbSelect
      .mockResolvedValueOnce([INSPECTION])
      .mockResolvedValueOnce([{ id: "m1", storagePath: "insp-1/photo/img.jpg" }]);
    const res = await DELETE(makeRequest({ mediaId: "m1" }), makeParams("insp-1"));
    expect(res.status).toBe(200);
    expect((await res.json()).deleted).toBe(true);
    expect(mockStorageRemove).toHaveBeenCalledWith(["insp-1/photo/img.jpg"]);
  });
});
