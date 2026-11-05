import * as repo from './repo'
import { ensure, mutate, opDelete, updateOp, byCreatedDesc, type Row } from './repo'
import { type Handler, str, num, notFound, badReq } from './handlers-core'

const QSTR = ['status', 'date', 'validUntil', 'notes']

export const quotations: Handler = async ({ method, query, body }) => {
  if (method === 'POST') {
    if (!body?.projectId || !body?.items) throw badReq('projectId and items required')
    const r = await repo.command<{ quotation: Row }>('quotation.create', { ...body, items: typeof body.items === 'string' ? JSON.parse(body.items) : body.items },
      ['quotations', 'projects'], 'Create quotation')
    return { __status: 201, quotation: r.quotation }
  }
  await ensure(['quotations', 'projects'])
  const projectId = query.get('projectId') ?? ''
  const prj = new Map(repo.rows('projects').map((p) => [p.id, p]))
  const list = repo.where('quotations', (q) => !projectId || q.projectId === projectId).sort(byCreatedDesc).map((q) => {
    const p = prj.get(q.projectId)
    return { ...q, project: p ? { name: p.name, code: p.code, clientName: p.clientName } : null }
  })
  return { quotations: list }
}

export const quotationById: Handler = async ({ method, body }, [id]) => {
  if (method === 'POST') {
    const r = await repo.command<{ quotation: Row }>('quotation.revise', { id, ...body }, ['quotations'], 'Create quotation revision')
    return { __status: 201, quotation: r.quotation }
  }
  await ensure(['quotations', 'projects'])
  if (method === 'GET') {
    const q = repo.get('quotations', id)
    if (!q) throw notFound('Quotation not found')
    return { quotation: { ...q, project: repo.get('projects', q.projectId) } }
  }
  if (method === 'DELETE') { await mutate([opDelete('quotations', id)], 'Delete quotation'); return { success: true } }
  const data: Row = {}
  for (const f of QSTR) if (f in body) data[f] = str(body[f])
  const res = await mutate([updateOp('quotations', id, data)], 'Update quotation')
  return { quotation: res.results[0].row }
}

export const dashboard: Handler = async () => {
  await ensure(['projects', 'floors', 'rooms', 'quotations', 'materials', 'stockMovements', 'estimateItems'])
  const projects = repo.where('projects', (p) => !p.archived).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  const quotes = [...repo.rows('quotations')].sort(byCreatedDesc)
  const mats = repo.where('materials', (m) => m.active)
  const mmap = new Map(repo.rows('materials').map((m) => [m.id, m]))
  const pmap = new Map(repo.rows('projects').map((p) => [p.id, p]))
  const floorsOf = (pid: string) => repo.where('floors', (f) => f.projectId === pid)
  const roomCount = (pid: string) => repo.where('rooms', (r) => r.projectId === pid).length
  const estimateMap: Record<string, number> = {}
  for (const e of repo.rows('estimateItems')) estimateMap[e.projectId] = (estimateMap[e.projectId] ?? 0) + 1
  const lowStock = mats.filter((m) => m.minStock > 0 && m.stockQty <= m.minStock)
  return {
    totalProjects: projects.length,
    activeProjects: projects.filter((p) => p.status !== 'COMPLETED').length,
    pendingEstimates: projects.filter((p) => p.status === 'DRAFT').length,
    designReviewPending: projects.filter((p) => p.status === 'DESIGN_REVIEW').length,
    approvedQuotations: quotes.filter((q) => q.status === 'APPROVED').length,
    totalQuotations: quotes.length,
    recentProjects: projects.slice(0, 6).map((p) => ({
      id: p.id, code: p.code, name: p.name, status: p.status, clientName: p.clientName, floors: floorsOf(p.id).length, rooms: roomCount(p.id), isDemo: p.isDemo, updatedAt: p.updatedAt,
    })),
    recentQuotations: quotes.slice(0, 6).map((q) => ({ id: q.id, quotationNo: q.quotationNo, status: q.status, grandTotal: q.grandTotal, projectName: pmap.get(q.projectId)?.name, date: q.date })),
    lowStock: lowStock.slice(0, 8).map((m) => ({ id: m.id, name: m.name, code: m.code, stockQty: m.stockQty, minStock: m.minStock, unit: m.unit })),
    lowStockCount: lowStock.length,
    recentMovements: [...repo.rows('stockMovements')].sort(byCreatedDesc).slice(0, 5).map((m) => ({ id: m.id, type: m.type, quantity: m.quantity, material: mmap.get(m.materialId)?.name, createdAt: m.createdAt })),
    projectSummary: projects.slice(0, 10).map((p) => ({
      id: p.id, code: p.code, name: p.name, status: p.status, estimatedItems: estimateMap[p.id] ?? 0,
      quotationTotal: repo.where('quotations', (q) => q.projectId === p.id && !q.parentId).reduce((a, q) => a + q.grandTotal, 0),
    })),
  }
}

void num
