import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const {
  mockGetUser,
  mockGetSession,
  mockCreateClient,
  mockDbSelect,
  mockDbUpdate,
  mockDbDelete,
} = vi.hoisted(() => {
  const mockGetUser = vi.fn();
  const mockGetSession = vi.fn();
  const mockDbSelect = vi.fn();
  const mockDbUpdate = vi.fn();
  const mockDbDelete = vi.fn();

  const mockCreateClient = vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
  });

  return { mockGetUser, mockGetSession, mockCreateClient, mockDbSelect, mockDbUpdate, mockDbDelete };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));

vi.mock("@/lib/db", () => {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(() => mockDbSelect()),
  };
  const updateChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn(() => mockDbUpdate()),
  };
  const deleteChain = {
    where: vi.fn(() => mockDbDelete()),
  };
  return {
    db: {
      select: vi.fn(() => selectChain),
      update: vi.fn(() => updateChain),
      delete: vi.fn(() => deleteChain),
    },
  };
});

vi.mock("@/lib/db/schema", () => ({
  inspections: {
    id: "id",
    inspectorId: "inspector_id",
    status: "status",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ _col, val })),
  and: vi.fn((...args: unknown[]) => args),
}));

// ---------------------------------------------------------------------------
// Import handlers
// ---------------------------------------------------------------------------
import { DELETE, GET, PATCH } from "../route";

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
  return new Request("http://localhost/api/inspections/test-id", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const USER = { id: "user-1", email: "tech@example.com" };
const INSPECTION = {
  id: "insp-1",
  inspectorId: "user-1",
  status: "draft",
  formData: {},
  facilityName: "Test Facility",
};

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: USER } });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: fakeAccessToken({ user_role: "field_tech" }) } },
  });
  mockDbSelect.mockResolvedValue([INSPECTION]);
  mockDbUpdate.mockResolvedValue(undefined);
  mockDbDelete.mockResolvedValue(undefined);
});

