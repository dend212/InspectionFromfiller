import { describe, expect, it } from "vitest";
import {
  buildRecommendationContext,
  formatRecommendationInput,
  hasActionableInput,
  type RecommendationContext,
} from "@/lib/ai/draft-recommendations";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Strings that must never reach the model */
const PII_STRINGS = [
  "Jane Seller",
  "123 Main St",
  "Inspector Bob",
  "Jane's House",
  "jane@example.com",
  "480-555-0100",
  "OW-17-00474",
];

/** A stored formData blob full of PII around the fields we actually want */
const PII_FORM = {
  facilityInfo: {
    facilityName: "Jane's House",
    facilityAddress: "123 Main St",
    facilityCity: "Phoenix",
    sellerName: "Jane Seller",
    sellerAddress: "123 Main St",
    inspectorName: "Inspector Bob",
    dischargeAuthPermitNo: "OW-17-00474",
    isCesspool: "no",
    cesspoolComments: "",
    septicTankCondition: "operational_with_concerns",
    disposalWorksCondition: "operational",
    alternativeSystemCondition: "",
  },
  septicTank: {
    tanksPumped: "yes",
    haulerCompany: "Bob's Pumping jane@example.com 480-555-0100",
    septicTankComments: "  Tank is sound.  ",
    tanks: [
      {
        tankMaterial: "precast_concrete",
        compromisedTank: "no",
        deficiencyRootInvasion: false,
        deficiencyCracks: true,
        deficiencyDamagedInlet: true,
      },
    ],
  },
  disposalWorks: {
    disposalWorksComments: "",
    printedName: "Inspector Bob",
  },
};

const EMPTY_CONTEXT: RecommendationContext = {
  septicTankComments: "",
  disposalWorksComments: "",
  cesspoolComments: "",
  isCesspool: "",
  tanksPumped: "",
  septicTankCondition: "",
  disposalWorksCondition: "",
  alternativeSystemCondition: "",
  tanks: [],
};

// ---------------------------------------------------------------------------
// buildRecommendationContext
// ---------------------------------------------------------------------------

describe("buildRecommendationContext", () => {
  it("copies only the comment, flag and condition fields (trimmed)", () => {
    expect(buildRecommendationContext(PII_FORM)).toEqual({
      septicTankComments: "Tank is sound.",
      disposalWorksComments: "",
      cesspoolComments: "",
      isCesspool: "no",
      tanksPumped: "yes",
      septicTankCondition: "operational_with_concerns",
      disposalWorksCondition: "operational",
      alternativeSystemCondition: "",
      tanks: [{ compromisedTank: "no", deficiencies: ["Cracks", "Damaged Inlet"] }],
    });
  });

  it("never includes names, addresses, emails, phone numbers or permit numbers", () => {
    const serialised = JSON.stringify(buildRecommendationContext(PII_FORM));
    for (const pii of PII_STRINGS) {
      expect(serialised).not.toContain(pii);
    }
  });

  it("returns an empty context for null, undefined or malformed form data", () => {
    expect(buildRecommendationContext(null)).toEqual(EMPTY_CONTEXT);
    expect(buildRecommendationContext(undefined)).toEqual(EMPTY_CONTEXT);
    expect(buildRecommendationContext("nope")).toEqual(EMPTY_CONTEXT);
    expect(buildRecommendationContext({ septicTank: { tanks: "not-an-array" } })).toEqual(
      EMPTY_CONTEXT,
    );
  });

  it("maps every tank deficiency checkbox to its label", () => {
    const ctx = buildRecommendationContext({
      septicTank: {
        tanks: [
          {
            deficiencyRootInvasion: true,
            deficiencyExposedRebar: true,
            deficiencyCracks: true,
            deficiencyDamagedInlet: true,
            deficiencyDamagedOutlet: true,
            deficiencyDamagedLids: true,
            deficiencyDeterioratingConcrete: true,
            deficiencyOther: true,
          },
        ],
      },
    });
    expect(ctx.tanks[0].deficiencies).toEqual([
      "Root Invasion",
      "Exposed Rebar",
      "Cracks",
      "Damaged Inlet",
      "Damaged Outlet",
      "Damaged Lids",
      "Deteriorating Concrete",
      "Other Deficiency",
    ]);
  });
});

