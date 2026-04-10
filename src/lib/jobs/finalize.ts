import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { jobChecklistItems, jobMedia, jobs, profiles } from "@/lib/db/schema";
import { logJobActivity } from "@/lib/jobs/activity";
import { buildJobReportPdf } from "@/lib/pdf/job-report";
import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "inspection-media";

export type FinalizeJobResult =
  | {
      ok: true;
      jobId: string;
      finalizedPdfPath: string;
      customerPdfPath: string;
      completedAt: Date;
    }
  | { ok: false; status: 404; error: string }
  | { ok: false; status: 400; error: string; details: string[] }
  | { ok: false; status: 500; error: string };

/**
 * Shared finalize pipeline used by both:
 *   - POST /api/jobs/[id]/finalize              (dashboard cookie-authed)
 *   - POST /api/webhooks/jobs/[externalId]/status + finalize=true  (n8n)
 *
 * Runs all the completion gates, builds the two PDF variants, uploads
 * them to Supabase Storage, and flips `jobs.status` to "completed".
 * Does NOT do authorization — callers are responsible for that.
 *
 * If the job is already in "completed" status, finalize runs in
 * regenerate-PDF mode: it rebuilds the PDFs with the current job state
 * and overwrites the storage objects. The activity log distinguishes
 * between first finalize and PDF regeneration.
 *
 * @param jobId  The job to finalize.
 * @param actorId Profile id of the user triggering finalize, or null for
 *                system-initiated finalize (n8n webhook). Used only for the
 *                activity log entry.
 */
export async function finalizeJobById(
  jobId: string,
  actorId: string | null = null,
): Promise<FinalizeJobResult> {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) return { ok: false, status: 404, error: "Job not found" };
  const wasAlreadyCompleted = job.status === "completed";

  const items = await db
    .select()
    .from(jobChecklistItems)
    .where(eq(jobChecklistItems.jobId, jobId))
    .orderBy(asc(jobChecklistItems.sortOrder));

  const media = await db
    .select()
    .from(jobMedia)
    .where(eq(jobMedia.jobId, jobId))
    .orderBy(asc(jobMedia.sortOrder), asc(jobMedia.createdAt));

  // Photos only — videos live on the public page, not in the PDF.
  const photoCountByItem = new Map<string, number>();
  for (const m of media) {
    if (m.bucket !== "checklist_item" || !m.checklistItemId) continue;
    if (m.type !== "photo") continue;
    photoCountByItem.set(m.checklistItemId, (photoCountByItem.get(m.checklistItemId) ?? 0) + 1);
  }

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
    return {
      ok: false,
      status: 400,
      error: "Cannot finalize: required items incomplete",
      details: failures,
    };
  }

  const assigneeProfiles = job.assignees.length
    ? await db
        .select({ id: profiles.id, fullName: profiles.fullName })
        .from(profiles)
        .where(inArray(profiles.id, job.assignees))
    : [];
  // Preserve insertion order from the array
  const nameById = new Map(assigneeProfiles.map((p) => [p.id, p.fullName] as const));
  const assigneeNames = job.assignees.map((aid) => nameById.get(aid) ?? "Unknown");

  // Forward-looking snapshot so the PDF cover page says COMPLETED
  const completedAt = new Date();
  const jobForReport = { ...job, status: "completed" as const, completedAt };

  let staffBytes: Uint8Array;
  let customerBytes: Uint8Array;
  try {
    staffBytes = await buildJobReportPdf({
      job: jobForReport,
      items,
      media,
      assigneeNames,
      audience: "staff",
    });
    customerBytes = await buildJobReportPdf({
      job: jobForReport,
      items,
      media,
      assigneeNames,
      audience: "customer",
    });
  } catch (err) {
    console.error("[jobs/finalize] PDF build failed:", err);
    return {
      ok: false,
      status: 500,
      error: err instanceof Error ? err.message : "PDF generation failed",
    };
  }

  const admin = createAdminClient();
  const staffPath = `reports/jobs/${jobId}/report.pdf`;
  const customerPath = `reports/jobs/${jobId}/report-customer.pdf`;

  const staffUpload = await admin.storage
    .from(BUCKET)
    .upload(staffPath, staffBytes, { contentType: "application/pdf", upsert: true });
  if (staffUpload.error) {
    return {
      ok: false,
      status: 500,
      error: `Staff PDF upload failed: ${staffUpload.error.message}`,
    };
  }

  const customerUpload = await admin.storage
    .from(BUCKET)
    .upload(customerPath, customerBytes, { contentType: "application/pdf", upsert: true });
  if (customerUpload.error) {
    return {
      ok: false,
      status: 500,
      error: `Customer PDF upload failed: ${customerUpload.error.message}`,
    };
  }

  await db
    .update(jobs)
    .set({
      status: "completed",
      completedAt,
      finalizedPdfPath: staffPath,
      customerPdfPath: customerPath,
    })
    .where(eq(jobs.id, jobId));

  await logJobActivity({
    jobId,
    eventType: "job.finalized",
    actorId,
    summary: wasAlreadyCompleted
      ? "Regenerated customer + staff PDFs from the current job state"
      : "Marked job complete and generated customer + staff PDFs",
    metadata: {
      regenerated: wasAlreadyCompleted,
      finalizedPdfPath: staffPath,
      customerPdfPath: customerPath,
      itemCount: items.length,
      mediaCount: media.length,
    },
  });

  return {
    ok: true,
    jobId,
    finalizedPdfPath: staffPath,
    customerPdfPath: customerPath,
    completedAt,
  };
}
