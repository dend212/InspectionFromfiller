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
 * Property-use-code rules (ADOR Property Use Code Manual; audit batch 0 §2.1). Each rule
 * matches the leading digits of the 4-digit PUC — two digits for a whole major category
 * (`03`, `07`, `10`–`39`), three where the category splits (`010`–`017` graded single-family
 * vs `018` second residence vs `019` misc improvements; `081`–`083` MH lots vs `084`–`089`
 * MH/RV parks; `87[1345]` vs `87[27]`). `prefixes` is an explicit list or an inclusive
 * lexical range of equal-length prefixes. A rule may propose neither field and only carry a
 * `note` for the assessor tile (vacant `00`, `019x`). Agricultural (`4x`–`7x`), Maricopa's
 * `85xx`, `88`/`89`/`9x` and anything unlisted propose nothing.
 */
interface PucProposal<V extends string> {
  value: V;
  confidence: number;
}

interface PucRule {
  prefixes: string[] | { from: string; to: string };
  wastewaterSource?: PucProposal<"residential" | "commercial">;
  facilityType?: PucProposal<"single_family" | "multifamily" | "commercial">;
  /** Category label in the proposal explanation */
  label: string;
  /** Appended to the assessor stage summary — the code needs a closer look */
  note?: string;
}

const PUC_RULES: PucRule[] = [
  {
    prefixes: { from: "010", to: "017" },
    wastewaterSource: { value: "residential", confidence: 0.95 },
    facilityType: { value: "single_family", confidence: 0.95 },
    label: "single family residence",
  },
  {
    prefixes: ["018"],
    wastewaterSource: { value: "residential", confidence: 0.95 },
    facilityType: { value: "single_family", confidence: 0.7 },
    label: "single family residence",
    note: "PUC 018x — second residence on parcel; check for a second or shared system",
  },
  {
    prefixes: ["019"],
    label: "single family residence",
    note: "PUC 019x — no dwelling coded on this parcel; confirm the structure served",
  },
  {
    prefixes: ["03"],
    wastewaterSource: { value: "residential", confidence: 0.9 },
    // The form's "Multi-family/Shared" means the *system* is shared; a duplex often has one per unit
    facilityType: { value: "multifamily", confidence: 0.7 },
    label: "multiple residential",
  },
  {
    prefixes: ["04", "05", "06"],
    wastewaterSource: { value: "commercial", confidence: 0.9 },
    facilityType: { value: "commercial", confidence: 0.9 },
    label: "hotel / motel / resort",
  },
  {
    prefixes: ["07"],
    wastewaterSource: { value: "residential", confidence: 0.9 },
    facilityType: { value: "multifamily", confidence: 0.7 },
    label: "condominium / townhouse",
    note: "PUC 07xx — condo/townhouse; confirm the system is not shared",
  },
  {
    prefixes: { from: "081", to: "083" },
    wastewaterSource: { value: "residential", confidence: 0.9 },
    facilityType: { value: "single_family", confidence: 0.85 },
    label: "manufactured home",
  },
  {
    prefixes: { from: "084", to: "089" },
    wastewaterSource: { value: "residential", confidence: 0.7 },
    label: "manufactured home",
    note: "PUC 08xx — MH/RV park: shared or large-flow system likely (250 gpd per space); confirm facility type and number of systems",
  },
  {
    prefixes: ["871", "873", "874", "875"],
    wastewaterSource: { value: "residential", confidence: 0.95 },
    facilityType: { value: "single_family", confidence: 0.9 },
    label: "residential, over 5 acres",
  },
  {
    prefixes: ["872", "877"],
    wastewaterSource: { value: "residential", confidence: 0.9 },
    facilityType: { value: "single_family", confidence: 0.7 },
    label: "residential, over 5 acres",
    note: "PUC 87xx — two residences on parcel; check for a second or shared system",
  },
  {
    prefixes: { from: "10", to: "39" },
    wastewaterSource: { value: "commercial", confidence: 0.9 },
    facilityType: { value: "commercial", confidence: 0.9 },
    label: "commercial / industrial",
  },
  {
    prefixes: ["00"],
    label: "vacant",
    note: "Assessor codes this parcel vacant (PUC 00xx) — confirm the structure served",
  },
];

/** Zero-padded prefixes of one length order correctly as strings, so a range is a lexical check */
function matchesPrefix({ prefixes }: PucRule, puc: string): boolean {
  if (Array.isArray(prefixes)) return prefixes.some((prefix) => puc.startsWith(prefix));
  const head = puc.slice(0, prefixes.from.length);
  return head >= prefixes.from && head <= prefixes.to;
}

/** The rule for a trimmed 4-digit code; null for a missing, blank, short or unlisted code */
function pucRule(code: string | undefined): { puc: string; rule: PucRule } | null {
  const puc = (code ?? "").trim();
  if (!/^\d{4}$/.test(puc)) return null;
  const rule = PUC_RULES.find((r) => matchesPrefix(r, puc));
  return rule ? { puc, rule } : null;
}

/**
 * One line for the assessor tile when the property use code needs a closer look
 * (second residence, no dwelling, condo, MH/RV park, vacant); null otherwise.
 */
export function propertyUseNote(code: string | undefined): string | null {
  return pucRule(code)?.rule.note ?? null;
}

/**
 * Wastewater Source + Facility Type from the assessor's property use code. A
 * missing, blank, short or unlisted code proposes nothing; a note-only code
 * (`00xx`, `019x`) proposes nothing here and speaks through `propertyUseNote`.
 */
export function propertyUseProposals(code: string | undefined, apn: string): ProposedField[] {
  const match = pucRule(code);
  if (!match) return [];
  const { puc, rule } = match;

  const provenance = {
    source: "assessor" as const,
    explanation: `Maricopa County Assessor · property use code ${puc} (${rule.label})`,
    evidence: `PUC: ${puc}`,
    sourceUrl: assessorParcelUrl(apn),
  };
  const out: ProposedField[] = [];
  if (rule.wastewaterSource) {
    out.push({
      fieldPath: "facilityInfo.wastewaterSource",
      value: rule.wastewaterSource.value,
      kind: "fill",
      provenance: { ...provenance, confidence: rule.wastewaterSource.confidence },
    });
  }
  if (rule.facilityType) {
    out.push({
      fieldPath: "facilityInfo.facilityType",
      value: rule.facilityType.value,
      kind: "fill",
      provenance: { ...provenance, confidence: rule.facilityType.confidence },
    });
  }
  return out;
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
