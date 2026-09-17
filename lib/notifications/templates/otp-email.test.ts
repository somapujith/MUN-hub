import { describe, expect, it } from 'vitest'
import { renderOtpEmailHtml, renderOtpEmailText } from './otp-email'

const INPUT = {
  purpose: 'login',
  code: '596833',
  expiresInMinutes: 5,
  supportEmail: 'events@munhub.in',
  supportHours: '10AM-7PM',
}

describe('renderOtpEmailHtml', () => {
  it('includes the code, purpose, expiry, and support contact', () => {
    const html = renderOtpEmailHtml(INPUT)
    expect(html).toContain('596833')
    expect(html).toContain('Your OTP for login is')
    expect(html).toContain('valid for 5 mins')
    expect(html).toContain('events@munhub.in')
    expect(html).toContain('10AM-7PM')
  })

  it('escapes HTML-significant characters in interpolated fields', () => {
    const html = renderOtpEmailHtml({ ...INPUT, purpose: '<script>alert(1)</script>' })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('singularizes "minute" when expiresInMinutes is 1', () => {
    const html = renderOtpEmailHtml({ ...INPUT, expiresInMinutes: 1 })
    expect(html).toContain('valid for 1 min')
    expect(html).not.toContain('valid for 1 mins')
  })

  it('omits support hours entirely when not given', () => {
    const html = renderOtpEmailHtml({ ...INPUT, supportHours: undefined })
    expect(html).not.toContain('(10AM-7PM)')
  })
})

describe('renderOtpEmailText', () => {
  it('includes the same core content as a plain-text fallback', () => {
    const text = renderOtpEmailText(INPUT)
    expect(text).toContain('596833')
    expect(text).toContain('login')
    expect(text).toContain('5 minutes')
    expect(text).toContain('events@munhub.in')
  })
})
