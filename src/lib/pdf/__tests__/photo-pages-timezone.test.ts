import { describe, expect, it } from "vitest";
import { fmtDate, fmtHeaderDate } from "@/lib/pdf/photo-pages";

// Regression: server-rendered PDFs ran in UTC, so a photo uploaded at
// 7:54 PM Phoenix time (UTC-7, no DST) printed as "Oct 7, 2026, 2:54 AM".
// These assertions must hold regardless of the process TZ.
describe("photo page date formatting (America/Phoenix)", () => {
  it("formats the photo timestamp in Phoenix time, not UTC", () => {
    expect(fmtDate("2026-10-07T02:54:00Z")).toBe("Oct 6, 2026, 7:54 PM");
  });

  it("does not shift Phoenix time for summer dates (no DST)", () => {
    expect(fmtDate("2026-07-01T19:30:00Z")).toBe("Jul 1, 2026, 12:30 PM");
  });

  it("formats the page header date in Phoenix time", () => {
    expect(fmtHeaderDate("2026-10-07T02:54:00Z")).toBe("Oct 6, 2026");
  });
});
