import type Anthropic from "@anthropic-ai/sdk";
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AnthropicError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import {
  ESCALATION_MODEL,
  EXTRACTION_MODEL,
  ExtractionError,
  estimateCostUsd,
  extractPermitFactsFromPdf,
} from "@/lib/ai/extract-permit-facts";
import { emptyPermitFacts, type PermitFacts } from "@/lib/ai/permit-extraction-schema";

/** Page N is (100+N) points wide so we can tell which page was attached */
async function makePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 1; i <= pages; i++) doc.addPage([100 + i, 200]);
  return new Uint8Array(await doc.save());
}

const sonnetUsage = {
  input_tokens: 10_000,
  output_tokens: 1_000,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 10_000,
};
const opusUsage = {
  input_tokens: 2_000,
  output_tokens: 200,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

function reply(parsed: unknown, extra: Record<string, unknown> = {}) {
  return { parsed_output: parsed, stop_reason: "end_turn", usage: sonnetUsage, content: [], ...extra };
}

function opusReply(answer: unknown) {
  return { parsed_output: answer, stop_reason: "end_turn", usage: opusUsage, content: [] };
}

function fakeClient(...replies: Array<object | Error>) {
  const parse = vi.fn();
  for (const r of replies) {
    if (r instanceof Error) parse.mockRejectedValueOnce(r);
    else parse.mockResolvedValueOnce(r);
  }
  return { client: { messages: { parse } } as unknown as Anthropic, parse };
}

// biome-ignore lint/suspicious/noExplicitAny: reading back untyped mock call args
async function attachedPdf(call: any): Promise<PDFDocument> {
  const block = call.messages[0].content.find((b: { type: string }) => b.type === "document");
  // Buffer is a Node-realm Uint8Array; under jsdom pdf-lib's instanceof check needs this realm's
  return PDFDocument.load(new Uint8Array(Buffer.from(block.source.data, "base64")));
}

// biome-ignore lint/suspicious/noExplicitAny: reading back untyped mock call args
function attachedText(call: any): string {
  return call.messages[0].content.find((b: { type: string }) => b.type === "text").text;
}

const f = <T>(value: T, confidence = 0.9, page = 1, handwritten = false) => ({
  value,
  confidence,
  page,
  evidence: `ev:${String(value)}`,
  handwritten,
});

function withCapacity(
  facts: PermitFacts,
  gal: number,
  page = 1,
  confidence = 0.9,
  handwritten = false,
): PermitFacts {
  return {
    ...facts,
    tanks: [{ capacityGal: f(gal, confidence, page, handwritten), material: null, model: null, dimensions: null }],
  };
}

const meta = { permitNumber: "000972", docType: "PERMIT", archive: "edms_env" as const };

describe("extractPermitFactsFromPdf — passes", () => {
  it("runs a single Sonnet pass over pages 1–4 when they carry core facts", async () => {
    const { client, parse } = fakeClient(reply(withCapacity(emptyPermitFacts(), 1200)));
    const result = await extractPermitFactsFromPdf(await makePdf(7), meta, { client, escalate: false });

    expect(result.passes).toBe(1);
    expect(result.pageCount).toBe(7);
    expect(result.facts.tanks[0].capacityGal?.value).toBe(1200);
    expect(parse).toHaveBeenCalledTimes(1);

    const [params, options] = parse.mock.calls[0];
    expect(params.model).toBe(EXTRACTION_MODEL);
    expect(params.max_tokens).toBe(4096);
    expect(params.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(params.system[0].text).toContain("General Permits Authorized");
    expect(params.output_config.format.type).toBe("json_schema");
    expect(options).toEqual({ timeout: 90_000, maxRetries: 0, signal: undefined });
    expect((await attachedPdf(params)).getPageCount()).toBe(4);
    expect(attachedText(params)).toContain("pages 1–4 of a 7-page document");
  });

  it("runs a second pass over the remaining pages when pass 1 has no capacity and no disposal type, and rebases pages", async () => {
    const pass1 = { ...emptyPermitFacts(), permitNumber: f("000972", 0.9, 1) };
    const pass2: PermitFacts = {
      ...withCapacity(emptyPermitFacts(), 1200, 2),
      disposal: { ...emptyPermitFacts().disposal, type: f("seepage_pit", 0.8, 3) },
    };
    const { client, parse } = fakeClient(reply(pass1), reply(pass2));
    const result = await extractPermitFactsFromPdf(await makePdf(7), meta, { client, escalate: false });

    expect(result.passes).toBe(2);
    expect(parse).toHaveBeenCalledTimes(2);
    const second = parse.mock.calls[1][0];
    expect((await attachedPdf(second)).getPageCount()).toBe(3);
    expect((await attachedPdf(second)).getPage(0).getWidth()).toBe(105);
    expect(attachedText(second)).toContain("pages 5–7 of a 7-page document");
    expect(attachedText(second)).toContain("did not state a tank capacity");
    // pass-2 page 2 → source page 6; pass-2 page 3 → source page 7
    expect(result.facts.tanks[0].capacityGal?.page).toBe(6);
    expect(result.facts.disposal.type?.page).toBe(7);
    expect(result.facts.permitNumber?.value).toBe("000972");
  });

  it("does not run a second pass when the document has no more pages", async () => {
    const { client, parse } = fakeClient(reply(emptyPermitFacts()));
    const result = await extractPermitFactsFromPdf(await makePdf(3), meta, { client, escalate: false });
    expect(result.passes).toBe(1);
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("uses pages 1–6 for ePLPAV documents", async () => {
    const { client, parse } = fakeClient(reply(withCapacity(emptyPermitFacts(), 1250)));
    await extractPermitFactsFromPdf(await makePdf(54), { ...meta, archive: "edms_eplpav" }, { client, escalate: false });
    expect((await attachedPdf(parse.mock.calls[0][0])).getPageCount()).toBe(6);
  });

  it("accumulates usage and estimates cost", async () => {
    const { client } = fakeClient(reply(emptyPermitFacts()), reply(withCapacity(emptyPermitFacts(), 1000)));
    const result = await extractPermitFactsFromPdf(await makePdf(7), meta, { client, escalate: false });
    expect(result.usage.calls).toHaveLength(2);
    expect(result.usage.calls[0]).toEqual({
      model: EXTRACTION_MODEL,
      inputTokens: 10_000,
      outputTokens: 1_000,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 10_000,
    });
    // per call: 10k×$3 + 1k×$15 + 10k×$0.30 per MTok = $0.048
    expect(result.usage.estimatedCostUsd).toBeCloseTo(0.096, 4);
  });
});

describe("estimateCostUsd", () => {
  it("prices Sonnet and Opus calls separately", () => {
    expect(
      estimateCostUsd([
        { model: EXTRACTION_MODEL, inputTokens: 10_000, outputTokens: 1_000, cacheCreationInputTokens: 0, cacheReadInputTokens: 10_000 },
        { model: ESCALATION_MODEL, inputTokens: 2_000, outputTokens: 200, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
      ]),
    ).toBeCloseTo(0.048 + 0.015, 4);
  });
});

describe("extractPermitFactsFromPdf — failures", () => {
  it("maps SDK errors to ExtractionError with a human message", async () => {
    const cases: Array<[Error, RegExp]> = [
      [new APIError(500, undefined, "boom", undefined), /Claude API error: 500 boom/],
      [new RateLimitError(429, undefined, "slow down", new Headers()), /rate limit/i],
      [new APIConnectionTimeoutError(), /timed out after 90 s/],
      [new APIUserAbortError(), /time budget/],
      [new AnthropicError("Failed to parse structured output: bad\nValidation issues:\n  - x"), /Schema mismatch: Failed to parse structured output: bad$/],
    ];
    for (const [err, pattern] of cases) {
      const { client } = fakeClient(err);
      const promise = extractPermitFactsFromPdf(await makePdf(2), meta, { client, escalate: false });
      await expect(promise).rejects.toBeInstanceOf(ExtractionError);
      await expect(promise).rejects.toThrow(pattern);
    }
  });

  it("fails when the reply was cut off or unparsed", async () => {
    const cut = fakeClient(reply(withCapacity(emptyPermitFacts(), 1), { stop_reason: "max_tokens" }));
    await expect(extractPermitFactsFromPdf(await makePdf(2), meta, { client: cut.client })).rejects.toThrow(/max_tokens/);
    const empty = fakeClient(reply(null, { stop_reason: "refusal" }));
    await expect(extractPermitFactsFromPdf(await makePdf(2), meta, { client: empty.client })).rejects.toThrow(
      /no structured output \(stop_reason: refusal\)/,
    );
  });

  it("fails fast on bytes that are not a PDF", async () => {
    const { client, parse } = fakeClient();
    await expect(extractPermitFactsFromPdf(new Uint8Array([1, 2, 3]), meta, { client })).rejects.toThrow(
      /Could not open PDF/,
    );
    expect(parse).not.toHaveBeenCalled();
  });

  it("retries once on a connection error, but not on a timeout or an HTTP error", async () => {
    const ok = reply(withCapacity(emptyPermitFacts(), 1200));
    const retried = fakeClient(new APIConnectionError({ message: "ECONNRESET" }), ok);
    const result = await extractPermitFactsFromPdf(await makePdf(2), meta, { client: retried.client, escalate: false });
    expect(result.facts.tanks[0].capacityGal?.value).toBe(1200);
    expect(retried.parse).toHaveBeenCalledTimes(2);

    const twice = fakeClient(new APIConnectionError({ message: "a" }), new APIConnectionError({ message: "b" }));
    await expect(extractPermitFactsFromPdf(await makePdf(2), meta, { client: twice.client })).rejects.toThrow(/^b$/);
    expect(twice.parse).toHaveBeenCalledTimes(2);

    for (const err of [new APIConnectionTimeoutError(), new APIError(500, undefined, "boom", undefined)]) {
      const once = fakeClient(err, ok);
      await expect(extractPermitFactsFromPdf(await makePdf(2), meta, { client: once.client })).rejects.toBeInstanceOf(ExtractionError);
      expect(once.parse).toHaveBeenCalledTimes(1);
    }
  });
});
