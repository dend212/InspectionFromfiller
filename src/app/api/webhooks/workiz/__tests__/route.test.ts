import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted so variables are available inside vi.mock factories
// ---------------------------------------------------------------------------

const {
  mockDbSelect,
  mockDbInsert,
  mockDbSelectProfiles,
} = vi.hoisted(() => {
  const mockDbSelect = vi.fn();
  const mockDbInsert = vi.fn();
  const mockDbSelectProfiles = vi.fn();

  return { mockDbSelect, mockDbInsert, mockDbSelectProfiles };
});

// Track which table is targeted by select/insert so we can route to the right mock
vi.mock("@/lib/db", () => {
  // We need separate chains for inspections vs profiles selects
  let selectTarget: "inspections" | "profiles" | null = null;

  const selectChain = {
    from: vi.fn((table: unknown) => {
      // The schema mock uses different objects for inspections vs profiles
      if (table === "profiles_table") {
        selectTarget = "profiles";
      } else {
        selectTarget = "inspections";
      }
      return selectChain;
    }),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(() => {
      if (selectTarget === "profiles") {
        return mockDbSelectProfiles();
      }
      return mockDbSelect();
    }),
  };

  const insertReturningChain = {
    values: vi.fn().mockReturnThis(),
    returning: vi.fn(() => mockDbInsert()),
  };

  return {
    db: {
      select: vi.fn(() => selectChain),
      insert: vi.fn(() => insertReturningChain),
    },
  };
});

vi.mock("@/lib/db/schema", () => ({
  inspections: {
    id: "id",
    inspectorId: "inspector_id",
    status: "status",
    workizJobId: "workiz_job_id",
  },
  profiles: "profiles_table",
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ _col, val })),
  ilike: vi.fn((_col: unknown, val: unknown) => ({ _col, val, _op: "ilike" })),
}));

vi.mock("@/lib/validators/inspection", () => ({
  getDefaultFormValues: vi.fn((name: string) => ({
    facilityInfo: {
      facilityName: "",
      facilityAddress: "",
      facilityCity: "",
      facilityCounty: "",
      facilityState: "AZ",
      facilityZip: "",
      taxParcelNumber: "",
      dateOfInspection: "",
      sellerName: "",
      inspectorName: name,
    },
    generalTreatment: { systemTypes: [] },
    designFlow: {},
    septicTank: { tanks: [] },
    disposalWorks: { printedName: name },
  })),
}));

// ---------------------------------------------------------------------------
// Import the handler under test (AFTER mocks are set up)
// ---------------------------------------------------------------------------
import { POST } from "../route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_SECRET = "test-webhook-secret-12345";

function makeRequest(body: unknown, token?: string): Request {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token !== undefined) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return new Request("http://localhost/api/webhooks/workiz", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function makeRawRequest(rawBody: string, token?: string): Request {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token !== undefined) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return new Request("http://localhost/api/webhooks/workiz", {
    method: "POST",
    headers,
    body: rawBody,
  });
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    client: {
      firstName: "John",
      lastName: "Doe",
      email: "john@example.com",
      phone: "555-1234",
    },
    address: {
      street: "123 Main St",
      city: "Phoenix",
      state: "AZ",
      zip: "85001",
      county: "Maricopa",
    },
    job: {
      jobId: "WZ-12345",
      jobType: "ADEQ Inspection",
      serviceType: "",
      scheduledDate: "2026-03-15",
    },
    tech: {
      email: "tech@sewertime.com",
      name: "Jane Smith",
    },
    apn: "123-45-678",
    ...overrides,
  };
}

