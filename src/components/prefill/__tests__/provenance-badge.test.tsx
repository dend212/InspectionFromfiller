import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as React from "react";
import { useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProvenanceBadge } from "@/components/prefill/provenance-badge";
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

  it("hides Verify and Clear when read-only but still shows the details", async () => {
    const user = userEvent.setup();
    renderBadge(ENTRY, true);
    await user.click(screen.getByRole("button", { name: /prefilled from permit records/i }));
    expect(await screen.findByText("Permit OW-17-00474 · Discharge Authorization p.1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Verify" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
  });
});
