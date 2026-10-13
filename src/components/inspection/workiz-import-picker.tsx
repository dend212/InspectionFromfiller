"use client";

import { AlertTriangle, CloudDownload, Loader2, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  WorkizErrorBody,
  WorkizImporterRole,
  WorkizImportResponse,
  WorkizJobRow,
  WorkizJobsResponse,
  WorkizRouteErrorCode,
} from "@/types/workiz-import";

export const LIST_ERROR_COPY: Partial<Record<WorkizRouteErrorCode, string>> = {
  workiz_not_configured: "Workiz import isn't set up on this server yet.",
  workiz_auth_failed: "Workiz rejected the app's credentials — ask an admin to check the Workiz API token.",
  workiz_rate_limited: "Workiz is busy — try again in a minute.",
};
export const DEFAULT_LIST_ERROR = "Couldn't reach Workiz — try again.";
const DEFAULT_IMPORT_ERROR = "Couldn't import this job — try again.";
export const PREFILL_SKIPPED_TOAST =
  "Imported — the street address couldn't be read, so records lookup didn't start. Enter an APN on the next screen.";
export const PREFILL_FAILED_TOAST = "Imported — records lookup couldn't start; use Find records.";

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  year: "numeric",
});

/** "2026-10-06" → "Oct 6, 2026" — noon UTC formatted in UTC, so the day never shifts */
export function formatScheduledDate(date: string | null): string {
  return date ? DATE_FORMAT.format(new Date(`${date}T12:00:00Z`)) : "Unscheduled";
}

/** Same routing as handleRowClick in src/components/dashboard/inspections-table.tsx */
export function inspectionHref(id: string, status: string, role: WorkizImporterRole): string {
  if (status === "draft") return `/inspections/${id}/edit`;
  return role === "admin" ? `/review/${id}` : `/inspections/${id}`;
}

type Panel =
  | { kind: "closed" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: WorkizJobsResponse };

interface WorkizImportPickerProps {
  /** The page is creating a blank inspection */
  disabled?: boolean;
  /** true while an import is in flight (the page then disables Create New Inspection) */
  onBusyChange?: (busy: boolean) => void;
}

/**
 * "Import from Workiz" on /inspections/new (spec §2, §9). Fetches the job list only when opened,
 * so a slow or broken Workiz never delays the manual flow. All Workiz text renders as React text.
 */
