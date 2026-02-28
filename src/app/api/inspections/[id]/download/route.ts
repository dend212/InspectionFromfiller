import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { inspections } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  getReportDownloadUrl,
  buildDownloadFilename,
} from "@/lib/storage/pdf-storage";
import { checkInspectionAccess } from "@/lib/supabase/auth-helpers";

/**
 * GET /api/inspections/[id]/download
 * Returns a signed download URL for the finalized PDF report.
 * Access: inspection owner, admin, or office_staff.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Load the inspection
  const [inspection] = await db
    .select()
    .from(inspections)
    .where(eq(inspections.id, id))
    .limit(1);

  if (!inspection) {
    return NextResponse.json(
      { error: "Inspection not found" },
      { status: 404 },
    );
  }

  // Verify user has access to this inspection
  const { allowed } = await checkInspectionAccess(supabase, user.id, inspection.inspectorId);
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!inspection.finalizedPdfPath) {
    return NextResponse.json(
      { error: "No finalized PDF available" },
      { status: 404 },
    );
  }

  // Build a user-friendly download filename (address + date)
  const downloadFilename = buildDownloadFilename(
    inspection.facilityAddress,
    inspection.completedAt,
  );

  // Generate signed URL (1 hour expiry)
  let signedUrl: string;
  try {
    signedUrl = await getReportDownloadUrl(
      inspection.finalizedPdfPath,
      downloadFilename,
    );
  } catch (err) {
    console.error("Download URL generation failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Download URL generation failed: ${message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    downloadUrl: signedUrl,
    filename: downloadFilename,
  });
}
