import { config } from 'dotenv'

// Load .env before anything that reads process.env.DATABASE_URL at import time.
// NOTE: `./client` and `./schema` are deliberately imported dynamically (inside
// main(), below) rather than via a static top-level `import`. Static imports
// are hoisted above this config() call by the ES module loader regardless of
// source order, so `./client`'s top-level `postgres(process.env.DATABASE_URL!)`
// would otherwise run before DATABASE_URL is populated and silently fall back
// to OS-default connection params (verified: falls back to connecting as OS
// user with no password, rather than throwing an error).
config({ path: '.env' })

import { eq } from 'drizzle-orm'

type SchemaModule = typeof import('./schema')
type ClientModule = typeof import('./client')
type Db = ClientModule['db']
type Users = SchemaModule['users']
type Muns = SchemaModule['muns']
type Committees = SchemaModule['committees']
type Portfolios = SchemaModule['portfolios']
type RegistrationProducts = SchemaModule['registrationProducts']
type NewUser = Users['$inferInsert']
type NewMun = Muns['$inferInsert']

interface Tables {
  users: Users
  muns: Muns
  committees: Committees
  portfolios: Portfolios
  registrationProducts: RegistrationProducts
}

async function upsertUserByEmail(db: Db, users: Users, data: NewUser) {
  const [existing] = await db.select().from(users).where(eq(users.email, data.email)).limit(1)
  if (existing) return existing
  const [created] = await db.insert(users).values(data).returning()
  return created
}

interface MunSeed {
  name: string
  slug: string
  city: string
  country: string
  organizerEmail: string
}

const MUN_SEEDS: MunSeed[] = [
  {
    name: 'Oxford MUN 2027',
    slug: 'oxford-mun-2027',
    city: 'Oxford',
    country: 'UK',
    organizerEmail: 'organizer@munhub.test',
  },
  {
    name: 'VIT MUN 2027',
    slug: 'vit-mun-2027',
    city: 'Vellore',
    country: 'India',
    organizerEmail: 'organizer-vit@munhub.test',
  },
]

const COMMITTEE_SEEDS = [
  { name: 'UNSC', agenda: 'Addressing regional security council reform and peacekeeping mandates.' },
  { name: 'UNHRC', agenda: 'Protecting civil liberties and human rights in conflict zones.' },
]

const PORTFOLIO_SEEDS = [
  { name: 'United States', type: 'country' },
  { name: 'France', type: 'country' },
]

const REGISTRATION_PRODUCT_SEEDS = [
  { name: 'Delegate', price: 2500, capacity: 200 },
  { name: 'Press', price: 1500, capacity: 20 },
]

async function seedMun(db: Db, tables: Tables, organizerId: string, seed: MunSeed) {
  const { muns, committees, portfolios, registrationProducts } = tables
  const [existingMun] = await db.select().from(muns).where(eq(muns.slug, seed.slug)).limit(1)

  if (existingMun) {
    if (existingMun.organizerId !== organizerId) {
      // Backfill for MUNs seeded before each MUN_SEED got its own organizer —
      // without this, re-running the seed script against an already-seeded
      // DB leaves every MUN pointing at whichever organizer seeded first.
      const [updated] = await db
        .update(muns)
        .set({ organizerId })
        .where(eq(muns.id, existingMun.id))
        .returning()
      console.log(`  - MUN "${seed.name}" already exists (slug: ${seed.slug}), backfilled organizerId.`)
      return updated
    }
    console.log(`  - MUN "${seed.name}" already exists (slug: ${seed.slug}), skipping.`)
    return existingMun
  }

  const munValues: NewMun = {
    organizerId,
    name: seed.name,
    slug: seed.slug,
    edition: '2027',
    theme: 'Diplomacy in a Fractured World',
    description: `${seed.name} brings together delegates from across the region for three days of high-stakes committee debate, crisis simulation, and diplomacy.`,
    startDate: new Date('2027-03-10'),
    endDate: new Date('2027-03-12'),
    city: seed.city,
    country: seed.country,
    status: 'PUBLISHED',
    publishedAt: new Date(),
  }

  const [mun] = await db.insert(muns).values(munValues).returning()
  console.log(`  - Created MUN "${mun.name}" (slug: ${mun.slug})`)

  for (const committeeSeed of COMMITTEE_SEEDS) {
    const [committee] = await db
      .insert(committees)
      .values({
        munId: mun.id,
        name: committeeSeed.name,
        agenda: committeeSeed.agenda,
        capacity: 30,
      })
      .returning()

    await db.insert(portfolios).values(
      PORTFOLIO_SEEDS.map((portfolioSeed) => ({
        committeeId: committee.id,
        name: portfolioSeed.name,
        type: portfolioSeed.type,
        availability: 1,
      })),
    )

    console.log(`    - Created committee "${committee.name}" with ${PORTFOLIO_SEEDS.length} portfolios`)
  }

  await db.insert(registrationProducts).values(
    REGISTRATION_PRODUCT_SEEDS.map((productSeed) => ({
      munId: mun.id,
      name: productSeed.name,
      price: productSeed.price,
      capacity: productSeed.capacity,
    })),
  )

  console.log(`    - Created ${REGISTRATION_PRODUCT_SEEDS.length} registration products`)

  return mun
}

async function main() {
  // Dynamic import: see the note above config() for why this must not be a
  // static top-level import.
  const { db } = await import('./client')
  const { users, muns, committees, portfolios, registrationProducts } = await import('./schema')
  const tables: Tables = { users, muns, committees, portfolios, registrationProducts }

  console.log('Seeding users...')
  const admin = await upsertUserByEmail(db, users, {
    name: 'Platform Admin',
    email: 'admin@munhub.test',
    role: 'ADMIN',
  })
  console.log(`  - Admin: ${admin.email}`)

  const organizer = await upsertUserByEmail(db, users, {
    name: 'Oxford MUN Society',
    email: 'organizer@munhub.test',
    role: 'ORGANIZER',
  })
  console.log(`  - Organizer: ${organizer.email}`)

  const organizerVit = await upsertUserByEmail(db, users, {
    name: 'VIT MUN Committee',
    email: 'organizer-vit@munhub.test',
    role: 'ORGANIZER',
  })
  console.log(`  - Organizer: ${organizerVit.email}`)

  const student = await upsertUserByEmail(db, users, {
    name: 'Asha Verma',
    email: 'student@munhub.test',
    role: 'STUDENT',
    institution: 'VIT Vellore',
  })
  console.log(`  - Student: ${student.email} (institution: ${student.institution})`)

  const organizersByEmail = new Map([
    [organizer.email, organizer],
    [organizerVit.email, organizerVit],
  ])

  console.log('Seeding MUNs...')
  for (const seed of MUN_SEEDS) {
    const munOrganizer = organizersByEmail.get(seed.organizerEmail)
    if (!munOrganizer) {
      throw new Error(`No seeded organizer found for email ${seed.organizerEmail}`)
    }
    await seedMun(db, tables, munOrganizer.id, seed)
  }

  console.log('Seed complete.')
  await db.$client.end()
}

main().catch((error) => {
  console.error('Seed failed:', error)
  process.exit(1)
})
