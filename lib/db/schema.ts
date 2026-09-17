import { relations, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import {
  accommodationFieldTypeEnum,
  adminActionEnum,
  applicationStatusEnum,
  consentTypeEnum,
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
  slaStateEnum,
  submissionStatusEnum,
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
  // Nullable: seeded/legacy rows may predate real signup. Every account
  // created via signUp (lib/actions/auth.ts) always sets this — a null value
  // on a post-signup row means "cannot sign in", not "passwordless is ok".
  // See lib/auth/password.ts for the scrypt hash/verify pair.
  passwordHash: text('password_hash'),
  // Single account-level preference (2026-09-17): whether the user wants
  // email notifications about their own registrations/MUN updates. Kept as
  // one column, not a jsonb bag — add a column per preference if/when a
  // second one is needed, rather than pre-building a generic preferences
  // system nobody's asked for yet.
  emailNotificationsEnabled: boolean('email_notifications_enabled').notNull().default(true),
  // Presence = verified (lib/actions/email-verification.ts). Null for every
  // pre-existing row at migration time — the migration backfills this to
  // `createdAt` for all of them (seeded demo accounts included), so turning
  // on REQUIRE_EMAIL_VERIFICATION doesn't retroactively lock out anyone who
  // signed up before this column existed.
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  suspended: boolean('suspended').notNull().default(false),
  suspendedReason: text('suspended_reason'),
  suspendedAt: timestamp('suspended_at', { withTimezone: true }),
},
(table) => [
  // Admin reporting (lib/actions/admin-reporting.ts): new-organizer/new-delegate
  // signup trend and the existing admin-analytics "new organizers this week"
  // count both filter by role + a createdAt range.
  index('users_role_created_at_idx').on(table.role, table.createdAt),
])

export const usersRelations = relations(users, ({ one, many }) => ({
  organizedMuns: many(muns),
  registrations: many(registrations),
  organizerApplications: many(organizerApplications),
  certificates: many(certificates),
  achievements: many(achievements),
  verificationLogs: many(verificationLogs),
  sessions: many(sessions),
  studentProfile: one(studentProfiles, {
    fields: [users.id],
    references: [studentProfiles.userId],
  }),
  consents: many(userConsents),
}))

// ---------------------------------------------------------------------------
// student_profiles — one-time-fill delegate onboarding data (emergency
// contact, DOB, past MUN experience, etc.) so a student never re-types it on
// every registration. 1:1 with `users` via a unique FK, STUDENT-role only by
// convention (not DB-enforced — an ORGANIZER/ADMIN account simply never gets
// a row). Existence of a row (with all its NOT NULL columns populated) IS the
// "profile complete" signal — see lib/actions/student-profile.ts's
// `isProfileComplete`, deliberately not a separate boolean flag.
//
// Field keys are chosen to line up with `DEFAULT_REGISTRATION_FIELDS`
// (lib/actions/registration-form-defaults.ts) — grade/address/transportation/
// DOB/emergency-contact/experience are already asked per-registration via
// `mun_form_fields`; `getProfileFormDefaults` maps this table's columns back
// onto those same `fieldKey`s so the per-mun form can pre-fill instead of
// re-asking, without the two systems needing to merge.
// ---------------------------------------------------------------------------