// ===========================================================================
// GET /api/inspections/[id]
// ===========================================================================
describe("GET /api/inspections/[id]", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const res = await GET(new Request("http://localhost"), makeParams("insp-1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when inspection not found", async () => {
    mockDbSelect.mockResolvedValueOnce([]);
    const res = await GET(new Request("http://localhost"), makeParams("nonexistent"));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Inspection not found");
  });

  it("returns the inspection for the owner", async () => {
    mockDbSelect.mockResolvedValueOnce([INSPECTION]);
    const res = await GET(new Request("http://localhost"), makeParams("insp-1"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe("insp-1");
  });

  it("returns 403 when non-owner field_tech tries to access", async () => {
    mockDbSelect.mockResolvedValueOnce([{ ...INSPECTION, inspectorId: "other-user" }]);
    mockGetSession.mockResolvedValueOnce({
      data: { session: { access_token: fakeAccessToken({ user_role: "field_tech" }) } },
    });
    const res = await GET(new Request("http://localhost"), makeParams("insp-1"));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Forbidden");
  });

  it("allows admin to access any inspection", async () => {
    mockDbSelect.mockResolvedValueOnce([{ ...INSPECTION, inspectorId: "other-user" }]);
    mockGetSession.mockResolvedValueOnce({
      data: { session: { access_token: fakeAccessToken({ user_role: "admin" }) } },
    });
    const res = await GET(new Request("http://localhost"), makeParams("insp-1"));
    expect(res.status).toBe(200);
  });

  it("allows office_staff to access any inspection", async () => {
    mockDbSelect.mockResolvedValueOnce([{ ...INSPECTION, inspectorId: "other-user" }]);
    mockGetSession.mockResolvedValueOnce({
      data: { session: { access_token: fakeAccessToken({ user_role: "office_staff" }) } },
    });
    const res = await GET(new Request("http://localhost"), makeParams("insp-1"));
    expect(res.status).toBe(200);
  });

  it("returns 403 when session decode fails for non-owner", async () => {
    mockDbSelect.mockResolvedValueOnce([{ ...INSPECTION, inspectorId: "other-user" }]);
    mockGetSession.mockResolvedValueOnce({
      data: { session: { access_token: "bad.token.here" } },
    });
    const res = await GET(new Request("http://localhost"), makeParams("insp-1"));
    expect(res.status).toBe(403);
  });
});

// ===========================================================================
// PATCH /api/inspections/[id]
// ===========================================================================
describe("PATCH /api/inspections/[id]", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const res = await PATCH(makeRequest({ facilityInfo: {} }), makeParams("insp-1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when inspection not found", async () => {
    mockDbSelect.mockResolvedValueOnce([]);
    const res = await PATCH(makeRequest({ facilityInfo: {} }), makeParams("insp-1"));
    expect(res.status).toBe(404);
  });

  it("allows owner to update their own draft", async () => {
    mockDbSelect.mockResolvedValueOnce([{ inspectorId: USER.id, status: "draft" }]);
    const res = await PATCH(
      makeRequest({ facilityInfo: { facilityName: "Updated" } }),
      makeParams("insp-1"),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).saved).toBe(true);
  });

  it("returns 403 when field_tech tries to edit non-draft", async () => {
    mockDbSelect.mockResolvedValueOnce([{ inspectorId: USER.id, status: "in_review" }]);
    const res = await PATCH(makeRequest({ facilityInfo: {} }), makeParams("insp-1"));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("no longer a draft");
  });

  it("returns 403 when non-owner field_tech tries to edit", async () => {
    mockDbSelect.mockResolvedValueOnce([{ inspectorId: "other-user", status: "draft" }]);
    mockGetSession.mockResolvedValueOnce({
      data: { session: { access_token: fakeAccessToken({ user_role: "field_tech" }) } },
    });
    const res = await PATCH(makeRequest({ facilityInfo: {} }), makeParams("insp-1"));
    expect(res.status).toBe(403);
  });

  it("allows admin to edit any inspection regardless of status", async () => {
    mockDbSelect.mockResolvedValueOnce([{ inspectorId: "other-user", status: "in_review" }]);
    mockGetSession.mockResolvedValueOnce({
      data: { session: { access_token: fakeAccessToken({ user_role: "admin" }) } },
    });
    const res = await PATCH(
      makeRequest({ facilityInfo: { facilityName: "Admin Edit" } }),
      makeParams("insp-1"),
    );
    expect(res.status).toBe(200);
  });

  it("allows office_staff to edit any inspection", async () => {
    mockDbSelect.mockResolvedValueOnce([{ inspectorId: "other-user", status: "completed" }]);
    mockGetSession.mockResolvedValueOnce({
      data: { session: { access_token: fakeAccessToken({ user_role: "office_staff" }) } },
    });
    const res = await PATCH(makeRequest({ facilityInfo: {} }), makeParams("insp-1"));
    expect(res.status).toBe(200);
  });

  it("syncs denormalized facility fields from facilityInfo", async () => {
    mockDbSelect.mockResolvedValueOnce([{ inspectorId: USER.id, status: "draft" }]);
    const formData = {
      facilityInfo: {
        facilityName: "Test Facility",
        facilityAddress: "123 Main St",
        facilityCity: "Phoenix",
        facilityCounty: "Maricopa",
        facilityZip: "85001",
        sellerName: "John Doe",
      },
    };
    const res = await PATCH(makeRequest(formData), makeParams("insp-1"));
    expect(res.status).toBe(200);
  });
});

// ===========================================================================
// DELETE /api/inspections/[id]
// ===========================================================================
describe("DELETE /api/inspections/[id]", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const res = await DELETE(new Request("http://localhost"), makeParams("insp-1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when inspection not found", async () => {
    mockDbSelect.mockResolvedValueOnce([]);
    const res = await DELETE(new Request("http://localhost"), makeParams("insp-1"));
    expect(res.status).toBe(404);
  });

  it("allows admin to delete any inspection regardless of status", async () => {
    mockDbSelect.mockResolvedValueOnce([{ inspectorId: "other-user", status: "completed" }]);
    mockGetSession.mockResolvedValueOnce({
      data: { session: { access_token: fakeAccessToken({ user_role: "admin" }) } },
    });
    const res = await DELETE(new Request("http://localhost"), makeParams("insp-1"));
    expect(res.status).toBe(200);
    expect((await res.json()).deleted).toBe(true);
  });

  it("allows owner to delete their own draft", async () => {
    mockDbSelect.mockResolvedValueOnce([{ inspectorId: USER.id, status: "draft" }]);
    mockGetSession.mockResolvedValueOnce({
      data: { session: { access_token: fakeAccessToken({ user_role: "field_tech" }) } },
    });
    const res = await DELETE(new Request("http://localhost"), makeParams("insp-1"));
    expect(res.status).toBe(200);
    expect((await res.json()).deleted).toBe(true);
  });

  it("returns 403 when non-admin tries to delete someone else's inspection", async () => {
    mockDbSelect.mockResolvedValueOnce([{ inspectorId: "other-user", status: "draft" }]);
    mockGetSession.mockResolvedValueOnce({
      data: { session: { access_token: fakeAccessToken({ user_role: "field_tech" }) } },
    });
    const res = await DELETE(new Request("http://localhost"), makeParams("insp-1"));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Forbidden");
  });

  it("returns 403 when non-admin tries to delete non-draft", async () => {
    mockDbSelect.mockResolvedValueOnce([{ inspectorId: USER.id, status: "in_review" }]);
    mockGetSession.mockResolvedValueOnce({
      data: { session: { access_token: fakeAccessToken({ user_role: "field_tech" }) } },
    });
    const res = await DELETE(new Request("http://localhost"), makeParams("insp-1"));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("Only draft inspections");
  });

  it("returns 403 when office_staff tries to delete (not admin)", async () => {
    mockDbSelect.mockResolvedValueOnce([{ inspectorId: "other-user", status: "draft" }]);
    mockGetSession.mockResolvedValueOnce({
      data: { session: { access_token: fakeAccessToken({ user_role: "office_staff" }) } },
    });
    const res = await DELETE(new Request("http://localhost"), makeParams("insp-1"));
    expect(res.status).toBe(403);
  });
});
