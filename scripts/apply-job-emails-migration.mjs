#!/usr/bin/env node
// Apply src/lib/db/migrations/0013_job_emails.sql to the remote DB.
// Usage: node --env-file=.env.local scripts/apply-job-emails-migration.mjs

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

const migrationPath = path.join(repoRoot, "src/lib/db/migrations/0013_job_emails.sql");
const sql = await readFile(migrationPath, "utf8");

const client = postgres(connectionString, { prepare: false, max: 1 });

try {
  console.log("Applying 0013_job_emails.sql …");
  await client.unsafe(sql);
  console.log("Migration applied cleanly.\n");

  // Verify table exists + has expected columns
  const cols = await client`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'job_emails'
    ORDER BY ordinal_position
  `;
  if (cols.length === 0) {
    console.error("FAIL: job_emails table not found");
    process.exit(2);
  }
  const expected = ["id", "job_id", "recipient_email", "subject", "sent_at", "sent_by"];
  for (const name of expected) {
    if (!cols.find((c) => c.column_name === name)) {
      console.error(`FAIL: missing column ${name}`);
      process.exit(2);
    }
  }
  console.log(`  ✓ job_emails has ${cols.length} columns`);

  const idx = await client`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'job_emails' AND indexname = 'job_emails_job_id_idx'
  `;
  if (idx.length === 0) {
    console.error("FAIL: index job_emails_job_id_idx missing");
    process.exit(2);
  }
  console.log("  ✓ job_emails_job_id_idx");

  const policies = await client`
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'job_emails'
  `;
  if (policies.length < 2) {
    console.error("FAIL: expected ≥2 RLS policies on job_emails");
    process.exit(2);
  }
  console.log(`  ✓ ${policies.length} RLS policies present`);

  console.log("\nVerification passed — migration applied and healthy.");
} catch (err) {
  console.error("\nMIGRATION FAILED:");
  console.error(err);
  process.exit(1);
} finally {
  await client.end({ timeout: 5 });
}
