import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jobs } from "@/lib/db/schema";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkJobAccess } from "@/lib/supabase/auth-helpers";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/jobs/[id]/download?variant=staff|customer
 * Returns a 1-hour signed URL for the finalized PDF.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const url = new URL(request.url);
  const variant = url.searchParams.get("variant") === "customer" ? "customer" : "staff";
  const path = variant === "customer" ? job.customerPdfPath : job.finalizedPdfPath;
  if (!path) {
    return NextResponse.json({ error: "Job has not been finalized" }, { status: 400 });
  }

  const sanitized = job.title.trim().replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-_]/g, "");
  const downloadName = `${sanitized || "service-visit"}${
    variant === "customer" ? "" : "-staff"
  }.pdf`;

  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from("inspection-media")
    .createSignedUrl(path, 3600, { download: downloadName });
  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to sign download URL" },
      { status: 500 },
    );
  }
  return NextResponse.json({ url: data.signedUrl });
}
