import { describe, expect, it } from "vitest";
import {
  ESCALATION_SYSTEM_PROMPT,
  PERMIT_EXTRACTION_SYSTEM_PROMPT,
  buildEscalationUserMessage,
  buildPassUserMessage,
} from "@/lib/ai/permit-extraction-prompt";
import { FACT_SPECS, tankFactSpecs } from "@/lib/ai/permit-facts-utils";
import { MAX_WIRE_TANKS } from "@/lib/ai/permit-facts-wire";

describe("PERMIT_EXTRACTION_SYSTEM_PROMPT", () => {
  it("matches the committed snapshot (prompt changes must be deliberate)", () => {
    expect(PERMIT_EXTRACTION_SYSTEM_PROMPT).toMatchSnapshot();
  });

  it("is long enough to be cached on Sonnet 4.6 (≥ 1024 tokens ≈ 4,500 chars)", () => {
    expect(PERMIT_EXTRACTION_SYSTEM_PROMPT.length).toBeGreaterThanOrEqual(4500);
  });

  it("describes the Maricopa ESD layouts, calibration, no-invention and evidence rules", () => {
    const p = PERMIT_EXTRACTION_SYSTEM_PROMPT;
    expect(p).toContain("Approval to Construct Individual Sewage Disposal System");
    expect(p).toContain("General Permits Authorized");
    expect(p).toContain("4.02 A314 Septic Tank Qty 1 Capacity 1250");
    expect(p).toContain("Seepage Pit Qty 2 Overall 28'0\" Effective 24'0\"");
    expect(p).toContain("Inspection Measurements");
    expect(p).toContain("Notice of Transfer");
    expect(p).toContain("CivicPlus");
    expect(p).toMatch(/0\.95.*typed/i);
    expect(p).toMatch(/0\.70.*0\.84/);
    expect(p).toContain("0.50 to 0.69");
    expect(p).toContain("Never invent a value");
    expect(p).toContain("verbatim quote");
    expect(p).toContain("1-based page number");
    expect(p).toContain("isCesspool");
    expect(p).toContain("isAbandonment");
    // no template-literal hazards leaked into the text
    expect(p).not.toContain("${");
    expect(p).not.toContain("`");
  });

  it("names every wire fact path and tells the model to omit, not null, what it cannot find", () => {
    const p = PERMIT_EXTRACTION_SYSTEM_PROMPT;
    for (const { path } of [...FACT_SPECS, ...tankFactSpecs(0)]) expect(p).toContain(path);
    expect(p).toContain(`tanks.${MAX_WIRE_TANKS - 1}.`);
    expect(p).toContain("facts array");
    expect(p).toContain("left out of the array");
    expect(p).not.toMatch(/return null/);
  });
});

describe("buildPassUserMessage", () => {
  const base = {
    permitNumber: "OW-17-00474",
    docType: "PERMIT",
    archive: "edms_env" as const,
    totalPages: 7,
  };

  it("names the page range, archive and EDMS metadata for pass 1", () => {
    const text = buildPassUserMessage({ ...base, pageNumbers: [1, 2, 3, 4], pass: 1 });
    expect(text).toContain("pages 1–4 of a 7-page document");
    expect(text).toContain('permit number "OW-17-00474"');
    expect(text).toContain('document type "PERMIT"');
    expect(text).toContain("env (legacy)");
    expect(text).toContain("1-based within THIS attachment");
    expect(text).not.toContain("did not state a tank capacity");
  });

  it("tells pass 2 why it is being asked and names the eplpav archive", () => {
    const text = buildPassUserMessage({
      ...base,
      archive: "edms_eplpav",
      totalPages: 30,
      pageNumbers: [7, 8, 9],
      pass: 2,
    });
    expect(text).toContain("pages 7–9 of a 30-page document");
    expect(text).toContain("eplpav (Permit Center)");
    expect(text).toContain("did not state a tank capacity or a disposal type");
  });
});

describe("buildEscalationUserMessage", () => {
  it("asks exactly one question and shows the previous weak reading", () => {
    const spec = FACT_SPECS.find((s) => s.path === "designFlowGpd")!;
    const text = buildEscalationUserMessage(spec, { value: 300, confidence: 0.45 });
    expect(text).toContain(spec.question);
    expect(text).toContain('"300"');
    expect(text).toContain("45%");
    expect(text.match(/\?/g)?.length).toBe(1);
  });

  it("omits the previous reading when none exists", () => {
    const spec = FACT_SPECS.find((s) => s.path === "permitNumber")!;
    expect(buildEscalationUserMessage(spec, null)).not.toContain("previous reading");
  });
});

describe("ESCALATION_SYSTEM_PROMPT", () => {
  it("frames a single-page, single-question task with honest confidence", () => {
    expect(ESCALATION_SYSTEM_PROMPT).toContain("ONE question");
    expect(ESCALATION_SYSTEM_PROMPT).toContain("found = false");
    expect(ESCALATION_SYSTEM_PROMPT).toContain("Never guess");
  });
});
