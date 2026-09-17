CREATE TYPE "public"."registration_group_invitation_status" AS ENUM('PENDING', 'ACCEPTED', 'EXPIRED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "registration_group_invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"registration_id" text NOT NULL,
	"email" text NOT NULL,
	"invited_name" text,
	"token_hash" text NOT NULL,
	"status" "registration_group_invitation_status" DEFAULT 'PENDING' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "registration_group_invitations_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "registration_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"mun_id" text NOT NULL,
	"registration_product_id" text NOT NULL,
	"head_user_id" text NOT NULL,
	"head_registration_id" text,
	"team_size" integer NOT NULL,
	"payment_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "registration_group_id" text;--> statement-breakpoint
ALTER TABLE "registration_group_invitations" ADD CONSTRAINT "registration_group_invitations_group_id_registration_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."registration_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_group_invitations" ADD CONSTRAINT "registration_group_invitations_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_groups" ADD CONSTRAINT "registration_groups_mun_id_muns_id_fk" FOREIGN KEY ("mun_id") REFERENCES "public"."muns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_groups" ADD CONSTRAINT "registration_groups_registration_product_id_registration_products_id_fk" FOREIGN KEY ("registration_product_id") REFERENCES "public"."registration_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_groups" ADD CONSTRAINT "registration_groups_head_user_id_users_id_fk" FOREIGN KEY ("head_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_groups" ADD CONSTRAINT "registration_groups_head_registration_id_registrations_id_fk" FOREIGN KEY ("head_registration_id") REFERENCES "public"."registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_groups" ADD CONSTRAINT "registration_groups_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "registration_group_invitations_group_id_idx" ON "registration_group_invitations" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "registration_group_invitations_registration_id_idx" ON "registration_group_invitations" USING btree ("registration_id");--> statement-breakpoint
CREATE INDEX "registration_groups_mun_id_idx" ON "registration_groups" USING btree ("mun_id");--> statement-breakpoint
CREATE INDEX "registration_groups_head_user_id_idx" ON "registration_groups" USING btree ("head_user_id");--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_registration_group_id_registration_groups_id_fk" FOREIGN KEY ("registration_group_id") REFERENCES "public"."registration_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "registrations_registration_group_id_idx" ON "registrations" USING btree ("registration_group_id");