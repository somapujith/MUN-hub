CREATE TYPE "public"."module_verification_state" AS ENUM('NOT_SUBMITTED', 'PENDING_REVIEW', 'VERIFIED', 'CHANGES_REQUESTED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."mun_module" AS ENUM('mun_details', 'committees', 'portfolios', 'registration_products');--> statement-breakpoint
CREATE TYPE "public"."verification_severity" AS ENUM('BLOCKER', 'HIGH', 'MEDIUM', 'LOW');--> statement-breakpoint
CREATE TABLE "mun_module_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"mun_id" text NOT NULL,
	"module_name" "mun_module" NOT NULL,
	"state" "module_verification_state" DEFAULT 'NOT_SUBMITTED' NOT NULL,
	"organizer_confirmed_at" timestamp with time zone,
	"last_reviewed_at" timestamp with time zone,
	"last_reviewed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mun_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"mun_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"snapshot_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizer_confirmations" (
	"id" text PRIMARY KEY NOT NULL,
	"mun_id" text NOT NULL,
	"confirming_user_id" text NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version_number" integer NOT NULL,
	"snapshot_json" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_issues" (
	"id" text PRIMARY KEY NOT NULL,
	"mun_id" text NOT NULL,
	"module_name" "mun_module" NOT NULL,
	"severity" "verification_severity" NOT NULL,
	"reason" text NOT NULL,
	"previous_value" text,
	"new_value" text,
	"resolved" boolean DEFAULT false NOT NULL,
	"raised_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "mun_version_id" text;--> statement-breakpoint
ALTER TABLE "mun_module_verifications" ADD CONSTRAINT "mun_module_verifications_mun_id_muns_id_fk" FOREIGN KEY ("mun_id") REFERENCES "public"."muns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mun_module_verifications" ADD CONSTRAINT "mun_module_verifications_last_reviewed_by_users_id_fk" FOREIGN KEY ("last_reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mun_versions" ADD CONSTRAINT "mun_versions_mun_id_muns_id_fk" FOREIGN KEY ("mun_id") REFERENCES "public"."muns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizer_confirmations" ADD CONSTRAINT "organizer_confirmations_mun_id_muns_id_fk" FOREIGN KEY ("mun_id") REFERENCES "public"."muns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizer_confirmations" ADD CONSTRAINT "organizer_confirmations_confirming_user_id_users_id_fk" FOREIGN KEY ("confirming_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_issues" ADD CONSTRAINT "verification_issues_mun_id_muns_id_fk" FOREIGN KEY ("mun_id") REFERENCES "public"."muns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_issues" ADD CONSTRAINT "verification_issues_raised_by_users_id_fk" FOREIGN KEY ("raised_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mun_module_verifications_mun_id_idx" ON "mun_module_verifications" USING btree ("mun_id");--> statement-breakpoint
CREATE INDEX "mun_versions_mun_id_idx" ON "mun_versions" USING btree ("mun_id");--> statement-breakpoint
CREATE INDEX "organizer_confirmations_mun_id_idx" ON "organizer_confirmations" USING btree ("mun_id");--> statement-breakpoint
CREATE INDEX "verification_issues_mun_id_idx" ON "verification_issues" USING btree ("mun_id");--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_mun_version_id_mun_versions_id_fk" FOREIGN KEY ("mun_version_id") REFERENCES "public"."mun_versions"("id") ON DELETE no action ON UPDATE no action;