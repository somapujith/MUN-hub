CREATE TYPE "public"."accommodation_field_type" AS ENUM('TEXT', 'NUMBER', 'DATE', 'DROPDOWN', 'CHECKBOX');--> statement-breakpoint
CREATE TABLE "accommodation_option_fields" (
	"id" text PRIMARY KEY NOT NULL,
	"option_id" text NOT NULL,
	"field_type" "accommodation_field_type" NOT NULL,
	"label" text NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"choices" jsonb,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accommodation_options" (
	"id" text PRIMARY KEY NOT NULL,
	"mun_id" text NOT NULL,
	"name" text NOT NULL,
	"price" integer NOT NULL,
	"capacity" integer NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "accommodation_option_id" text;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "accommodation_answers" jsonb;--> statement-breakpoint
ALTER TABLE "accommodation_option_fields" ADD CONSTRAINT "accommodation_option_fields_option_id_accommodation_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."accommodation_options"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accommodation_options" ADD CONSTRAINT "accommodation_options_mun_id_muns_id_fk" FOREIGN KEY ("mun_id") REFERENCES "public"."muns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accommodation_option_fields_option_id_idx" ON "accommodation_option_fields" USING btree ("option_id");--> statement-breakpoint
CREATE INDEX "accommodation_options_mun_id_idx" ON "accommodation_options" USING btree ("mun_id");--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_accommodation_option_id_accommodation_options_id_fk" FOREIGN KEY ("accommodation_option_id") REFERENCES "public"."accommodation_options"("id") ON DELETE no action ON UPDATE no action;