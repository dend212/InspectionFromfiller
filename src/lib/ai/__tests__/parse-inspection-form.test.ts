import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Anthropic SDK before importing the module under test
vi.mock("@anthropic-ai/sdk", () => {
  const createMock = vi.fn();
  return {
    default: class Anthropic {
      messages = { create: createMock };
    },
    __mockCreate: createMock,
  };
});

// Also mock the scan-prompt module so tests don't depend on real prompt content
vi.mock("@/lib/ai/scan-prompt", () => ({
  SCAN_SYSTEM_PROMPT: "mock system prompt",
  FIELD_CATALOG: "mock field catalog",
}));

import { parseInspectionForm } from "@/lib/ai/parse-inspection-form";

// Grab the mock function so we can configure per-test responses
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockCreate: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  const mod = await import("@anthropic-ai/sdk");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockCreate = (mod as any).__mockCreate;
  mockCreate.mockReset();
});

/** Helper to build a mock Anthropic response from a text string */
function mockResponse(text: string) {
  return {
    content: [{ type: "text", text }],
  };
}

/** Helper to build a minimal valid image input */
function dummyImages(count = 1) {
  return Array.from({ length: count }, () => ({
    data: Buffer.from("fake-image-data"),
    mediaType: "image/jpeg" as const,
  }));
}

