import { useState, useEffect, useSyncExternalStore } from 'react'
import { LoginForm } from '@/components/app/login'
import { SyncStatus } from '@/components/app/sync-status'
import { ChangePasswordDialog } from '@/components/app/change-password'
import { onAuthLost, setToken, resetRepo, resetDrawingState, retryPending } from '@/lib/backend'
import { useSyncStore } from '@/lib/backend/sync-store'
import { parseHash, buildHash } from '@/lib/store'
import { clearFileCache } from '@/lib/backend/files'
import { toast } from 'sonner'
import { useAppStore, useT } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet'
import DashboardView from '@/components/views/dashboard'
import ProjectsView from '@/components/views/projects'
import MaterialsView from '@/components/views/materials'
import SuppliersView from '@/components/views/suppliers'
import InventoryView from '@/components/views/inventory'
import QuotationsView from '@/components/views/quotations'
import ReportsView from '@/components/views/reports'
import SettingsView from '@/components/views/settings'
import HelpView from '@/components/views/help'
import { UnitQuickSelector } from '@/components/units/unit-controls'
import { useUnitStore } from '@/lib/unit-store'
import {
  LayoutDashboard, FolderKanban, Package, Truck, Boxes, FileText, BarChart3,
  Settings as SettingsIcon, BookOpen, Zap, Globe, LogOut, Menu, Wrench, KeyRound,
} from 'lucide-react'

