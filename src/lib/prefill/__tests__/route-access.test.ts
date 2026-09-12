import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetUser, mockGetSession, mockCreateClient, mockDbSelect } = vi.hoisted(() => {
  const mockGetUser = vi.fn();
  const mockGetSession = vi.fn();
  const mockDbSelect = vi.fn();
  const mockCreateClient = vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
  });
  return { mockGetUser, mockGetSession, mockCreateClient, mockDbSelect };
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

import { db } from "@/lib/db";
import { requireInspectionAccess } from "@/lib/prefill/route-access";

function fakeAccessToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64");
  return `${header}.${body}.fakesig`;
}

function sessionWithRole(role: string) {
  return { data: { session: { access_token: fakeAccessToken({ user_role: role }) } } };
}

const USER = { id: "user-1", email: "tech@example.com" };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: USER } });
  mockGetSession.mockResolvedValue(sessionWithRole("field_tech"));
  mockDbSelect.mockResolvedValue([{ inspectorId: "user-1", status: "draft", formData: {} }]);
});

describe("requireInspectionAccess", () => {
  it("selects formData only for edit access (the polling GETs must not load it)", async () => {
    await requireInspectionAccess("insp-1", "view");
    expect(vi.mocked(db.select).mock.calls[0][0]).toEqual({ inspectorId: "inspector_id", status: "status" });

    const edit = await requireInspectionAccess("insp-1", "edit");
    expect(vi.mocked(db.select).mock.calls[1][0]).toEqual({
      inspectorId: "inspector_id",
      status: "status",
      formData: "form_data",
    });
    expect(edit.ok).toBe(true);
    if (edit.ok) expect(edit.inspection.formData).toEqual({});
  });

  it("returns a 401 response when unauthenticated", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    const access = await requireInspectionAccess("insp-1", "view");
    expect(access.ok).toBe(false);
    if (!access.ok) expect(access.response.status).toBe(401);
  });

  it("returns a 404 response when the inspection does not exist", async () => {
    mockDbSelect.mockResolvedValueOnce([]);
    const access = await requireInspectionAccess("insp-1", "view");
    expect(access.ok).toBe(false);
    if (!access.ok) expect(access.response.status).toBe(404);
  });

  it("lets the owner view and edit their draft", async () => {
    const access = await requireInspectionAccess("insp-1", "edit");
    expect(access.ok).toBe(true);
    if (access.ok) {
      expect(access.userId).toBe("user-1");
      expect(access.inspection.inspectorId).toBe("user-1");
      expect(access.isPrivileged).toBe(false);
    }
  });

  it("returns 403 for a non-owner field tech", async () => {
    mockDbSelect.mockResolvedValueOnce([{ inspectorId: "someone-else", status: "draft", formData: {} }]);
    const access = await requireInspectionAccess("insp-1", "view");
    expect(access.ok).toBe(false);
    if (!access.ok) expect(access.response.status).toBe(403);
  });

  it("returns 403 when a field tech edits a non-draft, but allows viewing it", async () => {
    mockDbSelect.mockResolvedValue([{ inspectorId: "user-1", status: "submitted", formData: {} }]);
    const edit = await requireInspectionAccess("insp-1", "edit");
    expect(edit.ok).toBe(false);
    if (!edit.ok) {
      expect(edit.response.status).toBe(403);
      expect((await edit.response.json()).error).toContain("no longer a draft");
    }
    const view = await requireInspectionAccess("insp-1", "view");
    expect(view.ok).toBe(true);
  });

  it("lets admin and office_staff edit anyone's inspection in any status", async () => {
    for (const role of ["admin", "office_staff"]) {
      mockGetSession.mockResolvedValue(sessionWithRole(role));
      mockDbSelect.mockResolvedValueOnce([{ inspectorId: "someone-else", status: "completed", formData: {} }]);
      const access = await requireInspectionAccess("insp-1", "edit");
      expect(access.ok).toBe(true);
      if (access.ok) expect(access.isPrivileged).toBe(true);
    }
  });
});
