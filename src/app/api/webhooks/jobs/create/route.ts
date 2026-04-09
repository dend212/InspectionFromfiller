import { and, asc, eq, ilike, isNull, sql } from "drizzle-orm";
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
 * Tech lookup: tries `assignedToEmail` first (exact, case-insensitive),
 * then `assignedToName` (case-insensitive trim match). 404 if neither finds
 * a profile.
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

  // 4. Tech lookup — email first, fall back to fuzzy name
  let techProfile: { id: string; fullName: string; email: string } | undefined;

  if (payload.assignedToEmail.trim()) {
    const [byEmail] = await db
      .select({ id: profiles.id, fullName: profiles.fullName, email: profiles.email })
      .from(profiles)
      .where(eq(sql`lower(${profiles.email})`, payload.assignedToEmail.trim().toLowerCase()))
      .limit(1);
    techProfile = byEmail;
  }

  if (!techProfile && payload.assignedToName.trim()) {
    const [byName] = await db
      .select({ id: profiles.id, fullName: profiles.fullName, email: profiles.email })
      .from(profiles)
      .where(ilike(profiles.fullName, payload.assignedToName.trim()))
      .limit(1);
    techProfile = byName;
  }

  if (!techProfile) {
    return NextResponse.json(
      {
        error: `No user found matching tech: ${payload.assignedToEmail || payload.assignedToName}`,
      },
      { status: 404 },
    );
  }

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
        assignedTo: techProfile!.id,
        // n8n is acting on behalf of the assignee — treat them as creator.
        // Avoids needing a separate system-user identity and keeps `jobs.created_by`
        // pointing at a real person for audit.
        createdBy: techProfile!.id,
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

  return NextResponse.json(
    {
      jobId: newJob.id,
      status: newJob.status,
      duplicate: false,
      url: buildJobUrl(request, newJob.id),
      assignedTo: {
        id: techProfile.id,
        fullName: techProfile.fullName,
        email: techProfile.email,
      },
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
