#!/usr/bin/env node
// Apply src/lib/db/migrations/0016_inspection_records_extraction_version.sql to the remote DB.
// Usage: node --env-file=.env.local scripts/apply-extraction-version-migration.mjs
//
// Run this BEFORE merging / pushing the branch that adds `extractionVersion` to
// src/lib/db/schema.ts — run-store selects every schema column, so prefill
// hard-fails ("column extraction_version does not exist") until the column lands.
// The SQL is `ADD COLUMN IF NOT EXISTS`, so re-running is harmless.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

// .trim(): a pulled .env.local can carry a trailing escaped newline that `--env-file` expands
const connectionString = (process.env.DIRECT_URL || process.env.DATABASE_URL)?.trim();
if (!connectionString) {
  console.error("Missing DATABASE_URL (or DIRECT_URL) in .env.local");
  process.exit(1);
}

const migrationPath = path.join(
  repoRoot,
  "src/lib/db/migrations/0016_inspection_records_extraction_version.sql",
);
const sql = await readFile(migrationPath, "utf8");

const client = postgres(connectionString, { prepare: false, max: 1 });

try {
  console.log("Applying 0016_inspection_records_extraction_version.sql …");
  await client.unsafe(sql);
  console.log("Migration applied cleanly.\n");

  const column = await client`
    SELECT data_type, is_nullable, column_default FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'inspection_records' AND column_name = 'extraction_version'
  `;
  if (column.length === 0 || column[0].data_type !== "text" || column[0].is_nullable !== "YES") {
    console.error("FAIL: inspection_records.extraction_version missing or not a nullable `text` column", column);
    process.exit(2);
  }
  console.log("  ✓ inspection_records.extraction_version text NULL (no default)");

  const [{ stale }] = await client`
    SELECT count(*)::int AS stale FROM public.inspection_records
    WHERE extraction_status = 'done' AND extraction_version IS NULL
  `;
  console.log(`  ✓ ${stale} done row(s) carry no version — each is re-read from its stored PDF on the next Find records`);

  console.log("\nVerification passed — migration applied and healthy.");
} catch (err) {
  console.error("\nMIGRATION FAILED:");
  console.error(err);
  process.exit(1);
} finally {
  await client.end({ timeout: 5 });
}
