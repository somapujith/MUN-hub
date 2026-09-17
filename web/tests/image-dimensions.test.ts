// Runs under the repo-root Vitest config (`npx vitest run web/tests`). Kept
// outside web/src so the web app's own tsc/vite builds, which have no test
// runner installed, never pick it up.
//
// Only checkCoverDimensions is tested here — readImageDimensions needs a
// real browser (Image/URL.createObjectURL) and is exercised manually /
// through the organizer workspace, not under Node's vitest environment.
// This must stay in sync with lib/storage/validate.test.ts's equivalent
// server-side assertions (see image-dimensions.ts's header comment).
import { describe, expect, it } from 'vitest'
import { checkCoverDimensions, COVER_MIN_HEIGHT, COVER_MIN_WIDTH, COVER_REQUIRED_RATIO } from '../src/lib/image-dimensions'

describe('checkCoverDimensions', () => {
  it('accepts exactly the required 2000x480', () => {
    expect(checkCoverDimensions({ width: 2000, height: 480 })).toBeNull()
  })

  it('accepts a higher-resolution multiple of the same ratio', () => {
    expect(checkCoverDimensions({ width: 4000, height: 960 })).toBeNull()
  })

  it('rejects a 16:9 image with a message naming the required ratio', () => {
    expect(checkCoverDimensions({ width: 1600, height: 900 })).toBe(
      'Image is 1600x900 — this image must be 25:6 (e.g. 2000x480)',
    )
  })

  it('rejects a correctly-proportioned image below the size floor', () => {
    expect(checkCoverDimensions({ width: 1000, height: 240 })).toBe(
      'Image is 1000x240 — minimum size is 2000x480',
    )
  })

  it('matches the exported constants', () => {
    expect(COVER_REQUIRED_RATIO).toEqual({ width: 25, height: 6 })
    expect(COVER_MIN_WIDTH).toBe(2000)
    expect(COVER_MIN_HEIGHT).toBe(480)
  })
})
