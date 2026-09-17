import { describe, expect, it } from 'vitest'
import { neutralizeSpreadsheetCell, toCsv } from './csv'

describe('neutralizeSpreadsheetCell', () => {
  it.each(['=SUM(A1:A2)', '+91 98765 43210', '-2+3', '@cmd', '\tx', '\rx'])(
    'prefixes %j with an apostrophe',
    (value) => {
      expect(neutralizeSpreadsheetCell(value)).toBe(`'${value}`)
    },
  )

  it('leaves ordinary text alone', () => {
    expect(neutralizeSpreadsheetCell('Asha Rao')).toBe('Asha Rao')
    expect(neutralizeSpreadsheetCell('a=b')).toBe('a=b')
    expect(neutralizeSpreadsheetCell('')).toBe('')
  })
})

describe('toCsv', () => {
  it('quotes commas, quotes and newlines and uses CRLF rows', () => {
    expect(toCsv([['Name', 'Note'], ['Rao, Asha', 'said "hi"\nthen left']])).toBe(
      'Name,Note\r\n"Rao, Asha","said ""hi""\nthen left"\r\n',
    )
  })

  it('neutralises formulas before quoting, and keeps numbers numeric', () => {
    expect(toCsv([['=HYPERLINK("http://evil","x")', -5, 1499, true, null, undefined]])).toBe(
      `"'=HYPERLINK(""http://evil"",""x"")",-5,1499,true,,\r\n`,
    )
  })
})
