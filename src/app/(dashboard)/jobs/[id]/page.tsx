import { asc, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { JobDetailView } from "@/components/jobs/job-detail-view";
import { db } from "@/lib/db";
import { jobChecklistItems, jobMedia, jobSummaries, jobs, profiles } from "@/lib/db/schema";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkJobAccess, getUserRole } from "@/lib/supabase/auth-helpers";
import { createClient } from "@/lib/supabase/server";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function JobDetailPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [job] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
  if (!job) notFound();

  const { allowed } = await checkJobAccess(supabase, user.id, job.assignedTo);
  if (!allowed) {
    return (
      <div className="max-w-xl">
        <h1 className="text-2xl font-bold">Forbidden</h1>
        <p className="mt-2 text-muted-foreground">This job is assigned to another technician.</p>
      </div>
    );
  }
  const role = (await getUserRole(supabase)) ?? "field_tech";

  const [assignee] = await db
    .select({ fullName: profiles.fullName })
    .from(profiles)
    .where(eq(profiles.id, job.assignedTo))
    .limit(1);

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

  // Sign URLs for each media row so thumbnails render in the detail view
  const admin = createAdminClient();
  const mediaWithUrls = await Promise.all(
    media.map(async (m) => {
      const { data } = await admin.storage
        .from("inspection-media")
        .createSignedUrl(m.storagePath, 3600);
      return { ...m, signedUrl: data?.signedUrl ?? null };
    }),
  );

  const [latestSummary] = await db
    .select()
    .from(jobSummaries)
    .where(eq(jobSummaries.jobId, id))
    .orderBy(asc(jobSummaries.createdAt))
    .limit(1);

  return (
    <JobDetailView
      role={role}
      currentUserId={user.id}
      job={{
        id: job.id,
        title: job.title,
        status: job.status as "open" | "in_progress" | "completed",
        assignedTo: job.assignedTo,
        assigneeName: assignee?.fullName ?? null,
        customerName: job.customerName,
        customerEmail: job.customerEmail,
        customerPhone: job.customerPhone,
        serviceAddress: job.serviceAddress,
        city: job.city,
        state: job.state,
        zip: job.zip,
        generalNotes: job.generalNotes,
        customerSummary: job.customerSummary,
        finalizedPdfPath: job.finalizedPdfPath,
        customerPdfPath: job.customerPdfPath,
      }}
      items={items.map((i) => ({
        id: i.id,
        title: i.title,
        instructions: i.instructions,
        requiredPhotoCount: i.requiredPhotoCount,
        requiresNote: i.requiresNote,
        isRequired: i.isRequired,
        sortOrder: i.sortOrder,
        status: i.status as "pending" | "done" | "skipped",
        note: i.note,
      }))}
      media={mediaWithUrls.map((m) => ({
        id: m.id,
        bucket: m.bucket as "checklist_item" | "general",
        checklistItemId: m.checklistItemId,
        storagePath: m.storagePath,
        signedUrl: m.signedUrl,
        type: m.type as "photo" | "video",
        description: m.description,
        visibleToCustomer: m.visibleToCustomer,
        sortOrder: m.sortOrder,
      }))}
      latestSummaryToken={latestSummary?.token ?? null}
    />
  );
}
