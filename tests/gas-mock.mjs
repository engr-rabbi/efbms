// In-memory fakes of the Google services used by the Apps Script gateway, so the
// real server code (apps-script/*.gs) can be executed and tested in Node.
// NOTE: this proves the server LOGIC. It cannot prove Google's runtime behaviour
// (quotas, latency, OAuth) — see docs/TESTING.md for the live checklist.
import vm from 'node:vm'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../apps-script')
export const GS_ORDER = ['Config', 'Util', 'Store', 'Db', 'Auth', 'Files', 'Commands', 'Backup', 'Main']

const toSigned = (buf) => Array.from(buf, (b) => (b > 127 ? b - 256 : b))
const toBuf = (v) => (typeof v === 'string' ? Buffer.from(v, 'utf8') : Buffer.from(v.map((x) => x & 0xff)))

class Blob {
  constructor(data, type, name) { this._b = toBuf(data ?? ''); this._t = type || ''; this._n = name || '' }
  getBytes() { return toSigned(this._b) }
  getDataAsString() { return this._b.toString('utf8') }
  getContentType() { return this._t }
  setContentType(t) { this._t = t; return this }
  getName() { return this._n }
  setName(n) { this._n = n; return this }
}

export function createEnv() {
  let seq = 0
  const mkId = (p) => `${p}${(++seq).toString(36).padStart(6, '0')}${crypto.randomBytes(8).toString('hex')}`
  const stats = { sheetWrites: 0, mails: [], logs: [] }

  // ------------------------------------------------ properties / cache / lock
  const makeProps = () => {
    const m = new Map()
    return {
      getProperty: (k) => (m.has(k) ? m.get(k) : null),
      setProperty(k, v) { if (String(v).length > 9000) throw new Error('Property value too large'); m.set(k, String(v)); return this },
      deleteProperty(k) { m.delete(k); return this },
      _m: m,
    }
  }
  const props = makeProps()
  const cacheMap = new Map()
  const cache = {
    get: (k) => (cacheMap.has(k) ? cacheMap.get(k) : null),
    put(k, v) { if (String(v).length > 100000) throw new Error('Cache value too large'); cacheMap.set(k, String(v)) },
    remove: (k) => cacheMap.delete(k),
  }
  let locked = false
  const lock = {
    tryLock() { if (locked) return false; locked = true; return true },
    waitLock() { if (locked) throw new Error('lock busy'); locked = true },
    releaseLock() { locked = false },
  }

  // ------------------------------------------------ Drive
  const files = new Map(), folders = new Map()
  const rootFolder = { id: 'ROOT', name: 'My Drive', trashed: false, children: new Set(), files: new Set() }
  folders.set('ROOT', rootFolder)
  const wrapFile = (rec) => ({
    getId: () => rec.id, getName: () => rec.name, isTrashed: () => rec.trashed,
    getBlob: () => new Blob(rec.bytes, rec.mime, rec.name),
    setContent(s) { rec.bytes = toBuf(s); return this },
    setTrashed(t) { rec.trashed = t; return this },
    setSharing() { rec.sharedCalls = (rec.sharedCalls || 0) + 1; return this },
    makeCopy(name, folder) { return createFile(folders.get(folder.getId()), name, rec.bytes, rec.mime) },
    getSize: () => rec.bytes.length, _rec: rec,
  })
  function createFile(folderRec, name, content, mime) {
    const rec = { id: mkId('F'), name, bytes: toBuf(content), mime: mime || 'application/octet-stream', trashed: false }
    files.set(rec.id, rec); folderRec.files.add(rec.id)
    return wrapFile(rec)
  }
  const wrapFolder = (rec) => ({
    getId: () => rec.id, getName: () => rec.name, isTrashed: () => rec.trashed,
    getFoldersByName(name) {
      const l = [...rec.children].map((i) => folders.get(i)).filter((f) => f.name === name && !f.trashed)
      let i = 0
      return { hasNext: () => i < l.length, next: () => wrapFolder(l[i++]) }
    },
    createFolder(name) {
      const f = { id: mkId('D'), name, trashed: false, children: new Set(), files: new Set() }
      folders.set(f.id, f); rec.children.add(f.id)
      return wrapFolder(f)
    },
    createFile(a, b, c) {
      if (a instanceof Blob) return createFile(rec, a.getName(), a._b, a.getContentType())
      return createFile(rec, a, b, c)
    },
    addFile(file) { rec.files.add(file.getId()) },
    removeFile(file) { rec.files.delete(file.getId()) },
  })
  const DriveApp = {
    Access: { PRIVATE: 'PRIVATE' }, Permission: { NONE: 'NONE' },
    getRootFolder: () => wrapFolder(rootFolder),
    getFolderById(id) { const f = folders.get(id); if (!f) throw new Error('No item with the given ID could be found'); return wrapFolder(f) },
    getFileById(id) { const f = files.get(id); if (!f) throw new Error('No item with the given ID could be found'); return wrapFile(f) },
  }

  // ------------------------------------------------ Sheets
  class Range {
    constructor(sh, r, c, nr, nc) {
      if (r < 1 || c < 1 || nr < 1 || nc < 1) throw new Error('Invalid range')
      if (r + nr - 1 > sh.maxRows) throw new Error(`The coordinates of the range are outside the dimensions of the sheet (${r + nr - 1} > ${sh.maxRows})`)
      Object.assign(this, { sh, r, c, nr, nc })
    }
    getValues() {
      const out = []
      for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) { const v = (this.sh.rows[this.r - 1 + i] || [])[this.c - 1 + j]; row.push(v === undefined ? '' : v) } out.push(row) }
      return out
    }
    setValues(vals) {
      if (vals.length !== this.nr || vals.some((x) => x.length !== this.nc)) throw new Error('The number of rows/columns in the data does not match the range')
      stats.sheetWrites++
      for (let i = 0; i < this.nr; i++) {
        const rr = (this.sh.rows[this.r - 1 + i] = this.sh.rows[this.r - 1 + i] || [])
        for (let j = 0; j < this.nc; j++) {
          const v = vals[i][j]
          if (typeof v === 'string' && v.length > 50000) throw new Error('Cell exceeds 50000 characters')
          if (v !== null && typeof v === 'object') throw new Error('Cannot store object in cell')
          rr[this.c - 1 + j] = v
        }
      }
      return this
    }
    clearContent() { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) { const row = this.sh.rows[this.r - 1 + i]; if (row) row[this.c - 1 + j] = '' } return this }
    setNumberFormat() { return this } setFontWeight() { return this } setBackground() { return this }
  }
  class Sheet {
    constructor(name) { this.name = name; this.rows = []; this.maxRows = 1000; this.maxCols = 26 }
    getName() { return this.name }
    getLastRow() { for (let i = this.rows.length - 1; i >= 0; i--) if ((this.rows[i] || []).some((v) => v !== '' && v !== undefined)) return i + 1; return 0 }
    getLastColumn() { let m = 0; this.rows.forEach((r) => (r || []).forEach((v, j) => { if (v !== '' && v !== undefined) m = Math.max(m, j + 1) })); return m }
    getMaxRows() { return this.maxRows }
    insertRowsAfter(pos, n) { this.maxRows += n }
    setFrozenRows() {}
    getRange(r, c, nr = 1, nc = 1) { return new Range(this, r, c, nr, nc) }
  }
  const spreadsheets = new Map()
  const SpreadsheetApp = {
    create(name) {
      const sheets = [new Sheet('Sheet1')]
      const ss = {
        id: mkId('S'), name,
        getId() { return this.id }, getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id },
        getSheetByName: (n) => sheets.find((s) => s.name === n) || null,
        insertSheet(n) { const s = new Sheet(n); sheets.push(s); return s },
        getSheets: () => sheets,
        deleteSheet(s) { sheets.splice(sheets.indexOf(s), 1) },
      }
      spreadsheets.set(ss.id, ss)
      const f = { id: ss.id, name, bytes: Buffer.alloc(0), mime: 'sheet', trashed: false }
      files.set(f.id, f); rootFolder.files.add(f.id)
      return ss
    },
    openById(id) { const s = spreadsheets.get(id); if (!s) throw new Error('Spreadsheet not found'); return s },
  }

  // ------------------------------------------------ Utilities
  const algo = { SHA_256: 'sha256' }
  const Utilities = {
    DigestAlgorithm: algo,
    getUuid: () => crypto.randomUUID(),
    newBlob: (d, t, n) => new Blob(d, t, n),
    base64Encode: (d) => toBuf(d).toString('base64'),
    base64Decode: (s) => { if (typeof s !== 'string' || /[^A-Za-z0-9+/=\s]/.test(s)) throw new Error('Invalid base64'); return toSigned(Buffer.from(s, 'base64')) },
    base64EncodeWebSafe: (d) => toBuf(d).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
    base64DecodeWebSafe: (s) => toSigned(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
    computeDigest: (a, d) => toSigned(crypto.createHash(a).update(toBuf(d)).digest()),
    computeHmacSha256Signature: (v, k) => toSigned(crypto.createHmac('sha256', toBuf(k)).update(toBuf(v)).digest()),
    gzip: (blob, name) => new Blob(zlib.gzipSync(blob._b), 'application/x-gzip', name || blob.getName() + '.gz'),
    ungzip: (blob) => new Blob(zlib.gunzipSync(blob._b), 'application/octet-stream', 'out'),
  }

  const triggers = []
  const ScriptApp = {
    getProjectTriggers: () => triggers.map((t) => ({ getHandlerFunction: () => t.fn, _t: t })),
    deleteTrigger(t) { triggers.splice(triggers.indexOf(t._t), 1) },
    newTrigger: (fn) => ({ timeBased() { return this }, everyDays() { return this }, atHour() { return this }, create() { triggers.push({ fn }) } }),
  }
  const ContentService = {
    MimeType: { JSON: 'json' },
    createTextOutput: (s) => ({ _s: s, setMimeType() { return this }, getContent() { return this._s } }),
  }
  const MailApp = { sendEmail: (to, subject, body) => stats.mails.push({ to, subject, body }) }
  const consoleFake = { log() {}, error: (...a) => stats.logs.push(a.join(' ')), warn() {} }

  const ctx = vm.createContext({ PropertiesService: { getScriptProperties: () => props }, CacheService: { getScriptCache: () => cache }, LockService: { getScriptLock: () => lock },
    DriveApp, SpreadsheetApp, Utilities, ScriptApp, ContentService, MailApp, console: consoleFake, Date, JSON, Math, Object, Array, String, Number, Boolean, Error, RegExp, isFinite, parseInt, Buffer })
  const src = GS_ORDER.map((n) => fs.readFileSync(path.join(dir, n + '.gs'), 'utf8')).join('\n')
  vm.runInContext(src, ctx, { filename: 'apps-script-bundle.gs' })

  const g = (name) => vm.runInContext(name, ctx)
  const env = {
    ctx, stats, props, cache: cacheMap, files, folders, spreadsheets, triggers,
    run: (code) => vm.runInContext(code, ctx),
    fn: g,
    /** Call the web-app like the browser does. */
    call(action, payload = {}, token = null, reqId = null) {
      const body = { action, payload, token: token || undefined, reqId: reqId || undefined }
      const out = g('doPost')({ postData: { contents: JSON.stringify(body) } })
      return JSON.parse(out.getContent())
    },
    ok(action, payload, token, reqId) { const r = env.call(action, payload, token, reqId); if (!r.ok) throw new Error(`${action} failed: ${r.error.code} ${r.error.message}`); return r.data },
    setup({ email = 'admin@example.com', password = 'S3cure-Admin-Pass' } = {}) {
      props.setProperty('INITIAL_ADMIN_EMAIL', email); props.setProperty('INITIAL_ADMIN_PASSWORD', password)
      g('setup')()
      return { email, password }
    },
    login(email, password) { return env.call('auth.login', { email, password }) },
    token(email, password) { const r = env.login(email, password); if (!r.ok) throw new Error(JSON.stringify(r.error)); return r.data.token },
  }
  return env
}
