import { config } from 'dotenv'

// Tests must NEVER run against whatever database .env points at. .env.test
// pins tests to `mun_hub_test`, a database dedicated to tests on the same
// local Docker Postgres container — separate from .env's database, whether
// that's the team's shared live Neon instance or the local `mun_hub`
// database (both are documented, valid things for .env to point at; see
// CLAUDE.md's "Test/dev DB isolation" section). It's the *separate database*
// that makes this safe, not "local Docker" as a category: .env.test used to
// just point at local Docker's `mun_hub` database, which was NOT isolation
// the day .env also got pointed at local Docker — both files resolved to the
// exact same database, and two days of test runs wrote 111k+ junk rows into
// it before this was caught (the earlier, still-true history behind this
// comment: an even earlier incident had .env.test's Neon-vs-Docker mismatch
// catch 472 junk MUNs + 941 junk users written to live Neon).
config({ path: '.env.test' })
