/**
 * Pure mapping from extracted facts to ProposedField[] (spec §7). The client
 * hook merges these into the form (merge.ts); nothing here writes anywhere.
 */
import type { Fact, PermitDocumentKind, PermitFacts } from "@/lib/ai/permit-extraction-schema";
import { GP402_SYSTEM_TYPES, WATER_SOURCES } from "@/lib/constants/inspection";
import type { ListingFacts } from "./listing/provider";
import { SEWER_KEYS, WATER_KEYS, canonicalHomeType, findFact, flattenText } from "./listing/zillow-apify";
import { DOC_KIND_LABEL, classifyDocType, isTransferRecord, permitDocRank } from "./permits/doc-types";
import type { PrefillSource, ProposalAuthority, ProposedField } from "./types";

// permitDocRank, DOC_KIND_LABEL and isTransferRecord moved to permits/doc-types (next to
// DOC_CLASS_RANK — and out of the "use client" bundle, which must not pull the listing code in);
// kept exported here for importers
export { DOC_KIND_LABEL, isTransferRecord, permitDocRank };

export interface PermitRecordRef {
  id: string;
  permitNumber: string;
  docType: string;
  inspectionId: string;
  /** The EDMS index date (Drizzle `date()` → string | null); dates a transfer / abandonment record in dedupe */
  docDate?: string | null;
}

export interface MapPermitFactsOptions {
  /** Injected in tests; defaults to `new Date()` */
  now?: Date;
}

/** Spec §7: cesspool and system type are suggestion-only — kept under PREFILL_FILL_THRESHOLD (0.75) */
export const CESSPOOL_MAX_CONFIDENCE = 0.7;
export const SYSTEM_TYPE_MAX_CONFIDENCE = 0.7;

type Provenance = ProposedField["provenance"];

type DisposalType = NonNullable<PermitFacts["disposal"]["type"]>["value"];
type Gp402Token = (typeof GP402_SYSTEM_TYPES)[number]["value"];

/** Extracted disposal type → GP 4.02 checkbox; `other` has no box of its own */
const DISPOSAL_TO_GP402: Record<Exclude<DisposalType, "other">, Gp402Token> = {
  trench: "gp402_disposal_trench",
  bed: "gp402_disposal_bed",
  chamber: "gp402_chamber",
  seepage_pit: "gp402_seepage_pit",
};

/** Caption text per GP 4.02 token; the conventional option's own label repeats the "GP 4.02" prefix */
const GP402_CAPTION: Partial<Record<Gp402Token, string>> = {
  gp402_conventional: "Conventional",
};

function gp402Label(token: Gp402Token): string {
  return GP402_CAPTION[token] ?? GP402_SYSTEM_TYPES.find((t) => t.value === token)?.label ?? token;
}

/**
 * A tank the permit lists that is not a septic tank (audit batch 0 §3b / A17): dosing,
 * pump, lift and sump tanks, and treatment units (ATU, MicroFAST, …). The prompt forces
 * `model = "dosing tank"` for dosing/pump tanks; an ATU is a separate row with a free-text
 * model. Such a tank never ticks the GP 4.02 septic-tank box and is not counted in
 * septicTank.numberOfTanks. `pump`, `lift`, `sump` and `ATU` match whole words only — a
 * "Saturn 1000" or an "Uplift" tank is a septic tank (e2e follow-up).
 */
export const NON_SEPTIC_TANK = /dosing|\bpump\b|pump tank|\blift\b|\bsump\b|aerobic|\bATU\b|microfast|treatment/i;

type ExtractedTank = PermitFacts["tanks"][number];

function isSepticTank(tank: ExtractedTank): boolean {
  return !(tank.model && NON_SEPTIC_TANK.test(tank.model.value));
}

/** The most confident capacity fact among the septic (non-excluded) tanks */
function bestSepticCapacity(facts: PermitFacts): Fact<number> | undefined {
  return facts.tanks
    .filter(isSepticTank)
    .map((t) => t.capacityGal)
    .filter((x): x is NonNullable<typeof x> => x != null)
    .sort((a, b) => b.confidence - a.confidence)[0];
}

