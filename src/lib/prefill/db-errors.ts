/** postgres SQLSTATE for unique_violation */
const UNIQUE_VIOLATION = "23505";

function codeOf(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || !("code" in value)) return undefined;
  const code = (value as { code: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/**
 * True when `err` is a postgres unique-index violation, whichever shape it arrives in:
 * postgres.js throws `{ code: "23505" }` directly, but Drizzle wraps it as
 * `Error("Failed query …", { cause: <postgres error> })` — so in production the code is
 * on `err.cause.code` and `err.code` is undefined (verified live against the
 * `inspection_prefill_runs_one_active_idx` backstop).
 */
export function isUniqueViolation(err: unknown): boolean {
  if (codeOf(err) === UNIQUE_VIOLATION) return true;
  const cause = err && typeof err === "object" && "cause" in err ? (err as { cause: unknown }).cause : undefined;
  return codeOf(cause) === UNIQUE_VIOLATION;
}
