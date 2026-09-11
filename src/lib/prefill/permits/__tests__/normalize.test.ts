import { describe, expect, it } from "vitest";
import {
  candidateKey,
  decodeHtmlEntities,
  isSafeKeywordValue,
  normaliseLot,
  normalisePermitNumber,
  normaliseStreetDir,
  normalizeStreetName,
  normaliseSubdivision,
  parseUsDate,
  splitStreetAddress,
  zip5,
} from "../normalize";

describe("normalisePermitNumber", () => {
  it("strips punctuation and uppercases so OW-17-00474 ≡ OW1700474", () => {
    expect(normalisePermitNumber("OW-17-00474")).toBe("OW1700474");
    expect(normalisePermitNumber("ow1700474")).toBe("OW1700474");
    expect(normalisePermitNumber(" 000972 ")).toBe("000972");
  });
});

describe("normalizeStreetName (re-exported from phase-1 input.ts)", () => {
  it("uppercases and strips a trailing suffix", () => {
    expect(normalizeStreetName("Cave Creek Rd")).toBe("CAVE CREEK");
    expect(normalizeStreetName("CAVE CREEK ROAD")).toBe("CAVE CREEK");
    expect(normalizeStreetName("Princess Dr.")).toBe("PRINCESS");
    expect(normalizeStreetName("Sunland Avenue")).toBe("SUNLAND");
    expect(normalizeStreetName("Villa Chula")).toBe("VILLA CHULA");
    expect(normalizeStreetName("95th")).toBe("95TH");
  });

  it("strips a leading direction token if the caller left it in", () => {
    expect(normalizeStreetName("E Cave Creek Rd")).toBe("CAVE CREEK");
    expect(normalizeStreetName("W Villa Chula")).toBe("VILLA CHULA");
  });

  it("never strips the only token", () => {
    expect(normalizeStreetName("Way")).toBe("WAY");
    expect(normalizeStreetName("E")).toBe("E");
  });
});

describe("normaliseStreetDir", () => {
  it("maps spelled-out and abbreviated directions to N/S/E/W/NE/NW/SE/SW", () => {
    expect(normaliseStreetDir("e")).toBe("E");
    expect(normaliseStreetDir("West")).toBe("W");
    expect(normaliseStreetDir("NW")).toBe("NW");
    expect(normaliseStreetDir("")).toBe("");
    expect(normaliseStreetDir("Cave")).toBe("");
  });
});

describe("splitStreetAddress", () => {
  it("splits number / direction / street", () => {
    expect(splitStreetAddress("8911 E CAVE CREEK RD")).toEqual({
      number: "8911",
      dir: "E",
      street: "CAVE CREEK RD",
    });
    expect(splitStreetAddress("11425 Cottontail")).toEqual({
      number: "11425",
      dir: "",
      street: "COTTONTAIL",
    });
    expect(splitStreetAddress(undefined)).toEqual({ number: "", dir: "", street: "" });
  });
});

describe("normaliseSubdivision / normaliseLot / zip5", () => {
  it("treats SUNRISE 4 and SUNRISE UNIT 4 as the same subdivision", () => {
    expect(normaliseSubdivision("SUNRISE 4")).toBe(normaliseSubdivision("Sunrise Unit 4"));
  });
  it("drops leading zeros on lots and keeps letters", () => {
    expect(normaliseLot("002")).toBe("2");
    expect(normaliseLot("19A")).toBe("19A");
  });
  it("keeps only the 5-digit ZIP", () => {
    expect(zip5("85087-8650")).toBe("85087");
    expect(zip5(" 85383 ")).toBe("85383");
  });
});

describe("parseUsDate", () => {
  it("converts M/D/YYYY to ISO and passes ISO through", () => {
    expect(parseUsDate("9/11/2015")).toBe("2015-09-11");
    expect(parseUsDate("11/21/2025")).toBe("2025-11-21");
    expect(parseUsDate("2025-11-21")).toBe("2025-11-21");
  });
  it("returns undefined for blank or garbage", () => {
    expect(parseUsDate("")).toBeUndefined();
    expect(parseUsDate(undefined)).toBeUndefined();
    expect(parseUsDate("13/45/2025")).toBeUndefined();
    expect(parseUsDate("soon")).toBeUndefined();
  });
});

describe("decodeHtmlEntities", () => {
  it("decodes the entities EDMS emits and collapses CRLF runs", () => {
    expect(
      decodeHtmlEntities("&lt;3000 Gal/Day | Abandon &amp; Install\r\n\r\nmissing &#39;coc&#39;"),
    ).toBe("<3000 Gal/Day | Abandon & Install missing 'coc'");
  });
});

describe("candidateKey", () => {
  it("follows the shared-contract format archive:permit:docType:date", () => {
    expect(candidateKey("edms_env", "OW-17-00474", "PERMIT", "2018-02-08")).toBe(
      "edms_env:OW-17-00474:PERMIT:2018-02-08",
    );
    expect(candidateKey("edms_eplpav", "OW-24-00070", "FINAL DA", undefined)).toBe(
      "edms_eplpav:OW-24-00070:FINAL DA:",
    );
  });
});

describe("isSafeKeywordValue", () => {
  it("accepts printable ASCII up to 200 chars and rejects the rest", () => {
    expect(isSafeKeywordValue("8911")).toBe(true);
    expect(isSafeKeywordValue("CAVE CREEK*")).toBe(true);
    expect(isSafeKeywordValue("")).toBe(false);
    expect(isSafeKeywordValue("a".repeat(201))).toBe(false);
    expect(isSafeKeywordValue("café")).toBe(false);
    expect(isSafeKeywordValue("line\nbreak")).toBe(false);
  });
});
