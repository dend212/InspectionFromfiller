import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockLoadRunRow, mockUpdateRun, mockRunAssessorStage } = vi.hoisted(() => ({
  mockLoadRunRow: vi.fn(),
  mockUpdateRun: vi.fn(),
  mockRunAssessorStage: vi.fn(),
}));

vi.mock("@/lib/prefill/run-store", () => ({
  loadRunRow: mockLoadRunRow,
  updateRun: mockUpdateRun,
}));

vi.mock("@/lib/prefill/assessor", () => ({
  runAssessorStage: mockRunAssessorStage,
}));

import { continuePrefillAfterSelection, runPrefill } from "@/lib/prefill/run-prefill";
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

beforeEach(() => {
  vi.clearAllMocks();
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
    expect(final.stages.permits).toEqual({ status: "skipped", summary: "Not available yet", links: [] });
    expect(final.finishedAt).toBeInstanceOf(Date);
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

  it("records a stage error when a stage rejects and still finishes the run", async () => {
    mockRunAssessorStage.mockRejectedValueOnce(new Error("boom"));
    await runPrefill("run-1");
    const final = lastPatch();
    expect(final.status).toBe("done");
    expect(final.stages.assessor).toMatchObject({ status: "error", error: "boom", links: [] });
    expect(final.proposals).toEqual([]);
  });

  it("marks the run failed (never throws) when persistence blows up", async () => {
    mockUpdateRun.mockRejectedValueOnce(new Error("db down"));
    await expect(runPrefill("run-1")).resolves.toBeUndefined();
    const final = lastPatch();
    expect(final.status).toBe("failed");
    expect(final.error).toBe("db down");
    expect(final.finishedAt).toBeInstanceOf(Date);
  });

  it("swallows a load failure", async () => {
    mockLoadRunRow.mockRejectedValueOnce(new Error("db down"));
    await expect(runPrefill("run-1")).resolves.toBeUndefined();
    expect(mockUpdateRun).not.toHaveBeenCalled();
  });
});

describe("continuePrefillAfterSelection", () => {
  it("fails the run with an explicit phase-1 message", async () => {
    await continuePrefillAfterSelection("run-1", ["edms_env:OW-17-00474:PERMIT:"]);
    expect(mockUpdateRun).toHaveBeenCalledWith("run-1", {
      status: "failed",
      error: "Candidate selection is not available yet",
      finishedAt: expect.any(Date),
    });
  });
});
