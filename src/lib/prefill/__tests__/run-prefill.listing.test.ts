import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StageContext } from "@/lib/prefill/stage";
import type { PrefillInput, PrefillStage, ProposedField } from "@/lib/prefill/types";

// ---------------------------------------------------------------------------
// Mocks — same shape as run-prefill.test.ts / run-prefill.permits.test.ts: the
// orchestrator only reaches the DB through run-store, so that is what we mock.
// ---------------------------------------------------------------------------

const {
  mockLoadRunRow,
  mockUpdateRun,
  mockRunAssessorStage,
  mockRunListingStage,
  mockRunPermitsStage,
  mockRunPermitsSelection,
} = vi.hoisted(() => ({
  mockLoadRunRow: vi.fn(),
  mockUpdateRun: vi.fn(),
  mockRunAssessorStage: vi.fn(),
  mockRunListingStage: vi.fn(),
  mockRunPermitsStage: vi.fn(),
  mockRunPermitsSelection: vi.fn(),
}));

vi.mock("@/lib/prefill/run-store", () => ({
  loadRunRow: mockLoadRunRow,
  updateRun: mockUpdateRun,
  setInspectionApnIfNull: vi.fn(async () => undefined),
}));
vi.mock("@/lib/prefill/assessor", () => ({ runAssessorStage: mockRunAssessorStage }));
vi.mock("@/lib/prefill/listing", () => ({ runListingStage: mockRunListingStage }));
vi.mock("@/lib/prefill/permits", () => ({
  runPermitsStage: mockRunPermitsStage,
  runPermitsSelection: mockRunPermitsSelection,
}));

import { continuePrefillAfterSelection, runPrefill } from "@/lib/prefill/run-prefill";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RUN_ID = "run-1";
const INPUT: PrefillInput = {
  apn: "219-11-121",
  address: {
    streetNumber: "8911",
    streetDir: "E",
    streetName: "Cave Creek Rd",
    city: "Carefree",
    zip: "85377",
  },
};

function doneStage(summary: string, links: PrefillStage["links"] = []): PrefillStage {
  const at = new Date().toISOString();
  return { status: "done", startedAt: at, finishedAt: at, summary, links };
}

const ZILLOW_LINK = { label: "Open on Zillow", url: "https://www.zillow.com/homedetails/1_zpid/" };

const LISTING_PROPOSAL: ProposedField = {
  fieldPath: "facilityInfo.waterSource",
  value: "private_well",
  kind: "fill",
  provenance: {
    source: "listing",
    confidence: 0.8,
    explanation: "Zillow listing · Water source: Private Well",
  },
};
const PERMIT_PROPOSAL: ProposedField = {
  fieldPath: "septicTank.tankCapacity",
  value: "1250",
  kind: "fill",
  provenance: { source: "permit", confidence: 0.9, explanation: "Permit OW-17-00474 p.1" },
};

type RunPatch = { status?: string; stages?: Record<string, PrefillStage>; proposals?: ProposedField[] };

/** Every patch passed to `updateRun(runId, patch)`, in call order. */
function patches(): RunPatch[] {
  return mockUpdateRun.mock.calls.map((c) => c[1] as RunPatch);
}

