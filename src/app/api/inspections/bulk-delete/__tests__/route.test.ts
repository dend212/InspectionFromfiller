import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const {
  mockGetUser,
  mockGetSession,
  mockCreateClient,
  mockDbSelect,
  mockDbDelete,
} = vi.hoisted(() => {
  const mockGetUser = vi.fn();
  const mockGetSession = vi.fn();
  const mockDbSelect = vi.fn();
  const mockDbDelete = vi.fn();

  const mockCreateClient = vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
  });

  return { mockGetUser, mockGetSession, mockCreateClient, mockDbSelect, mockDbDelete };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));

vi.mock("@/lib/db", () => {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn(() => mockDbSelect()),
  };
  const deleteChain = {
    where: vi.fn(() => mockDbDelete()),
  };
  return {
    db: {
      select: vi.fn(() => selectChain),
      delete: vi.fn(() => deleteChain),
    },
  };
});

vi.mock("@/lib/db/schema", () => ({
  inspections: { id: "id", inspectorId: "inspector_id", status: "status" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ _col, val })),
  and: vi.fn((...args: unknown[]) => args),
  inArray: vi.fn((_col: unknown, vals: unknown) => ({ _col, vals })),
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

function makeRequest(body?: unknown): Request {
  return new Request("http://localhost/api/inspections/bulk-delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

const USER = { id: "user-1" };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: USER } });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: fakeAccessToken({ user_role: "admin" }) } },
  });
  mockDbSelect.mockResolvedValue([]);
  mockDbDelete.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("POST /api/inspections/bulk-delete", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const res = await POST(makeRequest({ ids: ["1"] }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when ids is not an array", async () => {
    const res = await POST(makeRequest({ ids: "not-array" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("non-empty array");
  });

  it("returns 400 when ids is empty", async () => {
    const res = await POST(makeRequest({ ids: [] }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when ids contains non-strings", async () => {
    const res = await POST(makeRequest({ ids: [1, 2, 3] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("must be strings");
  });

  it("returns 400 when ids exceeds 100 limit", async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `id-${i}`);
    const res = await POST(makeRequest({ ids }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("more than 100");
  });

  it("allows admin to delete any inspections", async () => {
    mockDbSelect.mockResolvedValueOnce([
      { id: "1", inspectorId: "other-user", status: "completed" },
      { id: "2", inspectorId: "other-user", status: "draft" },
    ]);
    const res = await POST(makeRequest({ ids: ["1", "2"] }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.deletedCount).toBe(2);
  });

  it("allows non-admin to delete only their own drafts", async () => {
    mockGetSession.mockResolvedValueOnce({
      data: { session: { access_token: fakeAccessToken({ user_role: "field_tech" }) } },
    });
    mockDbSelect.mockResolvedValueOnce([
      { id: "1", inspectorId: USER.id, status: "draft" },
      { id: "2", inspectorId: "other-user", status: "draft" },
      { id: "3", inspectorId: USER.id, status: "in_review" },
    ]);
    const res = await POST(makeRequest({ ids: ["1", "2", "3"] }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.deletedCount).toBe(1);
    expect(json.errors).toHaveLength(2);
  });

  it("returns deletedCount 0 when no inspections match", async () => {
    mockDbSelect.mockResolvedValueOnce([]);
    const res = await POST(makeRequest({ ids: ["nonexistent"] }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.deletedCount).toBe(0);
    expect(json.requestedCount).toBe(1);
  });

  it("returns errors for unauthorized deletions alongside successful ones", async () => {
    mockGetSession.mockResolvedValueOnce({
      data: { session: { access_token: fakeAccessToken({ user_role: "field_tech" }) } },
    });
    mockDbSelect.mockResolvedValueOnce([
      { id: "1", inspectorId: USER.id, status: "draft" },
      { id: "2", inspectorId: USER.id, status: "completed" },
    ]);
    const res = await POST(makeRequest({ ids: ["1", "2"] }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.deletedCount).toBe(1);
    expect(json.errors).toHaveLength(1);
    expect(json.errors[0]).toContain("only draft");
  });

  it("returns 400 when ids is missing from body", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });
});
