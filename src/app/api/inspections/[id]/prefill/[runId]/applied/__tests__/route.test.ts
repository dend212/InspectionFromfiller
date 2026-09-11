import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetUser, mockGetSession, mockCreateClient, mockDbSelect, mockLoadRunRow, mockMarkApplied } =
  vi.hoisted(() => {
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
      mockMarkApplied: vi.fn(),
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
vi.mock("@/lib/prefill/run-store", () => ({
  loadRunRow: mockLoadRunRow,
  markRunApplied: mockMarkApplied,
}));

import { POST } from "../route";

function fakeAccessToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64");
  return `${header}.${body}.fakesig`;
}
const makeParams = (id: string, runId: string) => ({ params: Promise.resolve({ id, runId }) });
const makeRequest = () => new Request("http://localhost", { method: "POST" });

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: fakeAccessToken({ user_role: "field_tech" }) } },
  });
  mockDbSelect.mockResolvedValue([{ inspectorId: "user-1", status: "draft", formData: {} }]);
  mockLoadRunRow.mockResolvedValue({ id: "run-1", inspectionId: "insp-1", status: "done" });
  mockMarkApplied.mockResolvedValue(undefined);
});

describe("POST /api/inspections/[id]/prefill/[runId]/applied", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    expect((await POST(makeRequest(), makeParams("insp-1", "run-1"))).status).toBe(401);
  });

  it("returns 403 when a field tech touches a non-draft (edit access)", async () => {
    mockDbSelect.mockResolvedValueOnce([{ inspectorId: "user-1", status: "submitted", formData: {} }]);
    expect((await POST(makeRequest(), makeParams("insp-1", "run-1"))).status).toBe(403);
    expect(mockMarkApplied).not.toHaveBeenCalled();
  });

  it("returns 404 when the run is missing or belongs to another inspection", async () => {
    mockLoadRunRow.mockResolvedValueOnce(null);
    expect((await POST(makeRequest(), makeParams("insp-1", "run-1"))).status).toBe(404);
    mockLoadRunRow.mockResolvedValueOnce({ id: "run-1", inspectionId: "insp-2", status: "done" });
    expect((await POST(makeRequest(), makeParams("insp-1", "run-1"))).status).toBe(404);
  });

  it("marks the run applied", async () => {
    const res = await POST(makeRequest(), makeParams("insp-1", "run-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockMarkApplied).toHaveBeenCalledWith("run-1");
  });
});
