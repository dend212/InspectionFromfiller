/**
 * Security Tests: Authentication Bypass
 *
 * Verifies that EVERY API route properly rejects unauthenticated requests.
 * Tests the auth flow in auth-helpers.ts and each route's getUser() check.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be declared before any imports that reference them
// ---------------------------------------------------------------------------

const mockCreateClient = vi.fn();
const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn().mockResolvedValue([]),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn().mockResolvedValue([]),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockResolvedValue([]),
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
  inspections: { id: "id", inspectorId: "inspector_id", status: "status", formData: "form_data" },
  profiles: { id: "id", fullName: "full_name", signatureDataUrl: "signature_data_url" },
  inspectionMedia: { id: "id", inspectionId: "inspection_id" },
  userRoles: { userId: "user_id", role: "role" },
  inspectionEmails: {},
}));

vi.mock("@/lib/validators/auth", () => ({
  createUserSchema: { safeParse: vi.fn().mockReturnValue({ success: false, error: { flatten: () => ({}) } }) },
}));

vi.mock("@/lib/email/send-notification", () => ({
  sendSubmissionNotification: vi.fn(),
}));

vi.mock("@/lib/ai/parse-inspection-form", () => ({
  parseInspectionForm: vi.fn(),
}));

vi.mock("@/lib/pdf/generate-report", () => ({
  generateReport: vi.fn(),
}));

vi.mock("@/lib/storage/pdf-storage", () => ({
  uploadReport: vi.fn(),
  buildDownloadFilename: vi.fn(),
}));

vi.mock("@/lib/validators/inspection", () => ({
  getDefaultFormValues: vi.fn().mockReturnValue({
    facilityInfo: { facilityName: "", facilityAddress: "", facilityCity: "", facilityCounty: "", facilityState: "AZ", facilityZip: "", taxParcelNumber: "", sellerName: "" },
  }),
}));

vi.mock("@/lib/validators/workiz-webhook", () => ({
  workizWebhookSchema: { safeParse: vi.fn().mockReturnValue({ success: false, error: { flatten: () => ({}) } }) },
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

import {
  createUnauthenticatedClient,
  createMockSupabaseClient,
} from "./helpers";

function makeRequest(path: string, method = "GET", body?: unknown): Request {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body) init.body = JSON.stringify(body);
  return new Request(`http://localhost:3000${path}`, init);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Authentication Bypass Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue(createUnauthenticatedClient());
  });

  // =========================================================================
  // POST /api/inspections — Create new inspection
  // =========================================================================
  describe("POST /api/inspections", () => {
    it("returns 401 when no auth token is present", async () => {
      const { POST } = await import("@/app/api/inspections/route");
      const res = await POST();
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toMatch(/unauthorized/i);
    });
  });

  // =========================================================================
  // GET /api/inspections — List inspections
  // =========================================================================
  describe("GET /api/inspections", () => {
    it("returns 401 when no auth token is present", async () => {
      const { GET } = await import("@/app/api/inspections/route");
      const res = await GET();
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toMatch(/unauthorized/i);
    });
  });

  // =========================================================================
  // GET /api/inspections/[id] — Get single inspection
  // =========================================================================
  describe("GET /api/inspections/[id]", () => {
    it("returns 401 when no auth token is present", async () => {
      const { GET } = await import("@/app/api/inspections/[id]/route");
      const req = makeRequest("/api/inspections/insp-001");
      const res = await GET(req, { params: Promise.resolve({ id: "insp-001" }) });
      expect(res.status).toBe(401);
    });
  });

  // =========================================================================
  // PATCH /api/inspections/[id] — Update inspection
  // =========================================================================
  describe("PATCH /api/inspections/[id]", () => {
    it("returns 401 when no auth token is present", async () => {
      const { PATCH } = await import("@/app/api/inspections/[id]/route");
      const req = makeRequest("/api/inspections/insp-001", "PATCH", { facilityInfo: {} });
      const res = await PATCH(req, { params: Promise.resolve({ id: "insp-001" }) });
      expect(res.status).toBe(401);
    });
  });

  // =========================================================================
  // DELETE /api/inspections/[id] — Delete inspection
  // =========================================================================
  describe("DELETE /api/inspections/[id]", () => {
    it("returns 401 when no auth token is present", async () => {
      const { DELETE } = await import("@/app/api/inspections/[id]/route");
      const req = makeRequest("/api/inspections/insp-001", "DELETE");
      const res = await DELETE(req, { params: Promise.resolve({ id: "insp-001" }) });
      expect(res.status).toBe(401);
    });
  });

  // =========================================================================
  // POST /api/inspections/[id]/submit — Submit for review
  // =========================================================================
  describe("POST /api/inspections/[id]/submit", () => {
    it("returns 401 when no auth token is present", async () => {
      const { POST } = await import("@/app/api/inspections/[id]/submit/route");
      const req = makeRequest("/api/inspections/insp-001/submit", "POST");
      const res = await POST(req, { params: Promise.resolve({ id: "insp-001" }) });
      expect(res.status).toBe(401);
    });
  });

  // =========================================================================
  // POST /api/inspections/[id]/finalize — Finalize (admin only)
  // =========================================================================
  describe("POST /api/inspections/[id]/finalize", () => {
    it("returns 401 when no auth token is present", async () => {
      const { POST } = await import("@/app/api/inspections/[id]/finalize/route");
      const req = makeRequest("/api/inspections/insp-001/finalize", "POST", {});
      const res = await POST(req, { params: Promise.resolve({ id: "insp-001" }) });
      expect(res.status).toBe(401);
    });
  });

  // =========================================================================
  // POST /api/inspections/[id]/return — Return to draft (admin only)
  // =========================================================================
  describe("POST /api/inspections/[id]/return", () => {
    it("returns 401 when no auth token is present", async () => {
      const { POST } = await import("@/app/api/inspections/[id]/return/route");
      const req = makeRequest("/api/inspections/insp-001/return", "POST", { note: "" });
      const res = await POST(req, { params: Promise.resolve({ id: "insp-001" }) });
      expect(res.status).toBe(401);
    });
  });

  // =========================================================================
  // POST /api/inspections/[id]/reopen — Reopen completed (admin only)
  // =========================================================================
  describe("POST /api/inspections/[id]/reopen", () => {
    it("returns 401 when no auth token is present", async () => {
      const { POST } = await import("@/app/api/inspections/[id]/reopen/route");
      const req = makeRequest("/api/inspections/insp-001/reopen", "POST");
      const res = await POST(req, { params: Promise.resolve({ id: "insp-001" }) });
      expect(res.status).toBe(401);
    });
  });

  // =========================================================================
  // POST /api/inspections/bulk-delete
  // =========================================================================
  describe("POST /api/inspections/bulk-delete", () => {
    it("returns 401 when no auth token is present", async () => {
      const { POST } = await import("@/app/api/inspections/bulk-delete/route");
      const req = makeRequest("/api/inspections/bulk-delete", "POST", { ids: ["x"] });
      const res = await POST(req);
      expect(res.status).toBe(401);
    });
  });

  // =========================================================================
  // POST /api/admin/users — Create user (admin only)
  // =========================================================================
  describe("POST /api/admin/users", () => {
    it("returns 401 when no auth token is present", async () => {
      const { POST } = await import("@/app/api/admin/users/route");
      const req = makeRequest("/api/admin/users", "POST", {
        email: "x@x.com",
        password: "12345678",
        fullName: "X",
        role: "field_tech",
      });
      const res = await POST(req);
      expect(res.status).toBe(401);
    });
  });

  // =========================================================================
  // POST /api/inspections/[id]/scan — AI scan
  // =========================================================================
  describe("POST /api/inspections/[id]/scan", () => {
    it("returns 401 when no auth token is present", async () => {
      const { POST } = await import("@/app/api/inspections/[id]/scan/route");
      const req = makeRequest("/api/inspections/insp-001/scan", "POST", {
        storagePaths: ["insp-001/photo.jpg"],
      });
      const res = await POST(req, { params: Promise.resolve({ id: "insp-001" }) });
      expect(res.status).toBe(401);
    });
  });

  // =========================================================================
  // GET /api/apn-lookup — APN lookup
  // =========================================================================
  describe("GET /api/apn-lookup", () => {
    it("returns 401 when no auth token is present", async () => {
      const { GET } = await import("@/app/api/apn-lookup/route");
      const req = makeRequest("/api/apn-lookup?apn=123-45-678");
      const res = await GET(req);
      expect(res.status).toBe(401);
    });
  });

  // =========================================================================
  // GET /api/profile/signature
  // =========================================================================
  describe("GET /api/profile/signature", () => {
    it("returns 401 when no auth token is present", async () => {
      const { GET } = await import("@/app/api/profile/signature/route");
      const res = await GET();
      expect(res.status).toBe(401);
    });
  });

  // =========================================================================
  // PUT /api/profile/signature
  // =========================================================================
  describe("PUT /api/profile/signature", () => {
    it("returns 401 when no auth token is present", async () => {
      const { PUT } = await import("@/app/api/profile/signature/route");
      const req = makeRequest("/api/profile/signature", "PUT", {
        signatureDataUrl: "data:image/png;base64,abc",
      });
      const res = await PUT(req);
      expect(res.status).toBe(401);
    });
  });

  // =========================================================================
  // Media endpoints
  // =========================================================================
  describe("POST /api/inspections/[id]/media/upload-url", () => {
    it("returns 401 when no auth token is present", async () => {
      const { POST } = await import("@/app/api/inspections/[id]/media/upload-url/route");
      const req = makeRequest("/api/inspections/insp-001/media/upload-url", "POST", {
        fileName: "test.jpg",
        type: "photo",
      });
      const res = await POST(req, { params: Promise.resolve({ id: "insp-001" }) });
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/inspections/[id]/media", () => {
    it("returns 401 when no auth token is present", async () => {
      const { POST } = await import("@/app/api/inspections/[id]/media/route");
      const req = makeRequest("/api/inspections/insp-001/media", "POST", {
        storagePath: "insp-001/photo/test.jpg",
        type: "photo",
      });
      const res = await POST(req, { params: Promise.resolve({ id: "insp-001" }) });
      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/inspections/[id]/media", () => {
    it("returns 401 when no auth token is present", async () => {
      const { GET } = await import("@/app/api/inspections/[id]/media/route");
      const req = makeRequest("/api/inspections/insp-001/media");
      const res = await GET(req, { params: Promise.resolve({ id: "insp-001" }) });
      expect(res.status).toBe(401);
    });
  });

  describe("PATCH /api/inspections/[id]/media", () => {
    it("returns 401 when no auth token is present", async () => {
      const { PATCH } = await import("@/app/api/inspections/[id]/media/route");
      const req = makeRequest("/api/inspections/insp-001/media", "PATCH", {
        mediaId: "media-1",
        label: "test",
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: "insp-001" }) });
      expect(res.status).toBe(401);
    });
  });

  describe("DELETE /api/inspections/[id]/media", () => {
    it("returns 401 when no auth token is present", async () => {
      const { DELETE } = await import("@/app/api/inspections/[id]/media/route");
      const req = makeRequest("/api/inspections/insp-001/media", "DELETE", {
        mediaId: "media-1",
      });
      const res = await DELETE(req, { params: Promise.resolve({ id: "insp-001" }) });
      expect(res.status).toBe(401);
    });
  });

  // =========================================================================
  // Auth helpers unit tests
  // =========================================================================
  describe("getUserRole()", () => {
    it("returns null when no session exists", async () => {
      const { getUserRole } = await import("@/lib/supabase/auth-helpers");
      const client = createUnauthenticatedClient();
      const role = await getUserRole(client as never);
      expect(role).toBeNull();
    });

    it("returns the role from a valid JWT", async () => {
      const { getUserRole } = await import("@/lib/supabase/auth-helpers");
      const client = createMockSupabaseClient({ role: "admin" });
      const role = await getUserRole(client as never);
      expect(role).toBe("admin");
    });

    it("returns null when JWT lacks user_role claim", async () => {
      const { getUserRole } = await import("@/lib/supabase/auth-helpers");
      const client = createMockSupabaseClient({ role: null });
      const role = await getUserRole(client as never);
      expect(role).toBeNull();
    });
  });

  describe("checkInspectionAccess()", () => {
    it("allows the owner regardless of role", async () => {
      const { checkInspectionAccess } = await import("@/lib/supabase/auth-helpers");
      const client = createMockSupabaseClient({ userId: "user-123", role: "field_tech" });
      const result = await checkInspectionAccess(client as never, "user-123", "user-123");
      expect(result.allowed).toBe(true);
    });

    it("allows admin to access other users inspections", async () => {
      const { checkInspectionAccess } = await import("@/lib/supabase/auth-helpers");
      const client = createMockSupabaseClient({ userId: "admin-1", role: "admin" });
      const result = await checkInspectionAccess(client as never, "admin-1", "other-user");
      expect(result.allowed).toBe(true);
      expect(result.role).toBe("admin");
    });

    it("allows office_staff to access other users inspections", async () => {
      const { checkInspectionAccess } = await import("@/lib/supabase/auth-helpers");
      const client = createMockSupabaseClient({ userId: "office-1", role: "office_staff" });
      const result = await checkInspectionAccess(client as never, "office-1", "other-user");
      expect(result.allowed).toBe(true);
    });

    it("denies field_tech access to other users inspections", async () => {
      const { checkInspectionAccess } = await import("@/lib/supabase/auth-helpers");
      const client = createMockSupabaseClient({ userId: "tech-1", role: "field_tech" });
      const result = await checkInspectionAccess(client as never, "tech-1", "other-user");
      expect(result.allowed).toBe(false);
    });
  });
});
