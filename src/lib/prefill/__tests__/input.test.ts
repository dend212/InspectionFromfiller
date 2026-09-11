import { describe, expect, it } from "vitest";
import {
  buildPrefillInput,
  formatFullAddress,
  isValidApn,
  normalizeStreetName,
  parseStreetAddress,
  prefillStartBodySchema,
} from "@/lib/prefill/input";

describe("isValidApn", () => {
  it("accepts dashed, spaced, plain-digit and letter-suffixed APNs", () => {
    for (const apn of ["219-11-121", "123 45 678", "12345678", "201-13-030Z"]) {
      expect(isValidApn(apn)).toBe(true);
    }
  });
  it("rejects empty, over-long, digit-less and special-character APNs", () => {
    for (const apn of ["", "123-45-678-90-123-456", "---", "ABC", "123@45#678", "1'; DROP"]) {
      expect(isValidApn(apn)).toBe(false);
    }
  });
});

describe("normalizeStreetName", () => {
  it("uppercases, drops a leading direction and a trailing suffix", () => {
    expect(normalizeStreetName("Cave Creek Rd")).toBe("CAVE CREEK");
    expect(normalizeStreetName("E. Cave Creek Road")).toBe("CAVE CREEK");
    expect(normalizeStreetName("North 7th Street")).toBe("7TH");
  });
  it("strips every character outside A–Z, 0–9 and space", () => {
    expect(normalizeStreetName("O'Neil Dr")).toBe("ONEIL");
    expect(normalizeStreetName("Main' OR 1=1 --")).toBe("MAIN OR 1 1");
  });
  it("keeps a one-word name that happens to be a suffix", () => {
    expect(normalizeStreetName("Way")).toBe("WAY");
  });
});

describe("parseStreetAddress", () => {
  it("splits number, direction and street name", () => {
    expect(parseStreetAddress("8911 E Cave Creek Rd")).toEqual({
      streetNumber: "8911",
      streetDir: "E",
      streetName: "Cave Creek Rd",
    });
  });
  it("handles no direction, unit markers and full-word directions", () => {
    expect(parseStreetAddress("123 Main St #4")).toEqual({
      streetNumber: "123",
      streetName: "Main St",
    });
    expect(parseStreetAddress("123 Main St Unit B")).toEqual({
      streetNumber: "123",
      streetName: "Main St",
    });
    expect(parseStreetAddress("10 North Central Ave")).toEqual({
      streetNumber: "10",
      streetDir: "N",
      streetName: "Central Ave",
    });
  });
  it("drops the city/zip tail the assessor appends after runs of spaces", () => {
    expect(parseStreetAddress("8911 E CAVE CREEK RD   CAREFREE  85377")).toEqual({
      streetNumber: "8911",
      streetDir: "E",
      streetName: "CAVE CREEK RD",
    });
  });
  it("returns null without a leading house number", () => {
    expect(parseStreetAddress("Main St")).toBeNull();
    expect(parseStreetAddress("")).toBeNull();
    expect(parseStreetAddress("123")).toBeNull();
  });
  it("strips non-ASCII characters", () => {
    expect(parseStreetAddress("123 Maïn St")).toEqual({ streetNumber: "123", streetName: "Ma n St" });
  });
});

describe("formatFullAddress", () => {
  it("builds the single-line listing address", () => {
    expect(
      formatFullAddress({
        streetNumber: "8911",
        streetDir: "E",
        streetName: "Cave Creek Rd",
        city: "Carefree",
        zip: "85377",
      }),
    ).toBe("8911 E Cave Creek Rd, Carefree, AZ 85377");
    expect(formatFullAddress({ streetNumber: "123", streetName: "Main St" })).toBe("123 Main St, AZ");
  });
});

describe("prefillStartBodySchema", () => {
  it("accepts an empty body and trims the APN", () => {
    expect(prefillStartBodySchema.safeParse({}).success).toBe(true);
    expect(prefillStartBodySchema.parse({ apn: " 219-11-121 " }).apn).toBe("219-11-121");
  });
  it("rejects non-digit street numbers, over-long names and unknown triggers", () => {
    expect(
      prefillStartBodySchema.safeParse({ address: { streetNumber: "12a", streetName: "Main" } })
        .success,
    ).toBe(false);
    expect(
      prefillStartBodySchema.safeParse({ address: { streetNumber: "12", streetName: "x".repeat(81) } })
        .success,
    ).toBe(false);
    expect(prefillStartBodySchema.safeParse({ trigger: "webhook" }).success).toBe(false);
    expect(prefillStartBodySchema.safeParse({ trigger: "apn_lookup" }).success).toBe(true);
  });
});

describe("buildPrefillInput", () => {
  const formData = {
    facilityInfo: {
      taxParcelNumber: "219-11-121",
      facilityAddress: "8911 E Cave Creek Rd",
      facilityCity: "Carefree",
      facilityZip: "85377",
    },
  };

  it("prefers the request body over the form data", () => {
    const input = buildPrefillInput(formData, {
      apn: "200-08-079",
      address: { streetNumber: "1", streetName: "Other St", full: "1 Other St" },
    });
    expect(input.apn).toBe("200-08-079");
    expect(input.address).toEqual({ streetNumber: "1", streetName: "Other St", full: "1 Other St" });
  });

  it("falls back to facilityInfo and derives the full address", () => {
    expect(buildPrefillInput(formData, {})).toEqual({
      apn: "219-11-121",
      address: {
        streetNumber: "8911",
        streetDir: "E",
        streetName: "Cave Creek Rd",
        city: "Carefree",
        zip: "85377",
        full: "8911 E Cave Creek Rd, Carefree, AZ 85377",
      },
    });
  });

  it("returns an empty input when nothing is available", () => {
    expect(buildPrefillInput(null, {})).toEqual({});
    expect(buildPrefillInput({ facilityInfo: { facilityAddress: "No number here" } }, {})).toEqual({});
  });
});
