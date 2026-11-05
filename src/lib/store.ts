import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useMemo } from 'react'
import { getT, type Lang } from '@/lib/i18n'
import { callApi } from '@/lib/backend'

export interface AppUser {
  id: string
  email: string
  name: string
  role: string
  mustChange?: boolean
}

export type ViewKey =
  | 'dashboard' | 'projects' | 'materials' | 'suppliers' | 'inventory'
  | 'quotations' | 'reports' | 'settings' | 'help'

interface AppState {
  lang: Lang
  user: AppUser | null
  view: ViewKey
  activeProjectId: string | null
  projectTab: string
  sidebarOpen: boolean
  setLang: (l: Lang) => void
  setUser: (u: AppUser | null) => void
  navigate: (v: ViewKey) => void
  openProject: (id: string, tab?: string) => void
  closeProject: () => void
  setProjectTab: (t: string) => void
  setSidebarOpen: (o: boolean) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      lang: 'bn',
      user: null,
      view: 'dashboard',
      activeProjectId: null,
      projectTab: 'overview',
      sidebarOpen: false,
      setLang: (lang) => set({ lang }),
      setUser: (user) => set({ user, view: user ? 'dashboard' : 'dashboard' }),
      navigate: (view) => set({ view, sidebarOpen: false }),
      openProject: (activeProjectId, projectTab = 'overview') =>
        set({ activeProjectId, projectTab, view: 'projects', sidebarOpen: false }),
      closeProject: () => set({ activeProjectId: null, projectTab: 'overview' }),
      setProjectTab: (projectTab) => set({ projectTab }),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
    }),
    {
      name: 'efbms-store',
      partialize: (s) => ({ lang: s.lang, user: s.user }),
    },
  ),
)

export function useT() {
  const lang = useAppStore((s) => s.lang)
  return useMemo(() => getT(lang), [lang])
}

export function useApi<T>() {
  // Same call signature as before (path + fetch-style options), but served by the
  // Google Sheets / Drive backend. Errors are thrown as Error(message).
  return useMemo(() => async (path: string, opts?: RequestInit): Promise<T> => {
    return callApi<T>(path, { method: opts?.method, body: typeof opts?.body === 'string' ? opts.body : null })
  }, [])
}

// ---------------------------------------------------------------- hash routing
// GitHub Pages only serves real files, so the app keeps its location in the URL hash
// (#/projects/<id>/estimation). Refresh, bookmarks and direct links never reach the
// server as unknown paths and therefore can never produce a 404.
const VIEWS: ViewKey[] = ['dashboard', 'projects', 'materials', 'suppliers', 'inventory', 'quotations', 'reports', 'settings', 'help']

export function parseHash(hash: string): Partial<Pick<AppState, 'view' | 'activeProjectId' | 'projectTab'>> {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
  const view = parts[0] as ViewKey
  if (!VIEWS.includes(view)) return {}
  if (view === 'projects' && parts[1]) return { view, activeProjectId: parts[1], projectTab: parts[2] || 'overview' }
  return { view, activeProjectId: null, projectTab: 'overview' }
}
export function buildHash(s: Pick<AppState, 'view' | 'activeProjectId' | 'projectTab'>): string {
  if (s.view === 'projects' && s.activeProjectId) return `#/projects/${encodeURIComponent(s.activeProjectId)}/${encodeURIComponent(s.projectTab || 'overview')}`
  return `#/${s.view}`
}
