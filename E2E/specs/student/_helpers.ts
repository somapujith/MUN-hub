import { expect, type Browser, type Page } from '@playwright/test'
import { browserContextFor, getMun, signUpViaApi, type ApiSession } from '../../fixtures/api'
import { OPEN } from '../../fixtures/fixture-muns'
import type { SignUpPayload } from '../../fixtures/data'

/** A brand-new student (full profile from signup) with a signed-in browser page. */
export async function freshStudentPage(browser: Browser, overrides: Partial<SignUpPayload> = {}) {
  const session = await signUpViaApi(overrides)
  const context = await browserContextFor(browser, session)
  const page = await context.newPage()
  return { session, context, page }
}

export function main(page: Page) {
  return page.getByRole('main')
}

/**
 * Holds a seat on the open fixture MUN through the API. Returns the
 * registration id. `pay` completes the mock payment so it ends up CONFIRMED.
 */
export async function registerOnOpenMun(
  session: ApiSession,
  opts: { pass?: string; committee?: string; portfolio?: string; pay?: boolean } = {},
): Promise<string> {
  const mun = await getMun(session.api, OPEN.slug)
  const product = mun.registrationProducts.find((p) => p.name === (opts.pass ?? OPEN.products[0].name))
  expect(product, 'fixture pass exists').toBeTruthy()
  const committee = opts.committee ? mun.committees.find((c) => c.name === opts.committee) : undefined
  const portfolio = committee && opts.portfolio ? committee.portfolios.find((p) => p.name === opts.portfolio) : undefined

  const res = await session.api.post('registrations', {
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    data: {
      munId: mun.id,
      registrationProductId: product!.id,
      ...(committee ? { committeeId: committee.id } : {}),
      ...(portfolio ? { portfolioId: portfolio.id } : {}),
    },
  })
  expect(res.status(), await res.text()).toBe(201)
  const { registrationId } = (await res.json()) as { registrationId: string }

  if (opts.pay) {
    const paid = await session.api.post(`registrations/${registrationId}/mock-payment`, { data: { outcome: 'success' } })
    expect(paid.ok(), await paid.text()).toBeTruthy()
  }
  return registrationId
}
