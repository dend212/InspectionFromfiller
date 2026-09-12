import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { describe, expect, it } from "vitest";
import { PermitFactsSchema, emptyPermitFacts } from "@/lib/ai/permit-extraction-schema";
import {
  MAX_NOTES_CHARS,
  MAX_UNION_PARAMETERS,
  MAX_WIRE_TANKS,
  type PermitFactRow,
  PermitFactsWireSchema,
  WIRE_FACT_PATHS,
  permitFactsFromWire,
} from "@/lib/ai/permit-facts-wire";

const row = (path: string, value: string | number | boolean, extra: Partial<PermitFactRow> = {}): PermitFactRow => ({
  path,
  value,
  confidence: 0.9,
  page: 1,
  evidence: `ev:${String(value)}`,
  handwritten: false,
  ...extra,
});

const fact = <T>(value: T, confidence = 0.9, page = 1, handwritten = false) => ({
  value,
  confidence,
  page,
  evidence: `ev:${String(value)}`,
  handwritten,
});

const wire = (facts: PermitFactRow[], top: Partial<{ documentKind: "final_da"; isAbandonment: boolean; notes: string }> = {}) => ({
  documentKind: "discharge_authorization" as const,
  isAbandonment: false,
  notes: "",
  ...top,
  facts,
});

/** Counts what the API counts: every schema node with `anyOf` or an array `type` */
function countUnionParameters(node: unknown): number {
  if (Array.isArray(node)) return node.reduce((n, x) => n + countUnionParameters(x), 0);
  if (!node || typeof node !== "object") return 0;
  const o = node as Record<string, unknown>;
  const self = Array.isArray(o.anyOf) || Array.isArray(o.type) ? 1 : 0;
  return self + Object.values(o).reduce<number>((n, v) => n + countUnionParameters(v), 0);
}

describe("PermitFactsWireSchema", () => {
  it("compiles to one flat facts array with far fewer union parameters than the API's limit", () => {
    const format = zodOutputFormat(PermitFactsWireSchema);
    const schema = format.schema as { properties: Record<string, { items?: { properties: Record<string, unknown> } }> };
    expect(Object.keys(schema.properties).sort()).toEqual(["documentKind", "facts", "isAbandonment", "notes"]);
    expect(Object.keys(schema.properties.facts.items?.properties ?? {}).sort()).toEqual([
      "confidence",
      "evidence",
      "handwritten",
      "page",
      "path",
      "value",
    ]);
    // 2026-09-12: the nested PermitFactsSchema was rejected live with "18 parameters with union
    // types (limit: 16)" and, once deduplicated, "The compiled grammar is too large" — only the
    // flat shape compiles. The one union left is `value: string | number | boolean`.
    expect(countUnionParameters(format.schema)).toBeLessThanOrEqual(MAX_UNION_PARAMETERS);
    expect(countUnionParameters(format.schema)).toBe(1);
  });

  it("stays inline (no $defs) so the grammar is as small as it looks", () => {
    expect(zodOutputFormat(PermitFactsWireSchema).schema).not.toHaveProperty("$defs");
  });

  it("addresses every top-level fact and the first MAX_WIRE_TANKS tanks", () => {
    expect(WIRE_FACT_PATHS).toContain("permitNumber");
    expect(WIRE_FACT_PATHS).toContain("disposal.absorptionAreaSqft");
    expect(WIRE_FACT_PATHS).toContain("tanks.0.capacityGal");
    expect(WIRE_FACT_PATHS).toContain(`tanks.${MAX_WIRE_TANKS - 1}.capacityGal`);
    expect(WIRE_FACT_PATHS).not.toContain(`tanks.${MAX_WIRE_TANKS}.capacityGal`);
  });

  it("round-trips a wire reply through parse() and rejects a bad documentKind", () => {
    const format = zodOutputFormat(PermitFactsWireSchema);
    const parsed = format.parse(JSON.stringify(wire([row("permitNumber", "OW-17-00474")])));
    expect(parsed.facts[0].value).toBe("OW-17-00474");
    expect(() => format.parse(JSON.stringify({ ...wire([]), documentKind: "letter" }))).toThrow(
      /Failed to parse structured output/,
    );
  });

  it("accepts a verbose notes string — the API cannot enforce string lengths, so a long note must not fail the pass", () => {
    // Seen live on the 15-page 071533 permit: pass 2's notes ran to 635 chars against the persisted 500 cap
    // and the SDK's client-side re-check threw, failing the whole document.
    const format = zodOutputFormat(PermitFactsWireSchema);
    const parsed = format.parse(JSON.stringify(wire([], { notes: "n".repeat(635) })));
    expect(parsed.notes).toHaveLength(635);
  });
});

