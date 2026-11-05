import test from 'node:test'
import assert from 'node:assert/strict'
import { createEnv } from './gas-mock.mjs'

const PW = 'Str0ng-Test-Pass'
function boot() {
  const env = createEnv()
  env.setup({ email: 'admin@example.com', password: 'S3cure-Admin-Pass' })
  const admin = env.token('admin@example.com', 'S3cure-Admin-Pass')
  const mk = (email, role) => { env.ok('users.create', { email, name: role + ' ' + email, role, password: PW }, admin); return env.token(email, PW) }
  const t = { admin, eng: mk('eng@x.com', 'ENGINEER'), eng2: mk('eng2@x.com', 'ENGINEER'), sales: mk('sales@x.com', 'SALES'), inv: mk('inv@x.com', 'INVENTORY'), view: mk('view@x.com', 'VIEWER') }
  return { env, t }
}
const mutate = (env, token, ops, reqId) => env.call('db.mutate', { ops }, token, reqId)
const create = (t, data, id) => ({ op: 'create', t, data, ...(id ? { id } : {}) })
const sync = (env, token, tables) => env.ok('db.sync', { tables }, token).tables
const code = (r) => (r.ok ? 'OK' : r.error.code)
// 1x1 PNG
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

test('setup creates sheets, folders and admin; password removed from properties', () => {
  const env = createEnv(); env.setup()
  const ss = [...env.spreadsheets.values()][0]
  for (const name of ['Users', 'Projects', 'Floors', 'Rooms', 'ElectricalPoints', 'PlumbingFixtures', 'EstimateItems', 'Drawings', 'Materials', 'MaterialImages', 'Quotations', 'Files', 'Backups', 'AuditLog'])
    assert.ok(ss.getSheetByName(name), name)
  assert.equal(env.props.getProperty('INITIAL_ADMIN_PASSWORD'), null)
  assert.ok(env.props.getProperty('TOKEN_SECRET').length >= 64)
  const names = [...env.folders.values()].map((f) => f.name)
  for (const n of ['Website_Data', 'Projects', 'Material_Images', 'Database_Backups', 'System_Backups', 'System_Data']) assert.ok(names.includes(n), n)
  env.run('Store.reset()'); env.setup() // idempotent
  assert.equal(env.run("Store.count('users')"), 1)
})

test('authentication: bad creds, throttling, token tampering, disabled user, password policy', () => {
  const { env, t } = boot()
  assert.equal(code(env.login('admin@example.com', 'wrong')), 'INVALID_CREDENTIALS')
  assert.equal(code(env.login('nobody@x.com', 'wrong')), 'INVALID_CREDENTIALS')
  for (let i = 0; i < 6; i++) env.login('view@x.com', 'bad-password')
  assert.equal(code(env.login('view@x.com', PW)), 'RATE_LIMITED', 'locked after repeated failures')
  assert.equal(code(env.call('db.sync', { tables: [{ t: 'projects' }] })), 'UNAUTHENTICATED')
  const bad = t.admin.slice(0, -3) + 'abc'
  assert.equal(code(env.call('db.sync', { tables: [{ t: 'projects' }] }, bad)), 'UNAUTHENTICATED')
  assert.equal(code(env.call('users.create', { email: 'a@b.co', name: 'x', role: 'VIEWER', password: 'demo123' }, t.admin)), 'VALIDATION')
  const users = env.ok('users.list', {}, t.admin).users
  assert.ok(users.every((u) => !('passwordHash' in u)), 'hash never leaves the server')
  const eng = users.find((u) => u.email === 'eng2@x.com')
  env.ok('users.update', { id: eng.id, active: false }, t.admin)
  assert.equal(code(env.call('auth.me', {}, t.eng2)), 'UNAUTHENTICATED', 'disabled user session dies immediately')
  assert.equal(code(env.call('users.list', {}, t.eng)), 'FORBIDDEN')
  const admin = users.find((u) => u.role === 'SUPER_ADMIN')
  assert.equal(code(env.call('users.update', { id: admin.id, role: 'VIEWER' }, t.admin)), 'CONFLICT', 'last admin protected')
})

