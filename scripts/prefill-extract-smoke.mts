// scripts/prefill-extract-smoke.mts
/**
 * Live smoke test for phase 3 (spec §12): runs the REAL permits stage — EDMS
 * search, document download to Supabase Storage, Claude extraction — for two
 * known parcels and prints the proposals, each record's extraction status and
 * key facts, every Claude call's token usage (incl. cache reads) and the
 * "[prefill] … tokens ≈ $…" usage lines from extract-records.
 *
 * Usage:
 *   npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/prefill-extract-smoke.mts [--apn 219-11-121] [--apn 200-08-079]
 *
 * Requires .env.local (npx vercel env pull .env.local) with ANTHROPIC_API_KEY,
 * DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Spends real
 * money (≈ $0.05–0.20 per parcel) against the PRODUCTION database and bucket, so
 * everything it writes is throwaway: it creates its own inspection
 * ("PREFILL EXTRACT SMOKE — DELETE ME"), runs each parcel as a prefill run on it,
 * and in a finally block deletes the inspection, its runs, its inspection_records
 * rows and the storage objects under records/{inspectionId}/, then verifies with
 * follow-up queries that nothing is left. Exit code 0 when every expectation
 * holds, 2 otherwise (1 for setup errors).
 *
 * Expected (spec §12): 219-11-121 → permit 000972, 1,200 gal, seepage pit, issued 2000;
 *                      200-08-079 → OW-17-00474, 1,250 gal, 2 seepage pits, design flow.
 */
import { parseArgs } from "node:util";
import { count, desc, eq } from "drizzle-orm";
import type { PermitFacts } from "../src/lib/ai/permit-extraction-schema";
import { db } from "../src/lib/db";
import {
  inspectionPrefillRuns,
  inspectionRecords,
  inspections,
  profiles,
  userRoles,
} from "../src/lib/db/schema";
import { runPermitsStage } from "../src/lib/prefill/permits/index";
import { type PrefillStage, type ProposedField, emptyStages } from "../src/lib/prefill/types";
import { RECORD_BUCKET } from "../src/lib/storage/record-storage";
import { createAdminClient } from "../src/lib/supabase/admin";

const SMOKE_FACILITY_NAME = "PREFILL EXTRACT SMOKE — DELETE ME";

interface Expectation {
  apn: string;
  permit: string;
  tankGal: number;
  disposal: string;
  issueYear?: number;
  designFlow?: boolean;
}

const EXPECTATIONS: Expectation[] = [
  { apn: "219-11-121", permit: "000972", tankGal: 1200, disposal: "seepage_pit", issueYear: 2000 },
  { apn: "200-08-079", permit: "OW-17-00474", tankGal: 1250, disposal: "seepage_pit", designFlow: true },
];

const { values: args } = parseArgs({
  options: {
    apn: { type: "string", multiple: true },
  },
});

for (const key of ["ANTHROPIC_API_KEY", "DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[key]) {
    console.error(`Missing ${key} — run: npx vercel env pull .env.local`);
    process.exit(1);
  }
}

/**
 * The stage only logs a per-document token total, so tap the SDK's fetch to see
 * each Claude call's usage — cache_read_input_tokens > 0 on the second Sonnet
 * call proves the system prompt is served from cache (spec §6).
 */
interface ClaudeCall {
  model: string;
  status: number;
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
}
const claudeCalls: ClaudeCall[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const res = await realFetch(input, init);
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/v1/messages")) {
    try {
      const body = (await res.clone().json()) as { model?: string; usage?: Record<string, number> };
      const u = body.usage ?? {};
      claudeCalls.push({
        model: body.model ?? "?",
        status: res.status,
        input: u.input_tokens ?? 0,
        output: u.output_tokens ?? 0,
        cacheCreation: u.cache_creation_input_tokens ?? 0,
        cacheRead: u.cache_read_input_tokens ?? 0,
      });
    } catch {
      // non-JSON error body — nothing to record
    }
  }
  return res;
}) as typeof fetch;

let failures = 0;
const check = (label: string, ok: boolean, actual: unknown) => {
  console.log(`  ${ok ? "PASS " : "CHECK"} ${label}${ok ? "" : ` (got ${JSON.stringify(actual)})`}`);
  if (!ok) failures++;
};
const normalise = (n: string) => n.replace(/[^A-Z0-9]/gi, "").toUpperCase();

