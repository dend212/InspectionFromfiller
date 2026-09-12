import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PhotoSelection } from "@/components/review/photo-selection";

const media = [
  { id: "p1", type: "photo" as const, storagePath: "a", label: "septic-tank", description: null, sortOrder: 0, createdAt: "2026-09-01T00:00:00.000Z", signedUrl: null },
  { id: "p2", type: "photo" as const, storagePath: "b", label: "facility-info", description: "Lid", sortOrder: 1, createdAt: "2026-09-01T00:00:00.000Z", signedUrl: null },
  { id: "v1", type: "video" as const, storagePath: "c", label: "video", description: null, sortOrder: 2, createdAt: "2026-09-01T00:00:00.000Z", signedUrl: null },
];

const baseProps = {
  inspectionId: "insp-1",
  media,
  selectedIds: new Set(["p1"]),
  onToggle: vi.fn(),
  onSelectAll: vi.fn(),
  onDeselectAll: vi.fn(),
  onDescriptionSaved: vi.fn(),
  readOnly: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});

describe("PhotoSelection", () => {
  it("shows the selected count, toggles photos and lists videos", async () => {
    const user = userEvent.setup();
    render(<PhotoSelection {...baseProps} />);

    expect(screen.getByText("Photos (1 of 2 selected for the report)")).toBeInTheDocument();
    expect(screen.getByText("video")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /include facility-info/i }));
    expect(baseProps.onToggle).toHaveBeenCalledWith("p2");

    await user.click(screen.getByRole("button", { name: /^select all$/i }));
    expect(baseProps.onSelectAll).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /deselect all/i }));
    expect(baseProps.onDeselectAll).toHaveBeenCalled();
  });

  it("edits a caption: PATCHes the media route and reports the saved description", async () => {
    const user = userEvent.setup();
    render(<PhotoSelection {...baseProps} />);

    await user.click(screen.getByRole("button", { name: "Lid" }));
    const input = screen.getByPlaceholderText("Add description…");
    await user.clear(input);
    await user.type(input, "Outlet lid{Enter}");

    await waitFor(() => expect(baseProps.onDescriptionSaved).toHaveBeenCalledWith("p2", "Outlet lid"));
    expect(fetch).toHaveBeenCalledWith("/api/inspections/insp-1/media", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mediaId: "p2", description: "Outlet lid" }),
    });
  });

  it("readOnly: hides Select/Deselect All and disables the photo buttons", () => {
    render(<PhotoSelection {...baseProps} readOnly />);
    expect(screen.queryByRole("button", { name: /^select all$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /exclude septic-tank/i })).toBeDisabled();
  });

  it("renders nothing without media", () => {
    const { container } = render(<PhotoSelection {...baseProps} media={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
