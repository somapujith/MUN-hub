import { eq } from 'drizzle-orm'

// -----------------------------------------------------------------------------
// seed-go-live-modules — Task 13 Step 1: full 15-module demo data for the two
// generic demo MUNs (Oxford MUN 2027, VIT MUN 2027) only.
// -----------------------------------------------------------------------------
//
// Split out of lib/db/seed.ts to keep that file under the project's 200-400
// line guideline once this module's worth of seed data is added. Deliberately
// NOT applied to the 6 real Hyderabad conferences (see CLAUDE.md): those have
// real names/dates/committees researched via web search, and inventing fake
// executive board members or bank/payment details for a real organization
// would misrepresent it. A realistic ACTION_REQUIRED state (7 modules already
// covered by lib/db/seed.ts's base seedMun — COMMITTEES, PORTFOLIOS,
// REGISTRATION_TYPES, PRICING_CAPACITY — plus whatever BASIC_INFO/DATES_VENUE
// checks already pass from seedMun's own mun/committee/product inserts — vs.
// eight identical green dashboards) is better demo material, and is what
// seedMun already produces unassisted for those 6.
//
// Idempotency: every insert here is guarded by an existence check scoped to
// the mun (or, for mun_form_fields/mun_contacts/organizer_applications, the
// relevant unique constraint via onConflictDoNothing) so re-running
// `npm run db:seed` against an already-seeded DB is a no-op for this module's
// data, matching the existing guarantee documented in lib/db/seed.ts and
// CLAUDE.md. Every onConflictDoNothing call below chains `.returning()` and
// logs conditionally on the returned row count (not unconditionally after the
// call) — an onConflictDoNothing that no-ops still resolves successfully with
// an empty array, so an unconditional log after it would misreport "seeded"
// on every re-run even when nothing was written.
//
// Payment settings ciphertext: this file deliberately does NOT import
// lib/crypto/field-encryption.ts's `encryptField`. That module's `loadKey()`
// throws at import time if `PAYMENT_FIELD_KEY` is not set, and this repo's
// live `.env` (Neon, which `npm run db:seed` reads) does not define that var
// — only `.env.test` does. Real payment rows are written exclusively through
// lib/actions/payment-settlement.ts's `upsertPaymentSettings`, which does
// real AES-256-GCM encryption; this seed writes directly to the table (same
// pattern lib/db/seed.ts already uses for every other table) with obviously
// fake, fixed-format placeholder ciphertext strings that are never decrypted
// by any code path (see field-encryption.ts's module docstring: there is no
// decrypt-and-return action in this codebase). This is fictional demo data
// for a fictional demo organizer, consistent with the rest of this file.

type SchemaModule = typeof import('./schema')
type ClientModule = typeof import('./client')
type Db = ClientModule['db']

export interface GoLiveModuleTables {
  munMedia: SchemaModule['munMedia']
  munExecutiveBoard: SchemaModule['munExecutiveBoard']
  munFormFields: SchemaModule['munFormFields']
  munPaymentSettings: SchemaModule['munPaymentSettings']
  munDocuments: SchemaModule['munDocuments']
  munScheduleItems: SchemaModule['munScheduleItems']
  munContacts: SchemaModule['munContacts']
  organizerApplications: SchemaModule['organizerApplications']
}

type CommitteeRow = SchemaModule['committees']['$inferSelect']

interface SeedFullGoLiveModulesArgs {
  db: Db
  tables: GoLiveModuleTables
  munId: string
  munName: string
  organizerId: string
  committees: CommitteeRow[]
}

/**
 * Placeholder ciphertext strings shaped like `field-encryption.ts`'s real
 * output (`base64(iv):base64(authTag):base64(ciphertext)`) but NOT produced
 * by AES-256-GCM and NOT decryptable — pure cosmetic placeholders for demo
 * data. Fixed (not randomly generated per run) so re-seeding is deterministic
 * and idempotency checks stay simple.
 */
const FAKE_PAN_CIPHERTEXT = 'ZmFrZS1pdi0xMg==:ZmFrZS10YWctMTY=:ZmFrZS1jaXBoZXJ0ZXh0LXBhbi1wbGFjZWhvbGRlcg=='
const FAKE_ACCOUNT_CIPHERTEXT = 'ZmFrZS1pdi0yMg==:ZmFrZS10YWctMjY=:ZmFrZS1jaXBoZXJ0ZXh0LWFjY3QtcGxhY2Vob2xkZXI='

/**
 * Seeds all 7 net-new go-live module tables (branding, executive board, form
 * fields, payment settlement, documents, schedule, contact) plus an APPROVED
 * organizer application, for ONE mun. Called only for Oxford MUN 2027 and VIT
 * MUN 2027 from lib/db/seed.ts — see that file's MUN_SEEDS entries and
 * this file's module docstring for why the 6 real Hyderabad conferences are
 * deliberately excluded.
 *
 * Every sub-step is independently idempotent (existence-checked or
 * onConflictDoNothing), so calling this again on an already-seeded mun is a
 * safe no-op for each table individually — matches the "re-running db:seed
 * must be safe" guarantee already documented for the rest of this file.
 */
