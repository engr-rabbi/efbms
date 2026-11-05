import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { DatabaseBackup, History, ShieldCheck, ClipboardList, Upload, Loader2, RotateCcw, CheckCircle2, AlertTriangle, XCircle, PlayCircle } from 'lucide-react'
import { gasCall, resetRepo, resetDrawingState } from '@/lib/backend'
import { ensure, rows, invalidate, type Row } from '@/lib/backend/repo'
import { useSyncStore } from '@/lib/backend/sync-store'
import { clearFileCache } from '@/lib/backend/files'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface BackupStatus {
  lastSuccess: { id: string; at: string; status: string } | null
  lastError: { id: string; at: string; message: string } | null
  ageHours: number | null
  alert: 'NONE' | 'FAILED' | 'STALE' | 'NEVER' | 'PARTIAL'
  scheduled: boolean
  copyFiles: boolean
}
interface VerifyReport { id: string; ok: boolean; problems: string[]; files: { total: number; present: number; recoverableFromMirror: number; lost: number }; createdAt: string }
interface PrepareReport { verify: VerifyReport; confirmCode: string; currentCounts: Record<string, number> }
interface RestoreReport { restoredFrom: string; safetyBackupId: string; tables: Record<string, number>; filesRecoveredFromMirror: number; drawingsRewritten: number; filesMissing: Array<{ name: string }>; integrity: { ok: boolean; issues: unknown[] } }

const fmtDT = (s?: string) => (s ? new Date(s).toLocaleString() : '—')
const fmtSize = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)
const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Failed')

function StatusBadge({ s }: { s: string }) {
  const cls = s === 'SUCCESS' ? 'bg-emerald-100 text-emerald-800' : s === 'PARTIAL' ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800'
  return <Badge className={`${cls} text-[10px]`} variant="secondary">{s}</Badge>
}