test('RBAC + project membership: server enforces, not the UI', () => {
  const { env, t } = boot()
  const r = mutate(env, t.eng, [create('projects', { code: 'P-1', name: 'Tower A' }, 'prj_1_aaaaaaa')])
  assert.equal(r.ok, true)
  assert.equal(r.data.results[0].row.ownerId.length > 5, true)
  // other engineer cannot see or touch it
  assert.equal(sync(env, t.eng2, [{ t: 'projects' }]).projects.rows.length, 0)
  assert.equal(code(mutate(env, t.eng2, [create('floors', { projectId: 'prj_1_aaaaaaa', name: 'F1', floorNumber: 1 })])), 'FORBIDDEN')
  assert.equal(code(mutate(env, t.eng2, [{ op: 'update', t: 'projects', id: 'prj_1_aaaaaaa', data: { name: 'hacked' } }])), 'FORBIDDEN')
  assert.equal(code(mutate(env, t.eng2, [{ op: 'delete', t: 'projects', id: 'prj_1_aaaaaaa' }])), 'FORBIDDEN')
  // viewer can never write; sales cannot write floors
  assert.equal(code(mutate(env, t.view, [create('projects', { code: 'P-9', name: 'x' })])), 'FORBIDDEN')
  assert.equal(code(mutate(env, t.sales, [create('floors', { projectId: 'prj_1_aaaaaaa', name: 'F', floorNumber: 1 })])), 'FORBIDDEN')
  // admin sees all; owner adds members → eng2 + viewer gain read access
  const dir = env.ok('directory', {}, t.admin).users
  const id = (e) => dir.find((u) => u.name.includes(e)).id
  assert.equal(code(mutate(env, t.eng, [{ op: 'update', t: 'projects', id: 'prj_1_aaaaaaa', data: { members: [id('eng2@'), id('view@')].join(',') } }])), 'OK')
  assert.equal(sync(env, t.eng2, [{ t: 'projects' }]).projects.rows.length, 1)
  assert.equal(sync(env, t.view, [{ t: 'projects' }]).projects.rows.length, 1)
  assert.equal(code(mutate(env, t.view, [create('floors', { projectId: 'prj_1_aaaaaaa', name: 'F', floorNumber: 1 })])), 'FORBIDDEN')
  assert.equal(code(mutate(env, t.eng2, [create('floors', { projectId: 'prj_1_aaaaaaa', name: 'F2', floorNumber: 2 })])), 'OK')
  // a member cannot change membership or owner
  assert.equal(code(mutate(env, t.eng2, [{ op: 'update', t: 'projects', id: 'prj_1_aaaaaaa', data: { members: '' } }])), 'FORBIDDEN')
  // settings: engineer may change units but not other keys
  assert.equal(code(mutate(env, t.eng, [{ op: 'upsert', t: 'settings', id: 'units.length', data: { value: 'ft' } }])), 'OK')
  assert.equal(code(mutate(env, t.eng, [{ op: 'upsert', t: 'settings', id: 'backup.copyFiles', data: { value: 'false' } }])), 'FORBIDDEN')
  assert.equal(code(env.call('backup.run', {}, t.eng)), 'FORBIDDEN')
  assert.equal(code(env.call('db.sync', { tables: [{ t: 'auditLog' }] }, t.eng)), 'FORBIDDEN')
  assert.equal(code(env.call('db.sync', { tables: [{ t: 'users' }] }, t.eng)), 'FORBIDDEN')
})

