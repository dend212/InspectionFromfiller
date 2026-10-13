/**
 * SYNTHETIC Workiz jobs, shaped like the live v2 API (spec §13). Fake names, example.com
 * emails, 555-01xx phones, "Example" streets and 123-45-6xx APNs only — never paste real
 * Workiz data (or anything from a backup) into this file.
 */
import { WORKIZ_CF } from "@/lib/workiz/adeq";
import { type WorkizJob, workizJobSchema } from "@/lib/workiz/schema";

type Raw = Record<string, unknown>;

export const JOB_ID = "JOB-AbCdEfGhIjKlMnOp";
export const JOB_UUID = "AB12CD";
export const SERIAL = 4696;

export function rawJob(over: Raw = {}): Raw {
  return {
    id: JOB_ID,
    uuid: JOB_UUID,
    serialId: SERIAL,
    status: "done pending approval",
    subStatus: { id: "SS-test0001", name: "Job Complete - Reports Required" },
    jobType: { id: "JT-a5DbVzyREDgGvdWK", name: "ADEQ Septic Inspection " },
    date: "2026-10-06 12:00:00",
    latitude: -1,
    longitude: -1,
    description: "Synthetic test job",
    customFields: [],
    notes: [],
    team: [
      { id: 101, name: "Alex Tester" },
      { id: 102, name: "Sam Sample" },
    ],
    clientInfo: {
      firstName: "Test",
      lastName: "Client",
      companyName: "",
      email: "test.client@example.com",
      primaryPhone: "555-0100",
      secondaryPhone: "555-0101",
      addressDetails: {
        address: "100 E Example Rd",
        unit: "",
        city: "Cave Creek",
        state: "AZ",
        zipCode: "85331",
      },
    },
    ...over,
  };
}

export const job = (over: Raw = {}): WorkizJob => workizJobSchema.parse(rawJob(over));

export function withAddress(details: Raw, over: Raw = {}): Raw {
  const base = rawJob(over);
  const client = base.clientInfo as Raw;
  return {
    ...base,
    clientInfo: { ...client, addressDetails: { ...(client.addressDetails as Raw), ...details } },
  };
}

export function withClient(client: Raw, over: Raw = {}): Raw {
  const base = rawJob(over);
  return { ...base, clientInfo: { ...(base.clientInfo as Raw), ...client } };
}

/** `value` is `unknown` so tests can feed malformed values (objects) through the lenient schema */
export function cf(id: string, value: unknown, fieldName = "Synthetic field "): Raw {
  return { id, fieldName, value };
}

export const note = (text: string, timestamp: string): Raw => ({ note: text, timestamp });

/** The three live permit-bot note shapes (spec §5.3), plus variants */
export const BOT_NOTES = {
  grokHigh: note("Permit added by Grok Bot. Confidence high. APN 123-45-678, permit OW-00-00001 added.", "2026-10-01 09:00:00"),
  plainHighSuffix: note("Permit added. Confidence high. APN 123-45-678K, permit OW-00-00002 added.", "2026-10-02 09:00:00"),
  parenthesizedMedium: note("Permit added. Confidence medium, see file (APN 123-45-678Z, permit OW-00-00003).", "2026-10-03 09:00:00"),
  noConfidence: note("Permit added. APN 123-45-679, permit OW-00-00004.", "2026-10-04 09:00:00"),
  grokLow: note("Permit added by Grok Bot. Confidence low. APN 123-45-680, permit OW-00-00005.", "2026-10-05 09:00:00"),
  notABotNote: note("Customer called, APN 123-45-681 per county site.", "2026-10-09 09:00:00"),
};

export const CF_IDS = WORKIZ_CF;

export const fixtures = {
  importable: () => rawJob(),
  onlineBooking: () =>
    rawJob({
      id: "JOB-OnlineBooking00001",
      uuid: "OB12CD",
      serialId: 4700,
      jobType: { id: "JT-ly4RYx5nKd2z30dw", name: "ADEQ Inspection - Online Booking" },
    }),
  nonAdeq: () =>
    rawJob({
      id: "JOB-Pumping0000000001",
      uuid: "PU12CD",
      serialId: 4701,
      jobType: { id: "JT-pumping0000000001", name: "Septic Pumping" },
    }),
  submitted: () => rawJob({ status: "Submitted" }),
  canceled: () => rawJob({ status: "Canceled" }),
  done: () => rawJob({ status: "Done" }),
  unscheduled: () => rawJob({ id: "JOB-Unscheduled000001", uuid: "UN12CD", serialId: 4650, date: null }),
  noSubStatus: () => rawJob({ subStatus: null }),
  emptyUuid: () => rawJob({ uuid: "" }),
  lowercaseCity: () => withAddress({ address: "300 N Demo Ln", city: "laveen", zipCode: "85339" }),
  unit: () => withAddress({ unit: "12" }),
  emptyTeam: () => rawJob({ team: [] }),
  multiTeam: () =>
    rawJob({
      team: [
        { id: 1, name: " Alex Tester " },
        { id: 2, name: "Sam Sample" },
        { id: 3, name: "Alex Tester" },
        { id: 4, name: "" },
        { id: 5, name: "alex Other" },
      ],
    }),
  nonMaricopa: () => withAddress({ address: "123 W Main St", city: "Florence", zipCode: "85132" }),
};
