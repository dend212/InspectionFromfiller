/**
 * Pure mapping from extracted facts to ProposedField[] (spec §7). The client
 * hook merges these into the form (merge.ts); nothing here writes anywhere.
 */
import type { Fact, PermitDocumentKind, PermitFacts } from "@/lib/ai/permit-extraction-schema";
import { GP402_SYSTEM_TYPES, WATER_SOURCES } from "@/lib/constants/inspection";
import type { ListingFacts } from "./listing/provider";
import { SEWER_KEYS, WATER_KEYS, findFact, flattenText } from "./listing/zillow-apify";
import { DOC_CLASS_RANK, classifyDocType } from "./permits/doc-types";
import type { PrefillSource, ProposalAuthority, ProposedField } from "./types";

export interface PermitRecordRef {
  id: string;
  permitNumber: string;
  docType: string;
  inspectionId: string;
}

export interface MapPermitFactsOptions {
  /** Injected in tests; defaults to `new Date()` */
  now?: Date;
}

/** Spec §7: cesspool and system type are suggestion-only — kept under PREFILL_FILL_THRESHOLD (0.75) */
export const CESSPOOL_MAX_CONFIDENCE = 0.7;
export const SYSTEM_TYPE_MAX_CONFIDENCE = 0.7;

const DOC_KIND_LABEL: Record<Exclude<PermitDocumentKind, "other">, string> = {
  approval_to_construct: "Approval to Construct",
  discharge_authorization: "Discharge Authorization",
  final_da: "Final Discharge Authorization",
  notice_of_transfer: "Notice of Transfer",
  abandonment: "Abandonment",
};

type Provenance = ProposedField["provenance"];

type DisposalType = NonNullable<PermitFacts["disposal"]["type"]>["value"];

/** Extracted disposal type → GP 4.02 checkbox; `other` has no box of its own */
const DISPOSAL_TO_GP402: Record<Exclude<DisposalType, "other">, string> = {
  trench: "gp402_disposal_trench",
  bed: "gp402_disposal_bed",
  chamber: "gp402_chamber",
  seepage_pit: "gp402_seepage_pit",
};

/** Caption text per GP 4.02 token; the conventional option's own label repeats the "GP 4.02" prefix */
const GP402_CAPTION: Record<string, string> = {
  gp402_conventional: "Conventional",
};

function gp402Label(token: string): string {
  return GP402_CAPTION[token] ?? GP402_SYSTEM_TYPES.find((t) => t.value === token)?.label ?? token;
}

/**
 * GP 4.02 "General Treatment & Disposal Type" boxes a record's facts support, in
 * `GP402_SYSTEM_TYPES` order with the fact behind each: conventional from the system
 * type verdict, septic tank from any tank capacity, and the disposal box from the
 * disposal type. An `alternative` verdict adds no box (no fact names a GP 4.03+ technology).
 */
function gp402Tokens(facts: PermitFacts): Array<{ token: string; fact: Fact<unknown> }> {
  const byToken = new Map<string, Fact<unknown>>();
  if (facts.systemType?.value === "conventional") byToken.set("gp402_conventional", facts.systemType);
  const capacity = facts.tanks
    .map((t) => t.capacityGal)
    .filter((x): x is NonNullable<typeof x> => x != null)
    .sort((a, b) => b.confidence - a.confidence)[0];
  if (capacity) byToken.set("gp402_septic_tank", capacity);
  const disposal = facts.disposal.type;
  if (disposal && disposal.value !== "other") byToken.set(DISPOSAL_TO_GP402[disposal.value], disposal);
  return GP402_SYSTEM_TYPES.flatMap(({ value }) => {
    const fact = byToken.get(value);
    return fact ? [{ token: value, fact }] : [];
  });
}

const AUTHORITATIVE_KINDS: ReadonlySet<PermitDocumentKind> = new Set([
  "approval_to_construct",
  "discharge_authorization",
  "final_da",
]);

/** A Notice of Transfer by the model's verdict, or by the EDMS index when the model could not tell */
export function isTransferRecord(kind: PermitDocumentKind, docType: string): boolean {
  return kind === "notice_of_transfer" || (kind === "other" && classifyDocType(docType) === "notice_of_transfer");
}

