import { and, asc, count, desc, eq, exists, ilike, inArray, or, sql, sum, type SQL } from 'drizzle-orm'
import { ATTENDANCE_OPEN_STATUSES } from '@/lib/actions/check-in'
import { assertMunOwner } from '@/lib/actions/mun-access'
import { ORGANIZER_OPS_ERRORS, ROSTER_EXPORT_MAX_ROWS } from '@/lib/actions/organizer-ops-errors'
import type { Session } from '@/lib/auth/adapter'
import { assertOwnsOrAdmin } from '@/lib/auth/ownership'
import { toCsv, type CsvCell } from '@/lib/csv'
import { db } from '@/lib/db/client'
import {
  accommodationOptions,
  committees,
  munFormFields,
  muns,
  payments,
  portfolios,
  registrationProducts,
  registrations,
  users,
} from '@/lib/db/schema'
import type { MunStatus, PaymentStatus, RegistrationStatus } from '@/lib/db/schema-enums'

export interface MunOverview {
  totalRegistrations: number
  revenue: number
  pendingPayments: number
  availableSeats: number
}

const COUNTABLE_REGISTRATION_STATUSES = ['CONFIRMED', 'ATTENDED'] as const

/**
 * Seat-reserved-but-not-yet-paid statuses, for the workspace-wide "pending"
 * total below. Mirrors the Next app's now-superseded
 * `app/organizer/dashboard/(workspace)/workspace-data.ts#PENDING_STATUSES` —
 * that file is Next-coupled (`"server-only"`, React `cache()`) and out of
 * scope for the framework-agnostic `/lib` contract, so the aggregate lives
 * here instead, callable from both the Next app and the Hono API.
 */
const PENDING_REGISTRATION_STATUSES = ['PENDING', 'PAYMENT_PENDING'] as const

/**
 * Aggregate stats for an organizer's mun dashboard: registration count,
 * revenue collected, payments still pending, and remaining seat capacity.
 *
 * Requires the caller-supplied `session` to own the mun or be an
 * ADMIN/SUPER_ADMIN — throws `Forbidden` otherwise. Missing mun throws
 * `Mun not found` (shared `assertOwnsOrAdmin`; previously this file's local
 * helper folded not-found into Forbidden).
 */
export async function getMunOverview(munId: string, session: Session | null): Promise<MunOverview> {
  await assertOwnsOrAdmin(munId, session)

  const [totalRegistrations, revenueRow, pendingPayments, products] = await Promise.all([
    db.$count(
      registrations,
      and(eq(registrations.munId, munId), inArray(registrations.status, [...COUNTABLE_REGISTRATION_STATUSES])),
    ),
    db
      .select({ total: sum(payments.amount) })
      .from(payments)
      .innerJoin(registrations, eq(payments.registrationId, registrations.id))
      .where(and(eq(registrations.munId, munId), eq(payments.status, 'PAID')))
      .then((rows) => rows[0]),
    db.$count(
      payments,
      and(
        eq(payments.status, 'PENDING'),
        inArray(
          payments.registrationId,
          db.select({ id: registrations.id }).from(registrations).where(eq(registrations.munId, munId)),
        ),
      ),
    ),
    db.select({ capacity: registrationProducts.capacity }).from(registrationProducts).where(eq(registrationProducts.munId, munId)),
  ])

  const totalCapacity = products.reduce((sumCapacity, product) => sumCapacity + product.capacity, 0)

  return {
    totalRegistrations,
    revenue: revenueRow?.total ? Number(revenueRow.total) : 0,
    pendingPayments,
    availableSeats: totalCapacity - totalRegistrations,
  }
}

export interface DelegateFilters {
  committeeId?: string
  paymentStatus?: PaymentStatus
  /** Registration statuses to include. Omitted or empty means every status. */
  statuses?: RegistrationStatus[]
  /** The pass (registration product) the delegate bought. */
  registrationProductId?: string
  /**
   * Free-text search across the whole roster, not just the current page:
   * delegate name, email or institution (case-insensitive substring), or the
   * start of a registration id.
   */
  search?: string
  limit?: number
  offset?: number
}

export const ROSTER_SEARCH_MAX_LENGTH = 100

export type DelegateRow = Awaited<ReturnType<typeof queryDelegates>>[number]

