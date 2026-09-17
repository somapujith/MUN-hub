import { describe, it, expect } from 'vitest'
import { validateCommittees, validatePortfolios, validateExecutiveBoard } from './committees'
import { makeContext } from './test-helpers'

function committee(overrides: Partial<{ id: string; name: string; agenda: string | null; capacity: number }> = {}) {
  return {
    id: overrides.id ?? 'committee-1',
    munId: 'mun-1',
    name: overrides.name ?? 'UNSC',
    agenda: 'agenda' in overrides ? overrides.agenda : 'Maintaining peace',
    description: null,
    capacity: overrides.capacity ?? 20,
    committeeType: null,
    portfoliosEnabled: true,
    createdAt: new Date(),
  } as never
}

function portfolio(overrides: Partial<{ id: string; committeeId: string; name: string; availability: number }> = {}) {
  return {
    id: overrides.id ?? 'portfolio-1',
    committeeId: overrides.committeeId ?? 'committee-1',
    name: overrides.name ?? 'United States',
    type: null,
    availability: overrides.availability ?? 1,
    description: null,
    restrictions: null,
    createdAt: new Date(),
  } as never
}

function ebMember(overrides: Partial<{ committeeId: string | null; role: string }> = {}) {
  return {
    id: 'eb-1',
    munId: 'mun-1',
    committeeId: 'committeeId' in overrides ? overrides.committeeId : 'committee-1',
    name: 'Chair One',
    role: overrides.role ?? 'CHAIR',
    customRole: null,
    photoUrl: null,
    bio: null,
    displayOrder: 0,
    createdAt: new Date(),
  } as never
}

describe('validateCommittees', () => {
  it('passes with at least one committee, agenda set, capacity positive', () => {
    const ctx = makeContext({ committees: [committee()] })
    const result = validateCommittees(ctx)
    expect(result.moduleKey).toBe('COMMITTEES')
    expect(result.passed).toBe(true)
  })

  it('fails when there are zero committees', () => {
    const ctx = makeContext({ committees: [] })
    const result = validateCommittees(ctx)
    expect(result.passed).toBe(false)
    expect(result.checks.find((c) => c.key === 'at_least_one_committee')?.passed).toBe(false)
  })

  it('flags (but does not block on) an empty agenda', () => {
    const ctx = makeContext({ committees: [committee({ agenda: '' })] })
    const result = validateCommittees(ctx)
    const check = result.checks.find((c) => c.key === 'every_committee_has_agenda')
    expect(check?.passed).toBe(false)
    expect(check?.severity).toBe('MEDIUM')
    expect(result.passed).toBe(true)
  })

  it('fails when a committee has a null agenda', () => {
    const ctx = makeContext({ committees: [committee({ agenda: null })] })
    const result = validateCommittees(ctx)
    expect(result.checks.find((c) => c.key === 'every_committee_has_agenda')?.passed).toBe(false)
  })

  it('fails when a committee has non-positive capacity', () => {
    const ctx = makeContext({ committees: [committee({ capacity: 0 })] })
    const result = validateCommittees(ctx)
    expect(result.passed).toBe(false)
    expect(result.checks.find((c) => c.key === 'every_committee_has_capacity')?.passed).toBe(false)
  })
})

describe('validatePortfolios', () => {
  it('passes when every committee has at least one available portfolio and no duplicate names', () => {
    const ctx = makeContext({
      committees: [committee()],
      portfolios: [portfolio()],
    })
    const result = validatePortfolios(ctx)
    expect(result.moduleKey).toBe('PORTFOLIOS')
    expect(result.passed).toBe(true)
  })

  it('passes trivially when there are no committees (owned by COMMITTEES module instead)', () => {
    const ctx = makeContext({ committees: [], portfolios: [] })
    const result = validatePortfolios(ctx)
    expect(result.passed).toBe(true)
  })

  it('flags (but does not block on) a committee with zero portfolios', () => {
    const ctx = makeContext({ committees: [committee()], portfolios: [] })
    const result = validatePortfolios(ctx)
    const check = result.checks.find((c) => c.key === 'available_portfolio_per_committee')
    expect(check?.passed).toBe(false)
    expect(check?.severity).toBe('MEDIUM')
    expect(result.passed).toBe(true)
  })

  it('fails when a committee has portfolios but none are available (availability 0)', () => {
    const ctx = makeContext({
      committees: [committee()],
      portfolios: [portfolio({ availability: 0 })],
    })
    const result = validatePortfolios(ctx)
    expect(result.checks.find((c) => c.key === 'available_portfolio_per_committee')?.passed).toBe(false)
  })

  it('flags (but does not block on) two portfolios in the same committee sharing a name (case-insensitive)', () => {
    const ctx = makeContext({
      committees: [committee()],
      portfolios: [
        portfolio({ id: 'p1', name: 'United States' }),
        portfolio({ id: 'p2', name: 'united states' }),
      ],
    })
    const result = validatePortfolios(ctx)
    const check = result.checks.find((c) => c.key === 'no_duplicate_portfolio_names')
    expect(check?.passed).toBe(false)
    expect(check?.severity).toBe('MEDIUM')
    expect(result.passed).toBe(true)
  })

  it('allows the same portfolio name across different committees', () => {
    const ctx = makeContext({
      committees: [committee({ id: 'c1' }), committee({ id: 'c2', name: 'UNHRC' })],
      portfolios: [
        portfolio({ id: 'p1', committeeId: 'c1', name: 'United States' }),
        portfolio({ id: 'p2', committeeId: 'c2', name: 'United States' }),
      ],
    })
    const result = validatePortfolios(ctx)
    expect(result.checks.find((c) => c.key === 'no_duplicate_portfolio_names')?.passed).toBe(true)
  })
})

describe('validateExecutiveBoard', () => {
  it('passes when every committee has a CHAIR', () => {
    const ctx = makeContext({ committees: [committee()], ebMembers: [ebMember()] })
    const result = validateExecutiveBoard(ctx)
    expect(result.moduleKey).toBe('EXECUTIVE_BOARD')
    expect(result.passed).toBe(true)
  })

  it('flags (but does not block on) a committee with zero EB members', () => {
    const ctx = makeContext({ committees: [committee()], ebMembers: [] })
    const result = validateExecutiveBoard(ctx)
    const check = result.checks.find((c) => c.key === 'every_committee_has_chair')
    expect(check?.passed).toBe(false)
    expect(check?.severity).toBe('MEDIUM')
    expect(result.passed).toBe(true)
  })

  it('flags (but does not block on) a committee whose EB members have no CHAIR', () => {
    const ctx = makeContext({
      committees: [committee()],
      ebMembers: [ebMember({ role: 'VICE_CHAIR' })],
    })
    const result = validateExecutiveBoard(ctx)
    expect(result.checks.find((c) => c.key === 'every_committee_has_chair')?.passed).toBe(false)
    expect(result.passed).toBe(true)
  })

  it('a mun-level Secretary-General (committeeId null) does not satisfy a committee-level CHAIR requirement', () => {
    const ctx = makeContext({
      committees: [committee()],
      ebMembers: [ebMember({ committeeId: null })],
    })
    const result = validateExecutiveBoard(ctx)
    expect(result.checks.find((c) => c.key === 'every_committee_has_chair')?.passed).toBe(false)
  })
})
