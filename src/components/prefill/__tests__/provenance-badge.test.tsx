import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as React from "react";
import { useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BADGE_HOVER_CLOSE_DELAY_MS, ProvenanceBadge } from "@/components/prefill/provenance-badge";
import { ProvenanceProvider } from "@/components/prefill/provenance-context";
import type { FieldProvenance, ProvenanceEntry } from "@/lib/prefill/types";
import { getDefaultFormValues } from "@/lib/validators/inspection";
import type { InspectionFormData } from "@/types/inspection";

const ENTRY: ProvenanceEntry = {
  source: "permit",
  state: "prefilled",
  kind: "fill",
  value: "1250",
  confidence: 0.92,
  explanation: "Permit OW-17-00474 · Discharge Authorization p.1",
  evidence: "Septic Tank Qty 1 Capacity 1250",
  sourceUrl: "/api/inspections/insp-1/records/rec-1#page=1",
  page: 1,
  at: "2026-09-11T10:00:00.000Z",
};
const FIELD = "septicTank.tanks.0.tankCapacity";

function Harness({
  initial,
  readOnly,
  children,
}: {
  initial: FieldProvenance;
  readOnly?: boolean;
  children: React.ReactNode;
}) {
  const form = useForm<InspectionFormData>({
    defaultValues: getDefaultFormValues("Tech") as unknown as InspectionFormData,
  });
  return (
    <ProvenanceProvider form={form} inspectionId="insp-1" initial={initial} readOnly={readOnly}>
      {children}
    </ProvenanceProvider>
  );
}

function renderBadge(entry: ProvenanceEntry | null, readOnly = false) {
  return render(
    <Harness initial={entry ? { [FIELD]: entry } : {}} readOnly={readOnly}>
      <ProvenanceBadge fieldPath={FIELD} />
    </Harness>,
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
});

afterEach(() => {
  // Unmount before unstubbing fetch — otherwise RTL's own auto-unmount cleanup
  // fires after the stub is gone and the provider's unmount flush hits real
  // fetch, logging "[provenance] save failed" noise to stderr.
  cleanup();
  vi.unstubAllGlobals();
});

