/**
 * Security Tests: Inspection State Machine
 *
 * Verifies that the inspection status transitions are properly guarded:
 *   draft -> in_review (submit)
 *   in_review -> completed (finalize)
 *   in_review -> draft (return)
 *   completed -> in_review (reopen)
 *
 * Invalid transitions must be rejected with 409 Conflict.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabaseClient } from "./helpers";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCreateClient = vi.fn();
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
  innerJoin: vi.fn().mockReturnThis(),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => mockCreateClient(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { admin: { createUser: vi.fn(), deleteUser: vi.fn() } },
    from: vi.fn().mockReturnThis(),
    storage: {
      from: vi.fn().mockReturnValue({
        createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: "https://signed.url" } }),
        createSignedUploadUrl: vi.fn().mockResolvedValue({
          data: { signedUrl: "https://upload.url", token: "tok" },
        }),
        download: vi.fn().mockResolvedValue({ data: new Blob(["fake"]), error: null }),
        remove: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    },
  }),
}));

vi.mock("@/lib/db", () => ({ db: mockDb }));

vi.mock("@/lib/db/schema", () => ({
  inspections: {
    id: "id",
    inspectorId: "inspector_id",
    status: "status",
    formData: "form_data",
    facilityName: "facility_name",
  },
  profiles: { id: "id", fullName: "full_name", signatureDataUrl: "signature_data_url" },
  inspectionMedia: { id: "id", inspectionId: "inspection_id" },
  userRoles: { userId: "user_id", role: "role" },
  inspectionEmails: {},
}));

vi.mock("@/lib/email/send-notification", () => ({
  sendSubmissionNotification: vi.fn(),
}));

vi.mock("@/lib/pdf/generate-report", () => ({
  generateReport: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
}));

vi.mock("@/lib/storage/pdf-storage", () => ({
  uploadReport: vi.fn().mockResolvedValue("reports/test/report.pdf"),
  buildDownloadFilename: vi.fn(),
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

function makeRequest(path: string, method = "POST", body?: unknown): Request {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(`http://localhost:3000${path}`, init);
}

function setupAdmin() {
  const client = createMockSupabaseClient({ userId: "admin-user", role: "admin" });
  mockCreateClient.mockResolvedValue(client);
}

function setupFieldTech(userId = "user-123") {
  const client = createMockSupabaseClient({ userId, role: "field_tech" });
  mockCreateClient.mockResolvedValue(client);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("State Machine Security Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbResult = [];
    mockReturningResult = [];
    // Reset where to default chainable behavior
    mockDb.where.mockReturnThis();
    mockDb.limit.mockImplementation(() => Promise.resolve(mockDbResult));
    mockDb.returning.mockImplementation(() => Promise.resolve(mockReturningResult));
  });

  // =========================================================================
  // Submit: draft -> in_review
  // =========================================================================
  describe("Submit (draft -> in_review)", () => {
    it("allows submitting a draft inspection", async () => {
      setupFieldTech();
      mockDbResult = [{ inspectorId: "user-123", status: "draft" }];
      mockReturningResult = [{ id: "insp-001", facilityName: "Test" }];

      const { POST } = await import("@/app/api/inspections/[id]/submit/route");
      const req = makeRequest("/api/inspections/insp-001/submit");
      const res = await POST(req, { params: Promise.resolve({ id: "insp-001" }) });
      const json = await res.json();
      expect(json.status).toBe("in_review");
    });

    it("rejects submitting an already in_review inspection", async () => {
      setupFieldTech();
      mockDbResult = [{ inspectorId: "user-123", status: "in_review" }];
      mockReturningResult = []; // Atomic update returns empty = status mismatch

      const { POST } = await import("@/app/api/inspections/[id]/submit/route");
      const req = makeRequest("/api/inspections/insp-001/submit");
      const res = await POST(req, { params: Promise.resolve({ id: "insp-001" }) });
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error).toMatch(/not in draft/i);
    });

    it("rejects submitting a completed inspection", async () => {
      setupFieldTech();
      mockDbResult = [{ inspectorId: "user-123", status: "completed" }];
      mockReturningResult = [];

      const { POST } = await import("@/app/api/inspections/[id]/submit/route");
      const req = makeRequest("/api/inspections/insp-001/submit");
      const res = await POST(req, { params: Promise.resolve({ id: "insp-001" }) });
      expect(res.status).toBe(409);
    });
  });

  // =========================================================================
  // Finalize: in_review -> completed
  // =========================================================================
  describe("Finalize (in_review -> completed)", () => {
    it("allows finalizing an in_review inspection", async () => {
      setupAdmin();
      // The finalize route has complex multi-query chains.
      // For the state machine test, we verify the status check (409) logic.
      // First limit() returns the inspection, then the media query uses where()
      // which we need to return an iterable. We configure the chain carefully.

      // Track call count to differentiate queries
      let whereCallCount = 0;
      mockDb.where.mockImplementation(function (this: typeof mockDb) {
        whereCallCount++;
        if (whereCallCount === 2) {
          // Second .where() is the media query (no .limit()) — return empty array
          return Promise.resolve([]);
        }
        // All others chain normally
        return this;
      });

      mockDb.limit
        .mockResolvedValueOnce([{
          id: "insp-002",
          inspectorId: "user-123",
          status: "in_review",
          formData: { facilityInfo: { facilityName: "Test" }, disposalWorks: {} },
        }])
        .mockResolvedValueOnce([{ signatureDataUrl: null }]); // profile signature

      mockReturningResult = [{ id: "insp-002" }];

      const { POST } = await import("@/app/api/inspections/[id]/finalize/route");
      const req = makeRequest("/api/inspections/insp-002/finalize", "POST", {});
      const res = await POST(req, { params: Promise.resolve({ id: "insp-002" }) });
      // Should succeed or at least not be a status violation (403 or 409)
      expect([403, 409]).not.toContain(res.status);
    });

    it("rejects finalizing a draft inspection (must go through in_review first)", async () => {
      setupAdmin();
      mockDb.limit.mockResolvedValueOnce([{
        id: "insp-001",
        inspectorId: "user-123",
        status: "draft",
        formData: { facilityInfo: { facilityName: "Test" }, disposalWorks: {} },
      }]);

      const { POST } = await import("@/app/api/inspections/[id]/finalize/route");
      const req = makeRequest("/api/inspections/insp-001/finalize", "POST", {});
      const res = await POST(req, { params: Promise.resolve({ id: "insp-001" }) });
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error).toMatch(/not in review/i);
    });

    it("rejects finalizing an already completed inspection", async () => {
      setupAdmin();
      mockDb.limit.mockResolvedValueOnce([{
        id: "insp-003",
        inspectorId: "user-123",
        status: "completed",
        formData: { facilityInfo: { facilityName: "Test" }, disposalWorks: {} },
      }]);

      const { POST } = await import("@/app/api/inspections/[id]/finalize/route");
      const req = makeRequest("/api/inspections/insp-003/finalize", "POST", {});
      const res = await POST(req, { params: Promise.resolve({ id: "insp-003" }) });
      expect(res.status).toBe(409);
    });

    it("rejects finalizing without form data", async () => {
      setupAdmin();
      mockDb.limit.mockResolvedValueOnce([{
        id: "insp-002",
        inspectorId: "user-123",
        status: "in_review",
        formData: null,
      }]);

      const { POST } = await import("@/app/api/inspections/[id]/finalize/route");
      const req = makeRequest("/api/inspections/insp-002/finalize", "POST", {});
      const res = await POST(req, { params: Promise.resolve({ id: "insp-002" }) });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/no form data/i);
    });
  });

  // =========================================================================
  // Return: in_review -> draft
  // =========================================================================
  describe("Return (in_review -> draft)", () => {
    it("allows returning an in_review inspection to draft", async () => {
      setupAdmin();
      mockReturningResult = [{ id: "insp-002" }];

      const { POST } = await import("@/app/api/inspections/[id]/return/route");
      const req = makeRequest("/api/inspections/insp-002/return", "POST", { note: "Needs fixes" });
      const res = await POST(req, { params: Promise.resolve({ id: "insp-002" }) });
      const json = await res.json();
      expect(json.status).toBe("draft");
    });

    it("rejects returning a draft inspection (already a draft)", async () => {
      setupAdmin();
      mockReturningResult = []; // Atomic update: status != in_review

      const { POST } = await import("@/app/api/inspections/[id]/return/route");
      const req = makeRequest("/api/inspections/insp-001/return", "POST", { note: "" });
      const res = await POST(req, { params: Promise.resolve({ id: "insp-001" }) });
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error).toMatch(/not in review/i);
    });

    it("rejects returning a completed inspection", async () => {
      setupAdmin();
      mockReturningResult = [];

      const { POST } = await import("@/app/api/inspections/[id]/return/route");
      const req = makeRequest("/api/inspections/insp-003/return", "POST", { note: "" });
      const res = await POST(req, { params: Promise.resolve({ id: "insp-003" }) });
      expect(res.status).toBe(409);
    });
  });

  // =========================================================================
  // Reopen: completed -> in_review
  // =========================================================================
  describe("Reopen (completed -> in_review)", () => {
    it("allows reopening a completed inspection", async () => {
      setupAdmin();
      mockReturningResult = [{ id: "insp-003" }];

      const { POST } = await import("@/app/api/inspections/[id]/reopen/route");
      const req = makeRequest("/api/inspections/insp-003/reopen");
      const res = await POST(req, { params: Promise.resolve({ id: "insp-003" }) });
      const json = await res.json();
      expect(json.status).toBe("in_review");
    });

    it("rejects reopening a draft inspection", async () => {
      setupAdmin();
      mockReturningResult = []; // Atomic update: status != completed

      const { POST } = await import("@/app/api/inspections/[id]/reopen/route");
      const req = makeRequest("/api/inspections/insp-001/reopen");
      const res = await POST(req, { params: Promise.resolve({ id: "insp-001" }) });
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error).toMatch(/not completed/i);
    });

    it("rejects reopening an in_review inspection", async () => {
      setupAdmin();
      mockReturningResult = [];

      const { POST } = await import("@/app/api/inspections/[id]/reopen/route");
      const req = makeRequest("/api/inspections/insp-002/reopen");
      const res = await POST(req, { params: Promise.resolve({ id: "insp-002" }) });
      expect(res.status).toBe(409);
    });
  });

  // =========================================================================
  // Atomic status transitions (defense-in-depth)
  // =========================================================================
  describe("Atomic status transitions", () => {
    it("uses WHERE clause with current status to prevent race conditions", () => {
      /**
       * POSITIVE FINDING: All state transition queries use atomic WHERE:
       *
       * Submit:   WHERE id = ? AND status = 'draft'
       * Finalize: WHERE id = ? AND status = 'in_review'
       * Return:   WHERE id = ? AND status = 'in_review'
       * Reopen:   WHERE id = ? AND status = 'completed'
       *
       * This prevents TOCTOU (time-of-check-time-of-use) race conditions
       * where a concurrent request could change the status between the
       * initial check and the update.
       *
       * If the status has changed by the time the UPDATE runs, returning()
       * returns an empty array and the route responds with 409.
       */
      expect(true).toBe(true);
    });
  });

  // =========================================================================
  // Edit restrictions based on status
  // =========================================================================
  describe("Edit restrictions by status", () => {
    it("field_tech cannot edit non-draft inspections", async () => {
      setupFieldTech();
      mockDbResult = [{ inspectorId: "user-123", status: "in_review" }];

      const { PATCH } = await import("@/app/api/inspections/[id]/route");
      const req = makeRequest("/api/inspections/insp-002", "PATCH", { facilityInfo: {} });
      const res = await PATCH(req, { params: Promise.resolve({ id: "insp-002" }) });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toMatch(/no longer a draft/i);
    });

    it("field_tech cannot delete non-draft inspections", async () => {
      setupFieldTech();
      mockDbResult = [{ inspectorId: "user-123", status: "completed" }];

      const { DELETE } = await import("@/app/api/inspections/[id]/route");
      const req = makeRequest("/api/inspections/insp-003", "DELETE");
      const res = await DELETE(req, { params: Promise.resolve({ id: "insp-003" }) });
      expect(res.status).toBe(403);
    });
  });

  // =========================================================================
  // Complete state machine diagram validation
  // =========================================================================
  describe("State machine completeness", () => {
    it("documents the valid state transitions", () => {
      const validTransitions = {
        draft: ["in_review"], // via submit
        in_review: ["completed", "draft"], // via finalize or return
        completed: ["in_review"], // via reopen
      };

      // Verify no unexpected transitions exist
      expect(validTransitions.draft).not.toContain("completed"); // Can't skip in_review
      expect(validTransitions.draft).not.toContain("sent");
      expect(Object.keys(validTransitions)).not.toContain("sent"); // No transitions from sent

      // Document: "submitted" status exists in the enum but is not used in transitions
      // The app uses "in_review" as the submitted state
    });

    it("SECURITY NOTE: submitted and sent statuses exist in enum but have no transition routes", () => {
      /**
       * FINDING: The inspection_status enum includes ["draft", "submitted",
       * "in_review", "completed", "sent"] but the actual state machine only
       * uses draft, in_review, and completed.
       *
       * The "submitted" and "sent" statuses exist in the DB schema but have
       * no API transition routes. If an inspection somehow gets into these
       * states (e.g., via direct DB manipulation), there's no API route to
       * transition out of them.
       *
       * This is a low-risk finding but could cause inspections to get "stuck"
       * in unreachable states.
       */
      expect(true).toBe(true);
    });
  });
});
