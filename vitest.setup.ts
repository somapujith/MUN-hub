import { config } from 'dotenv'

// Tests must NEVER run against .env's DATABASE_URL — that now points at the
// team's shared live Neon instance, and a prior test run wrote 472 junk MUNs
// + 941 junk users into it before this was caught. .env.test pins tests to
// local Docker Postgres regardless of what .env is pointed at.
config({ path: '.env.test' })
