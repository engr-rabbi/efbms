
import { useCallback, useEffect, useState } from 'react'
import { useT, useApi, useAppStore } from '@/lib/store'
import { useFmt, useUnitStore } from '@/lib/unit-store'
import { exportCsv, exportExcel, fmtBDT, boqRows } from '@/lib/export-utils'
import type { BoqLine } from '@/lib/engine/boq'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { toast } from 'sonner'
import {
  BarChart3, FileSpreadsheet, Zap, Droplets, Printer, GitCompareArrows, Cable, Waves,
} from 'lucide-react'

interface Project { id: string; code: string; name: string; status: string; clientName: string; unitLength?: string; unitArea?: string }

type ReportKey =
  | 'electrical_boq' | 'plumbing_boq' | 'combined_boq'
  | 'floor_schedule' | 'room_points' | 'circuit_schedule'
  | 'pipe_schedule' | 'fixture_schedule'
  | 'est_vs_verified' | 'shortage' | 'cost_estimate'

const REPORTS: Array<{ key: ReportKey; labelEn: string; labelBn: string; system?: string }> = [
  { key: 'electrical_boq', labelEn: 'Complete Electrical BOQ', labelBn: 'সম্পূর্ণ ইলেকট্রিক্যাল BOQ', system: 'ELECTRICAL' },
  { key: 'plumbing_boq', labelEn: 'Complete Plumbing BOQ', labelBn: 'সম্পূর্ণ প্লাম্বিং BOQ', system: 'PLUMBING' },
  { key: 'combined_boq', labelEn: 'Consolidated BOQ (E+P)', labelBn: 'কনসোলিডেটেড BOQ (ই+প্লা)', system: 'COMBINED' },
  { key: 'floor_schedule', labelEn: 'Floor-wise Material Schedule', labelBn: 'তলা অনুযায়ী ম্যাটেরিয়াল' },
  { key: 'room_points', labelEn: 'Room-wise Electrical Point Schedule', labelBn: 'রুম অনুযায়ী পয়েন্ট শিডিউল' },
  { key: 'circuit_schedule', labelEn: 'Circuit-wise Cable Schedule / DB & Breaker', labelBn: 'সার্কিট/ব্রেকার শিডিউল' },
  { key: 'pipe_schedule', labelEn: 'Pipe Diameter & Length Schedule', labelBn: 'পাইপ ব্যাস ও দৈর্ঘ্য শিডিউল' },
  { key: 'fixture_schedule', labelEn: 'Plumbing Fixture Schedule', labelBn: 'প্লাম্বিং ফিক্সচার শিডিউল' },
  { key: 'est_vs_verified', labelEn: 'Estimated vs Drawing-verified Comparison', labelBn: 'এস্টিমেটেড বনাম যাচাইকৃত' },
  { key: 'shortage', labelEn: 'Material Shortage / Procurement List', labelBn: 'ম্যাটেরিয়াল ঘাটতি / ক্রয় তালিকা' },
  { key: 'cost_estimate', labelEn: 'Project Cost Estimate', labelBn: 'প্রজেক্ট খরচ এস্টিমেট' },
]

interface FullProject {
  project: {
    id: string; code: string; name: string; clientName: string; location: string; status: string
    floors: Array<{
      id: string; name: string; floorNumber: number; height: number
      rooms: Array<{ id: string; name: string; roomType: string; length: number; width: number; points: Array<{ pointType: string; quantity: number; connectedLoadW: number }>; fixtures: Array<{ fixtureType: string; quantity: number; pipeDiameter: string; system: string }> }>
    }>
    circuits: Array<{ id: string; floorName: string; name: string; circuitType: string; loadW: number; designAmps: number; breakerRating: string; breakerType: string; cableSize: string; cableLength: number; pointsCount: number }>
  }
}

