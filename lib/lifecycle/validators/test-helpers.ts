import type { MunValidationContext } from '../validation'
import type { Mun } from '@/lib/types/mun'

// -----------------------------------------------------------------------------
// test-helpers.ts — literal MunValidationContext factory for validator unit
// tests. Zero DB: every validator test in lib/lifecycle/validators/*.test.ts
// constructs its context by hand via `makeContext`, per the task brief's
// explicit "test the validators with LITERAL context objects" instruction.
// -----------------------------------------------------------------------------

const FIXED_NOW = new Date('2027-01-01T00:00:00Z')

function defaultMun(): Mun {
  return {
    id: 'mun-1',
    organizerId: 'organizer-1',
    name: 'Test MUN',
    slug: 'test-mun',
    edition: '2027',
    theme: null,
    description: 'A'.repeat(25),
    startDate: new Date('2027-06-10T00:00:00Z'),
    endDate: new Date('2027-06-12T00:00:00Z'),
    venue: 'Grand Hall',
    city: 'Hyderabad',
    country: 'India',
    conferenceType: null,
    targetParticipantType: null,
    addressLine1: '123 Main St',
    addressState: null,
    postalCode: null,
    mapUrl: null,
    registrationOpensAt: new Date('2027-01-01T00:00:00Z'),
    registrationDeadline: new Date('2027-06-01T00:00:00Z'),
    accommodationProvided: 'NOT_PROVIDED',
    status: 'ONBOARDING',
    publishedAt: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  }
}

/**
 * Builds a fully-populated, PASSING `MunValidationContext` by default —
 * every field wired to satisfy every validator — then applies shallow
 * per-key overrides. `mun` merges shallowly against the default `Mun` shape
 * so tests can override just the fields relevant to one check (e.g.
 * `{ mun: { startDate: null } }`) without re-specifying every column.
 */
export function makeContext(overrides: Partial<Omit<MunValidationContext, 'mun'>> & { mun?: Partial<Mun> } = {}): MunValidationContext {
  const { mun: munOverrides, ...rest } = overrides

  return {
    now: FIXED_NOW,
    stage: 'SUBMIT',
    mun: { ...defaultMun(), ...munOverrides },
    organizerApplication: { id: 'app-1', organizerId: 'organizer-1', munId: 'mun-1', status: 'APPROVED', reviewNotes: null, submittedAt: FIXED_NOW } as MunValidationContext['organizerApplication'],
    committees: [],
    portfolios: [],
    registrationProducts: [],
    ebMembers: [],
    formFields: [],
    paymentSettings: null,
    organizerPaymentLinked: true,
    documents: [],
    scheduleItems: [],
    contact: null,
    media: [],
    accommodationOptions: [],
    accommodationOptionFields: [],
    moduleRows: [],
    unresolvedIssues: [],
    ...rest,
  }
}
