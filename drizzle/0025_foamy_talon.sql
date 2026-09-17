CREATE TYPE "public"."consent_type" AS ENUM('TERMS_OF_SERVICE', 'PRIVACY_POLICY', 'GUARDIAN_ACKNOWLEDGEMENT');--> statement-breakpoint
CREATE TABLE "user_consents" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"consent_type" "consent_type" NOT NULL,
	"policy_version" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "student_profiles" ADD COLUMN "gender" text;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD COLUMN "preferred_name" text;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD COLUMN "nationality" text;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD COLUMN "address_city" text;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD COLUMN "address_state" text;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD COLUMN "address_country" text;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD COLUMN "postal_code" text;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD COLUMN "alternate_mobile" text;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD COLUMN "course_or_program" text;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD COLUMN "graduation_year" integer;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD COLUMN "department" text;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD COLUMN "student_id" text;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD COLUMN "academic_email" text;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD COLUMN "alternate_emergency_contact_name" text;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD COLUMN "alternate_emergency_contact_number" text;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD COLUMN "alternate_emergency_contact_relation" text;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD COLUMN "has_prior_mun_experience" boolean;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD COLUMN "muns_attended_count" integer;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD COLUMN "previous_achievements" text;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD COLUMN "bio" text;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD COLUMN "areas_of_interest" text[];--> statement-breakpoint
ALTER TABLE "student_profiles" ADD COLUMN "languages" text[];--> statement-breakpoint
ALTER TABLE "student_profiles" ADD COLUMN "is_public_profile_visible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_consents" ADD CONSTRAINT "user_consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_consents_user_id_idx" ON "user_consents" USING btree ("user_id");