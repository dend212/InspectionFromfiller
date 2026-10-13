import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  combineSignals,
  getWorkizConfig,
  WORKIZ_USER_AGENT,
  WorkizError,
  workizGet,
} from "@/lib/workiz/client";

const TOKEN = "f".repeat(64);
const mockFetch = vi.fn();

function res(status: number, body: string, headers: Record<string, string> = {}) {
  return { status, ok: status >= 200 && status < 300, headers: new Headers(headers), text: async () => body };
}
const json = (status: number, data: unknown, headers: Record<string, string> = {}) =>
  res(status, JSON.stringify(data), { "content-type": "application/json", ...headers });

let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  vi.stubEnv("WORKIZ_API_V2_TOKEN", TOKEN);
  vi.stubEnv("WORKIZ_API_V2_BASE", "");
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  mockFetch.mockReset();
});

/** Runs a call to completion under fake timers and returns its rejection (or resolution) */
async function settle<T>(promise: Promise<T>): Promise<T | unknown> {
  const outcome = promise.then(
    (value) => value,
    (err) => err,
  );
  await vi.runAllTimersAsync();
  return outcome;
}

function loggedText(): string {
  return JSON.stringify([...warnSpy.mock.calls, ...errorSpy.mock.calls]);
}

describe("getWorkizConfig", () => {
  it("defaults the base and trims the token (a pasted trailing newline must not 401)", () => {
    vi.stubEnv("WORKIZ_API_V2_TOKEN", `  ${TOKEN}\n`);
    expect(getWorkizConfig()).toEqual({ token: TOKEN, base: "https://api.workiz.com/crm/api/v2" });
  });

  it("returns null for a missing or whitespace-only token", () => {
    vi.stubEnv("WORKIZ_API_V2_TOKEN", "");
    expect(getWorkizConfig()).toBeNull();
    vi.stubEnv("WORKIZ_API_V2_TOKEN", " \n ");
    expect(getWorkizConfig()).toBeNull();
  });

  it("accepts an https base override and strips trailing slashes", () => {
    vi.stubEnv("WORKIZ_API_V2_BASE", " https://staging.example.com/crm/api/v2/ ");
    expect(getWorkizConfig()?.base).toBe("https://staging.example.com/crm/api/v2");
  });

  it("rejects a non-https base so the bearer token is never sent in cleartext", () => {
    vi.stubEnv("WORKIZ_API_V2_BASE", "http://api.workiz.com/crm/api/v2");
    expect(getWorkizConfig()).toBeNull();
    expect(loggedText()).toContain("WORKIZ_API_V2_BASE rejected: not https");
  });
});

