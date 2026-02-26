"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SignaturePad } from "@/components/inspection/signature-pad";
import { PdfPreview } from "@/components/inspection/pdf-preview";
import { GeneratePdfButton } from "@/components/inspection/generate-pdf-button";
import { usePdfGeneration } from "@/hooks/use-pdf-generation";
import {
  ArrowLeft,
  Edit,
  MapPin,
  Calendar,
  Camera,
} from "lucide-react";
import type { InspectionFormData } from "@/types/inspection";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  in_review: "In Review",
  completed: "Completed",
  sent: "Sent",
};

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "outline"> = {
  draft: "secondary",
  submitted: "default",
  in_review: "default",
  completed: "default",
  sent: "default",
};

interface InspectionPdfViewProps {
  inspectionId: string;
  formData: InspectionFormData | null;
  status: string;
  facilityName: string | null;
  facilityAddress: string | null;
  facilityCity: string | null;
  facilityCounty: string | null;
  createdAt: string;
  mediaCount: number;
}

export function InspectionPdfView({
  inspectionId,
  formData,
  status,
  facilityName,
  facilityAddress,
  facilityCity,
  facilityCounty,
  createdAt,
  mediaCount,
}: InspectionPdfViewProps) {
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const { generatePdf, pdfData, isGenerating, error, clearPdf } =
    usePdfGeneration();

  const handleGenerate = useCallback(async () => {
    if (!formData) return;
    // Clear any previous PDF before generating a new one
    clearPdf();
    await generatePdf(formData, signatureDataUrl);
  }, [formData, signatureDataUrl, generatePdf, clearPdf]);

  const handleSignatureCapture = useCallback(
    (dataUrl: string) => {
      setSignatureDataUrl(dataUrl);
      // If a PDF was already generated, hint that re-generation is needed
      if (pdfData) {
        clearPdf();
      }
    },
    [pdfData, clearPdf],
  );

  const formattedDate = new Date(createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="space-y-6">
      {/* Navigation */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/inspections">
            <ArrowLeft className="size-4" />
            Back
          </Link>
        </Button>
      </div>

      {/* Inspection Summary Header */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1.5">
              <CardTitle className="text-xl">
                {facilityName || "Untitled Inspection"}
              </CardTitle>
              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                {(facilityAddress || facilityCity) && (
                  <span className="flex items-center gap-1">
                    <MapPin className="size-3.5" />
                    {[facilityAddress, facilityCity, facilityCounty]
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <Calendar className="size-3.5" />
                  {formattedDate}
                </span>
                {mediaCount > 0 && (
                  <span className="flex items-center gap-1">
                    <Camera className="size-3.5" />
                    {mediaCount} photo{mediaCount !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={STATUS_VARIANTS[status] ?? "secondary"}>
                {STATUS_LABELS[status] ?? status}
              </Badge>
              <Button variant="outline" size="sm" asChild>
                <Link href={`/inspections/${inspectionId}/edit`}>
                  <Edit className="size-4" />
                  Edit
                </Link>
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Signature Pad */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sign & Generate Report</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <SignaturePad onSignatureCapture={handleSignatureCapture} />

          {!formData && (
            <p className="text-sm text-muted-foreground">
              No form data available. Please{" "}
              <Link
                href={`/inspections/${inspectionId}/edit`}
                className="underline"
              >
                fill out the inspection form
              </Link>{" "}
              before generating a PDF.
            </p>
          )}

          {formData && (
            <GeneratePdfButton
              onGenerate={handleGenerate}
              isGenerating={isGenerating}
              error={error}
            />
          )}
        </CardContent>
      </Card>

      {/* PDF Preview */}
      {pdfData && (
        <Card>
          <CardContent className="pt-6">
            <PdfPreview
              pdfData={pdfData}
              facilityName={facilityName ?? undefined}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
