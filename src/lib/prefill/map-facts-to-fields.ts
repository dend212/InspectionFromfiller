/**
 * Pure mapping from extracted facts to ProposedField[] (spec §7). The client
 * hook merges these into the form (merge.ts); nothing here writes anywhere.
 */
import type { Fact, PermitDocumentKind, PermitFacts } from "@/lib/ai/permit-extraction-schema";
import type { PrefillSource, ProposedField } from "./types";

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

  const prov = (fact: Fact<unknown>, extra: Partial<Provenance> = {}): Provenance => ({
    source: "permit",
    confidence: fact.confidence,
    explanation: `Permit ${permitNo} · ${label} p.${fact.page}`,
    evidence: fact.evidence || undefined,
    sourceUrl: url(fact.page),
    recordId: record.id,
    page: fact.page,
    ...extra,
  });
  const fill = (fieldPath: string, value: ProposedField["value"], provenance: Provenance) =>
    out.push({ fieldPath, value, kind: "fill", provenance });

  // §7 row: any selected permit found → recordsAvailable "yes" (conf 1.0)
  fill("facilityInfo.recordsAvailable", "yes", {
    source: "permit",
    confidence: 1,
    explanation: `Permit ${permitNo} on file (${label})`,
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
      explanation: `Permit ${permitNo} · notes mention a site plan`,
      evidence: facts.notes.slice(0, 300),
      sourceUrl: url(1),
      recordId: record.id,
      page: 1,
    });
  }

  // §7 row: issueDate → facilityAge (years) + explanation "Approval to construct issued MM/YYYY (permit N)"
  if (facts.issueDate) {
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
          explanation: `Permit ${permitNo} · ${label} lists ${n} tank${n === 1 ? "" : "s"} (p.${best.page})`,
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
    const explanation = `Permit ${permitNo} · ${label} p.${facts.disposal.type.page}${detail.length ? ` · ${detail.join(" · ")}` : ""}`;
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

  // §7 row: isAbandonment → tile banner only, no proposal
  return out;
}

const SOURCE_RANK: Record<PrefillSource, number> = { permit: 3, assessor: 2, listing: 1, scan: 0 };

/**
 * Combine stage proposals: permit beats listing for the same fieldPath; higher
 * confidence wins within a source. Warnings never collide with fills.
 * Output keeps first-seen order per key.
 */
export function dedupeProposals(proposals: ProposedField[]): ProposedField[] {
  const best = new Map<string, ProposedField>();
  for (const p of proposals) {
    const key = `${p.kind}:${p.fieldPath}`;
    const cur = best.get(key);
    if (!cur) {
      best.set(key, p);
      continue;
    }
    const rankDiff = SOURCE_RANK[p.provenance.source] - SOURCE_RANK[cur.provenance.source];
    if (rankDiff > 0 || (rankDiff === 0 && p.provenance.confidence > cur.provenance.confidence)) {
      best.set(key, p);
    }
  }
  return [...best.values()];
}
