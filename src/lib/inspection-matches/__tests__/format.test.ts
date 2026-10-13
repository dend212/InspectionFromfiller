import { describe, expect, it } from "vitest";
import {
  formatMatchWhen,
  headerNoun,
  inspectorLabel,
  matchDetailLine,
  reasonLabel,
} from "@/lib/inspection-matches/format";
import type { VisibleInspectionMatch } from "@/types/inspection-matches";

function match(over: Partial<VisibleInspectionMatch> = {}): VisibleInspectionMatch {
  return {
    inspectionId: "6f1c2a9e-0000-4000-8000-000000000001",
    href: "/review/6f1c2a9e-0000-4000-8000-000000000001",
    status: "completed",
    facilityAddress: "100 E Example Rd",
    facilityCity: "Cave Creek",
    inspectionDate: "2026-10-06",
    createdAt: "2026-10-06T19:12:00.000Z",
    inspectorName: "Sam Sample",
    isOwn: false,
    reasons: ["apn", "address"],
    ...over,
  };
}

describe("headerNoun / reasonLabel", () => {
  it("names both, APN only or address only", () => {
    expect(headerNoun(["apn", "address"])).toBe("address and APN");
    expect(headerNoun(["address", "apn", "address"])).toBe("address and APN");
    expect(headerNoun(["apn"])).toBe("APN");
    expect(headerNoun(["address"])).toBe("address");
    expect(reasonLabel(["apn", "address"])).toBe("Same APN and address");
    expect(reasonLabel(["apn"])).toBe("Same APN");
    expect(reasonLabel(["address"])).toBe("Same address");
  });
});

describe("formatMatchWhen", () => {
  it("uses the inspection date without shifting the day", () => {
    expect(formatMatchWhen(match())).toBe("Inspected Oct 6, 2026");
  });

  it("falls back to createdAt in America/Phoenix (a UTC-midnight timestamp is the previous Phoenix day)", () => {
    expect(formatMatchWhen(match({ inspectionDate: null, createdAt: "2026-10-02T00:00:00.000Z" }))).toBe(
      "Created Oct 1, 2026",
    );
  });

  it("is empty when neither date is usable", () => {
    expect(formatMatchWhen(match({ inspectionDate: null, createdAt: "not a date" }))).toBe("");
  });
});

describe("inspectorLabel / matchDetailLine", () => {
  it("you for own matches, the name otherwise, Unknown inspector without a profile", () => {
    expect(inspectorLabel(match({ isOwn: true }))).toBe("you");
    expect(inspectorLabel(match())).toBe("Sam Sample");
    expect(inspectorLabel(match({ inspectorName: null }))).toBe("Unknown inspector");
  });

  it("joins address, status label, date, inspector and reason", () => {
    expect(matchDetailLine(match())).toBe(
      "100 E Example Rd, Cave Creek · Completed · Inspected Oct 6, 2026 · Sam Sample · Same APN and address",
    );
    expect(matchDetailLine(match({ status: "submitted", reasons: ["address"], isOwn: true }))).toBe(
      "100 E Example Rd, Cave Creek · In Review · Inspected Oct 6, 2026 · you · Same address",
    );
    expect(matchDetailLine(match({ facilityAddress: "", facilityCity: "" }))).toMatch(/^No address · /);
  });
});
