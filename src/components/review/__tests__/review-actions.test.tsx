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

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.restoreAllMocks();
  mockPush.mockClear();
  mockRefresh.mockClear();
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

    it("does not render Send to Customer for in_review", () => {
      render(<ReviewActions {...defaultProps} status="in_review" />);
      expect(
        screen.queryByRole("button", { name: /send to customer/i }),
      ).not.toBeInTheDocument();
    });

    it("shows confirmation dialog when Finalize is clicked", async () => {
      const user = userEvent.setup();
      render(<ReviewActions {...defaultProps} status="in_review" />);

      await user.click(
        screen.getByRole("button", { name: /finalize report/i }),
      );

      expect(
        screen.getByText("Finalize Inspection Report?"),
      ).toBeInTheDocument();
    });

    it("calls finalize API and shows success on confirmation", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({}),
        }),
      );

      const onStatusChange = vi.fn();
      const user = userEvent.setup();
      render(
        <ReviewActions
          {...defaultProps}
          status="in_review"
          onStatusChange={onStatusChange}
        />,
      );

      await user.click(
        screen.getByRole("button", { name: /finalize report/i }),
      );
      await user.click(screen.getByRole("button", { name: /^finalize$/i }));

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          "/api/inspections/insp-1/finalize",
          expect.objectContaining({ method: "POST" }),
        );
        expect(toast.success).toHaveBeenCalledWith(
          "Inspection finalized successfully",
        );
        expect(onStatusChange).toHaveBeenCalledWith("completed");
      });
    });

    it("opens return dialog when Return to Tech is clicked", async () => {
      const user = userEvent.setup();
      render(<ReviewActions {...defaultProps} status="in_review" />);

      await user.click(
        screen.getByRole("button", { name: /return to tech/i }),
      );

      expect(screen.getByTestId("return-dialog")).toBeInTheDocument();
    });
  });

  describe("completed status actions", () => {
    it("renders Send to Customer button", () => {
      render(<ReviewActions {...defaultProps} status="completed" />);
      expect(
        screen.getByRole("button", { name: /send to customer/i }),
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

    it("opens email dialog when Send to Customer is clicked", async () => {
      const user = userEvent.setup();
      render(
        <ReviewActions
          {...defaultProps}
          status="completed"
          customerEmail="test@example.com"
        />,
      );

      await user.click(
        screen.getByRole("button", { name: /send to customer/i }),
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

    it("calls reopen API on confirmation", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({}),
        }),
      );

      const onStatusChange = vi.fn();
      const user = userEvent.setup();
      render(
        <ReviewActions
          {...defaultProps}
          status="completed"
          onStatusChange={onStatusChange}
        />,
      );

      await user.click(
        screen.getByRole("button", { name: /reopen for editing/i }),
      );
      await user.click(screen.getByRole("button", { name: /^reopen$/i }));

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          "/api/inspections/insp-1/reopen",
          expect.objectContaining({ method: "POST" }),
        );
        expect(toast.success).toHaveBeenCalledWith(
          "Inspection reopened for editing",
        );
        expect(onStatusChange).toHaveBeenCalledWith("in_review");
      });
    });
  });

  describe("sent status actions", () => {
    it("renders Send to Customer and Reopen buttons", () => {
      render(<ReviewActions {...defaultProps} status="sent" />);

      expect(
        screen.getByRole("button", { name: /send to customer/i }),
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
    it("shows error toast on finalize failure", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          json: () => Promise.resolve({ error: "Missing PDF" }),
        }),
      );

      const user = userEvent.setup();
      render(<ReviewActions {...defaultProps} status="in_review" />);

      await user.click(
        screen.getByRole("button", { name: /finalize report/i }),
      );
      await user.click(screen.getByRole("button", { name: /^finalize$/i }));

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith("Missing PDF");
      });
    });

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
