import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jobChecklistItems, jobMedia, jobs, profiles } from "@/lib/db/schema";
import { buildJobReportPdf } from "@/lib/pdf/job-report";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkJobAccess } from "@/lib/supabase/auth-helpers";
import { createClient } from "@/lib/supabase/server";

const BUCKET = "inspection-media";

/**
 * POST /api/jobs/[id]/finalize
 *
 * Gates completion on all required items being marked done with their
 * required photos/notes, then builds BOTH a staff PDF (all general photos)
 * and a customer PDF (filtered by visibleToCustomer). Uploads to
 *   reports/jobs/{jobId}/report.pdf
 *   reports/jobs/{jobId}/report-customer.pdf
 * and updates the job row.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [job] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const { allowed } = await checkJobAccess(supabase, user.id, job.assignedTo);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const items = await db
    .select()
    .from(jobChecklistItems)
    .where(eq(jobChecklistItems.jobId, id))
    .orderBy(asc(jobChecklistItems.sortOrder));

  const media = await db
    .select()
    .from(jobMedia)
    .where(eq(jobMedia.jobId, id))
    .orderBy(asc(jobMedia.sortOrder), asc(jobMedia.createdAt));

  // Count photos per checklist item for the completion gate. Videos do NOT
  // count toward `requiredPhotoCount` — that field is named after photos for
  // a reason: the report embeds photos but videos live only on the customer
  // web page.
  const photoCountByItem = new Map<string, number>();
  for (const m of media) {
    if (m.bucket !== "checklist_item" || !m.checklistItemId) continue;
    if (m.type !== "photo") continue;
    photoCountByItem.set(m.checklistItemId, (photoCountByItem.get(m.checklistItemId) ?? 0) + 1);
  }

  // Enforce completion gates
  const failures: string[] = [];
  for (const item of items) {
    if (!item.isRequired) continue;
    if (item.status !== "done") {
      failures.push(`"${item.title}" is not marked done`);
      continue;
    }
    if (item.requiresNote && !item.note?.trim()) {
      failures.push(`"${item.title}" requires a technician note`);
    }
    const count = photoCountByItem.get(item.id) ?? 0;
    if (count < item.requiredPhotoCount) {
      failures.push(`"${item.title}" requires ${item.requiredPhotoCount} photo(s), has ${count}`);
    }
  }

  if (failures.length > 0) {
    return NextResponse.json(
      { error: "Cannot finalize: required items incomplete", details: failures },
      { status: 400 },
    );
  }

  // Look up the assignee's name for the cover page
  const [assignee] = await db
    .select({ fullName: profiles.fullName })
    .from(profiles)
    .where(eq(profiles.id, job.assignedTo))
    .limit(1);

  // Build both variants
  let staffBytes: Uint8Array;
  let customerBytes: Uint8Array;
  try {
    staffBytes = await buildJobReportPdf({
      job,
      items,
      media,
      assigneeName: assignee?.fullName ?? null,
      audience: "staff",
    });
    customerBytes = await buildJobReportPdf({
      job,
      items,
      media,
      assigneeName: assignee?.fullName ?? null,
      audience: "customer",
    });
  } catch (err) {
    console.error("[jobs/finalize] PDF build failed:", err);
    const message = err instanceof Error ? err.message : "PDF generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // Upload both
  const admin = createAdminClient();
  const staffPath = `reports/jobs/${id}/report.pdf`;
  const customerPath = `reports/jobs/${id}/report-customer.pdf`;

  const staffUpload = await admin.storage.from(BUCKET).upload(staffPath, staffBytes, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (staffUpload.error) {
    return NextResponse.json(
      { error: `Staff PDF upload failed: ${staffUpload.error.message}` },
      { status: 500 },
    );
  }
  const customerUpload = await admin.storage.from(BUCKET).upload(customerPath, customerBytes, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (customerUpload.error) {
    return NextResponse.json(
      { error: `Customer PDF upload failed: ${customerUpload.error.message}` },
      { status: 500 },
    );
  }

  // Transition to completed
  const [updated] = await db
    .update(jobs)
    .set({
      status: "completed",
      completedAt: new Date(),
      finalizedPdfPath: staffPath,
      customerPdfPath: customerPath,
    })
    .where(eq(jobs.id, id))
    .returning();

  return NextResponse.json({
    job: updated,
    finalizedPdfPath: staffPath,
    customerPdfPath: customerPath,
  });
}
