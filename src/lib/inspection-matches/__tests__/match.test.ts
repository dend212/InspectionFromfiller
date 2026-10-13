import { describe, expect, it } from "vitest";
import {
  buildMatchResult,
  localityCompatible,
  type MatchViewer,
  matchHref,
  matchReasons,
  storedApnKey,
} from "@/lib/inspection-matches/match";
import { buildMatchQuery, type MatchQuery } from "@/lib/inspection-matches/normalize";
import type { MatchCandidateRow } from "@/lib/inspection-matches/store";
import type { InspectionMatchRequest } from "@/types/inspection-matches";

// Synthetic fixtures only (spec §12)
const ADMIN: MatchViewer = { userId: "admin-1", privileged: true };
const TECH: MatchViewer = { userId: "tech-1", privileged: false };

let seq = 0;
function stored(over: Partial<MatchCandidateRow> = {}): MatchCandidateRow {
  seq += 1;
  return {
    id: `6f1c2a9e-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    inspectorId: "admin-1",
    status: "completed",
    facilityAddress: null,
    facilityCity: null,
    facilityZip: null,
    apn: null,
    taxParcelNumber: null,
    inspectionDate: null,
    createdAt: new Date("2026-10-06T19:12:00.000Z"),
    workizJobId: null,
    inspectorName: "Sam Sample",
    ...over,
  };
}

function q(input: InspectionMatchRequest): MatchQuery {
  const query = buildMatchQuery(input);
  if (!query) throw new Error("expected a query");
  return query;
}

const addr = (facilityAddress: string, facilityZip = "", facilityCity = "") => ({ facilityAddress, facilityZip, facilityCity });
const reasons = (input: InspectionMatchRequest, row: Partial<MatchCandidateRow>) => matchReasons(q(input), stored(row));

describe("matchReasons — §5.5 examples", () => {
  it.each<[string, InspectionMatchRequest, Partial<MatchCandidateRow>, string[]]>([
    ["#1 dashed vs compact APN", { taxParcelNumber: "123-45-678" }, { taxParcelNumber: "12345678" }, ["apn"]],
    ["#2 split-parcel letter differs", { taxParcelNumber: "123-45-678A" }, { taxParcelNumber: "123-45-678" }, []],
    ["#5 column fallback when the form APN is empty", { taxParcelNumber: "123-45-678" }, { apn: "123-45-678" }, ["apn"]],
    ["#5a stale column ignored when the form APN is usable", { taxParcelNumber: "123-45-678" }, { taxParcelNumber: "123-45-679", apn: "123-45-678" }, []],
    ["#6 abbreviation variants", addr("100 E Example Rd", "85331"), { facilityAddress: "100 E. Example Road", facilityZip: "85331" }, ["address"]],
    ["#7 direction differs", addr("100 E Example Rd", "85331"), { facilityAddress: "100 W Example Rd", facilityZip: "85331" }, []],
    ["#8 direction missing on one side", addr("100 Example Rd", "85331"), { facilityAddress: "100 E Example Rd", facilityZip: "85331" }, ["address"]],
    ["#9 suffix differs", addr("1234 N 7th St", "85014"), { facilityAddress: "1234 N 7th Ave", facilityZip: "85014" }, []],
    ["#10 suffix missing on one side", addr("1234 N 7th", "85014"), { facilityAddress: "1234 N 7th Ave", facilityZip: "85014" }, ["address"]],
    ["#11 unit differs", addr("100 E Example Rd #12", "85331"), { facilityAddress: "100 E Example Rd #14", facilityZip: "85331" }, []],
    ["#12 unit missing on one side", addr("100 E Example Rd Space 12", "85331"), { facilityAddress: "100 E Example Rd", facilityZip: "85331" }, ["address"]],
    ["#12a Workiz #Space 12", addr("100 E Example Rd #Space 12", "85331"), { facilityAddress: "100 E Example Rd Space 12", facilityZip: "85331" }, ["address"]],
    ["#12b #Lot 7", addr("100 E Example Rd #Lot 7", "85331"), { facilityAddress: "100 E Example Rd Lot 7", facilityZip: "85331" }, ["address"]],
    ["#12c comma cut", addr("100 E Example Rd, Cave Creek, AZ 85331"), { facilityAddress: "100 E Example Rd", facilityZip: "85331" }, ["address"]],
    ["#12d unit kept through the comma cut", addr("100 E Example Rd, #12", "85331"), { facilityAddress: "100 E Example Rd #14", facilityZip: "85331" }, []],
    ["#12e North vs South Ln", addr("100 W North Ln", "85331"), { facilityAddress: "100 W South Ln", facilityZip: "85331" }, []],
    ["#12f East vs West St", addr("100 N East St", "85014"), { facilityAddress: "100 N West St", facilityZip: "85014" }, []],
    ["#12g West Valley vs Valley", addr("100 N West Valley Rd", "85331"), { facilityAddress: "100 N Valley Rd", facilityZip: "85331" }, []],
    ["#12h direction-word streets", addr("100 North Ln", "85331"), { facilityAddress: "100 South Ln", facilityZip: "85331" }, []],
    ["#13 ZIPs differ, cities equal", addr("100 E Example Rd", "85331", "Cave Creek"), { facilityAddress: "100 E Example Rd", facilityZip: "85377", facilityCity: "Cave Creek" }, ["address"]],
    ["#13a ZIPs differ, cities differ", addr("100 E Example Rd", "85331", "Cave Creek"), { facilityAddress: "100 E Example Rd", facilityZip: "85377", facilityCity: "Carefree" }, []],
    ["#13b ZIPs differ, no input city", addr("100 E Example Rd", "85331"), { facilityAddress: "100 E Example Rd", facilityZip: "85377", facilityCity: "Cave Creek" }, []],
    ["#14 no ZIP, cities equal", addr("100 E Example Rd", "", "cave creek"), { facilityAddress: "100 E Example Rd", facilityZip: "85331", facilityCity: "Cave Creek" }, ["address"]],
    ["#15 no ZIP, cities differ", addr("100 E Example Rd", "", "Carefree"), { facilityAddress: "100 E Example Rd", facilityZip: "85331", facilityCity: "Cave Creek" }, []],
    ["#16 locality unknown", addr("100 E Example Rd"), { facilityAddress: "100 E Example Rd", facilityZip: "85331", facilityCity: "Cave Creek" }, ["address"]],
    ["#18 different APN, same address", { ...addr("100 E Example Rd", "85331"), taxParcelNumber: "123-45-678" }, { facilityAddress: "100 E Example Rd", facilityZip: "85331", taxParcelNumber: "123-45-679" }, ["address"]],
    ["#19 same APN and address", { ...addr("100 E Example Rd", "85331"), taxParcelNumber: "123-45-678" }, { facilityAddress: "100 E Example Rd", facilityZip: "85331", taxParcelNumber: "123-45-678" }, ["apn", "address"]],
  ])("%s", (_label, input, row, expected) => {
    expect(reasons(input, row)).toEqual(expected);
  });

  it("#3 N/A never matches; #4 an input without an APN key never checks APNs", () => {
    expect(buildMatchQuery({ taxParcelNumber: "N/A" })).toBeNull();
    expect(reasons(addr("100 E Example Rd", "85331"), { apn: "123-45-678", facilityAddress: "200 E Example Rd" })).toEqual([]);
  });

  it("#5b an over-long input APN still lets the address match", () => {
    expect(
      reasons(
        { ...addr("100 E Example Rd", "85331"), taxParcelNumber: "123-45-678 & 123-45-679" },
        { facilityAddress: "100 E Example Rd", facilityZip: "85331", taxParcelNumber: "123-45-678" },
      ),
    ).toEqual(["address"]);
  });
});

describe("storedApnKey", () => {
  it("form key first; the column only when the form key is null", () => {
    expect(storedApnKey(stored({ taxParcelNumber: "123-45-679", apn: "123-45-678" }))).toBe("12345679");
    expect(storedApnKey(stored({ taxParcelNumber: "", apn: "123-45-678" }))).toBe("12345678");
    expect(storedApnKey(stored({ taxParcelNumber: "N/A", apn: "123-45-678" }))).toBe("12345678");
    expect(storedApnKey(stored({}))).toBeNull();
  });
});

describe("localityCompatible truth table", () => {
  const base = { facilityAddress: "100 E Example Rd" };
  it.each<[string, string, string, string, boolean]>([
    ["85331", "Cave Creek", "85331", "Carefree", true],
    ["85331", "Cave Creek", "85377", "Cave Creek", true],
    ["85331", "Cave Creek", "85377", "Carefree", false],
    ["85331", "", "85377", "Cave Creek", false],
    ["85331", "Cave Creek", "85377", "", false],
    ["", "Cave Creek", "85331", "Cave Creek", true],
    ["", "Carefree", "85331", "Cave Creek", false],
    ["", "", "85331", "Cave Creek", true],
    ["85331", "Cave Creek", "", "Carefree", false],
    ["85331", "Cave Creek", "", "", true],
  ])("input %s/%s vs stored %s/%s → %s", (zip, city, rowZip, rowCity, expected) => {
    const query = q({ ...base, facilityZip: zip, facilityCity: city });
    expect(localityCompatible(query, stored({ ...base, facilityZip: rowZip, facilityCity: rowCity }))).toBe(expected);
  });
});

describe("matchHref", () => {
  it("own draft → edit; another's draft → review; non-draft → inspectionPath", () => {
    expect(matchHref(stored({ id: "d1", status: "draft", inspectorId: "tech-1" }), TECH)).toBe("/inspections/d1/edit");
    expect(matchHref(stored({ id: "d2", status: "draft", inspectorId: "tech-9" }), ADMIN)).toBe("/review/d2");
    expect(matchHref(stored({ id: "s1", status: "submitted", inspectorId: "tech-9" }), ADMIN)).toBe("/review/s1");
    expect(matchHref(stored({ id: "s2", status: "submitted", inspectorId: "tech-1" }), TECH)).toBe("/inspections/s2");
    expect(matchHref(stored({ id: "d3", status: "draft", inspectorId: "admin-1" }), ADMIN)).toBe("/inspections/d3/edit");
  });
});

describe("buildMatchResult", () => {
  const input = q({ ...addr("100 E Example Rd", "85331"), taxParcelNumber: "123-45-678" });
  const at = (iso: string) => new Date(iso);
  const both = (over: Partial<MatchCandidateRow> = {}) =>
    stored({ facilityAddress: "100 E Example Rd", facilityZip: "85331", taxParcelNumber: "123-45-678", ...over });
  const apnOnly = (over: Partial<MatchCandidateRow> = {}) => stored({ facilityAddress: "9 W Other St", taxParcelNumber: "123-45-678", ...over });
  const addressOnly = (over: Partial<MatchCandidateRow> = {}) => stored({ facilityAddress: "100 E Example Rd", facilityZip: "85331", ...over });
  const opts = { limit: 5, candidateCapHit: false };

  it("ranks both → apn → address, then newest first, and drops non-matches", () => {
    const rows = [
      addressOnly({ id: "addr-new", createdAt: at("2026-10-10T00:00:00Z") }),
      apnOnly({ id: "apn", createdAt: at("2026-10-01T00:00:00Z") }),
      both({ id: "both-old", createdAt: at("2026-09-01T00:00:00Z") }),
      both({ id: "both-new", createdAt: at("2026-10-01T00:00:00Z") }),
      stored({ id: "none", facilityAddress: "5 S Elsewhere Ave" }),
    ];
    const result = buildMatchResult(input, rows, ADMIN, opts);
    expect(result.matches.map((m) => m.inspectionId)).toEqual(["both-new", "both-old", "apn", "addr-new"]);
    expect(result.matches[0].reasons).toEqual(["apn", "address"]);
    expect(result).toMatchObject({ hiddenCount: 0, truncated: false });
  });

  it("limits visible matches and marks truncated when more exist or the candidate cap was hit", () => {
    const rows = [both(), both(), both(), both()];
    expect(buildMatchResult(input, rows, ADMIN, { limit: 3, candidateCapHit: false })).toMatchObject({ truncated: true });
    expect(buildMatchResult(input, rows, ADMIN, { limit: 3, candidateCapHit: false }).matches).toHaveLength(3);
    expect(buildMatchResult(input, rows, ADMIN, { limit: 4, candidateCapHit: false }).truncated).toBe(false);
    expect(buildMatchResult(input, rows, ADMIN, { limit: 4, candidateCapHit: true }).truncated).toBe(true);
  });

  it("no-leak: a field tech gets only a count for other inspectors' matches", () => {
    const hidden = both({
      id: "6f1c2a9e-0000-4000-8000-00000000beef",
      inspectorId: "tech-9",
      facilityAddress: "100 E Example Rd",
      facilityCity: "Hiddenville",
      inspectionDate: "2026-09-30",
      inspectorName: "Pat Private",
    });
    const own = both({ inspectorId: "tech-1", facilityCity: "Cave Creek" });
    const result = buildMatchResult(input, [hidden, own, both({ inspectorId: "tech-8" })], TECH, opts);
    expect(result.hiddenCount).toBe(2);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({ isOwn: true, inspectorName: "Sam Sample" });
    const json = JSON.stringify(result);
    for (const leak of ["00000000beef", "Hiddenville", "Pat Private", "2026-09-30"]) expect(json).not.toContain(leak);
  });

  it("privileged viewers see every match with its href", () => {
    const result = buildMatchResult(input, [both({ id: "x1", inspectorId: "tech-9", status: "draft" })], ADMIN, opts);
    expect(result.hiddenCount).toBe(0);
    expect(result.matches[0]).toMatchObject({ inspectionId: "x1", href: "/review/x1", isOwn: false });
  });

  it("excludeWorkizJobIds skips only that job's own import", () => {
    const rows = [both({ id: "own-import", workizJobId: "AB12CD" }), both({ id: "other", workizJobId: "ZZ99ZZ" })];
    const result = buildMatchResult(input, rows, ADMIN, { ...opts, excludeWorkizJobIds: ["AB12CD", "JOB-AbCdEfGhIjKlMnOp"] });
    expect(result.matches.map((m) => m.inspectionId)).toEqual(["other"]);
  });

  it("maps the wire fields: empty strings for null text, ISO createdAt, invalid inspection date → null", () => {
    const [m] = buildMatchResult(input, [both({ facilityCity: null, inspectionDate: "10/06/2026" })], ADMIN, opts).matches;
    expect(m.facilityCity).toBe("");
    expect(m.inspectionDate).toBeNull();
    expect(m.createdAt).toBe("2026-10-06T19:12:00.000Z");
    const [dated] = buildMatchResult(input, [both({ inspectionDate: "2026-10-06" })], ADMIN, opts).matches;
    expect(dated.inspectionDate).toBe("2026-10-06");
  });
});
