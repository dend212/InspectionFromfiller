import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jobs } from "@/lib/db/schema";
import { finalizeJobById } from "@/lib/jobs/finalize";
import { checkJobAccess } from "@/lib/supabase/auth-helpers";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/jobs/[id]/finalize
 *
 * Dashboard route. Verifies the caller has access to this job, then delegates
 * to `finalizeJobById()` which contains the shared pipeline (gates → PDF build
 * → upload → status=completed). The same helper is called by the n8n status
 * webhook so both code paths stay in sync.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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

  const result = await finalizeJobById(id);
  if (!result.ok) {
    const body: Record<string, unknown> = { error: result.error };
    if ("details" in result) body.details = result.details;
    return NextResponse.json(body, { status: result.status });
  }

  const [updated] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
  return NextResponse.json({
    job: updated,
    finalizedPdfPath: result.finalizedPdfPath,
    customerPdfPath: result.customerPdfPath,
  });
}
