/**
 * Helpers that operate on the PermitFacts shape: a registry of every fact
 * path (used for escalation and page re-basing), a field-by-field merge of
 * two extraction passes, and coercion of a free-text escalation answer.
 */
import type { Fact, PermitFacts } from "./permit-extraction-schema";

export type FactValue = string | number | boolean;

export type FactKind =
  | { type: "string" }
  | { type: "number" }
  | { type: "integer" }
  | { type: "boolean" }
  | { type: "enum"; values: readonly string[] };

export interface FactSpec {
  /** Dotted path into PermitFacts; tanks use a numeric segment, e.g. "tanks.0.capacityGal" */
  path: string;
  /** The single question asked when this fact is escalated */
  question: string;
  kind: FactKind;
}

export const TANK_MATERIAL_VALUES = ["precast_concrete", "fiberglass", "plastic", "steel", "cast_in_place", "other"] as const;
export const DISPOSAL_TYPE_VALUES = ["trench", "bed", "chamber", "seepage_pit", "other"] as const;
export const WATER_SOURCE_VALUES = ["municipal", "private_company", "shared_well", "private_well", "hauled_water"] as const;
export const SYSTEM_TYPE_VALUES = ["conventional", "alternative"] as const;

/** Top-level (non-tank) fact specs */
export const FACT_SPECS: readonly FactSpec[] = [
  { path: "permitNumber", question: "What is the permit number printed or written on this page? Keep dashes exactly as shown.", kind: { type: "string" } },
  { path: "issueDate", question: "What is the approval / issue date on this page? Answer as an ISO date (yyyy-mm-dd).", kind: { type: "string" } },
  { path: "finalDate", question: "What is the final inspection or final discharge authorization date on this page? Answer as an ISO date (yyyy-mm-dd).", kind: { type: "string" } },
  { path: "contractor", question: "Who is the installing contractor named on this page?", kind: { type: "string" } },
  { path: "designFlowGpd", question: "What is the design flow in gallons per day on this page? Answer with digits only.", kind: { type: "number" } },
  { path: "bedrooms", question: "How many bedrooms does this page say the dwelling has? Answer with digits only.", kind: { type: "integer" } },
  { path: "disposal.type", question: "What type of disposal works does this page specify? Answer with one of: trench, bed, chamber, seepage_pit, other.", kind: { type: "enum", values: DISPOSAL_TYPE_VALUES } },
  { path: "disposal.count", question: "How many disposal units (trenches, pits or beds) does this page specify? Answer with digits only.", kind: { type: "integer" } },
  { path: "disposal.dimensions", question: "What are the disposal works dimensions exactly as written on this page?", kind: { type: "string" } },
  { path: "disposal.absorptionAreaSqft", question: "What absorption area in square feet is printed on this page? Answer with digits only.", kind: { type: "number" } },
  { path: "waterSource", question: "What is the domestic water source on this page? Answer with one of: municipal, private_company, shared_well, private_well, hauled_water.", kind: { type: "enum", values: WATER_SOURCE_VALUES } },
  { path: "isCesspool", question: "Does this page describe the system as a cesspool or cesspit? Answer true or false.", kind: { type: "boolean" } },
  { path: "hasSitePlan", question: "Is this page a site plan / plot plan / as-built drawing of the lot showing the septic system layout? Answer true or false.", kind: { type: "boolean" } },
  { path: "systemType", question: "Is the system on this page conventional or alternative? Answer with one of: conventional, alternative.", kind: { type: "enum", values: SYSTEM_TYPE_VALUES } },
];

export function tankFactSpecs(index: number): FactSpec[] {
  const p = `tanks.${index}`;
  const n = index + 1;
  return [
    { path: `${p}.capacityGal`, question: `What is the capacity in gallons of septic tank #${n} on this page? Answer with digits only.`, kind: { type: "number" } },
    { path: `${p}.material`, question: `What is septic tank #${n} made of? Answer with one of: precast_concrete, fiberglass, plastic, steel, cast_in_place, other.`, kind: { type: "enum", values: TANK_MATERIAL_VALUES } },
    { path: `${p}.model`, question: `What make or model is listed for septic tank #${n} on this page?`, kind: { type: "string" } },
    { path: `${p}.dimensions`, question: `What are the dimensions of septic tank #${n} exactly as written on this page?`, kind: { type: "string" } },
  ];
}

/** Every fact path present in `facts` (tank paths expand per tank) */
export function allFactSpecs(facts: PermitFacts): FactSpec[] {
  return [...FACT_SPECS, ...facts.tanks.flatMap((_, i) => tankFactSpecs(i))];
}