// ====================================================================== backups
function BackupSection() {
  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [history, setHistory] = useState<Row[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [verify, setVerify] = useState<VerifyReport | null>(null)
  const [prep, setPrep] = useState<PrepareReport | null>(null)
  const [typed, setTyped] = useState('')
  const [code, setCode] = useState('')
  const [report, setReport] = useState<RestoreReport | null>(null)

  const load = useCallback(async () => {
    try {
      const [st] = await Promise.all([gasCall<BackupStatus>('backup.status'), ensure(['backups'], { force: true })])
      setStatus(st)
      setHistory([...rows('backups')].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)))
    } catch (e) { toast.error(errMsg(e)) }
  }, [])
  useEffect(() => { void load() }, [load])

  const runBackup = async () => {
    setBusy('backup')
    try {
      const r = await gasCall<{ backup: Row }>('backup.run', {}, { write: true, label: 'Manual backup', timeoutMs: 330_000, queue: false })
      toast[r.backup.status === 'SUCCESS' ? 'success' : 'warning'](`Backup ${r.backup.id}: ${r.backup.status}`)
    } catch (e) { toast.error(errMsg(e)) }
    finally { setBusy(null); invalidate(['backups']); await load() }
  }
  const doVerify = async (id: string) => {
    setBusy(id)
    try { setVerify(await gasCall<VerifyReport>('backup.verify', { id })) } catch (e) { toast.error(errMsg(e)) } finally { setBusy(null) }
  }
  const startRestore = async (id: string) => {
    setBusy(id); setTyped(''); setCode(''); setReport(null)
    try { setPrep(await gasCall<PrepareReport>('backup.restorePrepare', { id })) } catch (e) { toast.error(errMsg(e)) } finally { setBusy(null) }
  }
  const doRestore = async () => {
    if (!prep) return
    setBusy('restore')
    try {
      const r = await gasCall<RestoreReport>('backup.restore', { id: prep.verify.id, confirmCode: code, typed }, { write: true, label: 'Restore backup', timeoutMs: 330_000, queue: false })
      setReport(r); setPrep(null)
      resetRepo(); resetDrawingState(); clearFileCache(); useSyncStore.getState().bumpEpoch()
      toast.success('Restore completed')
    } catch (e) { toast.error(errMsg(e)) } finally { setBusy(null); await load() }
  }

  const alertInfo: Record<string, { title: string; text: string; cls: string }> = {
    FAILED: { title: 'Last backup FAILED', text: status?.lastError?.message ?? '', cls: 'border-rose-300 bg-rose-50' },
    STALE: { title: 'No successful backup for over 36 hours', text: 'Check that the daily trigger is installed (installTriggers) and the script is authorised.', cls: 'border-amber-300 bg-amber-50' },
    NEVER: { title: 'No backup has been made yet', text: 'Press “Backup now”, then install the daily trigger (see docs).', cls: 'border-amber-300 bg-amber-50' },
    PARTIAL: { title: 'Last backup is partial', text: 'Some Drive files are missing or not yet mirrored. Run the integrity check.', cls: 'border-amber-300 bg-amber-50' },
  }
  const a = status && alertInfo[status.alert]

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base flex items-center gap-2"><DatabaseBackup className="w-4 h-4 text-amber-600" />Backup &amp; restore</CardTitle>
          <CardDescription>All sheets + editable drawings → Drive › Database_Backups · uploaded files mirrored to Drive › System_Backups</CardDescription>
        </div>
        <Button onClick={runBackup} disabled={!!busy} className="bg-amber-500 hover:bg-amber-600 text-white shrink-0">
          {busy === 'backup' ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <PlayCircle className="w-4 h-4 mr-1.5" />}Backup now
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {a && (
          <Alert className={a.cls}><AlertTriangle className="w-4 h-4" /><AlertTitle>{a.title}</AlertTitle><AlertDescription>{a.text}</AlertDescription></Alert>
        )}
        <div className="grid sm:grid-cols-3 gap-3 text-sm">
          <div className="rounded-lg border p-3"><div className="text-[11px] text-slate-500">Last successful backup</div><div className="font-semibold">{status?.lastSuccess ? fmtDT(status.lastSuccess.at) : 'Never'}</div>{status?.ageHours != null && <div className="text-[11px] text-slate-500">{status.ageHours} h ago</div>}</div>
          <div className="rounded-lg border p-3"><div className="text-[11px] text-slate-500">Daily schedule</div><div className="font-semibold flex items-center gap-1">{status?.scheduled ? <><CheckCircle2 className="w-4 h-4 text-emerald-600" />Installed</> : <><XCircle className="w-4 h-4 text-rose-600" />Not installed</>}</div></div>
          <div className="rounded-lg border p-3"><div className="text-[11px] text-slate-500">File mirror copies</div><div className="font-semibold">{status?.copyFiles ? 'On' : 'Off'}</div></div>
        </div>

        <div className="rounded-lg border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] text-slate-500"><tr><th className="p-2 text-left">Backup ID</th><th className="p-2 text-left">Kind</th><th className="p-2 text-left">Status</th><th className="p-2 text-left">When</th><th className="p-2 text-right">Size</th><th className="p-2 text-right">Files</th><th className="p-2" /></tr></thead>
            <tbody>
              {history.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-slate-500">No backups yet</td></tr>}
              {history.map((b) => (
                <tr key={b.id} className="border-t align-top">
                  <td className="p-2 font-mono text-[11px]">{b.id}</td>
                  <td className="p-2 text-xs">{b.kind}</td>
                  <td className="p-2"><StatusBadge s={b.status} />{b.error && <div className="text-[10px] text-rose-600 max-w-[220px]">{b.error}</div>}</td>
                  <td className="p-2 text-xs">{fmtDT(b.finishedAt || b.startedAt)}<div className="text-[10px] text-slate-500">{b.createdBy}</div></td>
                  <td className="p-2 text-right text-xs">{b.sizeBytes ? fmtSize(b.sizeBytes) : '—'}</td>
                  <td className="p-2 text-right text-xs">{b.fileCount}{b.missingFiles > 0 && <span className="text-rose-600"> ({b.missingFiles} missing)</span>}</td>
                  <td className="p-2 text-right whitespace-nowrap">
                    {b.status !== 'FAILED' && <>
                      <Button size="sm" variant="outline" className="h-7 text-xs mr-1" disabled={!!busy} onClick={() => void doVerify(b.id)}>{busy === b.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3 mr-1" />}Verify</Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs text-rose-700" disabled={!!busy} onClick={() => void startRestore(b.id)}><RotateCcw className="w-3 h-3 mr-1" />Restore</Button>
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>

      <Dialog open={!!verify} onOpenChange={(o) => !o && setVerify(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2">{verify?.ok ? <CheckCircle2 className="w-5 h-5 text-emerald-600" /> : <AlertTriangle className="w-5 h-5 text-amber-600" />}Backup verification</DialogTitle><DialogDescription className="font-mono text-[11px]">{verify?.id}</DialogDescription></DialogHeader>
          {verify && <div className="text-sm space-y-1.5">
            <div>Created: {fmtDT(verify.createdAt)}</div>
            <div>Drive files present now: <b>{verify.files.present}</b> / {verify.files.total} · recoverable from mirror: <b>{verify.files.recoverableFromMirror}</b> · lost: <b className={verify.files.lost ? 'text-rose-600' : ''}>{verify.files.lost}</b></div>
            {verify.problems.length ? <ul className="list-disc pl-5 text-rose-600">{verify.problems.map((p) => <li key={p}>{p}</li>)}</ul> : <div className="text-emerald-700">Checksum, structure and row counts are consistent.</div>}
          </div>}
        </DialogContent>
      </Dialog>

      <Dialog open={!!prep} onOpenChange={(o) => !o && !busy && setPrep(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle className="text-rose-700">Restore this backup?</DialogTitle>
            <DialogDescription>Current data will be replaced by the backup from {fmtDT(prep?.verify.createdAt)}. A safety backup of the current data is created first.</DialogDescription></DialogHeader>
          {prep && <div className="space-y-3 text-sm">
            <div className="rounded-lg bg-slate-50 p-3 text-xs">Files: {prep.verify.files.present} present, {prep.verify.files.recoverableFromMirror} will be re-created from mirror copies, {prep.verify.files.lost} cannot be recovered.</div>
            <div className="text-xs">Confirmation code: <span className="font-mono text-base font-bold tracking-widest">{prep.confirmCode}</span></div>
            <Input placeholder="Type the confirmation code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
            <Input placeholder="Type RESTORE to confirm" value={typed} onChange={(e) => setTyped(e.target.value)} />
          </div>}
          <DialogFooter>
            <Button variant="outline" disabled={busy === 'restore'} onClick={() => setPrep(null)}>Cancel</Button>
            <Button className="bg-rose-600 hover:bg-rose-700 text-white" disabled={busy === 'restore' || typed !== 'RESTORE' || code.length < 6} onClick={() => void doRestore()}>
              {busy === 'restore' && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}Restore now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!report} onOpenChange={(o) => !o && setReport(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-emerald-600" />Restore completed</DialogTitle><DialogDescription>Safety backup of the previous state: <span className="font-mono">{report?.safetyBackupId}</span></DialogDescription></DialogHeader>
          {report && <div className="text-sm space-y-1.5">
            <div>Tables restored: {Object.keys(report.tables).length} · Drive files re-created: {report.filesRecoveredFromMirror} · drawings rewritten: {report.drawingsRewritten}</div>
            <div className={report.integrity.ok ? 'text-emerald-700' : 'text-rose-600'}>Relationship check: {report.integrity.ok ? 'all references intact' : `${report.integrity.issues.length} issue(s) — see Integrity check`}</div>
            {report.filesMissing.length > 0 && <div className="text-rose-600">Unrecoverable files: {report.filesMissing.map((f) => f.name).join(', ')}</div>}
          </div>}
        </DialogContent>
      </Dialog>
    </Card>
  )
}

// ====================================================================== integrity
interface IntegrityReport { ok: boolean; issues: Array<{ type: string; table: string; count: number; column?: string; refers?: string }>; counts: Record<string, number>; checkedAt: string }
function IntegritySection() {
  const [r, setR] = useState<IntegrityReport | null>(null)
  const [busy, setBusy] = useState(false)
  const run = async () => { setBusy(true); try { setR(await gasCall<IntegrityReport>('integrity.check', { deep: true }, { timeoutMs: 300_000 })) } catch (e) { toast.error(errMsg(e)) } finally { setBusy(false) } }
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div><CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-amber-600" />Integrity check</CardTitle><CardDescription>Verifies every relationship (project → floor → room → point), drawing/photo references and that each Drive file still exists.</CardDescription></div>
        <Button variant="outline" onClick={run} disabled={busy}>{busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <PlayCircle className="w-4 h-4 mr-1.5" />}Run</Button>
      </CardHeader>
      {r && <CardContent className="space-y-3">
        <div className={`flex items-center gap-2 text-sm font-medium ${r.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{r.ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}{r.ok ? 'Everything is consistent' : `${r.issues.length} problem(s) found`}</div>
        {r.issues.map((i, k) => <div key={k} className="text-xs rounded border border-rose-200 bg-rose-50 p-2">{i.type} — {i.table}{i.column ? `.${i.column}` : ''}{i.refers ? ` → ${i.refers}` : ''}: {i.count} row(s)</div>)}
        <div className="flex flex-wrap gap-1.5">{Object.entries(r.counts).map(([t, n]) => <Badge key={t} variant="outline" className="text-[10px]">{t}: {n}</Badge>)}</div>
      </CardContent>}
    </Card>
  )
}

// ====================================================================== audit log
function AuditSection() {
  const [list, setList] = useState<Row[] | null>(null)
  const [busy, setBusy] = useState(false)
  const load = async () => {
    setBusy(true)
    try { const d = await gasCall<{ tables: { auditLog: { rows: Row[] } } }>('db.sync', { tables: [{ t: 'auditLog', limit: 150 }] }); setList(d.tables.auditLog.rows) }
    catch (e) { toast.error(errMsg(e)) } finally { setBusy(false) }
  }
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div><CardTitle className="text-base flex items-center gap-2"><ClipboardList className="w-4 h-4 text-amber-600" />Audit log</CardTitle><CardDescription>Sign-ins, deletions, quotations, user changes, backups and restores (latest 150).</CardDescription></div>
        <Button variant="outline" onClick={load} disabled={busy}>{busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <History className="w-4 h-4 mr-1.5" />}{list ? 'Refresh' : 'Load'}</Button>
      </CardHeader>
      {list && <CardContent><div className="rounded-lg border overflow-x-auto max-h-96 overflow-y-auto"><table className="w-full text-xs">
        <thead className="bg-slate-50 sticky top-0 text-slate-500"><tr><th className="p-2 text-left">Time</th><th className="p-2 text-left">User</th><th className="p-2 text-left">Action</th><th className="p-2 text-left">Details</th></tr></thead>
        <tbody>{list.map((l) => <tr key={l.id} className="border-t"><td className="p-2 whitespace-nowrap">{fmtDT(l.createdAt)}</td><td className="p-2">{l.userName}</td><td className="p-2 font-mono text-[10px]">{l.action}</td><td className="p-2 text-slate-600">{l.entity} {l.details}</td></tr>)}</tbody></table></div></CardContent>}
    </Card>
  )
}

// ====================================================================== migration import
const IMPORT_ORDER = ['company', 'designRules', 'settings', 'suppliers', 'materials', 'materialImages', 'priceHistory', 'projects', 'floors', 'rooms', 'points', 'fixtures',
  'circuits', 'estimateItems', 'boqOverrides', 'drawings', 'quotations', 'purchaseOrders', 'stockMovements']
interface ImportResult { table: string; created: number; skipped: number; errors: Array<{ id: string; message: string }> }

function MigrationSection() {
  const [log, setLog] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [summary, setSummary] = useState<{ table: string; expected: number; created: number; skipped: number; errors: number }[] | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const run = async (file: File) => {
    setBusy(true); setLog([]); setSummary(null)
    const say = (m: string) => setLog((l) => [...l, m])
    try {
      const j = JSON.parse(await file.text()) as { format?: string; tables?: Record<string, Row[]> }
      if (j.format !== 'efbms-export-v1' || !j.tables) throw new Error('Not an efbms-export-v1 file (create it with scripts/export-sqlite.py)')
      // 0) safety: a backup of the current state before anything is written
      say('Creating safety backup…')
      try { await gasCall('backup.run', {}, { write: true, timeoutMs: 330_000, queue: false }); say('Safety backup OK') } catch (e) { throw new Error(`Safety backup failed, import aborted: ${errMsg(e)}`) }
      const sum: NonNullable<typeof summary> = []
      for (const table of IMPORT_ORDER) {
        const all = j.tables[table] ?? []
        if (!all.length) continue
        let created = 0, skipped = 0, errors = 0, i = 0
        while (i < all.length) {
          const chunk: Row[] = []; let size = 0
          while (i < all.length && chunk.length < 150 && size < 1_500_000) { size += JSON.stringify(all[i]).length; chunk.push(all[i++]) }
          const r = await gasCall<ImportResult>('migration.import', { table, rows: chunk }, { write: true, timeoutMs: 300_000, queue: false })
          created += r.created; skipped += r.skipped; errors += r.errors.length
          r.errors.slice(0, 3).forEach((e) => say(`  ✗ ${table} ${e.id}: ${e.message}`))
          say(`${table}: ${Math.min(i, all.length)}/${all.length}`)
        }
        sum.push({ table, expected: all.length, created, skipped, errors })
      }
      setSummary(sum)
      resetRepo(); resetDrawingState(); clearFileCache()
      say('Running integrity check…')
      const chk = await gasCall<IntegrityReport>('integrity.check', { deep: true }, { timeoutMs: 300_000 })
      say(chk.ok ? '✓ Relationships intact' : `✗ ${chk.issues.length} integrity problem(s)`)
      toast.success('Import finished')
    } catch (e) { toast.error(errMsg(e)); say(`✗ ${errMsg(e)}`) }
    finally { setBusy(false); if (input.current) input.current.value = '' }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Upload className="w-4 h-4 text-amber-600" />Data migration (import)</CardTitle>
        <CardDescription>Import the JSON file created from the old SQLite database (<code>scripts/export-sqlite.py</code>). Original IDs are kept, so relationships survive. Safe to re-run: existing records are skipped.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <input ref={input} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && void run(e.target.files[0])} />
        <Button variant="outline" disabled={busy} onClick={() => input.current?.click()}>{busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Upload className="w-4 h-4 mr-1.5" />}Choose export file…</Button>
        {log.length > 0 && <pre className="max-h-48 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] text-slate-100">{log.join('\n')}</pre>}
        {summary && <table className="w-full text-xs border rounded"><thead className="bg-slate-50 text-slate-500"><tr><th className="p-1.5 text-left">Table</th><th className="p-1.5 text-right">In file</th><th className="p-1.5 text-right">Created</th><th className="p-1.5 text-right">Skipped</th><th className="p-1.5 text-right">Errors</th></tr></thead>
          <tbody>{summary.map((s) => <tr key={s.table} className="border-t"><td className="p-1.5">{s.table}</td><td className="p-1.5 text-right">{s.expected}</td><td className="p-1.5 text-right">{s.created}</td><td className="p-1.5 text-right">{s.skipped}</td><td className={`p-1.5 text-right ${s.errors ? 'text-rose-600 font-bold' : ''}`}>{s.errors}</td></tr>)}</tbody></table>}
      </CardContent>
    </Card>
  )
}

export function AdminDataPanel() {
  return (
    <div className="space-y-4">
      <BackupSection />
      <IntegritySection />
      <AuditSection />
      <MigrationSection />
    </div>
  )
}
