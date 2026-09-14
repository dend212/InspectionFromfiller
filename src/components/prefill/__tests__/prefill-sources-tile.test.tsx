import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PrefillSourcesTile, stageSummary } from "@/components/prefill/prefill-sources-tile";
import type { InspectionRecordDTO, PrefillRunDTO } from "@/lib/prefill/types";

const RUN: PrefillRunDTO = {
  id: "run-1",
  inspectionId: "insp-1",
  trigger: "manual",
  status: "done",
  input: { apn: "219-11-121" },
  stages: {
    assessor: {
      status: "done",
      summary: "Parcel 219-11-121 · 8911 E CAVE CREEK RD",
      links: [{ label: "Assessor parcel page", url: "https://mcassessor.maricopa.gov/mcs/?q=219-11-121" }],
    },
    listing: { status: "skipped", summary: "Not available yet", links: [] },
    permits: {
      status: "not_found",
      summary: "No permit records found (searched APN 219-11-121 and 8911 CAVE CREEK — 0 matches)",
      links: [],
    },
  },
  proposals: [],
  candidates: [],
  error: null,
  appliedAt: null,
  createdAt: "2026-09-11T10:00:00.000Z",
  finishedAt: "2026-09-11T10:00:05.000Z",
  records: [],
};

const ABANDONMENT: InspectionRecordDTO = {
  id: "rec-1",
  source: "edms_env",
  permitNumber: "000972",
  docType: "ABANDONMENT",
  docDate: null,
  description: null,
  pageCount: null,
  sizeBytes: null,
  selected: true,
  extractionStatus: "pending",
  extractionError: null,
  isAbandonment: true,
  documentKind: null,
  downloadUrl: "/api/inspections/insp-1/records/rec-1",
};

function renderTile(over: Partial<React.ComponentProps<typeof PrefillSourcesTile>> = {}) {
  const props = {
    run: RUN,
    isRunning: false,
    canRun: true,
    error: null,
    onFindRecords: vi.fn(),
    ...over,
  };
  render(<PrefillSourcesTile {...props} />);
  return props;
}

describe("stageSummary", () => {
  it("prefers the stage summary, then the error, then a status default", () => {
    expect(stageSummary({ status: "done", summary: "2 permits found", links: [] })).toBe("2 permits found");
    expect(stageSummary({ status: "error", error: "Maricopa EDMS unavailable", links: [] })).toBe("Maricopa EDMS unavailable");
    expect(stageSummary({ status: "pending", links: [] })).toBe("Waiting…");
    expect(stageSummary({ status: "running", links: [] })).toBe("Searching…");
    expect(stageSummary({ status: "skipped", links: [] })).toBe("Not available yet");
  });
});

describe("PrefillSourcesTile", () => {
  it("shows intro copy and an enabled Find records button before any run", () => {
    renderTile({ run: null });
    expect(screen.getByText(/pull owner, address and permit details/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /find records/i })).toBeEnabled();
    expect(screen.queryByText(/last run/i)).toBeNull();
  });

  it("calls onFindRecords when the button is clicked", async () => {
    const user = userEvent.setup();
    const props = renderTile({ run: null });
    await user.click(screen.getByRole("button", { name: /find records/i }));
    expect(props.onFindRecords).toHaveBeenCalledTimes(1);
  });

  it("disables the button while running and when the caller cannot run", () => {
    renderTile({ isRunning: true });
    expect(screen.getByRole("button", { name: /searching/i })).toBeDisabled();
  });

  it("disables the button when canRun is false", () => {
    renderTile({ canRun: false });
    expect(screen.getByRole("button", { name: /find records/i })).toBeDisabled();
  });

  it("renders one row per stage with summary, status and external links", () => {
    renderTile();
    expect(screen.getByText(/Parcel 219-11-121 · 8911 E CAVE CREEK RD/)).toBeInTheDocument();
    expect(screen.getByText(/Not available yet/)).toBeInTheDocument();
    expect(screen.getByText(/No permit records found \(searched APN 219-11-121/)).toBeInTheDocument();

    const link = screen.getByRole("link", { name: "Assessor parcel page" });
    expect(link).toHaveAttribute("href", "https://mcassessor.maricopa.gov/mcs/?q=219-11-121");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");

    expect(document.querySelector("[data-stage=permits]")).toHaveAttribute("data-status", "not_found");
    expect(screen.getByText(/last run/i)).toBeInTheDocument();
  });

  it("never renders an unsafe stage link (javascript:, protocol-relative, newline-smuggled, http:)", () => {
    renderTile({
      run: {
        ...RUN,
        stages: {
          ...RUN.stages,
          permits: {
            status: "done",
            summary: "1 permit found",
            links: [
              { label: "Bad js", url: "javascript:alert(1)" },
              { label: "Bad relative", url: "//evil.com" },
              { label: "Bad newline", url: "java\nscript:alert(1)" },
              { label: "Bad http", url: "http://example.com" },
              { label: "Good", url: "/api/inspections/insp-1/records/rec-1" },
            ],
          },
        },
      },
    });
    const links = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(links).toEqual(["https://mcassessor.maricopa.gov/mcs/?q=219-11-121", "/api/inspections/insp-1/records/rec-1"]);
    for (const label of ["Bad js", "Bad relative", "Bad newline", "Bad http"]) {
      expect(screen.queryByRole("link", { name: label })).toBeNull();
    }
    expect(document.querySelector('a[href^="javascript:"]')).toBeNull();
  });

  it("renders the Last run time client-only so SSR (UTC) and the browser never disagree", () => {
    // Server pass: no locale-formatted time in the markup (that's what caused the hydration mismatch)
    let html = "";
    expect(() => {
      html = renderToString(
        <PrefillSourcesTile run={RUN} isRunning={false} canRun error={null} onFindRecords={() => {}} />,
      );
    }).not.toThrow();
    expect(html).toContain("Prefill sources");
    expect(html).not.toMatch(/last run/i);

    // Client pass: appears after mount
    renderTile();
    expect(screen.getByText(/last run/i)).toHaveTextContent(new Date(RUN.createdAt).toLocaleString());
  });

  it("shows the failed banner with the run error", () => {
    renderTile({ run: { ...RUN, status: "failed", error: "Timed out" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Prefill failed — Find records to retry (Timed out)");
  });

  it("shows the abandonment banner when a record is an ABANDONMENT document", () => {
    renderTile({ run: { ...RUN, records: [ABANDONMENT] } });
    expect(screen.getByRole("alert")).toHaveTextContent(/ABANDONMENT document was found/);
  });

  it("shows the hook-level error", () => {
    renderTile({ error: "Prefill limit reached (3 per hour)" });
    expect(screen.getByRole("alert")).toHaveTextContent("Prefill limit reached (3 per hour)");
  });

  it("collapses and expands the rows", async () => {
    const user = userEvent.setup();
    renderTile();
    await user.click(screen.getByRole("button", { name: /prefill sources/i }));
    expect(screen.queryByText(/Parcel 219-11-121/)).toBeNull();
    await user.click(screen.getByRole("button", { name: /prefill sources/i }));
    expect(screen.getByText(/Parcel 219-11-121/)).toBeInTheDocument();
  });
});
