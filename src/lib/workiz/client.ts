import "server-only";

/**
 * GET-only Workiz v2 HTTP client (spec §7.2). The token's real scope is unknown and may allow
 * writes, so no other method is ever exported. The token is read only here, trimmed, and never
 * logged; logs carry the path, the page number, the status and the attempt only.
 */

export type WorkizErrorCode =
  | "not_configured"
  | "auth_failed"
  | "not_found"
  | "rate_limited"
  | "unavailable"
  | "bad_response";

export class WorkizError extends Error {
  readonly code: WorkizErrorCode;
  readonly status?: number;

  constructor(code: WorkizErrorCode, status?: number) {
    super(`Workiz ${code}${status ? ` (HTTP ${status})` : ""}`);
    this.name = "WorkizError";
    this.code = code;
    this.status = status;
  }
}

export const WORKIZ_DEFAULT_BASE = "https://api.workiz.com/crm/api/v2";
/** Cloudflare 403s some default UAs (Python-urllib); always send our own (spec §7.1) */
export const WORKIZ_USER_AGENT = "SewerTime-InspectionFormFiller/1.0";
export const WORKIZ_REQUEST_TIMEOUT_MS = 15_000;
/** Cap on the total time spent waiting between retries, so an interactive request never hangs */
export const WORKIZ_MAX_RETRY_WAIT_MS = 6_000;
const RATE_LIMIT_WAITS_MS = [1_000, 2_000];
const RETRY_AFTER_CAP_S = 5;
const TRANSIENT_RETRY_WAIT_MS = 1_000;

let baseRejectionLogged = false;

export function getWorkizConfig(): { token: string; base: string } | null {
  const token = (process.env.WORKIZ_API_V2_TOKEN ?? "").trim();
  if (!token) return null;
  const base =
    (process.env.WORKIZ_API_V2_BASE ?? "").trim().replace(/\/+$/, "") || WORKIZ_DEFAULT_BASE;
  if (!base.startsWith("https://")) {
    if (!baseRejectionLogged) {
      baseRejectionLogged = true;
      console.error("[workiz] WORKIZ_API_V2_BASE rejected: not https");
    }
    return null;
  }
  return { token, base };
}

/**
 * One AbortSignal that fires when any input fires or after `timeoutMs`. setTimeout-based
 * (not AbortSignal.timeout) so vitest fake timers drive it. Always call dispose().
 */
export function combineSignals(
  signals: Array<AbortSignal | undefined>,
  timeoutMs?: number,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const cleanups: Array<() => void> = [];
  const abort = (reason: unknown): void => {
    if (!controller.signal.aborted) controller.abort(reason);
  };
  for (const input of signals) {
    if (!input) continue;
    if (input.aborted) {
      abort(input.reason);
      continue;
    }
    const onAbort = (): void => abort(input.reason);
    input.addEventListener("abort", onAbort, { once: true });
    cleanups.push(() => input.removeEventListener("abort", onAbort));
  }
  if (timeoutMs !== undefined) {
    const timer = setTimeout(() => abort(new DOMException("Timed out", "TimeoutError")), timeoutMs);
    cleanups.push(() => clearTimeout(timer));
  }
  return {
    signal: controller.signal,
    dispose: () => {
      for (const cleanup of cleanups) cleanup();
    },
  };
}

/** Sleep that ends early (as `unavailable`) when the caller's deadline fires */
export function waitFor(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new WorkizError("unavailable"));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new WorkizError("unavailable"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

type Attempt<T> =
  | { kind: "ok"; data: T }
  | { kind: "rate_limited"; status: number; retryAfterMs?: number }
  | { kind: "transient"; status?: number };

function retryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.min(seconds, RETRY_AFTER_CAP_S) * 1000;
}

async function attemptOnce<T>(url: string, token: string, signal: AbortSignal): Promise<Attempt<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "User-Agent": WORKIZ_USER_AGENT,
      },
      signal,
      cache: "no-store",
    });
  } catch {
    return { kind: "transient" }; // network error or the 15 s timeout
  }
  if (res.status === 401) throw new WorkizError("auth_failed", 401);
  if (res.status === 403) {
    // JSON 403 = Workiz refusing the token; HTML 403 = Cloudflare in front of it
    const isJson = (res.headers.get("content-type") ?? "").toLowerCase().includes("json");
    throw new WorkizError(isJson ? "auth_failed" : "unavailable", 403);
  }
  if (res.status === 404) throw new WorkizError("not_found", 404);
  if (res.status === 429) {
    return { kind: "rate_limited", status: 429, retryAfterMs: retryAfterMs(res.headers.get("retry-after")) };
  }
  if (res.status >= 500) return { kind: "transient", status: res.status };
  if (!res.ok) throw new WorkizError("unavailable", res.status);
  try {
    return { kind: "ok", data: JSON.parse(await res.text()) as T };
  } catch {
    return { kind: "transient", status: res.status }; // non-JSON 200 or a body cut off
  }
}

/**
 * GET `${base}${path}?${query}`. Retries: 429 → 1 s then 2 s (or Retry-After, capped at 5 s);
 * 5xx / network / timeout / non-JSON 200 → one retry after 1 s; total waiting ≤ 6 s.
 * `path` must already be encoded (callers encodeURIComponent any id).
 */
export async function workizGet<T>(
  path: string,
  query: Record<string, string> = {},
  opts: { signal?: AbortSignal } = {},
): Promise<T> {
  const config = getWorkizConfig();
  if (!config) throw new WorkizError("not_configured");
  const qs = new URLSearchParams(query).toString();
  const url = `${config.base}${path}${qs ? `?${qs}` : ""}`;
  const label = `GET ${path}${query.page ? ` page=${query.page}` : ""}`;

  let rateRetries = 0;
  let transientRetries = 0;
  let waitedMs = 0;
  for (;;) {
    if (opts.signal?.aborted) throw new WorkizError("unavailable");
    const attemptSignal = combineSignals([opts.signal], WORKIZ_REQUEST_TIMEOUT_MS);
    let attempt: Attempt<T>;
    try {
      attempt = await attemptOnce<T>(url, config.token, attemptSignal.signal);
    } finally {
      attemptSignal.dispose();
    }
    if (attempt.kind === "ok") return attempt.data;
    if (opts.signal?.aborted) throw new WorkizError("unavailable");

    let waitMs: number | null = null;
    if (attempt.kind === "rate_limited" && rateRetries < RATE_LIMIT_WAITS_MS.length) {
      waitMs = attempt.retryAfterMs ?? RATE_LIMIT_WAITS_MS[rateRetries];
      rateRetries += 1;
    } else if (attempt.kind === "transient" && transientRetries < 1) {
      waitMs = TRANSIENT_RETRY_WAIT_MS;
      transientRetries += 1;
    }
    const status = attempt.status ?? "network";
    if (waitMs === null || waitedMs + waitMs > WORKIZ_MAX_RETRY_WAIT_MS) {
      console.warn(`[workiz] ${label} → ${status} (giving up)`);
      throw new WorkizError(attempt.kind === "rate_limited" ? "rate_limited" : "unavailable", attempt.status);
    }
    console.warn(`[workiz] ${label} → ${status} (retry ${rateRetries + transientRetries})`);
    waitedMs += waitMs;
    await waitFor(waitMs, opts.signal);
  }
}
