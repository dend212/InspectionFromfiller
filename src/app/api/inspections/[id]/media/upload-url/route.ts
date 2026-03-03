import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { inspections } from "@/lib/db/schema";
import { checkInspectionAccess } from "@/lib/supabase/auth-helpers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/inspections/[id]/media/upload-url
 * Generate a presigned upload URL for direct client-to-storage uploads.
 * This avoids routing file bytes through the API (no body size or memory issues).
 *
 * Body: { fileName: string, type: "photo" | "video", label?: string }
 * Returns: { signedUrl: string, token: string, storagePath: string }
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify access
  const [inspection] = await db
    .select({ inspectorId: inspections.inspectorId })
    .from(inspections)
    .where(eq(inspections.id, id))
    .limit(1);

  if (!inspection) {
    return NextResponse.json({ error: "Inspection not found" }, { status: 404 });
  }

  const { allowed } = await checkInspectionAccess(supabase, user.id, inspection.inspectorId);
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { fileName, type, label } = body as {
    fileName: string;
    type: "photo" | "video";
    label?: string;
  };

  if (!fileName || !type) {
    return NextResponse.json({ error: "fileName and type are required" }, { status: 400 });
  }

  // Sanitize: use only the file extension from the original name
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "bin";
  const section = label ?? type;
  const storagePath = `${id}/${section}/${crypto.randomUUID()}.${ext}`;

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
    signedUrl: data.signedUrl,
    token: data.token,
    storagePath,
  });
}
