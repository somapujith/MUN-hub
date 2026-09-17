import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { OPEN } from '../../fixtures/fixture-muns'
import {
  acceptNextConfirm,
  anonApi,
  cardFor,
  main,
  openSection,
  organizerApi,
  ownedMunBySlug,
  prepareWorkspace,
  PRODUCTS_LIST_BUG,
  sandboxId,
  toast,
  uid,
  WORKSPACE_BUG,
  WORKSPACE_SHIM,
  expectWorkspaceBug,
} from './_helpers'

/**
 * Registration Products — passes, pricing, capacity, deadlines (Onboarding
 * PRD §15/§19). Writes happen on the sandbox only.
 *
 * The owner's product list endpoint is broken (PRODUCTS_LIST_BUG), so API
 * checks read products back through the owner's analytics endpoint, which
 * lists every pass in display order.
 */

let api: APIRequestContext
let munId: string
const created: string[] = []

test.beforeAll(async () => {
  api = await organizerApi()
  munId = await sandboxId(api)
})

test.afterAll(async () => {
  for (const id of created) await api.delete(`products/${id}`)
  await api?.dispose()
})

const REGION = 'Registration products'

interface Product {
  id: string
  name: string
  price: number
  capacity: number
  status: string
  displayOrder: number
  deadline: string | null
}

interface AnalyticsProduct {
  productId: string
  productName: string
  price: number
  capacity: number
}

/** Needs the products list, which fails for every MUN (and the workspace itself without the shim). */
function expectProductsListBug(): void {
  test.fail(!process.env.E2E_SHOW_KNOWN_BUGS, WORKSPACE_SHIM ? PRODUCTS_LIST_BUG : `${WORKSPACE_BUG}; ${PRODUCTS_LIST_BUG}`)
}

async function openProducts(page: Page) {
  await prepareWorkspace(page, api)
  await openSection(page, munId, 'products', 'Registration Products')
}

async function createProduct(data: Record<string, unknown>): Promise<Product> {
  const res = await api.post(`muns/${munId}/products`, { data })
  expect(res.status(), await res.text()).toBe(201)
  const product: Product = await res.json()
  created.push(product.id)
  return product
}

async function patchProduct(id: string, data: Record<string, unknown>): Promise<Product> {
  const res = await api.patch(`products/${id}`, { data })
  expect(res.status(), await res.text()).toBe(200)
  return res.json()
}

async function productsInOrder(): Promise<AnalyticsProduct[]> {
  const res = await api.get(`organizer/muns/${munId}/analytics`)
  expect(res.status()).toBe(200)
  return (await res.json()).products
}

