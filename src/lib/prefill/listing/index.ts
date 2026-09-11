import type { StageContext, StageResult } from "../stage";
import type { PrefillInput } from "../types";

/** Phase 4 replaces this with the Zillow/Apify provider */
export async function runListingStage(
  _input: PrefillInput,
  _ctx: StageContext,
): Promise<StageResult> {
  return { stage: { status: "skipped", summary: "Not available yet", links: [] }, proposals: [] };
}
