#!/usr/bin/env node
// Apply src/lib/db/migrations/0011_jobs_module.sql to the remote database.
// Usage:  node --env-file=.env.local scripts/apply-jobs-module-migration.mjs

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

const migrationPath = path.join(repoRoot, "src/lib/db/migrations/0011_jobs_module.sql");
const sql = await readFile(migrationPath, "utf8");

const client = postgres(connectionString, { prepare: false, max: 1 });

try {
  console.log("Applying 0011_jobs_module.sql ...");
  // Drizzle's standard statement-breakpoint separator isn't used here because
  // we write SQL as a single plpgsql-compatible script. postgres-js executes
  // the entire string as one multi-statement query.
  await client.unsafe(sql);
  console.log("Migration applied cleanly.");

  const expectedTables = [
    "checklist_templates",
    "checklist_template_items",
    "jobs",
    "job_checklist_items",
    "job_media",
    "job_summaries",
  ];

  const tableRows = await client`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ANY(${expectedTables})
    ORDER BY table_name
  `;

  console.log("\nTables present:");
  for (const row of tableRows) console.log("  ✓", row.table_name);

  const missing = expectedTables.filter((t) => !tableRows.find((r) => r.table_name === t));
  if (missing.length) {
    console.error("\nMISSING tables:", missing);
    process.exit(2);
  }

  const enumRows = await client`
    SELECT typname FROM pg_type
    WHERE typname IN ('job_status', 'job_media_bucket')
    ORDER BY typname
  `;
  console.log("\nEnums present:");
  for (const row of enumRows) console.log("  ✓", row.typname);

  const jobColumns = await client`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'jobs'
    ORDER BY ordinal_position
  `;
  console.log(`\njobs table has ${jobColumns.length} columns.`);

  const jobMediaCheck = await client`
    SELECT conname FROM pg_constraint
    WHERE conname = 'job_media_bucket_item_consistency'
  `;
  if (jobMediaCheck.length === 0) {
    console.error("MISSING check constraint: job_media_bucket_item_consistency");
    process.exit(2);
  }
  console.log("  ✓ job_media_bucket_item_consistency");

  console.log("\nVerification passed.");
} catch (err) {
  console.error("\nMIGRATION FAILED:");
  console.error(err);
  process.exit(1);
} finally {
  await client.end({ timeout: 5 });
}
