import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock the validator to control validation results
const mockSafeParse = vi.fn();
vi.mock("@/lib/validators/inspection", () => ({
  inspectionFormSchema: {
    safeParse: (...args: any[]) => mockSafeParse(...args),
  },
}));

import { toast } from "sonner";
import { SubmitForReviewButton } from "@/components/inspection/submit-for-review-button";

// ── Helpers ────────────────────────────────────────────────────────────────────

const makeFormData = () =>
  ({
    facilityInfo: { facilityName: "Test" },
  }) as any;

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.restoreAllMocks();
  mockPush.mockClear();
  mockSafeParse.mockReturnValue({ success: true });
});

describe("SubmitForReviewButton", () => {
  describe("rendering", () => {
    it("renders without crashing", () => {
      render(
        <SubmitForReviewButton
          inspectionId="insp-1"
          formData={makeFormData()}
        />,
      );
      expect(
        screen.getByRole("button", { name: /submit for review/i }),
      ).toBeInTheDocument();
    });

    it("renders with correct text", () => {
      render(
        <SubmitForReviewButton
          inspectionId="insp-1"
          formData={makeFormData()}
        />,
      );
      expect(screen.getByText("Submit for Review")).toBeInTheDocument();
    });

    it("respects disabled prop", () => {
      render(
        <SubmitForReviewButton
          inspectionId="insp-1"
          formData={makeFormData()}
          disabled={true}
        />,
      );
      expect(
        screen.getByRole("button", { name: /submit for review/i }),
      ).toBeDisabled();
    });
  });

  describe("dialog opening", () => {
    it("opens confirmation dialog on click", async () => {
      const user = userEvent.setup();
      render(
        <SubmitForReviewButton
          inspectionId="insp-1"
          formData={makeFormData()}
        />,
      );

      await user.click(
        screen.getByRole("button", { name: /submit for review/i }),
      );

      expect(screen.getByText("Submit for Review?")).toBeInTheDocument();
    });

    it("shows confirmation text when no validation warnings", async () => {
      mockSafeParse.mockReturnValue({ success: true });
      const user = userEvent.setup();
      render(
        <SubmitForReviewButton
          inspectionId="insp-1"
          formData={makeFormData()}
        />,
      );

      await user.click(
        screen.getByRole("button", { name: /submit for review/i }),
      );

      expect(
        screen.getByText(/submit this inspection for review/i),
      ).toBeInTheDocument();
    });

    it("shows validation warnings when present", async () => {
      mockSafeParse.mockReturnValue({
        success: false,
        error: {
          issues: [
            { path: ["facilityInfo", "facilityName"], message: "Required" },
            { path: ["septicTank", "numberOfTanks"], message: "Must be positive" },
          ],
        },
      });

      const user = userEvent.setup();
      render(
        <SubmitForReviewButton
          inspectionId="insp-1"
          formData={makeFormData()}
        />,
      );

      await user.click(
        screen.getByRole("button", { name: /submit for review/i }),
      );

      expect(
        screen.getByText("facilityInfo > facilityName: Required"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("septicTank > numberOfTanks: Must be positive"),
      ).toBeInTheDocument();
    });

    it("shows Submit Anyway when there are warnings", async () => {
      mockSafeParse.mockReturnValue({
        success: false,
        error: {
          issues: [{ path: ["field"], message: "Required" }],
        },
      });

      const user = userEvent.setup();
      render(
        <SubmitForReviewButton
          inspectionId="insp-1"
          formData={makeFormData()}
        />,
      );

      await user.click(
        screen.getByRole("button", { name: /submit for review/i }),
      );

      expect(
        screen.getByRole("button", { name: /submit anyway/i }),
      ).toBeInTheDocument();
    });

    it("shows Submit when there are no warnings", async () => {
      mockSafeParse.mockReturnValue({ success: true });
      const user = userEvent.setup();
      render(
        <SubmitForReviewButton
          inspectionId="insp-1"
          formData={makeFormData()}
        />,
      );

      await user.click(
        screen.getByRole("button", { name: /submit for review/i }),
      );

      // The dialog should have a "Submit" button (not "Submit Anyway")
      const buttons = screen.getAllByRole("button");
      const submitButton = buttons.find(
        (b) => b.textContent === "Submit",
      );
      expect(submitButton).toBeTruthy();
    });
  });

  describe("submission", () => {
    it("calls submit API on confirmation", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({}),
        }),
      );

      const user = userEvent.setup();
      render(
        <SubmitForReviewButton
          inspectionId="insp-1"
          formData={makeFormData()}
        />,
      );

      await user.click(
        screen.getByRole("button", { name: /submit for review/i }),
      );

      // Click Submit in dialog
      const submitBtn = screen.getByRole("button", { name: /^submit$/i });
      await user.click(submitBtn);

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          "/api/inspections/insp-1/submit",
          { method: "POST" },
        );
      });
    });

    it("shows success toast and navigates on success", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({}),
        }),
      );

      const user = userEvent.setup();
      render(
        <SubmitForReviewButton
          inspectionId="insp-1"
          formData={makeFormData()}
        />,
      );

      await user.click(
        screen.getByRole("button", { name: /submit for review/i }),
      );
      await user.click(screen.getByRole("button", { name: /^submit$/i }));

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith(
          "Inspection submitted for review",
        );
        expect(mockPush).toHaveBeenCalledWith("/inspections");
      });
    });

    it("shows error toast on failure", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          json: () => Promise.resolve({ error: "Not authorized" }),
        }),
      );

      const user = userEvent.setup();
      render(
        <SubmitForReviewButton
          inspectionId="insp-1"
          formData={makeFormData()}
        />,
      );

      await user.click(
        screen.getByRole("button", { name: /submit for review/i }),
      );
      await user.click(screen.getByRole("button", { name: /^submit$/i }));

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith("Not authorized");
      });
    });

    it("renders Cancel button in dialog", async () => {
      const user = userEvent.setup();
      render(
        <SubmitForReviewButton
          inspectionId="insp-1"
          formData={makeFormData()}
        />,
      );

      await user.click(
        screen.getByRole("button", { name: /submit for review/i }),
      );

      expect(
        screen.getByRole("button", { name: /cancel/i }),
      ).toBeInTheDocument();
    });
  });
});
