import type { ProposedField } from "./types";

/** The shape /api/apn-lookup returns under `assessor` */
export interface AssessorSummary {
  ownerName: string;
  physicalAddress: string;
  city: string;
  zip: string;
  county: string;
  apnFormatted: string;
  legalDescription: string;
  lotSize: string;
  yearBuilt: string;
}

/** Verified 2026-09-11: returns the parcel page with HTTP 200 */
export function assessorParcelUrl(apn: string): string {
  return `https://mcassessor.maricopa.gov/mcs/?q=${encodeURIComponent(apn)}`;
}

const FIELD_MAP: Array<{ fieldPath: string; key: keyof AssessorSummary; attribute: string }> = [
  { fieldPath: "facilityInfo.facilityName", key: "ownerName", attribute: "OWNER_NAME" },
  { fieldPath: "facilityInfo.sellerName", key: "ownerName", attribute: "OWNER_NAME" },
  { fieldPath: "facilityInfo.facilityAddress", key: "physicalAddress", attribute: "PHYSICAL_ADDRESS" },
  { fieldPath: "facilityInfo.facilityCity", key: "city", attribute: "PHYSICAL_CITY" },
  { fieldPath: "facilityInfo.facilityZip", key: "zip", attribute: "PHYSICAL_ZIP" },
  { fieldPath: "facilityInfo.facilityCounty", key: "county", attribute: "COUNTY" },
  { fieldPath: "facilityInfo.taxParcelNumber", key: "apnFormatted", attribute: "APN_DASH" },
];

/**
 * The same seven fields /api/apn-lookup writes, as confidence-1.0 proposals so
 * the APN lookup input, the assessor stage and (phase 5) webhook drafts all
 * attach identical provenance.
 */
export function assessorProposals(summary: AssessorSummary, apn: string): ProposedField[] {
  const explanation = `Maricopa County Assessor · parcel ${apn}`;
  const sourceUrl = assessorParcelUrl(apn);
  const proposals: ProposedField[] = [];
  for (const { fieldPath, key, attribute } of FIELD_MAP) {
    const value = key === "apnFormatted" ? summary.apnFormatted || apn : summary[key];
    if (!value) continue;
    proposals.push({
      fieldPath,
      value,
      kind: "fill",
      provenance: {
        source: "assessor",
        confidence: 1,
        explanation,
        evidence: `${attribute}: ${value}`,
        sourceUrl,
      },
    });
  }
  return proposals;
}
