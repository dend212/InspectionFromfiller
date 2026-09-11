import { z } from "zod";

/** The form has ~150 fields; 500 leaves room for per-tank array fields */
export const MAX_PROVENANCE_ENTRIES = 500;

/** Rendered as <a href> in the badge popover — only https:// and our own /api/ paths, never javascript:/data:/http: */
export function isSafeSourceUrl(url: string): boolean {
  return url.startsWith("https://") || url.startsWith("/api/");
}

const sourceUrlSchema = z
  .string()
  .max(2048)
  .refine(isSafeSourceUrl, {
    message: "sourceUrl must start with https:// or /api/",
  });

export const provenanceValueSchema = z.union([
  z.string().max(5000),
  z.boolean(),
  z.array(z.string().max(500)).max(100),
]);

export const provenanceEntrySchema = z.object({
  source: z.enum(["assessor", "permit", "listing", "scan"]),
  state: z.enum(["prefilled", "suggested", "edited", "verified"]),
  kind: z.enum(["fill", "warning"]),
  value: provenanceValueSchema,
  confidence: z.number().min(0).max(1),
  explanation: z.string().max(500),
  evidence: z.string().max(1000).optional(),
  sourceUrl: sourceUrlSchema.optional(),
  recordId: z.string().max(64).optional(),
  page: z.number().int().positive().optional(),
  runId: z.string().max(64).optional(),
  at: z.string().max(40),
});

/** Keys are react-hook-form dotted paths: "facilityInfo.waterSource", "septicTank.tanks.0.tankCapacity" */
const fieldPathKeySchema = z
  .string()
  .max(120)
  .regex(/^[A-Za-z][A-Za-z0-9_.]*$/, "Invalid field path");

export const fieldProvenanceSchema = z
  .record(fieldPathKeySchema, provenanceEntrySchema)
  .refine((map) => Object.keys(map).length <= MAX_PROVENANCE_ENTRIES, {
    message: `At most ${MAX_PROVENANCE_ENTRIES} provenance entries`,
  });

export const provenancePatchBodySchema = z.object({
  fieldProvenance: fieldProvenanceSchema,
});

export type ProvenancePatchBody = z.infer<typeof provenancePatchBodySchema>;
