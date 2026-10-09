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
  APN_SPLIT_SCORE,
  corroboratesParcel,
  decideFallback,
  dedupeHits,
  groupByProperty,
  scoreCandidate,
  searchPermits,
} from "../search";
import westlandApnTransfer from "./fixtures/env-apn-211-46-170-transfer.json";
import env200 from "./fixtures/env-parcel-200-08-079.json";
import env219 from "./fixtures/env-parcel-219-11-121.json";
import westlandStreet from "./fixtures/env-street-5116-westland.json";
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

/** A recorded response with some columns of one row replaced (row matched by name); other rows untouched */
function withColumns(
  fixture: RawResponse,
  name: string,
  columns: Record<string, string>,
): RawResponse {
  const headings = fixture.DisplayColumns.map((c) => c.Heading);
  return {
    ...fixture,
    Data: fixture.Data.map((row) =>
      row.Name.includes(name)
        ? {
            ...row,
            DisplayColumnValues: row.DisplayColumnValues.map((cell, i) =>
              headings[i] in columns ? { ...cell, Value: columns[headings[i]] } : cell,
            ),
          }
        : row,
    ),
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
  address: {
    streetNumber: "8911",
    streetName: "Princess Dr",
    streetDir: "E",
    city: "Mesa",
    zip: "85207",
  },
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

  it("adds street, direction, city and ZIP points", () => {
    // OWR-20-04198: 8911 E PRINCESS DR, MESA 85207, no APN -> 4 + 3 + 2 + 2
    expect(scoreCandidate(byPermit("OWR-20-04198"), princess())).toBe(11);
    // 743691: 8911 E PRINCESS, no city/zip -> street + direction
    expect(scoreCandidate(byPermit("743691"), princess())).toBe(7);
  });

  it("penalises a row from a different book and map instead of excluding it", () => {
    // 218-06-099A against our 999-99-999: 11 address points, APN_MISMATCH_PENALTY
    expect(scoreCandidate(byPermit("OWR-22-01478"), princess("999-99-999"))).toBe(3);
  });

  it("treats a row whose APN is a split of ours as the same property", () => {
    // 218-06-099A vs 218-06-099: same book-map-parcel, different split letter
    expect(scoreCandidate(byPermit("OWR-22-01478"), princess("218-06-099"))).toBe(
      11 + APN_SPLIT_SCORE,
    );
  });

  it("adds APN_MATCH_SCORE when the row's APN equals ours", () => {
    expect(scoreCandidate(byPermit("OWR-22-01478"), princess("218-06-099A"))).toBe(21);
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
    expect(scoreCandidate(byPermit("OW-17-00474"), input)).toBe(4 + 3 + 2 + 2 + 3 + 2);
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
    expect(result.hits.map((h) => h.candidate.score)).toEqual([7, 11, 11]);
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
    expect(result.hits.map((h) => h.candidate.score)).toEqual([11, 11, 11, 7]);
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
    expect(result.hits.map((h) => h.candidate.score)).toEqual([7, 11, 21]);
  });

  it("keeps an APN mismatch with its property, scored below its siblings", () => {
    // The parcel number on a permit is only as current as the day it was filed,
    // so a disagreement demotes the row — it no longer deletes it (509 W Lavitt Ln).
    const result = decideFallback(princessHits, princess("999-99-999"));
    expect(result.kind).toBe("found");
    expect(result.hits.map((h) => h.candidate.permitNumber)).toEqual([
      "743691",
      "OWR-20-04198",
      "OWR-22-01478",
    ]);
    expect(result.hits.map((h) => h.candidate.score)).toEqual([7, 11, 3]);
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
    expect(result.hits.map((h) => h.candidate.score)).toEqual([11, 11, 8]);
  });

  it("is ambiguous when the only group scores below AUTO_SELECT_MIN_SCORE", () => {
    const only = streetHits.filter((h) => h.candidate.permitNumber === "743691");
    expect(decideFallback(only, princess()).kind).toBe("ambiguous");
  });
});

