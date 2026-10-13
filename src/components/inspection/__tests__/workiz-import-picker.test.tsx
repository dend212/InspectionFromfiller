import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkizJobRow, WorkizJobsResponse } from "@/types/workiz-import";

const { mockPush, mockToastError, mockToastWarning } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockToastError: vi.fn(),
  mockToastWarning: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));
vi.mock("sonner", () => ({ toast: { error: mockToastError, warning: mockToastWarning, success: vi.fn() } }));

import {
  formatScheduledDate,
  inspectionHref,
  PREFILL_FAILED_TOAST,
  PREFILL_SKIPPED_TOAST,
  WorkizImportPicker,
} from "@/components/inspection/workiz-import-picker";

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function row(over: Partial<WorkizJobRow> = {}): WorkizJobRow {
  return {
    id: "JOB-AbCdEfGhIjKlMnOp",
    serialId: 4696,
    street: "100 E Example Rd",
    city: "Cave Creek",
    scheduledDate: "2026-10-06",
    subStatus: "Job Complete - Reports Required",
    teamFirstNames: ["Alex", "Sam"],
    existing: null,
    ...over,
  };
}

function jobs(over: Partial<WorkizJobsResponse> = {}): WorkizJobsResponse {
  return {
    jobs: [row()],
    fetchedAt: "2026-10-12T17:04:05.000Z",
    role: "field_tech",
    currentUserFirstName: "Sam",
    ...over,
  };
}

async function openPanel(response = reply(200, jobs())) {
  const user = userEvent.setup();
  fetchMock.mockResolvedValueOnce(response);
  await user.click(screen.getByRole("button", { name: "Import from Workiz" }));
  return user;
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  fetchMock.mockReset();
});

describe("helpers", () => {
  it("formats the Workiz date without shifting it", () => {
    expect(formatScheduledDate("2026-10-06")).toBe("Oct 6, 2026");
    expect(formatScheduledDate(null)).toBe("Unscheduled");
  });

  it("routes like the dashboard's handleRowClick", () => {
    expect(inspectionHref("i1", "draft", "field_tech")).toBe("/inspections/i1/edit");
    expect(inspectionHref("i1", "submitted", "admin")).toBe("/review/i1");
    expect(inspectionHref("i1", "submitted", "field_tech")).toBe("/inspections/i1");
  });
});

