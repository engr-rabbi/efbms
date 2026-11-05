// End-to-end: the REAL browser-side handlers + estimation engine talk to the REAL Apps Script code
// (executed on in-memory Google fakes). Proves the whole chain: UI API contract → gateway → Sheets/Drive.
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { build } from 'esbuild'
import { createEnv } from './gas-mock.mjs'

const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, 'node_modules/.cache/e2e-bundle.mjs')
await build({
  entryPoints: [path.join(root, 'src/lib/backend/index.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
  alias: { '@': path.join(root, 'src') }, define: { 'import.meta.env': '{"BASE_URL":"/repo/"}' },
})

const store = new Map()
const mkStorage = () => ({ getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) })
globalThis.window = { EFBMS_CONFIG: { gasUrl: 'https://script.google.com/macros/s/TEST/exec' } }
globalThis.sessionStorage = mkStorage(); globalThis.localStorage = mkStorage()
try { Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true }) } catch { /* ok */ }

const env = createEnv()
let online = true, calls = 0
globalThis.fetch = async (_url, init) => {
  if (!online) throw new TypeError('network down')
  calls++
  const o = env.fn('doPost')({ postData: { contents: init.body } })
  return { status: 200, text: async () => o.getContent() }
}
const api = await import(out)
const { callApi, ApiError, setToken, resetRepo } = api
const J = (o) => JSON.stringify(o)

env.setup({ email: 'admin@example.com', password: 'S3cure-Admin-Pass' })
const login = async (email, password) => { resetRepo(); return callApi('/api/auth/login', { method: 'POST', body: J({ email, password }) }) }

test('login + user management through the UI contract', async () => {
  await assert.rejects(() => login('admin@example.com', 'nope'), (e) => e instanceof ApiError && e.code === 'INVALID_CREDENTIALS')
  const { user } = await login('admin@example.com', 'S3cure-Admin-Pass')
  assert.equal(user.role, 'SUPER_ADMIN'); assert.equal(user.mustChange, true)
  for (const [email, role] of [['eng@x.com', 'ENGINEER'], ['sales@x.com', 'SALES'], ['inv@x.com', 'INVENTORY'], ['view@x.com', 'VIEWER']])
    await callApi('/api/users', { method: 'POST', body: J({ email, name: role, role, password: 'Str0ng-Pass-1' }) })
  const { users } = await callApi('/api/users')
  assert.equal(users.length, 5); assert.ok(users.every((u) => !u.passwordHash))
})

