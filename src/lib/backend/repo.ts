// Client-side view of the Google-Sheets database.
//  * Each table is cached in memory together with the server's table version.
//  * `ensure()` asks the server only for tables whose version changed (a tiny
//    request when nothing changed) so views always see other users' edits.
//  * Writes go to the server first; the cache is updated from the server's
//    answer — never optimistically — so the UI cannot show unsaved data as saved.
import { gasCall, ApiError } from './gas'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>

interface TableState { rows: Row[]; version: number; checkedAt: number }
interface SyncResponse { tables: Record<string, { version: number; rows?: Row[]; unchanged?: boolean }> }

export interface MutateOp {
  op: 'create' | 'update' | 'delete' | 'deleteWhere' | 'upsert'
  t: string
  id?: string
  rev?: number
  where?: Record<string, string>
  data?: Row
}
interface MutateResponse {
  results: Array<{ t: string; op: string; id?: string; row?: Row; count?: number }>
  deleted: Record<string, string[]>
  versions: { before: Record<string, number>; after: Record<string, number> }
}

const tables = new Map<string, TableState>()
const MAX_AGE_MS = 4000
let chain: Promise<unknown> = Promise.resolve()

export function resetRepo() { tables.clear() }
export function invalidate(names?: string[]) {
  if (!names) { tables.forEach((s) => { s.checkedAt = 0 }); return }
  names.forEach((n) => { const s = tables.get(n); if (s) s.checkedAt = 0 })
}

/** Make sure the given tables are loaded and current. Calls are serialised so parallel views share one round-trip. */
export function ensure(names: string[], opts: { force?: boolean } = {}): Promise<void> {
  const run = async () => {
    const now = Date.now()
    const need = names.filter((n) => opts.force || !tables.has(n) || now - (tables.get(n)?.checkedAt ?? 0) > MAX_AGE_MS)
    if (!need.length) return
    const res = await gasCall<SyncResponse>('db.sync', { tables: need.map((t) => ({ t, v: tables.get(t)?.version })) })
    for (const t of need) {
      const r = res.tables[t]
      if (!r) continue
      if (r.unchanged && tables.has(t)) tables.get(t)!.checkedAt = Date.now()
      else tables.set(t, { rows: r.rows ?? [], version: r.version, checkedAt: Date.now() })
    }
  }
  const p = chain.then(run, run)
  chain = p.catch(() => undefined)
  return p
}

export function rows(t: string): Row[] {
  const s = tables.get(t)
  if (!s) throw new Error(`Table ${t} is not loaded`)
  return s.rows
}
export function get(t: string, id: string): Row | undefined {
  return rows(t).find((r) => r.id === id)
}
export function where(t: string, pred: (r: Row) => boolean): Row[] {
  return rows(t).filter(pred)
}
export const byCreated = (a: Row, b: Row) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0)
export const byCreatedDesc = (a: Row, b: Row) => byCreated(b, a)

function apply(res: MutateResponse) {
  const touched = new Set<string>()
  for (const r of res.results) {
    const s = tables.get(r.t)
    if (!s || !r.row) continue
    touched.add(r.t)
    const i = s.rows.findIndex((x) => x.id === r.row!.id)
    if (i >= 0) s.rows[i] = r.row
    else s.rows.push(r.row)
  }
  for (const [t, ids] of Object.entries(res.deleted ?? {})) {
    const s = tables.get(t)
    touched.add(t)
    if (s) { const dead = new Set(ids); s.rows = s.rows.filter((x) => !dead.has(x.id)) }
  }
  for (const r of res.results) if (r.op === 'deleteWhere') touched.add(r.t)
  const { before, after } = res.versions ?? { before: {}, after: {} }
  for (const [t, nv] of Object.entries(after ?? {})) {
    const s = tables.get(t)
    if (!s) continue
    // Only adopt the new version when our copy was current AND fully reflects the change;
    // otherwise (side-effect tables, or someone else wrote in between) re-sync next time.
    if (touched.has(t) && s.version === before[t]) s.version = nv
    else s.checkedAt = 0
  }
}

export async function mutate(ops: MutateOp[], label = 'Save changes'): Promise<MutateResponse> {
  try {
    const res = await gasCall<MutateResponse>('db.mutate', { ops }, { write: true, label })
    if (res.results) apply(res)
    return res
  } catch (e) {
    if (e instanceof ApiError && (e.code === 'CONFLICT' || e.code === 'VALIDATION')) invalidate()
    throw e
  }
}

/** Convenience builders ------------------------------------------------ */
export const opCreate = (t: string, data: Row, id?: string): MutateOp => ({ op: 'create', t, id, data })
export const opUpdate = (t: string, id: string, data: Row, rev?: number): MutateOp => ({ op: 'update', t, id, data, rev })
export const opDelete = (t: string, id: string): MutateOp => ({ op: 'delete', t, id })

/** Update a cached row, carrying its revision so a concurrent edit by someone else is detected. */
export function updateOp(t: string, id: string, data: Row): MutateOp {
  const cur = tables.has(t) ? get(t, id) : undefined
  return { op: 'update', t, id, data, rev: cur?.rev }
}

/** Run a command action (stock.move, quotation.create, …) and mark the tables it changes as stale. */
export async function command<T>(action: string, payload: unknown, stale: string[], label: string): Promise<T> {
  const res = await gasCall<T>(action, payload, { write: true, label })
  invalidate(stale)
  return res
}
