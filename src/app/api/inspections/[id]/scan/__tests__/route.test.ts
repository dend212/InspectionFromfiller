import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — use vi.hoisted so variables are available inside vi.mock factories
// ---------------------------------------------------------------------------

const {
  mockGetUser,
  mockGetSession,
  mockCreateClient,
  mockDownload,
  mockCreateAdminClient,
  mockDbSelect,
  mockParseInspectionForm,
} = vi.hoisted(() => {
  const mockGetUser = vi.fn();
  const mockGetSession = vi.fn();
  const mockDownload = vi.fn();
  const mockDbSelect = vi.fn();
  const mockParseInspectionForm = vi.fn();

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
    mockParseInspectionForm,
  };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/ai/parse-inspection-form", () => ({
  parseInspectionForm: mockParseInspectionForm,
}));

// Mock drizzle — the route does: db.select({...}).from(inspections).where(...).limit(1)
vi.mock("@/lib/db", () => {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(() => mockDbSelect()),
  };
  return {
    db: { select: vi.fn(() => chain) },
  };
});

vi.mock("@/lib/db/schema", () => ({
  inspections: { id: "id", inspectorId: "inspector_id", status: "status" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ _col, val })),
}));

// ---------------------------------------------------------------------------
// Import the handler under test (AFTER mocks are set up)
// ---------------------------------------------------------------------------
import { POST } from "../route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Each test gets a unique inspection ID to avoid cross-test rate-limit
 * contamination (the rate-limit map is module-scoped and cannot be cleared).
 */
let testCounter = 0;
function uniqueId(): string {
  return `test-${++testCounter}-${Date.now()}`;
}

function makeRequest(body: unknown, id: string): Request {
  return new Request(`http://localhost/api/inspections/${id}/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeRawRequest(rawBody: string, id: string): Request {
  return new Request(`http://localhost/api/inspections/${id}/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: rawBody,
  });
}

function makeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

/** Encode a JWT payload section (used to fake role in access_token) */
function fakeAccessToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64");
  return `${header}.${body}.fakesig`;
}

/** Create a Blob-like object that has an `arrayBuffer()` method */
function fakeBlob(content: string = "image-bytes"): Blob {
  return new Blob([content], { type: "image/jpeg" });
}

const VALID_USER = { id: "user-1", email: "test@example.com" };
const OWNED_INSPECTION = { inspectorId: "user-1", status: "draft" };
const OTHER_INSPECTION = { inspectorId: "user-other", status: "draft" };

const MOCK_SCAN_RESULT = {
  fields: [
    {
      fieldPath: "facilityInfo.facilityName",
      value: "Test Facility",
      confidence: 0.95,
      source: "Page 1, top-left",
    },
  ],
  metadata: {
    pagesProcessed: 1,
    totalFieldsExtracted: 1,
    processingTimeMs: 1200,
  },
};

