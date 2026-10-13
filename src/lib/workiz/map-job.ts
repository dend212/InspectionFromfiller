import { z } from "zod";
import { formatFullAddress, parseStreetAddress, prefillAddressSchema } from "@/lib/prefill/input";
import { fieldProvenanceSchema } from "@/lib/prefill/provenance-schema";
import { secondaryKey } from "@/lib/prefill/secondary";
import type { FieldProvenance, PrefillInput, ProvenanceEntry, ProvenanceValue } from "@/lib/prefill/types";
import { getDefaultFormValues } from "@/lib/validators/inspection";
import { scheduledDateOf, teamNames, WORKIZ_CF } from "./adeq";
import { findApnHint } from "./apn-hint";
import {
  formatWorkizCity,
  formatWorkizStreet,
  formatWorkizZip,
  type MapResult,
  mapCondition,
  mapEffluentFilter,
  mapFlowTestCompleted,
  mapFreeText,
  mapTankSize,
  mapWaterSource,
  type SkipReason,
} from "./custom-fields";
import type { WorkizJob } from "./schema";

/**
 * Pure: Workiz job → everything POST /api/workiz/import writes (spec §5.1). The address is a
 * primary fill AND a same-value secondary chip; every other value is a secondary chip only
 * (`secondary.<path>`, never written to formData). No logging here — callers log `skips`
 * (field ids + reason codes, never values).
 */

export const WORKIZ_ADDRESS_CONFIDENCE = 0.9;
const TEAM_MAX_CHARS = 200;
const EVIDENCE_VALUE_MAX_CHARS = 200;
const emailSchema = z.string().trim().max(254).email();

export type WorkizSkipReason = SkipReason | "non_az_state";

export interface WorkizSkip {
  /** A custom-field id or "addressDetails.state" — never a value */
  field: string;
  reason: WorkizSkipReason;
}

export type ImportFormData = ReturnType<typeof getDefaultFormValues>;

export interface ImportPlan {
  formData: ImportFormData;
  fieldProvenance: FieldProvenance;
  columns: {
    facilityAddress: string | null;
    facilityCity: string | null;
    facilityZip: string | null;
    customerEmail: string | null;
    workizJobId: string;
  };
  /** null → the street could not be parsed: the draft is created without a prefill run */
  prefillInput: PrefillInput | null;
  skips: WorkizSkip[];
}

interface CustomFieldRule {
  id: string;
  label: string;
  path: string;
  confidence: number;
  map: (raw: string) => MapResult;
  /** Enum answers quote the Workiz option as evidence; free text does not (the value is the text) */
  evidence: boolean;
}

const CUSTOM_FIELD_RULES: CustomFieldRule[] = [
  { id: WORKIZ_CF.waterSource, label: "Water Source", path: "facilityInfo.waterSource", confidence: 0.85, map: mapWaterSource, evidence: true },
  { id: WORKIZ_CF.tankSize, label: "Tank Size", path: "septicTank.tanks.0.tankCapacity", confidence: 0.85, map: mapTankSize, evidence: true },
  { id: WORKIZ_CF.effluentFilter, label: "Has Effluent Filter", path: "septicTank.tanks.0.effluentFilterPresent", confidence: 0.85, map: mapEffluentFilter, evidence: true },
  { id: WORKIZ_CF.flowTestCompleted, label: "Flow Test Completed", path: "disposalWorks.hydraulicLoadTestPerformed", confidence: 0.85, map: mapFlowTestCompleted, evidence: true },
  { id: WORKIZ_CF.tankRecommendation, label: "Tank Recommendation", path: "facilityInfo.septicTankCondition", confidence: 0.85, map: mapCondition, evidence: true },
  { id: WORKIZ_CF.drainfieldRecommendation, label: "Drainfield Recommendation", path: "facilityInfo.disposalWorksCondition", confidence: 0.85, map: mapCondition, evidence: true },
  { id: WORKIZ_CF.notableConcerns, label: "Notable Concerns", path: "septicTank.septicTankComments", confidence: 0.8, map: (raw) => mapFreeText(raw, { dropNoneAnswers: true }), evidence: false },
  { id: WORKIZ_CF.flowTestDescription, label: "Flow Test Description", path: "disposalWorks.disposalWorksComments", confidence: 0.8, map: (raw) => mapFreeText(raw), evidence: false },
];

function buildPrefillInput(rawAddress: string, city: string, zip: string | null): PrefillInput | null {
  const parsed = parseStreetAddress(formatWorkizStreet(rawAddress, ""));
  if (!parsed) return null;
  const address = { ...parsed, ...(city ? { city } : {}), ...(zip ? { zip } : {}) };
  const checked = prefillAddressSchema.safeParse({ ...address, full: formatFullAddress(address) });
  if (!checked.success) return null;
  return { address: checked.data, ...(zip ? { zipMustMatch: true } : {}) };
}

