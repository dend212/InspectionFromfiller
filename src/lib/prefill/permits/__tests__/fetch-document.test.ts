// @vitest-environment node
import { PDFDocument } from "pdf-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_DOCUMENT_BYTES } from "../../types";
import type { SearchHit } from "../candidates";
import { EDMS_ARCHIVES } from "../edms-client";
import { type StoreDocumentDeps, countPdfPages, storeDocument } from "../fetch-document";

// fetch-document.ts imports the run store for its default deps; keep the real
// Drizzle client out of the test process.
vi.mock("@/lib/prefill/run-store", () => ({ createRecordRow: vi.fn() }));

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // %PDF-1.4

const hit: SearchHit = {
  documentId: "ephemeral-Á-token=",
  candidate: {
    key: "edms_env:OW-17-00474:PERMIT:2018-02-08",
    archive: "edms_env",
    permitNumber: "OW-17-00474",
    docType: "PERMIT",
    docDate: "2018-02-08",
    description: "EnvSeptic - 2/8/2018 - OW-17-00474 - PERMIT",
    streetAddress: "8911 W VILLA CHULA",
    city: "PEORIA",
    zip: "85383",
    apn: "200-08-079",
    score: 10,
  },
};

function makeDeps(overrides: Partial<StoreDocumentDeps> = {}): StoreDocumentDeps {
  return {
    getDocumentInfo: vi.fn().mockResolvedValue({ size: 8, viewerMode: "PDF", isAboveDownloadThreshold: false }),
    fetchDocumentBytes: vi.fn().mockResolvedValue({ bytes: PDF_BYTES, contentType: "application/pdf", filename: "x.pdf" }),
    upload: vi.fn().mockResolvedValue(undefined),
    insertRecord: vi.fn().mockResolvedValue(undefined),
    countPages: vi.fn().mockResolvedValue(21),
    newId: () => "rec-1",
    findExisting: vi.fn().mockResolvedValue(null),
    reuseRecord: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const baseInput = {
  inspectionId: "insp-1",
  runId: "run-1",
  hit,
  extractionStatus: "pending" as const,
  signal: new AbortController().signal,
};

describe("storeDocument", () => {
  let deps: StoreDocumentDeps;
  beforeEach(() => {
    deps = makeDeps();
  });

  it("size-checks, downloads, uploads, counts pages after upload and inserts the row", async () => {
    const result = await storeDocument(baseInput, deps);

    expect(deps.getDocumentInfo).toHaveBeenCalledWith(EDMS_ARCHIVES.env, "ephemeral-Á-token=", baseInput.signal);
    expect(deps.fetchDocumentBytes).toHaveBeenCalledWith(EDMS_ARCHIVES.env, "ephemeral-Á-token=", baseInput.signal);
    expect(deps.upload).toHaveBeenCalledWith("records/insp-1/rec-1.pdf", PDF_BYTES);
    const uploadOrder = (deps.upload as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    const countOrder = (deps.countPages as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    expect(uploadOrder).toBeLessThan(countOrder);

    expect(deps.insertRecord).toHaveBeenCalledTimes(1);
    expect(deps.insertRecord).toHaveBeenCalledWith({
      id: "rec-1",
      inspectionId: "insp-1",
      runId: "run-1",
      source: "edms_env",
      permitNumber: "OW-17-00474",
      docType: "PERMIT",
      docDate: "2018-02-08",
      description: "EnvSeptic - 2/8/2018 - OW-17-00474 - PERMIT",
      pageCount: 21,
      sizeBytes: 8,
      storagePath: "records/insp-1/rec-1.pdf",
      selected: true,
      extractionStatus: "pending",
      extractionError: null,
      extracted: null,
    });
    expect(result).toEqual({
      recordId: "rec-1",
      stored: true,
      sizeBytes: 8,
      pageCount: 21,
      extractionStatus: "pending",
    });
  });

  it("never persists the ephemeral document ID anywhere in the row", async () => {
    await storeDocument(baseInput, deps);
    const row = (deps.insertRecord as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(JSON.stringify(row)).not.toContain("ephemeral");
  });

  it("skips documents over MAX_DOCUMENT_BYTES without downloading, still inserting a row", async () => {
    deps = makeDeps({
      getDocumentInfo: vi.fn().mockResolvedValue({ size: MAX_DOCUMENT_BYTES + 1, viewerMode: "PDF", isAboveDownloadThreshold: true }),
    });
    const result = await storeDocument(baseInput, deps);
    expect(deps.fetchDocumentBytes).not.toHaveBeenCalled();
    expect(deps.upload).not.toHaveBeenCalled();
    expect(deps.insertRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        storagePath: "",
        sizeBytes: MAX_DOCUMENT_BYTES + 1,
        pageCount: null,
        extractionStatus: "skipped",
        extractionError: expect.stringContaining("Larger than 25 MB (25.0 MB)"),
      }),
    );
    expect(result).toMatchObject({ stored: false, extractionStatus: "skipped" });
  });

  it("marks the row failed when the download fails", async () => {
    deps = makeDeps({ fetchDocumentBytes: vi.fn().mockRejectedValue(new Error("EDMS document download failed (500)")) });
    const result = await storeDocument(baseInput, deps);
    expect(deps.upload).not.toHaveBeenCalled();
    expect(deps.insertRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        storagePath: "",
        extractionStatus: "failed",
        extractionError: "Download failed: EDMS document download failed (500)",
      }),
    );
    expect(result).toMatchObject({ stored: false, extractionStatus: "failed", error: expect.stringContaining("Download failed") });
  });

  it("marks the row failed when the upload fails", async () => {
    deps = makeDeps({ upload: vi.fn().mockRejectedValue(new Error("Record upload failed: quota")) });
    const result = await storeDocument(baseInput, deps);
    expect(deps.insertRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        storagePath: "",
        extractionStatus: "failed",
        extractionError: "Storage upload failed: Record upload failed: quota",
      }),
    );
    expect(result.stored).toBe(false);
  });

  it("still downloads when the metadata call fails", async () => {
    deps = makeDeps({ getDocumentInfo: vi.fn().mockRejectedValue(new Error("EDMS document info failed (500)")) });
    const result = await storeDocument(baseInput, deps);
    expect(result.stored).toBe(true);
    expect(deps.insertRecord).toHaveBeenCalledWith(expect.objectContaining({ sizeBytes: 8 }));
  });

  it("enforces the size cap on the actual bytes when the metadata under-reported", async () => {
    const big = new Uint8Array(MAX_DOCUMENT_BYTES + 1);
    big.set([0x25, 0x50, 0x44, 0x46]);
    deps = makeDeps({ fetchDocumentBytes: vi.fn().mockResolvedValue({ bytes: big, contentType: "application/pdf", filename: null }) });
    const result = await storeDocument(baseInput, deps);
    expect(deps.upload).not.toHaveBeenCalled();
    expect(result).toMatchObject({ stored: false, extractionStatus: "skipped" });
  });

  it("looks up an existing stored row by identity (never the ephemeral document ID) before any EDMS call", async () => {
    await storeDocument(baseInput, deps);
    expect(deps.findExisting).toHaveBeenCalledTimes(1);
    expect(deps.findExisting).toHaveBeenCalledWith("insp-1", {
      source: "edms_env",
      permitNumber: "OW-17-00474",
      docType: "PERMIT",
      docDate: "2018-02-08",
    });
    expect(JSON.stringify((deps.findExisting as ReturnType<typeof vi.fn>).mock.calls[0])).not.toContain("ephemeral");
    const findOrder = (deps.findExisting as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    const infoOrder = (deps.getDocumentInfo as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    expect(findOrder).toBeLessThan(infoOrder);
    expect(deps.reuseRecord).not.toHaveBeenCalled();
  });

  it("passes a null doc date through to the identity lookup", async () => {
    const { docDate: _omit, ...candidate } = hit.candidate;
    await storeDocument({ ...baseInput, hit: { ...hit, candidate } }, deps);
    expect(deps.findExisting).toHaveBeenCalledWith("insp-1", expect.objectContaining({ docDate: null }));
  });

  describe("reusing an already-stored document (D7)", () => {
    const existing = {
      id: "rec-old",
      storagePath: "records/insp-1/rec-old.pdf",
      sizeBytes: 712751,
      pageCount: 4,
      extractionStatus: "done",
      extractionError: null,
    };

    it("reuses a `done` row as-is: no EDMS call, no download, no upload, no new row, no re-extraction", async () => {
      deps = makeDeps({ findExisting: vi.fn().mockResolvedValue(existing) });
      const result = await storeDocument(baseInput, deps);

      expect(deps.getDocumentInfo).not.toHaveBeenCalled();
      expect(deps.fetchDocumentBytes).not.toHaveBeenCalled();
      expect(deps.upload).not.toHaveBeenCalled();
      expect(deps.insertRecord).not.toHaveBeenCalled();
      expect(deps.reuseRecord).toHaveBeenCalledTimes(1);
      expect(deps.reuseRecord).toHaveBeenCalledWith("rec-old", {
        runId: "run-1",
        extractionStatus: "done",
        extractionError: null,
      });
      expect(result).toEqual({
        recordId: "rec-old",
        stored: true,
        reused: true,
        sizeBytes: 712751,
        pageCount: 4,
        extractionStatus: "done",
      });
    });

    it("re-queues a `failed` row for extraction without re-downloading it", async () => {
      deps = makeDeps({
        findExisting: vi.fn().mockResolvedValue({
          ...existing,
          extractionStatus: "failed",
          extractionError: "Claude API error: 500 boom",
        }),
      });
      const result = await storeDocument(baseInput, deps);
      expect(deps.fetchDocumentBytes).not.toHaveBeenCalled();
      expect(deps.insertRecord).not.toHaveBeenCalled();
      expect(deps.reuseRecord).toHaveBeenCalledWith("rec-old", {
        runId: "run-1",
        extractionStatus: "pending",
        extractionError: null,
      });
      expect(result).toMatchObject({ recordId: "rec-old", stored: true, reused: true, extractionStatus: "pending" });
    });

    it("re-queues a `pending` row (a previous run died mid-extraction) the same way", async () => {
      deps = makeDeps({ findExisting: vi.fn().mockResolvedValue({ ...existing, extractionStatus: "pending" }) });
      const result = await storeDocument(baseInput, deps);
      expect(deps.fetchDocumentBytes).not.toHaveBeenCalled();
      expect(deps.reuseRecord).toHaveBeenCalledWith("rec-old", expect.objectContaining({ extractionStatus: "pending" }));
      expect(result.extractionStatus).toBe("pending");
    });

    it("keeps a `done` row done even when this run has no extraction slot left for it", async () => {
      deps = makeDeps({ findExisting: vi.fn().mockResolvedValue(existing) });
      const result = await storeDocument(
        { ...baseInput, extractionStatus: "skipped", extractionError: "Over the 3-document limit" },
        deps,
      );
      expect(deps.reuseRecord).toHaveBeenCalledWith("rec-old", {
        runId: "run-1",
        extractionStatus: "done",
        extractionError: null,
      });
      expect(result.extractionStatus).toBe("done");
    });

    it("carries this run's skipped status + reason onto a reused row that was never read", async () => {
      deps = makeDeps({ findExisting: vi.fn().mockResolvedValue({ ...existing, extractionStatus: "skipped", extractionError: "old reason" }) });
      await storeDocument(
        { ...baseInput, extractionStatus: "skipped", extractionError: "Over the 3-document limit" },
        deps,
      );
      expect(deps.reuseRecord).toHaveBeenCalledWith("rec-old", {
        runId: "run-1",
        extractionStatus: "skipped",
        extractionError: "Over the 3-document limit",
      });
    });

    it("stores normally when the lookup itself fails (reuse is an optimisation, not a gate)", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      deps = makeDeps({ findExisting: vi.fn().mockRejectedValue(new Error("db down")) });
      const result = await storeDocument(baseInput, deps);
      expect(result).toMatchObject({ recordId: "rec-1", stored: true });
      expect(deps.fetchDocumentBytes).toHaveBeenCalledTimes(1);
      expect(deps.insertRecord).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });
  });

  it("carries a caller-supplied skipped status + reason onto a stored document", async () => {
    await storeDocument(
      { ...baseInput, extractionStatus: "skipped", extractionError: "Over the 3-document limit" },
      deps,
    );
    expect(deps.insertRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        storagePath: "records/insp-1/rec-1.pdf",
        extractionStatus: "skipped",
        extractionError: "Over the 3-document limit",
      }),
    );
  });
});

describe("countPdfPages", () => {
  it("counts pages of a real PDF", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.addPage();
    doc.addPage();
    const bytes = await doc.save();
    await expect(countPdfPages(new Uint8Array(bytes))).resolves.toBe(3);
  });

  it("returns null for bytes pdf-lib cannot parse", async () => {
    await expect(countPdfPages(new Uint8Array([1, 2, 3]))).resolves.toBeNull();
  });
});
