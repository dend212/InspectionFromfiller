import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { inspectionRecords, inspections } from "@/lib/db/schema";
import { RECORD_SIGNED_URL_TTL_SECONDS, getRecordSignedUrl } from "@/lib/storage/record-storage";
import { checkInspectionAccess } from "@/lib/supabase/auth-helpers";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/inspections/[id]/records/[recordId]
 * 302 → 10-minute signed URL for a stored permit PDF.
 * Access: inspection owner, admin, or office_staff (same rule as /download).
 *
 * Linked from the tile with a plain <a target="_blank" rel="noopener"> — never
 * next/link, whose prefetch would fire this GET and burn a signed URL.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; recordId: string }> },
) {
  const { id, recordId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [inspection] = await db
    .select({ id: inspections.id, inspectorId: inspections.inspectorId })
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

  // Scope the record to this inspection so a record ID from another
  // inspection can never be reached through an inspection the caller may view.
  const [record] = await db
    .select({ storagePath: inspectionRecords.storagePath })
    .from(inspectionRecords)
    .where(and(eq(inspectionRecords.id, recordId), eq(inspectionRecords.inspectionId, id)))
    .limit(1);

  if (!record) {
    return NextResponse.json({ error: "Record not found" }, { status: 404 });
  }
  if (!record.storagePath) {
    return NextResponse.json({ error: "Document was not stored" }, { status: 404 });
  }

  let signedUrl: string;
  try {
    signedUrl = await getRecordSignedUrl(record.storagePath, RECORD_SIGNED_URL_TTL_SECONDS);
  } catch (err) {
    console.error("Record signed URL generation failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.redirect(signedUrl, {
    status: 302,
    headers: { "Cache-Control": "no-store" },
  });
}
