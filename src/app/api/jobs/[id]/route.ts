import { asc, eq, inArray } from "drizzle-orm";
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
      assignees: jobs.assignees,
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
    .where(eq(jobs.id, id))
    .limit(1);

  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const { allowed } = await checkJobAccess(supabase, user.id, job.assignees);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Resolve assignee names
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
    .where(eq(jobChecklistItems.jobId, id))
    .orderBy(asc(jobChecklistItems.sortOrder));

  const media = await db
    .select()
    .from(jobMedia)
    .where(eq(jobMedia.jobId, id))
    .orderBy(asc(jobMedia.sortOrder), asc(jobMedia.createdAt));

  return NextResponse.json({ job: { ...job, assigneeNames }, items, media });
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
    .select({ id: jobs.id, assignees: jobs.assignees, status: jobs.status })
    .from(jobs)
    .where(eq(jobs.id, id))
    .limit(1);
  if (!existing) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const { allowed } = await checkJobAccess(supabase, user.id, existing.assignees);
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
  if (body.assignees !== undefined || body.assignedTo !== undefined) {
    const role = await getUserRole(supabase);
    if (role !== "admin" && role !== "office_staff") {
      return NextResponse.json(
        { error: "Only admin or office staff can reassign jobs" },
        { status: 403 },
      );
    }
    // Accept either `assignees: string[]` (new) or legacy `assignedTo: string`.
    const raw: unknown = body.assignees ?? (body.assignedTo ? [body.assignedTo] : []);
    if (!Array.isArray(raw)) {
      return NextResponse.json({ error: "assignees must be an array" }, { status: 400 });
    }
    const normalized = Array.from(
      new Set(
        (raw as unknown[])
          .filter((v): v is string => typeof v === "string")
          .map((v) => v.trim())
          .filter(Boolean),
      ),
    );
    // Verify every assignee id exists in profiles.
    if (normalized.length > 0) {
      const existingProfiles = await db
        .select({ id: profiles.id })
        .from(profiles)
        .where(inArray(profiles.id, normalized));
      const found = new Set(existingProfiles.map((p) => p.id));
      const missing = normalized.filter((pid) => !found.has(pid));
      if (missing.length) {
        return NextResponse.json(
          { error: `Assignee(s) not found: ${missing.join(", ")}` },
          { status: 400 },
        );
      }
    }
    updates.assignees = normalized;
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
