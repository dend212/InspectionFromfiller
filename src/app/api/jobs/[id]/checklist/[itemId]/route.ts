import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jobChecklistItems, jobs } from "@/lib/db/schema";
import { logJobActivity } from "@/lib/jobs/activity";
import { checkJobAccess } from "@/lib/supabase/auth-helpers";
import { createClient } from "@/lib/supabase/server";

/**
 * PATCH /api/jobs/[id]/checklist/[itemId]
 * Update a single per-job checklist item (title, instructions, requirements,
 * status, note).
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const { id, itemId } = await params;
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

  // Load current item state so we can detect meaningful transitions
  // (status change, note added) for the activity log.
  const [existingItem] = await db
    .select({
      title: jobChecklistItems.title,
      status: jobChecklistItems.status,
      note: jobChecklistItems.note,
    })
    .from(jobChecklistItems)
    .where(and(eq(jobChecklistItems.id, itemId), eq(jobChecklistItems.jobId, id)))
    .limit(1);
  if (!existingItem) {
    return NextResponse.json({ error: "Checklist item not found" }, { status: 404 });
  }

  let body: {
    title?: string;
    instructions?: string | null;
    requiredPhotoCount?: number;
    requiresNote?: boolean;
    isRequired?: boolean;
    sortOrder?: number;
    note?: string | null;
    status?: "pending" | "done" | "skipped";
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (body.title !== undefined) {
    const trimmed = body.title.trim();
    if (!trimmed) return NextResponse.json({ error: "Title cannot be empty" }, { status: 400 });
    updates.title = trimmed;
  }
  if (body.instructions !== undefined) {
    updates.instructions = body.instructions ? body.instructions.trim() : null;
  }
  if (body.requiredPhotoCount !== undefined) {
    updates.requiredPhotoCount = Math.max(0, Math.floor(body.requiredPhotoCount));
  }
  if (body.requiresNote !== undefined) updates.requiresNote = !!body.requiresNote;
  if (body.isRequired !== undefined) updates.isRequired = !!body.isRequired;
  if (body.sortOrder !== undefined) updates.sortOrder = Math.floor(body.sortOrder);
  if (body.note !== undefined) {
    updates.note = body.note ? body.note.trim() : null;
  }
  if (body.status !== undefined) {
    if (!["pending", "done", "skipped"].includes(body.status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    updates.status = body.status;
    if (body.status === "done") {
      updates.completedAt = new Date();
      updates.completedBy = user.id;
    } else {
      updates.completedAt = null;
      updates.completedBy = null;
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const [updated] = await db
    .update(jobChecklistItems)
    .set(updates)
    .where(and(eq(jobChecklistItems.id, itemId), eq(jobChecklistItems.jobId, id)))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Checklist item not found" }, { status: 404 });
  }

  // Prefer a dedicated event for status transitions so the timeline highlights
  // "Done" / "Skipped" checkpoints, and fall back to a generic edit event
  // for pure title / note / instruction updates.
  const statusChanged = updates.status !== undefined && updates.status !== existingItem.status;
  if (statusChanged) {
    await logJobActivity({
      jobId: id,
      eventType: "checklist.item_status_changed",
      actorId: user.id,
      summary: `"${existingItem.title}" → ${updates.status}`,
      metadata: {
        itemId,
        title: existingItem.title,
        from: existingItem.status,
        to: updates.status,
      },
    });
  } else {
    const which: string[] = [];
    if (updates.title !== undefined && updates.title !== existingItem.title) which.push("title");
    if (updates.note !== undefined && updates.note !== existingItem.note) which.push("note");
    if (updates.instructions !== undefined) which.push("instructions");
    if (which.length > 0) {
      await logJobActivity({
        jobId: id,
        eventType: "checklist.item_updated",
        actorId: user.id,
        summary: `Updated ${which.join(", ")} on "${existingItem.title}"`,
        metadata: { itemId, title: existingItem.title, fields: which },
      });
    }
  }

  return NextResponse.json({ item: updated });
}

/**
 * DELETE /api/jobs/[id]/checklist/[itemId]
 * Remove a per-job checklist item. Does not affect the source template.
 * Cascades delete any media rows attached to the item.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const { id, itemId } = await params;
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

  const [deleted] = await db
    .delete(jobChecklistItems)
    .where(and(eq(jobChecklistItems.id, itemId), eq(jobChecklistItems.jobId, id)))
    .returning({ id: jobChecklistItems.id, title: jobChecklistItems.title });

  if (!deleted) {
    return NextResponse.json({ error: "Checklist item not found" }, { status: 404 });
  }

  await logJobActivity({
    jobId: id,
    eventType: "checklist.item_deleted",
    actorId: user.id,
    summary: `Removed checklist item "${deleted.title}"`,
    metadata: { itemId: deleted.id, title: deleted.title },
  });

  return NextResponse.json({ success: true });
}
