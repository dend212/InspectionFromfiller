import { describe, expect, it } from "vitest";
import {
  apnMatchKey,
  buildMatchQuery,
  cityKey,
  matchQueryKey,
  zip5,
} from "@/lib/inspection-matches/normalize";

describe("apnMatchKey", () => {
  it("dashed, compact, spaced and lowercase-letter forms give the same key", () => {
    expect(apnMatchKey("123-45-678")).toBe("12345678");
    expect(apnMatchKey("12345678")).toBe("12345678");
    expect(apnMatchKey(" 123 45 678 ")).toBe("12345678");
    expect(apnMatchKey("123-45-678a")).toBe("12345678A");
    expect(apnMatchKey("123-45-678A")).toBe("12345678A");
  });

  it.each(["N/A", "TBD", "0", "00000000", "pending", "", "123456789012345678901", "123-45-678 & 123-45-679"])(
    "%j → null",
    (raw) => {
      expect(apnMatchKey(raw)).toBeNull();
    },
  );

  it("null / undefined → null", () => {
    expect(apnMatchKey(null)).toBeNull();
    expect(apnMatchKey(undefined)).toBeNull();
  });
});

describe("zip5 / cityKey", () => {
  it.each([["85331", "85331"], ["85331-1234", "85331"], ["853311234", "85331"], [" 85331 ", "85331"]])(
    "zip5(%j) → %j",
    (raw, expected) => {
      expect(zip5(raw)).toBe(expected);
    },
  );

  it.each(["8533", "ABCDE", "", "85331 AZ"])("zip5(%j) → null", (raw) => {
    expect(zip5(raw)).toBeNull();
  });

  it("cityKey collapses whitespace, lowercases, and drops empty or over-long values", () => {
    expect(cityKey("  Cave   Creek ")).toBe("cave creek");
    expect(cityKey("")).toBeNull();
    expect(cityKey("   ")).toBeNull();
    expect(cityKey("x".repeat(61))).toBeNull();
    expect(cityKey("x".repeat(60))).toBe("x".repeat(60));
  });
});

describe("buildMatchQuery", () => {
  it("null without a house-number address and without a usable APN (§5.5 #17)", () => {
    expect(buildMatchQuery({})).toBeNull();
    expect(buildMatchQuery({ facilityAddress: "Example Rd", taxParcelNumber: "" })).toBeNull();
    expect(buildMatchQuery({ facilityAddress: "", taxParcelNumber: "N/A", facilityZip: "85331" })).toBeNull();
  });

  it("APN only, address only, and both", () => {
    expect(buildMatchQuery({ taxParcelNumber: "123-45-678" })).toEqual({
      address: null,
      zip5: null,
      city: null,
      apnKey: "12345678",
    });
    expect(buildMatchQuery({ facilityAddress: "100 E Example Rd", facilityCity: "Cave Creek", facilityZip: "85331" })).toEqual({
      address: { number: "100", dir: "E", street: "EXAMPLE", suffix: "RD", unit: null },
      zip5: "85331",
      city: "cave creek",
      apnKey: null,
    });
  });

  it("an over-long APN or city is ignored for that field only", () => {
    const query = buildMatchQuery({
      facilityAddress: "100 E Example Rd",
      facilityCity: "c".repeat(61),
      taxParcelNumber: "123-45-678 see permit 9",
    });
    expect(query?.apnKey).toBeNull();
    expect(query?.city).toBeNull();
    expect(query?.address).not.toBeNull();
  });
});

describe("matchQueryKey", () => {
  it("is empty for null, equal for Rd/Road and for whitespace or case changes", () => {
    expect(matchQueryKey(null)).toBe("");
    const a = buildMatchQuery({ facilityAddress: "100 E Example Rd", facilityCity: "Cave Creek", facilityZip: "85331" });
    const b = buildMatchQuery({ facilityAddress: "100 e example road", facilityCity: " cave  creek", facilityZip: "85331-1234" });
    expect(matchQueryKey(a)).toBe(matchQueryKey(b));
  });

  it("is stable across property order and changes with any normalised part", () => {
    const base = buildMatchQuery({ facilityAddress: "100 E Example Rd", taxParcelNumber: "123-45-678" });
    if (!base) throw new Error("expected a query");
    const reordered = { apnKey: base.apnKey, city: base.city, zip5: base.zip5, address: base.address };
    expect(matchQueryKey(reordered)).toBe(matchQueryKey(base));
    expect(matchQueryKey({ ...base, apnKey: "12345679" })).not.toBe(matchQueryKey(base));
    expect(matchQueryKey(buildMatchQuery({ facilityAddress: "102 E Example Rd", taxParcelNumber: "123-45-678" }))).not.toBe(
      matchQueryKey(base),
    );
  });
});
