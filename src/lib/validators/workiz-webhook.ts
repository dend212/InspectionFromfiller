import { z } from "zod";

export const workizWebhookSchema = z.object({
  client: z.object({
    firstName: z.string().min(1, "Client first name is required"),
    lastName: z.string().min(1, "Client last name is required"),
    email: z.string().email().optional().default(""),
    phone: z.string().optional().default(""),
  }),
  address: z.object({
    street: z.string().min(1, "Street address is required"),
    city: z.string().optional().default(""),
    state: z.string().optional().default("AZ"),
    zip: z.string().optional().default(""),
    county: z.string().optional().default(""),
  }),
  job: z
    .object({
      jobId: z.string().optional().default(""),
      jobType: z.string().optional().default(""),
      serviceType: z.string().optional().default(""),
      scheduledDate: z.string().optional().default(""),
    })
    .optional()
    .default({
      jobId: "",
      jobType: "",
      serviceType: "",
      scheduledDate: "",
    }),
  tech: z.object({
    email: z.string().email("Tech email is required for assignment"),
    name: z.string().optional().default(""),
  }),
});

export type WorkizWebhookPayload = z.infer<typeof workizWebhookSchema>;