describe("workizGet", () => {
  it("sends a GET with Bearer, User-Agent and Accept to the exact URL", async () => {
    mockFetch.mockResolvedValue(json(200, { ok: 1 }));
    const data = await workizGet<{ ok: number }>("/jobs", { isOpen: "true", page: "1" });
    expect(data).toEqual({ ok: 1 });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.workiz.com/crm/api/v2/jobs?isOpen=true&page=1");
    expect(init.method).toBe("GET");
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/json",
      "User-Agent": WORKIZ_USER_AGENT,
    });
    expect(WORKIZ_USER_AGENT).toBe("SewerTime-InspectionFormFiller/1.0");
  });

  it("uses the trimmed token in the header", async () => {
    vi.stubEnv("WORKIZ_API_V2_TOKEN", `${TOKEN}\n`);
    mockFetch.mockResolvedValue(json(200, {}));
    await workizGet("/jobs");
    expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("not_configured without a token or with a non-https base — and never fetches", async () => {
    vi.stubEnv("WORKIZ_API_V2_TOKEN", "");
    await expect(workizGet("/jobs")).rejects.toMatchObject({ name: "WorkizError", code: "not_configured" });
    vi.stubEnv("WORKIZ_API_V2_TOKEN", TOKEN);
    vi.stubEnv("WORKIZ_API_V2_BASE", "http://evil.example.com");
    await expect(workizGet("/jobs")).rejects.toMatchObject({ code: "not_configured" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([
    [json(401, { statusCode: 401 }), "auth_failed"],
    [json(403, { statusCode: 403 }), "auth_failed"],
    [res(403, "<html>Cloudflare</html>", { "content-type": "text/html" }), "unavailable"],
    [json(404, { statusCode: 404 }), "not_found"],
  ])("maps %# without retrying", async (response, code) => {
    mockFetch.mockResolvedValue(response);
    await expect(workizGet("/jobs/JOB-AbCdEf")).rejects.toMatchObject({ code });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("429 → waits 1 s and retries", async () => {
    vi.useFakeTimers();
    mockFetch.mockResolvedValueOnce(json(429, { statusCode: 429 })).mockResolvedValueOnce(json(200, { ok: 1 }));
    const promise = workizGet("/jobs", { page: "2" });
    await vi.advanceTimersByTimeAsync(999);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toEqual({ ok: 1 });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(loggedText()).toContain("[workiz] GET /jobs page=2 → 429 (retry 1)");
  });

  it("429 three times → rate_limited after waits of 1 s then 2 s", async () => {
    vi.useFakeTimers();
    mockFetch.mockResolvedValue(json(429, { statusCode: 429 }));
    const err = await settle(workizGet("/jobs"));
    expect(err).toBeInstanceOf(WorkizError);
    expect(err).toMatchObject({ code: "rate_limited" });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("honours Retry-After, capped at 5 s, within the 6 s total wait budget", async () => {
    vi.useFakeTimers();
    mockFetch.mockResolvedValue(json(429, { statusCode: 429 }, { "retry-after": "10" }));
    const promise = workizGet("/jobs");
    const outcome = promise.catch((e) => e);
    await vi.advanceTimersByTimeAsync(4999);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    // a second 5 s wait would exceed the 6 s budget → give up
    await vi.runAllTimersAsync();
    expect(await outcome).toMatchObject({ code: "rate_limited" });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("5xx → one retry after 1 s, then unavailable", async () => {
    vi.useFakeTimers();
    mockFetch.mockResolvedValueOnce(json(503, {})).mockResolvedValueOnce(json(200, { ok: 1 }));
    await expect(settle(workizGet("/jobs"))).resolves.toEqual({ ok: 1 });
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(json(502, {}));
    expect(await settle(workizGet("/jobs"))).toMatchObject({ code: "unavailable", status: 502 });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("network error and non-JSON 200 are retried once", async () => {
    vi.useFakeTimers();
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(json(200, { ok: 1 }));
    await expect(settle(workizGet("/jobs"))).resolves.toEqual({ ok: 1 });
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(res(200, "<html>not json</html>", { "content-type": "text/html" }));
    expect(await settle(workizGet("/jobs"))).toMatchObject({ code: "unavailable" });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("times out each attempt at 15 s (one retry) → unavailable", async () => {
    vi.useFakeTimers();
    mockFetch.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(init.signal.reason));
        }),
    );
    const outcome = workizGet("/jobs").catch((e) => e);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000 + 15_000);
    expect(await outcome).toMatchObject({ code: "unavailable" });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("a caller abort ends the call as unavailable with no retry", async () => {
    const controller = new AbortController();
    mockFetch.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(init.signal.reason));
        }),
    );
    const outcome = workizGet("/jobs", {}, { signal: controller.signal }).catch((e) => e);
    controller.abort();
    expect(await outcome).toMatchObject({ code: "unavailable" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("only ever calls fetch with GET and never logs the token", async () => {
    vi.useFakeTimers();
    mockFetch.mockResolvedValueOnce(json(429, {})).mockResolvedValueOnce(json(500, {})).mockResolvedValue(json(401, {}));
    await settle(workizGet("/jobs", { page: "1" }));
    for (const [, init] of mockFetch.mock.calls) expect(init.method).toBe("GET");
    expect(loggedText()).not.toContain(TOKEN);
  });
});

describe("combineSignals", () => {
  it("aborts after the timeout, or when any input aborts; dispose clears the timer", async () => {
    vi.useFakeTimers();
    const timed = combineSignals([], 100);
    expect(timed.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(timed.signal.aborted).toBe(true);

    const input = new AbortController();
    const linked = combineSignals([input.signal]);
    input.abort();
    expect(linked.signal.aborted).toBe(true);

    const disposed = combineSignals([], 100);
    disposed.dispose();
    await vi.advanceTimersByTimeAsync(200);
    expect(disposed.signal.aborted).toBe(false);
  });
});
