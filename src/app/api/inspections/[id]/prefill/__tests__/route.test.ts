import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetUser,
  mockGetSession,
  mockCreateClient,
  mockDbSelect,
  mockAfter,
  mockCountRuns,
  mockFailStale,
  mockFindActive,
  mockCreateRun,
  mockRunPrefill,
} = vi.hoisted(() => {
  const mockGetUser = vi.fn();
  const mockGetSession = vi.fn();
  const mockDbSelect = vi.fn();
  const mockCreateClient = vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
  });
  return {
    mockGetUser,
    mockGetSession,
    mockCreateClient,
    mockDbSelect,
    mockAfter: vi.fn(),
    mockCountRuns: vi.fn(),
    mockFailStale: vi.fn(),
    mockFindActive: vi.fn(),
    mockCreateRun: vi.fn(),
    mockRunPrefill: vi.fn(),
  };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));

vi.mock("@/lib/db", () => {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(() => mockDbSelect()),
  };
  return { db: { select: vi.fn(() => selectChain) } };
});

vi.mock("@/lib/db/schema", () => ({
  inspections: { id: "id", inspectorId: "inspector_id", status: "status", formData: "form_data" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ _col, val })),
}));

// after() throws outside a request scope — replace it, keep NextResponse
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: mockAfter };
});

vi.mock("@/lib/prefill/run-store", () => ({
  countRunsInLastHour: mockCountRuns,
  failStaleRuns: mockFailStale,
  findActiveRun: mockFindActive,
  createRun: mockCreateRun,
}));

vi.mock("@/lib/prefill/run-prefill", () => ({ runPrefill: mockRunPrefill }));

import { maxDuration, POST } from "../route";

function fakeAccessToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64");
  return `${header}.${body}.fakesig`;
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeRequest(body?: unknown): Request {
  return new Request("http://localhost/api/inspections/insp-1/prefill", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const USER = { id: "user-1", email: "tech@example.com" };
const INSPECTION = {
  inspectorId: "user-1",
  status: "draft",
  formData: {
    facilityInfo: {
      taxParcelNumber: "219-11-121",
      facilityAddress: "8911 E Cave Creek Rd",
      facilityCity: "Carefree",
      facilityZip: "85377",
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: USER } });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: fakeAccessToken({ user_role: "field_tech" }) } },
  });
  mockDbSelect.mockResolvedValue([INSPECTION]);
  mockCountRuns.mockResolvedValue(0);
  mockFailStale.mockResolvedValue(undefined);
  mockFindActive.mockResolvedValue(null);
  mockCreateRun.mockResolvedValue("run-1");
  mockRunPrefill.mockResolvedValue(undefined);
});

describe("POST /api/inspections/[id]/prefill", () => {
  it("exports maxDuration = 300 for the background work", () => {
    expect(maxDuration).toBe(300);
  });

  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const res = await POST(makeRequest({}), makeParams("insp-1"));
    expect(res.status).toBe(401);
    expect(mockCreateRun).not.toHaveBeenCalled();
  });

  it("returns 404 when the inspection does not exist", async () => {
    mockDbSelect.mockResolvedValueOnce([]);
    const res = await POST(makeRequest({}), makeParams("insp-1"));
    expect(res.status).toBe(404);
  });

  it("returns 403 for a non-owner field tech and for a tech on a non-draft", async () => {
    mockDbSelect.mockResolvedValueOnce([{ ...INSPECTION, inspectorId: "other" }]);
    expect((await POST(makeRequest({}), makeParams("insp-1"))).status).toBe(403);
    mockDbSelect.mockResolvedValueOnce([{ ...INSPECTION, status: "submitted" }]);
    expect((await POST(makeRequest({}), makeParams("insp-1"))).status).toBe(403);
  });

  it("creates a run from the body, schedules runPrefill via after() and returns 201", async () => {
    const res = await POST(
      makeRequest({ apn: "200-08-079", trigger: "apn_lookup" }),
      makeParams("insp-1"),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ runId: "run-1" });

    expect(mockCreateRun).toHaveBeenCalledWith({
      inspectionId: "insp-1",
      trigger: "apn_lookup",
      input: expect.objectContaining({ apn: "200-08-079" }),
      createdBy: "user-1",
    });

    expect(mockAfter).toHaveBeenCalledTimes(1);
    expect(mockRunPrefill).not.toHaveBeenCalled();
    await mockAfter.mock.calls[0][0]();
    expect(mockRunPrefill).toHaveBeenCalledWith("run-1");
  });

  it("defaults the APN and address from facilityInfo and the trigger to manual", async () => {
    const res = await POST(makeRequest(), makeParams("insp-1"));
    expect(res.status).toBe(201);
    expect(mockCreateRun).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: "manual",
        input: {
          apn: "219-11-121",
          address: {
            streetNumber: "8911",
            streetDir: "E",
            streetName: "Cave Creek Rd",
            city: "Carefree",
            zip: "85377",
            full: "8911 E Cave Creek Rd, Carefree, AZ 85377",
          },
        },
      }),
    );
  });

  it("returns 400 for an invalid APN and for an unparseable body", async () => {
    const bad = await POST(makeRequest({ apn: "1'; DROP" }), makeParams("insp-1"));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("Invalid APN format");

    const shape = await POST(makeRequest({ address: { streetNumber: "x" } }), makeParams("insp-1"));
    expect(shape.status).toBe(400);
    expect((await shape.json()).error).toBe("Invalid request");
  });

  it("returns 400 when there is nothing to search", async () => {
    mockDbSelect.mockResolvedValueOnce([{ ...INSPECTION, formData: {} }]);
    const res = await POST(makeRequest({}), makeParams("insp-1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Enter an APN or a street address first");
  });

  it("returns 429 once three runs exist in the last hour", async () => {
    mockCountRuns.mockResolvedValueOnce(3);
    const res = await POST(makeRequest({}), makeParams("insp-1"));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("Prefill limit reached (3 per hour)");
    expect(mockCreateRun).not.toHaveBeenCalled();
  });

  it("fails stale runs, then returns 409 while a run is still active", async () => {
    mockFindActive.mockResolvedValueOnce({ id: "run-0" });
    const res = await POST(makeRequest({}), makeParams("insp-1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("A prefill run is already in progress");
    expect(mockFailStale).toHaveBeenCalledWith("insp-1");
    expect(mockCreateRun).not.toHaveBeenCalled();
  });

  it("lets admins start runs on non-drafts they do not own", async () => {
    mockGetSession.mockResolvedValueOnce({
      data: { session: { access_token: fakeAccessToken({ user_role: "admin" }) } },
    });
    mockDbSelect.mockResolvedValueOnce([{ ...INSPECTION, inspectorId: "other", status: "in_review" }]);
    const res = await POST(makeRequest({}), makeParams("insp-1"));
    expect(res.status).toBe(201);
  });
});
