import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

export type CommentSection = "septicTank" | "disposalWorks";

export interface SepticTankContext {
  numberOfTanks: string;
  tanksPumped: string;
  haulerCompany: string;
  tanks: Array<{
    tankMaterial: string;
    tankCapacity: string;
    liquidLevel: string;
    primaryScumThickness: string;
    primarySludgeThickness: string;
    secondaryScumThickness: string;
    secondarySludgeThickness: string;
    compromisedTank: string;
    numberOfCompartments: string;
    accessOpenings: string;
    lidsRisersPresent: string;
    lidsSecurelyFastened: string;
    baffleMaterial: string | string[];
    inletBaffleCondition: string | string[];
    outletBaffleCondition: string | string[];
    interiorBaffleCondition: string | string[];
    effluentFilterPresent: string;
    effluentFilterServiced: string;
    deficiencies: string[];
  }>;
  overallCondition: string;
}

export interface DisposalWorksContext {
  disposalType: string;
  distributionMethod: string;
  supplyLineMaterial: string;
  locationDetermined: string;
  distributionComponentInspected: string;
  inspectionPortsPresent: string;
  numberOfPorts: string;
  portDepths: string[];
  hydraulicLoadTestPerformed: string;
  hasDisposalDeficiency: string;
  repairsRecommended: string;
  deficiencies: string[];
  overallCondition: string;
}

export interface RewriteRequest {
  section: CommentSection;
  currentComment: string;
  formContext: SepticTankContext | DisposalWorksContext;
}

const SYSTEM_PROMPT = `You are a professional Arizona septic system inspector writing field comments for an ADEQ GWS 432 Property Transfer Inspection form.

Rules:
- Write concise, factual inspection comments in paragraph form
- Use professional terminology appropriate for a licensed inspector
- Be thorough but brief — typically 2-4 sentences
- Reference specific findings from the inspection data when generating from scratch
- Do not include greetings, sign-offs, headers, or bullet points
- Do not invent findings not present in the data
- If deficiencies are noted, mention them specifically with their implications
- If the system is operational with no concerns, state that clearly and concisely
- Match the tone and style of the examples below

Example tank comments (structural failure):
"The septic tank was visually inspected and found to have collapsed inward around what appears to be an old inspection port, indicating significant structural failure. There is extensive deterioration throughout the tank, with severe degradation observed on both the inlet and outlet baffles. Due to the structural compromise and condition of the internal components, the tank does not meet operational requirements and should be replaced to restore proper system function and compliance."

Example tank comments (minor issues):
"The septic tank was visually inspected and pumped. The tank is a two-compartment design and is located beneath a small pony wall, which restricts access and reduces the ability to properly service and maintain the system. The tank also infringes on the required county setback distance to the wall, which is a code compliance concern. Minor deterioration was observed within the tank; however, it does not appear to be operationally significant at this time. It is recommended that proper risers be installed to grade to improve accessibility and facilitate future servicing and maintenance."

Example drainfield comments (failed flow test):
"According to permit documentation, the disposal area is a leach bed. A flow test was conducted and failed due to immediate backflow, indicating the system was not accepting effluent as expected. A subsequent line inspection using a sewer camera revealed that the outlet line is significantly damaged and/or crushed, restricting effluent flow to the drainfield. This condition alone could account for the failed flow test. Additionally, if the home has been vacant for a significant period, a full hydraulic loading test of the drainfield may be required after line repairs are completed to accurately confirm the long-term viability and performance of the leach bed."

Return ONLY the rewritten or generated comment text. No headers, labels, or extra formatting.`;