/** 5116 E Westland Rd, Cave Creek (inspection 4e46e23e, 2026-10-09) */
const westland: PrefillInput = {
  apn: "211-46-170",
  subdivision: "SAGUARO WEST 2",
  lot: "38",
  address: {
    streetNumber: "5116",
    streetName: "WESTLAND RD",
    streetDir: "E",
    city: "CAVE CREEK",
    zip: "85331",
  },
};

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
    expect(outcome.hits.map((h) => h.candidate.score)).toEqual([11, 11, 8]);
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

  it("returns ambiguous candidates (at most 8) when no property clears the bar", async () => {
    const search = fakeSearch({ envStreet: envStreet });
    const outcome = await searchPermits(
      { address: { streetNumber: "8911", streetName: "Princess Dr" } },
      signal,
      { search },
    );
    expect(outcome.kind).toBe("ambiguous");
    if (outcome.kind !== "ambiguous") throw new Error("unreachable");
    expect(outcome.hits).toHaveLength(3);
    expect(outcome.hits.map((h) => h.candidate.score)).toEqual([4, 4, 4]);
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
      searched: ["APN 219-11-121", "8911 CAVE CREEK", "8911"],
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
      searched: ["APN 219-11-121", "8911 CAVE CREEK", "8911"],
      failedArchives: ["edms_env"],
    });
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });

  it("keeps an APN-round failure on not_found even when the street round completed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const search = fakeSearch({ envApn: new Error("down") });
    const outcome = await searchPermits(caveCreek, signal, { search });
    expect(outcome).toEqual({
      kind: "not_found",
      searched: ["APN 219-11-121", "8911 CAVE CREEK", "8911"],
      failedArchives: ["edms_env"],
    });
    expect(search).toHaveBeenCalledTimes(6);
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

  // Regression: the APN query returned only the 2023 Notice of Transfer for 5116 E Westland Rd
  // (recorded 2026-10-09), so the run stopped there. Permit 820747 is filed with a blank parcel
  // number, so no APN query can return it; only the street round can.
  it("keeps searching past an APN hit that is only a transfer, so a blank-APN permit on the house is found", async () => {
    const search = fakeSearch({
      envApn: westlandApnTransfer,
      eplApn: eplEmpty,
      envStreet: westlandStreet,
      eplStreet: eplEmpty,
    });
    const outcome = await searchPermits(westland, signal, { search });
    expect(outcome).toMatchObject({ kind: "found", via: "street", failedArchives: [] });
    if (outcome.kind !== "found") throw new Error("unreachable");
    expect(outcome.hits.map((h) => h.candidate.permitNumber).sort()).toEqual([
      "820747",
      "OWR-23-00980",
    ]);
    expect(search).toHaveBeenCalledTimes(4);
  });

  it("still reports a transfer-only parcel as found by APN when no other record turns up", async () => {
    const search = fakeSearch({
      envApn: westlandApnTransfer,
      eplApn: eplEmpty,
      envStreet: eplEmpty,
      eplStreet: eplEmpty,
    });
    const outcome = await searchPermits(westland, signal, { search });
    expect(outcome).toMatchObject({ kind: "found", via: "apn", failedArchives: [] });
    if (outcome.kind !== "found") throw new Error("unreachable");
    expect(outcome.hits.map((h) => h.candidate.permitNumber)).toEqual(["OWR-23-00980"]);
    expect(outcome.hits[0].candidate.score).toBe(10);
  });

  it("keeps an APN transfer and names the archive whose street search failed", async () => {
    const search = fakeSearch({
      envApn: westlandApnTransfer,
      eplApn: eplEmpty,
      envStreet: new Error("EDMS timeout"),
      eplStreet: eplEmpty,
    });
    const outcome = await searchPermits(westland, signal, { search });
    expect(outcome).toMatchObject({ kind: "found", via: "apn", failedArchives: ["edms_env"] });
    if (outcome.kind !== "found") throw new Error("unreachable");
    expect(outcome.hits.map((h) => h.candidate.permitNumber)).toEqual(["OWR-23-00980"]);
  });

  it("does not let an address row replace a permit found by APN", async () => {
    const search = fakeSearch({
      envApn: env219,
      eplApn: eplEmpty,
      envStreet: westlandStreet,
      eplStreet: eplEmpty,
    });
    const outcome = await searchPermits({ ...westland, apn: "219-11-121" }, signal, { search });
    expect(outcome).toMatchObject({ kind: "found", via: "apn" });
    if (outcome.kind !== "found") throw new Error("unreachable");
    expect(outcome.hits.map((h) => h.candidate.permitNumber)).toEqual(["000972"]);
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("does not attach a same-house permit on another lot to the parcel's transfer", async () => {
    const otherLot = withColumns(westlandStreet, "820747", {
      EnvLotNumber: "12",
      EnvSubdivision: "DESERT HILLS",
    });
    const search = fakeSearch({
      envApn: westlandApnTransfer,
      eplApn: eplEmpty,
      envStreet: otherLot,
      eplStreet: eplEmpty,
    });
    const outcome = await searchPermits(westland, signal, { search });
    expect(outcome).toMatchObject({ kind: "found", via: "apn", failedArchives: [] });
    if (outcome.kind !== "found") throw new Error("unreachable");
    expect(outcome.hits.map((h) => h.candidate.permitNumber)).toEqual(["OWR-23-00980"]);
  });

  it("needs a positive identity match, so a same-house permit with no lot or subdivision is not attached", async () => {
    const bare = withColumns(westlandStreet, "820747", { EnvLotNumber: "", EnvSubdivision: "" });
    const search = fakeSearch({
      envApn: westlandApnTransfer,
      eplApn: eplEmpty,
      envStreet: bare,
      eplStreet: eplEmpty,
    });
    const outcome = await searchPermits(westland, signal, { search });
    expect(outcome).toMatchObject({ kind: "found", via: "apn" });
    if (outcome.kind !== "found") throw new Error("unreachable");
    expect(outcome.hits.map((h) => h.candidate.permitNumber)).toEqual(["OWR-23-00980"]);
  });

  it("ties a permit filed under a split of the parcel APN to the parcel", async () => {
    const split = withColumns(westlandStreet, "820747", {
      ParcelNumber: "211-46-170A",
      EnvLotNumber: "",
      EnvSubdivision: "",
    });
    const search = fakeSearch({
      envApn: westlandApnTransfer,
      eplApn: eplEmpty,
      envStreet: split,
      eplStreet: eplEmpty,
    });
    const outcome = await searchPermits(westland, signal, { search });
    expect(outcome).toMatchObject({ kind: "found", via: "street" });
    if (outcome.kind !== "found") throw new Error("unreachable");
    expect(outcome.hits.map((h) => h.candidate.permitNumber).sort()).toEqual([
      "820747",
      "OWR-23-00980",
    ]);
  });

  it("keeps an abandonment on the parcel when its street is spelled differently", async () => {
    const renamed = withColumns(westlandApnTransfer, "OWR-23-00980", {
      EnvSepticDocType: "ABANDONMENT",
      EnvStreet: "CAVE CREEK RD",
    });
    const search = fakeSearch({
      envApn: renamed,
      eplApn: eplEmpty,
      envStreet: westlandStreet,
      eplStreet: eplEmpty,
    });
    const outcome = await searchPermits(westland, signal, { search });
    expect(outcome).toMatchObject({ kind: "found", via: "street" });
    if (outcome.kind !== "found") throw new Error("unreachable");
    expect(outcome.hits.map((h) => h.candidate.docType).sort()).toEqual(["ABANDONMENT", "PERMIT"]);
  });

  it("does not let a same-number permit at another address replace the parcel's transfer", async () => {
    const elsewhere: PrefillInput = {
      apn: "211-46-170",
      address: {
        streetNumber: "509",
        streetName: "MOUNTAIN RD",
        streetDir: "S",
        city: "MARICOPA",
        zip: "85139",
      },
    };
    const search = fakeSearch({
      envApn: westlandApnTransfer,
      eplApn: eplEmpty,
      envStreet: westlandStreet,
      eplStreet: eplEmpty,
    });
    const outcome = await searchPermits(elsewhere, signal, { search });
    expect(outcome).toMatchObject({ kind: "found", via: "apn" });
    if (outcome.kind !== "found") throw new Error("unreachable");
    expect(outcome.hits.map((h) => h.candidate.permitNumber)).toEqual(["OWR-23-00980"]);
  });

  it("does not attach a same-house permit on the same lot number of another subdivision", async () => {
    const otherSubdivision = withColumns(westlandStreet, "820747", {
      EnvSubdivision: "DESERT HILLS",
    });
    const search = fakeSearch({
      envApn: westlandApnTransfer,
      eplApn: eplEmpty,
      envStreet: otherSubdivision,
      eplStreet: eplEmpty,
    });
    const outcome = await searchPermits(westland, signal, { search });
    expect(outcome).toMatchObject({ kind: "found", via: "apn" });
    if (outcome.kind !== "found") throw new Error("unreachable");
    expect(outcome.hits.map((h) => h.candidate.permitNumber)).toEqual(["OWR-23-00980"]);
  });

  it("does not attach a same-house permit on another lot of the same subdivision", async () => {
    const otherLot = withColumns(westlandStreet, "820747", { EnvLotNumber: "12" });
    const search = fakeSearch({
      envApn: westlandApnTransfer,
      eplApn: eplEmpty,
      envStreet: otherLot,
      eplStreet: eplEmpty,
    });
    const outcome = await searchPermits(westland, signal, { search });
    expect(outcome).toMatchObject({ kind: "found", via: "apn" });
    if (outcome.kind !== "found") throw new Error("unreachable");
    expect(outcome.hits.map((h) => h.candidate.permitNumber)).toEqual(["OWR-23-00980"]);
  });

  it("does not attach a same-house permit filed under another book's parcel number", async () => {
    const otherBook = withColumns(westlandStreet, "820747", { ParcelNumber: "219-11-121" });
    const search = fakeSearch({
      envApn: westlandApnTransfer,
      eplApn: eplEmpty,
      envStreet: otherBook,
      eplStreet: eplEmpty,
    });
    const outcome = await searchPermits(westland, signal, { search });
    expect(outcome).toMatchObject({ kind: "found", via: "apn" });
    if (outcome.kind !== "found") throw new Error("unreachable");
    expect(outcome.hits.map((h) => h.candidate.permitNumber)).toEqual(["OWR-23-00980"]);
  });

  it("does not attach a same-house permit on the other side of the street", async () => {
    const otherSide = withColumns(westlandStreet, "820747", { EnvStreetDir: "W" });
    const search = fakeSearch({
      envApn: westlandApnTransfer,
      eplApn: eplEmpty,
      envStreet: otherSide,
      eplStreet: eplEmpty,
    });
    const outcome = await searchPermits(westland, signal, { search });
    expect(outcome).toMatchObject({ kind: "found", via: "apn" });
    if (outcome.kind !== "found") throw new Error("unreachable");
    expect(outcome.hits.map((h) => h.candidate.permitNumber)).toEqual(["OWR-23-00980"]);
  });

  it("corroborates an ePLPAV permit filed under a split of the parcel APN", async () => {
    const eplSplit = oneRow(eplParcel, "OW-24-00070", {
      "Parcel Number": "211-46-170A",
      "Address Line 1": "5116 WESTLAND RD",
      "Address Line 2": "",
      City: "CAVE CREEK",
      "ZIP Code": "85331",
      "Subdivision (For Septic Only)": "",
      "LotNumber (For Septic Only)": "",
    });
    const search = fakeSearch({
      envApn: westlandApnTransfer,
      eplApn: eplEmpty,
      envStreet: eplEmpty,
      eplStreet: eplSplit,
    });
    const outcome = await searchPermits(westland, signal, { search });
    expect(outcome).toMatchObject({ kind: "found", via: "street", failedArchives: [] });
    if (outcome.kind !== "found") throw new Error("unreachable");
    expect(outcome.hits.map((h) => h.candidate.archive).sort()).toEqual([
      "edms_env",
      "edms_eplpav",
    ]);
  });

  it("keeps a corroborated permit and names the archive whose street query failed", async () => {
    const search = fakeSearch({
      envApn: westlandApnTransfer,
      eplApn: eplEmpty,
      envStreet: westlandStreet,
      eplStreet: new Error("EDMS timeout"),
    });
    const outcome = await searchPermits(westland, signal, { search });
    expect(outcome).toMatchObject({
      kind: "found",
      via: "street",
      failedArchives: ["edms_eplpav"],
    });
    if (outcome.kind !== "found") throw new Error("unreachable");
    expect(outcome.hits.map((h) => h.candidate.permitNumber).sort()).toEqual([
      "820747",
      "OWR-23-00980",
    ]);
  });

  it.each([
    ["a different ZIP", { EnvZip: "85377" }],
    ["a different city", { EnvCity: "CAREFREE" }],
    ["a street name that only starts the same", { EnvStreet: "WESTLANDS RD" }],
    ["another house number", { EnvStreetNo: "5118" }],
    ["a house number with a letter", { EnvStreetNo: "5116A" }],
  ])("does not attach a same-house permit with %s", async (_label, columns) => {
    const contradicted = withColumns(westlandStreet, "820747", columns);
    const search = fakeSearch({
      envApn: westlandApnTransfer,
      eplApn: eplEmpty,
      envStreet: contradicted,
      eplStreet: eplEmpty,
    });
    const outcome = await searchPermits(westland, signal, { search });
    expect(outcome).toMatchObject({ kind: "found", via: "apn" });
    if (outcome.kind !== "found") throw new Error("unreachable");
    expect(outcome.hits.map((h) => h.candidate.permitNumber)).toEqual(["OWR-23-00980"]);
  });

  it("corroborates a same-house permit that only the house-number round returns", async () => {
    // The street round (two keywords) comes back empty; the house-number round (one keyword) has the house
    const search = vi.fn(async (archive: EdmsArchiveConfig, keywords: EdmsKeyword[]) => {
      if (archive.id !== "env") return parseSearchResponse(eplEmpty);
      if (keywords.some((k) => k.id === archive.keywords.apn)) {
        return parseSearchResponse(westlandApnTransfer);
      }
      return parseSearchResponse(keywords.length === 1 ? westlandStreet : eplEmpty);
    });
    const outcome = await searchPermits(westland, signal, { search });
    expect(outcome).toMatchObject({ kind: "found", via: "number" });
    if (outcome.kind !== "found") throw new Error("unreachable");
    expect(outcome.hits.map((h) => h.candidate.permitNumber).sort()).toEqual([
      "820747",
      "OWR-23-00980",
    ]);
  });
});

describe("corroboratesParcel", () => {
  const ours: PrefillInput = {
    apn: "211-46-170",
    subdivision: "SAGUARO WEST 2",
    lot: "38",
    address: {
      streetNumber: "5116",
      streetName: "WESTLAND RD",
      streetDir: "E",
      city: "CAVE CREEK",
      zip: "85331",
    },
  };
  const permit = (over: Partial<PermitCandidate> = {}): PermitCandidate => ({
    key: "edms_env:820747:PERMIT:2015-09-11",
    archive: "edms_env",
    permitNumber: "820747",
    docType: "PERMIT",
    docDate: "2015-09-11",
    streetAddress: "5116 WESTLAND RD",
    city: "CAVE CREEK",
    zip: "",
    subdivision: "SAGUARO WEST II",
    lot: "38",
    apn: "",
    score: 0,
    ...over,
  });

  it("accepts the parcel own permit when its lot and subdivision agree", () => {
    expect(corroboratesParcel(permit(), ours)).toBe(true);
  });

  it("rejects a same-house permit on the other street suffix of the same subdivision", () => {
    // 509 N 104TH ST (lot 7) and 509 N 104TH PL (lot 39) share a subdivision and a house number
    const parcel: PrefillInput = {
      subdivision: "CREST VIEW PARK",
      address: {
        streetNumber: "509",
        streetName: "104TH ST",
        streetDir: "N",
        city: "MESA",
        zip: "85207",
      },
    };
    const pl = permit({
      streetAddress: "509 N 104TH PL",
      subdivision: "CREST VIEW PARK",
      lot: "39",
      city: "MESA",
      zip: "85207",
    });
    expect(corroboratesParcel(pl, parcel)).toBe(false);
  });

  it("does not take a subdivision as identity when a street suffix is missing", () => {
    const noSuffix: PrefillInput = {
      ...ours,
      lot: undefined,
      address: { ...ours.address!, streetName: "WESTLAND" },
    };
    expect(
      corroboratesParcel(permit({ streetAddress: "5116 WESTLAND RD", lot: "" }), noSuffix),
    ).toBe(false);
  });

  it("accepts a different suffix when the APN matches exactly", () => {
    const sameApn = permit({
      streetAddress: "5116 WESTLAND ST",
      apn: "211-46-170",
      lot: "",
      subdivision: "",
    });
    expect(corroboratesParcel(sameApn, ours)).toBe(true);
  });

  it("rejects a permit under a different parcel number in the same map", () => {
    expect(corroboratesParcel(permit({ apn: "211-46-171" }), ours)).toBe(false);
  });

  it("rejects a permit in another book or map", () => {
    expect(corroboratesParcel(permit({ apn: "219-11-121" }), ours)).toBe(false);
  });

  it("accepts a permit filed under a split of the parcel APN with no lot or subdivision", () => {
    expect(corroboratesParcel(permit({ apn: "211-46-170A", lot: "", subdivision: "" }), ours)).toBe(
      true,
    );
  });

  it("rejects a same-house permit on another lot of the same subdivision", () => {
    expect(corroboratesParcel(permit({ lot: "12" }), ours)).toBe(false);
  });

  it("rejects a blank lot and subdivision when no APN matches", () => {
    expect(corroboratesParcel(permit({ lot: "", subdivision: "" }), ours)).toBe(false);
  });

  it("reads a spelled-out direction as its abbreviation", () => {
    expect(corroboratesParcel(permit({ streetAddress: "5116 EAST WESTLAND RD" }), ours)).toBe(true);
  });

  it("rejects the other side of the street", () => {
    expect(corroboratesParcel(permit({ streetAddress: "5116 W WESTLAND RD" }), ours)).toBe(false);
  });

  it("reads MARICOPA COUNTY as no city, not a conflict", () => {
    expect(corroboratesParcel(permit({ city: "MARICOPA COUNTY" }), ours)).toBe(true);
  });
});
