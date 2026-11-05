
// Quotations view — list + creation wizard + detail pane + professional print.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Eye,
  FileSpreadsheet, FileText, GitBranch, Info, Loader2, Plus, Printer,
  RefreshCw, Trash2, TrendingUp,
} from 'lucide-react'
import { useApi, useAppStore, useT } from '@/lib/store'
import { exportCsv, exportExcel, fmtBDT } from '@/lib/export-utils'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { QuotationPrint } from './quotation-print'

/* ================= types ================= */

interface ProjectLite {
  id: string; code: string; name: string; clientName: string
  clientAddress: string; clientPhone: string; location: string
  status: string; isDemo: boolean
}

interface Quotation {
  id: string; projectId: string; quotationNo: string; quotationType: string
  revision: number; parentId: string; status: string; date: string; validUntil: string
  items: string; subtotal: number; discountType: 'FLAT' | 'PERCENT'; discountValue: number
  otherCharges: number; otherChargesLabel: string; vatPct: number; grandTotal: number
  totalCost: number; paymentTerms: string; deliveryTerms: string; terms: string
  notes: string; createdBy: string; createdAt: string
  project?: { name: string; code: string; clientName: string }
}

interface CompanyInfo {
  id: string; name: string; logoText: string; address: string; phone: string; email: string
  licenseNo: string; vatRegNo: string; quotationTerms: string; paymentTerms: string; deliveryTerms: string
}

interface BoqLineLite {
  key: string; itemNo: number; system: string; category: string; name: string; brand: string
  specification: string; size: string; unit: string; qtyFinal: number; modeMix: string
  unitSellingPrice: number; unitPurchasePrice: number; stockQty: number; shortage: number
}

interface BoqResp {
  lines: BoqLineLite[]
  totals: { purchaseCost: number; sellingTotal: number; profit: number; shortageCount: number; itemsCount: number }
  project: { id: string; name: string; code: string }
}

interface WizardRow {
  key: string; itemNo: number; category: string; system: string; name: string; brand: string
  specification: string; size: string; unit: string; qtyBoq: number; qty: string
  unitPrice: string; unitPurchasePrice: number; modeMix: string; stockQty: number
  shortage: number; checked: boolean
}

type QType = 'ELECTRICAL' | 'PLUMBING' | 'COMBINED'
type QStatus = 'DRAFT' | 'SENT' | 'APPROVED' | 'REJECTED' | 'REVISED' | 'EXPIRED'

/* ================= constants / helpers ================= */

const STATUSES: QStatus[] = ['DRAFT', 'SENT', 'APPROVED', 'REJECTED', 'REVISED', 'EXPIRED']

const STATUS_STYLES: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700 border-slate-300',
  SENT: 'bg-amber-100 text-amber-800 border-amber-300',
  APPROVED: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  REJECTED: 'bg-rose-100 text-rose-700 border-rose-300',
  REVISED: 'bg-violet-100 text-violet-700 border-violet-300',
  EXPIRED: 'bg-gray-100 text-gray-600 border-gray-300',
}

const TYPE_STYLES: Record<string, string> = {
  ELECTRICAL: 'bg-amber-50 text-amber-800 border-amber-200',
  PLUMBING: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  COMBINED: 'bg-slate-100 text-slate-800 border-slate-300',
}

const STEP_LABELS = ['Type & Items', 'Terms', 'Review & Create']

const SCROLLBAR =
  '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300'

const PRINT_CSS = `
@page { size: A4 portrait; margin: 10mm; }
@media print {
  body { background: #ffffff !important; }
  body.printing > *:not(.print-portal) { display: none !important; }
  .print-portal { display: block !important; background: #ffffff !important; }
  .print-portal, .print-portal * {
    -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important;
  }
  body * { visibility: hidden !important; }
  #quotation-print-area, #quotation-print-area * { visibility: visible !important; }
  #quotation-print-area {
    position: absolute !important; left: 0 !important; top: 0 !important;
    width: 100% !important; max-width: none !important;
    border: 0 !important; box-shadow: none !important; border-radius: 0 !important;
  }
  body.printing #quotation-print-area { position: static !important; padding: 0 !important; }
  .no-print { display: none !important; }
}
`

