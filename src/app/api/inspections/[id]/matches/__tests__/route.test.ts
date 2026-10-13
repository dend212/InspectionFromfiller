import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAccess, mockFindCandidates } = vi.hoisted(() => ({
  mockAccess: vi.fn(),
  mockFindCandidates: vi.fn(),
}));

vi.mock("@/lib/prefill/route-access", () => ({ requireInspectionAccess: mockAccess }));
// The real find.ts + match.ts run; only the SELECT is mocked
vi.mock("@/lib/inspection-matches/store", () => ({ findMatchCandidates: mockFindCandidates }));

import type { MatchCandidateRow } from "@/lib/inspection-matches/store";
import { POST } from "../route";

// Synthetic fixtures only (spec §12)
const ID = "6f1c2a9e-0000-4000-8000-0000000000aa";
const HIDDEN_ID = "6f1c2a9e-0000-4000-8000-00000000beef";
const OWN_ID = "6f1c2a9e-0000-4000-8000-000000000001";

const granted = (userId: string, isPrivileged: boolean) => ({
  ok: true,
  userId,
  isPrivileged,
  inspection: { inspectorId: userId, status: "draft" },
});
const denied = (status: number, error: string) => ({ ok: false, response: NextResponse.json({ error }, { status }) });

function stored(over: Partial<MatchCandidateRow> = {}): MatchCandidateRow {
  return {
    id: OWN_ID,
    inspectorId: "tech-1",
    status: "completed",
    facilityAddress: "100 E Example Rd",
    facilityCity: "Cave Creek",
    facilityZip: "85331",
    apn: null,
    taxParcelNumber: "123-45-678",
    inspectionDate: "2026-10-06",
    createdAt: new Date("2026-10-06T19:12:00.000Z"),
    workizJobId: null,
    inspectorName: "Sam Sample",
    ...over,
  };
}

const BODY = { facilityAddress: "100 E Example Rd", facilityCity: "Cave Creek", facilityZip: "85331", taxParcelNumber: "123-45-678" };

const call = (body: unknown, id = ID, raw = false) =>
  POST(
    new Request(`http://localhost/api/inspections/${id}/matches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: raw ? (body as string) : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockAccess.mockResolvedValue(granted("tech-1", false));
  mockFindCandidates.mockResolvedValue({ rows: [], capHit: false });
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/inspections/[id]/matches", () => {
  it("404 for a non-UUID id, before any auth or DB call", async () => {
    const res = await call(BODY, "not-a-uuid");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Inspection not found" });
    expect(mockAccess).not.toHaveBeenCalled();
    expect(mockFindCandidates).not.toHaveBeenCalled();
  });

  it.each([
    [401, "Unauthorized"],
    [404, "Inspection not found"],
    [403, "Forbidden"],
  ])("passes the access gate's %i through", async (status, error) => {
    mockAccess.mockResolvedValue(denied(status, error));
    const res = await call(BODY);
    expect(res.status).toBe(status);
    expect(mockFindCandidates).not.toHaveBeenCalled();
  });

  it("asks for view access to this inspection", async () => {
    await call(BODY);
    expect(mockAccess).toHaveBeenCalledWith(ID, "view");
  });

  it.each([
    ["invalid JSON", "{not json", true],
    ["an unknown key", { ...BODY, customerEmail: "test.client@example.com" }, false],
    ["a non-string", { facilityAddress: 100 }, false],
    ["a field over 1,000 characters", { facilityAddress: `100 E Example Rd ${"x".repeat(1000)}` }, false],
  ])("400 for %s, without echoing the input", async (_label, body, raw) => {
    const res = await call(body, ID, raw as boolean);
    expect(res.status).toBe(400);
    const text = JSON.stringify(await res.json());
    expect(text).toBe(JSON.stringify({ error: "Invalid request" }));
    expect(mockFindCandidates).not.toHaveBeenCalled();
  });

  it("an empty query → 200 empty with no store call", async () => {
    const res = await call({ facilityAddress: "Example Rd", taxParcelNumber: "N/A" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ matches: [], hiddenCount: 0, truncated: false });
    expect(mockFindCandidates).not.toHaveBeenCalled();
  });

  it("a 25-character APN is ignored but the address is still checked", async () => {
    mockFindCandidates.mockResolvedValue({ rows: [stored({ taxParcelNumber: null })], capHit: false });
    const res = await call({ ...BODY, taxParcelNumber: "123-45-678 see the permit" });
    expect(res.status).toBe(200);
    expect(mockFindCandidates).toHaveBeenCalledWith(expect.objectContaining({ houseNumbers: ["100"], apnKeys: [] }));
    expect((await res.json()).matches[0].reasons).toEqual(["address"]);
  });

  it("excludes the inspection itself and sends no-store", async () => {
    const res = await call(BODY);
    expect(mockFindCandidates).toHaveBeenCalledWith({
      houseNumbers: ["100"],
      apnKeys: ["12345678"],
      excludeInspectionId: ID,
      limit: 200,
    });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it.each([
    ["admin", "admin-1"],
    ["office staff", "office-1"],
  ])("%s gets full details and links for another inspector's match", async (_role, userId) => {
    mockAccess.mockResolvedValue(granted(userId, true));
    mockFindCandidates.mockResolvedValue({ rows: [stored({ inspectorId: "tech-9" })], capHit: false });
    const body = await (await call(BODY)).json();
    expect(body).toEqual({
      matches: [
        {
          inspectionId: OWN_ID,
          href: `/review/${OWN_ID}`,
          status: "completed",
          facilityAddress: "100 E Example Rd",
          facilityCity: "Cave Creek",
          inspectionDate: "2026-10-06",
          createdAt: "2026-10-06T19:12:00.000Z",
          inspectorName: "Sam Sample",
          isOwn: false,
          reasons: ["apn", "address"],
        },
      ],
      hiddenCount: 0,
      truncated: false,
    });
  });

  it("a field tech sees their own match in full and only a count for another inspector's", async () => {
    mockFindCandidates.mockResolvedValue({
      rows: [
        stored(),
        stored({ id: HIDDEN_ID, inspectorId: "tech-9", facilityCity: "Hiddenville", inspectorName: "Pat Private" }),
      ],
      capHit: false,
    });
    const body = await (await call(BODY)).json();
    expect(body.hiddenCount).toBe(1);
    expect(body.matches).toHaveLength(1);
    expect(body.matches[0]).toMatchObject({ inspectionId: OWN_ID, isOwn: true, href: `/inspections/${OWN_ID}` });
    const text = JSON.stringify(body);
    for (const leak of [HIDDEN_ID, "Hiddenville", "Pat Private"]) expect(text).not.toContain(leak);
  });

  it("a DB error → 500 with a fixed message; the log line carries no address or APN", async () => {
    const err = Object.assign(new Error(`Failed query: select … params: 100,12345678,${BODY.facilityAddress}`), {
      query: "select …",
      params: ["100", "12345678"],
      cause: { code: "57014" },
    });
    mockFindCandidates.mockRejectedValue(err);
    const res = await call(BODY);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Couldn't check for matching reports", code: "internal" });
    expect(errorSpy).toHaveBeenCalledWith("[inspection-matches] db error scope=match_lookup job=- code=57014 constraint=-");
    const logged = JSON.stringify(errorSpy.mock.calls);
    for (const leak of ["Example Rd", "12345678", "123-45-678", "Failed query"]) expect(logged).not.toContain(leak);
  });
});
