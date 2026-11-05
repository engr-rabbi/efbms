
import { useEffect, useState } from 'react'
import { useT, useApi, useAppStore } from '@/lib/store'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { toast } from 'sonner'
import ProjectDetail from '@/components/views/project-detail'
import {
  Plus, Copy, Archive, Pencil, MapPin, Phone, Building2, Layers,
} from 'lucide-react'

interface Project {
  id: string; code: string; name: string; clientName: string; clientAddress: string
  clientPhone: string; location: string; buildingType: string; supplyType: string
  totalFloors: number; occupants: number; startDate: string; estimationDate: string
  description: string; notes: string; status: string; isDemo: boolean; archived: boolean
  updatedAt: string
  floors: Array<{ id: string; rooms: Array<unknown> }>
  quotations: Array<{ id: string; status: string; grandTotal: number }>
}

const emptyForm = {
  name: '', code: '', clientName: '', clientAddress: '', clientPhone: '', location: '',
  buildingType: 'Apartment', supplyType: '1-PHASE', totalFloors: 1, occupants: 0,
  startDate: '', estimationDate: new Date().toISOString().slice(0, 10),
  description: '', notes: '', autoCreateFloors: 1,
}

const statusColors: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  ESTIMATION: 'bg-amber-100 text-amber-800',
  DESIGN_REVIEW: 'bg-violet-100 text-violet-800',
  QUOTATION: 'bg-cyan-100 text-cyan-800',
  APPROVED: 'bg-emerald-100 text-emerald-800',
  COMPLETED: 'bg-green-600 text-white',
}

export default function ProjectsView() {
  const t = useT()
  const api = useApi<{ projects: Project[] }>()
  const { openProject, user, activeProjectId } = useAppStore()

  // When a project is opened, show the detail workspace
  if (activeProjectId) return <ProjectDetail />

  return <ProjectsList t={t} api={api} openProject={openProject} user={user} />
}

