import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AssessorUnavailableError,
  cleanPhysicalAddress,
  findParcelByAddress,
  mapParcelToAssessor,
  queryParcelByApn,
  runAssessorStage,
} from "@/lib/prefill/assessor";
import type { StageContext } from "@/lib/prefill/stage";

const FEATURE = {
  OWNER_NAME: "JOHN DOE",
  PHYSICAL_ADDRESS: "8911 E CAVE CREEK RD   CAREFREE  85377",
  PHYSICAL_CITY: "CAREFREE",
  PHYSICAL_ZIP: "85377",
  JURISDICTION: "CAREFREE",
  APN_DASH: "219-11-121",
  LAND_SIZE: 43560,
  CONST_YEAR: 1998,
  SUBNAME: "CAVE CREEK ESTATES",
  LOT_NUM: "4",
  BLOCK: "",
  STR: "",
};

const mockFetch = vi.fn();

function arcgis(features: Array<Record<string, unknown>>) {
  return { ok: true, json: () => Promise.resolve({ features: features.map((attributes) => ({ attributes })) }) };
}

function whereOf(call: unknown[]): string | null {
  return new URL(String(call[0])).searchParams.get("where");
}

function makeCtx(over: Partial<StageContext> = {}): StageContext {
  return {
    inspectionId: "insp-1",
    runId: "run-1",
    signal: new AbortController().signal,
    progress: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockResolvedValue(arcgis([FEATURE]));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("queryParcelByApn", () => {
  it("queries APN_DASH and returns the first feature", async () => {
    const feature = await queryParcelByApn("219-11-121");
    expect(feature?.APN_DASH).toBe("219-11-121");
    expect(whereOf(mockFetch.mock.calls[0])).toBe("APN_DASH='219-11-121'");
    expect(String(mockFetch.mock.calls[0][0])).toContain("gis.mcassessor.maricopa.gov");
  });

  it("requests the property use code (PUC) alongside the situs/owner fields", async () => {
    await queryParcelByApn("219-11-121");
    const outFields = new URL(String(mockFetch.mock.calls[0][0])).searchParams.get("outFields") ?? "";
    expect(outFields.split(",")).toContain("PUC");
    expect(outFields.split(",")).toContain("APN_DASH");
  });

  it("returns null when there are no features", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });
    expect(await queryParcelByApn("999-99-999")).toBeNull();
  });

  it("throws AssessorUnavailableError on a non-2xx response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });
    await expect(queryParcelByApn("219-11-121")).rejects.toBeInstanceOf(AssessorUnavailableError);
  });

  it("refuses an invalid APN before calling the service", async () => {
    await expect(queryParcelByApn("1'; DROP TABLE")).rejects.toThrow("Invalid APN format");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("findParcelByAddress", () => {
  it("queries the normalised street number and name with a LIKE prefix", async () => {
    await findParcelByAddress("8911", "E Cave Creek Rd");
    expect(whereOf(mockFetch.mock.calls[0])).toBe(
      "PHYSICAL_STREET_NUM='8911' AND PHYSICAL_STREET_NAME LIKE 'CAVE CREEK%'",
    );
  });

  it("strips quotes from the street name", async () => {
    await findParcelByAddress("12", "O'Neil Dr");
    expect(whereOf(mockFetch.mock.calls[0])).toContain("LIKE 'ONEIL%'");
  });

  it("returns null without calling the service for a bad number or empty name", async () => {
    expect(await findParcelByAddress("12a", "Main St")).toBeNull();
    expect(await findParcelByAddress("12", "'--")).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("cleanPhysicalAddress / mapParcelToAssessor", () => {
  it("cuts the city/zip tail the layer appends after runs of spaces", () => {
    expect(cleanPhysicalAddress("8911 E CAVE CREEK RD   CAREFREE  85377")).toBe("8911 E CAVE CREEK RD");
    expect(cleanPhysicalAddress("123 Main St")).toBe("123 Main St");
    expect(cleanPhysicalAddress(null)).toBe("");
  });

  it("maps the feature to the assessor summary", () => {
    expect(mapParcelToAssessor(FEATURE)).toEqual({
      ownerName: "JOHN DOE",
      physicalAddress: "8911 E CAVE CREEK RD",
      city: "CAREFREE",
      zip: "85377",
      county: "Maricopa",
      apnFormatted: "219-11-121",
      legalDescription: "CAVE CREEK ESTATES, Lot 4",
      lotSize: "43560",
      yearBuilt: "1998",
    });
  });

  it("carries the property use code through as propertyUseCode, trimmed", () => {
    expect(mapParcelToAssessor({ ...FEATURE, PUC: "0141" }).propertyUseCode).toBe("0141");
    expect(mapParcelToAssessor({ ...FEATURE, PUC: " 1511 " }).propertyUseCode).toBe("1511");
  });

  it("leaves propertyUseCode undefined when the layer has no PUC", () => {
    expect(mapParcelToAssessor(FEATURE).propertyUseCode).toBeUndefined();
    expect(mapParcelToAssessor({ ...FEATURE, PUC: null }).propertyUseCode).toBeUndefined();
    expect(mapParcelToAssessor({ ...FEATURE, PUC: "" }).propertyUseCode).toBeUndefined();
    expect(mapParcelToAssessor({ ...FEATURE, PUC: "   " }).propertyUseCode).toBeUndefined();
  });
});

describe("runAssessorStage", () => {
  it("reports running, then done with proposals and the parcel link", async () => {
    const ctx = makeCtx();
    const result = await runAssessorStage({ apn: "219-11-121" }, ctx);
    expect(ctx.progress).toHaveBeenCalledWith(expect.objectContaining({ status: "running" }));
    expect(result.stage.status).toBe("done");
    expect(result.stage.summary).toBe("Parcel 219-11-121 · 8911 E CAVE CREEK RD");
    expect(result.stage.links).toEqual([
      { label: "Assessor parcel page", url: "https://mcassessor.maricopa.gov/mcs/?q=219-11-121" },
    ]);
    expect(result.proposals.map((p) => p.fieldPath)).toContain("facilityInfo.taxParcelNumber");
    expect(result.stage.startedAt).toBeTruthy();
    expect(result.stage.finishedAt).toBeTruthy();
  });

  it("proposes wastewater source and facility type when the parcel carries a PUC", async () => {
    mockFetch.mockResolvedValue(arcgis([{ ...FEATURE, PUC: "0141" }]));
    const result = await runAssessorStage({ apn: "219-11-121" }, makeCtx());
    expect(result.stage.status).toBe("done");
    const byPath = Object.fromEntries(result.proposals.map((p) => [p.fieldPath, p]));
    expect(byPath["facilityInfo.wastewaterSource"]?.value).toBe("residential");
    expect(byPath["facilityInfo.facilityType"]?.value).toBe("single_family");
    expect(byPath["facilityInfo.facilityType"]?.provenance.evidence).toBe("PUC: 0141");
  });

  it("appends the property-use note to the stage summary for a code that needs a closer look", async () => {
    mockFetch.mockResolvedValue(arcgis([{ ...FEATURE, PUC: "0197" }]));
    const result = await runAssessorStage({ apn: "219-11-121" }, makeCtx());
    expect(result.stage.summary).toBe(
      "Parcel 219-11-121 · 8911 E CAVE CREEK RD · PUC 019x — no dwelling coded on this parcel; confirm the structure served",
    );
    // 019x codes no dwelling: nothing is proposed for the two property-use fields
    const paths = result.proposals.map((p) => p.fieldPath);
    expect(paths).not.toContain("facilityInfo.wastewaterSource");
    expect(paths).not.toContain("facilityInfo.facilityType");
  });

  it("keeps the plain summary for a code with no note", async () => {
    mockFetch.mockResolvedValue(arcgis([{ ...FEATURE, PUC: "0141" }]));
    const result = await runAssessorStage({ apn: "219-11-121" }, makeCtx());
    expect(result.stage.summary).toBe("Parcel 219-11-121 · 8911 E CAVE CREEK RD");
  });

  it("falls back to the address when the APN finds nothing", async () => {
    mockFetch.mockResolvedValueOnce(arcgis([])).mockResolvedValueOnce(arcgis([FEATURE]));
    const result = await runAssessorStage(
      { apn: "999-99-999", address: { streetNumber: "8911", streetName: "Cave Creek Rd" } },
      makeCtx(),
    );
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(whereOf(mockFetch.mock.calls[1])).toContain("PHYSICAL_STREET_NUM='8911'");
    expect(result.stage.status).toBe("done");
    expect(result.proposals.find((p) => p.fieldPath === "facilityInfo.taxParcelNumber")?.value).toBe(
      "219-11-121",
    );
  });

  it("returns not_found naming what was searched", async () => {
    mockFetch.mockResolvedValue(arcgis([]));
    const result = await runAssessorStage(
      { apn: "999-99-999", address: { streetNumber: "1", streetName: "Nowhere Ln" } },
      makeCtx(),
    );
    expect(result.stage.status).toBe("not_found");
    expect(result.stage.summary).toBe("No parcel found (searched APN 999-99-999 and 1 Nowhere Ln)");
    expect(result.proposals).toEqual([]);
    expect(result.resolved).toBeUndefined();
  });

  it("exposes the resolved parcel (dashed APN, parsed situs address, subdivision, lot) for the orchestrator", async () => {
    const result = await runAssessorStage({ apn: "219-11-121" }, makeCtx());
    expect(result.resolved).toEqual({
      apn: "219-11-121",
      address: {
        streetNumber: "8911",
        streetDir: "E",
        streetName: "CAVE CREEK RD",
        city: "CAREFREE",
        zip: "85377",
        full: "8911 E CAVE CREEK RD, CAREFREE, AZ 85377",
      },
      subdivision: "CAVE CREEK ESTATES",
      lot: "4",
    });
  });

  it("omits the resolved address when the parcel has no parseable situs address", async () => {
    mockFetch.mockResolvedValue(
      arcgis([{ ...FEATURE, PHYSICAL_ADDRESS: "", PHYSICAL_CITY: "", PHYSICAL_ZIP: "", SUBNAME: "", LOT_NUM: "" }]),
    );
    const result = await runAssessorStage({ apn: "219-11-121" }, makeCtx());
    expect(result.stage.status).toBe("done");
    expect(result.resolved).toEqual({ apn: "219-11-121" });
  });

  it("returns an error stage (never throws) when the service is down", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 502 });
    const result = await runAssessorStage({ apn: "219-11-121" }, makeCtx());
    expect(result.stage.status).toBe("error");
    expect(result.stage.error).toBe("Assessor service unavailable — try Find records later");
  });

  it("reports a timeout when the fetch is aborted", async () => {
    mockFetch.mockRejectedValue(new DOMException("aborted", "AbortError"));
    const result = await runAssessorStage({ apn: "219-11-121" }, makeCtx());
    expect(result.stage.status).toBe("error");
    expect(result.stage.error).toBe("Assessor lookup timed out");
  });
});
