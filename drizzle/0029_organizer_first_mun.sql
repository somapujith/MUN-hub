ALTER TABLE "organizer_profiles" ADD COLUMN "mun_name" text;--> statement-breakpoint
ALTER TABLE "organizer_profiles" ADD COLUMN "mun_city" text;--> statement-breakpoint
ALTER TABLE "organizer_profiles" ADD COLUMN "mun_start_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizer_profiles" ADD COLUMN "expected_delegate_count" integer;--> statement-breakpoint
ALTER TABLE "organizer_profiles" ADD COLUMN "mun_description" text;--> statement-breakpoint
ALTER TABLE "organizer_profiles" ADD COLUMN "previous_editions" text;--> statement-breakpoint
ALTER TABLE "organizer_profiles" ADD COLUMN "website_url" text;--> statement-breakpoint
ALTER TABLE "organizer_profiles" ADD COLUMN "first_mun_id" text;--> statement-breakpoint
ALTER TABLE "organizer_profiles" ADD CONSTRAINT "organizer_profiles_first_mun_id_muns_id_fk" FOREIGN KEY ("first_mun_id") REFERENCES "public"."muns"("id") ON DELETE set null ON UPDATE no action;