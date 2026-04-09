import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jobs } from "@/lib/db/schema";
import { finalizeJobById } from "@/lib/jobs/finalize";
import { verifyJobsWebhookAuth } from "@/lib/jobs/webhook-auth";
import { jobsWebhookStatusSchema } from "@/lib/validators/jobs-webhook";

/**
 * POST /api/webhooks/jobs/[externalId]/status
 *
 * Push a status transition from n8n. Covers the full lifecycle:
 *
 *   - { status: "open" }                         → revert to open
 *   - { status: "in_progress" }                  → mark in progress (sets started_at)
 *   - { status: "completed", finalize: true }    → run finalize pipeline (PDFs + status)
 *
 * Finalizing without `finalize: true` is rejected — there's no legitimate
 * use case for a completed job with no PDF, and letting n8n flip status
 * without finalizing would leave the dashboard in an inconsistent state.
 *
 * Auth: `Authorization: Bearer <JOBS_WEBHOOK_SECRET>`.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ externalId: string }> },
) {
  const authFail = verifyJobsWebhookAuth(request);
  if (authFail) return authFail;

  const { externalId } = await params;
  if (!externalId) {
    return NextResponse.json({ error: "externalId is required" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = jobsWebhookStatusSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { status, finalize } = parsed.data;

  const [job] = await db
    .select({ id: jobs.id, status: jobs.status, startedAt: jobs.startedAt })
    .from(jobs)
    .where(eq(jobs.externalId, externalId))
    .limit(1);
  if (!job) {
    return NextResponse.json({ error: `No job with externalId: ${externalId}` }, { status: 404 });
  }

  // completed requires finalize=true
  if (status === "completed") {
    if (!finalize) {
      return NextResponse.json(
        {
          error: "Use finalize: true to mark a job completed (ensures PDFs are built)",
        },
        { status: 400 },
      );
    }
    const result = await finalizeJobById(job.id);
    if (!result.ok) {
      const errBody: Record<string, unknown> = { error: result.error };
      if ("details" in result) errBody.details = result.details;
      return NextResponse.json(errBody, { status: result.status });
    }
    return NextResponse.json({
      jobId: result.jobId,
      status: "completed",
      finalizedPdfPath: result.finalizedPdfPath,
      customerPdfPath: result.customerPdfPath,
      completedAt: result.completedAt,
    });
  }

  // open / in_progress — plain status update
  const updates: Record<string, unknown> = { status };
  if (status === "in_progress" && !job.startedAt) {
    updates.startedAt = new Date();
  }
  if (status === "open") {
    // If an admin wants to reset a job, clear startedAt too so the lifecycle
    // metadata doesn't lie.
    updates.startedAt = null;
  }

  const [updated] = await db
    .update(jobs)
    .set(updates)
    .where(eq(jobs.id, job.id))
    .returning({ id: jobs.id, status: jobs.status, startedAt: jobs.startedAt });

  return NextResponse.json({
    jobId: updated.id,
    status: updated.status,
    startedAt: updated.startedAt,
  });
}
