import { act, renderHook, waitFor } from "@testing-library/react";
import type * as React from "react";
import { type UseFormReturn, useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProvenanceProvider, useProvenance } from "@/components/prefill/provenance-context";
import { PREFILL_POLL_MS, usePrefill } from "@/components/prefill/use-prefill";
import type { PrefillRunDTO } from "@/lib/prefill/types";
import { createEmptyTank, getDefaultFormValues } from "@/lib/validators/inspection";
import type { InspectionFormData } from "@/types/inspection";

const DONE_RUN: PrefillRunDTO = {
  id: "run-1",
  inspectionId: "insp-1",
  trigger: "manual",
  status: "done",
  input: { apn: "219-11-121" },
  stages: {
    assessor: { status: "done", summary: "Parcel 219-11-121", links: [] },
    listing: { status: "skipped", summary: "Not available yet", links: [] },
    permits: { status: "skipped", summary: "Not available yet", links: [] },
  },
  proposals: [
    {
      fieldPath: "facilityInfo.taxParcelNumber",
      value: "219-11-121",
      kind: "fill",
      provenance: { source: "assessor", confidence: 1, explanation: "Maricopa County Assessor · parcel 219-11-121" },
    },
    {
      fieldPath: "designFlow.numberOfBedrooms",
      value: "3",
      kind: "fill",
      provenance: { source: "permit", confidence: 0.6, explanation: "Permit 000972 p.1" },
    },
  ],
  candidates: [],
  error: null,
  appliedAt: null,
  createdAt: "2026-09-11T10:00:00.000Z",
  finishedAt: "2026-09-11T10:00:05.000Z",
  records: [],
};

type Route = { status: number; body: unknown };
type Handler = (method: string, url: string, body: unknown) => Route | undefined;

