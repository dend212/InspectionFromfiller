import { relations } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// Role enum matching Supabase custom claims
export const appRoleEnum = pgEnum("app_role", ["admin", "field_tech", "office_staff"]);

// Inspection status enum
export const inspectionStatusEnum = pgEnum("inspection_status", [
  "draft",
  "submitted",
  "in_review",
  "completed",
  "sent",
]);

// User profiles (extends Supabase auth.users)
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(), // matches auth.users.id
  fullName: text("full_name").notNull(),
  email: text("email").notNull(),
  phone: varchar("phone", { length: 20 }),
  signatureDataUrl: text("signature_data_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  notificationSettings: jsonb("notification_settings").default({ emailOnSubmission: false }),
});

// User roles table (used by Custom Access Token Hook)
export const userRoles = pgTable(
  "user_roles",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    userId: uuid("user_id")
      .references(() => profiles.id, { onDelete: "cascade" })
      .notNull(),
    role: appRoleEnum("role").notNull(),
  },
  (table) => [unique("user_roles_user_id_role_unique").on(table.userId, table.role)],
);

// Inspections table
export const inspections = pgTable("inspections", {
  id: uuid("id").defaultRandom().primaryKey(),
  inspectorId: uuid("inspector_id")
    .references(() => profiles.id)
    .notNull(),
  status: inspectionStatusEnum("status").default("draft").notNull(),
  // Facility info
  facilityName: text("facility_name"),
  facilityAddress: text("facility_address"),
  facilityCity: text("facility_city"),
  facilityCounty: text("facility_county"),
  facilityState: varchar("facility_state", { length: 2 }).default("AZ"),
  facilityZip: varchar("facility_zip", { length: 10 }),
  // Customer contact info (denormalized for dashboard/email)
  customerEmail: text("customer_email"),
  customerName: text("customer_name"),
  // Form data stored as JSONB for flexibility during early development
  formData: jsonb("form_data"),
  // Timestamps
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  submittedAt: timestamp("submitted_at"),
  completedAt: timestamp("completed_at"),
  // Review workflow columns
  reviewNotes: text("review_notes"),
  finalizedPdfPath: text("finalized_pdf_path"),
  reviewedBy: uuid("reviewed_by").references(() => profiles.id),
  // External integration (Workiz via n8n)
  workizJobId: text("workiz_job_id").unique(),
  apn: text("apn"),
});

