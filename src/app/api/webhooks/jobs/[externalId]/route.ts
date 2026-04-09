import { asc, desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jobChecklistItems, jobMedia, jobSummaries, jobs, profiles } from "@/lib/db/schema";
import { verifyJobsWebhookAuth } from "@/lib/jobs/webhook-auth";

/**
 * GET /api/webhooks/jobs/[externalId]
 *
 * Lets n8n poll for the current state of a job it created. Returns the
 * full lifecycle state: status, assignees array, customer summary, PDF
 * paths, tokenized public URL (if one has been generated), media counts,
 * and checklist summary. This lets the upstream CRM mirror our state back
 * without us needing outbound webhooks.
 *
 * Auth: same Bearer token as the create route.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ externalId: string }> },
) {
  const authFail = verifyJobsWebhookAuth(request);
  if (authFail) return authFail;

  const { externalId } = await params;
  if (!externalId) {
    return NextResponse.json({ error: "externalId is required" }, { status: 400 });
  }

  const [job] = await db
    .select({
      id: jobs.id,
      externalId: jobs.externalId,
      title: jobs.title,
      status: jobs.status,
      assignees: jobs.assignees,
      customerSummary: jobs.customerSummary,
      finalizedPdfPath: jobs.finalizedPdfPath,
      customerPdfPath: jobs.customerPdfPath,
      startedAt: jobs.startedAt,
      completedAt: jobs.completedAt,
      createdAt: jobs.createdAt,
      updatedAt: jobs.updatedAt,
    })
    .from(jobs)
    .where(eq(jobs.externalId, externalId))
    .limit(1);

  if (!job) {
    return NextResponse.json({ error: `No job with externalId: ${externalId}` }, { status: 404 });
  }

  const assigneeProfiles = job.assignees.length
    ? await db
        .select({ id: profiles.id, fullName: profiles.fullName, email: profiles.email })
        .from(profiles)
        .where(inArray(profiles.id, job.assignees))
    : [];
  // Preserve the order from the stored array so the first-listed tech is
  // still the first element in the response.
  const profileById = new Map(assigneeProfiles.map((p) => [p.id, p] as const));
  const assignees = job.assignees
    .map((id) => profileById.get(id))
    .filter((x): x is { id: string; fullName: string; email: string } => x !== undefined);

  const items = await db
    .select({
      id: jobChecklistItems.id,
      title: jobChecklistItems.title,
      status: jobChecklistItems.status,
      isRequired: jobChecklistItems.isRequired,
      requiredPhotoCount: jobChecklistItems.requiredPhotoCount,
      requiresNote: jobChecklistItems.requiresNote,
    })
    .from(jobChecklistItems)
    .where(eq(jobChecklistItems.jobId, job.id))
    .orderBy(asc(jobChecklistItems.sortOrder));

  const media = await db
    .select({ type: jobMedia.type })
    .from(jobMedia)
    .where(eq(jobMedia.jobId, job.id));

  const mediaCount = media.reduce(
    (acc, m) => {
      if (m.type === "photo") acc.photos += 1;
      else if (m.type === "video") acc.videos += 1;
      return acc;
    },
    { photos: 0, videos: 0 },
  );

  // Latest tokenized summary URL (if admin has generated one)
  const [summary] = await db
    .select({ token: jobSummaries.token, expiresAt: jobSummaries.expiresAt })
    .from(jobSummaries)
    .where(eq(jobSummaries.jobId, job.id))
    .orderBy(desc(jobSummaries.createdAt))
    .limit(1);

  const base = process.env.NEXT_PUBLIC_APP_URL || request.headers.get("origin") || "";
  const publicSummaryUrl = summary ? `${base}/jobs/summary/${summary.token}` : null;

  return NextResponse.json({
    jobId: job.id,
    externalId: job.externalId,
    title: job.title,
    status: job.status,
    assignees,
    customerSummary: job.customerSummary,
    finalizedPdfPath: job.finalizedPdfPath,
    customerPdfPath: job.customerPdfPath,
    publicSummaryUrl,
    publicSummaryExpiresAt: summary?.expiresAt ?? null,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    url: `${base}/jobs/${job.id}`,
    mediaCount,
    checklist: items,
  });
}
