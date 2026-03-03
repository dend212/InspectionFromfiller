CREATE TYPE "public"."app_role" AS ENUM('admin', 'field_tech', 'office_staff');--> statement-breakpoint
CREATE TYPE "public"."inspection_status" AS ENUM('draft', 'submitted', 'in_review', 'completed', 'sent');--> statement-breakpoint
CREATE TABLE "inspection_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspection_id" uuid NOT NULL,
	"recipient_email" text NOT NULL,
	"subject" text NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"sent_by" uuid
);
--> statement-breakpoint
CREATE TABLE "inspection_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspection_id" uuid NOT NULL,
	"type" text NOT NULL,
	"storage_path" text NOT NULL,
	"label" text,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspector_id" uuid NOT NULL,
	"status" "inspection_status" DEFAULT 'draft' NOT NULL,
	"facility_name" text,
	"facility_address" text,
	"facility_city" text,
	"facility_county" text,
	"facility_state" varchar(2) DEFAULT 'AZ',
	"facility_zip" varchar(10),
	"customer_email" text,
	"customer_name" text,
	"form_data" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"submitted_at" timestamp,
	"completed_at" timestamp,
	"review_notes" text,
	"finalized_pdf_path" text,
	"reviewed_by" uuid,
	"workiz_job_id" text,
	CONSTRAINT "inspections_workiz_job_id_unique" UNIQUE("workiz_job_id")
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" varchar(20),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"notification_settings" jsonb DEFAULT '{"emailOnSubmission":false}'::jsonb
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "user_roles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" uuid NOT NULL,
	"role" "app_role" NOT NULL,
	CONSTRAINT "user_roles_user_id_role_unique" UNIQUE("user_id","role")
);
--> statement-breakpoint
ALTER TABLE "inspection_emails" ADD CONSTRAINT "inspection_emails_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_emails" ADD CONSTRAINT "inspection_emails_sent_by_profiles_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_media" ADD CONSTRAINT "inspection_media_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_inspector_id_profiles_id_fk" FOREIGN KEY ("inspector_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_reviewed_by_profiles_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;