export function getFactAt(facts: PermitFacts, path: string): Fact<FactValue> | null {
  let cur: unknown = facts;
  for (const seg of path.split(".")) {
    if (cur == null || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return (cur as Fact<FactValue> | null | undefined) ?? null;
}

/** Mutates `facts`. No-op when the parent object does not exist (e.g. a tank index that is not there). */
export function setFactAt(facts: PermitFacts, path: string, fact: Fact<FactValue> | null): void {
  const segs = path.split(".");
  let cur: unknown = facts;
  for (const seg of segs.slice(0, -1)) {
    cur = (cur as Record<string, unknown>)[seg];
    if (cur == null || typeof cur !== "object") return;
  }
  (cur as Record<string, unknown>)[segs[segs.length - 1]] = fact;
}

function pickFact<T>(x: Fact<T> | null, y: Fact<T> | null): Fact<T> | null {
  if (!x) return y;
  if (!y) return x;
  return y.confidence > x.confidence ? y : x;
}

/** Field-by-field merge of two passes: the higher-confidence fact wins; tanks merge index-wise. */
export function mergePermitFacts(a: PermitFacts, b: PermitFacts): PermitFacts {
  const tankCount = Math.max(a.tanks.length, b.tanks.length);
  const tanks = Array.from({ length: tankCount }, (_, i) => {
    const ta = a.tanks[i];
    const tb = b.tanks[i];
    return {
      capacityGal: pickFact(ta?.capacityGal ?? null, tb?.capacityGal ?? null),
      material: pickFact(ta?.material ?? null, tb?.material ?? null),
      model: pickFact(ta?.model ?? null, tb?.model ?? null),
      dimensions: pickFact(ta?.dimensions ?? null, tb?.dimensions ?? null),
    };
  });
  return {
    permitNumber: pickFact(a.permitNumber, b.permitNumber),
    documentKind: a.documentKind !== "other" ? a.documentKind : b.documentKind,
    issueDate: pickFact(a.issueDate, b.issueDate),
    finalDate: pickFact(a.finalDate, b.finalDate),
    contractor: pickFact(a.contractor, b.contractor),
    designFlowGpd: pickFact(a.designFlowGpd, b.designFlowGpd),
    bedrooms: pickFact(a.bedrooms, b.bedrooms),
    tanks,
    disposal: {
      type: pickFact(a.disposal.type, b.disposal.type),
      count: pickFact(a.disposal.count, b.disposal.count),
      dimensions: pickFact(a.disposal.dimensions, b.disposal.dimensions),
      absorptionAreaSqft: pickFact(a.disposal.absorptionAreaSqft, b.disposal.absorptionAreaSqft),
    },
    waterSource: pickFact(a.waterSource, b.waterSource),
    isCesspool: pickFact(a.isCesspool, b.isCesspool),
    isAbandonment: a.isAbandonment || b.isAbandonment,
    hasSitePlan: pickFact(a.hasSitePlan, b.hasSitePlan),
    systemType: pickFact(a.systemType, b.systemType),
    notes: [a.notes, b.notes].filter(Boolean).join(" ").slice(0, 500),
  };
}

/** Spec §6: a second pass is only needed when pass 1 found neither a tank capacity nor a disposal type. */
export function hasCoreFacts(facts: PermitFacts): boolean {
  return facts.tanks[0]?.capacityGal != null || facts.disposal.type != null;
}

/** Owner rule: a permit-class document is read further until the permit itself is identified. */
export function hasPermitIdentity(facts: PermitFacts): boolean {
  return facts.documentKind !== "other" && facts.issueDate != null;
}

/**
 * The model reports pages relative to the sub-PDF it was shown. `pageNumbers[i]`
 * is the source-document page number of sub-PDF page i+1. Returns a new object.
 */
export function rebasePages(facts: PermitFacts, pageNumbers: number[]): PermitFacts {
  const out: PermitFacts = JSON.parse(JSON.stringify(facts));
  const last = pageNumbers[pageNumbers.length - 1];
  for (const spec of allFactSpecs(out)) {
    const fact = getFactAt(out, spec.path);
    if (!fact) continue;
    setFactAt(out, spec.path, { ...fact, page: pageNumbers[fact.page - 1] ?? last });
  }
  return out;
}

/** Turn an escalation answer (free text as written) into the field's value type; null when it does not fit. */
export function coerceFactValue(kind: FactKind, raw: string): FactValue | null {
  const s = raw.trim();
  if (!s) return null;
  switch (kind.type) {
    case "string":
      return s;
    case "number": {
      const n = Number(s.replace(/[^0-9.-]/g, ""));
      return Number.isFinite(n) && s.replace(/[^0-9]/g, "").length > 0 ? n : null;
    }
    case "integer": {
      const digits = s.replace(/[^0-9-]/g, "");
      const n = Number.parseInt(digits, 10);
      return Number.isFinite(n) ? n : null;
    }
    case "boolean": {
      const l = s.toLowerCase();
      if (["true", "yes", "y"].includes(l)) return true;
      if (["false", "no", "n"].includes(l)) return false;
      return null;
    }
    case "enum": {
      const l = s.toLowerCase().replace(/[\s-]+/g, "_");
      return kind.values.includes(l) ? l : null;
    }
  }
}
