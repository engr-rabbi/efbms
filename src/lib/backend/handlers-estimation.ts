import { gasCall, newId, ApiError } from './gas'
import * as repo from './repo'
import { ensure, mutate, opCreate, updateOp, byCreated, byCreatedDesc, type Row, type MutateOp } from './repo'
import { runEstimation, rulesFromMap, DEFAULT_RULES, buildBoq, type EngProject, type MaterialLite, type RawEstimateItem } from '@/lib/engine'
import type { DrawingDocData } from '@/lib/engine/types'
import { fetchFileDataUrl, dataUrlParts } from './files'
import { type Handler, str, num, notFound, badReq, floorsOf, FLOOR_TABLES } from './handlers-core'

// ------------------------------------------------------------------ estimation (Mode A + Mode B)
function toEngProject(p: Row): EngProject {
  return {
    id: p.id, name: p.name, supplyType: p.supplyType, occupants: p.occupants,
    floors: floorsOf(p.id).map((f) => ({
      id: f.id, floorNumber: f.floorNumber, name: f.name, height: f.height,
      rooms: (f.rooms as Row[]).map((r) => ({
        id: r.id, name: r.name, roomType: r.roomType, length: r.length, width: r.width, height: r.height,
        points: (r.points as Row[]).map((pt) => ({ pointType: pt.pointType, quantity: pt.quantity, connectedLoadW: pt.connectedLoadW, mountingHeight: pt.mountingHeight })),
        fixtures: (r.fixtures as Row[]).map((fx) => ({ fixtureType: fx.fixtureType, quantity: fx.quantity, system: fx.system, pipeDiameter: fx.pipeDiameter })),
      })),
    })),
  }
}

export const estimation: Handler = async ({ method }, [projectId]) => {
  await ensure([...FLOOR_TABLES, 'estimateItems', 'circuits', 'designRules'])
  if (method === 'GET') {
    return {
      items: repo.where('estimateItems', (i) => i.projectId === projectId).sort(byCreated),
      circuits: repo.where('circuits', (c) => c.projectId === projectId).sort(byCreated),
      persisted: true,
    }
  }
  const p = repo.get('projects', projectId)
  if (!p) throw notFound('Project not found')
  const project = toEngProject(p)
  const map: Record<string, string> = {}
  for (const r of repo.rows('designRules')) map[r.key] = r.value
  const rules = rulesFromMap(map, DEFAULT_RULES)

  // Mode B input: the editable drawings saved for each floor
  const { drawings } = await gasCall<{ drawings: Row[] }>('drawing.list', { projectId })
  const rooms: unknown[] = [], symbols: unknown[] = [], routes: unknown[] = []
  let calibrated = false
  for (const d of drawings) {
    try {
      const data = JSON.parse(d.data) as { rooms?: unknown[]; symbols?: unknown[]; routes?: unknown[] }
      if (d.calibrated && data) {
        calibrated = true
        rooms.push(...(data.rooms ?? [])); symbols.push(...(data.symbols ?? [])); routes.push(...(data.routes ?? []))
      }
    } catch { /* skip unreadable drawing */ }
  }
  const drawing = calibrated ? ({ version: 1, pxPerMeter: 40, calibrated: true, rooms, symbols, routes } as unknown as DrawingDocData) : null
  const result = runEstimation(project, { rules, drawing })

  const ops: MutateOp[] = [
    { op: 'deleteWhere', t: 'estimateItems', where: { projectId } },
    { op: 'deleteWhere', t: 'circuits', where: { projectId } },
  ]
  for (const it of result.items) {
    ops.push(opCreate('estimateItems', {
      projectId, floorId: it.floorId ?? '', floorName: it.floorName ?? '', roomId: it.roomId ?? '', roomName: it.roomName ?? '',
      system: it.system, category: it.category, name: it.name, brand: it.brand, specification: it.specification, size: it.size, unit: it.unit,
      mode: it.mode, qty: it.qty, formula: it.formula, assumptions: JSON.stringify(it.assumptions ?? []), wastagePct: it.wastagePct,
      sourceRef: it.sourceRef, materialId: it.materialId ?? '',
    }, newId()))
  }
  for (const c of result.circuits) {
    const fl = project.floors.find((f) => f.name === c.floorName)
    ops.push(opCreate('circuits', {
      projectId, floorId: fl?.id ?? '', floorName: c.floorName, name: c.name, circuitType: c.circuitType, phase: c.phase, loadW: c.loadW,
      designAmps: c.designAmps, breakerRating: c.breakerRating, breakerType: c.breakerType, rccb: c.rccb, cableSize: c.cableSize,
      cableLength: c.cableLength, pointsCount: c.pointsCount, remarks: c.remarks,
    }, newId()))
  }
  if (p.status === 'DRAFT') ops.push(updateOp('projects', projectId, { status: 'ESTIMATION' }))
  // the replacement is one atomic request (all-or-nothing) up to the server limit of 1000 operations
  for (let i = 0; i < ops.length; i += 950) await mutate(ops.slice(i, i + 950), 'Run estimation')
  return { summary: result.summary, plumbingSummary: result.plumbingSummary, itemCount: result.items.length, circuitCount: result.circuits.length }
}

