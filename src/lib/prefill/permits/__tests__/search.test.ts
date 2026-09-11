// src/lib/prefill/permits/__tests__/search.test.ts
// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { PermitCandidate, PrefillInput } from "../../types";
import { rowsToHits } from "../candidates";
import {
  EDMS_ARCHIVES,
  type EdmsArchiveConfig,
  type EdmsKeyword,
  parseSearchResponse,
} from "../edms-client";
import {
  decideFallback,
  dedupeHits,
  groupByProperty,
  scoreCandidate,
  searchPermits,
} from "../search";
import env200 from "./fixtures/env-parcel-200-08-079.json";
import env219 from "./fixtures/env-parcel-219-11-121.json";
import envStreet from "./fixtures/env-street-8911.json";
import eplEmpty from "./fixtures/eplpav-empty.json";
import eplParcel from "./fixtures/eplpav-parcel-219-12-165.json";

const signal = new AbortController().signal;

/** Fake `searchKeywords`: routes by archive + whether the APN keyword is present */
function fakeSearch(responses: {
  envApn?: unknown;
  eplApn?: unknown;
  envStreet?: unknown;
  eplStreet?: unknown;
}) {
  return vi.fn(async (archive: EdmsArchiveConfig, keywords: EdmsKeyword[]) => {
    const isApn = keywords.some((k) => k.id === archive.keywords.apn);
    const pick =
      archive.id === "env"
        ? isApn
          ? responses.envApn
          : responses.envStreet
        : isApn
          ? responses.eplApn
          : responses.eplStreet;
    if (pick instanceof Error) throw pick;
    return parseSearchResponse(pick ?? eplEmpty);
  });
}

interface RawResponse {
  DisplayColumns: { Heading: string }[];
  Data: { Name: string; DisplayColumnValues: { Value: string }[] }[];
}

/** A recorded response cut down to one row (matched by name) with some columns replaced */
function oneRow(fixture: RawResponse, name: string, columns: Record<string, string>): unknown {
  const headings = fixture.DisplayColumns.map((c) => c.Heading);
  const row = fixture.Data.find((r) => r.Name.includes(name));
  if (!row) throw new Error(`fixture missing ${name}`);
  return {
    ...fixture,
    Data: [
      {
        ...row,
        DisplayColumnValues: row.DisplayColumnValues.map((cell, i) =>
          headings[i] in columns ? { ...cell, Value: columns[headings[i]] } : cell,
        ),
      },
    ],
  };
}

const caveCreek: PrefillInput = {
  apn: "219-11-121",
  address: {
    streetNumber: "8911",
    streetName: "Cave Creek Rd",
    streetDir: "E",
    city: "Carefree",
    zip: "85377",
  },
};

const princess = (apn?: string): PrefillInput => ({
  apn,
  address: { streetNumber: "8911", streetName: "Princess Dr", streetDir: "E", city: "Mesa", zip: "85207" },
});

const villaChula: PrefillInput = {
  address: {
    streetNumber: "8911",
    streetName: "Villa Chula",
    streetDir: "W",
    city: "Peoria",
    zip: "85383",
  },
};

/** eplpav FINAL DA for the Villa Chula permit — eplpav addresses never carry a direction */
const eplVillaChula = () =>
  oneRow(eplParcel, "OW-24-00070", {
    "Permit Number": "OW-17-00474",
    "File Name": "OW-17-00474 FINAL DA",
    "Address Line 1": "8911",
    "Address Line 2": "Villa Chula",
    City: "Peoria",
    "ZIP Code": "85383",
    "Parcel Number": "200-08-079",
  });

