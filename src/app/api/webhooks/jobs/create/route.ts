import { and, asc, eq, ilike, inArray, isNull, sql } from "drizzle-orm";
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
import { verifyJobsWebhookAuth } from "@/lib/jobs/webhook-auth";
import { jobsWebhookCreateSchema } from "@/lib/validators/jobs-webhook";

/**
 * POST /api/webhooks/jobs/create
 *
 * Creates a job on behalf of an external CRM (e.g. Workiz → n8n → here).
 *
 * Auth: `Authorization: Bearer <JOBS_WEBHOOK_SECRET>` — no Supabase session
 * needed, so n8n can hit this directly.
 *
 * Idempotency: `externalId` is unique in the DB (partial unique index). If a
 * job already exists for the same externalId, we return it with
 * `duplicate: true` and HTTP 200 — safe to retry.
 *
 * Tech lookup: resolves every entry in `assignedToEmail` (exact, case-
 * insensitive email match) and in `assignedToName` (case-insensitive name
 * match) to a profile id. The resulting set is stored as the job's
 * `assignees` array. If both fields are empty the job is created
 * "unassigned" and any field tech can pick it up. If a lookup value is
 * provided but doesn't resolve to a profile, the entire request fails with
 * 404 so the upstream CRM knows something is wrong.
 *
 * Template lookup (optional): `templateId` wins over `templateName`; if
 * `templateName` is provided, look up active (non-archived) templates by
 * case-insensitive name. 404 if name provided but not found.
 */
