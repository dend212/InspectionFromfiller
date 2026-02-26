"use client";

import { Button } from "@/components/ui/button";
import { FileText, Loader2 } from "lucide-react";

interface GeneratePdfButtonProps {
  /** Handler to trigger PDF generation */
  onGenerate: () => Promise<void>;
  /** Whether generation is currently in progress */
  isGenerating: boolean;
  /** Error message from the last attempt, or null */
  error: string | null;
}

/**
 * "Generate PDF" button with loading spinner and error display.
 *
 * Disabled during generation. Shows a spinner and status text while
 * the PDF is being created client-side.
 */
export function GeneratePdfButton({
  onGenerate,
  isGenerating,
  error,
}: GeneratePdfButtonProps) {
  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="default"
        size="lg"
        onClick={onGenerate}
        disabled={isGenerating}
        className="w-full sm:w-auto"
      >
        {isGenerating ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Generating PDF...
          </>
        ) : (
          <>
            <FileText className="size-4" />
            Generate PDF
          </>
        )}
      </Button>
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
    </div>
  );
}
