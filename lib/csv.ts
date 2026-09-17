// -----------------------------------------------------------------------------
// csv — RFC 4180 serialisation with spreadsheet formula-injection defence
// -----------------------------------------------------------------------------
//
// Exported files are opened in Excel / Google Sheets, which evaluate any cell
// that starts with `=`, `+`, `-` or `@` as a formula (and tab / carriage
// return are treated the same way by some importers). Delegate-supplied text
// (names, institutions, form answers) must never be able to run as a formula
// on the organizer's machine, so every such cell is prefixed with an
// apostrophe, which spreadsheets render as plain text. The cost: a value like
// "+91 98765 43210" shows up as "'+91 98765 43210" in a plain text editor —
// the standard OWASP trade-off.

const FORMULA_TRIGGER = /^[=+\-@\t\r]/

export type CsvCell = string | number | boolean | null | undefined

/** Prefixes a cell that a spreadsheet would evaluate as a formula. */
export function neutralizeSpreadsheetCell(value: string): string {
  return FORMULA_TRIGGER.test(value) ? `'${value}` : value
}

function formatCell(value: CsvCell): string {
  if (value === null || value === undefined) return ''
  // Only free text can smuggle a formula; a number we produced ourselves
  // (e.g. an amount) stays numeric so the spreadsheet can sum it.
  const text = typeof value === 'string' ? neutralizeSpreadsheetCell(value) : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Serialises rows (header first) with CRLF line endings. No BOM — callers add one if the consumer needs it. */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<CsvCell>>): string {
  return rows.map((row) => row.map(formatCell).join(',')).join('\r\n') + '\r\n'
}
