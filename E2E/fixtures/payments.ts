import { expect, request, type APIResponse } from '@playwright/test'
import { createHmac, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { API_ORIGIN } from '../env'
import { getMun, type ApiSession } from './api'

/**
 * Holds a seat on `passName` of the MUN at `slug` through the API and returns
 * the registration id. `pay` completes the mock checkout with that outcome.
 */
export async function registerForPass(
  session: ApiSession,
  slug: string,
  passName: string,
  { pay, committee }: { pay?: 'success' | 'failure'; committee?: string } = {},
): Promise<string> {
  const mun = await getMun(session.api, slug)
  const pass = mun.registrationProducts.find((p) => p.name === passName)
  expect(pass, `${passName} is offered on ${slug}`).toBeTruthy()
  const committeeId = committee ? mun.committees.find((c) => c.name === committee)?.id : undefined
  const res = await session.api.post('registrations', {
    headers: { 'Idempotency-Key': randomUUID() },
    data: { munId: mun.id, registrationProductId: pass!.id, ...(committeeId ? { committeeId } : {}) },
  })
  expect(res.status(), await res.text()).toBe(201)
  const { registrationId } = (await res.json()) as { registrationId: string }
  if (pay) {
    const paid = await session.api.post(`registrations/${registrationId}/mock-payment`, { data: { outcome: pay } })
    expect(paid.ok(), await paid.text()).toBeTruthy()
  }
  return registrationId
}

/**
 * Payment helpers for specs that talk to the payments webhook directly.
 *
 * The E2E API reads MOCK_PAYMENT_WEBHOOK_SECRET and the platform-fee rates
 * from its environment, then from server/.env (`tsx --env-file=.env`,
 * existing env wins; playwright.config.ts sets neither). `apiEnv` resolves a
 * value the same way, so tests sign webhooks and compute fees exactly as the
 * API under test does.
 */

const SERVER_ENV_FILE = path.resolve(__dirname, '..', '..', 'server', '.env')

function serverEnvFile(): Record<string, string> {
  let raw = ''
  try {
    raw = readFileSync(SERVER_ENV_FILE, 'utf8')
  } catch {
    return {}
  }
  const values: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!match) continue
    values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return values
}

export function apiEnv(name: string): string | undefined {
  return process.env[name] || serverEnvFile()[name] || undefined
}

/** lib/payments/fees.ts#computeFeeBreakdown with the API's configured rates. */
export function expectedFeeSplit(amount: number) {
  const feeBps = Number(apiEnv('PLATFORM_FEE_BPS') ?? '0')
  const taxBps = Number(apiEnv('PLATFORM_FEE_TAX_BPS') ?? '1800')
  const applyBps = (value: number, bps: number) => Math.floor((value * bps + 5000) / 10000)
  const platformFee = applyBps(amount, feeBps)
  const platformFeeTax = applyBps(platformFee, taxBps)
  return { feeBps, taxBps, platformFee, platformFeeTax, organizerNet: amount - platformFee - platformFeeTax }
}

export interface WebhookEvent {
  orderId: string
  amount: number
  currency: string
  type?: 'payment.captured' | 'payment.failed'
  eventId?: string
  providerPaymentId?: string | null
  /** When the provider says the capture happened (defaults to now). */
  occurredAt?: Date
  /** When the delivery was signed (the replay window is 5 minutes). */
  signedAt?: Date
  /** Signs with this secret instead of the API's. */
  secret?: string
}

export interface SignedWebhook {
  body: string
  headers: Record<string, string>
  eventId: string
  providerPaymentId: string | null
}

/**
 * A webhook in the mock provider's wire format (lib/payments/mock-adapter.ts):
 * `x-webhook-timestamp` + hex HMAC-SHA256(secret, `${timestamp}.${body}`).
 */
export function signedWebhook(event: WebhookEvent): SignedWebhook {
  const secret = event.secret ?? apiEnv('MOCK_PAYMENT_WEBHOOK_SECRET')
  if (!secret) throw new Error('MOCK_PAYMENT_WEBHOOK_SECRET is not set for the E2E API (server/.env)')
  const type = event.type ?? 'payment.captured'
  const eventId = event.eventId ?? `evt_e2e_${randomUUID()}`
  const providerPaymentId =
    event.providerPaymentId !== undefined
      ? event.providerPaymentId
      : type === 'payment.captured'
        ? `pay_e2e_${randomUUID()}`
        : null
  const body = JSON.stringify({
    id: eventId,
    type,
    orderId: event.orderId,
    providerPaymentId,
    amount: event.amount,
    currency: event.currency,
    createdAt: (event.occurredAt ?? new Date()).toISOString(),
  })
  const timestamp = String(Math.floor((event.signedAt ?? new Date()).getTime() / 1000))
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
  return {
    body,
    headers: { 'Content-Type': 'application/json', 'x-webhook-timestamp': timestamp, 'x-webhook-signature': signature },
    eventId,
    providerPaymentId,
  }
}

export interface WebhookResult {
  status: number
  text: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any
}

/** Delivers a webhook to the API the way a provider would: no cookies, no Origin. */
export async function deliverWebhook(webhook: Pick<SignedWebhook, 'body' | 'headers'>): Promise<WebhookResult> {
  const api = await request.newContext({ storageState: { cookies: [], origins: [] } })
  try {
    const response: APIResponse = await api.post(`${API_ORIGIN}/webhooks/payments`, {
      headers: webhook.headers,
      data: webhook.body,
    })
    const text = await response.text()
    let json: unknown = null
    try {
      json = JSON.parse(text)
    } catch {
      // not JSON
    }
    return { status: response.status(), text, json }
  } finally {
    await api.dispose()
  }
}
