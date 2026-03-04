import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  mockGetUser,
  mockGetSession,
  mockCreateClient,
  mockDownload,
  mockCreateAdminClient,
  mockDbSelect,
  mockDbInsert,
  mockDbUpdate,
  mockResendSend,
} = vi.hoisted(() => {
  const mockGetUser = vi.fn();
  const mockGetSession = vi.fn();
  const mockDownload = vi.fn();
  const mockDbSelect = vi.fn();
  const mockDbInsert = vi.fn();
  const mockDbUpdate = vi.fn();
  const mockResendSend = vi.fn();

  const mockCreateClient = vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
  });

  const mockCreateAdminClient = vi.fn().mockReturnValue({
    storage: { from: () => ({ download: mockDownload }) },
  });

  return {
    mockGetUser,
    mockGetSession,
    mockCreateClient,
    mockDownload,
    mockCreateAdminClient,
    mockDbSelect,
    mockDbInsert,
    mockDbUpdate,
    mockResendSend,
  };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));

// Mock Resend — must export a class that can be instantiated with `new`
vi.mock("resend", () => {
  return {
    Resend: class MockResend {
      emails = { send: mockResendSend };
    },
  };
});

// Mock drizzle
vi.mock("@/lib/db", () => {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(() => mockDbSelect()),
  };

  const insertChain = {
    values: vi.fn(() => mockDbInsert()),
  };

  const updateChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn(() => mockDbUpdate()),
  };

  return {
    db: {
      select: vi.fn(() => selectChain),
      insert: vi.fn(() => insertChain),
      update: vi.fn(() => updateChain),
    },
  };
});

vi.mock("@/lib/db/schema", () => ({
  inspections: { id: "id", customerEmail: "customer_email" },
  inspectionEmails: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ _col, val })),
}));

