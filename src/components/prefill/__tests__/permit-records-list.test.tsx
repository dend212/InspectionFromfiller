import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InspectionRecordDTO, PermitCandidate, PrefillRunDTO } from "@/lib/prefill/types";
import { emptyStages } from "@/lib/prefill/types";

const { mockToastSuccess, mockToastError } = vi.hoisted(() => ({
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: mockToastSuccess, error: mockToastError } }));

import {
  PermitRecordsList,
  formatBytes,
  formatDocDate,
  groupCandidates,
} from "../permit-records-list";

function record(over: Partial<InspectionRecordDTO> & { id: string }): InspectionRecordDTO {
  return {
    source: "edms_env",
    permitNumber: "OW-17-00474",
    docType: "PERMIT",
    docDate: "2018-02-08",
    description: null,
    pageCount: 21,
    sizeBytes: 1968056,
    selected: true,
    extractionStatus: "pending",
    extractionError: null,
    isAbandonment: false,
    downloadUrl: `/api/inspections/insp-1/records/${over.id}`,
    ...over,
  };
}

function candidate(
  over: Partial<PermitCandidate> & { permitNumber: string; docType: string },
): PermitCandidate {
  return {
    key: `edms_env:${over.permitNumber}:${over.docType}:${over.docDate ?? ""}`,
    archive: "edms_env",
    streetAddress: "8911 E PRINCESS DR",
    city: "MESA",
    zip: "85207",
    score: 7,
    ...over,
  };
}

