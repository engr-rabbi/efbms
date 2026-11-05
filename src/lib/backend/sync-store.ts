import { create } from 'zustand'

export interface PendingItem {
  id: string
  action: string
  payload: unknown
  reqId: string
  label: string
  createdAt: number
  error: string
  attempts: number
}

const KEY = 'efbms-pending-v1'

function load(): PendingItem[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as PendingItem[]) : []
  } catch { return [] }
}
function save(items: PendingItem[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items))
  } catch {
    // storage full (e.g. a very large drawing): keep in memory only, UI still shows it
  }
}

interface SyncState {
  inflight: number
  pending: PendingItem[]
  retrying: boolean
  lastSavedAt: number | null
  lastError: string | null
  /** bumps when queued changes were replayed; views use it as a React key to reload */
  epoch: number
  begin: () => void
  end: () => void
  saved: () => void
  fail: (m: string | null) => void
  addPending: (p: PendingItem) => void
  updatePending: (id: string, patch: Partial<PendingItem>) => void
  removePending: (id: string) => void
  clearPending: () => void
  setRetrying: (b: boolean) => void
  bumpEpoch: () => void
}

export const useSyncStore = create<SyncState>()((set, get) => ({
  inflight: 0,
  pending: load(),
  retrying: false,
  lastSavedAt: null,
  lastError: null,
  epoch: 0,
  begin: () => set((s) => ({ inflight: s.inflight + 1 })),
  end: () => set((s) => ({ inflight: Math.max(0, s.inflight - 1) })),
  saved: () => set({ lastSavedAt: Date.now(), lastError: null }),
  fail: (m) => set({ lastError: m }),
  addPending: (p) => { const next = [...get().pending.filter((x) => x.reqId !== p.reqId), p]; save(next); set({ pending: next }) },
  updatePending: (id, patch) => { const next = get().pending.map((x) => (x.id === id ? { ...x, ...patch } : x)); save(next); set({ pending: next }) },
  removePending: (id) => { const next = get().pending.filter((x) => x.id !== id); save(next); set({ pending: next }) },
  clearPending: () => { save([]); set({ pending: [] }) },
  setRetrying: (retrying) => set({ retrying }),
  bumpEpoch: () => set((s) => ({ epoch: s.epoch + 1 })),
}))
