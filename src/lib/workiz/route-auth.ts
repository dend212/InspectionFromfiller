import type { User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getUserRole } from "@/lib/supabase/auth-helpers";
import { createClient } from "@/lib/supabase/server";
import type { WorkizImporterRole } from "@/types/workiz-import";

export type WorkizImporterAuth =
  | { ok: true; user: User; role: WorkizImporterRole }
  | { ok: false; response: NextResponse };

/**
 * Both Workiz routes: signed in (401) AND admin or field_tech (403) — the roles the nav offers
 * New Inspection to. office_staff and unprovisioned users (no role claim) are refused (spec §8.3).
 */
export async function requireWorkizImporter(): Promise<WorkizImporterAuth> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const role = await getUserRole(supabase);
  if (role !== "admin" && role !== "field_tech") {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true, user, role };
}