export const studentProfiles = pgTable(
  'student_profiles',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),
    dateOfBirth: timestamp('date_of_birth', { withTimezone: true }).notNull(),
    gradeOrYear: text('grade_or_year').notNull(),
    residentialAddress: text('residential_address').notNull(),
    requiresTransportation: boolean('requires_transportation').notNull().default(false),
    emergencyContactName: text('emergency_contact_name').notNull(),
    emergencyContactPhone: text('emergency_contact_phone').notNull(),
    emergencyContactRelation: text('emergency_contact_relation').notNull(),
    munExperience: text('mun_experience'),
    referralCode: text('referral_code'),
    // --- MUNHub_User_Workflow_PRD.md fields (2026-09-17) ---
    // All nullable/optional (except isPublicProfileVisible, which the PRD
    // requires to default off): deliberately NOT added to
    // lib/actions/student-profile.ts's `isProfileComplete` gate, so no
    // existing profile is retroactively marked incomplete.
    gender: text('gender'),
    preferredName: text('preferred_name'),
    nationality: text('nationality'),
    // One structured location, reused for both "Personal" (§9) and
    // "Contact" (§10) — the PRD lists City/State/Country under both
    // sections, which reads as the PRD's own duplication, not two
    // independent addresses.
    addressCity: text('address_city'),
    addressState: text('address_state'),
    addressCountry: text('address_country'),
    postalCode: text('postal_code'),
    alternateMobile: text('alternate_mobile'),
    courseOrProgram: text('course_or_program'),
    graduationYear: integer('graduation_year'),
    department: text('department'),
    studentId: text('student_id'),
    academicEmail: text('academic_email'),
    alternateEmergencyContactName: text('alternate_emergency_contact_name'),
    alternateEmergencyContactNumber: text('alternate_emergency_contact_number'),
    alternateEmergencyContactRelation: text('alternate_emergency_contact_relation'),
    hasPriorMunExperience: boolean('has_prior_mun_experience'),
    munsAttendedCount: integer('muns_attended_count'),
    // §13: "a structured free-text field is sufficient for the initial
    // implementation" — deliberately not the platform-native `achievements`
    // table below, which is a different concept (MUNHub-verified per-MUN
    // awards, Phase 2+ deferred). This is the participant's own self-reported
    // history from before/outside MUNHub.
    previousAchievements: text('previous_achievements'),
    bio: text('bio'),
    areasOfInterest: text('areas_of_interest').array(),
    languages: text('languages').array(),
    isPublicProfileVisible: boolean('is_public_profile_visible').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('student_profiles_user_id_idx').on(table.userId)],
)

export const studentProfilesRelations = relations(studentProfiles, ({ one }) => ({
  user: one(users, { fields: [studentProfiles.userId], references: [users.id] }),
}))

// ---------------------------------------------------------------------------
// user_consents — append-only record of ToS/Privacy/guardian consent
// (docs/prd/MUNHub_User_Workflow_PRD.md §15). A re-acceptance of a new
// policy version writes a NEW row rather than overwriting one, so the full
// consent history is preserved — same append-only convention as
// `verification_issues`/audit logs elsewhere in this schema. Never updated
// or deleted.
// ---------------------------------------------------------------------------

export const userConsents = pgTable(
  'user_consents',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    consentType: consentTypeEnum('consent_type').notNull(),
    policyVersion: text('policy_version').notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('user_consents_user_id_idx').on(table.userId)],
)

export const userConsentsRelations = relations(userConsents, ({ one }) => ({
  user: one(users, { fields: [userConsents.userId], references: [users.id] }),
}))

// ---------------------------------------------------------------------------
// password_reset_tokens — "forgot password" recovery flow. Single-use
// (`usedAt` set on consumption), 1-hour expiry (enforced in
// lib/actions/password-reset.ts, not the DB). Tokens are stored in plaintext,
// same convention `sessions.token` already uses — both are high-entropy
// random values from `crypto.randomBytes`, and this app has no other
// precedent for hashing at-rest tokens.
// ---------------------------------------------------------------------------

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('password_reset_tokens_user_id_idx').on(table.userId)],
)

export const passwordResetTokensRelations = relations(passwordResetTokens, ({ one }) => ({
  user: one(users, { fields: [passwordResetTokens.userId], references: [users.id] }),
}))

// ---------------------------------------------------------------------------
// email_verification_tokens — lib/actions/email-verification.ts. Unlike
// password_reset_tokens above (a known, separately-tracked gap), the raw
// token is NEVER stored — only its SHA-256 hash (`tokenHash`), so a DB leak
// alone can never be used to complete a verification. High-entropy random
// token (32 bytes), so a fast hash is the correct/intended choice here, not
// a slow KDF like lib/auth/password.ts's scrypt (that's for low-entropy
// user-chosen secrets, a different threat model).
// ---------------------------------------------------------------------------

