
// Materials Library & Price Management view (Task 9-b, image cards 12-a)
import { SmartImg } from '@/components/common/smart-img'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MaterialBulkDialog } from '@/components/views/material-bulk-dialog'
import { resizeImageFile } from '@/components/views/material-image-manager'
import { toast } from 'sonner'
import {
  AlertTriangle, Boxes, Download, FileSpreadsheet, ImageIcon, Info,
  LayoutGrid, List, Package, PackageSearch, Pencil, Plus, Search, Trash2,
  Wallet, X, Upload, ImagePlus,
} from 'lucide-react'

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
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
import { Textarea } from '@/components/ui/textarea'
import { exportCsv, exportExcel, fmtBDT } from '@/lib/export-utils'
import { displayImage, type DisplayImage } from '@/lib/material-images'
import { useApi, useAppStore, useT } from '@/lib/store'
import { MaterialImageManager } from '@/components/views/material-image-manager'

// ------------------------------ types & constants ---------------------------

interface MaterialImage {
  id: string
  url: string
  isSample: boolean
  isPrimary: boolean
  caption?: string
}

interface Material {
  id: string
  code: string
  category: string
  name: string
  brand: string
  model: string
  specification: string
  size: string
  unit: string
  packSize: number
  packUnit: string
  supplierId: string
  purchasePrice: number
  sellingPrice: number
  stockQty: number
  minStock: number
  active: boolean
  updatedAt: string
  images?: MaterialImage[]
}

interface SupplierRow { id: string; name: string }

interface MaterialForm {
  code: string; category: string; name: string; brand: string; model: string
  specification: string; size: string; unit: string; packSize: string; packUnit: string
  supplierId: string; purchasePrice: string; sellingPrice: string; stockQty: string; minStock: string
}

const CATEGORIES = [
  'Cable', 'Conduit', 'Accessories', 'Protection', 'Distribution Board', 'Earthing',
  'Switch', 'Socket', 'Light', 'Fan', 'Pipe', 'Fitting', 'Valve', 'Consumable',
  'Sanitary', 'Equipment', 'Other',
]

const ELECTRICAL_CATEGORIES = new Set([
  'Cable', 'Conduit', 'Accessories', 'Protection', 'Distribution Board', 'Earthing',
  'Switch', 'Socket', 'Light', 'Fan',
])

const PLUMBING_CATEGORIES = new Set([
  'Pipe', 'Fitting', 'Valve', 'Consumable', 'Sanitary', 'Equipment',
])

const SAMPLE_WARNING = 'Generic type sample — not an actual brand product photo'

const CODE_PREFIX: Record<string, string> = {
  Cable: 'CBL', Conduit: 'CDT', Accessories: 'ACC', Protection: 'PRT',
  'Distribution Board': 'DB', Earthing: 'ERT', Switch: 'SW', Socket: 'SKT',
  Light: 'LT', Fan: 'FAN', Pipe: 'PIPE', Fitting: 'FIT', Valve: 'VLV',
  Consumable: 'CNS', Sanitary: 'SAN', Equipment: 'EQP', Other: 'GEN',
}

const EMPTY_FORM: MaterialForm = {
  code: '', category: 'Cable', name: '', brand: '', model: '', specification: '',
  size: '', unit: 'Pcs', packSize: '1', packUnit: 'Pcs', supplierId: '__none',
  purchasePrice: '0', sellingPrice: '0', stockQty: '0', minStock: '0',
}

const SCROLL_CLS =
  'max-h-[520px] overflow-y-auto overflow-x-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent'

