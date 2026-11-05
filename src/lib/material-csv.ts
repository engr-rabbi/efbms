// Bulk material upload — pure logic (no network, no React): CSV parsing, template, validation,
// duplicate detection. The server re-validates everything; this gives the user a precise preview first.

export const CSV_COLUMNS = [
  'code', 'name', 'category', 'brand', 'model', 'specification', 'size', 'unit',
  'pack_size', 'pack_unit', 'supplier', 'purchase_price', 'selling_price', 'stock_qty', 'min_stock',
] as const
export type CsvColumn = (typeof CSV_COLUMNS)[number]

export const KNOWN_CATEGORIES = [
  'Cable', 'Conduit', 'Accessories', 'Protection', 'Distribution Board', 'Earthing',
  'Switch', 'Socket', 'Light', 'Fan', 'Pipe', 'Fitting', 'Valve', 'Consumable',
  'Sanitary', 'Equipment', 'Other',
]

export const MAX_ROWS = 5000
export const MAX_FILE_BYTES = 2 * 1024 * 1024

/** Header spellings accepted for each column (compared after lower-casing and dropping spaces/_/-). */
const ALIASES: Record<CsvColumn, string[]> = {
  code: ['code', 'materialcode', 'itemcode', 'sku', 'id'],
  name: ['name', 'materialname', 'itemname', 'description'],
  category: ['category', 'type', 'group'],
  brand: ['brand', 'make', 'manufacturer'],
  model: ['model', 'modelno'],
  specification: ['specification', 'spec', 'specs'],
  size: ['size'],
  unit: ['unit', 'uom'],
  pack_size: ['packsize', 'pack', 'packqty'],
  pack_unit: ['packunit', 'packuom'],
  supplier: ['supplier', 'suppliername', 'vendor'],
  purchase_price: ['purchaseprice', 'buyprice', 'cost', 'purchaserate', 'costprice'],
  selling_price: ['sellingprice', 'saleprice', 'sellprice', 'price', 'rate', 'sellingrate'],
  stock_qty: ['stockqty', 'stock', 'openingstock', 'quantity', 'qty'],
  min_stock: ['minstock', 'minimumstock', 'reorderlevel', 'minqty'],
}

const norm = (s: string) => s.toLowerCase().replace(/[\s_\-.]/g, '')

// ------------------------------------------------------------------ CSV text → rows
export function parseCsv(input: string): string[][] {
  let text = input.replace(/^\uFEFF/, '')
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  // delimiter: the one that occurs most outside quotes on the header line
  const count = (ch: string) => { let q = false, n = 0; for (const c of firstLine) { if (c === '"') q = !q; else if (!q && c === ch) n++ } return n }
  const ranked = [',', ';', '\t'].map((d) => [d, count(d)] as const).sort((a, b) => b[1] - a[1])
  const delim = ranked[0][1] > 0 ? ranked[0][0] : ','
  const rows: string[][] = []
  let row: string[] = [], cell = '', inQ = false
  text = text.replace(/\r\n?/g, '\n')
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else inQ = false }
      else cell += c
    } else if (c === '"' && cell === '') inQ = true
    else if (c === delim) { row.push(cell); cell = '' }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else cell += c
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows.filter((r) => r.some((x) => x.trim() !== ''))
}

const csvEscape = (v: string) => (/[",\n\r;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

export function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map(csvEscape).join(',')).join('\r\n') + '\r\n'
}

/** Template with an explanatory first data row set and realistic examples. */
export function templateCsv(): string {
  return toCsv([
    [...CSV_COLUMNS],
    ['CBL-NEW-01', '2.5 mm² Single Core Cable (Red)', 'Cable', 'BRB', 'Copper 7/0.67', '450/750V PVC', '2.5 mm²', 'Meter', '100', 'Coil', 'Bashundhara Cable', '38.50', '46', '0', '200'],
    ['SW-NEW-01', '1-Gang 1-Way Switch', 'Switch', 'Clipsal', 'C2000', '10A 250V', '1 Gang', 'Pcs', '1', 'Pcs', '', '120', '165', '0', '20'],
    ['PIPE-NEW-01', 'PPR Pipe PN20', 'Pipe', 'Aqua', '', 'PN20', '20 mm', 'Meter', '4', 'Pcs', '', '95', '130', '0', '40'],
  ])
}