export async function seedFullGoLiveModules({
  db,
  tables,
  munId,
  munName,
  organizerId,
  committees,
}: SeedFullGoLiveModulesArgs): Promise<void> {
  const { munMedia, munExecutiveBoard, munFormFields, munPaymentSettings, munDocuments, munScheduleItems, munContacts, organizerApplications } =
    tables

  // --- BRANDING: mun_media LOGO + COVER -------------------------------------
  const [existingMedia] = await db.select({ id: munMedia.id }).from(munMedia).where(eq(munMedia.munId, munId)).limit(1)
  if (!existingMedia) {
    await db.insert(munMedia).values([
      {
        munId,
        kind: 'LOGO',
        url: `https://placehold.co/400x400?text=${encodeURIComponent(munName)}+Logo`,
        storageKey: `seed/${munId}/logo.png`,
        contentType: 'image/png',
        sizeBytes: 24_576,
        displayOrder: 0,
      },
      {
        munId,
        kind: 'COVER',
        url: `https://placehold.co/1600x600?text=${encodeURIComponent(munName)}+Cover`,
        storageKey: `seed/${munId}/cover.png`,
        contentType: 'image/png',
        sizeBytes: 131_072,
        displayOrder: 0,
      },
    ])
    console.log('    - Seeded branding (LOGO + COVER)')
  }

  // --- EXECUTIVE_BOARD: one Secretary-General + one Chair per committee ----
  const [existingEb] = await db
    .select({ id: munExecutiveBoard.id })
    .from(munExecutiveBoard)
    .where(eq(munExecutiveBoard.munId, munId))
    .limit(1)
  if (!existingEb) {
    const ebValues = [
      {
        munId,
        committeeId: null,
        name: 'Secretary-General (Demo)',
        role: 'DIRECTOR' as const,
        customRole: null,
        photoUrl: null,
        bio: 'Presides over the conference as a whole.',
        displayOrder: 0,
      },
      ...committees.map((committee, index) => ({
        munId,
        committeeId: committee.id,
        name: `Chair, ${committee.name} (Demo)`,
        role: 'CHAIR' as const,
        customRole: null,
        photoUrl: null,
        bio: `Chairs the ${committee.name} committee.`,
        displayOrder: index + 1,
      })),
    ]
    await db.insert(munExecutiveBoard).values(ebValues)
    console.log(`    - Seeded executive board (1 Secretary-General + ${committees.length} Chair(s))`)
  }

  // --- REGISTRATION_FORM: a couple of form fields ---------------------------
  const insertedFormFields = await db
    .insert(munFormFields)
    .values([
      {
        munId,
        fieldKey: 'institution_name',
        fieldType: 'INSTITUTION',
        label: 'Institution Name',
        helpText: 'The school or university you represent.',
        required: true,
        choices: null,
        displayOrder: 0,
        conditionalOn: null,
        conditionalOperator: null,
        conditionalValue: null,
      },
      {
        munId,
        fieldKey: 'mun_experience',
        fieldType: 'MUN_EXPERIENCE',
        label: 'Prior MUN Experience',
        helpText: 'Roughly how many MUN conferences have you attended?',
        required: false,
        choices: JSON.stringify(['None', '1-2', '3-5', '6+']),
        displayOrder: 1,
        conditionalOn: null,
        conditionalOperator: null,
        conditionalValue: null,
      },
    ])
    .onConflictDoNothing({ target: [munFormFields.munId, munFormFields.fieldKey] })
    .returning({ id: munFormFields.id })
  if (insertedFormFields.length > 0) {
    console.log(`    - Seeded ${insertedFormFields.length} registration form field(s)`)
  }

  // --- PAYMENT_SETTLEMENT: complete row, fake ciphertext, VERIFIED ---------
  const [existingPayment] = await db
    .select({ id: munPaymentSettings.id })
    .from(munPaymentSettings)
    .where(eq(munPaymentSettings.munId, munId))
    .limit(1)
  if (!existingPayment) {
    await db.insert(munPaymentSettings).values({
      munId,
      legalName: `${munName} Organizing Society`,
      orgType: 'EDUCATIONAL_INSTITUTION',
      addressLine1: '1 Demo Campus Road',
      addressLine2: null,
      city: 'Demo City',
      state: 'Demo State',
      postalCode: '000000',
      panLast4: '9999',
      panCiphertext: FAKE_PAN_CIPHERTEXT,
      gstin: null,
      authorizedRepName: 'Demo Authorized Representative',
      authorizedRepEmail: 'finance@munhub.test',
      accountHolderName: `${munName} Organizing Society`,
      bankName: 'Demo National Bank',
      accountNumberLast4: '4321',
      accountNumberCiphertext: FAKE_ACCOUNT_CIPHERTEXT,
      ifsc: 'DEMO0001234',
      accountType: 'CURRENT',
      gateway: 'RAZORPAY',
      currency: 'INR',
      refundPolicy: 'Full refund up to 14 days before the conference; no refunds thereafter.',
      settlementNotes: 'Seeded demo settlement configuration — fake ciphertext, never decrypted by any code path.',
      verificationState: 'VERIFIED',
      verifiedAt: new Date(),
      verifiedBy: null,
    })
    console.log('    - Seeded payment settlement (VERIFIED, fake ciphertext)')
  }

  // --- RULES_DOCUMENTS: RULES, CODE_OF_CONDUCT (no refunds, so no refund policy)
  const [existingDoc] = await db.select({ id: munDocuments.id }).from(munDocuments).where(eq(munDocuments.munId, munId)).limit(1)
  if (!existingDoc) {
    const docSeeds: { kind: 'RULES' | 'CODE_OF_CONDUCT'; title: string }[] = [
      { kind: 'RULES', title: 'Rules of Procedure' },
      { kind: 'CODE_OF_CONDUCT', title: 'Delegate Code of Conduct' },
    ]
    await db.insert(munDocuments).values(
      docSeeds.map((docSeed) => ({
        munId,
        kind: docSeed.kind,
        title: docSeed.title,
        url: `https://placehold.co/documents/${munId}/${docSeed.kind.toLowerCase()}.pdf`,
        storageKey: `seed/${munId}/documents/${docSeed.kind.toLowerCase()}.pdf`,
        contentType: 'application/pdf',
        sizeBytes: 65_536,
      })),
    )
    console.log(`    - Seeded ${docSeeds.length} required documents`)
  }

  // --- SCHEDULE: a handful of items spanning the conference ----------------
  const [existingSchedule] = await db
    .select({ id: munScheduleItems.id })
    .from(munScheduleItems)
    .where(eq(munScheduleItems.munId, munId))
    .limit(1)
  if (!existingSchedule) {
    const day1 = new Date('2027-03-10T09:00:00Z')
    const hour = (h: number) => new Date(day1.getTime() + h * 60 * 60 * 1000)
    await db.insert(munScheduleItems).values([
      {
        munId,
        committeeId: null,
        title: 'Opening Ceremony',
        kind: 'OPENING_CEREMONY',
        startsAt: hour(0),
        endsAt: hour(1),
        location: 'Main Auditorium',
        displayOrder: 0,
      },
      {
        munId,
        committeeId: committees[0]?.id ?? null,
        title: 'Committee Session I',
        kind: 'COMMITTEE_SESSION',
        startsAt: hour(1.5),
        endsAt: hour(4.5),
        location: 'Committee Rooms',
        displayOrder: 1,
      },
      {
        munId,
        committeeId: null,
        title: 'Lunch Break',
        kind: 'LUNCH',
        startsAt: hour(4.5),
        endsAt: hour(5.5),
        location: 'Dining Hall',
        displayOrder: 2,
      },
      {
        munId,
        committeeId: null,
        title: 'Closing Ceremony',
        kind: 'CLOSING_CEREMONY',
        startsAt: hour(48),
        endsAt: hour(49),
        location: 'Main Auditorium',
        displayOrder: 3,
      },
    ])
    console.log('    - Seeded schedule (4 items)')
  }

  // --- CONTACT ---------------------------------------------------------------
  const insertedContact = await db
    .insert(munContacts)
    .values({
      munId,
      officialEmail: `contact-${munId.slice(0, 8)}@munhub.test`,
      phone: '+91 90000 00000',
      website: null,
      socialLinks: null,
      contactPersonName: 'Demo Contact Person',
      contactPersonRole: 'Secretary-General',
      contactPersonEmail: `secgen-${munId.slice(0, 8)}@munhub.test`,
      contactPersonPhone: '+91 90000 00001',
    })
    .onConflictDoNothing({ target: munContacts.munId })
    .returning({ id: munContacts.id })
  if (insertedContact.length > 0) {
    console.log('    - Seeded contact')
  }

  // --- Gate 1: an APPROVED organizer application ----------------------------
  // Purely informational (validateBasicInfo's `organizer_approved` check is
  // HIGH severity, not BLOCKER — see lib/lifecycle/validators/content.ts), but
  // seeding it makes these two demo MUNs read as a fully onboarded organizer
  // end to end rather than one still waiting on a Gate-1 admin decision.
  const insertedApplication = await db
    .insert(organizerApplications)
    .values({
      organizerId,
      munId,
      status: 'APPROVED',
      reviewNotes: 'Seeded as pre-approved demo data.',
    })
    // mun_id is the unique key (an organizer can have several applications, migration 0030).
    .onConflictDoNothing({ target: organizerApplications.munId })
    .returning({ id: organizerApplications.id })
  if (insertedApplication.length > 0) {
    console.log('    - Seeded organizer application (APPROVED)')
  }
}
