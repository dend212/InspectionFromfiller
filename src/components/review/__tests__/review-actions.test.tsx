import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockPush = vi.fn();
const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock the child dialogs to simplify tests
vi.mock("@/components/review/return-dialog", () => ({
  ReturnDialog: ({ open, onOpenChange, onReturned }: any) =>
    open ? (
      <div data-testid="return-dialog">
        <button onClick={() => { onReturned(); onOpenChange(false); }}>
          Mock Return
        </button>
      </div>
    ) : null,
}));

const finalizeDialogProps = vi.fn();
vi.mock("@/components/review/finalize-dialog", () => ({
  FinalizeDialog: (props: any) => {
    finalizeDialogProps(props);
    return props.open ? (
      <div data-testid="finalize-dialog">
        <button onClick={() => { props.onOpenChange(false); props.onFinalized(); }}>
          Mock Finalize
        </button>
      </div>
    ) : null;
  },
}));

vi.mock("@/components/dashboard/send-email-dialog", () => ({
  SendEmailDialog: ({ open }: any) =>
    open ? <div data-testid="send-email-dialog">Email Dialog</div> : null,
}));

import { toast } from "sonner";
import { ReviewActions } from "@/components/review/review-actions";

// ── Helpers ────────────────────────────────────────────────────────────────────

const defaultProps = {
  inspectionId: "insp-1",
  status: "in_review",
  onStatusChange: vi.fn(),
};

/** fetch mock that records "METHOD url" into `calls` so ordering can be asserted */
function recordingFetch(calls: string[], ok = true, body: unknown = {}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    return { ok, status: ok ? 200 : 500, statusText: "x", json: async () => body };
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.restoreAllMocks();
  mockPush.mockClear();
  mockRefresh.mockClear();
  finalizeDialogProps.mockClear();
  // Silence the recommendations prefetch that runs on mount
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
});