test('hierarchy, derived projectId, validation, uniqueness, cascade delete', () => {
  const { env, t } = boot()
  const ok = (ops) => { const r = mutate(env, t.eng, ops); assert.equal(r.ok, true, JSON.stringify(r.error)); return r.data }
  ok([create('projects', { code: 'P-2', name: 'Villa' }, 'prj2aaaaaa')])
  // parent+children in a single atomic batch using client ids
  ok([create('floors', { projectId: 'prj2aaaaaa', name: '1st', floorNumber: 1 }, 'fl1aaaaaaa'),
      create('rooms', { floorId: 'fl1aaaaaaa', name: 'Bed', roomType: 'Bedroom', length: 4, width: 3 }, 'rm1aaaaaaa'),
      create('points', { roomId: 'rm1aaaaaaa', pointType: 'LIGHT', quantity: 3, projectId: 'EVIL' }, 'pt1aaaaaaa'),
      create('fixtures', { roomId: 'rm1aaaaaaa', fixtureType: 'WC' }, 'fx1aaaaaaa')])
  const rows = sync(env, t.eng, [{ t: 'rooms' }, { t: 'points' }, { t: 'fixtures' }])
  assert.equal(rows.points.rows[0].projectId, 'prj2aaaaaa', 'projectId derived server-side, client value ignored')
  assert.equal(rows.rooms.rows[0].projectId, 'prj2aaaaaa')
  // validation
  assert.equal(code(mutate(env, t.eng, [create('projects', { code: 'P-3' })])), 'VALIDATION')
  assert.equal(code(mutate(env, t.eng, [create('projects', { code: 'P-3', name: 'x', status: 'BOGUS' })])), 'VALIDATION')
  assert.equal(code(mutate(env, t.eng, [create('rooms', { floorId: 'fl1aaaaaaa', name: 'R', length: 'abc' })])), 'VALIDATION')
  assert.equal(code(mutate(env, t.eng, [create('rooms', { floorId: 'nope', name: 'R' })])), 'VALIDATION')
  assert.equal(code(mutate(env, t.eng, [create('points', { roomId: 'rm1aaaaaaa', pointType: 'LIGHT', quantity: -1 })])), 'VALIDATION')
  assert.equal(code(mutate(env, t.eng, [create('projects', { code: 'p-2', name: 'dup' })])), 'CONFLICT', 'unique is case-insensitive')
  // atomic: a bad op in the batch leaves nothing behind
  const before = sync(env, t.eng, [{ t: 'floors' }]).floors.rows.length
  assert.equal(code(mutate(env, t.eng, [create('floors', { projectId: 'prj2aaaaaa', name: 'ok', floorNumber: 2 }), create('floors', { projectId: 'prj2aaaaaa', floorNumber: 3 })])), 'VALIDATION')
  assert.equal(sync(env, t.eng, [{ t: 'floors' }]).floors.rows.length, before)
  // formula-like text stays text
  ok([create('suppliers', { name: '=HYPERLINK("http://evil")' })].map((o) => ({ ...o })).slice(0, 0).concat([{ op: 'create', t: 'projects', data: { code: 'P-F', name: '=1+1' } }]))
  assert.equal(sync(env, t.eng, [{ t: 'projects' }]).projects.rows.find((p) => p.code === 'P-F').name, '=1+1')
  // cascade
  const d = ok([{ op: 'delete', t: 'projects', id: 'prj2aaaaaa' }])
  assert.deepEqual(Object.keys(d.deleted).sort(), ['fixtures', 'floors', 'points', 'projects', 'rooms'])
  const after = sync(env, t.eng, [{ t: 'floors' }, { t: 'rooms' }, { t: 'points' }, { t: 'fixtures' }])
  assert.ok(Object.values(after).every((x) => x.rows.length === 0))
})

