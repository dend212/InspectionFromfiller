"use client";

import { X } from "lucide-react";
import { useFormContext, useWatch } from "react-hook-form";
import { valuesEqual } from "@/lib/prefill/merge";
import { SOURCE_META } from "@/lib/prefill/sources";
import type { ProvenanceEntry } from "@/lib/prefill/types";
import { cn } from "@/lib/utils";
import { confidencePercent, formatProvenanceValue } from "./format";
import { useProvenance } from "./provenance-context";

const WARNING_CLASS = "border-amber-300 text-amber-900 bg-amber-50";

/** Values longer than this are shortened on the chip itself (title/aria-label keep the full text) */
export const SUGGESTION_VALUE_MAX_CHARS = 60;
const SUGGESTION_VALUE_HEAD_CHARS = 57;

function shortenValue(value: string): string {
  if (value.length <= SUGGESTION_VALUE_MAX_CHARS) return value;
  return `${value.slice(0, SUGGESTION_VALUE_HEAD_CHARS)}…`;
}

function buildSuggestionText(entry: ProvenanceEntry, shorten: boolean): string {
  if (entry.kind === "warning") return entry.explanation;
  const value = formatProvenanceValue(entry.value);
  const head = `Suggested: ${shorten ? shortenValue(value) : value} · ${confidencePercent(entry.confidence)}`;
  // Some sources explain a value with the value itself (e.g. an age-estimate basis) — don't say it twice
  if (value.trim().toLowerCase() === entry.explanation.trim().toLowerCase()) return head;
  return `${head} · ${entry.explanation}`;
}

/** Full text — used for `title` so the chip is always readable in full */
export function suggestionText(entry: ProvenanceEntry): string {
  return buildSuggestionText(entry, false);
}

/** Text shown on the chip: same as `suggestionText` with an over-long value shortened */
export function suggestionDisplayText(entry: ProvenanceEntry): string {
  return buildSuggestionText(entry, true);
}

interface SuggestionChipProps {
  fieldPath: string;
}

/**
 * Rendered by FormItem under a field whose provenance entry is "suggested":
 * below-threshold values and proposals for fields that already had a value.
 * Tap the text to accept; × dismisses. Warnings carry no value — dismiss only.
 * Hidden while the field already holds the suggested value.
 */
export function SuggestionChip({ fieldPath }: SuggestionChipProps) {
  // Outside a react-hook-form provider (tests, stray usages) there is no live value to compare
  const form = useFormContext();
  if (!form) return <SuggestionChipBody fieldPath={fieldPath} />;
  return <WatchedSuggestionChip fieldPath={fieldPath} />;
}

function WatchedSuggestionChip({ fieldPath }: SuggestionChipProps) {
  const currentValue = useWatch({ name: fieldPath });
  return <SuggestionChipBody fieldPath={fieldPath} currentValue={currentValue} />;
}

function SuggestionChipBody({
  fieldPath,
  currentValue,
}: SuggestionChipProps & { currentValue?: unknown }) {
  const { entry, acceptSuggestion, dismissSuggestion, readOnly } = useProvenance(fieldPath);
  if (!entry || entry.state !== "suggested") return null;

  const meta = SOURCE_META[entry.source];
  const isWarning = entry.kind === "warning";
  // Nothing to suggest when the field already says exactly this (warnings have no value to compare)
  if (!isWarning && valuesEqual(currentValue, entry.value)) return null;

  return (
    <div
      data-slot="suggestion-chip"
      className={cn(
        // w-fit + justify-self-start: hug the text instead of stretching to the grid column;
        // max-w-full + min-w-0: still wrap inside that column.
        "inline-flex w-fit min-w-0 max-w-full justify-self-start items-start gap-1 whitespace-normal break-words rounded-lg border px-2 py-0.5 text-xs",
        isWarning ? WARNING_CLASS : meta.accentClass,
      )}
    >
      {isWarning ? (
        <span className="min-w-0 whitespace-normal break-words" title={entry.explanation}>
          {entry.explanation}
        </span>
      ) : (
        <button
          type="button"
          disabled={readOnly}
          aria-label={`Accept suggestion from ${meta.label}: ${formatProvenanceValue(entry.value)}`}
          title={suggestionText(entry)}
          onClick={() => acceptSuggestion(fieldPath)}
          className="min-w-0 whitespace-normal break-words text-left underline-offset-2 hover:underline disabled:no-underline"
        >
          {suggestionDisplayText(entry)}
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
