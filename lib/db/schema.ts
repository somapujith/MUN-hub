import { relations } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { boolean, index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import {
  accommodationFieldTypeEnum,
  applicationStatusEnum,
  moduleVerificationStateEnum,
  munModuleEnum,
  munStatusEnum,
  paymentStatusEnum,
  registrationStatusEnum,
  roleEnum,
  verificationSeverityEnum,
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
    // Nullable, unwired — schema-only for now. Slice 1 of the verification/
    // confirmation trust layer adds this column so a future slice can pin a
    // registration to the mun_versions snapshot active at purchase time
    // (PRD Section 33). initiateRegistration does NOT populate this yet —
    // see docs/superpowers/specs/2026-09-13-verification-trust-layer-design.md
    // Section 6 for why that's deliberately deferred.
    munVersionId: text('mun_version_id').references((): AnyPgColumn => munVersions.id),
    // Nullable — accommodation is optional. Priced additively into the same
    // payment as the registration product (one order, one webhook confirms
    // both) rather than a separate purchase.
    accommodationOptionId: text('accommodation_option_id').references(
      (): AnyPgColumn => accommodationOptions.id,
    ),
    accommodationAnswers: jsonb('accommodation_answers'),
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

// ---------------------------------------------------------------------------
// Verification & confirmation trust layer (slice 1) — see
// docs/superpowers/specs/2026-09-13-verification-trust-layer-design.md
// ---------------------------------------------------------------------------

export const munModuleVerifications = pgTable(
  'mun_module_verifications',
  {
    id: id(),
    munId: text('mun_id')
      .notNull()
      .references(() => muns.id, { onDelete: 'cascade' }),
    moduleName: munModuleEnum('module_name').notNull(),
    state: moduleVerificationStateEnum('state').notNull().default('NOT_SUBMITTED'),
    organizerConfirmedAt: timestamp('organizer_confirmed_at', { withTimezone: true }),
    lastReviewedAt: timestamp('last_reviewed_at', { withTimezone: true }),
    lastReviewedBy: text('last_reviewed_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('mun_module_verifications_mun_id_idx').on(table.munId)],
)

export const munModuleVerificationsRelations = relations(munModuleVerifications, ({ one }) => ({
  mun: one(muns, { fields: [munModuleVerifications.munId], references: [muns.id] }),
  lastReviewer: one(users, { fields: [munModuleVerifications.lastReviewedBy], references: [users.id] }),
}))

export const verificationIssues = pgTable(
  'verification_issues',
  {
    id: id(),
    munId: text('mun_id')
      .notNull()
      .references(() => muns.id, { onDelete: 'cascade' }),
    moduleName: munModuleEnum('module_name').notNull(),
    severity: verificationSeverityEnum('severity').notNull(),
    reason: text('reason').notNull(),
    previousValue: text('previous_value'),
    newValue: text('new_value'),
    resolved: boolean('resolved').notNull().default(false),
    raisedBy: text('raised_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => [index('verification_issues_mun_id_idx').on(table.munId)],
)

export const verificationIssuesRelations = relations(verificationIssues, ({ one }) => ({
  mun: one(muns, { fields: [verificationIssues.munId], references: [muns.id] }),
  raiser: one(users, { fields: [verificationIssues.raisedBy], references: [users.id] }),
}))

export const organizerConfirmations = pgTable(
  'organizer_confirmations',
  {
    id: id(),
    munId: text('mun_id')
      .notNull()
      .references(() => muns.id, { onDelete: 'cascade' }),
    confirmingUserId: text('confirming_user_id')
      .notNull()
      .references(() => users.id),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }).notNull().defaultNow(),
    versionNumber: integer('version_number').notNull(),
    snapshotJson: jsonb('snapshot_json').notNull(),
  },
  (table) => [index('organizer_confirmations_mun_id_idx').on(table.munId)],
)

export const organizerConfirmationsRelations = relations(organizerConfirmations, ({ one }) => ({
  mun: one(muns, { fields: [organizerConfirmations.munId], references: [muns.id] }),
  confirmingUser: one(users, { fields: [organizerConfirmations.confirmingUserId], references: [users.id] }),
}))

export const munVersions = pgTable(
  'mun_versions',
  {
    id: id(),
    munId: text('mun_id')
      .notNull()
      .references(() => muns.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    snapshotJson: jsonb('snapshot_json').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('mun_versions_mun_id_idx').on(table.munId)],
)

export const munVersionsRelations = relations(munVersions, ({ one, many }) => ({
  mun: one(muns, { fields: [munVersions.munId], references: [muns.id] }),
  registrations: many(registrations),
}))

// ---------------------------------------------------------------------------
// Accommodation
// ---------------------------------------------------------------------------

export const accommodationOptions = pgTable(
  'accommodation_options',
  {
    id: id(),
    munId: text('mun_id')
      .notNull()
      .references(() => muns.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    price: integer('price').notNull(),
    capacity: integer('capacity').notNull(),
    description: text('description'),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('accommodation_options_mun_id_idx').on(table.munId)],
)

export const accommodationOptionsRelations = relations(accommodationOptions, ({ one, many }) => ({
  mun: one(muns, { fields: [accommodationOptions.munId], references: [muns.id] }),
  fields: many(accommodationOptionFields),
  registrations: many(registrations),
}))

export const accommodationOptionFields = pgTable(
  'accommodation_option_fields',
  {
    id: id(),
    optionId: text('option_id')
      .notNull()
      .references(() => accommodationOptions.id, { onDelete: 'cascade' }),
    fieldType: accommodationFieldTypeEnum('field_type').notNull(),
    label: text('label').notNull(),
    required: boolean('required').notNull().default(false),
    // Choice list for DROPDOWN/CHECKBOX field types — null for TEXT/NUMBER/DATE.
    choices: jsonb('choices'),
    displayOrder: integer('display_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('accommodation_option_fields_option_id_idx').on(table.optionId)],
)

export const accommodationOptionFieldsRelations = relations(accommodationOptionFields, ({ one }) => ({
  option: one(accommodationOptions, { fields: [accommodationOptionFields.optionId], references: [accommodationOptions.id] }),
}))
