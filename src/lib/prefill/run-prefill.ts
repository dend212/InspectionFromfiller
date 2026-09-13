import { formatApn } from "./apn";
import type { AssessorStageResult, ResolvedParcel } from "./assessor";
import { runAssessorStage } from "./assessor";
import type { ListingStageResult } from "./listing";
import { runListingStage } from "./listing";
import {
  capListingProposals,
  dedupeProposals,
  listingParcelMismatch,
  listingParcelMismatchSummary,
} from "./map-facts-to-fields";
import type { PermitsStageResult } from "./permits";
import { runPermitsSelection, runPermitsStage } from "./permits";
import type { PrefillRunRow } from "./run-store";
import { loadRunRow, setInspectionApnIfNull, updateRun } from "./run-store";
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

/** The listing lookup and the permits street fallback both need a street address the input lacks */
function needsAssessorAddress(input: PrefillInput): boolean {
  return Boolean(input.apn) && !input.address;
}

/** The input the listing/permits stages search with once the assessor has resolved the parcel */
function enrichInput(input: PrefillInput, resolved: ResolvedParcel): PrefillInput {
  return {
    ...input,
    ...(resolved.address ? { address: resolved.address } : {}),
    ...(resolved.subdivision && !input.subdivision ? { subdivision: resolved.subdivision } : {}),
    ...(resolved.lot && !input.lot ? { lot: resolved.lot } : {}),
  };
}

/**
 * Cross-stage parcel guard (e2e D2). The listing stage compares the listing's parcel number
 * with the APN it was handed, so on an address-only run — no typed APN — a wrong-house listing
 * went through unflagged. Once the fan-out has settled the assessor's APN is known: when the
 * listing named a different parcel, its proposals are held under the fill gate with the same
 * note `mapListingFacts` writes and the tile says so — unless the stage already compared against
 * this very APN (typed-APN path), so the note is never appended twice. Mutates `stages.listing`.
 */
function applyListingParcelGuard(
  stages: PrefillStages,
  proposals: ProposedField[],
  listing: ListingStageResult | undefined,
  stageApn: string | undefined,
  resolvedApn: string | null,
): ProposedField[] {
  const parcelId = listing?.parcelId;
  if (!parcelId || !resolvedApn) return proposals;
  if (formatApn(stageApn) === resolvedApn) return proposals;
  if (!listingParcelMismatch(parcelId, resolvedApn)) return proposals;
  stages.listing = {
    ...stages.listing,
    summary: [stages.listing.summary, listingParcelMismatchSummary(parcelId, resolvedApn)]
      .filter(Boolean)
      .join(" · "),
  };
  return capListingProposals(proposals, parcelId, resolvedApn);
}

/**
 * D10: `inspections.apn` used to be written only by the legacy APN Lookup. Fill it from the
 * run when it is still empty; a failure here is logged and never fails the run.
 */
async function recordInspectionApn(
  run: PrefillRunRow,
  runId: string,
  input: PrefillInput,
  resolved: ResolvedParcel | undefined,
): Promise<void> {
  const apn = formatApn(resolved?.apn ?? input.apn);
  if (!apn) return;
  try {
    await setInspectionApnIfNull(run.inspectionId, apn);
  } catch (err) {
    console.error("[prefill] could not record inspection apn", runId, err);
  }
}

/**
 * Runs all stages for a run row that is `queued`, persisting progress after each stage.
 * Safe to call from `after()`. Never throws; on unexpected error marks the run `failed`.
 * When the permits stage returns candidates the run parks in `awaiting_selection`
 * (assessor/listing proposals are persisted so the client can apply them meanwhile)
 * and resumes through `continuePrefillAfterSelection`.
 *
 * Stage order (D2): with a street address in the input all three stages fan out at once.
 * With an APN alone the assessor runs first and the situs address it resolves is handed to
 * the listing and permits stages, which then run in parallel — otherwise the listing stage
 * would skip ("No address to search") and the permits street fallback would have nothing
 * to search. One AbortController covers the whole 240 s budget either way.
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

    const assessor = runAssessorStage(input, ctx("assessor"));
    let stageInput = input;
    let resolved: ResolvedParcel | undefined;
    if (needsAssessorAddress(input)) {
      // allSettled (not await) so a rejection is handled once, in the loop below
      const [first] = await Promise.allSettled([assessor]);
      if (first.status === "fulfilled") {
        resolved = first.value.resolved;
        if (resolved?.address) {
          stageInput = enrichInput(input, resolved);
          stages.assessor = first.value.stage;
          // Echo what the other stages will search with, so the tile can show it
          await updateRun(runId, { input: stageInput, stages: { ...stages } });
        }
      }
    }

    const settled = await Promise.allSettled<StageResult | PermitsStageResult>([
      assessor,
      runListingStage(stageInput, ctx("listing")),
      runPermitsStage(stageInput, ctx("permits")),
    ]);

    let proposals: ProposedField[] = [];
    let candidates: PermitCandidate[] = [];
    let listing: ListingStageResult | undefined;
    settled.forEach((result, i) => {
      const name = STAGE_NAMES[i];
      if (result.status === "fulfilled") {
        stages[name] = result.value.stage;
        proposals.push(...result.value.proposals);
        if (name === "assessor") {
          resolved = (result.value as AssessorStageResult).resolved;
        } else if (name === "listing") {
          listing = result.value as ListingStageResult;
        } else if (name === "permits") {
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

    proposals = applyListingParcelGuard(
      stages,
      proposals,
      listing,
      stageInput.apn,
      formatApn(resolved?.apn ?? input.apn),
    );
    await recordInspectionApn(run, runId, input, resolved);

    const awaiting = candidates.length > 0;
    await updateRun(runId, {
      status: awaiting ? "awaiting_selection" : "done",
      stages: { ...stages },
      // Spec §7: permit beats listing for the same field (dedupeProposals ranks by source)
      proposals: dedupeProposals(proposals),
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
      // Spec §7 again: a selected permit's field beats the listing value kept from the first pass
      proposals: dedupeProposals([...kept, ...selection.proposals]),
      candidates: [],
      finishedAt: new Date(),
    });
  } catch (err) {
    await failRun(runId, stages, err);
  } finally {
    clearTimeout(timer);
  }
}