function run(over: Partial<PrefillRunDTO> = {}): PrefillRunDTO {
  return {
    id: "run-1",
    inspectionId: "insp-1",
    trigger: "manual",
    status: "done",
    input: { apn: "219-11-121" },
    stages: {
      ...emptyStages(),
      permits: { status: "done", links: [], summary: "1 permit document found" },
    },
    proposals: [],
    candidates: [],
    error: null,
    appliedAt: null,
    createdAt: "2026-09-11T10:00:00Z",
    finishedAt: "2026-09-11T10:00:30Z",
    records: [],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("formatters", () => {
  it("formats ISO dates as M/D/YYYY without timezone drift and sizes in KB/MB", () => {
    expect(formatDocDate("2018-02-08")).toBe("2/8/2018");
    expect(formatDocDate(null)).toBe("");
    expect(formatBytes(147386)).toBe("144 KB");
    expect(formatBytes(1968056)).toBe("1.9 MB");
    expect(formatBytes(null)).toBe("");
  });
});

describe("PermitRecordsList — records", () => {
  it("renders one row per record with permit #, type, date, page count and a plain new-tab link", () => {
    render(
      <PermitRecordsList
        run={run({
          records: [
            record({ id: "rec-1" }),
            record({
              id: "rec-2",
              permitNumber: "OWR-22-04475",
              docType: "NOTICE OF TRANSFER",
              docDate: "2022-09-21",
              pageCount: 5,
              sizeBytes: 147386,
            }),
          ],
        })}
        onSelectCandidates={vi.fn()}
      />,
    );
    const rows = within(screen.getByRole("list", { name: /permit documents/i })).getAllByRole(
      "listitem",
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("OW-17-00474");
    expect(rows[0]).toHaveTextContent("PERMIT");
    expect(rows[0]).toHaveTextContent("2/8/2018");
    expect(rows[0]).toHaveTextContent("21 pages");
    expect(rows[0]).toHaveTextContent("1.9 MB");
    expect(rows[0]).toHaveTextContent("Queued for extraction");

    const link = within(rows[0]).getByRole("link", { name: /open pdf/i });
    expect(link).toHaveAttribute("href", "/api/inspections/insp-1/records/rec-1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(rows[1]).toHaveTextContent("144 KB");
  });

  it("shows the reason instead of a link for a document that was not stored", () => {
    render(
      <PermitRecordsList
        run={run({
          records: [
            record({
              id: "rec-3",
              downloadUrl: "",
              pageCount: null,
              sizeBytes: 26214401,
              extractionStatus: "skipped",
              extractionError: "Larger than 25 MB (25.0 MB) — open it on Maricopa EDMS",
            }),
            record({
              id: "rec-4",
              downloadUrl: "",
              pageCount: null,
              extractionStatus: "failed",
              extractionError: "Download failed: EDMS document download failed (500)",
            }),
          ],
        })}
        onSelectCandidates={vi.fn()}
      />,
    );
    expect(screen.queryByRole("link", { name: /open pdf/i })).toBeNull();
    expect(screen.getByText(/Larger than 25 MB/)).toBeInTheDocument();
    expect(screen.getByText(/Download failed: .* — re-run Find records/)).toBeInTheDocument();
  });

  it("tags abandonment rows (the tile's banner is phase 1's — no second alert here)", () => {
    render(
      <PermitRecordsList
        run={run({
          records: [
            record({
              id: "rec-5",
              permitNumber: "OWR-22-01512",
              docType: "ABANDONMENT",
              docDate: "2025-04-14",
              isAbandonment: true,
            }),
          ],
        })}
        onSelectCandidates={vi.fn()}
      />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    const row = screen.getByRole("listitem");
    expect(within(row).getByText("ABANDONMENT", { selector: "span.uppercase" })).toBeInTheDocument();
    expect(row).toHaveTextContent("4/14/2025");
  });

  it("renders no list and no picker for an empty done run", () => {
    render(<PermitRecordsList run={run()} onSelectCandidates={vi.fn()} />);
    expect(screen.queryByRole("list", { name: /permit documents/i })).toBeNull();
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });
});

describe("PermitRecordsList — candidate picker", () => {
  // Same property (8911 E PRINCESS): blank-compatible city/zip/apn/direction
  // must merge into ONE group per Amendment A9 — a legacy row with no
  // city/ZIP/APN and an eplpav row with no street direction still belong to
  // the same house, so they must not become separate picker options.
  const candidates = [
    candidate({
      permitNumber: "OWR-22-01478",
      docType: "NOTICE OF TRANSFER",
      docDate: "2022-03-28",
      apn: "218-06-099A",
    }),
    candidate({ permitNumber: "OWR-20-04198", docType: "NOTICE OF TRANSFER", docDate: "2020-10-27" }),
    candidate({
      permitNumber: "743691",
      docType: "PERMIT",
      docDate: "2015-09-11",
      streetAddress: "8911 E PRINCESS",
      city: undefined,
      zip: undefined,
      score: 3,
    }),
  ];

  // Three genuinely distinct properties (different house number + street) —
  // for exercising the multi-radio picker itself.
  const distinctCandidates = [
    candidate({
      permitNumber: "OWR-22-01478",
      docType: "NOTICE OF TRANSFER",
      docDate: "2022-03-28",
      apn: "218-06-099A",
    }),
    candidate({
      permitNumber: "OWR-20-04198",
      docType: "NOTICE OF TRANSFER",
      docDate: "2020-10-27",
      streetAddress: "1500 W CACTUS RD",
      city: "PHOENIX",
      zip: "85021",
      apn: "160-14-002",
    }),
    candidate({
      permitNumber: "743691",
      docType: "PERMIT",
      docDate: "2015-09-11",
      streetAddress: "302 N MAIN ST",
      city: "MESA",
      zip: "85201",
      apn: "138-05-041",
    }),
  ];

  it("groups candidates by property and lists their documents (A9: blank-compatible attrs merge)", () => {
    const groups = groupCandidates(candidates);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("8911 E PRINCESS DR, MESA 85207");
    expect(groups[0].detail).toContain("APN 218-06-099A");
    expect(groups[0].candidates.map((c) => c.permitNumber)).toEqual([
      "OWR-22-01478",
      "OWR-20-04198",
      "743691",
    ]);
  });

  it("renders a radio per property group and sends the chosen group's keys", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn().mockResolvedValue(undefined);
    render(
      <PermitRecordsList
        run={run({
          status: "awaiting_selection",
          candidates: distinctCandidates,
          stages: {
            ...emptyStages(),
            permits: { status: "pending", links: [], summary: "3 possible permits — pick the right one" },
          },
        })}
        onSelectCandidates={onSelect}
      />,
    );
    expect(screen.getByText("3 possible permits — pick the right one")).toBeInTheDocument();
    const radios = within(screen.getByRole("radiogroup")).getAllByRole("radio");
    expect(radios).toHaveLength(3);

    const useSelected = screen.getByRole("button", { name: /use selected/i });
    expect(useSelected).toBeDisabled();

    await user.click(radios[1]);
    expect(useSelected).toBeEnabled();
    await user.click(useSelected);
    expect(onSelect).toHaveBeenCalledWith([distinctCandidates[1].key]);
  });

  it("sends every key in the chosen group in extraction rank order (storeHits caps extraction, not the picker)", async () => {
    // Regression: a 4th-ranked doc (e.g. an ABANDONMENT or PLAN REVIEW) used to be sliced off
    // client-side, so it was never stored and never listed / summarised for the inspector.
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const big = [
      candidate({ permitNumber: "P1", docType: "PLAN REVIEW", docDate: "2024-01-01" }),
      candidate({ permitNumber: "P2", docType: "NOTICE OF TRANSFER", docDate: "2022-01-01" }),
      candidate({ permitNumber: "P3", docType: "PERMIT", docDate: "2015-01-01" }),
      candidate({ permitNumber: "P4", docType: "FINAL DA", docDate: "2025-01-01" }),
    ];
    render(
      <PermitRecordsList
        run={run({ status: "awaiting_selection", candidates: big })}
        onSelectCandidates={onSelect}
      />,
    );
    await user.click(screen.getByRole("radio"));
    await user.click(screen.getByRole("button", { name: /use selected/i }));
    expect(onSelect).toHaveBeenCalledWith([
      "edms_env:P4:FINAL DA:2025-01-01",
      "edms_env:P3:PERMIT:2015-01-01",
      "edms_env:P2:NOTICE OF TRANSFER:2022-01-01",
      "edms_env:P1:PLAN REVIEW:2024-01-01",
    ]);
  });

  it("disables the button when the list is disabled (run in flight / read-only)", () => {
    render(
      <PermitRecordsList
        run={run({ status: "awaiting_selection", candidates })}
        onSelectCandidates={vi.fn()}
        disabled
      />,
    );
    expect(screen.getByRole("button", { name: /use selected/i })).toBeDisabled();
  });

  it("does not show the picker once the run is no longer awaiting selection", () => {
    render(
      <PermitRecordsList run={run({ status: "done", candidates })} onSelectCandidates={vi.fn()} />,
    );
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });
});

describe("PermitRecordsList — copy APN", () => {
  it("copies the APN to the clipboard and toasts", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(
      <PermitRecordsList run={run({ input: { apn: "219-11-121" } })} onSelectCandidates={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: /copy apn 219-11-121/i }));
    expect(writeText).toHaveBeenCalledWith("219-11-121");
    expect(mockToastSuccess).toHaveBeenCalled();
  });

  it("hides the copy button when the run has no APN", () => {
    render(<PermitRecordsList run={run({ input: {} })} onSelectCandidates={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /copy apn/i })).toBeNull();
  });
});
