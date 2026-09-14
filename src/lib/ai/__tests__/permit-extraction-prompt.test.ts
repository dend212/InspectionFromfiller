import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ESCALATION_SYSTEM_PROMPT,
  PERMIT_EXTRACTION_SYSTEM_PROMPT,
  PERMIT_EXTRACTION_VERSION,
  buildEscalationUserMessage,
  buildPassUserMessage,
} from "@/lib/ai/permit-extraction-prompt";
import { FACT_SPECS, WATER_SOURCE_ALIASES, tankFactSpecs } from "@/lib/ai/permit-facts-utils";
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
    expect(p).toContain("never emit issueDate");
    expect(p).toContain("never an application, plan-check, signature, escrow or transfer date");
    expect(p).toMatch(/0\.95.*typed/i);
    expect(p).toMatch(/0\.70.*0\.84/);
    expect(p).toContain("0.50 to 0.69");
    expect(p).toContain("Never invent a value");
    expect(p).toContain("verbatim quote");
    expect(p).toContain("1-based page number");
    expect(p).toContain("isCesspool");
    expect(p).toContain("isAbandonment");
    // documentKind comes from the first page's title, EXCEPT on a later-pages pass, where an
    // approval stamp / DA on any page settles it — must agree with the pass-2 user message
    expect(p).toMatch(/documentKind: from the title of the FIRST page you were given.*except on a later-pages pass/);
    expect(p).toMatch(/later-pages pass.*ANY page you were given.*Approval \/ Authorization to Construct/);
    expect(p).toMatch(/later-pages pass.*county approval stamp.*report that kind/);
    // no template-literal hazards leaked into the text
    expect(p).not.toContain("${");
    expect(p).not.toContain("`");
  });

  it("spells out the waterSource tokens and how a Discharge Authorization's two water fields map onto them", () => {
    // 2026-09-14, OW-15-00667: the DA prints "Water Source: Water Company" beside "Water Source ID #: NNNNN -
    // City Of … Water …"; the model echoed the form's label ("water_company") on 5/5 replays and the wire
    // dropped it. The tokens were never listed for waterSource, unlike material / disposal.type / systemType.
    const p = PERMIT_EXTRACTION_SYSTEM_PROMPT;
    expect(p).toMatch(/- waterSource: one of municipal, private_company, shared_well, private_well, hauled_water\./);
    expect(p.indexOf("- waterSource:")).toBeGreaterThan(-1);
    expect(p.indexOf("- waterSource:")).toBeLessThan(p.indexOf("- systemType:"));
    expect(p).toContain('do not write "water_company", "city" or "well"');
    // the DA's two-field layout, described generically (no real provider string to parrot as evidence)
    expect(p).toMatch(/"Water Source: Water Company" \(or Private Well \/ Shared Well \/ Hauled Water\)/);
    expect(p).toContain('"Water Source ID #: NNNNN - ');
    expect(p).toContain("ADEQ public water system number");
    expect(p).toMatch(/"Shared Well:" blank[^.]*filled only when the well is shared/);
    expect(p).toContain("Bedroom Equivalents");
    expect(p).not.toContain("Scottsdale");
    expect(p).not.toContain("07098");
    // the category rule and the provider-name mapping
    expect(p).toMatch(
      /"Water Company" is the county's category for any piped utility, so decide municipal vs private_company from the provider named in "Water Source ID #"/,
    );
    expect(p).toMatch(/city, town or county utility \(City of X Water[^→]*→ municipal\./);
    // the calibration section governs confidence — the mapping must not dictate a number
    expect(p).not.toMatch(/→ municipal, at 0\.\d/);
    // Sun City / Sun City West are place names, not city utilities (EPCOR serves them)
    expect(p).toMatch(/merely contains "City" \(Sun City, Sun City West\) is not a city utility[^.]*provider actually named/);
    expect(p).toMatch(/Any other named water company or utility \(EPCOR, Arizona Water Company[^→]*→ private_company/);
    expect(p).toMatch(/"water company" box beside a separate "city" box → private_company/);
    expect(p).toMatch(/"Shared Well" checked[^→]*→ shared_well/);
    expect(p).toMatch(/"Private Well", "Domestic Well", "Exempt Well", "Individual Well"[^→]*55-xxxxxx[^→]*→ private_well/);
    expect(p).toMatch(/"Hauled" → hauled_water/);
    expect(p).toMatch(/says only "Water Company" and names no provider, leave waterSource out and say so in notes/);
    expect(p).toContain("Quote the line naming the provider as evidence");
    // the Approval to Construct's checkbox / name-blank presentation
    expect(p).toContain('"Water Company ____ / Private Well ____"');
    expect(p).toContain("an empty blank is a missing fact");
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

describe("PERMIT_EXTRACTION_VERSION", () => {
  it("is bumped together with the extraction contract (system prompt, escalation questions, waterSource aliases)", () => {
    // If this fails, the extraction contract changed — bump PERMIT_EXTRACTION_VERSION and update the hash.
    // D7 reuse replays stored facts only under the current version; a prompt / coercion change that
    // ships without a bump would keep serving facts read under the old contract.
    const contract =
      PERMIT_EXTRACTION_SYSTEM_PROMPT +
      JSON.stringify(FACT_SPECS.map((s) => s.question)) +
      JSON.stringify(WATER_SOURCE_ALIASES);
    const hash = createHash("sha256").update(contract).digest("hex");
    expect({ version: PERMIT_EXTRACTION_VERSION, hash }).toEqual({
      version: "2026-09-14.2",
      hash: "0061e4a415638e55c9c1b93048eb2e5f2fae17f2378f639cb05e0b7d3cbf9bfb",
    });
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
    expect(text).not.toContain("permit identity");
    expect(text).not.toContain("documentKind");
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
    expect(text).toContain("tank capacity / disposal type and/or its permit identity");
    expect(text).toContain("Approval / Authorization to Construct");
    expect(text).toContain("documentKind");
    expect(text).toContain("issueDate");
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