// Inspection media (photos and videos)
export const inspectionMedia = pgTable("inspection_media", {
  id: uuid("id").defaultRandom().primaryKey(),
  inspectionId: uuid("inspection_id")
    .references(() => inspections.id, { onDelete: "cascade" })
    .notNull(),
  type: text("type").notNull(), // 'photo' or 'video'
  storagePath: text("storage_path").notNull(),
  label: text("label"), // section key, e.g., 'septic-tank', 'facility-info'
  description: text("description"), // user-provided caption shown in PDF
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Inspection email send history
export const inspectionEmails = pgTable("inspection_emails", {
  id: uuid("id").defaultRandom().primaryKey(),
  inspectionId: uuid("inspection_id")
    .references(() => inspections.id, { onDelete: "cascade" })
    .notNull(),
  recipientEmail: text("recipient_email").notNull(),
  subject: text("subject").notNull(),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
  sentBy: uuid("sent_by").references(() => profiles.id),
});

// Inspection summary pages (public tokenized URLs)
export const inspectionSummaries = pgTable("inspection_summaries", {
  id: uuid("id").defaultRandom().primaryKey(),
  inspectionId: uuid("inspection_id")
    .references(() => inspections.id, { onDelete: "cascade" })
    .notNull(),
  token: varchar("token", { length: 32 }).notNull().unique(),
  recommendations: text("recommendations").notNull(),
  createdBy: uuid("created_by").references(() => profiles.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
});

// Relations
export const profilesRelations = relations(profiles, ({ many }) => ({
  inspections: many(inspections),
  roles: many(userRoles),
  assignedJobs: many(jobs, { relationName: "jobs_assignee" }),
  createdJobs: many(jobs, { relationName: "jobs_creator" }),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  profile: one(profiles, {
    fields: [userRoles.userId],
    references: [profiles.id],
  }),
}));

export const inspectionsRelations = relations(inspections, ({ one, many }) => ({
  inspector: one(profiles, {
    fields: [inspections.inspectorId],
    references: [profiles.id],
  }),
  media: many(inspectionMedia),
  emails: many(inspectionEmails),
  summaries: many(inspectionSummaries),
}));

export const inspectionMediaRelations = relations(inspectionMedia, ({ one }) => ({
  inspection: one(inspections, {
    fields: [inspectionMedia.inspectionId],
    references: [inspections.id],
  }),
}));

export const inspectionEmailsRelations = relations(inspectionEmails, ({ one }) => ({
  inspection: one(inspections, {
    fields: [inspectionEmails.inspectionId],
    references: [inspections.id],
  }),
  sender: one(profiles, {
    fields: [inspectionEmails.sentBy],
    references: [profiles.id],
  }),
}));

export const inspectionSummariesRelations = relations(inspectionSummaries, ({ one }) => ({
  inspection: one(inspections, {
    fields: [inspectionSummaries.inspectionId],
    references: [inspections.id],
  }),
  creator: one(profiles, {
    fields: [inspectionSummaries.createdBy],
    references: [profiles.id],
  }),
}));

// =========================================================================
// Jobs Module — general (non-ADEQ) service visits and pump jobs
// =========================================================================

// Job status enum — simpler flow than inspections
export const jobStatusEnum = pgEnum("job_status", ["open", "in_progress", "completed"]);

// Discriminator for job media — either attached to a checklist item or general
export const jobMediaBucketEnum = pgEnum("job_media_bucket", ["checklist_item", "general"]);

// Checklist templates (admin-managed library)
export const checklistTemplates = pgTable("checklist_templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  createdBy: uuid("created_by").references(() => profiles.id),
  archivedAt: timestamp("archived_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Items inside a checklist template
export const checklistTemplateItems = pgTable("checklist_template_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  templateId: uuid("template_id")
    .references(() => checklistTemplates.id, { onDelete: "cascade" })
    .notNull(),
  title: text("title").notNull(),
  instructions: text("instructions"),
  requiredPhotoCount: integer("required_photo_count").default(0).notNull(),
  requiresNote: boolean("requires_note").default(false).notNull(),
  isRequired: boolean("is_required").default(true).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Jobs — top-level record for a general service visit
export const jobs = pgTable("jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  assignedTo: uuid("assigned_to")
    .references(() => profiles.id)
    .notNull(),
  createdBy: uuid("created_by").references(() => profiles.id),
  status: jobStatusEnum("status").default("open").notNull(),
  title: text("title").notNull(),
  // Customer + service address (simplified vs. inspections)
  customerName: text("customer_name"),
  customerEmail: text("customer_email"),
  customerPhone: varchar("customer_phone", { length: 20 }),
  serviceAddress: text("service_address"),
  city: text("city"),
  state: varchar("state", { length: 2 }).default("AZ"),
  zip: varchar("zip", { length: 10 }),
  // Notes
  generalNotes: text("general_notes"),
  customerSummary: text("customer_summary"), // AI-generated final paragraph
  // Template traceability (informational; snapshot in job_checklist_items is authoritative)
  sourceTemplateId: uuid("source_template_id").references(() => checklistTemplates.id),
  // External idempotency key for webhook-created jobs (e.g. Workiz job id forwarded by n8n).
  // Nullable + partial unique index in SQL so dashboard-created jobs don't need one.
  externalId: text("external_id"),
  // PDF artifacts
  finalizedPdfPath: text("finalized_pdf_path"),
  customerPdfPath: text("customer_pdf_path"),
  // Scheduling + lifecycle timestamps
  scheduledFor: timestamp("scheduled_for"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Per-job snapshot of checklist items — edits here never touch the template
export const jobChecklistItems = pgTable("job_checklist_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  jobId: uuid("job_id")
    .references(() => jobs.id, { onDelete: "cascade" })
    .notNull(),
  title: text("title").notNull(),
  instructions: text("instructions"),
  requiredPhotoCount: integer("required_photo_count").default(0).notNull(),
  requiresNote: boolean("requires_note").default(false).notNull(),
  isRequired: boolean("is_required").default(true).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  // "pending" | "done" | "skipped" — plain text to avoid another enum
  status: text("status").default("pending").notNull(),
  note: text("note"),
  completedAt: timestamp("completed_at"),
  completedBy: uuid("completed_by").references(() => profiles.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Media attached to a job — either pinned to a checklist item or a general bucket
export const jobMedia = pgTable("job_media", {
  id: uuid("id").defaultRandom().primaryKey(),
  jobId: uuid("job_id")
    .references(() => jobs.id, { onDelete: "cascade" })
    .notNull(),
  checklistItemId: uuid("checklist_item_id").references(() => jobChecklistItems.id, {
    onDelete: "cascade",
  }),
  bucket: jobMediaBucketEnum("bucket").notNull(),
  type: text("type").notNull(), // "photo" | "video" (photo-only at launch)
  storagePath: text("storage_path").notNull(),
  description: text("description"),
  // Only meaningful for general-bucket rows; checklist rows always render as visible
  visibleToCustomer: boolean("visible_to_customer").default(true).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  uploadedBy: uuid("uploaded_by").references(() => profiles.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Public tokenized customer-facing summary pages for jobs
export const jobSummaries = pgTable("job_summaries", {
  id: uuid("id").defaultRandom().primaryKey(),
  jobId: uuid("job_id")
    .references(() => jobs.id, { onDelete: "cascade" })
    .notNull(),
  token: varchar("token", { length: 32 }).notNull().unique(),
  customerSummary: text("customer_summary").notNull(),
  createdBy: uuid("created_by").references(() => profiles.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
});

// Relations
export const checklistTemplatesRelations = relations(checklistTemplates, ({ one, many }) => ({
  creator: one(profiles, {
    fields: [checklistTemplates.createdBy],
    references: [profiles.id],
  }),
  items: many(checklistTemplateItems),
}));

export const checklistTemplateItemsRelations = relations(checklistTemplateItems, ({ one }) => ({
  template: one(checklistTemplates, {
    fields: [checklistTemplateItems.templateId],
    references: [checklistTemplates.id],
  }),
}));

export const jobsRelations = relations(jobs, ({ one, many }) => ({
  assignee: one(profiles, {
    fields: [jobs.assignedTo],
    references: [profiles.id],
    relationName: "jobs_assignee",
  }),
  creator: one(profiles, {
    fields: [jobs.createdBy],
    references: [profiles.id],
    relationName: "jobs_creator",
  }),
  sourceTemplate: one(checklistTemplates, {
    fields: [jobs.sourceTemplateId],
    references: [checklistTemplates.id],
  }),
  checklistItems: many(jobChecklistItems),
  media: many(jobMedia),
  summaries: many(jobSummaries),
}));

export const jobChecklistItemsRelations = relations(jobChecklistItems, ({ one, many }) => ({
  job: one(jobs, {
    fields: [jobChecklistItems.jobId],
    references: [jobs.id],
  }),
  completer: one(profiles, {
    fields: [jobChecklistItems.completedBy],
    references: [profiles.id],
  }),
  media: many(jobMedia),
}));

export const jobMediaRelations = relations(jobMedia, ({ one }) => ({
  job: one(jobs, {
    fields: [jobMedia.jobId],
    references: [jobs.id],
  }),
  checklistItem: one(jobChecklistItems, {
    fields: [jobMedia.checklistItemId],
    references: [jobChecklistItems.id],
  }),
  uploader: one(profiles, {
    fields: [jobMedia.uploadedBy],
    references: [profiles.id],
  }),
}));

export const jobSummariesRelations = relations(jobSummaries, ({ one }) => ({
  job: one(jobs, {
    fields: [jobSummaries.jobId],
    references: [jobs.id],
  }),
  creator: one(profiles, {
    fields: [jobSummaries.createdBy],
    references: [profiles.id],
  }),
}));
