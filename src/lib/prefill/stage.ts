import type { PrefillStage, ProposedField } from "./types";

/** What every stage module returns. Stages never throw — errors become `stage.status = "error"`. */
export interface StageResult {
  stage: PrefillStage;
  proposals: ProposedField[];
}

export interface StageContext {
  inspectionId: string;
  runId: string;
  /** AbortSignal that fires at the 240 s total budget */
  signal: AbortSignal;
  /** Persist a partial stage update so the client sees progress */
  progress: (stage: Partial<PrefillStage>) => Promise<void>;
}
