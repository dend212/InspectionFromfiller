import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jobSummaries, jobs } from "@/lib/db/schema";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/public/jobs/summary/[token]/pdf
 *
 * Public endpoint for the tokenized customer link. Verifies the token is valid
 * and not expired, then returns a short-lived signed URL for the customer PDF.
 * Uses the admin (service-role) client to bypass RLS because the caller is
 * unauthenticated.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const [summary] = await db
    .select()
    .from(jobSummaries)
    .where(eq(jobSummaries.token, token))
    .limit(1);
  if (!summary) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (new Date() > summary.expiresAt) {
    return NextResponse.json({ error: "Link has expired" }, { status: 410 });
  }

  const [job] = await db.select().from(jobs).where(eq(jobs.id, summary.jobId)).limit(1);
  if (!job?.customerPdfPath) {
    return NextResponse.json({ error: "Report not available" }, { status: 404 });
  }

  const sanitized = job.title
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9-_]/g, "");
  const downloadName = `${sanitized || "service-visit"}.pdf`;
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from("inspection-media")
    .createSignedUrl(job.customerPdfPath, 3600, { download: downloadName });
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Failed to sign URL" }, { status: 500 });
  }
  // Redirect so the client can click the link directly
  return NextResponse.redirect(data.signedUrl, { status: 302 });
}
