import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const {
  mockGetUser,
  mockGetSession,
  mockCreateClient,
  mockCreateAdminClient,
  mockAdminCreateUser,
  mockAdminDeleteUser,
  mockAdminInsertProfile,
  mockAdminInsertRole,
  mockAdminDeleteProfile,
} = vi.hoisted(() => {
  const mockGetUser = vi.fn();
  const mockGetSession = vi.fn();
  const mockAdminCreateUser = vi.fn();
  const mockAdminDeleteUser = vi.fn();
  const mockAdminInsertProfile = vi.fn();
  const mockAdminInsertRole = vi.fn();
  const mockAdminDeleteProfile = vi.fn();

  const mockCreateClient = vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
  });

  const mockCreateAdminClient = vi.fn().mockReturnValue({
    auth: {
      admin: {
        createUser: mockAdminCreateUser,
        deleteUser: mockAdminDeleteUser,
      },
    },
    from: vi.fn((table: string) => {
      if (table === "profiles") {
        return {
          insert: vi.fn(() => mockAdminInsertProfile()),
          delete: vi.fn(() => ({
            eq: vi.fn(() => mockAdminDeleteProfile()),
          })),
        };
      }
      if (table === "user_roles") {
        return {
          insert: vi.fn(() => mockAdminInsertRole()),
        };
      }
      return { insert: vi.fn(), delete: vi.fn() };
    }),
  });

  return {
    mockGetUser, mockGetSession, mockCreateClient, mockCreateAdminClient,
    mockAdminCreateUser, mockAdminDeleteUser,
    mockAdminInsertProfile, mockAdminInsertRole, mockAdminDeleteProfile,
  };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));

vi.mock("@/lib/validators/auth", () => ({
  createUserSchema: {
    safeParse: vi.fn((data: unknown) => {
      const d = data as Record<string, unknown>;
      if (!d.email || !d.password || !d.fullName || !d.role) {
        return {
          success: false,
          error: { flatten: () => ({ fieldErrors: { email: ["Required"] } }) },
        };
      }
      if (typeof d.password === "string" && d.password.length < 8) {
        return {
          success: false,
          error: { flatten: () => ({ fieldErrors: { password: ["Too short"] } }) },
        };
      }
      return { success: true, data: d };
    }),
  },
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
  return new Request("http://localhost/api/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

const ADMIN_USER = { id: "admin-1", email: "admin@test.com" };
const VALID_BODY = {
  email: "newuser@test.com",
  password: "password123",
  fullName: "New User",
  role: "field_tech",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: ADMIN_USER } });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: fakeAccessToken({ user_role: "admin" }) } },
  });
  mockAdminCreateUser.mockResolvedValue({
    data: { user: { id: "new-user-1", email: "newuser@test.com" } },
    error: null,
  });
  mockAdminInsertProfile.mockReturnValue({ error: null });
  mockAdminInsertRole.mockReturnValue({ error: null });
  mockAdminDeleteUser.mockResolvedValue({});
  mockAdminDeleteProfile.mockReturnValue({});
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("POST /api/admin/users", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(401);
  });

  it("returns 401 when no session exists", async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null } });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(401);
  });

  it("returns 403 when user is field_tech", async () => {
    mockGetSession.mockResolvedValueOnce({
      data: { session: { access_token: fakeAccessToken({ user_role: "field_tech" }) } },
    });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("admin access required");
  });

  it("returns 403 when user is office_staff", async () => {
    mockGetSession.mockResolvedValueOnce({
      data: { session: { access_token: fakeAccessToken({ user_role: "office_staff" }) } },
    });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(403);
  });

  it("returns 400 when validation fails (missing fields)", async () => {
    const res = await POST(makeRequest({ email: "test@test.com" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Validation failed");
  });

  it("returns 400 when password is too short", async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, password: "short" }));
    expect(res.status).toBe(400);
  });

  it("creates user successfully and returns 201", async () => {
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.user.id).toBe("new-user-1");
    expect(json.user.email).toBe("newuser@test.com");
    expect(json.user.fullName).toBe("New User");
    expect(json.user.role).toBe("field_tech");
  });

  it("returns 400 when auth user creation fails", async () => {
    mockAdminCreateUser.mockResolvedValueOnce({
      data: null,
      error: { message: "Email already in use" },
    });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Email already in use");
  });

  it("rolls back auth user when profile creation fails", async () => {
    mockAdminInsertProfile.mockReturnValueOnce({ error: { message: "Duplicate profile" } });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Profile creation failed");
    expect(mockAdminDeleteUser).toHaveBeenCalledWith("new-user-1");
  });

  it("rolls back auth user and profile when role creation fails", async () => {
    mockAdminInsertRole.mockReturnValueOnce({ error: { message: "Role conflict" } });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Role assignment failed");
    expect(mockAdminDeleteUser).toHaveBeenCalledWith("new-user-1");
  });

  it("returns 500 on unexpected errors", async () => {
    mockGetUser.mockRejectedValueOnce(new Error("DB connection lost"));
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Internal server error");
  });
});
