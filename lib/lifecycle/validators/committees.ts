import type { MunValidationContext, ModuleValidationResult, ValidationCheck } from '../validation'
import { modulePassed } from '../validation'

// -----------------------------------------------------------------------------
// validators/committees.ts — COMMITTEES, PORTFOLIOS, EXECUTIVE_BOARD
// -----------------------------------------------------------------------------
// Pure functions — see validators/content.ts's header comment for the shared
// architecture note (no I/O, no await, no direct clock reads).
// -----------------------------------------------------------------------------

export function validateCommittees(ctx: MunValidationContext): ModuleValidationResult {
  const { committees } = ctx

  const hasAtLeastOne = committees.length > 0
  const everyAgendaSet = committees.every((c) => (c.agenda ?? '').trim().length > 0)
  const everyCapacitySet = committees.every((c) => c.capacity > 0)

  const missingAgendaNames = committees.filter((c) => (c.agenda ?? '').trim().length === 0).map((c) => c.name)
  const missingCapacityNames = committees.filter((c) => c.capacity <= 0).map((c) => c.name)

  const checks: ValidationCheck[] = [
    {
      key: 'at_least_one_committee',
      label: 'At least one committee exists',
      passed: hasAtLeastOne,
      severity: 'BLOCKER',
      message: hasAtLeastOne ? undefined : 'At least one committee is required.',
    },
    {
      // Non-blocking as of the minimum-required-fields cut — agenda can be
      // added any time after publishing.
      key: 'every_committee_has_agenda',
      label: 'Every committee has a non-empty agenda',
      passed: everyAgendaSet,
      severity: 'MEDIUM',
      message: everyAgendaSet ? undefined : `Missing agenda for: ${missingAgendaNames.join(', ')}.`,
    },
    {
      key: 'every_committee_has_capacity',
      label: 'Every committee has a positive capacity',
      passed: everyCapacitySet,
      severity: 'BLOCKER',
      message: everyCapacitySet ? undefined : `Capacity not set for: ${missingCapacityNames.join(', ')}.`,
    },
  ]

  return { moduleKey: 'COMMITTEES', checks, passed: modulePassed(checks) }
}

export function validatePortfolios(ctx: MunValidationContext): ModuleValidationResult {
  const { committees, portfolios } = ctx

  const portfoliosByCommittee = new Map<string, typeof portfolios>()
  for (const portfolio of portfolios) {
    const existing = portfoliosByCommittee.get(portfolio.committeeId) ?? []
    existing.push(portfolio)
    portfoliosByCommittee.set(portfolio.committeeId, existing)
  }

  // "Active committee" — this schema has no explicit archived/active flag on
  // committees, so every committee row loaded for the mun is considered
  // active for this check (matches COMMITTEES' own treatment of `committees`
  // as the full active set).
  const committeesMissingAvailablePortfolio = committees.filter((committee) => {
    const committeePortfolios = portfoliosByCommittee.get(committee.id) ?? []
    return !committeePortfolios.some((p) => p.availability > 0)
  })

  const duplicateNameCommittees = committees.filter((committee) => {
    const names = (portfoliosByCommittee.get(committee.id) ?? []).map((p) => p.name.trim().toLowerCase())
    return new Set(names).size !== names.length
  })

  const hasAvailablePerCommittee = committeesMissingAvailablePortfolio.length === 0
  const noDuplicateNames = duplicateNameCommittees.length === 0

  // Non-blocking as of the minimum-required-fields cut — portfolios can be
  // added any time after publishing.
  const checks: ValidationCheck[] = [
    {
      key: 'available_portfolio_per_committee',
      label: 'Every active committee has at least one available portfolio',
      passed: hasAvailablePerCommittee,
      severity: 'MEDIUM',
      message: hasAvailablePerCommittee
        ? undefined
        : `No available portfolio for: ${committeesMissingAvailablePortfolio.map((c) => c.name).join(', ')}.`,
    },
    {
      key: 'no_duplicate_portfolio_names',
      label: 'No duplicate portfolio name within the same committee',
      passed: noDuplicateNames,
      severity: 'MEDIUM',
      message: noDuplicateNames
        ? undefined
        : `Duplicate portfolio names in: ${duplicateNameCommittees.map((c) => c.name).join(', ')}.`,
    },
  ]

  return { moduleKey: 'PORTFOLIOS', checks, passed: modulePassed(checks) }
}

export function validateExecutiveBoard(ctx: MunValidationContext): ModuleValidationResult {
  const { committees, ebMembers } = ctx

  const chairCommitteeIds = new Set(ebMembers.filter((m) => m.role === 'CHAIR' && m.committeeId).map((m) => m.committeeId))

  const committeesMissingChair = committees.filter((c) => !chairCommitteeIds.has(c.id))
  const everyCommitteeHasChair = committeesMissingChair.length === 0

  // Non-blocking as of the minimum-required-fields cut — the executive board
  // can be filled in any time after publishing.
  const checks: ValidationCheck[] = [
    {
      key: 'every_committee_has_chair',
      label: 'Every active committee has at least one Chair',
      passed: everyCommitteeHasChair,
      severity: 'MEDIUM',
      message: everyCommitteeHasChair
        ? undefined
        : `Missing a Chair for: ${committeesMissingChair.map((c) => c.name).join(', ')}.`,
    },
  ]

  return { moduleKey: 'EXECUTIVE_BOARD', checks, passed: modulePassed(checks) }
}
