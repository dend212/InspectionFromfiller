import { beforeEach, describe, expect, it, vi } from "vitest";

// `new Anthropic()` throws under jsdom ("browser-like environment") — mock the SDK before the module loads
const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

import {
  buildRecommendationContext,
  draftRecommendations,
  FALLBACK_RECOMMENDATION,
  formatRecommendationInput,
  hasActionableInput,
  normalizeRecommendations,
  type RecommendationContext,
} from "@/lib/ai/draft-recommendations";

/** Build a minimal Anthropic Messages response carrying one text block */
function mockResponse(text: string) {
  return { content: [{ type: "text", text }] };
}

beforeEach(() => {
  mockCreate.mockReset();
});

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

// ---------------------------------------------------------------------------
// normalizeRecommendations — post-processing of model output
// ---------------------------------------------------------------------------

describe("normalizeRecommendations", () => {
  it("normalises -, *, numbered and existing bullets to •", () => {
    expect(
      normalizeRecommendations("- Tank is sound.\n* Replace baffle.\n1. Re-inspect.\n•  Pump."),
    ).toBe("• Tank is sound.\n• Replace baffle.\n• Re-inspect.\n• Pump.");
  });

  it("drops blank lines and surrounding whitespace", () => {
    expect(normalizeRecommendations("\n  • A  \n\n\n• B\n")).toBe("• A\n• B");
  });

  it("keeps at most 5 lines", () => {
    expect(normalizeRecommendations("1\n2\n3\n4\n5\n6\n7")).toBe("• 1\n• 2\n• 3\n• 4\n• 5");
  });

  it("truncates to 80 words across lines", () => {
    const seventyNine = Array.from({ length: 79 }, () => "a").join(" ");
    expect(normalizeRecommendations(`${seventyNine}\nb c d`)).toBe(`• ${seventyNine}\n• b`);

    const hundred = Array.from({ length: 100 }, (_, i) => `w${i + 1}`).join(" ");
    const out = normalizeRecommendations(hundred);
    expect(out.startsWith("• w1 ")).toBe(true);
    expect(out.endsWith(" w80")).toBe(true);
    expect(out).not.toContain("w81");
  });

  it("returns the fallback line when nothing is left", () => {
    expect(normalizeRecommendations("")).toBe(FALLBACK_RECOMMENDATION);
    expect(normalizeRecommendations("   \n \t \n")).toBe(FALLBACK_RECOMMENDATION);
    expect(normalizeRecommendations("- \n• ")).toBe(FALLBACK_RECOMMENDATION);
  });
});

// ---------------------------------------------------------------------------
// draftRecommendations — the model call
// ---------------------------------------------------------------------------

describe("draftRecommendations", () => {
  const ctx: RecommendationContext = {
    ...EMPTY_CONTEXT,
    septicTankComments: "Inlet baffle is deteriorated.",
    tanks: [{ compromisedTank: "no", deficiencies: ["Damaged Inlet"] }],
  };

  it("calls claude-sonnet-4-6 with a cached system prompt and the formatted input", async () => {
    mockCreate.mockResolvedValueOnce(mockResponse("• Replace the inlet baffle."));

    await draftRecommendations(ctx);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const args = mockCreate.mock.calls[0][0];
    expect(args.model).toBe("claude-sonnet-4-6");
    expect(args.max_tokens).toBe(300);
    expect(args.system).toHaveLength(1);
    expect(args.system[0].type).toBe("text");
    expect(args.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(args.system[0].text).toContain("Start every line with \"• \"");
    expect(args.messages).toEqual([{ role: "user", content: formatRecommendationInput(ctx) }]);
    expect(mockCreate.mock.calls[0][1]).toEqual({ timeout: 20000, maxRetries: 1 });
  });

  it("normalises the model output", async () => {
    mockCreate.mockResolvedValueOnce(
      mockResponse("- Replace the inlet baffle.\n- Pump every 3–5 years."),
    );

    await expect(draftRecommendations(ctx)).resolves.toBe(
      "• Replace the inlet baffle.\n• Pump every 3–5 years.",
    );
  });

  it("returns the fallback without calling the model when there is nothing actionable", async () => {
    await expect(draftRecommendations(EMPTY_CONTEXT)).resolves.toBe(FALLBACK_RECOMMENDATION);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns the fallback when the model returns no text block", async () => {
    mockCreate.mockResolvedValueOnce({ content: [] });

    await expect(draftRecommendations(ctx)).resolves.toBe(FALLBACK_RECOMMENDATION);
  });

  it("propagates API errors to the caller", async () => {
    mockCreate.mockRejectedValueOnce(new Error("overloaded"));

    await expect(draftRecommendations(ctx)).rejects.toThrow("overloaded");
  });

  it("never sends names, addresses or identifiers to the model", async () => {
    mockCreate.mockResolvedValueOnce(mockResponse("• Fine."));

    await draftRecommendations(buildRecommendationContext(PII_FORM));

    const sent = JSON.stringify(mockCreate.mock.calls[0][0]);
    for (const pii of PII_STRINGS) {
      expect(sent).not.toContain(pii);
    }
  });
});
