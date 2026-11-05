
// =============================================================================
// FloorPlanEditor — 2D SVG CAD editor for electrical & plumbing floor plans.
// World coordinates are stored in METERS (DrawingDocData contract); rendering
// converts meters -> px via pxPerMeter * zoom. See worklog Task 9-a.
// =============================================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DrawingDocData, DrawingRoom, DrawingRoute, DrawingSymbol } from '@/lib/engine/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useToast } from '@/hooks/use-toast'
import { useApi, useT } from '@/lib/store'
import { useFmt } from '@/lib/unit-store'
import { cn } from '@/lib/utils'
import {
  Cable,
  ChevronLeft,
  ChevronRight,
  Download,
  Droplets,
  Hand,
  ImageDown,
  ImagePlus,
  Layers,
  LayoutGrid,
  Loader2,
  Maximize,
  MousePointer2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Redo2,
  Route as RouteIcon,
  Ruler,
  Save,
  Square,
  Trash2,
  Undo2,
  Waves,
  Zap,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import {
  MIN_ROOM,
  SNAP_GRID,
  bboxOfPoints,
  clamp,
  dedupePoints,
  dist,
  fmtM,
  padRect,
  pointInRect,
  pointSegDist,
  polylineLength,
  polylineMidpoint,
  rectFrom,
  round2,
  snap,
  snapPt,
  uid,
  unionRect,
  type Pt,
  type Rect,
} from './geometry'
import {
  CABLE_KINDS,
  ELECTRICAL_DEFS,
  PIPE_KINDS,
  PLUMBING_DEFS,
  SymbolGlyph,
  SymbolPreview,
  cableColor,
  cableDefaultSpec,
  findSymbolDef,
  pipeColor,
  pipeDefaultSpec,
  routeColor,
  routeLabel,
  symbolSvgString,
  systemColor,
  type SymSystem,
} from './symbols'

// -----------------------------------------------------------------------------
// Local types & constants
// -----------------------------------------------------------------------------

type Tool = 'select' | 'pan' | 'room' | 'symbol' | 'cable' | 'pipe' | 'calibrate'
type LayoutMode = 'BOTH' | 'ELECTRICAL' | 'PLUMBING'
type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

interface Layers {
  bg: boolean
  bgOpacity: number
  electrical: boolean
  plumbing: boolean
  cables: boolean
  pipes: boolean
  grid: boolean
}

interface View {
  zoom: number
  tx: number
  ty: number
}

type Selection =
  | { kind: 'room'; id: string }
  | { kind: 'symbol'; id: string }
  | { kind: 'route'; id: string }
  | null

type DragState =
  | { mode: 'pan'; sx: number; sy: number; tx: number; ty: number }
  | { mode: 'room-draw'; start: Pt }
  | { mode: 'move-room'; id: string; start: Pt; orig: Rect }
  | { mode: 'resize-room'; id: string; orig: Rect; handle: Handle }
  | { mode: 'move-symbol'; id: string; off: Pt }
  | { mode: 'move-route'; id: string; start: Pt; orig: Pt[] }
  | { mode: 'vertex'; id: string; index: number }

interface DrawingRow {
  id: string
  projectId: string
  floorNumber: number
  data: string
  scalePxPerMeter: number
  calibrated: boolean
  updatedAt: string
}

interface FloorProp {
  id: string
  floorNumber: number
  name: string
  height: number
}

const HANDLES: Array<{ h: Handle; fx: number; fy: number }> = [
  { h: 'nw', fx: 0, fy: 0 },
  { h: 'n', fx: 0.5, fy: 0 },
  { h: 'ne', fx: 1, fy: 0 },
  { h: 'e', fx: 1, fy: 0.5 },
  { h: 'se', fx: 1, fy: 1 },
  { h: 's', fx: 0.5, fy: 1 },
  { h: 'sw', fx: 0, fy: 1 },
  { h: 'w', fx: 0, fy: 0.5 },
]

const TOOL_LABELS: Record<Tool, string> = {
  select: 'Select / Move',
  pan: 'Pan',
  room: 'Draw Room',
  symbol: 'Place Symbol',
  cable: 'Cable Route',
  pipe: 'Pipe Route',
  calibrate: 'Calibrate Scale',
}

function emptyDoc(): DrawingDocData {
  return {
    version: 1,
    pxPerMeter: 40,
    calibrated: false,
    backgroundImage: null,
    rooms: [],
    symbols: [],
    routes: [],
  }
}

function cloneDoc(d: DrawingDocData): DrawingDocData {
  return JSON.parse(JSON.stringify(d)) as DrawingDocData
}

function parseDoc(row: DrawingRow): DrawingDocData {
  const base = emptyDoc()
  try {
    const p = JSON.parse(row.data) as Partial<DrawingDocData>
    if (p && typeof p === 'object') Object.assign(base, p)
  } catch {
    /* corrupted row -> fresh doc */
  }
  if (!Array.isArray(base.rooms)) base.rooms = []
  if (!Array.isArray(base.symbols)) base.symbols = []
  if (!Array.isArray(base.routes)) base.routes = []
  if (!Number.isFinite(base.pxPerMeter) || base.pxPerMeter <= 0) {
    base.pxPerMeter = row.scalePxPerMeter > 0 ? row.scalePxPerMeter : 40
  }
  base.calibrated = Boolean(base.calibrated)
  return base
}

function symbolSizeFor(type: string, system: SymSystem): number {
  return findSymbolDef(type, system)?.sizeM ?? 0.5
}

function symbolSizeOf(s: DrawingSymbol): number {
  return symbolSizeFor(s.type, s.system)
}

function pathOf(pts: Pt[]): string {
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${round2(p.x)} ${round2(p.y)}`).join(' ')
}

function roomAtPoint(rooms: DrawingRoom[], p: Pt): DrawingRoom | null {
  for (let i = rooms.length - 1; i >= 0; i--) {
    if (pointInRect(p, rooms[i])) return rooms[i]
  }
  return null
}

function resizedRect(orig: Rect, handle: Handle, p: Pt): Rect {
  let x1 = orig.x
  let y1 = orig.y
  let x2 = orig.x + orig.w
  let y2 = orig.y + orig.h
  if (handle.includes('w')) x1 = snap(p.x, SNAP_GRID)
  if (handle.includes('e')) x2 = snap(p.x, SNAP_GRID)
  if (handle.includes('n')) y1 = snap(p.y, SNAP_GRID)
  if (handle.includes('s')) y2 = snap(p.y, SNAP_GRID)
  if (x2 - x1 < MIN_ROOM) {
    if (handle.includes('w')) x1 = x2 - MIN_ROOM
    else x2 = x1 + MIN_ROOM
  }
  if (y2 - y1 < MIN_ROOM) {
    if (handle.includes('n')) y1 = y2 - MIN_ROOM
    else y2 = y1 + MIN_ROOM
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

const escXml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const CABLE_KIND_OPTIONS = Object.keys(CABLE_KINDS).map((kk) => ({ value: kk, label: kk }))
const PIPE_KIND_OPTIONS = Object.keys(PIPE_KINDS).map((kk) => ({ value: kk, label: kk }))
const wireOptions = (kind: string): Array<{ value: string; label: string }> =>
  (CABLE_KINDS[kind]?.sizes ?? []).map((sz) => ({ value: String(sz), label: `${sz} mm²` }))
const pipeSpecOptions = (kind: string): Array<{ value: string; label: string }> =>
  (PIPE_KINDS[kind]?.specs ?? []).map((sp) => ({ value: sp, label: sp }))

// -----------------------------------------------------------------------------
// Tiny form fields (commit on blur / Enter -> no history spam while typing)
// -----------------------------------------------------------------------------

function TextField(props: { label: string; value: string; onCommit: (v: string) => void; placeholder?: string }) {
  const [txt, setTxt] = useState<string | null>(null)
  const commit = () => {
    if (txt === null) return
    const v = txt.trim()
    if (v !== props.value) props.onCommit(v)
    setTxt(null)
  }
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-slate-500">{props.label}</Label>
      <Input
        className="h-8 text-xs"
        value={txt ?? props.value}
        placeholder={props.placeholder}
        onChange={(e) => setTxt(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit()
            ;(e.target as HTMLInputElement).blur()
          }
        }}
      />
    </div>
  )
}

function NumberField(props: {
  label: string
  value: number
  onCommit: (v: number) => void
  step?: number
  min?: number
}) {
  const [txt, setTxt] = useState<string | null>(null)
  const commit = () => {
    if (txt === null) return
    const n = parseFloat(txt)
    if (Number.isFinite(n) && round2(n) !== round2(props.value)) props.onCommit(n)
    setTxt(null)
  }
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-slate-500">{props.label}</Label>
      <Input
        type="number"
        className="h-8 text-xs"
        step={props.step ?? 0.25}
        min={props.min}
        value={txt ?? String(round2(props.value))}
        onChange={(e) => setTxt(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit()
            ;(e.target as HTMLInputElement).blur()
          }
        }}
      />
    </div>
  )
}

function SectionCard(props: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-2.5 flex items-center gap-1.5">
        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-slate-100 text-slate-500">{props.icon}</span>
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{props.title}</h3>
      </div>
      <div className="space-y-2">{props.children}</div>
    </section>
  )
}

function TipBtn(props: { tip: string; shortcut?: string; side?: 'top' | 'bottom' | 'left' | 'right'; children: React.ReactElement }) {
  return (
    <Tooltip delayDuration={250}>
      <TooltipTrigger asChild>{props.children}</TooltipTrigger>
      <TooltipContent side={props.side ?? 'bottom'} className="text-[11px]">
        {props.tip}
        {props.shortcut ? (
          <span className="ml-1.5 rounded bg-white/20 px-1 py-0.5 font-mono text-[10px] leading-none">{props.shortcut}</span>
        ) : null}
      </TooltipContent>
    </Tooltip>
  )
}

function MiniSelect(props: {
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
  ariaLabel: string
  className?: string
}) {
  return (
    <Select value={props.value} onValueChange={props.onChange}>
      <SelectTrigger className={props.className ?? 'h-8 text-xs'} aria-label={props.ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {props.options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function DeleteBtn(props: { onClick: () => void; label: string }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 shrink-0 text-xs text-red-600 hover:bg-red-50 hover:text-red-700"
      onClick={props.onClick}
    >
      <Trash2 className="mr-1 h-3.5 w-3.5" /> {props.label}
    </Button>
  )
}

function PalBtn(props: {
  active: boolean
  accent: 'slate' | 'amber' | 'cyan'
  title: string
  onClick: () => void
  children: React.ReactNode
}) {
  const idleCls =
    props.accent === 'amber'
      ? 'border-amber-200 bg-amber-50/70 text-amber-800 hover:border-amber-400 hover:bg-amber-100'
      : props.accent === 'cyan'
        ? 'border-cyan-200 bg-cyan-50/70 text-cyan-800 hover:border-cyan-400 hover:bg-cyan-100'
        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400 hover:bg-slate-100'
  const activeCls =
    props.accent === 'amber'
      ? 'border-amber-600 bg-amber-100 text-amber-900 shadow-sm ring-2 ring-amber-500/40'
      : props.accent === 'cyan'
        ? 'border-cyan-600 bg-cyan-100 text-cyan-900 shadow-sm ring-2 ring-cyan-600/40'
        : 'border-slate-700 bg-slate-800 text-white shadow-sm ring-2 ring-slate-400/40'
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={props.title}
          aria-pressed={props.active}
          onClick={props.onClick}
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border transition-all active:scale-95 ${
            props.active ? activeCls : idleCls
          }`}
        >
          {props.children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-[11px]">
        {props.title}
      </TooltipContent>
    </Tooltip>
  )
}

