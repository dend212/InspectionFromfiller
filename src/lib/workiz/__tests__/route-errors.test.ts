import { describe, expect, it } from "vitest";
import { WorkizError, type WorkizErrorCode } from "@/lib/workiz/client";
import { internalErrorResponse, workizErrorResponse } from "@/lib/workiz/route-errors";

describe("workizErrorResponse (spec §8.1 table)", () => {
  it.each<[WorkizErrorCode, "list" | "import", number, string]>([
    ["not_configured", "list", 503, "workiz_not_configured"],
    ["auth_failed", "list", 502, "workiz_auth_failed"],
    ["rate_limited", "list", 503, "workiz_rate_limited"],
    ["unavailable", "list", 502, "workiz_unavailable"],
    ["bad_response", "list", 502, "workiz_bad_response"],
    ["not_found", "list", 502, "workiz_unavailable"],
    ["not_found", "import", 404, "workiz_job_not_found"],
  ])("%s (%s) → %i %s", async (code, context, status, bodyCode) => {
    const res = workizErrorResponse(new WorkizError(code, 418), context);
    expect(res.status).toBe(status);
    const body = await res.json();
    expect(body.code).toBe(bodyCode);
    expect(typeof body.error).toBe("string");
    expect(JSON.stringify(body)).not.toContain("418"); // nothing from Workiz is forwarded
  });

  it("rate_limited carries retryAfterSeconds: 60", async () => {
    const body = await workizErrorResponse(new WorkizError("rate_limited"), "list").json();
    expect(body.retryAfterSeconds).toBe(60);
  });

  it("internalErrorResponse is a fixed 500", async () => {
    const res = internalErrorResponse();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Something went wrong", code: "internal" });
  });
});
