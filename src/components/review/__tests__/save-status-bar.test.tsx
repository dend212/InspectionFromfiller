import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SaveStatusBar } from "@/components/review/save-status-bar";

describe("SaveStatusBar", () => {
  it("shows Saving…, Saved · N s ago, and Save failed — Retry", async () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <SaveStatusBar status="saving" lastSaved={null} onRetry={onRetry} readOnly={false} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Saving…");

    rerender(
      <SaveStatusBar status="saved" lastSaved={new Date(Date.now() - 2000)} onRetry={onRetry} readOnly={false} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(/Saved · \d s ago/);

    rerender(<SaveStatusBar status="error" lastSaved={null} onRetry={onRetry} readOnly={false} />);
    expect(screen.getByRole("status")).toHaveTextContent("Save failed");
    await userEvent.setup().click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("shows the read-only notice regardless of save status", () => {
    render(<SaveStatusBar status="error" lastSaved={null} onRetry={vi.fn()} readOnly />);
    expect(screen.getByRole("status")).toHaveTextContent(/read-only/i);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("SaveStatusBar (semantics)", () => {
  it("is an <output> live region (implicit role=status) with aria-live=polite", () => {
    render(<SaveStatusBar status="idle" lastSaved={null} onRetry={vi.fn()} readOnly={false} />);
    const bar = screen.getByRole("status");
    expect(bar.tagName).toBe("OUTPUT");
    expect(bar).toHaveAttribute("aria-live", "polite");
    expect(bar).not.toHaveAttribute("role");
    expect(bar).toHaveTextContent("Changes save automatically");
  });
});
