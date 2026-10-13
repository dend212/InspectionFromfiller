/**
 * PII-safe DB error logging for the Workiz import (spec §12). Drizzle 0.45 wraps a failed query
 * in DrizzleQueryError whose `message` is `Failed query: <sql>\nparams: <params>` — for the import
 * INSERT the params hold the client email, street, whole formData and provenance map. So callers
 * never log the error object, its message, query or params: only this line. `prefix` lets other
 * features (the possible-duplicate check passes "inspection-matches") reuse the same safe line.
 */

function field(value: unknown, key: string): unknown {
  return value && typeof value === "object" && key in value
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

/** SQLSTATEs and constraint names are identifiers; anything else could be text, so it is dropped */
function identifier(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_]{1,63}$/.test(value) ? value : undefined;
}

export function logDbError(
  scope: string,
  err: unknown,
  ctx: { serialId?: number | null } = {},
  prefix = "workiz-import",
): void {
  const cause = field(err, "cause");
  const code = identifier(field(cause, "code")) ?? identifier(field(err, "code")) ?? "unknown";
  const constraint =
    identifier(field(cause, "constraint_name")) ?? identifier(field(err, "constraint_name")) ?? "-";
  console.error(
    `[${prefix}] db error scope=${scope} job=${ctx.serialId ?? "-"} code=${code} constraint=${constraint}`,
  );
}
