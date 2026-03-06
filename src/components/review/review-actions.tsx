"use client";

import { CheckCircle, Link2, Loader2, Mail, RotateCcw, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
import { ReturnDialog } from "./return-dialog";

const STATUS_BADGE_STYLES: Record<string, string> = {
  in_review: "text-sm px-3 py-1",
  completed: "text-sm px-3 py-1",
  draft: "text-sm px-3 py-1",
};

interface ReviewActionsProps {
  inspectionId: string;
  status: string;
  facilityAddress?: string | null;
  customerEmail?: string | null;
  isFromWorkiz?: boolean;
  selectedMediaIds?: string[];
  onStatusChange: (newStatus: string) => void;
}

export function ReviewActions({
  inspectionId,
  status,
  facilityAddress,
  customerEmail,
  isFromWorkiz,
  selectedMediaIds,
  onStatusChange,
}: ReviewActionsProps) {
  const router = useRouter();
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isReopening, setIsReopening] = useState(false);
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [sendEmailDialogOpen, setSendEmailDialogOpen] = useState(false);
  const [summaryDialogOpen, setSummaryDialogOpen] = useState(false);
  const [summaryEmailDialogOpen, setSummaryEmailDialogOpen] = useState(false);
  const [summaryUrl, setSummaryUrl] = useState<string | null>(null);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [recommendations, setRecommendations] = useState("");

  const handleFinalize = async () => {
    setIsFinalizing(true);
    try {
      const res = await fetch(`/api/inspections/${inspectionId}/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedMediaIds }),
      });
      if (!res.ok) {
        let errorMessage = "Failed to finalize";
        try {
          const data = await res.json();
          errorMessage = data.error || errorMessage;
        } catch {
          errorMessage = `Server error (${res.status}): ${res.statusText}`;
        }
        throw new Error(errorMessage);
      }
      toast.success("Inspection finalized successfully");
      onStatusChange("completed");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to finalize inspection");
    } finally {
      setIsFinalizing(false);
    }
  };

  const handleReopen = async () => {
    setIsReopening(true);
    try {
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
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700"
                disabled={isFinalizing}
              >
                {isFinalizing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <CheckCircle className="size-4" />
                )}
                Finalize Report
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Finalize Inspection Report?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will mark the inspection as completed. The field tech will no longer be able
                  to edit it. You can reopen it later if needed.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleFinalize} variant="default">
                  Finalize
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <Button
            size="sm"
            variant="outline"
            className="border-amber-300 text-amber-700 hover:bg-amber-50"
            onClick={() => setReturnDialogOpen(true)}
          >
            <Undo2 className="size-4" />
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
