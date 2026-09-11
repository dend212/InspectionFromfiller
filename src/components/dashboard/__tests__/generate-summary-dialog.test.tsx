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
      const draft = await drafts[Math.min(draftIndex, drafts.length - 1)];
      draftIndex += 1;
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
});
