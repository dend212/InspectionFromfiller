import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jobSummaries, jobs } from "@/lib/db/schema";
import { getUserRole } from "@/lib/supabase/auth-helpers";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/jobs/[id]/generate-summary
 * Returns the latest tokenized summary (if any) so the UI can show the
 * existing link without regenerating.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [latest] = await db
    .select()
    .from(jobSummaries)
    .where(eq(jobSummaries.jobId, id))
    .orderBy(desc(jobSummaries.createdAt))
    .limit(1);

  return NextResponse.json({ summary: latest ?? null });
}

/**
 * POST /api/jobs/[id]/generate-summary
 * Creates a tokenized customer summary page. Admin / office staff only, and
 * only after the job has been finalized (so the customer PDF is available).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = await getUserRole(supabase);
  if (role !== "admin" && role !== "office_staff") {
    return NextResponse.json({ error: "Forbidden: admin or office staff only" }, { status: 403 });
  }

  const [job] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  if (!job.customerPdfPath) {
    return NextResponse.json(
      { error: "Finalize the job before generating a customer link" },
      { status: 400 },
    );
  }

  const customerSummaryText = job.customerSummary?.trim() || "Service visit completed.";
  const token = nanoid(21);
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

  const [summary] = await db
    .insert(jobSummaries)
    .values({
      jobId: id,
      token,
      customerSummary: customerSummaryText,
      createdBy: user.id,
      expiresAt,
    })
    .returning();

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.headers.get("origin") || "";
  const summaryUrl = `${baseUrl}/jobs/summary/${token}`;

  return NextResponse.json({
    summaryId: summary.id,
    token,
    summaryUrl,
    expiresAt: summary.expiresAt,
  });
}
