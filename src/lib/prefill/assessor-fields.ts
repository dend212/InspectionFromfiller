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
  /** Arizona DOR 4-digit property use code from the parcel layer (`PUC`), trimmed; absent when the layer has none */
  propertyUseCode?: string;
}

/** Verified 2026-09-11: returns the parcel page with HTTP 200 */
export function assessorParcelUrl(apn: string): string {
  return `https://mcassessor.maricopa.gov/mcs/?q=${encodeURIComponent(apn)}`;
}

/** `attribute` is the parcel attribute the value was read from; county is fixed by the source, not read */
const FIELD_MAP: Array<{ fieldPath: string; key: keyof AssessorSummary; attribute?: string }> = [
  { fieldPath: "facilityInfo.facilityName", key: "ownerName", attribute: "OWNER_NAME" },
  { fieldPath: "facilityInfo.sellerName", key: "ownerName", attribute: "OWNER_NAME" },
  { fieldPath: "facilityInfo.facilityAddress", key: "physicalAddress", attribute: "PHYSICAL_ADDRESS" },
  { fieldPath: "facilityInfo.facilityCity", key: "city", attribute: "PHYSICAL_CITY" },
  { fieldPath: "facilityInfo.facilityZip", key: "zip", attribute: "PHYSICAL_ZIP" },
  { fieldPath: "facilityInfo.facilityCounty", key: "county" },
  { fieldPath: "facilityInfo.taxParcelNumber", key: "apnFormatted", attribute: "APN_DASH" },
];

/**
 * Property-use-code rules (ADOR Property Use Code Manual). The first two digits
 * of the 4-digit PUC are the major use category; `prefixes` is either an
 * explicit list or an inclusive `{ from, to }` range of two-digit prefixes.
 * Vacant (00), agricultural (4x+) and everything else propose nothing.
 */
interface PucRule {
  prefixes: string[] | { from: string; to: string };
  wastewaterSource: "residential" | "commercial";
  wsConfidence: number;
  facilityType: "single_family" | "multifamily" | "commercial";
  ftConfidence: number;
  label: string;
}

const PUC_RULES: PucRule[] = [
  {
    prefixes: ["01"],
    wastewaterSource: "residential",
    wsConfidence: 0.95,
    facilityType: "single_family",
    ftConfidence: 0.95,
    label: "single family residence",
  },
  {
    prefixes: ["03"],
    wastewaterSource: "residential",
    wsConfidence: 0.9,
    facilityType: "multifamily",
    ftConfidence: 0.9,
    label: "multiple residential",
  },
  {
    prefixes: ["07"],
    wastewaterSource: "residential",
    wsConfidence: 0.9,
    facilityType: "multifamily",
    ftConfidence: 0.7,
    label: "condominium / townhouse",
  },
  {
    prefixes: ["08"],
    wastewaterSource: "residential",
    wsConfidence: 0.9,
    facilityType: "single_family",
    ftConfidence: 0.85,
    label: "manufactured home",
  },
  {
    prefixes: { from: "10", to: "39" },
    wastewaterSource: "commercial",
    wsConfidence: 0.9,
    facilityType: "commercial",
    ftConfidence: 0.9,
    label: "commercial / industrial",
  },
];

/** Two-digit zero-padded prefixes order correctly as strings, so a range is a lexical check */
function matchesPrefix({ prefixes }: PucRule, prefix: string): boolean {
  return Array.isArray(prefixes)
    ? prefixes.includes(prefix)
    : prefix >= prefixes.from && prefix <= prefixes.to;
}

/**
 * Wastewater Source + Facility Type from the assessor's property use code. Only
 * the first two characters (major category) are read; a missing, blank or short
 * code proposes nothing.
 */
export function propertyUseProposals(code: string | undefined, apn: string): ProposedField[] {
  const puc = (code ?? "").trim();
  if (!/^\d{4}$/.test(puc)) return [];
  const prefix = puc.slice(0, 2);
  const rule = PUC_RULES.find((r) => matchesPrefix(r, prefix));
  if (!rule) return [];

  const provenance = {
    source: "assessor" as const,
    explanation: `Maricopa County Assessor · property use code ${puc} (${rule.label})`,
    evidence: `PUC: ${puc}`,
    sourceUrl: assessorParcelUrl(apn),
  };
  return [
    {
      fieldPath: "facilityInfo.wastewaterSource",
      value: rule.wastewaterSource,
      kind: "fill",
      provenance: { ...provenance, confidence: rule.wsConfidence },
    },
    {
      fieldPath: "facilityInfo.facilityType",
      value: rule.facilityType,
      kind: "fill",
      provenance: { ...provenance, confidence: rule.ftConfidence },
    },
  ];
}

/**
 * The same seven fields /api/apn-lookup writes, as confidence-1.0 proposals so
 * the APN lookup input, the assessor stage and (phase 5) webhook drafts all
 * attach identical provenance — plus Wastewater Source / Facility Type from the
 * property use code when the parcel carries a usable one.
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
        evidence: attribute ? `${attribute}: ${value}` : undefined,
        sourceUrl,
      },
    });
  }
  proposals.push(...propertyUseProposals(summary.propertyUseCode, apn));
  return proposals;
}
