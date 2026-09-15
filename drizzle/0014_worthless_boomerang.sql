CREATE TYPE "public"."sla_state" AS ENUM('ON_TRACK', 'DUE_SOON', 'OVERDUE', 'PAUSED', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'QUEUED', 'PUBLISHED', 'WITHDRAWN');--> statement-breakpoint
CREATE TABLE "mun_submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"mun_id" text NOT NULL,
	"submitted_by" text NOT NULL,
	"version_number" integer NOT NULL,
	"status" "submission_status" DEFAULT 'SUBMITTED' NOT NULL,
	"progress_percentage" integer DEFAULT 0 NOT NULL,
	"submitted_at" timestamp with time zone,
	"review_started_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"queued_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"sla_deadline" timestamp with time zone NOT NULL,
	"sla_state" "sla_state" DEFAULT 'ON_TRACK' NOT NULL,
	"sla_paused_at" timestamp with time zone,
	"sla_paused_total_ms" integer DEFAULT 0 NOT NULL,
	"reviewer_id" text,
	"mun_version_id" text,
	"publish_idempotency_key" text,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mun_submissions" ADD CONSTRAINT "mun_submissions_mun_id_muns_id_fk" FOREIGN KEY ("mun_id") REFERENCES "public"."muns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mun_submissions" ADD CONSTRAINT "mun_submissions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mun_submissions" ADD CONSTRAINT "mun_submissions_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mun_submissions" ADD CONSTRAINT "mun_submissions_mun_version_id_mun_versions_id_fk" FOREIGN KEY ("mun_version_id") REFERENCES "public"."mun_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mun_submissions_mun_id_idx" ON "mun_submissions" USING btree ("mun_id");--> statement-breakpoint
CREATE INDEX "mun_submissions_sla_state_idx" ON "mun_submissions" USING btree ("sla_state");--> statement-breakpoint
CREATE INDEX "mun_submissions_status_idx" ON "mun_submissions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "mun_submissions_publish_idempotency_key_uq" ON "mun_submissions" USING btree ("publish_idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "mun_submissions_active_per_mun_uq" ON "mun_submissions" USING btree ("mun_id") WHERE status NOT IN ('PUBLISHED','REJECTED','WITHDRAWN');