// ---------------------------------------------------------------------------
// 1. Enum normalization (tested indirectly through parseInspectionForm)
// ---------------------------------------------------------------------------
describe("enum normalization", () => {
  it("normalizes 'Pre-cast Concrete' tankMaterial to 'precast_concrete'", async () => {
    mockCreate.mockResolvedValueOnce(
      mockResponse(
        JSON.stringify({
          fields: [
            {
              fieldPath: "septicTank.tanks[0].tankMaterial",
              value: "Pre-cast Concrete",
              confidence: 0.9,
              source: "Page 1",
            },
          ],
        }),
      ),
    );

    const result = await parseInspectionForm(dummyImages());
    expect(result.fields[0].value).toBe("precast_concrete");
  });

  it("normalizes condition fields (e.g. supplyLineCondition)", async () => {
    mockCreate.mockResolvedValueOnce(
      mockResponse(
        JSON.stringify({
          fields: [
            {
              fieldPath: "disposalWorks.supplyLineCondition",
              value: "Operational With Concerns",
              confidence: 0.85,
              source: "Page 2",
            },
          ],
        }),
      ),
    );

    const result = await parseInspectionForm(dummyImages());
    expect(result.fields[0].value).toBe("operational_with_concerns");
  });

  it("routes *BaffleCondition fields through the baffleCondition map", async () => {
    mockCreate.mockResolvedValueOnce(
      mockResponse(
        JSON.stringify({
          fields: [
            {
              fieldPath: "septicTank.tanks[0].inletBaffleCondition",
              value: "Present - Operational",
              confidence: 0.95,
              source: "Page 1",
            },
            {
              fieldPath: "septicTank.tanks[0].outletBaffleCondition",
              value: "Present - Not Operational",
              confidence: 0.9,
              source: "Page 1",
            },
            {
              fieldPath: "septicTank.tanks[0].interiorBaffleCondition",
              value: "Not Present",
              confidence: 0.85,
              source: "Page 1",
            },
          ],
        }),
      ),
    );

    const result = await parseInspectionForm(dummyImages());
    expect(result.fields[0].value).toBe("present_operational");
    expect(result.fields[1].value).toBe("present_not_operational");
    expect(result.fields[2].value).toBe("not_present");
  });

  it("passes through unknown baffleCondition values unchanged", async () => {
    mockCreate.mockResolvedValueOnce(
      mockResponse(
        JSON.stringify({
          fields: [
            {
              fieldPath: "septicTank.tanks[0].inletBaffleCondition",
              value: "some unknown value",
              confidence: 0.95,
              source: "Page 1",
            },
          ],
        }),
      ),
    );

    const result = await parseInspectionForm(dummyImages());
    expect(result.fields[0].value).toBe("some unknown value");
  });

  it("normalizes waterSource values", async () => {
    mockCreate.mockResolvedValueOnce(
      mockResponse(
        JSON.stringify({
          fields: [
            {
              fieldPath: "facilityInfo.waterSource",
              value: "Private Water Company",
              confidence: 0.9,
              source: "Page 1",
            },
          ],
        }),
      ),
    );

    const result = await parseInspectionForm(dummyImages());
    expect(result.fields[0].value).toBe("private_company");
  });

  it("normalizes occupancyType values", async () => {
    mockCreate.mockResolvedValueOnce(
      mockResponse(
        JSON.stringify({
          fields: [
            {
              fieldPath: "facilityInfo.occupancyType",
              value: "Seasonal/Part Time",
              confidence: 0.85,
              source: "Page 1",
            },
          ],
        }),
      ),
    );

    const result = await parseInspectionForm(dummyImages());
    expect(result.fields[0].value).toBe("seasonal");
  });

  it("normalizes facilityType values", async () => {
    mockCreate.mockResolvedValueOnce(
      mockResponse(
        JSON.stringify({
          fields: [
            {
              fieldPath: "facilityInfo.facilityType",
              value: "Single Family Residence",
              confidence: 0.9,
              source: "Page 1",
            },
          ],
        }),
      ),
    );

    const result = await parseInspectionForm(dummyImages());
    expect(result.fields[0].value).toBe("single_family");
  });

  it("normalizes disposalType values", async () => {
    mockCreate.mockResolvedValueOnce(
      mockResponse(
        JSON.stringify({
          fields: [
            {
              fieldPath: "disposalWorks.disposalType",
              value: "Seepage Pit",
              confidence: 0.8,
              source: "Page 2",
            },
          ],
        }),
      ),
    );

    const result = await parseInspectionForm(dummyImages());
    expect(result.fields[0].value).toBe("seepage_pit");
  });

  it("normalizes capacityBasis values", async () => {
    mockCreate.mockResolvedValueOnce(
      mockResponse(
        JSON.stringify({
          fields: [
            {
              fieldPath: "septicTank.tanks[0].capacityBasis",
              value: "Capacity Not Determined",
              confidence: 0.7,
              source: "Page 1",
            },
          ],
        }),
      ),
    );

    const result = await parseInspectionForm(dummyImages());
    expect(result.fields[0].value).toBe("not_determined");
  });

  it("normalizes designFlowBasis values", async () => {
    mockCreate.mockResolvedValueOnce(
      mockResponse(
        JSON.stringify({
          fields: [
            {
              fieldPath: "designFlow.designFlowBasis",
              value: "Calculated Or Estimated",
              confidence: 0.85,
              source: "Page 2",
            },
          ],
        }),
      ),
    );

    const result = await parseInspectionForm(dummyImages());
    expect(result.fields[0].value).toBe("calculated");
  });

  it("normalizes actualFlowEvaluation values", async () => {
    mockCreate.mockResolvedValueOnce(
      mockResponse(
        JSON.stringify({
          fields: [
            {
              fieldPath: "designFlow.actualFlowEvaluation",
              value: "Actual Flow Did Not Appear To Exceed Design Flow",
              confidence: 0.9,
              source: "Page 2",
            },
          ],
        }),
      ),
    );

    const result = await parseInspectionForm(dummyImages());
    expect(result.fields[0].value).toBe("not_exceed");
  });

  it("normalizes distributionMethod values", async () => {
    mockCreate.mockResolvedValueOnce(
      mockResponse(
        JSON.stringify({
          fields: [
            {
              fieldPath: "disposalWorks.distributionMethod",
              value: "Diversion Valve",
              confidence: 0.8,
              source: "Page 2",
            },
          ],
        }),
      ),
    );

    const result = await parseInspectionForm(dummyImages());
    expect(result.fields[0].value).toBe("diversion_valve");
  });

  it("normalizes baffleMaterial values", async () => {
    mockCreate.mockResolvedValueOnce(
      mockResponse(
        JSON.stringify({
          fields: [
            {
              fieldPath: "septicTank.tanks[0].baffleMaterial",
              value: "Could Not Be Determined",
              confidence: 0.6,
              source: "Page 1",
            },
          ],
        }),
      ),
    );

    const result = await parseInspectionForm(dummyImages());
    expect(result.fields[0].value).toBe("not_determined");
  });

  it("normalizes enum values inside arrays", async () => {
    mockCreate.mockResolvedValueOnce(
      mockResponse(
        JSON.stringify({
          fields: [
            {
              fieldPath: "disposalWorks.distributionMethod",
              value: ["Diversion Valve", "Pressurized"],
              confidence: 0.85,
              source: "Page 2",
            },
          ],
        }),
      ),
    );

    const result = await parseInspectionForm(dummyImages());
    expect(result.fields[0].value).toEqual(["diversion_valve", "pressurized"]);
  });

  it("passes unknown enum values through unchanged", async () => {
    mockCreate.mockResolvedValueOnce(
      mockResponse(
        JSON.stringify({
          fields: [
            {
              fieldPath: "septicTank.tanks[0].tankMaterial",
              value: "UnknownMaterial",
              confidence: 0.5,
              source: "Page 1",
            },
          ],
        }),
      ),
    );

    const result = await parseInspectionForm(dummyImages());
    expect(result.fields[0].value).toBe("UnknownMaterial");
  });

  it("normalizes facilityCounty values", async () => {
    mockCreate.mockResolvedValueOnce(
      mockResponse(
        JSON.stringify({
          fields: [
            {
              fieldPath: "facilityInfo.facilityCounty",
              value: "La Paz",
              confidence: 0.95,
              source: "Page 1",
            },
          ],
        }),
      ),
    );

    const result = await parseInspectionForm(dummyImages());
    expect(result.fields[0].value).toBe("La Paz");
  });
});

