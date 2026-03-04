import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockGetUser, mockCreateClient } = vi.hoisted(() => {
  const mockGetUser = vi.fn();
  const mockCreateClient = vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser },
  });
  return { mockGetUser, mockCreateClient };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));

// Mock global fetch for ArcGIS API calls
const mockFetch = vi.fn();

// ---------------------------------------------------------------------------
// Import the handler under test
// ---------------------------------------------------------------------------
import { GET } from "../route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_USER = { id: "user-1", email: "tech@sewertime.com" };

function makeRequest(apn?: string): Request {
  const url = apn
    ? `http://localhost/api/apn-lookup?apn=${encodeURIComponent(apn)}`
    : "http://localhost/api/apn-lookup";
  return new Request(url, { method: "GET" });
}

function arcgisResponse(attributes: Record<string, unknown> | null) {
  if (attributes === null) {
    return { features: [] };
  }
  return {
    features: [{ attributes }],
  };
}

const FULL_PROPERTY = {
  OWNER_NAME: "John Doe",
  PHYSICAL_ADDRESS: "123 Main St",
  PHYSICAL_CITY: "Phoenix",
  PHYSICAL_ZIP: "85001",
  JURISDICTION: "Maricopa",
  APN_DASH: "123-45-678",
  LAND_SIZE: 12000,
  CONST_YEAR: "1995",
  SUBNAME: "Sunset Estates",
  LOT_NUM: "42",
  BLOCK: "3",
  STR: "T1N R1E S5",
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: VALID_USER } });

  // Replace global fetch with mock
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(arcgisResponse(FULL_PROPERTY)),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/apn-lookup", () => {
  // -----------------------------------------------------------------------
  // 1. Authentication
  // -----------------------------------------------------------------------
  describe("Authentication", () => {
    it("returns 401 when user is not authenticated", async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: null } });

      const res = await GET(makeRequest("123-45-678"));
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe("Unauthorized");
    });
  });

  // -----------------------------------------------------------------------
  // 2. Input validation
  // -----------------------------------------------------------------------
  describe("Input validation", () => {
    it("returns 400 when apn parameter is missing", async () => {
      const res = await GET(makeRequest());
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/apn.*required/i);
    });

    it("returns 400 when apn parameter is empty string", async () => {
      const res = await GET(makeRequest(""));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/apn.*required/i);
    });

    it("returns 400 when apn parameter is whitespace only", async () => {
      const res = await GET(makeRequest("   "));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/apn.*required/i);
    });

    it("returns 400 for APN with invalid characters (letters)", async () => {
      const res = await GET(makeRequest("ABC-45-678"));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/invalid apn format/i);
    });

    it("returns 400 for APN with special characters", async () => {
      const res = await GET(makeRequest("123@45#678"));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/invalid apn format/i);
    });

    it("returns 400 for APN longer than 20 characters", async () => {
      const longApn = "123-45-678-90-123-456";
      expect(longApn.length).toBeGreaterThan(20);
      const res = await GET(makeRequest(longApn));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/invalid apn format/i);
    });

    it("returns 400 for APN with no digits", async () => {
      const res = await GET(makeRequest("---"));
      expect(res.status).toBe(400);
    });

    it("accepts valid APN formats", async () => {
      const res = await GET(makeRequest("123-45-678"));
      expect(res.status).toBe(200);
    });

    it("accepts APN with spaces", async () => {
      const res = await GET(makeRequest("123 45 678"));
      expect(res.status).toBe(200);
    });

    it("accepts APN with only digits", async () => {
      const res = await GET(makeRequest("12345678"));
      expect(res.status).toBe(200);
    });
  });

  // -----------------------------------------------------------------------
  // 3. Rate limiting
  // -----------------------------------------------------------------------
  describe("Rate limiting", () => {
    it("returns 429 after 30 lookups within an hour", async () => {
      // Use a unique user for this test to avoid cross-test contamination
      const rateLimitUser = { id: `rate-limit-user-${Date.now()}`, email: "ratelimit@test.com" };
      mockGetUser.mockResolvedValue({ data: { user: rateLimitUser } });

      // Make 30 successful requests
      for (let i = 0; i < 30; i++) {
        const res = await GET(makeRequest("123-45-678"));
        expect(res.status).toBe(200);
      }

      // 31st should be rate limited
      const res = await GET(makeRequest("123-45-678"));
      expect(res.status).toBe(429);
      const json = await res.json();
      expect(json.error).toMatch(/too many/i);
    });

    it("rate limits per user, not globally", async () => {
      const user1 = { id: `user-rl-1-${Date.now()}`, email: "u1@test.com" };
      const user2 = { id: `user-rl-2-${Date.now()}`, email: "u2@test.com" };

      // Exhaust user1's quota
      mockGetUser.mockResolvedValue({ data: { user: user1 } });
      for (let i = 0; i < 30; i++) {
        await GET(makeRequest("123-45-678"));
      }

      // User2 should still be able to make requests
      mockGetUser.mockResolvedValue({ data: { user: user2 } });
      const res = await GET(makeRequest("123-45-678"));
      expect(res.status).toBe(200);
    });
  });

  // -----------------------------------------------------------------------
  // 4. Successful response
  // -----------------------------------------------------------------------
  describe("Successful response", () => {
    it("returns assessor data with all fields mapped", async () => {
      const res = await GET(makeRequest("123-45-678"));
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.assessor).toBeDefined();
      expect(json.assessor.ownerName).toBe("John Doe");
      expect(json.assessor.physicalAddress).toBe("123 Main St");
      expect(json.assessor.city).toBe("Phoenix");
      expect(json.assessor.zip).toBe("85001");
      expect(json.assessor.county).toBe("Maricopa");
      expect(json.assessor.apnFormatted).toBe("123-45-678");
      expect(json.assessor.lotSize).toBe("12000");
      expect(json.assessor.yearBuilt).toBe("1995");
    });

    it("constructs legal description from SUBNAME, LOT_NUM, BLOCK, STR", async () => {
      const res = await GET(makeRequest("123-45-678"));
      const json = await res.json();

      expect(json.assessor.legalDescription).toBe("Sunset Estates, Lot 42, Block 3, STR T1N R1E S5");
    });

    it("handles partial legal description (some fields missing)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve(
            arcgisResponse({
              ...FULL_PROPERTY,
              SUBNAME: "Desert View",
              LOT_NUM: "",
              BLOCK: "",
              STR: "",
            }),
          ),
      });

      const res = await GET(makeRequest("123-45-678"));
      const json = await res.json();
      expect(json.assessor.legalDescription).toBe("Desert View");
    });

    it("returns empty strings for missing attributes", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve(
            arcgisResponse({
              OWNER_NAME: "",
              PHYSICAL_ADDRESS: "",
              PHYSICAL_CITY: "",
              PHYSICAL_ZIP: "",
              JURISDICTION: "",
              APN_DASH: "",
              LAND_SIZE: 0,
              CONST_YEAR: "",
              SUBNAME: "",
              LOT_NUM: "",
              BLOCK: "",
              STR: "",
            }),
          ),
      });

      const res = await GET(makeRequest("123-45-678"));
      const json = await res.json();
      expect(json.assessor.ownerName).toBe("");
      expect(json.assessor.legalDescription).toBe("");
      // LAND_SIZE: 0 is falsy, so String(0 || "") becomes ""
      expect(json.assessor.lotSize).toBe("");
    });
  });

  // -----------------------------------------------------------------------
  // 5. No results
  // -----------------------------------------------------------------------
  describe("Empty results", () => {
    it("returns 404 when no property found for APN", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ features: [] }),
      });

      const res = await GET(makeRequest("999-99-999"));
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toMatch(/no property found/i);
    });

    it("returns 404 when features array is undefined", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const res = await GET(makeRequest("999-99-999"));
      expect(res.status).toBe(404);
    });
  });

  // -----------------------------------------------------------------------
  // 6. External API error handling
  // -----------------------------------------------------------------------
  describe("External API error handling", () => {
    it("returns 502 when Maricopa County API returns non-200", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const res = await GET(makeRequest("123-45-678"));
      expect(res.status).toBe(502);
      const json = await res.json();
      expect(json.error).toMatch(/assessor service unavailable/i);
    });

    it("returns 500 when fetch throws (network error)", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const res = await GET(makeRequest("123-45-678"));
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toMatch(/apn lookup failed/i);
    });

    it("returns 500 when fetch throws timeout error", async () => {
      mockFetch.mockRejectedValueOnce(new DOMException("Signal timed out", "TimeoutError"));

      const res = await GET(makeRequest("123-45-678"));
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toMatch(/apn lookup failed/i);
    });
  });
});
