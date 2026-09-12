/**
 * Structured extraction of PermitFacts from a stored Maricopa ESD permit PDF
 * (spec §6). Sonnet 4.6 reads a first-pass sub-PDF (pages 1–4 / 1–6) and, when
 * that yields neither a tank capacity nor a disposal type, a second sub-PDF of
 * the next ≤ 20 pages; the passes merge field-by-field (higher confidence
 * wins). Handwritten facts under HANDWRITING_ESCALATION_THRESHOLD are re-asked
 * on Opus 5 with only their page and a single question (max 3 per document).
 *
 * The structured-output schema sent to the API is the flat PermitFactsWireSchema
 * (the nested PermitFactsSchema does not compile as a grammar — see
 * permit-facts-wire.ts); each pass is converted back to PermitFacts here.
 */
import Anthropic, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AnthropicError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { buildSubPdf, loadPdfDocument, planPasses } from "@/lib/prefill/permits/triage";
import { HANDWRITING_ESCALATION_THRESHOLD, type PermitArchive } from "@/lib/prefill/types";
import {
  ESCALATION_SYSTEM_PROMPT,
  PERMIT_EXTRACTION_SYSTEM_PROMPT,
  buildEscalationUserMessage,
  buildPassUserMessage,
  type PassMessageMeta,
} from "./permit-extraction-prompt";
import {
  EscalationAnswerSchema,
  type EscalationAnswer,
  type Fact,
  type PermitFacts,
} from "./permit-extraction-schema";
import {
  allFactSpecs,
  coerceFactValue,
  getFactAt,
  hasCoreFacts,
  mergePermitFacts,
  rebasePages,
  setFactAt,
  type FactSpec,
  type FactValue,
} from "./permit-facts-utils";
import { PermitFactsWireSchema, permitFactsFromWire } from "./permit-facts-wire";
import type { PDFDocument } from "pdf-lib";

// Built lazily: constructing the SDK client at import time throws under vitest's jsdom
// environment ("browser-like environment"); tests inject `opts.client` instead.
let defaultClient: Anthropic | undefined;
function getClient(): Anthropic {
  defaultClient ??= new Anthropic();
  return defaultClient;
}

export const EXTRACTION_MODEL = "claude-sonnet-4-6";
export const ESCALATION_MODEL = "claude-opus-5";
export const EXTRACTION_MAX_TOKENS = 4096;
export const EXTRACTION_TIMEOUT_MS = 90_000;
export const MAX_ESCALATIONS_PER_DOCUMENT = 3;

/** USD per million tokens (platform.claude.com/docs/en/pricing, checked 2026-09-11) */
export const MODEL_PRICING: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  [EXTRACTION_MODEL]: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  [ESCALATION_MODEL]: { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
};

export interface ModelCallUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export interface ExtractionUsage {
  calls: ModelCallUsage[];
  estimatedCostUsd: number;
}

export function estimateCostUsd(calls: ModelCallUsage[]): number {
  let usd = 0;
  for (const c of calls) {
    const p = MODEL_PRICING[c.model] ?? MODEL_PRICING[EXTRACTION_MODEL];
    usd +=
      (c.inputTokens * p.input +
        c.outputTokens * p.output +
        c.cacheCreationInputTokens * p.cacheWrite +
        c.cacheReadInputTokens * p.cacheRead) /
      1_000_000;
  }
  return Math.round(usd * 10_000) / 10_000;
}

/** Any failure of one document's extraction. The message is safe to store in `extraction_error`. */
export class ExtractionError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ExtractionError";
    if (cause !== undefined) this.cause = cause;
  }
}