test('optimistic concurrency, idempotent retries, versions, bulk replace', () => {
  const { env, t } = boot()
  const r1 = mutate(env, t.eng, [create('projects', { code: 'P-C', name: 'C' }, 'prjCaaaaaa')]).data
  const rev = r1.results[0].row.rev
  assert.equal(code(mutate(env, t.eng, [{ op: 'update', t: 'projects', id: 'prjCaaaaaa', rev, data: { name: 'C2' } }])), 'OK')
  assert.equal(code(mutate(env, t.eng, [{ op: 'update', t: 'projects', id: 'prjCaaaaaa', rev, data: { name: 'C3' } }])), 'CONFLICT')
  // duplicate submission with the same reqId is replayed, not executed twice
  const a = mutate(env, t.eng, [create('projects', { code: 'P-D', name: 'D' })], 'req-123'), b = mutate(env, t.eng, [create('projects', { code: 'P-D', name: 'D' })], 'req-123')
  assert.equal(a.ok && b.ok, true); assert.equal(b.duplicate, true)
  assert.equal(sync(env, t.eng, [{ t: 'projects' }]).projects.rows.filter((p) => p.code === 'P-D').length, 1)
  // version based cache validation
  const s1 = sync(env, t.eng, [{ t: 'projects' }]).projects
  assert.equal(sync(env, t.eng, [{ t: 'projects', v: s1.version }]).projects.unchanged, true)
  mutate(env, t.eng, [{ op: 'update', t: 'projects', id: 'prjCaaaaaa', data: { notes: 'n' } }])
  assert.equal(!!sync(env, t.eng, [{ t: 'projects', v: s1.version }]).projects.rows, true)
  // estimation replace: deleteWhere + 150 creates in one request
  const items = Array.from({ length: 150 }, (_, i) => create('estimateItems', { projectId: 'prjCaaaaaa', system: 'ELECTRICAL', category: 'Cable', name: 'Wire ' + i, qty: i }))
  assert.equal(code(mutate(env, t.eng, [{ op: 'deleteWhere', t: 'estimateItems', where: { projectId: 'prjCaaaaaa' } }, ...items])), 'OK')
  assert.equal(code(mutate(env, t.eng, [{ op: 'deleteWhere', t: 'estimateItems', where: { projectId: 'prjCaaaaaa' } }, ...items.slice(0, 10)])), 'OK')
  assert.equal(sync(env, t.eng, [{ t: 'estimateItems' }]).estimateItems.rows.length, 10)
  assert.equal(code(mutate(env, t.eng2, [{ op: 'deleteWhere', t: 'estimateItems', where: { projectId: 'prjCaaaaaa' } }])), 'FORBIDDEN', 'bulk delete is access-checked too')
  assert.equal(sync(env, t.eng, [{ t: 'estimateItems' }]).estimateItems.rows.length, 10)
})