const round2 = (n: number) => Math.round(n * 100) / 100
const numOr = (v: string, fb = 0) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : fb
}
const todayStr = () => new Date().toISOString().slice(0, 10)
const addDaysStr = (days: number) => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}
const fmtDate = (iso: string) => {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return iso
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`
}
const parseItems = (raw: string) => {
  try {
    const arr = JSON.parse(raw) as Array<Record<string, unknown>>
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}
const isExpired = (q: Quotation) =>
  Boolean(q.validUntil) && q.validUntil < todayStr() && (q.status === 'DRAFT' || q.status === 'SENT')

/* ================= default export ================= */

export default function QuotationsView() {
  const t = useT()
  const api = useApi<unknown>()
  const user = useAppStore((s) => s.user)
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const canSeeProfit = user?.role !== 'VIEWER'

  /* ------- data state ------- */
  const [projects, setProjects] = useState<ProjectLite[]>([])
  const [company, setCompany] = useState<CompanyInfo | null>(null)
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [quotations, setQuotations] = useState<Quotation[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loadingProjects, setLoadingProjects] = useState(true)
  const [loadingQuotes, setLoadingQuotes] = useState(false)

  /* ------- wizard state ------- */
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [wizardType, setWizardType] = useState<QType>('COMBINED')
  const [boqLoading, setBoqLoading] = useState(false)
  const [boqError, setBoqError] = useState('')
  const [rows, setRows] = useState<WizardRow[]>([])
  const [creating, setCreating] = useState(false)
  const warnedKeys = useRef<Set<string>>(new Set())

  const [qDate, setQDate] = useState(todayStr())
  const [qValidUntil, setQValidUntil] = useState(addDaysStr(15))
  const [discountType, setDiscountType] = useState<'FLAT' | 'PERCENT'>('FLAT')
  const [discountValue, setDiscountValue] = useState('0')
  const [otherCharges, setOtherCharges] = useState('0')
  const [otherChargesLabel, setOtherChargesLabel] = useState('')
  const [vatPct, setVatPct] = useState('0')
  const [paymentTerms, setPaymentTerms] = useState('')
  const [deliveryTerms, setDeliveryTerms] = useState('')
  const [termsText, setTermsText] = useState('')
  const [notesText, setNotesText] = useState('')

  /* ------- confirm dialogs ------- */
  const [revFor, setRevFor] = useState<Quotation | null>(null)
  const [revBusy, setRevBusy] = useState(false)
  const [delFor, setDelFor] = useState<Quotation | null>(null)
  const [delBusy, setDelBusy] = useState(false)

  const selected = useMemo(
    () => quotations.find((q) => q.id === selectedId) ?? null,
    [quotations, selectedId],
  )

  /* ------- loaders ------- */

  const loadQuotations = useCallback(
    async (projectId: string) => {
      if (!projectId) return
      setLoadingQuotes(true)
      try {
        const d = await api(`/api/quotations?projectId=${encodeURIComponent(projectId)}`) as { quotations: Quotation[] }
        setQuotations(d.quotations ?? [])
      } catch (e) {
        toast.error((e as Error).message)
        setQuotations([])
      } finally {
        setLoadingQuotes(false)
      }
    },
    [api],
  )

  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoadingProjects(true)
      try {
        const [pd, cd] = await Promise.all([
          api('/api/projects') as Promise<{ projects: ProjectLite[] }>,
          api('/api/company') as Promise<{ company: CompanyInfo }>,
        ])
        if (!alive) return
        setProjects(pd.projects ?? [])
        setCompany(cd.company ?? null)
        const initial =
          activeProjectId && (pd.projects ?? []).some((p) => p.id === activeProjectId)
            ? activeProjectId
            : (pd.projects ?? [])[0]?.id ?? ''
        setSelectedProjectId(initial)
      } catch (e) {
        if (alive) toast.error((e as Error).message)
      } finally {
        if (alive) setLoadingProjects(false)
      }
    })()
    return () => { alive = false }
  }, [api, activeProjectId])

  useEffect(() => {
    if (selectedProjectId) {
      setSelectedId(null)
      void loadQuotations(selectedProjectId)
    }
  }, [selectedProjectId, loadQuotations])

  /* ------- stats ------- */

  const stats = useMemo(() => {
    const active = quotations.filter((q) => q.status !== 'REVISED')
    return {
      count: quotations.length,
      approved: quotations.filter((q) => q.status === 'APPROVED').length,
      totalValue: active.reduce((a, q) => a + q.grandTotal, 0),
      latest: quotations[0]?.status ?? null,
    }
  }, [quotations])

  /* ------- wizard derived ------- */

  const preview = useMemo(() => {
    const chosen = rows.filter((r) => r.checked)
    const subtotal = chosen.reduce((a, r) => a + numOr(r.qty) * numOr(r.unitPrice), 0)
    const dv = numOr(discountValue)
    const discount = discountType === 'PERCENT' ? (subtotal * dv) / 100 : dv
    const after = Math.max(0, subtotal - discount)
    const vat = (after * numOr(vatPct)) / 100
    const other = numOr(otherCharges)
    const grand = after + vat + other
    const cost = chosen.reduce((a, r) => a + numOr(r.qty) * r.unitPurchasePrice, 0)
    return { count: chosen.length, subtotal, discount, vat, other, grand, cost }
  }, [rows, discountType, discountValue, vatPct, otherCharges])

  /* ------- wizard actions ------- */

  const openWizard = useCallback(() => {
    setStep(0)
    setWizardType('COMBINED')
    setRows([])
    setBoqError('')
    warnedKeys.current = new Set()
    setQDate(todayStr())
    setQValidUntil(addDaysStr(15))
    setDiscountType('FLAT')
    setDiscountValue('0')
    setOtherCharges('0')
    setOtherChargesLabel('')
    setVatPct('0')
    setPaymentTerms(company?.paymentTerms ?? '')
    setDeliveryTerms(company?.deliveryTerms ?? '')
    setTermsText(company?.quotationTerms ?? '')
    setNotesText('')
    setOpen(true)
  }, [company])

  const loadBoqForType = useCallback(
    async (type: QType) => {
      if (!selectedProjectId) return
      setWizardType(type)
      setBoqLoading(true)
      setBoqError('')
      setRows([])
      try {
        const d = await api(`/api/boq/${selectedProjectId}?system=${type}`) as BoqResp
        const mapped: WizardRow[] = (d.lines ?? []).map((l) => ({
          key: l.key, itemNo: l.itemNo, category: l.category, system: l.system,
          name: l.name, brand: l.brand, specification: l.specification, size: l.size,
          unit: l.unit, qtyBoq: l.qtyFinal, qty: String(l.qtyFinal ?? 0),
          unitPrice: String(l.unitSellingPrice ?? 0), unitPurchasePrice: l.unitPurchasePrice ?? 0,
          modeMix: l.modeMix, stockQty: l.stockQty, shortage: l.shortage, checked: true,
        }))
        setRows(mapped)
        if (!mapped.length) {
          setBoqError(
            'No BOQ items found for this system. Run estimation first in the project\'s Estimation tab, then create the quotation.',
          )
        }
      } catch (e) {
        setBoqError((e as Error).message)
      } finally {
        setBoqLoading(false)
      }
    },
    [api, selectedProjectId],
  )

  const updateRow = (key: string, patch: Partial<WizardRow>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const onQtyChange = (r: WizardRow, v: string) => {
    if (!warnedKeys.current.has(r.key) && r.modeMix !== 'AUTO' && numOr(v) !== r.qtyBoq) {
      warnedKeys.current.add(r.key)
      toast.warning('Verified quantity edited', {
        description: `"${r.name}" qty came from drawing verification (${r.qtyBoq} ${r.unit}). Make sure the change is intended.`,
      })
    }
    updateRow(r.key, { qty: v })
  }

  const submitCreate = useCallback(async () => {
    if (!selectedProjectId) return
    const chosen = rows.filter((r) => r.checked && numOr(r.qty) > 0)
    if (!chosen.length) {
      toast.error('Select at least one item with a quantity')
      return
    }
    setCreating(true)
    try {
      const payload = {
        projectId: selectedProjectId,
        quotationType: wizardType,
        items: chosen.map((r) => ({
          name: r.name,
          specification: [r.brand, r.specification].filter(Boolean).join(' · '),
          size: r.size,
          unit: r.unit,
          qty: numOr(r.qty),
          unitPrice: numOr(r.unitPrice),
          lineTotal: round2(numOr(r.qty) * numOr(r.unitPrice)),
          totalCost: round2(numOr(r.qty) * r.unitPurchasePrice),
        })),
        date: qDate,
        validUntil: qValidUntil,
        discountType,
        discountValue: numOr(discountValue),
        otherCharges: numOr(otherCharges),
        otherChargesLabel: otherChargesLabel.trim(),
        vatPct: numOr(vatPct),
        paymentTerms,
        deliveryTerms,
        terms: termsText,
        notes: notesText,
        createdBy: user?.name || user?.email || 'system',
      }
      const d = await api('/api/quotations', {
        method: 'POST',
        body: JSON.stringify(payload),
      }) as { quotation?: Quotation }
      toast.success(`Quotation ${d.quotation?.quotationNo ?? ''} created`)
      setOpen(false)
      await loadQuotations(selectedProjectId)
      if (d.quotation) setSelectedId(d.quotation.id)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setCreating(false)
    }
  }, [
    api, selectedProjectId, rows, wizardType, qDate, qValidUntil, discountType, discountValue,
    otherCharges, otherChargesLabel, vatPct, paymentTerms, deliveryTerms, termsText, notesText,
    user, loadQuotations,
  ])

  /* ------- row actions ------- */

  const changeStatus = async (q: Quotation, status: string) => {
    try {
      const d = await api(`/api/quotations/${q.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }) as { quotation?: Quotation }
      if (d.quotation) {
        setQuotations((prev) => prev.map((x) => (x.id === q.id ? { ...x, status: d.quotation!.status } : x)))
      }
      toast.success(`${q.quotationNo} → ${status}`)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const createRevision = async () => {
    if (!revFor) return
    setRevBusy(true)
    try {
      const d = await api(`/api/quotations/${revFor.id}`, {
        method: 'POST',
        body: JSON.stringify({}),
      }) as { quotation?: Quotation }
      toast.success(`Revision ${d.quotation?.quotationNo ?? ''} created`)
      setRevFor(null)
      await loadQuotations(revFor.projectId)
      if (d.quotation) setSelectedId(d.quotation.id)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setRevBusy(false)
    }
  }

  const deleteQuotation = async () => {
    if (!delFor) return
    setDelBusy(true)
    try {
      await api(`/api/quotations/${delFor.id}`, { method: 'DELETE' })
      toast.success(`Quotation ${delFor.quotationNo} deleted`)
      if (selectedId === delFor.id) setSelectedId(null)
      setDelFor(null)
      await loadQuotations(delFor.projectId)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setDelBusy(false)
    }
  }

  /* ------- print ------- */

  const runPrint = useCallback(() => {
    const src = document.getElementById('quotation-print-area')
    if (!src) {
      toast.error('Open a quotation first, then print')
      return
    }
    const portal = document.createElement('div')
    portal.className = 'print-portal'
    portal.appendChild(src.cloneNode(true))
    document.body.appendChild(portal)
    document.body.classList.add('printing')
    let done = false
    const cleanup = () => {
      if (done) return
      done = true
      portal.remove()
      document.body.classList.remove('printing')
      window.removeEventListener('afterprint', cleanup)
    }
    window.addEventListener('afterprint', cleanup)
    window.setTimeout(cleanup, 60000) // safety net
    window.print()
  }, [])

  const printQuotationFor = (q: Quotation) => {
    if (selectedId === q.id) {
      runPrint()
      return
    }
    setSelectedId(q.id)
    window.setTimeout(() => runPrint(), 350) // allow render of detail pane
  }

  /* ------- export ------- */

  const itemRowsForExport = (q: Quotation) =>
    parseItems(q.items).map((it, i) => ({
      '#': i + 1,
      Item: String(it.name ?? ''),
      Specification: String(it.specification ?? ''),
      Size: String(it.size ?? ''),
      Unit: String(it.unit ?? ''),
      Qty: Number(it.qty ?? 0),
      'Unit Price (BDT)': Number(it.unitPrice ?? 0),
      'Line Total (BDT)': Number(it.lineTotal ?? 0),
    }))

  const exportItems = async (q: Quotation, kind: 'csv' | 'excel') => {
    const rws = itemRowsForExport(q)
    if (!rws.length) {
      toast.error('No items to export')
      return
    }
    const base = q.quotationNo.replace(/[^\w.-]+/g, '_')
    if (kind === 'csv') exportCsv(rws, `${base}-items.csv`)
    else await exportExcel(rws, `${base}-items.xlsx`, 'Quotation Items')
    toast.success(`Exported ${rws.length} items (${kind.toUpperCase()})`)
  }

  /* ------- derived ------- */

  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null
  const detailProject = selected
    ? (projects.find((p) => p.id === selected.projectId) ?? null)
    : null

  /* ================= render ================= */

  return (
    <div className="space-y-4">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      {/* header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{t('quotations')}</h1>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5" />
            {t('quotationNo')} flow: DRAFT → SENT → APPROVED / REJECTED · past valid-until shows Expired
          </p>
        </div>
        <Button onClick={openWizard} disabled={!selectedProjectId} className="shrink-0">
          <Plus className="mr-1.5 h-4 w-4" /> {t('newQuotation')}
        </Button>
      </div>

      {/* project selector + stats */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Card className="col-span-2 xl:col-span-1">
          <CardContent className="p-4">
            <Label className="text-[11px] text-muted-foreground">Project</Label>
            {loadingProjects ? (
              <Skeleton className="mt-2 h-8 w-full" />
            ) : (
              <Select
                value={selectedProjectId || undefined}
                onValueChange={(v) => setSelectedProjectId(v)}
              >
                <SelectTrigger className="mt-1 h-9 w-full" aria-label="Select project">
                  <SelectValue placeholder={projects.length ? 'Select project' : 'No projects'} />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.code} — {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </CardContent>
        </Card>

        <StatCard icon={<FileText className="h-4 w-4 text-slate-500" />} label="Total Quotations">
          {loadingQuotes ? <Skeleton className="h-6 w-10" /> : <span className="text-lg font-bold">{stats.count}</span>}
        </StatCard>
        <StatCard icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />} label={t('approvedQuotations')}>
          {loadingQuotes ? <Skeleton className="h-6 w-10" /> : <span className="text-lg font-bold">{stats.approved}</span>}
        </StatCard>
        <StatCard
          icon={<TrendingUp className="h-4 w-4 text-amber-600" />}
          label="Total Value (active)"
        >
          {loadingQuotes ? (
            <Skeleton className="h-6 w-20" />
          ) : (
            <span className="text-lg font-bold">৳ {fmtBDT(stats.totalValue)}</span>
          )}
        </StatCard>
      </div>

      {/* two-pane */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-5">
        {/* ---------- list pane ---------- */}
        <section className="no-print lg:col-span-2" aria-label="Quotation list">
          <Card>
            <CardContent className="p-0">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <h2 className="text-sm font-semibold">
                  {t('quotations')}{' '}
                  {!loadingQuotes && <span className="text-muted-foreground">({quotations.length})</span>}
                </h2>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label="Refresh quotations"
                  disabled={!selectedProjectId || loadingQuotes}
                  onClick={() => selectedProjectId && void loadQuotations(selectedProjectId)}
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', loadingQuotes && 'animate-spin')} />
                </Button>
              </div>

              {loadingQuotes ? (
                <div className="space-y-2 p-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : quotations.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
                  <FileText className="h-8 w-8 text-muted-foreground/50" />
                  <p className="text-sm font-medium">{t('noData')}</p>
                  <p className="text-xs text-muted-foreground">
                    {selectedProjectId
                      ? 'Create the first quotation from the project BOQ.'
                      : 'Select a project to view its quotations.'}
                  </p>
                </div>
              ) : (
                <div className={cn('overflow-x-auto', SCROLLBAR)}>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">{t('quotationNo')}</TableHead>
                        <TableHead className="text-xs">{t('date')}</TableHead>
                        <TableHead className="text-xs">{t('status')}</TableHead>
                        <TableHead className="text-right text-xs">{t('grandTotal')}</TableHead>
                        <TableHead className="text-right text-xs">{t('actions')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {quotations.map((q) => (
                        <TableRow
                          key={q.id}
                          className={cn('cursor-pointer', selectedId === q.id && 'bg-muted/60')}
                          onClick={() => setSelectedId(q.id)}
                        >
                          <TableCell className="py-2">
                            <div className="text-xs font-semibold">{q.quotationNo}</div>
                            <Badge
                              variant="outline"
                              className={cn('mt-0.5 px-1 py-0 text-[9px]', TYPE_STYLES[q.quotationType])}
                            >
                              {q.quotationType}
                            </Badge>
                          </TableCell>
                          <TableCell className="py-2 text-xs">
                            <div>{fmtDate(q.date)}</div>
                            <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                              <CalendarDays className="h-3 w-3" />
                              {fmtDate(q.validUntil)}
                              {isExpired(q) && (
                                <Badge variant="outline" className="ml-0.5 bg-gray-100 px-1 py-0 text-[8px] text-gray-500">
                                  EXP
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="py-2" onClick={(e) => e.stopPropagation()}>
                            <Select value={q.status} onValueChange={(v) => void changeStatus(q, v)}>
                              <SelectTrigger
                                aria-label={`Status of ${q.quotationNo}`}
                                className={cn('h-7 w-[108px] border px-2 text-[10px] font-semibold', STATUS_STYLES[q.status])}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {STATUSES.map((s) => (
                                  <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="py-2 text-right text-xs font-bold">
                            ৳ {fmtBDT(q.grandTotal)}
                          </TableCell>
                          <TableCell className="py-2" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-0.5">
                              <Button
                                variant="ghost" size="icon" className="h-7 w-7"
                                aria-label={`View ${q.quotationNo}`}
                                onClick={() => setSelectedId(q.id)}
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost" size="icon" className="h-7 w-7"
                                aria-label={`Print ${q.quotationNo}`}
                                onClick={() => printQuotationFor(q)}
                              >
                                <Printer className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost" size="icon" className="h-7 w-7"
                                aria-label={`Create revision of ${q.quotationNo}`}
                                onClick={() => setRevFor(q)}
                              >
                                <GitBranch className="h-3.5 w-3.5" />
                              </Button>
                              {q.status === 'DRAFT' ? (
                                <Button
                                  variant="ghost" size="icon"
                                  className="h-7 w-7 text-rose-600 hover:text-rose-700"
                                  aria-label={`Delete ${q.quotationNo}`}
                                  onClick={() => setDelFor(q)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        {/* ---------- detail pane ---------- */}
        <section className="lg:col-span-3" aria-label="Quotation detail">
          {!selected ? (
            <Card className="flex min-h-[320px] items-center justify-center">
              <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
                <Printer className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm font-medium">No quotation selected</p>
                <p className="max-w-xs text-xs text-muted-foreground">
                  Pick a quotation from the list to preview the client-ready document, print it, or export items.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {/* detail header */}
              <Card className="no-print">
                <CardContent className="p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-sm font-bold">{selected.quotationNo}</h2>
                        <Badge variant="outline" className={cn('px-1.5 text-[10px]', STATUS_STYLES[selected.status])}>
                          {selected.status}
                        </Badge>
                        <Badge variant="outline" className={cn('px-1.5 text-[10px]', TYPE_STYLES[selected.quotationType])}>
                          {selected.quotationType}
                        </Badge>
                        {isExpired(selected) && (
                          <Badge variant="outline" className="bg-gray-100 px-1.5 text-[10px] text-gray-500">
                            EXPIRED
                          </Badge>
                        )}
                        {selected.revision > 0 && (
                          <Badge variant="outline" className="bg-violet-50 px-1.5 text-[10px] text-violet-700">
                            R{selected.revision}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {selected.project?.name ?? detailProject?.name ?? ''} · {t('clientName')}: {selected.project?.clientName ?? detailProject?.clientName ?? '—'} · By {selected.createdBy || '—'}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button size="sm" className="h-8" onClick={runPrint}>
                        <Printer className="mr-1.5 h-3.5 w-3.5" /> {t('print')}
                      </Button>
                      <Button size="sm" variant="outline" className="h-8" onClick={() => void exportItems(selected, 'csv')}>
                        <FileText className="mr-1.5 h-3.5 w-3.5" /> {t('exportCsv')}
                      </Button>
                      <Button size="sm" variant="outline" className="h-8" onClick={() => void exportItems(selected, 'excel')}>
                        <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" /> {t('exportExcel')}
                      </Button>
                    </div>
                  </div>

                  {/* profit (hidden for VIEWER) */}
                  {canSeeProfit && (
                    <>
                      <Separator className="my-3" />
                      <div className="grid grid-cols-3 gap-3 text-center">
                        <div>
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('grandTotal')}</div>
                          <div className="mt-0.5 text-sm font-bold">৳ {fmtBDT(selected.grandTotal)}</div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('totalCost')}</div>
                          <div className="mt-0.5 text-sm font-semibold text-slate-600">৳ {fmtBDT(selected.totalCost)}</div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('profit')}</div>
                          <div
                            className={cn(
                              'mt-0.5 text-sm font-bold',
                              selected.grandTotal - selected.totalCost >= 0 ? 'text-emerald-700' : 'text-rose-600',
                            )}
                          >
                            ৳ {fmtBDT(selected.grandTotal - selected.totalCost)}
                            <span className="ml-1 text-[10px] font-medium text-muted-foreground">
                              ({selected.grandTotal > 0
                                ? (((selected.grandTotal - selected.totalCost) / selected.grandTotal) * 100).toFixed(1)
                                : '0.0'}%)
                            </span>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              {/* printable document */}
              <Card className="overflow-hidden">
                <CardContent className="max-h-[70vh] overflow-y-auto p-0 lg:max-h-[78vh]" >
                  <div id="quotation-print-area" className="bg-white">
                    <QuotationPrint
                      quotation={selected}
                      company={
                        company ?? {
                          id: '', name: 'ElectroFlow BMS', logoText: '', address: '', phone: '',
                          email: '', licenseNo: '', vatRegNo: '', quotationTerms: '',
                          paymentTerms: '', deliveryTerms: '',
                        }
                      }
                      project={{
                        name: detailProject?.name ?? selected.project?.name ?? '',
                        code: detailProject?.code ?? selected.project?.code ?? '',
                        clientName: detailProject?.clientName ?? selected.project?.clientName ?? '',
                        clientAddress: detailProject?.clientAddress ?? '',
                        clientPhone: detailProject?.clientPhone ?? '',
                        location: detailProject?.location ?? '',
                      }}
                    />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </section>
      </div>

      {/* ---------- creation wizard dialog ---------- */}
      <Dialog open={open} onOpenChange={(o) => !creating && setOpen(o)}>
        <DialogContent className="max-h-[92vh] w-[95vw] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('newQuotation')}</DialogTitle>
            <DialogDescription>
              Build a client quotation from the verified project BOQ — totals are computed on save.
            </DialogDescription>
            {/* step indicator */}
            <div className="mt-2 flex items-center gap-2">
              {STEP_LABELS.map((label, i) => (
                <div key={label} className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={i > 0 && rows.length === 0}
                    onClick={() => setStep(i)}
                    className={cn(
                      'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
                      i === step
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : i < step
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                          : 'border-slate-200 bg-slate-50 text-slate-500',
                    )}
                  >
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/20 text-[9px] font-bold">
                      {i + 1}
                    </span>
                    {label}
                  </button>
                  {i < STEP_LABELS.length - 1 && <ChevronRight className="h-3.5 w-3.5 text-slate-300" />}
                </div>
              ))}
            </div>
          </DialogHeader>

          {/* ----- step 1: type + items ----- */}
          {step === 0 && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                {(['ELECTRICAL', 'PLUMBING', 'COMBINED'] as QType[]).map((tp) => (
                  <button
                    key={tp}
                    type="button"
                    disabled={boqLoading}
                    onClick={() => void loadBoqForType(tp)}
                    className={cn(
                      'rounded-lg border px-3 py-2.5 text-center text-xs font-semibold transition-colors',
                      wizardType === tp
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400',
                    )}
                  >
                    {tp}
                  </button>
                ))}
              </div>

              {boqLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : boqError ? (
                <div className="flex items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <div>
                    <p className="text-xs font-semibold text-amber-800">{boqError}</p>
                    <p className="mt-1 text-[11px] text-amber-700">
                      Open the project → Estimation tab → run estimation to generate the BOQ, then come back here.
                    </p>
                  </div>
                </div>
              ) : rows.length > 0 ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
                      <span className="font-semibold text-slate-700">{rows.length} BOQ items</span>
                      <span className="text-slate-600">
                        Selling total: <b>৳ {fmtBDT(rows.reduce((a, r) => a + r.qtyBoq * numOr(r.unitPrice), 0))}</b>
                      </span>
                      {canSeeProfit && (
                        <span className="text-emerald-700">
                          Est. profit: <b>৳ {fmtBDT(rows.reduce((a, r) => a + (numOr(r.unitPrice) - r.unitPurchasePrice) * r.qtyBoq, 0))}</b>
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => setRows((p) => p.map((r) => ({ ...r, checked: true })))}>
                        All
                      </Button>
                      <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => setRows((p) => p.map((r) => ({ ...r, checked: false })))}>
                        None
                      </Button>
                    </div>
                  </div>

                  <div className={cn('max-h-72 overflow-y-auto rounded-lg border', SCROLLBAR)}>
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-slate-100 text-[10px] uppercase tracking-wide text-slate-600">
                        <tr>
                          <th className="w-8 px-2 py-2"></th>
                          <th className="px-2 py-2 text-left font-semibold">Material</th>
                          <th className="w-14 px-2 py-2 text-left font-semibold">Unit</th>
                          <th className="w-20 px-2 py-2 text-right font-semibold">Qty</th>
                          <th className="w-24 px-2 py-2 text-right font-semibold">Unit Price</th>
                          <th className="w-24 px-2 py-2 text-right font-semibold">Line Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.key} className="border-t border-slate-100 odd:bg-white even:bg-slate-50/60">
                            <td className="px-2 py-1.5">
                              <Checkbox
                                checked={r.checked}
                                onCheckedChange={(v) => updateRow(r.key, { checked: v === true })}
                                aria-label={`Include ${r.name}`}
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <div className="font-medium text-slate-800">{r.name}</div>
                              <div className="text-[10px] text-muted-foreground">
                                {[r.brand, r.specification, r.size].filter(Boolean).join(' · ')}
                                {r.shortage > 0 && (
                                  <span className="ml-1.5 font-semibold text-rose-600">short {r.shortage}</span>
                                )}
                              </div>
                            </td>
                            <td className="px-2 py-1.5 text-slate-600">{r.unit}</td>
                            <td className="px-2 py-1.5">
                              <Input
                                type="number" min={0} step="any"
                                className="h-7 w-20 text-right text-xs"
                                value={r.qty}
                                aria-label={`Quantity for ${r.name}`}
                                onChange={(e) => onQtyChange(r, e.target.value)}
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <Input
                                type="number" min={0} step="any"
                                className="h-7 w-24 text-right text-xs"
                                value={r.unitPrice}
                                aria-label={`Unit price for ${r.name}`}
                                onChange={(e) => updateRow(r.key, { unitPrice: e.target.value })}
                              />
                            </td>
                            <td className="px-2 py-1.5 text-right font-semibold">
                              {r.checked ? fmtBDT(numOr(r.qty) * numOr(r.unitPrice)) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <p className="py-6 text-center text-xs text-muted-foreground">Choose a quotation type to load BOQ items.</p>
              )}
            </div>
          )}

          {/* ----- step 2: terms ----- */}
          {step === 1 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs">{t('date')}</Label>
                <Input type="date" className="mt-1 h-9" value={qDate} onChange={(e) => setQDate(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">{t('validUntil')}</Label>
                <Input type="date" className="mt-1 h-9" value={qValidUntil} onChange={(e) => setQValidUntil(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">{t('discount')}</Label>
                  <Select value={discountType} onValueChange={(v) => setDiscountType(v as 'FLAT' | 'PERCENT')}>
                    <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FLAT">FLAT ৳</SelectItem>
                      <SelectItem value="PERCENT">PERCENT %</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Value</Label>
                  <Input type="number" min={0} step="any" className="mt-1 h-9" value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Other Charges (৳)</Label>
                  <Input type="number" min={0} step="any" className="mt-1 h-9" value={otherCharges} onChange={(e) => setOtherCharges(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Charges Label</Label>
                  <Input className="mt-1 h-9" placeholder="e.g. Transport & Installation" value={otherChargesLabel} onChange={(e) => setOtherChargesLabel(e.target.value)} />
                </div>
              </div>
              <div>
                <Label className="text-xs">{t('vat')}</Label>
                <Input type="number" min={0} step="any" className="mt-1 h-9" value={vatPct} onChange={(e) => setVatPct(e.target.value)} />
              </div>
              <div className="sm:col-span-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label className="text-xs">{t('paymentTerms')}</Label>
                  <Textarea className="mt-1 min-h-[64px] text-xs" value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">{t('deliveryTerms')}</Label>
                  <Textarea className="mt-1 min-h-[64px] text-xs" value={deliveryTerms} onChange={(e) => setDeliveryTerms(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">{t('termsConditions')}</Label>
                  <Textarea className="mt-1 min-h-[80px] text-xs" value={termsText} onChange={(e) => setTermsText(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">{t('notes')}</Label>
                  <Textarea className="mt-1 min-h-[80px] text-xs" value={notesText} onChange={(e) => setNotesText(e.target.value)} />
                </div>
              </div>
            </div>
          )}

          {/* ----- step 3: review ----- */}
          {step === 2 && (
            <div className="space-y-3">
              <div className="rounded-lg border bg-slate-50 p-4">
                <div className="space-y-1.5 text-xs">
                  <Row label={`${t('subtotal')} (${preview.count} items)`} value={`৳ ${fmtBDT(preview.subtotal)}`} />
                  <Row
                    label={`${t('discount')}${discountType === 'PERCENT' ? ` (${numOr(discountValue)}%)` : ''}`}
                    value={`− ৳ ${fmtBDT(preview.discount)}`}
                    muted
                  />
                  <Row label={`Other Charges${otherChargesLabel ? ` — ${otherChargesLabel}` : ''}`} value={`+ ৳ ${fmtBDT(preview.other)}`} muted />
                  <Row label={`${t('vat')} (${numOr(vatPct)}%)`} value={`+ ৳ ${fmtBDT(preview.vat)}`} muted />
                  <Separator className="my-2" />
                  <div className="flex items-center justify-between border-t-4 border-double border-slate-800 pt-2">
                    <span className="text-sm font-bold uppercase">{t('grandTotal')}</span>
                    <span className="text-base font-extrabold">৳ {fmtBDT(preview.grand)}</span>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-[11px] text-muted-foreground sm:grid-cols-4">
                <div><span className="font-medium text-slate-600">{t('date')}:</span> {fmtDate(qDate)}</div>
                <div><span className="font-medium text-slate-600">{t('validUntil')}:</span> {fmtDate(qValidUntil)}</div>
                <div><span className="font-medium text-slate-600">Type:</span> {wizardType}</div>
                <div><span className="font-medium text-slate-600">Project:</span> {selectedProject?.code ?? '—'}</div>
              </div>
              {canSeeProfit && (
                <p className="text-[11px] text-muted-foreground">
                  Est. cost ৳ {fmtBDT(preview.cost)} · Est. margin ৳ {fmtBDT(preview.grand - preview.cost)}
                </p>
              )}
              <p className="text-[11px] text-muted-foreground">
                A unique quotation number is assigned automatically; totals are recomputed server-side on save.
              </p>
            </div>
          )}

          <DialogFooter className="mt-2 gap-2 sm:gap-0">
            <Button variant="outline" disabled={creating} onClick={() => (step === 0 ? setOpen(false) : setStep((s) => s - 1))}>
              {step === 0 ? (
                <>{t('cancel')}</>
              ) : (
                <>
                  <ChevronLeft className="mr-1 h-3.5 w-3.5" /> Back
                </>
              )}
            </Button>
            {step < 2 ? (
              <Button disabled={step === 0 && rows.length === 0} onClick={() => setStep((s) => s + 1)}>
                Next <ChevronRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button onClick={() => void submitCreate()} disabled={creating || preview.count === 0}>
                {creating ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}
                Create Quotation
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- revision confirm ---------- */}
      <AlertDialog open={Boolean(revFor)} onOpenChange={(o) => !o && setRevFor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Create revision of {revFor?.quotationNo}?</AlertDialogTitle>
            <AlertDialogDescription>
              A new DRAFT copy ({revFor?.quotationNo}-R{revFor ? revFor.revision + 1 : ''}) will be created with the same
              items and terms. The current quotation will be marked REVISED.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revBusy}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-violet-600 hover:bg-violet-700"
              disabled={revBusy}
              onClick={(e) => { e.preventDefault(); void createRevision() }}
            >
              {revBusy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <GitBranch className="mr-1.5 h-4 w-4" />}
              Create Revision
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---------- delete confirm ---------- */}
      <AlertDialog open={Boolean(delFor)} onOpenChange={(o) => !o && setDelFor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('confirmDelete')}</AlertDialogTitle>
            <AlertDialogDescription>
              Quotation {delFor?.quotationNo} will be permanently removed. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={delBusy}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 hover:bg-rose-700"
              disabled={delBusy}
              onClick={(e) => { e.preventDefault(); void deleteQuotation() }}
            >
              {delBusy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Trash2 className="mr-1.5 h-4 w-4" />}
              {t('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/* ================= small pieces ================= */

function StatCard({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {icon}
          <span className="truncate">{label}</span>
        </div>
        <div className="mt-1.5">{children}</div>
      </CardContent>
    </Card>
  )
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={muted ? 'text-muted-foreground' : 'font-medium text-slate-700'}>{label}</span>
      <span className={muted ? 'text-slate-600' : 'font-semibold'}>{value}</span>
    </div>
  )
}
