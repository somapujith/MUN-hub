CREATE INDEX "mun_module_verifications_state_idx" ON "mun_module_verifications" USING btree ("state");--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status");