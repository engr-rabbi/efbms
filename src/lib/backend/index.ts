// Public entry: `callApi('/api/projects/123', { method: 'PATCH', body: JSON.stringify({...}) })`
// has the same contract as the old Next.js fetch() calls, but is served by the browser-side
// handlers + the Google Apps Script gateway. No localStorage database, no mock data.
import { ApiError } from './gas'
import type { Handler } from './handlers-core'
import * as core from './handlers-core'
import * as proj from './handlers-project'
import * as est from './handlers-estimation'
import * as lib from './handlers-library'
import * as sales from './handlers-sales'

export { ApiError, onAuthLost, setToken, hasToken, gasCall } from './gas'
import { retryPending as retryPendingRaw } from './gas'
import { invalidate } from './repo'

/** Replay queued changes; afterwards every cached table is re-validated against the server. */
export async function retryPending() {
  const r = await retryPendingRaw()
  if (r.ok) invalidate()
  return r
}
export { getGasUrl, assetUrl } from './config'
export { resetRepo } from './repo'
export { importMaterials } from './material-bulk'
export { useSyncStore } from './sync-store'
export { resetDrawingState } from './handlers-estimation'

type Route = [method: string | '*', pattern: RegExp, handler: Handler]
const R = (m: string, p: string, h: Handler): Route => [m, new RegExp('^' + p.replace(/:[a-zA-Z]+/g, '([^/]+)') + '/?$'), h]

const routes: Route[] = [
  R('POST', '/api/auth/login', core.authLogin),
  R('*', '/api/users', core.users),
  R('GET', '/api/dashboard', sales.dashboard),
  R('*', '/api/company', core.company),
  R('*', '/api/design-rules', core.designRules),
  R('*', '/api/settings/units', proj.unitSettings),
  R('*', '/api/projects', proj.projects),
  R('POST', '/api/projects/:id/duplicate', proj.projectDuplicate),
  R('*', '/api/projects/:id', proj.projectById),
  R('POST', '/api/floors', proj.floors),
  R('*', '/api/floors/:id', proj.floorById),
  R('POST', '/api/rooms', proj.rooms),
  R('*', '/api/rooms/:id', proj.roomById),
  R('POST', '/api/points', proj.points),
  R('*', '/api/points/:id', proj.pointById),
  R('POST', '/api/fixtures', proj.fixtures),
  R('*', '/api/fixtures/:id', proj.fixtureById),
  R('*', '/api/estimation/:id', est.estimation),
  R('*', '/api/boq/:id/override', est.boqOverride),
  R('GET', '/api/boq/:id', est.boq),
  R('GET', '/api/purchase-list/:id', est.purchaseList),
  R('*', '/api/drawings/:id', est.drawings),
  R('*', '/api/materials', lib.materials),
  R('*', '/api/materials/:id/images', lib.materialImages),
  R('*', '/api/materials/:id/images/:imageId', lib.materialImageById),
  R('*', '/api/materials/:id', lib.materialById),
  R('*', '/api/stock', lib.stock),
  R('*', '/api/suppliers', lib.suppliers),
  R('*', '/api/suppliers/:id', lib.supplierById),
  R('*', '/api/quotations', sales.quotations),
  R('*', '/api/quotations/:id', sales.quotationById),
]

export interface ApiResult<T = unknown> { ok: boolean; status: number; data: T }

/** Same shape the old code expected from `await res.json()`; errors are thrown as ApiError. */
export async function callApi<T = any>(path: string, init: { method?: string; body?: string | null } = {}): Promise<T> {
  const url = new URL(path, 'http://x')
  const method = (init.method ?? 'GET').toUpperCase()
  let body: Record<string, any> = {}
  if (init.body) { try { body = JSON.parse(init.body) } catch { throw new ApiError('BAD_REQUEST', 'Invalid body', 400) } }
  for (const [m, re, h] of routes) {
    if (m !== '*' && m !== method) continue
    const match = re.exec(url.pathname)
    if (!match) continue
    const out = (await h({ method, query: url.searchParams, body }, match.slice(1).map(decodeURIComponent))) as Record<string, unknown>
    if (out && typeof out === 'object' && '__status' in out) { const { __status, ...rest } = out; void __status; return rest as T }
    return out as T
  }
  throw new ApiError('NOT_FOUND', `Unknown API route: ${method} ${url.pathname}`, 404)
}