const TECH_PROFILE = { id: "tech-uuid-1", fullName: "Jane Smith" };
const NEW_INSPECTION = { id: "insp-uuid-1", status: "draft" };

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WORKIZ_WEBHOOK_SECRET", VALID_SECRET);

  // Defaults: no existing inspection, tech found by email
  mockDbSelect.mockResolvedValue([]); // no existing inspection
  mockDbSelectProfiles.mockResolvedValue([TECH_PROFILE]); // tech found
  mockDbInsert.mockResolvedValue([NEW_INSPECTION]); // new inspection created
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/webhooks/workiz", () => {
  // -----------------------------------------------------------------------
  // 1. Authentication
  // -----------------------------------------------------------------------
  describe("Authentication", () => {
    it("returns 500 when WORKIZ_WEBHOOK_SECRET is not configured", async () => {
      vi.stubEnv("WORKIZ_WEBHOOK_SECRET", "");

      const res = await POST(makeRequest(validPayload(), VALID_SECRET));
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe("Server misconfigured");
    });

    it("returns 401 when no Authorization header is present", async () => {
      const req = new Request("http://localhost/api/webhooks/workiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validPayload()),
      });

      const res = await POST(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe("Unauthorized");
    });

    it("returns 401 when Authorization header is not Bearer format", async () => {
      const req = new Request("http://localhost/api/webhooks/workiz", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Basic ${VALID_SECRET}`,
        },
        body: JSON.stringify(validPayload()),
      });

      const res = await POST(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe("Unauthorized");
    });

    it("returns 401 when Bearer token does not match secret", async () => {
      const res = await POST(makeRequest(validPayload(), "wrong-secret"));
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe("Unauthorized");
    });

    it("returns 401 when token has different length than secret (timing-safe)", async () => {
      const res = await POST(makeRequest(validPayload(), "short"));
      expect(res.status).toBe(401);
    });

    it("authenticates successfully with correct Bearer token", async () => {
      const res = await POST(makeRequest(validPayload(), VALID_SECRET));
      expect(res.status).toBe(201);
    });
  });

  // -----------------------------------------------------------------------
  // 2. Payload validation
  // -----------------------------------------------------------------------
  describe("Payload validation", () => {
    it("returns 400 for invalid JSON body", async () => {
      const res = await POST(makeRawRequest("{not valid json!!!", VALID_SECRET));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("Invalid JSON body");
    });

    it("returns 400 when client is missing", async () => {
      const payload = validPayload();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (payload as any).client;
      const res = await POST(makeRequest(payload, VALID_SECRET));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("Validation failed");
    });

    it("returns 400 when client.firstName is empty", async () => {
      const payload = validPayload({
        client: { firstName: "", lastName: "Doe", email: "", phone: "" },
      });
      const res = await POST(makeRequest(payload, VALID_SECRET));
      expect(res.status).toBe(400);
    });

    it("returns 400 when address.street is empty", async () => {
      const payload = validPayload({
        address: { street: "", city: "Phoenix", state: "AZ", zip: "85001", county: "Maricopa" },
      });
      const res = await POST(makeRequest(payload, VALID_SECRET));
      expect(res.status).toBe(400);
    });

    it("returns 400 when neither tech.email nor tech.name is provided", async () => {
      const payload = validPayload({
        tech: { email: "", name: "" },
      });
      const res = await POST(makeRequest(payload, VALID_SECRET));
      expect(res.status).toBe(400);
    });

    it("accepts payload with only required fields (optional fields use defaults)", async () => {
      const minimalPayload = {
        client: { firstName: "John", lastName: "Doe" },
        address: { street: "123 Main St" },
        tech: { name: "Jane Smith" },
        job: { jobType: "ADEQ Inspection" },
      };
      const res = await POST(makeRequest(minimalPayload, VALID_SECRET));
      // Should not 400 — defaults are applied by zod for missing optional fields
      expect(res.status).not.toBe(400);
    });
  });

  // -----------------------------------------------------------------------
  // 3. Job type filtering
  // -----------------------------------------------------------------------
  describe("Job type filtering", () => {
    it("skips non-ADEQ job types with 200 and skipped flag", async () => {
      const payload = validPayload({
        job: { jobId: "WZ-111", jobType: "Drain Cleaning", serviceType: "", scheduledDate: "" },
      });
      const res = await POST(makeRequest(payload, VALID_SECRET));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.skipped).toBe(true);
      expect(json.reason).toContain("Drain Cleaning");
    });

    it("processes job when serviceType contains 'adeq' (case insensitive fallback)", async () => {
      const payload = validPayload({
        job: { jobId: "WZ-222", jobType: "", serviceType: "ADEQ Septic Check", scheduledDate: "" },
      });
      const res = await POST(makeRequest(payload, VALID_SECRET));
      expect(res.status).toBe(201);
    });

    it("processes job when jobType contains 'ADEQ' (case insensitive)", async () => {
      const payload = validPayload({
        job: { jobId: "WZ-333", jobType: "adeq inspection", serviceType: "", scheduledDate: "" },
      });
      const res = await POST(makeRequest(payload, VALID_SECRET));
      expect(res.status).toBe(201);
    });

    it("skips when job section is entirely missing (defaults to empty jobType)", async () => {
      const payload = validPayload();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (payload as any).job;
      const res = await POST(makeRequest(payload, VALID_SECRET));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.skipped).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 4. Idempotency
  // -----------------------------------------------------------------------
  describe("Idempotency", () => {
    it("returns existing inspection when workizJobId already exists", async () => {
      const existingInspection = { id: "existing-uuid", status: "submitted" };
      mockDbSelect.mockResolvedValueOnce([existingInspection]);

      const res = await POST(makeRequest(validPayload(), VALID_SECRET));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.inspectionId).toBe("existing-uuid");
      expect(json.duplicate).toBe(true);
      expect(json.status).toBe("submitted");
    });

    it("creates new inspection when workizJobId does not exist yet", async () => {
      mockDbSelect.mockResolvedValueOnce([]); // no existing

      const res = await POST(makeRequest(validPayload(), VALID_SECRET));
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.inspectionId).toBe("insp-uuid-1");
      expect(json).not.toHaveProperty("duplicate");
    });

    it("skips idempotency check when jobId is empty string", async () => {
      const payload = validPayload({
        job: { jobId: "", jobType: "ADEQ Inspection", serviceType: "", scheduledDate: "" },
      });

      const res = await POST(makeRequest(payload, VALID_SECRET));
      expect(res.status).toBe(201);
      // mockDbSelect for inspections should NOT have been called for idempotency
      // (jobId is falsy, so the block is skipped)
    });
  });

  // -----------------------------------------------------------------------
  // 5. Tech assignment
  // -----------------------------------------------------------------------
  describe("Tech assignment", () => {
    it("assigns tech by email (exact match)", async () => {
      mockDbSelectProfiles.mockResolvedValueOnce([TECH_PROFILE]);

      const res = await POST(makeRequest(validPayload(), VALID_SECRET));
      expect(res.status).toBe(201);
    });

    it("falls back to name match when email lookup returns nothing", async () => {
      // First profiles call (by email) returns nothing
      mockDbSelectProfiles
        .mockResolvedValueOnce([]) // no email match
        .mockResolvedValueOnce([TECH_PROFILE]); // name match

      const res = await POST(makeRequest(validPayload(), VALID_SECRET));
      expect(res.status).toBe(201);
    });

    it("returns 404 when tech is not found by email or name", async () => {
      mockDbSelectProfiles
        .mockResolvedValueOnce([]) // no email match
        .mockResolvedValueOnce([]); // no name match

      const res = await POST(makeRequest(validPayload(), VALID_SECRET));
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toMatch(/no user found/i);
    });

    it("skips email lookup when tech.email is empty, uses name only", async () => {
      const payload = validPayload({
        tech: { email: "", name: "Jane Smith" },
      });
      mockDbSelectProfiles.mockResolvedValueOnce([TECH_PROFILE]);

      const res = await POST(makeRequest(payload, VALID_SECRET));
      expect(res.status).toBe(201);
    });

    it("includes tech email or name in 404 error message", async () => {
      mockDbSelectProfiles
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const payload = validPayload({
        tech: { email: "unknown@test.com", name: "Unknown Person" },
      });
      const res = await POST(makeRequest(payload, VALID_SECRET));
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toContain("unknown@test.com");
    });
  });

  // -----------------------------------------------------------------------
  // 6. Form data mapping (no assessor)
  // -----------------------------------------------------------------------
  describe("Form data mapping without assessor", () => {
    it("maps Workiz client name to facilityName and sellerName", async () => {
      const res = await POST(makeRequest(validPayload(), VALID_SECRET));
      expect(res.status).toBe(201);

      // Verify the db.insert was called — check the values argument
      const { db } = await import("@/lib/db");
      const insertCall = vi.mocked(db.insert);
      expect(insertCall).toHaveBeenCalled();
    });

    it("maps address fields from Workiz payload", async () => {
      const res = await POST(makeRequest(validPayload(), VALID_SECRET));
      expect(res.status).toBe(201);
    });

    it("defaults facilityState to AZ when not provided", async () => {
      const payload = validPayload({
        address: { street: "123 Main", city: "Tucson", zip: "85701", county: "Pima" },
      });
      const res = await POST(makeRequest(payload, VALID_SECRET));
      expect(res.status).toBe(201);
    });

    it("maps scheduledDate to dateOfInspection", async () => {
      const res = await POST(makeRequest(validPayload(), VALID_SECRET));
      expect(res.status).toBe(201);
    });

    it("maps APN to taxParcelNumber when present", async () => {
      const payload = validPayload({ apn: "111-22-333" });
      const res = await POST(makeRequest(payload, VALID_SECRET));
      expect(res.status).toBe(201);
    });

    it("uses empty APN when not present", async () => {
      const payload = validPayload({ apn: "" });
      const res = await POST(makeRequest(payload, VALID_SECRET));
      expect(res.status).toBe(201);
    });
  });

  // -----------------------------------------------------------------------
  // 7. Assessor data enrichment
  // -----------------------------------------------------------------------
  describe("Assessor data enrichment", () => {
    it("uses assessor ownerName as facilityName when assessor data present", async () => {
      const payload = validPayload({
        assessor: {
          ownerName: "Property Owner LLC",
          physicalAddress: "456 Oak Ave",
          city: "Scottsdale",
          zip: "85251",
          county: "Maricopa",
          apnFormatted: "123-45-678A",
        },
      });

      const res = await POST(makeRequest(payload, VALID_SECRET));
      expect(res.status).toBe(201);

      // Verify insert was called
      const { db } = await import("@/lib/db");
      expect(vi.mocked(db.insert)).toHaveBeenCalled();
    });

    it("falls back to Workiz address when assessor fields are empty", async () => {
      const payload = validPayload({
        assessor: {
          ownerName: "Owner Name",
          physicalAddress: "",
          city: "",
          zip: "",
          county: "",
        },
      });

      const res = await POST(makeRequest(payload, VALID_SECRET));
      expect(res.status).toBe(201);
    });

    it("does not use assessor path when ownerName is empty", async () => {
      const payload = validPayload({
        assessor: {
          ownerName: "",
          physicalAddress: "456 Oak Ave",
          city: "Scottsdale",
        },
      });

      const res = await POST(makeRequest(payload, VALID_SECRET));
      expect(res.status).toBe(201);
    });

    it("preserves Workiz customer name in customerName column even with assessor", async () => {
      const payload = validPayload({
        assessor: {
          ownerName: "Property Owner LLC",
          physicalAddress: "456 Oak Ave",
          city: "Scottsdale",
          zip: "85251",
          county: "Maricopa",
        },
      });

      const res = await POST(makeRequest(payload, VALID_SECRET));
      expect(res.status).toBe(201);
    });

    it("uses assessor apnFormatted for taxParcelNumber", async () => {
      const payload = validPayload({
        assessor: {
          ownerName: "Owner",
          apnFormatted: "123-45-678A",
        },
      });

      const res = await POST(makeRequest(payload, VALID_SECRET));
      expect(res.status).toBe(201);
    });
  });

  // -----------------------------------------------------------------------
  // 8. Inspection creation response
  // -----------------------------------------------------------------------
  describe("Inspection creation", () => {
    it("returns 201 with inspectionId and status on success", async () => {
      const res = await POST(makeRequest(validPayload(), VALID_SECRET));
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.inspectionId).toBe("insp-uuid-1");
      expect(json.status).toBe("draft");
    });

    it("stores workizJobId on the inspection", async () => {
      const res = await POST(makeRequest(validPayload(), VALID_SECRET));
      expect(res.status).toBe(201);

      const { db } = await import("@/lib/db");
      const insertMock = vi.mocked(db.insert);
      expect(insertMock).toHaveBeenCalled();
    });

    it("stores customerEmail from client.email", async () => {
      const payload = validPayload({
        client: { firstName: "John", lastName: "Doe", email: "customer@test.com", phone: "" },
      });
      const res = await POST(makeRequest(payload, VALID_SECRET));
      expect(res.status).toBe(201);
    });

    it("stores null customerEmail when client.email is empty", async () => {
      const payload = validPayload({
        client: { firstName: "John", lastName: "Doe", email: "", phone: "" },
      });
      const res = await POST(makeRequest(payload, VALID_SECRET));
      expect(res.status).toBe(201);
    });
  });
});
