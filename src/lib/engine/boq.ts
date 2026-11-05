// =============================================================================
// Engine: BOQ consolidation, purchase rounding, stock/shortage mapping
// =============================================================================
import type { RawEstimateItem } from './types'

export interface MaterialLite {
  id: string
  code: string
  category: string
  name: string
  brand: string
  specification: string
  size: string
  unit: string
  packSize: number
  packUnit: string
  purchasePrice: number
  sellingPrice: number
  stockQty: number
  minStock: number
}

export interface BoqLine {
  key: string
  itemNo: number
  system: string
  category: string
  name: string
  brand: string
  specification: string
  size: string
  unit: string
  qtyAuto: number
  qtyDrawing: number
  qtyFinal: number
  modeMix: 'AUTO' | 'DRAWING' | 'MIXED'
  wastagePct: number
  qtyWithWastage: number
  packSize: number
  packUnit: string
  purchaseQty: number
  stockQty: number
  shortage: number
  materialId: string
  unitPurchasePrice: number
  unitSellingPrice: number
  totalPurchaseCost: number
  totalSellingPrice: number
  profit: number
  override?: number
  breakdown: Array<{ floorName: string; roomName: string; qty: number; mode: string }>
}

export function consolidationKey(i: Pick<RawEstimateItem, 'system' | 'category' | 'name' | 'brand' | 'specification' | 'size' | 'unit'>): string {
  return [i.system, i.category, i.name, i.brand, i.specification, i.size, i.unit].join('||')
}

export function buildBoq(
  rawItems: RawEstimateItem[],
  materials: MaterialLite[],
  overrides: Record<string, { qty: number; reason: string; userName: string }> = {},
): { lines: BoqLine[] } {
  const map = new Map<string, BoqLine>()

  for (const it of rawItems) {
    const key = consolidationKey(it)
    let line = map.get(key)
    if (!line) {
      line = {
        key, itemNo: 0, system: it.system, category: it.category, name: it.name,
        brand: it.brand, specification: it.specification, size: it.size, unit: it.unit,
        qtyAuto: 0, qtyDrawing: 0, qtyFinal: 0, modeMix: 'AUTO', wastagePct: it.wastagePct,
        qtyWithWastage: 0, packSize: 1, packUnit: '', purchaseQty: 0, stockQty: 0,
        shortage: 0, materialId: it.materialId ?? '', unitPurchasePrice: 0,
        unitSellingPrice: 0, totalPurchaseCost: 0, totalSellingPrice: 0, profit: 0,
        breakdown: [],
      }
      map.set(key, line)
    }
    if (it.mode === 'DRAWING') line.qtyDrawing += it.qty
    else line.qtyAuto += it.qty
    line.breakdown.push({
      floorName: it.floorName ?? '', roomName: it.roomName ?? '',
      qty: Math.round(it.qty * 100) / 100, mode: it.mode,
    })
  }

  // material matching (best-effort by normalized name+size or explicit materialId)
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9.]+/g, ' ').trim()
  const matchMaterial = (l: BoqLine): MaterialLite | undefined => {
    if (l.materialId) {
      const m = materials.find((x) => x.id === l.materialId)
      if (m) return m
    }
    const candidates = materials.filter((m) => norm(m.name) === norm(l.name) && (!l.size || norm(m.size) === norm(l.size) || !m.size))
    if (candidates.length === 1) return candidates[0]
    const byCatSize = materials.filter((m) => norm(m.name).includes(norm(l.name).slice(0, 14)) && norm(m.size) === norm(l.size))
    return byCatSize[0]
  }

  const lines = [...map.values()]
  for (const line of lines) {
    line.qtyAuto = Math.round(line.qtyAuto * 100) / 100
    line.qtyDrawing = Math.round(line.qtyDrawing * 100) / 100
    const ov = overrides[line.key]
    if (ov) {
      line.override = ov.qty
      line.qtyFinal = ov.qty
    } else {
      // Drawing-based verified quantity takes precedence when present
      line.qtyFinal = line.qtyDrawing > 0 ? line.qtyDrawing : line.qtyAuto
    }
    line.modeMix = line.qtyDrawing > 0 && line.qtyAuto > 0 ? 'MIXED' : line.qtyDrawing > 0 ? 'DRAWING' : 'AUTO'

    line.qtyWithWastage = Math.round(line.qtyFinal * (1 + line.wastagePct / 100) * 100) / 100

    const mat = matchMaterial(line)
    if (mat) {
      line.materialId = mat.id
      line.brand = line.brand || mat.brand
      line.packSize = mat.packSize
      line.packUnit = mat.packUnit
      line.unitPurchasePrice = mat.purchasePrice
      line.unitSellingPrice = mat.sellingPrice
      line.stockQty = mat.stockQty
    }

    // purchase rounding: linear materials rounded up to standard pack, else ceil
    if (line.unit === 'm' && line.packSize > 1) {
      line.purchaseQty = Math.ceil(line.qtyWithWastage / line.packSize) * line.packSize
    } else {
      line.purchaseQty = Math.ceil(line.qtyWithWastage)
    }
    line.shortage = Math.max(0, line.purchaseQty - line.stockQty)
    line.totalPurchaseCost = Math.round(line.qtyWithWastage * line.unitPurchasePrice * 100) / 100
    line.totalSellingPrice = Math.round(line.qtyWithWastage * line.unitSellingPrice * 100) / 100
    line.profit = Math.round((line.totalSellingPrice - line.totalPurchaseCost) * 100) / 100
  }

  lines.sort((a, b) =>
    a.system.localeCompare(b.system) || a.category.localeCompare(b.category) || a.name.localeCompare(b.name) || a.size.localeCompare(b.size, undefined, { numeric: true }),
  )
  lines.forEach((l, i) => (l.itemNo = i + 1))

  return { lines }
}

// ---- CSV / Excel export helpers (client-usable) -----------------------------

export function boqToCsv(lines: BoqLine[], mode: 'ELECTRICAL' | 'PLUMBING' | 'COMBINED' = 'COMBINED'): string {
  const filtered = lines.filter((l) => mode === 'COMBINED' || l.system === mode)
  const headers = [
    'Item No', 'System', 'Category', 'Material Name', 'Brand', 'Specification', 'Size',
    'Unit', 'Est. Qty (Mode A)', 'Verified Qty (Drawing)', 'Final Qty', 'Wastage %',
    'Qty + Wastage', 'Purchase Qty', 'Stock', 'Shortage', 'Unit Purchase Price',
    'Unit Selling Price', 'Total Purchase Cost', 'Total Selling Price', 'Profit', 'Mode', 'Remarks',
  ]
  const esc = (v: string | number) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const rows = filtered.map((l) =>
    [l.itemNo, l.system, l.category, l.name, l.brand, l.specification, l.size, l.unit,
      l.qtyAuto, l.qtyDrawing, l.qtyFinal, l.wastagePct, l.qtyWithWastage, l.purchaseQty,
      l.stockQty, l.shortage, l.unitPurchasePrice, l.unitSellingPrice, l.totalPurchaseCost,
      l.totalSellingPrice, l.profit, l.modeMix, l.override !== undefined ? 'Manual override' : ''].map(esc).join(','),
  )
  return [headers.map(esc).join(','), ...rows].join('\n')
}
