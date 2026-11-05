import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2, CloudOff, CheckCircle2, RotateCw, Trash2, ChevronUp, ChevronDown } from 'lucide-react'
import { useSyncStore } from '@/lib/backend/sync-store'
import { retryPending } from '@/lib/backend'
import { useT } from '@/lib/store'
import { Button } from '@/components/ui/button'

/** Honest save-state indicator: saving…, saved, or "N changes NOT saved yet" with Retry. */
export function SyncStatus() {
  const t = useT()
  const { inflight, pending, retrying, lastSavedAt, clearPending, removePending } = useSyncStore()
  const [open, setOpen] = useState(false)

  const retry = async () => {
    const r = await retryPending()
    if (r.ok) toast.success(`${r.ok} pending change(s) saved`)
    if (r.failed) toast.error(`${r.failed} change(s) still not saved`)
  }

  if (pending.length > 0) {
    return (
      <div className="fixed bottom-3 right-3 z-50 max-w-sm rounded-lg border border-rose-300 bg-white shadow-lg print:hidden" role="status">
        <div className="flex items-center gap-2 px-3 py-2">
          <CloudOff className="w-4 h-4 text-rose-600 shrink-0" />
          <span className="text-sm font-medium text-rose-700 flex-1">{pending.length} {t('pendingChanges')} — not saved</span>
          <Button size="sm" variant="outline" onClick={retry} disabled={retrying}>
            {retrying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />}<span className="ml-1">{t('retry')}</span>
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setOpen(!open)} aria-label="Details">
            {open ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </Button>
        </div>
        {open && (
          <div className="border-t px-3 py-2 space-y-1.5 max-h-56 overflow-y-auto">
            {pending.map((p) => (
              <div key={p.id} className="text-xs flex items-start gap-2">
                <div className="flex-1 min-w-0"><div className="font-medium truncate">{p.label}</div><div className="text-slate-500 truncate">{p.error}</div></div>
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removePending(p.id)} aria-label={t('discard')}><Trash2 className="w-3.5 h-3.5" /></Button>
              </div>
            ))}
            <Button size="sm" variant="ghost" className="text-rose-600 h-7 px-2" onClick={() => { if (confirm('Discard ALL unsaved changes?')) clearPending() }}>{t('discard')} all</Button>
          </div>
        )}
      </div>
    )
  }
  if (inflight > 0) {
    return (
      <div className="fixed bottom-3 right-3 z-50 flex items-center gap-2 rounded-full border bg-white px-3 py-1.5 text-xs shadow print:hidden" role="status">
        <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-600" /> {t('saving')}
      </div>
    )
  }
  if (lastSavedAt && Date.now() - lastSavedAt < 4000) {
    return (
      <div className="fixed bottom-3 right-3 z-50 flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-xs text-emerald-700 shadow print:hidden" role="status">
        <CheckCircle2 className="w-3.5 h-3.5" /> {t('saved')}
      </div>
    )
  }
  return null
}
