#!/usr/bin/env node
// Apply src/lib/db/migrations/0015_prefill_runs_records_provenance.sql to the remote DB.
// Usage: node --env-file=.env.local scripts/apply-prefill-migration.mjs

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
  "src/lib/db/migrations/0015_prefill_runs_records_provenance.sql",
);
const sql = await readFile(migrationPath, "utf8");

const client = postgres(connectionString, { prepare: false, max: 1 });

async function expectColumns(table, expected) {
  const cols = await client`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}
    ORDER BY ordinal_position
  `;
  if (cols.length === 0) {
    console.error(`FAIL: ${table} table not found`);
    process.exit(2);
  }
  for (const name of expected) {
    if (!cols.find((c) => c.column_name === name)) {
      console.error(`FAIL: ${table} missing column ${name}`);
      process.exit(2);
    }
  }
  console.log(`  ✓ ${table} has ${cols.length} columns (all ${expected.length} expected present)`);
}

async function expectIndex(table, indexName) {
  const idx = await client`
    SELECT indexname FROM pg_indexes WHERE tablename = ${table} AND indexname = ${indexName}
  `;
  if (idx.length === 0) {
    console.error(`FAIL: missing index ${indexName}`);
    process.exit(2);
  }
  console.log(`  ✓ ${indexName}`);
}

async function expectPolicies(table, minimum) {
  const policies = await client`
    SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = ${table}
  `;
  if (policies.length < minimum) {
    console.error(`FAIL: expected ≥${minimum} RLS policies on ${table}, found ${policies.length}`);
    process.exit(2);
  }
  console.log(`  ✓ ${policies.length} RLS ${policies.length === 1 ? "policy" : "policies"} on ${table}`);
}

try {
  console.log("Applying 0015_prefill_runs_records_provenance.sql …");
  await client.unsafe(sql);
  console.log("Migration applied cleanly.\n");

  const provenance = await client`
    SELECT data_type, is_nullable, column_default FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'inspections' AND column_name = 'field_provenance'
  `;
  if (provenance.length === 0 || provenance[0].data_type !== "jsonb" || provenance[0].is_nullable !== "NO") {
    console.error("FAIL: inspections.field_provenance missing or not `jsonb NOT NULL`", provenance);
    process.exit(2);
  }
  console.log("  ✓ inspections.field_provenance jsonb NOT NULL default", provenance[0].column_default);

  await expectColumns("inspection_prefill_runs", [
    "id", "inspection_id", "trigger", "status", "input", "stages", "proposals", "candidates",
    "error", "applied_at", "created_by", "created_at", "finished_at",
  ]);
  await expectColumns("inspection_records", [
    "id", "inspection_id", "run_id", "source", "permit_number", "doc_type", "doc_date",
    "description", "page_count", "size_bytes", "storage_path", "selected", "extraction_status",
    "extraction_error", "extracted", "created_at",
  ]);
  await expectIndex("inspection_prefill_runs", "inspection_prefill_runs_inspection_created_idx");
  await expectIndex("inspection_prefill_runs", "inspection_prefill_runs_one_active_idx");
  await expectIndex("inspection_records", "inspection_records_inspection_idx");
  await expectPolicies("inspection_prefill_runs", 1);
  await expectPolicies("inspection_records", 1);

  console.log("\nVerification passed — migration applied and healthy.");
} catch (err) {
  console.error("\nMIGRATION FAILED:");
  console.error(err);
  process.exit(1);
} finally {
  await client.end({ timeout: 5 });
}
