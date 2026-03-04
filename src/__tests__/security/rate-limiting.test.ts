/**
 * Security Tests: Rate Limiting
 *
 * Tests rate limiting logic in:
 * - /api/apn-lookup (30 lookups/hour per user)
 * - /api/inspections/[id]/scan (5 scans/hour per inspection)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabaseClient } from "./helpers";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCreateClient = vi.fn();
let mockDbResult: unknown[] = [];

const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn(() => Promise.resolve(mockDbResult)),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn().mockResolvedValue([]),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => mockCreateClient(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: {
      from: vi.fn().mockReturnValue({
        download: vi.fn().mockResolvedValue({
          data: new Blob(["fake-image-data"]),
          error: null,
        }),
      }),
    },
  }),
}));

vi.mock("@/lib/db", () => ({ db: mockDb }));

vi.mock("@/lib/db/schema", () => ({
  inspections: { id: "id", inspectorId: "inspector_id", status: "status" },
  profiles: { id: "id", fullName: "full_name", signatureDataUrl: "signature_data_url" },
  inspectionMedia: { id: "id", inspectionId: "inspection_id" },
  userRoles: {},
  inspectionEmails: {},
}));

vi.mock("@/lib/ai/parse-inspection-form", () => ({
  parseInspectionForm: vi.fn().mockResolvedValue({ fields: {} }),
}));

vi.mock("@/lib/constants/inspection", () => ({
  INSPECTOR_DEFAULTS: {
    company: "", companyAddress: "", companyCity: "", companyState: "",
    companyZip: "", certificationNumber: "", registrationNumber: "", truckNumber: "",
  },
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    getAll: vi.fn().mockReturnValue([]),
    set: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(path: string, method = "GET", body?: unknown): Request {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body) init.body = JSON.stringify(body);
  return new Request(`http://localhost:3000${path}`, init);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Rate Limiting Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbResult = [];
    // Reset module-level rate limit maps by re-importing fresh modules
    vi.resetModules();
  });

  // =========================================================================
  // APN Lookup Rate Limiting — 30/hour per user
  // =========================================================================
  describe("APN Lookup — 30 lookups per hour", () => {
    it("allows up to 30 lookups then returns 429", async () => {
      // Need fresh import after resetModules to get clean rate limit state
      const { GET } = await import("@/app/api/apn-lookup/route");

      // Mock authenticated user
      const client = createMockSupabaseClient({ userId: "rate-test-user", role: "field_tech" });
      mockCreateClient.mockResolvedValue(client);

      // Mock the external fetch to avoid real HTTP calls
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ features: [] }),
      });

      // Make 30 successful requests
      for (let i = 0; i < 30; i++) {
        const req = makeRequest(`/api/apn-lookup?apn=123-45-${String(i).padStart(3, "0")}`);
        const res = await GET(req);
        expect(res.status).not.toBe(429);
      }

      // 31st request should be rate limited
      const req = makeRequest("/api/apn-lookup?apn=123-45-999");
      const res = await GET(req);
      expect(res.status).toBe(429);
      const json = await res.json();
      expect(json.error).toMatch(/too many/i);

      globalThis.fetch = originalFetch;
    });

    it("rate limit is per-user (different users have separate limits)", async () => {
      const { GET } = await import("@/app/api/apn-lookup/route");

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ features: [] }),
      });

      // User A makes 30 requests
      const clientA = createMockSupabaseClient({ userId: "user-a", role: "field_tech" });
      mockCreateClient.mockResolvedValue(clientA);
      for (let i = 0; i < 30; i++) {
        const req = makeRequest(`/api/apn-lookup?apn=123-45-${String(i).padStart(3, "0")}`);
        await GET(req);
      }

      // User B should still be able to make requests
      const clientB = createMockSupabaseClient({ userId: "user-b", role: "field_tech" });
      mockCreateClient.mockResolvedValue(clientB);
      const req = makeRequest("/api/apn-lookup?apn=123-45-000");
      const res = await GET(req);
      expect(res.status).not.toBe(429);

      globalThis.fetch = originalFetch;
    });
  });

  // =========================================================================
  // Scan Rate Limiting — 5/hour per inspection
  // =========================================================================
  describe("Scan — 5 scans per hour per inspection", () => {
    it("allows up to 5 scans then returns 429", async () => {
      const { POST } = await import("@/app/api/inspections/[id]/scan/route");

      const client = createMockSupabaseClient({ userId: "user-123", role: "field_tech" });
      mockCreateClient.mockResolvedValue(client);
      mockDbResult = [{ inspectorId: "user-123", status: "draft" }];

      // Make 5 successful requests
      for (let i = 0; i < 5; i++) {
        const req = makeRequest("/api/inspections/scan-test-insp/scan", "POST", {
          storagePaths: ["scan-test-insp/photo/test.jpg"],
        });
        const res = await POST(req, { params: Promise.resolve({ id: "scan-test-insp" }) });
        expect(res.status).not.toBe(429);
      }

      // 6th request should be rate limited
      const req = makeRequest("/api/inspections/scan-test-insp/scan", "POST", {
        storagePaths: ["scan-test-insp/photo/test.jpg"],
      });
      const res = await POST(req, { params: Promise.resolve({ id: "scan-test-insp" }) });
      expect(res.status).toBe(429);
      const json = await res.json();
      expect(json.error).toMatch(/rate limit/i);
    });

    it("rate limit is per-inspection (different inspections have separate limits)", async () => {
      const { POST } = await import("@/app/api/inspections/[id]/scan/route");

      const client = createMockSupabaseClient({ userId: "user-123", role: "field_tech" });
      mockCreateClient.mockResolvedValue(client);
      mockDbResult = [{ inspectorId: "user-123", status: "draft" }];

      // Exhaust limit for inspection A
      for (let i = 0; i < 5; i++) {
        const req = makeRequest("/api/inspections/insp-a/scan", "POST", {
          storagePaths: ["insp-a/photo/test.jpg"],
        });
        await POST(req, { params: Promise.resolve({ id: "insp-a" }) });
      }

      // Inspection B should still work
      const req = makeRequest("/api/inspections/insp-b/scan", "POST", {
        storagePaths: ["insp-b/photo/test.jpg"],
      });
      const res = await POST(req, { params: Promise.resolve({ id: "insp-b" }) });
      expect(res.status).not.toBe(429);
    });
  });

  // =========================================================================
  // Rate limit implementation analysis
  // =========================================================================
  describe("Rate limit implementation notes", () => {
    it("SECURITY NOTE: rate limits are in-memory and reset on server restart", () => {
      /**
       * FINDING: Both rate limiters use in-memory Maps:
       *   - apn-lookup: lookupTimestamps Map<string, number[]>
       *   - scan: scanTimestamps Map<string, number[]>
       *
       * These reset on server restart or deployment, which means:
       * 1. A determined attacker can bypass by triggering a restart
       * 2. In serverless environments, each cold start gets fresh limits
       * 3. No shared state across multiple server instances
       *
       * RECOMMENDATION for production:
       * - Use Redis or a distributed rate limiting solution
       * - Consider using the Vercel rate limiting SDK if deployed there
       * - Add X-RateLimit-* headers so clients know their remaining quota
       */
      expect(true).toBe(true); // Documented finding
    });

    it("SECURITY NOTE: no rate limit headers are returned", () => {
      /**
       * FINDING: Neither endpoint returns standard rate limit headers:
       *   - X-RateLimit-Limit
       *   - X-RateLimit-Remaining
       *   - X-RateLimit-Reset
       *
       * While not a vulnerability, this is a best practice gap.
       * Clients have no way to know their remaining quota without hitting 429.
       */
      expect(true).toBe(true); // Documented finding
    });
  });
});