/** A disposal fact with a GP 4.02 box of its own (`other` has none) */
function hasDisposalBox(fact: Fact<DisposalType> | null): fact is Fact<Exclude<DisposalType, "other">> {
  return fact != null && fact.value !== "other";
}

interface Gp402Boxes {
  /** In `GP402_SYSTEM_TYPES` order, each with the fact behind it */
  boxes: Array<{ token: Gp402Token; fact: Fact<unknown> }>;
  /** Carries page/evidence for the proposal: the disposal fact, else the best septic tank, else systemType */
  primary: Fact<unknown>;
}

/**
 * GP 4.02 "General Treatment & Disposal Type" boxes a record's facts support: conventional
 * from the system type verdict, septic tank from a septic tank's capacity (see
 * NON_SEPTIC_TANK), and the disposal box from the disposal type. An `alternative` verdict
 * adds no box (no fact names a GP 4.03+ technology). Null when nothing supports a box.
 */
function gp402Tokens(facts: PermitFacts): Gp402Boxes | null {
  const byToken = new Map<Gp402Token, Fact<unknown>>();
  const systemType = facts.systemType?.value === "conventional" ? facts.systemType : undefined;
  if (systemType) byToken.set("gp402_conventional", systemType);
  const bestTank = bestSepticCapacity(facts);
  if (bestTank) byToken.set("gp402_septic_tank", bestTank);
  const disposal = hasDisposalBox(facts.disposal.type) ? facts.disposal.type : undefined;
  if (disposal) byToken.set(DISPOSAL_TO_GP402[disposal.value], disposal);
  const primary = disposal ?? bestTank ?? systemType;
  if (!primary) return null;
  const boxes = GP402_SYSTEM_TYPES.flatMap(({ value }) => {
    const fact = byToken.get(value);
    return fact ? [{ token: value, fact }] : [];
  });
  return { boxes, primary };
}

/** An abandonment by the model's verdict, or by the EDMS index when the model could not tell */
function isAbandonmentRecord(kind: PermitDocumentKind, docType: string): boolean {
  return kind === "abandonment" || (kind === "other" && classifyDocType(docType) === "abandonment");
}

