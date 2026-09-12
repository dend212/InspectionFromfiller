import { describe, expect, it } from "vitest";
import { emptyPermitFacts, type PermitFacts } from "@/lib/ai/permit-extraction-schema";
import {
  allFactSpecs,
  coerceFactValue,
  getFactAt,
  hasCoreFacts,
  hasPermitIdentity,
  mergePermitFacts,
  rebasePages,
  setFactAt,
  tankFactSpecs,
} from "@/lib/ai/permit-facts-utils";

const f = <T>(value: T, confidence = 0.9, page = 1, handwritten = false) => ({
  value,
  confidence,
  page,
  evidence: `ev:${String(value)}`,
  handwritten,
});

function withTank(facts: PermitFacts, capacity: number, confidence = 0.9): PermitFacts {
  return {
    ...facts,
    tanks: [{ capacityGal: f(capacity, confidence), material: null, model: null, dimensions: null }],
  };
}

describe("fact path registry", () => {
  it("lists tank specs per tank index", () => {
    const facts = withTank(emptyPermitFacts(), 1000);
    const paths = allFactSpecs(facts).map((s) => s.path);
    expect(paths).toContain("permitNumber");
    expect(paths).toContain("disposal.type");
    expect(paths).toContain("tanks.0.capacityGal");
    expect(paths).not.toContain("tanks.1.capacityGal");
    expect(tankFactSpecs(1).map((s) => s.path)).toEqual([
      "tanks.1.capacityGal",
      "tanks.1.material",
      "tanks.1.model",
      "tanks.1.dimensions",
    ]);
  });

  it("gets and sets facts by dotted path", () => {
    const facts = withTank(emptyPermitFacts(), 1000);
    expect(getFactAt(facts, "tanks.0.capacityGal")?.value).toBe(1000);
    expect(getFactAt(facts, "disposal.type")).toBeNull();
    expect(getFactAt(facts, "tanks.4.capacityGal")).toBeNull();
    setFactAt(facts, "disposal.type", f("trench"));
    expect(facts.disposal.type?.value).toBe("trench");
    setFactAt(facts, "tanks.0.capacityGal", f(1250, 0.95));
    expect(facts.tanks[0].capacityGal?.value).toBe(1250);
  });
});

describe("mergePermitFacts", () => {
  it("keeps the higher-confidence fact per path and unions tanks", () => {
    const a = withTank({ ...emptyPermitFacts(), permitNumber: f("000972", 0.6) }, 1000, 0.5);
    const b: PermitFacts = {
      ...withTank(emptyPermitFacts(), 1200, 0.9),
      permitNumber: f("000972", 0.4),
      disposal: { ...emptyPermitFacts().disposal, type: f("seepage_pit", 0.8) },
      tanks: [
        { capacityGal: f(1200, 0.9), material: null, model: null, dimensions: null },
        { capacityGal: f(500, 0.7), material: null, model: null, dimensions: null },
      ],
    };
    const merged = mergePermitFacts(a, b);
    expect(merged.permitNumber?.confidence).toBe(0.6);
    expect(merged.tanks[0].capacityGal?.value).toBe(1200);
    expect(merged.tanks[1].capacityGal?.value).toBe(500);
    expect(merged.disposal.type?.value).toBe("seepage_pit");
  });

  it("prefers a known documentKind, ORs isAbandonment and joins notes", () => {
    const a = { ...emptyPermitFacts(), documentKind: "other" as const, notes: "first" };
    const b = { ...emptyPermitFacts(), documentKind: "abandonment" as const, isAbandonment: true, notes: "second" };
    const merged = mergePermitFacts(a, b);
    expect(merged.documentKind).toBe("abandonment");
    expect(merged.isAbandonment).toBe(true);
    expect(merged.notes).toBe("first second");
  });
});

describe("hasCoreFacts", () => {
  it("is true when a tank capacity or a disposal type exists", () => {
    expect(hasCoreFacts(emptyPermitFacts())).toBe(false);
    expect(hasCoreFacts(withTank(emptyPermitFacts(), 1000))).toBe(true);
    expect(
      hasCoreFacts({ ...emptyPermitFacts(), disposal: { ...emptyPermitFacts().disposal, type: f("bed") } }),
    ).toBe(true);
  });
});

describe("hasPermitIdentity", () => {
  it("needs both a positive document kind and an issue date", () => {
    expect(hasPermitIdentity({ ...emptyPermitFacts(), documentKind: "other", issueDate: f("2007-04-12") })).toBe(false);
    expect(hasPermitIdentity({ ...emptyPermitFacts(), documentKind: "approval_to_construct", issueDate: null })).toBe(false);
    expect(
      hasPermitIdentity({ ...emptyPermitFacts(), documentKind: "approval_to_construct", issueDate: f("2007-04-12") }),
    ).toBe(true);
  });
});

describe("rebasePages", () => {
  it("maps sub-PDF page numbers back to the source document", () => {
    const facts: PermitFacts = {
      ...withTank(emptyPermitFacts(), 1000),
      permitNumber: f("X", 0.9, 2),
      hasSitePlan: f(true, 0.8, 3),
    };
    const rebased = rebasePages(facts, [5, 6, 7]);
    expect(rebased.permitNumber?.page).toBe(6);
    expect(rebased.hasSitePlan?.page).toBe(7);
    expect(rebased.tanks[0].capacityGal?.page).toBe(5);
    // out-of-range page from the model clamps to the last page shown
    const clamped = rebasePages({ ...facts, permitNumber: f("X", 0.9, 9) }, [5, 6, 7]);
    expect(clamped.permitNumber?.page).toBe(7);
    // does not mutate the input
    expect(facts.permitNumber?.page).toBe(2);
  });
});

describe("coerceFactValue", () => {
  it("coerces by kind and rejects junk", () => {
    expect(coerceFactValue({ type: "number" }, "1,250 gal")).toBe(1250);
    expect(coerceFactValue({ type: "integer" }, "3 bedrooms")).toBe(3);
    expect(coerceFactValue({ type: "boolean" }, "Yes")).toBe(true);
    expect(coerceFactValue({ type: "boolean" }, "maybe")).toBeNull();
    expect(coerceFactValue({ type: "enum", values: ["seepage_pit", "trench"] }, "Seepage Pit")).toBe("seepage_pit");
    expect(coerceFactValue({ type: "enum", values: ["seepage_pit", "trench"] }, "leach line")).toBeNull();
    expect(coerceFactValue({ type: "string" }, "  OW-17-00474 ")).toBe("OW-17-00474");
    expect(coerceFactValue({ type: "string" }, "   ")).toBeNull();
    expect(coerceFactValue({ type: "number" }, "n/a")).toBeNull();
  });
});
