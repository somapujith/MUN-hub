CREATE TABLE "payment_webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text,
	"provider_order_id" text,
	"payload_sha256" text NOT NULL,
	"outcome" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "currency" text DEFAULT 'INR' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "platform_fee_amount" integer;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "platform_fee_tax_amount" integer;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "organizer_net_amount" integer;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "exception_reason" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "exception_raised_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "exception_resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "exception_resolved_by" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "exception_resolution_note" text;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_webhook_events_provider_event_id_uq" ON "payment_webhook_events" USING btree ("provider","event_id");--> statement-breakpoint
CREATE INDEX "payment_webhook_events_order_idx" ON "payment_webhook_events" USING btree ("provider_order_id");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_exception_resolved_by_users_id_fk" FOREIGN KEY ("exception_resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_exception_open_idx" ON "payments" USING btree ("exception_raised_at") WHERE "payments"."exception_reason" is not null and "payments"."exception_resolved_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "registrations_user_idempotency_key_uq" ON "registrations" USING btree ("user_id","idempotency_key") WHERE "registrations"."idempotency_key" is not null;