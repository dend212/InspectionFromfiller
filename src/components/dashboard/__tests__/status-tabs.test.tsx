import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockReplace = vi.fn();
let currentSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
  useSearchParams: () => currentSearchParams,
  usePathname: () => "/",
}));

import { StatusTabs } from "@/components/dashboard/status-tabs";

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.restoreAllMocks();
  mockReplace.mockClear();
  currentSearchParams = new URLSearchParams();
});

describe("StatusTabs", () => {
  describe("rendering", () => {
    it("renders without crashing", () => {
      render(<StatusTabs activeStatus="all" />);
      expect(screen.getByText("All")).toBeInTheDocument();
    });

    it("renders all four tab buttons", () => {
      render(<StatusTabs activeStatus="all" />);

      expect(screen.getByText("All")).toBeInTheDocument();
      expect(screen.getByText("Draft")).toBeInTheDocument();
      expect(screen.getByText("In Review")).toBeInTheDocument();
      expect(screen.getByText("Complete")).toBeInTheDocument();
    });

    it("renders counts when provided", () => {
      render(
        <StatusTabs
          activeStatus="all"
          counts={{ all: 42, draft: 10, in_review: 5, completed: 27 }}
        />,
      );

      expect(screen.getByText("42")).toBeInTheDocument();
      expect(screen.getByText("10")).toBeInTheDocument();
      expect(screen.getByText("5")).toBeInTheDocument();
      expect(screen.getByText("27")).toBeInTheDocument();
    });

    it("does not render count badges when counts are not provided", () => {
      render(<StatusTabs activeStatus="all" />);

      // Only 4 buttons, no count badges
      const buttons = screen.getAllByRole("button");
      expect(buttons).toHaveLength(4);
    });
  });

  describe("active state", () => {
    it("highlights the active tab", () => {
      render(<StatusTabs activeStatus="draft" />);

      // The active button should have the default variant
      const draftButton = screen.getByText("Draft").closest("button");
      expect(draftButton).toBeInTheDocument();
    });

    it("highlights 'All' as active by default", () => {
      render(<StatusTabs activeStatus="all" />);

      const allButton = screen.getByText("All").closest("button");
      expect(allButton).toBeInTheDocument();
    });
  });

  describe("tab switching", () => {
    it("navigates to draft status on click", async () => {
      const user = userEvent.setup();
      render(<StatusTabs activeStatus="all" />);

      await user.click(screen.getByText("Draft"));

      expect(mockReplace).toHaveBeenCalledWith(
        expect.stringContaining("status=draft"),
      );
    });

    it("navigates to in_review status on click", async () => {
      const user = userEvent.setup();
      render(<StatusTabs activeStatus="all" />);

      await user.click(screen.getByText("In Review"));

      expect(mockReplace).toHaveBeenCalledWith(
        expect.stringContaining("status=in_review"),
      );
    });

    it("navigates to completed status on click", async () => {
      const user = userEvent.setup();
      render(<StatusTabs activeStatus="all" />);

      await user.click(screen.getByText("Complete"));

      expect(mockReplace).toHaveBeenCalledWith(
        expect.stringContaining("status=completed"),
      );
    });

    it("removes status param when clicking All", async () => {
      const user = userEvent.setup();
      currentSearchParams = new URLSearchParams("status=draft");
      render(<StatusTabs activeStatus="draft" />);

      await user.click(screen.getByText("All"));

      expect(mockReplace).toHaveBeenCalled();
      const url = mockReplace.mock.calls[0][0];
      expect(url).not.toContain("status=");
    });

    it("resets page param on filter change", async () => {
      const user = userEvent.setup();
      currentSearchParams = new URLSearchParams("page=3");
      render(<StatusTabs activeStatus="all" />);

      await user.click(screen.getByText("Draft"));

      const url = mockReplace.mock.calls[0][0];
      expect(url).not.toContain("page=");
    });

    it("preserves other search params", async () => {
      const user = userEvent.setup();
      currentSearchParams = new URLSearchParams("q=test&sort=date");
      render(<StatusTabs activeStatus="all" />);

      await user.click(screen.getByText("Draft"));

      const url = mockReplace.mock.calls[0][0];
      expect(url).toContain("q=test");
      expect(url).toContain("sort=date");
      expect(url).toContain("status=draft");
    });
  });
});
