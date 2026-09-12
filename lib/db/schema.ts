import { relations } from 'drizzle-orm'
import { index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import {
  applicationStatusEnum,
  munStatusEnum,
  paymentStatusEnum,
  registrationStatusEnum,
  roleEnum,
} from './schema-enums'

export * from './schema-enums'

function id() {
  return text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID())
}

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------

export const users = pgTable('users', {
  id: id(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  phone: text('phone'),
  role: roleEnum('role').notNull().default('STUDENT'),
  username: text('username').unique(),
  institution: text('institution'),
  profileImage: text('profile_image'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const usersRelations = relations(users, ({ many }) => ({
  organizedMuns: many(muns),
  registrations: many(registrations),
  organizerApplications: many(organizerApplications),
  certificates: many(certificates),
  achievements: many(achievements),
  verificationLogs: many(verificationLogs),
  sessions: many(sessions),
}))

// ---------------------------------------------------------------------------
// sessions (new — supports getSession()/createSession()/destroySession())
// ---------------------------------------------------------------------------

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('sessions_user_id_idx').on(table.userId)],
)

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}))

// ---------------------------------------------------------------------------
// muns
// ---------------------------------------------------------------------------

export const muns = pgTable(
  'muns',
  {
    id: id(),
    organizerId: text('organizer_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    edition: text('edition'),
    theme: text('theme'),
    description: text('description'),
    startDate: timestamp('start_date', { withTimezone: true }),
    endDate: timestamp('end_date', { withTimezone: true }),
    venue: text('venue'),
    city: text('city'),
    country: text('country'),
    status: munStatusEnum('status').notNull().default('DRAFT'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('muns_status_idx').on(table.status),
    index('muns_organizer_id_idx').on(table.organizerId),
  ],
)

export const munsRelations = relations(muns, ({ one, many }) => ({
  organizer: one(users, { fields: [muns.organizerId], references: [users.id] }),
  committees: many(committees),
  registrationProducts: many(registrationProducts),
  registrations: many(registrations),
  certificates: many(certificates),
  achievements: many(achievements),
  verificationLogs: many(verificationLogs),
  organizerApplication: many(organizerApplications),
}))

// ---------------------------------------------------------------------------
// committees
// ---------------------------------------------------------------------------

export const committees = pgTable(
  'committees',
  {
    id: id(),
    munId: text('mun_id')
      .notNull()
      .references(() => muns.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    agenda: text('agenda'),
    description: text('description'),
    capacity: integer('capacity').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('committees_mun_id_idx').on(table.munId)],
)

export const committeesRelations = relations(committees, ({ one, many }) => ({
  mun: one(muns, { fields: [committees.munId], references: [muns.id] }),
  portfolios: many(portfolios),
  registrations: many(registrations),
}))

// ---------------------------------------------------------------------------
// portfolios
// ---------------------------------------------------------------------------

export const portfolios = pgTable(
  'portfolios',
  {
    id: id(),
    committeeId: text('committee_id')
      .notNull()
      .references(() => committees.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: text('type'),
    availability: integer('availability').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('portfolios_committee_id_idx').on(table.committeeId)],
)

export const portfoliosRelations = relations(portfolios, ({ one, many }) => ({
  committee: one(committees, { fields: [portfolios.committeeId], references: [committees.id] }),
  registrations: many(registrations),
}))

// ---------------------------------------------------------------------------
// registrationProducts
// ---------------------------------------------------------------------------

export const registrationProducts = pgTable(
  'registration_products',
  {
    id: id(),
    munId: text('mun_id')
      .notNull()
      .references(() => muns.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    price: integer('price').notNull(),
    currency: text('currency').notNull().default('INR'),
    capacity: integer('capacity').notNull(),
    deadline: timestamp('deadline', { withTimezone: true }),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('registration_products_mun_id_idx').on(table.munId)],
)

export const registrationProductsRelations = relations(registrationProducts, ({ one, many }) => ({
  mun: one(muns, { fields: [registrationProducts.munId], references: [muns.id] }),
  registrations: many(registrations),
}))

// ---------------------------------------------------------------------------
// registrations
// ---------------------------------------------------------------------------

export const registrations = pgTable(
  'registrations',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    munId: text('mun_id')
      .notNull()
      .references(() => muns.id),
    registrationProductId: text('registration_product_id')
      .notNull()
      .references(() => registrationProducts.id),
    committeeId: text('committee_id').references(() => committees.id),
    portfolioId: text('portfolio_id').references(() => portfolios.id),
    formResponses: jsonb('form_responses'),
    status: registrationStatusEnum('status').notNull().default('PENDING'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('registrations_mun_id_status_idx').on(table.munId, table.status),
    index('registrations_registration_product_id_status_idx').on(
      table.registrationProductId,
      table.status,
    ),
    index('registrations_user_id_idx').on(table.userId),
  ],
)

export const registrationsRelations = relations(registrations, ({ one, many }) => ({
  user: one(users, { fields: [registrations.userId], references: [users.id] }),
  mun: one(muns, { fields: [registrations.munId], references: [muns.id] }),
  registrationProduct: one(registrationProducts, {
    fields: [registrations.registrationProductId],
    references: [registrationProducts.id],
  }),
  committee: one(committees, { fields: [registrations.committeeId], references: [committees.id] }),
  portfolio: one(portfolios, { fields: [registrations.portfolioId], references: [portfolios.id] }),
  payment: many(payments),
  certificates: many(certificates),
  achievements: many(achievements),
}))

// ---------------------------------------------------------------------------
// payments
// ---------------------------------------------------------------------------

export const payments = pgTable('payments', {
  id: id(),
  registrationId: text('registration_id')
    .notNull()
    .unique()
    .references(() => registrations.id),
  provider: text('provider').notNull().default('mock_razorpay'),
  providerOrderId: text('provider_order_id').notNull().unique(),
  providerPaymentId: text('provider_payment_id'),
  amount: integer('amount').notNull(),
  status: paymentStatusEnum('status').notNull().default('CREATED'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const paymentsRelations = relations(payments, ({ one }) => ({
  registration: one(registrations, {
    fields: [payments.registrationId],
    references: [registrations.id],
  }),
}))

// ---------------------------------------------------------------------------
// certificates (scaffolded per PRD — no logic/UI in MVP)
// ---------------------------------------------------------------------------

export const certificates = pgTable('certificates', {
  id: id(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  munId: text('mun_id')
    .notNull()
    .references(() => muns.id),
  registrationId: text('registration_id')
    .notNull()
    .references(() => registrations.id),
  certificateUrl: text('certificate_url'),
  verificationStatus: text('verification_status').notNull().default('unverified'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const certificatesRelations = relations(certificates, ({ one }) => ({
  user: one(users, { fields: [certificates.userId], references: [users.id] }),
  mun: one(muns, { fields: [certificates.munId], references: [muns.id] }),
  registration: one(registrations, {
    fields: [certificates.registrationId],
    references: [registrations.id],
  }),
}))

// ---------------------------------------------------------------------------
// achievements (scaffolded per PRD — no logic/UI in MVP)
// ---------------------------------------------------------------------------

export const achievements = pgTable('achievements', {
  id: id(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  munId: text('mun_id')
    .notNull()
    .references(() => muns.id),
  registrationId: text('registration_id')
    .notNull()
    .references(() => registrations.id),
  committee: text('committee'),
  portfolio: text('portfolio'),
  award: text('award'),
  verificationStatus: text('verification_status').notNull().default('unverified'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const achievementsRelations = relations(achievements, ({ one }) => ({
  user: one(users, { fields: [achievements.userId], references: [users.id] }),
  mun: one(muns, { fields: [achievements.munId], references: [muns.id] }),
  registration: one(registrations, {
    fields: [achievements.registrationId],
    references: [registrations.id],
  }),
}))

// ---------------------------------------------------------------------------
// organizerApplications
// ---------------------------------------------------------------------------

export const organizerApplications = pgTable('organizer_applications', {
  id: id(),
  organizerId: text('organizer_id')
    .notNull()
    .unique()
    .references(() => users.id),
  munId: text('mun_id').unique().references(() => muns.id),
  status: applicationStatusEnum('status').notNull().default('SUBMITTED'),
  reviewNotes: text('review_notes'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
})

export const organizerApplicationsRelations = relations(organizerApplications, ({ one }) => ({
  organizer: one(users, { fields: [organizerApplications.organizerId], references: [users.id] }),
  mun: one(muns, { fields: [organizerApplications.munId], references: [muns.id] }),
}))

// ---------------------------------------------------------------------------
// verificationLogs
// ---------------------------------------------------------------------------

export const verificationLogs = pgTable(
  'verification_logs',
  {
    id: id(),
    munId: text('mun_id')
      .notNull()
      .references(() => muns.id, { onDelete: 'cascade' }),
    reviewerId: text('reviewer_id')
      .notNull()
      .references(() => users.id),
    action: text('action').notNull(),
    notes: text('notes'),
    internalNotes: text('internal_notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('verification_logs_mun_id_idx').on(table.munId)],
)

export const verificationLogsRelations = relations(verificationLogs, ({ one }) => ({
  mun: one(muns, { fields: [verificationLogs.munId], references: [muns.id] }),
  reviewer: one(users, { fields: [verificationLogs.reviewerId], references: [users.id] }),
}))
