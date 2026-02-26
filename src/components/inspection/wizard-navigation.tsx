"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface WizardNavigationProps {
  currentStep: number;
  onNext: () => void;
  onBack: () => void;
  isLastStep: boolean;
  isSubmitting: boolean;
  saving?: boolean;
  lastSaved?: Date | null;
}

export function WizardNavigation({
  currentStep,
  onNext,
  onBack,
  isLastStep,
  isSubmitting,
  saving,
  lastSaved,
}: WizardNavigationProps) {
  return (
    <div className="sticky bottom-0 z-10 border-t bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex items-center justify-between gap-3">
        {/* Back button */}
        <div className="flex-1">
          {currentStep > 0 && (
            <Button
              type="button"
              variant="secondary"
              onClick={onBack}
              className="min-h-[48px] px-6"
            >
              Back
            </Button>
          )}
        </div>

        {/* Save indicator */}
        <div className="text-sm text-muted-foreground">
          {saving ? (
            <span className="animate-pulse">Saving...</span>
          ) : lastSaved ? (
            <span>Saved</span>
          ) : null}
        </div>

        {/* Next / Submit button */}
        <div className="flex-1 flex justify-end">
          {isLastStep ? (
            <Button
              type="submit"
              disabled={isSubmitting}
              className="min-h-[48px] px-6"
            >
              {isSubmitting ? "Submitting..." : "Submit"}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={onNext}
              className="min-h-[48px] px-6"
            >
              Next
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