// ------------------------------------------------------------------ BOQ / purchase list
type OverrideMap = Record<string, { qty: number; reason: string; userName: string }>
function overrideMapFor(projectId: string): { map: OverrideMap; count: number } {
  const list = repo.where('boqOverrides', (o) => o.projectId === projectId).sort(byCreatedDesc)
  const map: OverrideMap = {}
  for (const o of list) if (!(o.itemKey in map)) map[o.itemKey] = { qty: o.qty, reason: o.reason, userName: o.userName }
  return { map, count: list.length }
}
function matLite(): { lite: MaterialLite[]; active: Row[] } {
  const active = repo.where('materials', (m) => m.active)
  return {
    active,
    lite: active.map((m) => ({
      id: m.id, code: m.code, category: m.category, name: m.name, brand: m.brand, specification: m.specification, size: m.size, unit: m.unit,
      packSize: m.packSize, packUnit: m.packUnit, purchasePrice: m.purchasePrice, sellingPrice: m.sellingPrice, stockQty: m.stockQty, minStock: m.minStock,
    })),
  }
}
function rawItems(projectId: string): RawEstimateItem[] {
  return repo.where('estimateItems', (i) => i.projectId === projectId).map((i) => ({
    system: i.system, category: i.category, name: i.name, brand: i.brand, specification: i.specification, size: i.size, unit: i.unit, mode: i.mode,
    qty: i.qty, formula: i.formula, assumptions: JSON.parse(i.assumptions || '[]'), wastagePct: i.wastagePct, sourceRef: i.sourceRef,
    materialId: i.materialId, floorName: i.floorName, roomName: i.roomName,
  }))
}
const r2 = (n: number) => Math.round(n * 100) / 100

export const boq: Handler = async ({ query }, [projectId]) => {
  await ensure(['projects', 'estimateItems', 'materials', 'boqOverrides'])
  const project = repo.get('projects', projectId)
  if (!project) throw notFound('Project not found')
  const { lite } = matLite()
  const ov = overrideMapFor(projectId)
  const { lines } = buildBoq(rawItems(projectId), lite, ov.map)
  const system = query.get('system')
  const filtered = system && system !== 'COMBINED' ? lines.filter((l) => l.system === system) : lines
  return {
    lines: filtered,
    totals: {
      purchaseCost: r2(filtered.reduce((a, l) => a + l.totalPurchaseCost, 0)), sellingTotal: r2(filtered.reduce((a, l) => a + l.totalSellingPrice, 0)),
      profit: r2(filtered.reduce((a, l) => a + l.profit, 0)), shortageCount: filtered.filter((l) => l.shortage > 0).length, itemsCount: filtered.length,
    },
    project: { id: project.id, name: project.name, code: project.code }, overrideCount: ov.count,
  }
}

export const boqOverride: Handler = async ({ method, body }, [projectId]) => {
  await ensure(['boqOverrides'])
  if (method === 'GET') return { overrides: repo.where('boqOverrides', (o) => o.projectId === projectId).sort(byCreatedDesc).slice(0, 200) }
  const itemKey = str(body?.itemKey), qty = num(body?.qty, -1)
  if (!itemKey || qty < 0) throw badReq('itemKey and qty required')
  const res = await mutate([opCreate('boqOverrides', { projectId, itemKey, qty, reason: str(body?.reason, 'Manual adjustment') }, newId())], 'BOQ override')
  return { __status: 201, override: res.results[0].row }
}

