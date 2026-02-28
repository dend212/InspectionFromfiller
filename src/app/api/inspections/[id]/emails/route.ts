import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { inspections, inspectionEmails, profiles } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { checkInspectionAccess } from "@/lib/supabase/auth-helpers";

/**
 * GET /api/inspections/[id]/emails
 * Returns email send history for an inspection, ordered by most recent first.
 * Includes the sender's full name from the profiles table.
 * Access: inspection owner, admin, or office_staff.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify inspection exists and user has access
  const [inspection] = await db
    .select({ inspectorId: inspections.inspectorId })
    .from(inspections)
    .where(eq(inspections.id, id))
    .limit(1);

  if (!inspection) {
    return NextResponse.json({ error: "Inspection not found" }, { status: 404 });
  }

  const { allowed } = await checkInspectionAccess(supabase, user.id, inspection.inspectorId);
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Query email history with sender name join
  const rows = await db
    .select({
      id: inspectionEmails.id,
      recipientEmail: inspectionEmails.recipientEmail,
      subject: inspectionEmails.subject,
      sentAt: inspectionEmails.sentAt,
      senderName: profiles.fullName,
    })
    .from(inspectionEmails)
    .leftJoin(profiles, eq(inspectionEmails.sentBy, profiles.id))
    .where(eq(inspectionEmails.inspectionId, id))
    .orderBy(desc(inspectionEmails.sentAt));

  return NextResponse.json(
    rows.map((r) => ({
      id: r.id,
      recipientEmail: r.recipientEmail,
      subject: r.subject,
      sentAt: r.sentAt.toISOString(),
      senderName: r.senderName ?? "Unknown",
    })),
  );
}
