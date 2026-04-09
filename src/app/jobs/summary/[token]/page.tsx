import { asc, eq, inArray } from "drizzle-orm";
import { JobSummaryView } from "@/components/jobs/job-summary-view";
import { SummaryExpired } from "@/components/summary/summary-expired";
import { db } from "@/lib/db";
import { jobChecklistItems, jobMedia, jobSummaries, jobs, profiles } from "@/lib/db/schema";
import { createAdminClient } from "@/lib/supabase/admin";

interface JobSummaryPageProps {
  params: Promise<{ token: string }>;
}

export default async function JobSummaryPage({ params }: JobSummaryPageProps) {
  const { token } = await params;

  const [summary] = await db
    .select()
    .from(jobSummaries)
    .where(eq(jobSummaries.token, token))
    .limit(1);

  if (!summary) return <SummaryExpired />;
  if (new Date() > summary.expiresAt) return <SummaryExpired />;

  const [job] = await db.select().from(jobs).where(eq(jobs.id, summary.jobId)).limit(1);
  if (!job) return <SummaryExpired />;

  const assigneeProfiles = job.assignees.length
    ? await db
        .select({ id: profiles.id, fullName: profiles.fullName })
        .from(profiles)
        .where(inArray(profiles.id, job.assignees))
    : [];
  const nameById = new Map(assigneeProfiles.map((p) => [p.id, p.fullName] as const));
  const assigneeNames = job.assignees.map((aid) => nameById.get(aid) ?? "Unknown");

  const items = await db
    .select()
    .from(jobChecklistItems)
    .where(eq(jobChecklistItems.jobId, job.id))
    .orderBy(asc(jobChecklistItems.sortOrder));

  const allMedia = await db
    .select()
    .from(jobMedia)
    .where(eq(jobMedia.jobId, job.id))
    .orderBy(asc(jobMedia.sortOrder), asc(jobMedia.createdAt));

  // Filter: checklist photos always visible; general photos only if flagged
  const visibleMedia = allMedia.filter((m) => m.bucket === "checklist_item" || m.visibleToCustomer);

  const admin = createAdminClient();
  const mediaWithUrls = await Promise.all(
    visibleMedia.map(async (m) => {
      const { data } = await admin.storage
        .from("inspection-media")
        .createSignedUrl(m.storagePath, 3600);
      return {
        id: m.id,
        signedUrl: data?.signedUrl ?? null,
        bucket: m.bucket,
        checklistItemId: m.checklistItemId,
        type: m.type as "photo" | "video",
        description: m.description,
      };
    }),
  );

  return (
    <JobSummaryView
      token={token}
      expiresAt={summary.expiresAt.toISOString()}
      job={{
        title: job.title,
        customerName: job.customerName,
        serviceAddress: job.serviceAddress,
        city: job.city,
        state: job.state,
        zip: job.zip,
        completedAt: job.completedAt?.toISOString() ?? null,
        customerSummary: summary.customerSummary,
      }}
      assigneeNames={assigneeNames}
      items={items.map((i) => ({
        id: i.id,
        title: i.title,
        instructions: i.instructions,
        status: i.status as "pending" | "done" | "skipped",
        note: i.note,
      }))}
      media={mediaWithUrls.filter((m) => m.signedUrl)}
      hasPdf={!!job.customerPdfPath}
    />
  );
}
