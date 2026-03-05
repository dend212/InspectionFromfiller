import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { inspections, inspectionSummaries, profiles } from "@/lib/db/schema";
import { COMPANY_CONTACT, INSPECTOR_DEFAULTS } from "@/lib/constants/inspection";
import { InspectionSummary } from "@/components/summary/inspection-summary";
import { SummaryExpired } from "@/components/summary/summary-expired";
import type { InspectionFormData } from "@/types/inspection";

interface SummaryPageProps {
  params: Promise<{ token: string }>;
}

export default async function SummaryPage({ params }: SummaryPageProps) {
  const { token } = await params;

  // Look up summary by token
  const [summary] = await db
    .select()
    .from(inspectionSummaries)
    .where(eq(inspectionSummaries.token, token))
    .limit(1);

  if (!summary) {
    return <SummaryExpired />;
  }

  // Check expiration
  if (new Date() > summary.expiresAt) {
    return <SummaryExpired />;
  }

  // Load inspection
  const [inspection] = await db
    .select()
    .from(inspections)
    .where(eq(inspections.id, summary.inspectionId))
    .limit(1);

  if (!inspection) {
    return <SummaryExpired />;
  }

  // Load inspector profile name
  const [inspector] = await db
    .select({ fullName: profiles.fullName })
    .from(profiles)
    .where(eq(profiles.id, inspection.inspectorId))
    .limit(1);

  const formData = inspection.formData as InspectionFormData | null;

  const summaryData = {
    token,
    facilityName: inspection.facilityName,
    facilityAddress: inspection.facilityAddress,
    facilityCity: inspection.facilityCity,
    facilityState: inspection.facilityState ?? "AZ",
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
  };

  return <InspectionSummary data={summaryData} />;
}