// ------------------------------------------------------------------ validation
export interface MaterialDraft {
  code: string; name: string; category: string; brand: string; model: string; specification: string; size: string
  unit: string; packSize: number; packUnit: string; supplierName: string; supplierId: string
  purchasePrice: number; sellingPrice: number; stockQty: number; minStock: number
}
export type RowStatus = 'ok' | 'error' | 'dup-file' | 'dup-existing'
export interface PreviewRow {
  line: number // 1-based line in the file (header = 1)
  status: RowStatus
  data: MaterialDraft
  errors: string[]
  warnings: string[]
  existingId?: string
}
export interface Preview {
  rows: PreviewRow[]
  unknownColumns: string[]
  missingColumns: string[]
  fatal: string | null
  counts: { total: number; ok: number; error: number; dupFile: number; dupExisting: number; warnings: number }
}
export interface ExistingMaterial { id: string; code: string; name: string; brand: string; size: string; specification: string }
export interface Supplier { id: string; name: string }

const BN_DIGITS: Record<string, string> = { '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4', '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9' }

/** "1,250.50", "৳ 1250", "১২৫০" → number; '' → null; invalid → NaN. */
export function parseNumber(raw: string): number | null {
  let s = raw.trim()
  if (s === '') return null
  s = s.replace(/[০-৯]/g, (d) => BN_DIGITS[d]).replace(/[৳,\s]|BDT|Tk\.?/gi, '')
  if (s === '' || !/^-?\d*\.?\d+(e[+-]?\d+)?$/i.test(s)) return NaN
  return Number(s)
}

const LIMITS = { code: 80, name: 300, category: 80, brand: 120, model: 120, specification: 500, size: 80, unit: 30, packUnit: 30 }
const MAX_NUM = 1e10

const dupKey = (m: { name: string; brand: string; size: string; specification: string }) =>
  [m.name, m.brand, m.size, m.specification].map((x) => x.trim().toLowerCase().replace(/\s+/g, ' ')).join('|')

