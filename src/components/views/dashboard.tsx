
import { useEffect, useState } from 'react'
import { useT, useApi, useAppStore } from '@/lib/store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { BackupBanner } from '@/components/admin/backup-banner'
import { fmtBDT } from '@/lib/export-utils'
import {
  FolderKanban, FolderOpen, ClipboardList, Eye, FileCheck2, PackageX,
  ArrowRight, TrendingUp, AlertTriangle, Boxes, FileText, Clock,
} from 'lucide-react'

interface DashData {
  totalProjects: number
  activeProjects: number
  pendingEstimates: number
  designReviewPending: number
  approvedQuotations: number
  totalQuotations: number
  recentProjects: Array<{ id: string; code: string; name: string; status: string; clientName: string; floors: number; rooms: number; isDemo: boolean; updatedAt: string }>
  recentQuotations: Array<{ id: string; quotationNo: string; status: string; grandTotal: number; projectName: string | null; date: string }>
  lowStock: Array<{ id: string; name: string; code: string; stockQty: number; minStock: number; unit: string }>
  lowStockCount: number
  recentMovements: Array<{ id: string; type: string; quantity: number; material: string | null; createdAt: string }>
  projectSummary: Array<{ id: string; code: string; name: string; status: string; estimatedItems: number; quotationTotal: number }>
}

const statusBadge: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  ESTIMATION: 'bg-amber-100 text-amber-800',
  DESIGN_REVIEW: 'bg-violet-100 text-violet-800',
  QUOTATION: 'bg-cyan-100 text-cyan-800',
  APPROVED: 'bg-emerald-100 text-emerald-800',
  COMPLETED: 'bg-green-600 text-white',
}

