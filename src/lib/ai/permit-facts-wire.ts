/**
 * The shape actually sent to the API as the structured-output schema.
 *
 * `PermitFactsSchema` stays the domain contract (spec §6) — every consumer
 * works on the nested PermitFacts — but as a structured-output grammar it is
 * rejected by the API: 18 nullable fact objects exceed the 16-union limit and,
 * once deduplicated through $ref, still compile to "The compiled grammar is too
 * large" (even a 12-fact variant does; verified live 2026-09-12 in the phase 3
 * smoke). One array of uniform fact rows compiles, so the model emits
 * `{ documentKind, isAbandonment, notes, facts: [{ path, value, … }] }` and
 * `permitFactsFromWire` folds the rows back into PermitFacts.
 */
import { z } from "zod";
import {
  type Fact,
  MAX_EVIDENCE_CHARS,
  type PermitFacts,
  PermitFactsSchema,
  emptyPermitFacts,
} from "./permit-extraction-schema";
import {
  FACT_SPECS,
  type FactKind,
  type FactSpec,
  type FactValue,
  coerceFactValue,
  getFactAt,
  setFactAt,
  tankFactSpecs,
} from "./permit-facts-utils";

/** The API rejects schemas with more union-typed (nullable / anyOf) parameters than this */
export const MAX_UNION_PARAMETERS = 16;

/** Tank indexes the model may address (tanks.0 … tanks.2); a fourth tank on a residential permit is unheard of */
export const MAX_WIRE_TANKS = 3;

/** The persisted cap on notes (PermitFactsSchema); the wire trims to it rather than rejecting the pass */
export const MAX_NOTES_CHARS: number = PermitFactsSchema.shape.notes.maxLength ?? 500;

/** A dropped value is logged trimmed to this — the model can put a whole evidence quote in `value` */
export const MAX_LOGGED_VALUE_CHARS = 80;

/**
 * Trims `text` to at most `max` chars, ending in "…" when anything was cut. The API cannot enforce
 * string lengths (structured outputs drop minLength/maxLength from the grammar), so the persisted
 * caps are applied here instead of failing the pass on an otherwise-valid reply.
 */
export function clampText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export const WIRE_FACT_SPECS: readonly FactSpec[] = [
  ...FACT_SPECS,
  ...Array.from({ length: MAX_WIRE_TANKS }, (_, i) => tankFactSpecs(i)).flat(),
];

export const WIRE_FACT_PATHS: readonly string[] = WIRE_FACT_SPECS.map((s) => s.path);

const SPEC_BY_PATH = new Map(WIRE_FACT_SPECS.map((s) => [s.path, s]));

// No `.describe()` here: zod 4 hoists described schemas into `$defs`, and the vocabulary
// (paths, value types) lives in the cached system prompt instead — the prompt test pins it.
export const PermitFactRowSchema = z.object({
  /** One of WIRE_FACT_PATHS */
  path: z.string(),
  /** A number, a flag, an enum token or the text as written — permitFactsFromWire coerces by path */
  value: z.union([z.string(), z.number(), z.boolean()]),
  confidence: z.number().min(0).max(1),
  page: z.number().int().positive(),
  /** No length cap on the wire (same reason as `notes` below); permitFactsFromWire clamps to MAX_EVIDENCE_CHARS */
  evidence: z.string(),
  handwritten: z.boolean(),
});

export type PermitFactRow = z.infer<typeof PermitFactRowSchema>;

export const PermitFactsWireSchema = z.object({
  documentKind: PermitFactsSchema.shape.documentKind,
  isAbandonment: z.boolean(),
  // No length cap here: structured outputs do not support minLength/maxLength, so the SDK strips
  // them from the grammar and only re-checks client-side — a verbose note would then fail the whole
  // pass (seen live on the 15-page 071533 permit: pass 2 wrote 635 chars). permitFactsFromWire trims.
  notes: z.string(),
  /** One row per fact actually found on the pages; absent facts are simply not listed */
  facts: z.array(PermitFactRowSchema),
});

export type PermitFactsWire = z.infer<typeof PermitFactsWireSchema>;

/** A typed value is used as-is when it fits the fact's kind; anything else goes through the escalation coercer. */
function coerceWireValue(kind: FactKind, raw: PermitFactRow["value"]): FactValue | null {
  if (typeof raw === "number") {
    if (kind.type === "number") return Number.isFinite(raw) ? raw : null;
    if (kind.type === "integer") return Number.isInteger(raw) ? raw : null;
  }
  if (typeof raw === "boolean") {
    if (kind.type === "boolean") return raw;
    return null;
  }
  return coerceFactValue(kind, String(raw));
}

function ensureTank(facts: PermitFacts, path: string): void {
  const m = /^tanks\.(\d+)\./.exec(path);
  if (!m) return;
  const index = Number(m[1]);
  while (facts.tanks.length <= index) {
    facts.tanks.push({ capacityGal: null, material: null, model: null, dimensions: null });
  }
}

export interface PermitFactsFromWireOptions {
  /** Names the document in drop logs (the permit number); a bare path + value is untraceable in a run log */
  label?: string;
}

/**
 * Folds the flat rows into PermitFacts. Rows with an unknown path or a value
 * that does not fit the fact are dropped (a stray row must never fail the
 * document) but logged — a silent drop hid the model answering waterSource
 * with the form's own label ("water_company") on every replay of OW-15-00667;
 * when a path is reported twice the more confident row wins.
 */
export function permitFactsFromWire(wire: PermitFactsWire, opts: PermitFactsFromWireOptions = {}): PermitFacts {
  const facts = emptyPermitFacts();
  facts.documentKind = wire.documentKind;
  facts.isAbandonment = wire.isAbandonment;
  facts.notes = clampText(wire.notes, MAX_NOTES_CHARS);

  const dropped = (row: PermitFactRow) =>
    console.warn("[prefill] dropped fact row", {
      ...(opts.label ? { label: opts.label } : {}),
      path: row.path,
      value: typeof row.value === "string" ? clampText(row.value, MAX_LOGGED_VALUE_CHARS) : row.value,
    });

  for (const row of wire.facts) {
    const spec = SPEC_BY_PATH.get(row.path.trim());
    if (!spec) {
      dropped(row);
      continue;
    }
    const value = coerceWireValue(spec.kind, row.value);
    if (value === null) {
      dropped(row);
      continue;
    }
    ensureTank(facts, spec.path);
    const existing = getFactAt(facts, spec.path);
    if (existing && existing.confidence >= row.confidence) continue;
    const fact: Fact<FactValue> = {
      value,
      confidence: row.confidence,
      page: row.page,
      evidence: clampText(row.evidence, MAX_EVIDENCE_CHARS),
      handwritten: row.handwritten,
    };
    setFactAt(facts, spec.path, fact);
  }

  facts.tanks = facts.tanks.filter((t) => t.capacityGal || t.material || t.model || t.dimensions);
  return facts;
}
