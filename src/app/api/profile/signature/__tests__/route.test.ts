import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const {
  mockGetUser,
  mockCreateClient,
  mockDbSelect,
  mockDbUpdate,
} = vi.hoisted(() => {
  const mockGetUser = vi.fn();
  const mockDbSelect = vi.fn();
  const mockDbUpdate = vi.fn();

  const mockCreateClient = vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser },
  });

  return { mockGetUser, mockCreateClient, mockDbSelect, mockDbUpdate };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));

vi.mock("@/lib/db", () => {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(() => mockDbSelect()),
  };
  const updateChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn(() => mockDbUpdate()),
  };
  return {
    db: {
      select: vi.fn(() => selectChain),
      update: vi.fn(() => updateChain),
    },
  };
});

vi.mock("@/lib/db/schema", () => ({
  profiles: { id: "id", signatureDataUrl: "signature_data_url" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ _col, val })),
}));

// ---------------------------------------------------------------------------
// Import handlers
// ---------------------------------------------------------------------------
import { GET, PUT } from "../route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const USER = { id: "user-1" };
const VALID_SIGNATURE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";

function makePutRequest(body?: unknown): Request {
  return new Request("http://localhost/api/profile/signature", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: USER } });
  mockDbSelect.mockResolvedValue([{ signatureDataUrl: VALID_SIGNATURE }]);
  mockDbUpdate.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("GET /api/profile/signature", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns the stored signature data URL", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.signatureDataUrl).toBe(VALID_SIGNATURE);
  });

  it("returns null when no signature exists", async () => {
    mockDbSelect.mockResolvedValueOnce([{ signatureDataUrl: null }]);
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.signatureDataUrl).toBeNull();
  });

  it("returns null when no profile found", async () => {
    mockDbSelect.mockResolvedValueOnce([]);
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.signatureDataUrl).toBeNull();
  });
});

describe("PUT /api/profile/signature", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const res = await PUT(makePutRequest({ signatureDataUrl: VALID_SIGNATURE }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when signatureDataUrl is not a string", async () => {
    const res = await PUT(makePutRequest({ signatureDataUrl: 123 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Invalid signature format");
  });

  it("returns 400 when signatureDataUrl does not start with data:image/png;base64,", async () => {
    const res = await PUT(makePutRequest({ signatureDataUrl: "data:image/jpeg;base64,abc" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Invalid signature format");
  });

  it("returns 400 when signatureDataUrl is missing", async () => {
    const res = await PUT(makePutRequest({}));
    expect(res.status).toBe(400);
  });

  it("returns 400 when signature is too large (>100KB)", async () => {
    const largeSignature = `data:image/png;base64,${"A".repeat(100_001)}`;
    const res = await PUT(makePutRequest({ signatureDataUrl: largeSignature }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Signature too large");
  });

  it("saves a valid signature and returns success", async () => {
    const res = await PUT(makePutRequest({ signatureDataUrl: VALID_SIGNATURE }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("returns 400 when request body is invalid JSON", async () => {
    const req = new Request("http://localhost/api/profile/signature", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const res = await PUT(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for empty string signatureDataUrl", async () => {
    const res = await PUT(makePutRequest({ signatureDataUrl: "" }));
    expect(res.status).toBe(400);
  });
});
