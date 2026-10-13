import { splitUnit } from "./address-key";
import { formatApn } from "./apn";
import { normalizeStreetName, parseStreetAddress } from "./input";
import { normalizeFieldPath, valuesEqual } from "./merge";
import type { ProvenanceEntry } from "./types";

/**
 * Import from Workiz keeps its suggestions in the SAME field_provenance map under
 * `secondary.<fieldPath>` keys (spec §6.2). mergeProposals never writes them (no proposal path
 * starts with `secondary.`), persistence rides the existing whole-map PATCH, and no form root is
 * named `secondary`. ANY code that iterates field_provenance — counters ("12 fields prefilled"),
 * exports, badges — MUST skip `isSecondaryKey(key)`.
 */
export const SECONDARY_PREFIX = "secondary.";

export const secondaryKey = (fieldPath: string): string =>
  `${SECONDARY_PREFIX}${normalizeFieldPath(fieldPath)}`;

export const isSecondaryKey = (key: string): boolean => key.startsWith(SECONDARY_PREFIX);

/** The two free-text targets: accepting appends to existing text instead of replacing it (§6.3) */
export const SECONDARY_APPEND_PATHS: ReadonlySet<string> = new Set([
  "septicTank.septicTankComments",
  "disposalWorks.disposalWorksComments",
]);

const collapseWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

/** True when `text` (whitespace-normalised, case-sensitive) already appears in `field` */
const containsText = (field: string, text: string): boolean => {
  const needle = collapseWhitespace(text);
  return needle !== "" && collapseWhitespace(field).includes(needle);
};

/**
 * `current.trimEnd() + "\n\n" + addition`, or just `addition` when the field is empty. Text the
 * field already contains (whitespace-normalised) is never appended a second time.
 */
export function appendSecondaryText(current: unknown, addition: string): string {
  const existing = typeof current === "string" ? current : "";
  if (containsText(existing, addition)) return existing;
  return existing.trim() ? `${existing.trimEnd()}\n\n${addition}` : addition;
}

const looseText = (value: string): string => value.replace(/\s+/g, " ").trim().toLowerCase();

function addressesEqual(a: string, b: string): boolean {
  const left = splitUnit(a);
  const right = splitUnit(b);
  const pa = parseStreetAddress(left.street);
  const pb = parseStreetAddress(right.street);
  if (!pa || !pb) return looseText(a) === looseText(b);
  return (
    pa.streetNumber === pb.streetNumber &&
    (pa.streetDir ?? "") === (pb.streetDir ?? "") &&
    normalizeStreetName(pa.streetName) === normalizeStreetName(pb.streetName) &&
    left.unit === right.unit
  );
}

function zip5(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 5 ? digits.slice(0, 5) : looseText(value);
}

/** Path-aware equality used to hide a secondary chip that says nothing new (spec §6.2) */
export function secondaryValuesEqual(fieldPath: string, a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string") return valuesEqual(a, b);
  const path = normalizeFieldPath(fieldPath);
  if (path === "facilityInfo.taxParcelNumber") {
    const fa = formatApn(a);
    const fb = formatApn(b);
    if (fa && fb) return fa === fb;
  }
  if (path === "facilityInfo.facilityAddress") return addressesEqual(a, b);
  if (path === "facilityInfo.facilityZip") return zip5(a) === zip5(b);
  return looseText(a) === looseText(b);
}

/**
 * Chip visibility (spec §6.3): the secondary exists, the field's value differs from it, the
 * primary is not verified, the primary is not itself a visible suggested chip with an equal
 * value, and — for the two comments paths — the field does not already contain the text and the
 * secondary has not been accepted (acceptSecondary marks it `edited`, so editing the appended
 * text never re-offers it; a fresh Workiz suggestion arrives as `suggested` and shows again).
 */
export function isSecondaryVisible(args: {
  fieldPath: string;
  secondary?: ProvenanceEntry;
  primary?: ProvenanceEntry;
  currentValue: unknown;
}): boolean {
  const { secondary, primary, currentValue } = args;
  const fieldPath = normalizeFieldPath(args.fieldPath);
  if (!secondary || secondary.kind !== "fill") return false;
  if (secondaryValuesEqual(fieldPath, currentValue, secondary.value)) return false;
  if (primary?.state === "verified") return false;
  if (
    primary?.state === "suggested" &&
    primary.kind === "fill" &&
    !valuesEqual(currentValue, primary.value) &&
    secondaryValuesEqual(fieldPath, primary.value, secondary.value)
  ) {
    return false;
  }
  if (SECONDARY_APPEND_PATHS.has(fieldPath)) {
    if (secondary.state === "edited") return false;
    if (
      typeof currentValue === "string" &&
      typeof secondary.value === "string" &&
      containsText(currentValue, secondary.value)
    ) {
      return false;
    }
  }
  return true;
}
