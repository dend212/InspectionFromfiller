"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { CommentSection, DisposalWorksContext, SepticTankContext } from "@/lib/ai/rewrite-comments";

export interface UseCommentRewriteReturn {
  isGenerating: boolean;
  generate: (
    inspectionId: string,
    section: CommentSection,
    currentComment: string,
    formContext: SepticTankContext | DisposalWorksContext,
  ) => Promise<string | null>;
}

export function useCommentRewrite(): UseCommentRewriteReturn {
  const [isGenerating, setIsGenerating] = useState(false);

  const generate = useCallback(
    async (
      inspectionId: string,
      section: CommentSection,
      currentComment: string,
      formContext: SepticTankContext | DisposalWorksContext,
    ): Promise<string | null> => {
      setIsGenerating(true);

      try {
        const res = await fetch(`/api/inspections/${inspectionId}/rewrite-comments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ section, currentComment, formContext }),
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({ error: "Generation failed" }));
          if (res.status === 429) {
            toast.error("Rate limit reached. Try again in a few minutes.");
          } else {
            toast.error(errBody.error || "Failed to generate comment");
          }
          return null;
        }

        const { rewrittenComment } = await res.json();
        return rewrittenComment;
      } catch {
        toast.error("Network error. Please try again.");
        return null;
      } finally {
        setIsGenerating(false);
      }
    },
    [],
  );

  return { isGenerating, generate };
}
