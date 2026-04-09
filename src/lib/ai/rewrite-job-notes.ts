import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

export type JobRewriteType = "generalNotes" | "checklistItem" | "customerSummary";

export interface JobContext {
  title: string;
  customerName?: string | null;
  serviceAddress?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}

export interface GeneralNotesContext {
  job: JobContext;
  currentText: string;
}

export interface ChecklistItemContext {
  job: JobContext;
  itemTitle: string;
  itemInstructions?: string | null;
  itemStatus: "pending" | "done" | "skipped";
  currentText: string;
}

export interface CustomerSummaryContext {
  job: JobContext;
  generalNotes: string | null;
  items: Array<{
    title: string;
    status: "pending" | "done" | "skipped";
    note: string | null;
  }>;
}

export type JobRewriteRequest =
  | { type: "generalNotes"; context: GeneralNotesContext }
  | { type: "checklistItem"; context: ChecklistItemContext }
  | { type: "customerSummary"; context: CustomerSummaryContext };

const BASE_PROMPT = `You are a professional service technician writing field notes and customer-facing summaries for a non-regulatory service visit (pump job, system check, general maintenance).

Rules:
- Write concise, factual, professional prose in paragraph form
- Never invent observations, measurements, or findings not present in the input
- Do not include greetings, sign-offs, headers, lists, or bullet points
- Use clear, plain language — the audience may include property owners
- Keep tone respectful and informative; avoid jargon unless necessary
- If the input is empty or thin, keep the output correspondingly brief rather than padding`;

const GENERAL_NOTES_PROMPT = `${BASE_PROMPT}

You are rewriting the job-level general notes. Polish the language, fix grammar, and tighten wording without adding information. Return 2-4 sentences. Return ONLY the rewritten text.`;

const CHECKLIST_ITEM_PROMPT = `${BASE_PROMPT}

You are rewriting a note attached to a single checklist item. Output should be 1-3 sentences describing what the technician observed or did for that specific item. Return ONLY the rewritten text.`;

const CUSTOMER_SUMMARY_PROMPT = `${BASE_PROMPT}

You are writing a single customer-facing summary paragraph (4-7 sentences) that explains the service visit. Synthesize the job's general notes and the per-item notes into a coherent narrative for the customer. Mention what was checked, what was found, and any follow-up actions if the tech noted them. Do not invent findings. Return ONLY the paragraph text.`;

function formatJobHeader(job: JobContext): string {
  const lines: string[] = [`Job: ${job.title}`];
  if (job.customerName) lines.push(`Customer: ${job.customerName}`);
  const addressParts = [job.serviceAddress, job.city, job.state, job.zip].filter(Boolean);
  if (addressParts.length > 0) lines.push(`Service address: ${addressParts.join(", ")}`);
  return lines.join("\n");
}

function buildGeneralNotesMessage(ctx: GeneralNotesContext): string {
  const header = formatJobHeader(ctx.job);
  if (!ctx.currentText.trim()) {
    return `${header}\n\nThe technician has not yet written general notes. Produce a brief (1-2 sentences) placeholder stating the visit was completed and that no additional observations have been recorded.`;
  }
  return `${header}\n\nTechnician's draft notes:\n"${ctx.currentText.trim()}"`;
}

function buildChecklistItemMessage(ctx: ChecklistItemContext): string {
  const header = formatJobHeader(ctx.job);
  const lines = [
    header,
    "",
    `Checklist item: ${ctx.itemTitle}`,
    ctx.itemInstructions ? `Instructions: ${ctx.itemInstructions}` : null,
    `Status: ${ctx.itemStatus}`,
    "",
    ctx.currentText.trim()
      ? `Technician's draft note:\n"${ctx.currentText.trim()}"`
      : "The technician has not yet written a note. Generate a concise one based on the item title, instructions, and status.",
  ].filter(Boolean);
  return lines.join("\n");
}

function buildCustomerSummaryMessage(ctx: CustomerSummaryContext): string {
  const header = formatJobHeader(ctx.job);
  const itemLines = ctx.items.map((item, idx) => {
    const base = `${idx + 1}. ${item.title} — status: ${item.status}`;
    return item.note ? `${base}\n   note: ${item.note}` : base;
  });
  const parts = [
    header,
    "",
    "General notes:",
    ctx.generalNotes?.trim() ? ctx.generalNotes.trim() : "(none)",
    "",
    "Checklist items and technician notes:",
    itemLines.length > 0 ? itemLines.join("\n") : "(no checklist items)",
  ];
  return parts.join("\n");
}

/**
 * Produce a rewritten / generated text for the requested scope. Caller is
 * responsible for auth, rate limiting, and persistence.
 */
export async function rewriteJobNotes(request: JobRewriteRequest): Promise<string> {
  let systemPrompt: string;
  let userMessage: string;
  let maxTokens: number;

  switch (request.type) {
    case "generalNotes":
      systemPrompt = GENERAL_NOTES_PROMPT;
      userMessage = buildGeneralNotesMessage(request.context);
      maxTokens = 400;
      break;
    case "checklistItem":
      systemPrompt = CHECKLIST_ITEM_PROMPT;
      userMessage = buildChecklistItemMessage(request.context);
      maxTokens = 250;
      break;
    case "customerSummary":
      systemPrompt = CUSTOMER_SUMMARY_PROMPT;
      userMessage = buildCustomerSummaryMessage(request.context);
      maxTokens = 700;
      break;
  }

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from AI");
  }
  return textBlock.text.trim();
}

// Exported for tests
export const __internal = {
  buildGeneralNotesMessage,
  buildChecklistItemMessage,
  buildCustomerSummaryMessage,
  formatJobHeader,
};
