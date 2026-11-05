import { useEffect, useState } from 'react'
import { DatabaseBackup, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { gasCall } from '@/lib/backend'
import { useAppStore } from '@/lib/store'

interface Status {
  lastSuccess: { id: string; at: string; status: string } | null
  lastError: { at: string; message: string } | null
  alert: 'NONE' | 'FAILED' | 'STALE' | 'NEVER' | 'PARTIAL'
  scheduled: boolean
}

const TEXT: Record<string, string> = {
  FAILED: 'Last backup FAILED',
  STALE: 'No successful backup for over 36 hours',
  NEVER: 'No backup has been made yet',
  PARTIAL: 'Last backup is partial (some Drive files missing or not mirrored)',
}

/** Admin-only strip on the dashboard: last successful backup time + alert when something is wrong. */
export function BackupBanner() {
  const isAdmin = useAppStore((s) => s.user?.role === 'SUPER_ADMIN')
  const navigate = useAppStore((s) => s.navigate)
  const [st, setSt] = useState<Status | null>(null)

  useEffect(() => {
    if (!isAdmin) return
    gasCall<Status>('backup.status').then(setSt).catch(() => undefined)
  }, [isAdmin])

  if (!isAdmin || !st) return null
  const bad = st.alert !== 'NONE'
  return (
    <button
      onClick={() => { try { sessionStorage.setItem('efbms-settings-tab', 'data') } catch { /* ignore */ } navigate('settings') }}
      className={`w-full flex items-center gap-3 rounded-lg border px-4 py-2.5 text-left text-sm ${bad ? 'border-rose-300 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}
      role={bad ? 'alert' : 'status'}
    >
      {bad ? <AlertTriangle className="w-4 h-4 shrink-0" /> : <CheckCircle2 className="w-4 h-4 shrink-0" />}
      <DatabaseBackup className="w-4 h-4 shrink-0 opacity-70" />
      <span className="flex-1">
        {bad ? <b>{TEXT[st.alert]}. </b> : null}
        Last successful backup: <b>{st.lastSuccess ? new Date(st.lastSuccess.at).toLocaleString() : 'never'}</b>
        {!st.scheduled && ' · daily schedule not installed'}
        {st.alert === 'FAILED' && st.lastError ? ` · ${st.lastError.message}` : ''}
      </span>
      <span className="text-xs underline shrink-0">Backup &amp; Data →</span>
    </button>
  )
}
