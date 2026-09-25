import { describe, expect, it } from 'vitest'
import { renderOrganizerDecisionEmailHtml, renderOrganizerDecisionEmailText } from './organizer-decision-email'

const APPROVED_INPUT = {
  munName: 'Oxford MUN 2027',
  area: 'your organizer application',
  decision: 'APPROVED' as const,
  supportEmail: 'organizers@munhub.in',
}

const CHANGES_REQUESTED_INPUT = {
  munName: 'Oxford MUN 2027',
  area: 'the Committees section',
  decision: 'CHANGES_REQUESTED' as const,
  reason: 'The UNSC committee is missing a chair.',
  supportEmail: 'organizers@munhub.in',
}

const REJECTED_INPUT = {
  munName: 'Oxford MUN 2027',
  area: 'your MUN submission',
  decision: 'REJECTED' as const,
  reason: 'The venue could not be verified.',
  supportEmail: 'organizers@munhub.in',
}

describe('renderOrganizerDecisionEmailHtml', () => {
  it('renders the APPROVED eyebrow, headline, and body without a reason block', () => {
    const html = renderOrganizerDecisionEmailHtml(APPROVED_INPUT)
    expect(html).toContain('APPROVED')
    expect(html).toContain('"Oxford MUN 2027" is approved')
    expect(html).toContain('Good news - your organizer application for "Oxford MUN 2027" has been approved.')
    expect(html).toContain('organizers@munhub.in')
  })

  it('does not show a reason block for APPROVED even if reason happens to be set', () => {
    const html = renderOrganizerDecisionEmailHtml({ ...APPROVED_INPUT, reason: 'ignored reason text' })
    expect(html).not.toContain('ignored reason text')
    expect(html).not.toContain('What needs to change')
    expect(html).not.toContain('Why')
  })

  it('renders the CHANGES_REQUESTED eyebrow, headline, body, and labelled reason block', () => {
    const html = renderOrganizerDecisionEmailHtml(CHANGES_REQUESTED_INPUT)
    expect(html).toContain('CHANGES REQUESTED')
    expect(html).toContain('Changes requested on "Oxford MUN 2027"')
    expect(html).toContain('the Committees section for "Oxford MUN 2027" needs a few changes before it can move forward.')
    expect(html).toContain('What needs to change')
    expect(html).toContain('The UNSC committee is missing a chair.')
  })

  it('falls back to a generic line when CHANGES_REQUESTED has no reason', () => {
    const html = renderOrganizerDecisionEmailHtml({ ...CHANGES_REQUESTED_INPUT, reason: undefined })
    expect(html).toContain('What needs to change')
    expect(html).toContain('See your dashboard for details.')
  })

  it('renders the REJECTED eyebrow, headline, body, and "Why" reason block', () => {
    const html = renderOrganizerDecisionEmailHtml(REJECTED_INPUT)
    expect(html).toContain('UPDATE')
    expect(html).toContain('Update on "Oxford MUN 2027"')
    expect(html).toContain('your MUN submission for "Oxford MUN 2027" was not approved this time.')
    expect(html).toContain('Why')
    expect(html).toContain('The venue could not be verified.')
  })

  it('falls back to a generic line when REJECTED has no reason', () => {
    const html = renderOrganizerDecisionEmailHtml({ ...REJECTED_INPUT, reason: undefined })
    expect(html).toContain('Why')
    expect(html).toContain('See your dashboard for details.')
  })

  it('escapes HTML-significant characters in munName, area, and reason', () => {
    const html = renderOrganizerDecisionEmailHtml({
      ...CHANGES_REQUESTED_INPUT,
      munName: '<script>alert(1)</script>',
      area: 'the <b>Committees</b> section',
      reason: 'Fix the <img src=x> tag & retry',
    })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).not.toContain('<b>Committees</b>')
    expect(html).not.toContain('<img src=x>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&lt;b&gt;Committees&lt;/b&gt;')
    expect(html).toContain('&lt;img src=x&gt; tag &amp; retry')
  })

  it('lists the flagged fields under the reason block when present', () => {
    const html = renderOrganizerDecisionEmailHtml({
      ...CHANGES_REQUESTED_INPUT,
      fieldsRequiringCorrection: ['Title of your MUN', 'About your MUN'],
    })
    expect(html).toContain('<li style="font-size:14px; color:#41454d;">Title of your MUN</li>')
    expect(html).toContain('<li style="font-size:14px; color:#41454d;">About your MUN</li>')
  })

  it('renders no field list when fieldsRequiringCorrection is absent or empty', () => {
    const withoutField = renderOrganizerDecisionEmailHtml(CHANGES_REQUESTED_INPUT)
    expect(withoutField).not.toContain('<ul style=')
    const withEmptyArray = renderOrganizerDecisionEmailHtml({ ...CHANGES_REQUESTED_INPUT, fieldsRequiringCorrection: [] })
    expect(withEmptyArray).not.toContain('<ul style=')
  })

  it('escapes HTML-significant characters in flagged field labels', () => {
    const html = renderOrganizerDecisionEmailHtml({
      ...CHANGES_REQUESTED_INPUT,
      fieldsRequiringCorrection: ['<script>alert(1)</script>'],
    })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('includes the logo image and the have-questions footer', () => {
    const html = renderOrganizerDecisionEmailHtml(APPROVED_INPUT)
    expect(html).toContain('https://www.munhub.in/images/logo-lockup.png')
    expect(html).toContain('Have questions?')
    expect(html).toContain('<a href="mailto:organizers@munhub.in"')
  })
})

describe('renderOrganizerDecisionEmailText', () => {
  it('includes the same core content as a plain-text fallback for APPROVED', () => {
    const text = renderOrganizerDecisionEmailText(APPROVED_INPUT)
    expect(text).toContain('"Oxford MUN 2027" is approved')
    expect(text).toContain('Good news - your organizer application for "Oxford MUN 2027" has been approved.')
    expect(text).not.toContain('What needs to change')
    expect(text).toContain('organizers@munhub.in')
  })

  it('includes the reason for CHANGES_REQUESTED', () => {
    const text = renderOrganizerDecisionEmailText(CHANGES_REQUESTED_INPUT)
    expect(text).toContain('Changes requested on "Oxford MUN 2027"')
    expect(text).toContain('What needs to change: The UNSC committee is missing a chair.')
  })

  it('falls back to the generic reason line for REJECTED with no reason', () => {
    const text = renderOrganizerDecisionEmailText({ ...REJECTED_INPUT, reason: undefined })
    expect(text).toContain('Why: See your dashboard for details.')
  })

  it('lists the flagged fields as a bullet list after the reason', () => {
    const text = renderOrganizerDecisionEmailText({
      ...CHANGES_REQUESTED_INPUT,
      fieldsRequiringCorrection: ['Title of your MUN', 'About your MUN'],
    })
    expect(text).toContain('What needs to change: The UNSC committee is missing a chair.\n- Title of your MUN\n- About your MUN')
  })
})
