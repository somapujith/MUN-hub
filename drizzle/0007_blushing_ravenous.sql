DROP TABLE "refund_requests" CASCADE;--> statement-breakpoint
ALTER TABLE "admin_actions" ALTER COLUMN "action" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."admin_action";--> statement-breakpoint
CREATE TYPE "public"."admin_action" AS ENUM('ORGANIZER_SUSPENDED', 'ORGANIZER_REINSTATED', 'MUN_UNPUBLISHED', 'MUN_SUSPENDED', 'TICKET_ASSIGNED', 'TICKET_RESOLVED', 'USER_SUSPENDED');--> statement-breakpoint
ALTER TABLE "admin_actions" ALTER COLUMN "action" SET DATA TYPE "public"."admin_action" USING "action"::"public"."admin_action";--> statement-breakpoint
DROP TYPE "public"."refund_status";