function SidebarContent() {
  const t = useT()
  const { view, navigate } = useAppStore()
  const items: Array<{ key: 'dashboard' | 'projects' | 'materials' | 'suppliers' | 'inventory' | 'quotations' | 'reports' | 'settings' | 'help'; icon: React.ElementType; label: string }> = [
    { key: 'dashboard', icon: LayoutDashboard, label: t('dashboard') },
    { key: 'projects', icon: FolderKanban, label: t('projects') },
    { key: 'materials', icon: Package, label: t('materialLibrary') },
    { key: 'suppliers', icon: Truck, label: t('suppliers') },
    { key: 'inventory', icon: Boxes, label: t('inventory') },
    { key: 'quotations', icon: FileText, label: t('quotations') },
    { key: 'reports', icon: BarChart3, label: t('reports') },
    { key: 'settings', icon: SettingsIcon, label: t('settings') },
    { key: 'help', icon: BookOpen, label: t('help') },
  ]
  return (
    <nav className="flex flex-col gap-1 p-3" aria-label="Main navigation">
      {items.map(({ key, icon: Icon, label }) => (
        <button
          key={key}
          onClick={() => navigate(key)}
          className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors min-h-[44px] ${
            view === key
              ? 'bg-amber-100 text-amber-900'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }`}
          aria-current={view === key ? 'page' : undefined}
        >
          <Icon className="w-4.5 h-4.5 shrink-0" />
          <span className="truncate">{label}</span>
        </button>
      ))}
      <div className="mt-4 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-[11px] leading-relaxed text-slate-500">
        <Wrench className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
        Electrical • Plumbing • BOQ • Supply
      </div>
    </nav>
  )
}

function LangToggle() {
  const t = useT()
  const { lang, setLang } = useAppStore()
  return (
    <div className="flex items-center rounded-lg border border-slate-200 overflow-hidden" role="group" aria-label={t('language')}>
      <button
        onClick={() => setLang('bn')}
        className={`px-2.5 py-1.5 text-xs font-semibold min-h-[36px] ${lang === 'bn' ? 'bg-amber-500 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
      >
        বাংলা
      </button>
      <button
        onClick={() => setLang('en')}
        className={`px-2.5 py-1.5 text-xs font-semibold min-h-[36px] ${lang === 'en' ? 'bg-amber-500 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
      >
        EN
      </button>
    </div>
  )
}

export default function App() {
  const t = useT()
  const { user, view, setUser, sidebarOpen, setSidebarOpen } = useAppStore()
  const hydrateUnits = useUnitStore((s) => s.hydrateFromServer)
  const epoch = useSyncStore((s) => s.epoch)
  const [pwOpen, setPwOpen] = useState(false)

  // Pull the shared global unit settings from the sheet once after login.
  useEffect(() => {
    if (user) void hydrateUnits()
  }, [user, hydrateUnits])

  // Session lost (expired / account disabled / signed out elsewhere) → back to the login screen.
  useEffect(() => {
    onAuthLost(() => { toast.error('Session ended — please sign in again'); useAppStore.setState({ user: null }) })
  }, [])

  // A persisted user without a session token (new tab, expired) must sign in again.
  useEffect(() => {
    if (user && !sessionStorage.getItem('efbms-token')) useAppStore.setState({ user: null })
  }, [user])

  // Replay queued changes automatically when the browser comes back online.
  useEffect(() => {
    const on = () => { if (useSyncStore.getState().pending.length) void retryPending() }
    window.addEventListener('online', on)
    return () => window.removeEventListener('online', on)
  }, [])

  // Warn before leaving the page while changes are still unsaved.
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (useSyncStore.getState().pending.length || useSyncStore.getState().inflight) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [])

  // URL hash <-> navigation state (refresh / deep links never 404 on GitHub Pages)
  useEffect(() => {
    const apply = () => { const p = parseHash(window.location.hash); if (Object.keys(p).length) useAppStore.setState(p) }
    apply()
    if (user && !window.location.hash) window.history.replaceState(null, '', buildHash(useAppStore.getState()))
    window.addEventListener('hashchange', apply)
    const unsub = useAppStore.subscribe((st) => {
      const h = buildHash(st)
      if (user && window.location.hash !== h) window.history.pushState(null, '', h)
    })
    return () => { window.removeEventListener('hashchange', apply); unsub() }
  }, [user])

  const logout = () => {
    setToken(null); resetRepo(); resetDrawingState(); clearFileCache(); setUser(null)
  }

  // Detect zustand persist rehydration via external store subscription (no sync setState)
  const hydrated = useSyncExternalStore(
    (cb) => useAppStore.persist.onFinishHydration(cb),
    () => useAppStore.persist.hasHydrated(),
    () => false,
  )

  if (!hydrated) {
    return <div className="min-h-screen bg-white" />
  }
  if (!user) return <LoginForm />

  const roleColors: Record<string, string> = {
    SUPER_ADMIN: 'bg-amber-100 text-amber-900',
    ENGINEER: 'bg-emerald-100 text-emerald-900',
    SALES: 'bg-violet-100 text-violet-900',
    INVENTORY: 'bg-cyan-100 text-cyan-900',
    VIEWER: 'bg-slate-100 text-slate-700',
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      {/* Top bar */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-200 print:hidden">
        <div className="flex items-center gap-3 px-3 sm:px-4 h-14">
          {/* Mobile sidebar */}
          <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu">
                <Menu className="w-5 h-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0">
              <SheetTitle className="sr-only">{t('dashboard')}</SheetTitle>
              <div className="flex items-center gap-2 px-4 h-14 border-b border-slate-200">
                <div className="w-8 h-8 rounded-lg bg-amber-500 flex items-center justify-center">
                  <Zap className="w-4.5 h-4.5 text-white" />
                </div>
                <span className="font-bold">{t('appName')}</span>
              </div>
              <SidebarContent />
            </SheetContent>
          </Sheet>

          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-amber-500 hidden lg:flex items-center justify-center shrink-0">
              <Zap className="w-4.5 h-4.5 text-white" />
            </div>
            <div className="min-w-0">
              <div className="font-bold text-sm leading-tight truncate">{t('appName')}</div>
              <div className="text-[10px] text-slate-500 leading-tight truncate hidden sm:block">{t('appTagline')}</div>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <UnitQuickSelector />
            <LangToggle />
            <div className="hidden sm:block text-right leading-tight">
              <div className="text-xs font-semibold">{user.name}</div>
              <Badge className={`text-[9px] px-1.5 py-0 ${roleColors[user.role] ?? 'bg-slate-100'}`} variant="secondary">
                {user.role}
              </Badge>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setPwOpen(true)} aria-label={t('changePassword')} title={t('changePassword')}>
              <KeyRound className="w-4.5 h-4.5" />
            </Button>
            <Button variant="ghost" size="icon" onClick={logout} aria-label={t('logout')} title={t('logout')}>
              <LogOut className="w-4.5 h-4.5" />
            </Button>
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        {/* Desktop sidebar */}
        <aside className="hidden lg:block w-60 shrink-0 border-r border-slate-200 bg-white print:hidden">
          <div className="sticky top-14 max-h-[calc(100vh-3.5rem)] overflow-y-auto">
            <SidebarContent />
          </div>
        </aside>

        {/* Main content */}
        <main key={epoch} className="flex-1 min-w-0 p-3 sm:p-5 lg:p-6">
          {view === 'dashboard' && <DashboardView />}
          {view === 'projects' && <ProjectsView />}
          {view === 'materials' && <MaterialsView />}
          {view === 'suppliers' && <SuppliersView />}
          {view === 'inventory' && <InventoryView />}
          {view === 'quotations' && <QuotationsView />}
          {view === 'reports' && <ReportsView />}
          {view === 'settings' && <SettingsView />}
          {view === 'help' && <HelpView />}
        </main>
      </div>

      <SyncStatus />
      <ChangePasswordDialog open={pwOpen || !!user.mustChange} forced={!!user.mustChange} onClose={() => setPwOpen(false)} />

      {/* Sticky footer */}
      <footer className="mt-auto border-t border-slate-200 bg-white print:hidden">
        <div className="px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-1 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <Globe className="w-3.5 h-3.5" />
            {t('appName')} — {t('appTagline')}
          </span>
          <span>© {new Date().getFullYear()} · Bangladesh Residential Building Solutions</span>
        </div>
      </footer>
    </div>
  )
}
