import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetUser, mockGetSession, mockCreateClient, mockDbSelect, mockDbUpdate, mockSet } =
  vi.hoisted(() => {
    const mockGetUser = vi.fn();
    const mockGetSession = vi.fn();
    const mockDbSelect = vi.fn();
    const mockDbUpdate = vi.fn();
    const mockSet = vi.fn();
    const mockCreateClient = vi.fn().mockResolvedValue({
      auth: { getUser: mockGetUser, getSession: mockGetSession },
    });
    return { mockGetUser, mockGetSession, mockCreateClient, mockDbSelect, mockDbUpdate, mockSet };
  });

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));

vi.mock("@/lib/db", () => {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(() => mockDbSelect()),
  };
  const updateChain = {
    set: vi.fn((v: unknown) => {
      mockSet(v);
      return updateChain;
    }),
    where: vi.fn(() => mockDbUpdate()),
  };
  return { db: { select: vi.fn(() => selectChain), update: vi.fn(() => updateChain) } };
});

vi.mock("@/lib/db/schema", () => ({
  inspections: {
    id: "id",
    inspectorId: "inspector_id",
    status: "status",
    formData: "form_data",
    fieldProvenance: "field_provenance",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ _col, val })),
}));

import { PATCH } from "../route";

function fakeAccessToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64");
  return `${header}.${body}.fakesig`;
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeRequest(body: unknown, raw = false): Request {
  return new Request("http://localhost/api/inspections/insp-1/provenance", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

const USER = { id: "user-1", email: "tech@example.com" };
const ENTRY = {
  source: "assessor",
  state: "prefilled",
  kind: "fill",
  value: "219-11-121",
  confidence: 1,
  explanation: "Maricopa County Assessor · parcel 219-11-121",
  sourceUrl: "https://mcassessor.maricopa.gov/mcs/?q=219-11-121",
  at: "2026-09-11T10:00:00.000Z",
};
const BODY = { fieldProvenance: { "facilityInfo.taxParcelNumber": ENTRY } };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: USER } });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: fakeAccessToken({ user_role: "field_tech" }) } },
  });
  mockDbSelect.mockResolvedValue([{ inspectorId: "user-1", status: "draft", formData: {} }]);
  mockDbUpdate.mockResolvedValue(undefined);
});

describe("PATCH /api/inspections/[id]/provenance", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const res = await PATCH(makeRequest(BODY), makeParams("insp-1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when the inspection does not exist", async () => {
    mockDbSelect.mockResolvedValueOnce([]);
    const res = await PATCH(makeRequest(BODY), makeParams("insp-1"));
    expect(res.status).toBe(404);
  });

  it("returns 403 for a non-owner field tech", async () => {
    mockDbSelect.mockResolvedValueOnce([{ inspectorId: "other", status: "draft", formData: {} }]);
    const res = await PATCH(makeRequest(BODY), makeParams("insp-1"));
    expect(res.status).toBe(403);
  });

  it("returns 403 when a field tech writes to a non-draft", async () => {
    mockDbSelect.mockResolvedValueOnce([{ inspectorId: "user-1", status: "in_review", formData: {} }]);
    const res = await PATCH(makeRequest(BODY), makeParams("insp-1"));
    expect(res.status).toBe(403);
  });

  it("replaces the whole map for the owner of a draft", async () => {
    const res = await PATCH(makeRequest(BODY), makeParams("insp-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ saved: true });
    expect(mockSet).toHaveBeenCalledWith({ fieldProvenance: BODY.fieldProvenance });
  });

  it("lets admins write provenance on any inspection", async () => {
    mockGetSession.mockResolvedValueOnce({
      data: { session: { access_token: fakeAccessToken({ user_role: "admin" }) } },
    });
    mockDbSelect.mockResolvedValueOnce([{ inspectorId: "other", status: "completed", formData: {} }]);
    const res = await PATCH(makeRequest({ fieldProvenance: {} }), makeParams("insp-1"));
    expect(res.status).toBe(200);
  });

  it("lets office staff verify provenance on another tech's in_review inspection (review page)", async () => {
    mockGetSession.mockResolvedValueOnce({
      data: { session: { access_token: fakeAccessToken({ user_role: "office_staff" }) } },
    });
    mockDbSelect.mockResolvedValueOnce([{ inspectorId: "other", status: "in_review", formData: {} }]);
    const verified = { ...ENTRY, state: "verified" };
    const res = await PATCH(
      makeRequest({ fieldProvenance: { "facilityInfo.taxParcelNumber": verified } }),
      makeParams("insp-1"),
    );
    expect(res.status).toBe(200);
    expect(mockSet).toHaveBeenCalledWith({
      fieldProvenance: { "facilityInfo.taxParcelNumber": verified },
    });
  });

  it("returns 400 for invalid JSON", async () => {
    const res = await PATCH(makeRequest("{not json", true), makeParams("insp-1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid JSON body");
  });

  it("returns 400 when the map fails validation (bad source, javascript: URL)", async () => {
    const badSource = await PATCH(
      makeRequest({ fieldProvenance: { "facilityInfo.x": { ...ENTRY, source: "zillow" } } }),
      makeParams("insp-1"),
    );
    expect(badSource.status).toBe(400);
    expect((await badSource.json()).error).toBe("Invalid provenance");

    const badUrl = await PATCH(
      makeRequest({ fieldProvenance: { "facilityInfo.x": { ...ENTRY, sourceUrl: "javascript:alert(1)" } } }),
      makeParams("insp-1"),
    );
    expect(badUrl.status).toBe(400);
    expect(mockSet).not.toHaveBeenCalled();
  });
});
