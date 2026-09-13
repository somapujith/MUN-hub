-- Hand-written migration (see docs/superpowers/specs/2026-09-14-onboarding-go-live-pipeline-design.md
-- Section 2.1). Must run AFTER 0009 (which adds the new mun_module enum values) and MUST be its own
-- transaction — Postgres cannot use a newly-added enum value in the same transaction that added it.
--
-- Remaps legacy mun_module keys to their PRD Section 38 equivalents in both tables that reference
-- the enum. The legacy enum values themselves are NOT removed (Postgres enums are append-only here);
-- only the data rows are remapped.
UPDATE "mun_module_verifications" SET "module_name" = 'BASIC_INFO' WHERE "module_name" = 'mun_details';--> statement-breakpoint
UPDATE "mun_module_verifications" SET "module_name" = 'COMMITTEES' WHERE "module_name" = 'committees';--> statement-breakpoint
UPDATE "mun_module_verifications" SET "module_name" = 'PORTFOLIOS' WHERE "module_name" = 'portfolios';--> statement-breakpoint
UPDATE "mun_module_verifications" SET "module_name" = 'REGISTRATION_TYPES' WHERE "module_name" = 'registration_products';--> statement-breakpoint
UPDATE "verification_issues" SET "module_name" = 'BASIC_INFO' WHERE "module_name" = 'mun_details';--> statement-breakpoint
UPDATE "verification_issues" SET "module_name" = 'COMMITTEES' WHERE "module_name" = 'committees';--> statement-breakpoint
UPDATE "verification_issues" SET "module_name" = 'PORTFOLIOS' WHERE "module_name" = 'portfolios';--> statement-breakpoint
UPDATE "verification_issues" SET "module_name" = 'REGISTRATION_TYPES' WHERE "module_name" = 'registration_products';
