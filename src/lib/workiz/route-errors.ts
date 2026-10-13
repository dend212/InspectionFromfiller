import { NextResponse } from "next/server";
import type { WorkizErrorBody, WorkizRouteErrorCode } from "@/types/workiz-import";
import type { WorkizError } from "./client";

/** Fixed, user-safe messages only — nothing from a Workiz body or a DB error is ever forwarded */
export const RATE_LIMIT_RETRY_AFTER_SECONDS = 60;

export function errorResponse(
  status: number,
  code: WorkizRouteErrorCode,
  error: string,
  extra: { retryAfterSeconds?: number } = {},
): NextResponse<WorkizErrorBody> {
  return NextResponse.json<WorkizErrorBody>({ error, code, ...extra }, { status });
}

export function workizErrorResponse(
  err: WorkizError,
  context: "list" | "import",
): NextResponse<WorkizErrorBody> {
  switch (err.code) {
    case "not_configured":
      return errorResponse(503, "workiz_not_configured", "Workiz import isn't set up on this server");
    case "auth_failed":
      return errorResponse(502, "workiz_auth_failed", "Workiz rejected the app's credentials");
    case "rate_limited":
      return errorResponse(503, "workiz_rate_limited", "Workiz is busy — try again in a minute", {
        retryAfterSeconds: RATE_LIMIT_RETRY_AFTER_SECONDS,
      });
    case "bad_response":
      return errorResponse(502, "workiz_bad_response", "Workiz sent a response the app couldn't read");
    case "not_found":
      if (context === "import") return errorResponse(404, "workiz_job_not_found", "Workiz job not found");
      return errorResponse(502, "workiz_unavailable", "Couldn't reach Workiz — try again");
    default:
      return errorResponse(502, "workiz_unavailable", "Couldn't reach Workiz — try again");
  }
}

export function internalErrorResponse(): NextResponse<WorkizErrorBody> {
  return errorResponse(500, "internal", "Something went wrong");
}
