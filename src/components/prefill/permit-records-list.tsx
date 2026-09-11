"use client";

import { Copy, ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { rankForExtraction } from "@/lib/prefill/permits/doc-types";
import {
  type InspectionRecordDTO,
  MAX_DOCUMENTS_PER_RUN,
  type PermitCandidate,
  type PrefillRunDTO,
} from "@/lib/prefill/types";

export interface PermitRecordsListProps {
  run: PrefillRunDTO;
  /** usePrefill().selectCandidates — POSTs /prefill/[runId]/select and resumes polling */
  onSelectCandidates: (keys: string[]) => Promise<void> | void;
  /** True while a run is in flight or on read-only views — the picker cannot submit */
  disabled?: boolean;
}

export interface CandidateGroup {
  key: string;
  /** "8911 E PRINCESS DR, MESA 85207" */
  label: string;
  /** "Subdivision SUNRISE 4 · Lot 2 · APN 200-08-079" */
  detail: string;
  candidates: PermitCandidate[];
}

/** "2018-02-08" → "2/8/2018" (string split — no Date/timezone drift) */
export function formatDocDate(iso?: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${Number(m)}/${Number(d)}/${y}`;
}

export function formatBytes(n?: number | null): string {
  if (n === null || n === undefined) return "";
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

/**
 * Identity for the picker's property groups. NOTE: this is deliberately an
 * exact match on the raw candidate fields (not `groupByProperty` from
 * ./permits/search, which fuzzy-merges rows sharing a house number + street
 * even when city/ZIP/APN are only blank-compatible — right for the search
 * fallback's auto-select heuristic, wrong here: two rows with the same
 * street address but a different confirmed APN must stay distinct options in
 * the picker rather than silently collapse into one).
 */
function candidateIdentity(c: PermitCandidate): string {
  return [c.streetAddress ?? "", c.city ?? "", c.zip ?? "", c.apn ?? ""].join("|");
}

export function groupCandidates(candidates: PermitCandidate[]): CandidateGroup[] {
  const groups = new Map<string, CandidateGroup>();
  for (const c of candidates) {
    const key = candidateIdentity(c);
    let group = groups.get(key);
    if (!group) {
      const place = [c.streetAddress, [c.city, c.zip].filter(Boolean).join(" ")]
        .filter(Boolean)
        .join(", ");
      const detail = [
        c.subdivision ? `Subdivision ${c.subdivision}` : "",
        c.lot ? `Lot ${c.lot}` : "",
        c.apn ? `APN ${c.apn}` : "No APN on record",
      ]
        .filter(Boolean)
        .join(" · ");
      group = { key, label: place || "Address not recorded", detail, candidates: [] };
      groups.set(key, group);
    }
    group.candidates.push(c);
  }
  return [...groups.values()];
}

function statusLabel(r: InspectionRecordDTO): string {
  switch (r.extractionStatus) {
    case "pending":
      return "Queued for extraction";
    case "done":
      return "Extracted";
    case "failed":
      return `${r.extractionError ?? "Failed"} — re-run Find records`;
    default:
      return r.extractionError ?? "Not extracted";
  }
}

export function PermitRecordsList({ run, onSelectCandidates, disabled }: PermitRecordsListProps) {
  const [chosenGroup, setChosenGroup] = useState<string | null>(null);
  const groups = useMemo(() => groupCandidates(run.candidates), [run.candidates]);
  const showPicker = run.status === "awaiting_selection" && groups.length > 0;
  const apn = run.input.apn;

  const handleUseSelected = async () => {
    const group = groups.find((g) => g.key === chosenGroup);
    if (!group) return;
    const keys = rankForExtraction(group.candidates)
      .slice(0, MAX_DOCUMENTS_PER_RUN)
      .map((c) => c.key);
    await onSelectCandidates(keys);
  };

  const handleCopyApn = async () => {
    if (!apn) return;
    try {
      await navigator.clipboard.writeText(apn);
      toast.success(`Copied ${apn} — paste it into the EDMS parcel search`);
    } catch {
      toast.error("Could not copy — select the APN and copy it manually");
    }
  };

  if (run.records.length === 0 && !showPicker && !apn) return null;

  return (
    <div className="space-y-3 pl-6 text-sm" data-slot="permit-records-list">
      {run.records.length > 0 && (
        <ul aria-label="Permit documents" className="space-y-1.5">
          {run.records.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="font-medium">{r.permitNumber}</span>
              {r.isAbandonment ? (
                <span className="rounded bg-red-100 px-1 text-xs font-semibold uppercase text-red-800">
                  {r.docType}
                </span>
              ) : (
                <span className="text-muted-foreground">{r.docType}</span>
              )}
              {r.docDate && (
                <span className="text-muted-foreground">{formatDocDate(r.docDate)}</span>
              )}
              {r.pageCount !== null && (
                <span className="text-muted-foreground">
                  {r.pageCount} page{r.pageCount === 1 ? "" : "s"}
                </span>
              )}
              {r.sizeBytes !== null && (
                <span className="text-muted-foreground">{formatBytes(r.sizeBytes)}</span>
              )}
              <span className="text-xs text-muted-foreground">{statusLabel(r)}</span>
              {r.downloadUrl && (
                // Plain anchor on purpose: next/link would prefetch the GET and burn a signed URL.
                <a
                  href={r.downloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                >
                  Open PDF
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}

      {showPicker && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
          <p className="mb-2 font-medium text-amber-900">
            {run.stages.permits.summary ??
              `${run.candidates.length} possible permits — pick the right one`}
          </p>
          <div role="radiogroup" aria-label="Possible permits" className="space-y-2">
            {groups.map((g) => (
              <label key={g.key} className="flex cursor-pointer items-start gap-2">
                <input
                  type="radio"
                  name={`permit-candidate-${run.id}`}
                  value={g.key}
                  checked={chosenGroup === g.key}
                  onChange={() => setChosenGroup(g.key)}
                  className="mt-1"
                />
                <span>
                  <span className="block font-medium">{g.label}</span>
                  <span className="block text-xs text-muted-foreground">{g.detail}</span>
                  <span className="block text-xs">
                    {g.candidates
                      .map(
                        (c) =>
                          `${c.permitNumber} · ${c.docType}${c.docDate ? ` · ${formatDocDate(c.docDate)}` : ""}`,
                      )
                      .join(" | ")}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <Button
            type="button"
            size="sm"
            className="mt-3"
            disabled={!chosenGroup || disabled}
            onClick={handleUseSelected}
          >
            Use selected
          </Button>
        </div>
      )}

      {apn && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1.5 px-2"
          onClick={handleCopyApn}
          aria-label={`Copy APN ${apn}`}
        >
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          Copy APN {apn}
        </Button>
      )}
    </div>
  );
}
