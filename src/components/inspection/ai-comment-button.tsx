"use client";

import { useCallback } from "react";
import { useFormContext } from "react-hook-form";
import { Loader2, WandSparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useCommentRewrite } from "@/hooks/use-comment-rewrite";
import { cn } from "@/lib/utils";
import type { CommentSection, DisposalWorksContext, SepticTankContext } from "@/lib/ai/rewrite-comments";
import type { InspectionFormData } from "@/types/inspection";

interface AiCommentButtonProps {
  inspectionId: string;
  section: CommentSection;
  fieldPath: "septicTank.septicTankComments" | "disposalWorks.disposalWorksComments";
  buildContext: () => SepticTankContext | DisposalWorksContext;
}

export function AiCommentButton({ inspectionId, section, fieldPath, buildContext }: AiCommentButtonProps) {
  const form = useFormContext<InspectionFormData>();
  const { isGenerating, generate } = useCommentRewrite();

  const handleGenerate = useCallback(async () => {
    const currentComment = form.getValues(fieldPath) ?? "";
    const context = buildContext();

    const result = await generate(inspectionId, section, currentComment, context);
    if (result) {
      form.setValue(fieldPath, result, { shouldDirty: true });
      toast.success("Comment generated");
    }
  }, [form, fieldPath, buildContext, generate, inspectionId, section]);

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={isGenerating}
      onClick={handleGenerate}
      className="gap-1.5"
    >
      {isGenerating ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <WandSparkles className="h-4 w-4" />
      )}
      {isGenerating ? "Generating..." : "Generate with AI"}
    </Button>
  );
}

const OVERFLOW_THRESHOLD = 200;

export function CharacterCount({ value }: { value: string }) {
  const len = (value || "").length;
  if (len === 0) return null;

  const color =
    len <= OVERFLOW_THRESHOLD
      ? "text-green-600 dark:text-green-400"
      : len <= 300
        ? "text-amber-600 dark:text-amber-400"
        : "text-red-600 dark:text-red-400";

  return (
    <p className={cn("text-xs mt-1", color)}>
      {len} / {OVERFLOW_THRESHOLD} characters
      {len > OVERFLOW_THRESHOLD && " (will use overflow page)"}
    </p>
  );
}
