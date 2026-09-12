import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Autosave: spy on the options the shell passes and expose a controllable flush
const autoSaveSpy = vi.fn();
vi.mock("@/hooks/use-auto-save", () => ({
  useAutoSave: (...args: unknown[]) => {
    autoSaveSpy(...args);
    return { saving: false, lastSaved: null, status: "idle", flush: vi.fn(async () => true) };
  },
}));

// Step components: lightweight stubs that mirror the real readOnly contract
// (a <fieldset disabled> wrapper) and expose one data-field-path for jump-to.
function stepStub(index: number, fieldPath: string) {
  return ({ readOnly }: { inspectionId: string; readOnly?: boolean }) => (
    <fieldset disabled={readOnly} data-testid={`step-${index}`}>
      <div data-slot="form-item" data-field-path={fieldPath}>
        <input aria-label={fieldPath} />
      </div>
    </fieldset>
  );
}
vi.mock("@/components/inspection/step-facility-info", () => ({
  StepFacilityInfo: stepStub(0, "facilityInfo.facilityName"),
}));
vi.mock("@/components/inspection/step-general-treatment", () => ({
  StepGeneralTreatment: stepStub(1, "generalTreatment.systemTypes"),
}));
vi.mock("@/components/inspection/step-design-flow", () => ({
  StepDesignFlow: stepStub(2, "designFlow.estimatedDesignFlow"),
}));
vi.mock("@/components/inspection/step-septic-tank", () => ({
  StepSepticTank: stepStub(3, "septicTank.numberOfTanks"),
}));
vi.mock("@/components/inspection/step-disposal-works", () => ({
  StepDisposalWorks: stepStub(4, "disposalWorks.disposalType"),
}));
vi.mock("@/components/inspection/step-alternative-system", () => ({
  StepAlternativeSystem: stepStub(5, "alternativeSystem.manufacturer"),
}));

// Actions: expose the jump-to callback so the shell's section/highlight logic can be driven,
// and record every props object so prop identity can be asserted across re-renders
const reviewActionsProps = vi.fn();
vi.mock("@/components/review/review-actions", () => ({
  ReviewActions: (props: any) => {
    reviewActionsProps(props);
    const { status, onJumpToField, flush } = props;
    return (
    <div data-testid="review-actions" data-status={status}>
      <button onClick={() => onJumpToField("septicTank.numberOfTanks", 3)}>Jump to tanks</button>
      <button onClick={() => onJumpToField("septicTank.tanks.9.lidsRisersPresent", 3)}>
        Jump to missing tank
      </button>
      <button onClick={() => flush()}>Flush</button>
    </div>
    );
  },
}));

// PDF preview: avoid pdf-lib in jsdom
vi.mock("@/hooks/use-pdf-generation", () => ({
  usePdfGeneration: () => ({
    generatePdf: vi.fn(),
    pdfData: null,
    isGenerating: false,
    error: null,
    clearPdf: vi.fn(),
  }),
}));

import { getDefaultFormValues } from "@/lib/validators/inspection";
import type { InspectionFormData } from "@/types/inspection";
import { ReviewEditor } from "@/components/review/review-editor";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeInspection(overrides: Partial<Parameters<typeof ReviewEditor>[0]["inspection"]> = {}) {
  const formData = getDefaultFormValues("Dan Endres") as unknown as InspectionFormData;
  formData.facilityInfo.facilityName = "Smith Residence";
  formData.designFlow = {
    estimatedDesignFlow: "450",
    designFlowBasis: "bedrooms",
    numberOfBedrooms: "3",
    fixtureCount: "12",
    nonDwellingGpd: "0",
    actualFlowEvaluation: "normal",
    designFlowComments: "ok",
  };
  return {
    id: "insp-1",
    status: "in_review",
    formData,
    facilityName: "Smith Residence",
    facilityAddress: "123 Main St",
    customerEmail: null,
    isFromWorkiz: false,
    ...overrides,
  };
}

const media = [
  {
    id: "m1",
    type: "photo" as const,
    storagePath: "insp-1/a.jpg",
    label: "septic-tank",
    description: null,
    sortOrder: 0,
    createdAt: "2026-09-01T00:00:00.000Z",
    signedUrl: "https://example.test/a.jpg",
  },
];

// jsdom does not implement scrollIntoView; record the receiver of every call
const scrollIntoView = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  Element.prototype.scrollIntoView = scrollIntoView;
});

afterEach(() => {
  vi.useRealTimers();
});

