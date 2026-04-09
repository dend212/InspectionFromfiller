"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { JobRewriteType } from "@/lib/ai/rewrite-job-notes";

export interface UseJobNoteRewriteReturn {
  isGenerating: boolean;
  generate: (params: {
    jobId: string;
    type: JobRewriteType;
    currentText?: string;
    checklistItemId?: string;
  }) => Promise<string | null>;
}

/**
 * Mirror of useCommentRewrite for the Jobs module. One hook covers all three
 * rewrite scopes since the API is a single endpoint with a `type` discriminator.
 */
export function useJobNoteRewrite(): UseJobNoteRewriteReturn {
  const [isGenerating, setIsGenerating] = useState(false);

  const generate = useCallback(
    async (params: {
      jobId: string;
      type: JobRewriteType;
      currentText?: string;
      checklistItemId?: string;
    }): Promise<string | null> => {
      setIsGenerating(true);
      try {
        const res = await fetch(`/api/jobs/${params.jobId}/rewrite`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: params.type,
            currentText: params.currentText ?? "",
            checklistItemId: params.checklistItemId,
          }),
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({ error: "Generation failed" }));
          if (res.status === 429) {
            toast.error("Rate limit reached. Try again in a few minutes.");
          } else {
            toast.error(errBody.error || "Failed to generate text");
          }
          return null;
        }

        const { rewrittenText } = await res.json();
        return rewrittenText;
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