export const emailVerificationTokens = pgTable(
  'email_verification_tokens',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('email_verification_tokens_user_id_idx').on(table.userId)],
)

export const emailVerificationTokensRelations = relations(emailVerificationTokens, ({ one }) => ({
  user: one(users, { fields: [emailVerificationTokens.userId], references: [users.id] }),
}))

// ---------------------------------------------------------------------------
// organizer_profiles — the one-time organizer onboarding wizard (profile, first
// MUN, payout UPI, agreement), 1:1 with an ORGANIZER user. See
// lib/actions/organizer-onboarding.ts. The UPI ID is a receiving address, so
// it is stored as entered and shown back to its owner. `completedAt` is set by
// the agreement step, which also submits the organizer application; a MUN
// application requires it.
// ---------------------------------------------------------------------------

export const organizerProfiles = pgTable('organizer_profiles', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  firstName: text('first_name'),
  lastName: text('last_name'),
  contactPhone: text('contact_phone'),
  // The organizer's first MUN, answered in the wizard and submitted as their
  // organizer application (organizer_applications) when the agreement is accepted.
  munName: text('mun_name'),
  munCity: text('mun_city'),
  munStartDate: timestamp('mun_start_date', { withTimezone: true }),
  expectedDelegateCount: integer('expected_delegate_count'),
  munDescription: text('mun_description'),
  previousEditions: text('previous_editions'),
  websiteUrl: text('website_url'),
  firstMunId: text('first_mun_id').references(() => muns.id, { onDelete: 'set null' }),
  upiId: text('upi_id'),
  upiPhone: text('upi_phone'),
  agreementVersion: text('agreement_version'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ---------------------------------------------------------------------------
// email_login_codes — the 6-digit codes behind passwordless organizer sign-in
// (lib/actions/organizer-otp.ts). Keyed by email rather than user because a
// code also verifies an address that has no account yet (organizer signup).
// Unlike reset tokens, a 6-digit code is low-entropy, so only a hash is
// stored and `attempts` caps guessing. Only the newest unconsumed row per
// email is ever valid; requesting a new code consumes the older ones.
// ---------------------------------------------------------------------------

export const emailLoginCodes = pgTable(
  'email_login_codes',
  {
    id: id(),
    email: text('email').notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('email_login_codes_email_created_at_idx').on(table.email, table.createdAt)],
)

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
// Staff TOTP two-factor auth (lib/actions/staff-mfa.ts). OPERATIONS/ADMIN/
// SUPER_ADMIN only, enforced by server/middleware/require-role.ts when
// REQUIRE_STAFF_2FA=true. Unlike mun_payment_settings (write-only —
// lib/crypto/field-encryption.ts), the TOTP secret genuinely needs decrypting
// on every code check, so it's the first real caller of decryptField, kept
// under its own key (TOTP_FIELD_KEY) rather than PAYMENT_FIELD_KEY so the two
// blast radii stay separate.
// ---------------------------------------------------------------------------

export const userMfa = pgTable('user_mfa', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  totpSecretCiphertext: text('totp_secret_ciphertext').notNull(),
  // Set once the enrolling user proves they can generate a valid code.
  // NULL = setup started but not finished; requireRole treats that the same
  // as "not enrolled".
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  // The last accepted 30s time-step counter, so the same code (or one from an
  // already-used step) can never be replayed.
  lastUsedStep: integer('last_used_step'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const userMfaRelations = relations(userMfa, ({ one }) => ({
  user: one(users, { fields: [userMfa.userId], references: [users.id] }),
}))

export const mfaRecoveryCodes = pgTable(
  'mfa_recovery_codes',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('mfa_recovery_codes_user_id_idx').on(table.userId)],
)

export const mfaRecoveryCodesRelations = relations(mfaRecoveryCodes, ({ one }) => ({
  user: one(users, { fields: [mfaRecoveryCodes.userId], references: [users.id] }),
}))

// The "password verified, TOTP still pending" step — mirrors
// password_reset_tokens/sessions: only the SHA-256 of the presented token is
// stored (lib/auth/opaque-token.ts), never the raw value. `attempts` mirrors
// email_login_codes' per-code guess counter — and summed across a user's
// recent rows it is also the *per-account* guess budget, so
// lib/actions/staff-mfa.ts writes a row here for a wrong code submitted on a
// path with no challenge of its own (disable / regenerate recovery codes).
// Those marker rows are written already-expired and already-consumed with a
// random token hash: they can never be redeemed, only counted. So a row here
// is not always a live sign-in attempt.
export const mfaPendingChallenges = pgTable(
  'mfa_pending_challenges',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('mfa_pending_challenges_user_id_idx').on(table.userId)],
)

export const mfaPendingChallengesRelations = relations(mfaPendingChallenges, ({ one }) => ({
  user: one(users, { fields: [mfaPendingChallenges.userId], references: [users.id] }),
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
  faqs: many(munFaqs),
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
    // Registration Types PRD (Slice 1, 2026-09-15) — see
    // docs/superpowers/specs/2026-09-15-registration-types-allocation-design.md.
    description: text('description'),
    allowsIndividual: boolean('allows_individual').notNull().default(true),
    allowsDelegation: boolean('allows_delegation').notNull().default(false),
    displayOrder: integer('display_order').notNull().default(0),
    eligibility: jsonb('eligibility'),
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
    // Client-supplied Idempotency-Key from POST /registrations: a retried
    // submit with the same key returns the original registration instead of
    // creating (or rejecting) a second one. Unique per user.
    idempotencyKey: text('idempotency_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('registrations_user_idempotency_key_uq')
      .on(table.userId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    index('registrations_mun_id_status_idx').on(table.munId, table.status),
    index('registrations_registration_product_id_status_idx').on(
      table.registrationProductId,
      table.status,
    ),
    index('registrations_user_id_idx').on(table.userId),
    // Admin reporting (lib/actions/admin-reporting.ts): registration trend and
    // the conversion funnel both filter/group a date range of createdAt.
    index('registrations_created_at_idx').on(table.createdAt),
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
    currency: text('currency').notNull().default('INR'),
    // Fee breakdown, computed server-side when the order is created (same
    // minor units as `amount`). `amount` is what the delegate pays; the
    // organizer is owed `organizerNetAmount` = amount - platformFee - tax.
    // Nullable: rows created before the fee model existed have no breakdown.
    platformFeeAmount: integer('platform_fee_amount'),
    platformFeeTaxAmount: integer('platform_fee_tax_amount'),
    organizerNetAmount: integer('organizer_net_amount'),
    status: paymentStatusEnum('status').notNull().default('CREATED'),
    // Payment exceptions (there are no refunds): money was taken but no valid
    // registration stands behind it — e.g. a payment that completed after the
    // seat hold expired. Set by the webhook, resolved manually by an admin.
    exceptionReason: text('exception_reason'),
    exceptionRaisedAt: timestamp('exception_raised_at', { withTimezone: true }),
    exceptionResolvedAt: timestamp('exception_resolved_at', { withTimezone: true }),
    exceptionResolvedBy: text('exception_resolved_by').references((): AnyPgColumn => users.id),
    exceptionResolutionNote: text('exception_resolution_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // getDelegateList (organizer-dashboard.ts) filters registrations joined to
  // payments by payments.status — needs this index once a mun has enough
  // delegates for the join+filter to matter.
  (table) => [
    index('payments_status_idx').on(table.status),
    index('payments_exception_open_idx')
      .on(table.exceptionRaisedAt)
      .where(sql`${table.exceptionReason} is not null and ${table.exceptionResolvedAt} is null`),
    // Admin reporting (lib/actions/admin-reporting.ts): revenue trend, the
    // payment funnel, and the platform fee summary all filter by status
    // together with a createdAt range.
    index('payments_status_created_at_idx').on(table.status, table.createdAt),
  ],
)

// ---------------------------------------------------------------------------
// payment_webhook_events — one row per provider event, so a redelivered or
// replayed webhook is recognised and ignored. Unique on (provider, event_id).
// ---------------------------------------------------------------------------

export const paymentWebhookEvents = pgTable(
  'payment_webhook_events',
  {
    id: id(),
    provider: text('provider').notNull(),
    eventId: text('event_id').notNull(),
    eventType: text('event_type'),
    providerOrderId: text('provider_order_id'),
    payloadSha256: text('payload_sha256').notNull(),
    outcome: text('outcome'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('payment_webhook_events_provider_event_id_uq').on(table.provider, table.eventId),
    index('payment_webhook_events_order_idx').on(table.providerOrderId),
  ],
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
// organizerApplications — one row per MUN an organizer applies to host (Gate 1).
// An organizer may host several MUNs, so organizer_id is not unique (migration
// 0030); mun_id still is — each MUN has exactly one application.
// ---------------------------------------------------------------------------

export const organizerApplications = pgTable(
  'organizer_applications',
  {
    id: id(),
    organizerId: text('organizer_id')
      .notNull()
      .references(() => users.id),
    munId: text('mun_id').unique().references(() => muns.id),
    status: applicationStatusEnum('status').notNull().default('SUBMITTED'),
    reviewNotes: text('review_notes'),
    // The organizer's answers that have no home on the mun row (migration
    // 0032), kept so the Gate-1 reviewer can see them.
    expectedDelegateCount: integer('expected_delegate_count'),
    previousEditions: text('previous_editions'),
    websiteUrl: text('website_url'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('organizer_applications_organizer_id_idx').on(table.organizerId)],
)

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
// mun_submissions — Onboarding go-live pipeline (Task 10). See
// docs/superpowers/specs/2026-09-14-onboarding-go-live-pipeline-design.md
// Section 5.1. One row per submission attempt; `submitMunForReview`
// (lib/lifecycle/go-live.ts) is the only writer of new rows.
//
// The partial unique index below — NOT a plain unique on munId — is THE
// structural fix for the double-submit race, per this project's own memory
// note (CLAUDE.md: "DB unique constraint is the right next fix" after the
// withdrawn refund workflow's unresolved double-refund race). A plain unique
// on munId would permanently break resubmission after a mun is ever
// published/rejected/withdrawn once, so it must stay partial.
// ---------------------------------------------------------------------------

export const munSubmissions = pgTable(
  'mun_submissions',
  {
    id: id(),
    munId: text('mun_id')
      .notNull()
      .references(() => muns.id, { onDelete: 'cascade' }),
    submittedBy: text('submitted_by')
      .notNull()
      .references(() => users.id),
    versionNumber: integer('version_number').notNull(),
    status: submissionStatusEnum('status').notNull().default('SUBMITTED'),
    progressPercentage: integer('progress_percentage').notNull().default(0),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    reviewStartedAt: timestamp('review_started_at', { withTimezone: true }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    queuedAt: timestamp('queued_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    slaDeadline: timestamp('sla_deadline', { withTimezone: true }).notNull(),
    slaState: slaStateEnum('sla_state').notNull().default('ON_TRACK'),
    slaPausedAt: timestamp('sla_paused_at', { withTimezone: true }),
    slaPausedTotalMs: integer('sla_paused_total_ms').notNull().default(0),
    reviewerId: text('reviewer_id').references(() => users.id),
    munVersionId: text('mun_version_id').references((): AnyPgColumn => munVersions.id),
    publishIdempotencyKey: text('publish_idempotency_key'),
    rejectionReason: text('rejection_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('mun_submissions_mun_id_idx').on(table.munId),
    index('mun_submissions_sla_state_idx').on(table.slaState),
    index('mun_submissions_status_idx').on(table.status),
    uniqueIndex('mun_submissions_publish_idempotency_key_uq').on(table.publishIdempotencyKey),
    // THE partial-unique constraint: one active (non-terminal) submission per
    // mun. Terminal statuses (PUBLISHED/REJECTED/WITHDRAWN) are excluded from
    // the predicate so a mun can be resubmitted after any of those. Verify
    // the generated migration SQL actually carries this WHERE clause — see
    // the file header comment above.
    uniqueIndex('mun_submissions_active_per_mun_uq')
      .on(table.munId)
      .where(sql`status NOT IN ('PUBLISHED','REJECTED','WITHDRAWN')`),
  ],
)

export const munSubmissionsRelations = relations(munSubmissions, ({ one }) => ({
  mun: one(muns, { fields: [munSubmissions.munId], references: [muns.id] }),
  submitter: one(users, { fields: [munSubmissions.submittedBy], references: [users.id] }),
  reviewer: one(users, { fields: [munSubmissions.reviewerId], references: [users.id] }),
  munVersion: one(munVersions, { fields: [munSubmissions.munVersionId], references: [munVersions.id] }),
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
    // Chat-thread additions (support widget). `lastMessageAt` is denormalized
    // purely for sorting a user's/admin's conversation list by recent
    // activity without joining support_messages; the two `*ReadAt` columns
    // back the unread-badge count on each side of the conversation — a
    // message strictly after the reader's own `*ReadAt` is unread to them.
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    // Denormalized alongside lastMessageAt so unread state is a plain id/time
    // comparison against `createdBy` (no join to support_messages, no role
    // check needed — anyone who can send at all besides the requester is
    // necessarily staff): requester-unread if this isn't `createdBy` and is
    // newer than requesterReadAt; admin-unread if it IS `createdBy` and is
    // newer than adminReadAt.
    lastMessageSenderId: text('last_message_sender_id').references(() => users.id),
    requesterReadAt: timestamp('requester_read_at', { withTimezone: true }),
    adminReadAt: timestamp('admin_read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('support_tickets_status_idx').on(table.status),
    index('support_tickets_assigned_to_idx').on(table.assignedTo),
    index('support_tickets_created_by_idx').on(table.createdBy),
  ],
)

export const supportTicketsRelations = relations(supportTickets, ({ one, many }) => ({
  creator: one(users, { fields: [supportTickets.createdBy], references: [users.id] }),
  assignee: one(users, { fields: [supportTickets.assignedTo], references: [users.id] }),
  registration: one(registrations, {
    fields: [supportTickets.relatedRegistrationId],
    references: [registrations.id],
  }),
  mun: one(muns, { fields: [supportTickets.relatedMunId], references: [muns.id] }),
  messages: many(supportMessages),
}))

// ---------------------------------------------------------------------------
// support_messages — the chat thread behind a support_tickets row. One row
// per message; `senderRole` snapshots the sender's role at send time (not a
// join to `users.role`) so a later role change never rewrites who "spoke as"
// what in ticket history the same way `mun_versions` snapshots content
// instead of re-deriving it live.
// ---------------------------------------------------------------------------

export const supportMessages = pgTable(
  'support_messages',
  {
    id: id(),
    ticketId: text('ticket_id')
      .notNull()
      .references(() => supportTickets.id, { onDelete: 'cascade' }),
    senderId: text('sender_id')
      .notNull()
      .references(() => users.id),
    senderRole: roleEnum('sender_role').notNull(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('support_messages_ticket_id_idx').on(table.ticketId, table.createdAt)],
)

export const supportMessagesRelations = relations(supportMessages, ({ one }) => ({
  ticket: one(supportTickets, { fields: [supportMessages.ticketId], references: [supportTickets.id] }),
  sender: one(users, { fields: [supportMessages.senderId], references: [users.id] }),
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
    institution: text('institution'),
    organization: text('organization'),
    socialLinks: jsonb('social_links'),
    isPublic: boolean('is_public').notNull().default(true),
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

// mun_faqs (FAQS, PRD Section 24)
export const munFaqs = pgTable(
  'mun_faqs',
  {
    id: id(),
    munId: text('mun_id').notNull().references(() => muns.id, { onDelete: 'cascade' }),
    question: text('question').notNull(),
    answer: text('answer').notNull(),
    displayOrder: integer('display_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('mun_faqs_mun_id_idx').on(table.munId)],
)

export const munFaqsRelations = relations(munFaqs, ({ one }) => ({
  mun: one(muns, { fields: [munFaqs.munId], references: [muns.id] }),
}))
