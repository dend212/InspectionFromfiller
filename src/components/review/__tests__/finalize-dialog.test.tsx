import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { toast } from "sonner";
import { buildFinalizedNote, FinalizeDialog } from "@/components/review/finalize-dialog";
import { getDefaultFormValues } from "@/lib/validators/inspection";
import type { InspectionFormData } from "@/types/inspection";

// ── Helpers ────────────────────────────────────────────────────────────────────

function cleanForm(): InspectionFormData {
  const d = getDefaultFormValues("Dan Endres") as unknown as InspectionFormData;
  d.facilityInfo.facilityName = "Smith Residence";
  return d;
}

function formWithIssues() {
  const d = cleanForm();
  d.facilityInfo.facilityName = "";
  d.septicTank.tanks = [{ lidsRisersPresent: "sideways" } as never];
  return d;
}

/** 12 tanks × 5 invalid enums = 60 issues, well past the 2000-char review-notes cap */
function formWithManyIssues(tankCount = 12) {
  const d = cleanForm();
  d.septicTank.tanks = Array.from({ length: tankCount }, () => ({
    lidsRisersPresent: "x",
    lidsSecurelyFastened: "x",
    compromisedTank: "x",
    effluentFilterPresent: "x",
    effluentFilterServiced: "x",
  })) as never;
  return d;
}

/** fetch mock that records the order of calls as "METHOD url" */
function queuedFetch(calls: string[], responses: Record<string, { ok: boolean; body?: unknown }> = {}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    const r = responses[url] ?? { ok: true, body: {} };
    return { ok: r.ok, status: r.ok ? 200 : 500, statusText: "x", json: async () => r.body ?? {} };
  });
}

