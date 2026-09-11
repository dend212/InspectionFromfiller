"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FieldPath, UseFormReturn } from "react-hook-form";
import { mergeProposals, normalizeFieldPath } from "@/lib/prefill/merge";
import type { PrefillAddress, PrefillRunDTO, PrefillTrigger } from "@/lib/prefill/types";
import { emptyStages } from "@/lib/prefill/types";
import { createEmptyTank } from "@/lib/validators/inspection";
import type { InspectionFormData } from "@/types/inspection";
import { useProvenance } from "./provenance-context";

export const PREFILL_POLL_MS = 2000;

const ACTIVE_STATUSES: ReadonlySet<string> = new Set(["queued", "running"]);

/** Matches "septicTank.tanks.<index>.<field>" once normalizeFieldPath has turned [i] into .i */
const TANK_FIELD_RE = /^septicTank\.tanks\.(\d+)\.(.+)$/;

export interface StartPrefillInput {
  apn?: string;
  address?: PrefillAddress;
  trigger?: "apn_lookup" | "manual";
}

export interface UsePrefillArgs {
  inspectionId: string;
  form: UseFormReturn<InspectionFormData>;
  enabled: boolean;
  /** Server-loaded latest run: undefined = fetch on mount; null = known to be none */
  initialRun?: PrefillRunDTO | null;
}

export interface UsePrefillReturn {
  run: PrefillRunDTO | null;
  isRunning: boolean;
  start(input?: StartPrefillInput): Promise<void>;
  selectCandidates(keys: string[]): Promise<void>;
  error: string | null;
}

/** Used only if the GET right after creation fails — keeps polling alive */
function placeholderRun(id: string, inspectionId: string, trigger: PrefillTrigger): PrefillRunDTO {
  return {
    id,
    inspectionId,
    trigger,
    status: "queued",
    input: {},
    stages: emptyStages(),
    proposals: [],
    candidates: [],
    error: null,
    appliedAt: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
    records: [],
  };
}

/**
 * A fill targeting `septicTank.tanks.<i>.<field>` needs the tanks array to be at least
 * `i + 1` long before `form.setValue` can reach it. Grows it with blank tanks (the same
 * shape step-septic-tank.tsx uses) and bumps numberOfTanks to match when it's empty or
 * smaller than the grown length.
 */
function ensureTankArrayCapacity(form: UseFormReturn<InspectionFormData>, fills: Array<{ fieldPath: string }>): void {
  let maxIndex = -1;
  for (const fill of fills) {
    const match = TANK_FIELD_RE.exec(fill.fieldPath);
    if (match) {
      const index = Number.parseInt(match[1], 10);
      if (index > maxIndex) maxIndex = index;
    }
  }
  if (maxIndex < 0) return;

  const requiredLength = maxIndex + 1;
  const currentTanks = form.getValues("septicTank.tanks") ?? [];
  if (currentTanks.length >= requiredLength) return;

  const grown = [...currentTanks];
  while (grown.length < requiredLength) {
    grown.push(createEmptyTank());
  }
  form.setValue("septicTank.tanks", grown);

  const currentCount = form.getValues("septicTank.numberOfTanks");
  if (!currentCount || Number.parseInt(currentCount, 10) < requiredLength) {
    form.setValue("septicTank.numberOfTanks", String(requiredLength));
  }
}

/**
 * Starts prefill runs, polls them, and applies finished runs to the form via
 * mergeProposals + the provenance context. Must be used inside ProvenanceProvider.
 */