describe("scoreCandidate", () => {
  const streetHits = rowsToHits(EDMS_ARCHIVES.env, parseSearchResponse(envStreet).rows);
  const byPermit = (n: string) => {
    const hit = streetHits.find((h) => h.candidate.permitNumber === n);
    if (!hit) throw new Error(`fixture missing ${n}`);
    return hit.candidate;
  };

  it("adds direction, city and ZIP points", () => {
    // OWR-20-04198: 8911 E PRINCESS DR, MESA 85207, no APN -> 3 + 2 + 2
    expect(scoreCandidate(byPermit("OWR-20-04198"), princess())).toBe(7);
    // 743691: 8911 E PRINCESS, no city/zip -> direction only
    expect(scoreCandidate(byPermit("743691"), princess())).toBe(3);
  });

  it("returns -Infinity when the row's APN differs from ours", () => {
    expect(scoreCandidate(byPermit("OWR-22-01478"), princess("999-99-999"))).toBe(-Infinity);
  });

  it("adds APN_MATCH_SCORE when the row's APN equals ours", () => {
    expect(scoreCandidate(byPermit("OWR-22-01478"), princess("218-06-099A"))).toBe(17);
  });

  it("adds subdivision and lot points, tolerating 'UNIT'", () => {
    const input: PrefillInput = {
      address: {
        streetNumber: "8911",
        streetName: "Villa Chula",
        streetDir: "W",
        city: "Peoria",
        zip: "85383",
      },
      subdivision: "Sunrise Unit 4",
      lot: "2",
    };
    expect(scoreCandidate(byPermit("OW-17-00474"), input)).toBe(3 + 2 + 2 + 3 + 2);
  });
});

describe("dedupeHits", () => {
  it("drops a second copy of the same permit/docType/date and prefers env", () => {
    const envHits = rowsToHits(EDMS_ARCHIVES.env, parseSearchResponse(env200).rows);
    const duplicate = {
      candidate: {
        ...envHits[0].candidate,
        archive: "edms_eplpav" as const,
        permitNumber: "ow1700474",
      },
      documentId: "other-token",
    };
    const result = dedupeHits([duplicate, ...envHits]);
    expect(result).toHaveLength(2);
    expect(result[0].candidate.archive).toBe("edms_eplpav");
    expect(dedupeHits([...envHits, duplicate])[0].candidate.archive).toBe("edms_env");
  });

  it("keeps a FINAL DA and a PERMIT for the same permit number", () => {
    const envHits = rowsToHits(EDMS_ARCHIVES.env, parseSearchResponse(env219).rows);
    const finalDa = {
      candidate: {
        ...envHits[0].candidate,
        archive: "edms_eplpav" as const,
        docType: "FINAL DA",
        docDate: "2025-11-21",
      },
      documentId: "t",
    };
    expect(dedupeHits([...envHits, finalDa])).toHaveLength(2);
  });
});

describe("groupByProperty", () => {
  const candidates = rowsToHits(EDMS_ARCHIVES.env, parseSearchResponse(envStreet).rows).map(
    (h) => h.candidate,
  );
  const princessRows = candidates.filter((c) => c.streetAddress?.includes("PRINCESS"));
  const permits = (groups: PermitCandidate[][]) => groups.map((g) => g.map((c) => c.permitNumber));

  it("groups by house number + normalised street, tolerating blank city/ZIP/APN", () => {
    // 743691 has no city/ZIP/APN and OWR-20-04198 no APN; all three are 8911 E PRINCESS [DR]
    expect(permits(groupByProperty(candidates))).toEqual([
      ["000972"],
      ["030977"],
      ["743691", "OWR-20-04198", "OWR-22-01478"],
      ["851171"],
      ["OW-17-00474", "OWR-22-04475"],
    ]);
  });

  it("splits only when an attribute populated on both sides contradicts", () => {
    const otherParcel = { ...princessRows[2], permitNumber: "X", apn: "999-99-999" };
    const otherCity = { ...princessRows[1], permitNumber: "Y", city: "Gilbert" };
    const otherDir = { ...princessRows[1], permitNumber: "Z", streetAddress: "8911 W PRINCESS DR" };
    expect(permits(groupByProperty([...princessRows, otherParcel, otherCity, otherDir]))).toEqual([
      ["743691", "OWR-20-04198", "OWR-22-01478"],
      ["X"],
      ["Y"],
      ["Z"],
    ]);
  });

  it("keeps an eplpav row (no direction) with the env rows of the same house", () => {
    const eplpav: PermitCandidate = {
      ...princessRows[2],
      archive: "edms_eplpav",
      permitNumber: "OWR-24-00001",
      streetAddress: "8911 PRINCESS",
      city: "Mesa",
      zip: "85207-1234",
    };
    expect(permits(groupByProperty([...princessRows, eplpav]))).toEqual([
      ["743691", "OWR-20-04198", "OWR-22-01478", "OWR-24-00001"],
    ]);
  });
});

