// src/lib/prefill/permits/__tests__/search.test.ts
// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { PrefillInput } from "../../types";
import { rowsToHits } from "../candidates";
import {
  EDMS_ARCHIVES,
  type EdmsArchiveConfig,
  type EdmsKeyword,
  parseSearchResponse,
} from "../edms-client";
import { decideFallback, dedupeHits, scoreCandidate, searchPermits } from "../search";
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

describe("decideFallback", () => {
  const streetHits = rowsToHits(EDMS_ARCHIVES.env, parseSearchResponse(envStreet).rows);
  const princessHits = streetHits.filter((h) => h.candidate.streetAddress?.includes("PRINCESS"));

  it("is ambiguous when two properties tie at the top", () => {
    const result = decideFallback(princessHits, princess());
    expect(result.kind).toBe("ambiguous");
    expect(result.hits.map((h) => h.candidate.permitNumber)).toEqual([
      "OWR-22-01478",
      "OWR-20-04198",
      "743691",
    ]);
    expect(result.hits.map((h) => h.candidate.score)).toEqual([7, 7, 3]);
  });

  it("auto-selects the whole property group when it wins by 3 or more", () => {
    const result = decideFallback(princessHits, princess("218-06-099A"));
    expect(result.kind).toBe("found");
    expect(result.hits.map((h) => h.candidate.permitNumber)).toEqual(["OWR-22-01478"]);
  });

  it("excludes APN mismatches before deciding", () => {
    const result = decideFallback(princessHits, princess("999-99-999"));
    expect(result.kind).toBe("found");
    expect(result.hits.map((h) => h.candidate.permitNumber)).toEqual(["OWR-20-04198"]);
  });

  it("keeps a property's multiple documents together", () => {
    const villaHits = streetHits.filter((h) => h.candidate.streetAddress?.includes("VILLA CHULA"));
    const result = decideFallback(villaHits, {
      address: {
        streetNumber: "8911",
        streetName: "Villa Chula",
        streetDir: "W",
        city: "Peoria",
        zip: "85383",
      },
    });
    expect(result.kind).toBe("found");
    expect(result.hits).toHaveLength(2);
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
    expect(outcome).toMatchObject({ kind: "found", via: "apn", searched: ["APN 219-11-121"] });
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

  it("returns ambiguous candidates (at most 8) when the street fallback ties", async () => {
    const search = fakeSearch({ envStreet: envStreet });
    const outcome = await searchPermits(princess(), signal, { search });
    expect(outcome.kind).toBe("ambiguous");
    if (outcome.kind !== "ambiguous") throw new Error("unreachable");
    expect(outcome.hits).toHaveLength(3);
    expect(outcome.searched).toEqual(["8911 PRINCESS"]);
    // APN search is skipped entirely when there is no APN
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("is not_found when both searches return nothing", async () => {
    const search = fakeSearch({});
    const outcome = await searchPermits(caveCreek, signal, { search });
    expect(outcome).toEqual({
      kind: "not_found",
      searched: ["APN 219-11-121", "8911 CAVE CREEK"],
    });
  });

  it("is not_found with no terms when there is nothing valid to search", async () => {
    const search = fakeSearch({});
    const outcome = await searchPermits(
      { apn: "nope", address: { streetNumber: "", streetName: "" } },
      signal,
      { search },
    );
    expect(outcome).toEqual({ kind: "not_found", searched: [] });
    expect(search).not.toHaveBeenCalled();
  });

  it("tolerates one archive failing when the other has rows", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const search = fakeSearch({ envApn: env219, eplApn: new Error("boom") });
    const outcome = await searchPermits({ apn: "219-11-121" }, signal, { search });
    expect(outcome.kind).toBe("found");
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
    warn.mockRestore();
  });

  it("refuses a street number that is not a house number instead of sending it", async () => {
    const search = fakeSearch({});
    const outcome = await searchPermits(
      { address: { streetNumber: "8911; DROP TABLE", streetName: "Cave Creek" } },
      signal,
      { search },
    );
    expect(outcome).toEqual({ kind: "not_found", searched: [] });
    expect(search).not.toHaveBeenCalled();
  });
});
