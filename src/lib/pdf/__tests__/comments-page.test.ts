import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock dependencies
// vi.mock factories are hoisted so we cannot reference top-level variables.
// ---------------------------------------------------------------------------

vi.mock("@/lib/pdf/load-public-file", () => ({
  loadPublicFile: vi.fn().mockResolvedValue(new ArrayBuffer(100)),
}));

// We use vi.hoisted to declare the mock fn so it's available inside the
// hoisted vi.mock factory.
const { mockGenerate } = vi.hoisted(() => ({
  mockGenerate: vi.fn().mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46])),
}));

vi.mock("@pdfme/generator", () => ({
  generate: mockGenerate,
}));

vi.mock("@pdfme/schemas", () => ({
  text: { type: "text" },
}));

import { buildCommentsPage, type OverflowSection } from "@/lib/pdf/comments-page";
import { loadPublicFile } from "@/lib/pdf/load-public-file";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildCommentsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-set default mock implementation after clearAllMocks
    mockGenerate.mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  });

  it("returns null when given an empty array", async () => {
    const result = await buildCommentsPage([]);
    expect(result).toBeNull();
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("returns a Uint8Array when given overflow sections", async () => {
    const sections: OverflowSection[] = [
      { section: "Design Flow", fieldName: "designFlowComments", text: "Some long text here" },
    ];
    const result = await buildCommentsPage(sections);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result).not.toBeNull();
  });

  it("loads fonts and passes them to generate", async () => {
    // Font loading uses a module-level cache, so fonts may have been loaded
    // by a prior test in this suite. We verify that generate received the
    // font configuration regardless of caching.
    const sections: OverflowSection[] = [
      { section: "Septic Tank", fieldName: "septicTankComments", text: "Comment text" },
    ];
    await buildCommentsPage(sections);

    const call = mockGenerate.mock.calls[0][0];
    expect(call.options.font).toBeDefined();
    expect(call.options.font.LiberationSans).toBeDefined();
    expect(call.options.font.LiberationSansBold).toBeDefined();
    expect(call.options.font.LiberationSans.data).toBeDefined();
    expect(call.options.font.LiberationSansBold.data).toBeDefined();
  });

  it("calls generate with correct template structure for single section", async () => {
    const sections: OverflowSection[] = [
      { section: "Design Flow", fieldName: "designFlowComments", text: "Test comment" },
    ];
    await buildCommentsPage(sections);

    expect(mockGenerate).toHaveBeenCalledOnce();
    const call = mockGenerate.mock.calls[0][0];

    // Should have a template with schemas
    expect(call.template).toBeDefined();
    expect(call.template.schemas).toBeDefined();
    expect(call.template.schemas).toHaveLength(1); // Array of schema arrays (one page)

    // Should have inputs
    expect(call.inputs).toHaveLength(1);
    const input = call.inputs[0];

    // Should contain the title
    expect(input.commentsTitle).toBe("Inspector Comments (Continued)");

    // Should contain the section heading and body
    expect(input.commentHeading_0).toBe("Design Flow Comments");
    expect(input.commentBody_0).toBe("Test comment");
  });

  it("handles multiple overflow sections", async () => {
    const sections: OverflowSection[] = [
      { section: "Design Flow", fieldName: "designFlowComments", text: "Flow comment" },
      { section: "Septic Tank", fieldName: "septicTankComments", text: "Tank comment" },
      { section: "Disposal Works", fieldName: "disposalWorksComments", text: "Disposal comment" },
    ];
    await buildCommentsPage(sections);

    const call = mockGenerate.mock.calls[0][0];
    const input = call.inputs[0];

    expect(input.commentHeading_0).toBe("Design Flow Comments");
    expect(input.commentBody_0).toBe("Flow comment");
    expect(input.commentHeading_1).toBe("Septic Tank Comments");
    expect(input.commentBody_1).toBe("Tank comment");
    expect(input.commentHeading_2).toBe("Disposal Works Comments");
    expect(input.commentBody_2).toBe("Disposal comment");
  });

  it("generates correct schema entries for each section", async () => {
    const sections: OverflowSection[] = [
      { section: "Design Flow", fieldName: "designFlowComments", text: "Test" },
    ];
    await buildCommentsPage(sections);

    const call = mockGenerate.mock.calls[0][0];
    const schemas = call.template.schemas[0];

    // Should have: title + heading + body = 3 schemas
    expect(schemas.length).toBe(3);

    // Title schema
    expect(schemas[0].name).toBe("commentsTitle");
    expect(schemas[0].type).toBe("text");
    expect(schemas[0].fontSize).toBe(14);
    expect(schemas[0].fontName).toBe("LiberationSansBold");
    expect(schemas[0].alignment).toBe("center");

    // Heading schema
    expect(schemas[1].name).toBe("commentHeading_0");
    expect(schemas[1].type).toBe("text");
    expect(schemas[1].fontSize).toBe(12);
    expect(schemas[1].fontName).toBe("LiberationSansBold");

    // Body schema
    expect(schemas[2].name).toBe("commentBody_0");
    expect(schemas[2].type).toBe("text");
    expect(schemas[2].fontSize).toBe(10);
    expect(schemas[2].fontName).toBe("LiberationSans");
  });

  it("uses blank US Letter page as basePdf", async () => {
    const sections: OverflowSection[] = [
      { section: "Test", fieldName: "test", text: "x" },
    ];
    await buildCommentsPage(sections);

    const call = mockGenerate.mock.calls[0][0];
    expect(call.template.basePdf).toEqual({
      width: 215.9,
      height: 279.4,
      padding: [10, 10, 10, 10],
    });
  });

  it("handles special characters in comment text", async () => {
    const sections: OverflowSection[] = [
      {
        section: "Design Flow",
        fieldName: "designFlowComments",
        text: "Tank O'Brien & Sons — test\u2122 <script>alert('xss')</script>",
      },
    ];
    await buildCommentsPage(sections);

    const call = mockGenerate.mock.calls[0][0];
    expect(call.inputs[0].commentBody_0).toBe(
      "Tank O'Brien & Sons — test\u2122 <script>alert('xss')</script>",
    );
  });

  it("handles very long comment text", async () => {
    const longText = "A".repeat(2000);
    const sections: OverflowSection[] = [
      { section: "Septic Tank", fieldName: "septicTankComments", text: longText },
    ];
    await buildCommentsPage(sections);

    const call = mockGenerate.mock.calls[0][0];
    expect(call.inputs[0].commentBody_0).toBe(longText);

    // Height should be capped at maxCommentHeight (180mm)
    const bodySchema = call.template.schemas[0].find(
      (s: { name: string }) => s.name === "commentBody_0",
    );
    expect(bodySchema.height).toBeLessThanOrEqual(180);
  });

  it("calculates comment height proportional to text length", async () => {
    // Short text (200 chars) should get base height (40mm)
    const shortSections: OverflowSection[] = [
      { section: "Test", fieldName: "test", text: "A".repeat(200) },
    ];
    await buildCommentsPage(shortSections);
    const shortCall = mockGenerate.mock.calls[0][0];
    const shortBody = shortCall.template.schemas[0].find(
      (s: { name: string }) => s.name === "commentBody_0",
    );
    const shortHeight = shortBody.height;

    // Longer text should get more height
    vi.clearAllMocks();
    mockGenerate.mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    const longSections: OverflowSection[] = [
      { section: "Test", fieldName: "test", text: "A".repeat(800) },
    ];
    await buildCommentsPage(longSections);
    const longCall = mockGenerate.mock.calls[0][0];
    const longBody = longCall.template.schemas[0].find(
      (s: { name: string }) => s.name === "commentBody_0",
    );
    const longHeight = longBody.height;

    expect(longHeight).toBeGreaterThan(shortHeight);
  });

  it("passes font config to generate", async () => {
    const sections: OverflowSection[] = [
      { section: "Test", fieldName: "test", text: "x" },
    ];
    await buildCommentsPage(sections);

    const call = mockGenerate.mock.calls[0][0];
    expect(call.options).toBeDefined();
    expect(call.options.font).toBeDefined();
    expect(call.options.font.LiberationSans).toBeDefined();
    expect(call.options.font.LiberationSansBold).toBeDefined();
    expect(call.options.font.LiberationSans.fallback).toBe(true);
  });

  it("passes text plugin to generate", async () => {
    const sections: OverflowSection[] = [
      { section: "Test", fieldName: "test", text: "x" },
    ];
    await buildCommentsPage(sections);

    const call = mockGenerate.mock.calls[0][0];
    expect(call.plugins).toBeDefined();
    expect(call.plugins.text).toBeDefined();
  });

  it("handles unicode text in comments", async () => {
    const sections: OverflowSection[] = [
      {
        section: "Design Flow",
        fieldName: "designFlowComments",
        text: "Jos\u00e9 Garc\u00eda \u2014 tanque s\u00e9ptico est\u00e1 funcionando correctamente. \u65e5\u672c\u8a9e\u30c6\u30b9\u30c8",
      },
    ];
    await buildCommentsPage(sections);

    const call = mockGenerate.mock.calls[0][0];
    expect(call.inputs[0].commentBody_0).toContain("Jos\u00e9 Garc\u00eda");
    expect(call.inputs[0].commentBody_0).toContain("\u65e5\u672c\u8a9e\u30c6\u30b9\u30c8");
  });

  it("handles empty text in overflow section", async () => {
    const sections: OverflowSection[] = [
      { section: "Design Flow", fieldName: "designFlowComments", text: "" },
    ];
    const result = await buildCommentsPage(sections);
    expect(result).not.toBeNull();

    const call = mockGenerate.mock.calls[0][0];
    expect(call.inputs[0].commentBody_0).toBe("");
  });
});
