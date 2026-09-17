CREATE INDEX "payments_status_created_at_idx" ON "payments" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "registrations_created_at_idx" ON "registrations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "users_role_created_at_idx" ON "users" USING btree ("role","created_at");