ALTER TYPE "public"."admin_action" ADD VALUE 'PAYMENT_EXCEPTION_RESOLVED';--> statement-breakpoint
ALTER TYPE "public"."admin_action" ADD VALUE 'STAFF_CREATED';--> statement-breakpoint
ALTER TYPE "public"."admin_action" ADD VALUE 'STAFF_ROLE_CHANGED';--> statement-breakpoint
ALTER TYPE "public"."admin_action" ADD VALUE 'STAFF_SUSPENDED';--> statement-breakpoint
ALTER TYPE "public"."admin_action" ADD VALUE 'STAFF_REINSTATED';--> statement-breakpoint
ALTER TYPE "public"."admin_action" ADD VALUE 'STAFF_SET_PASSWORD_LINK_ISSUED';--> statement-breakpoint
ALTER TYPE "public"."admin_action" ADD VALUE 'STAFF_MFA_RESET';--> statement-breakpoint
ALTER TYPE "public"."admin_action" ADD VALUE 'SUPER_ADMIN_BOOTSTRAPPED';--> statement-breakpoint
ALTER TYPE "public"."admin_action" ADD VALUE 'PII_READ';--> statement-breakpoint
ALTER TYPE "public"."admin_action" ADD VALUE 'ACCOUNT_DELETED';--> statement-breakpoint
-- Data cleanup: MUN Hub has no refunds. Earlier seeds created demo
-- REFUND_POLICY documents; this removes only those seeded rows (storage keys
-- under seed/), never an organizer's own upload. It doesn't use the enum
-- values added above, so it can run in the same transaction as ADD VALUE.
DELETE FROM "mun_documents" WHERE "kind" = 'REFUND_POLICY' AND "storage_key" LIKE 'seed/%';