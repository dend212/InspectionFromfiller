#!/usr/bin/env node
// Apply src/lib/db/migrations/0012_multi_assignee_jobs.sql to the remote DB.
// Usage: node --env-file=.env.local scripts/apply-multi-assignee-migration.mjs

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!connectionString) {
  console.error("Missing DATABASE_URL (or DIRECT_URL) in .env.local");
  process.exit(1);
}

const migrationPath = path.join(
  repoRoot,
  "src/lib/db/migrations/0012_multi_assignee_jobs.sql",
);
const sql = await readFile(migrationPath, "utf8");

const client = postgres(connectionString, { prepare: false, max: 1 });

try {
  console.log("Applying 0012_multi_assignee_jobs.sql …");
  await client.unsafe(sql);
  console.log("Migration applied cleanly.\n");

  // ---- Verification ----
  // 1. Column exists with the right shape
  const cols = await client`
    SELECT column_name, data_type, udt_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'jobs'
      AND column_name IN ('assigned_to', 'assignees')
  `;

  const hasOldColumn = cols.some((c) => c.column_name === "assigned_to");
  const newCol = cols.find((c) => c.column_name === "assignees");

  if (hasOldColumn) {
    console.error("FAIL: old assigned_to column still exists");
    process.exit(2);
  }
  if (!newCol) {
    console.error("FAIL: new assignees column is missing");
    process.exit(2);
  }
  // `data_type` for a uuid[] is "ARRAY" and `udt_name` is "_uuid"
  if (newCol.udt_name !== "_uuid") {
    console.error(
      `FAIL: assignees column has unexpected udt_name ${newCol.udt_name} (expected _uuid)`,
    );
    process.exit(2);
  }
  if (newCol.is_nullable !== "NO") {
    console.error("FAIL: assignees column is nullable (expected NOT NULL)");
    process.exit(2);
  }
  console.log("  ✓ assignees column present (uuid[], NOT NULL)");

  // 2. GIN index exists
  const idx = await client`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'jobs' AND indexname = 'jobs_assignees_gin_idx'
  `;
  if (idx.length === 0) {
    console.error("FAIL: missing GIN index jobs_assignees_gin_idx");
    process.exit(2);
  }
  console.log("  ✓ jobs_assignees_gin_idx");

  // 3. Old index gone
  const oldIdx = await client`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'jobs' AND indexname = 'jobs_assigned_to_idx'
  `;
  if (oldIdx.length > 0) {
    console.error("FAIL: old jobs_assigned_to_idx still exists");
    process.exit(2);
  }
  console.log("  ✓ old jobs_assigned_to_idx dropped");

  // 4. Sanity-check: backfilled data is in the array for every row
  const rowCount = await client`SELECT COUNT(*)::int AS n FROM jobs`;
  const emptyArrays = await client`
    SELECT COUNT(*)::int AS n FROM jobs WHERE cardinality(assignees) = 0
  `;
  const populated = rowCount[0].n - emptyArrays[0].n;
  console.log(
    `  ✓ ${rowCount[0].n} total jobs — ${populated} with ≥1 assignee, ${emptyArrays[0].n} unassigned`,
  );

  // 5. Policies recreated
  const policies = await client`
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('jobs', 'job_checklist_items', 'job_media', 'job_summaries')
      AND policyname IN (
        'Users can read jobs',
        'Users can insert jobs',
        'Users can update jobs',
        'Users can read job checklist items',
        'Users can insert job checklist items',
        'Users can update job checklist items',
        'Users can delete job checklist items',
        'Users can read job media',
        'Users can insert job media',
        'Users can update job media',
        'Users can delete job media',
        'Users can read job summaries',
        'Users can insert job summaries'
      )
    ORDER BY tablename, policyname
  `;
  console.log(`  ✓ ${policies.length}/13 expected RLS policies present`);
  if (policies.length < 13) {
    console.error("FAIL: some RLS policies were not recreated");
    for (const p of policies) console.error("   have:", p.policyname);
    process.exit(2);
  }

  console.log("\nVerification passed — migration applied and healthy.");
} catch (err) {
  console.error("\nMIGRATION FAILED:");
  console.error(err);
  process.exit(1);
} finally {
  await client.end({ timeout: 5 });
}