export function usePrefill({ inspectionId, form, enabled, initialRun }: UsePrefillArgs): UsePrefillReturn {
  const { provenance, setMany } = useProvenance();
  const provenanceRef = useRef(provenance);
  provenanceRef.current = provenance;

  const [run, setRun] = useState<PrefillRunDTO | null>(initialRun ?? null);
  const [error, setError] = useState<string | null>(null);
  const appliedRef = useRef<Set<string>>(new Set());

  const applyRun = useCallback(
    async (candidate: PrefillRunDTO) => {
      if (candidate.status !== "done" || candidate.appliedAt || appliedRef.current.has(candidate.id)) {
        return;
      }
      appliedRef.current.add(candidate.id);

      try {
        const { fills, provenance: next } = mergeProposals(form.getValues(), provenanceRef.current, candidate.proposals, {
          runId: candidate.id,
        });
        ensureTankArrayCapacity(form, fills);
        for (const fill of fills) {
          form.setValue(normalizeFieldPath(fill.fieldPath) as FieldPath<InspectionFormData>, fill.value as never, {
            shouldDirty: true,
            shouldValidate: true,
          });
        }
        setMany(next);
      } catch (err) {
        // Nothing was marked applied server-side, so the next time this run is seen
        // (poll, refetch, remount) it gets a fresh attempt instead of staying half-applied.
        appliedRef.current.delete(candidate.id);
        console.error("[prefill] could not apply run", candidate.id, err);
        setError("Could not apply the prefill results — try again");
        return;
      }

      try {
        const res = await fetch(`/api/inspections/${inspectionId}/prefill/${candidate.id}/applied`, {
          method: "POST",
        });
        if (res.ok) {
          setRun((current) =>
            current && current.id === candidate.id ? { ...current, appliedAt: new Date().toISOString() } : current,
          );
        }
      } catch {
        // The merge is idempotent — an unapplied run is simply re-applied on the next mount
      }
    },
    [form, inspectionId, setMany],
  );

  /**
   * Single entry point for every run DTO the hook receives (mount's initialRun/latest,
   * start()'s first GET, selectCandidates()'s refetch, poll ticks). Adopts it into state
   * and applies it immediately if it's already `done` — a run can finish before the
   * client's next look at it (e.g. a fast assessor stage beats the first GET after the
   * 201), so applying must not be limited to the mount effect and poll tick alone.
   */
  const adoptRun = useCallback(
    (dto: PrefillRunDTO) => {
      setRun(dto);
      if (dto.status === "done" && dto.appliedAt === null && !appliedRef.current.has(dto.id)) {
        void applyRun(dto);
      }
    },
    [applyRun],
  );

  const fetchRun = useCallback(
    async (runId: string): Promise<PrefillRunDTO | null> => {
      try {
        const res = await fetch(`/api/inspections/${inspectionId}/prefill/${runId}`);
        if (!res.ok) return null;
        return (await res.json()) as PrefillRunDTO;
      } catch {
        return null;
      }
    },
    [inspectionId],
  );

  // Mount: adopt or load the latest run and apply it if it finished unapplied
  // (this is how webhook-triggered runs reach the form in phase 5).
  useEffect(() => {
    if (!enabled) return;
    if (initialRun !== undefined) {
      if (initialRun) adoptRun(initialRun);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/inspections/${inspectionId}/prefill/latest`);
        if (!res.ok || cancelled) return;
        const latest = (await res.json()) as PrefillRunDTO | null;
        if (cancelled) return;
        if (latest) {
          adoptRun(latest);
        } else {
          setRun(null);
        }
      } catch {
        // No latest run to show — the tile falls back to its intro copy
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, inspectionId, initialRun, adoptRun]);

  // Poll while the run is queued/running
  useEffect(() => {
    if (!enabled || !run || !ACTIVE_STATUSES.has(run.status)) return;
    const runId = run.id;
    let cancelled = false;
    const timer = setInterval(async () => {
      const next = await fetchRun(runId);
      if (!next || cancelled) return;
      adoptRun(next);
    }, PREFILL_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled, run, fetchRun, adoptRun]);

  const start = useCallback(
    async (input: StartPrefillInput = {}) => {
      setError(null);
      try {
        const res = await fetch(`/api/inspections/${inspectionId}/prefill`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        const body = (await res.json().catch(() => ({}))) as { runId?: string; error?: string };
        if (!res.ok || !body.runId) {
          setError(body.error ?? `Prefill failed (${res.status})`);
          return;
        }
        const created = await fetchRun(body.runId);
        if (created) {
          adoptRun(created);
        } else {
          setRun(placeholderRun(body.runId, inspectionId, input.trigger ?? "manual"));
        }
      } catch {
        setError("Prefill failed — check your connection and try again");
      }
    },
    [inspectionId, fetchRun, adoptRun],
  );

  const selectCandidates = useCallback(
    async (keys: string[]) => {
      if (!run) return;
      setError(null);
      try {
        const res = await fetch(`/api/inspections/${inspectionId}/prefill/${run.id}/select`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ candidateKeys: keys }),
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setError(body.error ?? "Could not select records");
          return;
        }
        const refetched = await fetchRun(run.id);
        if (refetched) {
          adoptRun(refetched);
        } else {
          setRun({ ...run, status: "running", candidates: [] });
        }
      } catch {
        setError("Could not select records — try again");
      }
    },
    [inspectionId, run, fetchRun, adoptRun],
  );

  return {
    run,
    isRunning: run !== null && ACTIVE_STATUSES.has(run.status),
    start,
    selectCandidates,
    error,
  };
}
