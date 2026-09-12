import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetUser,
  mockGetSession,
  mockCreateClient,
  mockDbSelect,
  mockLoadRunRow,
  mockUpdateRun,
  mockAfter,
  mockContinue,
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
    mockLoadRunRow: vi.fn(),
    mockUpdateRun: vi.fn(),
    mockAfter: vi.fn(),
    mockContinue: vi.fn(),
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
vi.mock("drizzle-orm", () => ({ eq: vi.fn((_c: unknown, v: unknown) => ({ _c, v })) }));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: mockAfter };
});
vi.mock("@/lib/prefill/run-store", () => ({
  loadRunRow: mockLoadRunRow,
  updateRun: mockUpdateRun,
}));
vi.mock("@/lib/prefill/run-prefill", () => ({
  continuePrefillAfterSelection: mockContinue,
}));

import { MAX_CANDIDATES } from "@/lib/prefill/permits/search";
import { maxDuration, POST } from "../route";

function fakeAccessToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64");
  return `${header}.${body}.fakesig`;
}
const makeParams = (id: string, runId: string) => ({ params: Promise.resolve({ id, runId }) });
const makeRequest = (body: unknown) =>
  new Request("http://localhost", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const KEYS = ["edms_env:OW-17-00474:PERMIT:2017-03-01"];

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: fakeAccessToken({ user_role: "field_tech" }) } },
  });
  mockDbSelect.mockResolvedValue([{ inspectorId: "user-1", status: "draft", formData: {} }]);
  mockLoadRunRow.mockResolvedValue({ id: "run-1", inspectionId: "insp-1", status: "done" });
  mockUpdateRun.mockResolvedValue(undefined);
  mockContinue.mockResolvedValue(undefined);
});

describe("POST /api/inspections/[id]/prefill/[runId]/select", () => {
  it("exports maxDuration = 300", () => {
    expect(maxDuration).toBe(300);
  });

  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    expect((await POST(makeRequest({ candidateKeys: KEYS }), makeParams("insp-1", "run-1"))).status).toBe(401);
  });

  it("returns 400 for a bad body (no keys, more than MAX_CANDIDATES, non-strings)", async () => {
    const tooMany = Array.from({ length: MAX_CANDIDATES + 1 }, (_, i) => `k${i}`);
    for (const body of [{}, { candidateKeys: [] }, { candidateKeys: tooMany }, { candidateKeys: [1] }]) {
      const res = await POST(makeRequest(body), makeParams("insp-1", "run-1"));
      expect(res.status).toBe(400);
    }
  });

  it("accepts a whole picker group (up to MAX_CANDIDATES keys), not just the 3 extraction slots", async () => {
    // Regression: the picker sends every document in the chosen property so a 4th-ranked
    // ABANDONMENT is stored (skipped) like the auto-select path does, not silently dropped.
    const eightKeys = Array.from({ length: MAX_CANDIDATES }, (_, i) => `edms_env:P${i}:PERMIT:2020-01-0${i + 1}`);
    mockLoadRunRow.mockResolvedValueOnce({ id: "run-1", inspectionId: "insp-1", status: "awaiting_selection" });
    const res = await POST(makeRequest({ candidateKeys: eightKeys }), makeParams("insp-1", "run-1"));
    expect(res.status).toBe(200);
    await mockAfter.mock.calls[0][0]();
    expect(mockContinue).toHaveBeenCalledWith("run-1", eightKeys);
  });

  it("returns 404 when the run belongs to another inspection", async () => {
    mockLoadRunRow.mockResolvedValueOnce({ id: "run-1", inspectionId: "insp-2", status: "awaiting_selection" });
    expect((await POST(makeRequest({ candidateKeys: KEYS }), makeParams("insp-1", "run-1"))).status).toBe(404);
  });

  it("returns 409 when the run is not awaiting selection (always, in phase 1)", async () => {
    const res = await POST(makeRequest({ candidateKeys: KEYS }), makeParams("insp-1", "run-1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Run is not awaiting selection");
    expect(mockAfter).not.toHaveBeenCalled();
  });

  it("moves an awaiting_selection run to running and continues in after()", async () => {
    mockLoadRunRow.mockResolvedValueOnce({ id: "run-1", inspectionId: "insp-1", status: "awaiting_selection" });
    const res = await POST(makeRequest({ candidateKeys: KEYS }), makeParams("insp-1", "run-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockUpdateRun).toHaveBeenCalledWith("run-1", { status: "running" });
    expect(mockAfter).toHaveBeenCalledTimes(1);
    await mockAfter.mock.calls[0][0]();
    expect(mockContinue).toHaveBeenCalledWith("run-1", KEYS);
  });

  it("the after() callback never rejects even if the continuation throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockLoadRunRow.mockResolvedValueOnce({ id: "run-1", inspectionId: "insp-1", status: "awaiting_selection" });
    mockContinue.mockRejectedValueOnce(new Error("db down"));
    const res = await POST(makeRequest({ candidateKeys: KEYS }), makeParams("insp-1", "run-1"));
    expect(res.status).toBe(200);
    await expect(mockAfter.mock.calls[0][0]()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
