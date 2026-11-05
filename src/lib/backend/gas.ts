// Transport to the Google Apps Script gateway.
//  - POST text/plain (a "simple" request → no CORS pre-flight, which Apps Script cannot answer)
//  - every write carries a reqId so a retry after a lost response can never double-save
//  - network failures of writes are queued as "pending changes" and are NEVER reported as saved
import { getGasUrl } from './config'
import { useSyncStore } from './sync-store'

export class ApiError extends Error {
  code: string
  status: number
  details?: unknown
  retryable: boolean
  constructor(code: string, message: string, status = 0, details?: unknown, retryable = false) {
    super(message)
    this.code = code; this.status = status; this.details = details; this.retryable = retryable
  }
}

const TOKEN_KEY = 'efbms-token'
let token: string | null = null
try { token = sessionStorage.getItem(TOKEN_KEY) } catch { /* private mode */ }

let authLostHandler: (() => void) | null = null
export function onAuthLost(fn: () => void) { authLostHandler = fn }

export function setToken(t: string | null) {
  token = t
  try { if (t) sessionStorage.setItem(TOKEN_KEY, t); else sessionStorage.removeItem(TOKEN_KEY) } catch { /* ignore */ }
}
export function hasToken() { return !!token }

export function newReqId(): string {
  return (crypto as Crypto & { randomUUID?: () => string }).randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}
export function newId(): string {
  // client-generated record ids so a parent and its children can be created in ONE atomic request
  const r = (crypto as Crypto).getRandomValues(new Uint8Array(8))
  return 'c' + Date.now().toString(36) + Array.from(r, (b) => b.toString(16).padStart(2, '0')).join('')
}

interface CallOpts {
  write?: boolean
  label?: string
  reqId?: string
  timeoutMs?: number
  /** queue the request as a pending change when the network fails (default: true for writes) */
  queue?: boolean
}

interface Envelope<T> {
  ok: boolean
  data?: T
  error?: { code: string; message: string; status: number; details?: unknown }
  newToken?: string
  duplicate?: boolean
}

async function once<T>(action: string, payload: unknown, reqId: string | undefined, timeoutMs: number): Promise<Envelope<T>> {
  const url = getGasUrl()
  if (!url) throw new ApiError('NOT_CONFIGURED', 'Backend URL is not configured. Set gasUrl in config.js (see docs/SETUP.md).')
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, payload, token: token ?? undefined, reqId }),
      signal: ctl.signal,
      redirect: 'follow',
      credentials: 'omit',
    })
  } catch {
    throw new ApiError('NETWORK', navigator.onLine === false ? 'You are offline. Changes were not saved.' : 'Cannot reach the server (network error or timeout). Changes were not saved.', 0, undefined, true)
  } finally {
    clearTimeout(timer)
  }
  const text = await res.text()
  try {
    return JSON.parse(text) as Envelope<T>
  } catch {
    throw new ApiError('BAD_RESPONSE', 'The server returned an unexpected page. Check that the Apps Script web app is deployed with access "Anyone" and that the URL ends with /exec.', res.status)
  }
}

export async function gasCall<T = unknown>(action: string, payload: unknown = {}, opts: CallOpts = {}): Promise<T> {
  const sync = useSyncStore.getState()
  const write = !!opts.write
  const reqId = opts.reqId ?? (write ? newReqId() : undefined)
  const timeout = opts.timeoutMs ?? (write ? 120_000 : 60_000)
  sync.begin()
  try {
    let env: Envelope<T>
    try {
      env = await once<T>(action, payload, reqId, timeout)
    } catch (e) {
      if (!write && e instanceof ApiError && e.retryable) {            // reads are safe to retry once
        await new Promise((r) => setTimeout(r, 1200))
        env = await once<T>(action, payload, reqId, timeout)
      } else throw e
    }
    if (!env.ok) {
      const er = env.error!
      const err = new ApiError(er.code, er.message, er.status, er.details, er.code === 'BUSY')
      if (er.code === 'UNAUTHENTICATED' && action !== 'auth.login') { setToken(null); authLostHandler?.() }
      throw err
    }
    if (env.newToken) setToken(env.newToken)
    if (write && action !== 'auth.login') useSyncStore.getState().saved()
    return env.data as T
  } catch (e) {
    if (e instanceof ApiError) {
      useSyncStore.getState().fail(e.message)
      if (write && e.retryable && opts.queue !== false && action !== 'auth.login') {
        useSyncStore.getState().addPending({
          id: reqId!, reqId: reqId!, action, payload, label: opts.label ?? action, createdAt: Date.now(), error: e.message, attempts: 1,
        })
        e.message += ' It is kept under "Pending changes" — press Retry when you are back online.'
      }
    }
    throw e
  } finally {
    useSyncStore.getState().end()
  }
}

/** Re-send queued changes with their ORIGINAL request ids (the server de-duplicates). */
export async function retryPending(): Promise<{ ok: number; failed: number }> {
  const st = useSyncStore.getState()
  if (st.retrying) return { ok: 0, failed: 0 }
  st.setRetrying(true)
  let ok = 0, failed = 0
  try {
    for (const item of [...useSyncStore.getState().pending]) {
      try {
        await gasCall(item.action, item.payload, { write: true, reqId: item.reqId, queue: false, label: item.label })
        useSyncStore.getState().removePending(item.id); ok++
      } catch (e) {
        failed++
        const msg = e instanceof Error ? e.message : String(e)
        useSyncStore.getState().updatePending(item.id, { error: msg, attempts: item.attempts + 1 })
        if (e instanceof ApiError && e.retryable) break // still offline: stop early
      }
    }
    if (ok) useSyncStore.getState().bumpEpoch()
  } finally {
    useSyncStore.getState().setRetrying(false)
  }
  return { ok, failed }
}
