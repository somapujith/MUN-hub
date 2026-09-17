// Runs under the repo-root Vitest config (`npx vitest run web/tests`).
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  cameraAllowedByPolicy,
  describeCameraFailure,
  readCameraPermission,
} from '../src/lib/camera-access'

const webRoot = path.resolve(__dirname, '..')

function headersFilePolicy(): string | undefined {
  const text = fs.readFileSync(path.join(webRoot, 'public/_headers'), 'utf8')
  return text.match(/^\s*Permissions-Policy:\s*(.+)$/m)?.[1].trim()
}

function vercelPolicy(): string | undefined {
  const config = JSON.parse(fs.readFileSync(path.join(webRoot, 'vercel.json'), 'utf8')) as {
    headers: { headers: { key: string; value: string }[] }[]
  }
  return config.headers
    .flatMap((rule) => rule.headers)
    .find((header) => header.key === 'Permissions-Policy')?.value
}

describe('web Permissions-Policy header', () => {
  // The organizer check-in panel scans passes with the camera. camera=()
  // would disable it for the site's own origin, with no prompt to answer.
  it('allows the camera for the site itself in both deploy configs', () => {
    for (const policy of [headersFilePolicy(), vercelPolicy()]) {
      expect(policy).toBeDefined()
      expect(policy).toMatch(/(^|,\s*)camera=\(self\)/)
      expect(policy).toMatch(/microphone=\(\)/)
      expect(policy).toMatch(/geolocation=\(\)/)
    }
  })

  it('is identical in _headers and vercel.json', () => {
    expect(headersFilePolicy()).toBe(vercelPolicy())
  })
})

describe('cameraAllowedByPolicy', () => {
  it('reports what the document policy says about the camera', () => {
    const blocked = { permissionsPolicy: { allowsFeature: (f: string) => f !== 'camera' } }
    const allowed = { permissionsPolicy: { allowsFeature: () => true } }
    expect(cameraAllowedByPolicy(blocked)).toBe(false)
    expect(cameraAllowedByPolicy(allowed)).toBe(true)
  })

  it('falls back to the older featurePolicy object', () => {
    expect(cameraAllowedByPolicy({ featurePolicy: { allowsFeature: () => false } })).toBe(false)
  })

  it('assumes allowed when the browser exposes no policy', () => {
    expect(cameraAllowedByPolicy({})).toBe(true)
    expect(cameraAllowedByPolicy(undefined)).toBe(true)
    expect(
      cameraAllowedByPolicy({
        permissionsPolicy: {
          allowsFeature: () => {
            throw new Error('unknown feature')
          },
        },
      }),
    ).toBe(true)
  })
})

describe('readCameraPermission', () => {
  it('returns the queried state', async () => {
    const nav = { permissions: { query: async () => ({ state: 'denied' }) } }
    await expect(readCameraPermission(nav)).resolves.toBe('denied')
  })

  it('returns unknown when the query is missing or rejects', async () => {
    await expect(readCameraPermission({})).resolves.toBe('unknown')
    const nav = {
      permissions: {
        query: async () => {
          throw new TypeError("'camera' is not a valid PermissionName")
        },
      },
    }
    await expect(readCameraPermission(nav)).resolves.toBe('unknown')
  })
})

describe('describeCameraFailure', () => {
  const notAllowed = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' })

  it('hides the scanner when the browser refused without asking', () => {
    const failure = describeCameraFailure(notAllowed, 'denied')
    expect(failure.blocked).toBe(true)
    expect(failure.message).toMatch(/blocked/i)
  })

  it('keeps the scanner when the user dismissed or denied a prompt', () => {
    for (const state of ['prompt', 'unknown'] as const) {
      const failure = describeCameraFailure(notAllowed, state)
      expect(failure.blocked).toBe(false)
      expect(failure.message).toMatch(/allow camera access/i)
    }
  })

  it('hides the scanner when there is no camera', () => {
    const notFound = Object.assign(new Error('Requested device not found'), { name: 'NotFoundError' })
    expect(describeCameraFailure(notFound, 'prompt').blocked).toBe(true)
  })

  it('keeps the generic message for anything else', () => {
    const failure = describeCameraFailure(new Error('boom'), 'granted')
    expect(failure).toEqual({
      blocked: false,
      message: "Couldn't open the camera. Allow camera access, or type the code instead.",
    })
  })
})
