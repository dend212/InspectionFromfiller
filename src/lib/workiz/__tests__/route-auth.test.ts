import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetUser, mockGetUserRole } = vi.hoisted(() => ({ mockGetUser: vi.fn(), mockGetUserRole: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({ auth: { getUser: mockGetUser } }),
}));
vi.mock("@/lib/supabase/auth-helpers", () => ({ getUserRole: mockGetUserRole }));

import { requireWorkizImporter } from "@/lib/workiz/route-auth";

const USER = { id: "user-1", email: "tech@example.com" };

beforeEach(() => {
  mockGetUser.mockReset();
  mockGetUserRole.mockReset();
});

describe("requireWorkizImporter (spec §8.3)", () => {
  it("401 without a user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const auth = await requireWorkizImporter();
    expect(auth.ok).toBe(false);
    if (!auth.ok) {
      expect(auth.response.status).toBe(401);
      expect(await auth.response.json()).toEqual({ error: "Unauthorized" });
    }
  });

  it.each(["office_staff", null])("403 for role %s", async (role) => {
    mockGetUser.mockResolvedValue({ data: { user: USER } });
    mockGetUserRole.mockResolvedValue(role);
    const auth = await requireWorkizImporter();
    expect(auth.ok).toBe(false);
    if (!auth.ok) {
      expect(auth.response.status).toBe(403);
      expect(await auth.response.json()).toEqual({ error: "Forbidden" });
    }
  });

  it.each(["admin", "field_tech"])("admits %s", async (role) => {
    mockGetUser.mockResolvedValue({ data: { user: USER } });
    mockGetUserRole.mockResolvedValue(role);
    expect(await requireWorkizImporter()).toEqual({ ok: true, user: USER, role });
  });
});
