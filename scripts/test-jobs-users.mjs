#!/usr/bin/env node
// Temporary test-user lifecycle helper for end-to-end Jobs module testing.
//
// Usage:
//   node --env-file=.env.local scripts/test-jobs-users.mjs create
//   node --env-file=.env.local scripts/test-jobs-users.mjs delete
//
// Creates one admin and one field_tech with deterministic emails so the
// browser automation can log them in. Also removes anything these users
// created in the Jobs module (templates, jobs, media) when deleting.

import { createClient } from "@supabase/supabase-js";

const TEST_USERS = [
  {
    fullName: "Test Admin (temp)",
    email: "test-admin@jobs-e2e.local",
    password: "TestAdminPW_e2e_2026!",
    role: "admin",
  },
  {
    fullName: "Test Tech (temp)",
    email: "test-tech@jobs-e2e.local",
    password: "TestTechPW_e2e_2026!",
    role: "field_tech",
  },
];

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findUserByEmail(email) {
  // admin.listUsers paginates; fine for our tiny team
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = data.users.find((u) => u.email === email);
    if (found) return found;
    if (data.users.length < 200) return null;
    page += 1;
  }
}

async function createUser(u) {
  const existing = await findUserByEmail(u.email);
  if (existing) {
    console.log(`  • ${u.email} already exists (id=${existing.id}) — reusing`);
    return { id: existing.id, created: false };
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: u.email,
    password: u.password,
    email_confirm: true,
    user_metadata: { full_name: u.fullName },
  });
  if (error) throw new Error(`createUser ${u.email}: ${error.message}`);
  const userId = data.user.id;

  const { error: pErr } = await admin.from("profiles").insert({
    id: userId,
    full_name: u.fullName,
    email: u.email,
  });
  if (pErr) throw new Error(`profile ${u.email}: ${pErr.message}`);

  const { error: rErr } = await admin.from("user_roles").insert({
    user_id: userId,
    role: u.role,
  });
  if (rErr) throw new Error(`role ${u.email}: ${rErr.message}`);

  console.log(`  ✓ created ${u.email} (${u.role}) id=${userId}`);
  return { id: userId, created: true };
}

async function deleteUser(u) {
  const existing = await findUserByEmail(u.email);
  if (!existing) {
    console.log(`  • ${u.email} not found — nothing to delete`);
    return;
  }
  const userId = existing.id;

  // Delete any jobs the user created or is assigned to (cascades media + items)
  const { data: ownedJobs } = await admin
    .from("jobs")
    .select("id")
    .or(`assigned_to.eq.${userId},created_by.eq.${userId}`);
  if (ownedJobs && ownedJobs.length > 0) {
    const ids = ownedJobs.map((j) => j.id);
    const { error } = await admin.from("jobs").delete().in("id", ids);
    if (error) console.warn(`    ! jobs cleanup: ${error.message}`);
    else console.log(`  ✓ removed ${ids.length} job row(s)`);
  }

  // Delete templates the user created (cascades items)
  const { data: templates } = await admin
    .from("checklist_templates")
    .select("id")
    .eq("created_by", userId);
  if (templates && templates.length > 0) {
    const ids = templates.map((t) => t.id);
    const { error } = await admin.from("checklist_templates").delete().in("id", ids);
    if (error) console.warn(`    ! template cleanup: ${error.message}`);
    else console.log(`  ✓ removed ${ids.length} template(s)`);
  }

  // Delete profile / role rows
  await admin.from("user_roles").delete().eq("user_id", userId);
  await admin.from("profiles").delete().eq("id", userId);

  // Finally delete auth user
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw new Error(`deleteUser ${u.email}: ${error.message}`);
  console.log(`  ✓ deleted ${u.email}`);
}

async function main() {
  const action = process.argv[2];
  if (action !== "create" && action !== "delete") {
    console.error("Usage: node scripts/test-jobs-users.mjs <create|delete>");
    process.exit(1);
  }

  console.log(`\n${action === "create" ? "Creating" : "Deleting"} test users:`);
  for (const u of TEST_USERS) {
    if (action === "create") await createUser(u);
    else await deleteUser(u);
  }

  if (action === "create") {
    console.log("\nCredentials:");
    for (const u of TEST_USERS) {
      console.log(`  ${u.role.padEnd(12)} ${u.email}   password: ${u.password}`);
    }
  }
  console.log();
}

main().catch((err) => {
  console.error("\n✗ FAILED:", err.message);
  process.exit(1);
});
