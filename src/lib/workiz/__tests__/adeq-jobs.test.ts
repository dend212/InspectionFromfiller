import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockWorkizGet } = vi.hoisted(() => ({ mockWorkizGet: vi.fn() }));

vi.mock("@/lib/workiz/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workiz/client")>();
  return { ...actual, workizGet: mockWorkizGet };
});

import {
  __resetWorkizJobsCacheForTests,
  getCachedSummary,
  getJob,
  LIST_DEADLINE_MS,
  listImportableAdeqJobs,
  openJobsQuery,
} from "@/lib/workiz/adeq-jobs";
import { WorkizError } from "@/lib/workiz/client";
import { fixtures, rawJob } from "./fixtures/jobs";

const page = (data: unknown[], hasMore = false) => ({ data, hasMore, page: 1, pageSize: 300, totalResults: data.length });

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-12T17:00:00.000Z"));
  __resetWorkizJobsCacheForTests();
  mockWorkizGet.mockReset();
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function settle<T>(promise: Promise<T>): Promise<T | unknown> {
  const outcome = promise.then(
    (v) => v,
    (e) => e,
  );
  await vi.runAllTimersAsync();
  return outcome;
}

describe("openJobsQuery", () => {
  it("is the verified query: open jobs, 300/page, 1-based, stable created ASC order", () => {
    expect(openJobsQuery(2)).toEqual({
      isOpen: "true",
      pageSize: "300",
      page: "2",
      dateProperty: "date",
      dateOperator: "next",
      date: "2020-01-01",
      field: "created",
      order: "ASC",
    });
  });
});

describe("listImportableAdeqJobs", () => {
  it("pages from 1 until hasMore is false, 500 ms apart", async () => {
    mockWorkizGet
      .mockResolvedValueOnce(page([rawJob()], true))
      .mockResolvedValueOnce(page([fixtures.onlineBooking()], false));
    const promise = listImportableAdeqJobs();
    await vi.advanceTimersByTimeAsync(0);
    expect(mockWorkizGet).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(499);
    expect(mockWorkizGet).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const { rows } = await promise;
    expect(mockWorkizGet.mock.calls.map((c) => [c[0], c[1].page])).toEqual([
      ["/jobs", "1"],
      ["/jobs", "2"],
    ]);
    expect(rows.map((r) => r.serialId)).toEqual([4700, 4696]);
  });

  it("keeps only importable ADEQ jobs and sorts by date desc (nulls last), then serial desc", async () => {
    mockWorkizGet.mockResolvedValueOnce(
      page([
        rawJob({ id: "JOB-a000000000000001", serialId: 4667, date: "2026-09-28 08:00:00" }),
        fixtures.unscheduled(),
        rawJob({ id: "JOB-a000000000000002", serialId: 4690, date: "2026-10-06 10:00:00" }),
        rawJob({ id: "JOB-a000000000000003", serialId: 4696, date: "2026-10-06 12:00:00" }),
        fixtures.nonAdeq(),
        fixtures.done(),
        fixtures.canceled(),
      ]),
    );
    const { rows } = (await settle(listImportableAdeqJobs())) as Awaited<ReturnType<typeof listImportableAdeqJobs>>;
    expect(rows.map((r) => r.serialId)).toEqual([4696, 4690, 4667, 4650]);
  });

  it("drops a job that fails the schema and logs only its serial", async () => {
    mockWorkizGet.mockResolvedValueOnce(page([rawJob(), { serialId: 4711, clientInfo: { firstName: "Test" } }]));
    const { rows } = (await settle(listImportableAdeqJobs())) as Awaited<ReturnType<typeof listImportableAdeqJobs>>;
    expect(rows).toHaveLength(1);
    const logged = JSON.stringify(warnSpy.mock.calls);
    expect(logged).toContain("serial=4711");
    expect(logged).not.toContain("Test");
  });

  it("a page whose data is not an array → bad_response", async () => {
    mockWorkizGet.mockResolvedValueOnce({ data: "nope" });
    expect(await settle(listImportableAdeqJobs())).toMatchObject({ code: "bad_response" });
  });

  it("caches for 60 s", async () => {
    mockWorkizGet.mockResolvedValue(page([rawJob()]));
    await settle(listImportableAdeqJobs());
    vi.advanceTimersByTime(59_000);
    await settle(listImportableAdeqJobs());
    expect(mockWorkizGet).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_000);
    await settle(listImportableAdeqJobs());
    expect(mockWorkizGet).toHaveBeenCalledTimes(2);
  });

  it("single-flight: concurrent callers share one fetch sequence", async () => {
    mockWorkizGet.mockResolvedValue(page([rawJob()]));
    const a = listImportableAdeqJobs();
    const b = listImportableAdeqJobs({ refresh: true });
    await vi.runAllTimersAsync();
    expect((await a).rows).toEqual((await b).rows);
    expect(mockWorkizGet).toHaveBeenCalledTimes(1);
  });

  it("refresh within 15 s returns the cached rows; after 15 s it refetches", async () => {
    mockWorkizGet.mockResolvedValue(page([rawJob()]));
    const first = (await settle(listImportableAdeqJobs())) as Awaited<ReturnType<typeof listImportableAdeqJobs>>;
    vi.advanceTimersByTime(14_000);
    const second = (await settle(listImportableAdeqJobs({ refresh: true }))) as typeof first;
    expect(mockWorkizGet).toHaveBeenCalledTimes(1);
    expect(second.fetchedAt).toBe(first.fetchedAt);
    vi.advanceTimersByTime(1_000);
    await settle(listImportableAdeqJobs({ refresh: true }));
    expect(mockWorkizGet).toHaveBeenCalledTimes(2);
  });

  it("never caches a failure", async () => {
    mockWorkizGet.mockRejectedValueOnce(new WorkizError("unavailable")).mockResolvedValue(page([rawJob()]));
    expect(await settle(listImportableAdeqJobs())).toMatchObject({ code: "unavailable" });
    const ok = (await settle(listImportableAdeqJobs())) as Awaited<ReturnType<typeof listImportableAdeqJobs>>;
    expect(ok.rows).toHaveLength(1);
  });

  it("stops at 10 pages", async () => {
    mockWorkizGet.mockResolvedValue(page([], true));
    mockWorkizGet.mockImplementation(async () => page([rawJob()], true));
    await settle(listImportableAdeqJobs());
    expect(mockWorkizGet).toHaveBeenCalledTimes(10);
  });

  it("an empty page ends paging even when hasMore is true", async () => {
    mockWorkizGet.mockResolvedValueOnce(page([rawJob()], true)).mockResolvedValueOnce(page([], true));
    await settle(listImportableAdeqJobs());
    expect(mockWorkizGet).toHaveBeenCalledTimes(2);
  });

  it("gives up as unavailable at the 25 s overall deadline", async () => {
    mockWorkizGet.mockImplementation(
      (_path: string, _query: unknown, opts: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener("abort", () => reject(new WorkizError("unavailable")));
        }),
    );
    const outcome = listImportableAdeqJobs().catch((e) => e);
    await vi.advanceTimersByTimeAsync(LIST_DEADLINE_MS - 1);
    let settled = false;
    void outcome.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toMatchObject({ code: "unavailable" });
  });
});

