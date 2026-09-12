"use client";

import { AlertTriangle, Check } from "lucide-react";
import { useEffect, useState } from "react";
import { type Control, useWatch } from "react-hook-form";
import { Badge } from "@/components/ui/badge";
import {
  type StepValidation,
  type StepValidationResult,
  validateSteps,
} from "@/lib/validators/step-validation";
import type { InspectionFormData } from "@/types/inspection";

export type PillKind = "complete" | "empty" | "issues" | "excluded";

/** Pure: which pill a step's validation result maps to */
export function pillKind(result: StepValidation | null): PillKind {
  if (result === null) return "excluded";
  if (result.errors.length > 0) return "issues";
  if (result.emptyCount > 0) return "empty";
  return "complete";
}

interface ReviewPillProps {
  /** `null` renders the neutral "Not included" pill (alt-system pages switched off) */
  result: StepValidation | null;
}

/** Section-header status pill: ✓ complete (green) · N empty (grey) · ⚠ N issues (amber) */
export function ReviewPill({ result }: ReviewPillProps) {
  const kind = pillKind(result);
  if (kind === "excluded") {
    return (
      <Badge variant="outline" className="font-normal text-muted-foreground" data-pill="excluded">
        Not included
      </Badge>
    );
  }
  if (kind === "issues") {
    const n = result!.errors.length;
    return (
      <Badge
        className="bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
        data-pill="issues"
      >
        <AlertTriangle />
        {n} {n === 1 ? "issue" : "issues"}
      </Badge>
    );
  }
  if (kind === "empty") {
    return (
      <Badge variant="secondary" className="font-normal" data-pill="empty">
        {result!.emptyCount} empty
      </Badge>
    );
  }
  return (
    <Badge
      className="bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200"
      data-pill="complete"
    >
      <Check />
      complete
    </Badge>
  );
}

/**
 * Watches the whole form and recomputes validateSteps() after `debounceMs` of
 * quiet. The first result is computed synchronously so pills never flash empty.
 */
export function useStepValidations(
  control: Control<InspectionFormData>,
  debounceMs = 300,
): StepValidationResult {
  const values = useWatch({ control });
  const [result, setResult] = useState<StepValidationResult>(() => validateSteps(values));

  useEffect(() => {
    const t = setTimeout(() => setResult(validateSteps(values)), debounceMs);
    return () => clearTimeout(t);
  }, [values, debounceMs]);

  return result;
}
