import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ReviewSection } from "@/components/review/review-section";

describe("ReviewSection", () => {
  describe("rendering", () => {
    it("renders without crashing", () => {
      render(
        <ReviewSection title="Facility Info">
          <p>Content here</p>
        </ReviewSection>,
      );
      expect(screen.getByText("Facility Info")).toBeInTheDocument();
    });

    it("renders the title", () => {
      render(
        <ReviewSection title="Septic Tank Details">
          <p>Tank info</p>
        </ReviewSection>,
      );
      expect(screen.getByText("Septic Tank Details")).toBeInTheDocument();
    });
  });

  describe("default closed state", () => {
    it("does not show children by default", () => {
      render(
        <ReviewSection title="Section">
          <p>Hidden content</p>
        </ReviewSection>,
      );
      // Content may be in the DOM but hidden via Radix collapsible
      const content = screen.queryByText("Hidden content");
      if (content) {
        // If in DOM, it should not be visible
        expect(content).not.toBeVisible();
      } else {
        // Or it may not be rendered at all
        expect(content).toBeNull();
      }
    });
  });

  describe("default open state", () => {
    it("shows children when defaultOpen=true", () => {
      render(
        <ReviewSection title="Section" defaultOpen={true}>
          <p>Visible content</p>
        </ReviewSection>,
      );
      expect(screen.getByText("Visible content")).toBeVisible();
    });
  });

  describe("toggle behavior", () => {
    it("opens section when header is clicked", async () => {
      const user = userEvent.setup();
      render(
        <ReviewSection title="Clickable Section">
          <p>Now visible</p>
        </ReviewSection>,
      );

      // Click the title to expand
      await user.click(screen.getByText("Clickable Section"));

      expect(screen.getByText("Now visible")).toBeVisible();
    });

    it("closes section when header is clicked again", async () => {
      const user = userEvent.setup();
      render(
        <ReviewSection title="Toggle Section" defaultOpen={true}>
          <p>Toggle content</p>
        </ReviewSection>,
      );

      expect(screen.getByText("Toggle content")).toBeVisible();

      // Click to close
      await user.click(screen.getByText("Toggle Section"));

      // Content should be hidden or removed
      const content = screen.queryByText("Toggle content");
      if (content) {
        expect(content).not.toBeVisible();
      } else {
        expect(content).toBeNull();
      }
    });
  });

  describe("children content", () => {
    it("renders arbitrary children when open", () => {
      render(
        <ReviewSection title="Test" defaultOpen={true}>
          <div data-testid="child-1">Child 1</div>
          <div data-testid="child-2">Child 2</div>
        </ReviewSection>,
      );

      expect(screen.getByTestId("child-1")).toBeInTheDocument();
      expect(screen.getByTestId("child-2")).toBeInTheDocument();
    });

    it("renders complex nested content", () => {
      render(
        <ReviewSection title="Complex" defaultOpen={true}>
          <ul>
            <li>Item 1</li>
            <li>Item 2</li>
            <li>Item 3</li>
          </ul>
        </ReviewSection>,
      );

      expect(screen.getByText("Item 1")).toBeInTheDocument();
      expect(screen.getByText("Item 2")).toBeInTheDocument();
      expect(screen.getByText("Item 3")).toBeInTheDocument();
    });
  });
});
