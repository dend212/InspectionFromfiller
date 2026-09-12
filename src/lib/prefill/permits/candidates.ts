// src/lib/prefill/permits/candidates.ts
/**
 * Converts heading-keyed EDMS rows into the shared `PermitCandidate` shape.
 * The ephemeral document token travels alongside as `SearchHit.documentId`
 * and is never written anywhere.
 */

import type { PermitCandidate } from "../types";
import { deriveEplpavDocType } from "./doc-types";
import type { EdmsArchiveConfig, EdmsRow } from "./edms-client";
import { candidateKey, decodeHtmlEntities, normaliseStreetDir, parseUsDate } from "./normalize";

export interface SearchHit {
  candidate: PermitCandidate;
  /** Ephemeral EDMS token — in-memory only, never persisted */
  documentId: string;
}

const ENV_NAME_DATE = /^EnvSeptic - (\d{1,2}\/\d{1,2}\/\d{4}) - /;

function orUndefined(value: string | undefined): string | undefined {
  return value ? value : undefined;
}

function envCandidate(archive: EdmsArchiveConfig, row: EdmsRow): PermitCandidate | null {
  const c = row.columns;
  const permitNumber = c.EnvPermitNumber;
  if (!permitNumber) return null;
  const docType = c.EnvSepticDocType || "PERMIT";
  const docDate = parseUsDate(ENV_NAME_DATE.exec(row.name)?.[1]);
  const streetAddress = [c.EnvStreetNo, normaliseStreetDir(c.EnvStreetDir ?? ""), c.EnvStreet]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();
  return {
    key: candidateKey(archive.archive, permitNumber, docType, docDate),
    archive: archive.archive,
    permitNumber,
    docType,
    docDate,
    description: orUndefined(row.name),
    streetAddress: orUndefined(streetAddress),
    city: orUndefined(c.EnvCity),
    zip: orUndefined(c.EnvZip),
    subdivision: orUndefined(c.EnvSubdivision),
    lot: orUndefined(c.EnvLotNumber),
    apn: orUndefined(c.ParcelNumber),
    score: 0,
  };
}

function eplpavCandidate(archive: EdmsArchiveConfig, row: EdmsRow): PermitCandidate | null {
  const c = row.columns;
  const permitNumber = c["Permit Number"];
  if (!permitNumber) return null;
  const docType = deriveEplpavDocType(c["Permit Subtype"] ?? "", c["File Name"] ?? "");
  const docDate =
    parseUsDate(c["Closed Date"]) ?? parseUsDate(c["Issued Date"]) ?? parseUsDate(c["Application Date"]);
  const description = decodeHtmlEntities(c.Description ?? "").slice(0, 300);
  const streetAddress = [c["Address Line 1"], c["Address Line 2"]]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();
  return {
    key: candidateKey(archive.archive, permitNumber, docType, docDate),
    archive: archive.archive,
    permitNumber,
    docType,
    docDate,
    description: orUndefined(description),
    streetAddress: orUndefined(streetAddress),
    city: orUndefined(c.City),
    zip: orUndefined(c["ZIP Code"]),
    subdivision: orUndefined(c["Subdivision (For Septic Only)"]),
    lot: orUndefined(c["LotNumber (For Septic Only)"]),
    apn: orUndefined(c["Parcel Number"]),
    score: 0,
  };
}

export function rowToCandidate(archive: EdmsArchiveConfig, row: EdmsRow): PermitCandidate | null {
  return archive.id === "env" ? envCandidate(archive, row) : eplpavCandidate(archive, row);
}

export function rowsToHits(archive: EdmsArchiveConfig, rows: EdmsRow[]): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const row of rows) {
    const candidate = rowToCandidate(archive, row);
    if (candidate) hits.push({ candidate, documentId: row.id });
  }
  return hits;
}
