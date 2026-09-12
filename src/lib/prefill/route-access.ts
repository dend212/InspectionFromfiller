import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { inspections } from "@/lib/db/schema";
import { checkInspectionAccess } from "@/lib/supabase/auth-helpers";
import { createClient } from "@/lib/supabase/server";

interface InspectionMeta {
  inspectorId: string;
  status: string;
}

export type InspectionAccess<TInspection = InspectionMeta & { formData?: unknown }> =
  | {
      ok: true;
      userId: string;
      inspection: TInspection;
      isPrivileged: boolean;
    }
  | { ok: false; response: NextResponse };

/**
 * Auth gate shared by the prefill/provenance routes.
 *  - "view": owner, or admin/office_staff.
 *  - "edit": as "view", and non-privileged users may only touch drafts
 *    (the same rule PATCH /api/inspections/[id] enforces).
 * `formData` (the big jsonb column) is only loaded for "edit" — the 2 s polling
 * GETs never need it.
 */
export async function requireInspectionAccess(
  inspectionId: string,
  mode: "edit",
): Promise<InspectionAccess<InspectionMeta & { formData: unknown }>>;
export async function requireInspectionAccess(
  inspectionId: string,
  mode: "view",
): Promise<InspectionAccess<InspectionMeta>>;
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

  const meta = { inspectorId: inspections.inspectorId, status: inspections.status };
  const rows: Array<InspectionMeta & { formData?: unknown }> =
    mode === "edit"
      ? await db
          .select({ ...meta, formData: inspections.formData })
          .from(inspections)
          .where(eq(inspections.id, inspectionId))
          .limit(1)
      : await db.select(meta).from(inspections).where(eq(inspections.id, inspectionId)).limit(1);
  const inspection = rows[0];

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
