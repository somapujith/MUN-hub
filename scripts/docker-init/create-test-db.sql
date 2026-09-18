-- Runs once, automatically, on a fresh (empty) Postgres data volume via
-- postgres:16-alpine's docker-entrypoint-initdb.d mechanism. Gives tests
-- (.env.test) their own dedicated database, isolated from whatever `.env`
-- points at (Neon, or this same container's `mun_hub` database) — see
-- CLAUDE.md's "Test/dev DB isolation" section for why this separation exists.
-- Does NOT run against an already-initialized volume; see that section for
-- the one-time manual `CREATE DATABASE` needed on pre-existing checkouts.
CREATE DATABASE mun_hub_test;
