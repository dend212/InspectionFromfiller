import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WizardNavigation } from "@/components/inspection/wizard-navigation";

// ── Helpers ────────────────────────────────────────────────────────────────────

const defaultProps = {
  currentStep: 1,
  onNext: vi.fn(),
  onBack: vi.fn(),
  isLastStep: false,
  isSubmitting: false,
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("WizardNavigation", () => {
  describe("rendering", () => {
    it("renders without crashing", () => {
      render(<WizardNavigation {...defaultProps} />);
      expect(
        screen.getByRole("button", { name: /next/i }),
      ).toBeInTheDocument();
    });

    it("renders Back button when not on first step", () => {
      render(<WizardNavigation {...defaultProps} currentStep={2} />);
      expect(
        screen.getByRole("button", { name: /back/i }),
      ).toBeInTheDocument();
    });

    it("does not render Back button on first step", () => {
      render(<WizardNavigation {...defaultProps} currentStep={0} />);
      expect(
        screen.queryByRole("button", { name: /back/i }),
      ).not.toBeInTheDocument();
    });

    it("renders Next button when not last step", () => {
      render(<WizardNavigation {...defaultProps} isLastStep={false} />);
      expect(
        screen.getByRole("button", { name: /next/i }),
      ).toBeInTheDocument();
    });

    it("renders Submit button on last step", () => {
      render(<WizardNavigation {...defaultProps} isLastStep={true} />);
      expect(
        screen.getByRole("button", { name: /submit/i }),
      ).toBeInTheDocument();
    });

    it("renders custom submitButton when provided on last step", () => {
      render(
        <WizardNavigation
          {...defaultProps}
          isLastStep={true}
          submitButton={<button>Custom Submit</button>}
        />,
      );
      expect(
        screen.getByRole("button", { name: /custom submit/i }),
      ).toBeInTheDocument();
    });
  });

  describe("navigation actions", () => {
    it("calls onNext when Next is clicked", async () => {
      const onNext = vi.fn();
      const user = userEvent.setup();
      render(<WizardNavigation {...defaultProps} onNext={onNext} />);

      await user.click(screen.getByRole("button", { name: /next/i }));

      expect(onNext).toHaveBeenCalledTimes(1);
    });

    it("calls onBack when Back is clicked", async () => {
      const onBack = vi.fn();
      const user = userEvent.setup();
      render(
        <WizardNavigation {...defaultProps} currentStep={2} onBack={onBack} />,
      );

      await user.click(screen.getByRole("button", { name: /back/i }));

      expect(onBack).toHaveBeenCalledTimes(1);
    });
  });

  describe("save indicator", () => {
    it("shows Saving... when saving is true", () => {
      render(<WizardNavigation {...defaultProps} saving={true} />);
      expect(screen.getByText("Saving...")).toBeInTheDocument();
    });

    it("shows Saved when lastSaved is provided", () => {
      render(
        <WizardNavigation
          {...defaultProps}
          saving={false}
          lastSaved={new Date()}
        />,
      );
      expect(screen.getByText("Saved")).toBeInTheDocument();
    });

    it("shows nothing when not saving and no lastSaved", () => {
      render(
        <WizardNavigation
          {...defaultProps}
          saving={false}
          lastSaved={null}
        />,
      );
      expect(screen.queryByText("Saving...")).not.toBeInTheDocument();
      expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    });

    it("prioritizes Saving over Saved", () => {
      render(
        <WizardNavigation
          {...defaultProps}
          saving={true}
          lastSaved={new Date()}
        />,
      );
      expect(screen.getByText("Saving...")).toBeInTheDocument();
      expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    });
  });

  describe("submitting state", () => {
    it("shows Submitting... text on last step while submitting", () => {
      render(
        <WizardNavigation
          {...defaultProps}
          isLastStep={true}
          isSubmitting={true}
        />,
      );
      expect(screen.getByText("Submitting...")).toBeInTheDocument();
    });

    it("disables submit button while submitting", () => {
      render(
        <WizardNavigation
          {...defaultProps}
          isLastStep={true}
          isSubmitting={true}
        />,
      );
      expect(
        screen.getByRole("button", { name: /submitting/i }),
      ).toBeDisabled();
    });
  });

  describe("button types", () => {
    it("Next button has type=button", () => {
      render(<WizardNavigation {...defaultProps} />);
      expect(screen.getByRole("button", { name: /next/i })).toHaveAttribute(
        "type",
        "button",
      );
    });

    it("Back button has type=button", () => {
      render(<WizardNavigation {...defaultProps} currentStep={2} />);
      expect(screen.getByRole("button", { name: /back/i })).toHaveAttribute(
        "type",
        "button",
      );
    });

    it("Submit button has type=submit on last step", () => {
      render(<WizardNavigation {...defaultProps} isLastStep={true} />);
      expect(
        screen.getByRole("button", { name: /submit/i }),
      ).toHaveAttribute("type", "submit");
    });
  });
});
