/**
 * Security Tests: Role-Based Access Control (RBAC)
 *
 * Verifies that each role (admin, field_tech, office_staff) can only access
 * what their permissions allow. Tests both positive (allowed) and negative
 * (denied) cases for every protected endpoint.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AppRole } from "@/types/roles";
import { createMockSupabaseClient, buildJwt } from "./helpers";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCreateClient = vi.fn();

// Chainable mock DB — resolves to configurable results
let mockDbResult: unknown[] = [];
let mockReturningResult: unknown[] = [];

const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn(function (this: typeof mockDb) {
    return Promise.resolve(mockDbResult);
  }),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn(function () {
    return Promise.resolve(mockReturningResult);
  }),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockResolvedValue([]),
  innerJoin: vi.fn().mockReturnThis(),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => mockCreateClient(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: {
      admin: {
        createUser: vi.fn().mockResolvedValue({
          data: { user: { id: "new-user-id", email: "new@test.com" } },
          error: null,
        }),
        deleteUser: vi.fn(),
      },
    },
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: null }),
      delete: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
    }),
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
  inspections: { id: "id", inspectorId: "inspector_id", status: "status", formData: "form_data" },
  profiles: { id: "id", fullName: "full_name", signatureDataUrl: "signature_data_url" },
  inspectionMedia: { id: "id", inspectionId: "inspection_id" },
  userRoles: { userId: "user_id", role: "role" },
  inspectionEmails: {},
}));

vi.mock("@/lib/validators/auth", () => ({
  createUserSchema: {
    safeParse: vi.fn().mockReturnValue({
      success: true,
      data: { email: "new@test.com", password: "password123", fullName: "New User", role: "field_tech" },
    }),
  },
}));

vi.mock("@/lib/email/send-notification", () => ({
  sendSubmissionNotification: vi.fn(),
}));

vi.mock("@/lib/ai/parse-inspection-form", () => ({
  parseInspectionForm: vi.fn().mockResolvedValue({ fields: {} }),
}));

vi.mock("@/lib/pdf/generate-report", () => ({
  generateReport: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
}));

vi.mock("@/lib/storage/pdf-storage", () => ({
  uploadReport: vi.fn().mockResolvedValue("reports/insp-001/report.pdf"),
  buildDownloadFilename: vi.fn(),
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
    },
  }),
}));

vi.mock("@/lib/validators/workiz-webhook", () => ({
  workizWebhookSchema: {
    safeParse: vi.fn().mockReturnValue({
      success: false,
      error: { flatten: () => ({}) },
    }),
  },
}));

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
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(path: string, method = "GET", body?: unknown): Request {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body) init.body = JSON.stringify(body);
  return new Request(`http://localhost:3000${path}`, init);
}

function setupAuth(role: AppRole, userId = "user-123") {
  const client = createMockSupabaseClient({ userId, role });
  mockCreateClient.mockResolvedValue(client);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RBAC Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbResult = [];
    mockReturningResult = [];
  });

  // =========================================================================
  // Admin User Management — POST /api/admin/users
  // =========================================================================
  describe("POST /api/admin/users — admin only", () => {
    const payload = {
      email: "new@test.com",
      password: "password123",
      fullName: "New User",
      role: "field_tech",
    };

    it("allows admin to create users", async () => {
      setupAuth("admin");
      const { POST } = await import("@/app/api/admin/users/route");
      const req = makeRequest("/api/admin/users", "POST", payload);
      const res = await POST(req);
      // Should not be 401 or 403
      expect([401, 403]).not.toContain(res.status);
    });

    it("rejects field_tech from creating users", async () => {
      setupAuth("field_tech");
      const { POST } = await import("@/app/api/admin/users/route");
      const req = makeRequest("/api/admin/users", "POST", payload);
      const res = await POST(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toMatch(/forbidden|admin/i);
    });

    it("rejects office_staff from creating users", async () => {
      setupAuth("office_staff");
      const { POST } = await import("@/app/api/admin/users/route");
      const req = makeRequest("/api/admin/users", "POST", payload);
      const res = await POST(req);
      expect(res.status).toBe(403);
    });
  });

  // =========================================================================
  // Finalize — POST /api/inspections/[id]/finalize — admin only
  // =========================================================================
  describe("POST /api/inspections/[id]/finalize — admin only", () => {
    beforeEach(() => {
      // Return an inspection in_review with formData
      mockDbResult = [{
        id: "insp-002",
        inspectorId: "user-123",
        status: "in_review",
        formData: { facilityInfo: { facilityName: "Test" }, disposalWorks: {} },
      }];
      mockReturningResult = [{ id: "insp-002" }];
    });

    it("allows admin to finalize", async () => {
      setupAuth("admin");
      // For the RBAC test, we verify the admin role check passes (not 403).
      // The finalize route queries: inspection, media, profile, then updates.
      // We need to mock the media query which returns from .where() directly.

      let whereCallCount = 0;
      mockDb.where.mockImplementation(function (this: typeof mockDb) {
        whereCallCount++;
        if (whereCallCount === 2) {
          // Second .where() is the media query — returns array directly
          return Promise.resolve([]);
        }
        return this;
      });

      mockDb.limit
        .mockResolvedValueOnce([{
          id: "insp-002",
          inspectorId: "user-123",
          status: "in_review",
          formData: { facilityInfo: { facilityName: "Test" }, disposalWorks: {} },
        }])
        .mockResolvedValueOnce([{ signatureDataUrl: null }]);

      mockReturningResult = [{ id: "insp-002" }];

      const { POST } = await import("@/app/api/inspections/[id]/finalize/route");
      const req = makeRequest("/api/inspections/insp-002/finalize", "POST", {});
      const res = await POST(req, { params: Promise.resolve({ id: "insp-002" }) });
      // Must NOT be 401 or 403 — that's the RBAC assertion
      expect([401, 403]).not.toContain(res.status);

      // Reset where to default behavior for subsequent tests
      mockDb.where.mockReturnThis();
    });

    it("rejects field_tech from finalizing", async () => {
      setupAuth("field_tech");
      const { POST } = await import("@/app/api/inspections/[id]/finalize/route");
      const req = makeRequest("/api/inspections/insp-002/finalize", "POST", {});
      const res = await POST(req, { params: Promise.resolve({ id: "insp-002" }) });
      expect(res.status).toBe(403);
    });

    it("rejects office_staff from finalizing", async () => {
      setupAuth("office_staff");
      const { POST } = await import("@/app/api/inspections/[id]/finalize/route");
      const req = makeRequest("/api/inspections/insp-002/finalize", "POST", {});
      const res = await POST(req, { params: Promise.resolve({ id: "insp-002" }) });
      expect(res.status).toBe(403);
    });
  });

  // =========================================================================
  // Return — POST /api/inspections/[id]/return — admin only
  // =========================================================================
  describe("POST /api/inspections/[id]/return — admin only", () => {
    it("allows admin to return inspection", async () => {
      setupAuth("admin");
      mockReturningResult = [{ id: "insp-002" }];
      const { POST } = await import("@/app/api/inspections/[id]/return/route");
      const req = makeRequest("/api/inspections/insp-002/return", "POST", { note: "Fix this" });
      const res = await POST(req, { params: Promise.resolve({ id: "insp-002" }) });
      expect([401, 403]).not.toContain(res.status);
    });

    it("rejects field_tech from returning inspection", async () => {
      setupAuth("field_tech");
      const { POST } = await import("@/app/api/inspections/[id]/return/route");
      const req = makeRequest("/api/inspections/insp-002/return", "POST", { note: "Fix this" });
      const res = await POST(req, { params: Promise.resolve({ id: "insp-002" }) });
      expect(res.status).toBe(403);
    });

    it("rejects office_staff from returning inspection", async () => {
      setupAuth("office_staff");
      const { POST } = await import("@/app/api/inspections/[id]/return/route");
      const req = makeRequest("/api/inspections/insp-002/return", "POST", { note: "" });
      const res = await POST(req, { params: Promise.resolve({ id: "insp-002" }) });
      expect(res.status).toBe(403);
    });
  });

  // =========================================================================
  // Reopen — POST /api/inspections/[id]/reopen — admin only
  // =========================================================================
  describe("POST /api/inspections/[id]/reopen — admin only", () => {
    it("allows admin to reopen inspection", async () => {
      setupAuth("admin");
      mockReturningResult = [{ id: "insp-003" }];
      const { POST } = await import("@/app/api/inspections/[id]/reopen/route");
      const req = makeRequest("/api/inspections/insp-003/reopen", "POST");
      const res = await POST(req, { params: Promise.resolve({ id: "insp-003" }) });
      expect([401, 403]).not.toContain(res.status);
    });

    it("rejects field_tech from reopening inspection", async () => {
      setupAuth("field_tech");
      const { POST } = await import("@/app/api/inspections/[id]/reopen/route");
      const req = makeRequest("/api/inspections/insp-003/reopen", "POST");
      const res = await POST(req, { params: Promise.resolve({ id: "insp-003" }) });
      expect(res.status).toBe(403);
    });

    it("rejects office_staff from reopening inspection", async () => {
      setupAuth("office_staff");
      const { POST } = await import("@/app/api/inspections/[id]/reopen/route");
      const req = makeRequest("/api/inspections/insp-003/reopen", "POST");
      const res = await POST(req, { params: Promise.resolve({ id: "insp-003" }) });
      expect(res.status).toBe(403);
    });
  });

  // =========================================================================
  // GET /api/inspections/[id] — ownership + privilege checks
  // =========================================================================
  describe("GET /api/inspections/[id] — ownership checks", () => {
    it("allows owner (field_tech) to view own inspection", async () => {
      setupAuth("field_tech", "user-123");
      mockDbResult = [{
        id: "insp-001",
        inspectorId: "user-123",
        status: "draft",
        formData: {},
      }];
      const { GET } = await import("@/app/api/inspections/[id]/route");
      const req = makeRequest("/api/inspections/insp-001");
      const res = await GET(req, { params: Promise.resolve({ id: "insp-001" }) });
      expect(res.status).toBe(200);
    });

    it("denies field_tech access to another users inspection", async () => {
      setupAuth("field_tech", "user-123");
      mockDbResult = [{
        id: "insp-004",
        inspectorId: "other-user-456",
        status: "draft",
        formData: {},
      }];
      const { GET } = await import("@/app/api/inspections/[id]/route");
      const req = makeRequest("/api/inspections/insp-004");
      const res = await GET(req, { params: Promise.resolve({ id: "insp-004" }) });
      expect(res.status).toBe(403);
    });

    it("allows admin to view any inspection", async () => {
      setupAuth("admin", "admin-user");
      mockDbResult = [{
        id: "insp-004",
        inspectorId: "other-user-456",
        status: "draft",
        formData: {},
      }];
      const { GET } = await import("@/app/api/inspections/[id]/route");
      const req = makeRequest("/api/inspections/insp-004");
      const res = await GET(req, { params: Promise.resolve({ id: "insp-004" }) });
      expect(res.status).toBe(200);
    });

    it("allows office_staff to view any inspection", async () => {
      setupAuth("office_staff", "office-user");
      mockDbResult = [{
        id: "insp-004",
        inspectorId: "other-user-456",
        status: "draft",
        formData: {},
      }];
      const { GET } = await import("@/app/api/inspections/[id]/route");
      const req = makeRequest("/api/inspections/insp-004");
      const res = await GET(req, { params: Promise.resolve({ id: "insp-004" }) });
      expect(res.status).toBe(200);
    });
  });

  // =========================================================================
  // PATCH /api/inspections/[id] — ownership + status checks
  // =========================================================================
  describe("PATCH /api/inspections/[id] — edit restrictions", () => {
    it("allows field_tech to edit own draft", async () => {
      setupAuth("field_tech", "user-123");
      mockDbResult = [{ inspectorId: "user-123", status: "draft" }];
      const { PATCH } = await import("@/app/api/inspections/[id]/route");
      const req = makeRequest("/api/inspections/insp-001", "PATCH", { facilityInfo: {} });
      const res = await PATCH(req, { params: Promise.resolve({ id: "insp-001" }) });
      expect(res.status).toBe(200);
    });

    it("prevents field_tech from editing non-draft inspection", async () => {
      setupAuth("field_tech", "user-123");
      mockDbResult = [{ inspectorId: "user-123", status: "in_review" }];
      const { PATCH } = await import("@/app/api/inspections/[id]/route");
      const req = makeRequest("/api/inspections/insp-002", "PATCH", { facilityInfo: {} });
      const res = await PATCH(req, { params: Promise.resolve({ id: "insp-002" }) });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toMatch(/no longer a draft/i);
    });

    it("prevents field_tech from editing another users draft", async () => {
      setupAuth("field_tech", "user-123");
      mockDbResult = [{ inspectorId: "other-user-456", status: "draft" }];
      const { PATCH } = await import("@/app/api/inspections/[id]/route");
      const req = makeRequest("/api/inspections/insp-004", "PATCH", { facilityInfo: {} });
      const res = await PATCH(req, { params: Promise.resolve({ id: "insp-004" }) });
      expect(res.status).toBe(403);
    });

    it("allows admin to edit any inspection regardless of status", async () => {
      setupAuth("admin", "admin-user");
      mockDbResult = [{ inspectorId: "other-user-456", status: "in_review" }];
      const { PATCH } = await import("@/app/api/inspections/[id]/route");
      const req = makeRequest("/api/inspections/insp-002", "PATCH", { facilityInfo: {} });
      const res = await PATCH(req, { params: Promise.resolve({ id: "insp-002" }) });
      expect(res.status).toBe(200);
    });
  });

  // =========================================================================
  // DELETE /api/inspections/[id] — ownership + status checks
  // =========================================================================
  describe("DELETE /api/inspections/[id] — deletion restrictions", () => {
    it("allows field_tech to delete own draft", async () => {
      setupAuth("field_tech", "user-123");
      mockDbResult = [{ inspectorId: "user-123", status: "draft" }];
      const { DELETE } = await import("@/app/api/inspections/[id]/route");
      const req = makeRequest("/api/inspections/insp-001", "DELETE");
      const res = await DELETE(req, { params: Promise.resolve({ id: "insp-001" }) });
      expect(res.status).toBe(200);
    });

    it("prevents field_tech from deleting non-draft inspection", async () => {
      setupAuth("field_tech", "user-123");
      mockDbResult = [{ inspectorId: "user-123", status: "in_review" }];
      const { DELETE } = await import("@/app/api/inspections/[id]/route");
      const req = makeRequest("/api/inspections/insp-002", "DELETE");
      const res = await DELETE(req, { params: Promise.resolve({ id: "insp-002" }) });
      expect(res.status).toBe(403);
    });

    it("prevents field_tech from deleting another users inspection", async () => {
      setupAuth("field_tech", "user-123");
      mockDbResult = [{ inspectorId: "other-user-456", status: "draft" }];
      const { DELETE } = await import("@/app/api/inspections/[id]/route");
      const req = makeRequest("/api/inspections/insp-004", "DELETE");
      const res = await DELETE(req, { params: Promise.resolve({ id: "insp-004" }) });
      expect(res.status).toBe(403);
    });

    it("allows admin to delete any inspection", async () => {
      setupAuth("admin", "admin-user");
      mockDbResult = [{ inspectorId: "other-user-456", status: "completed" }];
      const { DELETE } = await import("@/app/api/inspections/[id]/route");
      const req = makeRequest("/api/inspections/insp-003", "DELETE");
      const res = await DELETE(req, { params: Promise.resolve({ id: "insp-003" }) });
      expect(res.status).toBe(200);
    });
  });

  // =========================================================================
  // POST /api/inspections/[id]/submit — owner or admin
  // =========================================================================
  describe("POST /api/inspections/[id]/submit — owner or admin", () => {
    it("allows owner to submit own draft", async () => {
      setupAuth("field_tech", "user-123");
      mockDbResult = [{ inspectorId: "user-123", status: "draft" }];
      mockReturningResult = [{ id: "insp-001", facilityName: "Test" }];
      const { POST } = await import("@/app/api/inspections/[id]/submit/route");
      const req = makeRequest("/api/inspections/insp-001/submit", "POST");
      const res = await POST(req, { params: Promise.resolve({ id: "insp-001" }) });
      expect([401, 403]).not.toContain(res.status);
    });

    it("prevents non-owner field_tech from submitting", async () => {
      setupAuth("field_tech", "user-123");
      mockDbResult = [{ inspectorId: "other-user-456", status: "draft" }];
      const { POST } = await import("@/app/api/inspections/[id]/submit/route");
      const req = makeRequest("/api/inspections/insp-004/submit", "POST");
      const res = await POST(req, { params: Promise.resolve({ id: "insp-004" }) });
      expect(res.status).toBe(403);
    });

    it("prevents office_staff from submitting (not owner, not admin)", async () => {
      setupAuth("office_staff", "office-user");
      mockDbResult = [{ inspectorId: "other-user-456", status: "draft" }];
      const { POST } = await import("@/app/api/inspections/[id]/submit/route");
      const req = makeRequest("/api/inspections/insp-004/submit", "POST");
      const res = await POST(req, { params: Promise.resolve({ id: "insp-004" }) });
      expect(res.status).toBe(403);
    });

    it("allows admin to submit any inspection", async () => {
      setupAuth("admin", "admin-user");
      mockDbResult = [{ inspectorId: "other-user-456", status: "draft" }];
      mockReturningResult = [{ id: "insp-004", facilityName: "Test" }];
      const { POST } = await import("@/app/api/inspections/[id]/submit/route");
      const req = makeRequest("/api/inspections/insp-004/submit", "POST");
      const res = await POST(req, { params: Promise.resolve({ id: "insp-004" }) });
      expect([401, 403]).not.toContain(res.status);
    });
  });

  // =========================================================================
  // Bulk Delete — role-based restrictions
  // =========================================================================
  describe("POST /api/inspections/bulk-delete — role restrictions", () => {
    it("allows admin to bulk-delete any inspections", async () => {
      setupAuth("admin", "admin-user");
      mockDbResult = [
        { id: "insp-001", inspectorId: "other", status: "completed" },
        { id: "insp-002", inspectorId: "other", status: "in_review" },
      ];
      // Mock: select returns the targets, delete succeeds
      mockDb.where.mockResolvedValueOnce([
        { id: "insp-001", inspectorId: "other", status: "completed" },
        { id: "insp-002", inspectorId: "other", status: "in_review" },
      ]);
      const { POST } = await import("@/app/api/inspections/bulk-delete/route");
      const req = makeRequest("/api/inspections/bulk-delete", "POST", {
        ids: ["insp-001", "insp-002"],
      });
      const res = await POST(req);
      expect([401, 403]).not.toContain(res.status);
    });

    it("field_tech can only bulk-delete own drafts", async () => {
      setupAuth("field_tech", "user-123");
      // Mock the db chain to return targets that include non-owned + non-draft
      mockDb.where.mockResolvedValueOnce([
        { id: "insp-001", inspectorId: "user-123", status: "draft" },
        { id: "insp-002", inspectorId: "other-user", status: "draft" },
        { id: "insp-003", inspectorId: "user-123", status: "in_review" },
      ]);
      const { POST } = await import("@/app/api/inspections/bulk-delete/route");
      const req = makeRequest("/api/inspections/bulk-delete", "POST", {
        ids: ["insp-001", "insp-002", "insp-003"],
      });
      const res = await POST(req);
      const json = await res.json();
      // Should have errors for the ones they can't delete
      expect(json.errors).toBeDefined();
      expect(json.errors.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // GET /api/inspections — list scoping by role
  // =========================================================================
  describe("GET /api/inspections — list scoping", () => {
    it("field_tech query includes user filter (own inspections only)", async () => {
      setupAuth("field_tech", "user-123");
      const { GET } = await import("@/app/api/inspections/route");
      const res = await GET();
      expect(res.status).toBe(200);
      // The where() clause should have been called (indicating a filter)
      expect(mockDb.where).toHaveBeenCalled();
    });

    it("admin gets all inspections without user filter", async () => {
      setupAuth("admin", "admin-user");
      mockDb.orderBy.mockResolvedValueOnce([]);
      const { GET } = await import("@/app/api/inspections/route");
      const res = await GET();
      expect(res.status).toBe(200);
    });
  });

  // =========================================================================
  // NAV_ITEMS role enforcement
  // =========================================================================
  describe("NAV_ITEMS role definitions", () => {
    it("only admin can see Manage Users", async () => {
      const { NAV_ITEMS } = await import("@/types/roles");
      const manageUsers = NAV_ITEMS.find((item) => item.label === "Manage Users");
      expect(manageUsers).toBeDefined();
      expect(manageUsers!.roles).toEqual(["admin"]);
      expect(manageUsers!.roles).not.toContain("field_tech");
      expect(manageUsers!.roles).not.toContain("office_staff");
    });

    it("field_tech cannot see Review Queue", async () => {
      const { NAV_ITEMS } = await import("@/types/roles");
      const reviewQueue = NAV_ITEMS.find((item) => item.label === "Review Queue");
      expect(reviewQueue).toBeDefined();
      expect(reviewQueue!.roles).not.toContain("field_tech");
    });

    it("office_staff cannot create new inspections", async () => {
      const { NAV_ITEMS } = await import("@/types/roles");
      const newInspection = NAV_ITEMS.find((item) => item.label === "New Inspection");
      expect(newInspection).toBeDefined();
      expect(newInspection!.roles).not.toContain("office_staff");
    });

    it("all roles can see Dashboard and Settings", async () => {
      const { NAV_ITEMS } = await import("@/types/roles");
      const dashboard = NAV_ITEMS.find((item) => item.label === "Dashboard");
      const settings = NAV_ITEMS.find((item) => item.label === "Settings");
      for (const item of [dashboard, settings]) {
        expect(item).toBeDefined();
        expect(item!.roles).toContain("admin");
        expect(item!.roles).toContain("field_tech");
        expect(item!.roles).toContain("office_staff");
      }
    });
  });
});
