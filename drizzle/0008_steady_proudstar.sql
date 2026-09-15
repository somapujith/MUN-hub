ALTER TYPE "public"."mun_status" ADD VALUE 'ACTION_REQUIRED' BEFORE 'CONTENT_SUBMITTED';--> statement-breakpoint
ALTER TYPE "public"."mun_status" ADD VALUE 'READY_FOR_SUBMISSION' BEFORE 'CONTENT_SUBMITTED';--> statement-breakpoint
ALTER TYPE "public"."mun_status" ADD VALUE 'AUTOMATED_VALIDATION' BEFORE 'CONTENT_SUBMITTED';--> statement-breakpoint
ALTER TYPE "public"."mun_status" ADD VALUE 'GO_LIVE_QUEUE' BEFORE 'PUBLISHED';--> statement-breakpoint
ALTER TYPE "public"."mun_status" ADD VALUE 'PUBLISHING' BEFORE 'PUBLISHED';--> statement-breakpoint
ALTER TYPE "public"."mun_status" ADD VALUE 'UNPUBLISHED' BEFORE 'REGISTRATION_OPEN';