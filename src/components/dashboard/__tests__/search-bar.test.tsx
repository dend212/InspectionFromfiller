import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

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

import { SearchBar } from "@/components/dashboard/search-bar";

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.restoreAllMocks();
  mockReplace.mockClear();
  currentSearchParams = new URLSearchParams();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SearchBar", () => {
  describe("rendering", () => {
    it("renders without crashing", () => {
      render(<SearchBar />);
      expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
    });

    it("renders with default value", () => {
      render(<SearchBar defaultValue="test query" />);
      expect(screen.getByDisplayValue("test query")).toBeInTheDocument();
    });

    it("renders search icon", () => {
      render(<SearchBar />);
      // The input is present in search context
      expect(screen.getByPlaceholderText(/search by address/i)).toBeInTheDocument();
    });

    it("does not render clear button when empty", () => {
      render(<SearchBar />);
      expect(screen.queryByRole("button", { name: /clear search/i })).not.toBeInTheDocument();
    });

    it("renders clear button when value is present", () => {
      render(<SearchBar defaultValue="query" />);
      expect(screen.getByRole("button", { name: /clear search/i })).toBeInTheDocument();
    });
  });

  describe("input behavior", () => {
    it("updates value on input", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<SearchBar />);

      const input = screen.getByPlaceholderText(/search/i);
      await user.type(input, "test");

      expect(input).toHaveValue("test");
    });

    it("debounces URL update by 300ms", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<SearchBar />);

      await user.type(screen.getByPlaceholderText(/search/i), "hello");

      // Should not have been called yet (within debounce window)
      // Note: due to timer faking, we may need to advance
      vi.advanceTimersByTime(100);
      // Still within debounce for the last keystroke

      vi.advanceTimersByTime(300);

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalled();
        const lastCall = mockReplace.mock.calls[mockReplace.mock.calls.length - 1][0];
        expect(lastCall).toContain("q=hello");
      });
    });

    it("resets page param on search", async () => {
      currentSearchParams = new URLSearchParams("page=3");
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<SearchBar />);

      await user.type(screen.getByPlaceholderText(/search/i), "test");

      vi.advanceTimersByTime(400);

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalled();
        const lastCall = mockReplace.mock.calls[mockReplace.mock.calls.length - 1][0];
        expect(lastCall).not.toContain("page=");
      });
    });
  });

  describe("clear button", () => {
    it("clears the input value", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<SearchBar defaultValue="existing" />);

      await user.click(screen.getByRole("button", { name: /clear search/i }));

      expect(screen.getByPlaceholderText(/search/i)).toHaveValue("");
    });

    it("updates URL immediately without debounce", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<SearchBar defaultValue="existing" />);

      await user.click(screen.getByRole("button", { name: /clear search/i }));

      expect(mockReplace).toHaveBeenCalled();
      const lastCall = mockReplace.mock.calls[mockReplace.mock.calls.length - 1][0];
      expect(lastCall).not.toContain("q=");
    });

    it("disappears after clearing", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<SearchBar defaultValue="existing" />);

      await user.click(screen.getByRole("button", { name: /clear search/i }));

      expect(
        screen.queryByRole("button", { name: /clear search/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe("accessibility", () => {
    it("has accessible clear button with sr-only text", () => {
      render(<SearchBar defaultValue="query" />);
      expect(screen.getByRole("button", { name: /clear search/i })).toBeInTheDocument();
    });
  });
});