// ---------------------------------------------------------------------------
// 2. Field path validation (tested indirectly — invalid paths get filtered)
// ---------------------------------------------------------------------------
describe("field path validation", () => {
  it("accepts valid top-level paths (facilityInfo.*)", async () => {
    mockCreate.mockResolvedValueOnce(
      mockResponse(
        JSON.stringify({
          fields: [
            {
              fieldPath: "facilityInfo.facilityName",
              value: "Test Facility",
              confidence: 0.9,
              source: "Page 1",
            },
          ],
        }),
      ),
    );

    const result = await parseInspectionForm(dummyImages());
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0].fieldPath).toBe("facilityInfo.facilityName");
  });

  it("accepts valid paths for all five prefixes", async () => {
    mockCreate.mockResolvedValueOnce(
      mockResponse(
        JSON.stringify({
          fields: [
            { fieldPath: "facilityInfo.facilityName", value: "Test", confidence: 0.9, source: "p1" },
            { fieldPath: "generalTreatment.systemTypes", value: "septic", confidence: 0.9, source: "p1" },
            { fieldPath: "designFlow.designFlowGpd", value: "300", confidence: 0.9, source: "p1" },
            { fieldPath: "septicTank.numberOfTanks", value: "1", confidence: 0.9, source: "p1" },
            { fieldPath: "disposalWorks.disposalType", value: "trench", confidence: 0.9, source: "p1" },
          ],
        }),
      ),
    );

    const result = await parseInspectionForm(dummyImages());
    expect(result.fields).toHaveLength(5);
  });

  it("accepts tank array paths like septicTank.tanks[0].tankMaterial", async () => {
    mockCreate.mockResolvedValueOnce(
      mockResponse(
        JSON.stringify({
          fields: [
            {
              fieldPath: "septicTank.tanks[0].tankMaterial",
              value: "fiberglass",
              confidence: 0.9,
              source: "Page 1",
            },
            {
              fieldPath: "septicTank.tanks[1].tankMaterial",
              value: "plastic",
              confidence: 0.8,
              source: "Page 1",
            },
          ],
        }),
      ),
    );

    const result = await parseInspectionForm(dummyImages());
    expect(result.fields).toHaveLength(2);
    expect(result.fields[0].fieldPath).toBe("septicTank.tanks[0].tankMaterial");
    expect(result.fields[1].fieldPath).toBe("septicTank.tanks[1].tankMaterial");
  });

  it("filters out invalid paths like 'foo.bar'", async () => {
    mockCreate.mockResolvedValueOnce(
      mockResponse(
        JSON.stringify({
          fields: [
            { fieldPath: "foo.bar", value: "test", confidence: 0.9, source: "p1" },
            { fieldPath: "randomField", value: "test", confidence: 0.9, source: "p1" },
            { fieldPath: "facilityInfo.facilityName", value: "Good One", confidence: 0.9, source: "p1" },
          ],
        }),
      ),
    );

    const result = await parseInspectionForm(dummyImages());
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0].fieldPath).toBe("facilityInfo.facilityName");
  });

  it("filters out fields with missing fieldPath", async () => {
    mockCreate.mockResolvedValueOnce(
      mockResponse(
        JSON.stringify({
          fields: [
            { value: "test", confidence: 0.9, source: "p1" },
            { fieldPath: "", value: "test", confidence: 0.9, source: "p1" },
            { fieldPath: "facilityInfo.ownerName", value: "Valid", confidence: 0.9, source: "p1" },
          ],
        }),
      ),
    );

    const result = await parseInspectionForm(dummyImages());
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0].fieldPath).toBe("facilityInfo.ownerName");
  });
});

