"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Check, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

interface WizardNavigationProps {
  currentStep: number;
  onNext: () => void;
  onBack: () => void;
  isLastStep: boolean;
  isSubmitting: boolean;
  saving?: boolean;
  lastSaved?: Date | null;
  submitButton?: ReactNode;
}

export function WizardNavigation({
  currentStep,
  onNext,
  onBack,
  isLastStep,
  isSubmitting,
  saving,
  lastSaved,
  submitButton,
}: WizardNavigationProps) {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 lg:-mx-8 border-t bg-card/95 px-4 lg:px-8 py-3 backdrop-blur-sm shadow-[0_-2px_10px_rgba(0,0,0,0.06)]">
      <div className="mx-auto max-w-3xl flex items-center justify-between gap-3">
        {/* Back button */}
        <div className="flex-1">
          {currentStep > 0 && (
            <Button
              type="button"
              variant="outline"
              onClick={onBack}
              className="min-h-[48px] px-5 gap-1.5"
            >
              <ChevronLeft className="size-4" />
              Back
            </Button>
          )}
        </div>

        {/* Save indicator */}
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          {saving ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              <span>Saving...</span>
            </>
          ) : lastSaved ? (
            <>
              <Check className="size-3.5 text-emerald-600" />
              <span className="text-emerald-600 font-medium">Saved</span>
            </>
          ) : null}
        </div>

        {/* Next / Submit button */}
        <div className="flex-1 flex justify-end">
          {isLastStep ? (
            submitButton ?? (
              <Button
                type="submit"
                disabled={isSubmitting}
                className="min-h-[48px] px-6 gap-1.5"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  "Submit"
                )}
              </Button>
            )
          ) : (
            <Button
              type="button"
              onClick={onNext}
              className="min-h-[48px] px-5 gap-1.5"
            >
              Next
              <ChevronRight className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
