import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jobMedia, jobs } from "@/lib/db/schema";
import { logJobActivity } from "@/lib/jobs/activity";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkJobAccess } from "@/lib/supabase/auth-helpers";
import { createClient } from "@/lib/supabase/server";

/**
 * PATCH /api/jobs/[id]/media/[mediaId]
 * Update a media row (description, visibleToCustomer, sortOrder).
 * visibleToCustomer may only be set to false on general-bucket rows — the UI
 * must never try to hide a checklist photo from the customer because those
 * are required evidence.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; mediaId: string }> },
) {
  const { id, mediaId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [job] = await db
    .select({ assignees: jobs.assignees })
    .from(jobs)
    .where(eq(jobs.id, id))
    .limit(1);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const { allowed } = await checkJobAccess(supabase, user.id, job.assignees);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [media] = await db
    .select()
    .from(jobMedia)
    .where(and(eq(jobMedia.id, mediaId), eq(jobMedia.jobId, id)))
    .limit(1);
  if (!media) return NextResponse.json({ error: "Media not found" }, { status: 404 });

  let body: {
    description?: string | null;
    visibleToCustomer?: boolean;
    sortOrder?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (body.description !== undefined) {
    updates.description = body.description ? body.description.trim() : null;
  }
  if (body.visibleToCustomer !== undefined) {
    if (body.visibleToCustomer === false && media.bucket === "checklist_item") {
      return NextResponse.json(
        { error: "Checklist photos are always visible to the customer" },
        { status: 400 },
      );
    }
    updates.visibleToCustomer = !!body.visibleToCustomer;
  }
  if (body.sortOrder !== undefined) updates.sortOrder = Math.floor(body.sortOrder);

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const [updated] = await db
    .update(jobMedia)
    .set(updates)
    .where(and(eq(jobMedia.id, mediaId), eq(jobMedia.jobId, id)))
    .returning();

  // Visibility toggles are the only field on this route worth logging —
  // description/sortOrder changes would just be noise in the timeline.
  if (body.visibleToCustomer !== undefined && body.visibleToCustomer !== media.visibleToCustomer) {
    await logJobActivity({
      jobId: id,
      eventType: "media.visibility_changed",
      actorId: user.id,
      summary: body.visibleToCustomer
        ? `Made a ${media.type} visible to the customer`
        : `Hid a ${media.type} from the customer`,
      metadata: {
        mediaId,
        type: media.type,
        visibleToCustomer: body.visibleToCustomer,
      },
    });
  }

  return NextResponse.json({ media: updated });
}

/**
 * DELETE /api/jobs/[id]/media/[mediaId]
 * Remove a media row and delete the underlying storage object.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; mediaId: string }> },
) {
  const { id, mediaId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [job] = await db
    .select({ assignees: jobs.assignees })
    .from(jobs)
    .where(eq(jobs.id, id))
    .limit(1);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const { allowed } = await checkJobAccess(supabase, user.id, job.assignees);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [media] = await db
    .select()
    .from(jobMedia)
    .where(and(eq(jobMedia.id, mediaId), eq(jobMedia.jobId, id)))
    .limit(1);
  if (!media) return NextResponse.json({ error: "Media not found" }, { status: 404 });

  const admin = createAdminClient();
  await admin.storage.from("inspection-media").remove([media.storagePath]);

  await db.delete(jobMedia).where(eq(jobMedia.id, mediaId));

  await logJobActivity({
    jobId: id,
    eventType: "media.removed",
    actorId: user.id,
    summary: `Removed a ${media.type}${media.bucket === "checklist_item" ? " from a checklist item" : " from general media"}`,
    metadata: {
      mediaId,
      type: media.type,
      bucket: media.bucket,
    },
  });

  return NextResponse.json({ success: true });
}
