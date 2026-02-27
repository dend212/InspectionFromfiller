"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { ReturnDialog } from "./return-dialog";
import { CheckCircle, Loader2, RotateCcw, Undo2 } from "lucide-react";
import { toast } from "sonner";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  in_review: "In Review",
  completed: "Completed",
  sent: "Sent",
};

const STATUS_BADGE_STYLES: Record<string, string> = {
  in_review: "bg-blue-100 text-blue-800 text-sm px-3 py-1",
  completed: "bg-emerald-100 text-emerald-800 text-sm px-3 py-1",
  draft: "bg-gray-100 text-gray-800 text-sm px-3 py-1",
};

interface ReviewActionsProps {
  inspectionId: string;
  status: string;
  onStatusChange: (newStatus: string) => void;
}

export function ReviewActions({
  inspectionId,
  status,
  onStatusChange,
}: ReviewActionsProps) {
  const router = useRouter();
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isReopening, setIsReopening] = useState(false);
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);

  const handleFinalize = async () => {
    setIsFinalizing(true);
    try {
      const res = await fetch(`/api/inspections/${inspectionId}/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to finalize");
      }
      toast.success("Inspection finalized successfully");
      onStatusChange("completed");
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to finalize inspection"
      );
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
        const data = await res.json();
        throw new Error(data.error || "Failed to reopen");
      }
      toast.success("Inspection reopened for editing");
      onStatusChange("in_review");
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to reopen inspection"
      );
    } finally {
      setIsReopening(false);
    }
  };

  const handleReturned = () => {
    onStatusChange("draft");
    router.refresh();
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Status badge */}
      <Badge
        variant="secondary"
        className={STATUS_BADGE_STYLES[status] ?? "text-sm px-3 py-1"}
      >
        {STATUS_LABELS[status] ?? status}
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
                  This will mark the inspection as completed. The field tech will
                  no longer be able to edit it. You can reopen it later if
                  needed.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleFinalize}
                  variant="default"
                >
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

      {/* Completed: Reopen button */}
      {status === "completed" && (
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
                This will move the inspection back to &quot;In Review&quot;
                status, allowing further edits before re-finalizing.
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
      )}
    </div>
  );
}
