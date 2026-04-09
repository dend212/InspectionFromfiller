import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jobChecklistItems, jobMedia, jobs, profiles } from "@/lib/db/schema";
import { checkJobAccess, getUserRole } from "@/lib/supabase/auth-helpers";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/jobs/[id]
 * Fetch a single job with checklist items and media rows.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [job] = await db
    .select({
      id: jobs.id,
      title: jobs.title,
      status: jobs.status,
      assignedTo: jobs.assignedTo,
      assigneeName: profiles.fullName,
      createdBy: jobs.createdBy,
      customerName: jobs.customerName,
      customerEmail: jobs.customerEmail,
      customerPhone: jobs.customerPhone,
      serviceAddress: jobs.serviceAddress,
      city: jobs.city,
      state: jobs.state,
      zip: jobs.zip,
      generalNotes: jobs.generalNotes,
      customerSummary: jobs.customerSummary,
      sourceTemplateId: jobs.sourceTemplateId,
      finalizedPdfPath: jobs.finalizedPdfPath,
      customerPdfPath: jobs.customerPdfPath,
      scheduledFor: jobs.scheduledFor,
      startedAt: jobs.startedAt,
      completedAt: jobs.completedAt,
      createdAt: jobs.createdAt,
      updatedAt: jobs.updatedAt,
    })
    .from(jobs)
    .leftJoin(profiles, eq(profiles.id, jobs.assignedTo))
    .where(eq(jobs.id, id))
    .limit(1);

  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const { allowed } = await checkJobAccess(supabase, user.id, job.assignedTo);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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

  return NextResponse.json({ job, items, media });
}

/**
 * PATCH /api/jobs/[id]
 * Update job metadata or status. Note: finalize has its own route; this
 * endpoint handles in-progress edits (customer fields, notes, summary, status
 * to in_progress).
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [existing] = await db
    .select({ id: jobs.id, assignedTo: jobs.assignedTo, status: jobs.status })
    .from(jobs)
    .where(eq(jobs.id, id))
    .limit(1);
  if (!existing) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const { allowed } = await checkJobAccess(supabase, user.id, existing.assignedTo);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  const stringFields = [
    "title",
    "customerName",
    "customerEmail",
    "customerPhone",
    "serviceAddress",
    "city",
    "state",
    "zip",
    "generalNotes",
    "customerSummary",
  ] as const;
  for (const f of stringFields) {
    if (body[f] !== undefined) {
      const v = body[f];
      updates[f] = typeof v === "string" ? v.trim() || null : null;
    }
  }
  if (body.scheduledFor !== undefined) {
    updates.scheduledFor = body.scheduledFor ? new Date(body.scheduledFor as string) : null;
  }
  if (body.assignedTo !== undefined) {
    const role = await getUserRole(supabase);
    if (role !== "admin" && role !== "office_staff") {
      return NextResponse.json(
        { error: "Only admin or office staff can reassign jobs" },
        { status: 403 },
      );
    }
    updates.assignedTo = body.assignedTo as string;
  }
  if (body.status !== undefined) {
    const next = body.status as "open" | "in_progress" | "completed";
    if (!["open", "in_progress", "completed"].includes(next)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    // Finalize-to-completed should go through /finalize — block direct flip here.
    if (next === "completed") {
      return NextResponse.json(
        { error: "Use /api/jobs/[id]/finalize to mark a job completed" },
        { status: 400 },
      );
    }
    updates.status = next;
    if (next === "in_progress" && existing.status !== "in_progress") {
      updates.startedAt = new Date();
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const [updated] = await db.update(jobs).set(updates).where(eq(jobs.id, id)).returning();

  return NextResponse.json({ job: updated });
}

/**
 * DELETE /api/jobs/[id]
 * Delete a job. Admin/office_staff only.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = await getUserRole(supabase);
  if (role !== "admin" && role !== "office_staff") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [deleted] = await db.delete(jobs).where(eq(jobs.id, id)).returning({ id: jobs.id });
  if (!deleted) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  return NextResponse.json({ success: true });
}
