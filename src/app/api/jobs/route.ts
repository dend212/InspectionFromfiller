import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  checklistTemplateItems,
  checklistTemplates,
  jobChecklistItems,
  jobs,
  profiles,
} from "@/lib/db/schema";
import { mapTemplateItemsToJobItems } from "@/lib/jobs/apply-template";
import { getUserRole } from "@/lib/supabase/auth-helpers";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/jobs
 * List jobs visible to the current user. Supports:
 *   ?status=open|in_progress|completed
 *   ?assignedTo=<uuid>           (admin/office_staff only)
 *   ?q=<substring>               (title / customer name match)
 *   ?page=1&pageSize=20
 *
 * field_tech automatically sees only their own jobs; admin/office_staff see all.
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
  const status = url.searchParams.get("status") as
    | "open"
    | "in_progress"
    | "completed"
    | null;
  const assignedToParam = url.searchParams.get("assignedTo");
  const q = url.searchParams.get("q")?.trim() || "";
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10));
  const pageSize = Math.min(
    100,
    Math.max(1, Number.parseInt(url.searchParams.get("pageSize") ?? String(PAGE_SIZE), 10)),
  );

  const conditions = [];
  // Role-aware visibility
  if (role === "field_tech") {
    conditions.push(eq(jobs.assignedTo, user.id));
  } else if (assignedToParam) {
    conditions.push(eq(jobs.assignedTo, assignedToParam));
  }
  if (status) conditions.push(eq(jobs.status, status));
  if (q) {
    conditions.push(
      // biome-ignore lint/style/noNonNullAssertion: drizzle or() always has at least one arg
      or(
        ilike(jobs.title, `%${q}%`),
        ilike(jobs.customerName, `%${q}%`),
        ilike(jobs.customerEmail, `%${q}%`),
      )!,
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      id: jobs.id,
      title: jobs.title,
      status: jobs.status,
      assignedTo: jobs.assignedTo,
      assigneeName: profiles.fullName,
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
    .leftJoin(profiles, eq(profiles.id, jobs.assignedTo))
    .where(where)
    .orderBy(desc(jobs.updatedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(jobs)
    .where(where);

  return NextResponse.json({
    jobs: rows,
    pagination: { page, pageSize, total: count, totalPages: Math.ceil(count / pageSize) },
  });
}

/**
 * POST /api/jobs
 * Create a new job. Optionally snapshot a checklist template into
 * job_checklist_items. Any authenticated user with a role may create.
 *
 * Body: {
 *   title, assignedTo, templateId?,
 *   customerName?, customerEmail?, customerPhone?,
 *   serviceAddress?, city?, state?, zip?,
 *   scheduledFor?: ISO string
 * }
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

  // If no assignee specified, default to the creator.
  const assignedTo = body.assignedTo?.trim() || user.id;

  // field_tech can only assign jobs to themselves; admin/office_staff can assign anyone.
  if (role === "field_tech" && assignedTo !== user.id) {
    return NextResponse.json(
      { error: "Field techs can only create jobs assigned to themselves" },
      { status: 403 },
    );
  }

  // Verify assignee exists
  const [assignee] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.id, assignedTo))
    .limit(1);
  if (!assignee) {
    return NextResponse.json({ error: "Assignee not found" }, { status: 400 });
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
        assignedTo,
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

  return NextResponse.json({ job: result });
}