test.describe('registration products UI', () => {
  test('the owner sees the MUN\'s passes, including retired ones', async ({ page }) => {
    expectProductsListBug()
    const product = await createProduct({ name: `E2E Listed Pass ${uid()}`, price: 750, capacity: 25, displayOrder: 700 })
    await patchProduct(product.id, { status: 'inactive' })
    await openProducts(page)
    await expect(main(page).getByRole('region', { name: REGION })).not.toContainText('not found')
    const card = cardFor(page, REGION, product.name)
    await expect(card).toContainText('Inactive')
    await expect(card).toContainText('₹750')
    await expect(card).toContainText('25 seats')
  })

  test('create a pass with price, capacity and deadline, then edit it', async ({ page }) => {
    expectProductsListBug()
    const name = `E2E Pass ${uid()}`
    await openProducts(page)

    await main(page).getByRole('button', { name: 'Add product' }).first().click()
    const form = main(page).locator('form')
    await form.getByLabel('Name').fill(name)
    await form.getByLabel('Price').fill('2499')
    await form.getByLabel('Capacity (seats)').fill('150')
    await form.getByLabel('Registration deadline').fill('2026-12-01T18:00')
    await form.getByLabel('Description').fill('Includes kit, lunch and socials')
    await form.getByLabel('Display order').fill('500')
    await form.getByLabel('Allow delegation (team) registration').check()
    await form.getByRole('button', { name: 'Add product' }).click()

    await expect(toast(page, 'Product created')).toBeVisible()
    const saved = (await productsInOrder()).find((p) => p.productName === name)
    expect(saved).toMatchObject({ price: 2499, capacity: 150 })
    created.push(saved!.productId)

    const card = cardFor(page, REGION, name)
    await expect(card).toContainText('Active')
    await expect(card).toContainText('₹2,499')
    await expect(card).toContainText('150 seats')
    await expect(card).toContainText('Closes')
    await expect(card).toContainText('Individual · Delegation')
    await expect(card).toContainText('Includes kit, lunch and socials')

    await main(page).getByRole('button', { name: `Edit ${name}` }).click()
    await expect(form.getByLabel('Price')).toHaveValue('2499')
    await expect(form.getByLabel('Registration deadline')).toHaveValue('2026-12-01T18:00')
    await form.getByLabel('Price').fill('1999')
    await form.getByLabel('Capacity (seats)').fill('120')
    await form.getByRole('button', { name: 'Save changes' }).click()
    await expect(toast(page, 'Product updated')).toBeVisible()
    await expect(card).toContainText('₹1,999')
    await expect(card).toContainText('120 seats')
    await page.reload()
    await expect(cardFor(page, REGION, name)).toContainText('₹1,999')
  })

  test('deactivate and reactivate a pass', async ({ page }) => {
    expectProductsListBug()
    const product = await createProduct({ name: `E2E Toggle Pass ${uid()}`, price: 999, capacity: 10, displayOrder: 600 })
    await openProducts(page)
    const card = cardFor(page, REGION, product.name)
    await expect(card).toContainText('Active')

    acceptNextConfirm(page)
    await main(page).getByRole('button', { name: `Deactivate ${product.name}` }).click()
    await expect(card).toContainText('Inactive')
    acceptNextConfirm(page)
    await main(page).getByRole('button', { name: `Reactivate ${product.name}` }).click()
    await expect(card).toContainText('Active')
  })

  test('reorder passes with the move buttons', async ({ page }) => {
    expectProductsListBug()
    const tag = uid()
    const first = await createProduct({ name: `E2E Order A ${tag}`, price: 1, capacity: 1, displayOrder: 9000 })
    const second = await createProduct({ name: `E2E Order B ${tag}`, price: 1, capacity: 1, displayOrder: 9001 })
    await openProducts(page)

    const names = main(page).getByRole('region', { name: REGION }).getByRole('heading', { level: 2 })
    await expect(names.filter({ hasText: tag })).toHaveText([first.name, second.name])
    await cardFor(page, REGION, second.name).getByRole('button', { name: 'Move product up' }).click()
    await expect(names.filter({ hasText: tag })).toHaveText([second.name, first.name])
    const order = (await productsInOrder()).map((p) => p.productName).filter((n) => n.includes(tag))
    expect(order).toEqual([second.name, first.name])
  })

  test('invalid price, capacity and mode are refused before saving', async ({ page }) => {
    expectWorkspaceBug()
    await openProducts(page)
    await main(page).getByRole('button', { name: 'Add product' }).first().click()
    const form = main(page).locator('form')
    await form.evaluate((el) => el.setAttribute('novalidate', ''))
    const name = `E2E Invalid Pass ${uid()}`
    await form.getByLabel('Name').fill(name)

    await form.getByLabel('Price').fill('-10')
    await form.getByLabel('Capacity (seats)').fill('10')
    await form.getByRole('button', { name: 'Add product' }).click()
    await expect(toast(page, 'Price must be a non-negative number')).toBeVisible()

    await form.getByLabel('Price').fill('100')
    await form.getByLabel('Capacity (seats)').fill('0')
    await form.getByRole('button', { name: 'Add product' }).click()
    await expect(toast(page, 'Capacity must be at least 1')).toBeVisible()

    await form.getByLabel('Capacity (seats)').fill('10')
    await form.getByLabel('Allow individual delegate registration').uncheck()
    await form.getByRole('button', { name: 'Add product' }).click()
    await expect(toast(page, 'At least one of individual or delegation registration must be allowed')).toBeVisible()

    await expect(form).toBeVisible()
    expect((await productsInOrder()).map((p) => p.productName)).not.toContain(name)
  })
})

