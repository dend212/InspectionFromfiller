import { parseStreetAddress } from "./input";

/**
 * Comparable street-address key for the possible-duplicate check (duplicate-warning spec §5.2).
 * Pure and client-safe: the wizard computes it to dedupe requests, the server to decide matches.
 */
export interface AddressKey {
  number: string;
  /** N/S/E/W/NE/NW/SE/SW, or null when none was typed */
  dir: string | null;
  /** Uppercase street words without direction or suffix: "CAVE CREEK" */
  street: string;
  /** Canonical abbreviation ("RD"), or null when none was typed */
  suffix: string | null;
  /** "12" for "#12" / "Space 12" / "#Space 12", or null */
  unit: string | null;
}

const UNIT_WORD = /^(UNIT|APT|STE|SUITE|SPACE|SPC|LOT)$/i;

/** "100 E Example Rd Space 12" → { street: "100 E Example Rd", unit: "12" } */
export function splitUnit(line: string): { street: string; unit: string } {
  const words = line.replace(/\s+/g, " ").trim().split(" ");
  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    const rest = (from: number) => words.slice(from).join("").replace(/#/g, "").toUpperCase();
    if (word.startsWith("#")) return { street: words.slice(0, i).join(" "), unit: rest(i) };
    const next = words[i + 1];
    // A unit word only counts when a unit token follows ("Lot Rd" is a street, "Lot 7" a unit)
    if (UNIT_WORD.test(word) && next && /^#?[A-Za-z0-9-]{1,8}$/.test(next) && (/\d/.test(next) || /^#?[A-Za-z]$/.test(next))) {
      return { street: words.slice(0, i).join(" "), unit: rest(i + 1) };
    }
  }
  return { street: words.join(" "), unit: "" };
}

/** Every STREET_SUFFIXES entry → its canonical abbreviation (a test pins the key set) */
export const SUFFIX_CANONICAL: Readonly<Record<string, string>> = {
  ROAD: "RD", RD: "RD", STREET: "ST", ST: "ST", AVENUE: "AVE", AVE: "AVE", DRIVE: "DR", DR: "DR",
  LANE: "LN", LN: "LN", BOULEVARD: "BLVD", BLVD: "BLVD", COURT: "CT", CT: "CT", PLACE: "PL",
  PL: "PL", CIRCLE: "CIR", CIR: "CIR", TRAIL: "TRL", TRL: "TRL", PARKWAY: "PKWY", PKWY: "PKWY",
  HIGHWAY: "HWY", HWY: "HWY", TERRACE: "TER", TER: "TER", WAY: "WAY", LOOP: "LOOP",
};

const SUFFIXES = new Map(Object.entries(SUFFIX_CANONICAL));

/** "100 North Ln" parses as dir N + street "Ln": the direction word was the street name */
const DIRECTION_WORD: Record<string, string> = { N: "NORTH", S: "SOUTH", E: "EAST", W: "WEST" };

const UNIT_SEGMENT = /^(#\s*[A-Za-z0-9-]{1,8}|(UNIT|APT|STE|SUITE|SPACE|SPC|LOT)\s+#?[A-Za-z0-9-]{1,8})$/i;

/** "100 E Example Rd, #12, Cave Creek, AZ 85331" → "100 E Example Rd #12" */
function cutAtComma(line: string): string {
  const [first, ...rest] = line.split(",");
  const kept = [first];
  for (const segment of rest) {
    const trimmed = segment.trim();
    if (!UNIT_SEGMENT.test(trimmed)) break;
    kept.push(trimmed);
  }
  return kept.join(" ");
}

const UNIT_PREFIX = /^(SUITE|STE|SPACE|SPC|UNIT|APT|LOT)(.+)$/;

/** "SPACE12" / "#12" / "12" → "12"; empty → null */
function canonicalUnit(raw: string): string | null {
  const unit = raw.toUpperCase().replace(/[#\s]/g, "");
  return (UNIT_PREFIX.exec(unit)?.[2] ?? unit) || null;
}

/** Null when the line has no leading house number (no key → no address matching) */
export function addressKey(line: string): AddressKey | null {
  const split = splitUnit(cutAtComma(line));
  const parsed = parseStreetAddress(split.street);
  if (!parsed) return null;

  // Own street-word step: normalizeStreetName would drop a second direction word ("W North Ln" → "LN")
  const words = parsed.streetName
    .toUpperCase()
    .replace(/['"]/g, "")
    .replace(/[^A-Z0-9]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  let dir = parsed.streetDir ?? null;
  let suffix: string | null = null;
  const last = words[words.length - 1];
  if (dir && words.length === 1 && SUFFIXES.has(last)) {
    suffix = SUFFIXES.get(last) ?? null;
    words[0] = DIRECTION_WORD[dir] ?? dir;
    dir = null;
  } else if (words.length >= 2 && SUFFIXES.has(last)) {
    suffix = SUFFIXES.get(last) ?? null;
    words.pop();
  }
  const street = words.join(" ");
  if (!street) return null;
  return { number: parsed.streetNumber, dir, street, suffix, unit: canonicalUnit(split.unit) };
}

const sameOrMissing = (a: string | null, b: string | null): boolean => a === null || b === null || a === b;

/** §5.3 address rule without locality: number and street equal; dir/suffix/unit equal or missing */
export function addressKeysCompatible(a: AddressKey, b: AddressKey): boolean {
  return (
    a.number === b.number &&
    a.street === b.street &&
    sameOrMissing(a.dir, b.dir) &&
    sameOrMissing(a.suffix, b.suffix) &&
    sameOrMissing(a.unit, b.unit)
  );
}
