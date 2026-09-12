// scripts/prefill-permits-smoke.mts
/**
 * Live smoke test for the phase-2 permit search against the REAL Maricopa
 * EDMS API (both archives). Read-only unless --download is given, and even
 * then it only writes PDFs to a local directory — never Storage or the DB.
 *
 * Usage:
 *   npm run smoke:permits                       # 219-11-121 and 200-08-079
 *   npm run smoke:permits -- 219-12-165         # any APN(s)
 *   npm run smoke:permits -- --fallback         # blank the APN, exercise the street search
 *   npm run smoke:permits -- --download         # also download the PDFs
 *   SMOKE_OUT_DIR=/path npm run smoke:permits -- --download
 *
 * Expected (verified 2026-09-11):
 *   219-11-121 → env 000972 PERMIT (2015-09-11 scan, 8911 E CAVE CREEK RD, CAREFREE)
 *   200-08-079 → env OW-17-00474 PERMIT (2018-02-08) + OWR-22-04475 NOTICE OF TRANSFER (2022-09-21)
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatApn } from "../src/lib/prefill/apn";
import { isExtractableDocType, rankForExtraction } from "../src/lib/prefill/permits/doc-types";
import {
  EDMS_ARCHIVES,
  fetchDocumentBytes,
  getDocumentInfo,
} from "../src/lib/prefill/permits/edms-client";
import { searchPermits } from "../src/lib/prefill/permits/search";
import type { SearchHit } from "../src/lib/prefill/permits/candidates";
import {
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENTS_PER_RUN,
  type PrefillInput,
} from "../src/lib/prefill/types";

interface KnownParcel {
  input: PrefillInput;
  expectPermits: string[];
}

const KNOWN: Record<string, KnownParcel> = {
  "219-11-121": {
    input: {
      apn: "219-11-121",
      address: { streetNumber: "8911", streetName: "Cave Creek Rd", streetDir: "E", city: "Carefree" },
    },
    expectPermits: ["000972"],
  },
  "200-08-079": {
    input: {
      apn: "200-08-079",
      address: { streetNumber: "8911", streetName: "Villa Chula", streetDir: "W", city: "Peoria", zip: "85383" },
      subdivision: "Sunrise 4",
      lot: "2",
    },
    expectPermits: ["OW-17-00474", "OWR-22-04475"],
  },
};

const args = process.argv.slice(2);
const download = args.includes("--download");
const fallback = args.includes("--fallback");
const apns = args.filter((a) => !a.startsWith("--"));
const targets = apns.length > 0 ? apns : Object.keys(KNOWN);
const outDir = process.env.SMOKE_OUT_DIR ?? join(tmpdir(), "prefill-permits-smoke");

function archiveFor(hit: SearchHit) {
  return hit.candidate.archive === "edms_env" ? EDMS_ARCHIVES.env : EDMS_ARCHIVES.eplpav;
}

function safeName(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, "_");
}

async function downloadHits(apn: string, hits: SearchHit[], signal: AbortSignal): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  for (const hit of hits) {
    const { permitNumber, docType } = hit.candidate;
    const archive = archiveFor(hit);
    const info = await getDocumentInfo(archive, hit.documentId, signal);
    const mb = (info.size / (1024 * 1024)).toFixed(1);
    if (info.size > MAX_DOCUMENT_BYTES) {
      console.log(`    ${permitNumber} ${docType}: ${mb} MB — over the 25 MB cap, skipped`);
      continue;
    }
    const started = Date.now();
    const doc = await fetchDocumentBytes(archive, hit.documentId, signal);
    const file = join(outDir, safeName(`${apn}-${permitNumber}-${docType}.pdf`));
    writeFileSync(file, doc.bytes);
    console.log(
      `    ${permitNumber} ${docType}: ${doc.bytes.byteLength} bytes in ${Date.now() - started} ms` +
        ` (server said ${info.size}; filename "${doc.filename ?? "?"}") → ${file}`,
    );
  }
}

async function main(): Promise<number> {
  let failures = 0;
  const controller = new AbortController();
  const budget = setTimeout(() => controller.abort(), 240_000);

  for (const raw of targets) {
    const apn = formatApn(raw);
    const known = apn ? KNOWN[apn] : undefined;
    const input: PrefillInput = known?.input ?? { apn: apn ?? raw };
    const effective: PrefillInput = fallback ? { ...input, apn: undefined } : input;

    console.log(`\n=== ${raw}${fallback ? " (street fallback — APN blanked)" : ""} ===`);
    if (fallback && !effective.address) {
      console.log("  no address known for this APN — nothing to search");
      continue;
    }
    const started = Date.now();
    const outcome = await searchPermits(effective, controller.signal);
    console.log(`  outcome: ${outcome.kind}${"via" in outcome ? ` via ${outcome.via}` : ""} in ${Date.now() - started} ms`);
    console.log(`  searched: ${outcome.searched.join(" | ") || "(nothing)"}`);
    if (outcome.kind === "error") {
      console.log(`  error: ${outcome.message}`);
      failures++;
      continue;
    }
    if (outcome.kind === "not_found") {
      if (known) failures++;
      continue;
    }

    const hits = outcome.hits;
    console.log(`  ${outcome.kind === "ambiguous" ? "candidates" : "documents"} (${hits.length}):`);
    for (const h of hits) {
      const c = h.candidate;
      console.log(
        `    [${c.archive}] ${c.permitNumber.padEnd(13)} ${c.docType.padEnd(20)} ${c.docDate ?? "          "}` +
          `  ${(c.streetAddress ?? "").padEnd(26)} ${(c.city ?? "").padEnd(14)} ${c.zip ?? "     "}` +
          `  apn=${c.apn ?? "-"} score=${c.score} key=${c.key}`,
      );
    }

    if (outcome.kind === "found") {
      const ranked = rankForExtraction(hits.map((h) => ({ h, docType: h.candidate.docType, docDate: h.candidate.docDate })));
      let pending = 0;
      console.log("  extraction ranking:");
      for (const { h } of ranked) {
        const { permitNumber, docType } = h.candidate;
        let status = "skipped (not extractable)";
        if (isExtractableDocType(docType)) {
          status = pending < MAX_DOCUMENTS_PER_RUN ? "pending" : "skipped (over limit)";
          if (status === "pending") pending++;
        }
        console.log(`    ${permitNumber} ${docType} → ${status}`);
      }
      if (known) {
        const got = new Set(hits.map((h) => h.candidate.permitNumber));
        for (const expected of known.expectPermits) {
          if (!got.has(expected)) {
            console.log(`  MISSING expected permit ${expected}`);
            failures++;
          }
        }
      }
      if (download) {
        console.log(`  downloading to ${outDir}:`);
        await downloadHits(apn ?? raw, hits, controller.signal);
      }
    }
  }

  clearTimeout(budget);
  console.log(`\n${failures === 0 ? "OK" : `${failures} problem(s)`}`);
  return failures === 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
