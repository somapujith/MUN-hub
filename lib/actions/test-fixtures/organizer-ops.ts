import type { Session } from '@/lib/auth/adapter'
import { db } from '@/lib/db/client'
import {
  committees,
  muns,
  payments,
  portfolios,
  registrationProducts,
  registrations,
  users,
} from '@/lib/db/schema'
import type { MunStatus, PaymentStatus, RegistrationStatus, Role } from '@/lib/db/schema-enums'

// Shared setup for the organizer-operations tests (roster, check-in,
// communications, results): one organizer-owned MUN with a pass, a committee
// and a portfolio, plus a helper to add delegates to it.

export function sessionFor(user: { id: string; role: Role }): Session {
  return { userId: user.id, role: user.role }
}

export async function makeUser(role: Role, overrides: Partial<typeof users.$inferInsert> = {}) {
  const [user] = await db
    .insert(users)
    .values({ name: `${role} user`, email: `${role.toLowerCase()}-${crypto.randomUUID()}@test.dev`, role, ...overrides })
    .returning()
  return user
}

export interface OpsFixtureOptions {
  status?: MunStatus
  /** Defaults to an hour ago (the conference has started). */
  startDate?: Date | null
}

export async function makeOpsFixture(options: OpsFixtureOptions = {}) {
  const suffix = crypto.randomUUID()
  const organizer = await makeUser('ORGANIZER')
  const [mun] = await db
    .insert(muns)
    .values({
      organizerId: organizer.id,
      name: `Ops MUN ${suffix.slice(0, 8)}`,
      slug: `ops-mun-${suffix}`,
      status: options.status ?? 'CONFERENCE_ACTIVE',
      startDate: options.startDate === undefined ? new Date(Date.now() - 3_600_000) : options.startDate,
      endDate: new Date(Date.now() + 86_400_000),
      venue: 'Hyderabad International Convention Centre',
      city: 'Hyderabad',
      country: 'India',
    })
    .returning()
  const [pass] = await db
    .insert(registrationProducts)
    .values({ munId: mun.id, name: 'Delegate Pass', price: 1500, capacity: 1000 })
    .returning()
  const [committee] = await db.insert(committees).values({ munId: mun.id, name: 'UNSC', capacity: 500 }).returning()
  const [portfolio] = await db.insert(portfolios).values({ committeeId: committee.id, name: 'France' }).returning()

  return { organizer, organizerSession: sessionFor(organizer), mun, pass, committee, portfolio }
}

export type OpsFixture = Awaited<ReturnType<typeof makeOpsFixture>>

export interface DelegateOptions {
  name?: string
  email?: string
  institution?: string | null
  status?: RegistrationStatus
  /** Seat the delegate in the fixture's committee and portfolio. */
  seated?: boolean
  paymentStatus?: PaymentStatus
  formResponses?: Record<string, unknown>
  suspended?: boolean
  registrationProductId?: string
  createdAt?: Date
}

export async function addDelegate(fixture: OpsFixture, options: DelegateOptions = {}) {
  const user = await makeUser('STUDENT', {
    name: options.name ?? 'Delegate',
    ...(options.email ? { email: options.email } : {}),
    institution: options.institution === undefined ? 'Test University' : options.institution,
    suspended: options.suspended ?? false,
  })
  const [registration] = await db
    .insert(registrations)
    .values({
      userId: user.id,
      munId: fixture.mun.id,
      registrationProductId: options.registrationProductId ?? fixture.pass.id,
      committeeId: options.seated ? fixture.committee.id : null,
      portfolioId: options.seated ? fixture.portfolio.id : null,
      status: options.status ?? 'CONFIRMED',
      formResponses: options.formResponses ?? null,
      ...(options.createdAt ? { createdAt: options.createdAt } : {}),
    })
    .returning()
  if (options.paymentStatus) {
    await db.insert(payments).values({
      registrationId: registration.id,
      providerOrderId: `order-${crypto.randomUUID()}`,
      amount: fixture.pass.price,
      status: options.paymentStatus,
    })
  }
  return { user, registration }
}
