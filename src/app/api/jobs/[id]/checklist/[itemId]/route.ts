import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jobChecklistItems, jobs } from "@/lib/db/schema";
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
    .select({ assignedTo: jobs.assignedTo })
    .from(jobs)
    .where(eq(jobs.id, id))
    .limit(1);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const { allowed } = await checkJobAccess(supabase, user.id, job.assignedTo);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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
    .select({ assignedTo: jobs.assignedTo })
    .from(jobs)
    .where(eq(jobs.id, id))
    .limit(1);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const { allowed } = await checkJobAccess(supabase, user.id, job.assignedTo);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [deleted] = await db
    .delete(jobChecklistItems)
    .where(and(eq(jobChecklistItems.id, itemId), eq(jobChecklistItems.jobId, id)))
    .returning({ id: jobChecklistItems.id });

  if (!deleted) {
    return NextResponse.json({ error: "Checklist item not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
