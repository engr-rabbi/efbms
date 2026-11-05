
import { useCallback, useEffect, useMemo, useState, Fragment } from 'react'
import { useT, useApi, useAppStore } from '@/lib/store'
import { POINT_TYPES, FIXTURE_TYPES, ROOM_TYPES } from '@/lib/engine/catalog'
import type { BoqLine as EngBoqLine } from '@/lib/engine/boq'
import { fmtBDT, exportCsv, exportExcel, boqRows } from '@/lib/export-utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ProjectFilesTab } from '@/components/project/files-tab'
import { TeamAccessCard } from '@/components/project/team-access'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Alert, AlertDescription } from '@/components/ui/alert'
import FloorPlanEditor from '@/components/drawing/FloorPlanEditor'
import { useFmt, useUnitStore } from '@/lib/unit-store'
import { UnitInput, UnitSelect } from '@/components/units/unit-controls'
import type { LengthUnit, AreaUnit } from '@/lib/units'
import { toast } from 'sonner'
import {
  ArrowLeft, Zap, Droplets, Play, Plus, Pencil, Trash2, AlertTriangle,
  Calculator, ShoppingCart, FileSpreadsheet, Info, Ruler, ChevronDown, ChevronRight,
} from 'lucide-react'

// ---------- types ----------
interface Point { id: string; pointType: string; quantity: number; location: string; mountingHeight: number; connectedLoadW: number; specification: string }
interface Fixture { id: string; fixtureType: string; quantity: number; connectionType: string; pipeDiameter: string; system: string }
interface Room { id: string; name: string; roomType: string; length: number; width: number; height: number; doorCount: number; windowCount: number; points: Point[]; fixtures: Fixture[] }
interface Floor { id: string; floorNumber: number; name: string; height: number; area: number; rooms: Room[] }
interface Circuit { id: string; floorName: string; name: string; circuitType: string; phase: string; loadW: number; designAmps: number; breakerRating: string; breakerType: string; rccb: boolean; cableSize: string; cableLength: number; pointsCount: number; remarks: string }
interface Project {
  id: string; code: string; name: string; clientName: string; clientAddress: string; clientPhone: string
  location: string; buildingType: string; supplyType: string; totalFloors: number; occupants: number
  status: string; isDemo: boolean; startDate: string; estimationDate: string; description: string; notes: string
  unitLength: string; unitArea: string
  floors: Floor[]; circuits: Circuit[]
}
interface EstItem {
  id: string; floorName: string; roomName: string; system: string; category: string; name: string
  specification: string; size: string; unit: string; mode: string; qty: number; formula: string
  assumptions: string; wastagePct: number; sourceRef: string
}
type BoqLine = EngBoqLine

const pointLabel = (type: string) => POINT_TYPES.find((p) => p.type === type)?.labelEn ?? type
const fixtureLabel = (type: string) => FIXTURE_TYPES.find((f) => f.type === type)?.labelEn ?? type

