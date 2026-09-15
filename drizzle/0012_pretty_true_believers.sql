CREATE TYPE "public"."eb_role" AS ENUM('CHAIR', 'VICE_CHAIR', 'DIRECTOR', 'RAPPORTEUR', 'CUSTOM');--> statement-breakpoint
CREATE TYPE "public"."form_field_type" AS ENUM('SHORT_TEXT', 'LONG_TEXT', 'EMAIL', 'PHONE', 'NUMBER', 'DROPDOWN', 'MULTIPLE_CHOICE', 'CHECKBOX', 'DATE', 'FILE_UPLOAD', 'INSTITUTION', 'ACADEMIC_YEAR', 'MUN_EXPERIENCE', 'COMMITTEE_PREFERENCE', 'PORTFOLIO_PREFERENCE', 'EMERGENCY_CONTACT');--> statement-breakpoint
CREATE TYPE "public"."mun_document_kind" AS ENUM('RULES', 'CODE_OF_CONDUCT', 'REFUND_POLICY', 'BROCHURE', 'HANDBOOK', 'DELEGATE_GUIDE', 'POSITION_PAPER', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."mun_media_kind" AS ENUM('LOGO', 'COVER', 'GALLERY', 'SPONSOR', 'ORGANIZER_LOGO');--> statement-breakpoint
CREATE TYPE "public"."payment_verification_state" AS ENUM('NOT_SUBMITTED', 'PENDING', 'VERIFIED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."schedule_item_kind" AS ENUM('OPENING_CEREMONY', 'COMMITTEE_SESSION', 'BREAK', 'LUNCH', 'CRISIS', 'CLOSING_CEREMONY', 'AWARDS', 'OTHER');--> statement-breakpoint
CREATE TABLE "mun_contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"mun_id" text NOT NULL,
	"official_email" text NOT NULL,
	"phone" text,
	"website" text,
	"social_links" jsonb,
	"contact_person_name" text NOT NULL,
	"contact_person_role" text,
	"contact_person_email" text NOT NULL,
	"contact_person_phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mun_contacts_mun_id_unique" UNIQUE("mun_id")
);
--> statement-breakpoint
CREATE TABLE "mun_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"mun_id" text NOT NULL,
	"kind" "mun_document_kind" NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mun_executive_board" (
	"id" text PRIMARY KEY NOT NULL,
	"mun_id" text NOT NULL,
	"committee_id" text,
	"name" text NOT NULL,
	"role" "eb_role" NOT NULL,
	"custom_role" text,
	"photo_url" text,
	"bio" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mun_form_fields" (
	"id" text PRIMARY KEY NOT NULL,
	"mun_id" text NOT NULL,
	"field_key" text NOT NULL,
	"field_type" "form_field_type" NOT NULL,
	"label" text NOT NULL,
	"help_text" text,
	"required" boolean DEFAULT false NOT NULL,
	"choices" jsonb,
	"display_order" integer DEFAULT 0 NOT NULL,
	"conditional_on" text,
	"conditional_operator" text,
	"conditional_value" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mun_media" (
	"id" text PRIMARY KEY NOT NULL,
	"mun_id" text NOT NULL,
	"kind" "mun_media_kind" NOT NULL,
	"url" text NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mun_payment_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"mun_id" text NOT NULL,
	"legal_name" text NOT NULL,
	"org_type" text NOT NULL,
	"address_line1" text NOT NULL,
	"address_line2" text,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"postal_code" text NOT NULL,
	"pan_last4" text NOT NULL,
	"pan_ciphertext" text NOT NULL,
	"gstin" text,
	"authorized_rep_name" text NOT NULL,
	"authorized_rep_email" text NOT NULL,
	"account_holder_name" text NOT NULL,
	"bank_name" text NOT NULL,
	"account_number_last4" text NOT NULL,
	"account_number_ciphertext" text NOT NULL,
	"ifsc" text NOT NULL,
	"account_type" text NOT NULL,
	"gateway" text NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"refund_policy" text,
	"settlement_notes" text,
	"verification_state" "payment_verification_state" DEFAULT 'NOT_SUBMITTED' NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mun_payment_settings_mun_id_unique" UNIQUE("mun_id")
);
--> statement-breakpoint
CREATE TABLE "mun_schedule_items" (
	"id" text PRIMARY KEY NOT NULL,
	"mun_id" text NOT NULL,
	"committee_id" text,
	"title" text NOT NULL,
	"kind" "schedule_item_kind" NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"location" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mun_contacts" ADD CONSTRAINT "mun_contacts_mun_id_muns_id_fk" FOREIGN KEY ("mun_id") REFERENCES "public"."muns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mun_documents" ADD CONSTRAINT "mun_documents_mun_id_muns_id_fk" FOREIGN KEY ("mun_id") REFERENCES "public"."muns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mun_executive_board" ADD CONSTRAINT "mun_executive_board_mun_id_muns_id_fk" FOREIGN KEY ("mun_id") REFERENCES "public"."muns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mun_executive_board" ADD CONSTRAINT "mun_executive_board_committee_id_committees_id_fk" FOREIGN KEY ("committee_id") REFERENCES "public"."committees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mun_form_fields" ADD CONSTRAINT "mun_form_fields_mun_id_muns_id_fk" FOREIGN KEY ("mun_id") REFERENCES "public"."muns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mun_media" ADD CONSTRAINT "mun_media_mun_id_muns_id_fk" FOREIGN KEY ("mun_id") REFERENCES "public"."muns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mun_payment_settings" ADD CONSTRAINT "mun_payment_settings_mun_id_muns_id_fk" FOREIGN KEY ("mun_id") REFERENCES "public"."muns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mun_payment_settings" ADD CONSTRAINT "mun_payment_settings_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mun_schedule_items" ADD CONSTRAINT "mun_schedule_items_mun_id_muns_id_fk" FOREIGN KEY ("mun_id") REFERENCES "public"."muns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mun_schedule_items" ADD CONSTRAINT "mun_schedule_items_committee_id_committees_id_fk" FOREIGN KEY ("committee_id") REFERENCES "public"."committees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mun_contacts_mun_id_idx" ON "mun_contacts" USING btree ("mun_id");--> statement-breakpoint
CREATE INDEX "mun_documents_mun_id_idx" ON "mun_documents" USING btree ("mun_id");--> statement-breakpoint
CREATE INDEX "mun_executive_board_mun_id_idx" ON "mun_executive_board" USING btree ("mun_id");--> statement-breakpoint
CREATE INDEX "mun_form_fields_mun_id_idx" ON "mun_form_fields" USING btree ("mun_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mun_form_fields_mun_key_uq" ON "mun_form_fields" USING btree ("mun_id","field_key");--> statement-breakpoint
CREATE INDEX "mun_media_mun_id_idx" ON "mun_media" USING btree ("mun_id");--> statement-breakpoint
CREATE INDEX "mun_payment_settings_mun_id_idx" ON "mun_payment_settings" USING btree ("mun_id");--> statement-breakpoint
CREATE INDEX "mun_schedule_items_mun_id_idx" ON "mun_schedule_items" USING btree ("mun_id");