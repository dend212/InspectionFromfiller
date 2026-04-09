import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jobChecklistItems, jobs } from "@/lib/db/schema";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkJobAccess } from "@/lib/supabase/auth-helpers";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/jobs/[id]/media/upload-url
 *
 * Authorizes a direct client-to-storage upload for a job photo. Mirrors the
 * inspections upload-url route: photos get a Supabase signed upload URL and
 * the client uploads bytes directly (no API body size constraints).
 *
 * Body: {
 *   fileName: string,
 *   bucket: "checklist_item" | "general",
 *   checklistItemId?: string    // required when bucket === "checklist_item"
 * }
 * Returns: { storagePath, signedUrl, token, bucket, checklistItemId }
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [job] = await db
    .select({ assignedTo: jobs.assignedTo })
    .from(jobs)
    .where(eq(jobs.id, id))
    .limit(1);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const { allowed } = await checkJobAccess(supabase, user.id, job.assignedTo);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { fileName?: string; bucket?: string; checklistItemId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { fileName, bucket, checklistItemId } = body;
  if (!fileName || typeof fileName !== "string") {
    return NextResponse.json({ error: "fileName is required" }, { status: 400 });
  }
  if (bucket !== "checklist_item" && bucket !== "general") {
    return NextResponse.json(
      { error: "bucket must be 'checklist_item' or 'general'" },
      { status: 400 },
    );
  }
  if (bucket === "checklist_item") {
    if (!checklistItemId) {
      return NextResponse.json(
        { error: "checklistItemId required when bucket is 'checklist_item'" },
        { status: 400 },
      );
    }
    const [item] = await db
      .select({ id: jobChecklistItems.id })
      .from(jobChecklistItems)
      .where(and(eq(jobChecklistItems.id, checklistItemId), eq(jobChecklistItems.jobId, id)))
      .limit(1);
    if (!item) {
      return NextResponse.json({ error: "Checklist item not found on this job" }, { status: 400 });
    }
  }

  const ext = fileName.split(".").pop()?.toLowerCase() ?? "jpg";
  const storagePath =
    bucket === "checklist_item"
      ? `jobs/${id}/items/${checklistItemId}/${crypto.randomUUID()}.${ext}`
      : `jobs/${id}/general/${crypto.randomUUID()}.${ext}`;

  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from("inspection-media")
    .createSignedUploadUrl(storagePath);

  if (error) {
    console.error("Failed to create signed upload URL:", error);
    return NextResponse.json(
      { error: `Failed to create upload URL: ${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    storagePath,
    signedUrl: data.signedUrl,
    token: data.token,
    bucket,
    checklistItemId: bucket === "checklist_item" ? checklistItemId : null,
  });
}