test.describe('registration products API', () => {
  test('the owner can list a MUN\'s passes by id, including inactive ones', async () => {
    test.fail(!process.env.E2E_SHOW_KNOWN_BUGS, PRODUCTS_LIST_BUG)
    const product = await createProduct({ name: `E2E Owner List ${uid()}`, price: 10, capacity: 1 })
    const res = await api.get(`muns/${munId}/products?includeInactive=true`)
    expect(res.status(), await res.text()).toBe(200)
    expect(((await res.json()) as Product[]).map((p) => p.id)).toContain(product.id)
  })

  test('create, update, deactivate, reactivate and (soft) delete a pass', async () => {
    const product = await createProduct({
      name: `E2E API Pass ${uid()}`,
      price: 1500,
      capacity: 40,
      deadline: '2026-12-10T12:00:00.000Z',
      description: 'API-created pass',
      allowsIndividual: true,
    })
    expect(product).toMatchObject({ price: 1500, capacity: 40, status: 'active' })
    expect(product.deadline).toBe('2026-12-10T12:00:00.000Z')

    expect(await patchProduct(product.id, { price: 1750, capacity: 45, deadline: null })).toMatchObject({
      price: 1750,
      capacity: 45,
      deadline: null,
    })
    expect((await productsInOrder()).find((p) => p.productId === product.id)).toMatchObject({ price: 1750, capacity: 45 })

    expect((await patchProduct(product.id, { status: 'inactive' })).status).toBe('inactive')
    expect((await patchProduct(product.id, { status: 'active' })).status).toBe('active')

    // DELETE is a soft delete: the pass is retired, not erased (existing registrations keep it).
    expect((await api.delete(`products/${product.id}`)).status()).toBe(204)
    expect((await patchProduct(product.id, { description: 'retired' })).status).toBe('inactive')
  })

  test('an inactive pass is never offered publicly', async () => {
    // Read-only against the open fixture: its "E2E Retired Pass" is inactive.
    const anon = await anonApi()
    const publicProducts: Product[] = await (await anon.get(`muns/${OPEN.slug}/products`)).json()
    const names = publicProducts.map((p) => p.name)
    expect(names).toContain(OPEN.products[0].name)
    expect(names).not.toContain(OPEN.products[2].name)
    // ...and asking for inactive ones anonymously doesn't reveal them.
    const sneaky: Product[] = await (await anon.get(`muns/${OPEN.slug}/products?includeInactive=true`)).json()
    expect(sneaky.map((p) => p.name)).not.toContain(OPEN.products[2].name)
    await anon.dispose()

    // The owner does see it.
    const open = await ownedMunBySlug(api, OPEN.slug)
    expect(open.id).toBeTruthy()
    const ownerView: Product[] = await (await api.get(`muns/${OPEN.slug}/products?includeInactive=true`)).json()
    expect(ownerView.map((p) => p.name)).toContain(OPEN.products[2].name)
  })

  test('an invalid price or capacity is refused', async () => {
    for (const data of [
      { name: 'E2E bad price', price: -1, capacity: 10 },
      { name: 'E2E bad price', price: 10.5, capacity: 10 },
      { name: 'E2E bad price', price: '100', capacity: 10 },
      { name: 'E2E bad capacity', price: 100, capacity: 0 },
      { name: 'E2E missing price', capacity: 10 },
      { name: '', price: 100, capacity: 10 },
      { name: 'E2E client status', price: 100, capacity: 10, status: 'active' },
    ]) {
      const res = await api.post(`muns/${munId}/products`, { data })
      expect(res.status(), JSON.stringify(data)).toBe(400)
      expect((await res.json()).error.code).toBe('VALIDATION_FAILED')
    }
    const product = await createProduct({ name: `E2E Patch Guard ${uid()}`, price: 10, capacity: 1 })
    expect((await api.patch(`products/${product.id}`, { data: { price: -5 } })).status()).toBe(400)
    expect((await api.patch(`products/${product.id}`, { data: { capacity: 0 } })).status()).toBe(400)
    await api.delete(`products/${product.id}`)
  })
})
