#!/usr/bin/env node
// Apply src/lib/db/migrations/0012_jobs_external_id.sql to the remote database.
// Usage: node --env-file=.env.local scripts/apply-external-id-migration.mjs

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

const migrationPath = path.join(repoRoot, "src/lib/db/migrations/0012_jobs_external_id.sql");
const sql = await readFile(migrationPath, "utf8");

const client = postgres(connectionString, { prepare: false, max: 1 });

try {
  console.log("Applying 0012_jobs_external_id.sql ...");
  await client.unsafe(sql);
  console.log("Migration applied cleanly.");

  const cols = await client`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'jobs' AND column_name = 'external_id'
  `;
  if (cols.length === 0) {
    console.error("MISSING column: jobs.external_id");
    process.exit(2);
  }
  console.log(`  ✓ jobs.external_id (${cols[0].data_type}, nullable=${cols[0].is_nullable})`);

  const idx = await client`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'jobs' AND indexname = 'jobs_external_id_unique'
  `;
  if (idx.length === 0) {
    console.error("MISSING index: jobs_external_id_unique");
    process.exit(2);
  }
  console.log(`  ✓ jobs_external_id_unique`);

  console.log("\nVerification passed.");
} catch (err) {
  console.error("\nMIGRATION FAILED:");
  console.error(err);
  process.exit(1);
} finally {
  await client.end({ timeout: 5 });
}
