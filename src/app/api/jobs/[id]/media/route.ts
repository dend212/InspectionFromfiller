import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jobChecklistItems, jobMedia, jobs } from "@/lib/db/schema";
import { checkJobAccess } from "@/lib/supabase/auth-helpers";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/jobs/[id]/media
 * Register an uploaded file in the job_media table. Called by the client after
 * a successful upload to the signed URL from /media/upload-url.
 *
 * Body: {
 *   storagePath, bucket: "checklist_item" | "general",
 *   checklistItemId?, type?: "photo" | "video" (default "photo"),
 *   description?
 * }
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [job] = await db
    .select({ assignedTo: jobs.assignedTo })
    .from(jobs)
    .where(eq(jobs.id, id))
    .limit(1);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const { allowed } = await checkJobAccess(supabase, user.id, job.assignedTo);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: {
    storagePath?: string;
    bucket?: "checklist_item" | "general";
    checklistItemId?: string | null;
    type?: "photo" | "video";
    description?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { storagePath, bucket } = body;
  if (!storagePath || typeof storagePath !== "string") {
    return NextResponse.json({ error: "storagePath is required" }, { status: 400 });
  }
  if (bucket !== "checklist_item" && bucket !== "general") {
    return NextResponse.json(
      { error: "bucket must be 'checklist_item' or 'general'" },
      { status: 400 },
    );
  }

  let checklistItemId: string | null = null;
  if (bucket === "checklist_item") {
    if (!body.checklistItemId) {
      return NextResponse.json(
        { error: "checklistItemId required when bucket is 'checklist_item'" },
        { status: 400 },
      );
    }
    const [item] = await db
      .select({ id: jobChecklistItems.id })
      .from(jobChecklistItems)
      .where(and(eq(jobChecklistItems.id, body.checklistItemId), eq(jobChecklistItems.jobId, id)))
      .limit(1);
    if (!item) {
      return NextResponse.json({ error: "Checklist item not found on this job" }, { status: 400 });
    }
    checklistItemId = body.checklistItemId;
  }

  const [inserted] = await db
    .insert(jobMedia)
    .values({
      jobId: id,
      checklistItemId,
      bucket,
      type: body.type ?? "photo",
      storagePath,
      description: body.description?.trim() || null,
      uploadedBy: user.id,
    })
    .returning();

  return NextResponse.json({ media: inserted });
}
