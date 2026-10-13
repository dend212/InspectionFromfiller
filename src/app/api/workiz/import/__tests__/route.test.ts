import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockGetUserRole: vi.fn(),
  mockFind: vi.fn(),
  mockInsert: vi.fn(),
  mockLoadName: vi.fn(),
  mockGetJob: vi.fn(),
  mockGetCached: vi.fn(),
  mockCreateRun: vi.fn(),
  mockRunPrefill: vi.fn(),
  mockAfter: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({ auth: { getUser: h.mockGetUser } }),
}));
vi.mock("@/lib/supabase/auth-helpers", () => ({ getUserRole: h.mockGetUserRole }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/workiz/import-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workiz/import-store")>()),
  findInspectionsByWorkizIds: h.mockFind,
  insertImportedInspection: h.mockInsert,
  loadProfileFullName: h.mockLoadName,
}));
vi.mock("@/lib/workiz/adeq-jobs", () => ({ getJob: h.mockGetJob, getCachedSummary: h.mockGetCached }));
vi.mock("@/lib/prefill/run-store", () => ({ createRun: h.mockCreateRun }));
vi.mock("@/lib/prefill/run-prefill", () => ({ runPrefill: h.mockRunPrefill }));
// after() throws outside a request scope — replace it, keep NextResponse
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: h.mockAfter,
}));

import { WORKIZ_CF } from "@/lib/workiz/adeq";
import { WorkizError } from "@/lib/workiz/client";
import { cf, fixtures, job, withAddress } from "@/lib/workiz/__tests__/fixtures/jobs";
import { workizJobSchema } from "@/lib/workiz/schema";
import { maxDuration, POST } from "../route";

const USER = { id: "user-1", email: "tech@example.com", user_metadata: { full_name: "Meta Name" } };
const JOB_ID = "JOB-AbCdEfGhIjKlMnOp";
const PII = ["Test Client", "test.client@example.com", "100 E Example Rd"];
const OWN = { id: "insp-own", inspectorId: "user-1", status: "draft", workizJobId: "AB12CD" };
const OTHER = { id: "insp-other", inspectorId: "user-2", status: "draft", workizJobId: "AB12CD" };

