// Bulk import of materials from a validated CSV preview. All writes go through the gateway, which
// validates again (unique code, ranges, permissions). Chunks are atomic; when a chunk is refused
// the rows are retried one by one so the report can name the exact rows that failed.
import { newId } from './gas'
import * as repo from './repo'
import { ensure, mutate, opCreate, updateOp, type MutateOp } from './repo'
import type { PreviewRow } from '@/lib/material-csv'

export type DuplicateMode = 'skip' | 'update'
export interface ImportOptions { duplicates: DuplicateMode; createSuppliers: boolean; onProgress?: (done: number, total: number) => void }
export interface ImportReport {
  created: number; updated: number; skipped: number
  failed: Array<{ line: number; code: string; message: string }>
  suppliersCreated: number
}

const CHUNK = 150

function fieldsOf(r: PreviewRow, supplierId: string) {
  const d = r.data
  return {
    category: d.category, name: d.name, brand: d.brand, model: d.model, specification: d.specification, size: d.size, unit: d.unit,
    packSize: d.packSize, packUnit: d.packUnit, supplierId, purchasePrice: d.purchasePrice, sellingPrice: d.sellingPrice,
  }
}

export async function importMaterials(rows: PreviewRow[], opts: ImportOptions): Promise<ImportReport> {
  await ensure(['materials', 'suppliers'], { force: true })
  const report: ImportReport = { created: 0, updated: 0, skipped: 0, failed: [], suppliersCreated: 0 }

  // 1) suppliers that do not exist yet (optional)
  const bySupplier = new Map(repo.rows('suppliers').map((s) => [String(s.name).trim().toLowerCase(), s.id as string]))
  if (opts.createSuppliers) {
    const wanted = new Map<string, string>()
    for (const r of rows) {
      const n = r.data.supplierName.trim()
      if (n && !r.data.supplierId && !bySupplier.has(n.toLowerCase())) wanted.set(n.toLowerCase(), n)
    }
    if (wanted.size) {
      const ops = [...wanted.values()].map((name) => { const id = newId(); bySupplier.set(name.toLowerCase(), id); return opCreate('suppliers', { name }, id) })
      await mutate(ops, 'Create suppliers (bulk upload)')
      report.suppliersCreated = ops.length
    }
  }

  // 2) turn rows into operations
  type Item = { row: PreviewRow; ops: MutateOp[]; kind: 'create' | 'update' }
  const items: Item[] = []
  for (const r of rows) {
    if (r.status === 'error' || r.status === 'dup-file') { report.skipped++; continue }
    const supplierId = r.data.supplierId || bySupplier.get(r.data.supplierName.trim().toLowerCase()) || ''
    if (r.status === 'dup-existing') {
      if (opts.duplicates === 'skip' || !r.existingId) { report.skipped++; continue }
      const prev = repo.get('materials', r.existingId)
      if (!prev) { report.skipped++; continue }
      const f = fieldsOf(r, supplierId || prev.supplierId)
      const ops: MutateOp[] = [updateOp('materials', r.existingId, f)]   // stock is NOT changed here: stock moves belong to Inventory
      if (f.purchasePrice !== prev.purchasePrice || f.sellingPrice !== prev.sellingPrice) {
        ops.push(opCreate('priceHistory', { materialId: r.existingId, oldPurchase: prev.purchasePrice, newPurchase: f.purchasePrice, oldSelling: prev.sellingPrice, newSelling: f.sellingPrice, note: 'CSV bulk update' }, newId()))
      }
      items.push({ row: r, ops, kind: 'update' })
    } else {
      items.push({ row: r, ops: [opCreate('materials', { code: r.data.code, ...fieldsOf(r, supplierId), stockQty: r.data.stockQty, minStock: r.data.minStock }, newId())], kind: 'create' })
    }
  }

  // 3) write in chunks; fall back to single rows when a chunk is rejected
  let done = 0
  const total = items.length
  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
  const count = (it: Item) => { if (it.kind === 'create') report.created++; else report.updated++ }
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK)
    try {
      await mutate(chunk.flatMap((c) => c.ops), 'Bulk material upload')
      chunk.forEach(count)
    } catch (e) {
      if (chunk.length === 1 || /NETWORK|offline|Cannot reach/i.test(msg(e))) {
        // network errors are queued by the transport as pending changes; report honestly as not saved
        chunk.forEach((c) => report.failed.push({ line: c.row.line, code: c.row.data.code, message: msg(e) }))
      } else {
        for (const c of chunk) {
          try { await mutate(c.ops, 'Bulk material upload (row)'); count(c) }
          catch (e2) { report.failed.push({ line: c.row.line, code: c.row.data.code, message: msg(e2) }) }
        }
      }
    }
    done += chunk.length
    opts.onProgress?.(done, total)
  }
  repo.invalidate(['materials', 'priceHistory'])
  return report
}
