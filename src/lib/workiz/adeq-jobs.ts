import { type WorkizJobSummary, isImportable, toJobSummary } from "./adeq";
import { combineSignals, WorkizError, waitFor, workizGet } from "./client";
import { parseWorkizJob, serialIdForLog, type WorkizJob, workizJobsPageSchema } from "./schema";

/**
 * Importable-ADEQ-jobs listing (spec §7.4). The API has no server-side status/type filter, so
 * every open job is paged in and filtered here. One module-level cache entry per serverless
 * instance: 60 s TTL, a 15 s floor under `refresh`, single-flight, failures never cached.
 * Only summaries are cached — no client name, email, phone or notes.
 */

export const LIST_CACHE_TTL_MS = 60_000;
export const REFRESH_FLOOR_MS = 15_000;
export const LIST_DEADLINE_MS = 25_000;
export const MAX_LIST_PAGES = 10;
export const PAGE_DELAY_MS = 500;
const LIST_PAGE_SIZE = 300;

export function openJobsQuery(page: number): Record<string, string> {
  return {
    isOpen: "true",
    pageSize: String(LIST_PAGE_SIZE),
    page: String(page),
    dateProperty: "date",
    dateOperator: "next",
    date: "2020-01-01",
    field: "created",
    order: "ASC",
  };
}

/** Every open job (≤ 10 pages, 500 ms apart) under one 25 s deadline covering pages and retries */
export async function fetchOpenJobs(
  opts: { signal?: AbortSignal } = {},
): Promise<{ jobs: WorkizJob[]; pages: number; dropped: number }> {
  const deadline = combineSignals([opts.signal], LIST_DEADLINE_MS);
  try {
    const jobs: WorkizJob[] = [];
    let dropped = 0;
    let pages = 0;
    for (let page = 1; page <= MAX_LIST_PAGES; page++) {
      if (page > 1) await waitFor(PAGE_DELAY_MS, deadline.signal);
      const raw = await workizGet<unknown>("/jobs", openJobsQuery(page), { signal: deadline.signal });
      const parsed = workizJobsPageSchema.safeParse(raw);
      if (!parsed.success) throw new WorkizError("bad_response");
      pages = page;
      for (const item of parsed.data.data) {
        const job = parseWorkizJob(item);
        if (job) {
          jobs.push(job);
        } else {
          dropped += 1;
          console.warn(`[workiz] dropped job serial=${serialIdForLog(item)} reason=schema`);
        }
      }
      if (!parsed.data.hasMore || parsed.data.data.length === 0) break;
    }
    return { jobs, pages, dropped };
  } catch (err) {
    if (err instanceof WorkizError) throw err;
    throw new WorkizError("unavailable");
  } finally {
    deadline.dispose();
  }
}

function sortSummaries(rows: WorkizJobSummary[]): WorkizJobSummary[] {
  return [...rows].sort((a, b) => {
    if (a.scheduledDate !== b.scheduledDate) {
      if (!a.scheduledDate) return 1;
      if (!b.scheduledDate) return -1;
      return a.scheduledDate > b.scheduledDate ? -1 : 1;
    }
    return (b.serialId ?? 0) - (a.serialId ?? 0);
  });
}

interface CacheEntry {
  at: number;
  rows: WorkizJobSummary[];
}

let cache: CacheEntry | null = null;
let inflight: Promise<CacheEntry> | null = null;

export async function listImportableAdeqJobs(
  opts: { refresh?: boolean } = {},
): Promise<{ rows: WorkizJobSummary[]; fetchedAt: number }> {
  if (cache) {
    const age = Date.now() - cache.at;
    if (age < LIST_CACHE_TTL_MS && (!opts.refresh || age < REFRESH_FLOOR_MS)) {
      return { rows: cache.rows, fetchedAt: cache.at };
    }
  }
  if (!inflight) {
    inflight = (async () => {
      const { jobs } = await fetchOpenJobs();
      const entry = { at: Date.now(), rows: sortSummaries(jobs.filter(isImportable).map(toJobSummary)) };
      cache = entry;
      return entry;
    })().finally(() => {
      inflight = null;
    });
  }
  const entry = await inflight;
  return { rows: entry.rows, fetchedAt: entry.at };
}

/** The cached summary for a JOB-… id, without any network call (import's uuid pre-check) */
export function getCachedSummary(id: string): WorkizJobSummary | undefined {
  return cache?.rows.find((row) => row.id === id);
}

/** GET /jobs/{id} returns the job shape; tolerate a `{ data: job | [job] }` wrapper too */
export function unwrapSingleJob(raw: unknown): unknown {
  if (raw && typeof raw === "object" && "data" in raw) {
    const data = (raw as { data: unknown }).data;
    return Array.isArray(data) ? data[0] : data;
  }
  return raw;
}

export async function getJob(id: string): Promise<WorkizJob> {
  const raw = await workizGet<unknown>(`/jobs/${encodeURIComponent(id)}`);
  const job = parseWorkizJob(unwrapSingleJob(raw));
  if (!job) throw new WorkizError("bad_response");
  return job;
}

export function __resetWorkizJobsCacheForTests(): void {
  cache = null;
  inflight = null;
}
