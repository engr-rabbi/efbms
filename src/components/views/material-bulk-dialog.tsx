import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Download, FileSpreadsheet, Loader2, Upload, CheckCircle2, XCircle, AlertTriangle, Copy, ArrowLeft } from 'lucide-react'
import { ensure, rows as repoRows } from '@/lib/backend/repo'
import { importMaterials, type DuplicateMode, type ImportReport } from '@/lib/backend/material-bulk'
import { buildPreview, KNOWN_CATEGORIES, templateCsv, errorReportCsv, MAX_FILE_BYTES, MAX_ROWS, type Preview, type PreviewRow } from '@/lib/material-csv'
import { downloadBlob } from '@/lib/export-utils'
import { useAppStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Checkbox } from '@/components/ui/checkbox'

type Filter = 'all' | 'ok' | 'warn' | 'error' | 'dup'
const BOM = '\uFEFF' // makes Excel open UTF-8 (Bengali) CSV correctly

const STATUS: Record<PreviewRow['status'], { label: string; cls: string }> = {
  ok: { label: 'Ready', cls: 'bg-emerald-100 text-emerald-800' },
  error: { label: 'Error', cls: 'bg-rose-100 text-rose-800' },
  'dup-file': { label: 'Duplicate in file', cls: 'bg-rose-100 text-rose-800' },
  'dup-existing': { label: 'Already exists', cls: 'bg-amber-100 text-amber-800' },
}

