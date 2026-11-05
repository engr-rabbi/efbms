// Migrates the REAL old SQLite demo database (exported by scripts/export-sqlite.py) into the new
// Sheets/Drive structure and verifies record counts, relationships, drawing data and calculations.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'
import { createEnv } from './gas-mock.mjs'

const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, 'node_modules/.cache/mig-bundle.mjs')
await build({ entryPoints: [path.join(root, 'src/lib/backend/index.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
  alias: { '@': path.join(root, 'src') }, define: { 'import.meta.env': '{"BASE_URL":"/repo/"}' } })
const store = new Map()
const st = () => ({ getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) })
globalThis.window = { EFBMS_CONFIG: { gasUrl: 'https://script.google.com/macros/s/TEST/exec' } }
globalThis.sessionStorage = st(); globalThis.localStorage = st()
try { Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true }) } catch {}
const env = createEnv()
globalThis.fetch = async (_u, init) => ({ status: 200, text: async () => env.fn('doPost')({ postData: { contents: init.body } }).getContent() })
const { callApi, resetRepo } = await import(out)

const ORDER = ['company', 'designRules', 'settings', 'suppliers', 'materials', 'materialImages', 'priceHistory', 'projects', 'floors', 'rooms', 'points', 'fixtures',
  'circuits', 'estimateItems', 'boqOverrides', 'drawings', 'quotations', 'purchaseOrders', 'stockMovements']
const exp = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/demo-export.json'), 'utf8'))

env.setup({ email: 'admin@example.com', password: 'S3cure-Admin-Pass' })
const admin = env.token('admin@example.com', 'S3cure-Admin-Pass')

function importAll() {
  const report = {}
  for (const t of ORDER) {
    const all = exp.tables[t] ?? []
    const r = { created: 0, skipped: 0, errors: [] }
    for (let i = 0; i < all.length; i += 150) {
      const x = env.ok('migration.import', { table: t, rows: all.slice(i, i + 150) }, admin)
      r.created += x.created; r.skipped += x.skipped; r.errors.push(...x.errors)
    }
    report[t] = r
  }
  return report
}

test('old database migrates completely: counts, relationships, drawings, images', () => {
  const rep = importAll()
  for (const t of ORDER) {
    const n = (exp.tables[t] ?? []).length
    assert.equal(rep[t].errors.length, 0, `${t}: ${JSON.stringify(rep[t].errors.slice(0, 2))}`)
    assert.equal(rep[t].created, n, `${t} created`)
  }
  const chk = env.ok('integrity.check', { deep: true }, admin)
  assert.equal(chk.ok, true, JSON.stringify(chk.issues))
  for (const t of ORDER) if (t !== 'drawings') assert.equal(chk.counts[t], exp.counts[t] ?? 0, `${t} row count in sheet`)
  assert.equal(chk.counts.drawings, exp.counts.drawings)
  // idempotent re-run
  const again = importAll()
  assert.ok(ORDER.every((t) => again[t].created === 0 && again[t].errors.length === 0))
})

test('migrated drawing is byte-for-byte the same editable document; sample photos resolve; totals match', async () => {
  resetRepo()
  await callApi('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'admin@example.com', password: 'S3cure-Admin-Pass' }) })
  const projectId = exp.tables.projects[0].id
  const d = await callApi(`/api/drawings/${projectId}`)
  const orig = exp.tables.drawings[0]
  assert.deepEqual(JSON.parse(d.drawings[0].data), JSON.parse(orig.data))
  assert.equal(d.drawings[0].scalePxPerMeter, orig.scalePxPerMeter)
  assert.equal(d.drawings[0].floorNumber, orig.floorNumber)

  const { materials } = await callApi('/api/materials')
  assert.equal(materials.length, exp.tables.materials.filter((m) => m.active !== false).length)
  const img = materials.flatMap((m) => m.images)[0]
  assert.match(img.url, /^\/repo\/images\/materials\//, 'bundled sample photos get the GitHub Pages base path')

  // project structure identical to the old DB
  const p = (await callApi(`/api/projects/${projectId}`)).project
  const rooms = p.floors.flatMap((f) => f.rooms)
  assert.equal(rooms.length, exp.tables.rooms.length)
  assert.equal(rooms.flatMap((r) => r.points).length, exp.tables.points.length)
  assert.equal(rooms.flatMap((r) => r.fixtures).length, exp.tables.fixtures.length)
  assert.equal(p.circuits.length, exp.tables.circuits.length)

  // stored estimate == old stored estimate, and re-running the engine on migrated data gives the same item count
  const stored = await callApi(`/api/estimation/${projectId}`)
  assert.equal(stored.items.length, exp.tables.estimateItems.length)
  const sum = (a) => Math.round(a.reduce((s, i) => s + i.qty, 0) * 1000) / 1000
  assert.equal(sum(stored.items), sum(exp.tables.estimateItems))
  const rerun = await callApi(`/api/estimation/${projectId}`, { method: 'POST', body: '{}' })
  assert.equal(rerun.itemCount, exp.tables.estimateItems.length, 'engine output unchanged after migration')
  const boq = await callApi(`/api/boq/${projectId}`)
  assert.ok(boq.lines.length > 0 && boq.totals.sellingTotal > 0)

  // quotation snapshot untouched
  const q = (await callApi('/api/quotations')).quotations[0]
  assert.equal(q.grandTotal, exp.tables.quotations[0].grandTotal)
  assert.equal(q.items, exp.tables.quotations[0].items)
})
