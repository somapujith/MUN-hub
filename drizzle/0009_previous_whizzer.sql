CREATE TYPE "public"."module_completion_status" AS ENUM('NOT_STARTED', 'IN_PROGRESS', 'ACTION_REQUIRED', 'COMPLETE', 'LOCKED');--> statement-breakpoint
ALTER TYPE "public"."mun_module" ADD VALUE 'BASIC_INFO';--> statement-breakpoint
ALTER TYPE "public"."mun_module" ADD VALUE 'DATES_VENUE';--> statement-breakpoint
ALTER TYPE "public"."mun_module" ADD VALUE 'BRANDING';--> statement-breakpoint
ALTER TYPE "public"."mun_module" ADD VALUE 'COMMITTEES';--> statement-breakpoint
ALTER TYPE "public"."mun_module" ADD VALUE 'PORTFOLIOS';--> statement-breakpoint
ALTER TYPE "public"."mun_module" ADD VALUE 'EXECUTIVE_BOARD';--> statement-breakpoint
ALTER TYPE "public"."mun_module" ADD VALUE 'REGISTRATION_TYPES';--> statement-breakpoint
ALTER TYPE "public"."mun_module" ADD VALUE 'REGISTRATION_FORM';--> statement-breakpoint
ALTER TYPE "public"."mun_module" ADD VALUE 'PRICING_CAPACITY';--> statement-breakpoint
ALTER TYPE "public"."mun_module" ADD VALUE 'PAYMENT_SETTLEMENT';--> statement-breakpoint
ALTER TYPE "public"."mun_module" ADD VALUE 'RULES_DOCUMENTS';--> statement-breakpoint
ALTER TYPE "public"."mun_module" ADD VALUE 'SCHEDULE';--> statement-breakpoint
ALTER TYPE "public"."mun_module" ADD VALUE 'ACCOMMODATION';--> statement-breakpoint
ALTER TYPE "public"."mun_module" ADD VALUE 'CONTACT';--> statement-breakpoint
ALTER TYPE "public"."mun_module" ADD VALUE 'FINAL_REVIEW';