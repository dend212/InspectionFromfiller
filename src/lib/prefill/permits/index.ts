import type { StageContext, StageResult } from "../stage";
import type { PermitCandidate, PrefillInput } from "../types";

/** Phase 2 replaces this with the Maricopa EDMS search + document download */
export async function runPermitsStage(
  _input: PrefillInput,
  _ctx: StageContext,
): Promise<StageResult & { candidates?: PermitCandidate[] }> {
  return { stage: { status: "skipped", summary: "Not available yet", links: [] }, proposals: [] };
}
