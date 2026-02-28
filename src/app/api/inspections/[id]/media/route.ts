import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { inspections, inspectionMedia } from "@/lib/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { checkInspectionAccess } from "@/lib/supabase/auth-helpers";

/**
 * Verify user has access to the inspection.
 * Returns the inspection's inspectorId or an error response.
 */
async function verifyAccess(
  inspectionId: string,
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
) {
  const [inspection] = await db
    .select({ inspectorId: inspections.inspectorId })
    .from(inspections)
    .where(eq(inspections.id, inspectionId))
    .limit(1);

  if (!inspection) {
    return { error: NextResponse.json({ error: "Inspection not found" }, { status: 404 }) };
  }

  const { allowed } = await checkInspectionAccess(supabase, userId, inspection.inspectorId);
  if (!allowed) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { inspectorId: inspection.inspectorId };
}

/**
 * Generate a signed URL for a storage path (1 hour expiry).
 * Returns null if URL generation fails.
 */
async function getSignedUrl(
  supabase: Awaited<ReturnType<typeof createClient>>,
  storagePath: string,
): Promise<string | null> {
  const { data } = await supabase.storage
    .from("inspection-media")
    .createSignedUrl(storagePath, 3600);
  return data?.signedUrl ?? null;
}

/**
 * POST /api/inspections/[id]/media
 * Record media metadata after a successful Supabase Storage upload.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await verifyAccess(id, supabase, user.id);
  if ("error" in access) return access.error;

  const body = await request.json();
  const { storagePath, type, label } = body as {
    storagePath: string;
    type: "photo" | "video";
    label?: string;
  };

  if (!storagePath || !type) {
    return NextResponse.json(
      { error: "storagePath and type are required" },
      { status: 400 }
    );
  }

  const [record] = await db
    .insert(inspectionMedia)
    .values({
      inspectionId: id,
      type,
      storagePath,
      label: label ?? null,
    })
    .returning();

  // Include signed URL so the client can display the photo immediately
  const signedUrl = type === "photo"
    ? await getSignedUrl(supabase, storagePath)
    : null;

  return NextResponse.json({ ...record, signedUrl }, { status: 201 });
}

/**
 * GET /api/inspections/[id]/media
 * List all media for an inspection, ordered by sortOrder then createdAt.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await verifyAccess(id, supabase, user.id);
  if ("error" in access) return access.error;

  const records = await db
    .select()
    .from(inspectionMedia)
    .where(eq(inspectionMedia.inspectionId, id))
    .orderBy(asc(inspectionMedia.sortOrder), asc(inspectionMedia.createdAt));

  // Attach signed URLs for photos so the client can display them immediately
  const withUrls = await Promise.all(
    records.map(async (r) => ({
      ...r,
      signedUrl: r.type === "photo"
        ? await getSignedUrl(supabase, r.storagePath)
        : null,
    }))
  );

  return NextResponse.json(withUrls);
}

/**
 * DELETE /api/inspections/[id]/media
 * Remove a media record and its storage file.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await verifyAccess(id, supabase, user.id);
  if ("error" in access) return access.error;

  const body = await request.json();
  const { mediaId } = body as { mediaId: string };

  if (!mediaId) {
    return NextResponse.json(
      { error: "mediaId is required" },
      { status: 400 }
    );
  }

  // Find the media record to get storagePath
  const [record] = await db
    .select()
    .from(inspectionMedia)
    .where(
      and(
        eq(inspectionMedia.id, mediaId),
        eq(inspectionMedia.inspectionId, id)
      )
    )
    .limit(1);

  if (!record) {
    return NextResponse.json({ error: "Media not found" }, { status: 404 });
  }

  // Remove from Supabase Storage
  await supabase.storage
    .from("inspection-media")
    .remove([record.storagePath]);

  // Remove from database
  await db
    .delete(inspectionMedia)
    .where(eq(inspectionMedia.id, mediaId));

  return NextResponse.json({ deleted: true });
}