vi.mock("@/lib/storage/pdf-storage", () => ({
  buildDownloadFilename: vi.fn(() => "123-Main-St_ADEQ_2026-03-03.pdf"),
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

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/inspections/insp-1/send-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeRawRequest(rawBody: string): Request {
  return new Request("http://localhost/api/inspections/insp-1/send-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: rawBody,
  });
}

function makeParams(id = "insp-1"): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

const VALID_USER = { id: "user-1", email: "admin@sewertime.com" };
const VALID_BODY = {
  recipientEmail: "customer@example.com",
  subject: "Your Inspection Report",
  personalNote: "Thank you for your business!",
};

const FINALIZED_INSPECTION = {
  id: "insp-1",
  inspectorId: "user-1",
  facilityAddress: "123 Main St",
  completedAt: new Date("2026-03-01"),
  finalizedPdfPath: "reports/insp-1/report.pdf",
  customerEmail: null,
};

// Small fake PDF buffer
function fakePdfBlob(): Blob {
  return new Blob([Buffer.alloc(100, "PDF")], { type: "application/pdf" });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("RESEND_API_KEY", "re_test_key");
  vi.stubEnv("EMAIL_FROM_ADDRESS", "inspections@sewertime.com");

  // Default happy path
  mockGetUser.mockResolvedValue({ data: { user: VALID_USER } });
  mockGetSession.mockResolvedValue({
    data: {
      session: { access_token: fakeAccessToken({ user_role: "admin" }) },
    },
  });
  mockDbSelect.mockResolvedValue([FINALIZED_INSPECTION]);
  mockDownload.mockResolvedValue({ data: fakePdfBlob(), error: null });
  mockResendSend.mockResolvedValue({ id: "email-123" });
  mockDbInsert.mockResolvedValue(undefined);
  mockDbUpdate.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/inspections/[id]/send-email", () => {
  // -----------------------------------------------------------------------
  // 1. Authentication & Authorization
  // -----------------------------------------------------------------------
  describe("Authentication & Authorization", () => {
    it("returns 401 when user is not authenticated", async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: null } });

      const res = await POST(makeRequest(VALID_BODY), makeParams());
      expect(res.status).toBe(401);
    });

    it("returns 403 for field_tech role", async () => {
      mockGetSession.mockResolvedValueOnce({
        data: {
          session: { access_token: fakeAccessToken({ user_role: "field_tech" }) },
        },
      });

      const res = await POST(makeRequest(VALID_BODY), makeParams());
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toMatch(/admin or office staff/i);
    });

    it("allows admin role", async () => {
      const res = await POST(makeRequest(VALID_BODY), makeParams());
      expect(res.status).toBe(200);
    });

    it("allows office_staff role", async () => {
      mockGetSession.mockResolvedValueOnce({
        data: {
          session: { access_token: fakeAccessToken({ user_role: "office_staff" }) },
        },
      });

      const res = await POST(makeRequest(VALID_BODY), makeParams());
      expect(res.status).toBe(200);
    });

    it("returns 403 when session decode fails", async () => {
      mockGetSession.mockResolvedValueOnce({
        data: { session: { access_token: "bad.token.here" } },
      });

      const res = await POST(makeRequest(VALID_BODY), makeParams());
      expect(res.status).toBe(403);
    });

    it("returns 403 when no session exists", async () => {
      mockGetSession.mockResolvedValueOnce({
        data: { session: null },
      });

      const res = await POST(makeRequest(VALID_BODY), makeParams());
      expect(res.status).toBe(403);
    });
  });

  // -----------------------------------------------------------------------
  // 2. Input validation
  // -----------------------------------------------------------------------
  describe("Input validation", () => {
    it("returns 400 for invalid JSON body", async () => {
      const res = await POST(makeRawRequest("not json"), makeParams());
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("Invalid JSON body");
    });

    it("returns 400 when recipientEmail is missing", async () => {
      const res = await POST(
        makeRequest({ subject: "Test", personalNote: "" }),
        makeParams(),
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/valid recipient email/i);
    });

    it("returns 400 when recipientEmail has no @ sign", async () => {
      const res = await POST(
        makeRequest({ recipientEmail: "not-an-email", subject: "Test" }),
        makeParams(),
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/valid recipient email/i);
    });

    it("returns 400 when subject is missing", async () => {
      const res = await POST(
        makeRequest({ recipientEmail: "test@example.com" }),
        makeParams(),
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/subject is required/i);
    });
  });

  // -----------------------------------------------------------------------
  // 3. Inspection lookup
  // -----------------------------------------------------------------------
  describe("Inspection lookup", () => {
    it("returns 404 when inspection does not exist", async () => {
      mockDbSelect.mockResolvedValueOnce([]);

      const res = await POST(makeRequest(VALID_BODY), makeParams());
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toBe("Inspection not found");
    });

    it("returns 400 when inspection has no finalized PDF", async () => {
      mockDbSelect.mockResolvedValueOnce([{
        ...FINALIZED_INSPECTION,
        finalizedPdfPath: null,
      }]);

      const res = await POST(makeRequest(VALID_BODY), makeParams());
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/no finalized pdf/i);
    });
  });

  // -----------------------------------------------------------------------
  // 4. PDF download from storage
  // -----------------------------------------------------------------------
  describe("PDF download", () => {
    it("returns 500 when PDF download fails with error", async () => {
      mockDownload.mockResolvedValueOnce({
        data: null,
        error: { message: "Object not found" },
      });

      const res = await POST(makeRequest(VALID_BODY), makeParams());
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toMatch(/failed to download pdf/i);
    });

    it("returns 500 when PDF download returns null data", async () => {
      mockDownload.mockResolvedValueOnce({ data: null, error: null });

      const res = await POST(makeRequest(VALID_BODY), makeParams());
      expect(res.status).toBe(500);
    });

    it("returns 400 when PDF is too large (>35MB base64)", async () => {
      // Create a blob that would exceed 35MB when base64 encoded
      // 35MB / (4/3) = ~26.25MB raw. We need raw > 26.25MB.
      const largeBuffer = Buffer.alloc(27 * 1024 * 1024);
      const largeBlob = new Blob([largeBuffer], { type: "application/pdf" });
      mockDownload.mockResolvedValueOnce({ data: largeBlob, error: null });

      const res = await POST(makeRequest(VALID_BODY), makeParams());
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/too large/i);
    });
  });

  // -----------------------------------------------------------------------
  // 5. Resend API integration
  // -----------------------------------------------------------------------
  describe("Resend email sending", () => {
    it("sends email via Resend with correct parameters", async () => {
      const res = await POST(makeRequest(VALID_BODY), makeParams());
      expect(res.status).toBe(200);
      expect(mockResendSend).toHaveBeenCalledTimes(1);

      const sendArgs = mockResendSend.mock.calls[0][0];
      expect(sendArgs.to).toEqual(["customer@example.com"]);
      expect(sendArgs.subject).toBe("Your Inspection Report");
      expect(sendArgs.attachments).toHaveLength(1);
      expect(sendArgs.attachments[0].filename).toBe("123-Main-St_ADEQ_2026-03-03.pdf");
    });

    it("includes personal note in email body when provided", async () => {
      const res = await POST(makeRequest(VALID_BODY), makeParams());
      expect(res.status).toBe(200);

      const sendArgs = mockResendSend.mock.calls[0][0];
      expect(sendArgs.text).toContain("Thank you for your business!");
    });

    it("omits personal note section when not provided", async () => {
      const body = { ...VALID_BODY, personalNote: undefined };
      const res = await POST(makeRequest(body), makeParams());
      expect(res.status).toBe(200);

      const sendArgs = mockResendSend.mock.calls[0][0];
      // Should still have the standard email body without the note
      expect(sendArgs.text).toContain("inspection report");
    });

    it("returns 500 when Resend API throws Error", async () => {
      mockResendSend.mockRejectedValueOnce(new Error("API rate limit exceeded"));

      const res = await POST(makeRequest(VALID_BODY), makeParams());
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toMatch(/failed to send email/i);
      expect(json.error).toContain("API rate limit exceeded");
    });

    it("returns 500 with generic message when non-Error is thrown", async () => {
      mockResendSend.mockRejectedValueOnce("unexpected error");

      const res = await POST(makeRequest(VALID_BODY), makeParams());
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toMatch(/unknown error/i);
    });
  });

  // -----------------------------------------------------------------------
  // 6. Post-send record keeping
  // -----------------------------------------------------------------------
  describe("Post-send record keeping", () => {
    it("returns success with sentAt timestamp", async () => {
      const res = await POST(makeRequest(VALID_BODY), makeParams());
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.success).toBe(true);
      expect(json.sentAt).toBeDefined();
      // Verify it's a valid ISO date string
      expect(new Date(json.sentAt).toISOString()).toBe(json.sentAt);
    });

    it("records email send history in database", async () => {
      await POST(makeRequest(VALID_BODY), makeParams());

      const { db } = await import("@/lib/db");
      expect(vi.mocked(db.insert)).toHaveBeenCalled();
    });

    it("updates customerEmail on the inspection", async () => {
      await POST(makeRequest(VALID_BODY), makeParams());

      const { db } = await import("@/lib/db");
      expect(vi.mocked(db.update)).toHaveBeenCalled();
    });

    it("does not record email history if Resend fails", async () => {
      mockResendSend.mockRejectedValueOnce(new Error("Resend failed"));

      await POST(makeRequest(VALID_BODY), makeParams());

      const { db } = await import("@/lib/db");
      expect(vi.mocked(db.insert)).not.toHaveBeenCalled();
    });
  });
});