/** Authority of a record's facts: what the model read outranks the EDMS index; lower wins */
export function permitDocRank(kind: PermitDocumentKind, docType: string): number {
  if (AUTHORITATIVE_KINDS.has(kind)) return DOC_CLASS_RANK.permit;
  if (kind === "notice_of_transfer") return DOC_CLASS_RANK.notice_of_transfer;
  if (kind === "abandonment") return DOC_CLASS_RANK.abandonment;
  return DOC_CLASS_RANK[classifyDocType(docType)];
}

function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return null;
  const d = new Date(`${value.trim()}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Whole years from `from` to `now` (UTC), never negative */
function wholeYearsBetween(from: Date, now: Date): number {
  let years = now.getUTCFullYear() - from.getUTCFullYear();
  const beforeAnniversary =
    now.getUTCMonth() < from.getUTCMonth() ||
    (now.getUTCMonth() === from.getUTCMonth() && now.getUTCDate() < from.getUTCDate());
  if (beforeAnniversary) years -= 1;
  return Math.max(0, years);
}

export function mapPermitFacts(
  facts: PermitFacts,
  record: PermitRecordRef,
  opts: MapPermitFactsOptions = {},
): ProposedField[] {
  const out: ProposedField[] = [];
  const label = facts.documentKind === "other" ? record.docType : DOC_KIND_LABEL[facts.documentKind];
  const permitNo = facts.permitNumber?.value.trim() || record.permitNumber;
  const url = (page: number) => `/api/inspections/${record.inspectionId}/records/${record.id}#page=${page}`;
  // A transfer record's facts are secondary: a permit-class record beats them in dedupeProposals
  const transfer = isTransferRecord(facts.documentKind, record.docType);
  const authority: ProposalAuthority = { docRank: permitDocRank(facts.documentKind, record.docType) };
  // Caption prefix/suffix shared by prov() and the explanation overrides below — a NOT is never "Permit N"
  const docLabel = transfer ? `Notice of Transfer ${record.permitNumber}` : `Permit ${permitNo}`;
  const secondary = transfer ? " (transfer record — secondary source)" : "";

  const prov = (fact: Fact<unknown>, extra: Partial<Provenance> = {}): Provenance => ({
    source: "permit",
    confidence: fact.confidence,
    explanation: transfer
      ? `Notice of Transfer ${record.permitNumber} · p.${fact.page} (transfer record — secondary source)`
      : `Permit ${permitNo} · ${label} p.${fact.page}`,
    evidence: fact.evidence || undefined,
    sourceUrl: url(fact.page),
    recordId: record.id,
    page: fact.page,
    ...extra,
  });
  // every proposal goes through here so all of them carry `authority`
  const fill = (fieldPath: string, value: ProposedField["value"], provenance: Provenance) =>
    out.push({ fieldPath, value, kind: "fill", provenance, authority });

  // §7 row: any selected permit found → recordsAvailable "yes" (conf 1.0)
  fill("facilityInfo.recordsAvailable", "yes", {
    source: "permit",
    confidence: 1,
    explanation: transfer
      ? `Notice of Transfer ${record.permitNumber} on file`
      : `Permit ${permitNo} on file (${label})`,
    sourceUrl: url(1),
    recordId: record.id,
    page: 1,
  });

  // §7 rows: permit # by document kind (the EDMS index is typed metadata → 0.9 when the model found none)
  const permitFact: Fact<string> = facts.permitNumber ?? {
    value: record.permitNumber,
    confidence: 0.9,
    page: 1,
    evidence: `EDMS index: ${record.permitNumber}`,
    handwritten: false,
  };
  if (facts.documentKind === "approval_to_construct") {
    fill("facilityInfo.hasApprovalOfConstruction", true, prov(permitFact));
    fill("facilityInfo.approvalPermitNo", permitNo, prov(permitFact));
  } else if (facts.documentKind === "discharge_authorization" || facts.documentKind === "final_da") {
    fill("facilityInfo.hasDischargeAuth", true, prov(permitFact));
    fill("facilityInfo.dischargeAuthPermitNo", permitNo, prov(permitFact));
  }

  // §7 row: site plan page detected (model verdict, else the notes mention one)
  if (facts.hasSitePlan?.value === true) {
    fill("facilityInfo.hasSitePlan", true, prov(facts.hasSitePlan));
  } else if (facts.hasSitePlan == null && /site plan|as-built|plot plan/i.test(facts.notes)) {
    fill("facilityInfo.hasSitePlan", true, {
      source: "permit",
      confidence: 0.6,
      explanation: `${docLabel} · notes mention a site plan${secondary}`,
      evidence: facts.notes.slice(0, 300),
      sourceUrl: url(1),
      recordId: record.id,
      page: 1,
    });
  }

  // §7 row: issueDate → facilityAge (years) + explanation "Approval to construct issued MM/YYYY (permit N)".
  // Never from a transfer record: its dates are the transfer's, not the system's install date.
  if (facts.issueDate && !transfer) {
    const issued = parseIsoDate(facts.issueDate.value);
    if (issued) {
      const years = wholeYearsBetween(issued, opts.now ?? new Date());
      const mmYYYY = `${String(issued.getUTCMonth() + 1).padStart(2, "0")}/${issued.getUTCFullYear()}`;
      const verb =
        facts.documentKind === "approval_to_construct"
          ? "Approval to construct issued"
          : facts.documentKind === "discharge_authorization" || facts.documentKind === "final_da"
            ? "Discharge authorization issued"
            : "Permit issued";
      const explanation = `${verb} ${mmYYYY} (permit ${permitNo})`;
      fill("facilityInfo.facilityAge", String(years), prov(facts.issueDate, { explanation }));
      fill("facilityInfo.facilityAgeEstimateExplanation", explanation, prov(facts.issueDate, { explanation }));
    }
  }

  // §7 rows + amendment A1/A4: every extracted tank → septicTank.tanks.<i>.* (react-hook-form dotted form)
  facts.tanks.forEach((tank, i) => {
    const base = `septicTank.tanks.${i}`;
    if (tank.capacityGal) {
      fill(`${base}.tankCapacity`, String(Math.round(tank.capacityGal.value)), prov(tank.capacityGal));
      fill(`${base}.capacityBasis`, "permit_document", prov(tank.capacityGal));
    }
    if (tank.material) fill(`${base}.tankMaterial`, tank.material.value, prov(tank.material));
    if (tank.dimensions) fill(`${base}.tankDimensions`, tank.dimensions.value, prov(tank.dimensions));
  });
  if (facts.tanks.length > 0) {
    const best = facts.tanks
      .flatMap((t) => [t.capacityGal, t.material, t.model, t.dimensions])
      .filter((x): x is NonNullable<typeof x> => x != null)
      .sort((a, b) => b.confidence - a.confidence)[0];
    if (best) {
      const n = facts.tanks.length;
      fill(
        "septicTank.numberOfTanks",
        String(n),
        prov(best, {
          explanation: `${docLabel} · ${transfer ? "" : `${label} `}lists ${n} tank${n === 1 ? "" : "s"} (p.${best.page})${secondary}`,
        }),
      );
    }
  }

  // §7 row: disposal.type — count and dimensions go into the explanation, not a field
  if (facts.disposal.type) {
    const detail = [
      facts.disposal.count ? `× ${facts.disposal.count.value}` : "",
      facts.disposal.dimensions ? facts.disposal.dimensions.value : "",
    ].filter(Boolean);
    const explanation = `${docLabel} · ${transfer ? "" : `${label} `}p.${facts.disposal.type.page}${detail.length ? ` · ${detail.join(" · ")}` : ""}${secondary}`;
    fill("disposalWorks.disposalType", facts.disposal.type.value, prov(facts.disposal.type, { explanation }));
  }

  // §7 row: bedrooms (permit wins over listing — enforced in dedupeProposals)
  if (facts.bedrooms) {
    fill("designFlow.numberOfBedrooms", String(facts.bedrooms.value), prov(facts.bedrooms));
  }

  // §7 row: design flow + basis
  if (facts.designFlowGpd) {
    fill("designFlow.estimatedDesignFlow", String(Math.round(facts.designFlowGpd.value)), prov(facts.designFlowGpd));
    fill("designFlow.designFlowBasis", "permit_documents", prov(facts.designFlowGpd));
  }

  // §7 row: water source (permit wins over listing — dedupeProposals)
  if (facts.waterSource) {
    fill("facilityInfo.waterSource", facts.waterSource.value, prov(facts.waterSource));
  }

  // §7 row: isCesspool true → ALWAYS a suggestion (form enum is "yes"/"no"); it voids the report pages
  if (facts.isCesspool?.value === true) {
    fill(
      "facilityInfo.isCesspool",
      "yes",
      prov(facts.isCesspool, {
        confidence: Math.min(facts.isCesspool.confidence, CESSPOOL_MAX_CONFIDENCE),
      }),
    );
  }

  // §7 row: systemType → suggestion only
  if (facts.systemType) {
    fill(
      "facilityInfo.facilitySystemTypes",
      [facts.systemType.value],
      prov(facts.systemType, {
        confidence: Math.min(facts.systemType.confidence, SYSTEM_TYPE_MAX_CONFIDENCE),
      }),
    );
  }

  // GP 4.02 "General Treatment & Disposal Type" boxes: the DA's "General Permits Authorized"
  // table is a read fact, so no 0.7 cap — confidence is the least sure contributing fact.
  // Provenance (page / evidence) comes from the disposal fact, else the best tank, else systemType —
  // i.e. the last box, since the tokens come out in GP402_SYSTEM_TYPES order.
  const boxes = gp402Tokens(facts);
  if (boxes.length > 0) {
    const primary = boxes[boxes.length - 1].fact;
    const labels = boxes.map((b) => gp402Label(b.token)).join(", ");
    fill(
      "generalTreatment.systemTypes",
      boxes.map((b) => b.token),
      prov(primary, {
        confidence: Math.min(...boxes.map((b) => b.fact.confidence)),
        explanation: `${docLabel} · GP 4.02 ${labels} p.${primary.page}${secondary}`,
      }),
    );
  }
  if (facts.systemType?.value === "alternative") {
    fill("generalTreatment.alternativeSystem", true, prov(facts.systemType));
  }

  // §7 row: isAbandonment → tile banner only, no proposal
  return out;
}

