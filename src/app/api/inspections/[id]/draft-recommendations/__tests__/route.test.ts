import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted so the factories below can reference them
// ---------------------------------------------------------------------------

const { mockGetUser, mockGetSession, mockCreateClient, mockDbSelect, mockBuildContext, mockDraft } =
  vi.hoisted(() => {
    const mockGetUser = vi.fn();
    const mockGetSession = vi.fn();
    const mockDbSelect = vi.fn();
    const mockBuildContext = vi.fn();
    const mockDraft = vi.fn();
    const mockCreateClient = vi.fn().mockResolvedValue({
      auth: { getUser: mockGetUser, getSession: mockGetSession },
    });
    return { mockGetUser, mockGetSession, mockCreateClient, mockDbSelect, mockBuildContext, mockDraft };
  });

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));

// The AI module constructs `new Anthropic()` at import time, which throws under jsdom — mock it whole
vi.mock("@/lib/ai/draft-recommendations", () => ({
  buildRecommendationContext: mockBuildContext,
  draftRecommendations: mockDraft,
}));

vi.mock("@/lib/db", () => {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(() => mockDbSelect()),
  };
  return { db: { select: vi.fn(() => selectChain) } };
});

vi.mock("@/lib/db/schema", () => ({
  inspections: { id: "id", formData: "form_data" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ _col, val })),
}));

// ---------------------------------------------------------------------------
// Import the handler under test
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

function makeRequest(id: string): Request {
  return new Request(`http://localhost/api/inspections/${id}/draft-recommendations`, {
    method: "POST",
  });
}

function makeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

/** The rate limiter is keyed by inspection id and lives for the whole test file — give each test its own id */
let seq = 0;
const nextId = () => `insp-${++seq}`;

const VALID_USER = { id: "user-1", email: "admin@sewertime.com" };
const FORM_DATA = { septicTank: { septicTankComments: "Tank is sound." } };
const CONTEXT = { marker: "built-context" };

function sessionWithRole(role: string | null) {
  return { data: { session: { access_token: fakeAccessToken({ user_role: role }) } } };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  mockGetUser.mockResolvedValue({ data: { user: VALID_USER } });
  mockGetSession.mockResolvedValue(sessionWithRole("admin"));
  mockDbSelect.mockResolvedValue([{ formData: FORM_DATA }]);
  mockBuildContext.mockReturnValue(CONTEXT);
  mockDraft.mockResolvedValue("• Pump every 3–5 years.");
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/inspections/[id]/draft-recommendations", () => {
  describe("Authentication & Authorization", () => {
    it("returns 401 when user is not authenticated", async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: null } });
      const id = nextId();

      const res = await POST(makeRequest(id), makeParams(id));

      expect(res.status).toBe(401);
      expect(mockDraft).not.toHaveBeenCalled();
    });

    it("returns 403 for field_tech role", async () => {
      mockGetSession.mockResolvedValueOnce(sessionWithRole("field_tech"));
      const id = nextId();

      const res = await POST(makeRequest(id), makeParams(id));

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toMatch(/admin or office staff/i);
      expect(mockDraft).not.toHaveBeenCalled();
    });

    it("returns 403 when there is no session", async () => {
      mockGetSession.mockResolvedValueOnce({ data: { session: null } });
      const id = nextId();

      const res = await POST(makeRequest(id), makeParams(id));

      expect(res.status).toBe(403);
    });

    it("allows admin role", async () => {
      const id = nextId();

      const res = await POST(makeRequest(id), makeParams(id));

      expect(res.status).toBe(200);
    });

    it("allows office_staff role", async () => {
      mockGetSession.mockResolvedValueOnce(sessionWithRole("office_staff"));
      const id = nextId();

      const res = await POST(makeRequest(id), makeParams(id));

      expect(res.status).toBe(200);
    });
  });

  describe("Inspection lookup", () => {
    it("returns 404 when the inspection does not exist", async () => {
      mockDbSelect.mockResolvedValueOnce([]);
      const id = nextId();

      const res = await POST(makeRequest(id), makeParams(id));

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toBe("Inspection not found");
      expect(mockDraft).not.toHaveBeenCalled();
    });
  });

  describe("Drafting", () => {
    it("returns { recommendations } built from the inspection's form data", async () => {
      const id = nextId();

      const res = await POST(makeRequest(id), makeParams(id));

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ recommendations: "• Pump every 3–5 years." });
      expect(mockBuildContext).toHaveBeenCalledWith(FORM_DATA);
      expect(mockDraft).toHaveBeenCalledWith(CONTEXT);
    });

    it("returns 502 when the model call fails", async () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      mockDraft.mockRejectedValueOnce(new Error("overloaded"));
      const id = nextId();

      const res = await POST(makeRequest(id), makeParams(id));

      expect(res.status).toBe(502);
      const json = await res.json();
      expect(json.error).toMatch(/couldn't draft/i);
      consoleError.mockRestore();
    });
  });

  describe("Rate limiting", () => {
    it("allows 5 drafts per inspection then returns 429", async () => {
      const id = nextId();

      for (let i = 0; i < 5; i++) {
        const res = await POST(makeRequest(id), makeParams(id));
        expect(res.status).toBe(200);
      }

      const res = await POST(makeRequest(id), makeParams(id));

      expect(res.status).toBe(429);
      const json = await res.json();
      expect(json.error).toMatch(/rate limit/i);
      expect(mockDraft).toHaveBeenCalledTimes(5);
    });

    it("tracks the limit per inspection", async () => {
      const first = nextId();
      for (let i = 0; i < 5; i++) {
        await POST(makeRequest(first), makeParams(first));
      }

      const other = nextId();
      const res = await POST(makeRequest(other), makeParams(other));

      expect(res.status).toBe(200);
    });
  });
});