describe("decideFallback", () => {
  const streetHits = rowsToHits(EDMS_ARCHIVES.env, parseSearchResponse(envStreet).rows);
  const princessHits = streetHits.filter((h) => h.candidate.streetAddress?.includes("PRINCESS"));
  /** Same house, different city -> a second property group */
  const rival = (overrides: Partial<PermitCandidate>) => ({
    documentId: "rival",
    candidate: {
      ...princessHits[2].candidate,
      key: "edms_env:R-1:NOTICE OF TRANSFER:2023-01-01",
      permitNumber: "R-1",
      docDate: "2023-01-01",
      apn: undefined,
      ...overrides,
    },
  });

  it("auto-selects a property's rows despite blank city/ZIP/APN on older documents", () => {
    const result = decideFallback(princessHits, princess());
    expect(result.kind).toBe("found");
    expect(result.hits.map((h) => h.candidate.permitNumber)).toEqual([
      "743691",
      "OWR-20-04198",
      "OWR-22-01478",
    ]);
    expect(result.hits.map((h) => h.candidate.score)).toEqual([3, 7, 7]);
  });

  it("is ambiguous when two properties tie at the top", () => {
    const result = decideFallback([...princessHits, rival({ apn: "999-99-999" })], princess());
    expect(result.kind).toBe("ambiguous");
    expect(result.hits.map((h) => h.candidate.permitNumber)).toEqual([
      "R-1",
      "OWR-22-01478",
      "OWR-20-04198",
      "743691",
    ]);
    expect(result.hits.map((h) => h.candidate.score)).toEqual([7, 7, 7, 3]);
  });

  it("auto-selects the whole property group when it wins by 3 or more", () => {
    const hits = [...princessHits, rival({ city: "GILBERT" })];
    const result = decideFallback(hits, princess("218-06-099A"));
    expect(result.kind).toBe("found");
    expect(result.hits.map((h) => h.candidate.permitNumber)).toEqual([
      "743691",
      "OWR-20-04198",
      "OWR-22-01478",
    ]);
    expect(result.hits.map((h) => h.candidate.score)).toEqual([3, 7, 17]);
  });

  it("excludes APN mismatches before deciding", () => {
    const result = decideFallback(princessHits, princess("999-99-999"));
    expect(result.kind).toBe("found");
    expect(result.hits.map((h) => h.candidate.permitNumber)).toEqual(["743691", "OWR-20-04198"]);
  });

  it("keeps a property's documents from both archives together", () => {
    const villaHits = streetHits.filter((h) => h.candidate.streetAddress?.includes("VILLA CHULA"));
    const eplHits = rowsToHits(EDMS_ARCHIVES.eplpav, parseSearchResponse(eplVillaChula()).rows);
    const result = decideFallback([...villaHits, ...eplHits], villaChula);
    expect(result.kind).toBe("found");
    expect(result.hits.map((h) => h.candidate.key)).toEqual([
      "edms_env:OW-17-00474:PERMIT:2018-02-08",
      "edms_env:OWR-22-04475:NOTICE OF TRANSFER:2022-09-21",
      "edms_eplpav:OW-17-00474:FINAL DA:2025-11-21",
    ]);
    expect(result.hits.map((h) => h.candidate.score)).toEqual([7, 7, 4]);
  });

  it("is ambiguous when the only group scores below 5", () => {
    const only = streetHits.filter((h) => h.candidate.permitNumber === "743691");
    expect(decideFallback(only, princess()).kind).toBe("ambiguous");
  });
});

