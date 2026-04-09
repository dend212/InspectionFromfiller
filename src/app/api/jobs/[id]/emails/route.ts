import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jobEmails, jobs, profiles } from "@/lib/db/schema";
import { checkJobAccess } from "@/lib/supabase/auth-helpers";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/jobs/[id]/emails
 *
 * Returns the customer-facing email send history for a job, most-recent
 * first. Mirrors /api/inspections/[id]/emails in shape so the send dialog
 * can reuse the same rendering logic.
 *
 * Access: anyone allowed to view the job (admins, office_staff, field_tech
 * assignees, or any tech if the job is unassigned).
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

  const [job] = await db
    .select({ assignees: jobs.assignees })
    .from(jobs)
    .where(eq(jobs.id, id))
    .limit(1);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const { allowed } = await checkJobAccess(supabase, user.id, job.assignees);
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await db
    .select({
      id: jobEmails.id,
      recipientEmail: jobEmails.recipientEmail,
      subject: jobEmails.subject,
      sentAt: jobEmails.sentAt,
      senderName: profiles.fullName,
    })
    .from(jobEmails)
    .leftJoin(profiles, eq(jobEmails.sentBy, profiles.id))
    .where(eq(jobEmails.jobId, id))
    .orderBy(desc(jobEmails.sentAt));

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
