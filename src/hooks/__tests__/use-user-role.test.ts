import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockUnsubscribe = vi.fn();
let onAuthStateChangeCallback: ((event: string, session: any) => void) | null = null;
let getSessionResult: any = { data: { session: null } };

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: () => Promise.resolve(getSessionResult),
      onAuthStateChange: (callback: (event: string, session: any) => void) => {
        onAuthStateChangeCallback = callback;
        return {
          data: {
            subscription: {
              unsubscribe: mockUnsubscribe,
            },
          },
        };
      },
    },
  }),
}));

// Mock jwt-decode: encode a "jwt" as JSON that we can decode
vi.mock("jwt-decode", () => ({
  jwtDecode: (token: string) => {
    // Our test tokens are just JSON strings
    try {
      return JSON.parse(token);
    } catch {
      throw new Error("Invalid token");
    }
  },
}));

import { useUserRole } from "@/hooks/use-user-role";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeSession(role?: string) {
  return {
    access_token: JSON.stringify(role ? { user_role: role } : {}),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.restoreAllMocks();
  onAuthStateChangeCallback = null;
  getSessionResult = { data: { session: null } };
  mockUnsubscribe.mockClear();
});

describe("useUserRole", () => {
  describe("initial state", () => {
    it("starts with null role and loading=true", () => {
      const { result } = renderHook(() => useUserRole());

      expect(result.current.role).toBeNull();
      expect(result.current.loading).toBe(true);
    });
  });

  describe("session detection", () => {
    it("sets role from existing session", async () => {
      getSessionResult = { data: { session: makeSession("admin") } };

      const { result } = renderHook(() => useUserRole());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.role).toBe("admin");
    });

    it("sets role=null when session exists but has no user_role claim", async () => {
      getSessionResult = { data: { session: makeSession() } };

      const { result } = renderHook(() => useUserRole());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.role).toBeNull();
    });

    it("sets role=null when no session exists", async () => {
      getSessionResult = { data: { session: null } };

      const { result } = renderHook(() => useUserRole());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.role).toBeNull();
    });

    it("handles field_tech role", async () => {
      getSessionResult = { data: { session: makeSession("field_tech") } };

      const { result } = renderHook(() => useUserRole());

      await waitFor(() => {
        expect(result.current.role).toBe("field_tech");
      });
    });

    it("handles office_staff role", async () => {
      getSessionResult = { data: { session: makeSession("office_staff") } };

      const { result } = renderHook(() => useUserRole());

      await waitFor(() => {
        expect(result.current.role).toBe("office_staff");
      });
    });
  });

  describe("auth state changes", () => {
    it("updates role when auth state changes to signed in", async () => {
      getSessionResult = { data: { session: null } };

      const { result } = renderHook(() => useUserRole());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.role).toBeNull();

      // Simulate auth state change
      act(() => {
        onAuthStateChangeCallback?.("SIGNED_IN", makeSession("admin"));
      });

      expect(result.current.role).toBe("admin");
    });

    it("clears role when session is null (sign out)", async () => {
      getSessionResult = { data: { session: makeSession("admin") } };

      const { result } = renderHook(() => useUserRole());

      await waitFor(() => {
        expect(result.current.role).toBe("admin");
      });

      act(() => {
        onAuthStateChangeCallback?.("SIGNED_OUT", null);
      });

      expect(result.current.role).toBeNull();
    });

    it("updates role when switching users", async () => {
      getSessionResult = { data: { session: makeSession("admin") } };

      const { result } = renderHook(() => useUserRole());

      await waitFor(() => {
        expect(result.current.role).toBe("admin");
      });

      act(() => {
        onAuthStateChangeCallback?.("TOKEN_REFRESHED", makeSession("field_tech"));
      });

      expect(result.current.role).toBe("field_tech");
    });
  });

  describe("error handling", () => {
    it("sets role=null when JWT decode fails", async () => {
      getSessionResult = {
        data: {
          session: {
            access_token: "not-valid-json",
          },
        },
      };

      const { result } = renderHook(() => useUserRole());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.role).toBeNull();
    });

    it("sets role=null on decode error during auth state change", async () => {
      getSessionResult = { data: { session: null } };

      const { result } = renderHook(() => useUserRole());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => {
        onAuthStateChangeCallback?.("SIGNED_IN", {
          access_token: "invalid-token",
        });
      });

      expect(result.current.role).toBeNull();
    });
  });

  describe("cleanup", () => {
    it("unsubscribes from auth state changes on unmount", async () => {
      const { unmount } = renderHook(() => useUserRole());

      unmount();

      expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
    });
  });
});
