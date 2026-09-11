"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { STEP_LABELS } from "@/lib/constants/inspection";
import {
  allIssues,
  humanizeFieldPath,
  type StepIssue,
  validateSteps,
} from "@/lib/validators/step-validation";
import type { InspectionFormData } from "@/types/inspection";

type Phase = "checking" | "clean" | "issues" | "submitting";

interface FinalizeDialogProps {
  inspectionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Flush pending autosave first; resolves false when the save failed (dialog closes with a toast) */
  flush: () => Promise<boolean>;
  /** Current form values; `null` skips validation (finalize is then always "clean") */
  getFormData: () => InspectionFormData | null;
  selectedMediaIds: string[];
  /** Expand the section and highlight the field; the dialog closes first */
  onJumpToField?: (path: string, stepIndex: number) => void;
  onFinalized: () => void;
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    return data.error || fallback;
  } catch {
    return `Server error (${res.status}): ${res.statusText}`;
  }
}

/** Groups issues by step, preserving step order */
function groupByStep(issues: Array<StepIssue & { step: number }>) {
  const groups = new Map<number, Array<StepIssue & { step: number }>>();
  for (const issue of issues) {
    const list = groups.get(issue.step) ?? [];
    list.push(issue);
    groups.set(issue.step, list);
  }
  return [...groups.entries()].map(([step, list]) => ({ step, issues: list }));
}

export function FinalizeDialog({
  inspectionId,
  open,
  onOpenChange,
  flush,
  getFormData,
  selectedMediaIds,
  onJumpToField,
  onFinalized,
}: FinalizeDialogProps) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [issues, setIssues] = useState<Array<StepIssue & { step: number }>>([]);
  // Set when the user clicked an issue row: Radix would otherwise return focus to
  // the Finalize button on close and steal it from the highlighted field.
  const jumpedRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    jumpedRef.current = false;
    setPhase("checking");
    setIssues([]);

    (async () => {
      const ok = await flush();
      if (cancelled) return;
      if (!ok) {
        toast.error("Couldn't save your latest changes — fix the save error, then finalize");
        onOpenChange(false);
        return;
      }
      const data = getFormData();
      const found = data ? allIssues(validateSteps(data)) : [];
      setIssues(found);
      setPhase(found.length > 0 ? "issues" : "clean");
    })();

    return () => {
      cancelled = true;
    };
  }, [open, flush, getFormData, onOpenChange]);

  const finalize = async (withIssues: boolean) => {
    setPhase("submitting");
    try {
      if (withIssues) {
        const list = issues
          .map((i) => `${STEP_LABELS[i.step]} › ${humanizeFieldPath(i.path)}`)
          .join(", ");
        const line = `Finalized with ${issues.length} validation ${
          issues.length === 1 ? "issue" : "issues"
        }: ${list}`;
        const notesRes = await fetch(`/api/inspections/${inspectionId}/review-notes`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ append: line }),
        });
        if (!notesRes.ok) {
          throw new Error(await errorMessage(notesRes, "Failed to record validation issues"));
        }
      }

      const res = await fetch(`/api/inspections/${inspectionId}/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedMediaIds }),
      });
      if (!res.ok) {
        throw new Error(await errorMessage(res, "Failed to finalize"));
      }

      toast.success("Inspection finalized successfully");
      onOpenChange(false);
      onFinalized();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to finalize inspection");
      setPhase(issues.length > 0 ? "issues" : "clean");
    }
  };

  const jump = (issue: StepIssue & { step: number }) => {
    jumpedRef.current = true;
    onOpenChange(false);
    onJumpToField?.(issue.path, issue.step);
  };

  const groups = groupByStep(issues);
  const busy = phase === "checking" || phase === "submitting";
  const showIssues = phase === "issues" || (phase === "submitting" && issues.length > 0);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        onCloseAutoFocus={(e) => {
          if (jumpedRef.current) e.preventDefault();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            {showIssues ? "Finalize with validation issues?" : "Finalize Inspection Report?"}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>
              {phase === "checking" && (
                <p className="flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" />
                  Saving your changes…
                </p>
              )}
              {!showIssues && phase !== "checking" && (
                <p>
                  This will mark the inspection as completed. The field tech will no longer be
                  able to edit it. You can reopen it later if needed.
                </p>
              )}
              {showIssues && (
                <div className="space-y-3">
                  <p>
                    The validators found {issues.length}{" "}
                    {issues.length === 1 ? "issue" : "issues"}. Click one to jump to the field, or
                    finalize anyway — the issues are recorded in the review notes.
                  </p>
                  <div className="max-h-64 space-y-3 overflow-y-auto pr-1">
                    {groups.map((g) => (
                      <div key={g.step}>
                        <p className="text-xs font-semibold uppercase text-muted-foreground">
                          {STEP_LABELS[g.step]} · {g.issues.length}{" "}
                          {g.issues.length === 1 ? "issue" : "issues"}
                        </p>
                        <ul className="mt-1 space-y-1">
                          {g.issues.map((issue) => (
                            <li key={issue.path}>
                              <button
                                type="button"
                                onClick={() => jump(issue)}
                                className="flex w-full items-start gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent"
                              >
                                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                                <span>
                                  <span className="font-medium">{humanizeFieldPath(issue.path)}</span>
                                  <span className="text-muted-foreground"> — {issue.message}</span>
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {showIssues ? (
            <>
              <AlertDialogCancel disabled={busy}>Fix issues</AlertDialogCancel>
              <Button
                onClick={() => finalize(true)}
                disabled={busy}
                className="bg-amber-600 hover:bg-amber-700"
              >
                {phase === "submitting" && <Loader2 className="size-4 animate-spin" />}
                Finalize with issues
              </Button>
            </>
          ) : (
            <>
              <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
              <Button onClick={() => finalize(false)} disabled={busy}>
                {phase === "submitting" && <Loader2 className="size-4 animate-spin" />}
                Finalize
              </Button>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