test('stock movement, material images (Drive), quotations and viewer redaction', () => {
  const { env, t } = boot()
  mutate(env, t.inv, [create('materials', { code: 'M-1', name: 'Cable 2.5', purchasePrice: 10, sellingPrice: 15, stockQty: 5 }, 'mat1aaaaaa')])
  assert.equal(code(env.call('stock.move', { materialId: 'mat1aaaaaa', type: 'IN', quantity: 10 }, t.sales)), 'FORBIDDEN')
  assert.equal(env.ok('stock.move', { materialId: 'mat1aaaaaa', type: 'IN', quantity: 10, userName: 'spoof' }, t.inv).stockQty, 15)
  const out = env.ok('stock.move', { materialId: 'mat1aaaaaa', type: 'OUT', quantity: 100 }, t.inv)
  assert.equal(out.stockQty, 0); assert.equal(out.clamped, true)
  assert.equal(code(env.call('stock.move', { materialId: 'mat1aaaaaa', type: 'IN', quantity: 0 }, t.inv)), 'VALIDATION')
  const mv = sync(env, t.inv, [{ t: 'stockMovements' }]).stockMovements.rows
  assert.ok(mv.every((m) => m.userName !== 'spoof'), 'user name comes from the session')
  // material image: bad bytes rejected, good png stored privately in Drive
  assert.equal(code(env.call('file.upload', { category: 'Material_Images', name: 'x.png', data: Buffer.from('not a png').toString('base64'), attach: { materialId: 'mat1aaaaaa' } }, t.inv)), 'VALIDATION')
  assert.equal(code(env.call('file.upload', { category: 'Material_Images', name: 'x.exe', data: PNG }, t.inv)), 'VALIDATION')
  assert.equal(code(env.call('file.upload', { category: 'Material_Images', name: 'x.png', data: PNG }, t.view)), 'FORBIDDEN')
  const up = env.ok('file.upload', { category: 'Material_Images', name: 'cable.png', data: PNG, attach: { materialId: 'mat1aaaaaa', caption: 'real' } }, t.inv)
  assert.equal(up.image.isPrimary, true); assert.equal(up.file.mime, 'image/png'); assert.equal(up.file.status, 'ACTIVE')
  const drv = env.files.get(up.file.driveFileId); assert.equal(drv.sharedCalls, 1)
  const got = env.ok('file.get', { id: up.file.id }, t.view)
  assert.equal(got.data, PNG)
  // quotations: server numbers + totals, viewer cannot see cost
  mutate(env, t.eng, [create('projects', { code: 'P-Q', name: 'Q' }, 'prjQaaaaaa')])
  const dir = env.ok('directory', {}, t.admin).users
  mutate(env, t.eng, [{ op: 'update', t: 'projects', id: 'prjQaaaaaa', data: { members: dir.filter((u) => /SALES|VIEWER/.test(u.role)).map((u) => u.id).join(',') } }])
  const items = [{ lineTotal: 1000, totalCost: 700, unitPurchasePrice: 7 }, { lineTotal: 500, totalCost: 300, unitPurchasePrice: 3 }]
  const q = env.ok('quotation.create', { projectId: 'prjQaaaaaa', items, discountType: 'PERCENT', discountValue: 10, vatPct: 5, otherCharges: 100, grandTotal: 1 }, t.sales).quotation
  assert.equal(q.subtotal, 1500); assert.equal(q.grandTotal, round2((1500 * 0.9) * 1.05 + 100)); assert.equal(q.totalCost, 1000)
  assert.match(q.quotationNo, /^QT-P-Q-\d{4}-001$/); assert.equal(q.createdBy.startsWith('SALES'), true)
  assert.equal(sync(env, t.eng, [{ t: 'projects' }]).projects.rows.find((p) => p.id === 'prjQaaaaaa').status, 'QUOTATION')
  const vq = sync(env, t.view, [{ t: 'quotations' }]).quotations.rows[0]
  assert.equal(vq.totalCost, 0); assert.ok(!vq.items.includes('unitPurchasePrice'))
  assert.equal(JSON.parse(sync(env, t.sales, [{ t: 'quotations' }]).quotations.rows[0].items)[0].totalCost, 700)
  const rev = env.ok('quotation.revise', { id: q.id, discountValue: 0 }, t.sales).quotation
  assert.equal(rev.parentId, q.id); assert.equal(rev.quotationNo, q.quotationNo + '-R1'); assert.equal(rev.grandTotal, round2(1500 * 1.05 + 100))
  assert.equal(sync(env, t.sales, [{ t: 'quotations' }]).quotations.rows.find((x) => x.id === q.id).status, 'REVISED')
  assert.equal(code(mutate(env, t.sales, [{ op: 'update', t: 'quotations', id: rev.id, data: { grandTotal: 1, status: 'SENT' } }])), 'OK')
  assert.equal(sync(env, t.sales, [{ t: 'quotations' }]).quotations.rows.find((x) => x.id === rev.id).grandTotal, rev.grandTotal, 'snapshot totals immutable')
  // big quotation overflows the 50k cell limit into a Drive blob and round-trips
  const big = Array.from({ length: 800 }, (_, i) => ({ lineTotal: 1, totalCost: 1, name: 'Item '.repeat(10) + i, note: 'x'.repeat(40) }))
  const bq = env.ok('quotation.create', { projectId: 'prjQaaaaaa', items: big }, t.sales).quotation
  assert.equal(JSON.parse(bq.items).length, 800)
  assert.equal(JSON.parse(sync(env, t.sales, [{ t: 'quotations' }]).quotations.rows.find((x) => x.id === bq.id).items).length, 800)
})
const round2 = (n) => Math.round(n * 100) / 100

