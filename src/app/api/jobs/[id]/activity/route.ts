import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jobActivity, jobs, profiles } from "@/lib/db/schema";
import { checkJobAccess } from "@/lib/supabase/auth-helpers";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/jobs/[id]/activity
 *
 * Returns the reverse-chronological activity timeline for a job. Every
 * entry carries:
 *   - eventType (machine-readable, drives icon selection in the UI)
 *   - summary (human-readable single line)
 *   - actorName (resolved via profile join, "System" when actorId is null)
 *   - metadata (JSONB blob — currently rendered on hover for debugging)
 *
 * Access: anyone allowed to view the job itself. Same rule as the job
 * detail route.
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
      id: jobActivity.id,
      eventType: jobActivity.eventType,
      summary: jobActivity.summary,
      metadata: jobActivity.metadata,
      createdAt: jobActivity.createdAt,
      actorId: jobActivity.actorId,
      actorName: profiles.fullName,
    })
    .from(jobActivity)
    .leftJoin(profiles, eq(jobActivity.actorId, profiles.id))
    .where(eq(jobActivity.jobId, id))
    .orderBy(desc(jobActivity.createdAt));

  return NextResponse.json(
    rows.map((r) => ({
      id: r.id,
      eventType: r.eventType,
      summary: r.summary,
      metadata: r.metadata,
      createdAt: r.createdAt.toISOString(),
      actorName: r.actorName ?? (r.actorId ? "Unknown user" : "System"),
    })),
  );
}