// ---------------------------------------------------------------------------
// 3. JSON response parsing
// ---------------------------------------------------------------------------
describe("JSON response parsing", () => {
  it("parses a valid JSON response correctly", async () => {
    mockCreate.mockResolvedValueOnce(
      mockResponse(
        JSON.stringify({
          fields: [
            {
              fieldPath: "facilityInfo.facilityName",
              value: "Test Facility",
              confidence: 0.95,
              source: "Top of page 1",
            },
          ],
        }),
      ),
    );

    const result = await parseInspectionForm(dummyImages());
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0]).toEqual({
      fieldPath: "facilityInfo.facilityName",
      value: "Test Facility",
      confidence: 0.95,
      source: "Top of page 1",
    });
  });

  it("handles markdown-wrapped JSON (```json ... ```)", async () => {
    const json = JSON.stringify({
      fields: [
        {
          fieldPath: "facilityInfo.facilityName",
          value: "Wrapped Facility",
          confidence: 0.9,
          source: "Page 1",
        },
      ],
    });
    mockCreate.mockResolvedValueOnce(mockResponse("```json\n" + json + "\n```"));

    const result = await parseInspectionForm(dummyImages());
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0].value).toBe("Wrapped Facility");
  });

  it("handles bare markdown code block (``` ... ```)", async () => {
    const json = JSON.stringify({
      fields: [
        {
          fieldPath: "facilityInfo.facilityName",
          value: "Bare Block",
          confidence: 0.9,
          source: "Page 1",
        },
      ],
    });
    mockCreate.mockResolvedValueOnce(mockResponse("```\n" + json + "\n```"));

    const result = await parseInspectionForm(dummyImages());
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0].value).toBe("Bare Block");
  });

  it("throws an error for invalid JSON", async () => {
    mockCreate.mockResolvedValueOnce(mockResponse("this is not json at all"));

    await expect(parseInspectionForm(dummyImages())).rejects.toThrow(
      "Failed to parse AI response as JSON",
    );
  });

  it("throws an error when 'fields' array is missing", async () => {
    mockCreate.mockResolvedValueOnce(
      mockResponse(JSON.stringify({ data: "no fields here" })),
    );

    await expect(parseInspectionForm(dummyImages())).rejects.toThrow(
      "AI response missing 'fields' array",
    );
  });

  it("throws an error when 'fields' is not an array", async () => {
    mockCreate.mockResolvedValueOnce(
      mockResponse(JSON.stringify({ fields: "not an array" })),
    );

    await expect(parseInspectionForm(dummyImages())).rejects.toThrow(
      "AI response missing 'fields' array",
    );
  });

  it("throws an error when response has no text block", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "tool_use", id: "x", name: "y", input: {} }],
    });

    await expect(parseInspectionForm(dummyImages())).rejects.toThrow(
      "No text response from AI",
    );
  });

  it("filters out fields with invalid paths", async () => {
    mockCreate.mockResolvedValueOnce(
      mockResponse(
        JSON.stringify({
          fields: [
            { fieldPath: "invalid.path", value: "x", confidence: 0.9, source: "p1" },
            { fieldPath: "facilityInfo.ownerName", value: "Valid Owner", confidence: 0.8, source: "p1" },
          ],
        }),
      ),
    );

    const result = await parseInspectionForm(dummyImages());
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0].value).toBe("Valid Owner");
  });

  it("filters out fields with non-numeric or missing confidence", async () => {
    mockCreate.mockResolvedValueOnce(
      mockResponse(
        JSON.stringify({
          fields: [
            { fieldPath: "facilityInfo.a", value: "x", confidence: "high", source: "p1" },
            { fieldPath: "facilityInfo.b", value: "y", source: "p1" },
            { fieldPath: "facilityInfo.c", value: "z", confidence: 0.9, source: "p1" },
          ],
        }),
      ),
    );

    const result = await parseInspectionForm(dummyImages());
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0].fieldPath).toBe("facilityInfo.c");
  });

  it("clamps confidence scores above 1 down to 1", async () => {
    mockCreate.mockResolvedValueOnce(
      mockResponse(
        JSON.stringify({
          fields: [
            {
              fieldPath: "facilityInfo.facilityName",
              value: "Test",
              confidence: 1.5,
              source: "Page 1",
            },
          ],
        }),
      ),
    );

    const result = await parseInspectionForm(dummyImages());
    expect(result.fields[0].confidence).toBe(1);
  });

  it("clamps confidence scores below 0 up to 0", async () => {
    mockCreate.mockResolvedValueOnce(
      mockResponse(
        JSON.stringify({
          fields: [
            {
              fieldPath: "facilityInfo.facilityName",
              value: "Test",
              confidence: -0.3,
              source: "Page 1",
            },
          ],
        }),
      ),
    );

    const result = await parseInspectionForm(dummyImages());
    expect(result.fields[0].confidence).toBe(0);
  });

  it("defaults source to 'Unknown' when not provided", async () => {
    mockCreate.mockResolvedValueOnce(
      mockResponse(
        JSON.stringify({
          fields: [
            {
              fieldPath: "facilityInfo.facilityName",
              value: "Test",
              confidence: 0.9,
            },
          ],
        }),
      ),
    );

    const result = await parseInspectionForm(dummyImages());
    expect(result.fields[0].source).toBe("Unknown");
  });
});