describe("getCachedSummary", () => {
  it("hits after a listing and misses otherwise — without any network call", async () => {
    expect(getCachedSummary("JOB-AbCdEfGhIjKlMnOp")).toBeUndefined();
    mockWorkizGet.mockResolvedValue(page([rawJob()]));
    await settle(listImportableAdeqJobs());
    mockWorkizGet.mockClear();
    expect(getCachedSummary("JOB-AbCdEfGhIjKlMnOp")?.uuid).toBe("AB12CD");
    expect(getCachedSummary("JOB-Missing000000001")).toBeUndefined();
    expect(mockWorkizGet).not.toHaveBeenCalled();
  });
});

describe("getJob", () => {
  it("GETs /jobs/{encoded id} and accepts a bare job, {data: job} or {data: [job]}", async () => {
    for (const body of [rawJob(), { data: rawJob() }, { data: [rawJob()] }]) {
      mockWorkizGet.mockResolvedValueOnce(body);
      const job = await getJob("JOB-AbCdEfGhIjKlMnOp");
      expect(job.uuid).toBe("AB12CD");
    }
    expect(mockWorkizGet.mock.calls[0][0]).toBe("/jobs/JOB-AbCdEfGhIjKlMnOp");
    mockWorkizGet.mockResolvedValueOnce(rawJob());
    await getJob("JOB-a/b");
    expect(mockWorkizGet.mock.calls.at(-1)?.[0]).toBe("/jobs/JOB-a%2Fb");
  });

  it("an unparseable job → bad_response", async () => {
    mockWorkizGet.mockResolvedValueOnce({ data: [] });
    await expect(getJob("JOB-AbCdEfGhIjKlMnOp")).rejects.toMatchObject({ code: "bad_response" });
  });
});
