"use client";

import { CheckCircle, Link2, Loader2, Mail, RotateCcw, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { SendEmailDialog } from "@/components/dashboard/send-email-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getStatusConfig } from "@/lib/constants/status";
import type { InspectionFormData } from "@/types/inspection";
import { FinalizeDialog } from "./finalize-dialog";
import { ReturnDialog } from "./return-dialog";

const STATUS_BADGE_STYLES: Record<string, string> = {
  in_review: "text-sm px-3 py-1",
  completed: "text-sm px-3 py-1",
  draft: "text-sm px-3 py-1",
};

const FLUSH_FAILED_MESSAGE = "Couldn't save your latest changes — fix the save error, then try again";

interface ReviewActionsProps {
  inspectionId: string;
  status: string;
  facilityAddress?: string | null;
  customerEmail?: string | null;
  isFromWorkiz?: boolean;
  selectedMediaIds?: string[];
  onStatusChange: (newStatus: string) => void;
  /** Flush pending autosave before a transition; resolves false when the save failed. Defaults to a no-op. */
  flush?: () => Promise<boolean>;
  /** Current form values for finalize validation. When omitted, finalize skips validation. */
  getFormData?: () => InspectionFormData | null;
  /** Expand a section and highlight a field (finalize "jump to issue") */
  onJumpToField?: (path: string, stepIndex: number) => void;
}

const noopFlush = async () => true;
const noFormData = () => null;

export function ReviewActions({
  inspectionId,
  status,
  facilityAddress,
  customerEmail,
  isFromWorkiz,
  selectedMediaIds,
  onStatusChange,
  flush = noopFlush,
  getFormData = noFormData,
  onJumpToField,
}: ReviewActionsProps) {
  const router = useRouter();
  const [isFlushing, setIsFlushing] = useState(false);
  const [isReopening, setIsReopening] = useState(false);
  const [finalizeDialogOpen, setFinalizeDialogOpen] = useState(false);
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [sendEmailDialogOpen, setSendEmailDialogOpen] = useState(false);
  const [summaryDialogOpen, setSummaryDialogOpen] = useState(false);
  const [summaryEmailDialogOpen, setSummaryEmailDialogOpen] = useState(false);
  const [summaryUrl, setSummaryUrl] = useState<string | null>(null);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [recommendations, setRecommendations] = useState("");
  const [recommendationsLoaded, setRecommendationsLoaded] = useState(false);

  // Pre-fill recommendations from the most recent summary for this inspection
  useEffect(() => {
    if (recommendationsLoaded) return;
    fetch(`/api/inspections/${inspectionId}/generate-summary`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.recommendations) setRecommendations(data.recommendations);
      })
      .catch(() => {})
      .finally(() => setRecommendationsLoaded(true));
  }, [inspectionId, recommendationsLoaded]);

  // Stable: FinalizeDialog receives it as a prop on every render
  const handleFinalized = useCallback(() => {
    onStatusChange("completed");
    router.refresh();
  }, [onStatusChange, router]);

  const handleReturnClick = async () => {
    setIsFlushing(true);
    const ok = await flush();
    setIsFlushing(false);
    if (!ok) {
      toast.error(FLUSH_FAILED_MESSAGE);
      return;
    }
    setReturnDialogOpen(true);
  };

  const handleReopen = async () => {
    setIsReopening(true);
    try {
      const ok = await flush();
      if (!ok) {
        toast.error(FLUSH_FAILED_MESSAGE);
        return;
      }
      const res = await fetch(`/api/inspections/${inspectionId}/reopen`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        let errorMessage = "Failed to reopen";
        try {
          const data = await res.json();
          errorMessage = data.error || errorMessage;
        } catch {
          errorMessage = `Server error (${res.status}): ${res.statusText}`;
        }
        throw new Error(errorMessage);
      }
      toast.success("Inspection reopened for editing");
      onStatusChange("in_review");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reopen inspection");
    } finally {
      setIsReopening(false);
    }
  };

  const handleReturned = () => {
    onStatusChange("draft");
    router.refresh();
  };

  const handleGenerateSummary = async () => {
    if (!recommendations.trim()) {
      toast.error("Please enter recommendations before generating the summary link.");
      return;
    }
    setIsGeneratingSummary(true);
    try {
      const res = await fetch(`/api/inspections/${inspectionId}/generate-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recommendations: recommendations.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to generate summary link");
      }
      const data = await res.json();
      setSummaryUrl(data.summaryUrl);
      setSummaryDialogOpen(false);
      setSummaryEmailDialogOpen(true);
      toast.success("Summary link generated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate summary link");
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Status badge */}
      <Badge className={`${getStatusConfig(status).className} ${STATUS_BADGE_STYLES[status] ?? "text-sm px-3 py-1"}`}>
        {getStatusConfig(status).label}
      </Badge>

      {/* In Review: Finalize and Return buttons */}
      {status === "in_review" && (
        <>
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700"
            disabled={isFlushing || finalizeDialogOpen}
            onClick={() => setFinalizeDialogOpen(true)}
          >
            {finalizeDialogOpen ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CheckCircle className="size-4" />
            )}
            Finalize Report
          </Button>

          <FinalizeDialog
            inspectionId={inspectionId}
            open={finalizeDialogOpen}
            onOpenChange={setFinalizeDialogOpen}
            flush={flush}
            getFormData={getFormData}
            selectedMediaIds={selectedMediaIds ?? []}
            onJumpToField={onJumpToField}
            onFinalized={handleFinalized}
          />

          <Button
            size="sm"
            variant="outline"
            className="border-amber-300 text-amber-700 hover:bg-amber-50"
            disabled={isFlushing}
            onClick={handleReturnClick}
          >
            {isFlushing ? <Loader2 className="size-4 animate-spin" /> : <Undo2 className="size-4" />}
            Return to Tech
          </Button>

          <ReturnDialog
            inspectionId={inspectionId}
            open={returnDialogOpen}
            onOpenChange={setReturnDialogOpen}
            onReturned={handleReturned}
          />
        </>
      )}

      {/* Completed/Sent: Send to Customer and Reopen buttons */}
      {(status === "completed" || status === "sent") && (
        <>
          <Button size="sm" onClick={() => setSendEmailDialogOpen(true)}>
            <Mail className="size-4" />
            Send PDF to Customer
          </Button>

          <Button size="sm" variant="outline" onClick={() => setSummaryDialogOpen(true)}>
            <Link2 className="size-4" />
            Send Summary Link
          </Button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="outline" disabled={isReopening}>
                {isReopening ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RotateCcw className="size-4" />
                )}
                Reopen for Editing
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reopen Inspection?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will move the inspection back to &quot;In Review&quot; status, allowing
                  further edits before re-finalizing.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleReopen} variant="default">
                  Reopen
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <SendEmailDialog
            inspectionId={inspectionId}
            facilityAddress={facilityAddress ?? null}
            customerEmail={customerEmail ?? null}
            isFromWorkiz={isFromWorkiz}
            open={sendEmailDialogOpen}
            onOpenChange={setSendEmailDialogOpen}
          />

          {/* Summary link generation dialog */}
          <AlertDialog open={summaryDialogOpen} onOpenChange={setSummaryDialogOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Generate Summary Link</AlertDialogTitle>
                <AlertDialogDescription>
                  Enter recommendations for the customer. A shareable summary link will be generated
                  and you can email it to the customer.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="py-2">
                <Label htmlFor="recommendations">Recommendations</Label>
                <Textarea
                  id="recommendations"
                  value={recommendations}
                  onChange={(e) => setRecommendations(e.target.value)}
                  placeholder="Enter recommendations for the customer..."
                  rows={4}
                  className="mt-1"
                />
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <Button onClick={handleGenerateSummary} disabled={isGeneratingSummary}>
                  {isGeneratingSummary && <Loader2 className="size-4 animate-spin" />}
                  Generate & Send
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Email dialog for summary link */}
          <SendEmailDialog
            inspectionId={inspectionId}
            facilityAddress={facilityAddress ?? null}
            customerEmail={customerEmail ?? null}
            isFromWorkiz={isFromWorkiz}
            open={summaryEmailDialogOpen}
            onOpenChange={setSummaryEmailDialogOpen}
            summaryUrl={summaryUrl}
          />
        </>
      )}
    </div>
  );
}