// ---------------------------------------------------------------------------
// 4. Metadata
// ---------------------------------------------------------------------------
describe("metadata", () => {
  it("returns correct pagesProcessed count", async () => {
    mockCreate.mockResolvedValueOnce(
      mockResponse(JSON.stringify({ fields: [] })),
    );

    const result = await parseInspectionForm(dummyImages(3));
    expect(result.metadata.pagesProcessed).toBe(3);
  });

  it("returns correct totalFieldsExtracted after filtering", async () => {
    mockCreate.mockResolvedValueOnce(
      mockResponse(
        JSON.stringify({
          fields: [
            { fieldPath: "facilityInfo.a", value: "x", confidence: 0.9, source: "p1" },
            { fieldPath: "invalid.path", value: "y", confidence: 0.9, source: "p1" },
            { fieldPath: "facilityInfo.b", value: "z", confidence: 0.8, source: "p1" },
          ],
        }),
      ),
    );

    const result = await parseInspectionForm(dummyImages());
    // Only 2 valid fields after filtering out invalid.path
    expect(result.metadata.totalFieldsExtracted).toBe(2);
  });

  it("returns processingTimeMs as a positive number", async () => {
    mockCreate.mockResolvedValueOnce(
      mockResponse(JSON.stringify({ fields: [] })),
    );

    const result = await parseInspectionForm(dummyImages());
    expect(result.metadata.processingTimeMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.metadata.processingTimeMs).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// 5. Tank array fields
// ---------------------------------------------------------------------------
describe("tank array fields", () => {
  it("validates septicTank.tanks[0].tankMaterial as a valid path", async () => {
    mockCreate.mockResolvedValueOnce(
      mockResponse(
        JSON.stringify({
          fields: [
            {
              fieldPath: "septicTank.tanks[0].tankMaterial",
              value: "fiberglass",
              confidence: 0.9,
              source: "Page 1",
            },
          ],
        }),
      ),
    );

    const result = await parseInspectionForm(dummyImages());
    expect(result.fields).toHaveLength(1);
  });

  it("validates multi-digit tank indices like tanks[12]", async () => {
    mockCreate.mockResolvedValueOnce(
      mockResponse(
        JSON.stringify({
          fields: [
            {
              fieldPath: "septicTank.tanks[12].tankMaterial",
              value: "plastic",
              confidence: 0.9,
              source: "Page 1",
            },
          ],
        }),
      ),
    );

    const result = await parseInspectionForm(dummyImages());
    expect(result.fields).toHaveLength(1);
  });

  it("handles multiple tanks with different indices", async () => {
    mockCreate.mockResolvedValueOnce(
      mockResponse(
        JSON.stringify({
          fields: [
            { fieldPath: "septicTank.tanks[0].tankMaterial", value: "Concrete", confidence: 0.9, source: "p1" },
            { fieldPath: "septicTank.tanks[0].capacityBasis", value: "Volume Pumped", confidence: 0.85, source: "p1" },
            { fieldPath: "septicTank.tanks[1].tankMaterial", value: "fiberglass", confidence: 0.8, source: "p1" },
            { fieldPath: "septicTank.tanks[1].capacityBasis", value: "Estimate", confidence: 0.75, source: "p1" },
          ],
        }),
      ),
    );

    const result = await parseInspectionForm(dummyImages());
    expect(result.fields).toHaveLength(4);
    expect(result.fields[0].value).toBe("precast_concrete");
    expect(result.fields[1].value).toBe("volume_pumped");
    expect(result.fields[2].value).toBe("fiberglass");
    expect(result.fields[3].value).toBe("estimate");
  });

  it("normalizes enum values within tank array fields", async () => {
    mockCreate.mockResolvedValueOnce(
      mockResponse(
        JSON.stringify({
          fields: [
            {
              fieldPath: "septicTank.tanks[0].inletBaffleCondition",
              value: "Present - Operational",
              confidence: 0.85,
              source: "Page 1",
            },
            {
              fieldPath: "septicTank.tanks[0].baffleMaterial",
              value: "Fiberglass",
              confidence: 0.8,
              source: "Page 1",
            },
          ],
        }),
      ),
    );

    const result = await parseInspectionForm(dummyImages());
    // inletBaffleCondition now correctly hits baffleCondition map
    expect(result.fields[0].value).toBe("present_operational");
    expect(result.fields[1].value).toBe("fiberglass");
  });
});

// ---------------------------------------------------------------------------
// 6. Boolean and pass-through values
// ---------------------------------------------------------------------------
describe("non-string value handling", () => {
  it("passes boolean values through without normalization", async () => {
    mockCreate.mockResolvedValueOnce(
      mockResponse(
        JSON.stringify({
          fields: [
            {
              fieldPath: "facilityInfo.someFlag",
              value: true,
              confidence: 0.95,
              source: "Page 1",
            },
          ],
        }),
      ),
    );

    const result = await parseInspectionForm(dummyImages());
    expect(result.fields[0].value).toBe(true);
  });
});
