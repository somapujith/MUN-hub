CREATE TABLE "student_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"date_of_birth" timestamp with time zone NOT NULL,
	"grade_or_year" text NOT NULL,
	"residential_address" text NOT NULL,
	"requires_transportation" boolean DEFAULT false NOT NULL,
	"emergency_contact_name" text NOT NULL,
	"emergency_contact_phone" text NOT NULL,
	"emergency_contact_relation" text NOT NULL,
	"mun_experience" text,
	"referral_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "student_profiles_user_id_idx" ON "student_profiles" USING btree ("user_id");