function lastPatch(): RunPatch {
  const all = patches();
  return all[all.length - 1];
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** True when `p` resolves within `ms`, false otherwise — never throws, never hangs. */
function settledWithin(p: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    p.then(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

function errorStage(error: string): PrefillStage {
  return { ...doneStage(error), status: "error", error };
}

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    inspectionId: "insp-1",
    trigger: "manual",
    status: "queued",
    input: INPUT,
    stages: {},
    proposals: [],
    candidates: [],
    error: null,
    appliedAt: null,
    createdBy: null,
    createdAt: new Date(),
    finishedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadRunRow.mockResolvedValue(makeRun());
  mockUpdateRun.mockResolvedValue(undefined);
  mockRunAssessorStage.mockResolvedValue({ stage: doneStage("Parcel found"), proposals: [] });
  mockRunListingStage.mockResolvedValue({
    stage: doneStage("Water: Private Well", [ZILLOW_LINK]),
    proposals: [LISTING_PROPOSAL],
  });
  mockRunPermitsStage.mockResolvedValue({
    stage: doneStage("1 permit found"),
    proposals: [PERMIT_PROPOSAL],
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runPrefill — listing stage wiring", () => {
  it("calls runListingStage with the run input and a StageContext", async () => {
    await runPrefill(RUN_ID);

    expect(mockRunListingStage).toHaveBeenCalledTimes(1);
    const [input, ctx] = mockRunListingStage.mock.calls[0] as [PrefillInput, StageContext];
    expect(input).toEqual(INPUT);
    expect(ctx).toMatchObject({ inspectionId: "insp-1", runId: RUN_ID });
    expect(ctx.signal).toBeInstanceOf(AbortSignal);
    expect(typeof ctx.progress).toBe("function");
  });

  it("runs the listing and permits stages concurrently (parallel, not sequential)", async () => {
    // Handshake: listing cannot finish until permits has been ENTERED, and permits
    // cannot finish until listing has been entered. Only a concurrent orchestrator
    // enters both before awaiting either; a sequential one (in either order) leaves
    // the first stage waiting on a stage that is never started. The bounded wait
    // turns that into an error stage instead of a hung test, and the assertions
    // below check the persisted stage statuses and proposals — not just run.status,
    // which the orchestrator writes as "done" even when a stage errors or rejects.
    const listingEntered = deferred();
    const permitsEntered = deferred();

    mockRunListingStage.mockImplementation(async () => {
      listingEntered.resolve();
      if (!(await settledWithin(permitsEntered.promise, 1_000))) {
        return { stage: errorStage("permits stage was never entered while listing ran"), proposals: [] };
      }
      return { stage: doneStage("Water: Private Well"), proposals: [LISTING_PROPOSAL] };
    });
    mockRunPermitsStage.mockImplementation(async () => {
      permitsEntered.resolve();
      if (!(await settledWithin(listingEntered.promise, 1_000))) {
        return { stage: errorStage("listing stage was never entered while permits ran"), proposals: [] };
      }
      return { stage: doneStage("1 permit found"), proposals: [PERMIT_PROPOSAL] };
    });

    await runPrefill(RUN_ID);

    const final = lastPatch();
    expect(final.status).toBe("done");
    expect(final.stages?.listing).toMatchObject({ status: "done", summary: "Water: Private Well" });
    expect(final.stages?.permits).toMatchObject({ status: "done", summary: "1 permit found" });
    expect(final.proposals).toEqual(expect.arrayContaining([LISTING_PROPOSAL, PERMIT_PROPOSAL]));
  });

  it("persists the listing stage (with its link) and merges listing proposals into the run", async () => {
    await runPrefill(RUN_ID);

    const final = lastPatch();
    expect(final.status).toBe("done");
    expect(final.stages?.listing).toMatchObject({
      status: "done",
      summary: "Water: Private Well",
      links: [ZILLOW_LINK],
    });
    expect(final.proposals).toEqual(expect.arrayContaining([LISTING_PROPOSAL, PERMIT_PROPOSAL]));
  });

  it("persists listing progress updates while the stage runs", async () => {
    mockRunListingStage.mockImplementation(async (_input: PrefillInput, ctx: StageContext) => {
      await ctx.progress({
        status: "running",
        summary: "Searching Zillow for 8911 E Cave Creek Rd, Carefree, AZ 85377…",
      });
      return { stage: doneStage("Water: Private Well"), proposals: [] };
    });

    await runPrefill(RUN_ID);

    const running = patches().find((p) => p.stages?.listing?.status === "running");
    expect(running).toBeDefined();
  });

  it("a listing error never fails the run", async () => {
    mockRunListingStage.mockResolvedValue({
      stage: { ...doneStage("Zillow lookup failed"), status: "error", error: "Apify responded 402" },
      proposals: [],
    });

    await runPrefill(RUN_ID);

    const final = lastPatch();
    expect(final.status).toBe("done");
    expect(final.stages?.listing).toMatchObject({ status: "error", error: "Apify responded 402" });
    expect(final.proposals).toEqual([PERMIT_PROPOSAL]);
  });

  it("keeps the permit proposal when listing and permit propose the same field", async () => {
    mockRunPermitsStage.mockResolvedValue({
      stage: doneStage("1 permit found"),
      proposals: [{ ...PERMIT_PROPOSAL, fieldPath: "facilityInfo.waterSource", value: "municipal" }],
    });

    await runPrefill(RUN_ID);

    const proposals = lastPatch().proposals as ProposedField[];
    const water = proposals.filter((p) => p.fieldPath === "facilityInfo.waterSource");
    expect(water).toHaveLength(1);
    expect(water[0].provenance.source).toBe("permit");
  });
});

describe("continuePrefillAfterSelection — keeps listing proposals", () => {
  const CANDIDATE_KEY = "edms_env:000972:PERMIT:2015-09-11";

  function parkedRun(overrides: Record<string, unknown> = {}) {
    return makeRun({
      status: "running",
      stages: {
        assessor: doneStage("Parcel found"),
        listing: doneStage("Water: Private Well", [ZILLOW_LINK]),
        permits: { status: "running", links: [] },
      },
      proposals: [LISTING_PROPOSAL],
      candidates: [
        { key: CANDIDATE_KEY, archive: "edms_env", permitNumber: "000972", docType: "PERMIT", score: 5 },
      ],
      ...overrides,
    });
  }

  it("merges the newly extracted permit proposals with the run's existing non-permit proposals", async () => {
    mockLoadRunRow.mockResolvedValue(parkedRun());
    mockRunPermitsSelection.mockResolvedValue({
      stage: doneStage("1 permit stored"),
      proposals: [PERMIT_PROPOSAL],
    });

    await continuePrefillAfterSelection(RUN_ID, [CANDIDATE_KEY]);

    const final = lastPatch();
    expect(final.status).toBe("done");
    expect(final.proposals).toEqual(expect.arrayContaining([LISTING_PROPOSAL, PERMIT_PROPOSAL]));
    // The listing stage persisted at awaiting_selection (link included) survives the continuation
    expect(final.stages?.listing).toMatchObject({ status: "done", links: [ZILLOW_LINK] });
  });

  it("keeps the permit proposal when the selection's permit collides with a kept listing field", async () => {
    mockLoadRunRow.mockResolvedValue(parkedRun());
    mockRunPermitsSelection.mockResolvedValue({
      stage: doneStage("1 permit stored"),
      proposals: [{ ...PERMIT_PROPOSAL, fieldPath: "facilityInfo.waterSource", value: "municipal" }],
    });

    await continuePrefillAfterSelection(RUN_ID, [CANDIDATE_KEY]);

    const proposals = lastPatch().proposals as ProposedField[];
    const water = proposals.filter((p) => p.fieldPath === "facilityInfo.waterSource");
    expect(water).toHaveLength(1);
    expect(water[0].provenance.source).toBe("permit");
  });
});
