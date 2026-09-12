import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PrefillRunDTO } from "@/lib/prefill/types";
import { emptyStages } from "@/lib/prefill/types";

const { mockList } = vi.hoisted(() => ({
  mockList: vi.fn((_props: unknown) => <div data-testid="permit-records-list" />),
}));
vi.mock("@/components/prefill/permit-records-list", () => ({ PermitRecordsList: mockList }));

import { PrefillSourcesTile } from "../prefill-sources-tile";

const notFoundRun: PrefillRunDTO = {
  id: "run-1",
  inspectionId: "insp-1",
  trigger: "manual",
  status: "done",
  input: { apn: "219-11-121", address: { streetNumber: "8911", streetName: "Cave Creek Rd" } },
  stages: {
    ...emptyStages(),
    permits: {
      status: "not_found",
      summary: "No permit records found (searched APN 219-11-121 and 8911 CAVE CREEK — 0 matches)",
      links: [{ label: "Open on Maricopa EDMS", url: "https://edms.maricopa.gov/env/" }],
    },
  },
  proposals: [],
  candidates: [],
  error: null,
  appliedAt: null,
  createdAt: "2026-09-11T10:00:00Z",
  finishedAt: "2026-09-11T10:00:30Z",
  records: [],
};

const onSelectCandidates = vi.fn();
const tileProps = {
  run: notFoundRun,
  isRunning: false,
  canRun: true,
  error: null,
  onFindRecords: vi.fn(),
  onSelectCandidates,
};

describe("PrefillSourcesTile — permits", () => {
  it("shows the not-found copy with the searched terms and the EDMS link on the Permits row", () => {
    render(<PrefillSourcesTile {...tileProps} />);
    expect(
      screen.getByText(/No permit records found \(searched APN 219-11-121 and 8911 CAVE CREEK — 0 matches\)/),
    ).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /open on maricopa edms/i });
    expect(link).toHaveAttribute("href", "https://edms.maricopa.gov/env/");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("mounts PermitRecordsList with the run, the selection handler and the running flag", () => {
    mockList.mockClear();
    render(<PrefillSourcesTile {...tileProps} isRunning />);
    expect(screen.getByTestId("permit-records-list")).toBeInTheDocument();
    const props = mockList.mock.calls[0][0] as {
      run: PrefillRunDTO;
      onSelectCandidates: unknown;
      disabled: boolean;
    };
    expect(props.run).toBe(notFoundRun);
    expect(props.onSelectCandidates).toBe(onSelectCandidates);
    expect(props.disabled).toBe(true);
  });

  it("disables the list when no selection handler is provided (read-only views)", () => {
    mockList.mockClear();
    render(<PrefillSourcesTile {...tileProps} onSelectCandidates={undefined} />);
    const props = mockList.mock.calls[0][0] as { disabled: boolean };
    expect(props.disabled).toBe(true);
  });

  it("does not mount PermitRecordsList when there is no run yet", () => {
    mockList.mockClear();
    render(<PrefillSourcesTile {...tileProps} run={null} />);
    expect(mockList).not.toHaveBeenCalled();
  });
});
