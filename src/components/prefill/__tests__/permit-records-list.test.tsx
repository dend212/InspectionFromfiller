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
    documentKind: null,
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
    expect(rows[0]).toHaveTextContent("Queued");

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

  it("notes a Notice of Transfer row as a transfer record, but not a permit row", () => {
    render(
      <PermitRecordsList
        run={run({
          records: [
            record({ id: "rec-6" }),
            record({
              id: "rec-7",
              permitNumber: "OWR-23-02001",
              docType: "NOTICE OF TRANSFER",
              docDate: "2023-06-07",
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

    expect(rows[0]).not.toHaveTextContent("transfer record — used only for facts no permit states");
    expect(within(rows[0]).getByText("Queued")).toBeInTheDocument();
    expect(within(rows[0]).getByRole("link", { name: /open pdf/i })).toHaveAttribute(
      "href",
      "/api/inspections/insp-1/records/rec-6",
    );

    expect(rows[1]).toHaveTextContent("transfer record — used only for facts no permit states");
    expect(within(rows[1]).getByText("Queued")).toBeInTheDocument();
    expect(within(rows[1]).getByRole("link", { name: /open pdf/i })).toHaveAttribute(
      "href",
      "/api/inspections/insp-1/records/rec-7",
    );
  });

  it("labels each row with the kind the model read and marks the first permit-class row as the primary source", () => {
    // Already in precedence order (run-dto sorts): DA → ATC → NOT → abandonment
    render(
      <PermitRecordsList
        run={run({
          records: [
            record({
              id: "da",
              permitNumber: "OW-15-00667",
              docType: "PERMIT",
              docDate: "2016-01-25",
              extractionStatus: "done",
              documentKind: "discharge_authorization",
            }),
            record({
              id: "atc",
              permitNumber: "740805",
              docType: "PERMIT",
              docDate: "2015-09-11",
              extractionStatus: "done",
              documentKind: "approval_to_construct",
            }),
            record({
              id: "not",
              permitNumber: "OWR-22-01478",
              docType: "NOTICE OF TRANSFER",
              docDate: "2022-03-28",
              extractionStatus: "done",
              documentKind: "notice_of_transfer",
            }),
            record({
              id: "aband",
              permitNumber: "OWR-15-00520",
              docType: "ABANDONMENT",
              docDate: "2015-11-02",
              extractionStatus: "done",
              documentKind: "abandonment",
              isAbandonment: true,
            }),
          ],
        })}
        onSelectCandidates={vi.fn()}
      />,
    );
    const rows = within(screen.getByRole("list", { name: /permit documents/i })).getAllByRole(
      "listitem",
    );
    expect(rows).toHaveLength(4);

    expect(rows[0]).toHaveTextContent("OW-15-00667");
    expect(rows[0]).toHaveTextContent("PERMIT");
    expect(rows[0]).toHaveTextContent("Discharge Authorization");
    expect(rows[0]).toHaveTextContent("Primary source");

    expect(rows[1]).toHaveTextContent("Approval to Construct");
    expect(rows[1]).not.toHaveTextContent("Primary source");

    // the transfer note already says what the row is — the kind label is not repeated
    expect(rows[2]).toHaveTextContent("NOTICE OF TRANSFER");
    expect(rows[2]).not.toHaveTextContent("Notice of Transfer");
    expect(rows[2]).toHaveTextContent("transfer record — used only for facts no permit states");
    expect(rows[2]).not.toHaveTextContent("Primary source");

    // likewise the ABANDONMENT badge
    expect(within(rows[3]).getByText("ABANDONMENT", { selector: "span.uppercase" })).toBeInTheDocument();
    expect(rows[3]).not.toHaveTextContent("Abandonment");
    expect(rows[3]).not.toHaveTextContent("Primary source");

    expect(screen.getAllByText("Primary source")).toHaveLength(1);
  });

  it("shows the model's kind only where it adds information: a PERMIT row always, otherwise only a verdict that changed the class", () => {
    render(
      <PermitRecordsList
        run={run({
          records: [
            // legacy "PERMIT" covers ATCs and DAs alike, so both verdicts are named
            record({ id: "permit-atc", permitNumber: "740805", docType: "PERMIT", extractionStatus: "done", documentKind: "approval_to_construct" }),
            record({ id: "permit-da", permitNumber: "OW-15-00667", docType: "PERMIT", extractionStatus: "done", documentKind: "discharge_authorization" }),
            // a FINAL DA read as a DA says nothing new; read as an ATC it does
            record({ id: "da-da", permitNumber: "OW-24-00001", docType: "FINAL DA", extractionStatus: "done", documentKind: "final_da" }),
            record({ id: "da-atc", permitNumber: "OW-24-00002", docType: "FINAL DA", extractionStatus: "done", documentKind: "approval_to_construct" }),
            // a NOT verdict is spelled out by the transfer note, whatever the EDMS type
            record({ id: "not-not", permitNumber: "OWR-22-01478", docType: "NOTICE OF TRANSFER", extractionStatus: "done", documentKind: "notice_of_transfer" }),
            record({ id: "permit-not", permitNumber: "OWR-23-02001", docType: "PERMIT", extractionStatus: "done", documentKind: "notice_of_transfer" }),
            // the ABANDONMENT badge prints the EDMS type: redundant on an ABANDONMENT row, news on a PERMIT row
            record({ id: "aband-aband", permitNumber: "OWR-15-00520", docType: "ABANDONMENT", extractionStatus: "done", documentKind: "abandonment", isAbandonment: true }),
            record({ id: "permit-aband", permitNumber: "OWR-15-00521", docType: "PERMIT", extractionStatus: "done", documentKind: "abandonment", isAbandonment: true }),
          ],
        })}
        onSelectCandidates={vi.fn()}
      />,
    );
    const rows = within(screen.getByRole("list", { name: /permit documents/i })).getAllByRole("listitem");
    expect(rows).toHaveLength(8);

    expect(rows[0]).toHaveTextContent("Approval to Construct");
    expect(rows[1]).toHaveTextContent("Discharge Authorization");

    expect(rows[2]).toHaveTextContent("FINAL DA");
    expect(rows[2]).not.toHaveTextContent("Discharge Authorization");
    expect(rows[3]).toHaveTextContent("Approval to Construct");

    expect(within(rows[4]).getAllByText(/notice of transfer/i)).toHaveLength(1);
    expect(rows[4]).not.toHaveTextContent("Notice of Transfer");
    expect(rows[4]).toHaveTextContent("transfer record — used only for facts no permit states");
    expect(rows[5]).not.toHaveTextContent("Notice of Transfer");
    expect(rows[5]).toHaveTextContent("transfer record — used only for facts no permit states");

    expect(within(rows[6]).getAllByText(/abandonment/i)).toHaveLength(1);
    expect(within(rows[6]).getByText("ABANDONMENT", { selector: "span.uppercase" })).toBeInTheDocument();
    expect(rows[6]).not.toHaveTextContent("Abandonment");
    expect(within(rows[7]).getByText("PERMIT", { selector: "span.uppercase" })).toBeInTheDocument();
    expect(rows[7]).toHaveTextContent("Abandonment");
  });

  it("skips transfers, abandonments and unread rows for the primary marker and shows no kind label for an unread or 'other' row", () => {
    render(
      <PermitRecordsList
        run={run({
          records: [
            record({
              id: "not",
              permitNumber: "OWR-23-02001",
              docType: "NOTICE OF TRANSFER",
              docDate: "2023-06-07",
              extractionStatus: "done",
              documentKind: "notice_of_transfer",
            }),
            record({
              id: "aband",
              permitNumber: "OWR-22-01512",
              docType: "ABANDONMENT",
              docDate: "2025-04-14",
              isAbandonment: true,
            }),
            record({ id: "unread", permitNumber: "OW-17-00474", docType: "PERMIT" }),
            record({
              id: "other",
              permitNumber: "743691",
              docType: "PERMIT SUB",
              extractionStatus: "done",
              documentKind: "other",
            }),
          ],
        })}
        onSelectCandidates={vi.fn()}
      />,
    );
    const rows = within(screen.getByRole("list", { name: /permit documents/i })).getAllByRole(
      "listitem",
    );
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent("transfer record — used only for facts no permit states");
    expect(rows[0]).not.toHaveTextContent("Primary source");
    expect(rows[1]).not.toHaveTextContent("Primary source");

    // The unread PERMIT row contributed no facts, so it cannot be the source of any fill
    expect(within(rows[2]).getByText("Queued")).toBeInTheDocument();
    expect(rows[2]).not.toHaveTextContent("Primary source");
    expect(rows[2]).not.toHaveTextContent("Approval to Construct");
    expect(rows[2]).not.toHaveTextContent("Discharge Authorization");

    // `other` = the model could not tell — only the EDMS type is shown; it is the only
    // permit-class row that was read, so its facts are the ones that filled the form
    expect(rows[3]).toHaveTextContent("PERMIT SUB");
    expect(rows[3]).not.toHaveTextContent(/other/i);
    expect(rows[3]).toHaveTextContent("Primary source");
    expect(screen.getAllByText("Primary source")).toHaveLength(1);
  });

  it("moves the primary marker past a FINAL DA that was not read to the ATC whose facts filled the form", () => {
    // run-dto sorts by class first, so a skipped (over 25 MB) or failed DA still sits on top —
    // but only the `done` ATC's facts reached dedupeProposals
    const cases: Array<Partial<InspectionRecordDTO>> = [
      {
        extractionStatus: "skipped",
        extractionError: "Larger than 25 MB (25.0 MB) — open it on Maricopa EDMS",
        downloadUrl: "",
      },
      { extractionStatus: "failed", extractionError: "Claude timed out" },
    ];
    for (const da of cases) {
      const { unmount } = render(
        <PermitRecordsList
          run={run({
            records: [
              record({
                id: "da",
                permitNumber: "OW-24-00001",
                docType: "FINAL DA",
                docDate: "2024-05-01",
                ...da,
              }),
              record({
                id: "atc",
                permitNumber: "740805",
                docType: "PERMIT",
                docDate: "2015-09-11",
                extractionStatus: "done",
                documentKind: "approval_to_construct",
              }),
            ],
          })}
          onSelectCandidates={vi.fn()}
        />,
      );
      const rows = within(screen.getByRole("list", { name: /permit documents/i })).getAllByRole(
        "listitem",
      );
      expect(rows[0]).toHaveTextContent("OW-24-00001");
      expect(rows[0]).not.toHaveTextContent("Primary source");
      expect(rows[1]).toHaveTextContent("Approval to Construct");
      expect(rows[1]).toHaveTextContent("Primary source");
      expect(screen.getAllByText("Primary source")).toHaveLength(1);
      unmount();
    }
  });

  it("marks no primary source when no permit-class row was read (NOT + PLAN REVIEW, or a run still queued)", () => {
    const { unmount } = render(
      <PermitRecordsList
        run={run({
          records: [
            record({
              id: "pr",
              permitNumber: "743691",
              docType: "PLAN REVIEW",
              docDate: "2015-09-11",
              extractionStatus: "skipped",
              extractionError: "PLAN REVIEW documents are not read",
            }),
            record({
              id: "not",
              permitNumber: "OWR-23-02001",
              docType: "NOTICE OF TRANSFER",
              docDate: "2023-06-07",
              extractionStatus: "done",
              documentKind: "notice_of_transfer",
            }),
          ],
        })}
        onSelectCandidates={vi.fn()}
      />,
    );
    expect(screen.queryByText("Primary source")).toBeNull();
    unmount();

    render(
      <PermitRecordsList
        run={run({
          status: "running",
          stages: { ...emptyStages(), permits: { status: "running", links: [], summary: "Reading OW-17-00474…" } },
          records: [record({ id: "queued", permitNumber: "OW-17-00474", docType: "PERMIT" })],
        })}
        onSelectCandidates={vi.fn()}
      />,
    );
    expect(screen.getByText("Reading…")).toBeInTheDocument();
    expect(screen.queryByText("Primary source")).toBeNull();
  });

  it("renders no list and no picker for an empty done run", () => {
    render(<PermitRecordsList run={run()} onSelectCandidates={vi.fn()} />);
    expect(screen.queryByRole("list", { name: /permit documents/i })).toBeNull();
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("shows each record's extraction status and the failure reason", () => {
    render(
      <PermitRecordsList
        run={run({
          records: [
            record({ id: "r1", permitNumber: "OW-17-00474", extractionStatus: "done", extractionError: null }),
            record({ id: "r2", permitNumber: "000972", extractionStatus: "failed", extractionError: "Claude API error: 500 boom" }),
            record({ id: "r3", permitNumber: "OW-24-00001", extractionStatus: "skipped", extractionError: "Only the first 3 documents are read per run" }),
          ],
        })}
        onSelectCandidates={vi.fn()}
      />,
    );
    expect(screen.getByText("Read")).toBeInTheDocument();
    expect(screen.getByText("Read failed")).toBeInTheDocument();
    expect(screen.getByText("Claude API error: 500 boom — re-run Find records")).toBeInTheDocument();
    expect(screen.getByText("Not read")).toBeInTheDocument();
    expect(screen.getByText("Only the first 3 documents are read per run")).toBeInTheDocument();
  });

  it("marks the record named in a running 'Reading …' summary", () => {
    render(
      <PermitRecordsList
        run={run({
          status: "running",
          stages: { ...emptyStages(), permits: { status: "running", links: [], summary: "Reading OW-17-00474…" } },
          records: [record({ id: "r1", permitNumber: "OW-17-00474", extractionStatus: "pending", extractionError: null })],
        })}
        onSelectCandidates={vi.fn()}
      />,
    );
    expect(screen.getByText("Reading…")).toBeInTheDocument();
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
