import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { inspectionPrefillRuns, inspectionRecords } from "@/lib/db/schema";
import type {
  PermitCandidate,
  PrefillInput,
  PrefillRunStatus,
  PrefillStages,
  PrefillTrigger,
  ProposedField,
} from "./types";
import { emptyStages } from "./types";

export type PrefillRunRow = typeof inspectionPrefillRuns.$inferSelect;
export type InspectionRecordRow = typeof inspectionRecords.$inferSelect;

/** Runs created in the last rolling hour — the DB-backed rate limit (survives cold starts) */
export async function countRunsInLastHour(inspectionId: string): Promise<number> {
  const rows = await db.execute(
    sql`SELECT count(*)::int AS n FROM inspection_prefill_runs
        WHERE inspection_id = ${inspectionId} AND created_at > now() - interval '1 hour'`,
  );
  return Number(rows[0]?.n ?? 0);
}

/** Queued/running runs older than 5 minutes are stuck — fail them so they can't hold the lock forever */
export async function failStaleRuns(inspectionId: string): Promise<void> {
  await db.execute(
    sql`UPDATE inspection_prefill_runs
        SET status = 'failed', error = 'Timed out', finished_at = now()
        WHERE inspection_id = ${inspectionId}
          AND status IN ('queued', 'running')
          AND created_at < now() - interval '5 minutes'`,
  );
}

export async function findActiveRun(inspectionId: string): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: inspectionPrefillRuns.id })
    .from(inspectionPrefillRuns)
    .where(
      and(
        eq(inspectionPrefillRuns.inspectionId, inspectionId),
        inArray(inspectionPrefillRuns.status, ["queued", "running"]),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function createRun(args: {
  inspectionId: string;
  trigger: PrefillTrigger;
  input: PrefillInput;
  createdBy: string | null;
}): Promise<string> {
  const [row] = await db
    .insert(inspectionPrefillRuns)
    .values({
      inspectionId: args.inspectionId,
      trigger: args.trigger,
      status: "queued",
      input: args.input,
      stages: emptyStages(),
      createdBy: args.createdBy,
    })
    .returning({ id: inspectionPrefillRuns.id });
  return row.id;
}

export async function loadRunRow(runId: string): Promise<PrefillRunRow | null> {
  const [row] = await db
    .select()
    .from(inspectionPrefillRuns)
    .where(eq(inspectionPrefillRuns.id, runId))
    .limit(1);
  return row ?? null;
}

export async function loadLatestRunRow(inspectionId: string): Promise<PrefillRunRow | null> {
  const [row] = await db
    .select()
    .from(inspectionPrefillRuns)
    .where(eq(inspectionPrefillRuns.inspectionId, inspectionId))
    .orderBy(desc(inspectionPrefillRuns.createdAt))
    .limit(1);
  return row ?? null;
}

export interface RunPatch {
  status?: PrefillRunStatus;
  stages?: PrefillStages;
  proposals?: ProposedField[];
  candidates?: PermitCandidate[];
  error?: string | null;
  finishedAt?: Date | null;
  appliedAt?: Date | null;
}

export async function updateRun(runId: string, patch: RunPatch): Promise<void> {
  await db.update(inspectionPrefillRuns).set(patch).where(eq(inspectionPrefillRuns.id, runId));
}

export async function markRunApplied(runId: string): Promise<void> {
  await updateRun(runId, { appliedAt: new Date() });
}

/** Capped at 200 rows — a run stores at most a handful of documents */
export async function listRecordRows(runId: string): Promise<InspectionRecordRow[]> {
  return db
    .select()
    .from(inspectionRecords)
    .where(eq(inspectionRecords.runId, runId))
    .orderBy(inspectionRecords.createdAt)
    .limit(200);
}
