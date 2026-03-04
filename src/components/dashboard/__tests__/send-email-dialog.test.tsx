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
import { SendEmailDialog } from "@/components/dashboard/send-email-dialog";

// ── Helpers ────────────────────────────────────────────────────────────────────

const defaultProps = {
  inspectionId: "insp-1",
  facilityAddress: "123 Main St",
  customerEmail: "customer@example.com",
  open: true,
  onOpenChange: vi.fn(),
};

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    }),
  );
});

describe("SendEmailDialog", () => {
  describe("rendering", () => {
    it("renders without crashing when open", () => {
      render(<SendEmailDialog {...defaultProps} />);
      expect(screen.getByText("Send Report to Customer")).toBeInTheDocument();
    });

    it("renders recipient email field pre-filled", () => {
      render(<SendEmailDialog {...defaultProps} />);
      expect(screen.getByLabelText("Recipient Email")).toHaveValue("customer@example.com");
    });

    it("renders subject field with address", () => {
      render(<SendEmailDialog {...defaultProps} />);
      expect(screen.getByLabelText("Subject")).toHaveValue(
        "Inspection Report - 123 Main St",
      );
    });

    it("uses fallback subject when address is null", () => {
      render(<SendEmailDialog {...defaultProps} facilityAddress={null} />);
      expect(screen.getByLabelText("Subject")).toHaveValue(
        "Inspection Report - Property Inspection",
      );
    });

    it("renders personal note field", () => {
      render(<SendEmailDialog {...defaultProps} />);
      expect(screen.getByLabelText(/personal note/i)).toBeInTheDocument();
    });

    it("renders email preview", () => {
      render(<SendEmailDialog {...defaultProps} />);
      expect(screen.getByText(/dear customer/i)).toBeInTheDocument();
      expect(screen.getByText(/123 main st/i)).toBeInTheDocument();
    });

    it("renders cancel and send buttons", () => {
      render(<SendEmailDialog {...defaultProps} />);
      expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /send email/i })).toBeInTheDocument();
    });

    it("renders description text", () => {
      render(<SendEmailDialog {...defaultProps} />);
      expect(
        screen.getByText(/send the finalized inspection report/i),
      ).toBeInTheDocument();
    });
  });

  describe("email validation", () => {
    it("disables send button when email is empty", async () => {
      const user = userEvent.setup();
      render(<SendEmailDialog {...defaultProps} customerEmail="" />);

      expect(screen.getByRole("button", { name: /send email/i })).toBeDisabled();
    });

    it("disables send button when email has no @ sign", async () => {
      const user = userEvent.setup();
      render(<SendEmailDialog {...defaultProps} customerEmail="notanemail" />);

      expect(screen.getByRole("button", { name: /send email/i })).toBeDisabled();
    });

    it("enables send button with valid email", () => {
      render(<SendEmailDialog {...defaultProps} />);

      expect(screen.getByRole("button", { name: /send email/i })).not.toBeDisabled();
    });
  });

  describe("form input", () => {
    it("allows editing recipient email", async () => {
      const user = userEvent.setup();
      render(<SendEmailDialog {...defaultProps} />);

      const input = screen.getByLabelText("Recipient Email");
      await user.clear(input);
      await user.type(input, "new@example.com");

      expect(input).toHaveValue("new@example.com");
    });

    it("allows editing subject", async () => {
      const user = userEvent.setup();
      render(<SendEmailDialog {...defaultProps} />);

      const input = screen.getByLabelText("Subject");
      await user.clear(input);
      await user.type(input, "Custom Subject");

      expect(input).toHaveValue("Custom Subject");
    });

    it("allows editing personal note", async () => {
      const user = userEvent.setup();
      render(<SendEmailDialog {...defaultProps} />);

      const textarea = screen.getByLabelText(/personal note/i);
      await user.type(textarea, "Thank you for your business!");

      expect(textarea).toHaveValue("Thank you for your business!");
    });
  });

  describe("sending email", () => {
    it("calls send-email API on submit", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn()
          .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) }) // history fetch
          .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) }), // send
      );

      const user = userEvent.setup();
      const onOpenChange = vi.fn();
      render(<SendEmailDialog {...defaultProps} onOpenChange={onOpenChange} />);

      await user.click(screen.getByRole("button", { name: /send email/i }));

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          "/api/inspections/insp-1/send-email",
          expect.objectContaining({
            method: "POST",
            body: expect.stringContaining("customer@example.com"),
          }),
        );
      });
    });

    it("shows success toast after sending", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn()
          .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) })
          .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) }),
      );

      const user = userEvent.setup();
      render(<SendEmailDialog {...defaultProps} />);

      await user.click(screen.getByRole("button", { name: /send email/i }));

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith(
          expect.stringContaining("customer@example.com"),
        );
      });
    });

    it("closes dialog after successful send", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn()
          .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) })
          .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) }),
      );

      const onOpenChange = vi.fn();
      const user = userEvent.setup();
      render(<SendEmailDialog {...defaultProps} onOpenChange={onOpenChange} />);

      await user.click(screen.getByRole("button", { name: /send email/i }));

      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
    });

    it("shows error toast on failure", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn()
          .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) })
          .mockResolvedValueOnce({
            ok: false,
            json: () => Promise.resolve({ error: "PDF not found" }),
          }),
      );

      const user = userEvent.setup();
      render(<SendEmailDialog {...defaultProps} />);

      await user.click(screen.getByRole("button", { name: /send email/i }));

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith("PDF not found");
      });
    });
  });

  describe("email history", () => {
    it("fetches email history when dialog opens", () => {
      render(<SendEmailDialog {...defaultProps} />);

      expect(fetch).toHaveBeenCalledWith("/api/inspections/insp-1/emails");
    });

    it("renders email history when present", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: "e1",
                recipientEmail: "sent@example.com",
                subject: "Report",
                sentAt: "2024-01-15T10:00:00Z",
                senderName: "Admin",
              },
            ]),
        }),
      );

      render(<SendEmailDialog {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(/previously sent/i)).toBeInTheDocument();
        expect(screen.getByText(/sent@example.com/i)).toBeInTheDocument();
      });
    });
  });

  describe("cancel", () => {
    it("calls onOpenChange(false) when cancel is clicked", async () => {
      const onOpenChange = vi.fn();
      const user = userEvent.setup();
      render(<SendEmailDialog {...defaultProps} onOpenChange={onOpenChange} />);

      await user.click(screen.getByRole("button", { name: /cancel/i }));

      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  describe("closed state", () => {
    it("does not render content when closed", () => {
      render(<SendEmailDialog {...defaultProps} open={false} />);

      expect(screen.queryByText("Send Report to Customer")).not.toBeInTheDocument();
    });
  });
});
