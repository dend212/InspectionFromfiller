// @vitest-environment node
/**
 * D7 (e2e): a second Find records on the same inspection re-downloaded the
 * same permit PDF (second inspection_records row, second 712 KB object) and
 * re-ran Sonnet extraction. This drives the real permits stage end to end —
 * storeDocument → withExtraction → extractStoredRecords — against an
 * in-memory inspection_records table with the first run's row already in it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  type Row = Record<string, unknown> & { id: string; runId: string | null; storagePath: string };
  const table: Row[] = [];
  return {
    table,
    createRecordRow: vi.fn(async (row: Row) => {
      table.push({ ...row });
      return row.id;
    }),
    findStoredRecordByIdentity: vi.fn(
      async (inspectionId: string, id: { source: string; permitNumber: string; docType: string; docDate: string | null }) =>
        [...table]
          .reverse()
          .find(
            (r) =>
              r.inspectionId === inspectionId &&
              r.source === id.source &&
              r.permitNumber === id.permitNumber &&
              r.docType === id.docType &&
              (r.docDate ?? null) === id.docDate &&
              r.storagePath !== "",
          ) ?? null,
    ),
    reuseRecordRow: vi.fn(async (recordId: string, patch: Record<string, unknown>) => {
      const row = table.find((r) => r.id === recordId);
      if (row) Object.assign(row, patch, { selected: true });
    }),
    listRecordRows: vi.fn(async (runId: string) => table.filter((r) => r.runId === runId)),
    persistSet: vi.fn(),
    fetchDocumentBytes: vi.fn(),
    getDocumentInfo: vi.fn(),
    uploadRecordPdf: vi.fn(),
    extractPermitFactsFromPdf: vi.fn(),
    download: vi.fn(),
  };
});

vi.mock("@/lib/prefill/run-store", () => ({
  createRecordRow: mocks.createRecordRow,
  findStoredRecordByIdentity: mocks.findStoredRecordByIdentity,
  reuseRecordRow: mocks.reuseRecordRow,
  listRecordRows: mocks.listRecordRows,
}));
vi.mock("@/lib/prefill/permits/edms-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/prefill/permits/edms-client")>()),
  fetchDocumentBytes: mocks.fetchDocumentBytes,
  getDocumentInfo: mocks.getDocumentInfo,
}));
vi.mock("@/lib/storage/record-storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage/record-storage")>()),
  uploadRecordPdf: mocks.uploadRecordPdf,
}));
vi.mock("@/lib/ai/extract-permit-facts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/extract-permit-facts")>()),
  extractPermitFactsFromPdf: mocks.extractPermitFactsFromPdf,
}));
vi.mock("@/lib/db", () => {
  // extract-records persists through db.update(...).set(patch).where(...): apply the patch to
  // the one row a test leaves pending (the re-extract case) so listRecordRows sees it
  const chain = {
    set: vi.fn((patch: Record<string, unknown>) => {
      mocks.persistSet(patch);
      const row = mocks.table.find((r) => r.extractionStatus === "pending");
      if (row) Object.assign(row, patch);
      return chain;
    }),
    where: vi.fn(async () => undefined),
  };
  return { db: { update: vi.fn(() => chain) } };
});
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ storage: { from: () => ({ download: mocks.download }) } }),
}));

import { PERMIT_EXTRACTION_VERSION } from "@/lib/ai/permit-extraction-prompt";
import { emptyPermitFacts, type PermitFacts } from "@/lib/ai/permit-extraction-schema";
import type { SearchHit } from "@/lib/prefill/permits/candidates";
import { storeDocument } from "@/lib/prefill/permits/fetch-document";
import { type PermitsStageDeps, runPermitsSelection, runPermitsStage } from "@/lib/prefill/permits/index";
import type { StageContext } from "@/lib/prefill/stage";

const f = <T>(value: T, confidence = 0.97, page = 1) => ({ value, confidence, page, evidence: `ev:${String(value)}`, handwritten: false });

const facts: PermitFacts = {
  ...emptyPermitFacts(),
  documentKind: "discharge_authorization",
  permitNumber: f("000972", 0.98),
  tanks: [{ capacityGal: f(1000), material: null, model: null, dimensions: null }],
  designFlowGpd: f(450),
};

const PERMIT: SearchHit = {
  documentId: "ephemeral-token-run-2",
  candidate: {
    key: "edms_env:000972:PERMIT:2000-04-12",
    archive: "edms_env",
    permitNumber: "000972",
    docType: "PERMIT",
    docDate: "2000-04-12",
    description: "EnvSeptic - 4/12/2000 - 000972 - PERMIT",
    apn: "219-11-121",
    score: 10,
  },
};

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x33]);

function existingRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "rec-run-1",
    inspectionId: "insp-1",
    runId: "run-1",
    source: "edms_env",
    permitNumber: "000972",
    docType: "PERMIT",
    docDate: "2000-04-12",
    description: "EnvSeptic - 4/12/2000 - 000972 - PERMIT",
    pageCount: 4,
    sizeBytes: 712751,
    storagePath: "records/insp-1/rec-run-1.pdf",
    selected: true,
    extractionStatus: "done",
    extractionError: null,
    extracted: facts,
    extractionVersion: PERMIT_EXTRACTION_VERSION,
    createdAt: new Date("2026-09-11T00:00:00Z"),
    ...over,
  };
}

function ctx(): StageContext {
  return {
    inspectionId: "insp-1",
    runId: "run-2",
    signal: new AbortController().signal,
    progress: vi.fn().mockResolvedValue(undefined),
  };
}

function deps(): PermitsStageDeps {
  return {
    searchPermits: vi.fn().mockResolvedValue({
      kind: "found",
      via: "apn",
      hits: [PERMIT],
      searched: ["APN 219-11-121"],
      failedArchives: [],
    }),
    storeDocument: (input) => storeDocument(input),
  };
}

const input = { apn: "219-11-121" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.table.length = 0;
  mocks.getDocumentInfo.mockResolvedValue({ size: PDF.byteLength, viewerMode: "PDF", isAboveDownloadThreshold: false });
  mocks.fetchDocumentBytes.mockResolvedValue({ bytes: PDF, contentType: "application/pdf", filename: "x.pdf" });
  mocks.uploadRecordPdf.mockResolvedValue(undefined);
  mocks.download.mockResolvedValue({ data: new Blob([PDF]), error: null });
  mocks.extractPermitFactsFromPdf.mockResolvedValue({
    facts,
    passes: 1,
    escalations: 0,
    pageCount: 4,
    usage: { calls: [], estimatedCostUsd: 0.04 },
  });
});

describe("second Find records on an inspection with a stored + extracted record (D7)", () => {
  it("neither downloads, uploads, inserts nor re-extracts — and still lists the record and applies its facts", async () => {
    mocks.table.push(existingRow());
    const result = await runPermitsStage(input, ctx(), deps());

    expect(mocks.getDocumentInfo).not.toHaveBeenCalled();
    expect(mocks.fetchDocumentBytes).not.toHaveBeenCalled();
    expect(mocks.uploadRecordPdf).not.toHaveBeenCalled();
    expect(mocks.createRecordRow).not.toHaveBeenCalled();
    expect(mocks.extractPermitFactsFromPdf).not.toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();

    // the one row now belongs to run 2 and is listed for it, exactly as if just stored
    expect(mocks.table).toHaveLength(1);
    expect(mocks.table[0]).toMatchObject({
      id: "rec-run-1",
      runId: "run-2",
      extractionStatus: "done",
      extracted: facts,
      extractionVersion: PERMIT_EXTRACTION_VERSION,
    });
    await expect(mocks.listRecordRows("run-2")).resolves.toHaveLength(1);

    expect(result.stage.status).toBe("done");
    expect(result.stage.summary).toBe(
      "1 permit document found: 000972 PERMIT · 000972: 1,000 gal tank · 450 gpd design flow",
    );
    const byPath = Object.fromEntries(result.proposals.map((p) => [p.fieldPath, p]));
    expect(byPath["facilityInfo.recordsAvailable"]).toMatchObject({
      value: "yes",
      provenance: { recordId: "rec-run-1", sourceUrl: "/api/inspections/insp-1/records/rec-run-1" },
    });
    expect(byPath["septicTank.tanks.0.tankCapacity"]).toMatchObject({
      value: "1000",
      provenance: { recordId: "rec-run-1", sourceUrl: "/api/inspections/insp-1/records/rec-run-1#page=1" },
    });
    // the ephemeral EDMS token from the fresh search is still never written anywhere
    expect(JSON.stringify(mocks.table)).not.toContain("ephemeral");
  });

  it("re-extracts (but does not re-download) a record whose earlier extraction failed", async () => {
    mocks.table.push(existingRow({ extractionStatus: "failed", extractionError: "Claude API error: 500 boom", extracted: null }));
    const result = await runPermitsStage(input, ctx(), deps());

    expect(mocks.fetchDocumentBytes).not.toHaveBeenCalled();
    expect(mocks.uploadRecordPdf).not.toHaveBeenCalled();
    expect(mocks.createRecordRow).not.toHaveBeenCalled();
    expect(mocks.download).toHaveBeenCalledWith("records/insp-1/rec-run-1.pdf");
    expect(mocks.extractPermitFactsFromPdf).toHaveBeenCalledTimes(1);
    expect(mocks.persistSet).toHaveBeenCalledWith({
      extractionStatus: "done",
      extractionError: null,
      extracted: facts,
      extractionVersion: PERMIT_EXTRACTION_VERSION,
    });
    expect(mocks.table).toHaveLength(1);
    expect(mocks.table[0]).toMatchObject({
      id: "rec-run-1",
      runId: "run-2",
      extractionStatus: "done",
      extractionVersion: PERMIT_EXTRACTION_VERSION,
    });
    expect(result.proposals.find((p) => p.fieldPath === "septicTank.tanks.0.tankCapacity")?.value).toBe("1000");
  });

  describe("facts read under an older extraction version (prompt / schema / coercion bump)", () => {
    // 11420 N Saint Andrews Way: the DA's stored facts pre-date the waterSource prompt fix and must be
    // re-read — replaying them would keep "Find records" from ever producing the new facts.
    const staleFacts: PermitFacts = {
      ...emptyPermitFacts(),
      documentKind: "discharge_authorization",
      permitNumber: f("000972", 0.98),
      tanks: [{ capacityGal: f(1250), material: null, model: null, dimensions: null }],
    };
    const freshFacts: PermitFacts = { ...facts, waterSource: f("municipal" as const, 0.95) };

    for (const [label, extractionVersion] of [
      ["an older version stamp", "2026-09-01.1"],
      ["no version stamp (read before versioning)", null],
    ] as const) {
      it(`re-reads (without re-downloading) a \`done\` record carrying ${label} and stamps the current version`, async () => {
        mocks.table.push(existingRow({ extracted: staleFacts, extractionVersion }));
        mocks.extractPermitFactsFromPdf.mockResolvedValue({
          facts: freshFacts,
          passes: 1,
          escalations: 0,
          pageCount: 4,
          usage: { calls: [], estimatedCostUsd: 0.04 },
        });
        const result = await runPermitsStage(input, ctx(), deps());

        // the stored PDF is kept: no EDMS call, no upload, no new row — but it IS read again
        expect(mocks.getDocumentInfo).not.toHaveBeenCalled();
        expect(mocks.fetchDocumentBytes).not.toHaveBeenCalled();
        expect(mocks.uploadRecordPdf).not.toHaveBeenCalled();
        expect(mocks.createRecordRow).not.toHaveBeenCalled();
        expect(mocks.reuseRecordRow).toHaveBeenCalledWith("rec-run-1", {
          runId: "run-2",
          extractionStatus: "pending",
          extractionError: null,
          extracted: null,
          extractionVersion: null,
        });
        expect(mocks.download).toHaveBeenCalledWith("records/insp-1/rec-run-1.pdf");
        expect(mocks.extractPermitFactsFromPdf).toHaveBeenCalledTimes(1);
        expect(mocks.persistSet).toHaveBeenCalledWith({
          extractionStatus: "done",
          extractionError: null,
          extracted: freshFacts,
          extractionVersion: PERMIT_EXTRACTION_VERSION,
        });
        expect(mocks.table).toHaveLength(1);
        expect(mocks.table[0]).toMatchObject({
          id: "rec-run-1",
          runId: "run-2",
          extractionStatus: "done",
          extracted: freshFacts,
          extractionVersion: PERMIT_EXTRACTION_VERSION,
        });

        // only the fresh facts reach the proposals — the stale 1,250 gal tank is never replayed
        expect(result.stage.status).toBe("done");
        const caps = result.proposals.filter((p) => p.fieldPath === "septicTank.tanks.0.tankCapacity");
        expect(caps.map((p) => p.value)).toEqual(["1000"]);
        expect(result.proposals.find((p) => p.fieldPath === "facilityInfo.waterSource")?.value).toBe("municipal");
        expect(result.stage.summary).toBe(
          "1 permit document found: 000972 PERMIT · 000972: 1,000 gal tank · 450 gpd design flow",
        );
      });
    }
  });

  it("treats the same permit with a different doc date as a new document", async () => {
    mocks.table.push(existingRow({ docDate: "1999-12-01" }));
    const result = await runPermitsStage(input, ctx(), deps());

    expect(mocks.fetchDocumentBytes).toHaveBeenCalledTimes(1);
    expect(mocks.uploadRecordPdf).toHaveBeenCalledTimes(1);
    expect(mocks.createRecordRow).toHaveBeenCalledTimes(1);
    expect(mocks.reuseRecordRow).not.toHaveBeenCalled();
    expect(mocks.extractPermitFactsFromPdf).toHaveBeenCalledTimes(1);
    expect(mocks.table).toHaveLength(2);
    expect(mocks.table.map((r) => r.runId)).toEqual(["run-1", "run-2"]);
    expect(result.proposals.find((p) => p.fieldPath === "septicTank.tanks.0.tankCapacity")?.value).toBe("1000");
  });

  it("applies the same rule after a candidate selection (runPermitsSelection)", async () => {
    mocks.table.push(existingRow());
    const result = await runPermitsSelection(input, ctx(), [PERMIT.candidate.key], deps());

    expect(mocks.fetchDocumentBytes).not.toHaveBeenCalled();
    expect(mocks.uploadRecordPdf).not.toHaveBeenCalled();
    expect(mocks.createRecordRow).not.toHaveBeenCalled();
    expect(mocks.extractPermitFactsFromPdf).not.toHaveBeenCalled();
    expect(mocks.table).toHaveLength(1);
    expect(mocks.table[0]).toMatchObject({ runId: "run-2", extractionStatus: "done" });
    expect(result.stage.status).toBe("done");
    expect(result.proposals.find((p) => p.fieldPath === "septicTank.tanks.0.tankCapacity")?.value).toBe("1000");
  });
});
