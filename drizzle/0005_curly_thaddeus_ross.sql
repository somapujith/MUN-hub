CREATE TYPE "public"."admin_action" AS ENUM('ORGANIZER_SUSPENDED', 'ORGANIZER_REINSTATED', 'MUN_UNPUBLISHED', 'MUN_SUSPENDED', 'REFUND_APPROVED', 'REFUND_REJECTED', 'TICKET_ASSIGNED', 'TICKET_RESOLVED', 'USER_SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('REQUESTED', 'APPROVED', 'REJECTED', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."support_category" AS ENUM('REGISTRATION', 'PAYMENT', 'REFUND', 'MUN_INFO', 'ACCOUNT', 'CERTIFICATE', 'ORGANIZER', 'TECHNICAL', 'SAFETY_POLICY');--> statement-breakpoint
CREATE TYPE "public"."support_priority" AS ENUM('LOW', 'NORMAL', 'HIGH', 'URGENT');--> statement-breakpoint
CREATE TYPE "public"."support_status" AS ENUM('NEW', 'ASSIGNED', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED');--> statement-breakpoint
ALTER TYPE "public"."mun_status" ADD VALUE 'SUSPENDED';--> statement-breakpoint
CREATE TABLE "admin_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text NOT NULL,
	"action" "admin_action" NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"reason" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refund_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"registration_id" text NOT NULL,
	"payment_id" text NOT NULL,
	"requested_by" text NOT NULL,
	"reason" text NOT NULL,
	"amount" integer NOT NULL,
	"status" "refund_status" DEFAULT 'REQUESTED' NOT NULL,
	"approver_id" text,
	"approved_at" timestamp with time zone,
	"provider_refund_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"created_by" text NOT NULL,
	"category" "support_category" NOT NULL,
	"priority" "support_priority" DEFAULT 'NORMAL' NOT NULL,
	"status" "support_status" DEFAULT 'NEW' NOT NULL,
	"subject" text NOT NULL,
	"description" text NOT NULL,
	"assigned_to" text,
	"related_registration_id" text,
	"related_mun_id" text,
	"resolution_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "suspended" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "suspended_reason" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "admin_actions" ADD CONSTRAINT "admin_actions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_approver_id_users_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_related_registration_id_registrations_id_fk" FOREIGN KEY ("related_registration_id") REFERENCES "public"."registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_related_mun_id_muns_id_fk" FOREIGN KEY ("related_mun_id") REFERENCES "public"."muns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_actions_target_idx" ON "admin_actions" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "admin_actions_actor_id_idx" ON "admin_actions" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "refund_requests_registration_id_idx" ON "refund_requests" USING btree ("registration_id");--> statement-breakpoint
CREATE INDEX "refund_requests_status_idx" ON "refund_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "support_tickets_status_idx" ON "support_tickets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "support_tickets_assigned_to_idx" ON "support_tickets" USING btree ("assigned_to");