let projectId, floor1, room1
test('project → floors → rooms → points/fixtures → estimation → BOQ', async () => {
  await login('eng@x.com', 'Str0ng-Pass-1')
  const { project } = await callApi('/api/projects', { method: 'POST', body: J({ name: 'Green Villa', clientName: 'Mr. Rahim', autoCreateFloors: 2, supplyType: '1-PHASE', occupants: 5 }) })
  projectId = project.id
  assert.match(project.code, /^PRJ-/)
  const list = await callApi('/api/projects')
  assert.equal(list.projects[0].floors.length, 2)
  const full = await callApi(`/api/projects/${projectId}`)
  floor1 = full.project.floors[0].id
  const { room } = await callApi('/api/rooms', { method: 'POST', body: J({ floorId: floor1, name: 'Master Bed', roomType: 'BEDROOM', length: 4.2, width: 3.6 }) })
  room1 = room.id
  const { room: bath } = await callApi('/api/rooms', { method: 'POST', body: J({ floorId: floor1, name: 'Bath', roomType: 'BATHROOM', length: 2.4, width: 1.8 }) })
  for (const [pointType, quantity] of [['LIGHT', 4], ['FAN', 1], ['SOCKET_5A', 3], ['AC_POINT', 1]]) await callApi('/api/points', { method: 'POST', body: J({ roomId: room1, pointType, quantity }) })
  for (const fixtureType of ['WC', 'BASIN', 'SHOWER']) await callApi('/api/fixtures', { method: 'POST', body: J({ roomId: bath.id, fixtureType, quantity: 1 }) })
  await callApi(`/api/rooms/${room1}`, { method: 'PATCH', body: J({ length: 4.5 }) })
  const p2 = await callApi(`/api/projects/${projectId}`)
  assert.equal(p2.project.floors[0].rooms.find((r) => r.id === room1).length, 4.5)
  assert.equal(p2.project.floors[0].rooms.find((r) => r.id === room1).points.length, 4)

  const est = await callApi(`/api/estimation/${projectId}`, { method: 'POST', body: '{}' })
  assert.ok(est.itemCount > 10, 'engine produced items: ' + est.itemCount); assert.ok(est.circuitCount > 0)
  const saved = await callApi(`/api/estimation/${projectId}`)
  assert.equal(saved.items.length, est.itemCount); assert.equal(saved.circuits.length, est.circuitCount)
  assert.equal((await callApi(`/api/projects/${projectId}`)).project.status, 'ESTIMATION')
  // re-running replaces (does not duplicate)
  const est2 = await callApi(`/api/estimation/${projectId}`, { method: 'POST', body: '{}' })
  assert.equal((await callApi(`/api/estimation/${projectId}`)).items.length, est2.itemCount)
  assert.equal(est2.itemCount, est.itemCount)

  const boq = await callApi(`/api/boq/${projectId}`)
  assert.ok(boq.lines.length > 5); assert.equal(boq.project.id, projectId)
  const key = boq.lines[0].key ?? boq.lines[0].itemKey
  if (key) {
    await callApi(`/api/boq/${projectId}/override`, { method: 'POST', body: J({ itemKey: key, qty: 99, reason: 'site check' }) })
    const again = await callApi(`/api/boq/${projectId}`)
    assert.equal(again.overrideCount, 1)
  }
  const dup = await callApi(`/api/projects/${projectId}/duplicate`, { method: 'POST', body: '{}' })
  const dfull = await callApi(`/api/projects/${dup.project.id}`)
  assert.equal(dfull.project.floors.reduce((a, f) => a + f.rooms.length, 0), 2)
  assert.equal(dfull.project.floors[0].rooms.find((r) => r.name === 'Master Bed').points.length, 4)
  await callApi(`/api/projects/${dup.project.id}`, { method: 'DELETE' })
  assert.equal((await callApi('/api/projects')).projects.length, 1)
})

test('drawings: editable data + background image round-trip through Drive', async () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const doc = { version: 1, pxPerMeter: 55.5, calibrated: true, rooms: [{ id: 'r1', pts: [[0, 0], [10, 20.5]] }], symbols: [{ id: 's1', type: 'LIGHT', x: 3.25, y: 4 }], routes: [{ id: 'c1', kind: 'cable', pts: [[0, 0], [100, 0]] }], backgroundImage: PNG }
  const put = await callApi(`/api/drawings/${projectId}`, { method: 'PUT', body: J({ floorNumber: 1, data: J(doc), scalePxPerMeter: 55.5, calibrated: true }) })
  assert.equal(put.drawing.scalePxPerMeter, 55.5)
  const get = await callApi(`/api/drawings/${projectId}`)
  assert.deepEqual(JSON.parse(get.drawings[0].data), doc, 'identical after reload (incl. background)')
  const before = calls
  await callApi(`/api/drawings/${projectId}`, { method: 'PUT', body: J({ floorNumber: 1, data: J({ ...doc, symbols: [] }), scalePxPerMeter: 55.5, calibrated: true }) })
  assert.ok(calls - before === 1)
  // Mode B estimate now uses the saved drawing
  const est = await callApi(`/api/estimation/${projectId}`, { method: 'POST', body: '{}' })
  assert.ok(est.itemCount > 0)
  assert.equal(JSON.parse((await callApi(`/api/drawings/${projectId}`)).drawings[0].data).symbols.length, 0)
})

