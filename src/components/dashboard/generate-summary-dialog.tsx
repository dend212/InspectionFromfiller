"use client";

import { Link2, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
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

  // Pre-populate with most recent recommendations when dialog opens
  useEffect(() => {
    if (open) {
      setIsGenerating(false);
      setIsLoading(true);
      fetch(`/api/inspections/${inspectionId}/generate-summary`)
        .then((res) => (res.ok ? res.json() : { recommendations: "" }))
        .then((data: { recommendations: string }) => {
          setRecommendations(data.recommendations || "");
        })
        .catch(() => setRecommendations(""))
        .finally(() => setIsLoading(false));
    }
  }, [open, inspectionId]);

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
            <Label htmlFor="recommendations">Recommendations</Label>
            <Textarea
              id="recommendations"
              value={recommendations}
              onChange={(e) => setRecommendations(e.target.value)}
              placeholder="e.g., Tank replacement recommended within 12 months. Schedule drainfield repair before rainy season."
              rows={5}
            />
            <p className="text-xs text-muted-foreground">
              These recommendations will be displayed prominently on the customer summary page.
            </p>
          </div>
        </div>

        <AlertDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isGenerating}>
            Cancel
          </Button>
          <Button onClick={handleGenerate} disabled={!recommendations.trim() || isGenerating}>
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
