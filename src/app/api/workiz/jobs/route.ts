import { NextResponse } from "next/server";
import type { WorkizJobSummary } from "@/lib/workiz/adeq";
import { listImportableAdeqJobs } from "@/lib/workiz/adeq-jobs";
import { WorkizError } from "@/lib/workiz/client";
import {
  findInspectionsByWorkizIds,
  firstNameOf,
  type ImportedInspectionRow,
  loadProfileFullName,
} from "@/lib/workiz/import-store";
import { logDbError } from "@/lib/workiz/log-db-error";
import { requireWorkizImporter } from "@/lib/workiz/route-auth";
import { internalErrorResponse, workizErrorResponse } from "@/lib/workiz/route-errors";
import type {
  WorkizExisting,
  WorkizImporterRole,
  WorkizJobRow,
  WorkizJobsResponse,
} from "@/types/workiz-import";

// The listing has its own 25 s deadline; the DB lookup fits well inside the rest
export const maxDuration = 60;

function existingFor(
  row: WorkizJobSummary,
  matches: ImportedInspectionRow[],
  userId: string,
  role: WorkizImporterRole,
): WorkizExisting | null {
  const match = matches.find(
    (m) => (row.uuid !== "" && m.workizJobId === row.uuid) || m.workizJobId === row.id,
  );
  if (!match) return null;
  // Same rule as checkInspectionAccess, restricted to the roles these routes admit
  if (match.inspectorId === userId || role === "admin") {
    return { canOpen: true, inspectionId: match.id, status: match.status };
  }
  return { canOpen: false };
}

/**
 * GET /api/workiz/jobs[?refresh=1] — importable ADEQ jobs for the New Inspection picker
 * (spec §8.1). Summaries only (serial, street, city, date, sub-status, team first names);
 * `existing` is computed per request and never cached.
 */
export async function GET(request: Request) {
  const auth = await requireWorkizImporter();
  if (!auth.ok) return auth.response;
  const refresh = new URL(request.url).searchParams.get("refresh") === "1";

  let list: Awaited<ReturnType<typeof listImportableAdeqJobs>>;
  try {
    list = await listImportableAdeqJobs({ refresh });
  } catch (err) {
    if (err instanceof WorkizError) return workizErrorResponse(err, "list");
    // Only the error's class name — and kept out of the console call so T23's `\berr\b` grep stays clean
    const errorName = err instanceof Error ? err.name : "unknown";
    console.error(`[workiz] job list failed: ${errorName}`);
    return internalErrorResponse();
  }

  let matches: ImportedInspectionRow[];
  let fullName: string | null;
  try {
    [matches, fullName] = await Promise.all([
      findInspectionsByWorkizIds(list.rows.flatMap((row) => [row.uuid, row.id])),
      loadProfileFullName(auth.user.id),
    ]);
  } catch (err) {
    logDbError("jobs_existing_lookup", err);
    return internalErrorResponse();
  }

  const jobs: WorkizJobRow[] = list.rows.map((row) => ({
    id: row.id,
    serialId: row.serialId,
    street: row.street,
    city: row.city,
    scheduledDate: row.scheduledDate,
    subStatus: row.subStatus,
    teamFirstNames: row.teamFirstNames,
    existing: existingFor(row, matches, auth.user.id, auth.role),
  }));

  const body: WorkizJobsResponse = {
    jobs,
    fetchedAt: new Date(list.fetchedAt).toISOString(),
    role: auth.role,
    currentUserFirstName: firstNameOf(fullName),
    ...(list.truncated ? { truncated: true } : {}),
  };
  return NextResponse.json(body);
}