describe("ReviewActions", () => {
  describe("status badge", () => {
    it("renders In Review badge for in_review status", () => {
      render(<ReviewActions {...defaultProps} status="in_review" />);
      expect(screen.getByText("In Review")).toBeInTheDocument();
    });

    it("renders Completed badge for completed status", () => {
      render(<ReviewActions {...defaultProps} status="completed" />);
      expect(screen.getByText("Completed")).toBeInTheDocument();
    });

    it("renders Draft badge for draft status", () => {
      render(<ReviewActions {...defaultProps} status="draft" />);
      expect(screen.getByText("Draft")).toBeInTheDocument();
    });

    it("renders Sent badge for sent status", () => {
      render(<ReviewActions {...defaultProps} status="sent" />);
      expect(screen.getByText("Sent")).toBeInTheDocument();
    });

    it("renders raw status when not in labels map", () => {
      render(<ReviewActions {...defaultProps} status="unknown_status" />);
      expect(screen.getByText("unknown_status")).toBeInTheDocument();
    });
  });

  describe("in_review status actions", () => {
    it("renders Finalize Report button", () => {
      render(<ReviewActions {...defaultProps} status="in_review" />);
      expect(
        screen.getByRole("button", { name: /finalize report/i }),
      ).toBeInTheDocument();
    });

    it("renders Return to Tech button", () => {
      render(<ReviewActions {...defaultProps} status="in_review" />);
      expect(
        screen.getByRole("button", { name: /return to tech/i }),
      ).toBeInTheDocument();
    });

    it("does not render Send PDF to Customer for in_review", () => {
      render(<ReviewActions {...defaultProps} status="in_review" />);
      expect(
        screen.queryByRole("button", { name: /send pdf to customer/i }),
      ).not.toBeInTheDocument();
    });

    it("opens the FinalizeDialog with flush, form data and selected media", async () => {
      const flush = vi.fn(async () => true);
      const getFormData = vi.fn(() => null);
      const onJumpToField = vi.fn();
      const user = userEvent.setup();
      render(
        <ReviewActions
          {...defaultProps}
          status="in_review"
          flush={flush}
          getFormData={getFormData}
          onJumpToField={onJumpToField}
          selectedMediaIds={["m1"]}
        />,
      );

      expect(screen.queryByTestId("finalize-dialog")).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /finalize report/i }));

      expect(screen.getByTestId("finalize-dialog")).toBeInTheDocument();
      expect(finalizeDialogProps).toHaveBeenLastCalledWith(
        expect.objectContaining({
          inspectionId: "insp-1",
          open: true,
          flush,
          getFormData,
          onJumpToField,
          selectedMediaIds: ["m1"],
        }),
      );
    });

    it("marks the inspection completed and refreshes when the dialog finalizes", async () => {
      const onStatusChange = vi.fn();
      const user = userEvent.setup();
      render(
        <ReviewActions {...defaultProps} status="in_review" onStatusChange={onStatusChange} />,
      );

      await user.click(screen.getByRole("button", { name: /finalize report/i }));
      await user.click(screen.getByRole("button", { name: /mock finalize/i }));

      expect(onStatusChange).toHaveBeenCalledWith("completed");
      expect(mockRefresh).toHaveBeenCalled();
      expect(screen.queryByTestId("finalize-dialog")).not.toBeInTheDocument();
    });

    it("flushes before opening the return dialog", async () => {
      const order: string[] = [];
      const flush = vi.fn(async () => {
        order.push("flush");
        return true;
      });
      const user = userEvent.setup();
      render(<ReviewActions {...defaultProps} status="in_review" flush={flush} />);

      await user.click(screen.getByRole("button", { name: /return to tech/i }));

      expect(await screen.findByTestId("return-dialog")).toBeInTheDocument();
      expect(order).toEqual(["flush"]);
    });

    it("does not open the return dialog when flush fails", async () => {
      const user = userEvent.setup();
      render(<ReviewActions {...defaultProps} status="in_review" flush={async () => false} />);

      await user.click(screen.getByRole("button", { name: /return to tech/i }));

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/couldn't save/i)),
      );
      expect(screen.queryByTestId("return-dialog")).not.toBeInTheDocument();
    });
  });

  describe("completed status actions", () => {
    it("renders Send PDF to Customer button", () => {
      render(<ReviewActions {...defaultProps} status="completed" />);
      expect(
        screen.getByRole("button", { name: /send pdf to customer/i }),
      ).toBeInTheDocument();
    });

    it("renders Reopen for Editing button", () => {
      render(<ReviewActions {...defaultProps} status="completed" />);
      expect(
        screen.getByRole("button", { name: /reopen for editing/i }),
      ).toBeInTheDocument();
    });

    it("does not render Finalize button for completed", () => {
      render(<ReviewActions {...defaultProps} status="completed" />);
      expect(
        screen.queryByRole("button", { name: /finalize report/i }),
      ).not.toBeInTheDocument();
    });

    it("opens email dialog when Send PDF to Customer is clicked", async () => {
      const user = userEvent.setup();
      render(
        <ReviewActions
          {...defaultProps}
          status="completed"
          customerEmail="test@example.com"
        />,
      );

      await user.click(
        screen.getByRole("button", { name: /send pdf to customer/i }),
      );

      expect(screen.getByTestId("send-email-dialog")).toBeInTheDocument();
    });

    it("shows reopen confirmation dialog", async () => {
      const user = userEvent.setup();
      render(<ReviewActions {...defaultProps} status="completed" />);

      await user.click(
        screen.getByRole("button", { name: /reopen for editing/i }),
      );

      expect(screen.getByText("Reopen Inspection?")).toBeInTheDocument();
    });

    it("flushes, then calls the reopen API on confirmation", async () => {
      const calls: string[] = [];
      vi.stubGlobal("fetch", recordingFetch(calls));
      const flush = vi.fn(async () => {
        calls.push("flush");
        return true;
      });

      const onStatusChange = vi.fn();
      const user = userEvent.setup();
      render(
        <ReviewActions
          {...defaultProps}
          status="completed"
          onStatusChange={onStatusChange}
          flush={flush}
        />,
      );

      await user.click(
        screen.getByRole("button", { name: /reopen for editing/i }),
      );
      await user.click(screen.getByRole("button", { name: /^reopen$/i }));

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith(
          "Inspection reopened for editing",
        );
        expect(onStatusChange).toHaveBeenCalledWith("in_review");
      });
      // The recommendations prefetch is the GET; flush must precede the POST
      expect(calls.filter((c) => !c.startsWith("GET"))).toEqual([
        "flush",
        "POST /api/inspections/insp-1/reopen",
      ]);
    });

    it("does not call the reopen API when flush fails", async () => {
      const calls: string[] = [];
      vi.stubGlobal("fetch", recordingFetch(calls));
      const user = userEvent.setup();
      render(
        <ReviewActions {...defaultProps} status="completed" flush={async () => false} />,
      );

      await user.click(screen.getByRole("button", { name: /reopen for editing/i }));
      await user.click(screen.getByRole("button", { name: /^reopen$/i }));

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/couldn't save/i)),
      );
      expect(calls.filter((c) => c.startsWith("POST"))).toEqual([]);
    });
  });

  describe("sent status actions", () => {
    it("renders Send PDF to Customer and Reopen buttons", () => {
      render(<ReviewActions {...defaultProps} status="sent" />);

      expect(
        screen.getByRole("button", { name: /send pdf to customer/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /reopen for editing/i }),
      ).toBeInTheDocument();
    });
  });

  describe("draft status", () => {
    it("only shows status badge, no action buttons", () => {
      render(<ReviewActions {...defaultProps} status="draft" />);

      expect(screen.getByText("Draft")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /finalize/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /send/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /reopen/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe("error handling", () => {
    it("shows error toast on reopen failure", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          json: () =>
            Promise.resolve({ error: "Cannot reopen" }),
        }),
      );

      const user = userEvent.setup();
      render(<ReviewActions {...defaultProps} status="completed" />);

      await user.click(
        screen.getByRole("button", { name: /reopen for editing/i }),
      );
      await user.click(screen.getByRole("button", { name: /^reopen$/i }));

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith("Cannot reopen");
      });
    });
  });
});
