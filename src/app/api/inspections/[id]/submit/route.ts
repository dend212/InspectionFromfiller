import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { inspections, profiles, userRoles } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { sendSubmissionNotification } from "@/lib/email/send-notification";

/**
 * POST /api/inspections/[id]/submit
 * Transition: draft -> in_review
 * Allowed: inspector (owner) or admin
 */
export async function POST(
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

  // Check if user is the inspector (owner) or has a privileged role
  const [existing] = await db
    .select({ inspectorId: inspections.inspectorId, status: inspections.status })
    .from(inspections)
    .where(eq(inspections.id, id))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Inspection not found" }, { status: 404 });
  }

  let isAllowed = existing.inspectorId === user.id;

  if (!isAllowed) {
    // Check for admin role
    let userRole: string | null = null;
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) {
        const payload = JSON.parse(
          Buffer.from(session.access_token.split(".")[1], "base64").toString()
        );
        userRole = payload.user_role ?? null;
      }
    } catch {
      // Role decode failed
    }

    isAllowed = userRole === "admin";
  }

  if (!isAllowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Atomic status transition: only update if current status is "draft"
  const result = await db
    .update(inspections)
    .set({
      status: "in_review",
      submittedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(inspections.id, id), eq(inspections.status, "draft")))
    .returning({ id: inspections.id, facilityName: inspections.facilityName });

  if (result.length === 0) {
    return NextResponse.json(
      { error: "Cannot submit: inspection is not in draft status" },
      { status: 409 }
    );
  }

  const updated = result[0];

  // Fire-and-forget email notification if admin has opted in
  (async () => {
    try {
      const admins = await db
        .select({
          notificationSettings: profiles.notificationSettings,
        })
        .from(profiles)
        .innerJoin(userRoles, eq(userRoles.userId, profiles.id))
        .where(eq(userRoles.role, "admin"));

      const adminWantsEmail = admins.some(
        (a) =>
          (a.notificationSettings as Record<string, unknown> | null)
            ?.emailOnSubmission === true
      );

      if (adminWantsEmail) {
        await sendSubmissionNotification(
          updated.id,
          updated.facilityName ?? null,
          null
        );
      }
    } catch (err) {
      console.error("Notification check failed:", err);
    }
  })();

  return NextResponse.json({ status: "in_review" });
}
