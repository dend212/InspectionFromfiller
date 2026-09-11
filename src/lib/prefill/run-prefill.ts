import { runAssessorStage } from "./assessor";
import { runListingStage } from "./listing";
import { runPermitsStage } from "./permits";
import type { PrefillRunRow } from "./run-store";
import { loadRunRow, updateRun } from "./run-store";
import type { StageContext, StageResult } from "./stage";
import type { PrefillInput, PrefillStages, ProposedField } from "./types";
import { emptyStages } from "./types";

export type { StageContext, StageResult } from "./stage";

/** Hard stop for a whole run; whatever finished is persisted */
export const PREFILL_TOTAL_BUDGET_MS = 240_000;

/**
 * Stored as `run.error` for unexpected failures and printed verbatim by the tile —
 * the real error (postgres/Drizzle text) only ever goes to the server log.
 * Stage-level messages (timeouts etc.) are already user-safe and stay as they are.
 */
export const GENERIC_RUN_ERROR = "Prefill failed — try again";

const STAGE_NAMES: Array<keyof PrefillStages> = ["assessor", "listing", "permits"];

/**
 * Runs all stages for a run row that is `queued`, persisting progress after each stage.
 * Safe to call from `after()`. Never throws; on unexpected error marks the run `failed`.
 */
export async function runPrefill(runId: string): Promise<void> {
  let run: PrefillRunRow | null;
  try {
    run = await loadRunRow(runId);
  } catch (err) {
    console.error("[prefill] could not load run", runId, err);
    return;
  }
  if (!run || run.status !== "queued") return;

  const input = (run.input ?? {}) as PrefillInput;
  const stages = emptyStages();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PREFILL_TOTAL_BUDGET_MS);

  // Always persist a snapshot — `stages` keeps mutating while stages run in parallel
  const makeContext = (name: keyof PrefillStages): StageContext => ({
    inspectionId: run.inspectionId,
    runId,
    signal: controller.signal,
    progress: async (patch) => {
      stages[name] = { ...stages[name], ...patch };
      await updateRun(runId, { stages: { ...stages } });
    },
  });

  try {
    await updateRun(runId, { status: "running", stages: { ...stages } });

    const settled = await Promise.allSettled<StageResult>([
      runAssessorStage(input, makeContext("assessor")),
      runListingStage(input, makeContext("listing")),
      runPermitsStage(input, makeContext("permits")),
    ]);

    const proposals: ProposedField[] = [];
    settled.forEach((result, i) => {
      const name = STAGE_NAMES[i];
      if (result.status === "fulfilled") {
        stages[name] = result.value.stage;
        proposals.push(...result.value.proposals);
      } else {
        // Stage modules are contracted never to throw; this is the belt-and-braces path
        stages[name] = {
          ...stages[name],
          status: "error",
          error: result.reason instanceof Error ? result.reason.message : "Stage failed",
          finishedAt: new Date().toISOString(),
          links: stages[name].links ?? [],
        };
      }
    });

    await updateRun(runId, {
      status: "done",
      stages: { ...stages },
      proposals,
      finishedAt: new Date(),
    });
  } catch (err) {
    console.error("[prefill] run failed", runId, err);
    try {
      await updateRun(runId, {
        status: "failed",
        stages: { ...stages },
        error: GENERIC_RUN_ERROR,
        finishedAt: new Date(),
      });
    } catch (persistErr) {
      console.error("[prefill] could not record failure", runId, persistErr);
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Called by the /select route after candidates are chosen. Same contract as
 * runPrefill: safe to call from `after()`, never throws — an unexpected error
 * marks the run `failed` (generic message, real error logged).
 * Phase 1 has no stage that produces candidates, so a selection can only reach
 * here through a hand-crafted request — record it as a failed run.
 * Phase 2 replaces the body with the extraction continuation.
 */
export async function continuePrefillAfterSelection(
  runId: string,
  _candidateKeys: string[],
): Promise<void> {
  try {
    await updateRun(runId, {
      status: "failed",
      error: "Candidate selection is not available yet",
      finishedAt: new Date(),
    });
  } catch (err) {
    console.error("[prefill] selection continuation failed", runId, err);
    try {
      await updateRun(runId, { status: "failed", error: GENERIC_RUN_ERROR, finishedAt: new Date() });
    } catch (persistErr) {
      console.error("[prefill] could not record failure", runId, persistErr);
    }
  }
}