export function MaterialBulkDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const role = useAppStore((s) => s.user?.role ?? '')
  const canCreateSuppliers = role === 'SUPER_ADMIN' || role === 'INVENTORY'
  const input = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [duplicates, setDuplicates] = useState<DuplicateMode>('skip')
  const [createSuppliers, setCreateSuppliers] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<[number, number] | null>(null)
  const [report, setReport] = useState<ImportReport | null>(null)

  const reset = () => { setPreview(null); setReport(null); setFileName(''); setProgress(null); setFilter('all'); if (input.current) input.current.value = '' }
  const close = () => { if (busy) return; reset(); onClose() }

  const downloadTemplate = () => downloadBlob(BOM + templateCsv(), 'materials-template.csv', 'text/csv;charset=utf-8')

  const onFile = async (f: File | undefined) => {
    if (!f) return
    if (f.size > MAX_FILE_BYTES) { toast.error(`File is larger than ${MAX_FILE_BYTES / 1048576} MB`); return }
    if (!/\.(csv|txt)$/i.test(f.name)) { toast.error('Please choose a .csv file (in Excel: Save As → CSV UTF-8)'); return }
    setBusy(true)
    try {
      await ensure(['materials', 'suppliers'], { force: true })
      const text = await f.text()
      const existing = repoRows('materials').map((m) => ({ id: m.id, code: m.code, name: m.name, brand: m.brand, size: m.size, specification: m.specification }))
      const suppliers = repoRows('suppliers').map((s) => ({ id: s.id, name: s.name }))
      const cats = Array.from(new Set([...repoRows('materials').map((m) => m.category as string)]))
      setPreview(buildPreview(text, existing, suppliers, Array.from(new Set([...KNOWN_CATEGORIES, ...cats]))))
      setFileName(f.name); setFilter('all'); setReport(null)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not read the file') }
    finally { setBusy(false) }
  }

  const willImport = useMemo(() => {
    if (!preview) return 0
    return preview.counts.ok + (duplicates === 'update' ? preview.counts.dupExisting : 0)
  }, [preview, duplicates])
  const missingSuppliers = useMemo(() => {
    if (!preview) return [] as string[]
    return Array.from(new Set(preview.rows.filter((r) => (r.status === 'ok' || r.status === 'dup-existing') && r.data.supplierName && !r.data.supplierId).map((r) => r.data.supplierName)))
  }, [preview])

  const shown = useMemo(() => {
    if (!preview) return []
    return preview.rows.filter((r) =>
      filter === 'all' ? true : filter === 'ok' ? r.status === 'ok' : filter === 'error' ? r.status === 'error' || r.status === 'dup-file'
        : filter === 'dup' ? r.status === 'dup-existing' || r.status === 'dup-file' : r.warnings.length > 0)
  }, [preview, filter])

  const run = async () => {
    if (!preview || willImport === 0) return
    setBusy(true); setProgress([0, willImport])
    try {
      const rep = await importMaterials(preview.rows, { duplicates, createSuppliers: createSuppliers && canCreateSuppliers, onProgress: (d, t) => setProgress([d, t]) })
      setReport(rep)
      if (rep.failed.length === 0) toast.success(`${rep.created} added, ${rep.updated} updated`)
      else toast.warning(`${rep.created + rep.updated} saved, ${rep.failed.length} failed`)
      onDone()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Upload failed') }
    finally { setBusy(false) }
  }

  const c = preview?.counts
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close() }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5 text-emerald-600" />Bulk upload materials (CSV)</DialogTitle>
          <DialogDescription>Upload many materials at once. You always see a preview first — nothing is saved until you press “Import”.</DialogDescription>
        </DialogHeader>

        {/* ---------------- step 1: template + file ---------------- */}
        {!preview && !report && (
          <div className="space-y-4">
            <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-700">
              <li>Download the template and fill one material per row (keep the header row). Required: <b>code</b> and <b>name</b>.</li>
              <li>In Excel use <b>Save As → CSV UTF-8</b>, then choose the file below.</li>
              <li>Check the preview (errors, duplicates, warnings) and press <b>Import</b>.</li>
            </ol>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={downloadTemplate}><Download className="mr-1.5 h-4 w-4" />Download CSV template</Button>
              <input ref={input} type="file" accept=".csv,text/csv,text/plain" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
              <Button onClick={() => input.current?.click()} disabled={busy}>{busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />}Choose CSV file…</Button>
            </div>
            <div className="rounded-lg border bg-slate-50 p-3 text-xs text-slate-600">
              <div className="mb-1 font-semibold">Columns</div>
              <code className="break-words">code, name, category, brand, model, specification, size, unit, pack_size, pack_unit, supplier, purchase_price, selling_price, stock_qty, min_stock</code>
              <ul className="mt-2 list-disc space-y-0.5 pl-4">
                <li><b>supplier</b>: the supplier’s name exactly as in the Suppliers page (unknown names can be created automatically by an admin/inventory user).</li>
                <li>Numbers may contain commas, ৳ or Bengali digits. Maximum {MAX_ROWS} rows / {MAX_FILE_BYTES / 1048576} MB per file.</li>
                <li>Photos cannot be in a CSV: generic sample photos are attached automatically; add real photos later from the material card.</li>
              </ul>
            </div>
          </div>
        )}

        {/* ---------------- step 2: preview ---------------- */}
        {preview && !report && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Button variant="ghost" size="sm" onClick={reset} disabled={busy}><ArrowLeft className="mr-1 h-4 w-4" />Another file</Button>
              <span className="text-slate-500">{fileName}</span>
            </div>
            {preview.fatal ? (
              <div className="flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800"><XCircle className="mt-0.5 h-4 w-4 shrink-0" />{preview.fatal}</div>
            ) : (
              <>
                {preview.unknownColumns.length > 0 && <div className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">Ignored unknown column(s): {preview.unknownColumns.join(', ')}</div>}
                <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-5">
                  {[
                    { k: 'all', label: 'Rows', v: c!.total, cls: 'bg-slate-100' },
                    { k: 'ok', label: 'Ready', v: c!.ok, cls: 'bg-emerald-100 text-emerald-800' },
                    { k: 'warn', label: 'With warnings', v: c!.warnings, cls: 'bg-amber-100 text-amber-800' },
                    { k: 'dup', label: 'Duplicates', v: c!.dupExisting + c!.dupFile, cls: 'bg-orange-100 text-orange-800' },
                    { k: 'error', label: 'Errors', v: c!.error + c!.dupFile, cls: 'bg-rose-100 text-rose-800' },
                  ].map((x) => (
                    <button key={x.k} onClick={() => setFilter(x.k as Filter)} aria-pressed={filter === x.k}
                      className={`rounded-lg px-2 py-2 ${x.cls} ${filter === x.k ? 'ring-2 ring-slate-900/40' : ''}`}>
                      <div className="text-lg font-bold">{x.v}</div><div className="text-[11px]">{x.label}</div>
                    </button>
                  ))}
                </div>

                <div className="max-h-[320px] overflow-auto rounded-lg border">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-slate-50 text-slate-500">
                      <tr><th className="p-2 text-left">Line</th><th className="p-2 text-left">Status</th><th className="p-2 text-left">Code</th><th className="p-2 text-left">Name</th><th className="p-2 text-left">Category</th><th className="p-2 text-left">Unit</th><th className="p-2 text-right">Buy ৳</th><th className="p-2 text-right">Sell ৳</th><th className="p-2 text-left">Notes</th></tr>
                    </thead>
                    <tbody>
                      {shown.slice(0, 600).map((r) => (
                        <tr key={r.line} className="border-t align-top">
                          <td className="p-2 text-slate-500">{r.line}</td>
                          <td className="p-2"><Badge className={`${STATUS[r.status].cls} text-[10px]`} variant="secondary">{STATUS[r.status].label}</Badge></td>
                          <td className="p-2 font-mono">{r.data.code}</td>
                          <td className="p-2">{r.data.name}</td>
                          <td className="p-2">{r.data.category}</td>
                          <td className="p-2">{r.data.unit}</td>
                          <td className="p-2 text-right">{r.data.purchasePrice}</td>
                          <td className="p-2 text-right">{r.data.sellingPrice}</td>
                          <td className="p-2">
                            {r.errors.map((e) => <div key={e} className="text-rose-700">✗ {e}</div>)}
                            {r.warnings.map((w) => <div key={w} className="text-amber-700">⚠ {w}</div>)}
                          </td>
                        </tr>
                      ))}
                      {shown.length === 0 && <tr><td colSpan={9} className="p-6 text-center text-slate-500">No rows in this filter</td></tr>}
                    </tbody>
                  </table>
                  {shown.length > 600 && <div className="border-t p-2 text-center text-[11px] text-slate-500">Showing the first 600 of {shown.length} rows (all rows are still processed)</div>}
                </div>

                <div className="grid gap-3 rounded-lg border bg-slate-50 p-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold">Materials whose code already exists ({c!.dupExisting})</Label>
                    <RadioGroup value={duplicates} onValueChange={(v) => setDuplicates(v as DuplicateMode)} className="gap-1.5">
                      <div className="flex items-center gap-2"><RadioGroupItem value="skip" id="d-skip" /><Label htmlFor="d-skip" className="text-xs font-normal">Skip them (keep the library as it is)</Label></div>
                      <div className="flex items-center gap-2"><RadioGroupItem value="update" id="d-upd" /><Label htmlFor="d-upd" className="text-xs font-normal">Update them (details &amp; prices; price history is recorded; stock is not changed)</Label></div>
                    </RadioGroup>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold">Unknown suppliers ({missingSuppliers.length})</Label>
                    {missingSuppliers.length === 0 ? <p className="text-xs text-slate-500">All suppliers in the file are known.</p> : (
                      <>
                        <p className="text-xs text-slate-600">{missingSuppliers.slice(0, 5).join(', ')}{missingSuppliers.length > 5 ? '…' : ''}</p>
                        {canCreateSuppliers ? (
                          <div className="flex items-center gap-2"><Checkbox id="cs" checked={createSuppliers} onCheckedChange={(v) => setCreateSuppliers(v === true)} /><Label htmlFor="cs" className="text-xs font-normal">Create these suppliers automatically</Label></div>
                        ) : <p className="text-xs text-amber-700">Your role cannot create suppliers — these materials will be saved without a supplier.</p>}
                      </>
                    )}
                  </div>
                </div>
                {(c!.error + c!.dupFile) > 0 && (
                  <Button variant="outline" size="sm" onClick={() => downloadBlob(BOM + errorReportCsv(preview.rows), 'materials-errors.csv', 'text/csv;charset=utf-8')}>
                    <Copy className="mr-1.5 h-3.5 w-3.5" />Download the {c!.error + c!.dupFile} rejected row(s) with reasons
                  </Button>
                )}
              </>
            )}
          </div>
        )}

        {/* ---------------- step 3: result ---------------- */}
        {report && (
          <div className="space-y-3">
            <div className={`flex items-center gap-2 text-sm font-medium ${report.failed.length ? 'text-amber-700' : 'text-emerald-700'}`}>
              {report.failed.length ? <AlertTriangle className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
              {report.failed.length ? 'Finished with problems' : 'Upload complete'}
            </div>
            <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
              {[['Added', report.created], ['Updated', report.updated], ['Skipped', report.skipped], ['Failed', report.failed.length]].map(([l, v]) => (
                <div key={String(l)} className="rounded-lg bg-slate-100 px-2 py-2"><div className="text-lg font-bold">{v}</div><div className="text-[11px]">{l}</div></div>
              ))}
            </div>
            {report.suppliersCreated > 0 && <p className="text-xs text-slate-600">{report.suppliersCreated} new supplier(s) created.</p>}
            {report.failed.length > 0 && (
              <div className="max-h-40 overflow-auto rounded border border-rose-200 bg-rose-50 p-2 text-xs">
                {report.failed.map((f) => <div key={f.line}>Line {f.line} ({f.code}): {f.message}</div>)}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          {progress && busy && <span className="mr-auto flex items-center text-xs text-slate-500"><Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />Saving {progress[0]} / {progress[1]}…</span>}
          <Button variant="outline" onClick={close} disabled={busy}>{report ? 'Close' : 'Cancel'}</Button>
          {preview && !preview.fatal && !report && (
            <Button onClick={() => void run()} disabled={busy || willImport === 0} className="bg-emerald-600 text-white hover:bg-emerald-700">
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />}Import {willImport} material{willImport === 1 ? '' : 's'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
