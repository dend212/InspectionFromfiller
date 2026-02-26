"use client";

import { useState, useCallback } from "react";
import { generateReport } from "@/lib/pdf/generate-report";
import type { InspectionFormData } from "@/types/inspection";
import type { MediaRecord } from "@/components/inspection/media-gallery";

interface UsePdfGenerationReturn {
  /** Trigger PDF generation with current form data, optional signature, and optional media */
  generatePdf: (
    formData: InspectionFormData,
    signatureDataUrl: string | null,
    media?: MediaRecord[],
  ) => Promise<void>;
  /** The generated PDF bytes, or null if not yet generated */
  pdfData: Uint8Array | null;
  /** Whether PDF generation is currently in progress */
  isGenerating: boolean;
  /** Error message from the last generation attempt, or null */
  error: string | null;
  /** Clear the generated PDF (e.g., after edits, before re-generation) */
  clearPdf: () => void;
}

/**
 * React hook for managing client-side PDF generation state.
 *
 * Wraps the generateReport() orchestrator with loading, error, and
 * result state management. Supports media records for photo appendix pages.
 */
export function usePdfGeneration(): UsePdfGenerationReturn {
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generatePdf = useCallback(
    async (
      formData: InspectionFormData,
      signatureDataUrl: string | null,
      media?: MediaRecord[],
    ): Promise<void> => {
      setIsGenerating(true);
      setError(null);

      try {
        const result = await generateReport(formData, signatureDataUrl, media);
        setPdfData(result);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "PDF generation failed";
        setError(message);
        console.error("PDF generation error:", err);
      } finally {
        setIsGenerating(false);
      }
    },
    [],
  );

  const clearPdf = useCallback(() => {
    setPdfData(null);
    setError(null);
  }, []);

  return {
    generatePdf,
    pdfData,
    isGenerating,
    error,
    clearPdf,
  };
}