describe("ProvenanceBadge", () => {
  it("renders nothing without an entry, for suggestions, and for warnings", () => {
    const { container: none } = renderBadge(null);
    expect(none.querySelector("button")).toBeNull();
    const { container: suggested } = renderBadge({ ...ENTRY, state: "suggested" });
    expect(suggested.querySelector("button")).toBeNull();
    const { container: warning } = renderBadge({ ...ENTRY, kind: "warning", value: "" });
    expect(warning.querySelector("button")).toBeNull();
  });

  it("is a button with the source and confidence in its accessible name and visible text", () => {
    renderBadge(ENTRY);
    const badge = screen.getByRole("button", { name: "Prefilled from Permit records, 92% confidence" });
    expect(badge).toHaveTextContent("92%");
    expect(badge.querySelector("span")).toHaveClass("bg-amber-500");
  });

  it("shows grey 'edited' and green 'verified' states with distinct labels", () => {
    renderBadge({ ...ENTRY, state: "edited" });
    const edited = screen.getByRole("button", { name: "Edited after prefill from Permit records, 92% confidence" });
    expect(edited).toHaveTextContent("edited");
    expect(edited.querySelector("span")).toHaveClass("bg-gray-400");
  });

  it("opens a popover with explanation, evidence and an external source link", async () => {
    const user = userEvent.setup();
    renderBadge(ENTRY);
    await user.click(screen.getByRole("button", { name: /prefilled from permit records/i }));

    expect(await screen.findByText("Permit OW-17-00474 · Discharge Authorization p.1")).toBeInTheDocument();
    expect(screen.getByText("Permit records")).toBeInTheDocument();
    expect(screen.getByText(/Septic Tank Qty 1 Capacity 1250/)).toBeInTheDocument();
    expect(screen.getByText("1250")).toBeInTheDocument();

    const link = screen.getByRole("link", { name: /open source \(p\. 1\)/i });
    expect(link).toHaveAttribute("href", "/api/inspections/insp-1/records/rec-1#page=1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders an https:// source URL as a link", async () => {
    const user = userEvent.setup();
    renderBadge({ ...ENTRY, sourceUrl: "https://mcassessor.maricopa.gov/mcs/?q=219-11-121" });
    await user.click(screen.getByRole("button", { name: /prefilled from permit records/i }));
    const link = await screen.findByRole("link", { name: /open source/i });
    expect(link).toHaveAttribute("href", "https://mcassessor.maricopa.gov/mcs/?q=219-11-121");
  });

  it("never renders an unsafe sourceUrl as a link, showing the page number as plain text instead", async () => {
    const user = userEvent.setup();
    for (const unsafe of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "http://example.com",
    ]) {
      const { unmount } = renderBadge({ ...ENTRY, sourceUrl: unsafe });
      await user.click(screen.getByRole("button", { name: /prefilled from permit records/i }));
      expect(await screen.findByText("Permit OW-17-00474 · Discharge Authorization p.1")).toBeInTheDocument();
      expect(screen.queryByRole("link")).toBeNull();
      expect(screen.getByText("p. 1")).toBeInTheDocument();
      unmount();
    }
  });

  it("Verify turns the badge into the verified state", async () => {
    const user = userEvent.setup();
    renderBadge(ENTRY);
    await user.click(screen.getByRole("button", { name: /prefilled from permit records/i }));
    await user.click(await screen.findByRole("button", { name: "Verify" }));

    const verified = screen.getByRole("button", {
      name: "Verified. Prefilled from Permit records, 92% confidence",
    });
    expect(verified).toHaveTextContent("verified");
    expect(verified.querySelector("span")).toHaveClass("bg-emerald-600");
  });

  it("Clear removes the badge", async () => {
    const user = userEvent.setup();
    renderBadge(ENTRY);
    await user.click(screen.getByRole("button", { name: /prefilled from permit records/i }));
    await user.click(await screen.findByRole("button", { name: "Clear" }));
    expect(screen.queryByRole("button", { name: /prefilled from/i })).toBeNull();
  });

  it("opens on hover and closes shortly after the pointer leaves", async () => {
    const user = userEvent.setup();
    renderBadge(ENTRY);
    const badge = screen.getByRole("button", { name: /prefilled from permit records/i });
    await user.hover(badge);
    expect(await screen.findByText("Permit records")).toBeInTheDocument();
    // A hover peek never steals focus from where the user is
    expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "Verify" }));
    await user.unhover(badge);
    // Still open during the grace period so the pointer can travel into the card
    expect(screen.getByText("Permit records")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Permit records")).toBeNull(), {
      timeout: BADGE_HOVER_CLOSE_DELAY_MS * 5,
    });
  });

  it("a hover peek that closes on its timer leaves focus in the field the user is typing in", async () => {
    const user = userEvent.setup();
    render(
      <Harness initial={{ [FIELD]: ENTRY }}>
        <input aria-label="Tank capacity" />
        <ProvenanceBadge fieldPath={FIELD} />
      </Harness>,
    );
    const input = screen.getByRole("textbox", { name: "Tank capacity" });
    const badge = screen.getByRole("button", { name: /prefilled from permit records/i });
    await user.click(input);
    expect(input).toHaveFocus();
    await user.hover(badge);
    expect(await screen.findByText("Permit records")).toBeInTheDocument();
    expect(input).toHaveFocus();
    await user.unhover(badge);
    await waitFor(() => expect(screen.queryByText("Permit records")).toBeNull(), {
      timeout: BADGE_HOVER_CLOSE_DELAY_MS * 5,
    });
    // Radix returns focus to the trigger on close unless told not to: the user never left the
    // input, so the badge must not grab focus out from under them
    await new Promise((r) => setTimeout(r, 20));
    expect(input).toHaveFocus();
    expect(badge).not.toHaveFocus();
  });

  it("Escape while peeked closes the popover and leaves focus in the field", async () => {
    const user = userEvent.setup();
    render(
      <Harness initial={{ [FIELD]: ENTRY }}>
        <input aria-label="Tank capacity" />
        <ProvenanceBadge fieldPath={FIELD} />
      </Harness>,
    );
    const input = screen.getByRole("textbox", { name: "Tank capacity" });
    const badge = screen.getByRole("button", { name: /prefilled from permit records/i });
    await user.click(input);
    await user.hover(badge);
    expect(await screen.findByText("Permit records")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByText("Permit records")).toBeNull());
    await new Promise((r) => setTimeout(r, 20));
    expect(input).toHaveFocus();
    expect(badge).not.toHaveFocus();
  });

  it("stays open while the pointer is inside the popover so Verify / Clear can be reached from a hover", async () => {
    const user = userEvent.setup();
    renderBadge(ENTRY);
    const badge = screen.getByRole("button", { name: /prefilled from permit records/i });
    await user.hover(badge);
    const verify = await screen.findByRole("button", { name: "Verify" });
    await user.unhover(badge);
    await user.hover(verify);
    // Longer than the close delay: the card must not have gone away
    await new Promise((r) => setTimeout(r, BADGE_HOVER_CLOSE_DELAY_MS * 2));
    expect(screen.getByRole("button", { name: "Verify" })).toBeInTheDocument();
    await user.click(verify);
    expect(
      screen.getByRole("button", { name: "Verified. Prefilled from Permit records, 92% confidence" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Permit records")).toBeNull();
  });

  it("a click after a hover pins the popover open; a second click closes it", async () => {
    const user = userEvent.setup();
    renderBadge(ENTRY);
    const badge = screen.getByRole("button", { name: /prefilled from permit records/i });
    await user.hover(badge);
    expect(await screen.findByText("Permit records")).toBeInTheDocument();
    await user.click(badge);
    expect(screen.getByText("Permit records")).toBeInTheDocument();
    await user.unhover(badge);
    await new Promise((r) => setTimeout(r, BADGE_HOVER_CLOSE_DELAY_MS * 2));
    expect(screen.getByText("Permit records")).toBeInTheDocument();
    await user.click(badge);
    expect(screen.queryByText("Permit records")).toBeNull();
  });

  it("opens on keyboard focus and closes when focus moves on", async () => {
    const user = userEvent.setup();
    render(
      <Harness initial={{ [FIELD]: ENTRY }}>
        <ProvenanceBadge fieldPath={FIELD} />
        <button type="button">next</button>
      </Harness>,
    );
    await user.tab();
    const badge = screen.getByRole("button", { name: /prefilled from permit records/i });
    expect(badge).toHaveFocus();
    expect(await screen.findByText("Permit records")).toBeInTheDocument();
    // Focus stays on the badge: a peek must not hijack keyboard navigation
    expect(badge).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "next" })).toHaveFocus();
    await waitFor(() => expect(screen.queryByText("Permit records")).toBeNull(), {
      timeout: BADGE_HOVER_CLOSE_DELAY_MS * 5,
    });
  });

  it("Enter on a focused badge moves focus into the popover so Verify / Clear are keyboard-reachable", async () => {
    const user = userEvent.setup();
    renderBadge(ENTRY);
    await user.tab();
    const badge = screen.getByRole("button", { name: /prefilled from permit records/i });
    expect(badge).toHaveFocus();
    await user.keyboard("{Enter}");
    const verify = await screen.findByRole("button", { name: "Verify" });
    const card = verify.closest("[data-slot=popover-content]") as HTMLElement;
    // Focus moved into the card (its first tabbable, like Radix's own auto-focus)
    await waitFor(() => expect(card).toContainElement(document.activeElement as HTMLElement));
    expect(badge).not.toHaveFocus();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByText("Permit records")).toBeNull());
    expect(badge).toHaveFocus();
  });

  it("hides Verify and Clear when read-only but still shows the details", async () => {
    const user = userEvent.setup();
    renderBadge(ENTRY, true);
    await user.click(screen.getByRole("button", { name: /prefilled from permit records/i }));
    expect(await screen.findByText("Permit OW-17-00474 · Discharge Authorization p.1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Verify" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
  });
});