function ProjectsList({ t, api, openProject, user }: {
  t: ReturnType<typeof useT>
  api: ReturnType<typeof useApi<{ projects: Project[] }>>
  openProject: (id: string, tab?: string) => void
  user: { name: string; role: string } | null
}) {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Project | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [delTarget, setDelTarget] = useState<Project | null>(null)
  const [statusFilter, setStatusFilter] = useState('ALL')
  const readOnly = user?.role === 'VIEWER'

  const load = () => api('/api/projects').then((d) => setProjects(d.projects)).catch((e) => toast.error(e.message))
  useEffect(() => { load().finally(() => setLoading(false)) }, [])  

  const openNew = () => {
    setEditing(null)
    setForm({ ...emptyForm, code: `PRJ-${Date.now().toString(36).toUpperCase().slice(-6)}` })
    setDialogOpen(true)
  }
  const openEdit = (p: Project) => {
    setEditing(p)
    setForm({
      name: p.name, code: p.code, clientName: p.clientName, clientAddress: p.clientAddress,
      clientPhone: p.clientPhone, location: p.location, buildingType: p.buildingType,
      supplyType: p.supplyType, totalFloors: p.totalFloors, occupants: p.occupants,
      startDate: p.startDate, estimationDate: p.estimationDate, description: p.description,
      notes: p.notes, autoCreateFloors: 0,
    })
    setDialogOpen(true)
  }

  const save = async () => {
    if (!form.name.trim()) { toast.error(t('projectName') + ' required'); return }
    try {
      if (editing) {
        await api(`/api/projects/${editing.id}`, { method: 'PATCH', body: JSON.stringify({ ...form, userName: user?.name }) })
        toast.success('Project updated')
      } else {
        await api('/api/projects', { method: 'POST', body: JSON.stringify(form) })
        toast.success('Project created')
      }
      setDialogOpen(false)
      load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Save failed') }
  }

  const duplicate = async (p: Project) => {
    try {
      await api(`/api/projects/${p.id}/duplicate`, { method: 'POST' })
      toast.success('Project duplicated')
      load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') }
  }
  const archive = async (p: Project) => {
    try {
      await api(`/api/projects/${p.id}`, { method: 'PATCH', body: JSON.stringify({ archived: true }) })
      toast.success('Project archived')
      load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') }
  }
  const del = async () => {
    if (!delTarget) return
    try {
      await api(`/api/projects/${delTarget.id}`, { method: 'DELETE' })
      toast.success('Project deleted')
      setDelTarget(null)
      load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') }
  }

  const filtered = statusFilter === 'ALL' ? projects : projects.filter((p) => p.status === statusFilter)

  const set = (k: keyof typeof form, v: string | number) => setForm((f) => ({ ...f, [k]: v }))

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{t('projects')}</h1>
          <p className="text-xs text-slate-500">{projects.length} {t('totalProjects')}</p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t('all')}</SelectItem>
              {Object.keys(statusColors).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          {!readOnly && (
            <Button onClick={openNew} className="bg-amber-500 hover:bg-amber-600 text-white">
              <Plus className="w-4 h-4 mr-1" /> {t('newProject')}
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-44 rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-dashed border-2 border-slate-200">
          <CardContent className="py-14 text-center text-slate-500">
            <Building2 className="w-10 h-10 mx-auto mb-3 text-slate-300" />
            {t('noData')} — {t('newProject')}
          </CardContent>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((p) => (
            <Card key={p.id} className="border-slate-200 shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-bold text-sm leading-tight">{p.name}</span>
                      {p.isDemo && <Badge className="bg-amber-100 text-amber-800 text-[9px]">{t('demoData')}</Badge>}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">{p.code} · {p.buildingType} · {p.supplyType}</div>
                  </div>
                  <Badge className={`${statusColors[p.status] ?? 'bg-slate-100'} text-[10px] shrink-0`}>{p.status}</Badge>
                </div>
                <div className="text-xs text-slate-600 space-y-1">
                  <div className="flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5 text-slate-400" /> {p.clientName || '—'}</div>
                  <div className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5 text-slate-400" /> {p.location || '—'}</div>
                  <div className="flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-slate-400" />
                    {p.floors.length} {t('floors')} · {p.floors.reduce((a, f) => a + f.rooms.length, 0)} {t('rooms')} · {p.totalFloors} {t('totalFloors')}
                  </div>
                  {p.clientPhone && <div className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5 text-slate-400" /> {p.clientPhone}</div>}
                </div>
                <div className="flex items-center gap-1.5 pt-1 border-t border-slate-100">
                  <Button size="sm" className="flex-1 bg-amber-500 hover:bg-amber-600 text-white" onClick={() => openProject(p.id)}>
                    {t('openProject')}
                  </Button>
                  {!readOnly && (
                    <>
                      <Button size="icon" variant="ghost" title={t('edit')} onClick={() => openEdit(p)} className="h-8 w-8"><Pencil className="w-3.5 h-3.5" /></Button>
                      <Button size="icon" variant="ghost" title={t('duplicate')} onClick={() => duplicate(p)} className="h-8 w-8"><Copy className="w-3.5 h-3.5" /></Button>
                      <Button size="icon" variant="ghost" title={t('archive')} onClick={() => archive(p)} className="h-8 w-8 text-slate-400"><Archive className="w-3.5 h-3.5" /></Button>
                      <Button size="icon" variant="ghost" title={t('delete')} onClick={() => setDelTarget(p)} className="h-8 w-8 text-rose-500"><Plus className="w-3.5 h-3.5 rotate-45" /></Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? t('edit') : t('newProject')}</DialogTitle>
          </DialogHeader>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t('projectName')} *</Label>
              <Input value={form.name} onChange={(e) => set('name', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('projectCode')}</Label>
              <Input value={form.code} onChange={(e) => set('code', e.target.value)} disabled={!!editing} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('clientName')}</Label>
              <Input value={form.clientName} onChange={(e) => set('clientName', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('clientPhone')}</Label>
              <Input value={form.clientPhone} onChange={(e) => set('clientPhone', e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>{t('clientAddress')}</Label>
              <Input value={form.clientAddress} onChange={(e) => set('clientAddress', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('location')}</Label>
              <Input value={form.location} onChange={(e) => set('location', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('buildingType')}</Label>
              <Select value={form.buildingType} onValueChange={(v) => set('buildingType', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['Apartment', 'Duplex', 'Villa', 'Single Family', 'Other'].map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t('supplyType')}</Label>
              <Select value={form.supplyType} onValueChange={(v) => set('supplyType', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1-PHASE">Single Phase (230V)</SelectItem>
                  <SelectItem value="3-PHASE">Three Phase (400V)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t('totalFloors')}</Label>
              <Input type="number" min={1} value={form.totalFloors} onChange={(e) => set('totalFloors', Number(e.target.value))} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('occupants')}</Label>
              <Input type="number" min={0} value={form.occupants} onChange={(e) => set('occupants', Number(e.target.value))} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('startDate')}</Label>
              <Input type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('estimationDate')}</Label>
              <Input type="date" value={form.estimationDate} onChange={(e) => set('estimationDate', e.target.value)} />
            </div>
            {!editing && (
              <div className="space-y-1.5">
                <Label>{t('addFloor')} × N (auto)</Label>
                <Input type="number" min={0} max={40} value={form.autoCreateFloors} onChange={(e) => set('autoCreateFloors', Number(e.target.value))} />
              </div>
            )}
            <div className="space-y-1.5 sm:col-span-2">
              <Label>{t('description')}</Label>
              <Textarea rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>{t('notes')}</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t('cancel')}</Button>
            <Button className="bg-amber-500 hover:bg-amber-600 text-white" onClick={save}>{t('save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!delTarget} onOpenChange={(o) => !o && setDelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('confirmDelete')}</AlertDialogTitle>
            <AlertDialogDescription>
              {delTarget?.name} — {t('delete')} (all floors, rooms, estimates & drawings)
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction className="bg-rose-600 hover:bg-rose-700" onClick={del}>{t('delete')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