describe("WorkizImportPicker", () => {
  it("does not call the API until opened, then shows a loading state", async () => {
    render(<WorkizImportPicker />);
    expect(fetchMock).not.toHaveBeenCalled();
    let resolve: (v: unknown) => void = () => {};
    fetchMock.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    await userEvent.setup().click(screen.getByRole("button", { name: "Import from Workiz" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/workiz/jobs");
    expect(screen.getByText("Loading Workiz jobs…")).toBeInTheDocument();
    resolve(reply(200, jobs()));
    expect(await screen.findByText("ADEQ jobs awaiting reports (1)")).toBeInTheDocument();
  });

  it("renders rows: serial, address, date, sub-status, team; Unscheduled when no date", async () => {
    render(<WorkizImportPicker />);
    await openPanel(
      reply(200, jobs({ jobs: [row(), row({ id: "JOB-Unscheduled000001", serialId: 4650, scheduledDate: null, subStatus: null, teamFirstNames: [] })] })),
    );
    const items = await screen.findAllByRole("listitem");
    expect(items).toHaveLength(2);
    const first = within(items[0]);
    expect(first.getByText("#4696")).toBeInTheDocument();
    expect(first.getByText("100 E Example Rd, Cave Creek")).toBeInTheDocument();
    expect(first.getByText("Oct 6, 2026")).toBeInTheDocument();
    expect(first.getByText("Job Complete - Reports Required")).toBeInTheDocument();
    expect(first.getByText("Team: Alex, Sam")).toBeInTheDocument();
    const second = within(items[1]);
    expect(second.getByText("Unscheduled")).toBeInTheDocument();
    expect(second.queryByText(/^Team:/)).toBeNull();
  });

  it("warns (case-insensitively) when the user is not on the Workiz team; omits it when the name is unknown", async () => {
    const { unmount } = render(<WorkizImportPicker />);
    await openPanel(reply(200, jobs({ currentUserFirstName: "pat" })));
    expect(await screen.findByText("You're not on this job's Workiz team")).toBeInTheDocument();
    unmount();

    const second = render(<WorkizImportPicker />);
    await openPanel(reply(200, jobs({ currentUserFirstName: "sam" })));
    await screen.findByText("#4696");
    expect(screen.queryByText("You're not on this job's Workiz team")).toBeNull();
    second.unmount();

    render(<WorkizImportPicker />);
    await openPanel(reply(200, jobs({ currentUserFirstName: null })));
    await screen.findByText("#4696");
    expect(screen.queryByText("You're not on this job's Workiz team")).toBeNull();
  });

  it("Open existing routes by status and role; a submitted one reads 'Report submitted'", async () => {
    render(<WorkizImportPicker />);
    const user = await openPanel(
      reply(
        200,
        jobs({
          role: "admin",
          jobs: [
            row({ existing: { canOpen: true, inspectionId: "insp-draft", status: "draft" } }),
            row({ id: "JOB-b000000000000001", serialId: 4667, existing: { canOpen: true, inspectionId: "insp-sub", status: "submitted" } }),
          ],
        }),
      ),
    );
    await user.click(await screen.findByRole("button", { name: "Open the inspection for Workiz job 4696" }));
    expect(mockPush).toHaveBeenCalledWith("/inspections/insp-draft/edit");
    const submitted = screen.getByRole("button", { name: "Open the inspection for Workiz job 4667" });
    expect(submitted).toHaveTextContent("Report submitted");
    await user.click(submitted);
    expect(mockPush).toHaveBeenCalledWith("/review/insp-sub");
  });

  it("a field tech's submitted inspection opens the read-only view", async () => {
    render(<WorkizImportPicker />);
    const user = await openPanel(
      reply(200, jobs({ jobs: [row({ existing: { canOpen: true, inspectionId: "insp-sub", status: "completed" } })] })),
    );
    await user.click(await screen.findByRole("button", { name: "Open the inspection for Workiz job 4696" }));
    expect(mockPush).toHaveBeenCalledWith("/inspections/insp-sub");
  });

  it("another inspector's import is a disabled button", async () => {
    render(<WorkizImportPicker />);
    await openPanel(reply(200, jobs({ jobs: [row({ existing: { canOpen: false } })] })));
    expect(await screen.findByRole("button", { name: "Imported by another inspector" })).toBeDisabled();
  });

  it("Import → POST {jobId} → router.push to the edit page; busy while importing", async () => {
    const onBusyChange = vi.fn();
    render(<WorkizImportPicker onBusyChange={onBusyChange} />);
    const user = await openPanel();
    let resolve: (v: unknown) => void = () => {};
    fetchMock.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const button = await screen.findByRole("button", { name: "Import Workiz job 4696, 100 E Example Rd" });
    await user.click(button);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/workiz/import", expect.objectContaining({ method: "POST", body: JSON.stringify({ jobId: "JOB-AbCdEfGhIjKlMnOp" }) }));
    expect(button).toHaveTextContent("Importing…");
    expect(button).toBeDisabled();
    expect(screen.getByRole("button", { name: "Import from Workiz" })).toBeDisabled();
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
    resolve(reply(201, { inspectionId: "insp-new", existing: false, prefill: { status: "started", runId: "run-1" } }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/inspections/insp-new/edit"));
    expect(mockToastWarning).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: "skipped", reason: "address_unparseable" }, PREFILL_SKIPPED_TOAST],
    [{ status: "failed" }, PREFILL_FAILED_TOAST],
  ])("toasts the prefill outcome %j before navigating", async (prefill, text) => {
    render(<WorkizImportPicker />);
    const user = await openPanel();
    fetchMock.mockResolvedValueOnce(reply(201, { inspectionId: "insp-new", existing: false, prefill }));
    await user.click(await screen.findByRole("button", { name: /Import Workiz job 4696/ }));
    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    expect(mockToastWarning).toHaveBeenCalledWith(text);
    expect(PREFILL_SKIPPED_TOAST).toBe(
      "Imported — the street address couldn't be read, so records lookup didn't start. Enter an APN on the next screen.",
    );
    expect(PREFILL_FAILED_TOAST).toBe("Imported — records lookup couldn't start; use Find records.");
  });

  it("200 existing routes like Open existing", async () => {
    render(<WorkizImportPicker />);
    const user = await openPanel();
    fetchMock.mockResolvedValueOnce(reply(200, { inspectionId: "insp-old", existing: true, status: "draft" }));
    await user.click(await screen.findByRole("button", { name: /Import Workiz job 4696/ }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/inspections/insp-old/edit"));
  });

  it("an import error renders inline (role=alert) and as a toast, and the Import button comes back", async () => {
    const onBusyChange = vi.fn();
    render(<WorkizImportPicker onBusyChange={onBusyChange} />);
    const user = await openPanel();
    fetchMock.mockResolvedValueOnce(reply(422, { error: "This Workiz job isn't ready to import", code: "not_importable" }));
    await user.click(await screen.findByRole("button", { name: /Import Workiz job 4696/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This Workiz job isn't ready to import");
    expect(mockToastError).toHaveBeenCalledWith("This Workiz job isn't ready to import");
    const button = screen.getByRole("button", { name: /Import Workiz job 4696/ });
    expect(button).toBeEnabled();
    expect(button).toHaveTextContent("Import");
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it("409 marks the row as imported by another inspector", async () => {
    render(<WorkizImportPicker />);
    const user = await openPanel();
    fetchMock.mockResolvedValueOnce(
      reply(409, { error: "This Workiz job was already imported by another inspector", code: "already_imported" }),
    );
    await user.click(await screen.findByRole("button", { name: /Import Workiz job 4696/ }));
    expect(await screen.findByRole("button", { name: "Imported by another inspector" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("already imported by another inspector");
  });

  it.each([
    ["workiz_not_configured", "Workiz import isn't set up on this server yet."],
    ["workiz_auth_failed", "Workiz rejected the app's credentials — ask an admin to check the Workiz API token."],
    ["workiz_rate_limited", "Workiz is busy — try again in a minute."],
    ["workiz_unavailable", "Couldn't reach Workiz — try again."],
    ["workiz_bad_response", "Couldn't reach Workiz — try again."],
  ])("list error %s → copy + Retry + manual hint", async (code, copy) => {
    render(<WorkizImportPicker />);
    const user = await openPanel(reply(502, { error: "x", code }));
    expect(await screen.findByText(copy)).toBeInTheDocument();
    expect(screen.getByText("You can still start a blank inspection with Create New Inspection.")).toBeInTheDocument();
    fetchMock.mockResolvedValueOnce(reply(200, jobs()));
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("#4696")).toBeInTheDocument();
  });

  it("empty state", async () => {
    render(<WorkizImportPicker />);
    await openPanel(reply(200, jobs({ jobs: [] })));
    expect(await screen.findByText("No ADEQ jobs are waiting for reports in Workiz.")).toBeInTheDocument();
    expect(screen.getByText("ADEQ jobs awaiting reports (0)")).toBeInTheDocument();
  });

  it("Refresh asks the server for a refresh", async () => {
    render(<WorkizImportPicker />);
    const user = await openPanel();
    await screen.findByText("#4696");
    fetchMock.mockResolvedValueOnce(reply(200, jobs()));
    await user.click(screen.getByRole("button", { name: "Refresh Workiz jobs" }));
    expect(fetchMock).toHaveBeenLastCalledWith("/api/workiz/jobs?refresh=1");
  });

  it("disabled (page is creating) disables the open button", () => {
    render(<WorkizImportPicker disabled />);
    expect(screen.getByRole("button", { name: "Import from Workiz" })).toBeDisabled();
  });
});
