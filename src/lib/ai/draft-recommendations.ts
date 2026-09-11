import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

/** Tank deficiency checkbox → label (mirrors TANK_DEFICIENCY_ITEMS in step-septic-tank.tsx) */
const TANK_DEFICIENCY_LABELS: Array<[field: string, label: string]> = [
  ["deficiencyRootInvasion", "Root Invasion"],
  ["deficiencyExposedRebar", "Exposed Rebar"],
  ["deficiencyCracks", "Cracks"],
  ["deficiencyDamagedInlet", "Damaged Inlet"],
  ["deficiencyDamagedOutlet", "Damaged Outlet"],
  ["deficiencyDamagedLids", "Damaged Lids"],
  ["deficiencyDeterioratingConcrete", "Deteriorating Concrete"],
  ["deficiencyOther", "Other Deficiency"],
];

export interface RecommendationTankContext {
  compromisedTank: string;
  deficiencies: string[];
}

/** The only inspection data that is ever sent to the model — no names, addresses or identifiers. */
export interface RecommendationContext {
  septicTankComments: string;
  disposalWorksComments: string;
  cesspoolComments: string;
  isCesspool: string;
  tanksPumped: string;
  septicTankCondition: string;
  disposalWorksCondition: string;
  alternativeSystemCondition: string;
  tanks: RecommendationTankContext[];
}

type Loose = Record<string, unknown>;

function asObject(value: unknown): Loose {
  return value !== null && typeof value === "object" ? (value as Loose) : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Pull only the fields the model needs out of the stored `inspections.form_data` JSON.
 * Tolerates null / partial / malformed data (drafts, scanned forms) by returning empties.
 */
export function buildRecommendationContext(formData: unknown): RecommendationContext {
  const form = asObject(formData);
  const facility = asObject(form.facilityInfo);
  const septic = asObject(form.septicTank);
  const disposal = asObject(form.disposalWorks);
  const tanks = Array.isArray(septic.tanks) ? septic.tanks : [];

  return {
    septicTankComments: asString(septic.septicTankComments),
    disposalWorksComments: asString(disposal.disposalWorksComments),
    cesspoolComments: asString(facility.cesspoolComments),
    isCesspool: asString(facility.isCesspool),
    tanksPumped: asString(septic.tanksPumped),
    septicTankCondition: asString(facility.septicTankCondition),
    disposalWorksCondition: asString(facility.disposalWorksCondition),
    alternativeSystemCondition: asString(facility.alternativeSystemCondition),
    tanks: tanks.map((raw) => {
      const tank = asObject(raw);
      return {
        compromisedTank: asString(tank.compromisedTank),
        deficiencies: TANK_DEFICIENCY_LABELS.filter(([field]) => tank[field] === true).map(
          ([, label]) => label,
        ),
      };
    }),
  };
}

/** True when there is something for the model to work from; otherwise the caller returns the fallback. */
export function hasActionableInput(ctx: RecommendationContext): boolean {
  if (ctx.septicTankComments || ctx.disposalWorksComments || ctx.cesspoolComments) return true;
  if (ctx.tanks.some((tank) => tank.compromisedTank === "yes" || tank.deficiencies.length > 0)) {
    return true;
  }
  const isConcern = (condition: string) => condition !== "" && condition !== "operational";
  return (
    isConcern(ctx.septicTankCondition) ||
    isConcern(ctx.disposalWorksCondition) ||
    isConcern(ctx.alternativeSystemCondition)
  );
}

function humanize(value: string): string {
  return value ? value.replace(/_/g, " ") : "Not specified";
}

/** The user message sent to the model. Deterministic so tests can assert it exactly. */
export function formatRecommendationInput(ctx: RecommendationContext): string {
  const lines: string[] = [
    "Draft the customer-facing recommendations from these inspection findings.",
    "",
    `Septic tank condition: ${humanize(ctx.septicTankCondition)}`,
    `Disposal works condition: ${humanize(ctx.disposalWorksCondition)}`,
    `Alternative system condition: ${humanize(ctx.alternativeSystemCondition)}`,
    `Tanks pumped: ${ctx.tanksPumped || "Not specified"}`,
    `Cesspool: ${ctx.isCesspool || "Not specified"}`,
  ];

  ctx.tanks.forEach((tank, i) => {
    lines.push("", `--- Tank ${i + 1} ---`);
    lines.push(`Compromised tank: ${tank.compromisedTank || "Not specified"}`);
    lines.push(
      `Deficiencies: ${tank.deficiencies.length > 0 ? tank.deficiencies.join(", ") : "None noted"}`,
    );
  });

  lines.push("", "Septic tank comments:", ctx.septicTankComments || "(none)");
  lines.push("", "Disposal works comments:", ctx.disposalWorksComments || "(none)");
  lines.push("", "Cesspool comments:", ctx.cesspoolComments || "(none)");

  return lines.join("\n");
}

export const FALLBACK_RECOMMENDATION =
  "• System functioned normally at the time of inspection. Continue routine pumping every 3–5 years.";

const MAX_LINES = 5;
const MAX_WORDS = 80;

const SYSTEM_PROMPT = `You write the "Recommendations" box on a customer-facing septic inspection summary page for an Arizona septic company. The reader is a home buyer or seller, not an inspector.

You are given the inspector's field comments, flagged deficiencies and overall condition ratings from an ADEQ GWS 432 Property Transfer Inspection.

Rules:
- Output 2 to 5 short lines and nothing else — no heading, no intro, no closing sentence
- Start every line with "• "
- Keep the whole response under 60 words
- Present tense, plain language; no jargon, no ADEQ section numbers, no pricing
- Lead with what the customer should do; most important item first
- Do not start lines with "We recommend" or "It is recommended" — state the action directly
- Use only findings present in the input; never invent findings
- If the input contains nothing actionable, output exactly this single line:
${FALLBACK_RECOMMENDATION}

Example output:
• Tank is structurally sound; pump every 3–5 years.
• Inlet baffle is deteriorated — replace before sale.
• Drainfield shows early ponding; limit water use and re-inspect in 12 months.`;

/**
 * Coerce model output into the summary-page contract: every line `• `-prefixed,
 * at most 5 lines and 80 words, fallback line when nothing usable remains.
 */
export function normalizeRecommendations(raw: string): string {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•·▪‣]+|\d+[.)])\s*/, "").trim())
    .filter((line) => line.length > 0)
    .slice(0, MAX_LINES);

  const kept: string[] = [];
  let budget = MAX_WORDS;
  for (const line of lines) {
    if (budget <= 0) break;
    const words = line.split(/\s+/);
    if (words.length <= budget) {
      kept.push(line);
      budget -= words.length;
    } else {
      kept.push(words.slice(0, budget).join(" "));
      budget = 0;
    }
  }

  if (kept.length === 0) return FALLBACK_RECOMMENDATION;
  return kept.map((line) => `• ${line}`).join("\n");
}

/**
 * Draft customer-facing recommendations from the inspection context using Claude.
 * Skips the model entirely when there is nothing actionable. Throws on API failure.
 */
export async function draftRecommendations(ctx: RecommendationContext): Promise<string> {
  if (!hasActionableInput(ctx)) return FALLBACK_RECOMMENDATION;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 300,
    // cache_control is a silent no-op below Sonnet 4.6's 1024-token minimum; kept so the
    // prompt caches automatically if it grows (expect cache_read_input_tokens: 0 today).
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: formatRecommendationInput(ctx) }],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  const text = textBlock && textBlock.type === "text" ? textBlock.text : "";
  return normalizeRecommendations(text);
}
