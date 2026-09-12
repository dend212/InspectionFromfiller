import { describe, expect, it, vi } from "vitest";

// the default deps read rows through phase 1's run-store (which imports db); the tests inject deps
vi.mock("@/lib/prefill/run-store", () => ({ listRecordRows: vi.fn() }));
// extract-records imports db/admin/storage for its default deps only — stub them like its own tests do
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/storage/record-storage", () => ({ RECORD_BUCKET: "inspection-media" }));

import type { StoredRecord } from "@/lib/prefill/permits/extract-records";
import {
  buildExtractionSummary,
  withExtraction,
  type WithExtractionDeps,
} from "@/lib/prefill/permits/with-extraction";
import type { StageContext, StageResult } from "@/lib/prefill/stage";
import type { ProposedField } from "@/lib/prefill/types";

const ctx: StageContext = {
  inspectionId: "insp-1",
  runId: "run-1",
  signal: new AbortController().signal,
  progress: vi.fn().mockResolvedValue(undefined),
};

const record = (over: Partial<StoredRecord> & { id: string }): StoredRecord => ({
  inspectionId: "insp-1",
  permitNumber: "OW-17-00474",
  docType: "PERMIT",
  source: "edms_env",
  storagePath: `records/insp-1/${over.id}.pdf`,
  docDate: "2017-05-12",
  sizeBytes: 1000,
  extractionStatus: "pending",
  ...over,
});

const fill = (fieldPath: string, value: string, confidence: number): ProposedField => ({
  fieldPath,
  value,
  kind: "fill",
  provenance: { source: "permit", confidence, explanation: "x" },
});

const done: StageResult = {
  stage: {
    status: "done",
    summary: "2 permits found",
    links: [{ label: "Open on Maricopa EDMS", url: "https://edms.maricopa.gov/env/" }],
  },
  proposals: [fill("facilityInfo.recordsAvailable", "yes", 1)],
};

const extraction = {
  proposals: [fill("septicTank.tanks.0.tankCapacity", "1250", 0.97), fill("facilityInfo.recordsAvailable", "yes", 1)],
  done: 1,
  failed: 0,
  skipped: 1,
  abandonmentPermits: [] as string[],
  estimatedCostUsd: 0.04,
  highlights: ["OW-17-00474: 1,250 gal tank · 2 seepage pits"],
};

function deps(over: Partial<WithExtractionDeps> = {}) {
  const d = {
    loadRecords: vi.fn().mockResolvedValue([record({ id: "r1" }), record({ id: "r2", extractionStatus: "skipped" })]),
    extract: vi.fn().mockResolvedValue(extraction),
    ...over,
  };
  return d as WithExtractionDeps & { [K in keyof WithExtractionDeps]: ReturnType<typeof vi.fn> };
}

