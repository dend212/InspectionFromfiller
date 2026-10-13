"use client";

import { AlertTriangle, ExternalLink } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { headerNoun, matchDetailLine } from "@/lib/inspection-matches/format";
import {
  buildMatchQuery,
  MATCH_FIELD_BODY_MAX,
  matchQueryKey,
} from "@/lib/inspection-matches/normalize";
import { cn } from "@/lib/utils";
import type { InspectionMatchRequest, InspectionMatchResult } from "@/types/inspection-matches";
import type { InspectionFormData } from "@/types/inspection";

/** Exact copy (duplicate-warning spec §2.3) */
export const headerSingle = (noun: string): string => `This ${noun} may match another report`;
export const headerMultiple = (noun: string): string => `This ${noun} may match other reports:`;
export const PICKER_HEADER_SINGLE = "May match an existing report";
export const PICKER_HEADER_MULTIPLE = "May match existing reports:";
export const hiddenOnly = (n: number): string =>
  n === 1 ? "May match a report by another inspector" : `May match ${n} reports by other inspectors`;
export const hiddenTail = (n: number): string =>
  n === 1 ? "+ 1 more by another inspector" : `+ ${n} more by other inspectors`;
export const MORE_MATCHES = "More matches exist — search the dashboard for this address.";
export const MATCH_CHECK_FAILED = "Couldn't check for matching reports.";
export const MATCH_ANNOUNCEMENT = "Possible matching report found";
export const NEW_TAB_SUFFIX = "(opens in a new tab)";

export const MATCH_DEBOUNCE_MS = 700;

const BOX = "rounded-md border border-amber-300 bg-amber-50 dark:border-amber-700/60 dark:bg-amber-950/30";
const HEADER_TEXT = "font-medium text-amber-900 dark:text-amber-200";
const MUTED_TEXT = "text-amber-800/90 dark:text-amber-300/90";

function NewTabSuffix() {
  return <span className="sr-only"> {NEW_TAB_SUFFIX}</span>;
}

interface PossibleDuplicateNoticeProps {
  result: InspectionMatchResult;
  /** compact = a Workiz picker row */
  variant?: "default" | "compact";
}

/**
 * Amber "may match another report" box. Information only: every link is a plain new-tab anchor
 * (no next/link prefetch of other inspections). Hidden matches render as a count, never a link.
 */
export function PossibleDuplicateNotice({ result, variant = "default" }: PossibleDuplicateNoticeProps) {
  const { matches, hiddenCount, truncated } = result;
  if (matches.length + hiddenCount === 0) return null;

  const compact = variant === "compact";
  const box = cn(BOX, "flex items-start gap-2", compact ? "px-2 py-1.5 text-xs" : "px-3 py-2 text-sm");
  const detail = cn("block", MUTED_TEXT, !compact && "text-xs");
  const icon = (
    <AlertTriangle
      aria-hidden="true"
      className={cn("mt-0.5 shrink-0 text-amber-600 dark:text-amber-400", compact ? "size-3.5" : "size-4")}
    />
  );
  const noun = headerNoun(matches.flatMap((match) => match.reasons));

  // One openable match and nothing else: the whole box is the link
  if (matches.length === 1 && hiddenCount === 0 && !truncated) {
    const match = matches[0];
    return (
      <a
        data-slot="possible-duplicate-warning"
        href={match.href}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(box, "hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:hover:bg-amber-950/50")}
      >
        {icon}
        <span className="min-w-0">
          <span className={cn("flex items-center gap-1", HEADER_TEXT)}>
            {compact ? PICKER_HEADER_SINGLE : headerSingle(noun)}
            <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
          </span>
          <span className={detail}>{matchDetailLine(match)}</span>
        </span>
        <NewTabSuffix />
      </a>
    );
  }

  if (matches.length === 0) {
    return (
      <div data-slot="possible-duplicate-warning" className={box}>
        {icon}
        <p className={HEADER_TEXT}>{hiddenOnly(hiddenCount)}</p>
      </div>
    );
  }

  return (
    <div data-slot="possible-duplicate-warning" className={box}>
      {icon}
      <div className="min-w-0 flex-1">
        <p className={HEADER_TEXT}>{compact ? PICKER_HEADER_MULTIPLE : headerMultiple(noun)}</p>
        {/* biome-ignore lint/a11y/noRedundantRoles: Safari drops list semantics under list-style:none */}
        {/* biome-ignore lint/a11y/useSemanticElements: same element; it already is a <ul> */}
        <ul role="list" className="mt-1 space-y-1">
          {matches.map((match) => (
            <li key={match.inspectionId}>
              <a
                href={match.href}
                target="_blank"
                rel="noopener noreferrer"
                className={cn("inline-flex items-start gap-1 underline-offset-2 hover:underline", HEADER_TEXT, "font-normal")}
              >
                <span>{matchDetailLine(match)}</span>
                <ExternalLink aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
                <NewTabSuffix />
              </a>
            </li>
          ))}
          {hiddenCount > 0 && <li className={MUTED_TEXT}>{hiddenTail(hiddenCount)}</li>}
          {truncated && <li className={MUTED_TEXT}>{MORE_MATCHES}</li>}
        </ul>
      </div>
    </div>
  );
}