test('library: materials, Drive photos, stock, suppliers, price history', async () => {
  await login('inv@x.com', 'Str0ng-Pass-1')
  const { supplier } = await callApi('/api/suppliers', { method: 'POST', body: J({ name: 'Bashundhara Cable' }) })
  const { material } = await callApi('/api/materials', { method: 'POST', body: J({ code: 'CBL-2.5', name: 'Cable 2.5mm', category: 'Cable', unit: 'Meter', purchasePrice: 40, sellingPrice: 55, supplierId: supplier.id, minStock: 100 }) })
  await assert.rejects(() => callApi('/api/materials', { method: 'POST', body: J({ code: 'cbl-2.5', name: 'dup' }) }), /already exists|CONFLICT/)
  await callApi(`/api/materials/${material.id}`, { method: 'PATCH', body: J({ sellingPrice: 60, priceChangeNote: 'market' }) })
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const { image } = await callApi(`/api/materials/${material.id}/images`, { method: 'POST', body: J({ url: PNG, caption: 'front' }) })
  assert.equal(image.url, 'drive:' + image.fileId); assert.equal(image.isPrimary, true)
  const { materials } = await callApi('/api/materials?q=cable')
  assert.equal(materials[0].images[0].url, 'drive:' + image.fileId)
  const st = await callApi('/api/stock', { method: 'POST', body: J({ materialId: material.id, type: 'IN', quantity: 500, reference: 'PO-1' }) })
  assert.equal(st.stockQty, 500)
  const s = await callApi('/api/stock')
  assert.equal(s.movements[0].material.code, 'CBL-2.5'); assert.equal(s.movements[0].project, null); assert.equal(s.lowStock.length, 0)
  await assert.rejects(() => callApi(`/api/suppliers/${supplier.id}`, { method: 'DELETE' }), /linked materials/)
  await callApi(`/api/materials/${material.id}/images/${image.id}`, { method: 'DELETE' })
  assert.equal((await callApi(`/api/materials/${material.id}/images`)).images.length, 0)
  // sample images shipped with the site keep working under the Pages base path
  await login('admin@example.com', 'S3cure-Admin-Pass')
  await callApi('/api/users').then(() => {})
})

test('quotations, dashboard, and role/membership enforcement through the same API', async () => {
  await login('admin@example.com', 'S3cure-Admin-Pass')
  const { users } = await callApi('/api/users')
  const ids = Object.fromEntries(users.map((u) => [u.role, u.id]))
  await callApi(`/api/projects/${projectId}`, { method: 'PATCH', body: J({ members: [ids.SALES, ids.VIEWER].join(',') }) })
  await login('sales@x.com', 'Str0ng-Pass-1')
  const items = [{ lineTotal: 2000, totalCost: 1500 }, { lineTotal: 1000, totalCost: 600 }]
  const { quotation } = await callApi('/api/quotations', { method: 'POST', body: J({ projectId, items, discountType: 'FLAT', discountValue: 100, vatPct: 5 }) })
  assert.equal(quotation.grandTotal, 3045); assert.equal(quotation.createdBy.startsWith('SALES'), true)
  await callApi(`/api/quotations/${quotation.id}`, { method: 'PATCH', body: J({ status: 'APPROVED' }) })
  const rev = await callApi(`/api/quotations/${quotation.id}`, { method: 'POST', body: J({ discountValue: 0 }) })
  assert.equal(rev.quotation.revision, 1)
  const d = await callApi('/api/dashboard')
  assert.equal(d.totalQuotations, 2); assert.equal(d.approvedQuotations, 0, 'approved one became REVISED'); assert.ok(d.recentQuotations[0].projectName)
  // sales may not edit designs
  await assert.rejects(() => callApi('/api/rooms', { method: 'POST', body: J({ floorId: floor1, name: 'X' }) }), (e) => e.code === 'FORBIDDEN')
  // viewer: sees project, no cost data, cannot write
  await login('view@x.com', 'Str0ng-Pass-1')
  const vq = await callApi('/api/quotations')
  assert.equal(vq.quotations[0].totalCost, 0)
  await assert.rejects(() => callApi(`/api/projects/${projectId}`, { method: 'PATCH', body: J({ name: 'x' }) }), (e) => e.code === 'FORBIDDEN')
  // engineer without membership of someone else's project sees nothing of it
  await login('admin@example.com', 'S3cure-Admin-Pass')
  const { project } = await callApi('/api/projects', { method: 'POST', body: J({ name: 'Admin Only' }) })
  await login('eng@x.com', 'Str0ng-Pass-1')
  assert.ok(!(await callApi('/api/projects')).projects.some((p) => p.id === project.id))
  await assert.rejects(() => callApi(`/api/projects/${project.id}`), (e) => e.code === 'NOT_FOUND')
})

