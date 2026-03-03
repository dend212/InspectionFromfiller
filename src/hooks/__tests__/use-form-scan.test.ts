import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { UseFormReturn } from "react-hook-form";
import type { InspectionFormData } from "@/types/inspection";
import type { ScanResult } from "@/lib/ai/scan-types";
import { useFormScan } from "@/hooks/use-form-scan";

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Import the mocked toast so we can assert on it
import { toast } from "sonner";

// ── Helpers ────────────────────────────────────────────────────────────────────

const makeImage = (id: number) => ({
  storagePath: `images/scan-${id}.jpg`,
  previewUrl: `blob:http://localhost/${id}`,
  fileName: `scan-${id}.jpg`,
});

const makeScanResult = (
  overrides: Partial<ScanResult> = {},
): ScanResult => ({
  fields: [
    {
      fieldPath: "facilityInfo.facilityName",
      value: "Test Facility",
      confidence: 0.95,
      source: "Page 1",
    },
    {
      fieldPath: "facilityInfo.address",
      value: "123 Main St",
      confidence: 0.5,
      source: "Page 1",
    },
    {
      fieldPath: "septicTank.tanks[0].capacity",
      value: "1000",
      confidence: 0.9,
      source: "Page 2",
    },
  ],
  metadata: {
    pagesProcessed: 2,
    totalFieldsExtracted: 3,
    processingTimeMs: 1200,
  },
  ...overrides,
});

const makeMockForm = () =>
  ({
    setValue: vi.fn(),
    getValues: vi.fn().mockReturnValue([]),
  }) as unknown as UseFormReturn<InspectionFormData>;

function mockFetchSuccess(result: ScanResult) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(result),
    }),
  );
}

