import { act, renderHook } from "@testing-library/react";
import type * as React from "react";
import { type UseFormReturn, useForm } from "react-hook-form";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NOOP_PROVENANCE,
  PROVENANCE_SAVE_DEBOUNCE_MS,
  ProvenanceProvider,
  useProvenance,
} from "@/components/prefill/provenance-context";
import type { FieldProvenance, ProvenanceEntry } from "@/lib/prefill/types";
import { createEmptyTank, getDefaultFormValues } from "@/lib/validators/inspection";
import type { InspectionFormData } from "@/types/inspection";

const NOW = "2026-09-11T10:00:00.000Z";

function entry(over: Partial<ProvenanceEntry> = {}): ProvenanceEntry {
  return {
    source: "assessor",
    state: "prefilled",
    kind: "fill",
    value: "JOHN DOE",
    confidence: 1,
    explanation: "Maricopa County Assessor · parcel 219-11-121",
    at: NOW,
    ...over,
  };
}

type FormRef = { current: UseFormReturn<InspectionFormData> | null };
type Tank = InspectionFormData["septicTank"]["tanks"][number];

function makeWrapper(opts: {
  formRef: FormRef;
  initial?: FieldProvenance;
  readOnly?: boolean;
  facility?: Partial<InspectionFormData["facilityInfo"]>;
  tanks?: Tank[];
}) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    const defaults = getDefaultFormValues("Tech") as unknown as InspectionFormData;
    const form = useForm<InspectionFormData>({
      defaultValues: {
        ...defaults,
        facilityInfo: { ...defaults.facilityInfo, ...opts.facility },
        septicTank: { ...defaults.septicTank, tanks: opts.tanks ?? [] },
      },
    });
    opts.formRef.current = form;
    return (
      <ProvenanceProvider
        form={form}
        inspectionId="insp-1"
        initial={opts.initial ?? {}}
        readOnly={opts.readOnly}
      >
        {children}
      </ProvenanceProvider>
    );
  };
}

function lastPatchBody(): { fieldProvenance: FieldProvenance } {
  const calls = vi.mocked(fetch).mock.calls;
  const [, init] = calls[calls.length - 1];
  return JSON.parse(String(init?.body));
}

// Mocked for the whole file (not per-test) so it stays silenced through
// testing-library's automatic unmount, which runs after our own afterEach
// (afterEach hooks run in reverse registration order) and can otherwise
// trigger a real, un-stubbed persist() call for any test that leaves the
// provenance map dirty without advancing timers to flush it.
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterAll(() => {
  errorSpy.mockRestore();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  errorSpy.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useProvenance without a provider", () => {
  it("returns the no-op context so badges render nothing and mutations are ignored", () => {
    const { result } = renderHook(() => useProvenance("facilityInfo.facilityName"));
    expect(result.current.entry).toBeUndefined();
    expect(result.current.readOnly).toBe(true);
    expect(() => result.current.setMany({ "facilityInfo.facilityName": entry() })).not.toThrow();
    expect(result.current.get("facilityInfo.facilityName")).toBeUndefined();
    expect(NOOP_PROVENANCE.provenance).toEqual({});
  });
});

