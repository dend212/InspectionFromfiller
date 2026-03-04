import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────────

let mockRole: string | null = null;
let mockLoading = false;

vi.mock("@/hooks/use-user-role", () => ({
  useUserRole: () => ({ role: mockRole, loading: mockLoading }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

vi.mock("next/link", () => ({
  default: ({ children, href, onClick, ...props }: any) => (
    <a href={href} onClick={onClick} {...props}>
      {children}
    </a>
  ),
}));

import { MobileNav } from "@/components/layout/mobile-nav";

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockRole = null;
  mockLoading = false;
});

describe("MobileNav", () => {
  describe("loading state", () => {
    it("renders nothing while loading", () => {
      mockLoading = true;
      mockRole = null;

      const { container } = render(
        <MobileNav open={true} onOpenChange={vi.fn()} />,
      );
      expect(container.firstChild).toBeNull();
    });
  });

  describe("no role", () => {
    it("renders nothing when role is null", () => {
      mockLoading = false;
      mockRole = null;

      const { container } = render(
        <MobileNav open={true} onOpenChange={vi.fn()} />,
      );
      expect(container.firstChild).toBeNull();
    });
  });

  describe("admin role", () => {
    it("shows admin nav items when open", () => {
      mockRole = "admin";

      render(<MobileNav open={true} onOpenChange={vi.fn()} />);

      expect(screen.getByText("Dashboard")).toBeInTheDocument();
      expect(screen.getByText("New Inspection")).toBeInTheDocument();
      expect(screen.getByText("All Inspections")).toBeInTheDocument();
      expect(screen.getByText("Review Queue")).toBeInTheDocument();
      expect(screen.getByText("Manage Users")).toBeInTheDocument();
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });
  });

  describe("field_tech role", () => {
    it("shows field tech nav items", () => {
      mockRole = "field_tech";

      render(<MobileNav open={true} onOpenChange={vi.fn()} />);

      expect(screen.getByText("Dashboard")).toBeInTheDocument();
      expect(screen.getByText("New Inspection")).toBeInTheDocument();
      expect(screen.getByText("My Inspections")).toBeInTheDocument();
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    it("does not show admin-only items", () => {
      mockRole = "field_tech";

      render(<MobileNav open={true} onOpenChange={vi.fn()} />);

      expect(screen.queryByText("Review Queue")).not.toBeInTheDocument();
      expect(screen.queryByText("Manage Users")).not.toBeInTheDocument();
    });
  });

  describe("link clicking", () => {
    it("calls onOpenChange(false) when a nav item is clicked", async () => {
      mockRole = "admin";
      const onOpenChange = vi.fn();
      const user = userEvent.setup();

      render(<MobileNav open={true} onOpenChange={onOpenChange} />);

      await user.click(screen.getByText("Dashboard"));

      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  describe("nav links", () => {
    it("renders correct href for each nav item", () => {
      mockRole = "admin";

      render(<MobileNav open={true} onOpenChange={vi.fn()} />);

      expect(screen.getByText("Dashboard").closest("a")).toHaveAttribute("href", "/");
      expect(screen.getByText("Review Queue").closest("a")).toHaveAttribute(
        "href",
        "/review",
      );
    });
  });

  describe("logo", () => {
    it("renders the logo in the header", () => {
      mockRole = "admin";

      render(<MobileNav open={true} onOpenChange={vi.fn()} />);

      expect(screen.getByAltText("SewerTime")).toBeInTheDocument();
    });
  });
});