const post = (body: unknown) =>
  new Request("http://localhost/api/workiz/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

/** Drizzle 0.45 DrizzleQueryError shape: PII in message + params, SQLSTATE on cause */
function drizzleError(cause: Record<string, unknown>) {
  return Object.assign(new Error(`Failed query: insert into "inspections" …\nparams: ${PII.join(",")}`), {
    query: 'insert into "inspections" …',
    params: [...PII],
    cause,
  });
}

let spies: Array<ReturnType<typeof vi.spyOn>> = [];
const consoleText = () => JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
const expectNoPiiLogged = () => {
  for (const value of PII) expect(consoleText()).not.toContain(value);
};

beforeEach(() => {
  vi.clearAllMocks();
  h.mockGetUser.mockResolvedValue({ data: { user: USER } });
  h.mockGetUserRole.mockResolvedValue("field_tech");
  h.mockFind.mockResolvedValue([]);
  h.mockGetCached.mockReturnValue(undefined);
  h.mockGetJob.mockResolvedValue(job());
  h.mockLoadName.mockResolvedValue("Sam Sample");
  h.mockInsert.mockResolvedValue("insp-new");
  h.mockCreateRun.mockResolvedValue("run-1");
  spies = (["error", "warn", "info", "log"] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => {}),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

it("exports maxDuration 300 (the run continues in after())", () => {
  expect(maxDuration).toBe(300);
});

describe("validation and auth", () => {
  it.each([["not json"], [{}], [{ jobId: "JOB-1" }], [{ jobId: "job-AbCdEfGh" }], [{ jobId: JOB_ID, extra: 1 }]])(
    "400 invalid_request for %j",
    async (body) => {
      const res = await POST(post(body));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "Invalid request", code: "invalid_request" });
      expect(h.mockGetJob).not.toHaveBeenCalled();
    },
  );

  it("401 when signed out", async () => {
    h.mockGetUser.mockResolvedValue({ data: { user: null } });
    expect((await POST(post({ jobId: JOB_ID }))).status).toBe(401);
  });

  it.each(["office_staff", null])("403 for role %s", async (role) => {
    h.mockGetUserRole.mockResolvedValue(role);
    expect((await POST(post({ jobId: JOB_ID }))).status).toBe(403);
    expect(h.mockGetJob).not.toHaveBeenCalled();
  });
});

describe("existing-job checks (spec §8.2)", () => {
  it("pre-check by the JOB- id → 200 without calling Workiz", async () => {
    h.mockFind.mockResolvedValueOnce([{ ...OWN, workizJobId: JOB_ID }]);
    const res = await POST(post({ jobId: JOB_ID }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ inspectionId: "insp-own", existing: true, status: "draft" });
    expect(h.mockFind.mock.calls[0][0]).toEqual([JOB_ID, undefined]);
    expect(h.mockGetJob).not.toHaveBeenCalled();
  });

  it("pre-check also matches the cached uuid", async () => {
    h.mockGetCached.mockReturnValue({ uuid: "AB12CD" });
    h.mockFind.mockResolvedValueOnce([OWN]);
    expect((await POST(post({ jobId: JOB_ID }))).status).toBe(200);
    expect(h.mockFind.mock.calls[0][0]).toEqual([JOB_ID, "AB12CD"]);
    expect(h.mockGetJob).not.toHaveBeenCalled();
  });

  it("409 for another inspector's import — and no inspection id in the body", async () => {
    h.mockFind.mockResolvedValueOnce([OTHER]);
    const res = await POST(post({ jobId: JOB_ID }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toEqual({ error: "This Workiz job was already imported by another inspector", code: "already_imported" });
    expect(JSON.stringify(body)).not.toContain("insp-other");
  });

  it("admins may open another inspector's import", async () => {
    h.mockGetUserRole.mockResolvedValue("admin");
    h.mockFind.mockResolvedValueOnce([OTHER]);
    expect(await (await POST(post({ jobId: JOB_ID }))).json()).toEqual({
      inspectionId: "insp-other",
      existing: true,
      status: "draft",
    });
  });

  it("post-fetch check by job.uuid ∪ job.id", async () => {
    h.mockFind.mockResolvedValueOnce([]).mockResolvedValueOnce([OWN]);
    expect((await POST(post({ jobId: JOB_ID }))).status).toBe(200);
    expect(h.mockFind.mock.calls[1][0]).toEqual(["AB12CD", JOB_ID]);
    expect(h.mockInsert).not.toHaveBeenCalled();
  });
});

describe("Workiz-side checks", () => {
  it("404 workiz_job_not_found", async () => {
    h.mockGetJob.mockRejectedValue(new WorkizError("not_found", 404));
    const res = await POST(post({ jobId: JOB_ID }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Workiz job not found", code: "workiz_job_not_found" });
  });

  it("Workiz rate limit → 503 workiz_rate_limited", async () => {
    h.mockGetJob.mockRejectedValue(new WorkizError("rate_limited", 429));
    const res = await POST(post({ jobId: JOB_ID }));
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("workiz_rate_limited");
  });

  it("422 not_adeq_job", async () => {
    h.mockGetJob.mockResolvedValue(workizJobSchema.parse(fixtures.nonAdeq()));
    const res = await POST(post({ jobId: JOB_ID }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "Only ADEQ inspection jobs can be imported", code: "not_adeq_job" });
  });

  it.each(["Canceled", "Submitted"])("422 not_importable for %s", async (status) => {
    h.mockGetJob.mockResolvedValue(job({ status }));
    const res = await POST(post({ jobId: JOB_ID }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "This Workiz job isn't ready to import", code: "not_importable" });
    expect(h.mockInsert).not.toHaveBeenCalled();
  });

  it("'Done' is accepted", async () => {
    h.mockGetJob.mockResolvedValue(workizJobSchema.parse(fixtures.done()));
    expect((await POST(post({ jobId: JOB_ID }))).status).toBe(201);
  });

  it("a job without a uuid → 502 workiz_bad_response, nothing inserted", async () => {
    h.mockGetJob.mockResolvedValue(workizJobSchema.parse(fixtures.emptyUuid()));
    const res = await POST(post({ jobId: JOB_ID }));
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("workiz_bad_response");
    expect(h.mockInsert).not.toHaveBeenCalled();
  });
});

describe("happy path", () => {
  it("inserts the draft (workiz_job_id = uuid, customer_name null) and starts the run in after()", async () => {
    const res = await POST(post({ jobId: JOB_ID }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      inspectionId: "insp-new",
      existing: false,
      prefill: { status: "started", runId: "run-1" },
    });
    const values = h.mockInsert.mock.calls[0][0];
    expect(values).toMatchObject({
      inspectorId: "user-1",
      status: "draft",
      workizJobId: "AB12CD",
      customerName: null,
      customerEmail: "test.client@example.com",
      facilityAddress: "100 E Example Rd",
      facilityCity: "Cave Creek",
      facilityZip: "85331",
      facilityCounty: null,
      facilityName: null,
      apn: null,
    });
    expect(values.formData.facilityInfo).toMatchObject({
      facilityAddress: "100 E Example Rd",
      inspectorName: "Sam Sample",
      sellerName: "",
    });
    expect(values.fieldProvenance["secondary.facilityInfo.sellerName"]).toMatchObject({ value: "Test Client" });
    expect(h.mockCreateRun).toHaveBeenCalledWith({
      inspectionId: "insp-new",
      trigger: "workiz_import",
      input: {
        address: expect.objectContaining({ streetNumber: "100", streetDir: "E", streetName: "Example Rd", zip: "85331" }),
        zipMustMatch: true,
      },
      createdBy: "user-1",
    });
    expect(h.mockAfter).toHaveBeenCalledTimes(1);
    await h.mockAfter.mock.calls[0][0]();
    expect(h.mockRunPrefill).toHaveBeenCalledWith("run-1");
    expectNoPiiLogged();
  });

  it("falls back to user_metadata.full_name for the inspector name", async () => {
    h.mockLoadName.mockResolvedValue(null);
    await POST(post({ jobId: JOB_ID }));
    expect(h.mockInsert.mock.calls[0][0].formData.facilityInfo.inspectorName).toBe("Meta Name");
  });

  it("logs a skipped custom field by id and reason only", async () => {
    h.mockGetJob.mockResolvedValue(job({ customFields: [cf(WORKIZ_CF.waterSource, "Municipal / Private Water Supply")] }));
    await POST(post({ jobId: JOB_ID }));
    expect(consoleText()).toContain(`[workiz-import] skip job=4696 field=${WORKIZ_CF.waterSource} reason=ambiguous`);
    expect(consoleText()).not.toContain("Municipal");
  });

  it("an unparseable address → 201 skipped, no run", async () => {
    h.mockGetJob.mockResolvedValue(workizJobSchema.parse(withAddress({ address: "Rural Route Box" })));
    const res = await POST(post({ jobId: JOB_ID }));
    expect(res.status).toBe(201);
    expect((await res.json()).prefill).toEqual({ status: "skipped", reason: "address_unparseable" });
    expect(h.mockCreateRun).not.toHaveBeenCalled();
    expect(h.mockAfter).not.toHaveBeenCalled();
  });
});

describe("DB failures stay PII-safe (spec §12)", () => {
  it("createRun throws → 201 failed, the inspection is kept, only the SQLSTATE is logged", async () => {
    h.mockCreateRun.mockRejectedValue(drizzleError({ code: "57014" }));
    const res = await POST(post({ jobId: JOB_ID }));
    expect(res.status).toBe(201);
    expect((await res.json()).prefill).toEqual({ status: "failed" });
    expect(h.mockInsert).toHaveBeenCalledTimes(1);
    expect(h.mockAfter).not.toHaveBeenCalled();
    expect(consoleText()).toContain("[workiz-import] db error scope=create_run job=4696 code=57014 constraint=-");
    expectNoPiiLogged();
  });

  it("INSERT throws (not unique) → 500 with a fixed message", async () => {
    h.mockInsert.mockRejectedValue(drizzleError({ code: "23502", constraint_name: "inspections_inspector_id_not_null" }));
    const res = await POST(post({ jobId: JOB_ID }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "Something went wrong", code: "internal" });
    expect(consoleText()).toContain(
      "[workiz-import] db error scope=insert job=4696 code=23502 constraint=inspections_inspector_id_not_null",
    );
    expectNoPiiLogged();
  });

  it("unique violation → re-select by uuid → 200 for the user's own import", async () => {
    h.mockInsert.mockRejectedValue(drizzleError({ code: "23505", constraint_name: "inspections_workiz_job_id_unique" }));
    h.mockFind.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([OWN]);
    const res = await POST(post({ jobId: JOB_ID }));
    expect(res.status).toBe(200);
    expect(h.mockFind.mock.calls[2][0]).toEqual(["AB12CD"]);
    expectNoPiiLogged();
  });

  it("unique violation for someone else's import → 409", async () => {
    h.mockInsert.mockRejectedValue(drizzleError({ code: "23505" }));
    h.mockFind.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([OTHER]);
    expect((await POST(post({ jobId: JOB_ID }))).status).toBe(409);
  });

  it("a DB error in the pre-check → 500, logged through logDbError", async () => {
    h.mockFind.mockRejectedValueOnce(drizzleError({ code: "08006" }));
    const res = await POST(post({ jobId: JOB_ID }));
    expect(res.status).toBe(500);
    expect(consoleText()).toContain("[workiz-import] db error scope=import job=- code=08006 constraint=-");
    expectNoPiiLogged();
  });
});
