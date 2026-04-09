import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { inspections } from "@/lib/db/schema";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkInspectionAccess } from "@/lib/supabase/auth-helpers";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/inspections/[id]/media/upload-url
 *
 * Authorizes a direct client-to-storage upload and returns the server-generated
 * object path. File bytes never pass through the API (no body size or memory
 * issues).
 *
 * - Photos (`type=photo`) use Supabase signed upload URLs — the route returns
 *   `{ signedUrl, token, storagePath }` and the client calls
 *   `uploadToSignedUrl`. Signed uploads bypass storage RLS.
 * - Videos (`type=video`) use the TUS resumable protocol for large files,
 *   progress tracking, and network-drop recovery. The route returns just
 *   `{ storagePath }`; the client uploads with its own user JWT directly to
 *   the Supabase `/storage/v1/upload/resumable` endpoint. Storage RLS
 *   (migration 0010) allows authenticated users to insert into the
 *   `inspection-media` bucket; path is the server-generated UUID so it
 *   cannot be guessed.
 *
 * Body:    { fileName: string, type: "photo" | "video", label?: string }
 * Returns: { storagePath: string, signedUrl?: string, token?: string }
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

  // Videos use TUS resumable upload from the browser; no signed URL needed.
  // Authorization is enforced by this route + storage.objects RLS (0010).
  if (type === "video") {
    return NextResponse.json({ storagePath });
  }

  // Photos use signed upload URLs (bypass RLS, simpler small-file path).
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