describe("searchPermits", () => {
  it("finds by APN on env, searching both archives with the dashed APN", async () => {
    const search = fakeSearch({ envApn: env219, eplApn: eplEmpty });
    const outcome = await searchPermits({ apn: "21911121" }, signal, { search });
    expect(outcome).toMatchObject({
      kind: "found",
      via: "apn",
      searched: ["APN 219-11-121"],
      failedArchives: [],
    });
    if (outcome.kind !== "found") throw new Error("unreachable");
    expect(outcome.hits.map((h) => h.candidate.permitNumber)).toEqual(["000972"]);
    expect(outcome.hits[0].candidate.score).toBe(10);
    expect(search).toHaveBeenCalledTimes(2);
    expect(search).toHaveBeenCalledWith(
      EDMS_ARCHIVES.env,
      [{ id: 1264, value: "219-11-121" }],
      signal,
    );
    expect(search).toHaveBeenCalledWith(
      EDMS_ARCHIVES.eplpav,
      [{ id: 4647, value: "219-11-121" }],
      signal,
    );
  });

  it("merges APN hits from both archives", async () => {
    const search = fakeSearch({ envApn: env200, eplApn: eplParcel });
    const outcome = await searchPermits({ apn: "200-08-079" }, signal, { search });
    if (outcome.kind !== "found") throw new Error(`expected found, got ${outcome.kind}`);
    expect(outcome.hits.map((h) => h.candidate.key)).toEqual([
      "edms_env:OW-17-00474:PERMIT:2018-02-08",
      "edms_env:OWR-22-04475:NOTICE OF TRANSFER:2022-09-21",
      "edms_eplpav:OW-24-00070:FINAL DA:2025-11-21",
    ]);
  });

  it("falls back to street number + normalised street wildcard and auto-selects", async () => {
    const search = fakeSearch({
      envApn: eplEmpty,
      eplApn: eplEmpty,
      envStreet: envStreet,
      eplStreet: eplEmpty,
    });
    const outcome = await searchPermits(caveCreek, signal, { search });
    expect(outcome).toMatchObject({
      kind: "found",
      via: "street",
      searched: ["APN 219-11-121", "8911 CAVE CREEK"],
      failedArchives: [],
    });
    if (outcome.kind !== "found") throw new Error("unreachable");
    expect(outcome.hits.map((h) => h.candidate.permitNumber)).toEqual(["000972"]);
    expect(search).toHaveBeenCalledWith(
      EDMS_ARCHIVES.env,
      [
        { id: 1307, value: "8911" },
        { id: 1309, value: "CAVE CREEK*" },
      ],
      signal,
    );
    expect(search).toHaveBeenCalledWith(
      EDMS_ARCHIVES.eplpav,
      [
        { id: 4608, value: "8911" },
        { id: 4609, value: "CAVE CREEK*" },
      ],
      signal,
    );
  });

  it("auto-selects one house's rows from both archives on the street fallback", async () => {
    const search = fakeSearch({ envStreet: envStreet, eplStreet: eplVillaChula() });
    const outcome = await searchPermits(villaChula, signal, { search });
    expect(outcome).toMatchObject({
      kind: "found",
      via: "street",
      searched: ["8911 VILLA CHULA"],
      failedArchives: [],
    });
    if (outcome.kind !== "found") throw new Error("unreachable");
    expect(outcome.hits.map((h) => h.candidate.key)).toEqual([
      "edms_env:OW-17-00474:PERMIT:2018-02-08",
      "edms_env:OWR-22-04475:NOTICE OF TRANSFER:2022-09-21",
      "edms_eplpav:OW-17-00474:FINAL DA:2025-11-21",
    ]);
    expect(outcome.hits.map((h) => h.candidate.score)).toEqual([7, 7, 4]);
  });

  it("searches a lettered house number uppercased and still matches its rows", async () => {
    const search = fakeSearch({
      envStreet: oneRow(envStreet, "OWR-20-04198", { EnvStreetNo: "8911A" }),
    });
    const outcome = await searchPermits(
      {
        address: {
          streetNumber: "8911a",
          streetName: "Princess Dr",
          streetDir: "E",
          city: "Mesa",
          zip: "85207",
        },
      },
      signal,
      { search },
    );
    expect(outcome).toMatchObject({ kind: "found", via: "street", searched: ["8911A PRINCESS"] });
    if (outcome.kind !== "found") throw new Error("unreachable");
    expect(outcome.hits.map((h) => h.candidate.streetAddress)).toEqual(["8911A E PRINCESS DR"]);
    expect(search).toHaveBeenCalledWith(
      EDMS_ARCHIVES.env,
      [
        { id: 1307, value: "8911A" },
        { id: 1309, value: "PRINCESS*" },
      ],
      signal,
    );
  });

  it("returns ambiguous candidates (at most 8) when no property scores 5", async () => {
    const search = fakeSearch({ envStreet: envStreet });
    const outcome = await searchPermits(
      { address: { streetNumber: "8911", streetName: "Princess Dr" } },
      signal,
      { search },
    );
    expect(outcome.kind).toBe("ambiguous");
    if (outcome.kind !== "ambiguous") throw new Error("unreachable");
    expect(outcome.hits).toHaveLength(3);
    expect(outcome.hits.map((h) => h.candidate.score)).toEqual([0, 0, 0]);
    expect(outcome.searched).toEqual(["8911 PRINCESS"]);
    expect(outcome.failedArchives).toEqual([]);
    // APN search is skipped entirely when there is no APN
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("is not_found when both searches return nothing", async () => {
    const search = fakeSearch({});
    const outcome = await searchPermits(caveCreek, signal, { search });
    expect(outcome).toEqual({
      kind: "not_found",
      searched: ["APN 219-11-121", "8911 CAVE CREEK"],
      failedArchives: [],
    });
  });

  it("is not_found with no terms when there is nothing valid to search", async () => {
    const search = fakeSearch({});
    const outcome = await searchPermits(
      { apn: "nope", address: { streetNumber: "", streetName: "" } },
      signal,
      { search },
    );
    expect(outcome).toEqual({ kind: "not_found", searched: [], failedArchives: [] });
    expect(search).not.toHaveBeenCalled();
  });

  it("tolerates one archive failing when the other has rows, naming it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const search = fakeSearch({ envApn: env219, eplApn: new Error("boom") });
    const outcome = await searchPermits({ apn: "219-11-121" }, signal, { search });
    expect(outcome).toMatchObject({ kind: "found", via: "apn", failedArchives: ["edms_eplpav"] });
    warn.mockRestore();
  });

  it("flags env on a street-round hit that only eplpav could answer", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const search = fakeSearch({ envStreet: new Error("down"), eplStreet: eplVillaChula() });
    const outcome = await searchPermits(villaChula, signal, { search });
    // The lone eplpav row scores 4 (city + ZIP, no direction) -> below auto-select
    expect(outcome).toMatchObject({ kind: "ambiguous", failedArchives: ["edms_env"] });
    if (outcome.kind !== "ambiguous") throw new Error("unreachable");
    expect(outcome.hits.map((h) => h.candidate.key)).toEqual([
      "edms_eplpav:OW-17-00474:FINAL DA:2025-11-21",
    ]);
    warn.mockRestore();
  });

  it("is not_found naming the failed archive when the other archive is empty", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const search = fakeSearch({ envApn: new Error("down"), envStreet: new Error("down") });
    const outcome = await searchPermits(caveCreek, signal, { search });
    expect(outcome).toEqual({
      kind: "not_found",
      searched: ["APN 219-11-121", "8911 CAVE CREEK"],
      failedArchives: ["edms_env"],
    });
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("keeps an APN-round failure on not_found even when the street round completed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const search = fakeSearch({ envApn: new Error("down") });
    const outcome = await searchPermits(caveCreek, signal, { search });
    expect(outcome).toEqual({
      kind: "not_found",
      searched: ["APN 219-11-121", "8911 CAVE CREEK"],
      failedArchives: ["edms_env"],
    });
    expect(search).toHaveBeenCalledTimes(4);
    warn.mockRestore();
  });

  it("is an error when every search attempt failed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const search = fakeSearch({ envApn: new Error("down"), eplApn: new Error("down") });
    const outcome = await searchPermits({ apn: "219-11-121" }, signal, { search });
    expect(outcome).toMatchObject({
      kind: "error",
      message: expect.stringContaining("Maricopa EDMS unavailable"),
    });
    expect(outcome).not.toHaveProperty("failedArchives");
    warn.mockRestore();
  });

  it("skips the street round once the signal is aborted", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const controller = new AbortController();
    controller.abort();
    const aborted = new Error("aborted");
    const search = fakeSearch({ envApn: aborted, eplApn: aborted, envStreet: envStreet });
    const outcome = await searchPermits(caveCreek, controller.signal, { search });
    expect(outcome).toMatchObject({ kind: "error", searched: ["APN 219-11-121"] });
    expect(search).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("refuses a street number that is not a house number instead of sending it", async () => {
    const search = fakeSearch({});
    const outcome = await searchPermits(
      { address: { streetNumber: "8911; DROP TABLE", streetName: "Cave Creek" } },
      signal,
      { search },
    );
    expect(outcome).toEqual({ kind: "not_found", searched: [], failedArchives: [] });
    expect(search).not.toHaveBeenCalled();
  });
});
