// Generates docs/SHEETS_SCHEMA.md straight from apps-script/Config.gs so the documentation can never drift from the code.
import fs from 'node:fs'
import vm from 'node:vm'
const ctx = vm.createContext({ console })
vm.runInContext(fs.readFileSync('apps-script/Config.gs', 'utf8'), ctx)
const g = (n) => vm.runInContext(n, ctx)
const SCHEMA = g('SCHEMA'), POLICY = g('POLICY'), ENUMS = g('ENUMS')
const T = { s: 'text', n: 'number', i: 'integer', b: 'TRUE/FALSE', j: 'JSON text' }
let md = `# Google Sheet structure (auto-generated from \`apps-script/Config.gs\`)\n\n> Do not edit the sheet's header row, rename or reorder columns, and do not edit data by hand while people are using the app. All writes must go through the Apps Script gateway (it validates, checks permissions, bumps versions and writes the audit log).\n\nEvery tab starts with the system columns **id, createdAt, updatedAt, rev** (rev = revision counter used to detect two people editing the same record).\n\n`
const roles = { SUPER_ADMIN: 'A', ENGINEER: 'E', SALES: 'S', INVENTORY: 'I', VIEWER: 'V' }
const short = (l) => (l.length ? l.map((r) => roles[r]).join('') : '—')
md += `Role letters: A = SUPER_ADMIN, E = ENGINEER, S = SALES, I = INVENTORY, V = VIEWER. “project scope” = a row is only visible/changeable if the user is admin, the project owner, or listed in the project's members.\n\n`
for (const [key, d] of Object.entries(SCHEMA)) {
  const p = POLICY[key]
  md += `## ${d.sheet}  \`(${key})\`\n\n`
  md += `Read: ${short(p.read)} · Create: ${short(p.write.create)} · Update: ${short(p.write.update)} · Delete: ${short(p.write.delete)}${d.projectCol ? ' · **project scope**' : ''}${d.unique ? ' · unique: ' + d.unique.join(', ') : ''}${d.children ? ' · deletes also: ' + d.children.map((c) => `${c[0]}.${c[1]}`).join(', ') : ''}\n\n`
  md += `| Column | Type | Rules |\n|---|---|---|\n| id | text | primary key |\n| createdAt / updatedAt | ISO time | set by server |\n| rev | integer | +1 on every update |\n`
  for (const f of d.fields) {
    const r = []
    if (f.req) r.push('required')
    if (f.enum) r.push('one of: ' + ENUMS[f.enum].join(' / '))
    if (f.def !== undefined && f.def !== '') r.push('default ' + JSON.stringify(f.def))
    if (f.max) r.push('max ' + f.max + ' chars')
    if (f.min !== undefined) r.push('≥ ' + f.min)
    if (f.maxv !== undefined) r.push('≤ ' + f.maxv)
    if (d.fk && d.fk[f.name]) r.push('→ ' + d.fk[f.name] + '.id')
    if ((d.hidden || []).includes(f.name)) r.push('never sent to browser')
    md += `| ${f.name} | ${T[f.type]} | ${r.join('; ')} |\n`
  }
  md += '\n'
}
md += `## Files that are not rows\n\n* **Drawings** — the editable drawing JSON (geometry, scale, layers, symbols, routes) is a file in Drive › Projects/<code>_<id>/Drawings; the \`Drawings\` row points to it through \`fileId\` (a \`Files.id\`).\n* **Large values** — any text/JSON longer than 40 000 characters (a Sheets cell holds 50 000) is moved to Drive › System_Data/Blobs and the cell holds \`@blob:<driveFileId>\`; the gateway reads it back transparently.\n`
fs.writeFileSync('docs/SHEETS_SCHEMA.md', md)
console.log('docs/SHEETS_SCHEMA.md', md.length, 'chars')