function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return null;
  const d = new Date(`${value.trim()}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The date that orders a record against others of its class in dedupeProposals (newer wins).
 * Transfer and abandonment records are dated by the EDMS index (`docDate`, trimmed to yyyy-mm-dd —
 * a raw pg dump carries "2015-09-11T00:00:00.000Z" shapes): the dates the model reads off them are
 * signature / escrow / inspection dates. Every other kind (DA, ATC, other) is dated by the issue
 * date the model read, or left undated. Deliberately NO docDate fallback for permit-class
 * documents: in the legacy env archive docDate is the scan / filing date (the 1975 ATC 740805
 * carries docDate 2015-09-11), so it would order a permit with an unread issue date as "newer".
 */
export function permitDocDate(facts: PermitFacts, record: PermitRecordRef, transfer: boolean): string | undefined {
  if (transfer || isAbandonmentRecord(facts.documentKind, record.docType)) {
    const raw = record.docDate ?? "";
    return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : undefined;
  }
  if (!facts.issueDate || !parseIsoDate(facts.issueDate.value)) return undefined;
  return facts.issueDate.value.trim();
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
  // A transfer record's facts are secondary: a permit-class record beats them in dedupeProposals;
  // within one class the newer document wins, so the authority also carries the record's date
  const transfer = isTransferRecord(facts.documentKind, record.docType);
  const docDate = permitDocDate(facts, record, transfer);
  const authority: ProposalAuthority = {
    docRank: permitDocRank(facts.documentKind, record.docType),
    ...(docDate ? { docDate } : {}),
  };
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

  // §7 rows + amendment A1/A4: every extracted septic tank → septicTank.tanks.<i>.* (react-hook-form
  // dotted form). The form's tanks[] holds septic tanks only, so the slots are indexed over the
  // septic tanks (NON_SEPTIC_TANK rows get none) and line up with numberOfTanks below — otherwise
  // an ATU at tanks.0 would survive the step's `tanks.slice(0, numberOfTanks)` and the septic tank
  // behind it would be the one deleted.
  const septicTanks = facts.tanks.filter(isSepticTank);
  septicTanks.forEach((tank, i) => {
    const base = `septicTank.tanks.${i}`;
    if (tank.capacityGal) {
      fill(`${base}.tankCapacity`, String(Math.round(tank.capacityGal.value)), prov(tank.capacityGal));
      fill(`${base}.capacityBasis`, "permit_document", prov(tank.capacityGal));
    }
    if (tank.material) fill(`${base}.tankMaterial`, tank.material.value, prov(tank.material));
    if (tank.dimensions) fill(`${base}.tankDimensions`, tank.dimensions.value, prov(tank.dimensions));
  });
  // numberOfTanks counts septic tanks only; a listed dosing/pump/treatment tank means the
  // count is an inference about which rows are septic tanks, so it is held to a chip (0.7)
  if (septicTanks.length > 0) {
    const best = septicTanks
      .flatMap((t) => [t.capacityGal, t.material, t.model, t.dimensions])
      .filter((x): x is NonNullable<typeof x> => x != null)
      .sort((a, b) => b.confidence - a.confidence)[0];
    if (best) {
      const n = septicTanks.length;
      const excludedTank = septicTanks.length < facts.tanks.length;
      fill(
        "septicTank.numberOfTanks",
        String(n),
        prov(best, {
          confidence: excludedTank ? Math.min(best.confidence, SYSTEM_TYPE_MAX_CONFIDENCE) : best.confidence,
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
  // Provenance (page / evidence) comes from the disposal fact, else the best septic tank, else systemType.
  const gp402 = gp402Tokens(facts);
  if (gp402) {
    const { boxes, primary } = gp402;
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
  // Both toggles decide which report pages exist, so — like facilitySystemTypes — they are
  // chips, never fills (SYSTEM_TYPE_MAX_CONFIDENCE; audit batch 0 §3, decision 2)
  if (facts.systemType?.value === "alternative") {
    const toggle = prov(facts.systemType, {
      confidence: Math.min(facts.systemType.confidence, SYSTEM_TYPE_MAX_CONFIDENCE),
    });
    fill("generalTreatment.alternativeSystem", true, toggle);
    fill("includeAlternativePages", true, toggle);
  }

  // §7 row: isAbandonment → tile banner only, no proposal
  return out;
}

const SOURCE_RANK: Record<PrefillSource, number> = { permit: 3, assessor: 2, listing: 1, scan: 0 };

/**
 * Per-field overrides of SOURCE_RANK (audit batch 0 §2.2). A permit describes the parcel as
 * it was when the system was built; the assessor's property use code is the current
 * classification and the listing's home type is fresher than any permit — so for these two
 * paths only: assessor > listing > permit. Every other path keeps the default order.
 */
const FIELD_SOURCE_RANK: Partial<Record<string, Record<PrefillSource, number>>> = {
  "facilityInfo.wastewaterSource": { assessor: 3, listing: 2, permit: 1, scan: 0 },
  "facilityInfo.facilityType": { assessor: 3, listing: 2, permit: 1, scan: 0 },
};

function sourceRankOf(p: ProposedField): number {
  return (FIELD_SOURCE_RANK[p.fieldPath] ?? SOURCE_RANK)[p.provenance.source];
}

/**
 * No authority = the phase-2 EDMS index row. Its default is rank 0 — the DA class — on purpose:
 * it must not lose to an ATC / NOT mapper proposal, and it ties a DA's, where the date never breaks
 * the tie (see beats) and first-seen keeps it.
 */
function docRankOf(p: ProposedField): number {
  return p.authority?.docRank ?? 0;
}

/**
 * Newer document first within a class, only between two proposals that BOTH carry authority (the
 * index row has none and must keep winning its first-seen tie). Dated beats undated; both undated
 * falls through (0). ISO yyyy-mm-dd strings compare lexically.
 */
function docDateDiff(p: ProposedField, cur: ProposedField): number {
  if (!p.authority || !cur.authority) return 0;
  const a = p.authority.docDate;
  const b = cur.authority.docDate;
  if (a === b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  return a > b ? 1 : -1;
}

/** True when `p` should replace `cur` for the same `kind:fieldPath` */
function beats(p: ProposedField, cur: ProposedField): boolean {
  const rankDiff = sourceRankOf(p) - sourceRankOf(cur);
  if (rankDiff !== 0) return rankDiff > 0;
  const docDiff = docRankOf(p) - docRankOf(cur);
  if (docDiff !== 0) return docDiff < 0;
  const dateDiff = docDateDiff(p, cur);
  if (dateDiff !== 0) return dateDiff > 0;
  return p.provenance.confidence > cur.provenance.confidence;
}

/**
 * Combine stage proposals per `kind:fieldPath`, in this order:
 *   1. higher SOURCE_RANK (permit > assessor > listing > scan, except the FIELD_SOURCE_RANK paths);
 *   2. within a source, the more authoritative document class (lower `authority.docRank`:
 *      Discharge Authorization → Approval to Construct → … → Notice of Transfer → abandonment;
 *      no authority = rank 0, i.e. the EDMS index row);
 *   3. within a class, the newer document (`authority.docDate`, dated beats undated) — only when
 *      both proposals carry authority, so the index row is never displaced by date;
 *   4. strictly higher confidence;
 *   5. first-seen.
 * Warnings never collide with fills. Output keeps first-seen order.
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
 * `dedupeProposals` (FIELD_SOURCE_RANK: assessor > listing) whenever both fire.
 * Keyed by the canonical token (`canonicalHomeType`); `LOT`, `HOME_TYPE_UNKNOWN`
 * and anything unmapped propose nothing.
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
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Parcel guard (audit batch 0 §2 tier 2): a listing found by address can be the wrong
 * house. When the listing carries a parcel number and the run has an APN, they must agree
 * once dashes/spaces/case are stripped — the letter suffix stays significant, so
 * `211-74-047P` is `21174047P` but `21174047` is not. Every listing proposal is then held
 * under the fill gate and says why.
 */
export const LISTING_PARCEL_MISMATCH_CONFIDENCE = 0.6;

function normaliseParcel(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** True when both sides are present and name different parcels */
export function listingParcelMismatch(parcelId: string | undefined, apn: string | undefined): boolean {
  const a = parcelId ? normaliseParcel(parcelId) : "";
  const b = apn ? normaliseParcel(apn) : "";
  return Boolean(a && b && a !== b);
}

/** The one-line tile note for a mismatch — the listing stage and the orchestrator write the same text */
export function listingParcelMismatchSummary(parcelId: string, apn: string): string {
  return `Listing parcel ${parcelId} does not match APN ${apn}`;
}

/**
 * Holds every `listing` proposal under the fill gate and says why. Used by `mapListingFacts`
 * on the typed-APN path and again by the orchestrator once the assessor has resolved the
 * parcel of an address-only run (e2e D2) — the text is identical either way. Proposals from
 * other sources pass through untouched.
 */
export function capListingProposals(proposals: ProposedField[], parcelId: string, apn: string): ProposedField[] {
  const note = ` · listing parcel ${parcelId} ≠ APN ${apn} — confirm this is the right property`;
  return proposals.map((p) =>
    p.provenance.source === "listing"
      ? {
          ...p,
          provenance: {
            ...p.provenance,
            confidence: Math.min(p.provenance.confidence, LISTING_PARCEL_MISMATCH_CONFIDENCE),
            explanation: `${p.provenance.explanation}${note}`,
          },
        }
      : p,
  );
}

export interface MapListingFactsOptions {
  /** The run's APN, when it has one — compared against `facts.parcelId` */
  apn?: string;
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

export function mapListingFacts(facts: ListingFacts, opts: MapListingFactsOptions = {}): ProposedField[] {
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
    const canonical = canonicalHomeType(facts.homeType);
    const rule = HOME_TYPE_RULES[canonical];
    if (rule) {
      const provenance = {
        source: "listing" as const,
        explanation: `Zillow lists the home as ${humaniseHomeType(canonical)}`,
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

  if (facts.parcelId && opts.apn && listingParcelMismatch(facts.parcelId, opts.apn)) {
    return capListingProposals(out, facts.parcelId, opts.apn);
  }
  return out;
}