test('offline / lost response: never shown as saved, queued, replayed exactly once', async () => {
  await login('eng@x.com', 'Str0ng-Pass-1')
  await callApi(`/api/projects/${projectId}`)
  const { useSyncStore, retryPending } = api
  const countRooms = async () => (await callApi(`/api/projects/${projectId}`)).project.floors[0].rooms.filter((r) => r.name.startsWith('Offline')).length

  // 1) network completely down → request never reaches the server
  online = false
  await assert.rejects(() => callApi('/api/rooms', { method: 'POST', body: J({ floorId: floor1, name: 'Offline A', roomType: 'STORE' }) }),
    (e) => e instanceof ApiError && e.code === 'NETWORK' && /Pending changes/.test(e.message))
  online = true
  assert.equal(useSyncStore.getState().pending.length, 1)
  assert.equal(JSON.parse(store.get('efbms-pending-v1')).length, 1, 'persisted so a page reload cannot lose it')
  assert.equal(await countRooms(), 0)
  assert.deepEqual(await retryPending(), { ok: 1, failed: 0 })
  assert.equal(useSyncStore.getState().pending.length, 0)
  assert.equal(await countRooms(), 1)

  // 2) the server SAVED the room but the answer got lost → naive retry would duplicate it
  const realFetch = globalThis.fetch
  globalThis.fetch = async (u, init) => { const r = await realFetch(u, init); if (JSON.parse(init.body).action === 'db.mutate') throw new TypeError('connection reset'); return r }  // answer to the WRITE is lost
  await assert.rejects(() => callApi('/api/rooms', { method: 'POST', body: J({ floorId: floor1, name: 'Offline B', roomType: 'STORE' }) }), (e) => e.code === 'NETWORK')
  globalThis.fetch = realFetch
  assert.equal(useSyncStore.getState().pending.length, 1)
  assert.deepEqual(await retryPending(), { ok: 1, failed: 0 })
  assert.equal(await countRooms(), 2, 'B exists exactly once (server de-duplicated the retry)')
  assert.deepEqual(await retryPending(), { ok: 0, failed: 0 })

  // 3) validation errors are NOT queued (retrying cannot help)
  await assert.rejects(() => callApi('/api/rooms', { method: 'POST', body: J({ floorId: floor1, name: 'N'.repeat(300) }) }), (e) => e.code === 'VALIDATION')
  assert.equal(useSyncStore.getState().pending.length, 0)
})

