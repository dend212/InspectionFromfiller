/**
 * Security Tests: Webhook Security
 *
 * Tests the Workiz webhook endpoint for:
 * - Missing Authorization header
 * - Wrong bearer token
 * - Timing-safe comparison
 * - Malformed payload handling
 * - Replay protection / idempotency
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let mockDbResult: unknown[] = [];
let mockReturningResult: unknown[] = [];

const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn(() => Promise.resolve(mockDbResult)),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn(() => Promise.resolve(mockReturningResult)),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
};

vi.mock("@/lib/db", () => ({ db: mockDb }));

vi.mock("@/lib/db/schema", () => ({
  inspections: {
    id: "id",
    inspectorId: "inspector_id",
    status: "status",
    formData: "form_data",
    workizJobId: "workiz_job_id",
  },
  profiles: { id: "id", fullName: "full_name", email: "email" },
  inspectionMedia: {},
  userRoles: {},
  inspectionEmails: {},
}));

vi.mock("@/lib/validators/inspection", () => ({
  getDefaultFormValues: vi.fn().mockReturnValue({
    facilityInfo: {
      facilityName: "",
      facilityAddress: "",
      facilityCity: "",
      facilityCounty: "",
      facilityState: "AZ",
      facilityZip: "",
      taxParcelNumber: "",
      sellerName: "",
      dateOfInspection: "",
    },
  }),
}));

// Real workiz webhook schema for proper validation testing
vi.mock("@/lib/validators/workiz-webhook", async () => {
  const actual = await vi.importActual("@/lib/validators/workiz-webhook");
  return actual;
});

vi.mock("@/lib/constants/inspection", () => ({
  INSPECTOR_DEFAULTS: {
    company: "",
    companyAddress: "",
    companyCity: "",
    companyState: "",
    companyZip: "",
    certificationNumber: "",
    registrationNumber: "",
    truckNumber: "",
  },
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    getAll: vi.fn().mockReturnValue([]),
    set: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Environment setup
// ---------------------------------------------------------------------------

const WEBHOOK_SECRET = "test-webhook-secret-12345";

function makeWebhookRequest(
  body: unknown,
  authHeader?: string,
): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authHeader !== undefined) {
    headers["authorization"] = authHeader;
  }
  return new Request("http://localhost:3000/api/webhooks/workiz", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const VALID_PAYLOAD = {
  client: { firstName: "John", lastName: "Doe", email: "john@test.com" },
  address: { street: "123 Main St", city: "Phoenix", state: "AZ", zip: "85001", county: "Maricopa" },
  job: { jobId: "WZ-001", jobType: "ADEQ Inspection", scheduledDate: "2024-03-15" },
  tech: { email: "tech@test.com", name: "Test Tech" },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Webhook Security Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbResult = [];
    mockReturningResult = [];
    process.env.WORKIZ_WEBHOOK_SECRET = WEBHOOK_SECRET;
  });

  afterEach(() => {
    delete process.env.WORKIZ_WEBHOOK_SECRET;
  });

  // =========================================================================
  // Missing auth header
  // =========================================================================
  describe("Missing Authorization header", () => {
    it("returns 401 when no Authorization header is present", async () => {
      const { POST } = await import("@/app/api/webhooks/workiz/route");
      const req = new Request("http://localhost:3000/api/webhooks/workiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(VALID_PAYLOAD),
      });
      const res = await POST(req);
      expect(res.status).toBe(401);
    });

    it("returns 401 when Authorization header is empty", async () => {
      const { POST } = await import("@/app/api/webhooks/workiz/route");
      const req = makeWebhookRequest(VALID_PAYLOAD, "");
      const res = await POST(req);
      expect(res.status).toBe(401);
    });

    it("returns 401 when Authorization header is not Bearer type", async () => {
      const { POST } = await import("@/app/api/webhooks/workiz/route");
      const req = makeWebhookRequest(VALID_PAYLOAD, `Basic ${WEBHOOK_SECRET}`);
      const res = await POST(req);
      expect(res.status).toBe(401);
    });
  });

  // =========================================================================
  // Wrong bearer token
  // =========================================================================
  describe("Wrong bearer token", () => {
    it("returns 401 with incorrect token", async () => {
      const { POST } = await import("@/app/api/webhooks/workiz/route");
      const req = makeWebhookRequest(VALID_PAYLOAD, "Bearer wrong-token");
      const res = await POST(req);
      expect(res.status).toBe(401);
    });

    it("returns 401 with partially correct token", async () => {
      const { POST } = await import("@/app/api/webhooks/workiz/route");
      const req = makeWebhookRequest(VALID_PAYLOAD, `Bearer ${WEBHOOK_SECRET}extra`);
      const res = await POST(req);
      expect(res.status).toBe(401);
    });

    it("returns 401 with token that is a prefix of the secret", async () => {
      const { POST } = await import("@/app/api/webhooks/workiz/route");
      const req = makeWebhookRequest(VALID_PAYLOAD, `Bearer ${WEBHOOK_SECRET.slice(0, -1)}`);
      const res = await POST(req);
      expect(res.status).toBe(401);
    });
  });

  // =========================================================================
  // Timing-safe comparison verification
  // =========================================================================
  describe("Timing-safe comparison", () => {
    it("correctly authenticates with the exact secret", async () => {
      /**
       * VERIFIED BY CODE REVIEW: The webhook route (workiz/route.ts lines 36-38) uses:
       *   const tokenBuf = Buffer.from(token);
       *   const secretBuf = Buffer.from(secret);
       *   if (tokenBuf.length !== secretBuf.length || !crypto.timingSafeEqual(tokenBuf, secretBuf))
       *
       * This is the correct pattern for timing-safe comparison.
       * The length check before timingSafeEqual is necessary because
       * timingSafeEqual throws if buffers are different lengths.
       *
       * We can't spy on ESM crypto.timingSafeEqual, so we verify behavior:
       */
      // Mock: tech lookup returns a profile, idempotency check returns nothing
      mockDb.limit
        .mockResolvedValueOnce([]) // idempotency check
        .mockResolvedValueOnce([{ id: "tech-123", fullName: "Test Tech" }]); // email lookup
      mockDb.returning.mockResolvedValueOnce([{ id: "new-insp", status: "draft" }]);

      const { POST } = await import("@/app/api/webhooks/workiz/route");
      const req = makeWebhookRequest(VALID_PAYLOAD, `Bearer ${WEBHOOK_SECRET}`);
      const res = await POST(req);
      // Should succeed (not 401) since we're using the correct token
      expect(res.status).not.toBe(401);
    });

    it("rejects different-length tokens", async () => {
      const { POST } = await import("@/app/api/webhooks/workiz/route");
      const req = makeWebhookRequest(VALID_PAYLOAD, "Bearer x");
      const res = await POST(req);
      expect(res.status).toBe(401);
    });

    it("rejects same-length but different tokens", async () => {
      const { POST } = await import("@/app/api/webhooks/workiz/route");
      // Create a token with the same length but different content
      const wrongToken = "x".repeat(WEBHOOK_SECRET.length);
      const req = makeWebhookRequest(VALID_PAYLOAD, `Bearer ${wrongToken}`);
      const res = await POST(req);
      expect(res.status).toBe(401);
    });
  });

  // =========================================================================
  // Missing/misconfigured server secret
  // =========================================================================
  describe("Server misconfiguration", () => {
    it("returns 500 when WORKIZ_WEBHOOK_SECRET is not configured", async () => {
      delete process.env.WORKIZ_WEBHOOK_SECRET;
      const { POST } = await import("@/app/api/webhooks/workiz/route");
      const req = makeWebhookRequest(VALID_PAYLOAD, `Bearer ${WEBHOOK_SECRET}`);
      const res = await POST(req);
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toMatch(/misconfigured/i);
    });
  });

  // =========================================================================
  // Malformed payload handling
  // =========================================================================
  describe("Malformed payload handling", () => {
    it("returns 400 for invalid JSON body", async () => {
      const { POST } = await import("@/app/api/webhooks/workiz/route");
      const req = new Request("http://localhost:3000/api/webhooks/workiz", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authorization: `Bearer ${WEBHOOK_SECRET}`,
        },
        body: "this is not json{{{",
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/invalid json/i);
    });

    it("returns 400 when required fields are missing", async () => {
      const { POST } = await import("@/app/api/webhooks/workiz/route");
      const req = makeWebhookRequest(
        { client: {}, address: {} }, // missing required fields
        `Bearer ${WEBHOOK_SECRET}`,
      );
      const res = await POST(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/validation/i);
    });

    it("returns 400 when client.firstName is empty", async () => {
      const { POST } = await import("@/app/api/webhooks/workiz/route");
      const req = makeWebhookRequest(
        {
          ...VALID_PAYLOAD,
          client: { firstName: "", lastName: "Doe" },
        },
        `Bearer ${WEBHOOK_SECRET}`,
      );
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("returns 400 when address.street is empty", async () => {
      const { POST } = await import("@/app/api/webhooks/workiz/route");
      const req = makeWebhookRequest(
        {
          ...VALID_PAYLOAD,
          address: { ...VALID_PAYLOAD.address, street: "" },
        },
        `Bearer ${WEBHOOK_SECRET}`,
      );
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("returns 400 when tech has neither email nor name", async () => {
      const { POST } = await import("@/app/api/webhooks/workiz/route");
      const req = makeWebhookRequest(
        {
          ...VALID_PAYLOAD,
          tech: { email: "", name: "" },
        },
        `Bearer ${WEBHOOK_SECRET}`,
      );
      const res = await POST(req);
      expect(res.status).toBe(400);
    });
  });

  // =========================================================================
  // Idempotency — duplicate job handling
  // =========================================================================
  describe("Idempotency", () => {
    it("returns existing inspection for duplicate jobId", async () => {
      // Mock: first limit() returns existing inspection (idempotency check)
      mockDb.limit.mockResolvedValueOnce([
        { id: "existing-insp", status: "draft" },
      ]);

      const { POST } = await import("@/app/api/webhooks/workiz/route");
      const req = makeWebhookRequest(VALID_PAYLOAD, `Bearer ${WEBHOOK_SECRET}`);
      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.duplicate).toBe(true);
      expect(json.inspectionId).toBe("existing-insp");
    });
  });

  // =========================================================================
  // Non-ADEQ job type skipping
  // =========================================================================
  describe("Job type filtering", () => {
    it("skips non-ADEQ jobs gracefully", async () => {
      const { POST } = await import("@/app/api/webhooks/workiz/route");
      const payload = {
        ...VALID_PAYLOAD,
        job: { ...VALID_PAYLOAD.job, jobType: "Plumbing Repair", serviceType: "" },
      };
      const req = makeWebhookRequest(payload, `Bearer ${WEBHOOK_SECRET}`);
      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.skipped).toBe(true);
    });
  });
});
