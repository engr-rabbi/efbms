
// Client-side export helpers: CSV, Excel (SheetJS), Print
import type { BoqLine } from '@/lib/engine/boq'
import { toast } from 'sonner'
import { useAppStore } from '@/lib/store'
import { uploadFile, MAX_UPLOAD_BYTES } from '@/lib/backend/files'

/** While a project is open, every exported CSV/Excel report also gets a private copy in Drive › Projects/<project>/Reports. */
async function archiveToDrive(blob: Blob, filename: string) {
  const { activeProjectId, user } = useAppStore.getState()
  if (!activeProjectId || !user || !['SUPER_ADMIN', 'ENGINEER', 'SALES'].includes(user.role)) return
  try { if (localStorage.getItem('efbms-archive-reports') === '0') return } catch { /* default on */ }
  if (blob.size > MAX_UPLOAD_BYTES || !/\.(csv|xlsx|xls|json|txt|pdf)$/i.test(filename)) return
  const d = new Date(), p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
  try {
    await uploadFile({ category: 'Reports', projectId: activeProjectId, file: blob, name: `${stamp}_${filename}` })
    toast.success('Copy saved to Google Drive › Reports')
  } catch (e) {
    toast.warning(`Downloaded, but the Drive copy failed: ${e instanceof Error ? e.message : 'error'}`)
  }
}

export function downloadBlob(content: BlobPart, filename: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  void archiveToDrive(blob, filename)
}

export function toCsv(rows: Array<Record<string, unknown>>, headers?: string[]): string {
  if (!rows.length) return ''
  const keys = headers ?? Object.keys(rows[0])
  const esc = (v: unknown) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [keys.map(esc).join(','), ...rows.map((r) => keys.map((k) => esc(r[k])).join(','))].join('\n')
}

export function exportCsv(rows: Array<Record<string, unknown>>, filename: string, headers?: string[]) {
  downloadBlob('\uFEFF' + toCsv(rows, headers), filename, 'text/csv;charset=utf-8')
}

export async function exportExcel(rows: Array<Record<string, unknown>>, filename: string, sheetName = 'Sheet1') {
  const XLSX = await import('xlsx')
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  XLSX.writeFile(wb, filename)
}

export function boqRows(lines: BoqLine[]) {
  return lines.map((l) => ({
    'Item No': l.itemNo, System: l.system, Category: l.category, 'Material Name': l.name,
    Brand: l.brand, Specification: l.specification, Size: l.size, Unit: l.unit,
    'Est Qty (Mode A)': l.qtyAuto, 'Verified Qty (Drawing)': l.qtyDrawing, 'Final Qty': l.qtyFinal,
    'Wastage %': l.wastagePct, 'Qty + Wastage': l.qtyWithWastage, 'Purchase Qty': l.purchaseQty,
    Stock: l.stockQty, Shortage: l.shortage, 'Unit Purchase': l.unitPurchasePrice,
    'Unit Selling': l.unitSellingPrice, 'Total Purchase Cost': l.totalPurchaseCost,
    'Total Selling': l.totalSellingPrice, Profit: l.profit, Mode: l.modeMix,
    Remarks: l.override !== undefined ? 'Manual override' : '',
  }))
}

export function printSection(elementId: string) {
  const el = document.getElementById(elementId)
  if (!el) return
  document.body.classList.add('printing')
  const cleanup = () => {
    document.body.classList.remove('printing')
    window.removeEventListener('afterprint', cleanup)
  }
  window.addEventListener('afterprint', cleanup)
  window.print()
}

export const fmtBDT = (n: number) =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(Math.round(n * 100) / 100)
