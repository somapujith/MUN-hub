import { config } from 'dotenv'

// Load .env before anything that reads process.env.DATABASE_URL at import time.
// NOTE: `./client` and `./schema` are deliberately imported dynamically (inside
// main(), below) rather than via a static top-level `import`. Static imports
// are hoisted above this config() call by the ES module loader regardless of
// source order, so `./client`'s top-level `postgres(process.env.DATABASE_URL!)`
// would otherwise run before DATABASE_URL is populated and silently fall back
// to OS-default connection params (verified: falls back to connecting as OS
// user with no password, rather than throwing an error).
// !! WARNING -- THIS CONNECTS TO LIVE NEON BY DEFAULT !!
// `.env` in this repo holds the team's shared live Neon DATABASE_URL. Running
// this script with no override therefore writes to the real database that the
// dev server and anyone browsing it read from. A test run against Neon once
// wrote 472 junk MUNs + 941 junk users before this was caught.
// For ANY non-production run, override the connection explicitly, e.g.:
//   DATABASE_URL=postgresql://mun_hub:mun_hub_dev@localhost:5432/mun_hub npx tsx lib/db/seed.ts
// (Tests are already safe: vitest.setup.ts pins them to .env.test regardless.)
// The hardcoded `.env` path below is repo-wide tooling convention -- do not
// change it unilaterally; override DATABASE_URL instead.
config({ path: '.env' })

import { eq } from 'drizzle-orm'
import { seedFullGoLiveModules, type GoLiveModuleTables } from './seed-go-live-modules'

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

