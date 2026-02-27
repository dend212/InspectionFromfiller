import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { inspections } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * GET /api/inspections/[id]
 * Load a single inspection with all form data.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [inspection] = await db
    .select()
    .from(inspections)
    .where(eq(inspections.id, id))
    .limit(1);

  if (!inspection) {
    return NextResponse.json({ error: "Inspection not found" }, { status: 404 });
  }

  // Check ownership or privileged role
  if (inspection.inspectorId !== user.id) {
    let userRole: string | null = null;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const payload = JSON.parse(
          Buffer.from(session.access_token.split(".")[1], "base64").toString()
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
}

/**
 * PATCH /api/inspections/[id]
 * Auto-save form data. Accepts the complete form data object and updates
 * both the JSONB column and denormalized facility fields.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const payload = JSON.parse(
          Buffer.from(session.access_token.split(".")[1], "base64").toString()
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
      { status: 403 }
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
