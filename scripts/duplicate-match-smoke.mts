// scripts/duplicate-match-smoke.mts
/**
 * Live, READ-ONLY smoke test for the possible-duplicate warning (duplicate-warning spec §12).
 * Builds each inspection's query from its own saved values, runs the real findPossibleDuplicates
 * as an admin viewer, then one findPossibleDuplicatesBatch over every row, and counts address
 * candidates rejected ONLY by the locality rule. Never writes anything.
 *
 * Prints COUNTS ONLY — never addresses, APNs, names or ids.
 *
 * Usage: npm run smoke:matches   (needs DATABASE_URL in .env.local)
 * Reference (spec §5.6, earlier rule set): 133 rows, 17 with matches, max 2 per row.
 */

import { asc, sql } from "drizzle-orm";
import { db } from "../src/lib/db";
import { inspections } from "../src/lib/db/schema";
import { findPossibleDuplicates, findPossibleDuplicatesBatch } from "../src/lib/inspection-matches/find";
import { CANDIDATE_LIMIT, localityCompatible, type MatchViewer } from "../src/lib/inspection-matches/match";
import { apnMatchKey, buildMatchQuery } from "../src/lib/inspection-matches/normalize";
import { findMatchCandidates } from "../src/lib/inspection-matches/store";
import { addressKey, addressKeysCompatible } from "../src/lib/prefill/address-key";

const ADMIN: MatchViewer = { userId: "00000000-0000-4000-8000-000000000000", privileged: true };

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is missing — set it in .env.local");
    process.exit(1);
  }

  const rows = await db
    .select({
      id: inspections.id,
      facilityAddress: inspections.facilityAddress,
      facilityCity: inspections.facilityCity,
      facilityZip: inspections.facilityZip,
      apn: inspections.apn,
      formApn: sql<string | null>`${inspections.formData} -> 'facilityInfo' ->> 'taxParcelNumber'`,
    })
    .from(inspections)
    .orderBy(asc(inspections.createdAt));

  const queries = rows.map((row) => ({
    row,
    query: buildMatchQuery({
      facilityAddress: row.facilityAddress ?? "",
      facilityCity: row.facilityCity ?? "",
      facilityZip: row.facilityZip ?? "",
      // The same form-first fallback the stored side uses (spec §5.1)
      taxParcelNumber: apnMatchKey(row.formApn) ? (row.formApn ?? "") : (row.apn ?? ""),
    }),
  }));

  let withQuery = 0;
  let withMatches = 0;
  let maxPerRow = 0;
  const pairs = { both: 0, apn: 0, address: 0 };
  let rejectedByLocalityOnly = 0;
  const started = Date.now();
  for (const { row, query } of queries) {
    if (!query) continue;
    withQuery += 1;
    const result = await findPossibleDuplicates(query, ADMIN, { excludeInspectionId: row.id, limit: CANDIDATE_LIMIT });
    if (result.matches.length > 0) withMatches += 1;
    maxPerRow = Math.max(maxPerRow, result.matches.length);
    for (const match of result.matches) {
      if (match.reasons.length === 2) pairs.both += 1;
      else if (match.reasons[0] === "apn") pairs.apn += 1;
      else pairs.address += 1;
    }

    if (query.address) {
      const { rows: candidates } = await findMatchCandidates({
        houseNumbers: [query.address.number],
        apnKeys: [],
        excludeInspectionId: row.id,
        limit: CANDIDATE_LIMIT,
      });
      for (const candidate of candidates) {
        const stored = addressKey(candidate.facilityAddress ?? "");
        if (stored && addressKeysCompatible(query.address, stored) && !localityCompatible(query, candidate)) {
          rejectedByLocalityOnly += 1;
        }
      }
    }
  }
  const totalMs = Date.now() - started;

  const batchStarted = Date.now();
  const batch = await findPossibleDuplicatesBatch(
    queries.map(({ row, query }) => ({ key: row.id, query, excludeWorkizJobIds: [] })),
    ADMIN,
    { limit: CANDIDATE_LIMIT },
  );
  const batchMs = Date.now() - batchStarted;
  // The batch has no self-exclusion (the picker has no inspection yet): drop each row's own match
  let batchWithMatches = 0;
  for (const [id, result] of batch) {
    if (result.matches.some((match) => match.inspectionId !== id)) batchWithMatches += 1;
  }

  console.log(`rows: ${rows.length} · with a usable query: ${withQuery}`);
  console.log(`rows with matches: ${withMatches} · max matches per row: ${maxPerRow}`);
  console.log(`directed pairs — apn+address: ${pairs.both} · apn only: ${pairs.apn} · address only: ${pairs.address}`);
  console.log(`rejectedByLocalityOnly (directed): ${rejectedByLocalityOnly}`);
  console.log(`batch rows with matches (self excluded): ${batchWithMatches}`);
  console.log(`total ${totalMs} ms (per-row checks) · batch ${batchMs} ms`);
  process.exit(0);
}

main().catch((err: unknown) => {
  // Class name only: a Drizzle error message carries query params
  console.error(`smoke failed: ${err instanceof Error ? err.name : "unknown"}`);
  process.exit(1);
});
