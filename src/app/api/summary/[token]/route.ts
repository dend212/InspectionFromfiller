import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { inspections, inspectionSummaries, profiles } from "@/lib/db/schema";
import { COMPANY_CONTACT, INSPECTOR_DEFAULTS } from "@/lib/constants/inspection";
import type { InspectionFormData } from "@/types/inspection";

/**
 * GET /api/summary/[token]
 * Public endpoint — returns inspection summary data for the customer-facing page.
 * No authentication required.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // Look up summary by token
  const [summary] = await db
    .select()
    .from(inspectionSummaries)
    .where(eq(inspectionSummaries.token, token))
    .limit(1);

  if (!summary) {
    return NextResponse.json({ error: "Summary not found" }, { status: 404 });
  }

  // Check expiration
  if (new Date() > summary.expiresAt) {
    return NextResponse.json({ error: "This summary has expired" }, { status: 410 });
  }

  // Load inspection
  const [inspection] = await db
    .select()
    .from(inspections)
    .where(eq(inspections.id, summary.inspectionId))
    .limit(1);

  if (!inspection) {
    return NextResponse.json({ error: "Inspection not found" }, { status: 404 });
  }

  // Load inspector name from profile
  const [inspector] = await db
    .select({ fullName: profiles.fullName })
    .from(profiles)
    .where(eq(profiles.id, inspection.inspectorId))
    .limit(1);

  // Extract only the fields needed for display (no internal IDs or full formData)
  const formData = inspection.formData as InspectionFormData | null;

  return NextResponse.json({
    facilityName: inspection.facilityName,
    facilityAddress: inspection.facilityAddress,
    facilityCity: inspection.facilityCity,
    facilityState: inspection.facilityState,
    facilityZip: inspection.facilityZip,
    dateOfInspection: formData?.facilityInfo?.dateOfInspection ?? null,
    inspectorName: formData?.facilityInfo?.inspectorName ?? inspector?.fullName ?? null,
    septicTankCondition: formData?.facilityInfo?.septicTankCondition ?? null,
    disposalWorksCondition: formData?.facilityInfo?.disposalWorksCondition ?? null,
    septicTankComments: formData?.septicTank?.septicTankComments ?? null,
    disposalWorksComments: formData?.disposalWorks?.disposalWorksComments ?? null,
    recommendations: summary.recommendations,
    company: INSPECTOR_DEFAULTS,
    contact: COMPANY_CONTACT,
    hasPdf: !!inspection.finalizedPdfPath,
  });
}
