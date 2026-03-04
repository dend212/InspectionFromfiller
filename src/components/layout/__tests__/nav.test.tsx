import { render, screen, waitFor } from "@testing-library/react";
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
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { Nav } from "@/components/layout/nav";

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockRole = null;
  mockLoading = false;
});

describe("Nav", () => {
  describe("loading state", () => {
    it("renders skeleton placeholders while loading", () => {
      mockLoading = true;
      mockRole = null;

      const { container } = render(<Nav />);

      // Should have animated pulse skeletons
      const skeletons = container.querySelectorAll(".animate-pulse");
      expect(skeletons.length).toBe(4);
    });
  });

  describe("no role", () => {
    it("renders nothing when role is null and not loading", () => {
      mockLoading = false;
      mockRole = null;

      const { container } = render(<Nav />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe("admin role", () => {
    it("shows admin-visible nav items", () => {
      mockRole = "admin";

      render(<Nav />);

      expect(screen.getByText("Dashboard")).toBeInTheDocument();
      expect(screen.getByText("New Inspection")).toBeInTheDocument();
      expect(screen.getByText("All Inspections")).toBeInTheDocument();
      expect(screen.getByText("Review Queue")).toBeInTheDocument();
      expect(screen.getByText("Manage Users")).toBeInTheDocument();
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    it("does not show field_tech-only items", () => {
      mockRole = "admin";

      render(<Nav />);

      expect(screen.queryByText("My Inspections")).not.toBeInTheDocument();
    });
  });

  describe("field_tech role", () => {
    it("shows field tech visible nav items", () => {
      mockRole = "field_tech";

      render(<Nav />);

      expect(screen.getByText("Dashboard")).toBeInTheDocument();
      expect(screen.getByText("New Inspection")).toBeInTheDocument();
      expect(screen.getByText("My Inspections")).toBeInTheDocument();
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    it("does not show admin-only items", () => {
      mockRole = "field_tech";

      render(<Nav />);

      expect(screen.queryByText("Review Queue")).not.toBeInTheDocument();
      expect(screen.queryByText("Manage Users")).not.toBeInTheDocument();
      expect(screen.queryByText("All Inspections")).not.toBeInTheDocument();
    });
  });

  describe("office_staff role", () => {
    it("shows office staff visible nav items", () => {
      mockRole = "office_staff";

      render(<Nav />);

      expect(screen.getByText("Dashboard")).toBeInTheDocument();
      expect(screen.getByText("All Inspections")).toBeInTheDocument();
      expect(screen.getByText("Review Queue")).toBeInTheDocument();
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    it("does not show field_tech-only or admin-only items", () => {
      mockRole = "office_staff";

      render(<Nav />);

      expect(screen.queryByText("New Inspection")).not.toBeInTheDocument();
      expect(screen.queryByText("My Inspections")).not.toBeInTheDocument();
      expect(screen.queryByText("Manage Users")).not.toBeInTheDocument();
    });
  });

  describe("nav links", () => {
    it("renders correct href for each nav item", () => {
      mockRole = "admin";

      render(<Nav />);

      expect(screen.getByText("Dashboard").closest("a")).toHaveAttribute("href", "/");
      expect(screen.getByText("New Inspection").closest("a")).toHaveAttribute(
        "href",
        "/inspections/new",
      );
      expect(screen.getByText("Review Queue").closest("a")).toHaveAttribute(
        "href",
        "/review",
      );
      expect(screen.getByText("Manage Users").closest("a")).toHaveAttribute(
        "href",
        "/admin/users",
      );
    });
  });
});