export function toExtractionError(err: unknown): ExtractionError {
  if (err instanceof ExtractionError) return err;
  if (err instanceof APIUserAbortError) {
    return new ExtractionError("Prefill time budget exceeded before extraction finished", err);
  }
  if (err instanceof APIConnectionTimeoutError) {
    return new ExtractionError(`Claude timed out after ${EXTRACTION_TIMEOUT_MS / 1000} s`, err);
  }
  if (err instanceof RateLimitError) {
    return new ExtractionError("Claude rate limit reached — try Find records again in a minute", err);
  }
  if (err instanceof APIConnectionError) return new ExtractionError(err.message, err);
  // APIError.message already carries the status ("500 boom")
  if (err instanceof APIError) return new ExtractionError(`Claude API error: ${err.message}`, err);
  // zodOutputFormat().parse throws a bare AnthropicError when the JSON does not match the schema
  if (err instanceof AnthropicError) {
    return new ExtractionError(`Schema mismatch: ${err.message.split("\n")[0]}`, err);
  }
  return new ExtractionError(err instanceof Error ? err.message : String(err), err);
}

/** Runs one Claude call; spec §10: one retry on network errors only (never on HTTP status, never on a timeout). */
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof APIConnectionError && !(err instanceof APIConnectionTimeoutError)) {
      try {
        return await fn();
      } catch (retryErr) {
        throw toExtractionError(retryErr);
      }
    }
    throw toExtractionError(err);
  }
}

function recordUsage(calls: ModelCallUsage[], model: string, usage: Anthropic.Messages.Usage | undefined): void {
  if (!usage) return;
  calls.push({
    model,
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
  });
}

export interface ExtractPermitFactsMeta {
  permitNumber: string;
  docType: string;
  archive: PermitArchive;
}

export interface ExtractPermitFactsOptions {
  /** The run's 240 s budget signal */
  signal?: AbortSignal;
  /** Injected in tests; defaults to the module client */
  client?: Anthropic;
  /** Default true; false skips the Opus escalation */
  escalate?: boolean;
}

export interface ExtractPermitFactsResult {
  facts: PermitFacts;
  passes: 1 | 2;
  escalations: number;
  pageCount: number;
  usage: ExtractionUsage;
}

async function runPass(
  client: Anthropic,
  subPdf: Uint8Array,
  meta: PassMessageMeta,
  signal: AbortSignal | undefined,
  calls: ModelCallUsage[],
): Promise<PermitFacts> {
  const message = await guarded(() =>
    client.messages.parse(
      {
        model: EXTRACTION_MODEL,
        max_tokens: EXTRACTION_MAX_TOKENS,
        system: [
          {
            type: "text",
            text: PERMIT_EXTRACTION_SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: Buffer.from(subPdf).toString("base64"),
                },
                title: `${meta.permitNumber} ${meta.docType}`,
              },
              { type: "text", text: buildPassUserMessage(meta) },
            ],
          },
        ],
        output_config: { format: zodOutputFormat(PermitFactsWireSchema) },
      },
      { timeout: EXTRACTION_TIMEOUT_MS, maxRetries: 0, signal },
    ),
  );
  recordUsage(calls, EXTRACTION_MODEL, message.usage);
  if (message.stop_reason === "max_tokens") {
    throw new ExtractionError("Claude reply was cut off (max_tokens)");
  }
  if (!message.parsed_output) {
    throw new ExtractionError(
      `Claude returned no structured output (stop_reason: ${message.stop_reason ?? "unknown"})`,
    );
  }
  return rebasePages(permitFactsFromWire(message.parsed_output), meta.pageNumbers);
}

async function askEscalation(
  client: Anthropic,
  pagePdf: Uint8Array,
  spec: FactSpec,
  current: Fact<FactValue>,
  signal: AbortSignal | undefined,
  calls: ModelCallUsage[],
): Promise<EscalationAnswer | null> {
  const message = await guarded(() =>
    client.messages.parse(
      {
        model: ESCALATION_MODEL,
        max_tokens: EXTRACTION_MAX_TOKENS,
        // Under Opus 5's 512-token cache minimum, so no cache_control — it would be silently ignored.
        system: ESCALATION_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: Buffer.from(pagePdf).toString("base64"),
                },
              },
              { type: "text", text: buildEscalationUserMessage(spec, current) },
            ],
          },
        ],
        output_config: { format: zodOutputFormat(EscalationAnswerSchema) },
      },
      { timeout: EXTRACTION_TIMEOUT_MS, maxRetries: 0, signal },
    ),
  );
  recordUsage(calls, ESCALATION_MODEL, message.usage);
  return message.parsed_output ?? null;
}

