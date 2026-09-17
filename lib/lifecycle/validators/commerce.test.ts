import { describe, it, expect } from 'vitest'
import {
  validateRegistrationTypes,
  validateRegistrationForm,
  validatePricingCapacity,
  validatePaymentSettlement,
} from './commerce'
import { makeContext } from './test-helpers'

function registrationProduct(
  overrides: Partial<{ id: string; price: number; capacity: number; status: string; deadline: Date | null }> = {},
) {
  return {
    id: overrides.id ?? 'product-1',
    munId: 'mun-1',
    name: 'Standard Delegate',
    price: overrides.price ?? 1000,
    currency: 'INR',
    capacity: overrides.capacity ?? 20,
    deadline: overrides.deadline === undefined ? null : overrides.deadline,
    status: overrides.status ?? 'active',
    registrationType: null,
    earlyBirdPrice: null,
    earlyBirdDeadline: null,
    createdAt: new Date(),
  } as never
}

function formField(overrides: Partial<{ fieldKey: string; conditionalOn: string | null }> = {}) {
  return {
    id: 'field-1',
    munId: 'mun-1',
    fieldKey: overrides.fieldKey ?? 'field_a',
    fieldType: 'SHORT_TEXT',
    label: 'Field A',
    helpText: null,
    required: false,
    choices: null,
    displayOrder: 0,
    conditionalOn: overrides.conditionalOn === undefined ? null : overrides.conditionalOn,
    conditionalOperator: null,
    conditionalValue: null,
    createdAt: new Date(),
  } as never
}

describe('validateRegistrationTypes', () => {
  it('passes when at least one active registration product exists', () => {
    const ctx = makeContext({ registrationProducts: [registrationProduct()] })
    const result = validateRegistrationTypes(ctx)
    expect(result.moduleKey).toBe('REGISTRATION_TYPES')
    expect(result.passed).toBe(true)
  })

  it('fails when there are zero registration products', () => {
    const ctx = makeContext({ registrationProducts: [] })
    const result = validateRegistrationTypes(ctx)
    expect(result.passed).toBe(false)
  })

  it('fails when every registration product is inactive', () => {
    const ctx = makeContext({ registrationProducts: [registrationProduct({ status: 'inactive' })] })
    const result = validateRegistrationTypes(ctx)
    expect(result.passed).toBe(false)
  })
})

describe('validateRegistrationForm', () => {
  it('passes with no fields at all (thin validation per design doc Section 6)', () => {
    const ctx = makeContext({ formFields: [] })
    const result = validateRegistrationForm(ctx)
    expect(result.moduleKey).toBe('REGISTRATION_FORM')
    expect(result.passed).toBe(true)
  })

  it('passes when a conditional field references a real fieldKey', () => {
    const ctx = makeContext({
      formFields: [formField({ fieldKey: 'accommodation' }), formField({ fieldKey: 'dietary', conditionalOn: 'accommodation' })],
    })
    const result = validateRegistrationForm(ctx)
    expect(result.passed).toBe(true)
  })

  it('fails when a conditional field references a non-existent fieldKey', () => {
    const ctx = makeContext({
      formFields: [formField({ fieldKey: 'dietary', conditionalOn: 'does_not_exist' })],
    })
    const result = validateRegistrationForm(ctx)
    expect(result.passed).toBe(false)
    expect(result.checks.find((c) => c.key === 'no_dangling_conditional_fields')?.passed).toBe(false)
  })
})

describe('validatePricingCapacity', () => {
  const start = new Date('2027-06-10T00:00:00Z')

  it('passes when price non-negative, capacity positive, deadline before start', () => {
    const ctx = makeContext({
      mun: { startDate: start },
      registrationProducts: [registrationProduct({ price: 1000, capacity: 20, deadline: new Date('2027-06-01T00:00:00Z') })],
    })
    const result = validatePricingCapacity(ctx)
    expect(result.moduleKey).toBe('PRICING_CAPACITY')
    expect(result.passed).toBe(true)
  })

  it('fails when price is negative', () => {
    const ctx = makeContext({ registrationProducts: [registrationProduct({ price: -1 })] })
    const result = validatePricingCapacity(ctx)
    expect(result.passed).toBe(false)
    expect(result.checks.find((c) => c.key === 'non_negative_price')?.passed).toBe(false)
  })

  it('allows a zero price (free registration)', () => {
    const ctx = makeContext({ registrationProducts: [registrationProduct({ price: 0 })] })
    const result = validatePricingCapacity(ctx)
    expect(result.checks.find((c) => c.key === 'non_negative_price')?.passed).toBe(true)
  })

  it('fails when capacity is zero or negative', () => {
    const ctx = makeContext({ registrationProducts: [registrationProduct({ capacity: 0 })] })
    const result = validatePricingCapacity(ctx)
    expect(result.passed).toBe(false)
    expect(result.checks.find((c) => c.key === 'positive_capacity')?.passed).toBe(false)
  })

  it('flags (but does not block on) a deadline on/after the conference start date', () => {
    const ctx = makeContext({
      mun: { startDate: start },
      registrationProducts: [registrationProduct({ deadline: new Date('2027-06-15T00:00:00Z') })],
    })
    const result = validatePricingCapacity(ctx)
    const check = result.checks.find((c) => c.key === 'deadline_before_start')
    expect(check?.passed).toBe(false)
    expect(check?.severity).toBe('MEDIUM')
    expect(result.passed).toBe(true)
  })

  it('passes when deadline is null (optional per spec)', () => {
    const ctx = makeContext({ mun: { startDate: start }, registrationProducts: [registrationProduct({ deadline: null })] })
    const result = validatePricingCapacity(ctx)
    expect(result.checks.find((c) => c.key === 'deadline_before_start')?.passed).toBe(true)
  })
})

describe('validatePaymentSettlement', () => {
  it('passes when the organizer has linked their account-level UPI payout', () => {
    const ctx = makeContext({ organizerPaymentLinked: true })
    const result = validatePaymentSettlement(ctx)
    expect(result.moduleKey).toBe('PAYMENT_SETTLEMENT')
    expect(result.passed).toBe(true)
  })

  it('BLOCKER when the organizer has not linked a UPI payout, at either stage', () => {
    const submitCtx = makeContext({ organizerPaymentLinked: false, stage: 'SUBMIT' })
    const publishCtx = makeContext({ organizerPaymentLinked: false, stage: 'PUBLISH' })

    expect(validatePaymentSettlement(submitCtx).passed).toBe(false)
    expect(validatePaymentSettlement(publishCtx).passed).toBe(false)
    expect(
      validatePaymentSettlement(submitCtx).checks.find((c) => c.key === 'organizer_payment_linked')?.severity,
    ).toBe('BLOCKER')
  })
})