interface Tables extends GoLiveModuleTables {
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

interface OrganizerSeed {
  name: string
  email: string
}

interface MunSeed {
  name: string
  slug: string
  edition?: string
  theme?: string
  description?: string
  city: string
  country: string
  startDate?: string
  endDate?: string
  organizer: OrganizerSeed
  committees?: { name: string; agenda: string }[]
  registrationProducts?: { name: string; price: number; capacity: number }[]
  /**
   * When true, seedMun also seeds all 7 net-new go-live module tables
   * (branding, executive board, form fields, payment settlement, documents,
   * schedule, contact) via lib/db/seed-go-live-modules.ts, plus the mun-level
   * DATES_VENUE/ACCOMMODATION fields (venue, addressLine1,
   * registrationOpensAt, registrationDeadline, accommodationProvided) via
   * `goLiveDemoMunFields` below, so this mun's go-live dashboard renders at or
   * near 100% complete (Task 13, 2026-09-15). Set ONLY on the 2 generic demo
   * MUNs (Oxford, VIT) — deliberately left unset on the 6 real Hyderabad
   * conferences per CLAUDE.md: those have real names/dates/committees and
   * inventing fake executive board members or bank/payment details for a real
   * organization would misrepresent it. A realistic ACTION_REQUIRED state for
   * those 6 is better demo material than eight identical green dashboards.
   */
  fullGoLiveDemo?: boolean
}

const MUN_SEEDS: MunSeed[] = [
  {
    name: 'Oxford MUN 2027',
    slug: 'oxford-mun-2027',
    city: 'Oxford',
    country: 'UK',
    organizer: { name: 'Oxford MUN Society', email: 'organizer@munhub.test' },
    fullGoLiveDemo: true,
  },
  {
    name: 'VIT MUN 2027',
    slug: 'vit-mun-2027',
    city: 'Vellore',
    country: 'India',
    organizer: { name: 'VIT MUN Committee', email: 'organizer-vit@munhub.test' },
    fullGoLiveDemo: true,
  },
  // --- Real Hyderabad MUN conferences (researched 2026-09-13, sources noted
  // in commit message) — placeholder registration fees since no conference
  // in this circuit publicly discloses fees (confirmed via research, not a
  // data gap on our end); themes/committees are real where sourced.
  //
  // DATES: all 6 researched dates fell before 2026-09-13 (today), which made
  // the homepage carousel (which only promotes upcoming conferences) show
  // zero Hyderabad slides — flagged by mun-hub-02. Per user's explicit call,
  // dates below are shifted +1 year from the researched date as a projected
  // "next annual edition," not the literal researched date. Conference names
  // that hard-code the researched year (e.g. "BITSMUN Hyderabad '25") keep
  // that name as-is — it's the real, findable name of the conference; only
  // the date fields are projected forward.
  {
    name: "BITSMUN Hyderabad '25",
    slug: 'bitsmun-hyderabad-25',
    edition: '14th',
    theme: 'Accord Amid Anarchy',
    description:
      'BITSMUN Hyderabad is the flagship Model United Nations conference of BITS Pilani, Hyderabad Campus, run as part of the ATMOS techno-management fest. Now in its 14th edition, it brings together delegates across classic UN bodies and specialized political simulations for three days of committee debate.',
    city: 'Hyderabad',
    country: 'India',
    startDate: '2026-11-07', // researched: 2025-11-07, projected +1yr
    endDate: '2026-11-09', // researched: 2025-11-09, projected +1yr
    organizer: { name: 'BITS Pilani Hyderabad MUN Society', email: 'organizer-bitsmun@munhub.test' },
    committees: [
      { name: 'UNSC', agenda: 'Security Council reform and regional peacekeeping mandates.' },
      { name: 'Lok Sabha', agenda: 'Simulating contemporary Indian parliamentary debate and policy-making.' },
      { name: 'European Parliament', agenda: 'EU-wide legislative negotiation on cross-border policy.' },
    ],
    registrationProducts: [
      { name: 'Delegate', price: 2000, capacity: 250 },
      { name: 'Press', price: 1200, capacity: 25 },
    ],
  },
  {
    name: 'CBITMUN 2026',
    slug: 'cbitmun-2026',
    edition: '15th',
    theme: 'Sankalpena Netritvam (Leadership Rooted in Resolve)',
    description:
      'CBITMUN is the annual Model United Nations conference hosted by Chaitanya Bharathi Institute of Technology, Gandipet, Hyderabad. In its 15th edition, the conference continues a long-running tradition of committee simulation and diplomatic debate for college delegates across the region.',
    city: 'Hyderabad',
    country: 'India',
    startDate: '2027-04-10', // researched: 2026-04-10 (already past 2026-09-13 "today"), projected +1yr
    endDate: '2027-04-12', // researched: 2026-04-12, projected +1yr
    organizer: { name: 'CBIT MUN Society', email: 'organizer-cbitmun@munhub.test' },
    registrationProducts: [
      { name: 'Delegate', price: 1800, capacity: 220 },
      { name: 'Press', price: 1000, capacity: 20 },
    ],
  },
  {
    name: 'Shri HMUN 2026',
    slug: 'shri-hmun-2026',
    edition: '5th',
    theme: 'Strategize. Sustain. Succeed.',
    description:
      'Shri HMUN is The Shri Ram Universal School\'s flagship Model United Nations conference for grades VIII-XII, held at its Financial District campus in Gachibowli, Hyderabad. Now in its 5th edition, it carries forward an SDG-focused tradition that grew out of the school\'s earlier Shri Colloquium gathering.',
    city: 'Hyderabad',
    country: 'India',
    startDate: '2027-07-03', // researched: 2026-07-03 (already past 2026-09-13 "today"), projected +1yr
    endDate: '2027-07-05', // researched: 2026-07-05, projected +1yr
    organizer: { name: 'The Shri Ram Universal School MUN Committee', email: 'organizer-shrihmun@munhub.test' },
    registrationProducts: [
      { name: 'Delegate', price: 1500, capacity: 150 },
    ],
  },
  {
    name: 'Vista MUN 2025',
    slug: 'vista-mun-2025',
    theme: 'Sustainable Development in a Divided World',
    description:
      'Vista MUN is hosted by Vista International School in Gachibowli, Hyderabad, bringing together school-level delegates for a weekend of committee simulation with an emphasis on sustainability and global development themes.',
    city: 'Hyderabad',
    country: 'India',
    startDate: '2027-06-27', // researched: 2025-06-27; +1yr (2026-06-27) still fell before "today" 2026-09-13, so +2yr
    endDate: '2027-06-29', // researched: 2025-06-29, projected +2yr
    organizer: { name: 'Vista International School MUN Society', email: 'organizer-vistamun@munhub.test' },
    registrationProducts: [
      { name: 'Delegate', price: 1200, capacity: 100 },
    ],
  },
  {
    name: 'St. Francis College MUN 2025',
    slug: 'st-francis-college-mun-2025',
    theme: 'India-U.S. Strategic Partnership and Global Diplomacy',
    description:
      "Hosted by St. Francis College for Women, Begumpet, Hyderabad, in partnership with American Corner Hyderabad, this conference brings together roughly 150 students for a focused two-day exploration of international diplomacy and strategic partnership themes.",
    city: 'Hyderabad',
    country: 'India',
    startDate: '2027-02-03', // researched: 2025-02-03; +1yr (2026-02-03) still fell before "today" 2026-09-13, so +2yr
    endDate: '2027-02-04', // researched: 2025-02-04, projected +2yr
    organizer: { name: 'St. Francis College for Women MUN Committee', email: 'organizer-stfrancismun@munhub.test' },
    registrationProducts: [
      { name: 'Delegate', price: 1000, capacity: 150 },
    ],
  },
  {
    name: 'M-UN 2025',
    slug: 'm-un-2025',
    theme: 'Dialogue • Develop • Dream',
    description:
      'M-UN is an independent Hyderabad-based Model United Nations conference drawing around 300 delegates for a three-day program spanning a Continuous Crisis Council, International Press corps, AIPPM, UNHRC, and an expert-level UNSC.',
    city: 'Hyderabad',
    country: 'India',
    startDate: '2027-06-06', // researched: 2025-06-06; +1yr (2026-06-06) still fell before "today" 2026-09-13, so +2yr
    endDate: '2027-06-08', // researched: 2025-06-08, projected +2yr
    organizer: { name: 'M-UN Hyderabad', email: 'organizer-mun2k25@munhub.test' },
    committees: [
      { name: 'Continuous Crisis Council', agenda: 'Real-time evolving crisis simulation across an unfolding scenario.' },
      { name: 'International Press', agenda: 'Reporting and shaping narrative across the conference\'s committees.' },
      { name: 'AIPPM', agenda: 'All India Political Parties Meet — simulating Indian multi-party political negotiation.' },
      { name: 'UNHRC', agenda: 'Protecting civil liberties and human rights in conflict zones.' },
      { name: 'UNSC', agenda: 'Expert-level Security Council crisis response and resolution drafting.' },
    ],
    registrationProducts: [
      { name: 'Delegate', price: 1500, capacity: 300 },
      { name: 'Press', price: 1000, capacity: 60 },
    ],
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

/**
 * Mun-level fields DATES_VENUE and ACCOMMODATION need beyond what the base
 * seed already sets (start/end date, city, country) — only applied to
 * `fullGoLiveDemo` muns (Task 13, 2026-09-15). Ordering matches
 * lib/lifecycle/validators/content.ts#validateDatesVenue's BLOCKER checks:
 * registrationOpensAt < registrationDeadline < startDate < endDate.
 * ACCOMMODATION uses the PRD §22 opt-out (`NOT_PROVIDED`) rather than
 * fabricating accommodation options, since that module's validator
 * (validators/operations.ts#validateAccommodation) treats the opt-out alone
 * as a full, trivial pass.
 */
function goLiveDemoMunFields(startDate: Date) {
  const dayMs = 24 * 60 * 60 * 1000
  return {
    venue: 'Demo Conference Center',
    addressLine1: '1 Demo Conference Way',
    registrationOpensAt: new Date(startDate.getTime() - 60 * dayMs),
    registrationDeadline: new Date(startDate.getTime() - 7 * dayMs),
    accommodationProvided: 'NOT_PROVIDED' as const,
  }
}

async function seedMun(db: Db, tables: Tables, organizerId: string, seed: MunSeed) {
  const { muns, committees, portfolios, registrationProducts } = tables
  const [existingMun] = await db.select().from(muns).where(eq(muns.slug, seed.slug)).limit(1)

  let mun: Muns['$inferSelect']
  let committeeRows: Committees['$inferSelect'][]

  if (existingMun) {
    const targetStartDate = new Date(seed.startDate ?? '2027-03-10')
    const targetEndDate = new Date(seed.endDate ?? '2027-03-12')
    const organizerDrifted = existingMun.organizerId !== organizerId
    const datesDrifted =
      existingMun.startDate?.getTime() !== targetStartDate.getTime() ||
      existingMun.endDate?.getTime() !== targetEndDate.getTime()
    // Only backfill go-live demo fields for the 2 generic demo MUNs, and only
    // if they haven't been set yet (venue is null on every mun until this
    // runs) — avoids clobbering a value someone edited via the organizer UI
    // on a later re-seed.
    const goLiveFieldsMissing = Boolean(seed.fullGoLiveDemo) && existingMun.venue == null

    if (organizerDrifted || datesDrifted || goLiveFieldsMissing) {
      // Backfill fields that have drifted from the current seed definition —
      // without this, re-running the seed script against an already-seeded
      // DB leaves stale values in place forever (bit us twice already: once
      // with organizerId all pointing at one organizer, once with dates
      // researched in the past that never got projected forward).
      const [updated] = await db
        .update(muns)
        .set({
          organizerId,
          startDate: targetStartDate,
          endDate: targetEndDate,
          ...(goLiveFieldsMissing ? goLiveDemoMunFields(targetStartDate) : {}),
        })
        .where(eq(muns.id, existingMun.id))
        .returning()
      console.log(
        `  - MUN "${seed.name}" already exists (slug: ${seed.slug}), backfilled${organizerDrifted ? ' organizerId' : ''}${datesDrifted ? ' dates' : ''}${goLiveFieldsMissing ? ' go-live demo fields' : ''}.`,
      )
      mun = updated
    } else {
      console.log(`  - MUN "${seed.name}" already exists (slug: ${seed.slug}), skipping.`)
      mun = existingMun
    }
    committeeRows = await db.select().from(committees).where(eq(committees.munId, mun.id))
  } else {
    const targetStartDate = new Date(seed.startDate ?? '2027-03-10')
    const munValues: NewMun = {
      organizerId,
      name: seed.name,
      slug: seed.slug,
      edition: seed.edition ?? '2027',
      theme: seed.theme ?? 'Diplomacy in a Fractured World',
      description:
        seed.description ??
        `${seed.name} brings together delegates from across the region for three days of high-stakes committee debate, crisis simulation, and diplomacy.`,
      startDate: targetStartDate,
      endDate: new Date(seed.endDate ?? '2027-03-12'),
      city: seed.city,
      country: seed.country,
      status: 'PUBLISHED',
      publishedAt: new Date(),
      ...(seed.fullGoLiveDemo ? goLiveDemoMunFields(targetStartDate) : {}),
    }

    const [created] = await db.insert(muns).values(munValues).returning()
    mun = created
    console.log(`  - Created MUN "${mun.name}" (slug: ${mun.slug})`)

    const committeeSeeds = seed.committees ?? COMMITTEE_SEEDS
    committeeRows = []
    for (const committeeSeed of committeeSeeds) {
      const [committee] = await db
        .insert(committees)
        .values({
          munId: mun.id,
          name: committeeSeed.name,
          agenda: committeeSeed.agenda,
          capacity: 30,
        })
        .returning()
      committeeRows.push(committee)

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

    const productSeeds = seed.registrationProducts ?? REGISTRATION_PRODUCT_SEEDS
    await db.insert(registrationProducts).values(
      productSeeds.map((productSeed) => ({
        munId: mun.id,
        name: productSeed.name,
        price: productSeed.price,
        capacity: productSeed.capacity,
      })),
    )

    console.log(`    - Created ${productSeeds.length} registration products`)
  }

  if (seed.fullGoLiveDemo) {
    await seedFullGoLiveModules({
      db,
      tables,
      munId: mun.id,
      munName: mun.name,
      organizerId,
      committees: committeeRows,
    })
  }

  return mun
}

async function main() {
  // Dynamic import: see the note above config() for why this must not be a
  // static top-level import.
  const { db } = await import('./client')
  const {
    users,
    muns,
    committees,
    portfolios,
    registrationProducts,
    munMedia,
    munExecutiveBoard,
    munFormFields,
    munPaymentSettings,
    munDocuments,
    munScheduleItems,
    munContacts,
    organizerApplications,
  } = await import('./schema')
  const tables: Tables = {
    users,
    muns,
    committees,
    portfolios,
    registrationProducts,
    munMedia,
    munExecutiveBoard,
    munFormFields,
    munPaymentSettings,
    munDocuments,
    munScheduleItems,
    munContacts,
    organizerApplications,
  }

  console.log('Seeding users...')
  const admin = await upsertUserByEmail(db, users, {
    name: 'Platform Admin',
    email: 'admin@munhub.test',
    role: 'ADMIN',
  })
  console.log(`  - Admin: ${admin.email}`)

  const student = await upsertUserByEmail(db, users, {
    name: 'Asha Verma',
    email: 'student@munhub.test',
    role: 'STUDENT',
    institution: 'VIT Vellore',
  })
  console.log(`  - Student: ${student.email} (institution: ${student.institution})`)

  // One organizer account per MUN_SEED, derived from each seed's `organizer`
  // field so adding a new MUN_SEED entry doesn't also require hand-wiring a
  // matching organizer block here.
  const organizersByEmail = new Map<string, Awaited<ReturnType<typeof upsertUserByEmail>>>()
  for (const seed of MUN_SEEDS) {
    if (organizersByEmail.has(seed.organizer.email)) continue
    const organizer = await upsertUserByEmail(db, users, {
      name: seed.organizer.name,
      email: seed.organizer.email,
      role: 'ORGANIZER',
    })
    organizersByEmail.set(organizer.email, organizer)
    console.log(`  - Organizer: ${organizer.email}`)
  }

  console.log('Seeding MUNs...')
  for (const seed of MUN_SEEDS) {
    const munOrganizer = organizersByEmail.get(seed.organizer.email)
    if (!munOrganizer) {
      throw new Error(`No seeded organizer found for email ${seed.organizer.email}`)
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
