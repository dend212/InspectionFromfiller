import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { db } from "@/lib/db";
import { jobEmails, jobSummaries, jobs } from "@/lib/db/schema";
import { getUserRole } from "@/lib/supabase/auth-helpers";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/jobs/[id]/send-summary-email
 *
 * Emails the tokenized customer summary link to the recipient. Intentionally
 * mirrors /api/inspections/[id]/send-email in its summary-link mode so the
 * two flows look the same from the outside:
 *   - same subject shape ("Service Visit Summary - <address>")
 *   - same email body template ("Dear Customer, ...")
 *   - same side effects (history row + customerEmail prefill)
 *
 * Requires:
 *   - caller is admin or office_staff
 *   - a summary row exists for this job (create one first via
 *     POST /api/jobs/[id]/generate-summary)
 *
 * Body: {
 *   recipientEmail: string,
 *   subject?: string,
 *   personalNote?: string,
 * }
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Admin / office_staff only — same rule as generate-summary and the
  // inspection send-email route.
  const role = await getUserRole(supabase);
  if (role !== "admin" && role !== "office_staff") {
    return NextResponse.json({ error: "Forbidden: admin or office staff only" }, { status: 403 });
  }

  let body: { recipientEmail?: string; subject?: string; personalNote?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const recipientEmail = body.recipientEmail?.trim() || "";
  if (!recipientEmail || !recipientEmail.includes("@")) {
    return NextResponse.json({ error: "A valid recipient email is required" }, { status: 400 });
  }

  const subject = body.subject?.trim();
  if (!subject) {
    return NextResponse.json({ error: "Subject is required" }, { status: 400 });
  }

  const [job] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const [summary] = await db
    .select()
    .from(jobSummaries)
    .where(eq(jobSummaries.jobId, id))
    .orderBy(desc(jobSummaries.createdAt))
    .limit(1);
  if (!summary) {
    return NextResponse.json(
      { error: "No summary link exists yet. Create one before sending." },
      { status: 400 },
    );
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.headers.get("origin") || "";
  const summaryUrl = `${baseUrl}/jobs/summary/${summary.token}`;

  const addressParts = [job.serviceAddress, job.city, job.state].filter(Boolean);
  const addressLine = addressParts.length > 0 ? addressParts.join(", ") : "your property";
  const personalNote = body.personalNote?.trim() || "";
  const notePart = personalNote ? `${personalNote}\n\n` : "";

  // Matches the inspection send-email summary-mode body exactly so both
  // customer flows read identically. "summary" → "service visit summary"
  // is the only wording difference.
  const emailBody = `Dear Customer,

Your service visit summary for ${addressLine} is ready. You can view it here:

${summaryUrl}

${notePart}This link includes a summary of the work performed and any photos or videos captured during the visit.

If you have any questions, please don't hesitate to contact us.

Best regards,
SewerTime Septic`;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("[jobs/send-summary-email] RESEND_API_KEY is not set");
    return NextResponse.json({ error: "Email is not configured on the server" }, { status: 500 });
  }
  const resend = new Resend(apiKey);
  const fromAddress = `SewerTime Septic <${process.env.EMAIL_FROM_ADDRESS || "onboarding@resend.dev"}>`;

  try {
    await resend.emails.send({
      from: fromAddress,
      to: [recipientEmail],
      subject,
      text: emailBody,
    });
  } catch (err) {
    console.error("[jobs/send-summary-email] Resend failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Failed to send email: ${message}` }, { status: 500 });
  }

  // Record send history (only after a successful Resend call) — mirrors
  // the inspection flow's inspection_emails insert.
  const sentAt = new Date();
  await db.insert(jobEmails).values({
    jobId: id,
    recipientEmail,
    subject,
    sentBy: user.id,
    sentAt,
  });

  // Persist customerEmail on the job so the next send pre-fills correctly.
  await db
    .update(jobs)
    .set({ customerEmail: recipientEmail, updatedAt: new Date() })
    .where(eq(jobs.id, id));

  return NextResponse.json({
    success: true,
    sentAt: sentAt.toISOString(),
    recipientEmail,
  });
}