/** An inspection needs an inspector — borrow an admin's profile id, else anyone's. */
async function pickInspectorId(): Promise<string> {
  const [admin] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .innerJoin(userRoles, eq(userRoles.userId, profiles.id))
    .where(eq(userRoles.role, "admin"))
    .orderBy(desc(profiles.createdAt))
    .limit(1);
  if (admin) return admin.id;
  const [anyone] = await db.select({ id: profiles.id }).from(profiles).limit(1);
  if (!anyone) throw new Error("No profiles in the database — cannot create a throwaway inspection");
  return anyone.id;
}

async function runParcel(inspectionId: string, exp: Expectation): Promise<void> {
  console.log(`\n=== APN ${exp.apn} ===`);
  const [run] = await db
    .insert(inspectionPrefillRuns)
    .values({ inspectionId, trigger: "manual", status: "running", input: { apn: exp.apn }, stages: emptyStages() })
    .returning({ id: inspectionPrefillRuns.id });

  const controller = new AbortController();
  const budget = setTimeout(() => controller.abort(), 240_000);
  const started = Date.now();
  const result = await runPermitsStage(
    { apn: exp.apn },
    {
      inspectionId,
      runId: run.id,
      signal: controller.signal,
      progress: async (stage: Partial<PrefillStage>) => {
        console.log(`  [progress] ${JSON.stringify(stage)}`);
      },
    },
  );
  clearTimeout(budget);

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`Stage: ${result.stage.status} — ${result.stage.summary ?? ""} (${secs} s)`);
  for (const link of result.stage.links) console.log(`  link: ${link.label} → ${link.url}`);
  if (result.stage.error) console.log(`  error: ${result.stage.error}`);
  if (result.candidates?.length) {
    console.log(`  candidates (${result.candidates.length}):`);
    for (const c of result.candidates) console.log(`    ${c.permitNumber} ${c.docType} ${c.docDate ?? ""} score=${c.score}`);
  }

  await db
    .update(inspectionPrefillRuns)
    .set({
      status: "done",
      stages: { ...emptyStages(), permits: result.stage },
      proposals: result.proposals,
      finishedAt: new Date(),
    })
    .where(eq(inspectionPrefillRuns.id, run.id));

  const records = await db.select().from(inspectionRecords).where(eq(inspectionRecords.runId, run.id));
  console.log(`Records (${records.length}):`);
  for (const r of records) {
    const x = r.extracted as PermitFacts | null;
    const facts = x
      ? `kind=${x.documentKind} tank=${x.tanks[0]?.capacityGal?.value ?? "-"} disposal=${x.disposal.type?.value ?? "-"}×${x.disposal.count?.value ?? "-"} flow=${x.designFlowGpd?.value ?? "-"} issued=${x.issueDate?.value ?? "-"}`
      : "";
    console.log(
      `  ${r.permitNumber.padEnd(14)} ${r.docType.padEnd(22)} ${String(r.pageCount ?? "?").padStart(3)} pp  ${r.extractionStatus.padEnd(8)} ${r.extractionError ?? ""} ${facts}`,
    );
  }

  console.log(`Proposals (${result.proposals.length}):`);
  for (const p of result.proposals) {
    console.log(
      `  ${p.fieldPath.padEnd(46)} ${JSON.stringify(p.value).padEnd(22)} ${(p.provenance.confidence * 100).toFixed(0).padStart(3)}%  ${p.provenance.explanation}`,
    );
  }

  const byPath = new Map<string, ProposedField>(result.proposals.map((p) => [p.fieldPath, p]));
  const permitNos = records.map((r) => r.permitNumber);
  check(`permit ${exp.permit} stored`, permitNos.some((n) => normalise(n) === normalise(exp.permit)), permitNos);
  check(
    `tank ${exp.tankGal} gal`,
    byPath.get("septicTank.tanks.0.tankCapacity")?.value === String(exp.tankGal),
    byPath.get("septicTank.tanks.0.tankCapacity")?.value,
  );
  check(
    `disposal ${exp.disposal}`,
    byPath.get("disposalWorks.disposalType")?.value === exp.disposal,
    byPath.get("disposalWorks.disposalType")?.value,
  );
  if (exp.issueYear) {
    const explanation = byPath.get("facilityInfo.facilityAgeEstimateExplanation")?.value;
    check(`issued ${exp.issueYear}`, typeof explanation === "string" && explanation.includes(String(exp.issueYear)), explanation);
  }
  if (exp.designFlow) {
    check("design flow proposed", byPath.has("designFlow.estimatedDesignFlow"), undefined);
  }
}

