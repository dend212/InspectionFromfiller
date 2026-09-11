/**
 * Review-page parity gate (spec §7).
 *
 * Extracts every form field path the legacy review editor renders and checks
 * that a wizard step component renders the same path. Run before deleting the
 * old editor and again after the rewrite; paste the output into the PR.
 *
 * Usage:
 *   node scripts/review-field-parity.mts                      # gate the live old editor
 *   node scripts/review-field-parity.mts --old <saved-copy>   # gate a saved copy after deletion
 * Exit code 1 when any field is missing, 2 when no old-editor fields could be
 * extracted (the gate must never pass on an empty set).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = process.cwd();
const oldArgIdx = process.argv.indexOf("--old");
const OLD_EDITOR =
  oldArgIdx > -1 ? process.argv[oldArgIdx + 1] : "src/components/review/review-editor.tsx";
const STEP_DIR = "src/components/inspection";
const VALIDATORS = "src/lib/validators/inspection.ts";

/** `${index}` / `${tankIndex}` / `${i}` → `*` so tank/port fields compare structurally */
function normalize(path: string): string {
  return path.replace(/\$\{[^}]+\}/g, "*");
}

/** Field paths the legacy editor renders via its render*("…") helpers */
function extractOldEditorFields(source: string): Set<string> {
  const out = new Set<string>();
  const helperCall =
    /render(?:TextField|Checkbox|SelectField|ButtonGroup|CheckboxGroup)\(\s*(["'`])([^"'`]+)\1/g;
  for (const m of source.matchAll(helperCall)) out.add(normalize(m[2]));
  return out;
}

/**
 * Field paths a step component renders: name="…", name={`…`}, `${item.field}`
 * loops expanded from `field: "…"` tables, and `name: "…"` inline tables.
 */
function extractStepFields(source: string): Set<string> {
  const out = new Set<string>();
  const fieldTable = [...source.matchAll(/field:\s*"([A-Za-z0-9_]+)"/g)].map((m) => m[1]);
  for (const m of source.matchAll(/name:\s*"([A-Za-z0-9_.]+)"/g)) out.add(m[1]);
  for (const m of source.matchAll(/name=(?:"([^"]+)"|\{`([^`]+)`(?:\s+as\s+const)?\})/g)) {
    const raw = m[1] ?? m[2];
    if (raw.includes("${item.field}")) {
      for (const f of fieldTable) out.add(normalize(raw.replace("${item.field}", f)));
    } else {
      out.add(normalize(raw));
    }
  }
  return out;
}

/** Top-level key → step index, derived from STEP_FIELDS in the validators file */
function extractStepPrefixes(source: string): Map<string, number> {
  const block = source.slice(source.indexOf("export const STEP_FIELDS"));
  const map = new Map<string, number>();
  let step = -1;
  for (const line of block.split("\n")) {
    const stepStart = line.match(/^\s*(\d+):\s*\[/);
    if (stepStart) step = Number(stepStart[1]);
    const path = line.match(/^\s*"([A-Za-z]+)\./);
    if (path && step >= 0 && !map.has(path[1])) map.set(path[1], step);
    if (/^};/.test(line)) break;
  }
  return map;
}

// resolve() keeps an absolute --old path as-is (join() would prefix it with cwd)
const oldEditorPath = resolve(root, OLD_EDITOR);
if (!existsSync(oldEditorPath)) {
  console.error(`Old editor not found at ${OLD_EDITOR} — pass --old <path to a saved copy>`);
  process.exit(2);
}

const oldFields = extractOldEditorFields(readFileSync(oldEditorPath, "utf8"));
if (oldFields.size === 0) {
  console.error(
    `No fields extracted from ${OLD_EDITOR} — pass --old <saved copy of the pre-rewrite editor>`,
  );
  process.exit(2);
}
const stepFields = new Map<string, string>(); // path → file
for (const file of readdirSync(join(root, STEP_DIR)).filter((f) => /^step-.*\.tsx$/.test(f))) {
  for (const p of extractStepFields(readFileSync(join(root, STEP_DIR, file), "utf8"))) {
    if (!stepFields.has(p)) stepFields.set(p, file);
  }
}
const prefixes = extractStepPrefixes(readFileSync(join(root, VALIDATORS), "utf8"));

const missing: string[] = [];
console.log(`Old editor fields: ${oldFields.size}   Step component fields: ${stepFields.size}\n`);
for (const p of [...oldFields].sort()) {
  const step = prefixes.get(p.split(".")[0]);
  const where = stepFields.get(p);
  const status = where ? "OK     " : "MISSING";
  console.log(`${status}  ${p.padEnd(52)} step ${step ?? "?"}  ${where ?? "-"}`);
  if (!where) missing.push(p);
}
console.log(
  `\n${missing.length === 0 ? "PARITY OK" : `PARITY FAILED — ${missing.length} field(s) not rendered by any step component:`}`,
);
for (const p of missing) console.log(`  - ${p}`);
process.exit(missing.length === 0 ? 0 : 1);
