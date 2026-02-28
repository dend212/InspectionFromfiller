"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Send, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import { inspectionFormSchema } from "@/lib/validators/inspection";
import type { InspectionFormData } from "@/types/inspection";

interface SubmitForReviewButtonProps {
  inspectionId: string;
  formData: InspectionFormData | null;
  disabled?: boolean;
}

export function SubmitForReviewButton({
  inspectionId,
  formData,
  disabled,
}: SubmitForReviewButtonProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [open, setOpen] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);

  const handleOpenDialog = () => {
    // Run validation to collect warnings
    const result = inspectionFormSchema.safeParse(formData);

    if (!result.success) {
      const issues = result.error.issues.map(
        (issue) => `${issue.path.join(" > ")}: ${issue.message}`
      );
      setWarnings(issues);
    } else {
      setWarnings([]);
    }

    setOpen(true);
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/inspections/${inspectionId}/submit`, {
        method: "POST",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to submit inspection");
      }

      toast.success("Inspection submitted for review");
      router.push("/inspections");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to submit inspection"
      );
      setIsSubmitting(false);
      setOpen(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          disabled={disabled}
          onClick={handleOpenDialog}
          className="min-h-[48px] px-6 gap-1.5"
        >
          <Send className="size-4" />
          Submit for Review
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Submit for Review?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>
              {warnings.length > 0 ? (
                <>
                  <p className="mb-2">
                    The following fields have issues:
                  </p>
                  <ul className="list-disc pl-5 space-y-1 text-sm max-h-48 overflow-y-auto">
                    {warnings.map((warning, i) => (
                      <li key={i}>{warning}</li>
                    ))}
                  </ul>
                  <p className="mt-3 text-sm">
                    You can submit anyway -- the reviewer can request corrections later.
                  </p>
                </>
              ) : (
                <p>
                  Submit this inspection for review? The admin will be able to see and
                  edit the report.
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="size-4 animate-spin mr-1.5" />
                Submitting...
              </>
            ) : warnings.length > 0 ? (
              "Submit Anyway"
            ) : (
              "Submit"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
