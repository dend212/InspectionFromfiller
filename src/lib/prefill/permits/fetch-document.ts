/**
 * Pull one EDMS document into Supabase Storage and record it as an
 * `inspection_records` row.
 *
 *   POST {Document}/ (size)  ->  GET {Document}/ (bytes, ≤ 25 MB)
 *   -> storage upload records/{inspectionId}/{recordId}.pdf
 *   -> pdf-lib page count -> insert row
 *
 * Every path inserts exactly one row. Documents that could not be stored
 * (too large, download/upload failure) get `storage_path = ""` plus a
 * human-readable `extraction_error`, so the tile can list them and the
 * records route can refuse them.
 */

import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { recordStoragePath, uploadRecordPdf } from "@/lib/storage/record-storage";
import { type NewInspectionRecordRow, createRecordRow } from "../run-store";
import { type ExtractionStatus, MAX_DOCUMENT_BYTES } from "../types";
import type { SearchHit } from "./candidates";
import {
  EDMS_ARCHIVES,
  type EdmsArchiveConfig,
  fetchDocumentBytes,
  getDocumentInfo,
} from "./edms-client";

export type NewInspectionRecord = NewInspectionRecordRow;

export interface StoreDocumentInput {
  inspectionId: string;
  runId: string;
  hit: SearchHit;
  /** "pending" for the ranked-for-extraction docs, "skipped" (with a reason) for the rest */
  extractionStatus: ExtractionStatus;
  extractionError?: string | null;
  signal: AbortSignal;
}

export interface StoreDocumentResult {
  recordId: string;
  stored: boolean;
  sizeBytes: number | null;
  pageCount: number | null;
  extractionStatus: ExtractionStatus;
  error?: string;
}

export interface StoreDocumentDeps {
  getDocumentInfo: typeof getDocumentInfo;
  fetchDocumentBytes: typeof fetchDocumentBytes;
  upload: (storagePath: string, bytes: Uint8Array) => Promise<void>;
  insertRecord: (row: NewInspectionRecord) => Promise<void>;
  countPages: (bytes: Uint8Array) => Promise<number | null>;
  newId: () => string;
}

/** Page count via pdf-lib; null when the file is not parseable (row still stored). */
export async function countPdfPages(bytes: Uint8Array): Promise<number | null> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    return doc.getPageCount();
  } catch {
    return null;
  }
}

const defaultDeps: StoreDocumentDeps = {
  getDocumentInfo,
  fetchDocumentBytes,
  upload: uploadRecordPdf,
  insertRecord: async (row) => {
    await createRecordRow(row);
  },
  countPages: countPdfPages,
  newId: () => randomUUID(),
};

function archiveFor(hit: SearchHit): EdmsArchiveConfig {
  return hit.candidate.archive === "edms_env" ? EDMS_ARCHIVES.env : EDMS_ARCHIVES.eplpav;
}

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function tooLargeMessage(bytes: number): string {
  return `Larger than 25 MB (${megabytes(bytes)}) — open it on Maricopa EDMS`;
}

export async function storeDocument(
  input: StoreDocumentInput,
  deps: StoreDocumentDeps = defaultDeps,
): Promise<StoreDocumentResult> {
  const { hit, signal } = input;
  const candidate = hit.candidate;
  const archive = archiveFor(hit);
  const recordId = deps.newId();

  // Row template — note: no EDMS document ID anywhere in here.
  const base: NewInspectionRecord = {
    id: recordId,
    inspectionId: input.inspectionId,
    runId: input.runId,
    source: candidate.archive,
    permitNumber: candidate.permitNumber,
    docType: candidate.docType,
    docDate: candidate.docDate ?? null,
    description: candidate.description ?? null,
    pageCount: null,
    sizeBytes: null,
    storagePath: "",
    selected: true,
    extractionStatus: input.extractionStatus,
    extractionError: input.extractionError ?? null,
    extracted: null,
  };

  const notStored = async (
    extractionStatus: ExtractionStatus,
    error: string,
    sizeBytes: number | null,
  ): Promise<StoreDocumentResult> => {
    await deps.insertRecord({ ...base, sizeBytes, extractionStatus, extractionError: error });
    return { recordId, stored: false, sizeBytes, pageCount: null, extractionStatus, error };
  };

  // 1. Size gate (metadata POST). A metadata failure is not fatal — the GET decides.
  let reportedSize: number | null = null;
  try {
    reportedSize = (await deps.getDocumentInfo(archive, hit.documentId, signal)).size;
  } catch (err) {
    console.warn(`[prefill/permits] document info failed for ${candidate.permitNumber}:`, err);
  }
  if (reportedSize !== null && reportedSize > MAX_DOCUMENT_BYTES) {
    return notStored("skipped", tooLargeMessage(reportedSize), reportedSize);
  }

  // 2. Download
  let bytes: Uint8Array;
  try {
    ({ bytes } = await deps.fetchDocumentBytes(archive, hit.documentId, signal));
  } catch (err) {
    return notStored("failed", `Download failed: ${errorMessage(err)}`, reportedSize);
  }
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
    return notStored("skipped", tooLargeMessage(bytes.byteLength), bytes.byteLength);
  }

  // 3. Upload
  const storagePath = recordStoragePath(input.inspectionId, recordId);
  try {
    await deps.upload(storagePath, bytes);
  } catch (err) {
    return notStored("failed", `Storage upload failed: ${errorMessage(err)}`, bytes.byteLength);
  }

  // 4. Page count after the upload, then the row
  const pageCount = await deps.countPages(bytes);
  await deps.insertRecord({ ...base, storagePath, sizeBytes: bytes.byteLength, pageCount });
  return {
    recordId,
    stored: true,
    sizeBytes: bytes.byteLength,
    pageCount,
    extractionStatus: input.extractionStatus,
  };
}
