import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockCreateServerClient, mockCookieStore } = vi.hoisted(() => {
  const mockCookieStore = {
    getAll: vi.fn().mockReturnValue([
      { name: "sb-access-token", value: "token-123" },
      { name: "sb-refresh-token", value: "refresh-456" },
    ]),
    set: vi.fn(),
  };

  const mockCreateServerClient = vi.fn().mockReturnValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: "user-1", email: "test@example.com" } },
      }),
    },
  });

  return { mockCreateServerClient, mockCookieStore };
});

vi.mock("@supabase/ssr", () => ({
  createServerClient: mockCreateServerClient,
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue(mockCookieStore),
}));

// ---------------------------------------------------------------------------
// Import the module under test
// ---------------------------------------------------------------------------
import { createClient } from "../server";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test-project.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "eyJhbGciOiJIUzI1NiJ9.test-key");
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createClient (server)", () => {
  it("creates a server client with correct URL and key", async () => {
    await createClient();

    expect(mockCreateServerClient).toHaveBeenCalledWith(
      "https://test-project.supabase.co",
      "eyJhbGciOiJIUzI1NiJ9.test-key",
      expect.objectContaining({
        cookies: expect.objectContaining({
          getAll: expect.any(Function),
          setAll: expect.any(Function),
        }),
      }),
    );
  });

  it("returns a Supabase client instance", async () => {
    const client = await createClient();
    expect(client).toBeDefined();
    expect(client.auth).toBeDefined();
  });

  it("cookie getAll reads from the cookie store", async () => {
    await createClient();

    // Get the cookies config passed to createServerClient
    const cookiesConfig = mockCreateServerClient.mock.calls[0][2].cookies;
    const allCookies = cookiesConfig.getAll();

    expect(allCookies).toHaveLength(2);
    expect(allCookies[0].name).toBe("sb-access-token");
  });

  it("cookie setAll writes cookies to the store", async () => {
    await createClient();

    const cookiesConfig = mockCreateServerClient.mock.calls[0][2].cookies;
    cookiesConfig.setAll([
      { name: "sb-access-token", value: "new-token", options: { path: "/" } },
    ]);

    expect(mockCookieStore.set).toHaveBeenCalledWith(
      "sb-access-token",
      "new-token",
      { path: "/" },
    );
  });

  it("cookie setAll handles errors silently (e.g., in Server Components)", async () => {
    mockCookieStore.set.mockImplementationOnce(() => {
      throw new Error("Cannot set cookies in Server Component");
    });

    await createClient();

    const cookiesConfig = mockCreateServerClient.mock.calls[0][2].cookies;

    // Should not throw
    expect(() =>
      cookiesConfig.setAll([
        { name: "test", value: "val", options: {} },
      ]),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Tests: Admin client
// ---------------------------------------------------------------------------

describe("createAdminClient", () => {
  it("creates a client with service role key", async () => {
    // Reset modules to import admin fresh
    vi.resetModules();

    const mockCreateClient = vi.fn().mockReturnValue({
      auth: { getUser: vi.fn() },
    });

    vi.doMock("@supabase/supabase-js", () => ({
      createClient: mockCreateClient,
    }));

    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test-project.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key-12345");

    const { createAdminClient } = await import("../admin");
    createAdminClient();

    expect(mockCreateClient).toHaveBeenCalledWith(
      "https://test-project.supabase.co",
      "service-role-key-12345",
      expect.objectContaining({
        auth: expect.objectContaining({
          autoRefreshToken: false,
          persistSession: false,
        }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: Proxy (updateSession middleware)
// ---------------------------------------------------------------------------

describe("updateSession (proxy middleware)", () => {
  it("redirects unauthenticated users to /login", async () => {
    vi.resetModules();

    const mockCreateServerClientProxy = vi.fn().mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    });

    vi.doMock("@supabase/ssr", () => ({
      createServerClient: mockCreateServerClientProxy,
    }));

    // We need to mock NextResponse and NextRequest for this test
    const mockRedirect = vi.fn().mockReturnValue({ type: "redirect" });
    const mockNext = vi.fn().mockReturnValue({
      cookies: { set: vi.fn() },
    });

    vi.doMock("next/server", () => ({
      NextResponse: {
        redirect: mockRedirect,
        next: mockNext,
      },
    }));

    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test-project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-key");

    const { updateSession } = await import("../proxy");

    const mockRequest = {
      cookies: {
        getAll: vi.fn().mockReturnValue([]),
        set: vi.fn(),
      },
      nextUrl: {
        pathname: "/inspections",
        clone: vi.fn().mockReturnValue({ pathname: "" }),
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await updateSession(mockRequest as any);
    expect(mockRedirect).toHaveBeenCalled();
    expect(result.type).toBe("redirect");
  });

  it("allows unauthenticated access to /login", async () => {
    vi.resetModules();

    const mockCreateServerClientProxy = vi.fn().mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    });

    vi.doMock("@supabase/ssr", () => ({
      createServerClient: mockCreateServerClientProxy,
    }));

    const mockNext = vi.fn().mockReturnValue({
      cookies: { set: vi.fn() },
    });
    const mockRedirect = vi.fn();

    vi.doMock("next/server", () => ({
      NextResponse: {
        redirect: mockRedirect,
        next: mockNext,
      },
    }));

    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test-project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-key");

    const { updateSession } = await import("../proxy");

    const mockRequest = {
      cookies: {
        getAll: vi.fn().mockReturnValue([]),
        set: vi.fn(),
      },
      nextUrl: {
        pathname: "/login",
        clone: vi.fn(),
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await updateSession(mockRequest as any);
    // Should NOT redirect — user is on a public page
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("allows authenticated users through to protected routes", async () => {
    vi.resetModules();

    const mockCreateServerClientProxy = vi.fn().mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
        }),
      },
    });

    vi.doMock("@supabase/ssr", () => ({
      createServerClient: mockCreateServerClientProxy,
    }));

    const mockNext = vi.fn().mockReturnValue({
      cookies: { set: vi.fn() },
    });
    const mockRedirect = vi.fn();

    vi.doMock("next/server", () => ({
      NextResponse: {
        redirect: mockRedirect,
        next: mockNext,
      },
    }));

    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test-project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-key");

    const { updateSession } = await import("../proxy");

    const mockRequest = {
      cookies: {
        getAll: vi.fn().mockReturnValue([]),
        set: vi.fn(),
      },
      nextUrl: {
        pathname: "/inspections",
        clone: vi.fn(),
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await updateSession(mockRequest as any);
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