function mockFetchError(status: number, body?: { error: string }) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      json: () => Promise.resolve(body ?? { error: "Scan failed" }),
    }),
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("useFormScan", () => {
  // ---------- Initial state ----------

  describe("initial state", () => {
    it("starts in idle state with empty collections", () => {
      const { result } = renderHook(() => useFormScan());

      expect(result.current.state).toBe("idle");
      expect(result.current.uploadedImages).toEqual([]);
      expect(result.current.scanResult).toBeNull();
      expect(result.current.selectedFields.size).toBe(0);
      expect(result.current.error).toBeNull();
    });
  });

  // ---------- addUploadedImage ----------

  describe("addUploadedImage", () => {
    it("appends an image to the list", () => {
      const { result } = renderHook(() => useFormScan());

      act(() => result.current.addUploadedImage(makeImage(1)));

      expect(result.current.uploadedImages).toHaveLength(1);
      expect(result.current.uploadedImages[0].storagePath).toBe(
        "images/scan-1.jpg",
      );
    });

    it("accumulates multiple images", () => {
      const { result } = renderHook(() => useFormScan());

      act(() => result.current.addUploadedImage(makeImage(1)));
      act(() => result.current.addUploadedImage(makeImage(2)));

      expect(result.current.uploadedImages).toHaveLength(2);
    });
  });

  // ---------- removeUploadedImage ----------

  describe("removeUploadedImage", () => {
    it("removes an image by storagePath", () => {
      const { result } = renderHook(() => useFormScan());

      act(() => result.current.addUploadedImage(makeImage(1)));
      act(() => result.current.addUploadedImage(makeImage(2)));
      act(() => result.current.removeUploadedImage("images/scan-1.jpg"));

      expect(result.current.uploadedImages).toHaveLength(1);
      expect(result.current.uploadedImages[0].storagePath).toBe(
        "images/scan-2.jpg",
      );
    });

    it("does nothing when storagePath is not found", () => {
      const { result } = renderHook(() => useFormScan());

      act(() => result.current.addUploadedImage(makeImage(1)));
      act(() =>
        result.current.removeUploadedImage("images/nonexistent.jpg"),
      );

      expect(result.current.uploadedImages).toHaveLength(1);
    });
  });

  // ---------- toggleField ----------

  describe("toggleField", () => {
    it("adds a field when not selected", () => {
      const { result } = renderHook(() => useFormScan());

      act(() => result.current.toggleField("facilityInfo.facilityName"));

      expect(
        result.current.selectedFields.has("facilityInfo.facilityName"),
      ).toBe(true);
    });

    it("removes a field when already selected", () => {
      const { result } = renderHook(() => useFormScan());

      act(() => result.current.toggleField("facilityInfo.facilityName"));
      act(() => result.current.toggleField("facilityInfo.facilityName"));

      expect(
        result.current.selectedFields.has("facilityInfo.facilityName"),
      ).toBe(false);
      expect(result.current.selectedFields.size).toBe(0);
    });
  });

  // ---------- selectAllHighConfidence ----------

  describe("selectAllHighConfidence", () => {
    it("does nothing when there is no scan result", () => {
      const { result } = renderHook(() => useFormScan());

      act(() => result.current.selectAllHighConfidence());

      expect(result.current.selectedFields.size).toBe(0);
    });

    it("selects only fields with confidence >= 0.8", async () => {
      const scanResult = makeScanResult();
      mockFetchSuccess(scanResult);

      const { result } = renderHook(() => useFormScan());

      // Upload an image so startScan proceeds
      act(() => result.current.addUploadedImage(makeImage(1)));
      await act(() => result.current.startScan("test-123"));

      // Clear selections first, then re-select high confidence
      act(() => result.current.clearAllSelections());
      act(() => result.current.selectAllHighConfidence());

      // facilityInfo.facilityName (0.95) and septicTank.tanks[0].capacity (0.9) should be selected
      // facilityInfo.address (0.5) should NOT be selected
      expect(result.current.selectedFields.size).toBe(2);
      expect(
        result.current.selectedFields.has("facilityInfo.facilityName"),
      ).toBe(true);
      expect(
        result.current.selectedFields.has("septicTank.tanks[0].capacity"),
      ).toBe(true);
      expect(
        result.current.selectedFields.has("facilityInfo.address"),
      ).toBe(false);
    });
  });

  // ---------- clearAllSelections ----------

  describe("clearAllSelections", () => {
    it("empties the selected fields set", () => {
      const { result } = renderHook(() => useFormScan());

      act(() => result.current.toggleField("a.b"));
      act(() => result.current.toggleField("c.d"));
      expect(result.current.selectedFields.size).toBe(2);

      act(() => result.current.clearAllSelections());

      expect(result.current.selectedFields.size).toBe(0);
    });
  });

  // ---------- applyFields ----------

  describe("applyFields", () => {
    it("calls form.setValue for each selected field", async () => {
      const scanResult = makeScanResult();
      mockFetchSuccess(scanResult);

      const { result } = renderHook(() => useFormScan());
      const mockForm = makeMockForm();

      act(() => result.current.addUploadedImage(makeImage(1)));
      await act(() => result.current.startScan("test-123"));

      // Only high-confidence fields are auto-selected (facilityName + tanks[0].capacity)
      act(() => result.current.applyFields(mockForm));

      expect(mockForm.setValue).toHaveBeenCalled();
    });

    it("handles tank array fields with septicTank.tanks[N].fieldName pattern", async () => {
      const scanResult = makeScanResult();
      mockFetchSuccess(scanResult);

      const { result } = renderHook(() => useFormScan());
      const mockForm = makeMockForm();

      act(() => result.current.addUploadedImage(makeImage(1)));
      await act(() => result.current.startScan("test-123"));

      act(() => result.current.applyFields(mockForm));

      // Tank field should call getValues for the current tanks array
      expect(mockForm.getValues).toHaveBeenCalledWith("septicTank.tanks");
      // Then setValue on septicTank.tanks with the modified array
      expect(mockForm.setValue).toHaveBeenCalledWith(
        "septicTank.tanks",
        expect.arrayContaining([
          expect.objectContaining({ capacity: "1000" }),
        ]),
        { shouldDirty: true },
      );
    });

    it("calls form.setValue with shouldValidate for standard dotted paths", async () => {
      const scanResult = makeScanResult();
      mockFetchSuccess(scanResult);

      const { result } = renderHook(() => useFormScan());
      const mockForm = makeMockForm();

      act(() => result.current.addUploadedImage(makeImage(1)));
      await act(() => result.current.startScan("test-123"));

      act(() => result.current.applyFields(mockForm));

      expect(mockForm.setValue).toHaveBeenCalledWith(
        "facilityInfo.facilityName",
        "Test Facility",
        { shouldDirty: true, shouldValidate: true },
      );
    });

    it("shows a toast with the count of applied fields", async () => {
      const scanResult = makeScanResult();
      mockFetchSuccess(scanResult);

      const { result } = renderHook(() => useFormScan());
      const mockForm = makeMockForm();

      act(() => result.current.addUploadedImage(makeImage(1)));
      await act(() => result.current.startScan("test-123"));

      act(() => result.current.applyFields(mockForm));

      // 2 high-confidence fields auto-selected
      expect(toast.success).toHaveBeenCalledWith(
        "2 fields applied from scan",
      );
    });

    it("shows singular toast text for 1 field", async () => {
      const scanResult = makeScanResult({
        fields: [
          {
            fieldPath: "facilityInfo.facilityName",
            value: "Only One",
            confidence: 0.95,
            source: "Page 1",
          },
        ],
      });
      mockFetchSuccess(scanResult);

      const { result } = renderHook(() => useFormScan());
      const mockForm = makeMockForm();

      act(() => result.current.addUploadedImage(makeImage(1)));
      await act(() => result.current.startScan("test-123"));

      act(() => result.current.applyFields(mockForm));

      expect(toast.success).toHaveBeenCalledWith(
        "1 field applied from scan",
      );
    });

    it("sets state to done", async () => {
      const scanResult = makeScanResult();
      mockFetchSuccess(scanResult);

      const { result } = renderHook(() => useFormScan());
      const mockForm = makeMockForm();

      act(() => result.current.addUploadedImage(makeImage(1)));
      await act(() => result.current.startScan("test-123"));
      act(() => result.current.applyFields(mockForm));

      expect(result.current.state).toBe("done");
    });

    it("does nothing when scanResult is null", () => {
      const { result } = renderHook(() => useFormScan());
      const mockForm = makeMockForm();

      // Clear any accumulated calls from prior tests
      vi.mocked(toast.success).mockClear();

      act(() => result.current.applyFields(mockForm));

      expect(mockForm.setValue).not.toHaveBeenCalled();
      expect(toast.success).not.toHaveBeenCalled();
    });
  });

  // ---------- startScan ----------

  describe("startScan", () => {
    it("sets error and returns early if no images uploaded", async () => {
      const { result } = renderHook(() => useFormScan());

      await act(() => result.current.startScan("test-123"));

      expect(result.current.error).toBe(
        "Upload at least one image to scan",
      );
      expect(result.current.state).toBe("idle");
    });

    it("transitions to scanning then reviewing on success", async () => {
      const scanResult = makeScanResult();
      mockFetchSuccess(scanResult);

      const { result } = renderHook(() => useFormScan());

      act(() => result.current.addUploadedImage(makeImage(1)));
      await act(() => result.current.startScan("test-123"));

      expect(result.current.state).toBe("reviewing");
      expect(result.current.scanResult).toEqual(scanResult);
      expect(result.current.error).toBeNull();
    });

    it("auto-selects high-confidence fields on success", async () => {
      const scanResult = makeScanResult();
      mockFetchSuccess(scanResult);

      const { result } = renderHook(() => useFormScan());

      act(() => result.current.addUploadedImage(makeImage(1)));
      await act(() => result.current.startScan("test-123"));

      expect(result.current.selectedFields.size).toBe(2);
      expect(
        result.current.selectedFields.has("facilityInfo.facilityName"),
      ).toBe(true);
      expect(
        result.current.selectedFields.has("septicTank.tanks[0].capacity"),
      ).toBe(true);
      expect(
        result.current.selectedFields.has("facilityInfo.address"),
      ).toBe(false);
    });

    it("sends correct request to the scan API", async () => {
      const scanResult = makeScanResult();
      mockFetchSuccess(scanResult);

      const { result } = renderHook(() => useFormScan());

      act(() => result.current.addUploadedImage(makeImage(1)));
      act(() => result.current.addUploadedImage(makeImage(2)));
      await act(() => result.current.startScan("insp-456"));

      expect(fetch).toHaveBeenCalledWith("/api/inspections/insp-456/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storagePaths: ["images/scan-1.jpg", "images/scan-2.jpg"],
        }),
      });
    });

    it("sets error and returns to uploading state on fetch failure", async () => {
      mockFetchError(500, { error: "Internal server error" });

      const { result } = renderHook(() => useFormScan());

      act(() => result.current.addUploadedImage(makeImage(1)));
      await act(() => result.current.startScan("test-123"));

      expect(result.current.state).toBe("uploading");
      expect(result.current.error).toBe("Internal server error");
      expect(result.current.scanResult).toBeNull();
    });

    it("handles error response without JSON body", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 502,
          json: () => Promise.reject(new Error("not json")),
        }),
      );

      const { result } = renderHook(() => useFormScan());

      act(() => result.current.addUploadedImage(makeImage(1)));
      await act(() => result.current.startScan("test-123"));

      expect(result.current.state).toBe("uploading");
      expect(result.current.error).toBe("Scan failed");
    });

    it("handles network error", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new Error("Network error")),
      );

      const { result } = renderHook(() => useFormScan());

      act(() => result.current.addUploadedImage(makeImage(1)));
      await act(() => result.current.startScan("test-123"));

      expect(result.current.state).toBe("uploading");
      expect(result.current.error).toBe("Network error");
    });
  });

  // ---------- reset ----------

  describe("reset", () => {
    it("resets everything back to initial state", async () => {
      const scanResult = makeScanResult();
      mockFetchSuccess(scanResult);

      const { result } = renderHook(() => useFormScan());

      // Build up some state
      act(() => result.current.addUploadedImage(makeImage(1)));
      await act(() => result.current.startScan("test-123"));

      // Verify we have state
      expect(result.current.state).toBe("reviewing");
      expect(result.current.uploadedImages).toHaveLength(1);
      expect(result.current.scanResult).not.toBeNull();
      expect(result.current.selectedFields.size).toBeGreaterThan(0);

      // Reset
      act(() => result.current.reset());

      expect(result.current.state).toBe("idle");
      expect(result.current.uploadedImages).toEqual([]);
      expect(result.current.scanResult).toBeNull();
      expect(result.current.selectedFields.size).toBe(0);
      expect(result.current.error).toBeNull();
    });
  });
});