/** Deletes everything the smoke created and proves it with follow-up queries. */
async function cleanup(inspectionId: string): Promise<void> {
  console.log(`\n=== Cleanup ${inspectionId} ===`);
  const storage = createAdminClient().storage.from(RECORD_BUCKET);
  const prefix = `records/${inspectionId}`;

  const { data: objects, error: listError } = await storage.list(prefix, { limit: 1000 });
  if (listError) console.warn(`  storage list: ${listError.message}`);
  const paths = (objects ?? []).map((o) => `${prefix}/${o.name}`);
  if (paths.length > 0) {
    const { error } = await storage.remove(paths);
    if (error) console.warn(`  storage remove: ${error.message}`);
  }
  const deletedRecords = await db
    .delete(inspectionRecords)
    .where(eq(inspectionRecords.inspectionId, inspectionId))
    .returning({ id: inspectionRecords.id });
  const deletedRuns = await db
    .delete(inspectionPrefillRuns)
    .where(eq(inspectionPrefillRuns.inspectionId, inspectionId))
    .returning({ id: inspectionPrefillRuns.id });
  const deletedInspections = await db
    .delete(inspections)
    .where(eq(inspections.id, inspectionId))
    .returning({ id: inspections.id });
  console.log(
    `  deleted ${paths.length} storage object(s), ${deletedRecords.length} record(s), ${deletedRuns.length} run(s), ${deletedInspections.length} inspection(s)`,
  );

  // Verify with fresh queries — the point of the smoke is to leave production untouched
  const [recs] = await db
    .select({ n: count() })
    .from(inspectionRecords)
    .where(eq(inspectionRecords.inspectionId, inspectionId));
  const [runs] = await db
    .select({ n: count() })
    .from(inspectionPrefillRuns)
    .where(eq(inspectionPrefillRuns.inspectionId, inspectionId));
  const [insp] = await db.select({ n: count() }).from(inspections).where(eq(inspections.id, inspectionId));
  const { data: left, error: leftError } = await storage.list(prefix, { limit: 1000 });
  check("no inspection_records left", Number(recs.n) === 0, recs.n);
  check("no inspection_prefill_runs left", Number(runs.n) === 0, runs.n);
  check("throwaway inspection deleted", Number(insp.n) === 0, insp.n);
  check("no storage objects left", !leftError && (left ?? []).length === 0, leftError?.message ?? left?.length);
}

function printClaudeCalls(): void {
  console.log(`\n=== Claude calls (${claudeCalls.length}) ===`);
  for (const c of claudeCalls) {
    console.log(
      `  ${c.model.padEnd(18)} HTTP ${c.status}  in=${String(c.input).padStart(6)}  out=${String(c.output).padStart(5)}  cache_creation=${String(c.cacheCreation).padStart(5)}  cache_read=${String(c.cacheRead).padStart(5)}`,
    );
  }
  const sonnet = claudeCalls.filter((c) => c.model.startsWith("claude-sonnet"));
  if (sonnet.length >= 2) {
    check(
      "system prompt served from cache on a later Sonnet call",
      sonnet.slice(1).some((c) => c.cacheRead > 0),
      sonnet.map((c) => c.cacheRead),
    );
  }
}

async function main(): Promise<number> {
  const wanted = args.apn?.length ? EXPECTATIONS.filter((e) => args.apn?.includes(e.apn)) : EXPECTATIONS;
  if (wanted.length === 0) {
    console.error(`Unknown --apn; known: ${EXPECTATIONS.map((e) => e.apn).join(", ")}`);
    return 1;
  }

  const inspectorId = await pickInspectorId();
  const [inspection] = await db
    .insert(inspections)
    .values({ inspectorId, status: "draft", facilityName: SMOKE_FACILITY_NAME, facilityCounty: "Maricopa" })
    .returning({ id: inspections.id });
  console.log(`Throwaway inspection: ${inspection.id} ("${SMOKE_FACILITY_NAME}")`);

  try {
    for (const exp of wanted) {
      try {
        await runParcel(inspection.id, exp);
      } catch (err) {
        console.error(`  parcel ${exp.apn} threw:`, err);
        failures++;
      }
    }
    printClaudeCalls();
  } finally {
    await cleanup(inspection.id);
  }

  console.log(failures ? `\n${failures} expectation(s) need a look.` : "\nAll expectations met.");
  return failures ? 2 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
