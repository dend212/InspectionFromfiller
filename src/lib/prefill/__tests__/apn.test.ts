import { describe, expect, it } from "vitest";
import { formatApn } from "../apn";

describe("formatApn", () => {
  it("returns an already-dashed APN unchanged", () => {
    expect(formatApn("219-11-121")).toBe("219-11-121");
  });

  it("dashes an 8-digit compact APN", () => {
    expect(formatApn("21911121")).toBe("219-11-121");
  });

  it("keeps the trailing split letter and uppercases it", () => {
    expect(formatApn("218 49 003b")).toBe("218-49-003B");
    expect(formatApn("218-49-003B")).toBe("218-49-003B");
  });

  it("strips stray punctuation and whitespace", () => {
    expect(formatApn("  219.11.121- ")).toBe("219-11-121");
  });

  it("returns null for empty, undefined, too-short or non-APN input", () => {
    expect(formatApn("")).toBeNull();
    expect(formatApn(undefined)).toBeNull();
    expect(formatApn(null)).toBeNull();
    expect(formatApn("2191112")).toBeNull();
    expect(formatApn("abc")).toBeNull();
    expect(formatApn("219-11-121XY")).toBeNull();
  });
});
