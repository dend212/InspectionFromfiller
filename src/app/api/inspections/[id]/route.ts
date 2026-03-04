import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { inspections } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/inspections/[id]
 * Load a single inspection with all form data.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [inspection] = await db.select().from(inspections).where(eq(inspections.id, id)).limit(1);

    if (!inspection) {
      return NextResponse.json({ error: "Inspection not found" }, { status: 404 });
    }

    // Check ownership or privileged role
    if (inspection.inspectorId !== user.id) {
      let userRole: string | null = null;
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session) {
          const payload = JSON.parse(
            Buffer.from(session.access_token.split(".")[1], "base64").toString(),
          );
          userRole = payload.user_role ?? null;
        }
      } catch {
        // Role decode failed
      }

      const isPrivileged = userRole === "admin" || userRole === "office_staff";
      if (!isPrivileged) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    return NextResponse.json(inspection);
  } catch (err) {
    console.error("[inspection GET] Failed to load inspection:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to load inspection: ${message}` },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/inspections/[id]
 * Auto-save form data. Accepts the complete form data object and updates
 * both the JSONB column and denormalized facility fields.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify the inspection exists and user has access
  const [existing] = await db
    .select({ inspectorId: inspections.inspectorId, status: inspections.status })
    .from(inspections)
    .where(eq(inspections.id, id))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Inspection not found" }, { status: 404 });
  }

  let isPrivileged = false;

  if (existing.inspectorId !== user.id) {
    let userRole: string | null = null;
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) {
        const payload = JSON.parse(
          Buffer.from(session.access_token.split(".")[1], "base64").toString(),
        );
        userRole = payload.user_role ?? null;
      }
    } catch {
      // Role decode failed
    }

    isPrivileged = userRole === "admin" || userRole === "office_staff";
    if (!isPrivileged) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // Field techs can only edit drafts (defense in depth -- RLS also enforces this)
  if (!isPrivileged && existing.status !== "draft") {
    return NextResponse.json(
      { error: "Cannot edit: inspection is no longer a draft" },
      { status: 403 },
    );
  }

  const formData = await request.json();

  // Extract facility info for denormalized columns
  const facilityInfo = formData?.facilityInfo;

  await db
    .update(inspections)
    .set({
      formData,
      updatedAt: new Date(),
      // Sync denormalized facility fields for dashboard display
      facilityName: facilityInfo?.facilityName ?? null,
      facilityAddress: facilityInfo?.facilityAddress ?? null,
      facilityCity: facilityInfo?.facilityCity ?? null,
      facilityCounty: facilityInfo?.facilityCounty ?? null,
      facilityZip: facilityInfo?.facilityZip ?? null,
      // Sync customer name for dashboard search/email
      customerName: facilityInfo?.sellerName ?? null,
    })
    .where(eq(inspections.id, id));

  return NextResponse.json({ saved: true });
}

/**
 * DELETE /api/inspections/[id]
 * Delete an inspection. Admins can delete any inspection.
 * Field techs can only delete their own drafts.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [existing] = await db
    .select({
      inspectorId: inspections.inspectorId,
      status: inspections.status,
    })
    .from(inspections)
    .where(eq(inspections.id, id))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Inspection not found" }, { status: 404 });
  }

  // Decode user role
  let isAdmin = false;
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session) {
      const payload = JSON.parse(
        Buffer.from(session.access_token.split(".")[1], "base64").toString(),
      );
      isAdmin = payload.user_role === "admin";
    }
  } catch {
    // Role decode failed
  }

  // Admins can delete any inspection
  if (isAdmin) {
    await db.delete(inspections).where(eq(inspections.id, id));
    return NextResponse.json({ deleted: true });
  }

  // Non-admins: must own the inspection and it must be a draft
  if (existing.inspectorId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (existing.status !== "draft") {
    return NextResponse.json({ error: "Only draft inspections can be deleted" }, { status: 403 });
  }

  await db.delete(inspections).where(and(eq(inspections.id, id), eq(inspections.status, "draft")));

  return NextResponse.json({ deleted: true });
}