/** Escapes LIKE/ILIKE wildcards so a search for "50%" matches the literal text. */
function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, (char) => `\\${char}`)
}

/**
 * Every filter is pushed into SQL — payment status and the user-field search
 * as EXISTS subqueries — rather than fetched-then-`.filter()`'d in
 * application memory: a mun with thousands of delegates would otherwise pull
 * every row on every filtered request (flagged during frontend review at
 * BITSMUN-scale conference sizes). Paginated (default 50/page) for the same
 * reason.
 */
function buildDelegateConditions(munId: string, filters?: DelegateFilters) {
  const conditions: SQL[] = [eq(registrations.munId, munId)]
  if (filters?.committeeId) {
    conditions.push(eq(registrations.committeeId, filters.committeeId))
  }
  if (filters?.registrationProductId) {
    conditions.push(eq(registrations.registrationProductId, filters.registrationProductId))
  }
  if (filters?.statuses && filters.statuses.length > 0) {
    conditions.push(inArray(registrations.status, filters.statuses))
  }
  if (filters?.paymentStatus) {
    const paymentStatus = filters.paymentStatus
    conditions.push(
      exists(
        db
          .select({ id: payments.id })
          .from(payments)
          .where(and(eq(payments.registrationId, registrations.id), eq(payments.status, paymentStatus))),
      ),
    )
  }
  const term = filters?.search?.trim().slice(0, ROSTER_SEARCH_MAX_LENGTH)
  if (term) {
    const escaped = escapeLikePattern(term)
    const pattern = `%${escaped}%`
    const userMatch = or(ilike(users.name, pattern), ilike(users.email, pattern), ilike(users.institution, pattern))
    const searchCondition = or(
      ilike(registrations.id, `${escaped}%`),
      exists(
        db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, registrations.userId), userMatch)),
      ),
    )
    if (searchCondition) conditions.push(searchCondition)
  }
  return conditions
}

/** The only user fields the organizer delegate roster exposes. */
const DELEGATE_USER_COLUMNS = { id: true, name: true, email: true, institution: true } as const

