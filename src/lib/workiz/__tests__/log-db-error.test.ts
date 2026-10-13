import { afterEach, describe, expect, it, vi } from "vitest";
import { logDbError } from "@/lib/workiz/log-db-error";

const PII = ["Test Client", "test.client@example.com", "100 E Example Rd"];

/** Shape of Drizzle 0.45's DrizzleQueryError: message = SQL + params, cause = the postgres error */
function drizzleError(cause: Record<string, unknown>) {
  const err = new Error(
    `Failed query: insert into "inspections" … \nparams: ${PII.join(",")}`,
  ) as Error & { query: string; params: unknown[]; cause: unknown };
  err.query = 'insert into "inspections" …';
  err.params = [...PII];
  err.cause = cause;
  return err;
}

afterEach(() => vi.restoreAllMocks());

describe("logDbError", () => {
  it("logs only scope, serial, SQLSTATE and constraint — never the message or params", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logDbError(
      "insert",
      drizzleError({ code: "23505", constraint_name: "inspections_workiz_job_id_unique" }),
      { serialId: 4696 },
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]).toEqual([
      "[workiz-import] db error scope=insert job=4696 code=23505 constraint=inspections_workiz_job_id_unique",
    ]);
    const logged = JSON.stringify(spy.mock.calls);
    for (const value of PII) expect(logged).not.toContain(value);
  });

  it("falls back to err.code, then unknown / -", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logDbError("create_run", Object.assign(new Error("x"), { code: "57014" }));
    logDbError("lookup", "not even an error");
    expect(spy.mock.calls[0][0]).toBe("[workiz-import] db error scope=create_run job=- code=57014 constraint=-");
    expect(spy.mock.calls[1][0]).toBe("[workiz-import] db error scope=lookup job=- code=unknown constraint=-");
  });

  it("refuses non-identifier code/constraint values (they could carry text)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logDbError("insert", drizzleError({ code: "Test Client", constraint_name: "a b" }), { serialId: 1 });
    expect(spy.mock.calls[0][0]).toBe("[workiz-import] db error scope=insert job=1 code=unknown constraint=-");
  });
});
