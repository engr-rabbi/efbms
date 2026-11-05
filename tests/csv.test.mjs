import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { build } from 'esbuild'
const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, 'node_modules/.cache/csv-unit.mjs')
await build({ entryPoints: [path.join(root, 'src/lib/material-csv.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' })
const C = await import(out)

test('parser: BOM, CRLF, quotes, escaped quotes, embedded newline/comma, semicolon & tab delimiters', () => {
  assert.deepEqual(C.parseCsv('\uFEFFa,b\r\n"x, ""y""","line1\nline2"\r\n'), [['a', 'b'], ['x, "y"', 'line1\nline2']])
  assert.deepEqual(C.parseCsv('a;b\n1;"2;3"'), [['a', 'b'], ['1', '2;3']])
  assert.deepEqual(C.parseCsv('a\tb\n1\t2'), [['a', 'b'], ['1', '2']])
  assert.deepEqual(C.parseCsv('a,b\n\n,\n1,2\n'), [['a', 'b'], ['1', '2']], 'blank rows are dropped')
})
test('numbers: thousands separators, currency, Bengali digits, invalid', () => {
  assert.equal(C.parseNumber('1,250.50'), 1250.5); assert.equal(C.parseNumber('৳ 1250'), 1250); assert.equal(C.parseNumber('১২৫০'), 1250)
  assert.equal(C.parseNumber(''), null); assert.ok(Number.isNaN(C.parseNumber('12abc'))); assert.ok(Number.isNaN(C.parseNumber('1.2.3')))
})
test('template is valid and round-trips through validation with no errors', () => {
  const p = C.buildPreview(C.templateCsv(), [], [])
  assert.equal(p.fatal, null); assert.equal(p.counts.ok, 3); assert.equal(p.counts.error, 0)
  assert.deepEqual(C.parseCsv(C.templateCsv())[0], [...C.CSV_COLUMNS])
})
test('header aliases, missing required columns, too many rows, unknown columns', () => {
  const p = C.buildPreview('Item Code,Material Name,UOM,Buy Price,Sale Price,Vendor,Colour\nA1,Thing,Meter,5,9,,red', [], [])
  assert.equal(p.rows[0].data.unit, 'Meter'); assert.equal(p.rows[0].data.purchasePrice, 5); assert.equal(p.rows[0].data.sellingPrice, 9); assert.deepEqual(p.unknownColumns, ['Colour'])
  assert.match(C.buildPreview('foo,bar\n1,2', [], []).fatal, /Required column/)
  assert.match(C.buildPreview('code,name', [], []).fatal, /no data rows/)
  assert.match(C.buildPreview('code,name\n' + Array.from({ length: C.MAX_ROWS + 1 }, (_, i) => `c${i},n`).join('\n'), [], []).fatal, /Too many rows/)
})
test('duplicates: in file (first wins), vs library, case-insensitive, same name+size different code', () => {
  const ex = [{ id: 'e', code: 'ABC-1', name: 'Cable 2.5', brand: 'BRB', size: '2.5', specification: '' }]
  const p = C.buildPreview('code,name,brand,size\nabc-1,Cable,,\nX-1,Cable 2.5,BRB,2.5\nx-1,again,,\nY-2,Cable 2.5,BRB,2.5', ex, [])
  assert.deepEqual(p.rows.map((r) => r.status), ['dup-existing', 'ok', 'dup-file', 'ok'])
  assert.ok(p.rows[1].warnings.some((w) => /possible duplicate/.test(w)) && p.rows[3].warnings.some((w) => /possible duplicate/.test(w)))
  assert.equal(p.rows[0].existingId, 'e')
})
test('limits mirror the server: lengths, negatives, formulas stay text, error report', () => {
  const p = C.buildPreview(`code,name,purchase_price\n${'C'.repeat(81)},ok,1\nA,${'n'.repeat(301)},1\nB,neg,-1\nF,=SUM(A1),2`, [], [])
  assert.deepEqual(p.rows.map((r) => r.status), ['error', 'error', 'error', 'ok'])
  assert.ok(p.rows[3].warnings.some((w) => /plain text/.test(w)))
  const rep = C.parseCsv(C.errorReportCsv(p.rows))
  assert.equal(rep.length, 4); assert.equal(rep[0].at(-1), 'problems')
})
