import { describe, expect, it } from "vitest";
import { isUniqueViolation } from "@/lib/prefill/db-errors";

describe("isUniqueViolation", () => {
  it("recognises a raw postgres.js error", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation(Object.assign(new Error("duplicate key"), { code: "23505" }))).toBe(true);
  });

  it("recognises the Drizzle-wrapped shape (postgres error on `cause`)", () => {
    const err = Object.assign(new Error("Failed query"), {
      cause: { code: "23505", constraint_name: "inspection_prefill_runs_one_active_idx" },
    });
    expect((err as { code?: unknown }).code).toBeUndefined();
    expect(isUniqueViolation(err)).toBe(true);
  });

  it("rejects other errors and non-objects", () => {
    expect(isUniqueViolation(new Error("connection reset"))).toBe(false);
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
    expect(isUniqueViolation(Object.assign(new Error("x"), { cause: { code: "40001" } }))).toBe(false);
    expect(isUniqueViolation(Object.assign(new Error("x"), { cause: "23505" }))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation("23505")).toBe(false);
  });
});
