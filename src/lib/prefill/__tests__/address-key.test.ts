import { describe, expect, it } from "vitest";
import {
  type AddressKey,
  addressKey,
  addressKeysCompatible,
  SUFFIX_CANONICAL,
  splitUnit,
} from "@/lib/prefill/address-key";
import { STREET_SUFFIXES } from "@/lib/prefill/input";

// Synthetic addresses only (duplicate-warning spec §12)
const key = (line: string) => addressKey(line);
const differ = (a: string, b: string) => {
  const ka = key(a);
  const kb = key(b);
  expect(ka).not.toBeNull();
  expect(kb).not.toBeNull();
  expect(addressKeysCompatible(ka as AddressKey, kb as AddressKey)).toBe(false);
};
const compatible = (a: string, b: string) => {
  expect(addressKeysCompatible(key(a) as AddressKey, key(b) as AddressKey)).toBe(true);
};

describe("splitUnit (moved from secondary.ts, unchanged)", () => {
  it("splits #, unit words followed by a unit token, and keeps Lot Rd as a street", () => {
    expect(splitUnit("100 E Example Rd #12")).toEqual({ street: "100 E Example Rd", unit: "12" });
    expect(splitUnit("100 E Example Rd Space 12")).toEqual({ street: "100 E Example Rd", unit: "12" });
    expect(splitUnit("100 E Example Rd #Space 12")).toEqual({ street: "100 E Example Rd", unit: "SPACE12" });
    expect(splitUnit("100 E Lot Rd")).toEqual({ street: "100 E Lot Rd", unit: "" });
  });
});

describe("addressKey", () => {
  it("returns null without a leading house number", () => {
    expect(key("Example Rd")).toBeNull();
    expect(key("")).toBeNull();
  });

  it("splits number, direction, street words and canonical suffix", () => {
    expect(key("100 E. Cave Creek Rd")).toEqual({ number: "100", dir: "E", street: "CAVE CREEK", suffix: "RD", unit: null });
    expect(key("100 East Example Road")).toEqual({ number: "100", dir: "E", street: "EXAMPLE", suffix: "RD", unit: null });
    expect(key("100 E South Mountain Ave")).toEqual({ number: "100", dir: "E", street: "SOUTH MOUNTAIN", suffix: "AVE", unit: null });
    expect(key("100 Broadway")).toEqual({ number: "100", dir: null, street: "BROADWAY", suffix: null, unit: null });
    expect(key("1234 N 7th")).toEqual({ number: "1234", dir: "N", street: "7TH", suffix: null, unit: null });
  });

  it("canonicalises units: #Space 12 / Space 12 / #12 → 12, #Lot 7 / Lot 7 → 7, Unit 4 → 4", () => {
    for (const line of ["100 E Example Rd #Space 12", "100 E Example Rd Space 12", "100 E Example Rd #12"]) {
      expect(key(line)?.unit).toBe("12");
    }
    expect(key("100 E Example Rd #Lot 7")?.unit).toBe("7");
    expect(key("100 E Example Rd Lot 7")?.unit).toBe("7");
    expect(key("100 E Example Rd Unit 4")?.unit).toBe("4");
    expect(key("100 E Lot Rd")).toEqual({ number: "100", dir: "E", street: "LOT", suffix: "RD", unit: null });
  });

  it("comma cut: city/state/ZIP segments are dropped, unit segments kept", () => {
    expect(key("100 E Example Rd, Cave Creek, AZ 85331")).toEqual(key("100 E Example Rd"));
    expect(key("100 E Example Rd, #12")?.unit).toBe("12");
    expect(key("100 E Example Rd, Unit 4")?.unit).toBe("4");
    expect(key("100 E Example Rd, #12, Cave Creek")).toEqual(key("100 E Example Rd #12"));
  });

  it("direction words inside the street name stay part of the name", () => {
    differ("100 W North Ln", "100 W South Ln");
    differ("100 N East St", "100 N West St");
    differ("100 N West Valley Rd", "100 N Valley Rd");
    differ("100 North Ln", "100 South Ln");
    expect(key("100 North Ln")).toEqual({ number: "100", dir: null, street: "NORTH", suffix: "LN", unit: null });
    expect(key("100 NE Way")).toEqual({ number: "100", dir: null, street: "NE", suffix: "WAY", unit: null });
  });

  it("SUFFIX_CANONICAL covers exactly STREET_SUFFIXES", () => {
    expect(Object.keys(SUFFIX_CANONICAL).sort()).toEqual([...STREET_SUFFIXES].sort());
  });
});

describe("addressKeysCompatible (§5.5 address rows, locality aside)", () => {
  it("matches abbreviation and punctuation variants", () => {
    compatible("100 E Example Rd", "100 E. Example Road"); // #6
    compatible("100 Example Rd", "100 E Example Rd"); // #8 direction missing on one side
    compatible("1234 N 7th", "1234 N 7th Ave"); // #10 suffix missing on one side
    compatible("100 E Example Rd Space 12", "100 E Example Rd"); // #12 unit missing on one side
    compatible("100 E Example Rd #Space 12", "100 E Example Rd Space 12"); // #12a
    compatible("100 E Example Rd #Lot 7", "100 E Example Rd Lot 7"); // #12b
    compatible("100 E Example Rd, Cave Creek, AZ 85331", "100 E Example Rd"); // #12c
  });

  it("rejects a different direction, suffix, unit, number or street", () => {
    differ("100 E Example Rd", "100 W Example Rd"); // #7
    differ("1234 N 7th St", "1234 N 7th Ave"); // #9
    differ("100 E Example Rd #12", "100 E Example Rd #14"); // #11
    differ("100 E Example Rd, #12", "100 E Example Rd #14"); // #12d
    differ("100 E Example Rd", "102 E Example Rd");
    differ("100 E Example Rd", "100 E Sample Rd");
  });

  it("truth table: equal / missing / different for dir, suffix and unit", () => {
    const base: AddressKey = { number: "100", dir: "E", street: "EXAMPLE", suffix: "RD", unit: "12" };
    for (const part of ["dir", "suffix", "unit"] as const) {
      expect(addressKeysCompatible(base, { ...base })).toBe(true);
      expect(addressKeysCompatible(base, { ...base, [part]: null })).toBe(true);
      expect(addressKeysCompatible({ ...base, [part]: null }, base)).toBe(true);
      expect(addressKeysCompatible(base, { ...base, [part]: "ZZ" })).toBe(false);
    }
  });
});