const SOURCE_RANK: Record<PrefillSource, number> = { permit: 3, assessor: 2, listing: 1, scan: 0 };

function docRankOf(p: ProposedField): number {
  return p.authority?.docRank ?? 0;
}

/** True when `p` should replace `cur` for the same `kind:fieldPath` */
function beats(p: ProposedField, cur: ProposedField): boolean {
  const rankDiff = SOURCE_RANK[p.provenance.source] - SOURCE_RANK[cur.provenance.source];
  if (rankDiff !== 0) return rankDiff > 0;
  const docDiff = docRankOf(p) - docRankOf(cur);
  if (docDiff !== 0) return docDiff < 0;
  return p.provenance.confidence > cur.provenance.confidence;
}

/**
 * Combine stage proposals per `kind:fieldPath`: higher SOURCE_RANK wins (permit > assessor >
 * listing > scan); within a source the more authoritative document wins (lower
 * `authority.docRank`; no authority = rank 0, i.e. the EDMS index row); then strictly higher
 * confidence; then first-seen. Warnings never collide with fills. Output keeps first-seen order.
 */
export function dedupeProposals(proposals: ProposedField[]): ProposedField[] {
  const best = new Map<string, ProposedField>();
  for (const p of proposals) {
    const key = `${p.kind}:${p.fieldPath}`;
    const cur = best.get(key);
    if (!cur || beats(p, cur)) best.set(key, p);
  }
  return [...best.values()];
}

