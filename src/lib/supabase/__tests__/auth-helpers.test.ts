import { describe, it, expect, vi, beforeEach } from "vitest";
import { getUserRole, checkInspectionAccess } from "../auth-helpers";

// Mock SupabaseClient type
function createMockSupabase(session: { access_token: string } | null) {
  return {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session },
      }),
    },
  } as any;
}

function encodeJwtPayload(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64");
  return `${header}.${body}.fake-signature`;
}

// ============================================================================
// getUserRole
// ============================================================================

describe("getUserRole", () => {
  it("returns the user_role from JWT payload", async () => {
    const token = encodeJwtPayload({ user_role: "admin" });
    const supabase = createMockSupabase({ access_token: token });

    const role = await getUserRole(supabase);
    expect(role).toBe("admin");
  });

  it("returns field_tech role", async () => {
    const token = encodeJwtPayload({ user_role: "field_tech" });
    const supabase = createMockSupabase({ access_token: token });

    const role = await getUserRole(supabase);
    expect(role).toBe("field_tech");
  });

  it("returns office_staff role", async () => {
    const token = encodeJwtPayload({ user_role: "office_staff" });
    const supabase = createMockSupabase({ access_token: token });

    const role = await getUserRole(supabase);
    expect(role).toBe("office_staff");
  });

  it("returns null when no session exists", async () => {
    const supabase = createMockSupabase(null);

    const role = await getUserRole(supabase);
    expect(role).toBeNull();
  });

  it("returns null when user_role is not in JWT payload", async () => {
    const token = encodeJwtPayload({ sub: "user-id", email: "user@test.com" });
    const supabase = createMockSupabase({ access_token: token });

    const role = await getUserRole(supabase);
    expect(role).toBeNull();
  });

  it("returns null when getSession throws", async () => {
    const supabase = {
      auth: {
        getSession: vi.fn().mockRejectedValue(new Error("Network error")),
      },
    } as any;

    const role = await getUserRole(supabase);
    expect(role).toBeNull();
  });

  it("returns null when token is malformed", async () => {
    const supabase = createMockSupabase({ access_token: "not-a-jwt" });

    const role = await getUserRole(supabase);
    // "not-a-jwt".split(".")[1] is "a-jwt" which is not valid base64 JSON
    // This should be caught by the try/catch
    expect(role).toBeNull();
  });

  it("returns null when JWT payload is not valid JSON", async () => {
    const supabase = createMockSupabase({
      access_token: "header.!!!invalid!!!.signature",
    });

    const role = await getUserRole(supabase);
    expect(role).toBeNull();
  });
});

// ============================================================================
// checkInspectionAccess
// ============================================================================

describe("checkInspectionAccess", () => {
  it("allows access when userId matches inspectorId", async () => {
    const token = encodeJwtPayload({ user_role: "field_tech" });
    const supabase = createMockSupabase({ access_token: token });

    const result = await checkInspectionAccess(supabase, "user-1", "user-1");
    expect(result.allowed).toBe(true);
    expect(result.role).toBe("field_tech");
  });

  it("allows access for admin even when userId !== inspectorId", async () => {
    const token = encodeJwtPayload({ user_role: "admin" });
    const supabase = createMockSupabase({ access_token: token });

    const result = await checkInspectionAccess(supabase, "user-1", "user-2");
    expect(result.allowed).toBe(true);
    expect(result.role).toBe("admin");
  });

  it("allows access for office_staff even when userId !== inspectorId", async () => {
    const token = encodeJwtPayload({ user_role: "office_staff" });
    const supabase = createMockSupabase({ access_token: token });

    const result = await checkInspectionAccess(
      supabase,
      "user-1",
      "user-2",
    );
    expect(result.allowed).toBe(true);
    expect(result.role).toBe("office_staff");
  });

  it("denies access for field_tech when userId !== inspectorId", async () => {
    const token = encodeJwtPayload({ user_role: "field_tech" });
    const supabase = createMockSupabase({ access_token: token });

    const result = await checkInspectionAccess(
      supabase,
      "user-1",
      "user-2",
    );
    expect(result.allowed).toBe(false);
    expect(result.role).toBe("field_tech");
  });

  it("denies access when no session and userId !== inspectorId", async () => {
    const supabase = createMockSupabase(null);

    const result = await checkInspectionAccess(
      supabase,
      "user-1",
      "user-2",
    );
    expect(result.allowed).toBe(false);
    expect(result.role).toBeNull();
  });

  it("allows access when same user but no role in JWT", async () => {
    const token = encodeJwtPayload({ sub: "user-1" });
    const supabase = createMockSupabase({ access_token: token });

    const result = await checkInspectionAccess(supabase, "user-1", "user-1");
    expect(result.allowed).toBe(true);
    expect(result.role).toBeNull();
  });
});
