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
