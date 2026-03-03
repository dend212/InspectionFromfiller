import { describe, expect, it } from "vitest";
import {
  AUTO_SELECT_CONFIDENCE,
  type ExtractedField,
  type ScanResult,
} from "@/lib/ai/scan-types";

describe("AUTO_SELECT_CONFIDENCE", () => {
  it("equals 0.8", () => {
    expect(AUTO_SELECT_CONFIDENCE).toBe(0.8);
  });
});

describe("ExtractedField shape", () => {
  it("accepts a string value", () => {
    const field: ExtractedField = {
      fieldPath: "facilityInfo.facilityName",
      value: "Test Facility",
      confidence: 0.95,
      source: "Page 1, top-left header",
    };

    expect(field.fieldPath).toBe("facilityInfo.facilityName");
    expect(field.value).toBe("Test Facility");
    expect(field.confidence).toBe(0.95);
    expect(field.source).toBe("Page 1, top-left header");
  });

  it("accepts a boolean value", () => {
    const field: ExtractedField = {
      fieldPath: "generalTreatment.isOperational",
      value: true,
      confidence: 0.7,
      source: "Page 2, checkbox row",
    };

    expect(field.value).toBe(true);
  });

  it("accepts a string array value", () => {
    const field: ExtractedField = {
      fieldPath: "designFlow.selectedOptions",
      value: ["optionA", "optionB"],
      confidence: 0.85,
      source: "Page 3, multi-select section",
    };

    expect(field.value).toEqual(["optionA", "optionB"]);
    expect(Array.isArray(field.value)).toBe(true);
  });

  it("has confidence between 0 and 1", () => {
    const low: ExtractedField = {
      fieldPath: "a.b",
      value: "x",
      confidence: 0.0,
      source: "s",
    };
    const high: ExtractedField = {
      fieldPath: "a.b",
      value: "x",
      confidence: 1.0,
      source: "s",
    };

    expect(low.confidence).toBeGreaterThanOrEqual(0);
    expect(high.confidence).toBeLessThanOrEqual(1);
  });
});

describe("ScanResult shape", () => {
  it("contains fields array and metadata", () => {
    const result: ScanResult = {
      fields: [
        {
          fieldPath: "facilityInfo.facilityName",
          value: "My Facility",
          confidence: 0.92,
          source: "Page 1",
        },
        {
          fieldPath: "facilityInfo.address",
          value: "123 Main St",
          confidence: 0.6,
          source: "Page 1",
        },
      ],
      metadata: {
        pagesProcessed: 2,
        totalFieldsExtracted: 2,
        processingTimeMs: 1500,
      },
    };

    expect(result.fields).toHaveLength(2);
    expect(result.metadata.pagesProcessed).toBe(2);
    expect(result.metadata.totalFieldsExtracted).toBe(2);
    expect(result.metadata.processingTimeMs).toBe(1500);
  });

  it("supports empty fields array", () => {
    const result: ScanResult = {
      fields: [],
      metadata: {
        pagesProcessed: 1,
        totalFieldsExtracted: 0,
        processingTimeMs: 200,
      },
    };

    expect(result.fields).toHaveLength(0);
    expect(result.metadata.totalFieldsExtracted).toBe(0);
  });
});
