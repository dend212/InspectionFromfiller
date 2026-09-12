import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetUser, mockGetSession, mockCreateClient, mockDbSelect, mockLoadRunDTO } = vi.hoisted(
  () => {
    const mockGetUser = vi.fn();
    const mockGetSession = vi.fn();
    const mockDbSelect = vi.fn();
    const mockCreateClient = vi.fn().mockResolvedValue({
      auth: { getUser: mockGetUser, getSession: mockGetSession },
    });
    return { mockGetUser, mockGetSession, mockCreateClient, mockDbSelect, mockLoadRunDTO: vi.fn() };
  },
);

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
vi.mock("@/lib/prefill/run-dto", () => ({ loadRunDTO: mockLoadRunDTO }));

import { GET } from "../route";

function fakeAccessToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64");
  return `${header}.${body}.fakesig`;
}
const makeParams = (id: string, runId: string) => ({ params: Promise.resolve({ id, runId }) });
const RUN = { id: "run-1", inspectionId: "insp-1", status: "running" };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: fakeAccessToken({ user_role: "field_tech" }) } },
  });
  mockDbSelect.mockResolvedValue([{ inspectorId: "user-1", status: "draft", formData: {} }]);
  mockLoadRunDTO.mockResolvedValue(RUN);
});

describe("GET /api/inspections/[id]/prefill/[runId]", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    expect((await GET(new Request("http://localhost"), makeParams("insp-1", "run-1"))).status).toBe(401);
  });

  it("returns 403 for a non-owner field tech", async () => {
    mockDbSelect.mockResolvedValueOnce([{ inspectorId: "other", status: "draft", formData: {} }]);
    expect((await GET(new Request("http://localhost"), makeParams("insp-1", "run-1"))).status).toBe(403);
  });

  it("returns the run DTO", async () => {
    const res = await GET(new Request("http://localhost"), makeParams("insp-1", "run-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(RUN);
    expect(mockLoadRunDTO).toHaveBeenCalledWith("run-1");
  });

  it("returns 404 when the run is missing or belongs to another inspection", async () => {
    mockLoadRunDTO.mockResolvedValueOnce(null);
    expect((await GET(new Request("http://localhost"), makeParams("insp-1", "run-x"))).status).toBe(404);
    mockLoadRunDTO.mockResolvedValueOnce({ ...RUN, inspectionId: "insp-2" });
    const res = await GET(new Request("http://localhost"), makeParams("insp-1", "run-1"));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Run not found");
  });
});
