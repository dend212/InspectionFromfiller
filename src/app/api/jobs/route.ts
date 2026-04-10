import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  checklistTemplateItems,
  checklistTemplates,
  jobChecklistItems,
  jobs,
  profiles,
} from "@/lib/db/schema";
import { logJobActivity } from "@/lib/jobs/activity";
import { mapTemplateItemsToJobItems } from "@/lib/jobs/apply-template";
import { getUserRole } from "@/lib/supabase/auth-helpers";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/jobs
 * List jobs visible to the current user. Supports:
 *   ?status=open|in_progress|completed
 *   ?assignedTo=<uuid>           (admin/office_staff only — filter to jobs
 *                                 including that assignee)
 *   ?unassigned=true             (admin/office_staff only — only jobs with
 *                                 an empty assignees array)
 *   ?q=<substring>               (title / customer name match)
 *   ?page=1&pageSize=20
 *
 * field_tech sees jobs where they are in `assignees` OR `assignees` is empty
 * (unassigned jobs are open to any tech). admin/office_staff see all.
 */
const PAGE_SIZE = 20;

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = await getUserRole(supabase);
  if (!role) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(request.url);
  const status = url.searchParams.get("status") as "open" | "in_progress" | "completed" | null;
  const assignedToParam = url.searchParams.get("assignedTo");
  const unassignedOnly = url.searchParams.get("unassigned") === "true";
  const q = url.searchParams.get("q")?.trim() || "";
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10));
  const pageSize = Math.min(
    100,
    Math.max(1, Number.parseInt(url.searchParams.get("pageSize") ?? String(PAGE_SIZE), 10)),
  );

  const conditions = [];
  // Role-aware visibility.
  if (role === "field_tech") {
    // Field techs see their own jobs + any unassigned (open-to-all) jobs.
    const orCond = or(
      sql`cardinality(${jobs.assignees}) = 0`,
      sql`${user.id}::uuid = ANY(${jobs.assignees})`,
    );
    if (orCond) conditions.push(orCond);
  } else if (unassignedOnly) {
    conditions.push(sql`cardinality(${jobs.assignees}) = 0`);
  } else if (assignedToParam) {
    conditions.push(sql`${assignedToParam}::uuid = ANY(${jobs.assignees})`);
  }
  if (status) conditions.push(eq(jobs.status, status));
  if (q) {
    const orCondition = or(
      ilike(jobs.title, `%${q}%`),
      ilike(jobs.customerName, `%${q}%`),
      ilike(jobs.customerEmail, `%${q}%`),
    );
    if (orCondition) conditions.push(orCondition);
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      id: jobs.id,
      title: jobs.title,
      status: jobs.status,
      assignees: jobs.assignees,
      customerName: jobs.customerName,
      serviceAddress: jobs.serviceAddress,
      city: jobs.city,
      state: jobs.state,
      zip: jobs.zip,
      scheduledFor: jobs.scheduledFor,
      createdAt: jobs.createdAt,
      updatedAt: jobs.updatedAt,
      completedAt: jobs.completedAt,
    })
    .from(jobs)
    .where(where)
    .orderBy(desc(jobs.updatedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  // Resolve assignee display names in a single follow-up query.
  const allAssigneeIds = Array.from(new Set(rows.flatMap((r) => r.assignees)));
  const assigneeProfiles = allAssigneeIds.length
    ? await db
        .select({ id: profiles.id, fullName: profiles.fullName })
        .from(profiles)
        .where(inArray(profiles.id, allAssigneeIds))
    : [];
  const nameById = new Map(assigneeProfiles.map((p) => [p.id, p.fullName] as const));

  const rowsWithNames = rows.map((r) => ({
    ...r,
    assigneeNames: r.assignees.map((id) => nameById.get(id) ?? "Unknown").filter(Boolean),
  }));

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(jobs)
    .where(where);

  return NextResponse.json({
    jobs: rowsWithNames,
    pagination: { page, pageSize, total: count, totalPages: Math.ceil(count / pageSize) },
  });
}

/**
 * POST /api/jobs
 * Create a new job. Optionally snapshot a checklist template into
 * job_checklist_items. Any authenticated user with a role may create.
 *
 * Body: {
 *   title,
 *   assignees?: string[],   // profile ids; empty/omitted = unassigned (open to all techs)
 *   templateId?,
 *   customerName?, customerEmail?, customerPhone?,
 *   serviceAddress?, city?, state?, zip?,
 *   scheduledFor?: ISO string
 * }
 *
 * For backwards compatibility, `assignedTo` (single string) is still accepted
 * and normalized into a single-element `assignees` array.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = await getUserRole(supabase);
  if (!role) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: {
    title?: string;
    assignees?: unknown;
    assignedTo?: string;
    templateId?: string | null;
    customerName?: string;
    customerEmail?: string;
    customerPhone?: string;
    serviceAddress?: string;
    city?: string;
    state?: string;
    zip?: string;
    scheduledFor?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const title = body.title?.trim();
  if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });

  // Normalize the assignees input to a deduped string[] of trimmed uuids.
  const rawAssignees: unknown = Array.isArray(body.assignees)
    ? body.assignees
    : body.assignedTo
      ? [body.assignedTo]
      : [];
  const assigneesInput = Array.from(
    new Set(
      (rawAssignees as unknown[])
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  );

  // Field techs can only leave it unassigned (empty) or assign it to themselves.
  if (role === "field_tech") {
    if (
      assigneesInput.length > 1 ||
      (assigneesInput.length === 1 && assigneesInput[0] !== user.id)
    ) {
      return NextResponse.json(
        { error: "Field techs can only create jobs assigned to themselves or unassigned" },
        { status: 403 },
      );
    }
  }

  // Verify every referenced assignee exists in profiles.
  if (assigneesInput.length > 0) {
    const existing = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(inArray(profiles.id, assigneesInput));
    const foundIds = new Set(existing.map((p) => p.id));
    const missing = assigneesInput.filter((id) => !foundIds.has(id));
    if (missing.length) {
      return NextResponse.json(
        { error: `Assignee(s) not found: ${missing.join(", ")}` },
        { status: 400 },
      );
    }
  }

  // If template provided, verify it exists (and load items in same trip)
  let templateRow: { id: string } | undefined;
  let templateItems: Array<{
    title: string;
    instructions: string | null;
    requiredPhotoCount: number;
    requiresNote: boolean;
    isRequired: boolean;
    sortOrder: number;
  }> = [];
  if (body.templateId) {
    [templateRow] = await db
      .select({ id: checklistTemplates.id })
      .from(checklistTemplates)
      .where(eq(checklistTemplates.id, body.templateId))
      .limit(1);
    if (!templateRow) {
      return NextResponse.json({ error: "Template not found" }, { status: 400 });
    }
    templateItems = await db
      .select({
        title: checklistTemplateItems.title,
        instructions: checklistTemplateItems.instructions,
        requiredPhotoCount: checklistTemplateItems.requiredPhotoCount,
        requiresNote: checklistTemplateItems.requiresNote,
        isRequired: checklistTemplateItems.isRequired,
        sortOrder: checklistTemplateItems.sortOrder,
      })
      .from(checklistTemplateItems)
      .where(eq(checklistTemplateItems.templateId, body.templateId))
      .orderBy(asc(checklistTemplateItems.sortOrder));
  }

  const scheduledFor = body.scheduledFor ? new Date(body.scheduledFor) : null;

  // Create job + snapshot items in a transaction
  const result = await db.transaction(async (tx) => {
    const [job] = await tx
      .insert(jobs)
      .values({
        assignees: assigneesInput,
        createdBy: user.id,
        title,
        customerName: body.customerName?.trim() || null,
        customerEmail: body.customerEmail?.trim() || null,
        customerPhone: body.customerPhone?.trim() || null,
        serviceAddress: body.serviceAddress?.trim() || null,
        city: body.city?.trim() || null,
        state: body.state?.trim() || "AZ",
        zip: body.zip?.trim() || null,
        sourceTemplateId: templateRow?.id ?? null,
        scheduledFor,
      })
      .returning();

    if (templateItems.length > 0) {
      const rows = mapTemplateItemsToJobItems(job.id, templateItems);
      await tx.insert(jobChecklistItems).values(rows);
    }

    return job;
  });

  await logJobActivity({
    jobId: result.id,
    eventType: "job.created",
    actorId: user.id,
    summary: `Job "${result.title}" created${
      assigneesInput.length > 0
        ? ` with ${assigneesInput.length} assignee${assigneesInput.length === 1 ? "" : "s"}`
        : " (unassigned)"
    }${templateRow ? ` from template` : ""}`,
    metadata: {
      title: result.title,
      assigneeCount: assigneesInput.length,
      templateId: templateRow?.id ?? null,
      templateItemCount: templateItems.length,
      customerName: result.customerName,
    },
  });

  return NextResponse.json({ job: result });
}
