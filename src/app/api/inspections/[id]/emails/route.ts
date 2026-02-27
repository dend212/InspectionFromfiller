import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { inspectionEmails, profiles } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

/**
 * GET /api/inspections/[id]/emails
 * Returns email send history for an inspection, ordered by most recent first.
 * Includes the sender's full name from the profiles table.
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
