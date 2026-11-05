// Concatenates apps-script/*.gs into ONE file (gas-dist/Code.gs) so it can be pasted into the
// Apps Script editor in a single step, and copies appsscript.json (the manifest).
import fs from 'node:fs'
import path from 'node:path'
const src = path.resolve('apps-script'), out = path.resolve('gas-dist')
const order = ['Config', 'Util', 'Store', 'Db', 'Auth', 'Files', 'Commands', 'Backup', 'Main']
fs.mkdirSync(out, { recursive: true })
const body = order.map((n) => `// ======================================================================\n// ${n}.gs\n// ======================================================================\n` + fs.readFileSync(path.join(src, n + '.gs'), 'utf8')).join('\n')
fs.writeFileSync(path.join(out, 'Code.gs'), body)
fs.copyFileSync(path.join(src, 'appsscript.json'), path.join(out, 'appsscript.json'))
console.log(`gas-dist/Code.gs (${(body.length / 1024).toFixed(0)} KB) + appsscript.json`)
