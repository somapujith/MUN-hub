ALTER TYPE "public"."mun_status" ADD VALUE 'ORGANIZER_CONFIRMATION' BEFORE 'VERIFICATION';--> statement-breakpoint
ALTER TYPE "public"."mun_status" ADD VALUE 'VERIFIED' BEFORE 'PUBLISHED';--> statement-breakpoint
ALTER TYPE "public"."mun_status" ADD VALUE 'RESULTS_PENDING' BEFORE 'COMPLETED';--> statement-breakpoint
ALTER TYPE "public"."mun_status" ADD VALUE 'RESULTS_UNDER_REVIEW' BEFORE 'COMPLETED';--> statement-breakpoint
ALTER TYPE "public"."mun_status" ADD VALUE 'CANCELLED';