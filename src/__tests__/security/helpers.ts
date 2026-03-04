/**
 * Shared test helpers for security tests.
 * Provides mock factories for Supabase clients and JWT tokens.
 */

import type { AppRole } from "@/types/roles";

// ---------------------------------------------------------------------------
// JWT helper — builds a minimal base64-encoded JWT with a given role
// ---------------------------------------------------------------------------

export function buildJwt(role: AppRole | null, extra: Record<string, unknown> = {}): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ user_role: role, sub: "test-user-id", ...extra }),
  ).toString("base64url");
  const sig = "fake-signature";
  return `${header}.${payload}.${sig}`;
}

// ---------------------------------------------------------------------------
// Mock user / session factory
// ---------------------------------------------------------------------------

export interface MockUserOptions {
  userId?: string;
  role?: AppRole | null;
  email?: string;
}

/**
 * Returns a mock Supabase client that satisfies the patterns used across all
 * API routes:
 *   - supabase.auth.getUser()
 *   - supabase.auth.getSession()
 */
export function createMockSupabaseClient(opts: MockUserOptions = {}) {
  const { userId = "user-123", role = "field_tech", email = "test@example.com" } = opts;

  const accessToken = buildJwt(role);

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: userId
            ? { id: userId, email, user_metadata: { full_name: "Test User" } }
            : null,
        },
        error: null,
      }),
      getSession: vi.fn().mockResolvedValue({
        data: {
          session: userId ? { access_token: accessToken } : null,
        },
        error: null,
      }),
    },
    storage: {
      from: vi.fn().mockReturnValue({
        createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: "https://signed.url" } }),
        createSignedUploadUrl: vi.fn().mockResolvedValue({
          data: { signedUrl: "https://upload.url", token: "upload-token" },
        }),
        download: vi.fn().mockResolvedValue({ data: new Blob(["fake"]), error: null }),
        remove: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    },
  };
}

/**
 * Returns a mock Supabase client that represents an unauthenticated request.
 */
export function createUnauthenticatedClient() {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    },
    storage: {
      from: vi.fn(),
    },
  };
}

// ---------------------------------------------------------------------------
// Common inspection records for mocking DB results
// ---------------------------------------------------------------------------

export const MOCK_INSPECTION_DRAFT = {
  id: "insp-001",
  inspectorId: "user-123",
  status: "draft" as const,
  formData: { facilityInfo: { facilityName: "Test Facility" } },
  facilityName: "Test Facility",
  createdAt: new Date(),
  updatedAt: new Date(),
};

export const MOCK_INSPECTION_IN_REVIEW = {
  ...MOCK_INSPECTION_DRAFT,
  id: "insp-002",
  status: "in_review" as const,
};

export const MOCK_INSPECTION_COMPLETED = {
  ...MOCK_INSPECTION_DRAFT,
  id: "insp-003",
  status: "completed" as const,
};

export const MOCK_INSPECTION_OTHER_USER = {
  ...MOCK_INSPECTION_DRAFT,
  id: "insp-004",
  inspectorId: "other-user-456",
};
