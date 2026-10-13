import { describe, expect, it } from "vitest";
import { parseWorkizJob, serialIdForLog, workizJobsPageSchema } from "@/lib/workiz/schema";
import { cf, fixtures, rawJob, withAddress } from "./fixtures/jobs";

describe("workizJobSchema (lenient boundary, spec §7.3)", () => {
  it("parses the live job shape and keeps unknown fields (passthrough)", () => {
    const job = parseWorkizJob(rawJob());
    expect(job).toMatchObject({
      id: "JOB-AbCdEfGhIjKlMnOp",
      uuid: "AB12CD",
      serialId: 4696,
      status: "done pending approval",
      subStatus: { name: "Job Complete - Reports Required" },
      jobType: { id: "JT-a5DbVzyREDgGvdWK" },
      date: "2026-10-06 12:00:00",
      clientInfo: { firstName: "Test", addressDetails: { city: "Cave Creek", zipCode: "85331" } },
    });
    expect((job as Record<string, unknown>).latitude).toBe(-1);
  });

  it("defaults missing arrays, null subStatus/date, and a missing clientInfo", () => {
    const job = parseWorkizJob({ id: "JOB-Minimal0000000001" });
    expect(job).toMatchObject({
      uuid: "",
      serialId: null,
      status: "",
      subStatus: null,
      jobType: null,
      date: null,
      customFields: [],
      notes: [],
      team: [],
      clientInfo: { firstName: "", email: "", addressDetails: { address: "", zipCode: "" } },
    });
  });

  it("coerces numeric zip/ids to strings and serialId strings to numbers", () => {
    const job = parseWorkizJob(withAddress({ zipCode: 85331 }, { serialId: "4696", team: [{ id: 7, name: "Sam Sample" }] }));
    expect(job?.clientInfo.addressDetails.zipCode).toBe("85331");
    expect(job?.serialId).toBe(4696);
    expect(job?.team[0].id).toBe("7");
  });

  it("normalises custom-field values: string/boolean kept, number → string, anything else → null", () => {
    const job = parseWorkizJob(
      rawJob({ customFields: [cf("CF-a", "Yes"), cf("CF-b", true), cf("CF-c", 1500), cf("CF-d", { x: 1 }), cf("CF-e", null)] }),
    );
    expect(job?.customFields.map((f) => f.value)).toEqual(["Yes", true, "1500", null, null]);
  });

  it("accepts a subStatus given as a plain string", () => {
    expect(parseWorkizJob(rawJob({ subStatus: "Job Complete" }))?.subStatus).toEqual({ id: "", name: "Job Complete" });
  });

  it("rejects a non-object or an item without an id", () => {
    expect(parseWorkizJob("nope")).toBeNull();
    expect(parseWorkizJob({ ...fixtures.importable(), id: "" })).toBeNull();
    expect(parseWorkizJob({ serialId: 1 })).toBeNull();
  });

  it("serialIdForLog never returns more than the serial", () => {
    expect(serialIdForLog(rawJob())).toBe("4696");
    expect(serialIdForLog({ serialId: "Test Client" })).toBe("?");
    expect(serialIdForLog(null)).toBe("?");
  });
});

describe("workizJobsPageSchema", () => {
  it("needs a data array; hasMore defaults to false", () => {
    expect(workizJobsPageSchema.safeParse({ data: [], page: 1 }).data?.hasMore).toBe(false);
    expect(workizJobsPageSchema.safeParse({ data: "x" }).success).toBe(false);
  });
});
