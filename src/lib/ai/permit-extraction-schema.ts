/**
 * Zod schema for the facts Claude extracts from a Maricopa ESD permit PDF.
 * Verbatim from docs/superpowers/plans/2026-09-11-prefill-shared-contracts.md;
 * `zodOutputFormat(PermitFactsSchema)` is what we hand to `messages.parse()`.
 */
import { z } from "zod";

const fact = <T extends z.ZodTypeAny>(v: T) =>
  z.object({
    value: v,
    confidence: z.number().min(0).max(1),
    page: z.number().int().positive(),
    evidence: z.string().max(300),
    handwritten: z.boolean(),
  });

export const PermitFactsSchema = z.object({
  permitNumber: fact(z.string()).nullable(),
  documentKind: z.enum([
    "approval_to_construct",
    "discharge_authorization",
    "final_da",
    "notice_of_transfer",
    "abandonment",
    "other",
  ]),
  issueDate: fact(z.string()).nullable(), // ISO yyyy-mm-dd
  finalDate: fact(z.string()).nullable(),
  contractor: fact(z.string()).nullable(),
  designFlowGpd: fact(z.number()).nullable(),
  bedrooms: fact(z.number().int()).nullable(),
  tanks: z.array(
    z.object({
      capacityGal: fact(z.number()).nullable(),
      material: fact(z.enum(["precast_concrete", "fiberglass", "plastic", "steel", "cast_in_place", "other"])).nullable(),
      model: fact(z.string()).nullable(),
      dimensions: fact(z.string()).nullable(),
    }),
  ),
  disposal: z.object({
    type: fact(z.enum(["trench", "bed", "chamber", "seepage_pit", "other"])).nullable(),
    count: fact(z.number().int()).nullable(),
    dimensions: fact(z.string()).nullable(),
    absorptionAreaSqft: fact(z.number()).nullable(),
  }),
  waterSource: fact(z.enum(["municipal", "private_company", "shared_well", "private_well", "hauled_water"])).nullable(),
  isCesspool: fact(z.boolean()).nullable(),
  isAbandonment: z.boolean(),
  hasSitePlan: fact(z.boolean()).nullable(),
  systemType: fact(z.enum(["conventional", "alternative"])).nullable(),
  notes: z.string().max(500),
});

export type PermitFacts = z.infer<typeof PermitFactsSchema>;
export type Fact<T> = { value: T; confidence: number; page: number; evidence: string; handwritten: boolean };
export type PermitDocumentKind = PermitFacts["documentKind"];

/**
 * Reply shape for a single-field escalation question on the stronger model.
 * `value` is always a string as written on the page; the caller coerces it
 * to the field's type (see permit-facts-utils.ts → coerceFactValue).
 */
export const EscalationAnswerSchema = z.object({
  found: z.boolean(),
  value: z.string(),
  confidence: z.number().min(0).max(1),
  evidence: z.string().max(300),
  handwritten: z.boolean(),
});

export type EscalationAnswer = z.infer<typeof EscalationAnswerSchema>;

/** A facts object with nothing found — what a pass that read nothing collapses to. */
export function emptyPermitFacts(): PermitFacts {
  return {
    permitNumber: null,
    documentKind: "other",
    issueDate: null,
    finalDate: null,
    contractor: null,
    designFlowGpd: null,
    bedrooms: null,
    tanks: [],
    disposal: { type: null, count: null, dimensions: null, absorptionAreaSqft: null },
    waterSource: null,
    isCesspool: null,
    isAbandonment: false,
    hasSitePlan: null,
    systemType: null,
    notes: "",
  };
}
