import { z } from "zod";

/**
 * Lenient zod schema for the Workiz v2 job fields we read (spec §7.3). Everything optional with
 * safe defaults; unknown fields pass through (z.looseObject). Never logs values.
 */

/** string | number | null | undefined → string ("" when absent) */
const text = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((value) => (value == null ? "" : String(value)));

const namedRef = z.union([
  z.looseObject({ id: text, name: text }),
  z.string().transform((name) => ({ id: "", name })),
]);

const customFieldValue = z
  .unknown()
  .transform((value): string | boolean | null => {
    if (typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    return null;
  });

const EMPTY_ADDRESS = { address: "", unit: "", city: "", state: "", zipCode: "" };

const addressDetailsSchema = z
  .looseObject({ address: text, unit: text, city: text, state: text, zipCode: text })
  .nullish()
  .transform((value) => value ?? { ...EMPTY_ADDRESS });

const clientInfoSchema = z
  .looseObject({
    firstName: text,
    lastName: text,
    companyName: text,
    email: text,
    addressDetails: addressDetailsSchema,
  })
  .nullish()
  .transform(
    (value) =>
      value ?? { firstName: "", lastName: "", companyName: "", email: "", addressDetails: { ...EMPTY_ADDRESS } },
  );

const list = <T extends z.ZodType>(item: T) =>
  z
    .array(item)
    .nullish()
    .transform((value) => value ?? []);

export const workizJobSchema = z.looseObject({
  id: z.string().min(1),
  uuid: text.transform((value) => value.trim()),
  serialId: z
    .union([z.number().int(), z.string().regex(/^\d+$/).transform(Number)])
    .nullish()
    .transform((value) => value ?? null),
  status: text,
  subStatus: namedRef.nullish().transform((value) => value ?? null),
  jobType: namedRef.nullish().transform((value) => value ?? null),
  date: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
  customFields: list(z.looseObject({ id: z.string(), fieldName: text, value: customFieldValue })),
  notes: list(z.looseObject({ note: text, timestamp: text })),
  team: list(z.looseObject({ id: text, name: text })),
  clientInfo: clientInfoSchema,
});

export type WorkizJob = z.output<typeof workizJobSchema>;

export const workizJobsPageSchema = z.looseObject({
  data: z.array(z.unknown()),
  hasMore: z
    .boolean()
    .nullish()
    .transform((value) => value ?? false),
  page: z.number().nullish(),
  pageSize: z.number().nullish(),
  totalResults: z.number().nullish(),
});

export function parseWorkizJob(raw: unknown): WorkizJob | null {
  const result = workizJobSchema.safeParse(raw);
  return result.success ? result.data : null;
}

/** For logs only: the serial when it is numeric, else "?" — never any other job text */
export function serialIdForLog(raw: unknown): string {
  const serial = raw && typeof raw === "object" ? (raw as { serialId?: unknown }).serialId : undefined;
  return typeof serial === "number" || (typeof serial === "string" && /^\d{1,10}$/.test(serial))
    ? String(serial)
    : "?";
}