test('drawings: editable JSON kept in Drive, background extracted, conflicts detected', () => {
  const { env, t } = boot()
  mutate(env, t.eng, [create('projects', { code: 'P-DW', name: 'DW' }, 'prjDWaaaaa')])
  const doc = { version: 1, pxPerMeter: 40, calibrated: true, rooms: [{ id: 'r1', points: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }] }], symbols: [{ id: 's1', type: 'LIGHT', x: 10.5, y: 20.25, layer: 'electrical' }], routes: [{ id: 'rt1', pts: [[0, 0], [100, 100]], kind: 'cable' }], layers: { bg: true }, backgroundImage: 'data:image/png;base64,' + PNG }
  const saved = env.ok('drawing.save', { projectId: 'prjDWaaaaa', floorNumber: 2, data: JSON.stringify(doc), scalePxPerMeter: 42.5, calibrated: true }, t.eng).drawing
  assert.equal(saved.scalePxPerMeter, 42.5); assert.ok(saved.bgFileId && saved.fileId)
  const list = env.ok('drawing.list', { projectId: 'prjDWaaaaa' }, t.eng).drawings
  const back = JSON.parse(list[0].data)
  assert.equal(back.backgroundImage, 'drive:' + saved.bgFileId, 'big image is a Drive file, not embedded')
  assert.deepEqual({ ...back, backgroundImage: null }, { ...doc, backgroundImage: null }, 'geometry / symbols / routes / layers identical after reload')
  assert.equal(env.ok('file.get', { id: saved.bgFileId }, t.eng).data, PNG)
  // second save re-uses the same Drive file (in place) and only bumps rev
  const again = env.ok('drawing.save', { projectId: 'prjDWaaaaa', floorNumber: 2, data: JSON.stringify({ ...back, symbols: [] }), calibrated: true, expectedRev: saved.rev }, t.eng).drawing
  assert.equal(again.fileId, saved.fileId); assert.equal(again.rev, saved.rev + 1)
  assert.equal(code(env.call('drawing.save', { projectId: 'prjDWaaaaa', floorNumber: 2, data: '{}', expectedRev: saved.rev }, t.eng)), 'CONFLICT')
  assert.equal(code(env.call('drawing.save', { projectId: 'prjDWaaaaa', floorNumber: 2, data: '{bad' }, t.eng)), 'VALIDATION')
  assert.equal(code(env.call('drawing.save', { projectId: 'prjDWaaaaa', floorNumber: 2, data: '{}' }, t.view)), 'FORBIDDEN')
  assert.equal(code(env.call('drawing.list', { projectId: 'prjDWaaaaa' }, t.eng2)), 'FORBIDDEN')
  assert.equal(code(env.call('drawing.save', { projectId: 'prjDWaaaaa', floorNumber: 2, data: JSON.stringify({ backgroundImage: 'http://evil/x.png' }) }, t.eng)), 'VALIDATION')
  // project file upload goes to the right Drive folder structure
  const f = env.ok('file.upload', { category: 'Documents', projectId: 'prjDWaaaaa', name: 'plan.pdf', data: Buffer.from('%PDF-1.4 test').toString('base64') }, t.eng).file
  assert.equal(code(env.call('file.get', { id: f.id }, t.eng2)), 'FORBIDDEN')
  const folder = [...env.folders.values()].find((x) => x.files.has(f.driveFileId))
  assert.equal(folder.name, 'Documents')
  const parent = [...env.folders.values()].find((x) => x.children.has([...env.folders.entries()].find(([, v]) => v === folder)[0]))
  assert.match(parent.name, /^P-DW_prjDWaaaaa$/)
})

