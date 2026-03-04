import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────────

// Mock react-hook-form's useWatch
let watchedValuesRef = { current: {} };
vi.mock("react-hook-form", () => ({
  useWatch: vi.fn(() => watchedValuesRef.current),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { toast } from "sonner";
import { useAutoSave } from "@/hooks/use-auto-save";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeMockForm(values: Record<string, unknown> = { field: "value" }) {
  return {
    control: {},
    getValues: vi.fn().mockReturnValue(values),
  } as any;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  vi.restoreAllMocks();
  watchedValuesRef.current = {};
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true }),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useAutoSave", () => {
  describe("initial state", () => {
    it("starts with saving=false and lastSaved=null", () => {
      const form = makeMockForm();
      const { result } = renderHook(() => useAutoSave(form, "insp-1"));

      expect(result.current.saving).toBe(false);
      expect(result.current.lastSaved).toBeNull();
    });
  });

  describe("debounced saving", () => {
    it("does not save immediately when values change", () => {
      const form = makeMockForm({ field: "initial" });
      renderHook(() => useAutoSave(form, "insp-1", 500));

      // Change watched values
      watchedValuesRef.current = { field: "changed" };

      // Advance less than debounce time
      act(() => {
        vi.advanceTimersByTime(200);
      });

      // fetch should not have been called (the initial render may have tried,
      // but with same serialized value it should skip)
      expect(fetch).not.toHaveBeenCalled();
    });

    it("saves after debounce period elapses", async () => {
      const values = { field: "initial" };
      const form = makeMockForm(values);

      const { rerender } = renderHook(() => useAutoSave(form, "insp-1", 500));

      // Simulate form value change by updating watched values and re-rendering
      watchedValuesRef.current = { field: "changed" };
      form.getValues.mockReturnValue({ field: "changed" });
      rerender();

      // Advance past debounce
      await act(async () => {
        vi.advanceTimersByTime(600);
      });

      expect(fetch).toHaveBeenCalledWith("/api/inspections/insp-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field: "changed" }),
      });
    });

    it("resets debounce timer on rapid changes", async () => {
      const form = makeMockForm({ field: "v1" });
      const { rerender } = renderHook(() => useAutoSave(form, "insp-1", 500));

      // First change
      watchedValuesRef.current = { field: "v2" };
      form.getValues.mockReturnValue({ field: "v2" });
      rerender();

      act(() => {
        vi.advanceTimersByTime(300);
      });

      // Second change before debounce fires
      watchedValuesRef.current = { field: "v3" };
      form.getValues.mockReturnValue({ field: "v3" });
      rerender();

      await act(async () => {
        vi.advanceTimersByTime(600);
      });

      // Should have only saved once with the latest value
      const calls = vi.mocked(fetch).mock.calls;
      const patchCalls = calls.filter(
        (c) => c[1] && (c[1] as any).method === "PATCH",
      );
      expect(patchCalls.length).toBe(1);
      expect(patchCalls[0][1]).toEqual(
        expect.objectContaining({
          body: JSON.stringify({ field: "v3" }),
        }),
      );
    });
  });

  describe("save skipping", () => {
    it("does not save when values have not changed from last save", async () => {
      const form = makeMockForm({ field: "same" });
      const { rerender } = renderHook(() => useAutoSave(form, "insp-1", 100));

      // Trigger first save
      watchedValuesRef.current = { field: "same" };
      rerender();

      await act(async () => {
        vi.advanceTimersByTime(200);
      });

      const firstCallCount = vi.mocked(fetch).mock.calls.length;

      // Same values again
      watchedValuesRef.current = { field: "same" };
      rerender();

      await act(async () => {
        vi.advanceTimersByTime(200);
      });

      // Should not have made another fetch call
      expect(vi.mocked(fetch).mock.calls.length).toBe(firstCallCount);
    });
  });

  describe("error handling", () => {
    it("shows toast.error when save fails", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: false, status: 500 }),
      );

      const form = makeMockForm({ field: "val" });
      const { rerender } = renderHook(() => useAutoSave(form, "insp-1", 100));

      watchedValuesRef.current = { field: "val" };
      rerender();

      await act(async () => {
        vi.advanceTimersByTime(200);
      });

      expect(toast.error).toHaveBeenCalledWith("Auto-save failed");
    });

    it("shows toast.error on network failure", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new Error("Network error")),
      );

      const form = makeMockForm({ field: "val" });
      const { rerender } = renderHook(() => useAutoSave(form, "insp-1", 100));

      watchedValuesRef.current = { field: "val" };
      rerender();

      await act(async () => {
        vi.advanceTimersByTime(200);
      });

      expect(toast.error).toHaveBeenCalledWith("Auto-save failed");
    });
  });

  describe("state transitions", () => {
    it("sets saving=true while request is in flight", async () => {
      let resolvePromise: (v: any) => void;
      vi.stubGlobal(
        "fetch",
        vi.fn().mockReturnValue(
          new Promise((resolve) => {
            resolvePromise = resolve;
          }),
        ),
      );

      const form = makeMockForm({ field: "val" });
      const { result, rerender } = renderHook(() =>
        useAutoSave(form, "insp-1", 100),
      );

      watchedValuesRef.current = { field: "val" };
      rerender();

      act(() => {
        vi.advanceTimersByTime(200);
      });

      // saving should be true while fetch is pending
      expect(result.current.saving).toBe(true);

      // Resolve the fetch
      await act(async () => {
        resolvePromise!({ ok: true });
      });

      expect(result.current.saving).toBe(false);
    });

    it("updates lastSaved on successful save", async () => {
      const form = makeMockForm({ field: "val" });
      const { result, rerender } = renderHook(() =>
        useAutoSave(form, "insp-1", 100),
      );

      expect(result.current.lastSaved).toBeNull();

      watchedValuesRef.current = { field: "val" };
      rerender();

      await act(async () => {
        vi.advanceTimersByTime(200);
      });

      expect(result.current.lastSaved).toBeInstanceOf(Date);
    });
  });

  describe("unmount behavior", () => {
    it("clears timeout on unmount", async () => {
      const form = makeMockForm({ field: "val" });
      const { unmount, rerender } = renderHook(() =>
        useAutoSave(form, "insp-1", 1000),
      );

      watchedValuesRef.current = { field: "val" };
      rerender();

      // Unmount before debounce fires
      unmount();

      // Should fire-and-forget save on unmount
      expect(fetch).toHaveBeenCalled();
    });

    it("fires save on unmount when there are unsaved changes", () => {
      const form = makeMockForm({ field: "unsaved" });
      const { unmount, rerender } = renderHook(() =>
        useAutoSave(form, "insp-1", 5000),
      );

      // Trigger a change so there's a pending timeout
      watchedValuesRef.current = { field: "unsaved" };
      rerender();

      unmount();

      // Should have called fetch as a fire-and-forget
      expect(fetch).toHaveBeenCalledWith("/api/inspections/insp-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field: "unsaved" }),
      });
    });
  });

  describe("beforeunload", () => {
    it("adds beforeunload listener", () => {
      const addSpy = vi.spyOn(window, "addEventListener");
      const form = makeMockForm();

      renderHook(() => useAutoSave(form, "insp-1"));

      expect(addSpy).toHaveBeenCalledWith(
        "beforeunload",
        expect.any(Function),
      );
    });

    it("removes beforeunload listener on unmount", () => {
      const removeSpy = vi.spyOn(window, "removeEventListener");
      const form = makeMockForm();

      const { unmount } = renderHook(() => useAutoSave(form, "insp-1"));
      unmount();

      expect(removeSpy).toHaveBeenCalledWith(
        "beforeunload",
        expect.any(Function),
      );
    });
  });

  describe("uses default debounce", () => {
    it("defaults to 1000ms debounce", async () => {
      const form = makeMockForm({ field: "val" });
      const { rerender } = renderHook(() => useAutoSave(form, "insp-1"));

      watchedValuesRef.current = { field: "val" };
      rerender();

      act(() => {
        vi.advanceTimersByTime(900);
      });

      expect(fetch).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(200);
      });

      expect(fetch).toHaveBeenCalled();
    });
  });
});
