ALTER TYPE "public"."consent_type" ADD VALUE 'ORGANIZER_AGREEMENT';--> statement-breakpoint
CREATE TABLE "organizer_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"first_name" text,
	"last_name" text,
	"contact_phone" text,
	"pan_name" text,
	"pan_last4" text,
	"pan_ciphertext" text,
	"has_gstin" boolean,
	"gstin" text,
	"upi_id" text,
	"upi_phone" text,
	"agreement_version" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizer_profiles" ADD CONSTRAINT "organizer_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;