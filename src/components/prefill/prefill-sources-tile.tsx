"use client";

import { AlertTriangle, Check, ChevronDown, Loader2, Minus, Search, SearchX } from "lucide-react";
import * as React from "react";
import { PermitRecordsList } from "@/components/prefill/permit-records-list";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { isSafeSourceUrl } from "@/lib/prefill/provenance-schema";
import type { PrefillRunDTO, PrefillStage, PrefillStages, StageStatus } from "@/lib/prefill/types";
import { cn } from "@/lib/utils";

const STAGE_ROWS: Array<{ key: keyof PrefillStages; label: string }> = [
  { key: "assessor", label: "Assessor" },
  { key: "listing", label: "Listing" },
  { key: "permits", label: "Permits" },
];

const DEFAULT_SUMMARY: Record<StageStatus, string> = {
  pending: "Waiting…",
  running: "Searching…",
  done: "Done",
  not_found: "No records found",
  error: "Failed",
  skipped: "Not available yet",
};

export function stageSummary(stage: PrefillStage): string {
  if (stage.summary) return stage.summary;
  if (stage.status === "error" && stage.error) return stage.error;
  return DEFAULT_SUMMARY[stage.status];
}

function StageIcon({ status }: { status: StageStatus }) {
  const base = "h-4 w-4 shrink-0 mt-0.5";
  switch (status) {
    case "running":
      return <Loader2 className={cn(base, "animate-spin text-primary")} aria-hidden="true" />;
    case "done":
      return <Check className={cn(base, "text-emerald-600")} aria-hidden="true" />;
    case "not_found":
      return <SearchX className={cn(base, "text-muted-foreground")} aria-hidden="true" />;
    case "error":
      return <AlertTriangle className={cn(base, "text-destructive")} aria-hidden="true" />;
    default:
      return <Minus className={cn(base, "text-muted-foreground")} aria-hidden="true" />;
  }
}

function Banner({ tone, children }: { tone: "destructive" | "red"; children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className={cn(
        "rounded-md border p-2 text-sm",
        tone === "destructive"
          ? "border-destructive/50 bg-destructive/10 text-destructive"
          : "border-red-300 bg-red-50 font-medium text-red-900",
      )}
    >
      {children}
    </div>
  );
}

/**
 * Locale-formatted timestamps differ between the SSR pass (Vercel, UTC) and the
 * browser (Phoenix), so the text is only produced after mount — the server markup
 * omits it and hydration has nothing to disagree about.
 */
function LastRunTime({ iso }: { iso: string }) {
  const [text, setText] = React.useState<string | null>(null);
  React.useEffect(() => {
    setText(new Date(iso).toLocaleString());
  }, [iso]);
  if (text === null) return null;
  return <span className="truncate text-xs text-muted-foreground">Last run {text}</span>;
}

export interface PrefillSourcesTileProps {
  run: PrefillRunDTO | null;
  isRunning: boolean;
  /** False on non-drafts / read-only views — the button is disabled */
  canRun: boolean;
  /** Hook-level error (409 / 429 / network) shown above the rows */
  error: string | null;
  onFindRecords: () => void;
  /** usePrefill().selectCandidates; omit on read-only views — the picker then cannot submit */
  onSelectCandidates?: (keys: string[]) => Promise<void> | void;
}

/**
 * "Prefill sources" card above step 1: one row per source with status, summary
 * and links, the Find records button, and the failure / abandonment banners.
 * The candidate picker (ambiguous permits) arrives in phase 2.
 */
export function PrefillSourcesTile({
  run,
  isRunning,
  canRun,
  error,
  onFindRecords,
  onSelectCandidates,
}: PrefillSourcesTileProps) {
  const [open, setOpen] = React.useState(true);
  const hasAbandonment = run?.records.some((r) => r.isAbandonment) ?? false;
  const failed = run?.status === "failed";

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-lg border bg-card"
      data-slot="prefill-sources-tile"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <CollapsibleTrigger asChild>
          <button type="button" className="flex min-w-0 items-center gap-2 text-left">
            <ChevronDown
              className={cn("h-4 w-4 shrink-0 transition-transform", !open && "-rotate-90")}
              aria-hidden="true"
            />
            <span className="text-sm font-semibold">Prefill sources</span>
            {run && <LastRunTime iso={run.createdAt} />}
          </button>
        </CollapsibleTrigger>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onFindRecords}
          disabled={!canRun || isRunning}
          className="gap-2"
        >
          {isRunning ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Search className="h-4 w-4" aria-hidden="true" />
          )}
          {isRunning ? "Searching…" : "Find records"}
        </Button>
      </div>

      <CollapsibleContent>
        <div className="space-y-3 border-t px-4 py-3">
          {error && <Banner tone="destructive">{error}</Banner>}
          {failed && (
            <Banner tone="destructive">
              Prefill failed — Find records to retry{run?.error ? ` (${run.error})` : ""}
            </Banner>
          )}
          {hasAbandonment && (
            <Banner tone="red">
              An ABANDONMENT document was found for this parcel — the system may have been
              abandoned. Review the permit records before continuing.
            </Banner>
          )}

          {run ? (
            <ul className="space-y-2">
              {STAGE_ROWS.map(({ key, label }) => {
                const stage = run.stages[key];
                const safeLinks = stage.links.filter((link) => isSafeSourceUrl(link.url));
                return (
                  <li
                    key={key}
                    className="flex flex-col gap-1 text-sm"
                    data-stage={key}
                    data-status={stage.status}
                  >
                    <div className="flex items-start gap-2">
                      <StageIcon status={stage.status} />
                      <div className="min-w-0 flex-1">
                        <span className="font-medium">{label}</span>
                        <span className="text-muted-foreground"> · {stageSummary(stage)}</span>
                        {safeLinks.length > 0 && (
                          <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1">
                            {safeLinks.map((link) => (
                              <a
                                key={link.url}
                                href={link.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-primary underline underline-offset-2"
                              >
                                {link.label}
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    {key === "permits" && (
                      <PermitRecordsList
                        run={run}
                        onSelectCandidates={onSelectCandidates ?? (() => undefined)}
                        disabled={isRunning || !onSelectCandidates}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Pull owner, address and permit details from county records into this form. Each
              value gets a badge so you can verify where it came from.
            </p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
