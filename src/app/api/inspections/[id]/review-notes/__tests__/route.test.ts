import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const { mockGetUser, mockGetSession, mockCreateClient, mockDbUpdate, mockSet } = vi.hoisted(() => {
  const mockGetUser = vi.fn();
  const mockGetSession = vi.fn();
  const mockDbUpdate = vi.fn();
  const mockSet = vi.fn();
  const mockCreateClient = vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
  });
  return { mockGetUser, mockGetSession, mockCreateClient, mockDbUpdate, mockSet };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));

vi.mock("@/lib/db", () => {
  const updateChain = {
    set: vi.fn((values: unknown) => {
      mockSet(values);
      return updateChain;
    }),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn(() => mockDbUpdate()),
  };
  return { db: { update: vi.fn(() => updateChain) } };
});

vi.mock("@/lib/db/schema", () => ({
  inspections: { id: "id", status: "status", reviewNotes: "review_notes" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ _col, val })),
  and: vi.fn((...args: unknown[]) => args),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings: [...strings], values })),
}));

// ---------------------------------------------------------------------------
// Import handler
// ---------------------------------------------------------------------------
import { PATCH } from "../route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fakeAccessToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64");
  return `${header}.${body}.fakesig`;
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeRequest(body?: unknown): Request {
  return new Request("http://localhost/api/inspections/insp-1/review-notes", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? "not json" : JSON.stringify(body),
  });
}

const USER = { id: "admin-1" };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: USER } });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: fakeAccessToken({ user_role: "admin" }) } },
  });
  mockDbUpdate.mockResolvedValue([{ id: "insp-1" }]);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("PATCH /api/inspections/[id]/review-notes", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const res = await PATCH(makeRequest({ append: "x" }), makeParams("insp-1"));
    expect(res.status).toBe(401);
  });

  it("returns 403 for field_tech and office_staff", async () => {
    for (const role of ["field_tech", "office_staff"]) {
      mockGetSession.mockResolvedValueOnce({
        data: { session: { access_token: fakeAccessToken({ user_role: role }) } },
      });
      const res = await PATCH(makeRequest({ append: "x" }), makeParams("insp-1"));
      expect(res.status).toBe(403);
      expect((await res.json()).error).toContain("admin only");
    }
  });

  it("returns 400 when append is missing, blank, too long, or the body is not JSON", async () => {
    expect((await PATCH(makeRequest({}), makeParams("insp-1"))).status).toBe(400);
    expect((await PATCH(makeRequest({ append: "   " }), makeParams("insp-1"))).status).toBe(400);
    expect((await PATCH(makeRequest({ append: "x".repeat(2001) }), makeParams("insp-1"))).status).toBe(400);
    expect((await PATCH(makeRequest(), makeParams("insp-1"))).status).toBe(400);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("appends the trimmed line with concat_ws and returns { appended: true }", async () => {
    const res = await PATCH(
      makeRequest({ append: "  Finalized with 1 validation issue: Facility Name  " }),
      makeParams("insp-1"),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ appended: true });
    const setArg = mockSet.mock.calls[0][0] as { reviewNotes: { strings: string[]; values: unknown[] } };
    expect(setArg.reviewNotes.strings.join("?")).toBe("concat_ws(chr(10), ?, ?)");
    expect(setArg.reviewNotes.values).toEqual([
      "review_notes",
      "Finalized with 1 validation issue: Facility Name",
    ]);
  });

  it("returns 409 when the inspection is not in_review", async () => {
    mockDbUpdate.mockResolvedValueOnce([]);
    const res = await PATCH(makeRequest({ append: "x" }), makeParams("insp-1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("not in review");
  });
});
