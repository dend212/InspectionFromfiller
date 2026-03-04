import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockPush = vi.fn();
const mockReplace = vi.fn();
const mockRefresh = vi.fn();
let currentSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    refresh: mockRefresh,
  }),
  useSearchParams: () => currentSearchParams,
  usePathname: () => "/",
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  InspectionsTable,
  type InspectionRow,
} from "@/components/dashboard/inspections-table";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeInspection(overrides: Partial<InspectionRow> = {}): InspectionRow {
  return {
    id: "insp-1",
    facilityAddress: "123 Main St",
    customerName: "John Doe",
    status: "draft",
    inspectorName: "Jane Inspector",
    createdAt: "2024-01-15T10:00:00Z",
    completedAt: null,
    finalizedPdfPath: null,
    emailSentCount: 0,
    isFromWorkiz: false,
    ...overrides,
  };
}

const defaultProps = {
  inspections: [makeInspection()],
  sortColumn: "date",
  sortOrder: "desc",
  isPrivileged: false,
  page: 1,
  totalPages: 1,
  totalCount: 1,
};

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.restoreAllMocks();
  mockPush.mockClear();
  mockReplace.mockClear();
  mockRefresh.mockClear();
  currentSearchParams = new URLSearchParams();
});

describe("InspectionsTable", () => {
  describe("rendering", () => {
    it("renders without crashing", () => {
      render(<InspectionsTable {...defaultProps} />);
      expect(screen.getByText("123 Main St")).toBeInTheDocument();
    });

    it("renders all column headers", () => {
      render(<InspectionsTable {...defaultProps} />);

      expect(screen.getByText("Address")).toBeInTheDocument();
      expect(screen.getByText("Date")).toBeInTheDocument();
      expect(screen.getByText("Customer Name")).toBeInTheDocument();
      expect(screen.getByText("Status")).toBeInTheDocument();
      expect(screen.getByText("Inspector")).toBeInTheDocument();
      expect(screen.getByText("Sent")).toBeInTheDocument();
    });

    it("renders inspection data in rows", () => {
      render(<InspectionsTable {...defaultProps} />);

      expect(screen.getByText("123 Main St")).toBeInTheDocument();
      expect(screen.getByText("John Doe")).toBeInTheDocument();
      expect(screen.getByText("Jane Inspector")).toBeInTheDocument();
    });

    it("renders 'No address' when facilityAddress is null", () => {
      render(
        <InspectionsTable
          {...defaultProps}
          inspections={[makeInspection({ facilityAddress: null })]}
        />,
      );

      expect(screen.getByText("No address")).toBeInTheDocument();
    });

    it("renders em-dash when customerName is null", () => {
      render(
        <InspectionsTable
          {...defaultProps}
          inspections={[makeInspection({ customerName: null })]}
        />,
      );

      // Multiple em-dashes may appear (customerName + sent column)
      const dashes = screen.getAllByText("\u2014");
      expect(dashes.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("status badges", () => {
    it("renders Draft badge for draft status", () => {
      render(
        <InspectionsTable
          {...defaultProps}
          inspections={[makeInspection({ status: "draft" })]}
        />,
      );
      expect(screen.getByText("Draft")).toBeInTheDocument();
    });

    it("renders In Review badge for in_review status", () => {
      render(
        <InspectionsTable
          {...defaultProps}
          inspections={[makeInspection({ status: "in_review" })]}
        />,
      );
      expect(screen.getByText("In Review")).toBeInTheDocument();
    });

    it("renders Complete badge for completed status", () => {
      render(
        <InspectionsTable
          {...defaultProps}
          inspections={[makeInspection({ status: "completed" })]}
        />,
      );
      expect(screen.getByText("Complete")).toBeInTheDocument();
    });

    it("renders Sent badge for sent status", () => {
      render(
        <InspectionsTable
          {...defaultProps}
          inspections={[makeInspection({ status: "sent" })]}
        />,
      );
      // "Sent" appears as both column header and badge - check for at least 2
      const sentElements = screen.getAllByText("Sent");
      expect(sentElements.length).toBeGreaterThanOrEqual(2);
    });

    it("renders Workiz badge when isFromWorkiz=true", () => {
      render(
        <InspectionsTable
          {...defaultProps}
          inspections={[makeInspection({ isFromWorkiz: true })]}
        />,
      );
      expect(screen.getByText("Workiz")).toBeInTheDocument();
    });
  });

  describe("email sent column", () => {
    it("shows check mark and count when emails sent", () => {
      render(
        <InspectionsTable
          {...defaultProps}
          inspections={[makeInspection({ emailSentCount: 3 })]}
        />,
      );
      expect(screen.getByText("3")).toBeInTheDocument();
    });

    it("shows Ready when PDF exists but no emails sent", () => {
      render(
        <InspectionsTable
          {...defaultProps}
          inspections={[
            makeInspection({
              emailSentCount: 0,
              finalizedPdfPath: "/some/path.pdf",
            }),
          ]}
        />,
      );
      expect(screen.getByText("Ready")).toBeInTheDocument();
    });
  });

  describe("empty state", () => {
    it("shows empty state when no inspections", () => {
      render(
        <InspectionsTable {...defaultProps} inspections={[]} totalCount={0} />,
      );

      expect(screen.getByText("No inspections found")).toBeInTheDocument();
      expect(
        screen.getByText("Try adjusting your search or filters"),
      ).toBeInTheDocument();
    });

    it("shows Clear Filters button in empty state", () => {
      render(
        <InspectionsTable {...defaultProps} inspections={[]} totalCount={0} />,
      );

      expect(
        screen.getByRole("button", { name: /clear filters/i }),
      ).toBeInTheDocument();
    });

    it("clears filters when Clear Filters is clicked", async () => {
      const user = userEvent.setup();
      render(
        <InspectionsTable {...defaultProps} inspections={[]} totalCount={0} />,
      );

      await user.click(screen.getByRole("button", { name: /clear filters/i }));

      expect(mockReplace).toHaveBeenCalledWith("/");
    });
  });

  describe("sorting", () => {
    it("toggles sort direction when clicking current sort column", async () => {
      const user = userEvent.setup();
      render(<InspectionsTable {...defaultProps} sortColumn="date" sortOrder="desc" />);

      await user.click(screen.getByText("Date"));

      expect(mockReplace).toHaveBeenCalledWith(expect.stringContaining("order=asc"));
    });

    it("sets new sort column with asc when clicking different column", async () => {
      const user = userEvent.setup();
      render(<InspectionsTable {...defaultProps} sortColumn="date" sortOrder="desc" />);

      await user.click(screen.getByText("Address"));

      expect(mockReplace).toHaveBeenCalledWith(
        expect.stringContaining("sort=address"),
      );
      expect(mockReplace).toHaveBeenCalledWith(
        expect.stringContaining("order=asc"),
      );
    });
  });

  describe("row click navigation", () => {
    it("navigates to edit page for draft inspection", async () => {
      const user = userEvent.setup();
      render(<InspectionsTable {...defaultProps} />);

      await user.click(screen.getByText("123 Main St"));

      expect(mockPush).toHaveBeenCalledWith("/inspections/insp-1/edit");
    });

    it("navigates to review page for privileged user with non-draft", async () => {
      const user = userEvent.setup();
      render(
        <InspectionsTable
          {...defaultProps}
          isPrivileged={true}
          inspections={[makeInspection({ status: "in_review" })]}
        />,
      );

      await user.click(screen.getByText("123 Main St"));

      expect(mockPush).toHaveBeenCalledWith("/review/insp-1");
    });

    it("navigates to view page for non-privileged user with non-draft", async () => {
      const user = userEvent.setup();
      render(
        <InspectionsTable
          {...defaultProps}
          isPrivileged={false}
          inspections={[makeInspection({ status: "completed" })]}
        />,
      );

      await user.click(screen.getByText("123 Main St"));

      expect(mockPush).toHaveBeenCalledWith("/inspections/insp-1");
    });
  });

  describe("pagination", () => {
    it("shows page count", () => {
      render(
        <InspectionsTable
          {...defaultProps}
          page={1}
          totalPages={5}
          totalCount={100}
        />,
      );

      expect(screen.getByText(/showing 1/i)).toBeInTheDocument();
    });

    it("disables Previous on first page", () => {
      render(
        <InspectionsTable {...defaultProps} page={1} totalPages={5} totalCount={100} />,
      );

      expect(screen.getByRole("button", { name: /previous/i })).toBeDisabled();
    });

    it("disables Next on last page", () => {
      render(
        <InspectionsTable {...defaultProps} page={5} totalPages={5} totalCount={100} />,
      );

      expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
    });

    it("navigates to next page", async () => {
      const user = userEvent.setup();
      render(
        <InspectionsTable {...defaultProps} page={1} totalPages={5} totalCount={100} />,
      );

      await user.click(screen.getByRole("button", { name: /next/i }));

      expect(mockReplace).toHaveBeenCalledWith(expect.stringContaining("page=2"));
    });
  });

  describe("checkbox selection", () => {
    it("renders select all checkbox", () => {
      render(<InspectionsTable {...defaultProps} />);

      expect(
        screen.getByRole("checkbox", { name: /select all inspections/i }),
      ).toBeInTheDocument();
    });

    it("renders per-row checkboxes", () => {
      render(<InspectionsTable {...defaultProps} />);

      expect(
        screen.getByRole("checkbox", { name: /select inspection at 123 main st/i }),
      ).toBeInTheDocument();
    });

    it("shows bulk action bar when items are selected", async () => {
      const user = userEvent.setup();
      render(
        <InspectionsTable
          {...defaultProps}
          inspections={[
            makeInspection({ id: "1" }),
            makeInspection({ id: "2", facilityAddress: "456 Oak Ave" }),
          ]}
          totalCount={2}
        />,
      );

      await user.click(
        screen.getByRole("checkbox", { name: /select inspection at 123 main st/i }),
      );

      expect(screen.getByText("1 selected")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /deselect all/i }),
      ).toBeInTheDocument();
    });
  });

  describe("multiple inspections", () => {
    it("renders multiple rows", () => {
      render(
        <InspectionsTable
          {...defaultProps}
          inspections={[
            makeInspection({ id: "1", facilityAddress: "111 First St" }),
            makeInspection({ id: "2", facilityAddress: "222 Second St" }),
            makeInspection({ id: "3", facilityAddress: "333 Third St" }),
          ]}
          totalCount={3}
        />,
      );

      expect(screen.getByText("111 First St")).toBeInTheDocument();
      expect(screen.getByText("222 Second St")).toBeInTheDocument();
      expect(screen.getByText("333 Third St")).toBeInTheDocument();
    });
  });
});