describe("ProvenanceProvider", () => {
  it("exposes the initial map; bracket paths are normalised on read", () => {
    const formRef: FormRef = { current: null };
    const { result } = renderHook(() => useProvenance("septicTank.tanks[0].tankCapacity"), {
      wrapper: makeWrapper({
        formRef,
        initial: { "septicTank.tanks.0.tankCapacity": entry({ value: "1250", source: "scan" }) },
      }),
    });
    expect(result.current.entry?.value).toBe("1250");
    expect(result.current.readOnly).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("verify flips the state and persists the whole map after the 1 s debounce", () => {
    const formRef: FormRef = { current: null };
    const { result } = renderHook(() => useProvenance("facilityInfo.facilityName"), {
      wrapper: makeWrapper({
        formRef,
        initial: { "facilityInfo.facilityName": entry() },
        facility: { facilityName: "JOHN DOE" },
      }),
    });

    act(() => result.current.verify("facilityInfo.facilityName"));
    expect(result.current.entry?.state).toBe("verified");
    expect(fetch).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(PROVENANCE_SAVE_DEBOUNCE_MS - 1);
    });
    expect(fetch).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/inspections/insp-1/provenance");
    expect(init?.method).toBe("PATCH");
    expect(lastPatchBody().fieldProvenance["facilityInfo.facilityName"].state).toBe("verified");
  });

  it("coalesces rapid changes into one PATCH", () => {
    const formRef: FormRef = { current: null };
    const { result } = renderHook(() => useProvenance(), {
      wrapper: makeWrapper({
        formRef,
        initial: {
          "facilityInfo.facilityName": entry(),
          "facilityInfo.facilityCity": entry({ value: "CAREFREE" }),
        },
      }),
    });

    act(() => result.current.verify("facilityInfo.facilityName"));
    act(() => result.current.clear("facilityInfo.facilityCity"));
    act(() => {
      vi.advanceTimersByTime(PROVENANCE_SAVE_DEBOUNCE_MS);
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    const map = lastPatchBody().fieldProvenance;
    expect(map["facilityInfo.facilityName"].state).toBe("verified");
    expect(map["facilityInfo.facilityCity"]).toBeUndefined();
  });

  it("clear and dismissSuggestion remove the entry", () => {
    const formRef: FormRef = { current: null };
    const { result } = renderHook(() => useProvenance(), {
      wrapper: makeWrapper({
        formRef,
        initial: {
          "facilityInfo.facilityName": entry(),
          "designFlow.numberOfBedrooms": entry({ state: "suggested", value: "3" }),
        },
      }),
    });
    act(() => result.current.clear("facilityInfo.facilityName"));
    act(() => result.current.dismissSuggestion("designFlow.numberOfBedrooms"));
    expect(result.current.provenance).toEqual({});
  });

  it("acceptSuggestion writes the value into the form and marks the entry prefilled", () => {
    const formRef: FormRef = { current: null };
    const { result } = renderHook(() => useProvenance("designFlow.numberOfBedrooms"), {
      wrapper: makeWrapper({
        formRef,
        initial: {
          "designFlow.numberOfBedrooms": entry({ state: "suggested", value: "3", source: "permit" }),
        },
      }),
    });
    act(() => result.current.acceptSuggestion("designFlow.numberOfBedrooms"));
    expect(formRef.current?.getValues("designFlow.numberOfBedrooms")).toBe("3");
    expect(result.current.entry?.state).toBe("prefilled");
  });

  it("acceptSuggestion grows the tanks array to reach a suggested tank field", () => {
    const formRef: FormRef = { current: null };
    const { result } = renderHook(() => useProvenance("septicTank.tanks.1.tankCapacity"), {
      wrapper: makeWrapper({
        formRef,
        tanks: [],
        initial: {
          "septicTank.tanks.1.tankCapacity": entry({ state: "suggested", value: "1000", source: "permit" }),
        },
      }),
    });
    act(() => result.current.acceptSuggestion("septicTank.tanks.1.tankCapacity"));
    const tanks = formRef.current?.getValues("septicTank.tanks");
    expect(tanks).toHaveLength(2);
    expect(tanks?.[0]).toEqual(createEmptyTank());
    expect(tanks?.[1]).toEqual({ ...createEmptyTank(), tankCapacity: "1000" });
    expect(formRef.current?.getValues("septicTank.numberOfTanks")).toBe("2");
    expect(result.current.entry?.state).toBe("prefilled");
  });

  it("acceptSuggestion on a warning removes it without touching the form", () => {
    const formRef: FormRef = { current: null };
    const { result } = renderHook(() => useProvenance("facilityInfo.wastewaterSource"), {
      wrapper: makeWrapper({
        formRef,
        initial: {
          "facilityInfo.wastewaterSource": entry({
            state: "suggested",
            kind: "warning",
            value: "",
            source: "listing",
          }),
        },
      }),
    });
    act(() => result.current.acceptSuggestion("facilityInfo.wastewaterSource"));
    expect(result.current.entry).toBeUndefined();
    expect(formRef.current?.getValues("facilityInfo.wastewaterSource")).toBe("");
  });

  it("ignores acceptSuggestion for non-suggested or missing entries", () => {
    const formRef: FormRef = { current: null };
    const { result } = renderHook(() => useProvenance("facilityInfo.facilityName"), {
      wrapper: makeWrapper({
        formRef,
        initial: { "facilityInfo.facilityName": entry() },
        facility: { facilityName: "JOHN DOE" },
      }),
    });
    act(() => result.current.acceptSuggestion("facilityInfo.facilityName"));
    act(() => result.current.acceptSuggestion("facilityInfo.nothingHere"));
    expect(result.current.entry?.state).toBe("prefilled");
    expect(formRef.current?.getValues("facilityInfo.facilityName")).toBe("JOHN DOE");
  });

  it("flips prefilled → edited when the form value diverges, not when it merely re-trims", () => {
    const formRef: FormRef = { current: null };
    const { result } = renderHook(() => useProvenance("facilityInfo.facilityName"), {
      wrapper: makeWrapper({
        formRef,
        initial: { "facilityInfo.facilityName": entry() },
        facility: { facilityName: "JOHN DOE" },
      }),
    });

    act(() => formRef.current?.setValue("facilityInfo.facilityName", "JOHN DOE "));
    expect(result.current.entry?.state).toBe("prefilled");

    act(() => formRef.current?.setValue("facilityInfo.facilityName", "JANE DOE"));
    expect(result.current.entry?.state).toBe("edited");
    expect(result.current.entry?.value).toBe("JOHN DOE");
  });

  it("flips nested entries when a parent array is replaced (scan flow writes whole tank arrays)", () => {
    const formRef: FormRef = { current: null };
    const tank = { tankCapacity: "1250" } as unknown as Tank;
    const { result } = renderHook(() => useProvenance("septicTank.tanks.0.tankCapacity"), {
      wrapper: makeWrapper({
        formRef,
        initial: { "septicTank.tanks.0.tankCapacity": entry({ value: "1250", source: "scan" }) },
        tanks: [tank],
      }),
    });
    act(() => formRef.current?.setValue("septicTank.tanks", [{ ...tank, tankCapacity: "1000" }]));
    expect(result.current.entry?.state).toBe("edited");
  });

  it("setMany merges entries and normalises bracket keys", () => {
    const formRef: FormRef = { current: null };
    const { result } = renderHook(() => useProvenance(), {
      wrapper: makeWrapper({ formRef, initial: { "facilityInfo.facilityName": entry() } }),
    });
    act(() =>
      result.current.setMany({
        "septicTank.tanks[1].tankCapacity": entry({ value: "1000", source: "scan" }),
      }),
    );
    expect(Object.keys(result.current.provenance).sort()).toEqual([
      "facilityInfo.facilityName",
      "septicTank.tanks.1.tankCapacity",
    ]);
  });

  it("does not persist when readOnly", () => {
    const formRef: FormRef = { current: null };
    const { result } = renderHook(() => useProvenance("facilityInfo.facilityName"), {
      wrapper: makeWrapper({
        formRef,
        readOnly: true,
        initial: { "facilityInfo.facilityName": entry() },
      }),
    });
    expect(result.current.readOnly).toBe(true);
    act(() => result.current.verify("facilityInfo.facilityName"));
    act(() => {
      vi.advanceTimersByTime(PROVENANCE_SAVE_DEBOUNCE_MS * 2);
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("flushes a pending save on unmount", () => {
    const formRef: FormRef = { current: null };
    const { result, unmount } = renderHook(() => useProvenance("facilityInfo.facilityName"), {
      wrapper: makeWrapper({ formRef, initial: { "facilityInfo.facilityName": entry() } }),
    });
    act(() => result.current.verify("facilityInfo.facilityName"));
    expect(fetch).not.toHaveBeenCalled();
    unmount();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("re-arms dirty and logs when a PATCH fails, so the next change retries with the latest map", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network down"));
    const formRef: FormRef = { current: null };
    const { result } = renderHook(() => useProvenance("facilityInfo.facilityName"), {
      wrapper: makeWrapper({
        formRef,
        initial: { "facilityInfo.facilityName": entry() },
        facility: { facilityName: "JOHN DOE" },
      }),
    });

    act(() => result.current.verify("facilityInfo.facilityName"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROVENANCE_SAVE_DEBOUNCE_MS);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith("[provenance] save failed", expect.any(Error));

    // A later interaction (not just the failed PATCH's own retry) must still see dirty=true
    // and resend the latest map — the failure must not be lost silently.
    act(() => result.current.verify("facilityInfo.facilityName"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROVENANCE_SAVE_DEBOUNCE_MS);
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(lastPatchBody().fieldProvenance["facilityInfo.facilityName"].state).toBe("verified");
  });

  it("flushes a retry PATCH on unmount after a failed save", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network down"));
    const formRef: FormRef = { current: null };
    const { result, unmount } = renderHook(() => useProvenance("facilityInfo.facilityName"), {
      wrapper: makeWrapper({ formRef, initial: { "facilityInfo.facilityName": entry() } }),
    });

    act(() => result.current.verify("facilityInfo.facilityName"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROVENANCE_SAVE_DEBOUNCE_MS);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith("[provenance] save failed", expect.any(Error));

    // Unmount happens before the scheduled retry fires — the flush-on-unmount path
    // must still see dirty=true and attempt the PATCH itself.
    unmount();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("treats a non-2xx PATCH as a failure: logs status + body, re-arms dirty and retries once", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: () => Promise.resolve('{"error":"Invalid provenance"}'),
    } as Response);
    const formRef: FormRef = { current: null };
    const { result } = renderHook(() => useProvenance("facilityInfo.facilityName"), {
      wrapper: makeWrapper({ formRef, initial: { "facilityInfo.facilityName": entry() } }),
    });

    act(() => result.current.verify("facilityInfo.facilityName"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROVENANCE_SAVE_DEBOUNCE_MS);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      "[provenance] save failed",
      400,
      '{"error":"Invalid provenance"}',
    );

    // The bounded retry fires on its own with the latest map
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROVENANCE_SAVE_DEBOUNCE_MS);
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(lastPatchBody().fieldProvenance["facilityInfo.facilityName"].state).toBe("verified");
  });

  it("does not retry more than once for consecutive failures", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("network down"));
    const formRef: FormRef = { current: null };
    const { result } = renderHook(() => useProvenance("facilityInfo.facilityName"), {
      wrapper: makeWrapper({ formRef, initial: { "facilityInfo.facilityName": entry() } }),
    });

    act(() => result.current.verify("facilityInfo.facilityName"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROVENANCE_SAVE_DEBOUNCE_MS * 5);
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("resets the retry guard after a success, so a later failure gets a fresh bounded retry", async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({ ok: true } as Response)
      .mockRejectedValueOnce(new Error("network down again"))
      .mockResolvedValueOnce({ ok: true } as Response);
    const formRef: FormRef = { current: null };
    const { result } = renderHook(() => useProvenance("facilityInfo.facilityName"), {
      wrapper: makeWrapper({ formRef, initial: { "facilityInfo.facilityName": entry() } }),
    });

    // 1st save fails, its retry succeeds
    act(() => result.current.verify("facilityInfo.facilityName"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROVENANCE_SAVE_DEBOUNCE_MS * 2);
    });
    expect(fetch).toHaveBeenCalledTimes(2);

    // A later save fails again — it must get its own retry (guard was reset on success)
    act(() => result.current.verify("facilityInfo.facilityName"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROVENANCE_SAVE_DEBOUNCE_MS * 2);
    });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("never schedules a retry timer after unmount when the unmount flush fails", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("network down"));
    const formRef: FormRef = { current: null };
    const { result, unmount } = renderHook(() => useProvenance("facilityInfo.facilityName"), {
      wrapper: makeWrapper({ formRef, initial: { "facilityInfo.facilityName": entry() } }),
    });

    act(() => result.current.verify("facilityInfo.facilityName"));
    unmount(); // flushes the dirty map → fetch #1 rejects after unmount
    expect(fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROVENANCE_SAVE_DEBOUNCE_MS * 5);
    });
    expect(errorSpy).toHaveBeenCalledWith("[provenance] save failed", expect.any(Error));
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