export default function ReportsView() {
  const t = useT()
  const api = useApi<Record<string, unknown>>()
  const { user } = useAppStore()
  const readOnly = user?.role === 'VIEWER'
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState('')
  const [report, setReport] = useState<ReportKey>('combined_boq')
  const [boq, setBoq] = useState<{ lines: BoqLine[] } | null>(null)
  const [full, setFull] = useState<FullProject['project'] | null>(null)
  const [purchase, setPurchase] = useState<{ purchaseList: Array<Record<string, unknown>> } | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const fmt = useFmt()
  const loadProjectUnits = useUnitStore((s) => s.loadProject)

  useEffect(() => {
    api('/api/projects').then((d) => {
      const ps = (d as { projects: Project[] }).projects
      setProjects(ps)
      if (ps[0]) setProjectId(ps[0].id)
    }).catch((e) => toast.error(e.message))
  }, [])  

  // Activate the selected project's unit override so reports display (and export)
  // in the project's units; cleared when no project is selected / on unmount.
  useEffect(() => {
    const p = projects.find((x) => x.id === projectId)
    if (projectId && p) loadProjectUnits(projectId, p)
    return () => { if (projectId) loadProjectUnits(null) }
  }, [projectId, projects, loadProjectUnits])

  const loadData = useCallback(async () => {
    if (!projectId) return
    setLoading(true); setErr('')
    try {
      const def = REPORTS.find((r) => r.key === report)
      if (def?.system || report === 'floor_schedule' || report === 'est_vs_verified' || report === 'cost_estimate') {
        const sys = report === 'electrical_boq' ? 'ELECTRICAL' : report === 'plumbing_boq' ? 'PLUMBING' : 'COMBINED'
        const d = await api(`/api/boq/${projectId}?system=${sys}`)
        setBoq({ lines: (d as { lines: BoqLine[] }).lines })
      } else { setBoq(null) }
      if (['floor_schedule', 'room_points', 'circuit_schedule', 'pipe_schedule', 'fixture_schedule', 'cost_estimate'].includes(report)) {
        const d = await api(`/api/projects/${projectId}`)
        setFull((d as unknown as FullProject).project)
      } else { setFull(null) }
      if (report === 'shortage') {
        const d = await api(`/api/purchase-list/${projectId}`)
        setPurchase(d as unknown as { purchaseList: Array<Record<string, unknown>> })
      } else { setPurchase(null) }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load')
    } finally { setLoading(false) }
  }, [projectId, report])  

  useEffect(() => { loadData() }, [loadData])

  const rows = useCallback((): Array<Record<string, unknown>> => {
    if (boq?.lines && ['electrical_boq', 'plumbing_boq', 'combined_boq'].includes(report)) return boqRows(boq.lines) as unknown as Array<Record<string, unknown>>
    if (full) {
      if (report === 'floor_schedule') {
        const map = new Map<string, Record<string, unknown>>()
        for (const fl of full.floors) for (const r of fl.rooms) {
          for (const p of r.points) for (let i = 0; i < p.quantity; i++) { /* noop */ }
          for (const p of r.points) {
            const k = `${fl.name}|${p.pointType}`
            const cur = map.get(k)
            map.set(k, { Floor: fl.name, Item: p.pointType, Qty: (Number(cur?.Qty) || 0) + p.quantity })
          }
        }
        return [...map.values()]
      }
      if (report === 'room_points') {
        return full.floors.flatMap((fl) => fl.rooms.map((r) => ({
          Floor: fl.name, Room: r.name, Type: r.roomType,
          [`Size (${fmt.lenSym})`]: `${fmt.len(r.length)}×${fmt.len(r.width)}`,
          Points: r.points.map((p) => `${p.pointType}×${p.quantity}`).join(', '),
          'Load (W)': r.points.reduce((a, p) => a + p.connectedLoadW * p.quantity, 0),
        }))) as unknown as Array<Record<string, unknown>>
      }
      if (report === 'circuit_schedule') {
        return full.circuits.map((c, i) => ({
          '#': i + 1, Floor: c.floorName, Circuit: c.name, Type: c.circuitType,
          'Load W': Math.round(c.loadW), 'Design A': c.designAmps,
          Breaker: `${c.breakerRating}A ${c.breakerType}`, 'Cable mm²': c.cableSize,
          [`Length (${fmt.lenSym})`]: fmt.len(c.cableLength), Points: c.pointsCount,
        })) as unknown as Array<Record<string, unknown>>
      }
      if (report === 'pipe_schedule' || report === 'fixture_schedule') {
        return full.floors.flatMap((fl) => fl.rooms.flatMap((r) =>
          r.fixtures.map((f) => ({
            Floor: fl.name, Room: r.name, Item: f.fixtureType, Qty: f.quantity,
            'Pipe Ø': f.pipeDiameter, System: f.system,
          })),
        )) as unknown as Array<Record<string, unknown>>
      }
      if (report === 'cost_estimate') {
        return (boq?.lines ?? []).map((l) => ({
          System: l.system, Category: l.category, Item: l.name, Unit: l.unit,
          'Final Qty': l.qtyFinal, 'Unit Sell ৳': l.unitSellingPrice,
          'Total ৳': l.totalSellingPrice, 'Profit ৳': l.profit,
        })) as unknown as Array<Record<string, unknown>>
      }
    }
    if (purchase) return purchase.purchaseList
    return []
  }, [boq, full, purchase, report, fmt])

  const print = () => {
    window.print()
  }

  const def = REPORTS.find((r) => r.key === report)!
  const currentRows = rows()

  return (
    <div className="space-y-4 print:block">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #report-print-area, #report-print-area * { visibility: visible; }
          #report-print-area { position: absolute; left: 0; top: 0; width: 100%; background: white; padding: 12px; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 no-print">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><BarChart3 className="w-5 h-5 text-amber-600" /> {t('reports')}</h1>
          <p className="text-xs text-slate-500">PDF (print) · Excel · CSV export</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger className="w-[220px]"><SelectValue placeholder={t('projects')} /></SelectTrigger>
            <SelectContent>
              {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={report} onValueChange={(v) => setReport(v as ReportKey)}>
            <SelectTrigger className="w-[280px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {REPORTS.map((r) => <SelectItem key={r.key} value={r.key}>{r.labelEn}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {err && <Alert variant="destructive"><AlertDescription className="text-xs">{err}</AlertDescription></Alert>}

      <div className="flex gap-2 no-print">
        <Button size="sm" variant="outline" onClick={() => { if (!currentRows.length) { toast.error('No data'); return } exportCsv(currentRows, `${report}.csv`) }}>
          <FileSpreadsheet className="w-3.5 h-3.5 mr-1" /> {t('exportCsv')}
        </Button>
        <Button size="sm" variant="outline" onClick={async () => { if (!currentRows.length) { toast.error('No data'); return } await exportExcel(currentRows, `${report}.xlsx`, def.labelEn.slice(0, 28)) }}>
          <FileSpreadsheet className="w-3.5 h-3.5 mr-1" /> {t('exportExcel')}
        </Button>
        <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-white" onClick={print}>
          <Printer className="w-3.5 h-3.5 mr-1" /> {t('print')}
        </Button>
      </div>

      <div id="report-print-area">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              {def.labelEn} — {projects.find((p) => p.id === projectId)?.name ?? ''}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? <Skeleton className="h-72 rounded-none" /> : currentRows.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-10">{t('noData')}</p>
            ) : (
              <div className="max-h-[560px] overflow-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full">
                <Table>
                  <TableHeader className="sticky top-0 bg-white">
                    <TableRow>
                      {Object.keys(currentRows[0]).map((k) => (
                        <TableHead key={k} className="text-xs whitespace-nowrap">{k}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {currentRows.slice(0, 300).map((r, i) => (
                      <TableRow key={i}>
                        {Object.keys(currentRows[0]).map((k) => (
                          <TableCell key={k} className="text-xs whitespace-nowrap max-w-[280px] truncate" title={String(r[k] ?? '')}>
                            {String(r[k] ?? '')}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {currentRows.length > 300 && <p className="text-[10px] text-slate-400 p-2">Showing 300 of {currentRows.length} rows — export for full data.</p>}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {report === 'est_vs_verified' && boq && !readOnly && (
        <Card className="no-print">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><GitCompareArrows className="w-4 h-4 text-violet-500" /> {t('estimatedVsVerified')}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs space-y-1.5 max-h-[300px] overflow-y-auto">
            {boq.lines.filter((l) => l.qtyAuto > 0 && l.qtyDrawing > 0).map((l) => (
              <div key={l.key} className="flex items-center gap-2 border-b border-slate-100 pb-1">
                <span className="flex-1 truncate">{l.name} {l.size}</span>
                <Badge variant="outline" className="text-[10px] text-amber-700">A: {Math.round(l.qtyAuto * 100) / 100}</Badge>
                <Badge variant="outline" className="text-[10px] text-emerald-700">B: {Math.round(l.qtyDrawing * 100) / 100}</Badge>
                <span className={`font-semibold w-16 text-right ${l.qtyDrawing > l.qtyAuto ? 'text-rose-600' : 'text-emerald-600'}`}>
                  {l.qtyAuto ? Math.round(((l.qtyDrawing - l.qtyAuto) / l.qtyAuto) * 100) : 0}%
                </span>
              </div>
            ))}
            {boq.lines.filter((l) => l.qtyAuto > 0 && l.qtyDrawing > 0).length === 0 && (
              <p className="text-slate-400 py-4 text-center">Draw cable/pipe routes in the Drawing Editor (calibrated) to compare Mode A vs Mode B.</p>
            )}
          </CardContent>
        </Card>
      )}

      {report === 'cost_estimate' && boq && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 no-print">
          {[
            [t('totalCost'), fmtBDT(boq.lines.reduce((a, l) => a + l.totalPurchaseCost, 0)), Zap],
            ['Selling', fmtBDT(boq.lines.reduce((a, l) => a + l.totalSellingPrice, 0)), Droplets],
            [t('profit'), fmtBDT(boq.lines.reduce((a, l) => a + l.profit, 0)), Cable],
            ['Items', String(boq.lines.length), Waves],
          ].map(([k, v, Icon]) => {
            const Ic = Icon as React.ElementType
            return (
              <Card key={String(k)} className="p-3">
                <div className="text-[10px] text-slate-500 flex items-center gap-1"><Ic className="w-3 h-3" /> {String(k)}</div>
                <div className="text-base font-bold">৳ {String(v)}</div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
