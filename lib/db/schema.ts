import { relations } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import {
  accommodationFieldTypeEnum,
  adminActionEnum,
  applicationStatusEnum,
  ebRoleEnum,
  formFieldTypeEnum,
  moduleCompletionEnum,
  moduleVerificationStateEnum,
  munDocumentKindEnum,
  munMediaKindEnum,
  munModuleEnum,
  munStatusEnum,
  paymentStatusEnum,
  paymentVerificationEnum,
  registrationStatusEnum,
  roleEnum,
  scheduleItemKindEnum,
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
    // PRD Section 9/10/22 columns (Task 3, 2026-09-14) — all nullable so
    // existing rows do not break. venue/city/country above already existed
    // and are NOT duplicated here.
    conferenceType: text('conference_type'),
    targetParticipantType: text('target_participant_type'),
    addressLine1: text('address_line1'),
    addressState: text('address_state'),
    postalCode: text('postal_code'),
    mapUrl: text('map_url'),
    registrationOpensAt: timestamp('registration_opens_at', { withTimezone: true }),
    registrationDeadline: timestamp('registration_deadline', { withTimezone: true }),
    // Tri-state: PROVIDED | NOT_PROVIDED | null (organizer hasn't answered yet).
    accommodationProvided: text('accommodation_provided'),
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
  media: many(munMedia),
  executiveBoard: many(munExecutiveBoard),
  formFields: many(munFormFields),
  paymentSettings: one(munPaymentSettings, {
    fields: [muns.id],
    references: [munPaymentSettings.munId],
  }),
  documents: many(munDocuments),
  scheduleItems: many(munScheduleItems),
  contact: one(munContacts, { fields: [muns.id], references: [munContacts.munId] }),
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
    // PRD Section 43 Phase 2 columns (Task 3, 2026-09-14).
    committeeType: text('committee_type'),
    portfoliosEnabled: boolean('portfolios_enabled').notNull().default(true),
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
    // PRD Section 43 Phase 2 columns (Task 3, 2026-09-14).
    description: text('description'),
    restrictions: text('restrictions'),
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
    // PRD Section 43 Phase 2 columns (Task 3, 2026-09-14).
    registrationType: text('registration_type'),
    earlyBirdPrice: integer('early_bird_price'),
    earlyBirdDeadline: timestamp('early_bird_deadline', { withTimezone: true }),
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
// Extended (Task 3, 2026-09-14) with the completion axis + PRD discriminator
// columns — see docs/superpowers/specs/2026-09-14-onboarding-go-live-pipeline-design.md
// Section 3.1.
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
    // Completion axis (organizer-facing: "have you filled this in correctly?")
    // — orthogonal to `state` (reviewer-facing: "has MUNHub verified it?").
    // See design doc Section 3.1 for why these are two columns on one row.
    completionStatus: moduleCompletionEnum('completion_status').notNull().default('NOT_STARTED'),
    isRequired: boolean('is_required').notNull().default(true),
    completionPercentage: integer('completion_percentage').notNull().default(0),
    blockingIssueCount: integer('blocking_issue_count').notNull().default(0),
    lastComputedAt: timestamp('last_computed_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('mun_module_verifications_mun_id_idx').on(table.munId),
    // getModuleReviewQueue filters WHERE state = 'PENDING_REVIEW' across every
    // mun on the platform (not scoped to one mun) — needs its own index once
    // that table has meaningful row counts across many organizers.
    index('mun_module_verifications_state_idx').on(table.state),
    // The constraint slice 1's design called for but never shipped. Its
    // absence was a live bug: getModuleVerificationState's lazy-create is
    // read-then-insert with no lock, so concurrent first-touches could
    // create duplicate (munId, moduleName) rows. See drizzle/0011 for the
    // dedupe-then-constrain migration.
    uniqueIndex('mun_module_verifications_mun_module_uq').on(table.munId, table.moduleName),
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
    // Discriminator columns (Task 3, 2026-09-14): this table is reused for
    // both reviewer-raised findings (source: REVIEWER, the original slice-1
    // use) and machine-raised validation failures (source: AUTOMATED, PRD
    // Section 24). code/fieldKey are the machine-readable identifiers the
    // automated validator needs; they stay nullable because reviewer-raised
    // rows don't have them.
    code: text('code'),
    fieldKey: text('field_key'),
    source: text('source').notNull().default('REVIEWER'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => [
    index('verification_issues_mun_id_idx').on(table.munId),
    // Task 8's blocking-issue-count recompute queries exactly this shape
    // (mun + module + unresolved) on every progress recomputation.
    index('verification_issues_mun_module_resolved_idx').on(
      table.munId,
      table.moduleName,
      table.resolved,
    ),
  ],
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

// ---------------------------------------------------------------------------
// Onboarding go-live pipeline — Task 4 net-new module tables (7 tables).
// See docs/superpowers/specs/2026-09-14-onboarding-go-live-pipeline-design.md
// Section 2.3. No actions/CRUD land in this task — Tasks 5-6 write the
// server actions against these tables; this task is schema-only.
// ---------------------------------------------------------------------------

// mun_media (BRANDING, PRD §11)

export const munMedia = pgTable(
  'mun_media',
  {
    id: id(),
    munId: text('mun_id')
      .notNull()
      .references(() => muns.id, { onDelete: 'cascade' }),
    kind: munMediaKindEnum('kind').notNull(),
    url: text('url').notNull(),
    storageKey: text('storage_key').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    displayOrder: integer('display_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('mun_media_mun_id_idx').on(table.munId)],
)

export const munMediaRelations = relations(munMedia, ({ one }) => ({
  mun: one(muns, { fields: [munMedia.munId], references: [muns.id] }),
}))

// mun_executive_board (EXECUTIVE_BOARD, PRD §14)

export const munExecutiveBoard = pgTable(
  'mun_executive_board',
  {
    id: id(),
    munId: text('mun_id')
      .notNull()
      .references(() => muns.id, { onDelete: 'cascade' }),
    // Nullable: a Secretary-General is mun-level, a Chair is committee-level.
    committeeId: text('committee_id').references(() => committees.id),
    name: text('name').notNull(),
    role: ebRoleEnum('role').notNull(),
    // Required iff role = CUSTOM — enforced in the action, not the DB.
    customRole: text('custom_role'),
    photoUrl: text('photo_url'),
    bio: text('bio'),
    displayOrder: integer('display_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('mun_executive_board_mun_id_idx').on(table.munId)],
)

export const munExecutiveBoardRelations = relations(munExecutiveBoard, ({ one }) => ({
  mun: one(muns, { fields: [munExecutiveBoard.munId], references: [muns.id] }),
  committee: one(committees, { fields: [munExecutiveBoard.committeeId], references: [committees.id] }),
}))

// mun_form_fields (REGISTRATION_FORM, PRD §17)

export const munFormFields = pgTable(
  'mun_form_fields',
  {
    id: id(),
    munId: text('mun_id')
      .notNull()
      .references(() => muns.id, { onDelete: 'cascade' }),
    fieldKey: text('field_key').notNull(),
    fieldType: formFieldTypeEnum('field_type').notNull(),
    label: text('label').notNull(),
    helpText: text('help_text'),
    required: boolean('required').notNull().default(false),
    // Non-null iff fieldType is DROPDOWN/MULTIPLE_CHOICE/CHECKBOX — enforced
    // in the action, not the DB.
    choices: jsonb('choices'),
    displayOrder: integer('display_order').notNull().default(0),
    // Conditional-logic design: single-parent, single-condition model stored
    // as three columns rather than a jsonb rule AST — see design doc Section
    // 2.3 for the rationale and the accepted cost (no OR-conditions or
    // multi-parent dependencies without a migration).
    conditionalOn: text('conditional_on'),
    conditionalOperator: text('conditional_operator'),
    conditionalValue: text('conditional_value'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('mun_form_fields_mun_id_idx').on(table.munId),
    // conditionalOn references fieldKey, which must be unambiguous within a
    // mun — see design doc Section 2.3.
    uniqueIndex('mun_form_fields_mun_key_uq').on(table.munId, table.fieldKey),
  ],
)

export const munFormFieldsRelations = relations(munFormFields, ({ one }) => ({
  mun: one(muns, { fields: [munFormFields.munId], references: [muns.id] }),
}))

// mun_payment_settings (PAYMENT_SETTLEMENT, PRD §19)
//
// SECURITY — write-only ciphertext columns, read this before touching this
// table. `panCiphertext` and `accountNumberCiphertext` are write-only in this
// slice: the write path (Task 6) encrypts and stores the full value via
// lib/crypto/field-encryption.ts, but NO read path in this codebase decrypts
// them back. `getPaymentSettings(munId)` (Task 6) MUST select columns
// explicitly and MUST NOT include these two columns in that list — `select()`
// with no argument is banned against this table for exactly this reason.
// There is deliberately no `getFullPaymentDetails` or equivalent decrypt-and-
// return action anywhere in this codebase. A decrypt path with no consumer is
// pure attack surface with no offsetting benefeit. Do NOT add one without a
// dedicated threat review — see design doc Section 2.3 and Section 8 (security
// invariant #7: "Payment plaintext is write-only, encrypted, and structurally
// unreachable by any read path").

export const munPaymentSettings = pgTable(
  'mun_payment_settings',
  {
    id: id(),
    munId: text('mun_id')
      .notNull()
      .unique()
      .references(() => muns.id, { onDelete: 'cascade' }),
    legalName: text('legal_name').notNull(),
    orgType: text('org_type').notNull(),
    addressLine1: text('address_line1').notNull(),
    addressLine2: text('address_line2'),
    city: text('city').notNull(),
    state: text('state').notNull(),
    postalCode: text('postal_code').notNull(),
    panLast4: text('pan_last4').notNull(),
    panCiphertext: text('pan_ciphertext').notNull(),
    gstin: text('gstin'),
    authorizedRepName: text('authorized_rep_name').notNull(),
    authorizedRepEmail: text('authorized_rep_email').notNull(),
    accountHolderName: text('account_holder_name').notNull(),
    bankName: text('bank_name').notNull(),
    accountNumberLast4: text('account_number_last4').notNull(),
    accountNumberCiphertext: text('account_number_ciphertext').notNull(),
    ifsc: text('ifsc').notNull(),
    accountType: text('account_type').notNull(),
    gateway: text('gateway').notNull(),
    currency: text('currency').notNull().default('INR'),
    refundPolicy: text('refund_policy'),
    settlementNotes: text('settlement_notes'),
    verificationState: paymentVerificationEnum('verification_state').notNull().default('NOT_SUBMITTED'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifiedBy: text('verified_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('mun_payment_settings_mun_id_idx').on(table.munId)],
)

export const munPaymentSettingsRelations = relations(munPaymentSettings, ({ one }) => ({
  mun: one(muns, { fields: [munPaymentSettings.munId], references: [muns.id] }),
  verifier: one(users, { fields: [munPaymentSettings.verifiedBy], references: [users.id] }),
}))

// mun_documents (RULES_DOCUMENTS, PRD §20)

export const munDocuments = pgTable(
  'mun_documents',
  {
    id: id(),
    munId: text('mun_id')
      .notNull()
      .references(() => muns.id, { onDelete: 'cascade' }),
    kind: munDocumentKindEnum('kind').notNull(),
    title: text('title').notNull(),
    url: text('url').notNull(),
    storageKey: text('storage_key').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('mun_documents_mun_id_idx').on(table.munId)],
)

export const munDocumentsRelations = relations(munDocuments, ({ one }) => ({
  mun: one(muns, { fields: [munDocuments.munId], references: [muns.id] }),
}))

// mun_schedule_items (SCHEDULE, PRD §21)

export const munScheduleItems = pgTable(
  'mun_schedule_items',
  {
    id: id(),
    munId: text('mun_id')
      .notNull()
      .references(() => muns.id, { onDelete: 'cascade' }),
    committeeId: text('committee_id').references(() => committees.id),
    title: text('title').notNull(),
    kind: scheduleItemKindEnum('kind').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    location: text('location'),
    displayOrder: integer('display_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('mun_schedule_items_mun_id_idx').on(table.munId)],
)

export const munScheduleItemsRelations = relations(munScheduleItems, ({ one }) => ({
  mun: one(muns, { fields: [munScheduleItems.munId], references: [muns.id] }),
  committee: one(committees, { fields: [munScheduleItems.committeeId], references: [committees.id] }),
}))

// mun_contacts (CONTACT, PRD §23)

export const munContacts = pgTable(
  'mun_contacts',
  {
    id: id(),
    munId: text('mun_id')
      .notNull()
      .unique()
      .references(() => muns.id, { onDelete: 'cascade' }),
    officialEmail: text('official_email').notNull(),
    phone: text('phone'),
    website: text('website'),
    socialLinks: jsonb('social_links'),
    contactPersonName: text('contact_person_name').notNull(),
    contactPersonRole: text('contact_person_role'),
    contactPersonEmail: text('contact_person_email').notNull(),
    contactPersonPhone: text('contact_person_phone'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('mun_contacts_mun_id_idx').on(table.munId)],
)

export const munContactsRelations = relations(munContacts, ({ one }) => ({
  mun: one(muns, { fields: [munContacts.munId], references: [muns.id] }),
}))
