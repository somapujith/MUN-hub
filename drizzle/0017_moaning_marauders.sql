ALTER TABLE "registration_products" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "registration_products" ADD COLUMN "allows_individual" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "registration_products" ADD COLUMN "allows_delegation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "registration_products" ADD COLUMN "display_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "registration_products" ADD COLUMN "eligibility" jsonb;