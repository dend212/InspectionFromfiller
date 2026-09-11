"use client";

import { Link2, Loader2, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const DRAFT_ERROR_MESSAGE = "Couldn't draft — write your own or retry";
const REGENERATE_CONFIRM_MESSAGE = "Replace your edits with a new draft?";

interface GenerateSummaryDialogProps {
  inspectionId: string;
  facilityAddress: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSummaryGenerated: (summaryUrl: string) => void;
}

export function GenerateSummaryDialog({
  inspectionId,
  facilityAddress,
  open,
  onOpenChange,
  onSummaryGenerated,
}: GenerateSummaryDialogProps) {
  const [recommendations, setRecommendations] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isDrafting, setIsDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  // The last text Claude produced — anything different in the textarea counts as a user edit
  const [lastDraft, setLastDraft] = useState<string | null>(null);
  // Guards requestDraft's own async chain: bumped on every new draft request and on
  // dialog close, so a response that lands after the request it belongs to has been
  // superseded is discarded instead of clobbering fresher state or double-firing.
  const draftSeqRef = useRef(0);

  // Ask Claude for a draft. On failure the textarea keeps whatever it had and the notice shows.
  const requestDraft = useCallback(async () => {
    const mySeq = ++draftSeqRef.current;
    setIsDrafting(true);
    setDraftError(null);
    try {
      const res = await fetch(`/api/inspections/${inspectionId}/draft-recommendations`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Draft failed");
      const data: { recommendations?: string } = await res.json();
      if (draftSeqRef.current !== mySeq) return; // superseded — discard
      const draft = (data.recommendations || "").trim();
      if (!draft) throw new Error("Empty draft");
      setRecommendations(draft);
      setLastDraft(draft);
    } catch {
      if (draftSeqRef.current === mySeq) setDraftError(DRAFT_ERROR_MESSAGE);
    } finally {
      if (draftSeqRef.current === mySeq) setIsDrafting(false);
    }
  }, [inspectionId]);

  // Pre-populate with most recent recommendations when dialog opens; auto-draft only when there are none
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setIsGenerating(false);
    setDraftError(null);
    setLastDraft(null);
    setIsLoading(true);

    fetch(`/api/inspections/${inspectionId}/generate-summary`)
      .then((res) => (res.ok ? res.json() : { recommendations: "" }))
      .catch(() => ({ recommendations: "" }))
      .then((data: { recommendations?: string }) => {
        if (cancelled) return;
        const saved = data.recommendations || "";
        setRecommendations(saved);
        setIsLoading(false);
        if (!saved) return requestDraft();
      });

    return () => {
      cancelled = true;
      // Invalidate any in-flight draft request and leave state clean for a re-open.
      draftSeqRef.current += 1;
      setIsDrafting(false);
      setDraftError(null);
    };
  }, [open, inspectionId, requestDraft]);

  const handleRegenerate = async () => {
    const hasEdits = recommendations.trim() !== "" && recommendations !== lastDraft;
    if (hasEdits && !window.confirm(REGENERATE_CONFIRM_MESSAGE)) return;
    await requestDraft();
  };

  const handleGenerate = async () => {
    if (!recommendations.trim() || isGenerating) return;
    setIsGenerating(true);

    try {
      const res = await fetch(`/api/inspections/${inspectionId}/generate-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recommendations: recommendations.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to generate summary");
      }

      const { summaryUrl } = await res.json();

      toast.success("Summary page created");
      onOpenChange(false);
      onSummaryGenerated(summaryUrl);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate summary");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Link2 className="size-5" />
            Generate Inspection Summary Page
          </AlertDialogTitle>
          <AlertDialogDescription>
            Create a shareable summary page for{" "}
            <span className="font-medium text-foreground">
              {facilityAddress || "this inspection"}
            </span>
            . The customer will see status indicators, inspector comments, and your
            recommendations below.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="recommendations">Recommendations</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleRegenerate}
                disabled={isDrafting || isLoading || isGenerating}
                className="gap-1.5"
              >
                {isDrafting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                Regenerate
              </Button>
            </div>
            {isDrafting ? (
              <div
                role="status"
                aria-live="polite"
                className="space-y-2 rounded-md border border-input px-3 py-2"
              >
                <div className="h-3 w-11/12 animate-pulse rounded bg-muted" />
                <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
                <div className="h-3 w-3/5 animate-pulse rounded bg-muted" />
                <p className="pt-1 text-xs text-muted-foreground">Drafting recommendations…</p>
              </div>
            ) : (
              <Textarea
                id="recommendations"
                value={recommendations}
                onChange={(e) => setRecommendations(e.target.value)}
                placeholder="e.g., Tank replacement recommended within 12 months. Schedule drainfield repair before rainy season."
                rows={5}
              />
            )}
            {draftError && (
              <p role="alert" className="text-xs text-destructive">
                {draftError}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              These recommendations will be displayed prominently on the customer summary page.
            </p>
          </div>
        </div>

        <AlertDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isGenerating}>
            Cancel
          </Button>
          <Button
            onClick={handleGenerate}
            disabled={!recommendations.trim() || isGenerating || isDrafting}
          >
            {isGenerating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Link2 className="size-4" />
            )}
            Generate Summary
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
