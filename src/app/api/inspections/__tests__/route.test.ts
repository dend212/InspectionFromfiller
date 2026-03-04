import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const {
  mockGetUser,
  mockGetSession,
  mockCreateClient,
  mockDbSelect,
  mockDbInsert,
} = vi.hoisted(() => {
  const mockGetUser = vi.fn();
  const mockGetSession = vi.fn();
  const mockDbSelect = vi.fn();
  const mockDbInsert = vi.fn();

  const mockCreateClient = vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
  });

  return { mockGetUser, mockGetSession, mockCreateClient, mockDbSelect, mockDbInsert };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));

// Mock drizzle — chain pattern used by the route
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
  return {
    db: {
      select: vi.fn(() => selectChain),
      insert: vi.fn(() => insertChain),
    },
  };
});

vi.mock("@/lib/db/schema", () => ({
  inspections: {
    id: "id",
    inspectorId: "inspector_id",
    status: "status",
    facilityName: "facility_name",
    facilityAddress: "facility_address",
    facilityCity: "facility_city",
    facilityCounty: "facility_county",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
  profiles: { id: "id", fullName: "full_name" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ _col, val })),
  desc: vi.fn((col: unknown) => ({ col, dir: "desc" })),
}));

vi.mock("@/lib/validators/inspection", () => ({
  getDefaultFormValues: vi.fn((name: string) => ({
    facilityInfo: { inspectorName: name },
  })),
}));

// ---------------------------------------------------------------------------
// Import handlers
// ---------------------------------------------------------------------------
import { GET, POST } from "../route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fakeAccessToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64");
  return `${header}.${body}.fakesig`;
}

const USER = { id: "user-1", email: "tech@example.com", user_metadata: { full_name: "Test Tech" } };

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: USER } });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: fakeAccessToken({ user_role: "field_tech" }) } },
  });
  mockDbSelect.mockResolvedValue([]);
  mockDbInsert.mockResolvedValue([{ id: "new-1", status: "draft", inspectorId: USER.id }]);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("POST /api/inspections", () => {
  it("returns 401 when user is not authenticated", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const res = await POST();
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Unauthorized");
  });

  it("creates a new draft inspection and returns 201", async () => {
    mockDbSelect.mockResolvedValueOnce([{ fullName: "John Inspector" }]);
    const newInsp = { id: "new-1", status: "draft", inspectorId: USER.id };
    mockDbInsert.mockResolvedValueOnce([newInsp]);

    const res = await POST();
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.id).toBe("new-1");
    expect(json.status).toBe("draft");
  });

  it("falls back to user_metadata.full_name when profile is missing", async () => {
    mockDbSelect.mockResolvedValueOnce([]); // no profile found
    mockDbInsert.mockResolvedValueOnce([{ id: "new-2", status: "draft" }]);

    const res = await POST();
    expect(res.status).toBe(201);
  });

  it("handles database insert error gracefully", async () => {
    mockDbSelect.mockResolvedValueOnce([{ fullName: "Test" }]);
    mockDbInsert.mockRejectedValueOnce(new Error("DB connection failed"));

    await expect(POST()).rejects.toThrow("DB connection failed");
  });
});

describe("GET /api/inspections", () => {
  it("returns 401 when user is not authenticated", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const res = await GET();
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Unauthorized");
  });

  it("returns all inspections for admin users", async () => {
    mockGetSession.mockResolvedValueOnce({
      data: { session: { access_token: fakeAccessToken({ user_role: "admin" }) } },
    });
    const allInspections = [
      { id: "1", status: "draft" },
      { id: "2", status: "in_review" },
    ];
    mockDbSelect.mockResolvedValueOnce(allInspections);

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveLength(2);
  });

  it("returns all inspections for office_staff users", async () => {
    mockGetSession.mockResolvedValueOnce({
      data: { session: { access_token: fakeAccessToken({ user_role: "office_staff" }) } },
    });
    mockDbSelect.mockResolvedValueOnce([{ id: "1" }]);

    const res = await GET();
    expect(res.status).toBe(200);
  });

  it("returns only own inspections for field_tech users", async () => {
    mockGetSession.mockResolvedValueOnce({
      data: { session: { access_token: fakeAccessToken({ user_role: "field_tech" }) } },
    });
    mockDbSelect.mockResolvedValueOnce([{ id: "own-1", inspectorId: USER.id }]);

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveLength(1);
  });

  it("defaults to field_tech behavior when role decode fails", async () => {
    mockGetSession.mockResolvedValueOnce({
      data: { session: { access_token: "invalid.base64.token" } },
    });
    mockDbSelect.mockResolvedValueOnce([]);

    const res = await GET();
    expect(res.status).toBe(200);
  });

  it("defaults to field_tech behavior when session is null", async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null } });
    mockDbSelect.mockResolvedValueOnce([]);

    const res = await GET();
    expect(res.status).toBe(200);
  });

  it("returns empty array when no inspections exist", async () => {
    mockDbSelect.mockResolvedValueOnce([]);
    const res = await GET();
    const json = await res.json();
    expect(json).toEqual([]);
  });
});
