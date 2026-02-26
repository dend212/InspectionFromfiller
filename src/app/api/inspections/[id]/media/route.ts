import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { inspectionMedia } from "@/lib/db/schema";
import { eq, and, asc } from "drizzle-orm";

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

  return NextResponse.json(record, { status: 201 });
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

  const records = await db
    .select()
    .from(inspectionMedia)
    .where(eq(inspectionMedia.inspectionId, id))
    .orderBy(asc(inspectionMedia.sortOrder), asc(inspectionMedia.createdAt));

  return NextResponse.json(records);
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
