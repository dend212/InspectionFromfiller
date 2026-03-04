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
  mockDbSelectAdmins,
} = vi.hoisted(() => {
  const mockGetUser = vi.fn();
  const mockGetSession = vi.fn();
  const mockDbSelect = vi.fn();
  const mockDbUpdate = vi.fn();
  const mockDbSelectAdmins = vi.fn();

  const mockCreateClient = vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
  });

  return { mockGetUser, mockGetSession, mockCreateClient, mockDbSelect, mockDbUpdate, mockDbSelectAdmins };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));

vi.mock("@/lib/db", () => {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(() => mockDbSelect()),
  };
  const updateChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn(() => mockDbUpdate()),
  };
  return {
    db: {
      select: vi.fn(() => selectChain),
      update: vi.fn(() => updateChain),
    },
  };
});

vi.mock("@/lib/db/schema", () => ({
  inspections: { id: "id", inspectorId: "inspector_id", status: "status", facilityName: "facility_name" },
  profiles: { id: "id", notificationSettings: "notification_settings" },
  userRoles: { userId: "user_id", role: "role" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ _col, val })),
  and: vi.fn((...args: unknown[]) => args),
}));

vi.mock("@/lib/email/send-notification", () => ({
  sendSubmissionNotification: vi.fn(),
}));

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

const USER = { id: "user-1" };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: USER } });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: fakeAccessToken({ user_role: "field_tech" }) } },
  });
  mockDbSelect.mockResolvedValue([{ inspectorId: USER.id, status: "draft" }]);
  mockDbUpdate.mockResolvedValue([{ id: "insp-1", facilityName: "Test" }]);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("POST /api/inspections/[id]/submit", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const res = await POST(new Request("http://localhost"), makeParams("insp-1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when inspection not found", async () => {
    mockDbSelect.mockResolvedValueOnce([]);
    const res = await POST(new Request("http://localhost"), makeParams("insp-1"));
    expect(res.status).toBe(404);
  });

  it("allows owner to submit their draft inspection", async () => {
    const res = await POST(new Request("http://localhost"), makeParams("insp-1"));
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("in_review");
  });

  it("allows admin to submit any draft inspection", async () => {
    mockDbSelect.mockResolvedValueOnce([{ inspectorId: "other-user", status: "draft" }]);
    mockGetSession.mockResolvedValueOnce({
      data: { session: { access_token: fakeAccessToken({ user_role: "admin" }) } },
    });
    const res = await POST(new Request("http://localhost"), makeParams("insp-1"));
    expect(res.status).toBe(200);
  });

  it("returns 403 when non-owner field_tech tries to submit", async () => {
    mockDbSelect.mockResolvedValueOnce([{ inspectorId: "other-user", status: "draft" }]);
    mockGetSession.mockResolvedValueOnce({
      data: { session: { access_token: fakeAccessToken({ user_role: "field_tech" }) } },
    });
    const res = await POST(new Request("http://localhost"), makeParams("insp-1"));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Forbidden");
  });

  it("returns 403 when office_staff (non-owner, non-admin) tries to submit", async () => {
    mockDbSelect.mockResolvedValueOnce([{ inspectorId: "other-user", status: "draft" }]);
    mockGetSession.mockResolvedValueOnce({
      data: { session: { access_token: fakeAccessToken({ user_role: "office_staff" }) } },
    });
    const res = await POST(new Request("http://localhost"), makeParams("insp-1"));
    expect(res.status).toBe(403);
  });

  it("returns 409 when inspection is not in draft status (atomic guard)", async () => {
    mockDbSelect.mockResolvedValueOnce([{ inspectorId: USER.id, status: "draft" }]);
    mockDbUpdate.mockResolvedValueOnce([]); // atomic transition fails
    const res = await POST(new Request("http://localhost"), makeParams("insp-1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("not in draft status");
  });

  it("returns 409 when concurrent submission already transitioned status", async () => {
    // Inspection looks like it's draft in the select, but atomic update returns nothing
    mockDbSelect.mockResolvedValueOnce([{ inspectorId: USER.id, status: "draft" }]);
    mockDbUpdate.mockResolvedValueOnce([]);
    const res = await POST(new Request("http://localhost"), makeParams("insp-1"));
    expect(res.status).toBe(409);
  });
});
