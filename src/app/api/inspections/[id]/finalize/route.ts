import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { inspections, inspectionMedia } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { generateReport } from "@/lib/pdf/generate-report";
import { uploadReport, buildDownloadFilename } from "@/lib/storage/pdf-storage";
import type { InspectionFormData } from "@/types/inspection";
import type { MediaRecord } from "@/components/inspection/media-gallery";

/**
 * POST /api/inspections/[id]/finalize
 * Transition: in_review -> completed
 * Generates PDF server-side, uploads to Supabase Storage, then transitions status.
 * Allowed: admin only
 */
export async function POST(
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

  // Admin-only check
  let userRole: string | null = null;
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session) {
      const payload = JSON.parse(
        Buffer.from(session.access_token.split(".")[1], "base64").toString(),
      );
      userRole = payload.user_role ?? null;
    }
  } catch {
    // Role decode failed
  }

  if (userRole !== "admin") {
    return NextResponse.json(
      { error: "Forbidden: admin only" },
      { status: 403 },
    );
  }

  // Load the full inspection record
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

  if (inspection.status !== "in_review") {
    return NextResponse.json(
      { error: "Cannot finalize: inspection is not in review" },
      { status: 409 },
    );
  }

  const formData = inspection.formData as InspectionFormData | null;
  if (!formData) {
    return NextResponse.json(
      { error: "Cannot finalize: no form data" },
      { status: 400 },
    );
  }

  // Load media records for this inspection
  const mediaRows = await db
    .select()
    .from(inspectionMedia)
    .where(eq(inspectionMedia.inspectionId, id));

  const mediaRecords: MediaRecord[] = mediaRows.map((m) => ({
    id: m.id,
    type: m.type as "photo" | "video",
    storagePath: m.storagePath,
    label: m.label,
    sortOrder: m.sortOrder,
    createdAt: m.createdAt.toISOString(),
  }));

  // Extract signature data URL from form data (if present)
  const signatureDataUrl =
    (formData as Record<string, unknown> & { disposalWorks?: { signatureDataUrl?: string } })
      .disposalWorks?.signatureDataUrl ?? null;

  // Generate PDF server-side
  let pdfData: Uint8Array;
  try {
    pdfData = await generateReport(
      formData,
      signatureDataUrl,
      mediaRecords.length > 0 ? mediaRecords : undefined,
    );
  } catch (err) {
    console.error("PDF generation failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `PDF generation failed: ${message}` },
      { status: 500 },
    );
  }

  // Upload PDF to Supabase Storage
  let storagePath: string;
  try {
    storagePath = await uploadReport(id, pdfData, "report.pdf");
  } catch (err) {
    console.error("PDF upload failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `PDF upload failed: ${message}` },
      { status: 500 },
    );
  }

  // Atomic status transition: only update if current status is "in_review"
  const now = new Date();
  const result = await db
    .update(inspections)
    .set({
      status: "completed",
      completedAt: now,
      finalizedPdfPath: storagePath,
      reviewedBy: user.id,
      updatedAt: now,
    })
    .where(and(eq(inspections.id, id), eq(inspections.status, "in_review")))
    .returning({ id: inspections.id });

  if (result.length === 0) {
    return NextResponse.json(
      { error: "Cannot finalize: inspection is not in review" },
      { status: 409 },
    );
  }

  return NextResponse.json({ status: "completed", pdfPath: storagePath });
}
