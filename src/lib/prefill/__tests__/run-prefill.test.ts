import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockLoadRunRow, mockUpdateRun, mockRunAssessorStage } = vi.hoisted(() => ({
  mockLoadRunRow: vi.fn(),
  mockUpdateRun: vi.fn(),
  mockRunAssessorStage: vi.fn(),
}));

vi.mock("@/lib/prefill/run-store", () => ({
  loadRunRow: mockLoadRunRow,
  updateRun: mockUpdateRun,
  setInspectionApnIfNull: vi.fn(async () => undefined),
}));

vi.mock("@/lib/prefill/assessor", () => ({
  runAssessorStage: mockRunAssessorStage,
}));

// The listing stub and the real permits stage (live EDMS + Storage) are mocked so the
// orchestrator test stays offline; the permits behaviour itself is covered by
// run-prefill.permits.test.ts.
const { mockRunListingStage, mockRunPermitsStage, mockRunPermitsSelection } = vi.hoisted(() => ({
  mockRunListingStage: vi.fn(async () => ({
    stage: { status: "skipped", summary: "Not available yet", links: [] },
    proposals: [],
  })),
  mockRunPermitsStage: vi.fn(async () => ({
    stage: { status: "not_found", summary: "No permit records found", links: [] },
    proposals: [],
  })),
  mockRunPermitsSelection: vi.fn(async () => ({
    stage: { status: "done", summary: "1 permit document found: 000972 PERMIT", links: [] },
    proposals: [],
  })),
}));
vi.mock("@/lib/prefill/listing", () => ({ runListingStage: mockRunListingStage }));
vi.mock("@/lib/prefill/permits", () => ({
  runPermitsStage: mockRunPermitsStage,
  runPermitsSelection: mockRunPermitsSelection,
}));

import {
  GENERIC_STAGE_ERROR,
  continuePrefillAfterSelection,
  runPrefill,
} from "@/lib/prefill/run-prefill";
import type { StageContext } from "@/lib/prefill/stage";
import type { PrefillInput } from "@/lib/prefill/types";

const RUN = {
  id: "run-1",
  inspectionId: "insp-1",
  trigger: "manual",
  status: "queued",
  input: { apn: "219-11-121" },
  stages: {},
  proposals: [],
  candidates: [],
  error: null,
  appliedAt: null,
  createdBy: "user-1",
  createdAt: new Date(),
  finishedAt: null,
};

const PROPOSAL = {
  fieldPath: "facilityInfo.taxParcelNumber",
  value: "219-11-121",
  kind: "fill" as const,
  provenance: { source: "assessor" as const, confidence: 1, explanation: "Assessor" },
};

function lastPatch() {
  const call = mockUpdateRun.mock.calls[mockUpdateRun.mock.calls.length - 1];
  return call[1];
}

// The orchestrator must never reach the network from a unit test — every stage is mocked.
// A real call is rejected here (so nothing leaves the process) and reported by the assertion.
let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("network access is not allowed in unit tests"));
  mockLoadRunRow.mockResolvedValue(RUN);
  mockUpdateRun.mockResolvedValue(undefined);
  mockRunAssessorStage.mockImplementation(async (_input: PrefillInput, ctx: StageContext) => {
    await ctx.progress({ status: "running" });
    return {
      stage: { status: "done", summary: "Parcel 219-11-121", links: [] },
      proposals: [PROPOSAL],
    };
  });
});

afterEach(() => {
  fetchSpy.mockRestore();
});