export default function DashboardView() {
  const t = useT()
  const api = useApi<DashData>()
  const openProject = useAppStore((s) => s.openProject)
  const navigate = useAppStore((s) => s.navigate)
  const [data, setData] = useState<DashData | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    api('/api/dashboard').then(setData).catch((e) => setErr(e.message))
  }, [])  

  if (err) return <p className="text-rose-600 text-sm p-4">{err}</p>
  if (!data) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }

  const stats = [
    { label: t('totalProjects'), value: data.totalProjects, icon: FolderKanban, color: 'bg-amber-500' },
    { label: t('activeProjects'), value: data.activeProjects, icon: FolderOpen, color: 'bg-emerald-500' },
    { label: t('pendingEstimates'), value: data.pendingEstimates, icon: ClipboardList, color: 'bg-slate-500' },
    { label: t('designReviewPending'), value: data.designReviewPending, icon: Eye, color: 'bg-violet-500' },
    { label: t('approvedQuotations'), value: data.approvedQuotations, icon: FileCheck2, color: 'bg-teal-500' },
  ]

  return (
    <div className="space-y-5">
      <BackupBanner />
      {/* Stats */}
      <section aria-label="Key statistics">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {stats.map(({ label, value, icon: Icon, color }) => (
            <Card key={label} className="border-slate-200 shadow-sm">
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg ${color} flex items-center justify-center shrink-0`}>
                  <Icon className="w-5 h-5 text-white" />
                </div>
                <div className="min-w-0">
                  <div className="text-2xl font-bold leading-none">{value}</div>
                  <div className="text-[11px] text-slate-500 mt-1 truncate">{label}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Recent projects */}
        <Card className="lg:col-span-2 border-slate-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between">
              {t('recentProjects')}
              <Button variant="ghost" size="sm" onClick={() => navigate('projects')} className="text-amber-600 hover:text-amber-700">
                {t('openProject')} <ArrowRight className="w-4 h-4" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-[320px] overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full space-y-2">
            {data.recentProjects.length === 0 && <p className="text-sm text-slate-500 py-6 text-center">{t('noData')}</p>}
            {data.recentProjects.map((p) => (
              <button
                key={p.id}
                onClick={() => openProject(p.id)}
                className="w-full text-left flex items-center gap-3 rounded-lg border border-slate-100 p-3 hover:border-amber-300 hover:bg-amber-50/50 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm truncate">{p.name}</span>
                    {p.isDemo && <Badge className="bg-amber-100 text-amber-800 text-[9px] shrink-0">{t('demoData')}</Badge>}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {p.code} · {p.clientName} · {p.floors} {t('floors')} / {p.rooms} {t('rooms')}
                  </div>
                </div>
                <Badge className={`${statusBadge[p.status] ?? 'bg-slate-100'} text-[10px] shrink-0`}>{p.status}</Badge>
              </button>
            ))}
          </CardContent>
        </Card>

        {/* Low stock */}
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <PackageX className="w-4.5 h-4.5 text-rose-500" />
              {t('lowStock')} ({data.lowStockCount})
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-[320px] overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full space-y-1.5">
            {data.lowStock.length === 0 && <p className="text-sm text-emerald-600 py-4 text-center flex items-center justify-center gap-1"><Boxes className="w-4 h-4" /> Stock OK</p>}
            {data.lowStock.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-2 text-xs p-2 rounded-md bg-rose-50 border border-rose-100">
                <div className="min-w-0">
                  <div className="font-medium truncate">{m.name}</div>
                  <div className="text-slate-500">{m.code}</div>
                </div>
                <Badge variant="destructive" className="shrink-0 text-[10px]">
                  {m.stockQty}/{m.minStock} {m.unit}
                </Badge>
              </div>
            ))}
            {data.lowStockCount > data.lowStock.length && (
              <Button variant="ghost" size="sm" className="w-full text-amber-600" onClick={() => navigate('inventory')}>
                +{data.lowStockCount - data.lowStock.length} more <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Recent quotations */}
        <Card className="lg:col-span-1 border-slate-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="w-4.5 h-4.5 text-teal-600" /> {t('recentQuotations')}
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-[260px] overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full space-y-2">
            {data.recentQuotations.length === 0 && <p className="text-sm text-slate-500 py-6 text-center">{t('noData')}</p>}
            {data.recentQuotations.map((q) => (
              <div key={q.id} className="p-2.5 rounded-lg border border-slate-100 text-xs">
                <div className="flex justify-between items-center gap-2">
                  <span className="font-semibold truncate">{q.quotationNo}</span>
                  <Badge className="text-[9px] bg-slate-100">{q.status}</Badge>
                </div>
                <div className="flex justify-between mt-1 text-slate-500">
                  <span className="truncate">{q.projectName}</span>
                  <span className="font-semibold text-slate-700">৳ {fmtBDT(q.grandTotal)}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Project cost summary */}
        <Card className="lg:col-span-2 border-slate-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4.5 h-4.5 text-emerald-600" /> {t('projectWiseCost')}
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-[260px] overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full">
            {data.projectSummary.length === 0 && <p className="text-sm text-slate-500 py-6 text-center">{t('noData')}</p>}
            <div className="space-y-1.5">
              {data.projectSummary.map((p) => (
                <button
                  key={p.id}
                  onClick={() => openProject(p.id, 'boq')}
                  className="w-full text-left flex items-center gap-3 text-xs p-2.5 rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-200"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{p.name}</div>
                    <div className="text-slate-500">{p.code} · {p.estimatedItems} BOQ items</div>
                  </div>
                  <Badge className={`${statusBadge[p.status] ?? ''} text-[9px] shrink-0`}>{p.status}</Badge>
                  <span className="font-semibold text-slate-700 shrink-0">৳ {fmtBDT(p.quotationTotal)}</span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent movements */}
      {data.recentMovements.length > 0 && (
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-4.5 h-4.5 text-slate-500" /> {t('movements')}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {data.recentMovements.map((m) => (
              <Badge key={m.id} variant="outline" className="text-[11px] font-normal text-slate-600">
                <AlertTriangle className={`w-3 h-3 mr-1 ${m.type === 'OUT' ? 'text-rose-500' : 'text-emerald-500'}`} />
                {m.type} {m.quantity} — {m.material}
              </Badge>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