// ---------- main ----------
export default function ProjectDetail() {
  const t = useT()
  const api = useApi<{ project: Project }>()
  const { activeProjectId, setProjectTab, projectTab, navigate, closeProject } = useAppStore()
  const [project, setProject] = useState<Project | null>(null)
  const [err, setErr] = useState('')

  const load = useCallback(() => {
    if (!activeProjectId) return
    api(`/api/projects/${activeProjectId}`).then((d) => setProject(d.project)).catch((e) => setErr(e.message))
  }, [activeProjectId, api])

  useEffect(() => { load() }, [load])

  // Activate the project's unit override (project.unitLength/unitArea, '' = follow global)
  // for all child tabs incl. the drawing editor; cleared when the project closes.
  // Display-only: never mutates geometry, quantities or persisted data.
  const loadProjectUnits = useUnitStore((s) => s.loadProject)
  useEffect(() => {
    const pid = project?.id
    if (!pid) return
    loadProjectUnits(pid, { unitLength: project?.unitLength ?? '', unitArea: project?.unitArea ?? '' })
    return () => { loadProjectUnits(null) }
  }, [project?.id, project?.unitLength, project?.unitArea, loadProjectUnits])

  if (err) return <Alert variant="destructive"><AlertDescription>{err}</AlertDescription></Alert>
  if (!project) return <Skeleton className="h-96 rounded-xl" />

  const tabs = [
    { key: 'overview', label: t('overview') },
    { key: 'floors-rooms', label: `${t('floors')} & ${t('rooms')}` },
    { key: 'electrical', label: t('electricalDesign') },
    { key: 'plumbing', label: t('plumbingDesign') },
    { key: 'drawing', label: t('floorPlan') },
    { key: 'estimation', label: t('estimation') },
    { key: 'boq', label: t('boq') },
    { key: 'procurement', label: t('procurement') },
    { key: 'files', label: 'Files' },
  ]

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <Button variant="ghost" size="icon" onClick={closeProject} aria-label="Back"><ArrowLeft className="w-5 h-5" /></Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-lg font-bold truncate">{project.name}</h1>
            {project.isDemo && <Badge className="bg-amber-100 text-amber-800 text-[9px]">{t('demoData')}</Badge>}
          </div>
          <p className="text-xs text-slate-500">{project.code} · {project.clientName} · {project.location}</p>
        </div>
      </div>

      <Tabs value={projectTab} onValueChange={setProjectTab}>
        <TabsList className="w-full justify-start overflow-x-auto h-auto flex-wrap sm:flex-nowrap">
          {tabs.map((tb) => (
            <TabsTrigger key={tb.key} value={tb.key} className="text-xs sm:text-sm shrink-0">{tb.label}</TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview"><OverviewTab project={project} onSaved={load} /></TabsContent>
        <TabsContent value="floors-rooms"><FloorsRoomsTab project={project} onSaved={load} /></TabsContent>
        <TabsContent value="electrical"><ElectricalTab project={project} /></TabsContent>
        <TabsContent value="plumbing"><PlumbingTab project={project} /></TabsContent>
        <TabsContent value="drawing">
          <FloorPlanEditor projectId={project.id} floors={project.floors.map((f) => ({ id: f.id, floorNumber: f.floorNumber, name: f.name, height: f.height }))} />
        </TabsContent>
        <TabsContent value="estimation"><EstimationTab project={project} onRerun={load} /></TabsContent>
        <TabsContent value="boq"><BoqTab projectId={project.id} /></TabsContent>
        <TabsContent value="procurement"><ProcurementTab projectId={project.id} /></TabsContent>
        <TabsContent value="files"><ProjectFilesTab projectId={project.id} /></TabsContent>
      </Tabs>
    </div>
  )
}

// ============================ Overview ============================
function OverviewTab({ project, onSaved }: { project: Project; onSaved: () => void }) {
  const t = useT()
  const api = useApi<{ project: Project }>()
  const fmt = useFmt()
  const setProjectUnits = useUnitStore((s) => s.setProjectUnits)
  const [status, setStatus] = useState(project.status)

  const changeStatus = async (v: string) => {
    setStatus(v)
    await api(`/api/projects/${project.id}`, { method: 'PATCH', body: JSON.stringify({ status: v, userName: useAppStore.getState().user?.name }) })
    toast.success(`${t('status')}: ${v}`)
    onSaved()
  }

  const totalRooms = project.floors.reduce((a, f) => a + f.rooms.length, 0)
  const totalPoints = project.floors.reduce((a, f) => a + f.rooms.reduce((b, r) => b + r.points.reduce((c, p) => c + p.quantity, 0), 0), 0)
  const totalFixtures = project.floors.reduce((a, f) => a + f.rooms.reduce((b, r) => b + r.fixtures.reduce((c, x) => c + x.quantity, 0), 0), 0)

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle className="text-base">{t('projectDetails')}</CardTitle></CardHeader>
        <CardContent className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          {[
            [t('projectCode'), project.code], [t('buildingType'), project.buildingType],
            [t('supplyType'), project.supplyType], [t('totalFloors'), String(project.totalFloors)],
            [t('startDate'), project.startDate || '—'], [t('estimationDate'), project.estimationDate || '—'],
            [t('occupants'), String(project.occupants || '—')], [t('location'), project.location || '—'],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2 border-b border-slate-100 py-1.5">
              <span className="text-slate-500">{k}</span><span className="font-medium text-right">{v}</span>
            </div>
          ))}
          {project.description && <p className="sm:col-span-2 text-xs text-slate-600 bg-slate-50 rounded-lg p-3">{project.description}</p>}
        </CardContent>
      </Card>
      <div className="space-y-4">
        <Card>
          <CardHeader><CardTitle className="text-base">{t('status')}</CardTitle></CardHeader>
          <CardContent>
            <Select value={status} onValueChange={changeStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {['DRAFT', 'ESTIMATION', 'DESIGN_REVIEW', 'QUOTATION', 'APPROVED', 'COMPLETED'].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="grid grid-cols-3 gap-2 p-4 text-center">
            {[
              [totalRooms, t('rooms')], [totalPoints, t('points')], [totalFixtures, t('fixtures')],
            ].map(([v, l]) => (
              <div key={String(l)} className="rounded-lg bg-slate-50 p-2.5">
                <div className="text-xl font-bold">{v}</div>
                <div className="text-[10px] text-slate-500">{l}</div>
              </div>
            ))}
          </CardContent>
        </Card>
        <TeamAccessCard project={project as unknown as { id: string; ownerId?: string; members?: string }} onSaved={onSaved} />
        <Card>
          <CardHeader><CardTitle className="text-sm flex items-center gap-1.5"><Ruler className="w-4 h-4 text-amber-600" />{t('projectUnitSettings')}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-500">{t('lengthUnit')}</Label>
                <UnitSelect kind="length" includeEmpty emptyLabel={t('useGlobalDefault')} value={project.unitLength || ''} onChange={(v) => setProjectUnits(project.id, { lengthUnit: v as LengthUnit | '', areaUnit: (project.unitArea || '') as AreaUnit | '' })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-500">{t('areaUnit')}</Label>
                <UnitSelect kind="area" includeEmpty emptyLabel={t('useGlobalDefault')} value={project.unitArea || ''} onChange={(v) => setProjectUnits(project.id, { lengthUnit: (project.unitLength || '') as LengthUnit | '', areaUnit: v as AreaUnit | '' })} />
              </div>
            </div>
            <p className="text-[11px] text-slate-400">{t('unitProjectHint')}</p>
            <p className="text-xs tabular-nums text-slate-500">Active: {fmt.lenSym} · {fmt.areaSym}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// ============================ Floors & Rooms ============================
function FloorsRoomsTab({ project, onSaved }: { project: Project; onSaved: () => void }) {
  const t = useT()
  const fmt = useFmt()
  const api = useApi<Record<string, unknown>>()
  const { user } = useAppStore()
  const readOnly = user?.role === 'VIEWER'
  const [openFloor, setOpenFloor] = useState<string>(project.floors[0]?.id ?? '')
  const [roomDialog, setRoomDialog] = useState<{ floorId: string; room?: Room } | null>(null)
  const [pointDialog, setPointDialog] = useState<{ room: Room; point?: Point } | null>(null)
  const [fixtureDialog, setFixtureDialog] = useState<{ room: Room; fixture?: Fixture } | null>(null)
  const [delTarget, setDelTarget] = useState<{ kind: 'floor' | 'room' | 'point' | 'fixture'; id: string; label: string } | null>(null)

  const doDelete = async () => {
    if (!delTarget) return
    const urls: Record<string, string> = {
      floor: `/api/floors/${delTarget.id}`, room: `/api/rooms/${delTarget.id}`,
      point: `/api/points/${delTarget.id}`, fixture: `/api/fixtures/${delTarget.id}`,
    }
    try {
      await api(urls[delTarget.kind], { method: 'DELETE' })
      toast.success(t('delete') + ' ✓')
      setDelTarget(null); onSaved()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{t('floors')} & {t('rooms')}</h2>
        {!readOnly && (
          <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-white" onClick={async () => {
            try {
              await api('/api/floors', { method: 'POST', body: JSON.stringify({ projectId: project.id, floorNumber: project.floors.length + 1, name: `${project.floors.length + 1}th Floor`, height: 3.05 }) })
              toast.success(t('addFloor') + ' ✓'); onSaved()
            } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') }
          }}>
            <Plus className="w-4 h-4 mr-1" /> {t('addFloor')}
          </Button>
        )}
      </div>

      {project.floors.length === 0 && (
        <Card className="border-dashed"><CardContent className="py-10 text-center text-slate-500 text-sm">{t('noData')} — {t('addFloor')}</CardContent></Card>
      )}

      {project.floors.map((floor) => {
        const open = openFloor === floor.id
        return (
          <Card key={floor.id} className="border-slate-200">
            <CardHeader className="p-4 pb-2 cursor-pointer select-none" onClick={() => setOpenFloor(open ? '' : floor.id)}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {open ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
                  <CardTitle className="text-sm font-bold truncate">{floor.name}</CardTitle>
                  <Badge variant="outline" className="text-[10px] shrink-0">{floor.rooms.length} {t('rooms')}</Badge>
                </div>
                <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <Badge variant="outline" className="text-[10px]">{`H: ${fmt.len(floor.height)} ${fmt.lenSym}`}</Badge>
                  {!readOnly && (
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-rose-500" onClick={() => setDelTarget({ kind: 'floor', id: floor.id, label: floor.name })} title={t('delete')}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            {open && (
              <CardContent className="pt-0 space-y-3">
                <div className="flex justify-end">
                  {!readOnly && (
                    <Button size="sm" variant="outline" onClick={() => setRoomDialog({ floorId: floor.id })}>
                      <Plus className="w-3.5 h-3.5 mr-1" /> {t('addRoom')}
                    </Button>
                  )}
                </div>
                {floor.rooms.length === 0 && <p className="text-xs text-slate-400 text-center py-4">{t('noData')}</p>}
                <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {floor.rooms.map((room) => (
                    <div key={room.id} className="rounded-lg border border-slate-200 p-3 bg-white">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-semibold text-sm truncate">{room.name}</div>
                          <div className="text-[11px] text-slate-500 flex items-center gap-1 flex-wrap">
                            <Ruler className="w-3 h-3" /> {fmt.len(room.length)}×{fmt.len(room.width)}×{fmt.len(room.height)} {fmt.lenSym}
                            <Badge variant="outline" className="text-[9px] ml-1">{room.roomType}</Badge>
                          </div>
                        </div>
                        {!readOnly && (
                          <div className="flex gap-0.5 shrink-0">
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setRoomDialog({ floorId: floor.id, room })}><Pencil className="w-3 h-3" /></Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-rose-500" onClick={() => setDelTarget({ kind: 'room', id: room.id, label: room.name })}><Trash2 className="w-3 h-3" /></Button>
                          </div>
                        )}
                      </div>
                      <div className="mt-2 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-medium text-amber-700 flex items-center gap-1"><Zap className="w-3 h-3" /> {t('points')}: {room.points.reduce((a, p) => a + p.quantity, 0)}</span>
                          {!readOnly && <Button size="sm" variant="ghost" className="h-6 text-[10px] text-amber-600" onClick={() => setPointDialog({ room })}><Plus className="w-3 h-3" /></Button>}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {room.points.map((p) => (
                            <Badge key={p.id} variant="secondary" className="text-[9px] font-normal cursor-default" title={`${p.quantity}× @ ${fmt.lenS(p.mountingHeight)} — ${p.specification || pointLabel(p.pointType)}`}>
                              {pointLabel(p.pointType)} ×{p.quantity}
                              {!readOnly && (
                                <button className="ml-1 text-slate-400 hover:text-rose-500" onClick={() => setPointDialog({ room, point: p })} aria-label="edit point"><Pencil className="w-2.5 h-2.5 inline" /></button>
                              )}
                              {!readOnly && (
                                <button className="ml-0.5 text-slate-400 hover:text-rose-500" onClick={() => setDelTarget({ kind: 'point', id: p.id, label: pointLabel(p.pointType) })} aria-label="delete point">×</button>
                              )}
                            </Badge>
                          ))}
                        </div>
                        <div className="flex items-center justify-between pt-1">
                          <span className="text-[11px] font-medium text-cyan-700 flex items-center gap-1"><Droplets className="w-3 h-3" /> {t('fixtures')}: {room.fixtures.reduce((a, f) => a + f.quantity, 0)}</span>
                          {!readOnly && <Button size="sm" variant="ghost" className="h-6 text-[10px] text-cyan-600" onClick={() => setFixtureDialog({ room })}><Plus className="w-3 h-3" /></Button>}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {room.fixtures.map((f) => (
                            <Badge key={f.id} variant="secondary" className="text-[9px] font-normal">
                              {fixtureLabel(f.fixtureType)} ×{f.quantity}
                              {!readOnly && (
                                <button className="ml-1 text-slate-400 hover:text-rose-500" onClick={() => setFixtureDialog({ room, fixture: f })}><Pencil className="w-2.5 h-2.5 inline" /></button>
                              )}
                              {!readOnly && (
                                <button className="ml-0.5 text-slate-400 hover:text-rose-500" onClick={() => setDelTarget({ kind: 'fixture', id: f.id, label: fixtureLabel(f.fixtureType) })}>×</button>
                              )}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            )}
          </Card>
        )
      })}

      {/* Room dialog */}
      {roomDialog && <RoomDialog floorId={roomDialog.floorId} room={roomDialog.room} onClose={() => setRoomDialog(null)} onSaved={onSaved} />}
      {/* Point dialog */}
      {pointDialog && <PointDialog roomId={pointDialog.room.id} roomName={pointDialog.room.name} point={pointDialog.point} onClose={() => setPointDialog(null)} onSaved={onSaved} />}
      {/* Fixture dialog */}
      {fixtureDialog && <FixtureDialog roomId={fixtureDialog.room.id} roomName={fixtureDialog.room.name} fixture={fixtureDialog.fixture} onClose={() => setFixtureDialog(null)} onSaved={onSaved} />}

      <AlertDialog open={!!delTarget} onOpenChange={(o) => !o && setDelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{t('confirmDelete')}</AlertDialogTitle>
            <AlertDialogDescription>{delTarget?.label}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction className="bg-rose-600 hover:bg-rose-700" onClick={doDelete}>{t('delete')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function RoomDialog({ floorId, room, onClose, onSaved }: { floorId: string; room?: Room; onClose: () => void; onSaved: () => void }) {
  const t = useT()
  const api = useApi<Record<string, unknown>>()
  const [f, setF] = useState({ name: room?.name ?? '', roomType: room?.roomType ?? 'BEDROOM', length: room?.length ?? 3.6, width: room?.width ?? 3.0, height: room?.height ?? 3.05, doorCount: room?.doorCount ?? 1, windowCount: room?.windowCount ?? 0 })
  const save = async () => {
    if (!f.name.trim()) { toast.error(t('roomName') + ' *'); return }
    try {
      if (room) await api(`/api/rooms/${room.id}`, { method: 'PATCH', body: JSON.stringify(f) })
      else await api('/api/rooms', { method: 'POST', body: JSON.stringify({ floorId, ...f }) })
      toast.success(t('save') + ' ✓'); onClose(); onSaved()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{room ? t('edit') : t('addRoom')}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5"><Label>{t('roomName')} *</Label>
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>{t('roomType')}</Label>
            <Select value={f.roomType} onValueChange={(v) => setF({ ...f, roomType: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{ROOM_TYPES.map((r) => <SelectItem key={r.type} value={r.type}>{r.labelEn} / {r.labelBn}</SelectItem>)}</SelectContent>
            </Select></div>
          <div className="space-y-1.5"><Label>{t('length')}</Label>
            <UnitInput meters={f.length} onMeters={(v) => setF({ ...f, length: v })} ariaLabel={t('length')} /></div>
          <div className="space-y-1.5"><Label>{t('width')}</Label>
            <UnitInput meters={f.width} onMeters={(v) => setF({ ...f, width: v })} ariaLabel={t('width')} /></div>
          <div className="space-y-1.5"><Label>{t('height')}</Label>
            <UnitInput meters={f.height} onMeters={(v) => setF({ ...f, height: v })} step={0.05} ariaLabel={t('height')} /></div>
          <div className="space-y-1.5"><Label>Doors</Label>
            <Input type="number" min={0} value={f.doorCount} onChange={(e) => setF({ ...f, doorCount: Number(e.target.value) })} /></div>
          <div className="space-y-1.5"><Label>Windows</Label>
            <Input type="number" min={0} value={f.windowCount} onChange={(e) => setF({ ...f, windowCount: Number(e.target.value) })} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button className="bg-amber-500 hover:bg-amber-600 text-white" onClick={save}>{t('save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PointDialog({ roomId, roomName, point, onClose, onSaved }: { roomId: string; roomName: string; point?: Point; onClose: () => void; onSaved: () => void }) {
  const t = useT()
  const api = useApi<Record<string, unknown>>()
  const [f, setF] = useState({ pointType: point?.pointType ?? 'LIGHT', quantity: point?.quantity ?? 1, location: point?.location ?? '', mountingHeight: point?.mountingHeight ?? 2.7, connectedLoadW: point?.connectedLoadW ?? 25, specification: point?.specification ?? '' })
  const meta = POINT_TYPES.find((p) => p.type === f.pointType)
  const save = async () => {
    try {
      if (point) await api(`/api/points/${point.id}`, { method: 'PATCH', body: JSON.stringify(f) })
      else await api('/api/points', { method: 'POST', body: JSON.stringify({ roomId, ...f }) })
      toast.success(t('save') + ' ✓'); onClose(); onSaved()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{point ? t('edit') : t('addPoint')} — {roomName}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5"><Label>{t('pointType')}</Label>
            <Select value={f.pointType} onValueChange={(v) => {
              const m = POINT_TYPES.find((p) => p.type === v)
              setF({ ...f, pointType: v, connectedLoadW: m?.defaultLoadW ?? 0 })
            }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{POINT_TYPES.map((p) => <SelectItem key={p.type} value={p.type}>{p.labelEn} / {p.labelBn}</SelectItem>)}</SelectContent>
            </Select></div>
          <div className="space-y-1.5"><Label>{t('quantity')}</Label>
            <Input type="number" min={1} value={f.quantity} onChange={(e) => setF({ ...f, quantity: Number(e.target.value) })} /></div>
          <div className="space-y-1.5"><Label>{t('connectedLoadW')}</Label>
            <Input type="number" min={0} value={f.connectedLoadW} onChange={(e) => setF({ ...f, connectedLoadW: Number(e.target.value) })} />
            {meta && <p className="text-[10px] text-slate-400">default: {meta.defaultLoadW}W</p>}</div>
          <div className="space-y-1.5"><Label>{t('mountingHeight')}</Label>
            <UnitInput meters={f.mountingHeight} onMeters={(v) => setF({ ...f, mountingHeight: v })} step={0.05} ariaLabel={t('mountingHeight')} /></div>
          <div className="space-y-1.5"><Label>Location</Label>
            <Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="N wall / ceiling center" /></div>
          <div className="col-span-2 space-y-1.5"><Label>{t('specification')}</Label>
            <Input value={f.specification} onChange={(e) => setF({ ...f, specification: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button className="bg-amber-500 hover:bg-amber-600 text-white" onClick={save}>{t('save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function FixtureDialog({ roomId, roomName, fixture, onClose, onSaved }: { roomId: string; roomName: string; fixture?: Fixture; onClose: () => void; onSaved: () => void }) {
  const t = useT()
  const api = useApi<Record<string, unknown>>()
  const [f, setF] = useState({ fixtureType: fixture?.fixtureType ?? 'WC', quantity: fixture?.quantity ?? 1, connectionType: fixture?.connectionType ?? 'Cold', pipeDiameter: fixture?.pipeDiameter ?? '', system: fixture?.system ?? 'Cold Water' })
  const meta = FIXTURE_TYPES.find((x) => x.type === f.fixtureType)
  const save = async () => {
    try {
      if (fixture) await api(`/api/fixtures/${fixture.id}`, { method: 'PATCH', body: JSON.stringify(f) })
      else await api('/api/fixtures', { method: 'POST', body: JSON.stringify({ roomId, ...f }) })
      toast.success(t('save') + ' ✓'); onClose(); onSaved()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{fixture ? t('edit') : t('addFixture')} — {roomName}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5"><Label>{t('fixtureType')}</Label>
            <Select value={f.fixtureType} onValueChange={(v) => {
              const m = FIXTURE_TYPES.find((x) => x.type === v)
              setF({ ...f, fixtureType: v, system: m?.coldDia ? 'Cold Water' : 'Soil', pipeDiameter: m?.soilDia || m?.wasteDia || '15' })
            }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{FIXTURE_TYPES.map((x) => <SelectItem key={x.type} value={x.type}>{x.labelEn} / {x.labelBn}</SelectItem>)}</SelectContent>
            </Select></div>
          <div className="space-y-1.5"><Label>{t('quantity')}</Label>
            <Input type="number" min={1} value={f.quantity} onChange={(e) => setF({ ...f, quantity: Number(e.target.value) })} /></div>
          <div className="space-y-1.5"><Label>{t('connectionType')}</Label>
            <Select value={f.connectionType} onValueChange={(v) => setF({ ...f, connectionType: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{['Cold', 'Hot', 'Cold+Hot', 'Soil', 'Waste', 'Vent', 'Rain'].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select></div>
          <div className="space-y-1.5"><Label>{t('pipeDiameter')}</Label>
            <Input value={f.pipeDiameter} onChange={(e) => setF({ ...f, pipeDiameter: e.target.value })} placeholder={meta ? `default: ${meta.coldDia || meta.soilDia || meta.wasteDia}` : ''} /></div>
          <div className="space-y-1.5"><Label>System</Label>
            <Select value={f.system} onValueChange={(v) => setF({ ...f, system: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{['Cold Water', 'Hot Water', 'Soil', 'Wastewater', 'Vent', 'Rainwater'].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button className="bg-amber-500 hover:bg-amber-600 text-white" onClick={save}>{t('save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============================ Electrical ============================
function ElectricalTab({ project }: { project: Project }) {
  const t = useT()
  const fmt = useFmt()
  const circuits = project.circuits

  const rows = project.floors.flatMap((fl) =>
    fl.rooms.map((r) => ({
      floor: fl.name, room: r.name,
      pts: r.points.map((p) => `${pointLabel(p.pointType)}×${p.quantity}`).join(', ') || '—',
      load: r.points.reduce((a, p) => a + (p.connectedLoadW || 0) * p.quantity, 0),
    })),
  )

  return (
    <div className="space-y-4">
      <h2 className="font-semibold flex items-center gap-2"><Zap className="w-4.5 h-4.5 text-amber-600" /> {t('electricalDesign')}</h2>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">{t('points')} — {t('schedule')}</CardTitle></CardHeader>
        <CardContent className="max-h-[380px] overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full">
          <Table>
            <TableHeader><TableRow><TableHead>{t('floors')}</TableHead><TableHead>{t('rooms')}</TableHead><TableHead>{t('points')}</TableHead><TableHead className="text-right">Load (W)</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="text-xs">{r.floor}</TableCell>
                  <TableCell className="text-xs font-medium">{r.room}</TableCell>
                  <TableCell className="text-xs max-w-[320px] truncate">{r.pts}</TableCell>
                  <TableCell className="text-xs text-right">{r.load}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-xs text-slate-400 py-6">{t('noData')}</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t('circuitSchedule')} ({circuits.length})</CardTitle>
        </CardHeader>
        <CardContent className="max-h-[420px] overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full">
          {circuits.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-6 flex items-center justify-center gap-1.5">
              <Info className="w-4 h-4" /> {t('runEstimation')} →
            </p>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-xs">#</TableHead><TableHead className="text-xs">{t('name')}</TableHead>
                <TableHead className="text-xs">Type</TableHead><TableHead className="text-xs">Load W</TableHead>
                <TableHead className="text-xs">A</TableHead><TableHead className="text-xs">Breaker</TableHead>
                <TableHead className="text-xs">Wire mm²</TableHead><TableHead className="text-xs">{`Len (${fmt.lenSym})`}</TableHead>
                <TableHead className="text-xs">RCCB</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {circuits.map((c, i) => (
                  <TableRow key={c.id}>
                    <TableCell className="text-[11px]">{i + 1}</TableCell>
                    <TableCell className="text-[11px] font-medium max-w-[180px] truncate" title={c.name + ' — ' + c.floorName}>{c.name}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[9px]">{c.circuitType}</Badge></TableCell>
                    <TableCell className="text-[11px]">{Math.round(c.loadW)}</TableCell>
                    <TableCell className="text-[11px]">{c.designAmps}</TableCell>
                    <TableCell className="text-[11px] font-semibold">{c.breakerRating}A {c.breakerType}</TableCell>
                    <TableCell className="text-[11px]">{c.cableSize}</TableCell>
                    <TableCell className="text-[11px]">{fmt.len(c.cableLength)}</TableCell>
                    <TableCell>{c.rccb ? <Badge className="bg-emerald-100 text-emerald-800 text-[9px]">✓</Badge> : <span className="text-[10px] text-slate-300">—</span>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ============================ Plumbing ============================
function PlumbingTab({ project }: { project: Project }) {
  const t = useT()
  const rows = project.floors.flatMap((fl) =>
    fl.rooms.filter((r) => r.fixtures.length > 0).map((r) => ({
      floor: fl.name, room: r.name,
      fx: r.fixtures.map((f) => `${fixtureLabel(f.fixtureType)}×${f.quantity}`).join(', '),
      systems: [...new Set(r.fixtures.map((f) => f.system))].join(', '),
    })),
  )
  return (
    <div className="space-y-4">
      <h2 className="font-semibold flex items-center gap-2"><Droplets className="w-4.5 h-4.5 text-cyan-600" /> {t('plumbingDesign')}</h2>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">{t('fixtures')} — {t('schedule')}</CardTitle></CardHeader>
        <CardContent className="max-h-[380px] overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full">
          <Table>
            <TableHeader><TableRow><TableHead className="text-xs">{t('floors')}</TableHead><TableHead className="text-xs">{t('rooms')}</TableHead><TableHead className="text-xs">{t('fixtures')}</TableHead><TableHead className="text-xs">Systems</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="text-xs">{r.floor}</TableCell>
                  <TableCell className="text-xs font-medium">{r.room}</TableCell>
                  <TableCell className="text-xs">{r.fx}</TableCell>
                  <TableCell className="text-xs text-slate-500">{r.systems}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-xs text-slate-400 py-6">{t('noData')}</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

// ============================ Estimation ============================
function EstimationTab({ project, onRerun }: { project: Project; onRerun: () => void }) {
  const t = useT()
  const fmt = useFmt()
  const api = useApi<Record<string, unknown>>()
  const { user } = useAppStore()
  const readOnly = user?.role === 'VIEWER'
  const [items, setItems] = useState<EstItem[]>([])
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null)
  const [plumb, setPlumb] = useState<{ occupants: number; dailyDemandL: number; ohtL: number; ugtL: number; pumpFlowLpm: number; pumpHeadM: number; pumpHp: string } | null>(null)
  const [running, setRunning] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [systemFilter, setSystemFilter] = useState('ALL')

  useEffect(() => {
    let cancelled = false
    api(`/api/estimation/${project.id}`).then((d) => {
      if (cancelled) return
      const list = (d.items as EstItem[]) ?? []
      setItems(list)
      if (list.length > 0) setSummary({ persisted: true })
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [project.id, api])

  const run = async () => {
    setRunning(true)
    try {
      const res = await api(`/api/estimation/${project.id}`, { method: 'POST' })
      setSummary(res.summary as Record<string, unknown>)
      setPlumb(res.plumbingSummary as { occupants: number; dailyDemandL: number; ohtL: number; ugtL: number; pumpFlowLpm: number; pumpHeadM: number; pumpHp: string })
      const d = await api(`/api/estimation/${project.id}`)
      setItems((d.items as EstItem[]) ?? [])
      toast.success(`${res.itemCount} items · ${res.circuitCount} circuits`)
      onRerun()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') } finally { setRunning(false) }
  }

  const filtered = systemFilter === 'ALL' ? items : items.filter((i) => i.system === systemFilter)

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="font-semibold flex items-center gap-2"><Calculator className="w-4.5 h-4.5 text-amber-600" /> {t('estimation')}</h2>
        {!readOnly && (
          <Button onClick={run} disabled={running} className="bg-amber-500 hover:bg-amber-600 text-white">
            <Play className="w-4 h-4 mr-1.5" /> {items.length ? t('reRun') : t('runEstimation')}
          </Button>
        )}
      </div>
      {readOnly && <Alert><AlertDescription className="text-xs">Read-only user — estimation results shown below (ask an engineer to re-run).</AlertDescription></Alert>}

      {summary && 'totalConnectedW' in (summary ?? {}) && (
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2">
          {[
            [t('connectedLoad'), `${fmtBDT(Number(summary.totalConnectedW))} W`],
            [t('demandLoad'), `${fmtBDT(Number(summary.demandW))} W`],
            [t('designAmps'), `${summary.designAmps} A`],
            [t('mainBreaker'), String(summary.mainBreaker)],
            ['Wire Total', `${fmt.len(Number(summary.wireTotalM))} ${fmt.lenSym}`],
            ['Conduit', `${fmt.len(Number(summary.conduitTotalM))} ${fmt.lenSym}`],
            [t('points'), String(summary.totalPoints)],
          ].map(([k, v]) => (
            <Card key={k} className="p-3"><div className="text-[10px] text-slate-500 truncate">{k}</div><div className="text-sm font-bold mt-0.5">{v}</div></Card>
          ))}
        </div>
      )}

      {plumb && (
        <Card className="border-cyan-200 bg-cyan-50/40">
          <CardContent className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-center text-xs">
            <div><div className="font-bold">{String(plumb.occupants)}</div><div className="text-slate-500">{t('occupants')}</div></div>
            <div><div className="font-bold">{fmtBDT(Number(plumb.dailyDemandL))} L</div><div className="text-slate-500">{t('waterDemand')}/day</div></div>
            <div><div className="font-bold">{fmtBDT(Number(plumb.ohtL))} L</div><div className="text-slate-500">Overhead Tank</div></div>
            <div><div className="font-bold">{fmtBDT(Number(plumb.ugtL))} L</div><div className="text-slate-500">Underground</div></div>
            <div><div className="font-bold">{plumb.pumpFlowLpm} LPM</div><div className="text-slate-500">Pump Flow</div></div>
            <div><div className="font-bold">{fmt.len(plumb.pumpHeadM)} {fmt.lenSym} / {plumb.pumpHp}HP</div><div className="text-slate-500">Pump Head</div></div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2 flex-row items-center justify-between">
          <CardTitle className="text-sm">{t('estimation')} — {filtered.length} items</CardTitle>
          <Select value={systemFilter} onValueChange={setSystemFilter}>
            <SelectTrigger className="w-[150px] h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t('all')}</SelectItem>
              <SelectItem value="ELECTRICAL">Electrical</SelectItem>
              <SelectItem value="PLUMBING">Plumbing</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="max-h-[480px] overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full">
          {items.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">{t('noData')} — {t('runEstimation')}</p>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-xs w-8"></TableHead>
                <TableHead className="text-xs">{t('name')}</TableHead>
                <TableHead className="text-xs">{t('qty')}</TableHead>
                <TableHead className="text-xs">{t('unit')}</TableHead>
                <TableHead className="text-xs">Mode</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filtered.map((it) => (
                  <Fragment key={it.id}>
                    <TableRow className="cursor-pointer hover:bg-slate-50" onClick={() => setExpanded(expanded === it.id ? null : it.id)}>
                      <TableCell>{expanded === it.id ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}</TableCell>
                      <TableCell className="text-xs">
                        <span className="font-medium">{it.name}</span>
                        <span className="text-slate-400 block text-[10px]">{it.category}{it.size ? ` · ${it.size}` : ''}</span>
                      </TableCell>
                      <TableCell className="text-xs font-semibold">{Math.round(it.qty * 100) / 100}
                        {it.unit === 'm' && fmt.prefs.lengthUnit !== 'm' && (
                          <span className="block text-[9px] text-slate-400">≈ {fmt.len(it.qty)} {fmt.lenSym}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">{it.unit}</TableCell>
                      <TableCell>
                        <Badge className={`text-[9px] ${it.mode === 'DRAWING' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{it.mode === 'DRAWING' ? 'Mode B' : 'Mode A'}</Badge>
                      </TableCell>
                    </TableRow>
                    {expanded === it.id && (
                      <TableRow className="bg-amber-50/50">
                        <TableCell></TableCell>
                        <TableCell colSpan={4} className="text-xs pb-3">
                          <div className="space-y-1.5">
                            <div><span className="font-semibold text-amber-800">{t('formula')}:</span> <span className="text-slate-700">{it.formula}</span></div>
                            {it.floorName && <div className="text-slate-500">📍 {it.floorName}{it.roomName ? ` → ${it.roomName}` : ''}</div>}
                            {JSON.parse(it.assumptions || '[]').map((a: string, i: number) => (
                              <div key={i} className="flex gap-1.5 text-slate-600"><AlertTriangle className="w-3 h-3 mt-0.5 text-amber-500 shrink-0" />{a}</div>
                            ))}
                            <div className="text-slate-400 text-[10px]">Wastage: {it.wastagePct}% · Source: {it.sourceRef}</div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ============================ BOQ ============================
function BoqTab({ projectId }: { projectId: string }) {
  const t = useT()
  const fmt = useFmt()
  const api = useApi<Record<string, unknown>>()
  const { user } = useAppStore()
  const readOnly = user?.role === 'VIEWER'
  const [lines, setLines] = useState<BoqLine[]>([])
  const [totals, setTotals] = useState<Record<string, number> | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  const [system, setSystem] = useState('COMBINED')
  const [q, setQ] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [ovDialog, setOvDialog] = useState<BoqLine | null>(null)
  const [ovForm, setOvForm] = useState({ qty: 0, reason: '' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await null
      if (cancelled) return
      setLoading(true)
      try {
        const d = await api(`/api/boq/${projectId}?system=COMBINED`)
        if (cancelled) return
        setLines((d.lines as BoqLine[]) ?? [])
        setTotals(d.totals as Record<string, number>)
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : 'Failed')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [projectId, api, refreshKey])

  const filtered = useMemo(() => lines.filter((l) =>
    (system === 'COMBINED' || l.system === system) &&
    (!q || `${l.name} ${l.brand} ${l.specification} ${l.size} ${l.category}`.toLowerCase().includes(q.toLowerCase())),
  ), [lines, system, q])

  const saveOverride = async () => {
    if (!ovDialog) return
    try {
      await api(`/api/boq/${projectId}/override`, {
        method: 'POST',
        body: JSON.stringify({ itemKey: ovDialog.key, qty: ovForm.qty, reason: ovForm.reason, userName: useAppStore.getState().user?.name }),
      })
      toast.success('Override saved (with history)')
      setOvDialog(null); setRefreshKey((k) => k + 1)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="font-semibold">{t('consolidatedBoq')}</h2>
        <div className="flex gap-2 flex-wrap">
          <Select value={system} onValueChange={setSystem}>
            <SelectTrigger className="w-[140px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="COMBINED">Combined</SelectItem>
              <SelectItem value="ELECTRICAL">Electrical</SelectItem>
              <SelectItem value="PLUMBING">Plumbing</SelectItem>
            </SelectContent>
          </Select>
          <Input placeholder={t('search')} value={q} onChange={(e) => setQ(e.target.value)} className="w-[180px] h-9" />
          <Button size="sm" variant="outline" onClick={() => exportCsv(boqRows(filtered), 'boq.csv')}><FileSpreadsheet className="w-3.5 h-3.5 mr-1" />CSV</Button>
          <Button size="sm" variant="outline" onClick={() => exportExcel(boqRows(filtered), 'boq.xlsx', 'BOQ')}><FileSpreadsheet className="w-3.5 h-3.5 mr-1" />Excel</Button>
        </div>
      </div>

      {totals && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            ['Purchase Cost', fmtBDT(totals.purchaseCost), 'text-slate-700'],
            ['Selling Total', fmtBDT(totals.sellingTotal), 'text-emerald-700'],
            [t('profit'), fmtBDT(totals.profit), 'text-amber-700'],
            [t('shortage'), String(totals.shortageCount) + ' items', 'text-rose-600'],
          ].map(([k, v, c]) => (
            <Card key={k} className="p-3"><div className="text-[10px] text-slate-500">{k}</div><div className={`text-base font-bold ${c}`}>৳ {v}</div></Card>
          ))}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {loading ? <Skeleton className="h-72 rounded-none" /> : filtered.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-10">{t('noData')} — {t('runEstimation')} first</p>
          ) : (
            <div className="max-h-[560px] overflow-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full">
              <Table>
                <TableHeader className="sticky top-0 bg-white shadow-sm">
                  <TableRow>
                    <TableHead className="text-xs w-8">#</TableHead>
                    <TableHead className="text-xs min-w-[220px]">Material</TableHead>
                    <TableHead className="text-xs">{t('estQty')}</TableHead>
                    <TableHead className="text-xs">{t('verifiedQty')}</TableHead>
                    <TableHead className="text-xs">{t('finalQty')}</TableHead>
                    <TableHead className="text-xs">{t('purchaseQty')}</TableHead>
                    <TableHead className="text-xs">{t('stock')}</TableHead>
                    <TableHead className="text-xs">{t('shortage')}</TableHead>
                    <TableHead className="text-xs">Buy ৳</TableHead>
                    <TableHead className="text-xs">Sell ৳</TableHead>
                    <TableHead className="text-xs w-8"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((l) => (
                    <Fragment key={l.key}>
                      <TableRow className="cursor-pointer hover:bg-slate-50" onClick={() => setExpanded(expanded === l.key ? null : l.key)}>
                        <TableCell className="text-[10px] text-slate-400">{l.itemNo}</TableCell>
                        <TableCell className="text-xs">
                          <div className="font-medium leading-tight">{l.name}</div>
                          <div className="text-[10px] text-slate-400 flex gap-1.5 flex-wrap">
                            <Badge variant="outline" className={`text-[8px] px-1 h-4 ${l.system === 'ELECTRICAL' ? 'border-amber-300 text-amber-700' : 'border-cyan-300 text-cyan-700'}`}>{l.system === 'ELECTRICAL' ? 'E' : 'P'}</Badge>
                            {l.brand && <span>{l.brand}</span>}
                            {l.size && <span>· {l.size}</span>}
                            <span>· {l.unit}</span>
                            <Badge className={`text-[8px] px-1 h-4 ${l.modeMix === 'DRAWING' ? 'bg-emerald-100 text-emerald-800' : l.modeMix === 'MIXED' ? 'bg-teal-100 text-teal-800' : 'bg-amber-100 text-amber-800'}`}>{l.modeMix}</Badge>
                            {l.override !== undefined && <Badge className="text-[8px] px-1 h-4 bg-violet-100 text-violet-800">OVR</Badge>}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">{l.qtyAuto ? Math.round(l.qtyAuto * 100) / 100 : '—'}
                          {l.unit === 'm' && fmt.prefs.lengthUnit !== 'm' && !!l.qtyAuto && (
                            <span className="block text-[9px] text-slate-400">≈ {fmt.len(l.qtyAuto)} {fmt.lenSym}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{l.qtyDrawing ? Math.round(l.qtyDrawing * 100) / 100 : '—'}
                          {l.unit === 'm' && fmt.prefs.lengthUnit !== 'm' && !!l.qtyDrawing && (
                            <span className="block text-[9px] text-slate-400">≈ {fmt.len(l.qtyDrawing)} {fmt.lenSym}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs font-semibold">{Math.round(l.qtyFinal * 100) / 100}
                          {l.unit === 'm' && fmt.prefs.lengthUnit !== 'm' && (
                            <span className="block text-[9px] text-slate-400">≈ {fmt.len(l.qtyFinal)} {fmt.lenSym}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{l.purchaseQty}{l.packSize > 1 ? <span className="text-[9px] text-slate-400 block">{l.packSize}{l.packUnit === 'Coil' ? 'm coil' : ''}</span> : ''}
                          {l.unit === 'm' && fmt.prefs.lengthUnit !== 'm' && (
                            <span className="block text-[9px] text-slate-400">≈ {fmt.len(l.purchaseQty)} {fmt.lenSym}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{l.stockQty || '—'}
                          {l.unit === 'm' && fmt.prefs.lengthUnit !== 'm' && !!l.stockQty && (
                            <span className="block text-[9px] text-slate-400">≈ {fmt.len(l.stockQty)} {fmt.lenSym}</span>
                          )}
                        </TableCell>
                        <TableCell>{l.shortage > 0 ? <Badge variant="destructive" className="text-[9px]">{l.shortage}</Badge> : <span className="text-emerald-500 text-xs">✓</span>}</TableCell>
                        <TableCell className="text-xs">{fmtBDT(l.totalPurchaseCost)}</TableCell>
                        <TableCell className="text-xs text-emerald-700">{fmtBDT(l.totalSellingPrice)}</TableCell>
                        <TableCell>
                          {!readOnly && (
                            <Button size="icon" variant="ghost" className="h-6 w-6 text-violet-500" title={t('overrideQty')}
                              onClick={(e) => { e.stopPropagation(); setOvDialog(l); setOvForm({ qty: l.qtyFinal, reason: '' }) }}>
                              <Pencil className="w-3 h-3" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                      {expanded === l.key && (
                        <TableRow className="bg-slate-50">
                          <TableCell></TableCell>
                          <TableCell colSpan={10} className="py-3">
                            <div className="text-[11px] space-y-2">
                              <div className="flex flex-wrap gap-x-6 gap-y-1 text-slate-600">
                                <span><b>Wastage:</b> {l.wastagePct}% → {Math.round(l.qtyWithWastage * 100) / 100} {l.unit}{l.unit === 'm' && fmt.prefs.lengthUnit !== 'm' ? ` (≈ ${fmt.lenS(l.qtyWithWastage)})` : ''}</span>
                                <span><b>Unit buy:</b> ৳{l.unitPurchasePrice} · <b>sell:</b> ৳{l.unitSellingPrice}</span>
                                <span><b>{t('profit')}:</b> ৳{fmtBDT(l.profit)}</span>
                              </div>
                              <div>
                                <div className="font-semibold text-slate-700 mb-1">{t('itemBreakdown')}:</div>
                                <div className="flex flex-wrap gap-1">
                                  {l.breakdown.slice(0, 40).map((b, i) => (
                                    <Badge key={i} variant="outline" className="text-[9px] font-normal">
                                      {b.floorName}{b.roomName ? ` › ${b.roomName}` : ''}: {b.qty} ({b.mode})
                                    </Badge>
                                  ))}
                                  {l.breakdown.length > 40 && <Badge variant="outline" className="text-[9px]">+{l.breakdown.length - 40} more</Badge>}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Override dialog */}
      <Dialog open={!!ovDialog} onOpenChange={(o) => !o && setOvDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{t('overrideQty')}</DialogTitle></DialogHeader>
          <p className="text-xs text-slate-500">{ovDialog?.name}</p>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>{t('finalQty')} ({ovDialog?.unit})</Label>
              <Input type="number" value={ovForm.qty} onChange={(e) => setOvForm({ ...ovForm, qty: Number(e.target.value) })} /></div>
            <div className="space-y-1.5"><Label>{t('reason')} *</Label>
              <Input value={ovForm.reason} onChange={(e) => setOvForm({ ...ovForm, reason: e.target.value })} placeholder="Site verification / client request..." /></div>
            <p className="text-[10px] text-slate-400 flex gap-1"><Info className="w-3 h-3" /> Change history is recorded automatically (user + timestamp + reason).</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOvDialog(null)}>{t('cancel')}</Button>
            <Button className="bg-violet-600 hover:bg-violet-700 text-white" onClick={saveOverride} disabled={!ovForm.reason.trim()}>{t('save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ============================ Procurement ============================
interface PurchaseData {
  purchaseList: Array<Record<string, unknown>>
  bySupplier: Array<Record<string, unknown>>
  totalPurchaseCost: number
}

function ProcurementTab({ projectId }: { projectId: string }) {
  const t = useT()
  const fmt = useFmt()
  const api = useApi<Record<string, unknown>>()
  const [data, setData] = useState<PurchaseData | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    api(`/api/purchase-list/${projectId}`)
      .then((d) => setData(d as unknown as PurchaseData))
      .catch((e) => setErr(e.message))
  }, [projectId])  

  if (err) {
    return <Alert><AlertTriangle className="w-4 h-4" /><AlertDescription className="text-xs">{err} — run {t('estimation')} first.</AlertDescription></Alert>
  }
  if (!data) return <Skeleton className="h-64 rounded-xl" />

  return (
    <div className="space-y-4">
      <h2 className="font-semibold flex items-center gap-2"><ShoppingCart className="w-4.5 h-4.5 text-emerald-600" /> {t('purchaseList')} ({t('shortage')} only)</h2>
      <div className="grid grid-cols-2 gap-2 max-w-md">
        <Card className="p-3"><div className="text-[10px] text-slate-500">{t('totalCost')} (shortage)</div><div className="text-lg font-bold text-rose-600">৳ {fmtBDT(data.totalPurchaseCost)}</div></Card>
        <Card className="p-3"><div className="text-[10px] text-slate-500">{t('suppliers')}</div><div className="text-lg font-bold">{data.bySupplier.length}</div></Card>
      </div>

      {data.bySupplier.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">{t('supplier')}-wise summary</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {data.bySupplier.map((s, i) => (
              <Badge key={i} variant="outline" className="text-xs py-1.5 px-3 font-normal">
                {String(s.supplier)} — {String(s.items)} items · ৳{fmtBDT(Number(s.totalCost))}
              </Badge>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="max-h-[480px] overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full">
            <Table>
              <TableHeader className="sticky top-0 bg-white">
                <TableRow>
                  <TableHead className="text-xs">#</TableHead><TableHead className="text-xs">Material</TableHead>
                  <TableHead className="text-xs">{t('qty')}</TableHead><TableHead className="text-xs">{t('purchaseQty')}</TableHead>
                  <TableHead className="text-xs">{t('stock')}</TableHead><TableHead className="text-xs">{t('shortage')}</TableHead>
                  <TableHead className="text-xs">{t('supplier')}</TableHead><TableHead className="text-xs">Est. ৳</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.purchaseList.map((p, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-[10px] text-slate-400">{String(p.itemNo)}</TableCell>
                    <TableCell className="text-xs font-medium max-w-[240px] truncate" title={`${p.specification}`}>
                      {String(p.name)} {p.size ? <span className="text-slate-400">· {String(p.size)}</span> : ''}
                    </TableCell>
                    <TableCell className="text-xs">{String(p.required)} {String(p.unit)}
                      {String(p.unit) === 'm' && fmt.prefs.lengthUnit !== 'm' && (
                        <span className="block text-[9px] text-slate-400">≈ {fmt.len(Number(p.required))} {fmt.lenSym}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs font-semibold">{String(p.purchaseQty)}</TableCell>
                    <TableCell className="text-xs">{String(p.stock)}</TableCell>
                    <TableCell><Badge variant="destructive" className="text-[9px]">{String(p.shortage)}</Badge></TableCell>
                    <TableCell className="text-xs">{String(p.supplier)}</TableCell>
                    <TableCell className="text-xs">৳{fmtBDT(Number(p.estCost))}</TableCell>
                  </TableRow>
                ))}
                {data.purchaseList.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="text-center text-xs text-emerald-600 py-8">✓ No shortage — stock covers all requirements</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      <Button variant="outline" size="sm" onClick={() => exportCsv(data.purchaseList, 'purchase-list.csv')}>
        <FileSpreadsheet className="w-3.5 h-3.5 mr-1" /> {t('exportCsv')}
      </Button>
    </div>
  )
}

