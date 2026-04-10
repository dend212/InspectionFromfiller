import { db } from "@/lib/db";
import { jobActivity } from "@/lib/db/schema";

/**
 * Canonical set of job activity event types. Anything rendered in the
 * timeline goes through `logJobActivity()` with one of these as the
 * `eventType`. Keep the list append-only — existing rows in the DB
 * reference these strings directly.
 */
export type JobActivityEventType =
  | "job.created"
  | "job.status_changed"
  | "job.assignees_changed"
  | "job.finalized"
  | "job.reopened"
  | "job.customer_summary_generated"
  | "job.notes_updated"
  | "checklist.item_added"
  | "checklist.item_updated"
  | "checklist.item_status_changed"
  | "checklist.item_deleted"
  | "media.added"
  | "media.removed"
  | "media.visibility_changed"
  | "summary.link_created"
  | "summary.email_sent";

export interface LogJobActivityInput {
  jobId: string;
  eventType: JobActivityEventType;
  /** Short human-readable description — shown verbatim in the timeline. */
  summary: string;
  /** profile id of the acting user, or null for system events (webhooks). */
  actorId: string | null;
  /** Arbitrary extra context — rendered as key: value chips under the summary. */
  metadata?: Record<string, unknown>;
}

/**
 * Write one row to job_activity. Always fire-and-forget semantics:
 * logging must never block or fail the user-facing operation, so errors
 * are swallowed with a console.error. If logging is down, the timeline
 * has a gap — the actual work still succeeds.
 *
 * Call from inside the same API handler that performs the mutation, AFTER
 * the mutation has succeeded. Do not call from client code.
 */
export async function logJobActivity(input: LogJobActivityInput): Promise<void> {
  try {
    await db.insert(jobActivity).values({
      jobId: input.jobId,
      eventType: input.eventType,
      actorId: input.actorId,
      summary: input.summary,
      metadata: input.metadata ?? {},
    });
  } catch (err) {
    // Intentionally non-fatal. If the activity table is unreachable, we
    // don't want to take down the primary mutation with it.
    console.error("[job-activity] failed to log event", {
      jobId: input.jobId,
      eventType: input.eventType,
      err,
    });
  }
}
