import { describe, expect, it } from 'vitest'
import { renderOrganizerPublishedEmailHtml, renderOrganizerPublishedEmailText } from './organizer-published-email'

const INPUT = {
  munName: 'BITSMUN Hyderabad',
  publicUrl: 'https://www.munhub.in/muns/bitsmun-hyderabad-25',
  supportEmail: 'organizers@munhub.in',
}

describe('renderOrganizerPublishedEmailHtml', () => {
  it('includes the mun name, public url, and support contact', () => {
    const html = renderOrganizerPublishedEmailHtml(INPUT)
    expect(html).toContain('BITSMUN Hyderabad')
    expect(html).toContain('is live!')
    expect(html).toContain('https://www.munhub.in/muns/bitsmun-hyderabad-25')
    expect(html).toContain('organizers@munhub.in')
  })

  it('renders a visible call-to-action button linking to publicUrl', () => {
    const html = renderOrganizerPublishedEmailHtml(INPUT)
    expect(html).toContain('View your listing')
    expect(html).toContain('href="https://www.munhub.in/muns/bitsmun-hyderabad-25"')
  })

  it('escapes HTML-significant characters in the mun name', () => {
    const html = renderOrganizerPublishedEmailHtml({ ...INPUT, munName: '<script>alert(1)</script>' })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('escapes HTML-significant characters in the public url', () => {
    const html = renderOrganizerPublishedEmailHtml({
      ...INPUT,
      publicUrl: 'https://www.munhub.in/muns/"><script>alert(1)</script>',
    })
    expect(html).not.toContain('"><script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('escapes HTML-significant characters in the support email', () => {
    const html = renderOrganizerPublishedEmailHtml({ ...INPUT, supportEmail: '<b>x@munhub.in</b>' })
    expect(html).not.toContain('<b>x@munhub.in</b>')
    expect(html).toContain('&lt;b&gt;')
  })
})

describe('renderOrganizerPublishedEmailText', () => {
  it('includes the same core content as a plain-text fallback', () => {
    const text = renderOrganizerPublishedEmailText(INPUT)
    expect(text).toContain('BITSMUN Hyderabad')
    expect(text).toContain('is live!')
    expect(text).toContain('https://www.munhub.in/muns/bitsmun-hyderabad-25')
    expect(text).toContain('organizers@munhub.in')
  })

  it('does not HTML-escape values in the plain-text render', () => {
    const text = renderOrganizerPublishedEmailText({ ...INPUT, munName: 'Model UN & Debate' })
    expect(text).toContain('Model UN & Debate')
    expect(text).not.toContain('&amp;')
  })
})
