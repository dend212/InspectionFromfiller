// scripts/workiz-adeq-smoke.mts
/**
 * Live, READ-ONLY smoke test for Import from Workiz (spec §13). Pages every open Workiz job
 * (GET /jobs) and fetches the first importable one (GET /jobs/{id}). Never writes anything,
 * anywhere.
 *
 * Prints counts and, per importable job, ONLY: serial, job-type id, sub-status, scheduled date,
 * prefill mode, the secondary provenance paths the import would produce, and skip reason codes.
 * It never prints names, addresses, emails, phones, notes or custom-field values.
 *
 * Usage: npm run smoke:workiz   (needs WORKIZ_API_V2_TOKEN in .env.local)
 * Expected (2026-10-12): 5 importable jobs, all JT-a5DbVzyREDgGvdWK.
 */

import { isSecondaryKey } from "../src/lib/prefill/secondary";
import { isAdeqJob, isImportable, scheduledDateOf } from "../src/lib/workiz/adeq";
import { fetchOpenJobs, getJob } from "../src/lib/workiz/adeq-jobs";
import { getWorkizConfig } from "../src/lib/workiz/client";
import { mapJobToImportPlan } from "../src/lib/workiz/map-job";

async function main(): Promise<void> {
  if (!getWorkizConfig()) {
    console.error("WORKIZ_API_V2_TOKEN is missing (or WORKIZ_API_V2_BASE is not https) — set it in .env.local");
    process.exit(1);
  }

  const started = Date.now();
  const { jobs, pages, dropped } = await fetchOpenJobs();
  const ms = Date.now() - started;
  const adeq = jobs.filter(isAdeqJob);
  const importable = jobs.filter(isImportable);
  console.log(`open jobs: ${jobs.length} (pages ${pages}, ${ms} ms, dropped by schema ${dropped})`);
  console.log(`ADEQ: ${adeq.length} · importable (done pending approval): ${importable.length}`);

  for (const job of importable) {
    const plan = mapJobToImportPlan(job, { inspectorName: "Smoke Test" });
    const secondaries = Object.keys(plan.fieldProvenance).filter(isSecondaryKey).sort();
    const prefill = plan.prefillInput ? (plan.prefillInput.zipMustMatch ? "address+zip" : "address") : "skipped";
    console.log(
      `#${job.serialId ?? "?"} type=${job.jobType?.id ?? "-"} sub=${JSON.stringify(job.subStatus?.name ?? null)} date=${scheduledDateOf(job) ?? "unscheduled"} prefill=${prefill} uuid=${job.uuid ? "yes" : "MISSING"}`,
    );
    console.log(`   secondary: ${secondaries.join(", ") || "(none)"}`);
    console.log(`   skips: ${plan.skips.map((s) => `${s.field}:${s.reason}`).join(", ") || "(none)"}`);
  }

  const first = importable[0];
  if (first) {
    const t0 = Date.now();
    const single = await getJob(first.id);
    console.log(
      `getJob #${single.serialId ?? "?"}: ${Date.now() - t0} ms, same serial: ${single.serialId === first.serialId}, uuid: ${single.uuid ? "yes" : "MISSING"}`,
    );
  }
}

main().catch((err: unknown) => {
  const code = err && typeof err === "object" && "code" in err ? ` code=${String((err as { code: unknown }).code)}` : "";
  console.error(`smoke failed: ${err instanceof Error ? err.name : "unknown"}${code}`);
  process.exit(1);
});
