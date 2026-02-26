import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { inspections, profiles } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { getDefaultFormValues } from "@/lib/validators/inspection";

/**
 * POST /api/inspections
 * Create a new draft inspection with pre-filled inspector info (FORM-04).
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Look up the user's profile to get their full name
  const [profile] = await db
    .select({ fullName: profiles.fullName })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);

  const inspectorName = profile?.fullName ?? user.user_metadata?.full_name ?? "";
  const defaultFormData = getDefaultFormValues(inspectorName);

  const [newInspection] = await db
    .insert(inspections)
    .values({
      inspectorId: user.id,
      status: "draft",
      formData: defaultFormData,
    })
    .returning();

  return NextResponse.json(newInspection, { status: 201 });
}

/**
 * GET /api/inspections
 * List inspections. Field techs see only their own; admin/office_staff see all.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Decode JWT to get user_role
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
    // Role decode failed, default to field_tech behavior (own inspections only)
  }

  const isPrivileged = userRole === "admin" || userRole === "office_staff";

  const results = isPrivileged
    ? await db
        .select({
          id: inspections.id,
          status: inspections.status,
          facilityName: inspections.facilityName,
          facilityAddress: inspections.facilityAddress,
          facilityCity: inspections.facilityCity,
          facilityCounty: inspections.facilityCounty,
          createdAt: inspections.createdAt,
          updatedAt: inspections.updatedAt,
        })
        .from(inspections)
        .orderBy(desc(inspections.updatedAt))
    : await db
        .select({
          id: inspections.id,
          status: inspections.status,
          facilityName: inspections.facilityName,
          facilityAddress: inspections.facilityAddress,
          facilityCity: inspections.facilityCity,
          facilityCounty: inspections.facilityCounty,
          createdAt: inspections.createdAt,
          updatedAt: inspections.updatedAt,
        })
        .from(inspections)
        .where(eq(inspections.inspectorId, user.id))
        .orderBy(desc(inspections.updatedAt));

  return NextResponse.json(results);
}
