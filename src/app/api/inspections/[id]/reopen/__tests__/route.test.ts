import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const {
  mockGetUser,
  mockGetSession,
  mockCreateClient,
  mockDbUpdate,
} = vi.hoisted(() => {
  const mockGetUser = vi.fn();
  const mockGetSession = vi.fn();
  const mockDbUpdate = vi.fn();

  const mockCreateClient = vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
  });

  return { mockGetUser, mockGetSession, mockCreateClient, mockDbUpdate };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));

vi.mock("@/lib/db", () => {
  const updateChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn(() => mockDbUpdate()),
  };
  return {
    db: { update: vi.fn(() => updateChain) },
  };
});

vi.mock("@/lib/db/schema", () => ({
  inspections: { id: "id", status: "status" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ _col, val })),
  and: vi.fn((...args: unknown[]) => args),
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

const USER = { id: "admin-1" };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: USER } });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: fakeAccessToken({ user_role: "admin" }) } },
  });
  mockDbUpdate.mockResolvedValue([{ id: "insp-1" }]);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("POST /api/inspections/[id]/reopen", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const res = await POST(new Request("http://localhost"), makeParams("insp-1"));
    expect(res.status).toBe(401);
  });

  it("returns 403 when user is field_tech", async () => {
    mockGetSession.mockResolvedValueOnce({
      data: { session: { access_token: fakeAccessToken({ user_role: "field_tech" }) } },
    });
    const res = await POST(new Request("http://localhost"), makeParams("insp-1"));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("admin only");
  });

  it("returns 403 when user is office_staff", async () => {
    mockGetSession.mockResolvedValueOnce({
      data: { session: { access_token: fakeAccessToken({ user_role: "office_staff" }) } },
    });
    const res = await POST(new Request("http://localhost"), makeParams("insp-1"));
    expect(res.status).toBe(403);
  });

  it("reopens a completed inspection back to in_review", async () => {
    const res = await POST(new Request("http://localhost"), makeParams("insp-1"));
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("in_review");
  });

  it("returns 409 when inspection is not completed", async () => {
    mockDbUpdate.mockResolvedValueOnce([]);
    const res = await POST(new Request("http://localhost"), makeParams("insp-1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("not completed");
  });

  it("returns 403 when session is null", async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null } });
    const res = await POST(new Request("http://localhost"), makeParams("insp-1"));
    expect(res.status).toBe(403);
  });

  it("returns 403 when token decode fails", async () => {
    mockGetSession.mockResolvedValueOnce({
      data: { session: { access_token: "malformed.b@d.token" } },
    });
    const res = await POST(new Request("http://localhost"), makeParams("insp-1"));
    expect(res.status).toBe(403);
  });
});
