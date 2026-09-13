import { describe, it, expect } from 'vitest'
import { MODULE_REGISTRY, TRACKED_MODULES, getModuleDefinition } from './module-registry'
import { munModuleEnum } from '@/lib/db/schema-enums'
import type { MunModule } from '@/lib/db/schema-enums'

// The 15 PRD Section 38 module keys, verbatim. Asserted against a literal
// array (not derived from the registry or the enum) so a typo'd enum value
// anywhere (e.g. "REGISTRATON_TYPES") is caught by this test rather than
// silently accepted because both sides of a comparison share the same typo.
const PRD_SECTION_38_KEYS = [
  'BASIC_INFO',
  'DATES_VENUE',
  'BRANDING',
  'COMMITTEES',
  'PORTFOLIOS',
  'EXECUTIVE_BOARD',
  'REGISTRATION_TYPES',
  'REGISTRATION_FORM',
  'PRICING_CAPACITY',
  'PAYMENT_SETTLEMENT',
  'RULES_DOCUMENTS',
  'SCHEDULE',
  'ACCOMMODATION',
  'CONTACT',
  'FINAL_REVIEW',
] as const

const VALID_MUN_MODULES = new Set<string>(munModuleEnum.enumValues)

describe('MODULE_REGISTRY', () => {
  it('has exactly 15 entries', () => {
    expect(MODULE_REGISTRY.length).toBe(15)
  })

  it('every key is a valid MunModule enum value', () => {
    for (const entry of MODULE_REGISTRY) {
      expect(VALID_MUN_MODULES.has(entry.key)).toBe(true)
    }
  })

  it('has no duplicate keys', () => {
    const keys = MODULE_REGISTRY.map((m) => m.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('contains every one of the 15 PRD Section 38 keys, exactly', () => {
    const keys = MODULE_REGISTRY.map((m) => m.key).sort()
    expect(keys).toEqual([...PRD_SECTION_38_KEYS].sort())
  })

  it('every entry has a non-empty label and a valid phase', () => {
    const validPhases = new Set(['CONTENT', 'COMMERCE', 'OPERATIONS', 'FINAL'])
    for (const entry of MODULE_REGISTRY) {
      expect(entry.label.length).toBeGreaterThan(0)
      expect(validPhases.has(entry.phase)).toBe(true)
    }
  })

  it('FINAL_REVIEW defaults to required (it must always stay required)', () => {
    expect(getModuleDefinition('FINAL_REVIEW').defaultRequired).toBe(true)
  })
})

describe('TRACKED_MODULES', () => {
  it('is derived from MODULE_REGISTRY keys, in the same order', () => {
    expect(TRACKED_MODULES).toEqual(MODULE_REGISTRY.map((m) => m.key))
  })
})

describe('getModuleDefinition', () => {
  it('returns the matching definition for a real key', () => {
    const def = getModuleDefinition('COMMITTEES')
    expect(def.key).toBe('COMMITTEES')
    expect(def.label).toBe('Committees')
  })

  it('throws for a module key not in the registry (e.g. a legacy pre-PRD key)', () => {
    expect(() => getModuleDefinition('mun_details' as MunModule)).toThrow(
      /No ModuleDefinition registered/,
    )
  })
})
