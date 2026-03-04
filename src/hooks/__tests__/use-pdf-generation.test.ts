import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockGenerateReport = vi.fn();
vi.mock("@/lib/pdf/generate-report", () => ({
  generateReport: (...args: any[]) => mockGenerateReport(...args),
}));

import { usePdfGeneration } from "@/hooks/use-pdf-generation";
import type { InspectionFormData } from "@/types/inspection";

// ── Helpers ────────────────────────────────────────────────────────────────────

const makeFormData = (): InspectionFormData =>
  ({
    facilityInfo: { facilityName: "Test" },
  }) as any;

const makePdfBytes = () => new Uint8Array([80, 68, 70]);

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("usePdfGeneration", () => {
  describe("initial state", () => {
    it("starts with null pdfData, not generating, no error", () => {
      const { result } = renderHook(() => usePdfGeneration());

      expect(result.current.pdfData).toBeNull();
      expect(result.current.isGenerating).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it("returns stable function references", () => {
      const { result, rerender } = renderHook(() => usePdfGeneration());

      const firstGeneratePdf = result.current.generatePdf;
      const firstClearPdf = result.current.clearPdf;

      rerender();

      expect(result.current.generatePdf).toBe(firstGeneratePdf);
      expect(result.current.clearPdf).toBe(firstClearPdf);
    });
  });

  describe("generatePdf", () => {
    it("sets isGenerating=true while generating", async () => {
      let resolveGenerate: (v: Uint8Array) => void;
      mockGenerateReport.mockReturnValue(
        new Promise((resolve) => {
          resolveGenerate = resolve;
        }),
      );

      const { result } = renderHook(() => usePdfGeneration());

      let promise: Promise<void>;
      act(() => {
        promise = result.current.generatePdf(makeFormData(), null);
      });

      expect(result.current.isGenerating).toBe(true);
      expect(result.current.error).toBeNull();

      await act(async () => {
        resolveGenerate!(makePdfBytes());
        await promise!;
      });

      expect(result.current.isGenerating).toBe(false);
    });

    it("stores pdfData on success", async () => {
      const pdfBytes = makePdfBytes();
      mockGenerateReport.mockResolvedValue(pdfBytes);

      const { result } = renderHook(() => usePdfGeneration());

      await act(() => result.current.generatePdf(makeFormData(), null));

      expect(result.current.pdfData).toBe(pdfBytes);
      expect(result.current.error).toBeNull();
      expect(result.current.isGenerating).toBe(false);
    });

    it("passes signature and media to generateReport", async () => {
      mockGenerateReport.mockResolvedValue(makePdfBytes());

      const { result } = renderHook(() => usePdfGeneration());
      const formData = makeFormData();
      const sig = "data:image/png;base64,abc";
      const media = [{ id: "1", url: "https://example.com/photo.jpg" }] as any;

      await act(() => result.current.generatePdf(formData, sig, media));

      expect(mockGenerateReport).toHaveBeenCalledWith(formData, sig, media);
    });

    it("sets error on failure with Error instance", async () => {
      mockGenerateReport.mockRejectedValue(new Error("Font not found"));

      const { result } = renderHook(() => usePdfGeneration());

      await act(() => result.current.generatePdf(makeFormData(), null));

      expect(result.current.error).toBe("Font not found");
      expect(result.current.pdfData).toBeNull();
      expect(result.current.isGenerating).toBe(false);
    });

    it("sets generic error on non-Error throw", async () => {
      mockGenerateReport.mockRejectedValue("something broke");

      const { result } = renderHook(() => usePdfGeneration());

      await act(() => result.current.generatePdf(makeFormData(), null));

      expect(result.current.error).toBe("PDF generation failed");
    });

    it("clears previous error on new generation attempt", async () => {
      mockGenerateReport.mockRejectedValueOnce(new Error("first error"));

      const { result } = renderHook(() => usePdfGeneration());

      await act(() => result.current.generatePdf(makeFormData(), null));
      expect(result.current.error).toBe("first error");

      mockGenerateReport.mockResolvedValueOnce(makePdfBytes());

      await act(() => result.current.generatePdf(makeFormData(), null));
      expect(result.current.error).toBeNull();
    });

    it("replaces previous pdfData on second generation", async () => {
      const bytes1 = new Uint8Array([1, 2, 3]);
      const bytes2 = new Uint8Array([4, 5, 6]);

      mockGenerateReport.mockResolvedValueOnce(bytes1);

      const { result } = renderHook(() => usePdfGeneration());

      await act(() => result.current.generatePdf(makeFormData(), null));
      expect(result.current.pdfData).toBe(bytes1);

      mockGenerateReport.mockResolvedValueOnce(bytes2);

      await act(() => result.current.generatePdf(makeFormData(), null));
      expect(result.current.pdfData).toBe(bytes2);
    });
  });

  describe("clearPdf", () => {
    it("clears pdfData and error", async () => {
      mockGenerateReport.mockResolvedValue(makePdfBytes());

      const { result } = renderHook(() => usePdfGeneration());

      await act(() => result.current.generatePdf(makeFormData(), null));
      expect(result.current.pdfData).not.toBeNull();

      act(() => result.current.clearPdf());

      expect(result.current.pdfData).toBeNull();
      expect(result.current.error).toBeNull();
    });

    it("clears error even when pdfData is null", async () => {
      mockGenerateReport.mockRejectedValue(new Error("fail"));

      const { result } = renderHook(() => usePdfGeneration());

      await act(() => result.current.generatePdf(makeFormData(), null));
      expect(result.current.error).toBe("fail");

      act(() => result.current.clearPdf());

      expect(result.current.error).toBeNull();
    });

    it("is idempotent when called on already-clear state", () => {
      const { result } = renderHook(() => usePdfGeneration());

      act(() => result.current.clearPdf());

      expect(result.current.pdfData).toBeNull();
      expect(result.current.error).toBeNull();
    });
  });

  describe("concurrent operations", () => {
    it("handles rapid sequential calls", async () => {
      const bytes1 = new Uint8Array([1]);
      const bytes2 = new Uint8Array([2]);

      mockGenerateReport
        .mockResolvedValueOnce(bytes1)
        .mockResolvedValueOnce(bytes2);

      const { result } = renderHook(() => usePdfGeneration());

      await act(async () => {
        await result.current.generatePdf(makeFormData(), null);
        await result.current.generatePdf(makeFormData(), "sig");
      });

      // Last call wins
      expect(result.current.pdfData).toBe(bytes2);
    });
  });
});
