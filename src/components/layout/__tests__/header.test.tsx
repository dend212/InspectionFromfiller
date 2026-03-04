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
  usePathname: () => "/",
}));

let getSessionResult: any = { data: { session: null } };
const mockSignOut = vi.fn().mockResolvedValue({});
const mockUnsubscribe = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: () => Promise.resolve(getSessionResult),
      onAuthStateChange: (_callback: any) => ({
        data: {
          subscription: {
            unsubscribe: mockUnsubscribe,
          },
        },
      }),
      signOut: mockSignOut,
    },
  }),
}));

// Mock MobileNav to simplify
vi.mock("@/components/layout/mobile-nav", () => ({
  MobileNav: ({ open }: { open: boolean }) =>
    open ? <div data-testid="mobile-nav">Mobile Nav</div> : null,
}));

import { Header } from "@/components/layout/header";

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.restoreAllMocks();
  mockPush.mockClear();
  mockRefresh.mockClear();
  mockSignOut.mockClear().mockResolvedValue({});
  getSessionResult = { data: { session: null } };
});

describe("Header", () => {
  describe("rendering", () => {
    it("renders without crashing", () => {
      render(<Header />);
      expect(screen.getByAltText("SewerTime")).toBeInTheDocument();
    });

    it("renders logo", () => {
      render(<Header />);
      expect(screen.getByAltText("SewerTime")).toBeInTheDocument();
    });

    it("renders sign out button", () => {
      render(<Header />);
      expect(screen.getByText("Sign Out")).toBeInTheDocument();
    });

    it("renders mobile menu button with accessible label", () => {
      render(<Header />);
      expect(
        screen.getByRole("button", { name: /open navigation menu/i }),
      ).toBeInTheDocument();
    });
  });

  describe("user email display", () => {
    it("shows user email when session exists", async () => {
      getSessionResult = {
        data: {
          session: { user: { email: "admin@example.com" } },
        },
      };

      render(<Header />);

      await waitFor(() => {
        expect(screen.getByText("admin@example.com")).toBeInTheDocument();
      });
    });

    it("does not show email when no session", async () => {
      getSessionResult = { data: { session: null } };

      render(<Header />);

      // Wait for session check to complete
      await waitFor(() => {
        expect(screen.queryByText(/@/)).not.toBeInTheDocument();
      });
    });
  });

  describe("logout", () => {
    it("calls signOut on sign out button click", async () => {
      const user = userEvent.setup();
      render(<Header />);

      await user.click(screen.getByText("Sign Out"));

      await waitFor(() => {
        expect(mockSignOut).toHaveBeenCalled();
      });
    });

    it("navigates to login page after sign out", async () => {
      const user = userEvent.setup();
      render(<Header />);

      await user.click(screen.getByText("Sign Out"));

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith("/login");
        expect(mockRefresh).toHaveBeenCalled();
      });
    });
  });

  describe("mobile nav toggle", () => {
    it("opens mobile nav when menu button is clicked", async () => {
      const user = userEvent.setup();
      render(<Header />);

      await user.click(
        screen.getByRole("button", { name: /open navigation menu/i }),
      );

      expect(screen.getByTestId("mobile-nav")).toBeInTheDocument();
    });
  });
});