function queryDelegates(munId: string, filters?: DelegateFilters) {
  return db.query.registrations.findMany({
    where: and(...buildDelegateConditions(munId, filters)),
    // Explicit column lists throughout: this roster is returned verbatim by
    // GET /organizer/muns/:id/delegates. The registration's form answers are
    // served one row at a time by `getDelegateDetail`, and its idempotency
    // key is the delegate's client secret, never the organizer's business.
    columns: {
      id: true,
      userId: true,
      munId: true,
      registrationProductId: true,
      committeeId: true,
      portfolioId: true,
      accommodationOptionId: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
    with: {
      // Never `user: true` — the full users row carries passwordHash,
      // suspension flags and other account internals.
      user: { columns: DELEGATE_USER_COLUMNS },
      committee: { columns: { id: true, name: true } },
      portfolio: { columns: { id: true, name: true } },
      payment: { columns: { id: true, status: true, amount: true, currency: true } },
      registrationProduct: { columns: { id: true, name: true, price: true, currency: true } },
    },
    // A stable order, or limit/offset pages can repeat or skip rows. Newest first.
    orderBy: (registration, { desc }) => [desc(registration.createdAt), desc(registration.id)],
    limit: filters?.limit ?? 50,
    offset: filters?.offset ?? 0,
  })
}

export interface DelegateListResult {
  results: DelegateRow[]
  total: number
  /** The MUN's lifecycle status, so the roster can explain which actions are available. */
  munStatus: MunStatus
  /** Whether delegates can be marked attended / no-show right now (see `ATTENDANCE_OPEN_STATUSES`). */
  attendanceOpen: boolean
}

/**
 * Delegate roster for an organizer's mun: filtered by committee, pass,
 * registration status and/or payment status, searched server-side, and
 * paginated.
 *
 * Requires the caller-supplied `session` to own the mun or be an
 * ADMIN/SUPER_ADMIN — throws `Forbidden` otherwise.
 */
export async function getDelegateList(
  munId: string,
  filters: DelegateFilters | undefined,
  session: Session | null,
): Promise<DelegateListResult> {
  await assertOwnsOrAdmin(munId, session)

  const [results, [{ count } = { count: 0 }], [mun]] = await Promise.all([
    queryDelegates(munId, filters),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(registrations)
      .where(and(...buildDelegateConditions(munId, filters))),
    db.select({ status: muns.status }).from(muns).where(eq(muns.id, munId)).limit(1),
  ])

  return {
    results,
    total: count,
    munStatus: mun.status,
    attendanceOpen: ATTENDANCE_OPEN_STATUSES.includes(mun.status),
  }
}

// ---------------------------------------------------------------------------
// Delegate detail (roster drawer) and CSV export — owner only
// ---------------------------------------------------------------------------

export interface DelegateAnswer {
  key: string
  label: string
  value: string
}

export interface DelegateProfileEssentials {
  dateOfBirth: Date
  gradeOrYear: string
  courseOrProgram: string | null
  city: string | null
  state: string | null
  country: string | null
  requiresTransportation: boolean
  emergencyContactName: string
  emergencyContactRelation: string
  emergencyContactPhone: string
}

export interface DelegateDetail {
  registration: { id: string; status: RegistrationStatus; createdAt: Date; updatedAt: Date }
  delegate: {
    name: string
    email: string
    phone: string | null
    institution: string | null
    /** Null when the delegate registered before the one-time profile existed. */
    profile: DelegateProfileEssentials | null
  }
  pass: { id: string; name: string; price: number; currency: string }
  committee: { id: string; name: string } | null
  portfolio: { id: string; name: string } | null
  /** The registration form answers, in the MUN's form order; unanswered fields are left out. */
  answers: DelegateAnswer[]
  accommodation: { name: string; answers: DelegateAnswer[] } | null
  payment: { status: PaymentStatus; amount: number; currency: string; createdAt: Date; updatedAt: Date } | null
  checkIn: {
    state: 'NOT_CHECKED_IN' | 'CHECKED_IN' | 'NO_SHOW' | 'NOT_APPLICABLE'
    /** When attendance was last recorded (the registration's last status change). */
    recordedAt: Date | null
  }
}

/** Labels for the account fields the registration funnel always asks (web/src/components/registration/registration-form.tsx). */
const CORE_ANSWER_LABELS: Record<string, string> = {
  fullName: 'Full name',
  email: 'Email',
  phone: 'Phone',
}

export function formatAnswerValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.map(formatAnswerValue).filter(Boolean).join(', ')
  return JSON.stringify(value)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/**
 * Orders form answers as the delegate saw them: account fields first, then
 * the MUN's form fields by display order, then any key the form no longer
 * defines (a field deleted after this delegate registered) under its raw key.
 */
function orderAnswers(
  responses: Record<string, unknown>,
  fields: ReadonlyArray<{ key: string; label: string }>,
): DelegateAnswer[] {
  const labelled = [
    ...Object.entries(CORE_ANSWER_LABELS).map(([key, label]) => ({ key, label })),
    ...fields.filter((field) => !(field.key in CORE_ANSWER_LABELS)),
  ]
  const known = new Set(labelled.map((field) => field.key))
  const ordered = [
    ...labelled,
    ...Object.keys(responses)
      .filter((key) => !known.has(key))
      .map((key) => ({ key, label: key })),
  ]
  return ordered
    .map(({ key, label }) => ({ key, label, value: formatAnswerValue(responses[key]).trim() }))
    .filter((answer) => answer.value !== '')
}

function checkInState(status: RegistrationStatus): DelegateDetail['checkIn']['state'] {
  if (status === 'ATTENDED') return 'CHECKED_IN'
  if (status === 'NO_SHOW') return 'NO_SHOW'
  if (status === 'CONFIRMED') return 'NOT_CHECKED_IN'
  return 'NOT_APPLICABLE'
}

/**
 * One delegate's full registration record for the roster drawer: profile
 * essentials, form answers, payment and check-in state.
 *
 * Owning organizer only (`assertMunOwner`) — this is the most PII-dense read
 * an organizer has. `registrationId` must belong to `munId`; a registration
 * of another MUN reads as not found rather than leaking that it exists.
 */
export async function getDelegateDetail(
  munId: string,
  registrationId: string,
  session: Session | null,
): Promise<DelegateDetail> {
  await assertMunOwner(munId, session)

  const row = await db.query.registrations.findFirst({
    where: and(eq(registrations.id, registrationId), eq(registrations.munId, munId)),
    columns: {
      id: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      formResponses: true,
      accommodationOptionId: true,
      accommodationAnswers: true,
    },
    with: {
      user: {
        columns: { name: true, email: true, phone: true, institution: true },
        with: {
          studentProfile: {
            columns: {
              dateOfBirth: true,
              gradeOrYear: true,
              courseOrProgram: true,
              addressCity: true,
              addressState: true,
              addressCountry: true,
              requiresTransportation: true,
              emergencyContactName: true,
              emergencyContactRelation: true,
              emergencyContactPhone: true,
            },
          },
        },
      },
      registrationProduct: { columns: { id: true, name: true, price: true, currency: true } },
      committee: { columns: { id: true, name: true } },
      portfolio: { columns: { id: true, name: true } },
      payment: { columns: { status: true, amount: true, currency: true, createdAt: true, updatedAt: true } },
    },
  })
  if (!row) throw new Error('Registration not found')

  const [formFields, accommodation] = await Promise.all([
    db
      .select({ key: munFormFields.fieldKey, label: munFormFields.label })
      .from(munFormFields)
      .where(eq(munFormFields.munId, munId))
      .orderBy(asc(munFormFields.displayOrder), asc(munFormFields.createdAt)),
    row.accommodationOptionId ? loadAccommodation(row.accommodationOptionId, row.accommodationAnswers) : null,
  ])

  const profile = row.user.studentProfile
  const payment = row.payment.at(-1) ?? null
  const attendanceRecorded = row.status === 'ATTENDED' || row.status === 'NO_SHOW'

  return {
    registration: { id: row.id, status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt },
    delegate: {
      name: row.user.name,
      email: row.user.email,
      phone: row.user.phone,
      institution: row.user.institution,
      profile: profile
        ? {
            dateOfBirth: profile.dateOfBirth,
            gradeOrYear: profile.gradeOrYear,
            courseOrProgram: profile.courseOrProgram,
            city: profile.addressCity,
            state: profile.addressState,
            country: profile.addressCountry,
            requiresTransportation: profile.requiresTransportation,
            emergencyContactName: profile.emergencyContactName,
            emergencyContactRelation: profile.emergencyContactRelation,
            emergencyContactPhone: profile.emergencyContactPhone,
          }
        : null,
    },
    pass: row.registrationProduct,
    committee: row.committee,
    portfolio: row.portfolio,
    answers: orderAnswers(asRecord(row.formResponses), formFields),
    accommodation,
    payment,
    checkIn: { state: checkInState(row.status), recordedAt: attendanceRecorded ? row.updatedAt : null },
  }
}

async function loadAccommodation(optionId: string, rawAnswers: unknown): Promise<DelegateDetail['accommodation']> {
  const option = await db.query.accommodationOptions.findFirst({
    where: eq(accommodationOptions.id, optionId),
    columns: { name: true },
    with: { fields: { columns: { id: true, label: true, displayOrder: true } } },
  })
  if (!option) return null
  const fields = [...option.fields]
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((field) => ({ key: field.id, label: field.label }))
  const answers = asRecord(rawAnswers)
  const known = new Set(fields.map((field) => field.key))
  return {
    name: option.name,
    answers: [...fields, ...Object.keys(answers).filter((key) => !known.has(key)).map((key) => ({ key, label: key }))]
      .map(({ key, label }) => ({ key, label, value: formatAnswerValue(answers[key]).trim() }))
      .filter((answer) => answer.value !== ''),
  }
}

const ROSTER_EXPORT_BATCH = 1_000

export interface DelegateRosterExport {
  filename: string
  csv: string
  rowCount: number
}

const EXPORT_BASE_HEADERS = [
  'Registration ID',
  'Registration status',
  'Checked in',
  'Name',
  'Email',
  'Phone',
  'Institution',
  'Pass',
  'Committee',
  'Portfolio',
  'Payment status',
  'Amount',
  'Currency',
  'Registered at',
] as const

/**
 * The filtered roster (same filters and search as `getDelegateList`, no
 * paging) as a CSV file, one row per registration, with a column per
 * registration-form field. Every free-text cell goes through
 * `lib/csv.ts`'s formula-injection guard. A roster larger than
 * ROSTER_EXPORT_MAX_ROWS is refused up front rather than silently cut off.
 *
 * Owning organizer only (`assertMunOwner`).
 */
export async function exportDelegateRoster(
  munId: string,
  filters: Omit<DelegateFilters, 'limit' | 'offset'> | undefined,
  session: Session | null,
): Promise<DelegateRosterExport> {
  await assertMunOwner(munId, session)
  const conditions = and(...buildDelegateConditions(munId, filters))

  const [[mun], formFields, [{ total } = { total: 0 }]] = await Promise.all([
    db.select({ slug: muns.slug }).from(muns).where(eq(muns.id, munId)).limit(1),
    db
      .select({ key: munFormFields.fieldKey, label: munFormFields.label })
      .from(munFormFields)
      .where(eq(munFormFields.munId, munId))
      .orderBy(asc(munFormFields.displayOrder), asc(munFormFields.createdAt)),
    db.select({ total: sql<number>`count(*)::int` }).from(registrations).where(conditions),
  ])
  if (total > ROSTER_EXPORT_MAX_ROWS) throw new Error(ORGANIZER_OPS_ERRORS.exportTooLarge)
  const answerFields = formFields.filter((field) => !(field.key in CORE_ANSWER_LABELS))

  const rows: CsvCell[][] = [[...EXPORT_BASE_HEADERS, ...answerFields.map((field) => field.label)]]
  // Batched so a large conference never holds one giant result set; the
  // count above bounds the loop even if registrations arrive mid-export.
  for (let offset = 0; offset < total; offset += ROSTER_EXPORT_BATCH) {
    const batch = await db
      .select({
        id: registrations.id,
        status: registrations.status,
        createdAt: registrations.createdAt,
        formResponses: registrations.formResponses,
        name: users.name,
        email: users.email,
        phone: users.phone,
        institution: users.institution,
        passName: registrationProducts.name,
        committeeName: committees.name,
        portfolioName: portfolios.name,
        paymentStatus: payments.status,
        paymentAmount: payments.amount,
        paymentCurrency: payments.currency,
      })
      .from(registrations)
      .innerJoin(users, eq(users.id, registrations.userId))
      .innerJoin(registrationProducts, eq(registrationProducts.id, registrations.registrationProductId))
      .leftJoin(committees, eq(committees.id, registrations.committeeId))
      .leftJoin(portfolios, eq(portfolios.id, registrations.portfolioId))
      .leftJoin(payments, eq(payments.registrationId, registrations.id))
      .where(conditions)
      .orderBy(desc(registrations.createdAt), desc(registrations.id))
      .limit(ROSTER_EXPORT_BATCH)
      .offset(offset)

    for (const row of batch) {
      const responses = asRecord(row.formResponses)
      rows.push([
        row.id,
        row.status,
        row.status === 'ATTENDED' ? 'Yes' : 'No',
        row.name,
        row.email,
        row.phone,
        row.institution,
        row.passName,
        row.committeeName,
        row.portfolioName,
        row.paymentStatus,
        row.paymentAmount,
        row.paymentCurrency,
        row.createdAt.toISOString(),
        ...answerFields.map((field) => formatAnswerValue(responses[field.key])),
      ])
    }
    if (batch.length < ROSTER_EXPORT_BATCH) break
  }

  const date = new Date().toISOString().slice(0, 10)
  const slug = (mun?.slug ?? 'mun').replace(/[^a-z0-9-]/gi, '-')
  return {
    filename: `${slug}-delegates-${date}.csv`,
    csv: toCsv(rows),
    rowCount: rows.length - 1,
  }
}

// ---------------------------------------------------------------------------
// Organizer-wide workspace overview (Overview + My MUNs pages)
// ---------------------------------------------------------------------------

export interface OrganizerWorkspaceMunSummary {
  id: string
  name: string
  slug: string
  edition: string | null
  status: MunStatus
  startDate: Date | null
  endDate: Date | null
  /** CONFIRMED/ATTENDED + PENDING/PAYMENT_PENDING for this mun. */
  registrationCount: number
  /** CONFIRMED/ATTENDED only. */
  confirmedCount: number
  /** Summed capacity of this mun's *active* registration products; 0 if none exist. */
  capacity: number
}

export interface OrganizerWorkspaceTotals {
  registrations: number
  confirmed: number
  pending: number
  capacity: number
  /** capacity - confirmed, floored at 0. */
  availableSeats: number
}

export interface OrganizerWorkspaceOverview {
  muns: OrganizerWorkspaceMunSummary[]
  totals: OrganizerWorkspaceTotals
}

/**
 * Organizer-wide dashboard data: every mun `session`'s user owns, plus
 * registration/capacity totals summed across all of them. Backs both the
 * Overview and My MUNs workspace pages (a single call covers both — My MUNs
 * just renders the `muns` array the Overview page also uses for totals).
 *
 * A fixed number of queries regardless of mun count, same approach as
 * `getMunOverview` above but grouped across the whole owned-mun id set
 * instead of a single mun.
 *
 * IDOR: `session.userId` is the only source of the organizer id — there is
 * no munId or organizerId parameter for a caller to widen. Throws
 * `Forbidden` for an unauthenticated caller.
 */
export async function getOrganizerWorkspaceOverview(session: Session | null): Promise<OrganizerWorkspaceOverview> {
  if (!session) throw new Error('Forbidden')

  const emptyTotals: OrganizerWorkspaceTotals = {
    registrations: 0,
    confirmed: 0,
    pending: 0,
    capacity: 0,
    availableSeats: 0,
  }

  const ownedMuns = await db
    .select({
      id: muns.id,
      name: muns.name,
      slug: muns.slug,
      edition: muns.edition,
      status: muns.status,
      startDate: muns.startDate,
      endDate: muns.endDate,
    })
    .from(muns)
    .where(eq(muns.organizerId, session.userId))
    .orderBy(desc(muns.createdAt))

  if (ownedMuns.length === 0) {
    return { muns: [], totals: emptyTotals }
  }

  const munIds = ownedMuns.map((mun) => mun.id)

  const [statusCounts, products] = await Promise.all([
    db
      .select({ munId: registrations.munId, status: registrations.status, total: count() })
      .from(registrations)
      .where(
        and(
          inArray(registrations.munId, munIds),
          inArray(registrations.status, [...COUNTABLE_REGISTRATION_STATUSES, ...PENDING_REGISTRATION_STATUSES]),
        ),
      )
      .groupBy(registrations.munId, registrations.status),
    db
      .select({ munId: registrationProducts.munId, capacity: registrationProducts.capacity, status: registrationProducts.status })
      .from(registrationProducts)
      .where(inArray(registrationProducts.munId, munIds)),
  ])

  const confirmedByMun = new Map<string, number>()
  const pendingByMun = new Map<string, number>()
  const countableStatuses: readonly string[] = COUNTABLE_REGISTRATION_STATUSES
  for (const row of statusCounts) {
    const bucket = countableStatuses.includes(row.status) ? confirmedByMun : pendingByMun
    bucket.set(row.munId, (bucket.get(row.munId) ?? 0) + row.total)
  }

  const capacityByMun = new Map<string, number>()
  for (const product of products) {
    // An inactive product isn't selling, so its seats aren't available.
    // Mirrors the same rule the marketplace and the Next workspace-data
    // aggregate both apply.
    if (product.status !== 'active') continue
    capacityByMun.set(product.munId, (capacityByMun.get(product.munId) ?? 0) + product.capacity)
  }

  const summaries: OrganizerWorkspaceMunSummary[] = ownedMuns.map((mun) => {
    const confirmedCount = confirmedByMun.get(mun.id) ?? 0
    const pendingCount = pendingByMun.get(mun.id) ?? 0
    return {
      ...mun,
      confirmedCount,
      registrationCount: confirmedCount + pendingCount,
      capacity: capacityByMun.get(mun.id) ?? 0,
    }
  })

  const confirmed = sumBy(summaries, (row) => row.confirmedCount)
  const totalRegistrations = sumBy(summaries, (row) => row.registrationCount)
  const capacity = sumBy(summaries, (row) => row.capacity)

  return {
    muns: summaries,
    totals: {
      registrations: totalRegistrations,
      confirmed,
      pending: totalRegistrations - confirmed,
      capacity,
      availableSeats: Math.max(capacity - confirmed, 0),
    },
  }
}

function sumBy<T>(rows: readonly T[], pick: (row: T) => number): number {
  return rows.reduce((total, row) => total + pick(row), 0)
}
