import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { inspections, inspectionSummaries } from "@/lib/db/schema";
import { buildDownloadFilename, getReportDownloadUrl } from "@/lib/storage/pdf-storage";

/**
 * GET /api/summary/[token]/download
 * Public endpoint — returns a signed Supabase Storage URL for the finalized PDF.
 * No authentication required (secured by token + expiration).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const [summary] = await db
    .select()
    .from(inspectionSummaries)
    .where(eq(inspectionSummaries.token, token))
    .limit(1);

  if (!summary) {
    return NextResponse.json({ error: "Summary not found" }, { status: 404 });
  }

  if (new Date() > summary.expiresAt) {
    return NextResponse.json({ error: "This summary has expired" }, { status: 410 });
  }

  const [inspection] = await db
    .select()
    .from(inspections)
    .where(eq(inspections.id, summary.inspectionId))
    .limit(1);

  if (!inspection || !inspection.finalizedPdfPath) {
    return NextResponse.json({ error: "PDF not available" }, { status: 404 });
  }

  const downloadFilename = buildDownloadFilename(
    inspection.facilityAddress,
    inspection.completedAt,
  );

  const downloadUrl = await getReportDownloadUrl(
    inspection.finalizedPdfPath,
    downloadFilename,
  );

  return NextResponse.json({ downloadUrl, filename: downloadFilename });
}