test('backup → disaster → restore keeps relationships, drawings and files', () => {
  const { env, t } = boot()
  mutate(env, t.eng, [create('projects', { code: 'P-B', name: 'Backup me' }, 'prjBaaaaaa'), create('floors', { projectId: 'prjBaaaaaa', name: '1', floorNumber: 1 }, 'flBaaaaaaa'),
    create('rooms', { floorId: 'flBaaaaaaa', name: 'R' }, 'rmBaaaaaaa'), create('points', { roomId: 'rmBaaaaaaa', pointType: 'SOCKET', quantity: 4 }, 'ptBaaaaaaa')])
  const doc = { rooms: [{ id: 'r1' }], symbols: [{ id: 's1', x: 1, y: 2 }], routes: [], backgroundImage: 'data:image/png;base64,' + PNG }
  const dr = env.ok('drawing.save', { projectId: 'prjBaaaaaa', floorNumber: 1, data: JSON.stringify(doc), calibrated: true }, t.eng).drawing
  const pdf = env.ok('file.upload', { category: 'Documents', projectId: 'prjBaaaaaa', name: 'spec.pdf', data: Buffer.from('%PDF-1.4 original').toString('base64') }, t.eng).file
  assert.equal(env.ok('backup.status', {}, t.admin).alert, 'NEVER')
  const run = env.ok('backup.run', {}, t.admin)
  assert.equal(run.backup.status, 'SUCCESS'); assert.equal(run.files.copied >= 3, true)
  assert.equal(env.ok('backup.status', {}, t.admin).alert, 'NONE')
  const v = env.ok('backup.verify', { id: run.backup.id }, t.admin); assert.equal(v.ok, true)
  // disaster: rows deleted, a Drive file deleted for good, drawing JSON corrupted
  mutate(env, t.admin, [{ op: 'delete', t: 'projects', id: 'prjBaaaaaa' }])
  const frow = env.run("Store.reset(), Store.get('files'," + JSON.stringify(pdf.id) + ")")
  env.files.get(pdf.driveFileId).trashed = true; env.files.get(pdf.driveFileId).bytes = Buffer.from('')
  env.files.delete(pdf.driveFileId)
  assert.equal(env.ok('db.sync', { tables: [{ t: 'points' }] }, t.admin).tables.points.rows.length, 0)
  // restore requires the confirmation dance
  assert.equal(code(env.call('backup.restore', { id: run.backup.id, typed: 'RESTORE', confirmCode: 'NOPE' }, t.admin)), 'VALIDATION')
  const prep = env.ok('backup.restorePrepare', { id: run.backup.id }, t.admin)
  assert.equal(code(env.call('backup.restore', { id: run.backup.id, confirmCode: prep.confirmCode }, t.admin)), 'VALIDATION', 'must type RESTORE')
  const rep = env.ok('backup.restore', { id: run.backup.id, confirmCode: prep.confirmCode, typed: 'RESTORE' }, t.admin)
  assert.ok(rep.safetyBackupId.startsWith('BK-')); assert.equal(rep.integrity.ok, true, JSON.stringify(rep.integrity)); assert.equal(rep.filesMissing.length, 0)
  const back = env.ok('db.sync', { tables: [{ t: 'projects' }, { t: 'floors' }, { t: 'rooms' }, { t: 'points' }, { t: 'files' }, { t: 'drawings' }] }, t.admin).tables
  assert.equal(back.points.rows[0].quantity, 4); assert.equal(back.rooms.rows[0].projectId, 'prjBaaaaaa'); assert.equal(back.projects.rows[0].id, 'prjBaaaaaa')
  const pdfRow = back.files.rows.find((f) => f.id === pdf.id)
  assert.equal(pdfRow.status, 'ACTIVE'); assert.notEqual(pdfRow.driveFileId, pdf.driveFileId, 'file re-created from the mirror copy')
  assert.equal(Buffer.from(env.ok('file.get', { id: pdf.id }, t.admin).data, 'base64').toString(), '%PDF-1.4 original')
  const d2 = env.ok('drawing.list', { projectId: 'prjBaaaaaa' }, t.admin).drawings[0]
  assert.equal(JSON.parse(d2.data).symbols[0].x, 1); assert.equal(d2.id, dr.id)
  // history & audit retained
  const hist = env.ok('db.sync', { tables: [{ t: 'backups' }, { t: 'auditLog', limit: 50 }] }, t.admin).tables
  assert.equal(hist.backups.rows.filter((b) => b.kind === 'PRE_RESTORE').length, 1)
  assert.ok(hist.auditLog.rows.some((r) => r.action === 'RESTORE'))
  // tampered backup is refused
  env.files.get(run.backup.driveFileId).bytes = Buffer.from('garbage')
  assert.equal(code(env.call('backup.verify', { id: run.backup.id }, t.admin)), 'BACKUP_CORRUPT')
})

