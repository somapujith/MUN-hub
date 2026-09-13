import { relations } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { boolean, index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import {
  accommodationFieldTypeEnum,
  adminActionEnum,
  applicationStatusEnum,
  moduleVerificationStateEnum,
  munModuleEnum,
  munStatusEnum,
  paymentStatusEnum,
  refundStatusEnum,
  registrationStatusEnum,
  roleEnum,
  supportCategoryEnum,
  supportPriorityEnum,
  supportStatusEnum,
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
  suspended: boolean('suspended').notNull().default(false),
  suspendedReason: text('suspended_reason'),
  suspendedAt: timestamp('suspended_at', { withTimezone: true }),
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

export const payments = pgTable(
  'payments',
  {
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
  },
  // getDelegateList (organizer-dashboard.ts) filters registrations joined to
  // payments by payments.status — needs this index once a mun has enough
  // delegates for the join+filter to matter.
  (table) => [index('payments_status_idx').on(table.status)],
)

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
  (table) => [
    index('mun_module_verifications_mun_id_idx').on(table.munId),
    // getModuleReviewQueue filters WHERE state = 'PENDING_REVIEW' across every
    // mun on the platform (not scoped to one mun) — needs its own index once
    // that table has meaningful row counts across many organizers.
    index('mun_module_verifications_state_idx').on(table.state),
  ],
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

// ---------------------------------------------------------------------------
// admin_actions (general audit log — append-only)
// ---------------------------------------------------------------------------

export const adminActions = pgTable(
  'admin_actions',
  {
    id: id(),
    actorId: text('actor_id')
      .notNull()
      .references(() => users.id),
    action: adminActionEnum('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    reason: text('reason'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('admin_actions_target_idx').on(table.targetType, table.targetId),
    index('admin_actions_actor_id_idx').on(table.actorId),
  ],
)

export const adminActionsRelations = relations(adminActions, ({ one }) => ({
  actor: one(users, { fields: [adminActions.actorId], references: [users.id] }),
}))

// ---------------------------------------------------------------------------
// refund_requests
// ---------------------------------------------------------------------------

export const refundRequests = pgTable(
  'refund_requests',
  {
    id: id(),
    registrationId: text('registration_id')
      .notNull()
      .references(() => registrations.id),
    paymentId: text('payment_id')
      .notNull()
      .references(() => payments.id),
    requestedBy: text('requested_by')
      .notNull()
      .references(() => users.id),
    reason: text('reason').notNull(),
    amount: integer('amount').notNull(),
    status: refundStatusEnum('status').notNull().default('REQUESTED'),
    approverId: text('approver_id').references(() => users.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    providerRefundId: text('provider_refund_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('refund_requests_registration_id_idx').on(table.registrationId),
    index('refund_requests_status_idx').on(table.status),
  ],
)

export const refundRequestsRelations = relations(refundRequests, ({ one }) => ({
  registration: one(registrations, {
    fields: [refundRequests.registrationId],
    references: [registrations.id],
  }),
  payment: one(payments, { fields: [refundRequests.paymentId], references: [payments.id] }),
  requester: one(users, { fields: [refundRequests.requestedBy], references: [users.id] }),
  approver: one(users, { fields: [refundRequests.approverId], references: [users.id] }),
}))

// ---------------------------------------------------------------------------
// support_tickets
// ---------------------------------------------------------------------------

export const supportTickets = pgTable(
  'support_tickets',
  {
    id: id(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    category: supportCategoryEnum('category').notNull(),
    priority: supportPriorityEnum('priority').notNull().default('NORMAL'),
    status: supportStatusEnum('status').notNull().default('NEW'),
    subject: text('subject').notNull(),
    description: text('description').notNull(),
    assignedTo: text('assigned_to').references(() => users.id),
    relatedRegistrationId: text('related_registration_id').references(() => registrations.id),
    relatedMunId: text('related_mun_id').references(() => muns.id),
    resolutionNotes: text('resolution_notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('support_tickets_status_idx').on(table.status),
    index('support_tickets_assigned_to_idx').on(table.assignedTo),
  ],
)

export const supportTicketsRelations = relations(supportTickets, ({ one }) => ({
  creator: one(users, { fields: [supportTickets.createdBy], references: [users.id] }),
  assignee: one(users, { fields: [supportTickets.assignedTo], references: [users.id] }),
  registration: one(registrations, {
    fields: [supportTickets.relatedRegistrationId],
    references: [registrations.id],
  }),
  mun: one(muns, { fields: [supportTickets.relatedMunId], references: [muns.id] }),
}))
