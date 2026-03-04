import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ReviewNoteBanner } from "@/components/inspection/review-note-banner";

describe("ReviewNoteBanner", () => {
  describe("rendering", () => {
    it("renders without crashing", () => {
      render(<ReviewNoteBanner note="Please fix the address" />);
      expect(screen.getByText("Review Note")).toBeInTheDocument();
    });

    it("renders the note text", () => {
      render(<ReviewNoteBanner note="Please fix the address field" />);
      expect(
        screen.getByText("Please fix the address field"),
      ).toBeInTheDocument();
    });

    it("renders the Review Note heading", () => {
      render(<ReviewNoteBanner note="Some note" />);
      expect(screen.getByText("Review Note")).toBeInTheDocument();
    });

    it("renders dismiss button with accessible label", () => {
      render(<ReviewNoteBanner note="Some note" />);
      expect(
        screen.getByRole("button", { name: /dismiss/i }),
      ).toBeInTheDocument();
    });
  });

  describe("conditional rendering", () => {
    it("renders nothing when note is null", () => {
      const { container } = render(<ReviewNoteBanner note={null} />);
      expect(container.firstChild).toBeNull();
    });

    it("renders nothing when note is empty string", () => {
      const { container } = render(<ReviewNoteBanner note="" />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe("dismiss behavior", () => {
    it("hides the banner when dismiss button is clicked", async () => {
      const user = userEvent.setup();
      render(<ReviewNoteBanner note="Fix this" />);

      expect(screen.getByText("Fix this")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /dismiss/i }));

      expect(screen.queryByText("Fix this")).not.toBeInTheDocument();
    });

    it("hides both heading and note text on dismiss", async () => {
      const user = userEvent.setup();
      render(<ReviewNoteBanner note="Fix this" />);

      await user.click(screen.getByRole("button", { name: /dismiss/i }));

      expect(screen.queryByText("Review Note")).not.toBeInTheDocument();
      expect(screen.queryByText("Fix this")).not.toBeInTheDocument();
    });
  });

  describe("long note text", () => {
    it("renders long notes without truncation", () => {
      const longNote =
        "This is a very long review note that spans multiple lines and contains detailed instructions about what needs to be fixed in the inspection form before it can be approved.";
      render(<ReviewNoteBanner note={longNote} />);

      expect(screen.getByText(longNote)).toBeInTheDocument();
    });
  });
});
