#!/usr/bin/env node
// Check whether migration 0010 (storage.objects RLS for inspection-media) has
// been applied to the remote DB. Prints the current policies and the bucket
// size limit so we know whether we still need to run the migration.
//
// Usage: node --env-file=.env.local scripts/check-storage-rls.mjs

import postgres from "postgres";

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!connectionString) {
  console.error("Missing DATABASE_URL (or DIRECT_URL) in .env.local");
  process.exit(1);
}

const client = postgres(connectionString, { prepare: false, max: 1 });

try {
  // Storage policies on storage.objects
  const policies = await client`
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND (policyname ILIKE '%inspection%' OR policyname ILIKE '%inspection-media%')
    ORDER BY policyname
  `;

  console.log("Storage policies touching inspection-media:");
  if (policies.length === 0) {
    console.log("  (none)");
  } else {
    for (const p of policies) console.log("  •", p.policyname);
  }

  // Bucket file size limit
  const buckets = await client`
    SELECT id, file_size_limit
    FROM storage.buckets
    WHERE id = 'inspection-media'
  `;
  const bucket = buckets[0];
  if (bucket) {
    const limitMb = bucket.file_size_limit
      ? (Number(bucket.file_size_limit) / (1024 * 1024)).toFixed(0)
      : "(no limit set)";
    console.log(`\ninspection-media bucket file_size_limit: ${limitMb} MB`);
  } else {
    console.log("\ninspection-media bucket not found");
  }

  const expectedPolicyNames = [
    "inspection-media: authenticated insert",
    "inspection-media: authenticated select",
    "inspection-media: authenticated update",
    "inspection-media: authenticated delete",
  ];
  const present = new Set(policies.map((p) => p.policyname));
  const missing = expectedPolicyNames.filter((n) => !present.has(n));
  if (missing.length === 0) {
    console.log("\n✓ Migration 0010 is fully applied.");
  } else {
    console.log("\n✗ Migration 0010 is NOT applied — missing policies:");
    for (const n of missing) console.log("  •", n);
  }
} catch (err) {
  console.error(err);
  process.exit(1);
} finally {
  await client.end({ timeout: 5 });
}
