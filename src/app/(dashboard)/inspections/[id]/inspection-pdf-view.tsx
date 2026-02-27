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
import { SendEmailDialog } from "@/components/dashboard/send-email-dialog";
import {
  ArrowLeft,
  Download,
  Edit,
  Loader2,
  Mail,
  MapPin,
  Calendar,
  Camera,
} from "lucide-react";
import { toast } from "sonner";
import type { InspectionFormData } from "@/types/inspection";
import type { MediaRecord } from "@/components/inspection/media-gallery";

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
  customerEmail: string | null;
  createdAt: string;
  mediaCount: number;
  media: MediaRecord[];
}

export function InspectionPdfView({
  inspectionId,
  formData,
  status,
  facilityName,
  facilityAddress,
  facilityCity,
  facilityCounty,
  customerEmail,
  createdAt,
  mediaCount,
  media,
}: InspectionPdfViewProps) {
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [sendEmailDialogOpen, setSendEmailDialogOpen] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const { generatePdf, pdfData, isGenerating, error, clearPdf } =
    usePdfGeneration();

  const handleGenerate = useCallback(async () => {
    if (!formData) return;
    // Clear any previous PDF before generating a new one
    clearPdf();
    await generatePdf(formData, signatureDataUrl, media);
  }, [formData, signatureDataUrl, media, generatePdf, clearPdf]);

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

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      const res = await fetch(`/api/inspections/${inspectionId}/download`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to get download URL");
      }
      const { downloadUrl } = await res.json();
      window.open(downloadUrl, "_blank");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to download report",
      );
    } finally {
      setIsDownloading(false);
    }
  };

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
              <Badge
                variant={STATUS_VARIANTS[status] ?? "secondary"}
                className={
                  status === "completed"
                    ? "bg-emerald-100 text-emerald-800"
                    : undefined
                }
              >
                {STATUS_LABELS[status] ?? status}
              </Badge>
              {status === "draft" && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/inspections/${inspectionId}/edit`}>
                    <Edit className="size-4" />
                    Edit
                  </Link>
                </Button>
              )}
              {status === "in_review" && (
                <span className="text-xs text-muted-foreground">
                  This inspection is under review
                </span>
              )}
              {(status === "completed" || status === "sent") && (
                <>
                  <Button
                    size="sm"
                    onClick={() => setSendEmailDialogOpen(true)}
                  >
                    <Mail className="size-4" />
                    Send to Customer
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleDownload}
                    disabled={isDownloading}
                  >
                    {isDownloading ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Download className="size-4" />
                    )}
                    Download PDF
                  </Button>
                </>
              )}
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

      {/* Send Email Dialog */}
      <SendEmailDialog
        inspectionId={inspectionId}
        facilityAddress={facilityAddress}
        customerEmail={customerEmail}
        open={sendEmailDialogOpen}
        onOpenChange={setSendEmailDialogOpen}
      />
    </div>
  );
}
