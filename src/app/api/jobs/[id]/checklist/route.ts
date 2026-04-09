import { eq, max } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jobChecklistItems, jobs } from "@/lib/db/schema";
import { checkJobAccess } from "@/lib/supabase/auth-helpers";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/jobs/[id]/checklist
 * Add an ad-hoc item to a job's checklist snapshot. Does not touch the source
 * template. Body mirrors the template item shape.
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
    title?: string;
    instructions?: string;
    requiredPhotoCount?: number;
    requiresNote?: boolean;
    isRequired?: boolean;
    sortOrder?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const title = body.title?.trim();
  if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });

  let sortOrder = body.sortOrder;
  if (sortOrder === undefined) {
    const [{ maxOrder }] = await db
      .select({ maxOrder: max(jobChecklistItems.sortOrder) })
      .from(jobChecklistItems)
      .where(eq(jobChecklistItems.jobId, id));
    sortOrder = (maxOrder ?? -1) + 1;
  }

  const [item] = await db
    .insert(jobChecklistItems)
    .values({
      jobId: id,
      title,
      instructions: body.instructions?.trim() || null,
      requiredPhotoCount: Math.max(0, Math.floor(body.requiredPhotoCount ?? 0)),
      requiresNote: !!body.requiresNote,
      isRequired: body.isRequired ?? true,
      sortOrder,
      status: "pending",
    })
    .returning();

  return NextResponse.json({ item });
}

/**
 * PATCH /api/jobs/[id]/checklist
 * Reorder checklist items by providing an array of { id, sortOrder } entries.
 * Body: { order: Array<{ id: string, sortOrder: number }> }
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  let body: { order?: Array<{ id: string; sortOrder: number }> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.order) || body.order.length === 0) {
    return NextResponse.json({ error: "order array required" }, { status: 400 });
  }

  await db.transaction(async (tx) => {
    for (const entry of body.order!) {
      await tx
        .update(jobChecklistItems)
        .set({ sortOrder: Math.floor(entry.sortOrder) })
        .where(eq(jobChecklistItems.id, entry.id));
    }
  });

  return NextResponse.json({ success: true });
}
