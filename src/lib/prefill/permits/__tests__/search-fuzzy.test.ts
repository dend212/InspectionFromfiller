// src/lib/prefill/permits/__tests__/search-fuzzy.test.ts
// @vitest-environment node
/**
 * Regression cover for the 509 W Lavitt Ln miss (inspection 15d962a6, 2026-09-26).
 *
 * The assessor gives the CURRENT parcel `211-23-049L`; the 2001 permit row carries
 * `211-23-049J`, the parent parcel that was split away years later (the assessor's
 * live layer has H/F/G/L on that base and no J at all). The street round found the
 * permit; `scoreCandidate` then vetoed it for the APN disagreement and the stage
 * reported "0 matches".
 *
 * Fixtures are live recordings (2026-09-25) of the exact queries the app sends.
 */
import { describe, expect, it, vi } from "vitest";
import type { PrefillInput } from "../../types";
import {
  EDMS_ARCHIVES,
  type EdmsArchiveConfig,
  type EdmsKeyword,
  parseSearchResponse,
} from "../edms-client";
import { scoreCandidate, searchPermits } from "../search";
import envLavitt from "./fixtures/env-street-509-lavitt.json";
import env509 from "./fixtures/env-street-509.json";
import eplEmpty from "./fixtures/eplpav-empty.json";
import epl509 from "./fixtures/eplpav-street-509.json";

const signal = new AbortController().signal;

/** 509 W Lavitt Ln as the inspection holds it, with the assessor's current APN. */
const lavitt: PrefillInput = {
  apn: "211-23-049L",
  address: {
    streetNumber: "509",
    streetDir: "W",
    streetName: "LAVITT LN",
    city: "PHOENIX",
    zip: "85086",
    full: "509 W LAVITT LN, PHOENIX, AZ 85086",
  },
};

type Round = "apn" | "street" | "number";

function roundOf(archive: EdmsArchiveConfig, keywords: EdmsKeyword[]): Round {
  if (keywords.some((k) => k.id === archive.keywords.apn)) return "apn";
  return keywords.some((k) => k.id === archive.keywords.street) ? "street" : "number";
}

/** Fake `searchKeywords` routed by archive and which round the keywords describe. */
function fakeSearch(responses: Partial<Record<`${"env" | "epl"}:${Round}`, unknown>>) {
  return vi.fn(async (archive: EdmsArchiveConfig, keywords: EdmsKeyword[]) => {
    const key = `${archive.id === "env" ? "env" : "epl"}:${roundOf(archive, keywords)}` as const;
    return parseSearchResponse(responses[key] ?? eplEmpty);
  });
}

describe("scoreCandidate — APN disagreement is a signal, not a veto", () => {
  const lavittHit = parseSearchResponse(envLavitt).rows[0];
  const candidate = {
    key: "edms_env:000602:PERMIT:",
    archive: "edms_env" as const,
    permitNumber: "000602",
    docType: "PERMIT",
    streetAddress: "509 W LAVITT LN",
    city: "PHOENIX",
    zip: "85086",
    apn: "211-23-049J",
    score: 0,
  };

  it("records the fixture the app actually receives", () => {
    expect(lavittHit.columns.ParcelNumber).toBe("211-23-049J");
    expect(lavittHit.columns.EnvStreet).toBe("LAVITT LN");
  });

  it("does not veto a row whose APN is a split of ours", () => {
    expect(scoreCandidate(candidate, lavitt)).toBeGreaterThan(0);
  });

  it("still rewards an exact APN match above a split", () => {
    const exact = scoreCandidate({ ...candidate, apn: "211-23-049L" }, lavitt);
    expect(exact).toBeGreaterThan(scoreCandidate(candidate, lavitt));
  });

  it("penalises a row from an unrelated book and map", () => {
    const stranger = scoreCandidate({ ...candidate, apn: "504-51-024" }, lavitt);
    expect(stranger).toBeLessThan(scoreCandidate(candidate, lavitt));
  });
});

describe("searchPermits — 509 W Lavitt Ln", () => {
  it("finds permit 000602 on the street round despite the retired parcel number", async () => {
    const search = fakeSearch({ "env:street": envLavitt });
    const outcome = await searchPermits(lavitt, signal, { search });

    expect(outcome.kind).toBe("found");
    if (outcome.kind !== "found") throw new Error("unreachable");
    expect(outcome.via).toBe("street");
    expect(outcome.hits.map((h) => h.candidate.permitNumber)).toEqual(["000602"]);
  });

  it("falls back to a house-number-only round when number + street finds nothing", async () => {
    // The street keyword misses (misspelt street on the inspection); 509 alone hits.
    const search = fakeSearch({ "env:number": env509, "epl:number": epl509 });
    const outcome = await searchPermits(
      { ...lavitt, address: { ...lavitt.address!, streetName: "LAVVIT LN" } },
      signal,
      { search },
    );

    expect(outcome.kind).not.toBe("not_found");
    const hits = outcome.kind === "found" || outcome.kind === "ambiguous" ? outcome.hits : [];
    expect(hits.map((h) => h.candidate.permitNumber)).toContain("000602");
    expect(outcome.kind === "not_found" ? [] : outcome.searched).toContain("509");
  });

  it("never reports a confident negative when rows came back", async () => {
    // Every row is a different property — none should auto-select, all should be offered.
    const search = fakeSearch({ "env:number": env509 });
    const outcome = await searchPermits(
      {
        apn: "999-99-999",
        address: { streetNumber: "509", streetName: "NOWHERE", city: "TEMPE", zip: "85281" },
      },
      signal,
      { search },
    );

    expect(outcome.kind).toBe("ambiguous");
    if (outcome.kind !== "ambiguous") throw new Error("unreachable");
    expect(outcome.hits.length).toBeGreaterThan(0);
  });
});