export async function POST(request: Request) {
  // 1. Auth
  const authFail = verifyJobsWebhookAuth(request);
  if (authFail) return authFail;

  // 2. Parse + validate body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = jobsWebhookCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const payload = parsed.data;

  // 3. Idempotency check
  const [existing] = await db
    .select({ id: jobs.id, status: jobs.status })
    .from(jobs)
    .where(eq(jobs.externalId, payload.externalId))
    .limit(1);
  if (existing) {
    return NextResponse.json(
      {
        jobId: existing.id,
        status: existing.status,
        duplicate: true,
        url: buildJobUrl(request, existing.id),
      },
      { status: 200 },
    );
  }

  // 4. Tech lookup — resolve every email + name into a profile id.
  //    Emails are matched exactly (case-insensitive); names use ILIKE.
  //    The final assignees list is the union of both lookups, deduplicated.
  const resolvedProfiles = new Map<string, { id: string; fullName: string; email: string }>();

  // Emails: bulk lookup in one query
  const emailLookups = payload.assignedToEmail.map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (emailLookups.length > 0) {
    const rows = await db
      .select({ id: profiles.id, fullName: profiles.fullName, email: profiles.email })
      .from(profiles)
      .where(inArray(sql`lower(${profiles.email})`, emailLookups));
    for (const row of rows) resolvedProfiles.set(row.id, row);

    // Detect unresolved emails (one per line) so the CRM gets a specific error.
    const foundEmails = new Set(rows.map((r) => r.email.toLowerCase()));
    const unresolvedEmails = emailLookups.filter((e) => !foundEmails.has(e));
    if (unresolvedEmails.length > 0) {
      return NextResponse.json(
        { error: `No user found for email(s): ${unresolvedEmails.join(", ")}` },
        { status: 404 },
      );
    }
  }

  // Names: one lookup per entry because ILIKE isn't bulk-friendly.
  for (const nameRaw of payload.assignedToName) {
    const name = nameRaw.trim();
    if (!name) continue;
    const [byName] = await db
      .select({ id: profiles.id, fullName: profiles.fullName, email: profiles.email })
      .from(profiles)
      .where(ilike(profiles.fullName, name))
      .limit(1);
    if (!byName) {
      return NextResponse.json({ error: `No user found matching name: ${name}` }, { status: 404 });
    }
    resolvedProfiles.set(byName.id, byName);
  }

  const techProfiles = Array.from(resolvedProfiles.values());
  const assigneeIds = techProfiles.map((p) => p.id);
  // First resolved profile (if any) acts as the `createdBy` so `jobs.created_by`
  // still points at a real person for audit. If nothing resolved, createdBy
  // will be null (which the column allows).
  const primaryTech = techProfiles[0] ?? null;

  // 5. Template lookup (optional)
  let templateRow: { id: string; name: string } | undefined;
  let templateItems: Array<{
    title: string;
    instructions: string | null;
    requiredPhotoCount: number;
    requiresNote: boolean;
    isRequired: boolean;
    sortOrder: number;
  }> = [];

  if (payload.templateId) {
    const [row] = await db
      .select({ id: checklistTemplates.id, name: checklistTemplates.name })
      .from(checklistTemplates)
      .where(eq(checklistTemplates.id, payload.templateId))
      .limit(1);
    templateRow = row;
    if (!templateRow) {
      return NextResponse.json(
        { error: `No template found with id: ${payload.templateId}` },
        { status: 404 },
      );
    }
  } else if (payload.templateName.trim()) {
    const [row] = await db
      .select({ id: checklistTemplates.id, name: checklistTemplates.name })
      .from(checklistTemplates)
      .where(
        and(
          ilike(checklistTemplates.name, payload.templateName.trim()),
          isNull(checklistTemplates.archivedAt),
        ),
      )
      .limit(1);
    templateRow = row;
    if (!templateRow) {
      return NextResponse.json(
        { error: `No template found matching name: ${payload.templateName}` },
        { status: 404 },
      );
    }
  }

  if (templateRow) {
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
      .where(eq(checklistTemplateItems.templateId, templateRow.id))
      .orderBy(asc(checklistTemplateItems.sortOrder));
  }

  const scheduledFor = payload.scheduledFor.trim() ? new Date(payload.scheduledFor) : null;

  // 6. Create job + snapshot items in a single transaction
  const newJob = await db.transaction(async (tx) => {
    const [job] = await tx
      .insert(jobs)
      .values({
        assignees: assigneeIds,
        // n8n is acting on behalf of the (first) assignee — treat them as
        // creator so `jobs.created_by` still points at a real person for
        // audit. If no tech was resolved, createdBy is null.
        createdBy: primaryTech?.id ?? null,
        title: payload.title.trim(),
        customerName: payload.customer.name.trim() || null,
        customerEmail: payload.customer.email.trim() || null,
        customerPhone: payload.customer.phone.trim() || null,
        serviceAddress: payload.serviceAddress.street.trim() || null,
        city: payload.serviceAddress.city.trim() || null,
        state: payload.serviceAddress.state.trim() || "AZ",
        zip: payload.serviceAddress.zip.trim() || null,
        generalNotes: payload.initialNotes.trim() || null,
        sourceTemplateId: templateRow?.id ?? null,
        externalId: payload.externalId,
        scheduledFor,
      })
      .returning();

    if (templateItems.length > 0) {
      await tx.insert(jobChecklistItems).values(mapTemplateItemsToJobItems(job.id, templateItems));
    }

    return job;
  });

  await logJobActivity({
    jobId: newJob.id,
    eventType: "job.created",
    actorId: primaryTech?.id ?? null,
    summary: `Job "${newJob.title}" created via webhook${
      assigneeIds.length > 0
        ? ` · assigned to ${techProfiles.map((p) => p.fullName).join(", ")}`
        : " (unassigned)"
    }${templateRow ? ` · template "${templateRow.name}"` : ""}`,
    metadata: {
      source: "webhook",
      externalId: payload.externalId,
      title: newJob.title,
      assigneeCount: assigneeIds.length,
      templateId: templateRow?.id ?? null,
      templateName: templateRow?.name ?? null,
    },
  });

  return NextResponse.json(
    {
      jobId: newJob.id,
      status: newJob.status,
      duplicate: false,
      url: buildJobUrl(request, newJob.id),
      assignees: techProfiles.map((p) => ({
        id: p.id,
        fullName: p.fullName,
        email: p.email,
      })),
      templateApplied: templateRow
        ? { id: templateRow.id, name: templateRow.name, itemCount: templateItems.length }
        : null,
    },
    { status: 201 },
  );
}

function buildJobUrl(request: Request, jobId: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || request.headers.get("origin") || "";
  return `${base}/jobs/${jobId}`;
}