// ---------------------------------------------------------------------------
// Listing (Zillow) — spec §5.3 / §7
// ---------------------------------------------------------------------------

/** Listing data can be stale, so listing fills sit just above the 0.75 gate. */
export const LISTING_WATER_CONFIDENCE = 0.8;
export const LISTING_BEDROOMS_CONFIDENCE = 0.85;
export const LISTING_SEWER_WARNING = 'Listing says "Sewer" — confirm this property is on septic';

/**
 * Zillow homeType → Wastewater Source + Facility Type (fallback for a parcel the
 * assessor stage hasn't covered): assessor's property use code outranks this in
 * `dedupeProposals` (SOURCE_RANK: assessor 2 > listing 1) whenever both fire.
 * Compared upper-cased; `LOT`, `HOME_TYPE_UNKNOWN` and anything unmapped propose
 * nothing.
 */
interface HomeTypeRule {
  wastewaterSource: "residential";
  wsConfidence: number;
  facilityType: "single_family" | "multifamily";
  ftConfidence: number;
}

const HOME_TYPE_RULES: Record<string, HomeTypeRule> = {
  SINGLE_FAMILY: { wastewaterSource: "residential", wsConfidence: 0.85, facilityType: "single_family", ftConfidence: 0.85 },
  MANUFACTURED: { wastewaterSource: "residential", wsConfidence: 0.85, facilityType: "single_family", ftConfidence: 0.85 },
  TOWNHOUSE: { wastewaterSource: "residential", wsConfidence: 0.85, facilityType: "single_family", ftConfidence: 0.8 },
  CONDO: { wastewaterSource: "residential", wsConfidence: 0.85, facilityType: "multifamily", ftConfidence: 0.8 },
  APARTMENT: { wastewaterSource: "residential", wsConfidence: 0.85, facilityType: "multifamily", ftConfidence: 0.8 },
  MULTI_FAMILY: { wastewaterSource: "residential", wsConfidence: 0.85, facilityType: "multifamily", ftConfidence: 0.8 },
};

