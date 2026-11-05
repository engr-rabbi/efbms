// Ports of the original Next.js /api/* route handlers. URLs and JSON shapes are kept
// identical so the existing UI components work unchanged, but the work is now done in
// the browser (calculations) + the Apps Script gateway (validation, permissions, storage).
import { gasCall, newId, setToken, ApiError } from './gas'
import * as repo from './repo'
import { ensure, mutate, opCreate, opDelete, updateOp, byCreated, byCreatedDesc, type Row } from './repo'
import { assetUrl } from './config'
import { clearFileCache } from './files'

export interface Req { method: string; query: URLSearchParams; body: Record<string, any> }
export type Handler = (req: Req, p: string[]) => Promise<unknown>

export const str = (v: unknown, d = '') => (typeof v === 'string' ? v : v == null ? d : String(v))
export const num = (v: unknown, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d }
export const bool = (v: unknown, d = false) => (typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : d)
export const notFound = (m: string) => new ApiError('NOT_FOUND', m, 404)
export const badReq = (m: string) => new ApiError('BAD_REQUEST', m, 400)

/** Only copy the fields that are present in the request body (PATCH semantics). */
export function pickFields(b: Row, strs: string[] = [], nums: Array<[string, number]> = [], bools: string[] = []): Row {
  const d: Row = {}
  for (const f of strs) if (f in b) d[f] = str(b[f])
  for (const [f, def] of nums) if (f in b) d[f] = num(b[f], def)
  for (const f of bools) if (f in b) d[f] = bool(b[f])
  return d
}

// ------------------------------------------------------------------ joins (replace Prisma `include`)
export function roomsOf(floorId: string): Row[] {
  const pts = repo.rows('points'), fxs = repo.rows('fixtures')
  return repo.where('rooms', (r) => r.floorId === floorId).sort(byCreated).map((r) => ({
    ...r, points: pts.filter((p) => p.roomId === r.id), fixtures: fxs.filter((x) => x.roomId === r.id),
  }))
}
export function floorsOf(projectId: string, withPF = true): Row[] {
  return repo.where('floors', (f) => f.projectId === projectId).sort((a, b) => a.floorNumber - b.floorNumber)
    .map((f) => ({ ...f, rooms: withPF ? roomsOf(f.id) : repo.where('rooms', (r) => r.floorId === f.id).sort(byCreated) }))
}
export const FLOOR_TABLES = ['projects', 'floors', 'rooms', 'points', 'fixtures']

export function imageUrl(img: Row): string {
  return img.fileId ? `drive:${img.fileId}` : assetUrl(img.url)
}
export function imagesOf(materialId: string): Row[] {
  return repo.where('materialImages', (i) => i.materialId === materialId)
    .sort((a, b) => (Number(b.isPrimary) - Number(a.isPrimary)) || (a.sortOrder - b.sortOrder) || byCreated(a, b))
    .map((i) => ({ ...i, url: imageUrl(i) }))
}

// ------------------------------------------------------------------ auth & users
export const authLogin: Handler = async ({ method, body }) => {
  if (method !== 'POST') throw badReq('Use the sign-in form')
  repo.resetRepo(); clearFileCache()
  const d = await gasCall<{ token: string; user: Row }>('auth.login', { email: body.email, password: body.password }, { write: true, queue: false })
  setToken(d.token)
  return { user: d.user }
}

export const users: Handler = async ({ method, body }) => {
  if (method === 'GET') {
    try {
      const d = await gasCall<{ users: Row[] }>('users.list')
      return { users: d.users }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'FORBIDDEN') {
        const d = await gasCall<{ users: Row[] }>('directory')
        return { users: d.users.map((u) => ({ ...u, email: '', active: true })) }
      }
      throw e
    }
  }
  if (method === 'POST') {
    const d = await gasCall<{ user: Row }>('users.create', { email: body.email, name: body.name, role: body.role, password: body.password }, { write: true, label: 'Create user' })
    return d
  }
  if (method === 'PATCH') {
    let last: { user: Row } | null = null
    if ('password' in body && body.password) await gasCall('users.setPassword', { id: body.id, password: body.password }, { write: true, label: 'Reset password' })
    if ('role' in body || 'name' in body || 'active' in body) {
      last = await gasCall<{ user: Row }>('users.update', { id: body.id, role: body.role, name: body.name, active: body.active }, { write: true, label: 'Update user' })
    }
    return last ?? { ok: true }
  }
  throw badReq('Unsupported')
}

// ------------------------------------------------------------------ company / rules / units
export const company: Handler = async ({ method, body }) => {
  await ensure(['company'])
  let c = repo.rows('company')[0]
  if (method === 'GET') {
    if (!c) return { company: { id: '', name: 'My Company', logoText: '', address: '', phone: '', email: '', licenseNo: '', vatRegNo: '', quotationTerms: '', paymentTerms: '', deliveryTerms: '' } }
    return { company: c }
  }
  const data = pickFields(body, ['name', 'logoText', 'address', 'phone', 'email', 'licenseNo', 'vatRegNo', 'quotationTerms', 'paymentTerms', 'deliveryTerms'])
  const res = await mutate([c ? updateOp('company', c.id, data) : opCreate('company', data, newId())], 'Save company info')
  c = res.results[0].row!
  return { company: c }
}

export const designRules: Handler = async ({ method, body }) => {
  await ensure(['designRules'])
  const sorted = () => [...repo.rows('designRules')].sort((a, b) => String(a.system).localeCompare(String(b.system)))
  if (method === 'GET') {
    const map: Record<string, string> = {}
    for (const r of repo.rows('designRules')) map[r.key] = r.value
    return { rules: sorted(), map }
  }
  const updates: Record<string, string> = body.rules ?? {}
  const ops = Object.entries(updates).map(([key, value]) => {
    const ex = repo.rows('designRules').find((r) => r.key === key)
    return ex ? updateOp('designRules', ex.id, { value: String(value) }) : opCreate('designRules', { key, value: String(value), label: key }, newId())
  })
  if (ops.length) await mutate(ops, 'Save design rules')
  return { rules: sorted() }
}