// ---------------------------------------------------------------------------
// Reset mocks between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // Defaults — happy path authenticated owner
  mockGetUser.mockResolvedValue({ data: { user: VALID_USER } });
  mockGetSession.mockResolvedValue({
    data: {
      session: {
        access_token: fakeAccessToken({ user_role: "field_tech" }),
      },
    },
  });
  mockDbSelect.mockResolvedValue([OWNED_INSPECTION]);
  mockDownload.mockResolvedValue({ data: fakeBlob(), error: null });
  mockParseInspectionForm.mockResolvedValue(MOCK_SCAN_RESULT);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/inspections/[id]/scan", () => {
  // -----------------------------------------------------------------------
  // 1. Authentication
  // -----------------------------------------------------------------------
  describe("Authentication", () => {
    it("returns 401 when user is not authenticated", async () => {
      const id = uniqueId();
      mockGetUser.mockResolvedValueOnce({ data: { user: null } });

      const res = await POST(
        makeRequest({ storagePaths: [`${id}/photo.jpg`] }, id),
        makeParams(id),
      );

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe("Unauthorized");
    });
  });

  // -----------------------------------------------------------------------
  // 2. Authorization
  // -----------------------------------------------------------------------
  describe("Authorization", () => {
    it("returns 403 when user is not the owner and has no privileged role", async () => {
      const id = uniqueId();
      mockDbSelect.mockResolvedValueOnce([OTHER_INSPECTION]);
      mockGetSession.mockResolvedValueOnce({
        data: {
          session: {
            access_token: fakeAccessToken({ user_role: "field_tech" }),
          },
        },
      });

      const res = await POST(
        makeRequest({ storagePaths: [`${id}/photo.jpg`] }, id),
        makeParams(id),
      );

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe("Forbidden");
    });

    it("allows admin access even when not owner", async () => {
      const id = uniqueId();
      mockDbSelect.mockResolvedValueOnce([OTHER_INSPECTION]);
      mockGetSession.mockResolvedValueOnce({
        data: {
          session: {
            access_token: fakeAccessToken({ user_role: "admin" }),
          },
        },
      });

      const res = await POST(
        makeRequest({ storagePaths: [`${id}/photo.jpg`] }, id),
        makeParams(id),
      );

      expect(res.status).toBe(200);
    });

    it("allows office_staff access even when not owner", async () => {
      const id = uniqueId();
      mockDbSelect.mockResolvedValueOnce([OTHER_INSPECTION]);
      mockGetSession.mockResolvedValueOnce({
        data: {
          session: {
            access_token: fakeAccessToken({ user_role: "office_staff" }),
          },
        },
      });

      const res = await POST(
        makeRequest({ storagePaths: [`${id}/photo.jpg`] }, id),
        makeParams(id),
      );

      expect(res.status).toBe(200);
    });

    it("returns 403 when session decode fails for non-owner", async () => {
      const id = uniqueId();
      mockDbSelect.mockResolvedValueOnce([OTHER_INSPECTION]);
      mockGetSession.mockResolvedValueOnce({
        data: { session: { access_token: "not.valid-base64.token" } },
      });

      const res = await POST(
        makeRequest({ storagePaths: [`${id}/photo.jpg`] }, id),
        makeParams(id),
      );

      expect(res.status).toBe(403);
    });

    it("returns 403 when no session exists for non-owner", async () => {
      const id = uniqueId();
      mockDbSelect.mockResolvedValueOnce([OTHER_INSPECTION]);
      mockGetSession.mockResolvedValueOnce({
        data: { session: null },
      });

      const res = await POST(
        makeRequest({ storagePaths: [`${id}/photo.jpg`] }, id),
        makeParams(id),
      );

      expect(res.status).toBe(403);
    });
  });

  // -----------------------------------------------------------------------
  // 3. Inspection not found
  // -----------------------------------------------------------------------
  describe("Inspection not found", () => {
    it("returns 404 when inspection does not exist", async () => {
      const id = uniqueId();
      mockDbSelect.mockResolvedValueOnce([]);

      const res = await POST(
        makeRequest({ storagePaths: [`${id}/photo.jpg`] }, id),
        makeParams(id),
      );

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toBe("Inspection not found");
    });
  });

  // -----------------------------------------------------------------------
  // 4. Rate limiting
  // -----------------------------------------------------------------------
  describe("Rate limiting", () => {
    it("returns 429 after 5 scans per hour for the same inspection", async () => {
      const id = uniqueId();

      // First 5 should succeed
      for (let i = 0; i < 5; i++) {
        const res = await POST(
          makeRequest({ storagePaths: [`${id}/photo.jpg`] }, id),
          makeParams(id),
        );
        expect(res.status).toBe(200);
      }

      // 6th should be rate limited
      const res = await POST(
        makeRequest({ storagePaths: [`${id}/photo.jpg`] }, id),
        makeParams(id),
      );
      expect(res.status).toBe(429);
      const json = await res.json();
      expect(json.error).toMatch(/rate limit/i);
    });
  });

  // -----------------------------------------------------------------------
  // 5. Input validation
  // -----------------------------------------------------------------------
  describe("Input validation", () => {
    it("returns 400 when storagePaths is missing", async () => {
      const id = uniqueId();
      const res = await POST(makeRequest({}, id), makeParams(id));

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/storagePaths/i);
    });

    it("returns 400 when storagePaths is an empty array", async () => {
      const id = uniqueId();
      const res = await POST(makeRequest({ storagePaths: [] }, id), makeParams(id));

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/storagePaths/i);
    });

    it("returns 400 when storagePaths has more than 10 items", async () => {
      const id = uniqueId();
      const paths = Array.from({ length: 11 }, (_, i) => `${id}/photo${i}.jpg`);
      const res = await POST(makeRequest({ storagePaths: paths }, id), makeParams(id));

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/storagePaths/i);
    });

    it("returns 400 when a path does not start with the inspection ID", async () => {
      const id = uniqueId();
      const res = await POST(
        makeRequest({ storagePaths: ["wrong-id/photo.jpg"] }, id),
        makeParams(id),
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/invalid storage path/i);
    });

    it("returns 400 when storagePaths is not an array", async () => {
      const id = uniqueId();
      const res = await POST(
        makeRequest({ storagePaths: "not-an-array" }, id),
        makeParams(id),
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/storagePaths/i);
    });

    it("returns 400 when a path entry is not a string", async () => {
      const id = uniqueId();
      const res = await POST(
        makeRequest({ storagePaths: [123] }, id),
        makeParams(id),
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/invalid storage path/i);
    });

    it("returns 400 when request body is not valid JSON", async () => {
      const id = uniqueId();
      const res = await POST(makeRawRequest("not-json{{{", id), makeParams(id));

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/invalid request body/i);
    });
  });

  // -----------------------------------------------------------------------
  // 6. Successful scan
  // -----------------------------------------------------------------------
  describe("Successful scan", () => {
    it("returns parsed scan result with correct shape", async () => {
      const id = uniqueId();
      const res = await POST(
        makeRequest({ storagePaths: [`${id}/photo.jpg`] }, id),
        makeParams(id),
      );

      expect(res.status).toBe(200);
      const json = await res.json();

      // Verify shape matches ScanResult
      expect(json).toHaveProperty("fields");
      expect(json).toHaveProperty("metadata");
      expect(Array.isArray(json.fields)).toBe(true);
      expect(json.fields[0]).toHaveProperty("fieldPath");
      expect(json.fields[0]).toHaveProperty("value");
      expect(json.fields[0]).toHaveProperty("confidence");
      expect(json.fields[0]).toHaveProperty("source");
      expect(json.metadata).toHaveProperty("pagesProcessed");
      expect(json.metadata).toHaveProperty("totalFieldsExtracted");
      expect(json.metadata).toHaveProperty("processingTimeMs");
    });

    it("passes downloaded images to parseInspectionForm", async () => {
      const id = uniqueId();
      await POST(
        makeRequest({ storagePaths: [`${id}/photo1.jpg`, `${id}/photo2.png`] }, id),
        makeParams(id),
      );

      expect(mockParseInspectionForm).toHaveBeenCalledTimes(1);
      const images = mockParseInspectionForm.mock.calls[0][0];
      expect(images).toHaveLength(2);
      expect(images[0]).toHaveProperty("data");
      expect(images[0]).toHaveProperty("mediaType", "image/jpeg");
      expect(images[1]).toHaveProperty("mediaType", "image/png");
    });

    it("correctly maps file extensions to media types", async () => {
      const id = uniqueId();
      mockDownload.mockResolvedValue({ data: fakeBlob(), error: null });

      await POST(
        makeRequest(
          {
            storagePaths: [
              `${id}/a.jpg`,
              `${id}/b.jpeg`,
              `${id}/c.png`,
              `${id}/d.webp`,
              `${id}/e.gif`,
              `${id}/f.bmp`, // unknown extension -> defaults to image/jpeg
            ],
          },
          id,
        ),
        makeParams(id),
      );

      const images = mockParseInspectionForm.mock.calls[0][0];
      expect(images[0].mediaType).toBe("image/jpeg");
      expect(images[1].mediaType).toBe("image/jpeg");
      expect(images[2].mediaType).toBe("image/png");
      expect(images[3].mediaType).toBe("image/webp");
      expect(images[4].mediaType).toBe("image/gif");
      expect(images[5].mediaType).toBe("image/jpeg"); // fallback
    });

    it("downloads from the correct storage bucket", async () => {
      const id = uniqueId();
      const storagePath = `${id}/photo.jpg`;
      await POST(makeRequest({ storagePaths: [storagePath] }, id), makeParams(id));

      expect(mockDownload).toHaveBeenCalledWith(storagePath);
    });
  });

  // -----------------------------------------------------------------------
  // 7. Storage download failure
  // -----------------------------------------------------------------------
  describe("Storage download failure", () => {
    it("returns 500 when image download fails with error", async () => {
      const id = uniqueId();
      mockDownload.mockResolvedValueOnce({
        data: null,
        error: { message: "Object not found" },
      });

      const res = await POST(
        makeRequest({ storagePaths: [`${id}/missing.jpg`] }, id),
        makeParams(id),
      );

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toMatch(/failed to download/i);
      expect(json.error).toContain(`${id}/missing.jpg`);
    });

    it("returns 500 when download returns null data without error", async () => {
      const id = uniqueId();
      mockDownload.mockResolvedValueOnce({ data: null, error: null });

      const res = await POST(
        makeRequest({ storagePaths: [`${id}/empty.jpg`] }, id),
        makeParams(id),
      );

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toMatch(/failed to download/i);
    });
  });

  // -----------------------------------------------------------------------
  // 8. AI parsing error
  // -----------------------------------------------------------------------
  describe("AI parsing error", () => {
    it("returns 500 with error message when parseInspectionForm throws", async () => {
      const id = uniqueId();
      mockParseInspectionForm.mockRejectedValueOnce(new Error("AI service unavailable"));

      const res = await POST(
        makeRequest({ storagePaths: [`${id}/photo.jpg`] }, id),
        makeParams(id),
      );

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe("AI service unavailable");
    });

    it("returns generic message when non-Error is thrown", async () => {
      const id = uniqueId();
      mockParseInspectionForm.mockRejectedValueOnce("unexpected string error");

      const res = await POST(
        makeRequest({ storagePaths: [`${id}/photo.jpg`] }, id),
        makeParams(id),
      );

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe("Failed to parse form scan");
    });
  });
});
