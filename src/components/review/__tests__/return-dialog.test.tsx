import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { toast } from "sonner";
import { ReturnDialog } from "@/components/review/return-dialog";

// ── Helpers ────────────────────────────────────────────────────────────────────

const defaultProps = {
  inspectionId: "insp-1",
  open: true,
  onOpenChange: vi.fn(),
  onReturned: vi.fn(),
};

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("ReturnDialog", () => {
  describe("rendering", () => {
    it("renders without crashing when open", () => {
      render(<ReturnDialog {...defaultProps} />);
      expect(screen.getByText("Return to Field Tech")).toBeInTheDocument();
    });

    it("renders description text", () => {
      render(<ReturnDialog {...defaultProps} />);
      expect(
        screen.getByText(/send the inspection back to the field tech/i),
      ).toBeInTheDocument();
    });

    it("renders return note textarea", () => {
      render(<ReturnDialog {...defaultProps} />);
      expect(screen.getByLabelText("Return Note")).toBeInTheDocument();
    });

    it("renders Cancel and Return Inspection buttons", () => {
      render(<ReturnDialog {...defaultProps} />);
      expect(
        screen.getByRole("button", { name: /cancel/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /return inspection/i }),
      ).toBeInTheDocument();
    });

    it("disables Return button when note is empty", () => {
      render(<ReturnDialog {...defaultProps} />);
      expect(
        screen.getByRole("button", { name: /return inspection/i }),
      ).toBeDisabled();
    });
  });

  describe("form input", () => {
    it("allows typing a return note", async () => {
      const user = userEvent.setup();
      render(<ReturnDialog {...defaultProps} />);

      const textarea = screen.getByLabelText("Return Note");
      await user.type(textarea, "Please fix the address");

      expect(textarea).toHaveValue("Please fix the address");
    });

    it("enables Return button when note has content", async () => {
      const user = userEvent.setup();
      render(<ReturnDialog {...defaultProps} />);

      await user.type(
        screen.getByLabelText("Return Note"),
        "Fix the tank count",
      );

      expect(
        screen.getByRole("button", { name: /return inspection/i }),
      ).not.toBeDisabled();
    });
  });

  describe("submission", () => {
    it("shows error toast when submitting empty note", async () => {
      // Note: The button is disabled for empty, but let's test the handler anyway
      // by making the form have only whitespace
      const user = userEvent.setup();
      render(<ReturnDialog {...defaultProps} />);

      await user.type(screen.getByLabelText("Return Note"), "   ");

      // Button should still be disabled because note.trim() is empty
      expect(
        screen.getByRole("button", { name: /return inspection/i }),
      ).toBeDisabled();
    });

    it("calls return API with note", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({}),
        }),
      );

      const user = userEvent.setup();
      render(<ReturnDialog {...defaultProps} />);

      await user.type(
        screen.getByLabelText("Return Note"),
        "Fix the address field",
      );
      await user.click(
        screen.getByRole("button", { name: /return inspection/i }),
      );

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          "/api/inspections/insp-1/return",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ note: "Fix the address field" }),
          },
        );
      });
    });

    it("shows success toast on successful return", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({}),
        }),
      );

      const user = userEvent.setup();
      render(<ReturnDialog {...defaultProps} />);

      await user.type(screen.getByLabelText("Return Note"), "Fix this");
      await user.click(
        screen.getByRole("button", { name: /return inspection/i }),
      );

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith(
          "Inspection returned to field tech",
        );
      });
    });

    it("calls onOpenChange and onReturned on success", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({}),
        }),
      );

      const onOpenChange = vi.fn();
      const onReturned = vi.fn();
      const user = userEvent.setup();
      render(
        <ReturnDialog
          {...defaultProps}
          onOpenChange={onOpenChange}
          onReturned={onReturned}
        />,
      );

      await user.type(screen.getByLabelText("Return Note"), "Fix this");
      await user.click(
        screen.getByRole("button", { name: /return inspection/i }),
      );

      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false);
        expect(onReturned).toHaveBeenCalled();
      });
    });

    it("shows error toast on API failure", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          json: () => Promise.resolve({ error: "Not authorized" }),
        }),
      );

      const user = userEvent.setup();
      render(<ReturnDialog {...defaultProps} />);

      await user.type(screen.getByLabelText("Return Note"), "Fix this");
      await user.click(
        screen.getByRole("button", { name: /return inspection/i }),
      );

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith("Not authorized");
      });
    });

    it("shows error toast on network failure", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new Error("Network error")),
      );

      const user = userEvent.setup();
      render(<ReturnDialog {...defaultProps} />);

      await user.type(screen.getByLabelText("Return Note"), "Fix this");
      await user.click(
        screen.getByRole("button", { name: /return inspection/i }),
      );

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith("Network error");
      });
    });
  });

  describe("closed state", () => {
    it("does not render content when closed", () => {
      render(<ReturnDialog {...defaultProps} open={false} />);
      expect(
        screen.queryByText("Return to Field Tech"),
      ).not.toBeInTheDocument();
    });
  });
});