export function WorkizImportPicker({ disabled = false, onBusyChange }: WorkizImportPickerProps) {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>({ kind: "closed" });
  const [importingId, setImportingId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const locked = disabled || importingId !== null;

  const setImporting = (jobId: string | null): void => {
    setImportingId(jobId);
    onBusyChange?.(jobId !== null);
  };

  async function load(refresh: boolean): Promise<void> {
    setPanel({ kind: "loading" });
    try {
      const res = await fetch(refresh ? "/api/workiz/jobs?refresh=1" : "/api/workiz/jobs");
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const code = (body as Partial<WorkizErrorBody> | null)?.code;
        setPanel({ kind: "error", message: (code && LIST_ERROR_COPY[code]) || DEFAULT_LIST_ERROR });
        return;
      }
      setPanel({ kind: "ready", data: body as WorkizJobsResponse });
    } catch {
      setPanel({ kind: "error", message: DEFAULT_LIST_ERROR });
    }
  }

  function markImportedByOther(jobId: string): void {
    setPanel((current) =>
      current.kind === "ready"
        ? {
            ...current,
            data: {
              ...current.data,
              jobs: current.data.jobs.map((j) => (j.id === jobId ? { ...j, existing: { canOpen: false } } : j)),
            },
          }
        : current,
    );
  }

  async function handleImport(job: WorkizJobRow, role: WorkizImporterRole): Promise<void> {
    setRowErrors(({ [job.id]: _cleared, ...rest }) => rest);
    setImporting(job.id);
    let navigating = false;
    try {
      const res = await fetch("/api/workiz/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id }),
      });
      const body: unknown = await res.json().catch(() => null);
      if (res.status === 200 || res.status === 201) {
        const result = body as WorkizImportResponse;
        if (result.existing) {
          navigating = true;
          router.push(inspectionHref(result.inspectionId, result.status, role));
          return;
        }
        // Fired just before router.push; the dashboard layout's <Toaster /> survives the navigation
        if (result.prefill.status === "skipped") toast.warning(PREFILL_SKIPPED_TOAST);
        if (result.prefill.status === "failed") toast.warning(PREFILL_FAILED_TOAST);
        navigating = true;
        router.push(`/inspections/${result.inspectionId}/edit`);
        return;
      }
      const message = (body as Partial<WorkizErrorBody> | null)?.error || DEFAULT_IMPORT_ERROR;
      if (res.status === 409) markImportedByOther(job.id);
      setRowErrors((prev) => ({ ...prev, [job.id]: message }));
      toast.error(message);
    } catch {
      setRowErrors((prev) => ({ ...prev, [job.id]: DEFAULT_IMPORT_ERROR }));
      toast.error(DEFAULT_IMPORT_ERROR);
    } finally {
      // Stay busy while navigating so nothing else can be created in the meantime
      if (!navigating) setImporting(null);
    }
  }

  function renderAction(job: WorkizJobRow, role: WorkizImporterRole) {
    const serial = job.serialId ?? "?";
    const existing = job.existing;
    if (existing === null) {
      return (
        <Button
          type="button"
          size="sm"
          disabled={locked}
          aria-label={`Import Workiz job ${serial}, ${job.street}`}
          onClick={() => void handleImport(job, role)}
        >
          {importingId === job.id ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Importing…
            </>
          ) : (
            "Import"
          )}
        </Button>
      );
    }
    if (existing.canOpen) {
      return (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={locked}
          aria-label={`Open the inspection for Workiz job ${serial}`}
          onClick={() => router.push(inspectionHref(existing.inspectionId, existing.status, role))}
        >
          {existing.status === "draft" ? "Open existing" : "Report submitted"}
        </Button>
      );
    }
    return (
      <Button type="button" size="sm" variant="outline" disabled>
        Imported by another inspector
      </Button>
    );
  }

  const listBusy = panel.kind === "loading";

  return (
    <div className="contents">
      <Button
        type="button"
        size="lg"
        variant="outline"
        disabled={locked || listBusy}
        aria-expanded={panel.kind !== "closed"}
        aria-controls="workiz-import-panel"
        onClick={() => {
          if (panel.kind === "closed") void load(false);
        }}
      >
        <CloudDownload className="size-5" aria-hidden="true" />
        Import from Workiz
      </Button>

      {panel.kind !== "closed" && (
        <div id="workiz-import-panel" className="flex w-full basis-full justify-center">
          <Card className="w-full max-w-xl">
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-base">
                ADEQ jobs awaiting reports{panel.kind === "ready" ? ` (${panel.data.jobs.length})` : ""}
              </CardTitle>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Refresh Workiz jobs"
                disabled={locked || listBusy}
                onClick={() => void load(true)}
              >
                <RefreshCw className="size-4" aria-hidden="true" />
              </Button>
            </CardHeader>
            <CardContent>
              {panel.kind === "loading" && (
                <p aria-live="polite" className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Loading Workiz jobs…
                </p>
              )}

              {panel.kind === "error" && (
                <div aria-live="polite" className="space-y-2 text-sm">
                  <p className="text-destructive">{panel.message}</p>
                  <Button type="button" size="sm" variant="outline" disabled={locked} onClick={() => void load(false)}>
                    Retry
                  </Button>
                  <p className="text-muted-foreground">
                    You can still start a blank inspection with Create New Inspection.
                  </p>
                </div>
              )}

              {panel.kind === "ready" && panel.data.jobs.length === 0 && (
                <p aria-live="polite" className="text-sm text-muted-foreground">
                  No ADEQ jobs are waiting for reports in Workiz.
                </p>
              )}

              {panel.kind === "ready" && panel.data.jobs.length > 0 && (
                // biome-ignore lint/a11y/noRedundantRoles: Safari drops list semantics under list-style:none
                // biome-ignore lint/a11y/useSemanticElements: same element; it already is a <ul>
                <ul role="list" className="max-h-[60vh] divide-y overflow-y-auto">
                  {panel.data.jobs.map((job) => {
                    const me = panel.data.currentUserFirstName?.toLowerCase();
                    const notOnTeam =
                      !!me && job.existing === null && !job.teamFirstNames.some((name) => name.toLowerCase() === me);
                    return (
                      <li key={job.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 space-y-1">
                          <p className="text-sm font-medium">
                            <span>#{job.serialId ?? "?"}</span> · <span>{[job.street, job.city].filter(Boolean).join(", ")}</span>
                          </p>
                          <p className="text-xs text-muted-foreground">{formatScheduledDate(job.scheduledDate)}</p>
                          {job.subStatus && <Badge variant="secondary">{job.subStatus}</Badge>}
                          {job.teamFirstNames.length > 0 && (
                            <p className="text-xs text-muted-foreground">Team: {job.teamFirstNames.join(", ")}</p>
                          )}
                          {rowErrors[job.id] && (
                            <p role="alert" className="text-sm text-destructive">
                              {rowErrors[job.id]}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
                          {renderAction(job, panel.data.role)}
                          {notOnTeam && (
                            <p className="flex items-center gap-1 text-xs text-muted-foreground">
                              <AlertTriangle className="size-3" aria-hidden="true" />
                              You're not on this job's Workiz team
                            </p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