describe("runPrefill", () => {
  it("marks the run running, runs the stages, stores proposals and finishes done", async () => {
    await runPrefill("run-1");

    expect(mockUpdateRun.mock.calls[0][0]).toBe("run-1");
    expect(mockUpdateRun.mock.calls[0][1]).toMatchObject({ status: "running" });

    const final = lastPatch();
    expect(final.status).toBe("done");
    expect(final.proposals).toEqual([PROPOSAL]);
    expect(final.stages.assessor.status).toBe("done");
    expect(final.stages.listing).toEqual({ status: "skipped", summary: "Not available yet", links: [] });
    expect(final.stages.permits).toEqual({ status: "not_found", summary: "No permit records found", links: [] });
    expect(final.finishedAt).toBeInstanceOf(Date);
  });

  it("never reaches the network — every stage is mocked", async () => {
    await runPrefill("run-1");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(lastPatch().stages.permits).toEqual({
      status: "not_found",
      summary: "No permit records found",
      links: [],
    });
  });

  it("passes the run input and a StageContext to the assessor stage", async () => {
    await runPrefill("run-1");
    const [input, ctx] = mockRunAssessorStage.mock.calls[0];
    expect(input).toEqual({ apn: "219-11-121" });
    expect(ctx.inspectionId).toBe("insp-1");
    expect(ctx.runId).toBe("run-1");
    expect(ctx.signal).toBeInstanceOf(AbortSignal);
    expect(ctx.signal.aborted).toBe(false);
  });

  it("persists progress updates so the client can see stages advance", async () => {
    await runPrefill("run-1");
    const progressCall = mockUpdateRun.mock.calls.find(
      (c) => c[1].stages?.assessor?.status === "running",
    );
    expect(progressCall).toBeDefined();
  });

  it("does nothing when the run is missing or not queued", async () => {
    mockLoadRunRow.mockResolvedValueOnce(null);
    await runPrefill("run-1");
    mockLoadRunRow.mockResolvedValueOnce({ ...RUN, status: "done" });
    await runPrefill("run-1");
    expect(mockUpdateRun).not.toHaveBeenCalled();
    expect(mockRunAssessorStage).not.toHaveBeenCalled();
  });

  it("records a generic stage error when a stage rejects, logs the real one and still finishes", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = new Error("ECONNREFUSED 10.0.0.1:443");
    mockRunAssessorStage.mockRejectedValueOnce(boom);
    await runPrefill("run-1");
    const final = lastPatch();
    expect(final.status).toBe("done");
    // Internal rejection text never reaches the tile (it prints stage.error verbatim)
    expect(final.stages.assessor).toMatchObject({
      status: "error",
      error: GENERIC_STAGE_ERROR,
      links: [],
    });
    expect(final.stages.assessor.error).not.toContain("ECONNREFUSED");
    expect(errorSpy).toHaveBeenCalledWith("[prefill] assessor stage rejected", "run-1", boom);
    expect(final.proposals).toEqual([]);
    errorSpy.mockRestore();
  });

  it("marks the run failed (never throws) with a generic message and logs the real error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = new Error("db down: connection refused at 10.0.0.1:5432");
    mockUpdateRun.mockRejectedValueOnce(boom);
    await expect(runPrefill("run-1")).resolves.toBeUndefined();
    const final = lastPatch();
    expect(final.status).toBe("failed");
    // Internal error text never reaches the tile
    expect(final.error).toBe("Prefill failed — try again");
    expect(final.finishedAt).toBeInstanceOf(Date);
    expect(errorSpy).toHaveBeenCalledWith("[prefill] run failed", "run-1", boom);
    errorSpy.mockRestore();
  });

  it("swallows a load failure", async () => {
    mockLoadRunRow.mockRejectedValueOnce(new Error("db down"));
    await expect(runPrefill("run-1")).resolves.toBeUndefined();
    expect(mockUpdateRun).not.toHaveBeenCalled();
  });
});

describe("continuePrefillAfterSelection", () => {
  // The real continuation is covered by run-prefill.permits.test.ts; this keeps the
  // phase-1 never-rejects guarantee for the after() caller.
  it("never rejects inside after(): a thrown DB error marks the run failed with a generic message", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = new Error("db down");
    mockLoadRunRow.mockResolvedValue({ ...RUN, status: "running" });
    mockUpdateRun.mockRejectedValueOnce(boom);
    await expect(continuePrefillAfterSelection("run-1", ["k"])).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith("[prefill] run failed", "run-1", boom);
    expect(lastPatch()).toMatchObject({
      status: "failed",
      error: "Prefill failed — try again",
      finishedAt: expect.any(Date),
    });

    // Even the failure record can fail — still resolves
    mockUpdateRun.mockRejectedValue(new Error("db still down"));
    await expect(continuePrefillAfterSelection("run-1", ["k"])).resolves.toBeUndefined();
    errorSpy.mockRestore();
  });
});
