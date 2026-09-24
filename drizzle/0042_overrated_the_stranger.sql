CREATE INDEX "achievements_user_id_verification_status_idx" ON "achievements" USING btree ("user_id","verification_status");--> statement-breakpoint
CREATE INDEX "achievements_mun_id_created_at_idx" ON "achievements" USING btree ("mun_id","created_at");--> statement-breakpoint
CREATE INDEX "certificates_user_id_created_at_idx" ON "certificates" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "certificates_mun_id_created_at_idx" ON "certificates" USING btree ("mun_id","created_at");