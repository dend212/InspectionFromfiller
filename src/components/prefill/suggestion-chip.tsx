"use client";

import { X } from "lucide-react";
import { SOURCE_META } from "@/lib/prefill/sources";
import type { ProvenanceEntry } from "@/lib/prefill/types";
import { cn } from "@/lib/utils";
import { confidencePercent, formatProvenanceValue } from "./format";
import { useProvenance } from "./provenance-context";

const WARNING_CLASS = "border-amber-300 text-amber-900 bg-amber-50";

export function suggestionText(entry: ProvenanceEntry): string {
  if (entry.kind === "warning") return entry.explanation;
  return `Suggested: ${formatProvenanceValue(entry.value)} · ${confidencePercent(entry.confidence)} · ${entry.explanation}`;
}

interface SuggestionChipProps {
  fieldPath: string;
}

/**
 * Rendered by FormItem under a field whose provenance entry is "suggested":
 * below-threshold values and proposals for fields that already had a value.
 * Tap the text to accept; × dismisses. Warnings carry no value — dismiss only.
 */
export function SuggestionChip({ fieldPath }: SuggestionChipProps) {
  const { entry, acceptSuggestion, dismissSuggestion, readOnly } = useProvenance(fieldPath);
  if (!entry || entry.state !== "suggested") return null;

  const meta = SOURCE_META[entry.source];
  const isWarning = entry.kind === "warning";

  return (
    <div
      data-slot="suggestion-chip"
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
        isWarning ? WARNING_CLASS : meta.accentClass,
      )}
    >
      {isWarning ? (
        <span className="truncate">{entry.explanation}</span>
      ) : (
        <button
          type="button"
          disabled={readOnly}
          aria-label={`Accept suggestion from ${meta.label}: ${formatProvenanceValue(entry.value)}`}
          onClick={() => acceptSuggestion(fieldPath)}
          className="truncate text-left underline-offset-2 hover:underline disabled:no-underline"
        >
          {suggestionText(entry)}
        </button>
      )}
      {!readOnly && (
        <button
          type="button"
          aria-label="Dismiss suggestion"
          onClick={() => dismissSuggestion(fieldPath)}
          className="ml-1 shrink-0 rounded-full p-0.5 hover:bg-black/5"
        >
          <X className="h-3 w-3" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
