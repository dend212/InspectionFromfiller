import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));

import { Toaster } from "@/components/ui/sonner";
import NewInspectionPage from "../page";

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const JOBS = {
  jobs: [
    {
      id: "JOB-AbCdEfGhIjKlMnOp",
      serialId: 4696,
      street: "100 E Example Rd",
      city: "Cave Creek",
      scheduledDate: "2026-10-06",
      subStatus: null,
      teamFirstNames: ["Sam"],
      existing: null,
    },
  ],
  fetchedAt: "2026-10-12T17:04:05.000Z",
  role: "field_tech",
  currentUserFirstName: "Sam",
};

beforeAll(() => {
  // sonner reads prefers-color-scheme; jsdom has no matchMedia
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  fetchMock.mockReset();
});

const renderPage = () =>
  render(
    <>
      <NewInspectionPage />
      <Toaster />
    </>,
  );

describe("NewInspectionPage", () => {
  it("shows both buttons and does not call Workiz on load", () => {
    renderPage();
    expect(screen.getByRole("button", { name: "Create New Inspection" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Import from Workiz" })).toBeEnabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Create New Inspection still POSTs /api/inspections and routes to the edit page", async () => {
    fetchMock.mockResolvedValueOnce(reply(201, { id: "insp-1" }));
    renderPage();
    await userEvent.setup().click(screen.getByRole("button", { name: "Create New Inspection" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/inspections", { method: "POST" });
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/inspections/insp-1/edit"));
  });

  it("while creating, Import from Workiz is disabled", async () => {
    fetchMock.mockReturnValueOnce(new Promise(() => {}));
    renderPage();
    await userEvent.setup().click(screen.getByRole("button", { name: "Create New Inspection" }));
    expect(screen.getByRole("button", { name: /Creating/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Import from Workiz" })).toBeDisabled();
  });

  it("while importing, Create New Inspection is disabled", async () => {
    const user = userEvent.setup();
    renderPage();
    fetchMock.mockResolvedValueOnce(reply(200, JOBS));
    await user.click(screen.getByRole("button", { name: "Import from Workiz" }));
    fetchMock.mockReturnValueOnce(new Promise(() => {}));
    await user.click(await screen.findByRole("button", { name: /Import Workiz job 4696/ }));
    expect(screen.getByRole("button", { name: "Create New Inspection" })).toBeDisabled();
  });

  it("a failed create renders the toast text (the Toaster is mounted)", async () => {
    fetchMock.mockResolvedValueOnce(reply(500, { error: "Failed to create inspection" }));
    renderPage();
    await userEvent.setup().click(screen.getByRole("button", { name: "Create New Inspection" }));
    expect(await screen.findByText("Failed to create inspection")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create New Inspection" })).toBeEnabled();
  });
});
