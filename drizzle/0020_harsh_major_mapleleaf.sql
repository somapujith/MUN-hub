ALTER TABLE "mun_executive_board" ADD COLUMN "institution" text;--> statement-breakpoint
ALTER TABLE "mun_executive_board" ADD COLUMN "organization" text;--> statement-breakpoint
ALTER TABLE "mun_executive_board" ADD COLUMN "social_links" jsonb;--> statement-breakpoint
ALTER TABLE "mun_executive_board" ADD COLUMN "is_public" boolean DEFAULT true NOT NULL;--> statement-breakpoint