import { describe, it, expect } from 'vitest'
import { validateRulesDocuments, validateSchedule, validateAccommodation, validateFinalReview } from './operations'
import { makeContext } from './test-helpers'
import type { MunDocumentKind } from '@/lib/db/schema-enums'

function document(kind: MunDocumentKind) {
  return {
    id: `doc-${kind}`,
    munId: 'mun-1',
    kind,
    title: kind,
    url: `https://example.com/${kind}.pdf`,
    storageKey: kind,
    contentType: 'application/pdf',
    sizeBytes: 100,
    createdAt: new Date(),
  } as never
}

function scheduleItem() {
  return {
    id: 'schedule-1',
    munId: 'mun-1',
    committeeId: null,
    title: 'Opening Ceremony',
    kind: 'OPENING_CEREMONY',
    startsAt: new Date('2027-06-10T09:00:00Z'),
    endsAt: new Date('2027-06-10T10:00:00Z'),
    location: null,
    displayOrder: 0,
    createdAt: new Date(),
  } as never
}

function accommodationOption(overrides: Partial<{ price: number | null; capacity: number | null; status: string }> = {}) {
  return {
    id: 'option-1',
    munId: 'mun-1',
    name: 'Standard Room',
    price: overrides.price === undefined ? 500 : overrides.price,
    capacity: overrides.capacity === undefined ? 10 : overrides.capacity,
    description: null,
    status: overrides.status ?? 'active',
    createdAt: new Date(),
  } as never
}

function issue(overrides: Partial<{ severity: string; resolved: boolean }> = {}) {
  return {
    id: 'issue-1',
    munId: 'mun-1',
    moduleName: 'COMMITTEES',
    severity: overrides.severity ?? 'BLOCKER',
    reason: 'Some issue',
    previousValue: null,
    newValue: null,
    resolved: overrides.resolved ?? false,
    raisedBy: 'user-1',
    code: null,
    fieldKey: null,
    source: 'AUTOMATED',
    createdAt: new Date(),
    resolvedAt: null,
  } as never
}

describe('validateRulesDocuments', () => {
  it('passes when RULES and CODE_OF_CONDUCT are present', () => {
    const ctx = makeContext({ documents: [document('RULES'), document('CODE_OF_CONDUCT')] })
    const result = validateRulesDocuments(ctx)
    expect(result.moduleKey).toBe('RULES_DOCUMENTS')
    expect(result.passed).toBe(true)
  })

  it('fails when RULES is missing, and says which document to upload', () => {
    const ctx = makeContext({ documents: [document('CODE_OF_CONDUCT')] })
    const result = validateRulesDocuments(ctx)
    expect(result.passed).toBe(false)
    expect(result.checks[0].message).toBe('Upload your rules of procedure.')
  })

  it('fails when CODE_OF_CONDUCT is missing', () => {
    const ctx = makeContext({ documents: [document('RULES')] })
    const result = validateRulesDocuments(ctx)
    expect(result.passed).toBe(false)
  })

  // Rows written while no storage backend was configured point at the mock
  // store, which kept no bytes — the row exists but the PDF does not.
  it('fails when a required document only points at the discarding mock store', () => {
    const discarded = { ...(document('RULES') as object), url: '/mock-storage/muns/mun-1/documents/a' } as never
    const ctx = makeContext({ documents: [discarded, document('CODE_OF_CONDUCT')] })
    const result = validateRulesDocuments(ctx)
    expect(result.passed).toBe(false)
    expect(result.checks[0].message).toBe(
      'Upload your rules of procedure again — the earlier upload was not stored.',
    )
  })

  it('does not require a refund policy (MUN Hub has no refunds)', () => {
    const ctx = makeContext({ documents: [document('RULES'), document('CODE_OF_CONDUCT')] })
    expect(validateRulesDocuments(ctx).checks.map((check) => check.label).join(' ')).not.toMatch(/refund/i)
  })

  it('fails when no documents exist at all', () => {
    const ctx = makeContext({ documents: [] })
    const result = validateRulesDocuments(ctx)
    expect(result.passed).toBe(false)
  })

  it('extra document kinds (e.g. BROCHURE) do not affect the outcome', () => {
    const ctx = makeContext({
      documents: [document('RULES'), document('CODE_OF_CONDUCT'), document('REFUND_POLICY'), document('BROCHURE')],
    })
    const result = validateRulesDocuments(ctx)
    expect(result.passed).toBe(true)
  })

  it('treats a document whose file was never stored (mock-storage URL) as missing', () => {
    const lostRules = { ...(document('RULES') as object), url: '/mock-storage/muns/mun-1/documents/x' } as never
    const ctx = makeContext({ documents: [lostRules, document('CODE_OF_CONDUCT')] })
    const result = validateRulesDocuments(ctx)
    expect(result.passed).toBe(false)
    expect(result.checks[0].message).toBe('Upload your rules of procedure.')
  })
})

