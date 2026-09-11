"use client";

import { Download, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { type UseFormReturn, useWatch } from "react-hook-form";
import type { MediaRecord } from "@/components/inspection/media-gallery";
import { PdfPreview } from "@/components/inspection/pdf-preview";
import { Button } from "@/components/ui/button";
import { usePdfGeneration } from "@/hooks/use-pdf-generation";
import type { InspectionFormData } from "@/types/inspection";
import { ReviewSection } from "./review-section";

interface ReportPreviewProps {
  inspectionId: string;
  status: string;
  form: UseFormReturn<InspectionFormData>;
  /** Photos currently selected for the report (drives client-side regeneration) */
  selectedMedia: MediaRecord[];
  readOnly: boolean;
}

/**
 * Client-side "Regenerate PDF" preview while in review; the exact server-generated
 * PDF once the inspection is completed/sent. Extracted from the legacy review editor.
 */
export function ReportPreview({ inspectionId, status, form, selectedMedia, readOnly }: ReportPreviewProps) {
  const facilityName = useWatch({ control: form.control, name: "facilityInfo.facilityName" });
  const values = useWatch({ control: form.control });
  const { generatePdf, pdfData, isGenerating, error, clearPdf } = usePdfGeneration();

  // Snapshot of the form + selection the preview was generated from, to flag staleness
  const generatedFromRef = useRef<string | null>(null);
  const currentSnapshot = JSON.stringify({ values, ids: selectedMedia.map((m) => m.id) });
  const isStale = generatedFromRef.current !== null && generatedFromRef.current !== currentSnapshot;

  // Finalized PDF state — for showing the exact server-generated PDF
  const [finalizedPdfUrl, setFinalizedPdfUrl] = useState<string | null>(null);
  const [finalizedDownloadUrl, setFinalizedDownloadUrl] = useState<string | null>(null);
  const [loadingFinalizedPdf, setLoadingFinalizedPdf] = useState(false);

  const fetchFinalizedPdf = useCallback(async () => {
    setLoadingFinalizedPdf(true);
    try {
      const res = await fetch(`/api/inspections/${inspectionId}/download`);
      if (res.ok) {
        const data = await res.json();
        setFinalizedPdfUrl(data.previewUrl ?? data.downloadUrl);
        setFinalizedDownloadUrl(data.downloadUrl);
      }
    } catch (err) {
      console.error("Failed to fetch finalized PDF:", err);
    } finally {
      setLoadingFinalizedPdf(false);
    }
  }, [inspectionId]);

  const isFinalized = status === "completed" || status === "sent";

  // Load the finalized PDF whenever the inspection becomes completed/sent; drop it on reopen
  useEffect(() => {
    if (isFinalized) {
      fetchFinalizedPdf();
    } else {
      setFinalizedPdfUrl(null);
      setFinalizedDownloadUrl(null);
    }
  }, [isFinalized, fetchFinalizedPdf]);

  const handleRegenerate = useCallback(async () => {
    clearPdf();
    const formData = form.getValues();
    const signatureDataUrl = formData.disposalWorks?.signatureDataUrl ?? null;
    generatedFromRef.current = JSON.stringify({
      values: formData,
      ids: selectedMedia.map((m) => m.id),
    });
    await generatePdf(formData, signatureDataUrl, selectedMedia);
  }, [form, selectedMedia, generatePdf, clearPdf]);

  return (
    <ReviewSection title="Report Preview" defaultOpen>
      <div className="space-y-4">
        {!readOnly && (
          <Button onClick={handleRegenerate} disabled={isGenerating} className="w-full">
            {isGenerating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Regenerate PDF
          </Button>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        {isStale && !readOnly && pdfData && (
          <p className="text-xs text-amber-600">
            Form data changed -- click &quot;Regenerate PDF&quot; to see updates
          </p>
        )}

        {isFinalized && finalizedPdfUrl ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Finalized Report</h3>
              <Button variant="outline" size="sm" asChild>
                <a
                  href={finalizedDownloadUrl ?? finalizedPdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Download className="size-4" />
                  Download PDF
                </a>
              </Button>
            </div>
            <iframe
              src={finalizedPdfUrl}
              className="h-[80vh] w-full rounded-lg border"
              title="Finalized PDF"
            />
          </div>
        ) : isFinalized && loadingFinalizedPdf ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="size-8 mb-2 animate-spin opacity-30" />
            <p className="text-sm">Loading finalized report...</p>
          </div>
        ) : pdfData ? (
          <PdfPreview pdfData={pdfData} facilityName={facilityName || undefined} />
        ) : !readOnly ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <RefreshCw className="size-8 mb-2 opacity-30" />
            <p className="text-sm">Click &quot;Regenerate PDF&quot; to preview</p>
          </div>
        ) : null}
      </div>
    </ReviewSection>
  );
}
