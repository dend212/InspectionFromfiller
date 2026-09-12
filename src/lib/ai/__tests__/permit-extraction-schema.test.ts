import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { describe, expect, it } from "vitest";
import {
  EscalationAnswerSchema,
  MAX_EVIDENCE_CHARS,
  PermitFactsSchema,
  emptyPermitFacts,
} from "@/lib/ai/permit-extraction-schema";

/** A Discharge Authorization as Sonnet would return it for OW-17-00474 */
export const daSample = {
  permitNumber: {
    value: "OW-17-00474",
    confidence: 0.98,
    page: 1,
    evidence: "Permit No. OW-17-00474",
    handwritten: false,
  },
  documentKind: "discharge_authorization",
  issueDate: {
    value: "2017-05-12",
    confidence: 0.95,
    page: 1,
    evidence: "Date Issued: 05/12/2017",
    handwritten: false,
  },
  finalDate: null,
  contractor: {
    value: "Desert Septic LLC",
    confidence: 0.9,
    page: 1,
    evidence: "Contractor: Desert Septic LLC",
    handwritten: false,
  },
  designFlowGpd: {
    value: 450,
    confidence: 0.96,
    page: 1,
    evidence: "Design Flow 450 gpd",
    handwritten: false,
  },
  bedrooms: {
    value: 3,
    confidence: 0.96,
    page: 1,
    evidence: "Bedrooms: 3",
    handwritten: false,
  },
  tanks: [
    {
      capacityGal: {
        value: 1250,
        confidence: 0.97,
        page: 1,
        evidence: "4.02 A314 Septic Tank Qty 1 Capacity 1250",
        handwritten: false,
      },
      material: {
        value: "precast_concrete",
        confidence: 0.85,
        page: 2,
        evidence: "Tank: precast concrete",
        handwritten: false,
      },
      model: null,
      dimensions: null,
    },
  ],
  disposal: {
    type: {
      value: "seepage_pit",
      confidence: 0.97,
      page: 1,
      evidence: "4.02 Seepage Pit Qty 2 Overall 28'0\" Effective 24'0\"",
      handwritten: false,
    },
    count: {
      value: 2,
      confidence: 0.97,
      page: 1,
      evidence: "Seepage Pit Qty 2",
      handwritten: false,
    },
    dimensions: {
      value: "Overall 28'0\" Effective 24'0\"",
      confidence: 0.95,
      page: 1,
      evidence: "Overall 28'0\" Effective 24'0\"",
      handwritten: false,
    },
    absorptionAreaSqft: null,
  },
  waterSource: {
    value: "private_well",
    confidence: 0.9,
    page: 1,
    evidence: "Water Supply: Private Well",
    handwritten: false,
  },
  isCesspool: null,
  isAbandonment: false,
  hasSitePlan: {
    value: true,
    confidence: 0.8,
    page: 3,
    evidence: "SITE PLAN (drawing)",
    handwritten: false,
  },
  systemType: {
    value: "conventional",
    confidence: 0.9,
    page: 1,
    evidence: "4.02 Conventional",
    handwritten: false,
  },
  notes: "Capacity from the General Permits Authorized table.",
};

describe("PermitFactsSchema", () => {
  it("parses a Discharge Authorization sample", () => {
    const parsed = PermitFactsSchema.parse(daSample);
    expect(parsed.tanks[0].capacityGal?.value).toBe(1250);
    expect(parsed.disposal.type?.value).toBe("seepage_pit");
    expect(parsed.documentKind).toBe("discharge_authorization");
  });

  it("parses the empty facts object", () => {
    expect(PermitFactsSchema.parse(emptyPermitFacts())).toEqual(emptyPermitFacts());
  });

  it("rejects an unknown disposal type", () => {
    const bad = {
      ...daSample,
      disposal: { ...daSample.disposal, type: { ...daSample.disposal.type, value: "leach_line" } },
    };
    expect(PermitFactsSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects evidence longer than 300 characters", () => {
    const bad = {
      ...daSample,
      permitNumber: { ...daSample.permitNumber, evidence: "x".repeat(301) },
    };
    expect(PermitFactsSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a non-positive page number", () => {
    const bad = { ...daSample, bedrooms: { ...daSample.bedrooms, page: 0 } };
    expect(PermitFactsSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects confidence above 1", () => {
    const bad = { ...daSample, bedrooms: { ...daSample.bedrooms, confidence: 1.2 } };
    expect(PermitFactsSchema.safeParse(bad).success).toBe(false);
  });
});

describe("zodOutputFormat(PermitFactsSchema)", () => {
  it("builds a strict json_schema and round-trips a sample through parse()", () => {
    const format = zodOutputFormat(PermitFactsSchema);
    expect(format.type).toBe("json_schema");
    expect(format.schema.type).toBe("object");
    expect(format.schema.additionalProperties).toBe(false);
    const parsed = format.parse(JSON.stringify(daSample));
    expect(parsed.permitNumber?.value).toBe("OW-17-00474");
  });

  it("throws on a schema mismatch", () => {
    const format = zodOutputFormat(PermitFactsSchema);
    expect(() => format.parse(JSON.stringify({ ...daSample, documentKind: "letter" }))).toThrow(
      /Failed to parse structured output/,
    );
  });
});

describe("EscalationAnswerSchema", () => {
  it("parses a found answer and a not-found answer", () => {
    expect(
      EscalationAnswerSchema.parse({
        found: true,
        value: "1200",
        confidence: 0.82,
        evidence: "Septic tank 1200 gal",
        handwritten: true,
      }).value,
    ).toBe("1200");
    expect(
      EscalationAnswerSchema.parse({
        found: false,
        value: "",
        confidence: 0,
        evidence: "",
        handwritten: false,
      }).found,
    ).toBe(false);
  });

  it("accepts an evidence quote over the persisted cap on the wire — the API cannot enforce string lengths", () => {
    // Reply-only schema: a 301-char quote must not throw in zodOutputFormat().parse, or the paid
    // Opus answer (and every remaining escalation) is dropped; the caller clamps to MAX_EVIDENCE_CHARS.
    expect(MAX_EVIDENCE_CHARS).toBe(300);
    const parsed = zodOutputFormat(EscalationAnswerSchema).parse(
      JSON.stringify({
        found: true,
        value: "1200",
        confidence: 0.82,
        evidence: "e".repeat(MAX_EVIDENCE_CHARS + 1),
        handwritten: true,
      }),
    );
    expect(parsed.evidence).toHaveLength(MAX_EVIDENCE_CHARS + 1);
  });
});
