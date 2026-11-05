
// Supplier Management view (Task 9-b)
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  Download, Mail, MapPin, Pencil, Phone, Plus, Scale, Trash2, Truck, User, Users,
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
import { exportCsv, fmtBDT } from '@/lib/export-utils'
import { useApi, useAppStore, useT } from '@/lib/store'

// ------------------------------ types ---------------------------------------

interface Supplier {
  id: string
  name: string
  contactPerson: string
  phone: string
  email: string
  address: string
  notes: string
  createdAt: string
  materialCount: number
}

interface SupplierForm {
  name: string; contactPerson: string; phone: string; email: string; address: string; notes: string
}

interface MaterialLite {
  id: string; category: string; name: string; brand: string; size: string; unit: string
  purchasePrice: number; sellingPrice: number; supplierId: string
}

const EMPTY_FORM: SupplierForm = {
  name: '', contactPerson: '', phone: '', email: '', address: '', notes: '',
}

const SCROLL_CLS =
  'max-h-[520px] overflow-y-auto overflow-x-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent'

// ------------------------------ component -----------------------------------

export default function SuppliersView() {
  const t = useT()
  const user = useAppStore((s) => s.user)
  const isViewer = user?.role === 'VIEWER'

  const apiSuppliers = useApi<{ suppliers: Supplier[] }>()
  const apiMaterials = useApi<{ materials: MaterialLite[] }>()
  const apiMutate = useApi<{ supplier: Supplier }>()
  const apiDelete = useApi<{ success: boolean }>()

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [materials, setMaterials] = useState<MaterialLite[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Supplier | null>(null)
  const [form, setForm] = useState<SupplierForm>(EMPTY_FORM)
  const [deleting, setDeleting] = useState<Supplier | null>(null)

  const [compareOpen, setCompareOpen] = useState(false)
  const [cmpCategory, setCmpCategory] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [s, m] = await Promise.all([
        apiSuppliers('/api/suppliers'),
        apiMaterials('/api/materials'),
      ])
      setSuppliers(s.suppliers)
      setMaterials(m.materials)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [apiSuppliers, apiMaterials])

  useEffect(() => { void load() }, [load])

  const supplierNameMap = useMemo(
    () => new Map(suppliers.map((s) => [s.id, s.name])),
    [suppliers],
  )

  const cmpCategories = useMemo(
    () => Array.from(new Set(materials.map((m) => m.category))).sort(),
    [materials],
  )

  const cmpMaterials = useMemo(() => {
    const cat = cmpCategory || cmpCategories[0] || ''
    return materials
      .filter((m) => m.category === cat)
      .sort((a, b) => a.purchasePrice - b.purchasePrice)
  }, [materials, cmpCategory, cmpCategories])

  const set = (k: keyof SupplierForm) => (v: string) =>
    setForm((f) => ({ ...f, [k]: v }))

  const openAdd = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }

  const openEdit = (s: Supplier) => {
    setEditing(s)
    setForm({
      name: s.name, contactPerson: s.contactPerson, phone: s.phone,
      email: s.email, address: s.address, notes: s.notes,
    })
    setDialogOpen(true)
  }

  const submit = async () => {
    if (!form.name.trim()) {
      toast.error('Supplier name is required')
      return
    }
    setSaving(true)
    try {
      const body = {
        name: form.name.trim(), contactPerson: form.contactPerson.trim(),
        phone: form.phone.trim(), email: form.email.trim(),
        address: form.address.trim(), notes: form.notes.trim(),
      }
      if (editing) {
        await apiMutate(`/api/suppliers/${editing.id}`, {
          method: 'PATCH', body: JSON.stringify(body),
        })
        toast.success('Supplier updated')
      } else {
        await apiMutate('/api/suppliers', { method: 'POST', body: JSON.stringify(body) })
        toast.success('Supplier added')
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
      await apiDelete(`/api/suppliers/${deleting.id}`, { method: 'DELETE' })
      toast.success('Supplier deleted')
      setDeleting(null)
      await load()
    } catch (e) {
      // e.g. 409 "Supplier has linked materials; unlink first"
      toast.error((e as Error).message)
    }
  }

  const onCsv = () => {
    if (!suppliers.length) { toast.error(t('noData')); return }
    exportCsv(suppliers.map((s) => ({
      Name: s.name, 'Contact Person': s.contactPerson, Phone: s.phone, Email: s.email,
      Address: s.address, Materials: s.materialCount, Notes: s.notes,
    })), 'suppliers.csv')
    toast.success(t('exportCsv'))
  }

  // ------------------------------ render ------------------------------------

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
            <Truck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 sm:text-xl">{t('suppliers')}</h1>
            <p className="text-xs text-slate-500 sm:text-sm">{t('Vendor directory & price comparison')}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={onCsv}>
            <Download className="h-4 w-4" /><span className="hidden sm:inline">{t('exportCsv')}</span>
          </Button>
          {!isViewer && (
            <Button variant="outline" size="sm" onClick={() => setCompareOpen(true)}>
              <Scale className="h-4 w-4" />{t('Compare Prices')}
            </Button>
          )}
          {!isViewer && (
            <Button size="sm" onClick={openAdd}>
              <Plus className="h-4 w-4" />{t('Add Supplier')}
            </Button>
          )}
        </div>
      </div>

      {/* Cards grid */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-52 w-full rounded-xl" />
          ))}
        </div>
      ) : suppliers.length === 0 ? (
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-slate-500">
            <Users className="h-10 w-10" />
            <p className="text-sm">{t('noData')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {suppliers.map((s) => (
            <Card key={s.id} className="flex flex-col border-slate-200 shadow-sm transition-shadow hover:shadow-md">
              <CardContent className="flex flex-1 flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
                      <Truck className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-800">{s.name}</p>
                      <p className="truncate text-xs text-slate-500">{s.contactPerson || '—'}</p>
                    </div>
                  </div>
                  <Badge variant="secondary" className="shrink-0 text-[11px]">
                    {s.materialCount} {t('materials')}
                  </Badge>
                </div>

                <div className="space-y-1.5 text-sm text-slate-600">
                  {s.phone && (
                    <p className="flex items-center gap-2">
                      <Phone className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <a href={`tel:${s.phone}`} className="truncate hover:text-slate-900 hover:underline">{s.phone}</a>
                    </p>
                  )}
                  {s.email && (
                    <p className="flex items-center gap-2">
                      <Mail className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <a href={`mailto:${s.email}`} className="truncate hover:text-slate-900 hover:underline">{s.email}</a>
                    </p>
                  )}
                  {s.address && (
                    <p className="flex items-start gap-2">
                      <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <span className="line-clamp-2">{s.address}</span>
                    </p>
                  )}
                  {!s.phone && !s.email && !s.address && (
                    <p className="flex items-center gap-2 text-slate-400">
                      <User className="h-3.5 w-3.5" />{t('No contact info')}
                    </p>
                  )}
                </div>

                {s.notes && (
                  <p className="rounded-md bg-slate-50 p-2 text-xs italic text-slate-500">{s.notes}</p>
                )}

                {!isViewer && (
                  <div className="mt-auto flex gap-2 pt-1">
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => openEdit(s)}>
                      <Pencil className="h-3.5 w-3.5" />{t('edit')}
                    </Button>
                    <Button
                      variant="outline" size="sm"
                      className="flex-1 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                      onClick={() => setDeleting(s)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />{t('delete')}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full">
          <DialogHeader>
            <DialogTitle>{editing ? `${t('edit')} — ${editing.name}` : t('Add Supplier')}</DialogTitle>
            <DialogDescription>
              {editing ? t('Update supplier contact details') : t('Register a new vendor / supplier')}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="s-name">{t('name')} *</Label>
              <Input id="s-name" value={form.name} onChange={(e) => set('name')(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-contact">{t('Contact Person')}</Label>
              <Input id="s-contact" value={form.contactPerson} onChange={(e) => set('contactPerson')(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-phone">{t('Phone')}</Label>
              <Input id="s-phone" type="tel" inputMode="tel" value={form.phone} onChange={(e) => set('phone')(e.target.value)} placeholder="01XXXXXXXXX" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="s-email">Email</Label>
              <Input id="s-email" type="email" inputMode="email" value={form.email} onChange={(e) => set('email')(e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="s-address">{t('Address')}</Label>
              <Textarea id="s-address" rows={2} value={form.address} onChange={(e) => set('address')(e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="s-notes">{t('notes')}</Label>
              <Textarea id="s-notes" rows={2} value={form.notes} onChange={(e) => set('notes')(e.target.value)} />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t('cancel')}</Button>
            <Button onClick={() => void submit()} disabled={saving}>
              {saving ? t('loading') : t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Price comparison dialog */}
      <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full">
          <DialogHeader>
            <DialogTitle>{t('Supplier-wise Price Comparison')}</DialogTitle>
            <DialogDescription>{t('Materials in a category sorted by purchase price — cheapest first')}</DialogDescription>
          </DialogHeader>

          <Select value={cmpCategory || cmpCategories[0] || '__none'} onValueChange={setCmpCategory}>
            <SelectTrigger aria-label={t('category')}><SelectValue placeholder={t('category')} /></SelectTrigger>
            <SelectContent>
              {cmpCategories.length === 0
                ? <SelectItem value="__none">—</SelectItem>
                : cmpCategories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>

          {cmpMaterials.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-slate-500">
              <Scale className="h-8 w-8" />
              <p className="text-sm">{t('noData')}</p>
            </div>
          ) : (
            <div className={SCROLL_CLS}>
              <Table className="min-w-[640px]">
                <TableHeader>
                  <TableRow className="bg-slate-50 hover:bg-slate-50">
                    <TableHead className="text-slate-600">{t('name')}</TableHead>
                    <TableHead className="hidden text-slate-600 sm:table-cell">{t('brand')}</TableHead>
                    <TableHead className="hidden text-slate-600 sm:table-cell">{t('Size')}</TableHead>
                    <TableHead className="text-right text-slate-600">{t('purchasePrice')}</TableHead>
                    <TableHead className="text-right text-slate-600">{t('sellingPrice')}</TableHead>
                    <TableHead className="hidden text-slate-600 md:table-cell">{t('supplier')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cmpMaterials.map((m, idx) => (
                    <TableRow key={m.id} className={idx === 0 ? 'bg-emerald-50/80 hover:bg-emerald-50' : 'hover:bg-slate-50/70'}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="max-w-[180px] truncate text-sm font-medium text-slate-800">{m.name}</span>
                          {idx === 0 && (
                            <Badge className="border-emerald-200 bg-emerald-100 px-1.5 py-0 text-[10px] text-emerald-800" variant="outline">
                              {t('Lowest')}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="hidden text-sm text-slate-600 sm:table-cell">{m.brand || '—'}</TableCell>
                      <TableCell className="hidden text-xs text-slate-500 sm:table-cell">{m.size || '—'}</TableCell>
                      <TableCell className="text-right text-sm font-medium text-slate-800">৳{fmtBDT(m.purchasePrice)}<span className="text-xs text-slate-400"> /{m.unit}</span></TableCell>
                      <TableCell className="text-right text-sm text-slate-600">৳{fmtBDT(m.sellingPrice)}</TableCell>
                      <TableCell className="hidden max-w-[140px] truncate text-sm text-slate-600 md:table-cell">
                        {m.supplierId ? supplierNameMap.get(m.supplierId) ?? '—' : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{`${t('delete')} — ${deleting?.name ?? ''}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('confirmDelete')}
              {(deleting?.materialCount ?? 0) > 0 &&
                ` ${t('This supplier has linked materials and cannot be deleted until unlinked.')}`}
            </AlertDialogDescription>
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
    </div>
  )
}
