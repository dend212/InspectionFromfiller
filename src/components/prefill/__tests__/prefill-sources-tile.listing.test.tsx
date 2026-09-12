import { render, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PrefillRunDTO, PrefillStage } from "@/lib/prefill/types";
import { PrefillSourcesTile } from "../prefill-sources-tile";

const ZILLOW_URL = "https://www.zillow.com/homedetails/8911-E-Cave-Creek-Rd-Carefree-AZ-85377/7921650_zpid/";

function stage(partial: Partial<PrefillStage>): PrefillStage {
  return { status: "done", links: [], ...partial };
}

function makeRun(listing: PrefillStage): PrefillRunDTO {
  return {
    id: "run-1",
    inspectionId: "insp-1",
    trigger: "webhook",
    status: "done",
    input: { apn: "219-11-121" },
    stages: {
      assessor: stage({ summary: "Parcel 219-11-121" }),
      listing,
      permits: stage({ status: "not_found", summary: "No permit records found" }),
    },
    proposals: [],
    candidates: [],
    error: null,
    appliedAt: null,
    createdAt: "2026-09-11T18:00:00.000Z",
    finishedAt: "2026-09-11T18:00:20.000Z",
    records: [],
  };
}

/** The Listing row (`<li data-stage="listing">`) — phase 1's generic row markup. */
function renderListingRow(run: PrefillRunDTO) {
  const { container } = render(
    <PrefillSourcesTile run={run} isRunning={false} canRun onFindRecords={vi.fn()} onSelectCandidates={vi.fn()} error={null} />,
  );
  const row = container.querySelector('li[data-stage="listing"]');
  if (!(row instanceof HTMLElement)) throw new Error("Listing row not rendered");
  return within(row);
}

describe("PrefillSourcesTile — Listing row", () => {
  it("shows the listing summary and an Open on Zillow link that opens in a new tab", () => {
    const row = renderListingRow(
      makeRun(
        stage({
          summary: "Water: Private Well · 3 bed · Sewer: septic",
          links: [{ label: "Open on Zillow", url: ZILLOW_URL }],
        }),
      ),
    );
    expect(row.getByText(/Water: Private Well · 3 bed · Sewer: septic/)).toBeInTheDocument();
    const link = row.getByRole("link", { name: /open on zillow/i });
    expect(link).toHaveAttribute("href", ZILLOW_URL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("shows the not-found copy with the searched address and no link", () => {
    const row = renderListingRow(
      makeRun(stage({ status: "not_found", summary: "No Zillow listing found for 8911 E Cave Creek Rd, Carefree, AZ 85377" })),
    );
    expect(row.getByText(/No Zillow listing found for 8911 E Cave Creek Rd, Carefree, AZ 85377/)).toBeInTheDocument();
    expect(row.queryByRole("link")).not.toBeInTheDocument();
  });

  it("marks the row with the stage status and shows the error text when the lookup failed", () => {
    const { container } = render(
      <PrefillSourcesTile
        run={makeRun(stage({ status: "error", summary: "Zillow lookup failed", error: "Apify responded 402" }))}
        isRunning={false}
        canRun
        error={null}
        onFindRecords={vi.fn()}
        onSelectCandidates={vi.fn()}
      />,
    );
    const row = container.querySelector('li[data-stage="listing"]');
    expect(row).toHaveAttribute("data-status", "error");
    expect(row?.textContent).toMatch(/Zillow lookup failed|Apify responded 402/);
  });
});
