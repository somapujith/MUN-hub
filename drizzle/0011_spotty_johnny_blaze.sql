ALTER TABLE "committees" ADD COLUMN "committee_type" text;--> statement-breakpoint
ALTER TABLE "committees" ADD COLUMN "portfolios_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "mun_module_verifications" ADD COLUMN "completion_status" "module_completion_status" DEFAULT 'NOT_STARTED' NOT NULL;--> statement-breakpoint
ALTER TABLE "mun_module_verifications" ADD COLUMN "is_required" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "mun_module_verifications" ADD COLUMN "completion_percentage" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "mun_module_verifications" ADD COLUMN "blocking_issue_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "mun_module_verifications" ADD COLUMN "last_computed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mun_module_verifications" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "muns" ADD COLUMN "conference_type" text;--> statement-breakpoint
ALTER TABLE "muns" ADD COLUMN "target_participant_type" text;--> statement-breakpoint
ALTER TABLE "muns" ADD COLUMN "address_line1" text;--> statement-breakpoint
ALTER TABLE "muns" ADD COLUMN "address_state" text;--> statement-breakpoint
ALTER TABLE "muns" ADD COLUMN "postal_code" text;--> statement-breakpoint
ALTER TABLE "muns" ADD COLUMN "map_url" text;--> statement-breakpoint
ALTER TABLE "muns" ADD COLUMN "registration_opens_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "muns" ADD COLUMN "registration_deadline" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "muns" ADD COLUMN "accommodation_provided" text;--> statement-breakpoint
ALTER TABLE "portfolios" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "portfolios" ADD COLUMN "restrictions" text;--> statement-breakpoint
ALTER TABLE "registration_products" ADD COLUMN "registration_type" text;--> statement-breakpoint
ALTER TABLE "registration_products" ADD COLUMN "early_bird_price" integer;--> statement-breakpoint
ALTER TABLE "registration_products" ADD COLUMN "early_bird_deadline" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "verification_issues" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "verification_issues" ADD COLUMN "field_key" text;--> statement-breakpoint
ALTER TABLE "verification_issues" ADD COLUMN "source" text DEFAULT 'REVIEWER' NOT NULL;--> statement-breakpoint
-- Dedupe before constraining (Task 3, 2026-09-14). The pre-existing
-- getModuleVerificationState lazy-create was read-then-insert with no lock,
-- so concurrent first-touches could have already created duplicate
-- (mun_id, module_name) rows. For each such pair, keep the oldest row
-- (earliest created_at) and delete the rest via a self-join.
DELETE FROM "mun_module_verifications" a
USING "mun_module_verifications" b
WHERE a.mun_id = b.mun_id
  AND a.module_name = b.module_name
  AND (a.created_at > b.created_at
       OR (a.created_at = b.created_at AND a.id > b.id));--> statement-breakpoint
CREATE UNIQUE INDEX "mun_module_verifications_mun_module_uq" ON "mun_module_verifications" USING btree ("mun_id","module_name");--> statement-breakpoint
CREATE INDEX "verification_issues_mun_module_resolved_idx" ON "verification_issues" USING btree ("mun_id","module_name","resolved");
