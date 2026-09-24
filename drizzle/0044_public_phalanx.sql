ALTER TYPE "public"."admin_action" ADD VALUE 'REGISTRATION_CANCELLED';--> statement-breakpoint
ALTER TYPE "public"."admin_action" ADD VALUE 'REGISTRATION_FLAGGED_DUPLICATE';--> statement-breakpoint
ALTER TYPE "public"."admin_action" ADD VALUE 'REGISTRATION_DUPLICATE_FLAG_CLEARED';--> statement-breakpoint
ALTER TYPE "public"."admin_action" ADD VALUE 'REGISTRATION_CONFIRMATION_RESENT';--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "flagged_duplicate_at" timestamp with time zone;