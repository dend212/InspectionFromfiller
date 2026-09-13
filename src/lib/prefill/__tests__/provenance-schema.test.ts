import { describe, expect, it } from "vitest";
import {
  fieldProvenanceSchema,
  MAX_PROVENANCE_ENTRIES,
  provenanceEntrySchema,
  provenancePatchBodySchema,
} from "@/lib/prefill/provenance-schema";

const VALID = {
  source: "permit",
  state: "prefilled",
  kind: "fill",
  value: "1250",
  confidence: 0.92,
  explanation: "Permit OW-17-00474 · Discharge Authorization p.1",
  evidence: "Septic Tank Qty 1 Capacity 1250",
  sourceUrl: "/api/inspections/insp-1/records/rec-1#page=1",
  recordId: "rec-1",
  page: 1,
  runId: "run-1",
  at: "2026-09-11T10:00:00.000Z",
};

describe("provenanceEntrySchema", () => {
  it("accepts a complete entry", () => {
    expect(provenanceEntrySchema.safeParse(VALID).success).toBe(true);
  });

  it("accepts boolean and string[] values", () => {
    expect(provenanceEntrySchema.safeParse({ ...VALID, value: true }).success).toBe(true);
    expect(provenanceEntrySchema.safeParse({ ...VALID, value: ["a", "b"] }).success).toBe(true);
  });

  it("accepts a minimal entry without optional fields", () => {
    const { evidence, sourceUrl, recordId, page, runId, ...minimal } = VALID;
    void evidence;
    void sourceUrl;
    void recordId;
    void page;
    void runId;
    expect(provenanceEntrySchema.safeParse(minimal).success).toBe(true);
  });

  it("accepts a remembered prior entry (an edited field re-suggested by a later run)", () => {
    const prior = { ...VALID, state: "edited", source: "scan", confidence: 0.8 };
    const parsed = provenanceEntrySchema.safeParse({ ...VALID, state: "suggested", prior });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.prior).toEqual(prior);
  });

  it("accepts a warning line on a prefilled entry (audit 5.1) and bounds it like the explanation", () => {
    const warning = 'Listing says "Sewer" — confirm this property is on septic';
    const parsed = provenanceEntrySchema.safeParse({ ...VALID, warning });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.warning).toBe(warning);
    expect(provenanceEntrySchema.safeParse({ ...VALID, warning: "w".repeat(501) }).success).toBe(false);
    expect(provenanceEntrySchema.safeParse({ ...VALID, warning: 42 }).success).toBe(false);
  });

  it("rejects a prior entry that is itself invalid", () => {
    const bad = { ...VALID, state: "suggested", prior: { ...VALID, state: "maybe" } };
    expect(provenanceEntrySchema.safeParse(bad).success).toBe(false);
  });

  it("rejects unknown sources, states and kinds", () => {
    expect(provenanceEntrySchema.safeParse({ ...VALID, source: "zillow" }).success).toBe(false);
    expect(provenanceEntrySchema.safeParse({ ...VALID, state: "maybe" }).success).toBe(false);
    expect(provenanceEntrySchema.safeParse({ ...VALID, kind: "note" }).success).toBe(false);
  });

  it("rejects confidence outside 0–1 and numeric values", () => {
    expect(provenanceEntrySchema.safeParse({ ...VALID, confidence: 1.2 }).success).toBe(false);
    expect(provenanceEntrySchema.safeParse({ ...VALID, confidence: -0.1 }).success).toBe(false);
    expect(provenanceEntrySchema.safeParse({ ...VALID, value: 1250 }).success).toBe(false);
  });

  it("only allows https:// or /api/ source URLs (never javascript: or http:)", () => {
    expect(
      provenanceEntrySchema.safeParse({ ...VALID, sourceUrl: "javascript:alert(1)" }).success,
    ).toBe(false);
    expect(
      provenanceEntrySchema.safeParse({ ...VALID, sourceUrl: "http://example.com" }).success,
    ).toBe(false);
    // Protocol-relative and newline-smuggled schemes
    expect(provenanceEntrySchema.safeParse({ ...VALID, sourceUrl: "//evil.com" }).success).toBe(false);
    expect(
      provenanceEntrySchema.safeParse({ ...VALID, sourceUrl: "java\nscript:alert(1)" }).success,
    ).toBe(false);
    expect(
      provenanceEntrySchema.safeParse({ ...VALID, sourceUrl: " https://example.com" }).success,
    ).toBe(false);
    expect(provenanceEntrySchema.safeParse({ ...VALID, sourceUrl: "/apix/evil" }).success).toBe(false);
    expect(
      provenanceEntrySchema.safeParse({
        ...VALID,
        sourceUrl: "https://mcassessor.maricopa.gov/mcs/?q=219-11-121",
      }).success,
    ).toBe(true);
  });
});

describe("fieldProvenanceSchema", () => {
  it("accepts dotted keys including array indexes", () => {
    expect(
      fieldProvenanceSchema.safeParse({ "septicTank.tanks.0.tankCapacity": VALID }).success,
    ).toBe(true);
  });

  it("rejects bracket keys (must be normalised first)", () => {
    expect(
      fieldProvenanceSchema.safeParse({ "septicTank.tanks[0].tankCapacity": VALID }).success,
    ).toBe(false);
  });

  it("rejects more than MAX_PROVENANCE_ENTRIES entries", () => {
    const tooMany: Record<string, typeof VALID> = {};
    for (let i = 0; i <= MAX_PROVENANCE_ENTRIES; i++) {
      tooMany[`facilityInfo.f${i}`] = VALID;
    }
    expect(fieldProvenanceSchema.safeParse(tooMany).success).toBe(false);
  });
});

describe("provenancePatchBodySchema", () => {
  it("requires fieldProvenance", () => {
    expect(provenancePatchBodySchema.safeParse({}).success).toBe(false);
    expect(provenancePatchBodySchema.safeParse({ fieldProvenance: {} }).success).toBe(true);
  });
});
