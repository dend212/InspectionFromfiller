/**
 * Pure value maps: Workiz custom-field option → wizard form value (spec §5.2), plus the address
 * formatters the mapper and the job summary share. Matching is exact after trim, internal
 * whitespace collapse and case-folding. Never logs: callers log `reason` codes only.
 */

export type SkipReason = "empty" | "ambiguous" | "unknown_option" | "out_of_range" | "invalid_apn";

export type MapResult<T extends string = string> =
  | { ok: true; value: T }
  | { ok: false; reason: SkipReason };

const skip = (reason: SkipReason): { ok: false; reason: SkipReason } => ({ ok: false, reason });

export function normalizeOption(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

function fromTable<T extends string>(raw: string, table: Record<string, T | "ambiguous">): MapResult<T> {
  const key = normalizeOption(raw);
  if (!key) return skip("empty");
  const hit = table[key];
  if (hit === undefined) return skip("unknown_option");
  if (hit === "ambiguous") return skip("ambiguous");
  return { ok: true, value: hit };
}

/** §5.2.1 — "Municipal / Private Water Supply" merges two ADEQ boxes, so it is never guessed */
export function mapWaterSource(raw: string): MapResult<"private_well" | "shared_well" | "hauled_water"> {
  return fromTable(raw, {
    "private well": "private_well",
    "shared private well": "shared_well",
    "hauled water": "hauled_water",
    "municipal / private water supply": "ambiguous",
  });
}

const TANK_MIN_GALLONS = 300;
const TANK_MAX_GALLONS = 10_000;

/** §5.2.2 — an integer (commas allowed) with an optional gal/gallon(s) suffix, 300–10,000 */
export function mapTankSize(raw: string): MapResult {
  const text = raw.trim().replace(/\s+/g, " ");
  if (!text) return skip("empty");
  const match = /^(\d{1,3}(?:,\d{3})+|\d+)\s*(?:gal|gals|gallon|gallons)?\.?$/i.exec(text);
  if (!match) return skip("unknown_option"); // "< 1000", ">3000", free words
  const gallons = Number(match[1].replace(/,/g, ""));
  if (gallons < TANK_MIN_GALLONS || gallons > TANK_MAX_GALLONS) return skip("out_of_range");
  return { ok: true, value: String(gallons) };
}

/** §5.2.3 */
export function mapEffluentFilter(raw: string): MapResult<"present" | "not_present"> {
  return fromTable(raw, { yes: "present", no: "not_present" });
}

/** §5.2.4 — Workiz's "flow test" is the ADEQ hydraulic load test */
export function mapFlowTestCompleted(raw: string): MapResult<"yes" | "no"> {
  return fromTable(raw, { yes: "yes", no: "no" });
}

/** §5.2.5 — Tank / Drainfield Recommendation → CONDITION_OPTIONS */
export function mapCondition(
  raw: string,
): MapResult<"operational" | "operational_with_concerns" | "not_operational"> {
  return fromTable(raw, {
    operational: "operational",
    "operational w/concerns": "operational_with_concerns",
    "non-operational": "not_operational",
  });
}

export const FREE_TEXT_MAX_CHARS = 4000;
const NONE_ANSWER = /^(none|n\/?a|no concerns?)\.?$/i;

/** Tech notes: whitespace trimmed, internal newlines kept, capped at 4,000 chars */
export function mapFreeText(raw: string, opts: { dropNoneAnswers?: boolean } = {}): MapResult {
  const text = raw.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (!text) return skip("empty");
  if (opts.dropNoneAnswers && NONE_ANSWER.test(text)) return skip("empty");
  return { ok: true, value: text.slice(0, FREE_TEXT_MAX_CHARS) };
}

const collapse = (value: string): string => value.replace(/\s+/g, " ").trim();

/** "100 E Example Rd" + "12" → "100 E Example Rd #12" */
export function formatWorkizStreet(address: string, unit: string): string {
  const street = collapse(address);
  const unitText = collapse(unit).replace(/^#\s*/, "");
  if (!street) return "";
  return unitText ? `${street} #${unitText}` : street;
}

/** Title-cases only an all-lower or all-upper value ("laveen" → "Laveen"); mixed case is kept */
export function formatWorkizCity(city: string): string {
  const text = collapse(city);
  if (text !== text.toLowerCase() && text !== text.toUpperCase()) return text;
  return text.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** `^\d{5}(-\d{4})?$` → first five digits; anything else → null (no fill, no chip) */
export function formatWorkizZip(zip: string): string | null {
  const text = zip.trim();
  return /^\d{5}(-\d{4})?$/.test(text) ? text.slice(0, 5) : null;
}