const num = (s: string) => {
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

const fmtQty = (n: number) =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(n)

const marginPct = (m: Material) =>
  m.sellingPrice > 0 ? ((m.sellingPrice - m.purchasePrice) / m.sellingPrice) * 100 : 0

const photosTitle = (di: DisplayImage) =>
  di.hasUploaded
    ? `${di.uploadedCount} uploaded photo${di.uploadedCount > 1 ? 's' : ''} — click to manage`
    : di.sampleCount > 0
      ? `Sample photo attached (generic type illustration) — click to upload a real product photo`
      : 'No photo yet — click to upload a real product photo'

// ------------------------------ component -----------------------------------

export default function MaterialsView() {
  const t = useT()
  const user = useAppStore((s) => s.user)
  const isViewer = user?.role === 'VIEWER'
  // same roles the server allows to create materials
  const canCreate = user?.role === 'SUPER_ADMIN' || user?.role === 'ENGINEER' || user?.role === 'INVENTORY'

  const apiMaterials = useApi<{ materials: Material[] }>()
  const apiSuppliers = useApi<{ suppliers: SupplierRow[] }>()
  const apiMutate = useApi<{ material: Material }>()
  const apiImage = useApi<unknown>()
  const apiDelete = useApi<{ success: boolean }>()

  const [materials, setMaterials] = useState<Material[]>([])
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('__all')
  const [brandFilter, setBrandFilter] = useState('__all')
  const [typeFilter, setTypeFilter] = useState('__all') // __all | ELECTRICAL | PLUMBING
  const [specFilter, setSpecFilter] = useState('__all')
  const [viewMode, setViewMode] = useState<'cards' | 'list'>('cards')

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Material | null>(null)
  const [form, setForm] = useState<MaterialForm>(EMPTY_FORM)
  const [priceNote, setPriceNote] = useState('')
  const [deleting, setDeleting] = useState<Material | null>(null)
  const [managerMat, setManagerMat] = useState<Material | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [photo, setPhoto] = useState<{ file: File; preview: string } | null>(null)
  const photoInput = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [m, s] = await Promise.all([
        apiMaterials('/api/materials'),
        apiSuppliers('/api/suppliers'),
      ])
      setMaterials(m.materials)
      setSuppliers(s.suppliers)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [apiMaterials, apiSuppliers])

  useEffect(() => { void load() }, [load])

  const supplierMap = useMemo(
    () => new Map(suppliers.map((s) => [s.id, s.name])),
    [suppliers],
  )

  const allCategories = useMemo(
    () => Array.from(new Set([...CATEGORIES, ...materials.map((m) => m.category)])).sort(),
    [materials],
  )

  const brandOptions = useMemo(
    () => Array.from(new Set(materials.map((m) => m.brand).filter(Boolean))).sort(),
    [materials],
  )

  const specOptions = useMemo(
    () => Array.from(new Set(materials.map((m) => m.specification).filter(Boolean))).sort(),
    [materials],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return materials.filter((m) =>
      (categoryFilter === '__all' || m.category === categoryFilter) &&
      (typeFilter === '__all' ||
        (typeFilter === 'ELECTRICAL' && ELECTRICAL_CATEGORIES.has(m.category)) ||
        (typeFilter === 'PLUMBING' && PLUMBING_CATEGORIES.has(m.category))) &&
      (brandFilter === '__all' || m.brand === brandFilter) &&
      (specFilter === '__all' || m.specification === specFilter) &&
      (!q || [m.code, m.name, m.brand, m.model, m.specification, m.size]
        .some((v) => v.toLowerCase().includes(q))))
  }, [materials, search, categoryFilter, typeFilter, brandFilter, specFilter])

  const hasFilters =
    search.trim() !== '' || categoryFilter !== '__all' || typeFilter !== '__all' ||
    brandFilter !== '__all' || specFilter !== '__all'

  const clearFilters = () => {
    setSearch('')
    setCategoryFilter('__all')
    setTypeFilter('__all')
    setBrandFilter('__all')
    setSpecFilter('__all')
  }

  const stats = useMemo(() => ({
    total: materials.length,
    categories: new Set(materials.map((m) => m.category)).size,
    low: materials.filter((m) => m.stockQty <= m.minStock).length,
    value: materials.reduce((s, m) => s + m.stockQty * m.purchasePrice, 0),
  }), [materials])

  const priceChanged = !!editing &&
    (num(form.purchasePrice) !== editing.purchasePrice ||
      num(form.sellingPrice) !== editing.sellingPrice)

  const set = (k: keyof MaterialForm) => (v: string) =>
    setForm((f) => ({ ...f, [k]: v }))

  const suggestCode = useCallback((cat: string) => {
    const prefix = CODE_PREFIX[cat] ?? 'GEN'
    const count = materials.filter((m) => m.category === cat).length
    return `${prefix}-${String(count + 1).padStart(2, '0')}`
  }, [materials])

  const openAdd = () => {
    setEditing(null)
    setForm({ ...EMPTY_FORM, code: suggestCode('Cable') })
    setPriceNote('')
    setPhoto(null)
    setDialogOpen(true)
  }

  const openEdit = (m: Material) => {
    setEditing(m)
    setForm({
      code: m.code, category: m.category, name: m.name, brand: m.brand, model: m.model,
      specification: m.specification, size: m.size, unit: m.unit,
      packSize: String(m.packSize), packUnit: m.packUnit,
      supplierId: m.supplierId || '__none',
      purchasePrice: String(m.purchasePrice), sellingPrice: String(m.sellingPrice),
      stockQty: String(m.stockQty), minStock: String(m.minStock),
    })
    setPriceNote('')
    setPhoto(null)
    setDialogOpen(true)
  }

  const pickPhoto = (f: File | undefined) => {
    if (!f) return
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { toast.error('Photo must be JPG, PNG or WebP'); return }
    if (f.size > 12 * 1024 * 1024) { toast.error('Photo is too large (max 12 MB before resizing)'); return }
    setPhoto((old) => { if (old) URL.revokeObjectURL(old.preview); return { file: f, preview: URL.createObjectURL(f) } })
  }

  const submit = async () => {
    if (!form.code.trim() || !form.name.trim()) {
      toast.error('Code and name are required')
      return
    }
    setSaving(true)
    try {
      const body = {
        code: form.code.trim(), category: form.category, name: form.name.trim(),
        brand: form.brand.trim(), model: form.model.trim(),
        specification: form.specification.trim(), size: form.size.trim(),
        unit: form.unit.trim() || 'Pcs', packSize: num(form.packSize) || 1,
        packUnit: form.packUnit.trim() || 'Pcs',
        supplierId: form.supplierId === '__none' ? '' : form.supplierId,
        purchasePrice: num(form.purchasePrice), sellingPrice: num(form.sellingPrice),
        stockQty: num(form.stockQty), minStock: num(form.minStock),
      }
      if (editing) {
        await apiMutate(`/api/materials/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            ...body,
            ...(priceChanged ? { priceChangeNote: priceNote.trim() || 'Price update' } : {}),
            userName: user?.name ?? 'admin',
          }),
        })
        toast.success('Material updated')
      } else {
        const created = await apiMutate('/api/materials', { method: 'POST', body: JSON.stringify(body) })
        if (photo) {
          try {
            const url = await resizeImageFile(photo.file)
            await apiImage(`/api/materials/${created.material.id}/images`, { method: 'POST', body: JSON.stringify({ url, caption: body.name }) })
            toast.success('Material added with photo')
          } catch (pe) {
            toast.warning(`Material added, but the photo was not saved: ${(pe as Error).message}. Open the material card to add it again.`)
          }
        } else toast.success('Material added')
      }
      setDialogOpen(false)
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    try {
      await apiDelete(`/api/materials/${deleting.id}`, { method: 'DELETE' })
      toast.success('Material deleted')
      setDeleting(null)
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const exportRows = () => filtered.map((m) => ({
    Code: m.code, Category: m.category, Name: m.name, Brand: m.brand, Model: m.model,
    Specification: m.specification, Size: m.size, Unit: m.unit,
    'Pack Size': m.packSize, 'Pack Unit': m.packUnit,
    Supplier: supplierMap.get(m.supplierId) ?? '',
    'Purchase (BDT)': m.purchasePrice, 'Selling (BDT)': m.sellingPrice,
    'Margin %': Math.round(marginPct(m) * 10) / 10,
    Stock: m.stockQty, 'Min Stock': m.minStock,
  }))

  const onCsv = () => {
    if (!exportRows().length) { toast.error(t('noData')); return }
    exportCsv(exportRows(), 'materials.csv')
    toast.success(t('exportCsv'))
  }

  const onExcel = async () => {
    if (!exportRows().length) { toast.error(t('noData')); return }
    try {
      await exportExcel(exportRows(), 'materials.xlsx', 'Materials')
      toast.success(t('exportExcel'))
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  // ------------------------------ render helpers ----------------------------

  const stockCell = (m: Material) => (
    <div className="flex items-center gap-1.5">
      <span className="text-sm font-medium text-slate-700">{fmtQty(m.stockQty)}</span>
      {m.stockQty <= 0 ? (
        <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">OUT</Badge>
      ) : m.stockQty <= m.minStock ? (
        <Badge variant="outline" className="border-amber-200 bg-amber-100 px-1.5 py-0 text-[10px] text-amber-800">
          LOW
        </Badge>
      ) : null}
    </div>
  )

  const statCards = [
    { icon: Package, label: t('Total Materials'), value: String(stats.total), cls: 'bg-slate-100 text-slate-700' },
    { icon: Boxes, label: t('category'), value: String(stats.categories), cls: 'bg-amber-100 text-amber-700' },
    { icon: AlertTriangle, label: t('lowStock'), value: String(stats.low), cls: 'bg-rose-100 text-rose-600' },
    { icon: Wallet, label: t('Stock Value'), value: `৳${fmtBDT(stats.value)}`, cls: 'bg-emerald-100 text-emerald-700' },
  ]

  // ------------------------------ JSX ---------------------------------------

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
            <Package className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 sm:text-xl">{t('materialLibrary')}</h1>
            <p className="text-xs text-slate-500 sm:text-sm">{t('Price Management & Catalog')}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
          <Button variant="outline" size="sm" onClick={onCsv}>
            <Download className="h-4 w-4" /><span className="hidden sm:inline">CSV</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => void onExcel()}>
            <FileSpreadsheet className="h-4 w-4" /><span className="hidden sm:inline">Excel</span>
          </Button>
          {canCreate && (
            <Button variant="outline" size="sm" onClick={() => setBulkOpen(true)}>
              <Upload className="h-4 w-4" /><span className="hidden sm:inline">Bulk upload (CSV)</span>
            </Button>
          )}
          {canCreate && (
            <Button size="sm" onClick={openAdd}>
              <Plus className="h-4 w-4" />{t('Add Material')}
            </Button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {statCards.map((s) => (
          <Card key={s.label} className="border-slate-200 shadow-sm">
            <CardContent className="flex items-center gap-3 p-4">
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${s.cls}`}>
                <s.icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs text-slate-500">{s.label}</p>
                <p className="truncate text-base font-bold text-slate-900">{s.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`${t('search')} — code, name, brand, spec...`}
            className="pl-9"
            aria-label={t('search')}
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-full sm:w-56" aria-label={t('category')}>
            <SelectValue placeholder={t('category')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">{t('All categories')}</SelectItem>
            {allCategories.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Extra filters — brand / material type / specification */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Select value={brandFilter} onValueChange={setBrandFilter}>
          <SelectTrigger className="w-full sm:w-48" aria-label={t('brand')}>
            <SelectValue placeholder={t('brand')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">{t('All brands')}</SelectItem>
            {brandOptions.map((b) => (
              <SelectItem key={b} value={b}>{b}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-full sm:w-44" aria-label="Material type">
            <SelectValue placeholder="Material type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All types</SelectItem>
            <SelectItem value="ELECTRICAL">Electrical</SelectItem>
            <SelectItem value="PLUMBING">Plumbing</SelectItem>
          </SelectContent>
        </Select>
        <Select value={specFilter} onValueChange={setSpecFilter}>
          <SelectTrigger className="w-full sm:w-48" aria-label={t('specification')}>
            <SelectValue placeholder={t('specification')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">{t('All specifications')}</SelectItem>
            {specOptions.map((sp) => (
              <SelectItem key={sp} value={sp}>{sp}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hasFilters && (
          <Button variant="ghost" size="sm" className="h-9 text-slate-500 hover:text-slate-900" onClick={clearFilters}>
            <X className="h-4 w-4" />Clear filters
          </Button>
        )}
      </div>

      {/* Table */}
      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-slate-500">
              <PackageSearch className="h-10 w-10" />
              <p className="text-sm">{t('noData')}</p>
            </div>
          ) : viewMode === 'cards' ? (
            <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {filtered.map((m) => {
                const di = displayImage(m)
                return (
                  <Card key={m.id} className="group overflow-hidden border-slate-200 shadow-sm transition hover:shadow-md">
                    {/* Image area — click opens the Image Manager */}
                    <button
                      type="button"
                      className="relative block aspect-[4/3] w-full cursor-pointer overflow-hidden bg-slate-100"
                      title={photosTitle(di)}
                      aria-label={`Manage photos — ${m.name}`}
                      onClick={() => setManagerMat(m)}
                    >
                      {di.src && (
                        <>
                          <SmartImg
                            src={di.src} alt={m.name} loading="lazy"
                            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                          />
                        </>
                      )}
                      {di.isSample && (
                        <Badge
                          className="absolute left-2 top-2 border-amber-300 bg-amber-100/95 text-amber-800"
                          title={SAMPLE_WARNING}
                        >
                          <Info className="h-3 w-3" />Sample
                        </Badge>
                      )}
                      {di.uploadedCount > 1 && (
                        <Badge className="absolute right-2 top-2 border-transparent bg-slate-900/70 text-white">
                          {di.uploadedCount} photos
                        </Badge>
                      )}
                      {m.stockQty <= 0 && (
                        <Badge variant="destructive" className="absolute bottom-2 left-2">OUT</Badge>
                      )}
                    </button>

                    <CardContent className="space-y-2 p-4">
                      <p className="line-clamp-2 min-h-[2.5rem] text-sm font-semibold text-slate-800" title={m.name}>
                        {m.name}
                      </p>
                      <p
                        className="truncate text-xs text-slate-500"
                        title={[m.brand, m.model].filter(Boolean).join(' · ')}
                      >
                        {m.brand || m.model ? [m.brand, m.model].filter(Boolean).join(' · ') : '—'}
                      </p>
                      <p className="truncate text-xs text-slate-400" title={m.specification}>
                        {m.specification || '—'}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="secondary" className="text-[11px]">{m.category}</Badge>
                        {m.size && (
                          <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-600">
                            {m.size}
                          </span>
                        )}
                      </div>
                    </CardContent>

                    <div className="border-t border-slate-100 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-slate-900">৳{fmtBDT(m.sellingPrice)}</p>
                          <p className="truncate text-[11px] text-slate-400">Purchase ৳{fmtBDT(m.purchasePrice)}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {stockCell(m)}
                          <span className="text-[11px] text-slate-400">{m.unit}</span>
                        </div>
                      </div>
                      {!isViewer && (
                        <div className="mt-2.5 flex items-center justify-end gap-1 border-t border-dashed border-slate-100 pt-2">
                          <Button
                            variant="ghost" size="sm"
                            className="h-7 gap-1 px-1.5 text-slate-500 hover:text-slate-900"
                            title={photosTitle(di)}
                            aria-label={`Manage photos — ${m.name}`}
                            onClick={() => setManagerMat(m)}
                          >
                            <ImageIcon className="h-3.5 w-3.5" />
                            <span className="text-[10px]">{di.hasUploaded ? di.uploadedCount : 'S'}</span>
                          </Button>
                          <Button
                            variant="ghost" size="sm" aria-label={`${t('edit')} ${m.name}`}
                            className="h-7 w-7 p-0 text-slate-500 hover:text-slate-900"
                            onClick={() => openEdit(m)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost" size="sm" aria-label={`${t('delete')} ${m.name}`}
                            className="h-7 w-7 p-0 text-rose-500 hover:bg-rose-50 hover:text-rose-600"
                            onClick={() => setDeleting(m)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </Card>
                )
              })}
            </div>
          ) : (
            <div className={SCROLL_CLS}>
              <Table className="min-w-[1140px]">
                <TableHeader>
                  <TableRow className="bg-slate-50 hover:bg-slate-50">
                    <TableHead className="w-14 text-slate-600">Photo</TableHead>
                    <TableHead className="text-slate-600">{t('Code')}</TableHead>
                    <TableHead className="text-slate-600">{t('name')}</TableHead>
                    <TableHead className="hidden text-slate-600 md:table-cell">{t('brand')}</TableHead>
                    <TableHead className="hidden text-slate-600 md:table-cell">{t('Model')}</TableHead>
                    <TableHead className="text-slate-600">{t('category')}</TableHead>
                    <TableHead className="hidden text-slate-600 lg:table-cell">{t('Size')}</TableHead>
                    <TableHead className="text-slate-600">{t('unit')}</TableHead>
                    <TableHead className="hidden text-slate-600 lg:table-cell">{t('Pack')}</TableHead>
                    <TableHead className="text-right text-slate-600">{t('purchasePrice')}</TableHead>
                    <TableHead className="text-right text-slate-600">{t('sellingPrice')}</TableHead>
                    <TableHead className="text-slate-600">{t('stock')}</TableHead>
                    <TableHead className="hidden text-right text-slate-600 lg:table-cell">Margin</TableHead>
                    <TableHead className="hidden text-slate-600 xl:table-cell">{t('supplier')}</TableHead>
                    <TableHead className="text-right text-slate-600">{t('actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((m) => {
                    const di = displayImage(m)
                    return (
                      <TableRow key={m.id} className="hover:bg-slate-50/70">
                        <TableCell>
                          <button
                            type="button"
                            className="relative block h-10 w-10 overflow-hidden rounded-md border border-slate-200 bg-slate-100"
                            title={photosTitle(di)}
                            aria-label={`Manage photos — ${m.name}`}
                            onClick={() => setManagerMat(m)}
                          >
                            {di.src && (
                              <>
                                <SmartImg src={di.src} alt="" loading="lazy" className="h-full w-full object-cover" />
                              </>
                            )}
                            {di.isSample && (
                              <span className="absolute bottom-0 right-0 rounded-tl bg-amber-400 px-[3px] text-[8px] font-bold leading-[12px] text-amber-900">S</span>
                            )}
                          </button>
                        </TableCell>
                        <TableCell className="font-mono text-xs font-medium text-slate-700">{m.code}</TableCell>
                      <TableCell>
                        <p className="max-w-[220px] truncate font-medium text-slate-800">{m.name}</p>
                        {m.specification && (
                          <p className="max-w-[220px] truncate text-xs text-slate-400">{m.specification}</p>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-sm text-slate-600 md:table-cell">{m.brand || '—'}</TableCell>
                      <TableCell className="hidden max-w-[120px] truncate text-sm text-slate-600 md:table-cell">{m.model || '—'}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="max-w-[130px] truncate text-[11px]">{m.category}</Badge>
                      </TableCell>
                      <TableCell className="hidden text-sm text-slate-600 lg:table-cell">{m.size || '—'}</TableCell>
                      <TableCell className="text-sm text-slate-600">{m.unit}</TableCell>
                      <TableCell className="hidden text-xs text-slate-500 lg:table-cell">
                        {m.packSize > 0 ? `${fmtQty(m.packSize)} ${m.packUnit}` : '—'}
                      </TableCell>
                      <TableCell className="text-right text-sm text-slate-700">৳{fmtBDT(m.purchasePrice)}</TableCell>
                      <TableCell className="text-right text-sm text-slate-700">৳{fmtBDT(m.sellingPrice)}</TableCell>
                      <TableCell>{stockCell(m)}</TableCell>
                      <TableCell className="hidden text-right text-xs text-slate-500 lg:table-cell">
                        {marginPct(m).toFixed(1)}%
                      </TableCell>
                      <TableCell className="hidden max-w-[140px] truncate text-sm text-slate-600 xl:table-cell">
                        {m.supplierId ? supplierMap.get(m.supplierId) ?? '—' : '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          {isViewer ? (
                            <span className="text-xs text-slate-400">—</span>
                          ) : (
                            <>
                              <Button
                                variant="ghost" size="sm" aria-label={`${t('edit')} ${m.name}`}
                                className="h-8 w-8 p-0 text-slate-500 hover:text-slate-900"
                                onClick={() => openEdit(m)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost" size="sm" aria-label={`${t('delete')} ${m.name}`}
                                className="h-8 w-8 p-0 text-rose-500 hover:bg-rose-50 hover:text-rose-600"
                                onClick={() => setDeleting(m)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full">
          <DialogHeader>
            <DialogTitle>{editing ? `${t('edit')} — ${editing.name}` : t('Add Material')}</DialogTitle>
            <DialogDescription>
              {editing ? t('Update material details and prices') : t('Create a new material in the catalog')}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="m-code">{t('Code')} *</Label>
              <Input id="m-code" value={form.code} onChange={(e) => set('code')(e.target.value)} className="font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label>{t('category')}</Label>
              <Select
                value={form.category}
                onValueChange={(v) => setForm((f) => ({ ...f, category: v, ...(editing ? {} : { code: suggestCode(v) }) }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="m-name">{t('name')} *</Label>
              <Input id="m-name" value={form.name} onChange={(e) => set('name')(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-brand">{t('brand')}</Label>
              <Input id="m-brand" value={form.brand} onChange={(e) => set('brand')(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-model">{t('Model')}</Label>
              <Input id="m-model" value={form.model} onChange={(e) => set('model')(e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="m-spec">{t('specification')}</Label>
              <Input id="m-spec" value={form.specification} onChange={(e) => set('specification')(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-size">{t('Size')}</Label>
              <Input id="m-size" value={form.size} onChange={(e) => set('size')(e.target.value)} placeholder="e.g. 1/18, 2.5 sqmm" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-unit">{t('unit')}</Label>
              <Input id="m-unit" value={form.unit} onChange={(e) => set('unit')(e.target.value)} placeholder="Pcs / m / Box" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-packsize">{t('Pack Size')}</Label>
              <Input id="m-packsize" type="number" min={0} step="any" inputMode="decimal"
                value={form.packSize} onChange={(e) => set('packSize')(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-packunit">{t('Pack Unit')}</Label>
              <Input id="m-packunit" value={form.packUnit} onChange={(e) => set('packUnit')(e.target.value)} placeholder="Coil / Box / Pcs" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>{t('supplier')}</Label>
              <Select value={form.supplierId} onValueChange={set('supplierId')}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— {t('No supplier')} —</SelectItem>
                  {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-pp">{t('purchasePrice')} (৳)</Label>
              <Input id="m-pp" type="number" min={0} step="any" inputMode="decimal"
                value={form.purchasePrice} onChange={(e) => set('purchasePrice')(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-sp">{t('sellingPrice')} (৳)</Label>
              <Input id="m-sp" type="number" min={0} step="any" inputMode="decimal"
                value={form.sellingPrice} onChange={(e) => set('sellingPrice')(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-stock">{t('stock')}</Label>
              <Input id="m-stock" type="number" min={0} step="any" inputMode="decimal"
                value={form.stockQty} onChange={(e) => set('stockQty')(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-min">{t('minStock')}</Label>
              <Input id="m-min" type="number" min={0} step="any" inputMode="decimal"
                value={form.minStock} onChange={(e) => set('minStock')(e.target.value)} />
            </div>
          </div>

          {!editing && (
            <div className="space-y-2 rounded-lg border border-dashed border-slate-300 p-3">
              <Label className="flex items-center gap-1.5"><ImagePlus className="h-4 w-4 text-slate-500" />Material photo <span className="text-[11px] font-normal text-slate-400">(optional — JPG/PNG/WebP, saved to Google Drive)</span></Label>
              <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { pickPhoto(e.target.files?.[0]); e.target.value = '' }} />
              {photo ? (
                <div className="flex items-center gap-3">
                  <img src={photo.preview} alt="Selected material" className="h-20 w-20 rounded-lg border object-cover" />
                  <div className="text-xs text-slate-600"><div className="max-w-[220px] truncate font-medium">{photo.file.name}</div><div>{Math.round(photo.file.size / 1024)} KB — resized automatically</div></div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => photoInput.current?.click()}>Change</Button>
                  <Button type="button" variant="ghost" size="sm" className="text-rose-600" onClick={() => setPhoto((p) => { if (p) URL.revokeObjectURL(p.preview); return null })}>Remove</Button>
                </div>
              ) : (
                <Button type="button" variant="outline" size="sm" onClick={() => photoInput.current?.click()}><Upload className="mr-1.5 h-4 w-4" />Choose photo</Button>
              )}
              <p className="text-[11px] text-slate-500">Without a photo a generic sample picture of the material type is shown. More photos can be added later from the material card.</p>
            </div>
          )}

          {priceChanged && (
            <div className="space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <Label htmlFor="m-pnote" className="text-amber-800">{t('Price change note')}</Label>
              <Textarea
                id="m-pnote" rows={2} value={priceNote}
                onChange={(e) => setPriceNote(e.target.value)}
                placeholder={t('Reason for price change (recorded in price history)')}
              />
              <p className="text-[11px] text-amber-700">{t('History recorded automatically')}</p>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t('cancel')}</Button>
            <Button onClick={() => void submit()} disabled={saving}>
              {saving ? t('loading') : t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MaterialBulkDialog open={bulkOpen} onClose={() => setBulkOpen(false)} onDone={() => void load()} />

      {/* Delete confirm */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{`${t('delete')} — ${deleting?.name ?? ''}?`}</AlertDialogTitle>
            <AlertDialogDescription>{t('confirmDelete')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-700"
              onClick={() => void confirmDelete()}
            >
              {t('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Product image manager (Task 12-a) */}
      <MaterialImageManager
        material={managerMat}
        open={!!managerMat}
        onOpenChange={(o) => { if (!o) setManagerMat(null) }}
        onChanged={() => { void load() }}
      />
    </div>
  )
}
