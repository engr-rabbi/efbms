
// Inventory & Stock Movements view with low-stock alerts (Task 9-b, cards 12-a)
import { SmartImg } from '@/components/common/smart-img'
import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react'
import { toast } from 'sonner'
import {
  ArrowDownToLine, ArrowUpFromLine, Boxes, ClipboardList, Download,
  ImageIcon, Info, LayoutGrid, List, PackageSearch, RotateCcw, Trash2,
  TriangleAlert,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { exportCsv, fmtBDT } from '@/lib/export-utils'
import { displayImage } from '@/lib/material-images'
import { useApi, useAppStore, useT } from '@/lib/store'

// ------------------------------ types & constants ---------------------------

interface Material {
  id: string
  code: string
  category: string
  name: string
  unit: string
  brand?: string
  model?: string
  specification?: string
  size?: string
  purchasePrice: number
  stockQty: number
  minStock: number
  images?: Array<{ id: string; url: string; isSample: boolean; isPrimary: boolean; caption?: string }>
}

interface Movement {
  id: string
  type: string // IN | OUT | RETURN | WASTAGE
  quantity: number
  reference: string
  note: string
  userName: string
  createdAt: string
  material: { name: string; code: string; unit: string }
  project?: { name: string; code: string } | null
}

type MovementType = 'IN' | 'OUT' | 'RETURN' | 'WASTAGE'

const TYPE_BADGE: Record<string, string> = {
  IN: 'border-emerald-200 bg-emerald-100 text-emerald-800',
  OUT: 'border-rose-200 bg-rose-100 text-rose-700',
  RETURN: 'border-amber-200 bg-amber-100 text-amber-800',
  WASTAGE: 'border-slate-300 bg-slate-200 text-slate-700',
}

const TYPE_LABEL: Record<MovementType, string> = {
  IN: 'stockIn', OUT: 'stockOut', RETURN: 'return', WASTAGE: 'wastageEntry',
}

const MOVEMENT_TYPES: MovementType[] = ['IN', 'OUT', 'RETURN', 'WASTAGE']

const SCROLL_CLS =
  'max-h-[520px] overflow-y-auto overflow-x-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent'

const num = (s: string) => {
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

const fmtQty = (n: number) =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(n)

const fmtDateTime = (iso: string) => {
  try {
    const d = new Date(iso)
    return `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
  } catch {
    return '-'
  }
}

const SAMPLE_WARNING = 'Generic type sample — not an actual brand product photo'

function stockStatus(m: Material): { label: string; cls: string } {
  if (m.stockQty <= 0) return { label: 'OUT', cls: 'border-rose-200 bg-rose-100 text-rose-700' }
  if (m.stockQty <= m.minStock) return { label: 'LOW', cls: 'border-amber-200 bg-amber-100 text-amber-800' }
  return { label: 'OK', cls: 'border-emerald-200 bg-emerald-100 text-emerald-700' }
}

const suggestedReorder = (m: Material) => Math.max(m.minStock * 2 - m.stockQty, 0)

// ------------------------------ component -----------------------------------

export default function InventoryView() {
  const t = useT()
  const user = useAppStore((s) => s.user)
  const isViewer = user?.role === 'VIEWER'

  const apiStock = useApi<{ movements: Movement[]; materials: Material[]; lowStock: Material[] }>()
  const apiPost = useApi<{ success: boolean; stockQty: number }>()

  const [movements, setMovements] = useState<Movement[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [lowStock, setLowStock] = useState<Material[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState('overview')
  const [viewMode, setViewMode] = useState<'cards' | 'list'>('cards')

  // movement dialog state
  const [mvOpen, setMvOpen] = useState(false)
  const [mvType, setMvType] = useState<MovementType>('IN')
  const [mvMaterialId, setMvMaterialId] = useState('')
  const [mvQty, setMvQty] = useState('')
  const [mvRef, setMvRef] = useState('')
  const [mvNote, setMvNote] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiStock('/api/stock')
      setMovements(res.movements)
      setMaterials(res.materials)
      setLowStock(res.lowStock)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [apiStock])

  useEffect(() => { void load() }, [load])

  const openMv = (materialId: string, type: MovementType) => {
    setMvMaterialId(materialId)
    setMvType(type)
    setMvQty('')
    setMvRef('')
    setMvNote('')
    setMvOpen(true)
  }

  const submitMv = async () => {
    const q = num(mvQty)
    if (!mvMaterialId || q <= 0) {
      toast.error('Select material and enter a quantity greater than 0')
      return
    }
    setSaving(true)
    try {
      const res = await apiPost('/api/stock', {
        method: 'POST',
        body: JSON.stringify({
          materialId: mvMaterialId,
          type: mvType,
          quantity: q,
          reference: mvRef.trim(),
          note: mvNote.trim(),
          userName: user?.name ?? 'system',
        }),
      })
      toast.success(`${t('stock')}: ${fmtQty(res.stockQty)}`)
      setMvOpen(false)
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const onExport = () => {
    if (tab === 'overview') {
      if (!materials.length) { toast.error(t('noData')); return }
      exportCsv(materials.map((m) => {
        const st = stockStatus(m)
        return {
          Code: m.code, Material: m.name, Category: m.category, Unit: m.unit,
          Stock: m.stockQty, 'Min Stock': m.minStock, Status: st.label,
          'Purchase Price': m.purchasePrice, 'Stock Value': Math.round(m.stockQty * m.purchasePrice * 100) / 100,
        }
      }), 'stock-overview.csv')
    } else if (tab === 'movements') {
      if (!movements.length) { toast.error(t('noData')); return }
      exportCsv(movements.map((mv) => ({
        Date: fmtDateTime(mv.createdAt), Type: mv.type, Code: mv.material.code,
        Material: mv.material.name, Qty: mv.quantity, Unit: mv.material.unit,
        Reference: mv.reference, Note: mv.note,
        Project: mv.project?.code ?? '', User: mv.userName,
      })), 'stock-movements.csv')
    } else {
      if (!lowStock.length) { toast.error(t('noData')); return }
      exportCsv(lowStock.map((m) => ({
        Code: m.code, Material: m.name, Unit: m.unit, Stock: m.stockQty,
        'Min Stock': m.minStock, Shortfall: Math.max(m.minStock - m.stockQty, 0),
        'Suggested Reorder': suggestedReorder(m),
        'Est. Reorder Cost': Math.round(suggestedReorder(m) * m.purchasePrice * 100) / 100,
      })), 'low-stock.csv')
    }
    toast.success(t('exportCsv'))
  }

  // ------------------------------ table builders ----------------------------

  // Static photo thumbnail (display-only in Inventory — no manager here)
  const photoThumb = (m: Material) => {
    const di = displayImage(m)
    return (
      <div
        className="relative block h-10 w-10 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-100"
        title={di.isSample ? SAMPLE_WARNING : (di.hasUploaded ? 'Product photo' : 'No photo yet — generic sample shown')}
      >
        {di.src && (
          <>
            <SmartImg src={di.src} alt="" loading="lazy" className="h-full w-full object-cover" />
          </>
        )}
        {di.isSample && (
          <span className="absolute bottom-0 right-0 rounded-tl bg-amber-400 px-[3px] text-[8px] font-bold leading-[12px] text-amber-900">S</span>
        )}
      </div>
    )
  }

  const overviewTable = (
    <div className={SCROLL_CLS}>
      <Table className="min-w-[820px]">
        <TableHeader>
          <TableRow className="bg-slate-50 hover:bg-slate-50">
            <TableHead className="w-14 text-slate-600">Photo</TableHead>
            <TableHead className="text-slate-600">{t('name')}</TableHead>
            <TableHead className="hidden text-slate-600 sm:table-cell">{t('Code')}</TableHead>
            <TableHead className="text-slate-600">{t('unit')}</TableHead>
            <TableHead className="text-right text-slate-600">{t('stock')}</TableHead>
            <TableHead className="text-right text-slate-600">{t('minStock')}</TableHead>
            <TableHead className="text-slate-600">{t('status')}</TableHead>
            <TableHead className="text-right text-slate-600">{t('actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {materials.map((m) => {
            const st = stockStatus(m)
            return (
              <TableRow key={m.id} className="hover:bg-slate-50/70">
                <TableCell>{photoThumb(m)}</TableCell>
                <TableCell className="max-w-[200px] truncate text-sm font-medium text-slate-800">{m.name}</TableCell>
                <TableCell className="hidden font-mono text-xs text-slate-500 sm:table-cell">{m.code}</TableCell>
                <TableCell className="text-sm text-slate-600">{m.unit}</TableCell>
                <TableCell className="text-right text-sm font-semibold text-slate-800">{fmtQty(m.stockQty)}</TableCell>
                <TableCell className="text-right text-sm text-slate-500">{fmtQty(m.minStock)}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={`text-[11px] ${st.cls}`}>{st.label}</Badge>
                </TableCell>
                <TableCell>
                  {isViewer ? (
                    <div className="flex justify-end"><span className="text-xs text-slate-400">—</span></div>
                  ) : (
                    <div className="flex flex-wrap justify-end gap-1">
                      <Button variant="outline" size="sm" className="h-7 border-emerald-200 px-2 text-emerald-700 hover:bg-emerald-50"
                        title={t('stockIn')} aria-label={`${t('stockIn')} ${m.name}`} onClick={() => openMv(m.id, 'IN')}>
                        <ArrowDownToLine className="h-3 w-3" />
                      </Button>
                      <Button variant="outline" size="sm" className="h-7 border-rose-200 px-2 text-rose-600 hover:bg-rose-50"
                        title={t('stockOut')} aria-label={`${t('stockOut')} ${m.name}`} onClick={() => openMv(m.id, 'OUT')}>
                        <ArrowUpFromLine className="h-3 w-3" />
                      </Button>
                      <Button variant="outline" size="sm" className="h-7 border-amber-200 px-2 text-amber-700 hover:bg-amber-50"
                        title={t('return')} aria-label={`${t('return')} ${m.name}`} onClick={() => openMv(m.id, 'RETURN')}>
                        <RotateCcw className="h-3 w-3" />
                      </Button>
                      <Button variant="outline" size="sm" className="h-7 border-slate-300 px-2 text-slate-600 hover:bg-slate-100"
                        title={t('wastageEntry')} aria-label={`${t('wastageEntry')} ${m.name}`} onClick={() => openMv(m.id, 'WASTAGE')}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )

  // Image card grid for Stock Overview (Task 12-a)
  const stockCards = (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {materials.map((m) => {
        const st = stockStatus(m)
        const di = displayImage(m)
        return (
          <Card key={m.id} className="overflow-hidden border-slate-200 shadow-sm">
            <div className="relative aspect-[4/3] bg-slate-100">
              {di.src && (
                <>
                  <SmartImg src={di.src} alt={m.name} loading="lazy" className="h-full w-full object-cover" />
                </>
              )}
              {di.isSample && (
                <Badge className="absolute left-2 top-2 border-amber-300 bg-amber-100/95 text-amber-800" title={SAMPLE_WARNING}>
                  <Info className="h-3 w-3" />Sample
                </Badge>
              )}
              <Badge variant="outline" className={`absolute right-2 top-2 ${st.cls}`}>
                {st.label}
              </Badge>
            </div>
            <CardContent className="space-y-1.5 p-4">
              <p className="line-clamp-2 min-h-[2.5rem] text-sm font-semibold text-slate-800" title={m.name}>
                {m.name}
              </p>
              <p className="font-mono text-xs text-slate-400">{m.code}</p>
              <div className="flex items-baseline gap-1 pt-0.5">
                <p className="text-2xl font-bold leading-7 text-slate-900">{fmtQty(m.stockQty)}</p>
                <span className="text-xs text-slate-400">{m.unit}</span>
              </div>
              <p className="text-xs text-slate-500">{t('minStock')}: {fmtQty(m.minStock)} {m.unit}</p>
              <p className="text-xs text-slate-500">{t('purchasePrice')}: ৳{fmtBDT(m.purchasePrice)}</p>
              {!isViewer && (
                <div className="flex gap-1.5 pt-2">
                  <Button
                    variant="outline" size="sm"
                    className="h-7 flex-1 border-emerald-200 px-2 text-xs text-emerald-700 hover:bg-emerald-50"
                    title={t('stockIn')} aria-label={`${t('stockIn')} ${m.name}`}
                    onClick={() => openMv(m.id, 'IN')}
                  >
                    <ArrowDownToLine className="h-3 w-3" />{t('stockIn')}
                  </Button>
                  <Button
                    variant="outline" size="sm"
                    className="h-7 flex-1 border-rose-200 px-2 text-xs text-rose-600 hover:bg-rose-50"
                    title={t('stockOut')} aria-label={`${t('stockOut')} ${m.name}`}
                    onClick={() => openMv(m.id, 'OUT')}
                  >
                    <ArrowUpFromLine className="h-3 w-3" />{t('stockOut')}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )

  const movementsTable = (
    <div className={SCROLL_CLS}>
      <Table className="min-w-[880px]">
        <TableHeader>
          <TableRow className="bg-slate-50 hover:bg-slate-50">
            <TableHead className="text-slate-600">{t('date')}</TableHead>
            <TableHead className="text-slate-600">Type</TableHead>
            <TableHead className="text-slate-600">{t('name')}</TableHead>
            <TableHead className="text-right text-slate-600">{t('qty')}</TableHead>
            <TableHead className="hidden text-slate-600 sm:table-cell">Ref.</TableHead>
            <TableHead className="hidden text-slate-600 md:table-cell">{t('notes')}</TableHead>
            <TableHead className="hidden text-slate-600 lg:table-cell">{t('projects')}</TableHead>
            <TableHead className="hidden text-slate-600 sm:table-cell">User</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {movements.map((mv) => (
            <TableRow key={mv.id} className="hover:bg-slate-50/70">
              <TableCell className="whitespace-nowrap text-xs text-slate-500">{fmtDateTime(mv.createdAt)}</TableCell>
              <TableCell>
                <Badge variant="outline" className={`text-[11px] ${TYPE_BADGE[mv.type] ?? ''}`}>
                  {t(TYPE_LABEL[mv.type as MovementType] ?? mv.type)}
                </Badge>
              </TableCell>
              <TableCell>
                <p className="max-w-[200px] truncate text-sm font-medium text-slate-800">{mv.material.name}</p>
                <p className="font-mono text-[11px] text-slate-400">{mv.material.code}</p>
              </TableCell>
              <TableCell className="text-right text-sm font-medium text-slate-700">
                {mv.type === 'IN' || mv.type === 'RETURN' ? '+' : '−'}{fmtQty(mv.quantity)}
                <span className="ml-1 text-xs text-slate-400">{mv.material.unit}</span>
              </TableCell>
              <TableCell className="hidden max-w-[140px] truncate text-sm text-slate-600 sm:table-cell">{mv.reference || '—'}</TableCell>
              <TableCell className="hidden max-w-[180px] truncate text-sm text-slate-600 md:table-cell">{mv.note || '—'}</TableCell>
              <TableCell className="hidden max-w-[140px] truncate text-sm text-slate-600 lg:table-cell">
                {mv.project ? `${mv.project.code} · ${mv.project.name}` : '—'}
              </TableCell>
              <TableCell className="hidden text-sm text-slate-600 sm:table-cell">{mv.userName || '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )

  const lowStockTable = (
    <div className={SCROLL_CLS}>
      <Table className="min-w-[880px]">
        <TableHeader>
          <TableRow className="bg-slate-50 hover:bg-slate-50">
            <TableHead className="w-14 text-slate-600">Photo</TableHead>
            <TableHead className="text-slate-600">{t('name')}</TableHead>
            <TableHead className="hidden text-slate-600 sm:table-cell">{t('Code')}</TableHead>
            <TableHead className="text-slate-600">{t('unit')}</TableHead>
            <TableHead className="text-right text-slate-600">{t('stock')}</TableHead>
            <TableHead className="text-right text-slate-600">{t('minStock')}</TableHead>
            <TableHead className="text-right text-slate-600">{t('Reorder Qty')}</TableHead>
            <TableHead className="text-right text-slate-600">{t('Est. Cost')}</TableHead>
            {!isViewer && <TableHead className="text-right text-slate-600">{t('actions')}</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {lowStock.map((m) => (
            <TableRow key={m.id} className="hover:bg-amber-50/50">
              <TableCell>{photoThumb(m)}</TableCell>
              <TableCell className="max-w-[200px] truncate text-sm font-medium text-slate-800">{m.name}</TableCell>
              <TableCell className="hidden font-mono text-xs text-slate-500 sm:table-cell">{m.code}</TableCell>
              <TableCell className="text-sm text-slate-600">{m.unit}</TableCell>
              <TableCell className="text-right text-sm font-semibold text-rose-600">{fmtQty(m.stockQty)}</TableCell>
              <TableCell className="text-right text-sm text-slate-600">{fmtQty(m.minStock)}</TableCell>
              <TableCell className="text-right text-sm font-medium text-amber-700">{fmtQty(suggestedReorder(m))}</TableCell>
              <TableCell className="text-right text-sm text-slate-700">৳{fmtBDT(suggestedReorder(m) * m.purchasePrice)}</TableCell>
              {!isViewer && (
                <TableCell className="text-right">
                  <Button variant="outline" size="sm" className="h-7 border-emerald-200 px-2 text-emerald-700 hover:bg-emerald-50"
                    onClick={() => openMv(m.id, 'IN')}>
                    <ArrowDownToLine className="h-3 w-3" />{t('stockIn')}
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )

  const emptyBox = (icon: ComponentType<{ className?: string }>, text: string) => {
    const Ico = icon
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-slate-500">
        <Ico className="h-10 w-10" />
        <p className="text-sm">{text}</p>
      </div>
    )
  }

  // ------------------------------ JSX ---------------------------------------

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
            <Boxes className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 sm:text-xl">{t('inventory')}</h1>
            <p className="text-xs text-slate-500 sm:text-sm">{t('Stock overview, movements & reorder alerts')}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={onExport}>
            <Download className="h-4 w-4" /><span className="hidden sm:inline">{t('exportCsv')}</span>
          </Button>
          {!isViewer && (
            <Button size="sm" onClick={() => openMv(materials[0]?.id ?? '', 'IN')} disabled={materials.length === 0}>
              <ClipboardList className="h-4 w-4" />{t('New Movement')}
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : (
        <Tabs value={tab} onValueChange={setTab} className="gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <TabsList className="h-auto flex-wrap justify-start gap-1 bg-slate-100 p-1">
              <TabsTrigger value="overview" className="text-xs sm:text-sm">{t('Stock Overview')}</TabsTrigger>
              <TabsTrigger value="movements" className="text-xs sm:text-sm">
                {t('movements')}
                <Badge variant="secondary" className="ml-1 px-1.5 text-[10px]">{movements.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="lowstock" className="text-xs sm:text-sm">
                {t('Low Stock')}
                {lowStock.length > 0 && (
                  <Badge variant="outline" className="ml-1 border-amber-200 bg-amber-100 px-1.5 text-[10px] text-amber-800">
                    {lowStock.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
            {tab === 'overview' && materials.length > 0 && (
              <div className="flex items-center rounded-lg border border-slate-200 bg-slate-100 p-0.5" role="group" aria-label="View mode">
                <button
                  type="button" title="Card view" aria-pressed={viewMode === 'cards'}
                  aria-label="Card view"
                  className={`flex h-7 w-7 items-center justify-center rounded-md transition ${
                    viewMode === 'cards' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                  onClick={() => setViewMode('cards')}
                >
                  <LayoutGrid className="h-4 w-4" />
                </button>
                <button
                  type="button" title="List view" aria-pressed={viewMode === 'list'}
                  aria-label="List view"
                  className={`flex h-7 w-7 items-center justify-center rounded-md transition ${
                    viewMode === 'list' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                  onClick={() => setViewMode('list')}
                >
                  <List className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>

          <TabsContent value="overview" className="space-y-3">
            {materials.length === 0 ? (
              <Card className="border-slate-200 shadow-sm">
                <CardContent className="p-0">
                  {emptyBox(PackageSearch, t('noData'))}
                </CardContent>
              </Card>
            ) : viewMode === 'cards' ? (
              stockCards
            ) : (
              <Card className="border-slate-200 shadow-sm">
                <CardContent className="p-0">
                  {overviewTable}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="movements" className="space-y-3">
            <Card className="border-slate-200 shadow-sm">
              <CardContent className="p-0">
                {movements.length === 0
                  ? emptyBox(ClipboardList, t('noData'))
                  : movementsTable}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="lowstock" className="space-y-3">
            {lowStock.length > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <p>{t('Low stock alert — suggested reorder qty = 2 × min stock − current stock.')}</p>
              </div>
            )}
            <Card className="border-slate-200 shadow-sm">
              <CardContent className="p-0">
                {lowStock.length === 0
                  ? emptyBox(PackageSearch, t('All materials sufficiently stocked'))
                  : lowStockTable}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      {/* Movement dialog */}
      <Dialog open={mvOpen} onOpenChange={setMvOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full">
          <DialogHeader>
            <DialogTitle>{t(TYPE_LABEL[mvType])}</DialogTitle>
            <DialogDescription>{t('Record a stock movement — stock is updated instantly')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t('Movement Type')}</Label>
              <Select value={mvType} onValueChange={(v) => setMvType(v as MovementType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MOVEMENT_TYPES.map((tp) => (
                    <SelectItem key={tp} value={tp}>{t(TYPE_LABEL[tp])}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t('Material')} *</Label>
              <Select value={mvMaterialId || undefined} onValueChange={setMvMaterialId}>
                <SelectTrigger><SelectValue placeholder={t('Select material')} /></SelectTrigger>
                <SelectContent>
                  {materials.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name} ({m.code}) — {fmtQty(m.stockQty)} {m.unit}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="mv-qty">{t('qty')} *</Label>
                <Input id="mv-qty" type="number" min={0} step="any" inputMode="decimal"
                  value={mvQty} onChange={(e) => setMvQty(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mv-ref">{t('Reference')}</Label>
                <Input id="mv-ref" value={mvRef} onChange={(e) => setMvRef(e.target.value)}
                  placeholder={t('chalan / invoice no.')} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mv-note">{t('notes')}</Label>
              <Textarea id="mv-note" rows={2} value={mvNote} onChange={(e) => setMvNote(e.target.value)} />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setMvOpen(false)}>{t('cancel')}</Button>
            <Button onClick={() => void submitMv()} disabled={saving}>
              {saving ? t('loading') : t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