test('backup failure is logged, flagged on the dashboard and e-mailed', () => {
  const { env, t } = boot()
  env.props.setProperty('ADMIN_ALERT_EMAIL', 'owner@example.com')
  env.run("var _top = Folders.top; Folders.top = function (n) { if (n === 'Database_Backups') return { createFile: function () { throw new Error('Drive quota exceeded'); } }; return _top(n); }")
  const r = env.call('backup.run', {}, t.admin)
  assert.equal(r.ok, false); assert.equal(r.error.code, 'BACKUP_FAILED')
  const st = env.ok('backup.status', {}, t.admin)
  assert.equal(st.alert, 'FAILED'); assert.match(st.lastError.message, /quota/)
  assert.equal(env.stats.mails.length, 1)
  const rows = env.ok('db.sync', { tables: [{ t: 'backups' }, { t: 'auditLog', limit: 20 }] }, t.admin).tables
  assert.equal(rows.backups.rows[0].status, 'FAILED'); assert.ok(rows.auditLog.rows.some((x) => x.action === 'BACKUP_FAILED'))
})

test('scheduled backup trigger installs once and runs', () => {
  const { env } = boot()
  env.fn('installTriggers')(); env.fn('installTriggers')()
  assert.equal(env.triggers.length, 1)
  env.fn('scheduledBackup')()
  assert.equal(env.run("Store.reset(), Store.all('backups')[0].kind"), 'SCHEDULED')
})

test('migration import is idempotent, keeps ids and reports errors; integrity check', () => {
  const { env, t } = boot()
  const sup = [{ id: 'sup1aaaaaa', name: 'Supplier 1' }, { id: 'sup2aaaaaa', name: 'Supplier 2' }]
  const mats = [{ id: 'm1aaaaaaaa', code: 'A', name: 'A', supplierId: 'sup1aaaaaa' }, { id: 'm2aaaaaaaa', code: 'A', name: 'dup code' }, { id: 'm3aaaaaaaa', code: 'C', name: 'C' }]
  assert.equal(code(env.call('migration.import', { table: 'suppliers', rows: sup }, t.eng)), 'FORBIDDEN')
  assert.equal(env.ok('migration.import', { table: 'suppliers', rows: sup }, t.admin).created, 2)
  const r = env.ok('migration.import', { table: 'materials', rows: mats }, t.admin)
  assert.equal(r.created, 2); assert.equal(r.errors.length, 1)
  assert.equal(env.ok('migration.import', { table: 'materials', rows: mats }, t.admin).skipped, 2, 're-run does not duplicate')
  env.ok('migration.import', { table: 'materialImages', rows: [{ id: 'i1aaaaaaaa', materialId: 'm1aaaaaaaa', url: '/images/materials/cable.jpg', isSample: true, isPrimary: true }, { id: 'i2aaaaaaaa', materialId: 'm1aaaaaaaa', url: 'data:image/png;base64,' + PNG }], }, t.admin)
  const imgs = env.ok('db.sync', { tables: [{ t: 'materialImages' }] }, t.admin).tables.materialImages.rows
  assert.equal(imgs.find((i) => i.id === 'i2aaaaaaaa').fileId.length > 3, true); assert.equal(imgs.find((i) => i.id === 'i1aaaaaaaa').url, '/images/materials/cable.jpg')
  assert.equal(code(mutate(env, t.inv, [create('materialImages', { materialId: 'm1aaaaaaaa', url: 'https://evil.example/x.png' })])), 'VALIDATION')
  const chk = env.ok('integrity.check', { deep: true }, t.admin)
  assert.equal(chk.ok, true); assert.equal(chk.counts.materials, 2)
})

test('rate limiting and malformed requests', () => {
  const { env, t } = boot()
  assert.equal(code(env.call('nope', {}, t.admin)), 'BAD_REQUEST')
  const out = env.fn('doPost')({ postData: { contents: '{not json' } })
  assert.equal(JSON.parse(out.getContent()).error.code, 'BAD_REQUEST')
  let limited = false
  for (let i = 0; i < 260 && !limited; i++) limited = code(env.call('auth.me', {}, t.view)) === 'RATE_LIMITED'
  assert.equal(limited, true)
  assert.equal(code(env.call('db.mutate', { ops: Array.from({ length: 1001 }, () => create('suppliers', { name: 'x' })) }, t.admin)), 'BAD_REQUEST')
})