export const purchaseList: Handler = async (_r, [projectId]) => {
  await ensure(['projects', 'estimateItems', 'materials', 'suppliers', 'boqOverrides'])
  if (!repo.get('projects', projectId)) throw notFound('Project not found')
  if (!repo.where('estimateItems', (i) => i.projectId === projectId).length) throw badReq('Run estimation first to generate the purchase list')
  const { lite, active } = matLite()
  const { lines } = buildBoq(rawItems(projectId), lite, overrideMapFor(projectId).map)
  const sup = new Map(repo.rows('suppliers').map((s) => [s.id, s]))
  const list = lines.filter((l) => l.shortage > 0).map((l) => {
    const mat = active.find((m) => m.id === l.materialId)
    const s = mat ? sup.get(mat.supplierId) : undefined
    return {
      itemNo: l.itemNo, name: l.name, brand: l.brand, specification: l.specification, size: l.size, unit: l.unit, required: l.qtyWithWastage,
      purchaseQty: l.purchaseQty, stock: l.stockQty, shortage: l.shortage, estCost: r2(l.shortage * l.unitPurchasePrice),
      supplier: s?.name ?? 'Unassigned', supplierId: s?.id ?? '',
    }
  })
  const by: Record<string, { supplier: string; items: number; totalCost: number }> = {}
  for (const p of list) {
    by[p.supplier] ??= { supplier: p.supplier, items: 0, totalCost: 0 }
    by[p.supplier].items++; by[p.supplier].totalCost += p.estCost
  }
  return { purchaseList: list, bySupplier: Object.values(by).map((b) => ({ ...b, totalCost: r2(b.totalCost) })), totalPurchaseCost: r2(list.reduce((a, p) => a + p.estCost, 0)) }
}

// ------------------------------------------------------------------ drawings (editable geometry kept in Drive)
const drawingRev = new Map<string, number>()
const bgRefByData = new Map<string, string>() // data URL → "drive:<fileId>" for images already stored in Drive

async function resolveBackground(doc: Record<string, unknown>): Promise<void> {
  const bg = doc.backgroundImage
  if (typeof bg === 'string' && bg.startsWith('drive:')) {
    const data = await fetchFileDataUrl(bg.slice(6))
    bgRefByData.set(data, bg)
    doc.backgroundImage = data
  }
}
export function resetDrawingState() { drawingRev.clear(); bgRefByData.clear() }

export const drawings: Handler = async ({ method, body }, [projectId]) => {
  if (method === 'GET') {
    const res = await gasCall<{ drawings: Row[] }>('drawing.list', { projectId })
    const out: Row[] = []
    for (const d of res.drawings) {
      let data = d.data as string
      try {
        const doc = JSON.parse(data) as Record<string, unknown>
        await resolveBackground(doc)
        data = JSON.stringify(doc)
      } catch { /* leave as-is */ }
      drawingRev.set(`${projectId}:${d.floorNumber}`, d.rev)
      out.push({ ...d, data })
    }
    return { drawings: out }
  }
  if (typeof body?.data !== 'string') throw badReq('data (JSON string) required')
  const floorNumber = num(body.floorNumber, 0)
  let payloadData = body.data as string
  try {
    const doc = JSON.parse(payloadData) as Record<string, unknown>
    const bg = doc.backgroundImage
    if (typeof bg === 'string' && bg.startsWith('data:')) {
      const ref = bgRefByData.get(bg)
      if (ref) { doc.backgroundImage = ref; payloadData = JSON.stringify(doc) }  // already in Drive: send only the reference
    }
  } catch { /* the server rejects invalid JSON */ }
  const key = `${projectId}:${floorNumber}`
  const res = await gasCall<{ drawing: Row }>('drawing.save', {
    projectId, floorNumber, data: payloadData, scalePxPerMeter: num(body.scalePxPerMeter, 40), calibrated: body.calibrated === true, expectedRev: drawingRev.get(key),
  }, { write: true, label: `Save drawing (floor ${floorNumber})`, timeoutMs: 150_000 })
  drawingRev.set(key, res.drawing.rev)
  if (res.drawing.bgFileId) {
    try {
      const doc = JSON.parse(body.data) as Record<string, unknown>
      if (typeof doc.backgroundImage === 'string' && doc.backgroundImage.startsWith('data:')) bgRefByData.set(doc.backgroundImage, `drive:${res.drawing.bgFileId}`)
    } catch { /* ignore */ }
  }
  return { drawing: { ...res.drawing, data: body.data } }
}

void ApiError; void dataUrlParts
