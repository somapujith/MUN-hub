CREATE TYPE "public"."module_completion_status" AS ENUM('NOT_STARTED', 'IN_PROGRESS', 'ACTION_REQUIRED', 'COMPLETE', 'LOCKED');--> statement-breakpoint
-- Extends "mun_module" from the 4 legacy keys to the PRD Section 38 set, and
-- remaps the legacy rows onto the new keys in the same step.
--
-- WHY THIS IS A TYPE SWAP AND NOT `ALTER TYPE ... ADD VALUE`:
-- Postgres refuses to *use* an enum label in the same transaction that added
-- it via ADD VALUE ("unsafe use of new value of enum type"). Drizzle's
-- migrate() runs every pending migration inside ONE transaction (see
-- drizzle-orm/pg-core/dialect.js -- session.transaction wraps the whole
-- migration loop), so on a FRESH database this migration and the remap that
-- follows it are always in the same transaction. With ADD VALUE, that
-- combination aborted the entire batch and left a fresh database with zero
-- tables -- the repo could not be bootstrapped at all. Splitting the remap
-- into its own *file* does not help, because files are not transactions.
--
-- Casting the literal (e.g. 'BASIC_INFO'::text::mun_module) does not help
-- either -- verified directly against Postgres; the label is still resolved at
-- plan time and rejected identically.
--
-- A label on a *newly CREATE-d* type carries no such restriction, so building
-- the full enum as a new type and swapping the columns onto it is safe inside
-- a single transaction. The USING clauses below fold the legacy -> PRD remap
-- into the column rewrite itself, which is why 0010 is now a no-op.
--
-- Do NOT "simplify" this back to ADD VALUE, and do not add a future migration
-- that ADD VALUEs an enum label and then uses that label from another
-- migration. Verify any enum change by migrating a genuinely empty database
-- with the full drizzle/ folder in one sequential migrate() call.
ALTER TYPE "public"."mun_module" RENAME TO "mun_module_legacy";--> statement-breakpoint
CREATE TYPE "public"."mun_module" AS ENUM('mun_details', 'committees', 'portfolios', 'registration_products', 'BASIC_INFO', 'DATES_VENUE', 'BRANDING', 'COMMITTEES', 'PORTFOLIOS', 'EXECUTIVE_BOARD', 'REGISTRATION_TYPES', 'REGISTRATION_FORM', 'PRICING_CAPACITY', 'PAYMENT_SETTLEMENT', 'RULES_DOCUMENTS', 'SCHEDULE', 'ACCOMMODATION', 'CONTACT', 'FINAL_REVIEW');--> statement-breakpoint
ALTER TABLE "mun_module_verifications" ALTER COLUMN "module_name" TYPE "public"."mun_module" USING (CASE "module_name"::text WHEN 'mun_details' THEN 'BASIC_INFO' WHEN 'committees' THEN 'COMMITTEES' WHEN 'portfolios' THEN 'PORTFOLIOS' WHEN 'registration_products' THEN 'REGISTRATION_TYPES' ELSE "module_name"::text END)::"public"."mun_module";--> statement-breakpoint
ALTER TABLE "verification_issues" ALTER COLUMN "module_name" TYPE "public"."mun_module" USING (CASE "module_name"::text WHEN 'mun_details' THEN 'BASIC_INFO' WHEN 'committees' THEN 'COMMITTEES' WHEN 'portfolios' THEN 'PORTFOLIOS' WHEN 'registration_products' THEN 'REGISTRATION_TYPES' ELSE "module_name"::text END)::"public"."mun_module";--> statement-breakpoint
DROP TYPE "public"."mun_module_legacy";
