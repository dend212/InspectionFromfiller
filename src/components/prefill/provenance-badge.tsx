"use client";

import { Check, ExternalLink } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { isSafeSourceUrl } from "@/lib/prefill/provenance-schema";
import { EDITED_DOT_CLASS, SOURCE_META, VERIFIED_DOT_CLASS } from "@/lib/prefill/sources";
import type { ProvenanceEntry } from "@/lib/prefill/types";
import { cn } from "@/lib/utils";
import { confidencePercent, formatProvenanceValue } from "./format";
import { useProvenance } from "./provenance-context";

/** Visible badge text — always present so colour is never the only signal */
export function badgeText(entry: ProvenanceEntry): string {
  if (entry.state === "verified") return "verified";
  if (entry.state === "edited") return "edited";
  return confidencePercent(entry.confidence);
}

export function badgeAriaLabel(entry: ProvenanceEntry): string {
  const label = SOURCE_META[entry.source].label;
  const pct = confidencePercent(entry.confidence);
  if (entry.state === "verified") return `Verified. Prefilled from ${label}, ${pct} confidence`;
  if (entry.state === "edited") return `Edited after prefill from ${label}, ${pct} confidence`;
  return `Prefilled from ${label}, ${pct} confidence`;
}

interface ProvenanceBadgeProps {
  fieldPath: string;
}

/**
 * Small dot + text badge rendered by FormLabel next to every prefilled field.
 * Tap opens the explanation popover (no hover needed — works on phones).
 */
export function ProvenanceBadge({ fieldPath }: ProvenanceBadgeProps) {
  const { entry, verify, clear, readOnly } = useProvenance(fieldPath);
  const [open, setOpen] = React.useState(false);

  if (!entry || entry.kind !== "fill" || entry.state === "suggested") return null;

  const meta = SOURCE_META[entry.source];
  const dotClass =
    entry.state === "verified"
      ? VERIFIED_DOT_CLASS
      : entry.state === "edited"
        ? EDITED_DOT_CLASS
        : meta.dotClass;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={badgeAriaLabel(entry)}
          data-slot="provenance-badge"
          data-provenance-state={entry.state}
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full border bg-background px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground",
            "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            entry.state === "verified" && "text-emerald-700",
          )}
        >
          <span aria-hidden="true" className={cn("h-2 w-2 rounded-full", dotClass)} />
          {entry.state === "verified" && <Check className="h-3 w-3" aria-hidden="true" />}
          {badgeText(entry)}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-3 text-sm">
        <div>
          <p className="font-medium">{meta.label}</p>
          <p className="text-muted-foreground">{entry.explanation}</p>
        </div>
        <p>
          <span className="text-muted-foreground">Value: </span>
          <span className="font-medium">{formatProvenanceValue(entry.value)}</span>
          <span className="text-muted-foreground">
            {" "}
            · {confidencePercent(entry.confidence)} confidence
          </span>
        </p>
        {entry.evidence && (
          <blockquote className="border-l-2 pl-2 text-muted-foreground italic">
            “{entry.evidence}”
          </blockquote>
        )}
        {entry.sourceUrl && isSafeSourceUrl(entry.sourceUrl) ? (
          <a
            href={entry.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary underline underline-offset-2"
          >
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
            Open source{entry.page ? ` (p. ${entry.page})` : ""}
          </a>
        ) : (
          entry.page && <p className="text-muted-foreground">p. {entry.page}</p>
        )}
        {!readOnly && (
          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              disabled={entry.state === "verified"}
              onClick={() => {
                verify(fieldPath);
                setOpen(false);
              }}
            >
              Verify
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                clear(fieldPath);
                setOpen(false);
              }}
            >
              Clear
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
