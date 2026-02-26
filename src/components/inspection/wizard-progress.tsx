"use client";

import { cn } from "@/lib/utils";
import { STEP_LABELS } from "@/lib/constants/inspection";

interface WizardProgressProps {
  currentStep: number;
  onStepClick?: (step: number) => void;
}

export function WizardProgress({ currentStep, onStepClick }: WizardProgressProps) {
  return (
    <nav aria-label="Inspection form progress" className="w-full">
      <ol className="flex items-center justify-between gap-1">
        {STEP_LABELS.map((label, index) => {
          const isCompleted = index < currentStep;
          const isCurrent = index === currentStep;

          return (
            <li key={label} className="flex flex-1 flex-col items-center gap-1.5">
              <button
                type="button"
                onClick={() => onStepClick?.(index)}
                aria-label={`Step ${index + 1}: ${label}${isCurrent ? " (current)" : ""}${isCompleted ? " (completed)" : ""}`}
                aria-current={isCurrent ? "step" : undefined}
                className={cn(
                  "flex size-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  isCurrent && "bg-primary text-primary-foreground",
                  isCompleted && "bg-primary/20 text-primary",
                  !isCurrent && !isCompleted && "bg-muted text-muted-foreground"
                )}
              >
                {index + 1}
              </button>
              <span
                className={cn(
                  "hidden text-xs font-medium sm:block",
                  isCurrent && "text-primary",
                  !isCurrent && "text-muted-foreground"
                )}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