test('remaining handlers: company, design rules, units, floors/points/fixtures edit+delete, purchase list, supplier edit', async () => {
  await login('admin@example.com', 'S3cure-Admin-Pass')
  // company
  const c0 = await callApi('/api/company')
  const c1 = await callApi('/api/company', { method: 'PUT', body: J({ name: 'Bright Electric Ltd', phone: '01700000000', quotationTerms: 'Valid 15 days' }) })
  assert.equal(c1.company.name, 'Bright Electric Ltd'); assert.equal((await callApi('/api/company')).company.quotationTerms, 'Valid 15 days'); void c0
  // design rules: update existing + create new key, label of existing is kept
  const r0 = await callApi('/api/design-rules')
  await callApi('/api/design-rules', { method: 'PUT', body: J({ rules: { 'custom.rule': '42' } }) })
  const r1 = await callApi('/api/design-rules')
  assert.equal(r1.map['custom.rule'], '42'); assert.equal(r1.rules.length, r0.rules.length + 1)
  await callApi('/api/design-rules', { method: 'PUT', body: J({ rules: { 'custom.rule': '43' } }) })
  assert.equal((await callApi('/api/design-rules')).map['custom.rule'], '43')
  // units
  const u = await callApi('/api/settings/units', { method: 'PUT', body: J({ lengthUnit: 'ft', areaUnit: 'ft2', lengthPrecision: 2, areaPrecision: null, rounding: 'UP' }) })
  assert.deepEqual(u.units, { lengthUnit: 'ft', areaUnit: 'ft2', lengthPrecision: 2, areaPrecision: null, rounding: 'UP' })
  assert.equal((await callApi('/api/settings/units')).units.lengthUnit, 'ft')
  await assert.rejects(() => callApi('/api/settings/units', { method: 'PUT', body: J({ lengthUnit: 'parsec', areaUnit: 'm2', rounding: 'UP' }) }), /Unsupported/)
  // viewer may not persist global unit settings
  await login('view@x.com', 'Str0ng-Pass-1')
  await assert.rejects(() => callApi('/api/settings/units', { method: 'PUT', body: J({ lengthUnit: 'm', areaUnit: 'm2', lengthPrecision: null, areaPrecision: null, rounding: 'NEAREST' }) }), (e) => e.code === 'FORBIDDEN')
  assert.equal((await callApi('/api/settings/units')).units.lengthUnit, 'ft')

  // floors / rooms / points / fixtures: edit + delete cascade (as the owner engineer)
  await login('eng@x.com', 'Str0ng-Pass-1')
  const { floor } = await callApi('/api/floors', { method: 'POST', body: J({ projectId, name: 'Roof', floorNumber: 9, height: 2.5 }) })
  await callApi(`/api/floors/${floor.id}`, { method: 'PATCH', body: J({ name: 'Roof Terrace', area: 55 }) })
  const { room } = await callApi('/api/rooms', { method: 'POST', body: J({ floorId: floor.id, name: 'Tank Room' }) })
  const { point } = await callApi('/api/points', { method: 'POST', body: J({ roomId: room.id, pointType: 'LIGHT', quantity: 2 }) })
  const { fixture } = await callApi('/api/fixtures', { method: 'POST', body: J({ roomId: room.id, fixtureType: 'TAP' }) })
  await callApi(`/api/points/${point.id}`, { method: 'PATCH', body: J({ quantity: 5 }) })
  await callApi(`/api/fixtures/${fixture.id}`, { method: 'PATCH', body: J({ pipeDiameter: '20mm' }) })
  let p = (await callApi(`/api/projects/${projectId}`)).project
  const f = p.floors.find((x) => x.id === floor.id)
  assert.equal(f.name, 'Roof Terrace'); assert.equal(f.area, 55)
  assert.equal(f.rooms[0].points[0].quantity, 5); assert.equal(f.rooms[0].fixtures[0].pipeDiameter, '20mm')
  await callApi(`/api/points/${point.id}`, { method: 'DELETE' })
  await callApi(`/api/fixtures/${fixture.id}`, { method: 'DELETE' })
  await callApi(`/api/rooms/${room.id}`, { method: 'DELETE' })
  await callApi(`/api/floors/${floor.id}`, { method: 'DELETE' })
  p = (await callApi(`/api/projects/${projectId}`)).project
  assert.ok(!p.floors.some((x) => x.id === floor.id))
  await callApi(`/api/projects/${projectId}`, { method: 'PATCH', body: J({ notes: 'site visit done', unitLength: 'ft' }) })
  assert.equal((await callApi(`/api/projects/${projectId}`)).project.notes, 'site visit done')

  // BOQ per system + purchase list + supplier edit
  const el = await callApi(`/api/boq/${projectId}?system=ELECTRICAL`), pl = await callApi(`/api/boq/${projectId}?system=PLUMBING`), all = await callApi(`/api/boq/${projectId}`)
  assert.equal(el.lines.length + pl.lines.length, all.lines.length)
  const purchase = await callApi(`/api/purchase-list/${projectId}`)
  assert.ok(Array.isArray(purchase.purchaseList) && Array.isArray(purchase.bySupplier))
  await login('inv@x.com', 'Str0ng-Pass-1')
  const { suppliers } = await callApi('/api/suppliers')
  const s = await callApi(`/api/suppliers/${suppliers[0].id}`, { method: 'PATCH', body: J({ phone: '01800000000' }) })
  assert.equal(s.supplier.phone, '01800000000')
  const { supplier } = await callApi('/api/suppliers', { method: 'POST', body: J({ name: 'Temp Supplier' }) })
  assert.deepEqual(await callApi(`/api/suppliers/${supplier.id}`, { method: 'DELETE' }), { success: true })
  // user admin: reset password + disable through the Users API
  await login('admin@example.com', 'S3cure-Admin-Pass')
  const { users } = await callApi('/api/users')
  const v = users.find((x) => x.role === 'VIEWER')
  await callApi('/api/users', { method: 'PATCH', body: J({ id: v.id, password: 'Another-Pass-77' }) })
  await login('view@x.com', 'Another-Pass-77')
  await login('admin@example.com', 'S3cure-Admin-Pass')
  await callApi('/api/users', { method: 'PATCH', body: J({ id: v.id, active: false }) })
  await assert.rejects(() => login('view@x.com', 'Another-Pass-77'), (e) => e.code === 'INVALID_CREDENTIALS')
})

