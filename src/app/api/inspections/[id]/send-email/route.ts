import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { db } from "@/lib/db";
import { inspectionEmails, inspections } from "@/lib/db/schema";
import { buildDownloadFilename } from "@/lib/storage/pdf-storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/inspections/[id]/send-email
 * Downloads finalized PDF from storage, sends via Resend with attachment,
 * records send history in inspection_emails table, and persists customerEmail.
 * Allowed: admin or office_staff only.
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

  // Role check: admin or office_staff only
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

  if (userRole !== "admin" && userRole !== "office_staff") {
    return NextResponse.json({ error: "Forbidden: admin or office staff only" }, { status: 403 });
  }

  // Parse request body
  let body: { recipientEmail?: string; subject?: string; personalNote?: string; summaryUrl?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { recipientEmail, subject, personalNote, summaryUrl } = body;

  if (!recipientEmail || !recipientEmail.includes("@")) {
    return NextResponse.json({ error: "A valid recipient email is required" }, { status: 400 });
  }

  if (!subject) {
    return NextResponse.json({ error: "Subject is required" }, { status: 400 });
  }

  // Load inspection
  const [inspection] = await db.select().from(inspections).where(eq(inspections.id, id)).limit(1);

  if (!inspection) {
    return NextResponse.json({ error: "Inspection not found" }, { status: 404 });
  }

  if (!inspection.finalizedPdfPath) {
    return NextResponse.json(
      { error: "No finalized PDF to send. Please finalize the inspection first." },
      { status: 400 },
    );
  }

  const addressLine = inspection.facilityAddress || "the inspected property";
  const notePart = personalNote ? `${personalNote}\n\n` : "";
  const resend = new Resend(process.env.RESEND_API_KEY!);
  const fromAddress = `SewerTime Inspections <${process.env.EMAIL_FROM_ADDRESS || "onboarding@resend.dev"}>`;

  if (summaryUrl) {
    // Summary URL mode: send link instead of PDF attachment
    const emailBody = `Dear Customer,

Your inspection summary for ${addressLine} is ready. You can view it here:

${summaryUrl}

${notePart}This link includes your inspection report download and a summary of findings.

If you have any questions, please don't hesitate to contact us.

Best regards,
SewerTime Septic`;

    try {
      await resend.emails.send({
        from: fromAddress,
        to: [recipientEmail],
        subject,
        text: emailBody,
      });
    } catch (err) {
      console.error("Resend email failed:", err);
      const message = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json({ error: `Failed to send email: ${message}` }, { status: 500 });
    }
  } else {
    // PDF attachment mode (original flow)
    const admin = createAdminClient();
    const { data: blob, error: downloadError } = await admin.storage
      .from("inspection-media")
      .download(inspection.finalizedPdfPath);

    if (downloadError || !blob) {
      console.error("PDF download failed:", downloadError);
      return NextResponse.json({ error: "Failed to download PDF from storage" }, { status: 500 });
    }

    const buffer = Buffer.from(await blob.arrayBuffer());
    console.log(`[send-email] PDF size: ${(buffer.length / 1024 / 1024).toFixed(2)}MB`);

    const base64Size = buffer.length * (4 / 3);
    const MAX_ATTACHMENT_SIZE = 35 * 1024 * 1024;
    if (base64Size > MAX_ATTACHMENT_SIZE) {
      return NextResponse.json(
        { error: "PDF too large for email (>35MB). Please download and send manually." },
        { status: 400 },
      );
    }

    const downloadFilename = buildDownloadFilename(
      inspection.facilityAddress,
      inspection.completedAt,
    );

    const emailBody = `Dear Customer,

Please find attached your inspection report for ${addressLine}.

${notePart}If you have any questions about this report, please don't hesitate to contact us.

Best regards,
SewerTime Septic`;

    try {
      await resend.emails.send({
        from: fromAddress,
        to: [recipientEmail],
        subject,
        text: emailBody,
        attachments: [
          {
            content: buffer.toString("base64"),
            filename: downloadFilename,
          },
        ],
      });
    } catch (err) {
      console.error("Resend email failed:", err);
      const message = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json({ error: `Failed to send email: ${message}` }, { status: 500 });
    }
  }

  // Record send history (only after successful send)
  const sentAt = new Date();
  await db.insert(inspectionEmails).values({
    inspectionId: id,
    recipientEmail,
    subject,
    sentBy: user.id,
    sentAt,
  });

  // Persist customerEmail on the inspection for future pre-fill
  await db
    .update(inspections)
    .set({ customerEmail: recipientEmail, updatedAt: new Date() })
    .where(eq(inspections.id, id));

  return NextResponse.json({
    success: true,
    sentAt: sentAt.toISOString(),
  });
}