describe('validateSchedule', () => {
  it('passes when at least one schedule item exists', () => {
    const ctx = makeContext({ scheduleItems: [scheduleItem()] })
    const result = validateSchedule(ctx)
    expect(result.moduleKey).toBe('SCHEDULE')
    expect(result.passed).toBe(true)
  })

  it('fails when there are zero schedule items', () => {
    const ctx = makeContext({ scheduleItems: [] })
    const result = validateSchedule(ctx)
    expect(result.passed).toBe(false)
  })
})

describe('validateAccommodation', () => {
  it('passes trivially when accommodationProvided is NOT_PROVIDED, regardless of options', () => {
    const ctx = makeContext({ mun: { accommodationProvided: 'NOT_PROVIDED' }, accommodationOptions: [] })
    const result = validateAccommodation(ctx)
    expect(result.moduleKey).toBe('ACCOMMODATION')
    expect(result.passed).toBe(true)
  })

  it('passes when PROVIDED and at least one active option has both price and capacity', () => {
    const ctx = makeContext({ mun: { accommodationProvided: 'PROVIDED' }, accommodationOptions: [accommodationOption()] })
    const result = validateAccommodation(ctx)
    expect(result.passed).toBe(true)
  })

  it('fails when PROVIDED but there are zero active options', () => {
    const ctx = makeContext({
      mun: { accommodationProvided: 'PROVIDED' },
      accommodationOptions: [accommodationOption({ status: 'inactive' })],
    })
    const result = validateAccommodation(ctx)
    expect(result.passed).toBe(false)
    expect(result.checks.find((c) => c.key === 'at_least_one_active_option')?.passed).toBe(false)
  })

  it('fails when an active option is missing a price', () => {
    const ctx = makeContext({
      mun: { accommodationProvided: 'PROVIDED' },
      accommodationOptions: [accommodationOption({ price: null })],
    })
    const result = validateAccommodation(ctx)
    expect(result.passed).toBe(false)
    expect(result.checks.find((c) => c.key === 'every_option_has_price')?.passed).toBe(false)
  })

  it('fails when an active option is missing a capacity', () => {
    const ctx = makeContext({
      mun: { accommodationProvided: 'PROVIDED' },
      accommodationOptions: [accommodationOption({ capacity: null })],
    })
    const result = validateAccommodation(ctx)
    expect(result.passed).toBe(false)
    expect(result.checks.find((c) => c.key === 'every_option_has_capacity')?.passed).toBe(false)
  })

  it('fails when accommodationProvided is null (organizer has not answered yet)', () => {
    const ctx = makeContext({ mun: { accommodationProvided: null }, accommodationOptions: [] })
    const result = validateAccommodation(ctx)
    expect(result.passed).toBe(false)
  })
})

describe('validateFinalReview', () => {
  it('passes when there are zero unresolved BLOCKER issues', () => {
    const ctx = makeContext({ unresolvedIssues: [] })
    const result = validateFinalReview(ctx)
    expect(result.moduleKey).toBe('FINAL_REVIEW')
    expect(result.passed).toBe(true)
  })

  it('fails when at least one unresolved BLOCKER issue exists', () => {
    const ctx = makeContext({ unresolvedIssues: [issue({ severity: 'BLOCKER' })] })
    const result = validateFinalReview(ctx)
    expect(result.passed).toBe(false)
  })

  it('passes when the only issues are non-BLOCKER severity', () => {
    const ctx = makeContext({ unresolvedIssues: [issue({ severity: 'HIGH' }), issue({ severity: 'MEDIUM' })] })
    const result = validateFinalReview(ctx)
    expect(result.passed).toBe(true)
  })
})