export function buildPreview(csvText: string, existing: ExistingMaterial[], suppliers: Supplier[], categories: string[] = KNOWN_CATEGORIES): Preview {
  const empty = (fatal: string | null): Preview => ({ rows: [], unknownColumns: [], missingColumns: [], fatal, counts: { total: 0, ok: 0, error: 0, dupFile: 0, dupExisting: 0, warnings: 0 } })
  const table = parseCsv(csvText)
  if (table.length < 2) return empty('The file has no data rows. Download the template and fill it in.')
  if (table.length - 1 > MAX_ROWS) return empty(`Too many rows (${table.length - 1}). The limit is ${MAX_ROWS} per upload.`)

  // header → column index
  const header = table[0].map((h) => h.trim())
  const colIdx = new Map<CsvColumn, number>()
  const unknownColumns: string[] = []
  header.forEach((h, i) => {
    const n = norm(h)
    const col = CSV_COLUMNS.find((c) => ALIASES[c].includes(n))
    if (col && !colIdx.has(col)) colIdx.set(col, i)
    else if (h) unknownColumns.push(h)
  })
  const missingColumns = (['code', 'name'] as CsvColumn[]).filter((c) => !colIdx.has(c))
  if (missingColumns.length) {
    return { ...empty(`Required column(s) missing: ${missingColumns.join(', ')}. Use the template header.`), unknownColumns, missingColumns }
  }

  const catMap = new Map(categories.map((c) => [c.toLowerCase(), c]))
  const supMap = new Map(suppliers.map((s) => [s.name.trim().toLowerCase(), s]))
  const existingByCode = new Map(existing.map((m) => [m.code.trim().toLowerCase(), m]))
  const existingByKey = new Map(existing.map((m) => [dupKey(m), m]))
  const seenCodes = new Map<string, number>() // code → first line
  const seenKeys = new Map<string, number>()

  const rows: PreviewRow[] = table.slice(1).map((cells, idx) => {
    const line = idx + 2
    const get = (c: CsvColumn) => { const i = colIdx.get(c); return i === undefined ? '' : (cells[i] ?? '').trim() }
    const errors: string[] = [], warnings: string[] = []
    const d: MaterialDraft = {
      code: get('code'), name: get('name'), category: get('category'), brand: get('brand'), model: get('model'),
      specification: get('specification'), size: get('size'), unit: get('unit'), packSize: 1, packUnit: get('pack_unit'),
      supplierName: get('supplier'), supplierId: '', purchasePrice: 0, sellingPrice: 0, stockQty: 0, minStock: 0,
    }
    // text rules (same limits as the server)
    if (!d.code) errors.push('code is required')
    if (!d.name) errors.push('name is required')
    if (/[\s]/.test(d.code) && d.code) warnings.push('code contains spaces')
    ;(Object.keys(LIMITS) as Array<keyof typeof LIMITS>).forEach((k) => {
      if ((d[k] as string).length > LIMITS[k]) errors.push(`${k} is too long (max ${LIMITS[k]} characters)`)
    })
    // formulas pasted from Excel are harmless (stored as text) but usually a mistake
    if (/^[=+\-@]/.test(d.name) || /^[=@]/.test(d.code)) warnings.push('starts with = + - or @ — stored as plain text')
    // category
    if (!d.category) { d.category = 'Other'; warnings.push('category empty → "Other"') }
    else {
      const k = catMap.get(d.category.toLowerCase())
      if (k) d.category = k
      else warnings.push(`new category "${d.category}" will be created`)
    }
    if (!d.unit) d.unit = 'Pcs'
    if (!d.packUnit) d.packUnit = 'Pcs'
    // numbers
    const num = (col: CsvColumn, label: string, def: number, min = 0): number => {
      const raw = get(col)
      const v = parseNumber(raw)
      if (v === null) return def
      if (Number.isNaN(v)) { errors.push(`${label} "${raw}" is not a number`); return def }
      if (v < min) { errors.push(`${label} must not be negative`); return def }
      if (v > MAX_NUM) { errors.push(`${label} is too large`); return def }
      return v
    }
    d.packSize = num('pack_size', 'pack_size', 1)
    if (d.packSize === 0) { warnings.push('pack_size 0 → 1'); d.packSize = 1 }
    d.purchasePrice = num('purchase_price', 'purchase_price', 0)
    d.sellingPrice = num('selling_price', 'selling_price', 0)
    d.stockQty = num('stock_qty', 'stock_qty', 0)
    d.minStock = num('min_stock', 'min_stock', 0)
    if (d.sellingPrice > 0 && d.purchasePrice > d.sellingPrice) warnings.push('selling price is lower than purchase price (negative margin)')
    if (d.sellingPrice === 0 && d.purchasePrice === 0) warnings.push('both prices are 0 — BOQ cost will be 0 for this material')
    // supplier
    if (d.supplierName) {
      const s = supMap.get(d.supplierName.toLowerCase())
      if (s) d.supplierId = s.id
      else warnings.push(`supplier "${d.supplierName}" not found`)
    }

    // duplicates
    let status: RowStatus = errors.length ? 'error' : 'ok'
    let existingId: string | undefined
    const ck = d.code.toLowerCase()
    if (ck) {
      if (seenCodes.has(ck)) {
        errors.push(`duplicate code inside the file (first seen on line ${seenCodes.get(ck)})`)
        status = 'dup-file'
      } else {
        seenCodes.set(ck, line)
        const ex = existingByCode.get(ck)
        if (ex && status !== 'error') { status = 'dup-existing'; existingId = ex.id; warnings.push(`code already exists in the library ("${ex.name}")`) }
      }
    }
    if (status === 'ok' || status === 'dup-existing') {
      const key = dupKey(d)
      if (d.name) {
        if (seenKeys.has(key) && seenKeys.get(key) !== line) warnings.push(`same name/brand/size/spec as line ${seenKeys.get(key)} (different code) — possible duplicate`)
        else seenKeys.set(key, line)
        const ex = existingByKey.get(key)
        if (ex && ex.code.toLowerCase() !== ck) warnings.push(`looks like existing material ${ex.code} ("${ex.name}") — possible duplicate`)
      }
    }
    return { line, status, data: d, errors, warnings, existingId }
  })

  const counts = {
    total: rows.length,
    ok: rows.filter((r) => r.status === 'ok').length,
    error: rows.filter((r) => r.status === 'error').length,
    dupFile: rows.filter((r) => r.status === 'dup-file').length,
    dupExisting: rows.filter((r) => r.status === 'dup-existing').length,
    warnings: rows.filter((r) => r.warnings.length > 0 && r.status !== 'error').length,
  }
  return { rows, unknownColumns, missingColumns, fatal: null, counts }
}

/** CSV of the rejected rows with the reasons, so the user can fix and re-upload. */
export function errorReportCsv(rows: PreviewRow[]): string {
  return toCsv([
    ['line', ...CSV_COLUMNS, 'problems'],
    ...rows.filter((r) => r.errors.length).map((r) => [
      String(r.line), r.data.code, r.data.name, r.data.category, r.data.brand, r.data.model, r.data.specification, r.data.size, r.data.unit,
      String(r.data.packSize), r.data.packUnit, r.data.supplierName, String(r.data.purchasePrice), String(r.data.sellingPrice), String(r.data.stockQty), String(r.data.minStock),
      r.errors.join('; '),
    ]),
  ])
}
