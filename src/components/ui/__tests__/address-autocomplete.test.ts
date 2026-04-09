import { describe, expect, it } from "vitest";
import { parseAddressComponents } from "@/components/ui/address-autocomplete";

type Comp = {
  longText: string | null;
  shortText: string | null;
  types: string[];
};

const comp = (
  longText: string,
  shortText: string,
  types: string[],
): Comp => ({ longText, shortText, types });

describe("parseAddressComponents", () => {
  it("parses a full US address into street/city/state/zip", () => {
    const components: Comp[] = [
      comp("1600", "1600", ["street_number"]),
      comp("Amphitheatre Parkway", "Amphitheatre Pkwy", ["route"]),
      comp("Mountain View", "Mountain View", ["locality", "political"]),
      comp("Santa Clara County", "Santa Clara County", [
        "administrative_area_level_2",
        "political",
      ]),
      comp("California", "CA", ["administrative_area_level_1", "political"]),
      comp("United States", "US", ["country", "political"]),
      comp("94043", "94043", ["postal_code"]),
    ];
    expect(parseAddressComponents(components)).toEqual({
      street: "1600 Amphitheatre Parkway",
      city: "Mountain View",
      state: "CA",
      zip: "94043",
    });
  });

  it("returns empty strings for missing fields (never undefined)", () => {
    expect(parseAddressComponents([])).toEqual({
      street: "",
      city: "",
      state: "",
      zip: "",
    });
  });

  it("handles addresses with only a route (no street number)", () => {
    const components: Comp[] = [
      comp("Main Street", "Main St", ["route"]),
      comp("Phoenix", "Phoenix", ["locality", "political"]),
      comp("Arizona", "AZ", ["administrative_area_level_1"]),
      comp("85001", "85001", ["postal_code"]),
    ];
    expect(parseAddressComponents(components)).toEqual({
      street: "Main Street",
      city: "Phoenix",
      state: "AZ",
      zip: "85001",
    });
  });

  it("falls back to sublocality_level_1 when locality is absent", () => {
    const components: Comp[] = [
      comp("742", "742", ["street_number"]),
      comp("Evergreen Terrace", "Evergreen Ter", ["route"]),
      comp("Queens", "Queens", ["sublocality_level_1", "political"]),
      comp("New York", "NY", ["administrative_area_level_1"]),
      comp("11101", "11101", ["postal_code"]),
    ];
    expect(parseAddressComponents(components).city).toBe("Queens");
  });

  it("falls back to postal_town when locality and sublocality are absent", () => {
    const components: Comp[] = [
      comp("10", "10", ["street_number"]),
      comp("Downing Street", "Downing St", ["route"]),
      comp("London", "London", ["postal_town"]),
      comp("England", "England", ["administrative_area_level_1"]),
      comp("SW1A 2AA", "SW1A 2AA", ["postal_code"]),
    ];
    expect(parseAddressComponents(components).city).toBe("London");
  });

  it("uses shortText for state (two-letter code)", () => {
    const components: Comp[] = [
      comp("Arizona", "AZ", ["administrative_area_level_1"]),
    ];
    expect(parseAddressComponents(components).state).toBe("AZ");
  });

  it("returns empty zip when postal_code is absent", () => {
    const components: Comp[] = [
      comp("123", "123", ["street_number"]),
      comp("Desert Rd", "Desert Rd", ["route"]),
    ];
    expect(parseAddressComponents(components).zip).toBe("");
  });

  it("trims street when street_number is missing", () => {
    const components: Comp[] = [
      comp("", "", ["street_number"]),
      comp("Ocean Ave", "Ocean Ave", ["route"]),
    ];
    expect(parseAddressComponents(components).street).toBe("Ocean Ave");
  });
});
