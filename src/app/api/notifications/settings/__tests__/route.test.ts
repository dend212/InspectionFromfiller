import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const {
  mockGetUser,
  mockCreateClient,
  mockDbSelect,
  mockDbUpdate,
} = vi.hoisted(() => {
  const mockGetUser = vi.fn();
  const mockDbSelect = vi.fn();
  const mockDbUpdate = vi.fn();

  const mockCreateClient = vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser },
  });

  return { mockGetUser, mockCreateClient, mockDbSelect, mockDbUpdate };
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
  return {
    db: {
      select: vi.fn(() => selectChain),
      update: vi.fn(() => updateChain),
    },
  };
});

vi.mock("@/lib/db/schema", () => ({
  profiles: { id: "id", notificationSettings: "notification_settings" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ _col, val })),
}));

// ---------------------------------------------------------------------------
// Import handlers
// ---------------------------------------------------------------------------
import { GET, PUT } from "../route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const USER = { id: "user-1" };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: USER } });
  mockDbSelect.mockResolvedValue([{ notificationSettings: { emailOnSubmission: true } }]);
  mockDbUpdate.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("GET /api/notifications/settings", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns current notification settings", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.emailOnSubmission).toBe(true);
  });

  it("returns default settings when profile has no notification settings", async () => {
    mockDbSelect.mockResolvedValueOnce([{ notificationSettings: null }]);
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.emailOnSubmission).toBe(false);
  });

  it("returns default settings when no profile found", async () => {
    mockDbSelect.mockResolvedValueOnce([]);
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.emailOnSubmission).toBe(false);
  });
});

describe("PUT /api/notifications/settings", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const req = new Request("http://localhost/api/notifications/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emailOnSubmission: true }),
    });
    const res = await PUT(req);
    expect(res.status).toBe(401);
  });

  it("updates notification settings and returns them", async () => {
    const settings = { emailOnSubmission: true };
    const req = new Request("http://localhost/api/notifications/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    const res = await PUT(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.emailOnSubmission).toBe(true);
  });

  it("allows disabling notifications", async () => {
    const settings = { emailOnSubmission: false };
    const req = new Request("http://localhost/api/notifications/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    const res = await PUT(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.emailOnSubmission).toBe(false);
  });
});