const FAKE_TIMERS: Parameters<typeof vi.useFakeTimers>[0] = {
  toFake: [
    "setTimeout",
    "clearTimeout",
    "setInterval",
    "clearInterval",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "Date",
  ],
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("ReviewEditor", () => {
  it("renders the six wizard sections collapsed, with live pills", () => {
    render(<ReviewEditor inspection={makeInspection()} media={media} />);

    for (const label of [
      "Facility Info",
      "General Treatment",
      "Design Flow",
      "Septic Tank",
      "Disposal Works",
      "Alternative System",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    for (let i = 0; i < 6; i++) {
      expect(screen.queryByTestId(`step-${i}`)).not.toBeInTheDocument();
    }

    // Design Flow is fully filled → complete; Septic Tank still has empty STEP_FIELDS;
    // Alternative System is switched off → Not included
    const designFlow = screen.getByText("Design Flow").closest("[data-slot=collapsible-trigger]")!;
    expect(within(designFlow as HTMLElement).getByText("complete")).toBeInTheDocument();
    const septic = screen.getByText("Septic Tank").closest("[data-slot=collapsible-trigger]")!;
    expect(within(septic as HTMLElement).getByText(/^\d+ empty$/)).toBeInTheDocument();
    const alt = screen.getByText("Alternative System").closest("[data-slot=collapsible-trigger]")!;
    expect(within(alt as HTMLElement).getByText("Not included")).toBeInTheDocument();
  });

  it("shows an issues pill when a validator error exists", () => {
    const inspection = makeInspection();
    inspection.formData!.facilityInfo.facilityName = "";
    render(<ReviewEditor inspection={inspection} media={media} />);

    const facility = screen.getByText("Facility Info").closest("[data-slot=collapsible-trigger]")!;
    expect(within(facility as HTMLElement).getByText("1 issue")).toBeInTheDocument();
  });

  it("expanding a section renders the wizard step component", async () => {
    const user = userEvent.setup();
    render(<ReviewEditor inspection={makeInspection()} media={media} />);

    await user.click(screen.getByText("Septic Tank"));

    expect(screen.getByTestId("step-3")).toBeInTheDocument();
    expect(screen.getByTestId("step-3")).not.toBeDisabled();
    expect(screen.queryByTestId("step-0")).not.toBeInTheDocument();
  });

  it("mounts autosave enabled while in review, seeded so opening the page never writes", () => {
    render(<ReviewEditor inspection={makeInspection()} media={media} />);
    expect(autoSaveSpy).toHaveBeenCalledWith(expect.anything(), "insp-1", {
      enabled: true,
      seedFromInitial: true,
    });
  });

  it("completed: steps render inside fieldset[disabled], autosave is disabled, bar says read-only", async () => {
    const user = userEvent.setup();
    render(<ReviewEditor inspection={makeInspection({ status: "completed" })} media={media} />);

    expect(autoSaveSpy).toHaveBeenCalledWith(expect.anything(), "insp-1", {
      enabled: false,
      seedFromInitial: true,
    });
    expect(screen.getByRole("status")).toHaveTextContent(/read-only/i);
    expect(screen.getByTestId("review-actions")).toHaveAttribute("data-status", "completed");

    await user.click(screen.getByText("Facility Info"));
    const step = screen.getByTestId("step-0");
    expect(step.tagName).toBe("FIELDSET");
    expect(step).toBeDisabled();
    expect(document.querySelector("fieldset[disabled]")).not.toBeNull();
  });

  it("sent: steps render inside fieldset[disabled] and autosave is disabled (no PATCH)", async () => {
    const user = userEvent.setup();
    render(<ReviewEditor inspection={makeInspection({ status: "sent" })} media={media} />);

    expect(autoSaveSpy).toHaveBeenCalledWith(expect.anything(), "insp-1", {
      enabled: false,
      seedFromInitial: true,
    });
    expect(screen.getByRole("status")).toHaveTextContent(/read-only/i);
    expect(screen.getByTestId("review-actions")).toHaveAttribute("data-status", "sent");

    await user.click(screen.getByText("Septic Tank"));
    expect(screen.getByTestId("step-3")).toBeDisabled();
    expect(document.querySelector("fieldset[disabled]")).not.toBeNull();
    expect(
      vi.mocked(fetch).mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "PATCH"),
    ).toHaveLength(0);
  });

  it("jump-to-field opens the section and highlights the field", async () => {
    const user = userEvent.setup();
    render(<ReviewEditor inspection={makeInspection()} media={media} />);

    expect(screen.queryByTestId("step-3")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /jump to tanks/i }));

    await waitFor(() => {
      const target = document.querySelector('[data-field-path="septicTank.numberOfTanks"]');
      expect(target).not.toBeNull();
      expect(target).toHaveAttribute("data-highlight", "true");
    });
  });

  it("jump-to focuses the control without scrolling, then smooth-scrolls the field last", async () => {
    const order: string[] = [];
    const focusSpy = vi
      .spyOn(HTMLElement.prototype, "focus")
      .mockImplementation(function (this: HTMLElement, opts?: FocusOptions) {
        order.push(`focus:${this.getAttribute("aria-label") ?? this.tagName}:${opts?.preventScroll ? "noscroll" : "scroll"}`);
      });
    scrollIntoView.mockImplementation(function (this: Element) {
      order.push(`scroll:${this.getAttribute("data-field-path") ?? this.tagName}`);
    });
    try {
      render(<ReviewEditor inspection={makeInspection()} media={media} />);
      fireEvent.click(screen.getByRole("button", { name: /jump to tanks/i }));
      await waitFor(() => expect(order.some((o) => o.startsWith("scroll:"))).toBe(true));

      // The field's input is focused with preventScroll, and the smooth scroll is the last step
      expect(order).toContain("focus:septicTank.numberOfTanks:noscroll");
      expect(order.at(-1)).toBe("scroll:septicTank.numberOfTanks");
      expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: "smooth", block: "center" });
    } finally {
      focusSpy.mockRestore();
      scrollIntoView.mockReset();
    }
  });

  it("jump-to falls back to the section header when no field element exists", async () => {
    const user = userEvent.setup();
    render(<ReviewEditor inspection={makeInspection()} media={media} />);

    await user.click(screen.getByRole("button", { name: /jump to missing tank/i }));

    // Section opened, header scrolled into view, nothing highlighted
    await waitFor(() => expect(screen.getByTestId("step-3")).toBeInTheDocument());
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    const header = screen.getByText("Septic Tank").closest("[data-slot=collapsible-trigger]");
    expect(scrollIntoView.mock.contexts[0]).toBe(header);
    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: "smooth", block: "start" });
    expect(header).toHaveFocus();
    expect(document.querySelector("[data-highlight]")).toBeNull();
  });

  it("removes the highlight after 2 s, and clears the timer on unmount", async () => {
    vi.useFakeTimers(FAKE_TIMERS);

    // Normal path: the ring goes away after HIGHLIGHT_MS
    const first = render(<ReviewEditor inspection={makeInspection()} media={media} />);
    fireEvent.click(screen.getByRole("button", { name: /jump to tanks/i }));
    await act(async () => {
      vi.advanceTimersByTime(50); // two animation frames
    });
    const target = document.querySelector('[data-field-path="septicTank.numberOfTanks"]')!;
    expect(target).toHaveAttribute("data-highlight", "true");
    await act(async () => {
      vi.advanceTimersByTime(2100);
    });
    expect(target).not.toHaveAttribute("data-highlight");
    first.unmount();

    // Unmount path: the pending timeout is cleared (no timer left behind) and the
    // ring is stripped synchronously by the cleanup rather than by a late callback
    const second = render(<ReviewEditor inspection={makeInspection()} media={media} />);
    fireEvent.click(screen.getByRole("button", { name: /jump to tanks/i }));
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    const detached = document.querySelector('[data-field-path="septicTank.numberOfTanks"]')!;
    expect(detached).toHaveAttribute("data-highlight", "true");
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    second.unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(detached).not.toHaveAttribute("data-highlight");
  });

  it("renders the photo selection with all photos selected by default", () => {
    render(<ReviewEditor inspection={makeInspection()} media={media} />);
    expect(screen.getByText("Photos (1 of 1 selected for the report)")).toBeInTheDocument();
  });

  it("keeps selectedMediaIds referentially stable across unrelated re-renders", async () => {
    const user = userEvent.setup();
    render(<ReviewEditor inspection={makeInspection()} media={media} />);
    const before = reviewActionsProps.mock.lastCall![0].selectedMediaIds;
    expect(before).toEqual(["m1"]);

    // Opening a section re-renders the shell but does not touch the selection
    await user.click(screen.getByText("Septic Tank"));
    const after = reviewActionsProps.mock.lastCall![0].selectedMediaIds;
    expect(reviewActionsProps.mock.calls.length).toBeGreaterThan(1);
    expect(after).toBe(before);

    // Toggling a photo yields a new array
    await user.click(screen.getByRole("button", { name: /deselect all/i }));
    expect(reviewActionsProps.mock.lastCall![0].selectedMediaIds).toEqual([]);
  });
});
