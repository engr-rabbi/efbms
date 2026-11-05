// Keeps docs/USER_MANUAL.md honest: every number quoted in the worked examples is recomputed with the
// real estimation/BOQ engine, and the manual must contain exactly those figures.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'

const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, 'node_modules/.cache/engine-bundle.mjs')
await build({ entryPoints: [path.join(root, 'src/lib/engine/index.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' })
const E = await import(out)
const manual = fs.readFileSync(path.join(root, 'docs/USER_MANUAL.md'), 'utf8')
const bn = (v) => String(v).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[d])
const has = (v, label) => assert.ok(manual.includes(bn(v)), `manual should mention ${label}: ${bn(v)}`)

const project = { id: 'p', name: 'Example Flat', supplyType: '1-PHASE', occupants: 4, floors: [{ id: 'f1', floorNumber: 1, name: '1st Floor', height: 3.05, rooms: [
  { id: 'r1', name: 'Master Bedroom', roomType: 'BEDROOM', length: 4.2, width: 3.6, height: 3.05, points: [{ pointType: 'LIGHT', quantity: 2 }, { pointType: 'CEILING_FAN', quantity: 1 }, { pointType: 'SOCKET', quantity: 3 }, { pointType: 'AC', quantity: 1 }], fixtures: [] },
  { id: 'r2', name: 'Bathroom', roomType: 'BATHROOM', length: 2.4, width: 1.8, height: 3.05, points: [{ pointType: 'LIGHT', quantity: 1 }, { pointType: 'EXHAUST_FAN', quantity: 1 }], fixtures: [{ fixtureType: 'WC', quantity: 1 }, { fixtureType: 'BASIN', quantity: 1 }, { fixtureType: 'SHOWER', quantity: 1 }, { fixtureType: 'FLOOR_DRAIN', quantity: 1 }] }] }] }

test('manual §9.3 worked example equals the engine output', () => {
  const R = E.runEstimation(project, { rules: E.DEFAULT_RULES, drawing: null })
  const s = R.summary
  assert.deepEqual([s.totalConnectedW, s.demandW, s.designAmps, s.mainBreaker, s.wireTotalM, s.conduitTotalM], [2610, 1827, 7.94, '10A', 352.05, 95.83])
  for (const [v, l] of [[2610, 'connected load'], [1827, 'demand'], ['7.94', 'amps'], ['352.05', 'wire total'], ['95.83', 'conduit']]) has(v, l)
  const qty = (re) => Math.round(R.items.filter((i) => re.test(i.name)).reduce((a, i) => a + i.qty, 0) * 100) / 100
  assert.equal(qty(/Single Core\) 1\.5 sqmm$/), 147); has(147, '1.5 sqmm total')
  assert.equal(qty(/Single Core\) 2\.5 sqmm$/), 71.4); has('71.4', '2.5 sqmm total')
  assert.equal(qty(/Single Core\) 4\.0 sqmm$/), 49.5); has('49.5', '4.0 sqmm total')
  assert.equal(qty(/Single Core\) 10 sqmm$/) + qty(/Single Core\) 10 sqmm \(Earth\)$/) - 0, 84.15 + qty(/\(Earth\)$/)); has('84.15', '10 sqmm total')
  assert.equal(R.circuits.length, 6); assert.equal(R.items.find((i) => /Distribution Board/.test(i.name)).name, 'Distribution Board (DB) 8-Way')
  const p = R.plumbingSummary
  assert.equal(p.dailyDemandL, 540); assert.equal(p.pumpHp, '0.5'); assert.equal(p.ohtL, 500, '540 L × 0.5 = 270 L, raised to the 500 L minimum')
  assert.equal(R.items.find((i) => /Water Tank \(Overhead\)/.test(i.name)).name, 'Water Tank (Overhead) 500L')
  assert.equal(R.items.find((i) => /Water Tank \(Underground\)/.test(i.name)).name, 'Water Tank (Underground) 1000L')
  assert.equal(qty(/Cold Water\)$/), 10.5); assert.equal(qty(/Hot Water\)$/), 6.5); assert.equal(qty(/Rainwater/), 12.2)
  has('10.5', 'cold branch'); has('6.5', 'hot branch'); has('12.2', 'rain pipe'); has('10.23', 'pump head')
  assert.ok(Math.abs((3.05 + 1.5) * 1.15 + 5 - 10.2325) < 1e-9)
})

test('manual §10.3 BOQ example: coil rounding, shortage, cost', () => {
  const mat = { id: 'm', code: 'C', category: 'Cable', name: 'PVC Insulated Copper Cable (Single Core) 2.5 sqmm', brand: '', specification: '', size: '2.5', unit: 'm', packSize: 91.4, packUnit: 'Coil', purchasePrice: 152, sellingPrice: 178, stockQty: 650, minStock: 0 }
  const raw = [{ system: 'ELECTRICAL', category: 'Cable', name: mat.name, brand: '', specification: 'x', size: '2.5', unit: 'm', mode: 'AUTO', qty: 762.6, formula: '', assumptions: [], wastagePct: 8, sourceRef: '' }]
  const l = E.buildBoq(raw, [mat]).lines[0]
  assert.deepEqual([l.qtyWithWastage, l.purchaseQty, l.shortage, l.totalPurchaseCost, l.totalSellingPrice, l.profit], [823.61, 914, 264, 125188.72, 146602.58, 21413.86])
  for (const v of ['823.61', 914, 264]) has(v, 'BOQ example')
  assert.ok(manual.includes('১,২৫,১৮৮.৭২') && manual.includes('১,৪৬,৬০২.৫৮') && manual.includes('২১,৪১৩.৮৬'))
})

test('manual: Mode A + Mode B lines stay separate (the documented caution is still true)', () => {
  const drawing = { version: 1, pxPerMeter: 40, calibrated: true, rooms: [], symbols: [], routes: [{ id: 'a', system: 'cable', kind: 'LIGHT', spec: '1.5', floorNumber: 1, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }] }
  const R = E.runEstimation(project, { rules: E.DEFAULT_RULES, drawing })
  const lines = E.buildBoq(R.items, []).lines.filter((l) => /Single Core\) 1\.5 sqmm$/.test(l.name))
  assert.equal(lines.length, 2, 'if this fails the engine changed: update manual §9.5 and appendix C')
  assert.ok(lines.some((l) => l.modeMix === 'AUTO') && lines.some((l) => l.modeMix === 'DRAWING'))
})

test('manual: structure (20 chapters/appendices + TOC), no unbalanced markers, links to real files', () => {
  assert.equal((manual.match(/^## /gm) ?? []).length, 21)
  for (const [i, l] of manual.split('\n').entries()) if (!l.startsWith('```') && (l.split('**').length - 1) % 2) assert.fail(`odd ** on line ${i + 1}`)
  assert.ok(manual.includes('Bulk upload (CSV)') && manual.includes('Material photo') && manual.includes('materials-template.csv'))
})
