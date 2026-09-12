// src/lib/prefill/permits/__tests__/candidates.test.ts
import { describe, expect, it } from "vitest";
import { rowToCandidate, rowsToHits } from "../candidates";
import { EDMS_ARCHIVES, parseSearchResponse } from "../edms-client";
import envParcel from "./fixtures/env-parcel-200-08-079.json";
import envSingle from "./fixtures/env-parcel-219-11-121.json";
import eplNoSuffix from "./fixtures/eplpav-ow-nosuffix.json";
import eplOwr from "./fixtures/eplpav-owr-sample.json";
import eplParcel from "./fixtures/eplpav-parcel-219-12-165.json";

describe("rowToCandidate (env)", () => {
  it("maps the legacy columns, derives the date from Name and builds the key", () => {
    const [row] = parseSearchResponse(envParcel).rows;
    expect(rowToCandidate(EDMS_ARCHIVES.env, row)).toEqual({
      key: "edms_env:OW-17-00474:PERMIT:2018-02-08",
      archive: "edms_env",
      permitNumber: "OW-17-00474",
      docType: "PERMIT",
      docDate: "2018-02-08",
      description: "EnvSeptic - 2/8/2018 - OW-17-00474 - PERMIT",
      streetAddress: "8911 W VILLA CHULA",
      city: "PEORIA",
      zip: "85383",
      subdivision: "SUNRISE 4",
      lot: "2",
      apn: "200-08-079",
      score: 0,
    });
  });

  it("leaves blank columns undefined", () => {
    const [row] = parseSearchResponse(envSingle).rows;
    const c = rowToCandidate(EDMS_ARCHIVES.env, row);
    expect(c?.zip).toBeUndefined();
    expect(c?.lot).toBeUndefined();
    expect(c?.subdivision).toBeUndefined();
    expect(c?.apn).toBe("219-11-121");
    expect(c?.streetAddress).toBe("8911 E CAVE CREEK RD");
  });

  it("returns null when the permit number is missing", () => {
    const [row] = parseSearchResponse(envSingle).rows;
    expect(
      rowToCandidate(EDMS_ARCHIVES.env, { ...row, columns: { ...row.columns, EnvPermitNumber: "" } }),
    ).toBeNull();
  });
});

describe("rowToCandidate (eplpav)", () => {
  it("derives FINAL DA, uses Closed Date, decodes the description and uppercases the address", () => {
    const [row] = parseSearchResponse(eplParcel).rows;
    const c = rowToCandidate(EDMS_ARCHIVES.eplpav, row);
    expect(c).toMatchObject({
      key: "edms_eplpav:OW-24-00070:FINAL DA:2025-11-21",
      archive: "edms_eplpav",
      permitNumber: "OW-24-00070",
      docType: "FINAL DA",
      docDate: "2025-11-21",
      streetAddress: "11425 COTTONTAIL",
      city: "Cave Creek",
      zip: "85331",
      apn: "219-12-165",
      score: 0,
    });
    expect(c?.description).toMatch(/^Standard, New, Septic Tank with Additional Alternative Elements/);
    expect(c?.description?.length).toBeLessThanOrEqual(300);
  });

  it("falls back to PERMIT + Issued Date when File Name and Closed Date are empty", () => {
    const [row] = parseSearchResponse(eplNoSuffix).rows;
    expect(rowToCandidate(EDMS_ARCHIVES.eplpav, row)).toMatchObject({
      key: "edms_eplpav:OW-21-01552:PERMIT:2024-11-27",
      docType: "PERMIT",
      docDate: "2024-11-27",
      streetAddress: "38174 TRANQUIL",
    });
  });

  it("maps ABANDONMENT / NOTICE OF TRANSFER / PLAN REVIEW rows and decodes entities", () => {
    const rows = parseSearchResponse(eplOwr).rows;
    const [abandonment, transfer, minor] = rows.map((r) => rowToCandidate(EDMS_ARCHIVES.eplpav, r));
    expect(abandonment?.docType).toBe("ABANDONMENT");
    expect(abandonment?.description).toContain("<3000 Gal/Day | Abandon FAILING System & Install");
    expect(transfer?.docType).toBe("NOTICE OF TRANSFER");
    expect(transfer?.docDate).toBe("2024-06-12"); // no closed/issued date → application date
    expect(minor?.docType).toBe("PLAN REVIEW");
  });
});

describe("rowsToHits", () => {
  it("keeps the ephemeral document ID next to each candidate and drops unmappable rows", () => {
    const rows = parseSearchResponse(envParcel).rows;
    const hits = rowsToHits(EDMS_ARCHIVES.env, rows);
    expect(hits).toHaveLength(2);
    expect(hits[0].documentId).toBe(envParcel.Data[0].ID);
    expect(hits[1].candidate.permitNumber).toBe("OWR-22-04475");
    expect(rowsToHits(EDMS_ARCHIVES.env, [{ id: "x", name: "", columns: {} }])).toEqual([]);
  });
});