// ---------------------------------------------------------------------------
// hasActionableInput
// ---------------------------------------------------------------------------

describe("hasActionableInput", () => {
  it("is false for an empty context", () => {
    expect(hasActionableInput(EMPTY_CONTEXT)).toBe(false);
  });

  it("is true when any comment is present", () => {
    expect(hasActionableInput({ ...EMPTY_CONTEXT, septicTankComments: "x" })).toBe(true);
    expect(hasActionableInput({ ...EMPTY_CONTEXT, disposalWorksComments: "x" })).toBe(true);
    expect(hasActionableInput({ ...EMPTY_CONTEXT, cesspoolComments: "x" })).toBe(true);
  });

  it("is true for a tank deficiency or a compromised tank", () => {
    expect(
      hasActionableInput({
        ...EMPTY_CONTEXT,
        tanks: [{ compromisedTank: "", deficiencies: ["Cracks"] }],
      }),
    ).toBe(true);
    expect(
      hasActionableInput({
        ...EMPTY_CONTEXT,
        tanks: [{ compromisedTank: "yes", deficiencies: [] }],
      }),
    ).toBe(true);
  });

  it("is true for any condition other than operational", () => {
    expect(
      hasActionableInput({ ...EMPTY_CONTEXT, septicTankCondition: "operational_with_concerns" }),
    ).toBe(true);
    expect(
      hasActionableInput({ ...EMPTY_CONTEXT, disposalWorksCondition: "not_operational" }),
    ).toBe(true);
    expect(
      hasActionableInput({ ...EMPTY_CONTEXT, alternativeSystemCondition: "not_operational" }),
    ).toBe(true);
  });

  it("is false when everything is operational and nothing else is set", () => {
    expect(
      hasActionableInput({
        ...EMPTY_CONTEXT,
        tanksPumped: "yes",
        isCesspool: "no",
        septicTankCondition: "operational",
        disposalWorksCondition: "operational",
        tanks: [{ compromisedTank: "no", deficiencies: [] }],
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// formatRecommendationInput — the exact user message sent to the model
// ---------------------------------------------------------------------------

describe("formatRecommendationInput", () => {
  it("renders the exact prompt input", () => {
    const ctx = buildRecommendationContext(PII_FORM);
    expect(formatRecommendationInput(ctx)).toBe(
      [
        "Draft the customer-facing recommendations from these inspection findings.",
        "",
        "Septic tank condition: operational with concerns",
        "Disposal works condition: operational",
        "Alternative system condition: Not specified",
        "Tanks pumped: yes",
        "Cesspool: no",
        "",
        "--- Tank 1 ---",
        "Compromised tank: no",
        "Deficiencies: Cracks, Damaged Inlet",
        "",
        "Septic tank comments:",
        "Tank is sound.",
        "",
        "Disposal works comments:",
        "(none)",
        "",
        "Cesspool comments:",
        "(none)",
      ].join("\n"),
    );
  });

  it("renders (none) placeholders and no tank blocks for an empty context", () => {
    expect(formatRecommendationInput(EMPTY_CONTEXT)).toBe(
      [
        "Draft the customer-facing recommendations from these inspection findings.",
        "",
        "Septic tank condition: Not specified",
        "Disposal works condition: Not specified",
        "Alternative system condition: Not specified",
        "Tanks pumped: Not specified",
        "Cesspool: Not specified",
        "",
        "Septic tank comments:",
        "(none)",
        "",
        "Disposal works comments:",
        "(none)",
        "",
        "Cesspool comments:",
        "(none)",
      ].join("\n"),
    );
  });

  it("contains no PII", () => {
    const text = formatRecommendationInput(buildRecommendationContext(PII_FORM));
    for (const pii of PII_STRINGS) {
      expect(text).not.toContain(pii);
    }
  });
});
