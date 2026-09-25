ALTER TYPE "public"."admin_action" ADD VALUE 'ORGANIZER_PAYOUT_VERIFIED';--> statement-breakpoint
ALTER TABLE "organizer_profiles" ADD COLUMN "payout_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizer_profiles" ADD COLUMN "payout_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizer_profiles" ADD COLUMN "payout_verified_by" text;--> statement-breakpoint
ALTER TABLE "organizer_profiles" ADD COLUMN "payment_gateway" text;--> statement-breakpoint
ALTER TABLE "organizer_profiles" ADD CONSTRAINT "organizer_profiles_payout_verified_by_users_id_fk" FOREIGN KEY ("payout_verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;