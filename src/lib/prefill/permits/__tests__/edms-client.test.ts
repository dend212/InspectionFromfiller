// src/lib/prefill/permits/__tests__/edms-client.test.ts
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EDMS_ARCHIVES,
  EdmsError,
  documentUrl,
  fetchDocumentBytes,
  getDocumentInfo,
  parseSearchResponse,
  searchKeywords,
} from "../edms-client";
import docInfo from "./fixtures/document-info-000972.json";
import envParcel from "./fixtures/env-parcel-219-11-121.json";
import eplEmpty from "./fixtures/eplpav-empty.json";
import eplParcel from "./fixtures/eplpav-parcel-219-12-165.json";

const mockFetch = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseSearchResponse", () => {
  it("keys every column by its DisplayColumns heading", () => {
    const { rows, truncated } = parseSearchResponse(envParcel);
    expect(truncated).toBe(false);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(envParcel.Data[0].ID);
    expect(rows[0].name).toBe("EnvSeptic - 9/11/2015 - 000972 - PERMIT");
    expect(rows[0].columns).toEqual({
      EnvSepticDocType: "PERMIT",
      EnvPermitNumber: "000972",
      ParcelNumber: "219-11-121",
      EnvStreetNo: "8911",
      EnvStreetDir: "E",
      EnvStreet: "CAVE CREEK RD",
      EnvCity: "CAREFREE",
      EnvZip: "",
      EnvLotNumber: "",
      EnvSubdivision: "",
    });
  });

  it("handles the 22-column ePLPAV layout by heading", () => {
    const { rows } = parseSearchResponse(eplParcel);
    expect(rows[0].columns["Permit Number"]).toBe("OW-24-00070");
    expect(rows[0].columns["File Name"]).toBe("OW-24-00070 FINAL DA");
    expect(rows[0].columns["Closed Date"]).toBe("11/21/2025");
    expect(rows[0].columns["Address Line 2"]).toBe("Cottontail");
    expect(rows[0].columns["Parcel Number"]).toBe("219-12-165");
  });

  it("returns no rows when Data is empty and DisplayColumns is null", () => {
    expect(parseSearchResponse(eplEmpty)).toEqual({ rows: [], truncated: false });
  });

  it("throws a parse EdmsError on a non-object body", () => {
    expect(() => parseSearchResponse("<html>")).toThrowError(EdmsError);
    expect(() => parseSearchResponse({ Message: "An error has occurred." })).toThrowError(
      /unexpected/i,
    );
  });
});

describe("searchKeywords", () => {
  it("POSTs the OnBase KeywordSearch body with QueryID, keyword IDs and QueryLimit", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(envParcel));

    const result = await searchKeywords(EDMS_ARCHIVES.env, [{ id: 1264, value: "219-11-121" }]);

    expect(result.rows).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://edms.maricopa.gov/env/api/CustomQuery/KeywordSearch");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      Accept: "application/json",
    });
    expect(JSON.parse(init.body)).toEqual({
      QueryID: 229,
      Keywords: [{ ID: 1264, Value: "219-11-121", KeywordOperator: "=" }],
      FromDate: null,
      ToDate: null,
      QueryLimit: 50,
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses the eplpav base URL and QueryID 476", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(eplParcel));
    await searchKeywords(EDMS_ARCHIVES.eplpav, [{ id: 4647, value: "219-12-165" }]);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://edms.maricopa.gov/eplpav/api/CustomQuery/KeywordSearch");
    expect(JSON.parse(init.body).QueryID).toBe(476);
  });

  it("throws an http EdmsError on non-2xx without retrying", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ Message: "An error has occurred." }, 500));
    await expect(
      searchKeywords(EDMS_ARCHIVES.env, [{ id: 1264, value: "219-11-121" }]),
    ).rejects.toMatchObject({ kind: "http", status: 500 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("retries exactly once on a network error, then succeeds", async () => {
    mockFetch
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(jsonResponse(envParcel));
    const result = await searchKeywords(EDMS_ARCHIVES.env, [{ id: 1264, value: "219-11-121" }]);
    expect(result.rows).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("gives up after the single retry with a network EdmsError", async () => {
    mockFetch.mockRejectedValue(new TypeError("fetch failed"));
    await expect(
      searchKeywords(EDMS_ARCHIVES.env, [{ id: 1264, value: "219-11-121" }]),
    ).rejects.toMatchObject({ kind: "network" });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry when the caller's signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      searchKeywords(EDMS_ARCHIVES.env, [{ id: 1264, value: "219-11-121" }], controller.signal),
    ).rejects.toMatchObject({ kind: "network" });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("documentUrl", () => {
  it("encodes the ephemeral ID (non-ASCII bytes and '=') and keeps the trailing slash", () => {
    const id = envParcel.Data[0].ID;
    const url = documentUrl(EDMS_ARCHIVES.env, id);
    expect(url).toBe(`https://edms.maricopa.gov/env/api/Document/${encodeURIComponent(id)}/`);
    expect(url).toContain("%C3%81"); // Á
    expect(url.endsWith("%3D/")).toBe(true); // trailing '='
    expect(url).not.toContain("Á");
  });
});

describe("getDocumentInfo", () => {
  it("POSTs {} to the document URL and maps Size/ViewerMode/IsAboveDownloadThreshold", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(docInfo));
    const info = await getDocumentInfo(EDMS_ARCHIVES.env, envParcel.Data[0].ID);
    expect(info).toEqual({ size: 712751, viewerMode: "PDF", isAboveDownloadThreshold: false });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(documentUrl(EDMS_ARCHIVES.env, envParcel.Data[0].ID));
    expect(init.method).toBe("POST");
    expect(init.body).toBe("{}");
  });

  it("throws a parse EdmsError when Size is missing", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ViewerMode: "PDF" }));
    await expect(getDocumentInfo(EDMS_ARCHIVES.env, "abc")).rejects.toMatchObject({
      kind: "parse",
    });
  });
});

describe("fetchDocumentBytes", () => {
  it("GETs the document, returns the bytes and the Content-Disposition filename", async () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
    mockFetch.mockResolvedValueOnce(
      new Response(pdf, {
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "content-disposition":
            'inline; filename="EnvSeptic - 9/11/2015 - 000972 - PERMIT.pdf"',
        },
      }),
    );
    const doc = await fetchDocumentBytes(EDMS_ARCHIVES.env, envParcel.Data[0].ID);
    expect(Array.from(doc.bytes)).toEqual(Array.from(pdf));
    expect(doc.contentType).toBe("application/pdf");
    expect(doc.filename).toBe("EnvSeptic - 9/11/2015 - 000972 - PERMIT.pdf");
    const [, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe("GET");
  });

  it("rejects a non-PDF body with a parse EdmsError", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("<html>login</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    await expect(fetchDocumentBytes(EDMS_ARCHIVES.env, "abc")).rejects.toMatchObject({
      kind: "parse",
    });
  });
});