type MatchFields = Required<InspectionMatchRequest>;

const clip = (value: unknown): string => (typeof value === "string" ? value.trim().slice(0, MATCH_FIELD_BODY_MAX) : "");

function isMatchResult(body: unknown): body is InspectionMatchResult {
  if (!body || typeof body !== "object") return false;
  const candidate = body as Partial<InspectionMatchResult>;
  return Array.isArray(candidate.matches) && typeof candidate.hiddenCount === "number";
}

/** Any failure (non-2xx, bad JSON, wrong shape, abort, network) → null: the notice stays hidden */
async function fetchMatches(
  inspectionId: string,
  fields: MatchFields,
  signal: AbortSignal,
): Promise<InspectionMatchResult | null> {
  try {
    const res = await fetch(`/api/inspections/${encodeURIComponent(inspectionId)}/matches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
      signal,
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (!isMatchResult(body)) return null;
    return { matches: body.matches, hiddenCount: body.hiddenCount, truncated: body.truncated === true };
  } catch {
    return null;
  }
}

/**
 * Wizard/review Step 1 container (spec §9.2): watches the four property fields, asks the server
 * on mount and then (debounced) whenever the normalised key changes, and hides the previous
 * notice at once when the key changes.
 */
export function PossibleDuplicateWarning({ inspectionId }: { inspectionId: string }) {
  const { control } = useFormContext<InspectionFormData>();
  const [facilityAddress, facilityCity, facilityZip, taxParcelNumber] = useWatch({
    control,
    name: [
      "facilityInfo.facilityAddress",
      "facilityInfo.facilityCity",
      "facilityInfo.facilityZip",
      "facilityInfo.taxParcelNumber",
    ],
  });
  const fields: MatchFields = {
    facilityAddress: clip(facilityAddress),
    facilityCity: clip(facilityCity),
    facilityZip: clip(facilityZip),
    taxParcelNumber: clip(taxParcelNumber),
  };
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;

  const key = useMemo(
    () => matchQueryKey(buildMatchQuery({ facilityAddress, facilityCity, facilityZip, taxParcelNumber })),
    [facilityAddress, facilityCity, facilityZip, taxParcelNumber],
  );

  // Tagged with the key it answers, so a result never shows for different values
  const [result, setResult] = useState<{ key: string; value: InspectionMatchResult } | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    const immediate = !mountedRef.current;
    mountedRef.current = true;
    setResult(null);
    if (key === "") return;

    const controller = new AbortController();
    const run = () => {
      void fetchMatches(inspectionId, fieldsRef.current, controller.signal).then((value) => {
        if (value && !controller.signal.aborted) setResult({ key, value });
      });
    };
    const timer = immediate ? undefined : setTimeout(run, MATCH_DEBOUNCE_MS);
    if (immediate) run();
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, inspectionId]);

  const current = result && result.key === key ? result.value : null;
  const found = !!current && current.matches.length + current.hiddenCount > 0;

  return (
    <>
      <div className="empty:hidden sm:col-span-2">{current && <PossibleDuplicateNotice result={current} />}</div>
      <span className="sr-only" aria-live="polite" data-slot="possible-duplicate-announcement">
        {found ? MATCH_ANNOUNCEMENT : ""}
      </span>
    </>
  );
}