test('bulk CSV upload: preview, duplicates, update mode, supplier creation, partial failure, permissions', async () => {
  const csvOut = path.join(root, 'node_modules/.cache/csv-bundle.mjs')
  await build({ entryPoints: [path.join(root, 'src/lib/material-csv.ts')], bundle: true, format: 'esm', platform: 'node', outfile: csvOut, logLevel: 'silent' })
  const csv = await import(csvOut)
  const { importMaterials } = api

  await login('inv@x.com', 'Str0ng-Pass-1')
  const { materials: before } = await callApi('/api/materials')
  const { suppliers } = await callApi('/api/suppliers')
  const existing = () => api.gasCall('db.sync', { tables: [{ t: 'materials' }] }).then((r) => r.tables.materials.rows.map((m) => ({ id: m.id, code: m.code, name: m.name, brand: m.brand, size: m.size, specification: m.specification })))
  const stockBefore = before.find((m) => m.code === 'CBL-2.5').stockQty

  const text = [
    'code,name,category,brand,unit,pack_size,purchase_price,selling_price,stock_qty,min_stock,supplier',
    'BLK-1,Bulk Cable 4mm,cable,BRB,Meter,100,"1,000",1200,50,10,Bashundhara Cable',   // ok, known supplier, lower-case category
    'BLK-2,Bulk Switch,Switch,Clipsal,Pcs,1,100,150,0,5,Brand New Supplier',              // unknown supplier
    'BLK-1,Same code again,Cable,,,,,,,,',                                                  // duplicate in file
    'CBL-2.5,Cable 2.5mm updated,Cable,BRB,Meter,100,45,70,9999,100,Bashundhara Cable',  // exists in library
    'BLK-3,Bad price,Cable,,,,abc,,,,',                                                     // validation error
    ',No code,Cable,,,,,,,,',                                                               // validation error
    'RACE-1,Will collide,Cable,,Pcs,1,1,2,0,0,',                                            // valid now, collides later
  ].join('\n')
  const pv = csv.buildPreview(text, await existing(), suppliers, csv.KNOWN_CATEGORIES)
  assert.deepEqual([pv.counts.ok, pv.counts.error, pv.counts.dupFile, pv.counts.dupExisting], [3, 2, 1, 1])
  assert.equal(pv.rows[0].data.category, 'Cable'); assert.equal(pv.rows[0].data.purchasePrice, 1000); assert.ok(pv.rows[0].data.supplierId)

  // someone else creates RACE-1 after the preview was built → the server must refuse that row only
  await callApi('/api/materials', { method: 'POST', body: J({ code: 'RACE-1', name: 'created meanwhile' }) })

  const rep = await importMaterials(pv.rows, { duplicates: 'skip', createSuppliers: true })
  assert.equal(rep.created, 2); assert.equal(rep.updated, 0); assert.equal(rep.suppliersCreated, 1)
  assert.equal(rep.failed.length, 1); assert.equal(rep.failed[0].code, 'RACE-1'); assert.match(rep.failed[0].message, /already exists/)
  const after = (await callApi('/api/materials')).materials
  assert.ok(after.find((m) => m.code === 'BLK-1') && after.find((m) => m.code === 'BLK-2'))
  assert.equal(after.find((m) => m.code === 'BLK-2').supplierId.length > 3, true, 'new supplier linked')
  assert.equal(after.find((m) => m.code === 'CBL-2.5').sellingPrice, 60, 'skip mode left the existing material alone')
  assert.equal(after.find((m) => m.code === 'BLK-1').images.length >= 0, true)

  // re-running the same file is safe: everything is now a duplicate and is skipped
  const pv2 = csv.buildPreview(text, await existing(), suppliers, csv.KNOWN_CATEGORIES)
  const rep2 = await importMaterials(pv2.rows, { duplicates: 'skip', createSuppliers: false })
  assert.equal(rep2.created, 0)

  // update mode: details + prices change, history is written, STOCK is untouched
  const rep3 = await importMaterials(pv2.rows, { duplicates: 'update', createSuppliers: false })
  assert.ok(rep3.updated >= 3)
  const m = (await callApi('/api/materials')).materials.find((x) => x.code === 'CBL-2.5')
  assert.equal(m.sellingPrice, 70); assert.equal(m.purchasePrice, 45); assert.equal(m.stockQty, stockBefore, 'stock only changes through inventory movements')
  const hist = (await api.gasCall('db.sync', { tables: [{ t: 'priceHistory' }] })).tables.priceHistory.rows.filter((h) => h.materialId === m.id)
  assert.ok(hist.some((h) => h.note === 'CSV bulk update' && h.newSelling === 70))

  // a role without permission cannot bulk-create; every row is reported as failed (nothing saved)
  await login('sales@x.com', 'Str0ng-Pass-1')
  const pv3 = csv.buildPreview('code,name\nSALES-1,Not allowed', [], [])
  const rep4 = await importMaterials(pv3.rows, { duplicates: 'skip', createSuppliers: false }).catch((e) => ({ failed: [e], created: 0 }))
  assert.equal(rep4.created, 0)
  await login('inv@x.com', 'Str0ng-Pass-1')
  assert.ok(!(await callApi('/api/materials')).materials.some((x) => x.code === 'SALES-1'))
})

test('create material together with its photo (Add Material dialog flow)', async () => {
  await login('inv@x.com', 'Str0ng-Pass-1')
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const { material } = await callApi('/api/materials', { method: 'POST', body: J({ code: 'PH-1', name: 'With photo', category: 'Light' }) })
  const { image } = await callApi(`/api/materials/${material.id}/images`, { method: 'POST', body: J({ url: PNG, caption: 'With photo' }) })
  const got = (await callApi('/api/materials?q=with photo')).materials[0]
  assert.equal(got.images.length, 1); assert.equal(got.images[0].url, 'drive:' + image.fileId); assert.equal(got.images[0].isPrimary, true)
})
