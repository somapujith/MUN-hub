import { describe, it, expect } from 'vitest'
import { munModuleEnum } from '@/lib/db/schema-enums'
import type { MunModule } from '@/lib/db/schema-enums'
import { isHighImpactModule } from './reverification'

// Once a MUN is verified, organizer edits never send it back to review, so
// the only thing left in reverification.ts is which modules are high-impact
// (frozen while a MUN is under its FIRST review). The "edits after
// verification leave the MUN live" behavior is covered where each edit is
// made: mun-config.test.ts, accommodation.test.ts, payment-settlement.test.ts,
// registration-form.test.ts and go-live.test.ts.

describe('HIGH_IMPACT_FIELDS exhaustiveness', () => {
  // TypeScript's Record<MunModule, string[]> already makes a missing key a
  // COMPILE error — this runtime test pins the current 19-key enum's shape
  // for the case a hotfix skips the type-check.
  it('every MunModule enum value resolves to a boolean', () => {
    for (const moduleKey of munModuleEnum.enumValues as MunModule[]) {
      expect(typeof isHighImpactModule(moduleKey)).toBe('boolean')
    }
  })

  it('exactly the modules the design spec lists non-empty are high-impact', () => {
    const expectedHighImpact: MunModule[] = [
      'BASIC_INFO',
      'DATES_VENUE',
      'COMMITTEES',
      'PORTFOLIOS',
      'EXECUTIVE_BOARD',
      'REGISTRATION_TYPES',
      'PRICING_CAPACITY',
      'PAYMENT_SETTLEMENT',
      'RULES_DOCUMENTS',
      'SCHEDULE',
      'ACCOMMODATION',
      'CONTACT',
    ]
    const expectedEmpty: MunModule[] = [
      'BRANDING',
      'REGISTRATION_FORM',
      'FINAL_REVIEW',
      'mun_details',
      'committees',
      'portfolios',
      'registration_products',
    ]

    for (const moduleKey of expectedHighImpact) {
      expect(isHighImpactModule(moduleKey)).toBe(true)
    }
    for (const moduleKey of expectedEmpty) {
      expect(isHighImpactModule(moduleKey)).toBe(false)
    }
  })
})
