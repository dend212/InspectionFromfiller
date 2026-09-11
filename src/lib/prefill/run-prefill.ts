import { runAssessorStage } from "./assessor";
import { runListingStage } from "./listing";
import type { PermitsStageResult } from "./permits";
import { runPermitsSelection, runPermitsStage } from "./permits";
import type { PrefillRunRow } from "./run-store";
import { loadRunRow, updateRun } from "./run-store";
import type { StageContext, StageResult } from "./stage";
import type { PermitCandidate, PrefillInput, PrefillStages, ProposedField } from "./types";
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

/**
 * Stored as `stages[name].error` when a stage module breaks its never-throw contract and
 * rejects. The tile prints `stage.error` verbatim, so the rejection text stays in the log.
 */
export const GENERIC_STAGE_ERROR = "Lookup failed — try Find records again";

const STAGE_NAMES: Array<keyof PrefillStages> = ["assessor", "listing", "permits"];

/** Builds the StageContext for one stage; `progress` persists a snapshot of all stages. */
function makeContext(
  run: PrefillRunRow,
  runId: string,
  stages: PrefillStages,
  signal: AbortSignal,
  name: keyof PrefillStages,
): StageContext {
  return {
    inspectionId: run.inspectionId,
    runId,
    signal,
    progress: async (patch) => {
      // Always persist a snapshot — `stages` keeps mutating while stages run in parallel
      stages[name] = { ...stages[name], ...patch };
      await updateRun(runId, { stages: { ...stages } });
    },
  };
}

/** Marks the run `failed` with the generic message; the real error only goes to the log. */
async function failRun(runId: string, stages: PrefillStages, err: unknown): Promise<void> {
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
}

/**
 * Runs all stages for a run row that is `queued`, persisting progress after each stage.
 * Safe to call from `after()`. Never throws; on unexpected error marks the run `failed`.
 * When the permits stage returns candidates the run parks in `awaiting_selection`
 * (assessor/listing proposals are persisted so the client can apply them meanwhile)
 * and resumes through `continuePrefillAfterSelection`.
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
  const ctx = (name: keyof PrefillStages) =>
    makeContext(run, runId, stages, controller.signal, name);

  try {
    await updateRun(runId, { status: "running", stages: { ...stages } });

    const settled = await Promise.allSettled<StageResult | PermitsStageResult>([
      runAssessorStage(input, ctx("assessor")),
      runListingStage(input, ctx("listing")),
      runPermitsStage(input, ctx("permits")),
    ]);

    const proposals: ProposedField[] = [];
    let candidates: PermitCandidate[] = [];
    settled.forEach((result, i) => {
      const name = STAGE_NAMES[i];
      if (result.status === "fulfilled") {
        stages[name] = result.value.stage;
        proposals.push(...result.value.proposals);
        if (name === "permits") {
          candidates = (result.value as PermitsStageResult).candidates ?? [];
        }
      } else {
        // Stage modules are contracted never to throw; this is the belt-and-braces path.
        // The rejection text is internal (fetch/DB detail) — log it, store the generic message.
        console.error(`[prefill] ${name} stage rejected`, runId, result.reason);
        stages[name] = {
          ...stages[name],
          status: "error",
          error: GENERIC_STAGE_ERROR,
          finishedAt: new Date().toISOString(),
          links: stages[name].links ?? [],
        };
      }
    });

    const awaiting = candidates.length > 0;
    await updateRun(runId, {
      status: awaiting ? "awaiting_selection" : "done",
      stages: { ...stages },
      proposals,
      candidates,
      finishedAt: awaiting ? null : new Date(),
    });
  } catch (err) {
    await failRun(runId, stages, err);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Called by POST /prefill/[runId]/select via after(). The route has already
 * validated the keys and flipped the run to `running`. EDMS document IDs are
 * ephemeral, so the permits module re-runs the same search and matches the
 * chosen candidates by their stable `key`, then stores them. Proposals from the
 * other stages (persisted at `awaiting_selection`) are kept; permit proposals
 * are replaced by the selection's. Same contract as runPrefill: safe to call
 * from `after()`, never throws — an unexpected error marks the run `failed`
 * (generic message, real error logged).
 */
export async function continuePrefillAfterSelection(
  runId: string,
  candidateKeys: string[],
): Promise<void> {
  let run: PrefillRunRow | null;
  try {
    run = await loadRunRow(runId);
  } catch (err) {
    console.error("[prefill] could not load run for selection", runId, err);
    return;
  }
  if (!run || run.status !== "running") return;

  const input = (run.input ?? {}) as PrefillInput;
  const stages: PrefillStages = {
    ...emptyStages(),
    ...((run.stages ?? {}) as Partial<PrefillStages>),
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PREFILL_TOTAL_BUDGET_MS);

  try {
    const selection = await runPermitsSelection(
      input,
      makeContext(run, runId, stages, controller.signal, "permits"),
      candidateKeys,
    );
    stages.permits = selection.stage;

    const kept = ((run.proposals ?? []) as ProposedField[]).filter(
      (p) => p.provenance.source !== "permit",
    );
    await updateRun(runId, {
      status: "done",
      stages: { ...stages },
      proposals: [...kept, ...selection.proposals],
      candidates: [],
      finishedAt: new Date(),
    });
  } catch (err) {
    await failRun(runId, stages, err);
  } finally {
    clearTimeout(timer);
  }
}
