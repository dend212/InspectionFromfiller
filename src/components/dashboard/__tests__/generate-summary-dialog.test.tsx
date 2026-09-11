import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { GenerateSummaryDialog } from "@/components/dashboard/generate-summary-dialog";

// ── Helpers ────────────────────────────────────────────────────────────────────

type DraftResponse = { ok: boolean; recommendations?: string };

const defaultProps = {
  inspectionId: "insp-1",
  facilityAddress: "123 Main St",
  open: true,
  onOpenChange: vi.fn(),
  onSummaryGenerated: vi.fn(),
};

/**
 * Routes the dialog's fetches:
 *   GET  …/generate-summary        → { recommendations: saved }
 *   POST …/draft-recommendations   → next entry of `drafts` (last entry repeats)
 * A draft entry may be a pending promise to hold the skeleton open.
 */
function mockFetch({
  saved = "",
  drafts = [{ ok: true, recommendations: "• Default draft." }],
}: {
  saved?: string;
  drafts?: Array<DraftResponse | Promise<DraftResponse>>;
} = {}) {
  let draftIndex = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/draft-recommendations")) {
      // Assign this call's entry synchronously (by invocation order), then await it —
      // so two overlapping calls each wait on their own entry instead of racing to read
      // the same `draftIndex` before either has resolved.
      const idx = Math.min(draftIndex, drafts.length - 1);
      draftIndex += 1;
      const draft = await drafts[idx];
      return {
        ok: draft.ok,
        json: async () => ({
          recommendations: draft.recommendations ?? "",
          error: draft.ok ? undefined : "Rate limit exceeded",
        }),
      };
    }
    if (url.endsWith("/generate-summary") && (init?.method ?? "GET") === "GET") {
      return { ok: true, json: async () => ({ recommendations: saved }) };
    }
    return { ok: true, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function draftCallCount(fetchMock: ReturnType<typeof mockFetch>): number {
  return fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/draft-recommendations"))
    .length;
}

const generateButton = () => screen.getByRole("button", { name: /generate summary/i });

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("GenerateSummaryDialog — AI draft", () => {
  it("auto-drafts when there is no saved recommendation", async () => {
    const fetchMock = mockFetch({ saved: "", drafts: [{ ok: true, recommendations: "• Pump the tank." }] });

    render(<GenerateSummaryDialog {...defaultProps} />);

    await waitFor(() =>
      expect(screen.getByLabelText("Recommendations")).toHaveValue("• Pump the tank."),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/inspections/insp-1/draft-recommendations",
      expect.objectContaining({ method: "POST" }),
    );
    expect(draftCallCount(fetchMock)).toBe(1);
    expect(generateButton()).not.toBeDisabled();
  });

  it("does not auto-draft when a saved recommendation exists", async () => {
    const fetchMock = mockFetch({ saved: "Saved text" });

    render(<GenerateSummaryDialog {...defaultProps} />);

    await waitFor(() => expect(screen.getByLabelText("Recommendations")).toHaveValue("Saved text"));
    expect(draftCallCount(fetchMock)).toBe(0);
  });

  it("shows the skeleton while drafting, then fills the textarea", async () => {
    let resolveDraft!: (value: DraftResponse) => void;
    const pending = new Promise<DraftResponse>((resolve) => {
      resolveDraft = resolve;
    });
    mockFetch({ saved: "", drafts: [pending] });

    render(<GenerateSummaryDialog {...defaultProps} />);

    expect(await screen.findByText("Drafting recommendations…")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(generateButton()).toBeDisabled();

    resolveDraft({ ok: true, recommendations: "• Pump the tank." });

    await waitFor(() =>
      expect(screen.getByLabelText("Recommendations")).toHaveValue("• Pump the tank."),
    );
    expect(screen.queryByText("Drafting recommendations…")).not.toBeInTheDocument();
    expect(generateButton()).not.toBeDisabled();
  });

  it("shows the failure notice and leaves the textarea empty and editable", async () => {
    mockFetch({ saved: "", drafts: [{ ok: false }] });
    const user = userEvent.setup();

    render(<GenerateSummaryDialog {...defaultProps} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't draft — write your own or retry",
    );
    const field = screen.getByLabelText("Recommendations");
    expect(field).toHaveValue("");
    expect(field).not.toBeDisabled();
    expect(generateButton()).toBeDisabled();

    await user.type(field, "Manual note");

    expect(field).toHaveValue("Manual note");
    expect(generateButton()).not.toBeDisabled();
  });

  it("treats an empty draft as a failure", async () => {
    mockFetch({ saved: "", drafts: [{ ok: true, recommendations: "   " }] });

    render(<GenerateSummaryDialog {...defaultProps} />);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByLabelText("Recommendations")).toHaveValue("");
    expect(generateButton()).toBeDisabled();
  });

  it("still lets the user generate the summary after a draft failure", async () => {
    const fetchMock = mockFetch({ saved: "", drafts: [{ ok: false }] });
    const user = userEvent.setup();
    const onSummaryGenerated = vi.fn();

    render(<GenerateSummaryDialog {...defaultProps} onSummaryGenerated={onSummaryGenerated} />);

    await screen.findByRole("alert");
    await user.type(screen.getByLabelText("Recommendations"), "Manual note");

    // The POST to generate-summary falls through mockFetch's default branch and returns {} —
    // override it for this one call so the dialog gets a summaryUrl back.
    fetchMock.mockImplementationOnce(async () => ({
      ok: true,
      json: async () => ({ summaryUrl: "http://localhost/summary/tok" }),
    }));
    await user.click(generateButton());

    await waitFor(() => expect(onSummaryGenerated).toHaveBeenCalledWith("http://localhost/summary/tok"));
  });

  it("discards a draft response that resolves after the dialog was closed", async () => {
    let resolveDraft!: (value: DraftResponse) => void;
    const pendingDraft = new Promise<DraftResponse>((resolve) => {
      resolveDraft = resolve;
    });

    let getCallCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/draft-recommendations")) {
        const draft = await pendingDraft;
        return { ok: draft.ok, json: async () => ({ recommendations: draft.recommendations ?? "" }) };
      }
      if (url.endsWith("/generate-summary") && (init?.method ?? "GET") === "GET") {
        getCallCount += 1;
        // Second open (after close/reopen) now has a saved recommendation, so no new
        // draft request should fire — isolating whether the stale first response leaks in.
        const saved = getCallCount === 1 ? "" : "Saved after reopen";
        return { ok: true, json: async () => ({ recommendations: saved }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(<GenerateSummaryDialog {...defaultProps} />);

    await screen.findByText("Drafting recommendations…");
    expect(generateButton()).toBeDisabled();

    // Close before the draft request resolves.
    rerender(<GenerateSummaryDialog {...defaultProps} open={false} />);

    // Reopen with a saved recommendation this time — no new draft request fires.
    rerender(<GenerateSummaryDialog {...defaultProps} open={true} />);

    await waitFor(() =>
      expect(screen.getByLabelText("Recommendations")).toHaveValue("Saved after reopen"),
    );
    expect(generateButton()).not.toBeDisabled();

    // The stale draft from before the close now resolves.
    resolveDraft({ ok: true, recommendations: "• Stale draft." });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.getByLabelText("Recommendations")).toHaveValue("Saved after reopen");
    expect(generateButton()).not.toBeDisabled();
    expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/draft-recommendations")))
      .toHaveLength(1);
  });

  it("fires exactly one new draft request on close/reopen and ignores the stale first response", async () => {
    let resolveFirst!: (value: DraftResponse) => void;
    let resolveSecond!: (value: DraftResponse) => void;
    const firstDraft = new Promise<DraftResponse>((resolve) => {
      resolveFirst = resolve;
    });
    const secondDraft = new Promise<DraftResponse>((resolve) => {
      resolveSecond = resolve;
    });

    const fetchMock = mockFetch({ saved: "", drafts: [firstDraft, secondDraft] });

    const { rerender } = render(<GenerateSummaryDialog {...defaultProps} />);

    await screen.findByText("Drafting recommendations…");
    expect(draftCallCount(fetchMock)).toBe(1);

    // Close before the first draft resolves, then reopen — saved is still empty.
    rerender(<GenerateSummaryDialog {...defaultProps} open={false} />);
    rerender(<GenerateSummaryDialog {...defaultProps} open={true} />);

    await waitFor(() => expect(draftCallCount(fetchMock)).toBe(2));

    resolveSecond({ ok: true, recommendations: "• Second draft." });
    await waitFor(() =>
      expect(screen.getByLabelText("Recommendations")).toHaveValue("• Second draft."),
    );

    // The stale first request resolves after the second has already won.
    resolveFirst({ ok: true, recommendations: "• First draft (stale)." });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.getByLabelText("Recommendations")).toHaveValue("• Second draft.");
    expect(draftCallCount(fetchMock)).toBe(2);
  });
});

describe("GenerateSummaryDialog — Regenerate", () => {
  const regenerateButton = () => screen.getByRole("button", { name: /regenerate/i });

  it("asks before replacing saved text and keeps it when cancelled", async () => {
    const fetchMock = mockFetch({ saved: "Saved text" });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();

    render(<GenerateSummaryDialog {...defaultProps} />);
    await waitFor(() => expect(screen.getByLabelText("Recommendations")).toHaveValue("Saved text"));

    await user.click(regenerateButton());

    expect(confirmSpy).toHaveBeenCalledWith("Replace your edits with a new draft?");
    expect(draftCallCount(fetchMock)).toBe(0);
    expect(screen.getByLabelText("Recommendations")).toHaveValue("Saved text");
  });

  it("replaces saved text with a fresh draft when confirmed", async () => {
    const fetchMock = mockFetch({
      saved: "Saved text",
      drafts: [{ ok: true, recommendations: "• Fresh draft." }],
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();

    render(<GenerateSummaryDialog {...defaultProps} />);
    await waitFor(() => expect(screen.getByLabelText("Recommendations")).toHaveValue("Saved text"));

    await user.click(regenerateButton());

    await waitFor(() =>
      expect(screen.getByLabelText("Recommendations")).toHaveValue("• Fresh draft."),
    );
    expect(draftCallCount(fetchMock)).toBe(1);
  });

  it("regenerates an untouched AI draft without asking", async () => {
    const fetchMock = mockFetch({
      saved: "",
      drafts: [
        { ok: true, recommendations: "• First draft." },
        { ok: true, recommendations: "• Second draft." },
      ],
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();

    render(<GenerateSummaryDialog {...defaultProps} />);
    await waitFor(() =>
      expect(screen.getByLabelText("Recommendations")).toHaveValue("• First draft."),
    );

    await user.click(regenerateButton());

    await waitFor(() =>
      expect(screen.getByLabelText("Recommendations")).toHaveValue("• Second draft."),
    );
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(draftCallCount(fetchMock)).toBe(2);
  });

  it("asks before regenerating once the AI draft has been edited", async () => {
    const fetchMock = mockFetch({ saved: "", drafts: [{ ok: true, recommendations: "• First draft." }] });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();

    render(<GenerateSummaryDialog {...defaultProps} />);
    const field = await screen.findByDisplayValue("• First draft.");
    await user.type(field, " Edited.");

    await user.click(regenerateButton());

    expect(confirmSpy).toHaveBeenCalledWith("Replace your edits with a new draft?");
    expect(draftCallCount(fetchMock)).toBe(1);
    expect(field).toHaveValue("• First draft. Edited.");
  });

  it("keeps the current text and shows the notice when regenerate fails", async () => {
    mockFetch({ saved: "Saved text", drafts: [{ ok: false }] });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();

    render(<GenerateSummaryDialog {...defaultProps} />);
    await waitFor(() => expect(screen.getByLabelText("Recommendations")).toHaveValue("Saved text"));

    await user.click(regenerateButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't draft — write your own or retry",
    );
    expect(screen.getByLabelText("Recommendations")).toHaveValue("Saved text");
    expect(generateButton()).not.toBeDisabled();
  });

  it("disables Regenerate while a draft is in flight", async () => {
    let resolveDraft!: (value: DraftResponse) => void;
    const pending = new Promise<DraftResponse>((resolve) => {
      resolveDraft = resolve;
    });
    mockFetch({ saved: "", drafts: [pending] });

    render(<GenerateSummaryDialog {...defaultProps} />);

    expect(await screen.findByText("Drafting recommendations…")).toBeInTheDocument();
    expect(regenerateButton()).toBeDisabled();

    resolveDraft({ ok: true, recommendations: "• Done." });

    await waitFor(() => expect(regenerateButton()).not.toBeDisabled());
  });
});
