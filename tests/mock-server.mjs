// Local stand-in for the deployed Apps Script URL (used only by the browser smoke test).
import http from 'node:http'
import { createEnv } from './gas-mock.mjs'
const env = createEnv()
env.setup({ email: 'admin@example.com', password: 'S3cure-Admin-Pass' })
const admin = env.token('admin@example.com', 'S3cure-Admin-Pass')
for (const [email, role] of [['eng@x.com', 'ENGINEER'], ['view@x.com', 'VIEWER']]) env.ok('users.create', { email, name: role, role, password: 'Str0ng-Pass-1' }, admin)
// pre-seed: clear mustChange for admin so the smoke test can reach the app (the forced dialog is tested separately)
env.run("Store.reset(); Store.update('users', Store.find('users', function(u){return u.role==='SUPER_ADMIN'}).id, {mustChange:false}); Store.commit()")
if (process.env.DEMO) {
  const fs = await import('node:fs')
  const exp = JSON.parse(fs.readFileSync(new URL('./fixtures/demo-export.json', import.meta.url), 'utf8'))
  for (const t of ['company', 'designRules', 'settings', 'suppliers', 'materials', 'materialImages', 'priceHistory', 'projects', 'floors', 'rooms', 'points', 'fixtures', 'circuits', 'estimateItems', 'boqOverrides', 'drawings', 'quotations', 'purchaseOrders', 'stockMovements']) {
    const all = exp.tables[t] ?? []
    for (let i = 0; i < all.length; i += 150) env.ok('migration.import', { table: t, rows: all.slice(i, i + 150) }, admin)
  }
  console.log('demo data imported')
}
http.createServer((req, res) => {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end() }
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    const out = env.fn('doPost')({ postData: { contents: body } })
    res.writeHead(200, { ...cors, 'content-type': 'application/json' }); res.end(out.getContent())
  })
}).listen(8787, '127.0.0.1', () => console.log('mock backend on 8787'))