export function mapJobToImportPlan(
  job: WorkizJob,
  opts: { inspectorName: string; now?: string },
): ImportPlan {
  const now = opts.now ?? new Date().toISOString();
  const n = job.serialId ?? "?";
  const formData = getDefaultFormValues(opts.inspectorName);
  const fieldProvenance: FieldProvenance = {};
  const skips: WorkizSkip[] = [];

  const suggestion = (
    value: ProvenanceValue,
    confidence: number,
    explanation: string,
    evidence?: string,
  ): ProvenanceEntry => ({
    source: "workiz",
    state: "suggested",
    kind: "fill",
    value,
    confidence,
    explanation,
    ...(evidence ? { evidence } : {}),
    at: now,
  });
  const chip = (path: string, value: ProvenanceValue, confidence: number, explanation: string, evidence?: string): void => {
    fieldProvenance[secondaryKey(path)] = suggestion(value, confidence, explanation, evidence);
  };

  // Address: primary fill (the run's starting point) + same-value chip (survives the assessor's replacement)
  const details = job.clientInfo.addressDetails;
  const street = formatWorkizStreet(details.address, details.unit);
  const city = formatWorkizCity(details.city);
  const zip = formatWorkizZip(details.zipCode);
  const addressExplanation = `Workiz job #${n} · service address`;
  const fillAddress = (path: string, value: string): void => {
    fieldProvenance[path] = { ...suggestion(value, WORKIZ_ADDRESS_CONFIDENCE, addressExplanation), state: "prefilled" };
    chip(path, value, WORKIZ_ADDRESS_CONFIDENCE, addressExplanation);
  };
  if (street) {
    formData.facilityInfo.facilityAddress = street;
    fillAddress("facilityInfo.facilityAddress", street);
  }
  if (city) {
    formData.facilityInfo.facilityCity = city;
    fillAddress("facilityInfo.facilityCity", city);
  }
  if (zip) {
    formData.facilityInfo.facilityZip = zip;
    fillAddress("facilityInfo.facilityZip", zip);
  }
  const state = details.state.trim();
  if (state && !/^(az|arizona)$/i.test(state)) skips.push({ field: "addressDetails.state", reason: "non_az_state" });
  formData.facilityInfo.facilityState = "AZ";
  // County is left blank on purpose: the assessor fills Maricopa at 1.0; ~3% of jobs are elsewhere (§5.4)

  const scheduled = scheduledDateOf(job);
  if (scheduled) {
    chip("facilityInfo.dateOfInspection", scheduled, 0.9, `Workiz scheduled date (job #${n})`, `date: ${job.date}`);
  }

  const client = job.clientInfo;
  const person = `${client.firstName} ${client.lastName}`.replace(/\s+/g, " ").trim();
  const clientName = person || client.companyName.replace(/\s+/g, " ").trim();
  if (clientName) chip("facilityInfo.sellerName", clientName, 0.6, `Workiz client (job #${n})`);

  const team = teamNames(job).join(", ").slice(0, TEAM_MAX_CHARS).replace(/[,\s]+$/, "");
  if (team) chip("facilityInfo.employeeName", team, 0.8, `Workiz team (job #${n})`);

  const { hint, customFieldInvalid } = findApnHint(job);
  if (customFieldInvalid) skips.push({ field: WORKIZ_CF.apn, reason: "invalid_apn" });
  if (hint) {
    const explanation =
      hint.source === "custom_field"
        ? `Workiz APN field (job #${n})`
        : `Workiz note — permit bot, confidence ${hint.noteConfidence === "unstated" ? "not stated" : hint.noteConfidence} (job #${n})`;
    chip("facilityInfo.taxParcelNumber", hint.apn, hint.confidence, explanation, `APN ${hint.apn}`);
  }

  for (const rule of CUSTOM_FIELD_RULES) {
    const field = job.customFields.find((f) => f.id === rule.id);
    if (!field || typeof field.value === "boolean") continue; // absent, or a checkbox field
    const raw = field.value ?? "";
    const result = rule.map(raw);
    if (!result.ok) {
      skips.push({ field: rule.id, reason: result.reason });
      continue;
    }
    const evidence = rule.evidence ? `${rule.label}: "${raw.trim().slice(0, EVIDENCE_VALUE_MAX_CHARS)}"` : undefined;
    chip(rule.path, result.value, rule.confidence, `Workiz job #${n} · ${rule.label}`, evidence);
  }

  const email = emailSchema.safeParse(client.email);
  return {
    formData,
    fieldProvenance,
    columns: {
      facilityAddress: street || null,
      facilityCity: city || null,
      facilityZip: zip,
      customerEmail: email.success ? email.data : null,
      workizJobId: job.uuid,
    },
    prefillInput: buildPrefillInput(details.address, city, zip),
    skips,
  };
}

/** Validates entry by entry; an entry that fails is dropped (the caller logs its path) */
export function sanitizeProvenance(map: FieldProvenance): { map: FieldProvenance; dropped: string[] } {
  const out: FieldProvenance = {};
  const dropped: string[] = [];
  for (const [path, entry] of Object.entries(map)) {
    if (fieldProvenanceSchema.safeParse({ [path]: entry }).success) out[path] = entry;
    else dropped.push(path);
  }
  return { map: out, dropped };
}