/** Title-cases a `_`-separated enum token: "SINGLE_FAMILY" → "Single Family". */
function humaniseHomeType(token: string): string {
  return token
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(" ");
}

/** Original (un-normalised) text of a listing fact, for the popover evidence line. */
function listingEvidence(raw: Record<string, unknown>, keys: string[]): string | undefined {
  const value = findFact(raw, keys);
  if (value === undefined) return undefined;
  if (typeof value === "string") return value.trim() || undefined;
  if (Array.isArray(value)) {
    const parts = value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
    return parts.length ? parts.join(", ") : undefined;
  }
  const text = flattenText(value);
  return text ? text : undefined;
}

export function mapListingFacts(facts: ListingFacts): ProposedField[] {
  const out: ProposedField[] = [];
  const sourceUrl = facts.url ? { sourceUrl: facts.url } : {};

  if (facts.waterSource) {
    const label = WATER_SOURCES.find((w) => w.value === facts.waterSource)?.label ?? facts.waterSource;
    const rawText = listingEvidence(facts.raw, WATER_KEYS);
    out.push({
      fieldPath: "facilityInfo.waterSource",
      value: facts.waterSource,
      kind: "fill",
      provenance: {
        source: "listing",
        confidence: LISTING_WATER_CONFIDENCE,
        explanation: `Zillow listing · Water source: ${rawText ?? label}`,
        ...(rawText ? { evidence: `Water: ${rawText}` } : {}),
        ...sourceUrl,
      },
    });
  }

  if (typeof facts.bedrooms === "number" && Number.isInteger(facts.bedrooms) && facts.bedrooms > 0) {
    out.push({
      fieldPath: "designFlow.numberOfBedrooms",
      value: String(facts.bedrooms),
      kind: "fill",
      provenance: {
        source: "listing",
        confidence: LISTING_BEDROOMS_CONFIDENCE,
        explanation: `Zillow listing · ${facts.bedrooms} bedrooms`,
        evidence: `Bedrooms: ${facts.bedrooms}`,
        ...sourceUrl,
      },
    });
  }

  // A listing on sewer proposes no value — it warns the inspector (amber chip).
  if (facts.sewer === "sewer") {
    const rawText = listingEvidence(facts.raw, SEWER_KEYS);
    out.push({
      fieldPath: "facilityInfo.wastewaterSource",
      value: "",
      kind: "warning",
      provenance: {
        source: "listing",
        confidence: LISTING_WATER_CONFIDENCE,
        explanation: LISTING_SEWER_WARNING,
        ...(rawText ? { evidence: `Sewer: ${rawText}` } : {}),
        ...sourceUrl,
      },
    });
  }

  if (facts.homeType) {
    const rule = HOME_TYPE_RULES[facts.homeType.toUpperCase()];
    if (rule) {
      const provenance = {
        source: "listing" as const,
        explanation: `Zillow lists the home as ${humaniseHomeType(facts.homeType.toUpperCase())}`,
        evidence: `homeType: ${facts.homeType}`,
        ...sourceUrl,
      };
      // A listing that says the home is on sewer must not also assert the onsite wastewater
      // source: the warning above owns that field (one provenance slot per path in merge).
      if (facts.sewer !== "sewer") {
        out.push({
          fieldPath: "facilityInfo.wastewaterSource",
          value: rule.wastewaterSource,
          kind: "fill",
          provenance: { ...provenance, confidence: rule.wsConfidence },
        });
      }
      out.push({
        fieldPath: "facilityInfo.facilityType",
        value: rule.facilityType,
        kind: "fill",
        provenance: { ...provenance, confidence: rule.ftConfidence },
      });
    }
  }

  return out;
}
