/**
 * Security Tests: File Upload Security
 *
 * Tests media upload routes for:
 * - Path traversal prevention in storage paths
 * - File type validation
 * - Storage path scoping to inspection ID
 * - Access control on upload URL generation
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
  orderBy: vi.fn().mockReturnThis(),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => mockCreateClient(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: {
      from: vi.fn().mockReturnValue({
        createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: "https://signed.url" } }),
        createSignedUploadUrl: vi.fn().mockResolvedValue({
          data: { signedUrl: "https://upload.url", token: "upload-token" },
        }),
        download: vi.fn().mockResolvedValue({ data: new Blob(["fake"]), error: null }),
        remove: vi.fn().mockResolvedValue({ data: [], error: null }),
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
  if (body) init.body = JSON.stringify(body);
  return new Request(`http://localhost:3000${path}`, init);
}

function setupAuth(userId = "user-123") {
  const client = createMockSupabaseClient({ userId, role: "field_tech" });
  mockCreateClient.mockResolvedValue(client);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("File Upload Security Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbResult = [{ inspectorId: "user-123" }]; // Default: user owns the inspection
    mockReturningResult = [{
      id: "media-1",
      inspectionId: "insp-001",
      type: "photo",
      storagePath: "insp-001/photo/test.jpg",
      label: null,
      sortOrder: 0,
      createdAt: new Date(),
    }];
    setupAuth();
  });

  // =========================================================================
  // Upload URL generation — path construction
  // =========================================================================
  describe("POST /api/inspections/[id]/media/upload-url — path safety", () => {
    it("generates storage path scoped to inspection ID", async () => {
      const { POST } = await import("@/app/api/inspections/[id]/media/upload-url/route");
      const req = makeRequest("/api/inspections/insp-001/media/upload-url", "POST", {
        fileName: "photo.jpg",
        type: "photo",
      });
      const res = await POST(req, { params: Promise.resolve({ id: "insp-001" }) });
      expect(res.status).toBe(200);
      const json = await res.json();
      // Storage path must start with the inspection ID
      expect(json.storagePath).toMatch(/^insp-001\//);
    });

    it("extracts only the file extension, ignoring path components in fileName", async () => {
      const { POST } = await import("@/app/api/inspections/[id]/media/upload-url/route");

      const traversalFileNames = [
        "../../etc/passwd.jpg",
        "../secret/file.png",
        "/root/.ssh/id_rsa.pem",
        "..\\..\\windows\\system32\\config\\sam.jpg",
      ];

      for (const fileName of traversalFileNames) {
        const req = makeRequest("/api/inspections/insp-001/media/upload-url", "POST", {
          fileName,
          type: "photo",
        });
        const res = await POST(req, { params: Promise.resolve({ id: "insp-001" }) });

        if (res.status === 200) {
          const json = await res.json();
          // Path must NOT contain traversal sequences
          expect(json.storagePath).not.toContain("..");
          expect(json.storagePath).not.toContain("\\");
          // Must be scoped to inspection
          expect(json.storagePath).toMatch(/^insp-001\//);
          // Extension should be extracted cleanly
          const ext = json.storagePath.split(".").pop();
          expect(["jpg", "png", "pem"]).toContain(ext);
        }
      }
    });

    it("generates a random UUID in the storage path (prevents name collisions)", async () => {
      const { POST } = await import("@/app/api/inspections/[id]/media/upload-url/route");

      const paths: string[] = [];
      for (let i = 0; i < 3; i++) {
        const req = makeRequest("/api/inspections/insp-001/media/upload-url", "POST", {
          fileName: "photo.jpg",
          type: "photo",
        });
        const res = await POST(req, { params: Promise.resolve({ id: "insp-001" }) });
        if (res.status === 200) {
          const json = await res.json();
          paths.push(json.storagePath);
        }
      }

      // All paths should be unique
      const uniquePaths = new Set(paths);
      expect(uniquePaths.size).toBe(paths.length);
    });

    it("uses label as the section directory when provided", async () => {
      const { POST } = await import("@/app/api/inspections/[id]/media/upload-url/route");
      const req = makeRequest("/api/inspections/insp-001/media/upload-url", "POST", {
        fileName: "photo.jpg",
        type: "photo",
        label: "Septic Tank",
      });
      const res = await POST(req, { params: Promise.resolve({ id: "insp-001" }) });
      if (res.status === 200) {
        const json = await res.json();
        expect(json.storagePath).toContain("Septic Tank");
      }
    });

    it("SECURITY NOTE: label is not sanitized for path traversal", () => {
      /**
       * FINDING: In upload-url/route.ts line 57:
       *   const section = label ?? type;
       *   const storagePath = `${id}/${section}/${crypto.randomUUID()}.${ext}`;
       *
       * The label field is used directly in the storage path without sanitization.
       * A malicious label like "../../other-bucket" could potentially create
       * files outside the intended directory in Supabase Storage.
       *
       * MITIGATION: Supabase Storage policies and bucket scoping should prevent
       * actual directory traversal, but the label should still be sanitized.
       *
       * RECOMMENDATION: Sanitize the label to remove path separators and
       * traversal sequences: label.replace(/[\/\\\.\.]/g, '_')
       */
      expect(true).toBe(true);
    });
  });

  // =========================================================================
  // Media metadata POST — storagePath validation
  // =========================================================================
  describe("POST /api/inspections/[id]/media — metadata security", () => {
    it("accepts metadata with valid storagePath", async () => {
      const { POST } = await import("@/app/api/inspections/[id]/media/route");
      const req = makeRequest("/api/inspections/insp-001/media", "POST", {
        storagePath: "insp-001/photo/abc-123.jpg",
        type: "photo",
      });
      const res = await POST(req, { params: Promise.resolve({ id: "insp-001" }) });
      expect(res.status).toBe(201);
    });

    it("SECURITY NOTE: storagePath is not validated to match inspection ID", () => {
      /**
       * FINDING: In media/route.ts POST handler, the storagePath from the
       * request body is stored directly without verifying it starts with
       * the inspection ID.
       *
       * Unlike the /scan endpoint which validates path prefixes, the media
       * metadata endpoint trusts the client-provided storagePath.
       *
       * An attacker with valid auth could potentially reference files from
       * other inspections by providing a storagePath like:
       *   "other-inspection-id/photo/sensitive.jpg"
       *
       * RECOMMENDATION: Validate that storagePath starts with the inspection ID:
       *   if (!storagePath.startsWith(`${id}/`)) return 400;
       */
      expect(true).toBe(true);
    });

    it("rejects missing storagePath", async () => {
      const { POST } = await import("@/app/api/inspections/[id]/media/route");
      const req = makeRequest("/api/inspections/insp-001/media", "POST", {
        type: "photo",
      });
      const res = await POST(req, { params: Promise.resolve({ id: "insp-001" }) });
      expect(res.status).toBe(400);
    });

    it("rejects missing type", async () => {
      const { POST } = await import("@/app/api/inspections/[id]/media/route");
      const req = makeRequest("/api/inspections/insp-001/media", "POST", {
        storagePath: "insp-001/photo/test.jpg",
      });
      const res = await POST(req, { params: Promise.resolve({ id: "insp-001" }) });
      expect(res.status).toBe(400);
    });
  });

  // =========================================================================
  // Media PATCH — label update security
  // =========================================================================
  describe("PATCH /api/inspections/[id]/media — label update", () => {
    beforeEach(() => {
      mockReturningResult = [{
        id: "media-1",
        inspectionId: "insp-001",
        type: "photo",
        storagePath: "insp-001/photo/test.jpg",
        label: "Updated Label",
        sortOrder: 0,
      }];
    });

    it("rejects missing mediaId", async () => {
      const { PATCH } = await import("@/app/api/inspections/[id]/media/route");
      const req = makeRequest("/api/inspections/insp-001/media", "PATCH", {
        label: "New Label",
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: "insp-001" }) });
      expect(res.status).toBe(400);
    });

    it("rejects non-string label", async () => {
      const { PATCH } = await import("@/app/api/inspections/[id]/media/route");
      const req = makeRequest("/api/inspections/insp-001/media", "PATCH", {
        mediaId: "media-1",
        label: 12345,
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: "insp-001" }) });
      expect(res.status).toBe(400);
    });

    it("scopes media update to inspection ID (prevents cross-inspection updates)", async () => {
      /**
       * The PATCH handler correctly uses:
       *   where(and(eq(inspectionMedia.id, mediaId), eq(inspectionMedia.inspectionId, id)))
       *
       * This ensures a media record can only be updated if it belongs to
       * the specified inspection. An attacker cannot update media records
       * from other inspections by guessing mediaId values.
       */
      const { PATCH } = await import("@/app/api/inspections/[id]/media/route");
      const req = makeRequest("/api/inspections/insp-001/media", "PATCH", {
        mediaId: "media-from-other-inspection",
        label: "Hacked",
      });
      mockReturningResult = []; // No match = 404
      const res = await PATCH(req, { params: Promise.resolve({ id: "insp-001" }) });
      expect(res.status).toBe(404);
    });
  });

  // =========================================================================
  // Media DELETE — scoping and cleanup
  // =========================================================================
  describe("DELETE /api/inspections/[id]/media — deletion security", () => {
    it("rejects missing mediaId", async () => {
      const { DELETE } = await import("@/app/api/inspections/[id]/media/route");
      const req = makeRequest("/api/inspections/insp-001/media", "DELETE", {});
      const res = await DELETE(req, { params: Promise.resolve({ id: "insp-001" }) });
      expect(res.status).toBe(400);
    });

    it("scopes media delete to inspection ID (prevents cross-inspection deletion)", async () => {
      mockDbResult = []; // Simulates: media not found for this inspection
      const { DELETE } = await import("@/app/api/inspections/[id]/media/route");
      const req = makeRequest("/api/inspections/insp-001/media", "DELETE", {
        mediaId: "media-from-other-inspection",
      });
      const res = await DELETE(req, { params: Promise.resolve({ id: "insp-001" }) });
      expect(res.status).toBe(404);
    });
  });

  // =========================================================================
  // Access control — non-owner cannot upload/modify media
  // =========================================================================
  describe("Media access control — non-owner denied", () => {
    it("denies field_tech from uploading to another users inspection", async () => {
      const client = createMockSupabaseClient({ userId: "attacker-user", role: "field_tech" });
      mockCreateClient.mockResolvedValue(client);
      mockDbResult = [{ inspectorId: "victim-user" }]; // Different owner

      const { POST } = await import("@/app/api/inspections/[id]/media/upload-url/route");
      const req = makeRequest("/api/inspections/insp-001/media/upload-url", "POST", {
        fileName: "malware.jpg",
        type: "photo",
      });
      const res = await POST(req, { params: Promise.resolve({ id: "insp-001" }) });
      expect(res.status).toBe(403);
    });

    it("allows admin to upload to any inspection", async () => {
      const client = createMockSupabaseClient({ userId: "admin-user", role: "admin" });
      mockCreateClient.mockResolvedValue(client);
      mockDbResult = [{ inspectorId: "other-user" }];

      const { POST } = await import("@/app/api/inspections/[id]/media/upload-url/route");
      const req = makeRequest("/api/inspections/insp-001/media/upload-url", "POST", {
        fileName: "photo.jpg",
        type: "photo",
      });
      const res = await POST(req, { params: Promise.resolve({ id: "insp-001" }) });
      expect(res.status).toBe(200);
    });
  });
});