// -----------------------------------------------------------------------------
// Main component
// -----------------------------------------------------------------------------

export default function FloorPlanEditor(props: {
  projectId: string
  floors: FloorProp[]
  userName?: string
}) {
  const { projectId, floors } = props
  const t = useT()
  const request = useApi<unknown>()
  const { toast } = useToast()
  // Unit-aware DISPLAY formatting (meters stay internal — see src/lib/units.ts).
  // Changing the display unit must never affect doc geometry, pxPerMeter,
  // zoom/pan or saved data; every fmt.* call below is render/display only.
  const fmt = useFmt()

  // ---- document / persistence state ------------------------------------------
  const [doc, setDoc] = useState<DrawingDocData>(emptyDoc)
  const docRef = useRef<DrawingDocData>(emptyDoc())
  const docsCache = useRef<Map<number, DrawingDocData>>(new Map())
  const [floorNumber, setFloorNumber] = useState<number>(floors[0]?.floorNumber ?? 0)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [floorSwitch, setFloorSwitch] = useState<number | null>(null)

  // ---- history ----------------------------------------------------------------
  const undoRef = useRef<DrawingDocData[]>([])
  const redoRef = useRef<DrawingDocData[]>([])
  const [hist, setHist] = useState({ u: 0, r: 0 })

  // ---- tools & drafts -----------------------------------------------------------
  const [tool, setToolState] = useState<Tool>('select')
  const [symType, setSymType] = useState<{ system: SymSystem; type: string } | null>(null)
  const [cableKind, setCableKind] = useState('LIGHT')
  const [cableSpec, setCableSpec] = useState('1.5')
  const [pipeKind, setPipeKind] = useState('COLD')
  const [pipeSpec, setPipeSpec] = useState('PPR-20')
  const [routeDraft, setRouteDraft] = useState<Pt[] | null>(null)
  const [routeCursor, setRouteCursor] = useState<Pt | null>(null)
  const [ghostPt, setGhostPt] = useState<Pt | null>(null)
  const [roomPreview, setRoomPreview] = useState<Rect | null>(null)
  const roomPreviewRef = useRef<Rect | null>(null)
  const [roomDialog, setRoomDialog] = useState<Rect | null>(null)
  const [roomName, setRoomName] = useState('')
  const [roomRoomId, setRoomRoomId] = useState('')
  const [calibP1, setCalibP1] = useState<Pt | null>(null)
  const [calibCursor, setCalibCursor] = useState<Pt | null>(null)
  const [calibDialog, setCalibDialog] = useState<{ px: number } | null>(null)
  const [calibInput, setCalibInput] = useState('3.0')

  // ---- view / layers / selection -------------------------------------------------
  const [layout, setLayout] = useState<LayoutMode>('BOTH')
  const [layers, setLayers] = useState<Layers>({
    bg: true,
    bgOpacity: 65,
    electrical: true,
    plumbing: true,
    cables: true,
    pipes: true,
    grid: true,
  })
  const [view, setView] = useState<View>({ zoom: 1, tx: 60, ty: 60 })
  const viewRef = useRef(view)
  useEffect(() => {
    viewRef.current = view
  }, [view])
  const [size, setSize] = useState({ w: 900, h: 520 })
  const [cursorM, setCursorM] = useState<Pt | null>(null)
  const [selection, setSelection] = useState<Selection>(null)
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null)
  const pendingFitRef = useRef(false)

  // ---- sidebar minimization (pure layout toggle — never touches view/zoom/doc) ----
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)

  // ---- refs & elements ------------------------------------------------------------
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const spaceRef = useRef(false)
  const bgInputRef = useRef<HTMLInputElement | null>(null)

  const P = doc.pxPerMeter || 40
  const k = P * view.zoom
  const floorLabel = floors.find((f) => f.floorNumber === floorNumber)?.name ?? `Floor ${floorNumber}`

  // -----------------------------------------------------------------------------
  // Document mutations with undo history
  // -----------------------------------------------------------------------------

  const snapshot = useCallback(() => {
    undoRef.current.push(cloneDoc(docRef.current))
    if (undoRef.current.length > 50) undoRef.current.shift()
    redoRef.current = []
    setHist({ u: undoRef.current.length, r: 0 })
  }, [])

  const applyDoc = useCallback(
    (next: DrawingDocData, opts?: { history?: boolean }) => {
      if (opts?.history !== false) snapshot()
      docRef.current = next
      docsCache.current.set(floorNumber, next)
      setDoc(next)
      setDirty(true)
    },
    [floorNumber, snapshot],
  )

  const undo = useCallback(() => {
    const prev = undoRef.current.pop()
    if (!prev) return
    redoRef.current.push(cloneDoc(docRef.current))
    docRef.current = prev
    docsCache.current.set(floorNumber, prev)
    setDoc(prev)
    setDirty(true)
    setHist({ u: undoRef.current.length, r: redoRef.current.length })
  }, [floorNumber])

  const redo = useCallback(() => {
    const next = redoRef.current.pop()
    if (!next) return
    undoRef.current.push(cloneDoc(docRef.current))
    docRef.current = next
    docsCache.current.set(floorNumber, next)
    setDoc(next)
    setDirty(true)
    setHist({ u: undoRef.current.length, r: redoRef.current.length })
  }, [floorNumber])

  // -----------------------------------------------------------------------------
  // Coordinate transforms
  // -----------------------------------------------------------------------------

  const evtScreen = useCallback((e: { clientX: number; clientY: number }): Pt => {
    const rect = svgRef.current?.getBoundingClientRect()
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) }
  }, [])

  const worldFromScreen = useCallback((sx: number, sy: number): Pt => {
    const v = viewRef.current
    const kk = (docRef.current.pxPerMeter || 40) * v.zoom
    return { x: (sx - v.tx) / kk, y: (sy - v.ty) / kk }
  }, [])

  const evtWorldPt = useCallback(
    (e: { clientX: number; clientY: number }): Pt => {
      const s = evtScreen(e)
      return worldFromScreen(s.x, s.y)
    },
    [evtScreen, worldFromScreen],
  )

  // -----------------------------------------------------------------------------
  // Floor loading / switching / saving
  // -----------------------------------------------------------------------------

  const measureImage = useCallback((src: string) => {
    const img = new window.Image()
    img.onload = () => setImgSize({ w: img.naturalWidth, h: img.naturalHeight })
    img.src = src
  }, [])

  const loadFloor = useCallback(
    (n: number) => {
      const d = docsCache.current.get(n) ?? emptyDoc()
      docRef.current = d
      setDoc(d)
      setFloorNumber(n)
      setDirty(false)
      setSelection(null)
      setRouteDraft(null)
      setRouteCursor(null)
      setCalibP1(null)
      setCalibCursor(null)
      setCalibDialog(null)
      setRoomPreview(null)
      roomPreviewRef.current = null
      setGhostPt(null)
      setToolState('select')
      setSymType(null)
      undoRef.current = []
      redoRef.current = []
      setHist({ u: 0, r: 0 })
      if (d.backgroundImage) measureImage(d.backgroundImage)
      else setImgSize(null)
      pendingFitRef.current = d.rooms.length > 0 || d.routes.length > 0
    },
    [measureImage],
  )

  useEffect(() => {
    let alive = true
    setLoading(true)
    const run = async () => {
      try {
        const res = (await request(`/api/drawings/${projectId}`)) as { drawings?: DrawingRow[] }
        if (!alive) return
        docsCache.current.clear()
        for (const row of res.drawings ?? []) {
          docsCache.current.set(row.floorNumber, parseDoc(row))
        }
        loadFloor(floors[0]?.floorNumber ?? 0)
      } catch (err) {
        if (alive) {
          toast({
            title: 'Failed to load drawings',
            description: err instanceof Error ? err.message : 'Unknown error',
            variant: 'destructive',
          })
        }
      } finally {
        if (alive) setLoading(false)
      }
    }
    void run()
    return () => {
      alive = false
    }
  }, [projectId])

  const handleSave = useCallback(async (): Promise<boolean> => {
    setSaving(true)
    try {
      const d = docRef.current
      const stamped: DrawingDocData = {
        ...d,
        symbols: d.symbols.map((s) => ({ ...s, floorNumber })),
        routes: d.routes.map((r) => ({ ...r, floorNumber })),
      }
      await request(`/api/drawings/${projectId}`, {
        method: 'PUT',
        body: JSON.stringify({
          data: JSON.stringify(stamped),
          floorNumber,
          scalePxPerMeter: d.pxPerMeter,
          calibrated: d.calibrated,
        }),
      })
      docsCache.current.set(floorNumber, stamped)
      docRef.current = stamped
      setDoc(stamped)
      setDirty(false)
      toast({
        title: 'Drawing saved ✓',
        description: `${floorLabel} — ${d.rooms.length} rooms, ${d.symbols.length} symbols, ${d.routes.length} routes`,
      })
      return true
    } catch (err) {
      toast({
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      })
      return false
    } finally {
      setSaving(false)
    }
  }, [floorLabel, floorNumber, projectId, request, toast])

  const switchFloor = useCallback(
    (n: number) => {
      if (n === floorNumber) return
      loadFloor(n)
    },
    [floorNumber, loadFloor],
  )

  const onFloorSelect = (n: number) => {
    if (n === floorNumber) return
    if (dirty) setFloorSwitch(n)
    else switchFloor(n)
  }

  // -----------------------------------------------------------------------------
  // Wheel zoom / pan (native listener — React onWheel is passive)
  // -----------------------------------------------------------------------------

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const v = viewRef.current
      const pp = docRef.current.pxPerMeter || 40
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect()
        const mx = e.clientX - rect.left
        const my = e.clientY - rect.top
        const kOld = pp * v.zoom
        const zoom = clamp(v.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 0.1, 24)
        const kNew = pp * zoom
        setView({
          zoom,
          tx: mx - ((mx - v.tx) / kOld) * kNew,
          ty: my - ((my - v.ty) / kOld) * kNew,
        })
      } else {
        setView({ ...v, tx: v.tx - e.deltaX, ty: v.ty - e.deltaY })
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // ---- container resize ------------------------------------------------------------
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect
      if (r && r.width > 0) setSize({ w: r.width, h: r.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // -----------------------------------------------------------------------------
  // Content bbox / fit-to-view
  // -----------------------------------------------------------------------------

  const contentBbox = useCallback(
    (d: DrawingDocData, includeImage: boolean): Rect | null => {
      let bbox: Rect | null = null
      for (const r of d.rooms) bbox = unionRect(bbox, { x: r.x, y: r.y, w: r.w, h: r.h })
      for (const s of d.symbols) {
        const sz = symbolSizeOf(s)
        bbox = unionRect(bbox, { x: s.x - sz / 2, y: s.y - sz / 2, w: sz, h: sz })
      }
      for (const r of d.routes) bbox = unionRect(bbox, bboxOfPoints(r.points))
      if (includeImage && imgSize && d.backgroundImage) {
        bbox = unionRect(bbox, { x: 0, y: 0, w: imgSize.w / (d.pxPerMeter || 40), h: imgSize.h / (d.pxPerMeter || 40) })
      }
      return bbox
    },
    [imgSize],
  )

  const fitToView = useCallback(() => {
    const d = docRef.current
    const pp = d.pxPerMeter || 40
    const bbox = contentBbox(d, true)
    if (!bbox) {
      setView({ zoom: 1, tx: 60, ty: 60 })
      return
    }
    const pb = padRect(bbox, 0.8)
    const kk = Math.min(size.w / pb.w, size.h / pb.h)
    const zoom = clamp(kk / pp, 0.1, 24)
    const keff = pp * zoom
    setView({
      zoom,
      tx: (size.w - pb.w * keff) / 2 - pb.x * keff,
      ty: (size.h - pb.h * keff) / 2 - pb.y * keff,
    })
  }, [contentBbox, size.h, size.w])

  useEffect(() => {
    if (pendingFitRef.current && !loading) {
      pendingFitRef.current = false
      fitToView()
    }
  }, [fitToView, loading, size.h, size.w])

  const zoomBy = (factor: number) => {
    setView((v) => {
      const pp = docRef.current.pxPerMeter || 40
      const zoom = clamp(v.zoom * factor, 0.1, 24)
      const kOld = pp * v.zoom
      const kNew = pp * zoom
      const cx = size.w / 2
      const cy = size.h / 2
      return {
        zoom,
        tx: cx - ((cx - v.tx) / kOld) * kNew,
        ty: cy - ((cy - v.ty) / kOld) * kNew,
      }
    })
  }

  // -----------------------------------------------------------------------------
  // Visibility / dimming helpers
  // -----------------------------------------------------------------------------

  const symbolLayerOn = useCallback(
    (s: DrawingSymbol) => (s.system === 'ELECTRICAL' ? layers.electrical : layers.plumbing),
    [layers.electrical, layers.plumbing],
  )
  const symbolOpacity = useCallback(
    (s: DrawingSymbol) => (layout === 'BOTH' || layout === s.system ? 1 : 0.15),
    [layout],
  )
  const routeLayerOn = useCallback(
    (r: DrawingRoute) => (r.system === 'cable' ? layers.cables : layers.pipes),
    [layers.cables, layers.pipes],
  )
  const routeOpacity = useCallback(
    (r: DrawingRoute) => {
      const sys: SymSystem = r.system === 'cable' ? 'ELECTRICAL' : 'PLUMBING'
      return layout === 'BOTH' || layout === sys ? 1 : 0.15
    },
    [layout],
  )

  // -----------------------------------------------------------------------------
  // Mutations: place / add / update / delete
  // -----------------------------------------------------------------------------

  const placeSymbol = (p: Pt) => {
    if (!symType) return
    const room = roomAtPoint(docRef.current.rooms, p)
    const sym: DrawingSymbol = {
      id: uid('sym'),
      type: symType.type,
      system: symType.system,
      floorNumber,
      roomId: room?.roomId,
      x: p.x,
      y: p.y,
    }
    applyDoc({ ...docRef.current, symbols: [...docRef.current.symbols, sym] })
    setSelection({ kind: 'symbol', id: sym.id })
  }

  const finishRoute = useCallback(() => {
    if (!routeDraft) return
    const pts = dedupePoints(routeDraft)
    setRouteDraft(null)
    setRouteCursor(null)
    if (pts.length < 2) return
    const isCable = tool === 'cable'
    const kind = isCable ? cableKind : pipeKind
    const spec = isCable ? cableSpec : pipeSpec
    const route: DrawingRoute = {
      id: uid('rte'),
      system: isCable ? 'cable' : 'pipe',
      kind,
      spec,
      floorNumber,
      roomId: roomAtPoint(docRef.current.rooms, pts[0])?.roomId,
      points: pts,
    }
    applyDoc({ ...docRef.current, routes: [...docRef.current.routes, route] })
    setSelection({ kind: 'route', id: route.id })
    setToolState('select')
    toast({
      title: `${isCable ? 'Cable' : 'Pipe'} route added`,
      description: `${kind} · ${fmt.lenS(polylineLength(pts))}`,
    })
  }, [applyDoc, cableKind, cableSpec, floorNumber, pipeKind, pipeSpec, routeDraft, toast, tool, fmt])

  const cancelActive = useCallback(() => {
    setRouteDraft(null)
    setRouteCursor(null)
    setCalibP1(null)
    setCalibCursor(null)
    setRoomPreview(null)
    roomPreviewRef.current = null
    setGhostPt(null)
    dragRef.current = null
    setToolState('select')
  }, [])

  const deleteSelection = useCallback(() => {
    const sel = selection
    if (!sel) return
    const d = docRef.current
    if (sel.kind === 'room') applyDoc({ ...d, rooms: d.rooms.filter((r) => r.roomId !== sel.id) })
    else if (sel.kind === 'symbol') applyDoc({ ...d, symbols: d.symbols.filter((s) => s.id !== sel.id) })
    else applyDoc({ ...d, routes: d.routes.filter((r) => r.id !== sel.id) })
    setSelection(null)
  }, [applyDoc, selection])

  const setTool = (next: Tool) => {
    setToolState(next)
    setRouteDraft(null)
    setRouteCursor(null)
    setCalibP1(null)
    setCalibCursor(null)
    setGhostPt(null)
    if (next !== 'select') setSelection(null)
  }

  const activateSymbol = (system: SymSystem, type: string) => {
    setTool('symbol')
    setSymType({ system, type })
  }

  const updateSelectedRoom = (patch: Partial<DrawingRoom>) => {
    if (selection?.kind !== 'room') return
    const id = selection.id
    applyDoc({
      ...docRef.current,
      rooms: docRef.current.rooms.map((r) => (r.roomId === id ? { ...r, ...patch } : r)),
    })
  }
  const updateSelectedSymbol = (patch: Partial<DrawingSymbol>) => {
    if (selection?.kind !== 'symbol') return
    const id = selection.id
    applyDoc({
      ...docRef.current,
      symbols: docRef.current.symbols.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    })
  }
  const updateSelectedRoute = (patch: Partial<DrawingRoute>) => {
    if (selection?.kind !== 'route') return
    const id = selection.id
    applyDoc({
      ...docRef.current,
      routes: docRef.current.routes.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    })
  }

  // -----------------------------------------------------------------------------
  // Background image & calibration
  // -----------------------------------------------------------------------------

  const onBgFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (!f.type.startsWith('image/')) {
      toast({ title: 'Unsupported file', description: 'Choose a JPG or PNG image.', variant: 'destructive' })
      return
    }
    if (f.size > 2 * 1024 * 1024) {
      toast({ title: 'Large image (>2MB)', description: 'Consider compressing it for smoother editing.' })
    }
    const reader = new FileReader()
    reader.onload = () => {
      const src = String(reader.result)
      measureImage(src)
      applyDoc({ ...docRef.current, backgroundImage: src })
      toast({ title: 'Background imported', description: 'Now calibrate the scale over a known dimension.' })
    }
    reader.readAsDataURL(f)
  }

  const removeBg = () => {
    applyDoc({ ...docRef.current, backgroundImage: null })
    setImgSize(null)
  }

  const applyCalibration = () => {
    if (!calibDialog) return
    // Input is in the ACTIVE display unit; convert to internal meters.
    const real = fmt.fromLen(parseFloat(calibInput))
    if (!Number.isFinite(real) || real <= 0) {
      toast({ title: 'Enter a valid length', variant: 'destructive' })
      return
    }
    const ppm = round2(calibDialog.px / real)
    if (ppm <= 0) return
    applyDoc({ ...docRef.current, pxPerMeter: ppm, calibrated: true })
    setCalibDialog(null)
    setCalibP1(null)
    setCalibCursor(null)
    setToolState('select')
    toast({ title: `Scale calibrated: ${ppm} px/m`, description: 'Coordinates are now in true meters.' })
  }

  // -----------------------------------------------------------------------------
  // Canvas pointer handlers
  // -----------------------------------------------------------------------------

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return
    const s = evtScreen(e)
    const w = worldFromScreen(s.x, s.y)

    // pan: middle button / space held / pan tool
    if (e.button === 1 || spaceRef.current || tool === 'pan') {
      e.preventDefault()
      dragRef.current = { mode: 'pan', sx: s.x, sy: s.y, tx: view.tx, ty: view.ty }
      svg.setPointerCapture(e.pointerId)
      return
    }
    if (e.button !== 0) return
    svg.setPointerCapture(e.pointerId)

    if (tool === 'calibrate') {
      if (!calibP1) {
        setCalibP1(w)
        setCalibCursor(w)
      } else {
        const px = dist(calibP1, w) * (docRef.current.pxPerMeter || 40)
        setCalibCursor(w)
        setCalibInput(fmt.len(3)) // suggested value in the active display unit
        setCalibDialog({ px })
      }
      return
    }
    if (tool === 'room') {
      const start = snapPt(w, SNAP_GRID)
      dragRef.current = { mode: 'room-draw', start }
      roomPreviewRef.current = { x: start.x, y: start.y, w: 0, h: 0 }
      setRoomPreview(roomPreviewRef.current)
      return
    }
    if (tool === 'symbol') {
      placeSymbol(snapPt(w, SNAP_GRID))
      return
    }
    if (tool === 'cable' || tool === 'pipe') {
      const p = snapPt(w, SNAP_GRID)
      setRouteDraft((prev) => (prev ? [...prev, p] : [p]))
      return
    }

    // ---- select tool: hit testing (top-down) ----
    const hitR = 8 / k

    // 1. vertex handles of the selected route
    if (selection?.kind === 'route') {
      const r = doc.routes.find((x) => x.id === selection.id)
      if (r && routeLayerOn(r) && routeOpacity(r) === 1) {
        for (let i = 0; i < r.points.length; i++) {
          if (dist(r.points[i], w) <= hitR) {
            snapshot()
            dragRef.current = { mode: 'vertex', id: r.id, index: i }
            return
          }
        }
      }
    }

    // 2. resize handles of the selected room
    if (selection?.kind === 'room') {
      const rm = doc.rooms.find((x) => x.roomId === selection.id)
      if (rm) {
        for (const hd of HANDLES) {
          const hp: Pt = { x: rm.x + rm.w * hd.fx, y: rm.y + rm.h * hd.fy }
          if (dist(hp, w) <= hitR) {
            snapshot()
            dragRef.current = { mode: 'resize-room', id: rm.roomId, orig: { ...rm }, handle: hd.h }
            return
          }
        }
      }
    }

    // 3. symbols (nearest within 13 px)
    let bestSym: DrawingSymbol | null = null
    let bestD = Infinity
    for (const sym of doc.symbols) {
      if (!symbolLayerOn(sym) || symbolOpacity(sym) !== 1) continue
      const dd = dist({ x: sym.x, y: sym.y }, w) * k
      if (dd <= 13 && dd < bestD) {
        bestD = dd
        bestSym = sym
      }
    }
    if (bestSym) {
      setSelection({ kind: 'symbol', id: bestSym.id })
      snapshot()
      dragRef.current = { mode: 'move-symbol', id: bestSym.id, off: { x: w.x - bestSym.x, y: w.y - bestSym.y } }
      return
    }

    // 4. route segments (within 6 px) -> select + whole-route move
    for (const r of doc.routes) {
      if (!routeLayerOn(r) || routeOpacity(r) !== 1) continue
      for (let i = 1; i < r.points.length; i++) {
        if (pointSegDist(w, r.points[i - 1], r.points[i]) * k <= 6) {
          setSelection({ kind: 'route', id: r.id })
          snapshot()
          dragRef.current = { mode: 'move-route', id: r.id, start: w, orig: r.points.map((p) => ({ ...p })) }
          return
        }
      }
    }

    // 5. rooms (topmost first)
    for (let i = doc.rooms.length - 1; i >= 0; i--) {
      const rm = doc.rooms[i]
      if (pointInRect(w, rm)) {
        setSelection({ kind: 'room', id: rm.roomId })
        snapshot()
        dragRef.current = { mode: 'move-room', id: rm.roomId, start: w, orig: { x: rm.x, y: rm.y, w: rm.w, h: rm.h } }
        return
      }
    }

    setSelection(null)
  }

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const s = evtScreen(e)
    const w = evtWorldPt(e)
    setCursorM(w)
    const d = dragRef.current
    if (!d) {
      if (routeDraft) setRouteCursor(snapPt(w, SNAP_GRID))
      else if (calibP1) setCalibCursor(w)
      else if (tool === 'symbol') setGhostPt(snapPt(w, SNAP_GRID))
      return
    }

    switch (d.mode) {
      case 'pan':
        setView((v) => ({ ...v, tx: d.tx + (s.x - d.sx), ty: d.ty + (s.y - d.sy) }))
        return
      case 'room-draw': {
        const r = rectFrom(d.start, snapPt(w, SNAP_GRID))
        roomPreviewRef.current = r
        setRoomPreview(r)
        return
      }
      case 'move-room': {
        const dx = snap(w.x - d.start.x, SNAP_GRID)
        const dy = snap(w.y - d.start.y, SNAP_GRID)
        applyDoc(
          {
            ...docRef.current,
            rooms: docRef.current.rooms.map((r) =>
              r.roomId === d.id ? { ...r, x: round2(d.orig.x + dx), y: round2(d.orig.y + dy) } : r,
            ),
          },
          { history: false },
        )
        return
      }
      case 'resize-room': {
        const nr = resizedRect(d.orig, d.handle, w)
        applyDoc(
          {
            ...docRef.current,
            rooms: docRef.current.rooms.map((r) =>
              r.roomId === d.id ? { ...r, x: nr.x, y: nr.y, w: round2(nr.w), h: round2(nr.h) } : r,
            ),
          },
          { history: false },
        )
        return
      }
      case 'move-symbol': {
        const p = snapPt({ x: w.x - d.off.x, y: w.y - d.off.y }, SNAP_GRID)
        applyDoc(
          {
            ...docRef.current,
            symbols: docRef.current.symbols.map((sym) => (sym.id === d.id ? { ...sym, x: p.x, y: p.y } : sym)),
          },
          { history: false },
        )
        return
      }
      case 'move-route': {
        const dx = snap(w.x - d.start.x, SNAP_GRID)
        const dy = snap(w.y - d.start.y, SNAP_GRID)
        applyDoc(
          {
            ...docRef.current,
            routes: docRef.current.routes.map((r) =>
              r.id === d.id
                ? { ...r, points: d.orig.map((p) => ({ x: round2(p.x + dx), y: round2(p.y + dy) })) }
                : r,
            ),
          },
          { history: false },
        )
        return
      }
      case 'vertex': {
        const p = snapPt(w, SNAP_GRID)
        applyDoc(
          {
            ...docRef.current,
            routes: docRef.current.routes.map((r) =>
              r.id === d.id
                ? { ...r, points: r.points.map((pp, i) => (i === d.index ? { x: p.x, y: p.y } : pp)) }
                : r,
            ),
          },
          { history: false },
        )
        return
      }
    }
  }

  const onPointerUp = () => {
    const d = dragRef.current
    dragRef.current = null
    if (!d) return
    if (d.mode === 'room-draw') {
      const r = roomPreviewRef.current
      roomPreviewRef.current = null
      setRoomPreview(null)
      if (r && r.w >= MIN_ROOM && r.h >= MIN_ROOM) {
        setRoomName('')
        setRoomRoomId('')
        setRoomDialog(r)
      }
    }
    if (d.mode === 'move-symbol') {
      const sym = docRef.current.symbols.find((x) => x.id === d.id)
      if (sym) {
        const rm = roomAtPoint(docRef.current.rooms, { x: sym.x, y: sym.y })
        if (rm?.roomId !== sym.roomId) {
          applyDoc(
            {
              ...docRef.current,
              symbols: docRef.current.symbols.map((x) => (x.id === d.id ? { ...x, roomId: rm?.roomId } : x)),
            },
            { history: false },
          )
        }
      }
    }
  }

  const onDoubleClick = () => {
    if (routeDraft) finishRoute()
  }

  // -----------------------------------------------------------------------------
  // Keyboard shortcuts
  // -----------------------------------------------------------------------------

  const actionsRef = useRef({ cancel: cancelActive, del: deleteSelection, finish: finishRoute, undo, redo })
  actionsRef.current = { cancel: cancelActive, del: deleteSelection, finish: finishRoute, undo, redo }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tg = e.target as HTMLElement | null
      if (
        tg &&
        (tg.tagName === 'INPUT' ||
          tg.tagName === 'TEXTAREA' ||
          tg.tagName === 'SELECT' ||
          tg.tagName === 'BUTTON' ||
          tg.isContentEditable)
      ) {
        if (e.code === 'Space') return // let focused buttons activate normally
        if (tg.tagName !== 'BUTTON') return
      }
      if (document.querySelector('[role="dialog"]')) return
      if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === '[' || e.key === ']')) {
        e.preventDefault()
        if (e.key === '[') setLeftOpen((v) => !v)
        else setRightOpen((v) => !v)
        return
      }
      if (e.code === 'Space') {
        spaceRef.current = true
        e.preventDefault()
        return
      }
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) actionsRef.current.redo()
        else actionsRef.current.undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        actionsRef.current.redo()
        return
      }
      if (e.key === 'Escape') {
        actionsRef.current.cancel()
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        actionsRef.current.del()
        return
      }
      if (e.key === 'Enter') {
        actionsRef.current.finish()
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceRef.current = false
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  // -----------------------------------------------------------------------------
  // Export (SVG string built from doc data; PNG via canvas)
  // -----------------------------------------------------------------------------

  const buildExportSvg = useCallback((): string | null => {
    const d = docRef.current
    const pp = d.pxPerMeter || 40
    const EXP = 40 // px per meter in the exported file
    let bbox = contentBbox(d, true)
    if (!bbox) bbox = { x: 0, y: 0, w: 8, h: 6 }
    bbox = padRect(bbox, 1)
    const out: string[] = []
    out.push(
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${round2(bbox.x)} ${round2(bbox.y)} ${round2(bbox.w)} ${round2(bbox.h)}" width="${Math.round(bbox.w * EXP)}" height="${Math.round(bbox.h * EXP)}" font-family="sans-serif">`,
    )
    out.push(
      `<rect x="${round2(bbox.x)}" y="${round2(bbox.y)}" width="${round2(bbox.w)}" height="${round2(bbox.h)}" fill="#ffffff"/>`,
    )
    if (layers.bg && d.backgroundImage && imgSize) {
      out.push(
        `<image x="0" y="0" width="${round2(imgSize.w / pp)}" height="${round2(imgSize.h / pp)}" href="${d.backgroundImage}" opacity="${layers.bgOpacity / 100}" preserveAspectRatio="none"/>`,
      )
    }
    for (const r of d.rooms) {
      out.push(
        `<rect x="${r.x}" y="${r.y}" width="${round2(r.w)}" height="${round2(r.h)}" fill="#f8fafc" stroke="#64748b" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`,
      )
      out.push(
        `<text x="${round2(r.x + r.w / 2)}" y="${round2(r.y + r.h / 2 - 0.12)}" font-size="0.3" fill="#334155" font-weight="600" text-anchor="middle">${escXml(r.name)}</text>`,
      )
      out.push(
        `<text x="${round2(r.x + r.w / 2)}" y="${round2(r.y + r.h / 2 + 0.26)}" font-size="0.24" fill="#64748b" text-anchor="middle">${fmt.len(r.w)}×${fmt.len(r.h)} ${fmt.lenSym}</text>`,
      )
    }
    for (const r of d.routes) {
      if (!routeLayerOn(r)) continue
      const color = routeColor(r.system, r.kind)
      const mid = polylineMidpoint(r.points)
      out.push(
        `<path d="${pathOf(r.points)}" fill="none" stroke="${color}" stroke-width="2.5" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round" opacity="${routeOpacity(r)}"/>`,
      )
      out.push(
        `<text x="${round2(mid.x)}" y="${round2(mid.y - 0.15)}" font-size="0.26" fill="${color}" font-weight="600" text-anchor="middle" stroke="#ffffff" stroke-width="0.06" paint-order="stroke" opacity="${routeOpacity(r)}">${escXml(routeLabel(r.system, r.kind, r.spec))} ${fmt.len(polylineLength(r.points))} ${fmt.lenSym}</text>`,
      )
    }
    for (const s of d.symbols) {
      if (!symbolLayerOn(s)) continue
      out.push(symbolSvgString(s.type, s.system, s.x, s.y, symbolSizeOf(s), symbolOpacity(s)))
      if (s.label) {
        out.push(
          `<text x="${s.x}" y="${round2(s.y + symbolSizeOf(s) * 0.9)}" font-size="0.22" fill="#334155" text-anchor="middle" opacity="${symbolOpacity(s)}">${escXml(s.label)}</text>`,
        )
      }
    }
    out.push(
      `<text x="${round2(bbox.x + 0.3)}" y="${round2(bbox.y + bbox.h - 0.3)}" font-size="0.32" fill="#94a3b8" font-weight="600">${escXml(`ElectroFlow BMS — ${floorLabel}${d.calibrated ? ` — ${round2(pp)} px/m` : ''}`)}</text>`,
    )
    out.push('</svg>')
    return out.join('\n')
  }, [
    contentBbox,
    floorLabel,
    imgSize,
    layers.bg,
    layers.bgOpacity,
    routeLayerOn,
    routeOpacity,
    symbolLayerOn,
    symbolOpacity,
    fmt,
  ])

  const downloadBlob = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 4000)
  }

  const exportSvg = () => {
    const svg = buildExportSvg()
    if (!svg) return
    downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `floor-${floorNumber}-plan.svg`)
    toast({ title: 'SVG exported ✓' })
  }

  const exportPng = () => {
    const svg = buildExportSvg()
    if (!svg) return
    const img = new window.Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth * 2 || 800
      canvas.height = img.naturalHeight * 2 || 600
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob((blob) => {
        if (blob) downloadBlob(blob, `floor-${floorNumber}-plan.png`)
      }, 'image/png')
      toast({ title: 'PNG exported ✓' })
    }
    img.onerror = () => toast({ title: 'PNG export failed', variant: 'destructive' })
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  }

  // -----------------------------------------------------------------------------
  // Room dialog commit
  // -----------------------------------------------------------------------------

  const commitRoom = () => {
    const r = roomDialog
    if (!r) return
    let roomId = roomRoomId.trim() || uid('room')
    while (docRef.current.rooms.some((x) => x.roomId === roomId)) roomId = `${roomId}-2`
    const name = roomName.trim() || `Room ${docRef.current.rooms.length + 1}`
    const room: DrawingRoom = { roomId, name, x: r.x, y: r.y, w: round2(r.w), h: round2(r.h) }
    applyDoc({ ...docRef.current, rooms: [...docRef.current.rooms, room] })
    setSelection({ kind: 'room', id: room.roomId })
    setRoomDialog(null)
    setRoomName('')
    setRoomRoomId('')
    setToolState('select')
  }

  // -----------------------------------------------------------------------------
  // Derived render data
  // -----------------------------------------------------------------------------

  const selRoom = selection?.kind === 'room' ? (doc.rooms.find((r) => r.roomId === selection.id) ?? null) : null
  const selSymbol = selection?.kind === 'symbol' ? (doc.symbols.find((s) => s.id === selection.id) ?? null) : null
  const selRoute = selection?.kind === 'route' ? (doc.routes.find((r) => r.id === selection.id) ?? null) : null

  const isEmpty = doc.rooms.length === 0 && doc.symbols.length === 0 && doc.routes.length === 0 && !doc.backgroundImage

  const cursor =
    dragRef.current?.mode === 'pan'
      ? 'grabbing'
      : tool === 'pan'
        ? 'grab'
        : tool === 'select'
          ? 'default'
          : 'crosshair'

  const gridEls = useMemo(() => {
    if (!layers.grid) return null
    const wx0 = -view.tx / k
    const wy0 = -view.ty / k
    const wx1 = (size.w - view.tx) / k
    const wy1 = (size.h - view.ty) / k
    const minor = 0.5
    const els: React.ReactNode[] = []
    const i0 = Math.ceil(wx0 / minor)
    const i1 = Math.floor(wx1 / minor)
    const j0 = Math.ceil(wy0 / minor)
    const j1 = Math.floor(wy1 / minor)
    const showMinor = i1 - i0 < 80 && j1 - j0 < 80
    const drawV = (x: number, key: string, major: boolean) => {
      els.push(
        <line
          key={key}
          x1={round2(x)}
          y1={round2(wy0)}
          x2={round2(x)}
          y2={round2(wy1)}
          stroke={x === 0 ? '#94a3b8' : major ? '#cbd5e1' : '#e8edf3'}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          shapeRendering="crispEdges"
        />,
      )
    }
    const drawH = (y: number, key: string, major: boolean) => {
      els.push(
        <line
          key={key}
          x1={round2(wx0)}
          y1={round2(y)}
          x2={round2(wx1)}
          y2={round2(y)}
          stroke={y === 0 ? '#94a3b8' : major ? '#cbd5e1' : '#e8edf3'}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          shapeRendering="crispEdges"
        />,
      )
    }
    if (showMinor) {
      for (let i = i0; i <= i1; i++) drawV(i * minor, `gx${i}`, i % 2 === 0)
      for (let j = j0; j <= j1; j++) drawH(j * minor, `gy${j}`, j % 2 === 0)
    } else {
      for (let i = Math.ceil(wx0); i <= Math.floor(wx1); i++) drawV(i, `gX${i}`, true)
      for (let j = Math.ceil(wy0); j <= Math.floor(wy1); j++) drawH(j, `gY${j}`, true)
    }
    els.push(<circle key="org" cx={0} cy={0} r={4 / k} fill="#94a3b8" />)
    return els
  }, [k, layers.grid, size.h, size.w, view.tx, view.ty])

  const draftColor = tool === 'pipe' ? pipeColor(pipeKind) : cableColor(cableKind)
  const previewPts = routeCursor && routeDraft ? [...routeDraft, routeCursor] : (routeDraft ?? [])
  const previewLen = polylineLength(previewPts)

  const cableTotal = doc.routes
    .filter((r) => r.system === 'cable')
    .reduce((acc, r) => acc + polylineLength(r.points), 0)
  const pipeTotal = doc.routes
    .filter((r) => r.system === 'pipe')
    .reduce((acc, r) => acc + polylineLength(r.points), 0)

  // ---- active tool indicator (floating pill on canvas) -----------------------------
  const toolBadge = useMemo(() => {
    if (tool === 'symbol' && symType) {
      const def = findSymbolDef(symType.type, symType.system)
      return { label: `Place · ${def?.label ?? symType.type}`, color: systemColor(symType.system) }
    }
    if (tool === 'cable') return { label: `Cable route · ${cableKind} · ${cableSpec} mm²`, color: cableColor(cableKind) }
    if (tool === 'pipe') return { label: `Pipe route · ${pipeKind} · ${pipeSpec}`, color: pipeColor(pipeKind) }
    if (tool === 'room') return { label: 'Draw room — drag on canvas', color: '#0f172a' }
    if (tool === 'calibrate')
      return { label: calibP1 ? 'Calibrate — click point 2' : 'Calibrate — click point 1', color: '#b45309' }
    if (tool === 'pan') return { label: 'Pan — drag canvas or wheel', color: '#0f172a' }
    return null
  }, [calibP1, cableKind, cableSpec, pipeKind, pipeSpec, symType, tool])

  // ---- floors guard ---------------------------------------------------------------
  if (floors.length === 0) {
    return (
      <div className="flex min-h-[480px] items-center justify-center rounded-xl border bg-white p-8 text-center text-sm text-slate-500">
        No floors defined for this project. Add floors first, then draw the plan here.
      </div>
    )
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <h2 className="sr-only">{t('floorPlan')}</h2>

      {/* ================= Top bar ================= */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-gradient-to-r from-slate-50 via-white to-slate-50 px-3 py-2">
        {/* Sidebar visibility toggles (layout only — view/zoom/scale untouched) */}
        <div className="flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm" role="group" aria-label="Panel visibility">
          <TipBtn tip={leftOpen ? 'Minimize tools panel' : 'Expand tools panel'} shortcut="[">
            <Button
              variant="ghost"
              size="icon"
              className={`h-7 w-7 ${leftOpen ? 'text-slate-800' : 'text-slate-400'}`}
              aria-label={leftOpen ? 'Minimize tools panel' : 'Expand tools panel'}
              aria-pressed={leftOpen}
              aria-expanded={leftOpen}
              aria-controls="editor-tool-palette"
              onClick={() => setLeftOpen((v) => !v)}
            >
              {leftOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
            </Button>
          </TipBtn>
          <TipBtn tip={rightOpen ? 'Minimize properties panel' : 'Expand properties panel'} shortcut="]">
            <Button
              variant="ghost"
              size="icon"
              className={`h-7 w-7 ${rightOpen ? 'text-slate-800' : 'text-slate-400'}`}
              aria-label={rightOpen ? 'Minimize properties panel' : 'Expand properties panel'}
              aria-pressed={rightOpen}
              aria-expanded={rightOpen}
              aria-controls="editor-properties"
              onClick={() => setRightOpen((v) => !v)}
            >
              {rightOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
            </Button>
          </TipBtn>
        </div>

        <Select value={String(floorNumber)} onValueChange={(v) => onFloorSelect(Number(v))}>
          <SelectTrigger className="h-8 w-40 bg-white text-xs shadow-sm" aria-label="Select floor">
            <SelectValue placeholder={t('floors')} />
          </SelectTrigger>
          <SelectContent>
            {floors.map((f) => (
              <SelectItem key={f.id} value={String(f.floorNumber)}>
                {f.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Separator orientation="vertical" className="hidden h-6 sm:block" />

        {/* Layout mode segmented control */}
        <div className="flex items-center gap-0.5 rounded-lg border border-slate-200 bg-slate-100 p-0.5" role="group" aria-label="Layout mode">
          {(
            [
              ['BOTH', 'Both', LayoutGrid],
              ['ELECTRICAL', 'Electric', Zap],
              ['PLUMBING', 'Plumbing', Droplets],
            ] as Array<[LayoutMode, string, typeof Zap]>
          ).map(([m, label, Icon]) => (
            <button
              key={m}
              type="button"
              onClick={() => setLayout(m)}
              aria-pressed={layout === m}
              className={`flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition-all ${
                layout === m
                  ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Icon className={`h-3.5 w-3.5 ${m === 'ELECTRICAL' ? 'text-amber-600' : m === 'PLUMBING' ? 'text-cyan-600' : ''}`} />
              <span className="hidden md:inline">{label}</span>
            </button>
          ))}
        </div>

        <Separator orientation="vertical" className="hidden h-6 sm:block" />

        <div className="flex items-center gap-0.5">
          <TipBtn tip="Undo" shortcut="Ctrl+Z">
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Undo" disabled={hist.u === 0} onClick={undo}>
              <Undo2 className="h-4 w-4" />
            </Button>
          </TipBtn>
          <TipBtn tip="Redo" shortcut="Ctrl+Y">
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Redo" disabled={hist.r === 0} onClick={redo}>
              <Redo2 className="h-4 w-4" />
            </Button>
          </TipBtn>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {dirty ? (
            <span className="hidden items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700 md:flex">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
              Unsaved changes
            </span>
          ) : (
            <span className="hidden items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 md:flex">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Saved
            </span>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 bg-white text-xs shadow-sm">
                <Download className="mr-1 h-3.5 w-3.5" /> Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={exportSvg}>
                <Download className="mr-2 h-4 w-4" /> Download SVG
              </DropdownMenuItem>
              <DropdownMenuItem onClick={exportPng}>
                <ImageDown className="mr-2 h-4 w-4" /> Download PNG
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            size="sm"
            className="h-8 rounded-md bg-emerald-600 text-xs text-white shadow-sm hover:bg-emerald-700"
            disabled={!dirty || saving}
            onClick={() => void handleSave()}
          >
            {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}
            {t('save')}
          </Button>
        </div>
      </div>

      {/* ================= Main area ================= */}
      <div className="flex flex-1 flex-col xl:flex-row">
        {/* ---- Palette (minimizable — width animates at xl+, instant below; pure layout toggle, never touches view/zoom/doc) ---- */}
        <div
          id="editor-tool-palette"
          className={cn(
            'relative shrink-0 overflow-hidden transition-[width] duration-300 ease-in-out',
            leftOpen ? 'xl:w-56' : 'max-xl:hidden xl:w-0',
          )}
          inert={!leftOpen}
        >
        <aside
          className="flex h-full w-full flex-row gap-3 overflow-x-auto border-b border-slate-200 bg-slate-50 p-2 xl:w-56 xl:flex-col xl:overflow-y-auto xl:border-b-0 xl:border-r [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar]:w-1.5"
          aria-label="Tool palette"
        >
          {/* Tools */}
          <div className="flex shrink-0 flex-col gap-1">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 xl:px-1">
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400" /> Tools
            </div>
            <div className="flex flex-row gap-1 xl:grid xl:grid-cols-4">
              <PalBtn active={tool === 'select'} accent="slate" title="Select / Move (Esc)" onClick={() => setTool('select')}>
                <MousePointer2 className="h-5 w-5" />
              </PalBtn>
              <PalBtn active={tool === 'pan'} accent="slate" title="Pan (Space-drag / middle-drag / wheel)" onClick={() => setTool('pan')}>
                <Hand className="h-5 w-5" />
              </PalBtn>
              <PalBtn active={tool === 'room'} accent="slate" title="Draw room rectangle (drag on canvas)" onClick={() => setTool('room')}>
                <Square className="h-5 w-5" />
              </PalBtn>
              <PalBtn
                active={tool === 'calibrate'}
                accent="slate"
                title="Calibrate scale: click two points over a known dimension"
                onClick={() => setTool('calibrate')}
              >
                <Ruler className="h-5 w-5" />
              </PalBtn>
            </div>
          </div>

          {/* Electrical */}
          <div className="flex shrink-0 flex-col gap-1">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 xl:px-1">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Electrical
            </div>
            <div className="flex flex-row gap-1 xl:grid xl:grid-cols-4">
              {ELECTRICAL_DEFS.map((d) => (
                <PalBtn
                  key={d.type}
                  active={tool === 'symbol' && symType?.system === 'ELECTRICAL' && symType.type === d.type}
                  accent="amber"
                  title={d.label}
                  onClick={() => activateSymbol('ELECTRICAL', d.type)}
                >
                  <SymbolPreview type={d.type} system="ELECTRICAL" size={22} />
                </PalBtn>
              ))}
            </div>
          </div>

          {/* Plumbing */}
          <div className="flex shrink-0 flex-col gap-1">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-700 xl:px-1">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-500" /> Plumbing
            </div>
            <div className="flex flex-row gap-1 xl:grid xl:grid-cols-4">
              {PLUMBING_DEFS.map((d) => (
                <PalBtn
                  key={d.type}
                  active={tool === 'symbol' && symType?.system === 'PLUMBING' && symType.type === d.type}
                  accent="cyan"
                  title={d.label}
                  onClick={() => activateSymbol('PLUMBING', d.type)}
                >
                  <SymbolPreview type={d.type} system="PLUMBING" size={22} />
                </PalBtn>
              ))}
            </div>
          </div>

          {/* Routes */}
          <div className="flex shrink-0 flex-col gap-1">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 xl:px-1">
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400" /> Routes
            </div>
            <div className="flex flex-row gap-1 xl:grid xl:grid-cols-2">
              <PalBtn
                active={tool === 'cable'}
                accent="amber"
                title="Draw cable route: click points, Enter / double-click to finish"
                onClick={() => setTool('cable')}
              >
                <Cable className="h-5 w-5" />
              </PalBtn>
              <PalBtn
                active={tool === 'pipe'}
                accent="cyan"
                title="Draw pipe route: click points, Enter / double-click to finish"
                onClick={() => setTool('pipe')}
              >
                <Waves className="h-5 w-5" />
              </PalBtn>
            </div>
            <div className="flex gap-1">
              <MiniSelect
                value={cableKind}
                onChange={(v) => {
                  setCableKind(v)
                  setCableSpec(cableDefaultSpec(v))
                }}
                options={CABLE_KIND_OPTIONS}
                ariaLabel="Cable route kind"
                className="h-7 w-full min-w-24 text-[11px]"
              />
              <MiniSelect
                value={cableSpec}
                onChange={setCableSpec}
                options={wireOptions(cableKind)}
                ariaLabel="Wire size"
                className="h-7 w-20 shrink-0 text-[11px]"
              />
            </div>
            <div className="flex gap-1">
              <MiniSelect
                value={pipeKind}
                onChange={(v) => {
                  setPipeKind(v)
                  setPipeSpec(pipeDefaultSpec(v))
                }}
                options={PIPE_KIND_OPTIONS}
                ariaLabel="Pipe route kind"
                className="h-7 w-full min-w-24 text-[11px]"
              />
              <MiniSelect
                value={pipeSpec}
                onChange={setPipeSpec}
                options={pipeSpecOptions(pipeKind)}
                ariaLabel="Pipe spec"
                className="h-7 w-24 shrink-0 text-[11px]"
              />
            </div>
          </div>
        </aside>
        </div>

        {/* ---- Canvas ---- */}
        <div ref={wrapRef} className="relative min-h-[480px] min-w-0 flex-1 bg-white">
          {/* Seam panel toggles — collapse/expand the side panels; layout only, never touches zoom/pan/doc */}
          <button
            type="button"
            onClick={() => setLeftOpen((v) => !v)}
            title={leftOpen ? 'Minimize tools panel ([)' : 'Expand tools panel ([)'}
            aria-label={leftOpen ? 'Minimize tools panel' : 'Expand tools panel'}
            aria-expanded={leftOpen}
            aria-controls="editor-tool-palette"
            className="absolute left-0 top-1/2 z-30 flex h-16 w-5 -translate-y-1/2 items-center justify-center rounded-r-lg border border-l-0 border-slate-200 bg-white/95 text-slate-400 shadow-md backdrop-blur transition-all hover:bg-white hover:text-slate-700 hover:shadow-lg active:scale-95"
          >
            {leftOpen ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => setRightOpen((v) => !v)}
            title={rightOpen ? 'Minimize properties panel (])' : 'Expand properties panel (])'}
            aria-label={rightOpen ? 'Minimize properties panel' : 'Expand properties panel'}
            aria-expanded={rightOpen}
            aria-controls="editor-properties"
            className="absolute right-0 top-1/2 z-30 flex h-16 w-5 -translate-y-1/2 items-center justify-center rounded-l-lg border border-r-0 border-slate-200 bg-white/95 text-slate-400 shadow-md backdrop-blur transition-all hover:bg-white hover:text-slate-700 hover:shadow-lg active:scale-95"
          >
            {rightOpen ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>

          {/* Active tool indicator */}
          {toolBadge && !loading && (
            <div
              role="status"
              className="pointer-events-none absolute left-1/2 top-2 z-20 flex max-w-[85%] -translate-x-1/2 items-center gap-1.5 truncate whitespace-nowrap rounded-full border bg-white/95 px-3 py-1 text-[11px] font-semibold shadow-md backdrop-blur"
              style={{ borderColor: `${toolBadge.color}55`, color: toolBadge.color }}
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: toolBadge.color }} />
              <span className="truncate">{toolBadge.label}</span>
            </div>
          )}

          {/* Floating zoom control */}
          <div className="absolute bottom-3 left-3 z-20 flex items-center gap-0.5 rounded-full border border-slate-200 bg-white/95 p-1 shadow-lg backdrop-blur">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-full text-slate-600 hover:text-slate-900"
              aria-label="Zoom out"
              onClick={() => zoomBy(1 / 1.25)}
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <button
              type="button"
              onClick={() => setView((v) => ({ ...v, zoom: 1 }))}
              className="w-12 text-center text-[11px] font-semibold tabular-nums text-slate-600 transition hover:text-slate-900"
              title="Reset zoom to 100%"
              aria-label="Reset zoom to 100 percent"
            >
              {Math.round(view.zoom * 100)}%
            </button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-full text-slate-600 hover:text-slate-900"
              aria-label="Zoom in"
              onClick={() => zoomBy(1.25)}
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
            <div className="mx-0.5 h-4 w-px bg-slate-200" />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-full text-slate-600 hover:text-slate-900"
              aria-label="Fit to view"
              onClick={fitToView}
            >
              <Maximize className="h-4 w-4" />
            </Button>
          </div>

          <svg
            ref={svgRef}
            width="100%"
            height="100%"
            className="absolute inset-0 block touch-none select-none"
            style={{ cursor }}
            role="application"
            aria-label="Floor plan drawing canvas"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={() => setCursorM(null)}
            onDoubleClick={onDoubleClick}
          >
            <g transform={`translate(${view.tx} ${view.ty}) scale(${k})`}>
              {layers.bg && doc.backgroundImage && imgSize && (
                <image
                  href={doc.backgroundImage}
                  x={0}
                  y={0}
                  width={imgSize.w / P}
                  height={imgSize.h / P}
                  opacity={layers.bgOpacity / 100}
                  preserveAspectRatio="none"
                />
              )}
              {gridEls}

              {/* Rooms */}
              {doc.rooms.map((r) => {
                const sel = selection?.kind === 'room' && selection.id === r.roomId
                return (
                  <g key={r.roomId}>
                    <rect
                      x={r.x}
                      y={r.y}
                      width={r.w}
                      height={r.h}
                      fill={sel ? '#fff7ed' : '#f8fafc'}
                      stroke={sel ? '#d97706' : '#64748b'}
                      strokeWidth={sel ? 2 : 1.5}
                      strokeDasharray={sel ? '7 4' : undefined}
                      vectorEffect="non-scaling-stroke"
                    />
                    <text
                      x={r.x + r.w / 2}
                      y={r.y + r.h / 2 - 0.1}
                      fontSize={12 / k}
                      textAnchor="middle"
                      fill="#334155"
                      fontWeight={600}
                      pointerEvents="none"
                      style={{ userSelect: 'none' }}
                    >
                      {r.name}
                    </text>
                    <text
                      x={r.x + r.w / 2}
                      y={r.y + r.h / 2 + 0.24}
                      fontSize={10 / k}
                      textAnchor="middle"
                      fill="#64748b"
                      pointerEvents="none"
                      style={{ userSelect: 'none' }}
                    >
                      {fmt.len(r.w)}×{fmt.len(r.h)} {fmt.lenSym}
                    </text>
                    {sel &&
                      HANDLES.map((hd) => (
                        <rect
                          key={hd.h}
                          x={r.x + r.w * hd.fx - 5 / k}
                          y={r.y + r.h * hd.fy - 5 / k}
                          width={10 / k}
                          height={10 / k}
                          fill="#d97706"
                          stroke="#ffffff"
                          strokeWidth={1.5 / k}
                        />
                      ))}
                  </g>
                )
              })}

              {/* Routes */}
              {doc.routes.map((r) => {
                if (!routeLayerOn(r)) return null
                const sel = selection?.kind === 'route' && selection.id === r.id
                const color = routeColor(r.system, r.kind)
                const mid = polylineMidpoint(r.points)
                return (
                  <g key={r.id} opacity={routeOpacity(r)}>
                    <path
                      d={pathOf(r.points)}
                      fill="none"
                      stroke={color}
                      strokeWidth={sel ? 3.5 : 2.5}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    />
                    <text
                      x={mid.x}
                      y={mid.y - 0.15}
                      fontSize={10.5 / k}
                      textAnchor="middle"
                      fill={color}
                      fontWeight={600}
                      stroke="#ffffff"
                      strokeWidth={3 / k}
                      paintOrder="stroke"
                      pointerEvents="none"
                      style={{ userSelect: 'none' }}
                    >
                      {routeLabel(r.system, r.kind, r.spec)} · {fmt.lenS(polylineLength(r.points))}
                    </text>
                    {sel &&
                      r.points.map((p, i) => (
                        <circle key={i} cx={p.x} cy={p.y} r={4.5 / k} fill="#ffffff" stroke={color} strokeWidth={1.8 / k} />
                      ))}
                  </g>
                )
              })}

              {/* Symbols */}
              {doc.symbols.map((s) => {
                if (!symbolLayerOn(s)) return null
                const sz = symbolSizeOf(s)
                const sel = selection?.kind === 'symbol' && selection.id === s.id
                return (
                  <g key={s.id}>
                    {sel && (
                      <circle
                        cx={s.x}
                        cy={s.y}
                        r={sz * 0.68}
                        fill="none"
                        stroke="#d97706"
                        strokeWidth={1.5}
                        strokeDasharray="4 3"
                        vectorEffect="non-scaling-stroke"
                      />
                    )}
                    <SymbolGlyph type={s.type} system={s.system} x={s.x} y={s.y} sizeM={sz} opacity={symbolOpacity(s)} />
                    {s.label && (
                      <text
                        x={s.x}
                        y={s.y + sz * 0.85}
                        fontSize={9 / k}
                        textAnchor="middle"
                        fill="#334155"
                        pointerEvents="none"
                        style={{ userSelect: 'none' }}
                      >
                        {s.label}
                      </text>
                    )}
                  </g>
                )
              })}

              {/* Room draw preview */}
              {roomPreview && roomPreview.w > 0 && roomPreview.h > 0 && (
                <rect
                  x={roomPreview.x}
                  y={roomPreview.y}
                  width={roomPreview.w}
                  height={roomPreview.h}
                  fill="rgba(217,119,6,0.08)"
                  stroke="#d97706"
                  strokeWidth={1.5}
                  strokeDasharray="6 4"
                  vectorEffect="non-scaling-stroke"
                />
              )}

              {/* Route draft */}
              {routeDraft && routeDraft.length > 0 && (
                <g>
                  <path
                    d={pathOf(routeDraft)}
                    fill="none"
                    stroke={draftColor}
                    strokeWidth={2.5}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                    opacity={0.9}
                  />
                  {routeCursor && (
                    <path
                      d={`M ${round2(routeDraft[routeDraft.length - 1].x)} ${round2(routeDraft[routeDraft.length - 1].y)} L ${round2(routeCursor.x)} ${round2(routeCursor.y)}`}
                      fill="none"
                      stroke={draftColor}
                      strokeWidth={2}
                      strokeDasharray="6 4"
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  {routeDraft.map((p, i) => (
                    <circle key={i} cx={p.x} cy={p.y} r={3.5 / k} fill={draftColor} />
                  ))}
                  {routeCursor && (
                    <text
                      x={routeCursor.x}
                      y={routeCursor.y - 10 / k}
                      fontSize={10 / k}
                      textAnchor="middle"
                      fill={draftColor}
                      fontWeight={600}
                      stroke="#ffffff"
                      strokeWidth={3 / k}
                      paintOrder="stroke"
                    >
                      {fmt.lenS(previewLen)}
                    </text>
                  )}
                </g>
              )}

              {/* Calibration preview */}
              {calibP1 && calibCursor && (
                <g>
                  <line
                    x1={calibP1.x}
                    y1={calibP1.y}
                    x2={calibCursor.x}
                    y2={calibCursor.y}
                    stroke="#b45309"
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    vectorEffect="non-scaling-stroke"
                  />
                  <circle cx={calibP1.x} cy={calibP1.y} r={4 / k} fill="#b45309" />
                  <text
                    x={(calibP1.x + calibCursor.x) / 2}
                    y={(calibP1.y + calibCursor.y) / 2 - 8 / k}
                    fontSize={10 / k}
                    textAnchor="middle"
                    fill="#b45309"
                    fontWeight={600}
                    stroke="#ffffff"
                    strokeWidth={3 / k}
                    paintOrder="stroke"
                  >
                    {fmt.lenS(dist(calibP1, calibCursor))}
                  </text>
                </g>
              )}

              {/* Symbol placement ghost */}
              {tool === 'symbol' && symType && ghostPt && (
                <g opacity={0.55}>
                  <SymbolGlyph
                    type={symType.type}
                    system={symType.system}
                    x={ghostPt.x}
                    y={ghostPt.y}
                    sizeM={symbolSizeFor(symType.type, symType.system)}
                  />
                  <circle
                    cx={ghostPt.x}
                    cy={ghostPt.y}
                    r={12 / k}
                    fill="none"
                    stroke={systemColor(symType.system)}
                    strokeWidth={1}
                    strokeDasharray="3 3"
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              )}
            </g>
          </svg>

          {/* Loading overlay */}
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              <span className="ml-2 text-sm text-slate-500">{t('loading')}</span>
            </div>
          )}

          {/* Empty state */}
          {!loading && isEmpty && (
            <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center">
              <div className="pointer-events-auto max-w-sm space-y-3 rounded-2xl border border-slate-200 bg-white/95 p-6 text-center shadow-xl backdrop-blur">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 shadow-lg shadow-amber-200">
                  <Ruler className="h-6 w-6 text-white" />
                </div>
                <h3 className="text-sm font-semibold text-slate-800">Start your floor plan</h3>
                <p className="text-xs leading-relaxed text-slate-500">
                  Import a reference drawing (JPG/PNG) and calibrate the scale over a known dimension (e.g. a 4.2 m
                  room) — or just draw rooms directly. Grid snap is 0.25 m.
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  <Button size="sm" variant="outline" className="h-9 text-xs" onClick={() => bgInputRef.current?.click()}>
                    <ImagePlus className="mr-1 h-4 w-4" /> Import background
                  </Button>
                  <Button
                    size="sm"
                    className="h-9 bg-amber-600 text-xs text-white hover:bg-amber-700"
                    onClick={() => setTool('calibrate')}
                  >
                    <Ruler className="mr-1 h-4 w-4" /> Calibrate scale
                  </Button>
                  <Button size="sm" variant="outline" className="h-9 text-xs" onClick={() => setTool('room')}>
                    <Square className="mr-1 h-4 w-4" /> Draw room
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ---- Properties / layers panel (minimizable) ---- */}
        <div
          id="editor-properties"
          className={cn(
            'relative shrink-0 overflow-hidden transition-[width] duration-300 ease-in-out',
            rightOpen ? 'xl:w-80' : 'max-xl:hidden xl:w-0',
          )}
          inert={!rightOpen}
        >
        <aside
          className="flex w-full flex-col gap-3 border-t border-slate-200 bg-slate-50 p-3 xl:h-full xl:w-80 xl:overflow-y-auto xl:border-l xl:border-t-0 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar]:w-1.5"
          aria-label="Properties"
        >
          {/* Selection */}
          <SectionCard icon={<MousePointer2 className="h-3 w-3" />} title="Selection">
            {!selection && (
              <p className="rounded-lg border border-dashed border-slate-300 bg-white p-2.5 text-[11px] leading-relaxed text-slate-500">
                {tool === 'cable' || tool === 'pipe'
                  ? 'Click points on the canvas to draw the route. Enter or double-click finishes, Esc cancels. Snap: 0.25 m.'
                  : tool === 'calibrate'
                    ? 'Click two points across a known dimension (e.g. a 4.2 m room wall).'
                    : tool === 'room'
                      ? 'Click-drag on the canvas to draw a room rectangle.'
                      : 'Select a room, symbol or route on the canvas to edit it. Drag the vertices of a selected route to reshape it.'}
              </p>
            )}
            {selRoom && (
              <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/70 p-2.5">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="border-slate-400 text-[10px] text-slate-600">
                    ROOM
                  </Badge>
                  <DeleteBtn onClick={deleteSelection} label={t('delete')} />
                </div>
                <TextField
                  label="Name"
                  value={selRoom.name}
                  placeholder="Master Bedroom"
                  onCommit={(v) => updateSelectedRoom({ name: v || 'Room' })}
                />
                <TextField
                  label="Room ID (links to room registry, optional)"
                  value={selRoom.roomId}
                  onCommit={(v) => updateSelectedRoom({ roomId: v })}
                />
                <div className="grid grid-cols-2 gap-2">
                  <NumberField label="X (m)" value={selRoom.x} onCommit={(v) => updateSelectedRoom({ x: v })} />
                  <NumberField label="Y (m)" value={selRoom.y} onCommit={(v) => updateSelectedRoom({ y: v })} />
                  <NumberField
                    label="Width (m)"
                    value={selRoom.w}
                    min={MIN_ROOM}
                    onCommit={(v) => updateSelectedRoom({ w: Math.max(MIN_ROOM, v) })}
                  />
                  <NumberField
                    label="Height (m)"
                    value={selRoom.h}
                    min={MIN_ROOM}
                    onCommit={(v) => updateSelectedRoom({ h: Math.max(MIN_ROOM, v) })}
                  />
                </div>
              </div>
            )}
            {selSymbol && (
              <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/70 p-2.5">
                <div className="flex items-center justify-between">
                  <Badge
                    variant="outline"
                    className="text-[10px]"
                    style={{ borderColor: systemColor(selSymbol.system), color: systemColor(selSymbol.system) }}
                  >
                    {selSymbol.system === 'ELECTRICAL' ? 'ELECTRICAL' : 'PLUMBING'} · {selSymbol.type}
                  </Badge>
                  <DeleteBtn onClick={deleteSelection} label={t('delete')} />
                </div>
                <TextField
                  label="Label (optional)"
                  value={selSymbol.label ?? ''}
                  onCommit={(v) => updateSelectedSymbol({ label: v || undefined })}
                />
                <div className="grid grid-cols-2 gap-2">
                  <NumberField label="X (m)" value={selSymbol.x} onCommit={(v) => updateSelectedSymbol({ x: v })} />
                  <NumberField label="Y (m)" value={selSymbol.y} onCommit={(v) => updateSelectedSymbol({ y: v })} />
                </div>
                <p className="text-[11px] text-slate-400">
                  Room: {doc.rooms.find((r) => r.roomId === selSymbol.roomId)?.name ?? '— (drag into a room to link)'}
                </p>
              </div>
            )}
            {selRoute && (
              <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/70 p-2.5">
                <div className="flex items-center justify-between">
                  <Badge
                    variant="outline"
                    className="text-[10px]"
                    style={{
                      borderColor: routeColor(selRoute.system, selRoute.kind),
                      color: routeColor(selRoute.system, selRoute.kind),
                    }}
                  >
                    {selRoute.system === 'cable' ? 'CABLE' : 'PIPE'} · {selRoute.kind}
                  </Badge>
                  <DeleteBtn onClick={deleteSelection} label={t('delete')} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {selRoute.system === 'cable' ? (
                    <>
                      <div className="space-y-1">
                        <Label className="text-[11px] text-slate-500">Kind</Label>
                        <MiniSelect
                          value={selRoute.kind}
                          onChange={(v) => {
                            const sizes = CABLE_KINDS[v]?.sizes ?? []
                            const spec = sizes.includes(parseFloat(selRoute.spec)) ? selRoute.spec : cableDefaultSpec(v)
                            updateSelectedRoute({ kind: v, spec })
                          }}
                          options={CABLE_KIND_OPTIONS}
                          ariaLabel="Selected cable route kind"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] text-slate-500">Wire size</Label>
                        <MiniSelect
                          value={selRoute.spec}
                          onChange={(v) => updateSelectedRoute({ spec: v })}
                          options={wireOptions(selRoute.kind)}
                          ariaLabel="Selected cable wire size"
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="space-y-1">
                        <Label className="text-[11px] text-slate-500">Kind</Label>
                        <MiniSelect
                          value={selRoute.kind}
                          onChange={(v) => {
                            const specs = PIPE_KINDS[v]?.specs ?? []
                            const spec = specs.includes(selRoute.spec) ? selRoute.spec : pipeDefaultSpec(v)
                            updateSelectedRoute({ kind: v, spec })
                          }}
                          options={PIPE_KIND_OPTIONS}
                          ariaLabel="Selected pipe route kind"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] text-slate-500">Spec</Label>
                        <MiniSelect
                          value={selRoute.spec}
                          onChange={(v) => updateSelectedRoute({ spec: v })}
                          options={pipeSpecOptions(selRoute.kind)}
                          ariaLabel="Selected pipe spec"
                        />
                      </div>
                    </>
                  )}
                </div>
                <div className="flex items-center justify-between rounded-md bg-white px-2.5 py-1.5 text-xs">
                  <span className="text-slate-500">Length</span>
                  <span className="font-semibold tabular-nums text-slate-800">{fmt.lenS(polylineLength(selRoute.points))}</span>
                </div>
                <p className="text-[11px] text-slate-400">
                  {selRoute.points.length} vertices · drag them on canvas to reshape · Room:{' '}
                  {doc.rooms.find((r) => r.roomId === selRoute.roomId)?.name ?? '—'}
                </p>
              </div>
            )}
          </SectionCard>

          {/* Scale & background */}
          <SectionCard icon={<Ruler className="h-3 w-3" />} title="Scale & Background">
            <div className="flex items-end gap-2">
              <div className="w-28">
                <NumberField
                  label="px / meter"
                  value={doc.pxPerMeter}
                  step={1}
                  min={1}
                  onCommit={(v) => applyDoc({ ...docRef.current, pxPerMeter: Math.max(1, v), calibrated: true })}
                />
              </div>
              {doc.calibrated ? (
                <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">Calibrated ✓</Badge>
              ) : (
                <Badge variant="outline" className="border-amber-600 text-amber-700">
                  Not calibrated
                </Badge>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              className={`h-9 w-full text-xs ${tool === 'calibrate' ? 'ring-2 ring-amber-500' : ''}`}
              onClick={() => setTool('calibrate')}
            >
              <Ruler className="mr-1 h-4 w-4" /> Calibrate on canvas
            </Button>
            <input
              ref={bgInputRef}
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={onBgFile}
              aria-label="Import background image"
            />
            <Button size="sm" variant="outline" className="h-9 w-full text-xs" onClick={() => bgInputRef.current?.click()}>
              <ImagePlus className="mr-1 h-4 w-4" /> Import background image
            </Button>
            {doc.backgroundImage && (
              <>
                <div className="flex items-center gap-2">
                  <span className="w-14 shrink-0 text-[11px] text-slate-500">Opacity</span>
                  <Slider
                    value={[layers.bgOpacity]}
                    min={10}
                    max={100}
                    step={5}
                    onValueChange={(v) => setLayers((l) => ({ ...l, bgOpacity: v[0] ?? 65 }))}
                    className="flex-1"
                    aria-label="Background opacity"
                  />
                  <span className="w-9 text-right text-[11px] tabular-nums text-slate-500">{layers.bgOpacity}%</span>
                </div>
                <Button size="sm" variant="ghost" className="h-8 w-full text-xs text-slate-500" onClick={removeBg}>
                  <Trash2 className="mr-1 h-3.5 w-3.5" /> Remove background
                </Button>
              </>
            )}
          </SectionCard>

          {/* Layers */}
          <SectionCard icon={<Layers className="h-3 w-3" />} title="Layers">
            {(
              [
                ['bg', 'Background image'],
                ['electrical', 'Electrical symbols'],
                ['plumbing', 'Plumbing symbols'],
                ['cables', 'Cable routes'],
                ['pipes', 'Pipe routes'],
                ['grid', 'Grid'],
              ] as Array<[Exclude<keyof Layers, 'bgOpacity'>, string]>
            ).map(([key, label]) => (
              <div key={key} className="flex items-center justify-between rounded-md px-1 py-0.5 hover:bg-slate-100">
                <span className="text-xs text-slate-600">{label}</span>
                <Switch
                  checked={layers[key]}
                  onCheckedChange={(b) => setLayers((l) => ({ ...l, [key]: b }))}
                  aria-label={label}
                  className="data-[state=checked]:bg-slate-800"
                />
              </div>
            ))}
          </SectionCard>

          {/* Legend & totals */}
          <SectionCard icon={<RouteIcon className="h-3 w-3" />} title="Route Legend">
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              {Object.entries(CABLE_KINDS).map(([kk, v]) => (
                <div key={kk} className="flex items-center gap-1.5 text-[11px] text-slate-600">
                  <span className="h-1 w-4 shrink-0 rounded-full" style={{ background: v.color }} />
                  {kk}
                </div>
              ))}
              {Object.entries(PIPE_KINDS).map(([kk, v]) => (
                <div key={kk} className="flex items-center gap-1.5 text-[11px] text-slate-600">
                  <span className="h-1 w-4 shrink-0 rounded-full" style={{ background: v.color }} />
                  {kk}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 divide-x divide-slate-100 rounded-lg bg-slate-50 p-2 text-center">
              <div>
                <div className="text-sm font-semibold tabular-nums text-slate-800">{doc.rooms.length}</div>
                <div className="text-[10px] uppercase tracking-wide text-slate-400">Rooms</div>
              </div>
              <div>
                <div className="text-sm font-semibold tabular-nums text-slate-800">{doc.symbols.length}</div>
                <div className="text-[10px] uppercase tracking-wide text-slate-400">Symbols</div>
              </div>
              <div>
                <div className="text-sm font-semibold tabular-nums text-slate-800">{doc.routes.length}</div>
                <div className="text-[10px] uppercase tracking-wide text-slate-400">Routes</div>
              </div>
            </div>
            <p className="text-[11px] text-slate-500">
              Cable total: <b className="tabular-nums">{fmt.lenS(cableTotal)}</b> · Pipe total:{' '}
              <b className="tabular-nums">{fmt.lenS(pipeTotal)}</b>
            </p>
          </SectionCard>
        </aside>
        </div>
      </div>

      {/* ================= Status bar ================= */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 border-t bg-slate-50 px-3 py-1.5 text-[11px] text-slate-500">
        <span>
          Scale: <b className="tabular-nums text-slate-700">{round2(doc.pxPerMeter)}</b> px/m{' '}
          {doc.calibrated ? (
            <span className="text-emerald-600">✓ calibrated</span>
          ) : (
            <span className="text-amber-700">✗ not calibrated</span>
          )}
        </span>
        <span className="tabular-nums">Cursor: {cursorM ? `${fmt.len(cursorM.x)}, ${fmt.len(cursorM.y)} ${fmt.lenSym}` : '—'}</span>
        <span>
          Tool: <b className="text-slate-700">{TOOL_LABELS[tool]}</b>
          {tool === 'calibrate' && (calibP1 ? ' · click point 2' : ' · click point 1')}
        </span>
        {selRoute && (
          <span className="text-slate-700">
            {routeLabel(selRoute.system, selRoute.kind, selRoute.spec)}:{' '}
            <b className="tabular-nums">{fmt.lenS(polylineLength(selRoute.points))}</b>
          </span>
        )}
        <span className="ml-auto">
          Snap {SNAP_GRID} m{props.userName ? ` · ${props.userName}` : ''}
        </span>
      </div>

      {/* ================= Room name dialog ================= */}
      <Dialog open={roomDialog !== null} onOpenChange={(o) => !o && setRoomDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Name this room</DialogTitle>
            <DialogDescription>
              {roomDialog ? `${fmt.len(roomDialog.w)} × ${fmt.len(roomDialog.h)} ${fmt.lenSym} drawn. The label appears on the plan.` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="ef-room-name">Room name</Label>
              <Input
                id="ef-room-name"
                autoFocus
                value={roomName}
                placeholder="e.g. Master Bedroom"
                onChange={(e) => setRoomName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRoom()
                }}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ef-room-id">Room ID (optional)</Label>
              <Input id="ef-room-id" value={roomRoomId} placeholder="e.g. MBED-01" onChange={(e) => setRoomRoomId(e.target.value)} />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button variant="outline" size="sm" onClick={() => setRoomDialog(null)}>
              {t('cancel')}
            </Button>
            <Button size="sm" className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={commitRoom}>
              Add room
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================= Calibration dialog ================= */}
      <Dialog
        open={calibDialog !== null}
        onOpenChange={(o) => {
          if (!o) {
            setCalibDialog(null)
            setCalibP1(null)
            setCalibCursor(null)
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Calibrate scale</DialogTitle>
            <DialogDescription>
              Measured {calibDialog ? fmtM(calibDialog.px) : '—'} px on the drawing. Type the real length of that
              distance in {fmt.lenSym}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="ef-calib-len">Real length ({fmt.lenSym})</Label>
            <Input
              id="ef-calib-len"
              autoFocus
              type="number"
              step="0.01"
              min="0.01"
              value={calibInput}
              onChange={(e) => setCalibInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyCalibration()
              }}
            />
          </div>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button variant="outline" size="sm" onClick={() => setCalibDialog(null)}>
              {t('cancel')}
            </Button>
            <Button size="sm" className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={applyCalibration}>
              Apply scale
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================= Unsaved-changes floor switch guard ================= */}
      <Dialog open={floorSwitch !== null} onOpenChange={(o) => !o && setFloorSwitch(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Unsaved changes</DialogTitle>
            <DialogDescription>{floorLabel} has unsaved edits. Save before switching floors?</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button variant="outline" size="sm" onClick={() => setFloorSwitch(null)}>
              {t('cancel')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-red-600 hover:bg-red-50 hover:text-red-700"
              onClick={() => {
                const target = floorSwitch
                setFloorSwitch(null)
                if (target !== null) switchFloor(target)
              }}
            >
              Discard
            </Button>
            <Button
              size="sm"
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={() => {
                const target = floorSwitch
                setFloorSwitch(null)
                void handleSave().then((okSaved) => {
                  if (okSaved && target !== null) switchFloor(target)
                })
              }}
            >
              Save &amp; switch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
