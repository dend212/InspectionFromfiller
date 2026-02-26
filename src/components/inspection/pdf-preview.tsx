"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

interface PdfPreviewProps {
  /** The generated PDF bytes, or null if not yet generated */
  pdfData: Uint8Array | null;
  /** Facility name for the download filename */
  facilityName?: string;
}

/**
 * In-browser PDF viewer using an iframe with a Blob URL.
 *
 * Shows the generated PDF in an embedded viewer and provides a
 * download button. Cleans up Blob URLs on unmount or data change.
 */
export function PdfPreview({ pdfData, facilityName }: PdfPreviewProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!pdfData) {
      setBlobUrl(null);
      return;
    }

    const blob = new Blob([new Uint8Array(pdfData)], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    setBlobUrl(url);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [pdfData]);

  if (!blobUrl) return null;

  const safeName = (facilityName ?? "Inspection")
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
  const filename = `ADEQ-Inspection-${safeName}.pdf`;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">PDF Preview</h3>
        <Button variant="outline" size="sm" asChild>
          <a href={blobUrl} download={filename}>
            <Download className="size-4" />
            Download PDF
          </a>
        </Button>
      </div>
      <iframe
        src={blobUrl}
        className="h-[80vh] w-full rounded-lg border"
        title="PDF Preview"
      />
    </div>
  );
}
