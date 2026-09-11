import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { inspections } from "@/lib/db/schema";
import { checkInspectionAccess } from "@/lib/supabase/auth-helpers";
import { createClient } from "@/lib/supabase/server";

export type InspectionAccess =
  | {
      ok: true;
      userId: string;
      inspection: { inspectorId: string; status: string; formData: unknown };
      isPrivileged: boolean;
    }
  | { ok: false; response: NextResponse };

/**
 * Auth gate shared by the prefill/provenance routes.
 *  - "view": owner, or admin/office_staff.
 *  - "edit": as "view", and non-privileged users may only touch drafts
 *    (the same rule PATCH /api/inspections/[id] enforces).
 */
export async function requireInspectionAccess(
  inspectionId: string,
  mode: "view" | "edit",
): Promise<InspectionAccess> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const [inspection] = await db
    .select({
      inspectorId: inspections.inspectorId,
      status: inspections.status,
      formData: inspections.formData,
    })
    .from(inspections)
    .where(eq(inspections.id, inspectionId))
    .limit(1);

  if (!inspection) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Inspection not found" }, { status: 404 }),
    };
  }

  const { allowed, role } = await checkInspectionAccess(supabase, user.id, inspection.inspectorId);
  if (!allowed) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  const isPrivileged = role === "admin" || role === "office_staff";
  if (mode === "edit" && !isPrivileged && inspection.status !== "draft") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Cannot edit: inspection is no longer a draft" },
        { status: 403 },
      ),
    };
  }

  return { ok: true, userId: user.id, inspection, isPrivileged };
}
