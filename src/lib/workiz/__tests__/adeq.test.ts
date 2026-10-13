import { describe, expect, it } from "vitest";
import {
  ADEQ_JOB_TYPE_IDS,
  canImportNow,
  isAdeqJob,
  isImportable,
  scheduledDateOf,
  teamFirstNames,
  teamNames,
  toJobSummary,
  WORKIZ_CF,
} from "@/lib/workiz/adeq";
import { WORKIZ_CF as LEAF_WORKIZ_CF } from "@/lib/workiz/custom-field-ids";
import { BOT_NOTES, cf, fixtures, job, withAddress } from "./fixtures/jobs";
import { workizJobSchema } from "@/lib/workiz/schema";

const parse = (raw: Record<string, unknown>) => workizJobSchema.parse(raw);

describe("constants", () => {
  it("pins the ADEQ job-type ids and custom-field ids (account-specific, spec §16)", () => {
    expect([...ADEQ_JOB_TYPE_IDS].sort()).toEqual(["JT-a5DbVzyREDgGvdWK", "JT-ly4RYx5nKd2z30dw"]);
    expect(WORKIZ_CF).toEqual({
      apn: "CF-nXNayb3y6x56kpwZ",
      waterSource: "CF-ypkPZr3dojlD9KnE",
      tankSize: "CF-mw5dG83Z9joVbYXE",
      effluentFilter: "CF-eWzopvxv6xPQglna",
      flowTestCompleted: "CF-JBDeg6xJWMlYV85W",
      tankRecommendation: "CF-p2ErD5xbe36Jl1XO",
      drainfieldRecommendation: "CF-y5W6qQMr9x1Rvld9",
      notableConcerns: "CF-2AblKqxDG3YeDga1",
      flowTestDescription: "CF-wlovONMYrjKBp4GE",
    });
  });
});

describe("isAdeqJob", () => {
  it("matches by job-type id or by a trimmed name starting with ADEQ", () => {
    expect(isAdeqJob(job())).toBe(true);
    expect(isAdeqJob(parse(fixtures.onlineBooking()))).toBe(true);
    expect(isAdeqJob(job({ jobType: { id: "JT-other000000000001", name: "  ADEQ Re-inspection" } }))).toBe(true);
    expect(isAdeqJob(parse(fixtures.nonAdeq()))).toBe(false);
    expect(isAdeqJob(job({ jobType: null }))).toBe(false);
  });
});

describe("isImportable (picker filter) — exact status match", () => {
  it("accepts only 'done pending approval' on an ADEQ job", () => {
    expect(isImportable(job())).toBe(true);
    for (const status of ["Done", "done", "Done pending approval", "Done Pending Approval", "Submitted"]) {
      expect(isImportable(job({ status }))).toBe(false);
    }
    expect(isImportable(parse(fixtures.nonAdeq()))).toBe(false);
  });
});

describe("canImportNow (import-time re-check)", () => {
  it("accepts 'done pending approval' and 'Done'; rejects Canceled, Submitted, done", () => {
    expect(canImportNow(job())).toBe(true);
    expect(canImportNow(parse(fixtures.done()))).toBe(true);
    expect(canImportNow(parse(fixtures.canceled()))).toBe(false);
    expect(canImportNow(parse(fixtures.submitted()))).toBe(false);
    expect(canImportNow(job({ status: "done" }))).toBe(false);
    expect(canImportNow({ ...parse(fixtures.nonAdeq()), status: "Done" })).toBe(false);
  });
});

describe("summary helpers", () => {
  it("scheduledDateOf slices YYYY-MM-DD and rejects anything else", () => {
    expect(scheduledDateOf(job())).toBe("2026-10-06");
    expect(scheduledDateOf(parse(fixtures.unscheduled()))).toBeNull();
    expect(scheduledDateOf(job({ date: "10/06/2026" }))).toBeNull();
  });

  it("teamNames trims, drops empties and de-duplicates; teamFirstNames de-duplicates case-insensitively", () => {
    const multi = parse(fixtures.multiTeam());
    expect(teamNames(multi)).toEqual(["Alex Tester", "Sam Sample", "alex Other"]);
    expect(teamFirstNames(multi)).toEqual(["Alex", "Sam"]);
    expect(teamFirstNames(parse(fixtures.emptyTeam()))).toEqual([]);
  });

  it("toJobSummary carries only summary fields", () => {
    expect(toJobSummary(parse(fixtures.unit()))).toEqual({
      id: "JOB-AbCdEfGhIjKlMnOp",
      uuid: "AB12CD",
      serialId: 4696,
      street: "100 E Example Rd #12",
      city: "Cave Creek",
      scheduledDate: "2026-10-06",
      subStatus: "Job Complete - Reports Required",
      teamFirstNames: ["Alex", "Sam"],
      zip: "85331",
      apnHint: null,
    });
    const lower = toJobSummary(parse(fixtures.lowercaseCity()));
    expect(lower.city).toBe("Laveen");
    expect(toJobSummary(parse(fixtures.noSubStatus())).subStatus).toBeNull();
    expect(JSON.stringify(toJobSummary(job()))).not.toMatch(/Test Client|example\.com|555-01/);
  });

  it("toJobSummary adds the server-side zip (5 digits, ZIP+4 → first 5, invalid → null)", () => {
    expect(toJobSummary(job()).zip).toBe("85331");
    expect(toJobSummary(parse(withAddress({ zipCode: "85331-1234" }))).zip).toBe("85331");
    expect(toJobSummary(parse(withAddress({ zipCode: "8533" }))).zip).toBeNull();
    expect(toJobSummary(parse(withAddress({ zipCode: "" }))).zip).toBeNull();
  });

  it("toJobSummary adds the apnHint: custom field, else newest bot note, else null", () => {
    expect(toJobSummary(job({ customFields: [cf(WORKIZ_CF.apn, "12345670")] })).apnHint).toBe("123-45-670");
    expect(toJobSummary(job({ notes: [BOT_NOTES.grokHigh, BOT_NOTES.noConfidence] })).apnHint).toBe("123-45-679");
    expect(toJobSummary(job()).apnHint).toBeNull();
  });
});

describe("WORKIZ_CF leaf module", () => {
  it("adeq re-exports the very same object", () => {
    expect(WORKIZ_CF).toBe(LEAF_WORKIZ_CF);
  });
});
