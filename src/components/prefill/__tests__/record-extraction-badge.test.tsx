import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RecordExtractionBadge, isRecordBeingRead } from "@/components/prefill/record-extraction-badge";

describe("RecordExtractionBadge", () => {
  it.each([
    ["pending", "Queued"],
    ["done", "Read"],
    ["skipped", "Not read"],
    ["failed", "Read failed"],
  ] as const)("renders %s as %s", (extractionStatus, label) => {
    render(<RecordExtractionBadge record={{ extractionStatus, extractionError: null }} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("shows 'Reading…' for the pending record currently being read", () => {
    render(<RecordExtractionBadge record={{ extractionStatus: "pending", extractionError: null }} reading />);
    expect(screen.getByText("Reading…")).toBeInTheDocument();
  });

  it("ignores `reading` once the record is no longer pending", () => {
    render(<RecordExtractionBadge record={{ extractionStatus: "done", extractionError: null }} reading />);
    expect(screen.getByText("Read")).toBeInTheDocument();
  });

  it("exposes the failure or skip reason as title and accessible label", () => {
    render(
      <RecordExtractionBadge
        record={{ extractionStatus: "failed", extractionError: "Claude API error: 500 boom" }}
      />,
    );
    const badge = screen.getByText("Read failed");
    expect(badge).toHaveAttribute("title", "Claude API error: 500 boom");
    expect(badge).toHaveAttribute("aria-label", "Read failed: Claude API error: 500 boom");
  });
});

describe("isRecordBeingRead", () => {
  const rec = { permitNumber: "OW-17-00474", extractionStatus: "pending" as const };
  it("is true only for a pending record named in a 'Reading …' summary", () => {
    expect(isRecordBeingRead(rec, "Reading OW-17-00474…")).toBe(true);
    expect(isRecordBeingRead(rec, "Reading 000972…")).toBe(false);
    expect(isRecordBeingRead(rec, "2 permits found")).toBe(false);
    expect(isRecordBeingRead(rec, undefined)).toBe(false);
    expect(isRecordBeingRead({ ...rec, extractionStatus: "done" }, "Reading OW-17-00474…")).toBe(false);
  });
});
