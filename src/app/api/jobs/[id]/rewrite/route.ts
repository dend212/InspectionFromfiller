import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import {
  rewriteJobNotes,
  type JobRewriteType,
} from "@/lib/ai/rewrite-job-notes";
import { db } from "@/lib/db";
import { jobChecklistItems, jobs } from "@/lib/db/schema";
import { checkJobAccess } from "@/lib/supabase/auth-helpers";
import { createClient } from "@/lib/supabase/server";

/** Simple in-memory rate limiter: jobId → timestamps */
const rewriteTimestamps = new Map<string, number[]>();
const MAX_REWRITES_PER_HOUR = 5;
const ONE_HOUR_MS = 60 * 60 * 1000;

function checkRateLimit(jobId: string): boolean {
  const now = Date.now();
  const timestamps = rewriteTimestamps.get(jobId) ?? [];
  const recent = timestamps.filter((t) => now - t < ONE_HOUR_MS);
  if (recent.length >= MAX_REWRITES_PER_HOUR) return false;
  recent.push(now);
  rewriteTimestamps.set(jobId, recent);
  return true;
}

const VALID_TYPES: JobRewriteType[] = ["generalNotes", "checklistItem", "customerSummary"];

/**
 * POST /api/jobs/[id]/rewrite
 * Unified rewrite endpoint for all three job note scopes. The type parameter
 * determines which context builder the AI module uses.
 *
 * Body: {
 *   type: "generalNotes" | "checklistItem" | "customerSummary",
 *   currentText?: string,        // required for generalNotes & checklistItem
 *   checklistItemId?: string     // required for checklistItem
 * }
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [job] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const { allowed } = await checkJobAccess(supabase, user.id, job.assignedTo);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (!checkRateLimit(id)) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Maximum 5 rewrites per hour per job." },
      { status: 429 },
    );
  }

  let body: {
    type?: string;
    currentText?: string;
    checklistItemId?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.type || !VALID_TYPES.includes(body.type as JobRewriteType)) {
    return NextResponse.json(
      { error: "type must be 'generalNotes' | 'checklistItem' | 'customerSummary'" },
      { status: 400 },
    );
  }

  const jobContext = {
    title: job.title,
    customerName: job.customerName,
    serviceAddress: job.serviceAddress,
    city: job.city,
    state: job.state,
    zip: job.zip,
  };

  try {
    let rewrittenText: string;

    if (body.type === "generalNotes") {
      rewrittenText = await rewriteJobNotes({
        type: "generalNotes",
        context: { job: jobContext, currentText: body.currentText ?? "" },
      });
    } else if (body.type === "checklistItem") {
      if (!body.checklistItemId) {
        return NextResponse.json(
          { error: "checklistItemId required for checklistItem rewrite" },
          { status: 400 },
        );
      }
      const [item] = await db
        .select()
        .from(jobChecklistItems)
        .where(and(eq(jobChecklistItems.id, body.checklistItemId), eq(jobChecklistItems.jobId, id)))
        .limit(1);
      if (!item) {
        return NextResponse.json({ error: "Checklist item not found" }, { status: 400 });
      }
      rewrittenText = await rewriteJobNotes({
        type: "checklistItem",
        context: {
          job: jobContext,
          itemTitle: item.title,
          itemInstructions: item.instructions,
          itemStatus: item.status as "pending" | "done" | "skipped",
          currentText: body.currentText ?? item.note ?? "",
        },
      });
    } else {
      // customerSummary: load all items
      const items = await db
        .select({
          title: jobChecklistItems.title,
          status: jobChecklistItems.status,
          note: jobChecklistItems.note,
        })
        .from(jobChecklistItems)
        .where(eq(jobChecklistItems.jobId, id))
        .orderBy(asc(jobChecklistItems.sortOrder));

      rewrittenText = await rewriteJobNotes({
        type: "customerSummary",
        context: {
          job: jobContext,
          generalNotes: job.generalNotes,
          items: items.map((i) => ({
            title: i.title,
            status: i.status as "pending" | "done" | "skipped",
            note: i.note,
          })),
        },
      });
    }

    return NextResponse.json({ rewrittenText });
  } catch (err) {
    console.error("[jobs rewrite] AI error:", err);
    const message = err instanceof Error ? err.message : "Failed to generate text";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
