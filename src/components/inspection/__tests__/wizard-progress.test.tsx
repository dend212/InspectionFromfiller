import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@/lib/constants/inspection", () => ({
  STEP_LABELS: [
    "Facility Info",
    "General Treatment",
    "Design Flow",
    "Septic Tank",
    "Disposal Works",
  ],
}));

import { WizardProgress } from "@/components/inspection/wizard-progress";

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("WizardProgress", () => {
  describe("rendering", () => {
    it("renders without crashing", () => {
      render(<WizardProgress currentStep={0} />);
      expect(
        screen.getByLabelText(/inspection form progress/i),
      ).toBeInTheDocument();
    });

    it("renders all step labels", () => {
      render(<WizardProgress currentStep={0} />);

      expect(screen.getByText("Facility Info")).toBeInTheDocument();
      expect(screen.getByText("General Treatment")).toBeInTheDocument();
      expect(screen.getByText("Design Flow")).toBeInTheDocument();
      expect(screen.getByText("Septic Tank")).toBeInTheDocument();
      expect(screen.getByText("Disposal Works")).toBeInTheDocument();
    });

    it("renders step numbers", () => {
      render(<WizardProgress currentStep={0} />);

      expect(screen.getByText("1")).toBeInTheDocument();
      expect(screen.getByText("2")).toBeInTheDocument();
      expect(screen.getByText("3")).toBeInTheDocument();
      expect(screen.getByText("4")).toBeInTheDocument();
      expect(screen.getByText("5")).toBeInTheDocument();
    });
  });

  describe("accessibility", () => {
    it("has nav element with accessible label", () => {
      render(<WizardProgress currentStep={0} />);
      expect(
        screen.getByRole("navigation", { name: /inspection form progress/i }),
      ).toBeInTheDocument();
    });

    it("marks current step with aria-current=step", () => {
      render(<WizardProgress currentStep={2} />);

      const stepButton = screen.getByLabelText(/step 3: design flow \(current\)/i);
      expect(stepButton).toHaveAttribute("aria-current", "step");
    });

    it("includes (completed) in aria-label for completed steps", () => {
      render(<WizardProgress currentStep={2} />);

      expect(
        screen.getByLabelText(/step 1: facility info \(completed\)/i),
      ).toBeInTheDocument();
      expect(
        screen.getByLabelText(/step 2: general treatment \(completed\)/i),
      ).toBeInTheDocument();
    });

    it("does not mark future steps as current or completed", () => {
      render(<WizardProgress currentStep={0} />);

      const step3 = screen.getByLabelText(/step 3: design flow$/i);
      expect(step3).not.toHaveAttribute("aria-current");
    });
  });

  describe("step click", () => {
    it("calls onStepClick with correct index", async () => {
      const onStepClick = vi.fn();
      const user = userEvent.setup();
      render(<WizardProgress currentStep={0} onStepClick={onStepClick} />);

      await user.click(screen.getByText("3"));

      expect(onStepClick).toHaveBeenCalledWith(2);
    });

    it("calls onStepClick for each step", async () => {
      const onStepClick = vi.fn();
      const user = userEvent.setup();
      render(<WizardProgress currentStep={2} onStepClick={onStepClick} />);

      await user.click(screen.getByText("1"));
      expect(onStepClick).toHaveBeenCalledWith(0);

      await user.click(screen.getByText("5"));
      expect(onStepClick).toHaveBeenCalledWith(4);
    });

    it("does not crash when onStepClick is not provided", async () => {
      const user = userEvent.setup();
      render(<WizardProgress currentStep={0} />);

      // Should not throw
      await user.click(screen.getByText("3"));
    });
  });

  describe("step states", () => {
    it("step 0 is current when currentStep=0", () => {
      render(<WizardProgress currentStep={0} />);

      const step1 = screen.getByLabelText(/step 1: facility info \(current\)/i);
      expect(step1).toHaveAttribute("aria-current", "step");
    });

    it("steps before current are completed", () => {
      render(<WizardProgress currentStep={3} />);

      expect(
        screen.getByLabelText(/step 1: facility info \(completed\)/i),
      ).toBeInTheDocument();
      expect(
        screen.getByLabelText(/step 2: general treatment \(completed\)/i),
      ).toBeInTheDocument();
      expect(
        screen.getByLabelText(/step 3: design flow \(completed\)/i),
      ).toBeInTheDocument();
    });

    it("last step can be current", () => {
      render(<WizardProgress currentStep={4} />);

      expect(
        screen.getByLabelText(/step 5: disposal works \(current\)/i),
      ).toHaveAttribute("aria-current", "step");
    });
  });
});