function formatTankContext(ctx: SepticTankContext): string {
  const lines: string[] = [
    "Section: Septic Tank Inspection",
    `Overall Condition Rating: ${ctx.overallCondition || "Not specified"}`,
    `Number of Tanks: ${ctx.numberOfTanks || "Not specified"}`,
    `Tanks Pumped: ${ctx.tanksPumped || "Not specified"}`,
  ];

  if (ctx.haulerCompany) {
    lines.push(`Hauler Company: ${ctx.haulerCompany}`);
  }

  for (let i = 0; i < ctx.tanks.length; i++) {
    const tank = ctx.tanks[i];
    lines.push(`\n--- Tank ${i + 1} ---`);
    if (tank.tankMaterial) lines.push(`Material: ${tank.tankMaterial}`);
    if (tank.tankCapacity) lines.push(`Capacity: ${tank.tankCapacity} gallons`);
    if (tank.liquidLevel) lines.push(`Liquid Level: ${tank.liquidLevel}`);
    if (tank.primaryScumThickness) lines.push(`Primary Scum Thickness: ${tank.primaryScumThickness}`);
    if (tank.primarySludgeThickness) lines.push(`Primary Sludge Thickness: ${tank.primarySludgeThickness}`);
    if (tank.secondaryScumThickness) lines.push(`Secondary Scum Thickness: ${tank.secondaryScumThickness}`);
    if (tank.secondarySludgeThickness) lines.push(`Secondary Sludge Thickness: ${tank.secondarySludgeThickness}`);
    if (tank.compromisedTank) lines.push(`Compromised Tank: ${tank.compromisedTank}`);
    if (tank.numberOfCompartments) lines.push(`Compartments: ${tank.numberOfCompartments}`);
    if (tank.accessOpenings) lines.push(`Access Openings: ${tank.accessOpenings}`);
    if (tank.lidsRisersPresent) lines.push(`Lids/Risers Present: ${tank.lidsRisersPresent}`);
    if (tank.lidsSecurelyFastened) lines.push(`Lids Securely Fastened: ${tank.lidsSecurelyFastened}`);
    const bm = Array.isArray(tank.baffleMaterial) ? tank.baffleMaterial.join(", ") : tank.baffleMaterial;
    if (bm) lines.push(`Baffle Material: ${bm}`);
    const ib = Array.isArray(tank.inletBaffleCondition) ? tank.inletBaffleCondition.join(", ") : tank.inletBaffleCondition;
    if (ib) lines.push(`Inlet Baffle: ${ib}`);
    const ob = Array.isArray(tank.outletBaffleCondition) ? tank.outletBaffleCondition.join(", ") : tank.outletBaffleCondition;
    if (ob) lines.push(`Outlet Baffle: ${ob}`);
    const intb = Array.isArray(tank.interiorBaffleCondition) ? tank.interiorBaffleCondition.join(", ") : tank.interiorBaffleCondition;
    if (intb) lines.push(`Interior Baffle: ${intb}`);
    if (tank.effluentFilterPresent) lines.push(`Effluent Filter Present: ${tank.effluentFilterPresent}`);
    if (tank.effluentFilterServiced) lines.push(`Effluent Filter Serviced: ${tank.effluentFilterServiced}`);

    if (tank.deficiencies.length > 0) {
      lines.push(`Deficiencies: ${tank.deficiencies.join(", ")}`);
    } else {
      lines.push("Deficiencies: None noted");
    }
  }

  return lines.join("\n");
}

function formatDisposalContext(ctx: DisposalWorksContext): string {
  const lines: string[] = [
    "Section: Disposal Works / Drainfield Inspection",
    `Overall Condition Rating: ${ctx.overallCondition || "Not specified"}`,
  ];

  if (ctx.disposalType) lines.push(`Disposal Type: ${ctx.disposalType}`);
  if (ctx.distributionMethod) lines.push(`Distribution Method: ${ctx.distributionMethod}`);
  if (ctx.supplyLineMaterial) lines.push(`Supply Line Material: ${ctx.supplyLineMaterial}`);
  if (ctx.locationDetermined) lines.push(`Location Determined: ${ctx.locationDetermined}`);
  if (ctx.distributionComponentInspected) lines.push(`Distribution Component Inspected: ${ctx.distributionComponentInspected}`);
  if (ctx.inspectionPortsPresent) lines.push(`Inspection Ports Present: ${ctx.inspectionPortsPresent}`);
  if (ctx.numberOfPorts) lines.push(`Number of Ports: ${ctx.numberOfPorts}`);

  if (ctx.portDepths.length > 0) {
    const depths = ctx.portDepths.filter(Boolean);
    if (depths.length > 0) {
      lines.push(`Port Depths: ${depths.join(", ")}`);
    }
  }

  if (ctx.hydraulicLoadTestPerformed) lines.push(`Hydraulic Load Test Performed: ${ctx.hydraulicLoadTestPerformed}`);
  if (ctx.hasDisposalDeficiency) lines.push(`Has Deficiency: ${ctx.hasDisposalDeficiency}`);
  if (ctx.repairsRecommended) lines.push(`Repairs Recommended: ${ctx.repairsRecommended}`);

  if (ctx.deficiencies.length > 0) {
    lines.push(`Deficiencies: ${ctx.deficiencies.join(", ")}`);
  } else {
    lines.push("Deficiencies: None noted");
  }

  return lines.join("\n");
}

/**
 * Rewrite or generate an inspection comment using Claude.
 *
 * - If `currentComment` is non-empty: rewrites the text using example style (ignores form context).
 * - If `currentComment` is empty: generates from scratch using form context data.
 */
export async function rewriteInspectionComment(request: RewriteRequest): Promise<string> {
  const { section, currentComment, formContext } = request;
  const hasExistingComment = currentComment.trim().length > 0;

  let userMessage: string;

  if (hasExistingComment) {
    // Rewrite mode: trust the inspector's written observations, just polish the language
    userMessage = `Rewrite the following inspector notes into a professional inspection summary for the ${section === "septicTank" ? "septic tank" : "drainfield/disposal works"} section. Match the tone and style of the examples in your instructions. Do not add findings not mentioned in the notes.\n\nInspector's draft notes:\n"${currentComment}"`;
  } else {
    // Generate mode: use form context data to create a comment from scratch
    const contextText =
      section === "septicTank"
        ? formatTankContext(formContext as SepticTankContext)
        : formatDisposalContext(formContext as DisposalWorksContext);

    userMessage = `Generate a professional inspection summary for the ${section === "septicTank" ? "septic tank" : "drainfield/disposal works"} section based on the inspection findings below. Match the tone and style of the examples in your instructions.\n\n${contextText}`;
  }

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 500,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from AI");
  }

  return textBlock.text.trim();
}
