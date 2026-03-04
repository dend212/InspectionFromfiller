import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const {
  mockGetUser,
  mockGetSession,
  mockCreateClient,
  mockDbSelect,
  mockDbSelectEmails,
} = vi.hoisted(() => {
  const mockGetUser = vi.fn();
  const mockGetSession = vi.fn();
  const mockDbSelect = vi.fn();
  const mockDbSelectEmails = vi.fn();

  const mockCreateClient = vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
  });

  return { mockGetUser, mockGetSession, mockCreateClient, mockDbSelect, mockDbSelectEmails };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));

vi.mock("@/lib/db", () => {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(() => mockDbSelect()),
    orderBy: vi.fn(() => mockDbSelectEmails()),
  };
  return {
    db: { select: vi.fn(() => selectChain) },
  };
});

vi.mock("@/lib/db/schema", () => ({
  inspections: { id: "id", inspectorId: "inspector_id" },
  inspectionEmails: { id: "id", inspectionId: "inspection_id", sentAt: "sent_at", sentBy: "sent_by" },
  profiles: { id: "id", fullName: "full_name" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ _col, val })),
  desc: vi.fn((col: unknown) => ({ col, dir: "desc" })),
}));

vi.mock("@/lib/supabase/auth-helpers", () => ({
  checkInspectionAccess: vi.fn().mockResolvedValue({ allowed: true, role: "admin" }),
}));

// ---------------------------------------------------------------------------
// Import handler
// ---------------------------------------------------------------------------
import { GET } from "../route";
import { checkInspectionAccess } from "@/lib/supabase/auth-helpers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

const USER = { id: "user-1" };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: USER } });
  mockDbSelect.mockResolvedValue([{ inspectorId: USER.id }]);
  (checkInspectionAccess as ReturnType<typeof vi.fn>).mockResolvedValue({ allowed: true, role: "admin" });
  mockDbSelectEmails.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("GET /api/inspections/[id]/emails", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const res = await GET(new Request("http://localhost"), makeParams("insp-1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when inspection not found", async () => {
    mockDbSelect.mockResolvedValueOnce([]);
    const res = await GET(new Request("http://localhost"), makeParams("insp-1"));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Inspection not found");
  });

  it("returns 403 when user has no access", async () => {
    (checkInspectionAccess as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ allowed: false, role: "field_tech" });
    const res = await GET(new Request("http://localhost"), makeParams("insp-1"));
    expect(res.status).toBe(403);
  });

  it("returns email history with sender names", async () => {
    const emails = [
      {
        id: "e1",
        recipientEmail: "customer@test.com",
        subject: "Report",
        sentAt: new Date("2026-03-01T12:00:00Z"),
        senderName: "Admin User",
      },
      {
        id: "e2",
        recipientEmail: "customer2@test.com",
        subject: "Report 2",
        sentAt: new Date("2026-03-02T12:00:00Z"),
        senderName: null,
      },
    ];
    mockDbSelectEmails.mockResolvedValueOnce(emails);

    const res = await GET(new Request("http://localhost"), makeParams("insp-1"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveLength(2);
    expect(json[0].senderName).toBe("Admin User");
    expect(json[1].senderName).toBe("Unknown");
    expect(json[0].sentAt).toBe("2026-03-01T12:00:00.000Z");
  });

  it("returns empty array when no emails exist", async () => {
    mockDbSelectEmails.mockResolvedValueOnce([]);
    const res = await GET(new Request("http://localhost"), makeParams("insp-1"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual([]);
  });
});
