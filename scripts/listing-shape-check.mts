/**
 * One real Apify → Zillow lookup so the defensive mapper in
 * src/lib/prefill/listing/zillow-apify.ts can be checked against the actor's
 * actual output keys. Prints raw keys, water/sewer-ish raw values and the
 * normalised facts. Never prints the token.
 *
 * Usage: npx tsx --env-file=.env.local scripts/listing-shape-check.mts ["<full address>"]
 * Default address: 8911 E Cave Creek Rd, Carefree, AZ 85377
 */

import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const root = resolve(dirname(__filename), "..");

const { buildApifyUrl, normaliseListingItem, findFact, WATER_KEYS, SEWER_KEYS } = await import(
  pathToFileURL(join(root, "src/lib/prefill/listing/zillow-apify.ts")).href
);

const token = process.env.APIFY_TOKEN;
if (!token) {
  console.error("APIFY_TOKEN is not set — run with --env-file=.env.local (after `npx vercel env pull .env.local`).");
  process.exit(1);
}

const address = process.argv[2] ?? "8911 E Cave Creek Rd, Carefree, AZ 85377";
console.log(`Looking up: ${address}`);

const started = Date.now();
const res = await fetch(buildApifyUrl(token), {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ addresses: [address] }),
  signal: AbortSignal.timeout(90_000),
});
console.log(`HTTP ${res.status} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
if (!res.ok) {
  console.error(await res.text().catch(() => "<no body>"));
  process.exit(1);
}

const items: unknown = await res.json();
if (!Array.isArray(items)) {
  console.error("Dataset is not an array:", JSON.stringify(items).slice(0, 500));
  process.exit(1);
}
console.log(`Dataset items: ${items.length}`);
if (items.length === 0) {
  console.log("No listing found (Apify does not charge for this).");
  process.exit(0);
}

const item = items[0] as Record<string, unknown>;
console.log("\nTop-level keys:");
for (const key of Object.keys(item).sort()) {
  const v = item[key];
  const kind = Array.isArray(v) ? `array(${v.length})` : v === null ? "null" : typeof v;
  console.log(`  ${key}: ${kind}`);
}

/** Every dotted path (depth ≤ 4) whose key or string value mentions water/sewer/septic/well. */
function scan(node: unknown, path: string, out: string[], depth = 0) {
  if (!node || typeof node !== "object" || depth > 4) return;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    const p = path ? `${path}.${k}` : k;
    const text = typeof v === "string" ? v : Array.isArray(v) ? v.filter((x) => typeof x === "string").join(", ") : "";
    if (/water|sewer|septic|well|utilit/i.test(k) || /water|sewer|septic|well/i.test(text)) {
      out.push(`  ${p} = ${JSON.stringify(v).slice(0, 160)}`);
    }
    if (v && typeof v === "object") scan(v, p, out, depth + 1);
  }
}
const hits: string[] = [];
scan(item, "", hits);
console.log("\nWater/sewer-related paths:");
console.log(hits.length ? hits.join("\n") : "  (none — extend WATER_KEYS/SEWER_KEYS in zillow-apify.ts after inspecting the keys above)");

console.log("\nfindFact(WATER_KEYS):", JSON.stringify(findFact(item, WATER_KEYS)));
console.log("findFact(SEWER_KEYS):", JSON.stringify(findFact(item, SEWER_KEYS)));

const facts = normaliseListingItem(item);
console.log("\nNormalised facts:");
console.log(facts ? JSON.stringify({ ...facts, raw: "<omitted>" }, null, 2) : "null (mapper found nothing — fix the key lists)");