describe("permitFactsFromWire", () => {
  it("builds the nested PermitFacts from typed rows", () => {
    const facts = permitFactsFromWire(
      wire(
        [
          row("permitNumber", "OW-17-00474"),
          row("issueDate", "2017-02-08", { page: 1 }),
          row("designFlowGpd", 450, { page: 2 }),
          row("bedrooms", 3),
          row("tanks.0.capacityGal", 1250, { confidence: 0.98 }),
          row("tanks.0.material", "precast_concrete"),
          row("disposal.type", "seepage_pit", { page: 2 }),
          row("disposal.count", 2),
          row("disposal.dimensions", "Overall 28'0\" Effective 24'0\""),
          row("waterSource", "municipal"),
          row("isCesspool", false),
          row("hasSitePlan", true, { page: 3 }),
          row("systemType", "conventional"),
        ],
        { notes: "As-built table used." },
      ),
    );
    expect(facts).toEqual({
      ...emptyPermitFacts(),
      documentKind: "discharge_authorization",
      notes: "As-built table used.",
      permitNumber: fact("OW-17-00474"),
      issueDate: fact("2017-02-08"),
      designFlowGpd: fact(450, 0.9, 2),
      bedrooms: fact(3),
      tanks: [{ capacityGal: fact(1250, 0.98), material: fact("precast_concrete"), model: null, dimensions: null }],
      disposal: {
        type: fact("seepage_pit", 0.9, 2),
        count: fact(2),
        dimensions: fact("Overall 28'0\" Effective 24'0\""),
        absorptionAreaSqft: null,
      },
      waterSource: fact("municipal"),
      isCesspool: fact(false),
      hasSitePlan: fact(true, 0.9, 3),
      systemType: fact("conventional"),
    });
  });

  it("passes documentKind and isAbandonment through and leaves everything else empty", () => {
    const facts = permitFactsFromWire(wire([], { documentKind: "final_da", isAbandonment: true }));
    expect(facts).toEqual({ ...emptyPermitFacts(), documentKind: "final_da", isAbandonment: true });
  });

  it("coerces values written as text into the fact's type", () => {
    const facts = permitFactsFromWire(
      wire([
        row("tanks.0.capacityGal", "1,250 gal"),
        row("bedrooms", "3"),
        row("isCesspool", "true"),
        row("disposal.type", "Seepage Pit"),
        row("permitNumber", 972),
      ]),
    );
    expect(facts.tanks[0].capacityGal?.value).toBe(1250);
    expect(facts.bedrooms?.value).toBe(3);
    expect(facts.isCesspool?.value).toBe(true);
    expect(facts.disposal.type?.value).toBe("seepage_pit");
    expect(facts.permitNumber?.value).toBe("972");
  });

  it("drops rows whose path is unknown or whose value does not fit the fact", () => {
    const facts = permitFactsFromWire(
      wire([
        row("septicTankGallons", 1250),
        row(`tanks.${MAX_WIRE_TANKS}.capacityGal`, 1000),
        row("waterSource", "moon"),
        row("bedrooms", 2.5),
        row("isCesspool", 1),
        row("designFlowGpd", ""),
        row("contractor", "   "),
        row("issueDate", "2000-03-01"),
      ]),
    );
    expect(facts).toEqual({
      ...emptyPermitFacts(),
      documentKind: "discharge_authorization",
      issueDate: fact("2000-03-01"),
    });
  });

  it("keeps the more confident row when a path is reported twice, whatever the order", () => {
    const a = permitFactsFromWire(wire([row("bedrooms", 3, { confidence: 0.6 }), row("bedrooms", 4, { confidence: 0.9 })]));
    const b = permitFactsFromWire(wire([row("bedrooms", 4, { confidence: 0.9 }), row("bedrooms", 3, { confidence: 0.6 })]));
    expect(a.bedrooms?.value).toBe(4);
    expect(b.bedrooms?.value).toBe(4);
  });

  it("grows the tanks array per index and compacts tanks that carry no fact", () => {
    const facts = permitFactsFromWire(
      wire([row("tanks.1.capacityGal", 500), row("tanks.1.model", "dosing tank"), row("tanks.2.material", "fiberglass")]),
    );
    expect(facts.tanks).toEqual([
      { capacityGal: fact(500), material: null, model: fact("dosing tank"), dimensions: null },
      { capacityGal: null, material: fact("fiberglass"), model: null, dimensions: null },
    ]);
  });

  it("trims verbose notes to the persisted cap so the result still satisfies PermitFactsSchema", () => {
    const facts = permitFactsFromWire(wire([], { notes: "n".repeat(635) }));
    expect(facts.notes).toHaveLength(MAX_NOTES_CHARS);
    expect(facts.notes.endsWith("…")).toBe(true);
    expect(PermitFactsSchema.safeParse(facts).success).toBe(true);
    expect(permitFactsFromWire(wire([], { notes: "As-built table used." })).notes).toBe("As-built table used.");
  });

  it("keeps page, evidence and handwritten from the row", () => {
    const facts = permitFactsFromWire(
      wire([row("tanks.0.capacityGal", 1200, { page: 2, evidence: "Septic tank 1200 gal", handwritten: true, confidence: 0.55 })]),
    );
    expect(facts.tanks[0].capacityGal).toEqual({
      value: 1200,
      confidence: 0.55,
      page: 2,
      evidence: "Septic tank 1200 gal",
      handwritten: true,
    });
  });
});
