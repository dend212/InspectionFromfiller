import { relations } from "drizzle-orm";
import {
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
});

// Inspection media (photos and videos)
export const inspectionMedia = pgTable("inspection_media", {
  id: uuid("id").defaultRandom().primaryKey(),
  inspectionId: uuid("inspection_id")
    .references(() => inspections.id, { onDelete: "cascade" })
    .notNull(),
  type: text("type").notNull(), // 'photo' or 'video'
  storagePath: text("storage_path").notNull(),
  label: text("label"), // e.g., 'Septic Tank Lid', 'Distribution Box'
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

// Relations
export const profilesRelations = relations(profiles, ({ many }) => ({
  inspections: many(inspections),
  roles: many(userRoles),
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