const baseProps = {
  inspectionId: "insp-1",
  open: true,
  onOpenChange: vi.fn(),
  selectedMediaIds: ["m1", "m2"],
  onFinalized: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("FinalizeDialog", () => {
  it("calls flush() before validating and shows the clean confirmation", async () => {
    const order: string[] = [];
    const flush = vi.fn(async () => {
      order.push("flush");
      return true;
    });
    const getFormData = vi.fn(() => {
      order.push("getFormData");
      return cleanForm();
    });
    render(<FinalizeDialog {...baseProps} flush={flush} getFormData={getFormData} />);

    expect(screen.getByText(/saving your changes/i)).toBeInTheDocument();
    await screen.findByText(/mark the inspection as completed/i);
    expect(order).toEqual(["flush", "getFormData"]);
    expect(screen.getByRole("button", { name: /^finalize$/i })).toBeEnabled();
    expect(screen.queryByText(/finalize with issues/i)).not.toBeInTheDocument();
  });

  it("closes with an error toast when flush() fails", async () => {
    const onOpenChange = vi.fn();
    render(
      <FinalizeDialog
        {...baseProps}
        onOpenChange={onOpenChange}
        flush={async () => false}
        getFormData={cleanForm}
      />,
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/couldn't save/i));
  });

  it("clean path: POSTs finalize with selectedMediaIds and skips the issue list", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", queuedFetch(calls));
    const onFinalized = vi.fn();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      <FinalizeDialog
        {...baseProps}
        onOpenChange={onOpenChange}
        onFinalized={onFinalized}
        flush={async () => true}
        getFormData={cleanForm}
      />,
    );

    await user.click(await screen.findByRole("button", { name: /^finalize$/i }));

    await waitFor(() => expect(onFinalized).toHaveBeenCalled());
    expect(calls).toEqual(["POST /api/inspections/insp-1/finalize"]);
    expect(vi.mocked(fetch).mock.calls[0][1]).toEqual(
      expect.objectContaining({ body: JSON.stringify({ selectedMediaIds: ["m1", "m2"] }) }),
    );
    expect(toast.success).toHaveBeenCalledWith("Inspection finalized successfully");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("lists issues grouped by section with jump-to rows", async () => {
    const onJumpToField = vi.fn();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      <FinalizeDialog
        {...baseProps}
        onOpenChange={onOpenChange}
        onJumpToField={onJumpToField}
        flush={async () => true}
        getFormData={formWithIssues}
      />,
    );

    expect(await screen.findByText("Finalize with validation issues?")).toBeInTheDocument();
    expect(screen.getByText("Facility Info · 1 issue")).toBeInTheDocument();
    expect(screen.getByText("Septic Tank · 1 issue")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /fix issues/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /tank 1 · lids risers present/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onJumpToField).toHaveBeenCalledWith("septicTank.tanks.0.lidsRisersPresent", 3);
  });

  it("Finalize with issues PATCHes review_notes, then POSTs finalize", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", queuedFetch(calls));
    const onFinalized = vi.fn();
    const user = userEvent.setup();
    render(
      <FinalizeDialog
        {...baseProps}
        onFinalized={onFinalized}
        flush={async () => true}
        getFormData={formWithIssues}
      />,
    );

    await user.click(await screen.findByRole("button", { name: /finalize with issues/i }));

    await waitFor(() => expect(onFinalized).toHaveBeenCalled());
    expect(calls).toEqual([
      "PATCH /api/inspections/insp-1/review-notes",
      "POST /api/inspections/insp-1/finalize",
    ]);
    const notesBody = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(notesBody.append).toBe(
      "Finalized with 2 validation issues: Facility Info › Facility Name, Septic Tank › Tank 1 · Lids Risers Present",
    );
  });

  it("caps the appended note under the server's 2000-char limit with 60 issues (…and N more)", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", queuedFetch(calls));
    const onFinalized = vi.fn();
    const user = userEvent.setup();
    render(
      <FinalizeDialog
        {...baseProps}
        onFinalized={onFinalized}
        flush={async () => true}
        getFormData={formWithManyIssues}
      />,
    );

    expect(await screen.findByText(/found 60 issues/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /finalize with issues/i }));

    await waitFor(() => expect(onFinalized).toHaveBeenCalled());
    expect(calls).toEqual([
      "PATCH /api/inspections/insp-1/review-notes",
      "POST /api/inspections/insp-1/finalize",
    ]);
    const note: string = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).append;
    expect(note.length).toBeLessThanOrEqual(1900);
    expect(note.startsWith("Finalized with 60 validation issues: Septic Tank › Tank 1 · Lids Risers Present, ")).toBe(true);
    expect(note).toMatch(/ …and \d+ more$/);
    // Everything listed plus the "more" count still adds up to 60
    const [body, moreStr] = note.slice("Finalized with 60 validation issues: ".length).split(" …and ");
    const listed = body.split(", ").length;
    const more = Number(moreStr.match(/^(\d+) more$/)![1]);
    expect(listed + more).toBe(60);
  });

  it("stays open with an error toast when the review-notes PATCH fails", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      queuedFetch(calls, {
        "/api/inspections/insp-1/review-notes": { ok: false, body: { error: "Forbidden: admin only" } },
      }),
    );
    const onFinalized = vi.fn();
    const user = userEvent.setup();
    render(
      <FinalizeDialog
        {...baseProps}
        onFinalized={onFinalized}
        flush={async () => true}
        getFormData={formWithIssues}
      />,
    );

    await user.click(await screen.findByRole("button", { name: /finalize with issues/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Forbidden: admin only"));
    expect(calls).toEqual(["PATCH /api/inspections/insp-1/review-notes"]);
    expect(onFinalized).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /finalize with issues/i })).toBeEnabled();
  });

  it("renders nothing when closed", () => {
    render(<FinalizeDialog {...baseProps} open={false} flush={async () => true} getFormData={cleanForm} />);
    expect(screen.queryByText(/finalize inspection report/i)).not.toBeInTheDocument();
  });
});

describe("buildFinalizedNote", () => {
  const issue = (i: number) => ({ step: 3, path: `septicTank.tanks.${i}.lidsRisersPresent`, message: "bad" });

  it("lists every issue verbatim when the line fits", () => {
    expect(buildFinalizedNote([issue(0), issue(1)])).toBe(
      "Finalized with 2 validation issues: Septic Tank › Tank 1 · Lids Risers Present, Septic Tank › Tank 2 · Lids Risers Present",
    );
  });

  it("singular wording for one issue", () => {
    expect(buildFinalizedNote([issue(0)])).toBe(
      "Finalized with 1 validation issue: Septic Tank › Tank 1 · Lids Risers Present",
    );
  });

  it("never exceeds 1900 chars and reports how many were cut", () => {
    const many = Array.from({ length: 200 }, (_, i) => issue(i));
    const note = buildFinalizedNote(many);
    expect(note.length).toBeLessThanOrEqual(1900);
    const [body, moreStr] = note.slice("Finalized with 200 validation issues: ".length).split(" …and ");
    const more = Number(moreStr.match(/^(\d+) more$/)![1]);
    expect(more).toBeGreaterThan(0);
    expect(body.split(", ").length + more).toBe(200);
  });
});