function installFetch(handler: Handler) {
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const route = handler(method, url, body) ?? { status: 404, body: { error: "no route" } };
    return { ok: route.status < 400, status: route.status, json: () => Promise.resolve(route.body) };
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

function calls(mock: ReturnType<typeof installFetch>) {
  return mock.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${url}`);
}

type FormRef = { current: UseFormReturn<InspectionFormData> | null };

function makeWrapper(formRef: FormRef) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    const form = useForm<InspectionFormData>({
      defaultValues: getDefaultFormValues("Tech") as unknown as InspectionFormData,
    });
    formRef.current = form;
    return (
      <ProvenanceProvider form={form} inspectionId="insp-1" initial={{}}>
        {children}
      </ProvenanceProvider>
    );
  };
}

// Tracks the most recently rendered hook so afterEach can unmount it before the fetch
// mock is torn down — ProvenanceProvider's save debounce schedules a real setTimeout,
// and an un-unmounted hook lets that timer fire later against the real (unstubbed)
// fetch, throwing "Failed to parse URL" from an unrelated test. Unmounting flushes it
// synchronously against the still-mocked fetch instead (same pattern as
// provenance-context.test.tsx's explicit `unmount()` calls).
let activeUnmount: (() => void) | null = null;

function renderPrefill(opts: { enabled?: boolean; initialRun?: PrefillRunDTO | null } = {}) {
  const formRef: FormRef = { current: null };
  const hook = renderHook(
    () => ({
      prefill: usePrefill({
        inspectionId: "insp-1",
        form: formRef.current as UseFormReturn<InspectionFormData>,
        enabled: opts.enabled ?? true,
        initialRun: opts.initialRun,
      }),
      prov: useProvenance(),
    }),
    { wrapper: makeWrapper(formRef) },
  );
  activeUnmount = hook.unmount;
  return { ...hook, formRef };
}

afterEach(() => {
  activeUnmount?.();
  activeUnmount = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("usePrefill", () => {
  it("does nothing when disabled", async () => {
    const mock = installFetch(() => undefined);
    const { result } = renderPrefill({ enabled: false });
    await act(async () => {});
    expect(mock).not.toHaveBeenCalled();
    expect(result.current.prefill.run).toBeNull();
    expect(result.current.prefill.isRunning).toBe(false);
  });

  it("loads the latest run on mount and applies an unapplied done run", async () => {
    const mock = installFetch((method, url) => {
      if (method === "GET" && url === "/api/inspections/insp-1/prefill/latest") return { status: 200, body: DONE_RUN };
      if (method === "POST" && url === "/api/inspections/insp-1/prefill/run-1/applied") return { status: 200, body: { ok: true } };
      return undefined;
    });
    const { result, formRef } = renderPrefill();

    await waitFor(() => {
      expect(formRef.current?.getValues("facilityInfo.taxParcelNumber")).toBe("219-11-121");
    });
    expect(result.current.prov.provenance["facilityInfo.taxParcelNumber"]).toMatchObject({
      source: "assessor",
      state: "prefilled",
      runId: "run-1",
    });
    // below the gate → suggestion, not written
    expect(formRef.current?.getValues("designFlow.numberOfBedrooms")).toBe("");
    expect(result.current.prov.provenance["designFlow.numberOfBedrooms"].state).toBe("suggested");

    await waitFor(() => {
      expect(calls(mock)).toContain("POST /api/inspections/insp-1/prefill/run-1/applied");
    });
    await waitFor(() => {
      expect(result.current.prefill.run?.appliedAt).toBeTruthy();
    });
  });

  it("adopts initialRun without fetching latest", async () => {
    const mock = installFetch((method, url) => {
      if (method === "POST" && url.endsWith("/applied")) return { status: 200, body: { ok: true } };
      return undefined;
    });
    const { result, formRef } = renderPrefill({ initialRun: DONE_RUN });
    await waitFor(() => {
      expect(formRef.current?.getValues("facilityInfo.taxParcelNumber")).toBe("219-11-121");
    });
    expect(calls(mock)).not.toContain("GET /api/inspections/insp-1/prefill/latest");
    expect(result.current.prefill.run?.id).toBe("run-1");
  });

  it("does not re-apply a run that was already applied", async () => {
    const mock = installFetch(() => undefined);
    const { formRef } = renderPrefill({
      initialRun: { ...DONE_RUN, appliedAt: "2026-09-11T10:01:00.000Z" },
    });
    await act(async () => {});
    expect(formRef.current?.getValues("facilityInfo.taxParcelNumber")).toBe("");
    expect(mock).not.toHaveBeenCalled();
  });

  it("start() posts, then polls every 2 s until the run is done and applies it", async () => {
    vi.useFakeTimers();
    let polls = 0;
    const mock = installFetch((method, url) => {
      if (method === "POST" && url === "/api/inspections/insp-1/prefill") return { status: 201, body: { runId: "run-2" } };
      if (method === "GET" && url === "/api/inspections/insp-1/prefill/run-2") {
        polls += 1;
        return polls < 2
          ? { status: 200, body: { ...DONE_RUN, id: "run-2", status: "running", proposals: [] } }
          : { status: 200, body: { ...DONE_RUN, id: "run-2" } };
      }
      if (method === "POST" && url === "/api/inspections/insp-1/prefill/run-2/applied") return { status: 200, body: { ok: true } };
      return undefined;
    });
    const { result, formRef } = renderPrefill({ initialRun: null });

    await act(async () => {
      await result.current.prefill.start({ apn: "219-11-121", trigger: "apn_lookup" });
    });
    const post = mock.mock.calls.find(([url, init]) => init?.method === "POST" && url === "/api/inspections/insp-1/prefill");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ apn: "219-11-121", trigger: "apn_lookup" });
    expect(result.current.prefill.run?.status).toBe("running");
    expect(result.current.prefill.isRunning).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PREFILL_POLL_MS);
    });
    expect(result.current.prefill.run?.status).toBe("done");
    expect(result.current.prefill.isRunning).toBe(false);
    expect(formRef.current?.getValues("facilityInfo.taxParcelNumber")).toBe("219-11-121");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(calls(mock)).toContain("POST /api/inspections/insp-1/prefill/run-2/applied");
  });

  it("surfaces the server error from start() (429 / 409) and keeps the previous run", async () => {
    installFetch((method, url) => {
      if (method === "POST" && url === "/api/inspections/insp-1/prefill") {
        return { status: 429, body: { error: "Prefill limit reached (3 per hour)" } };
      }
      return undefined;
    });
    const { result } = renderPrefill({ initialRun: null });
    await act(async () => {
      await result.current.prefill.start();
    });
    expect(result.current.prefill.error).toBe("Prefill limit reached (3 per hour)");
    expect(result.current.prefill.run).toBeNull();
  });

  it("surfaces a network failure from start()", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { result } = renderPrefill({ initialRun: null });
    await act(async () => {
      await result.current.prefill.start();
    });
    expect(result.current.prefill.error).toBe("Prefill failed — check your connection and try again");
  });

  it("selectCandidates surfaces the 409 from the select route", async () => {
    installFetch((method, url) => {
      if (method === "POST" && url === "/api/inspections/insp-1/prefill/run-1/select") {
        return { status: 409, body: { error: "Run is not awaiting selection" } };
      }
      if (method === "POST" && url.endsWith("/applied")) return { status: 200, body: { ok: true } };
      return undefined;
    });
    const { result } = renderPrefill({ initialRun: DONE_RUN });
    await act(async () => {
      await result.current.prefill.selectCandidates(["edms_env:000972:PERMIT:"]);
    });
    expect(result.current.prefill.error).toBe("Run is not awaiting selection");
  });

  it("grows a shorter septicTank.tanks array to fit a fill's tank index (amendment A1)", async () => {
    const runWithTankFill: PrefillRunDTO = {
      ...DONE_RUN,
      proposals: [
        {
          fieldPath: "septicTank.tanks.1.tankCapacity",
          value: "1000",
          kind: "fill",
          provenance: { source: "permit", confidence: 0.9, explanation: "Permit 000972 p.2" },
        },
      ],
    };
    installFetch((method, url) => {
      if (method === "POST" && url.endsWith("/applied")) return { status: 200, body: { ok: true } };
      return undefined;
    });
    const { formRef } = renderPrefill({ initialRun: runWithTankFill });

    await waitFor(() => {
      expect(formRef.current?.getValues("septicTank.tanks.1.tankCapacity")).toBe("1000");
    });
    const tanks = formRef.current?.getValues("septicTank.tanks");
    expect(tanks).toHaveLength(2);
    expect(tanks?.[0]).toEqual(createEmptyTank());
    expect(tanks?.[1]).toEqual({ ...createEmptyTank(), tankCapacity: "1000" });
    expect(formRef.current?.getValues("septicTank.numberOfTanks")).toBe("2");
  });
});
