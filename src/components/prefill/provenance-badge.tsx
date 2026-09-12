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

/** Grace period after the pointer/focus leaves a hover-opened popover before it closes */
export const BADGE_HOVER_CLOSE_DELAY_MS = 200;

/** First tabbable control inside the popover card, for keyboard users who pin it open */
function focusFirstTabbable(root: HTMLElement | null): void {
  root
    ?.querySelector<HTMLElement>(
      'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    )
    ?.focus();
}

/**
 * Small dot + text badge rendered by FormLabel next to every prefilled field.
 *
 * Opening model (spec §2.3 / §9: "opens on tap and hover"):
 *  - hover or keyboard focus *peeks* the popover: it shows without taking focus and closes
 *    shortly after the pointer/focus leaves (the pointer may travel into the card);
 *  - tap / click / Enter *pins* it: it stays until the badge is clicked again, Escape,
 *    an outside click, or Verify / Clear. A keyboard pin moves focus into the card so
 *    Verify / Clear stay reachable.
 */
export function ProvenanceBadge({ fieldPath }: ProvenanceBadgeProps) {
  const { entry, verify, clear, readOnly } = useProvenance(fieldPath);
  const [open, setOpen] = React.useState(false);
  const pinnedRef = React.useRef(false);
  /** Set while Radix hands focus back to the badge on close — that focus must not re-open it */
  const returningFocusRef = React.useRef(false);
  /**
   * Whether the card held focus at the moment it closed. Captured in close(), because by the
   * time Radix asks about close auto-focus the card is already out of the DOM (its ref is null
   * and document.activeElement has fallen back to body).
   */
  const focusWasInCardRef = React.useRef(false);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = React.useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);
  const close = React.useCallback(() => {
    cancelClose();
    pinnedRef.current = false;
    focusWasInCardRef.current = contentRef.current?.contains(document.activeElement) ?? false;
    setOpen(false);
  }, [cancelClose]);
  /** Close after the grace period unless pinned (or the pointer/focus came back) */
  const scheduleClose = React.useCallback(() => {
    if (pinnedRef.current) return;
    cancelClose();
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      if (!pinnedRef.current) close();
    }, BADGE_HOVER_CLOSE_DELAY_MS);
  }, [cancelClose, close]);
  const peek = React.useCallback(() => {
    cancelClose();
    setOpen(true);
  }, [cancelClose]);
  const handleTriggerFocus = React.useCallback(() => {
    if (returningFocusRef.current) {
      returningFocusRef.current = false;
      return;
    }
    peek();
  }, [peek]);

  React.useEffect(() => cancelClose, [cancelClose]);

  if (!entry || entry.kind !== "fill" || entry.state === "suggested") return null;

  const meta = SOURCE_META[entry.source];
  const dotClass =
    entry.state === "verified"
      ? VERIFIED_DOT_CLASS
      : entry.state === "edited"
        ? EDITED_DOT_CLASS
        : meta.dotClass;

  const handleTriggerClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    // Handled here instead of Radix's toggle: a click on a hover-opened popover must pin it,
    // not close it. preventDefault skips the composed Radix onClick.
    event.preventDefault();
    cancelClose();
    if (open && pinnedRef.current) {
      close();
      return;
    }
    pinnedRef.current = true;
    setOpen(true);
    // detail === 0: keyboard activation (Enter / Space) — hand focus to the card when it
    // is already showing from the focus peek (a fresh open autofocuses via Radix instead)
    if (event.detail === 0 && open) focusFirstTabbable(contentRef.current);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        // Radix dismissals (Escape, outside click, focus outside) land here
        if (next) setOpen(true);
        else close();
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={badgeAriaLabel(entry)}
          data-slot="provenance-badge"
          data-provenance-state={entry.state}
          onClick={handleTriggerClick}
          onMouseEnter={peek}
          onMouseLeave={scheduleClose}
          onFocus={handleTriggerFocus}
          onBlur={scheduleClose}
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
      <PopoverContent
        ref={contentRef}
        align="start"
        className="w-80 space-y-3 text-sm"
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
        onFocusCapture={() => {
          // Focus moved into the card (Tab or a click on Verify / Clear): keep it open
          cancelClose();
          pinnedRef.current = true;
        }}
        onOpenAutoFocus={(event) => {
          // A peek must not steal focus from the field the user is on
          if (!pinnedRef.current) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          // Non-modal Radix content focuses the trigger on close unless something interacted
          // outside. A peek that closes on its timer, or Escape while peeked, is neither: the
          // user is still in the field they were typing in, so leave focus there.
          if (!focusWasInCardRef.current) {
            event.preventDefault();
            return;
          }
          focusWasInCardRef.current = false;
          // Focus was inside the card (keyboard pin + Escape, Verify, Clear) and is about to
          // return to the badge: swallow that one focus event so the popover does not peek
          // straight back open. Cleared on the next tick in case focus goes elsewhere.
          returningFocusRef.current = true;
          setTimeout(() => {
            returningFocusRef.current = false;
          }, 0);
        }}
      >
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
                close();
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
                close();
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