/**
 * Spec §6: every handwritten fact with confidence < 0.6 (weakest first, max 3)
 * is re-asked on Opus with only its page. The Opus answer replaces the fact
 * only when it is more confident. An Opus failure ends escalation but keeps
 * the Sonnet facts. Returns the number of answers received.
 */
async function escalateWeakHandwriting(
  client: Anthropic,
  doc: PDFDocument,
  facts: PermitFacts,
  signal: AbortSignal | undefined,
  calls: ModelCallUsage[],
): Promise<number> {
  const weak = allFactSpecs(facts)
    .map((spec) => ({ spec, fact: getFactAt(facts, spec.path) }))
    .filter(
      (x): x is { spec: FactSpec; fact: Fact<FactValue> } =>
        x.fact != null && x.fact.handwritten && x.fact.confidence < HANDWRITING_ESCALATION_THRESHOLD,
    )
    .sort((a, b) => a.fact.confidence - b.fact.confidence)
    .slice(0, MAX_ESCALATIONS_PER_DOCUMENT);

  let answered = 0;
  for (const { spec, fact } of weak) {
    let answer: EscalationAnswer | null;
    try {
      answer = await askEscalation(client, await buildSubPdf(doc, [fact.page]), spec, fact, signal, calls);
    } catch (err) {
      console.warn(
        `[prefill] escalation of ${spec.path} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      break;
    }
    answered++;
    if (!answer?.found) continue;
    const value = coerceFactValue(spec.kind, answer.value);
    if (value === null || answer.confidence <= fact.confidence) continue;
    setFactAt(facts, spec.path, {
      value,
      confidence: answer.confidence,
      page: fact.page,
      evidence: answer.evidence,
      handwritten: answer.handwritten,
    });
  }
  return answered;
}

/**
 * Extract PermitFacts from one stored permit PDF. Throws ExtractionError; the
 * caller marks the record `failed` and moves on.
 */
export async function extractPermitFactsFromPdf(
  pdfBytes: Uint8Array,
  meta: ExtractPermitFactsMeta,
  opts: ExtractPermitFactsOptions = {},
): Promise<ExtractPermitFactsResult> {
  const client = opts.client ?? getClient();
  const calls: ModelCallUsage[] = [];

  let doc: Awaited<ReturnType<typeof loadPdfDocument>>;
  try {
    doc = await loadPdfDocument(pdfBytes);
  } catch (err) {
    throw new ExtractionError(err instanceof Error ? err.message : String(err), err);
  }
  const plan = planPasses(doc.getPageCount(), meta.archive);

  let facts = await runPass(
    client,
    await buildSubPdf(doc, plan.first),
    { ...meta, pageNumbers: plan.first, totalPages: plan.pageCount, pass: 1 },
    opts.signal,
    calls,
  );
  let passes: 1 | 2 = 1;

  if (!hasCoreFacts(facts) && plan.second.length > 0) {
    const more = await runPass(
      client,
      await buildSubPdf(doc, plan.second),
      { ...meta, pageNumbers: plan.second, totalPages: plan.pageCount, pass: 2 },
      opts.signal,
      calls,
    );
    facts = mergePermitFacts(facts, more);
    passes = 2;
  }

  const escalations =
    opts.escalate === false ? 0 : await escalateWeakHandwriting(client, doc, facts, opts.signal, calls);

  return {
    facts,
    passes,
    escalations,
    pageCount: plan.pageCount,
    usage: { calls, estimatedCostUsd: estimateCostUsd(calls) },
  };
}
