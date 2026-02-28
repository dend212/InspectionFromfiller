import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppRole } from "@/types/roles";

/**
 * Extract the user's role from their JWT access token.
 * Used across API routes to avoid repeating JWT decode logic.
 */
export async function getUserRole(
  supabase: SupabaseClient,
): Promise<AppRole | null> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return null;

    const payload = JSON.parse(
      Buffer.from(session.access_token.split(".")[1], "base64").toString(),
    );
    return payload.user_role ?? null;
  } catch {
    return null;
  }
}

/**
 * Check if the current user owns the given inspection or has a privileged role.
 * Returns { allowed, role } so callers can make further decisions.
 */
export async function checkInspectionAccess(
  supabase: SupabaseClient,
  userId: string,
  inspectorId: string,
): Promise<{ allowed: boolean; role: AppRole | null }> {
  if (userId === inspectorId) {
    const role = await getUserRole(supabase);
    return { allowed: true, role };
  }

  const role = await getUserRole(supabase);
  const isPrivileged = role === "admin" || role === "office_staff";
  return { allowed: isPrivileged, role };
}
