/**
 * Wire types for GET /api/workiz/jobs and POST /api/workiz/import. Lives in src/types (not
 * src/lib/workiz) so the client-side picker can import it without touching server modules.
 */

export type WorkizImporterRole = "admin" | "field_tech";

/** `canOpen: false` is exactly that — no inspection id or status leaks to a field tech */
export type WorkizExisting = { canOpen: true; inspectionId: string; status: string } | { canOpen: false };

export interface WorkizJobRow {
  id: string;
  serialId: number | null;
  street: string;
  city: string;
  /** "YYYY-MM-DD" (Workiz wall-clock date) or null */
  scheduledDate: string | null;
  subStatus: string | null;
  teamFirstNames: string[];
  existing: WorkizExisting | null;
}

export interface WorkizJobsResponse {
  jobs: WorkizJobRow[];
  fetchedAt: string;
  role: WorkizImporterRole;
  /** First token of profiles.fullName; null → the not-on-team warning is not shown */
  currentUserFirstName: string | null;
  /** Present (true) only when the Workiz listing hit the server's page cap — more jobs may exist */
  truncated?: boolean;
}

export type WorkizRouteErrorCode =
  | "workiz_not_configured"
  | "workiz_auth_failed"
  | "workiz_rate_limited"
  | "workiz_unavailable"
  | "workiz_bad_response"
  | "workiz_job_not_found"
  | "invalid_request"
  | "already_imported"
  | "not_adeq_job"
  | "not_importable"
  | "internal";

export interface WorkizErrorBody {
  error: string;
  code: WorkizRouteErrorCode;
  retryAfterSeconds?: number;
}

export type WorkizImportPrefill =
  | { status: "started"; runId: string }
  | { status: "skipped"; reason: "address_unparseable" }
  | { status: "failed" };

export interface WorkizImportCreated {
  inspectionId: string;
  existing: false;
  prefill: WorkizImportPrefill;
}

export interface WorkizImportExisting {
  inspectionId: string;
  existing: true;
  status: string;
}

export type WorkizImportResponse = WorkizImportCreated | WorkizImportExisting;