describe("withExtraction", () => {
  it("extracts the run's pending records and folds proposals + highlights into the stage result", async () => {
    const d = deps();
    const out = await withExtraction(ctx, done, d);
    expect(d.loadRecords).toHaveBeenCalledWith("run-1");
    expect(d.extract).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: "r1", extractionStatus: "pending" })]),
      ctx,
    );
    expect(out.stage.status).toBe("done");
    expect(out.stage.summary).toBe("2 permits found · OW-17-00474: 1,250 gal tank · 2 seepage pits");
    expect(out.stage.links).toEqual(done.stage.links);
    expect(out.stage.finishedAt).toBeTruthy();
    expect(out.proposals.map((p) => p.fieldPath)).toEqual([
      "facilityInfo.recordsAvailable",
      "septicTank.tanks.0.tankCapacity",
    ]);
  });

  it("leaves not_found / error / running / skipped results alone and preserves extra fields", async () => {
    for (const status of ["not_found", "error", "running", "skipped"] as const) {
      const d = deps();
      const result: StageResult & { candidates: unknown[] } = { stage: { status, links: [] }, proposals: [], candidates: [] };
      expect(await withExtraction(ctx, result, d)).toBe(result);
      expect(d.loadRecords).not.toHaveBeenCalled();
    }
  });

  it("returns the input unchanged when nothing is pending", async () => {
    const d = deps({ loadRecords: vi.fn().mockResolvedValue([record({ id: "r2", extractionStatus: "skipped" })]) });
    expect(await withExtraction(ctx, done, d)).toBe(done);
    expect(d.extract).not.toHaveBeenCalled();
  });

  it("still runs the extraction pass when the run only holds reused `done` records (D7)", async () => {
    const reused = record({ id: "r-old", extractionStatus: "done", extracted: { isAbandonment: false } as never });
    const d = deps({
      loadRecords: vi.fn().mockResolvedValue([reused]),
      extract: vi.fn().mockResolvedValue({ ...extraction, done: 0, estimatedCostUsd: 0 }),
    });
    const out = await withExtraction(ctx, done, d);
    expect(d.extract).toHaveBeenCalledWith([reused], ctx);
    expect(out.proposals.map((p) => p.fieldPath)).toEqual([
      "facilityInfo.recordsAvailable",
      "septicTank.tanks.0.tankCapacity",
    ]);
    expect(out.stage.summary).toBe("2 permits found · OW-17-00474: 1,250 gal tank · 2 seepage pits");
  });

  it("returns the input unchanged when the only `done` records carry no facts", async () => {
    const d = deps({ loadRecords: vi.fn().mockResolvedValue([record({ id: "r-old", extractionStatus: "done", extracted: null })]) });
    expect(await withExtraction(ctx, done, d)).toBe(done);
    expect(d.extract).not.toHaveBeenCalled();
  });

  it("keeps phase 2's recordsAvailable (the EDMS index row) over the mapper's, whatever the record class", async () => {
    const phase2: ProposedField = {
      fieldPath: "facilityInfo.recordsAvailable",
      value: "yes",
      kind: "fill",
      provenance: {
        source: "permit",
        confidence: 1,
        explanation: "Permit 071533 (PERMIT) found on Maricopa EDMS",
        sourceUrl: "/api/inspections/insp-1/records/rec-permit",
        recordId: "rec-permit",
        runId: "run-1",
      },
    };
    const fromMapper = (docRank: number, explanation: string): ProposedField => ({
      ...fill("facilityInfo.recordsAvailable", "yes", 1),
      provenance: { source: "permit", confidence: 1, explanation, recordId: "rec-x", page: 1 },
      authority: { docRank },
    });
    for (const mapper of [
      fromMapper(0, "Permit 071533 on file (PERMIT)"),
      fromMapper(2, "Notice of Transfer OWR-23-02001 on file"),
    ]) {
      const d = deps({ extract: vi.fn().mockResolvedValue({ ...extraction, proposals: [mapper] }) });
      const out = await withExtraction(ctx, { ...done, proposals: [phase2] }, d);
      const ra = out.proposals.filter((p) => p.fieldPath === "facilityInfo.recordsAvailable");
      expect(ra).toHaveLength(1);
      expect(ra[0]).toBe(phase2);
      expect(ra[0].provenance.explanation).toContain("found on Maricopa EDMS");
      expect(ra[0].provenance.sourceUrl).toBe("/api/inspections/insp-1/records/rec-permit");
    }
  });

  it("keeps the stage done and notes the problem when extraction crashes", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = deps({ extract: vi.fn().mockRejectedValue(new Error("db down")) });
    const out = await withExtraction(ctx, done, d);
    expect(out.stage.status).toBe("done");
    expect(out.stage.summary).toBe("2 permits found · extraction failed: db down");
    expect(out.proposals).toEqual(done.proposals);
    error.mockRestore();
  });
});

describe("buildExtractionSummary", () => {
  it("puts an abandonment banner first, then the base summary, highlights and failures", () => {
    expect(
      buildExtractionSummary("3 permits found", {
        ...extraction,
        failed: 1,
        abandonmentPermits: ["AB-01"],
        highlights: ["000972: 1,200 gal tank · seepage pit"],
      }),
    ).toBe(
      "ABANDONMENT on file (permit AB-01) · 3 permits found · 000972: 1,200 gal tank · seepage pit · 1 document could not be read",
    );
    expect(buildExtractionSummary(undefined, { ...extraction, highlights: [], done: 0, failed: 2 })).toBe(
      "2 documents could not be read",
    );
  });

  it("does not repeat an abandonment banner phase 2 already wrote", () => {
    expect(
      buildExtractionSummary("1 permit document found: OWR-22-01512 ABANDONMENT · ABANDONMENT on file (OWR-22-01512)", {
        ...extraction,
        proposals: [],
        highlights: [],
        abandonmentPermits: ["OWR-22-01512"],
      }),
    ).toBe("1 permit document found: OWR-22-01512 ABANDONMENT · ABANDONMENT on file (OWR-22-01512)");
  });
});
