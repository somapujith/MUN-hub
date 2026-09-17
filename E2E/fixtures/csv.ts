/**
 * A small RFC 4180 parser for asserting on CSV downloads: quoted fields,
 * doubled quotes, CRLF or LF row ends. Strips a leading UTF-8 BOM.
 */
export function parseCsv(input: string): { header: string[]; rows: string[][] } {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"'
        i += 1
      } else if (char === '"') {
        quoted = false
      } else {
        field += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      record.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1
      record.push(field)
      records.push(record)
      record = []
      field = ''
    } else {
      field += char
    }
  }
  if (field || record.length) {
    record.push(field)
    records.push(record)
  }
  const [header = [], ...rows] = records
  return { header, rows }
}
