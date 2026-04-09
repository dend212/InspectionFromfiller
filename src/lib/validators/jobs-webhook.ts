import { z } from "zod";

/**
 * Zod schemas for the n8n-facing jobs webhook endpoints.
 *
 * Design rules:
 * - Payloads are FLAT, not deeply nested, so n8n Function / Set nodes can build
 *   them with minimal ceremony.
 * - Human-readable lookup keys (email, name) are preferred over UUIDs so the
 *   external CRM (Workiz, etc.) doesn't need to know Supabase primary keys.
 * - Every optional string defaults to "" instead of undefined so `.trim()`
 *   downstream is safe.
 */

// Shared sub-shapes ---------------------------------------------------------

const customerSchema = z
  .object({
    name: z.string().optional().default(""),
    email: z.string().optional().default(""),
    phone: z.string().optional().default(""),
  })
  .optional()
  .default({ name: "", email: "", phone: "" });

const addressSchema = z
  .object({
    street: z.string().optional().default(""),
    city: z.string().optional().default(""),
    state: z.string().optional().default("AZ"),
    zip: z.string().optional().default(""),
  })
  .optional()
  .default({ street: "", city: "", state: "AZ", zip: "" });

// POST /api/webhooks/jobs/create --------------------------------------------

export const jobsWebhookCreateSchema = z
  .object({
    externalId: z.string().min(1, "externalId is required"),
    title: z.string().min(1, "title is required"),

    // At least one must be provided — validated by .refine below.
    assignedToEmail: z.string().optional().default(""),
    assignedToName: z.string().optional().default(""),

    // Optional template selector. If both are provided, templateId wins.
    templateId: z.string().uuid().optional().nullable(),
    templateName: z.string().optional().default(""),

    customer: customerSchema,
    serviceAddress: addressSchema,

    // ISO 8601 timestamp, optional.
    scheduledFor: z.string().optional().default(""),
    // Pre-seed general notes the tech will see on the dashboard.
    initialNotes: z.string().optional().default(""),
  })
  .refine((v) => v.assignedToEmail.trim() || v.assignedToName.trim(), {
    message: "assignedToEmail or assignedToName is required",
    path: ["assignedToEmail"],
  });

export type JobsWebhookCreatePayload = z.infer<typeof jobsWebhookCreateSchema>;

// POST /api/webhooks/jobs/[externalId]/status -------------------------------

export const jobsWebhookStatusSchema = z.object({
  status: z.enum(["open", "in_progress", "completed"]),
  finalize: z.boolean().optional().default(false),
});

export type JobsWebhookStatusPayload = z.infer<typeof jobsWebhookStatusSchema>;
