
// QuotationPrint — professional A4 quotation document.
// Rendered inside the detail pane (#quotation-print-area) and cloned to <body>
// as a .print-portal when printing. Kept free of screen-only chrome.

import { useMemo } from 'react'
import { fmtBDT } from '@/lib/export-utils'

export interface QuotationItem {
  name: string
  specification?: string
  size?: string
  unit: string
  qty: number
  unitPrice: number
  lineTotal: number
  totalCost?: number
}

export interface QuotationPrintData {
  quotationNo: string
  quotationType: string
  revision: number
  status: string
  date: string
  validUntil: string
  items: string
  subtotal: number
  discountType: string
  discountValue: number
  otherCharges: number
  otherChargesLabel: string
  vatPct: number
  grandTotal: number
  totalCost: number
  paymentTerms?: string
  deliveryTerms?: string
  terms?: string
  notes?: string
  createdBy?: string
}

export interface QuotationCompany {
  name: string
  logoText?: string
  address?: string
  phone?: string
  email?: string
  licenseNo?: string
  vatRegNo?: string
}

export interface QuotationProject {
  name: string
  code?: string
  clientName?: string
  clientAddress?: string
  clientPhone?: string
  location?: string
}

/* ---------------- date + number helpers ---------------- */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function fmtPrintDate(iso: string): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return iso
  return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`
}

const fmtQty = (q: number) =>
  Number.isFinite(q) ? (Number.isInteger(q) ? String(q) : q.toFixed(2)) : '0'

/* ---------------- BDT number-to-words (lakh/crore) ---------------- */

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen',
  'Eighteen', 'Nineteen',
]
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function twoDigits(n: number): string {
  if (n < 20) return ONES[n]
  const t = Math.floor(n / 10)
  const o = n % 10
  return TENS[t] + (o ? ` ${ONES[o]}` : '')
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100)
  const rest = n % 100
  let s = ''
  if (h) s = `${ONES[h]} Hundred`
  if (rest) s += (s ? ' ' : '') + twoDigits(rest)
  return s
}

/** e.g. 125000 -> "Taka One Lakh Twenty Five Thousand Only" */
export function numberToWordsBDT(amount: number): string {
  const neg = amount < 0
  const abs = Math.abs(Math.round(amount * 100) / 100)
  const taka = Math.floor(abs)
  const poisha = Math.round((abs - taka) * 100)
  if (!taka && !poisha) return 'Taka Zero Only'

  const crore = Math.floor(taka / 10000000)
  const lakh = Math.floor((taka % 10000000) / 100000)
  const thousand = Math.floor((taka % 100000) / 1000)
  const rest = taka % 1000

  const parts: string[] = []
  if (crore) parts.push(`${threeDigits(crore)} Crore`)
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`)
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`)
  if (rest) parts.push(threeDigits(rest))

  let words = parts.join(' ').trim() || 'Zero'
  if (poisha) words += ` and ${twoDigits(poisha)} Poisha`
  return `Taka ${neg ? 'Minus ' : ''}${words} Only`
}

/* ---------------- component ---------------- */

function parseItems(raw: string): QuotationItem[] {
  try {
    const arr = JSON.parse(raw) as QuotationItem[]
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function companyInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return 'EF'
  return words.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')
}

export function QuotationPrint({
  quotation,
  company,
  project,
}: {
  quotation: QuotationPrintData
  company: QuotationCompany
  project: QuotationProject
}) {
  const items = useMemo(() => parseItems(quotation.items), [quotation.items])

  const discountAmt =
    quotation.discountType === 'PERCENT'
      ? (quotation.subtotal * quotation.discountValue) / 100
      : quotation.discountValue
  const vatAmt = ((quotation.subtotal - discountAmt) * quotation.vatPct) / 100
  const words = numberToWordsBDT(quotation.grandTotal)
  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

  const discountLabel =
    quotation.discountType === 'PERCENT'
      ? `Discount (${quotation.discountValue}%)`
      : 'Discount'

  const otherLabel = quotation.otherChargesLabel
    ? `Other Charges — ${quotation.otherChargesLabel}`
    : 'Other Charges'

  return (
    <div className="mx-auto w-full max-w-[820px] bg-white text-slate-900">
      {/* top accent strip */}
      <div className="h-1.5 w-full bg-gradient-to-r from-amber-500 via-slate-600 to-emerald-600" />

      <div className="px-6 py-5 sm:px-8">
        {/* ---------- header ---------- */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-slate-900 text-sm font-bold text-white">
              {companyInitials(company.logoText || company.name)}
            </div>
            <div>
              <div className="text-lg font-bold leading-tight tracking-tight sm:text-xl">
                {company.name}
              </div>
              {company.address ? (
                <div className="mt-0.5 max-w-[300px] whitespace-pre-line text-[11px] leading-snug text-slate-600">
                  {company.address}
                </div>
              ) : null}
              <div className="mt-0.5 text-[11px] text-slate-600">
                {[company.phone, company.email].filter(Boolean).join('  ·  ')}
              </div>
              {company.licenseNo || company.vatRegNo ? (
                <div className="mt-0.5 text-[10px] text-slate-500">
                  {[company.licenseNo ? `License: ${company.licenseNo}` : '', company.vatRegNo ? `VAT Reg: ${company.vatRegNo}` : '']
                    .filter(Boolean)
                    .join('  ·  ')}
                </div>
              ) : null}
            </div>
          </div>

          <div className="sm:text-right">
            <div className="text-2xl font-extrabold uppercase tracking-wide text-slate-900 sm:text-[26px]">
              Quotation
            </div>
            <div className="mt-1 space-y-0.5 text-[11px] text-slate-700">
              <div>
                <span className="text-slate-500">No: </span>
                <span className="font-bold">{quotation.quotationNo}</span>
              </div>
              <div>
                <span className="text-slate-500">Date: </span>
                <span className="font-medium">{fmtPrintDate(quotation.date)}</span>
              </div>
              <div>
                <span className="text-slate-500">Valid Until: </span>
                <span className="font-medium">{fmtPrintDate(quotation.validUntil)}</span>
              </div>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 sm:justify-end">
              <span className="inline-flex items-center rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700">
                {quotation.quotationType}
              </span>
              {quotation.revision > 0 ? (
                <span className="inline-flex items-center rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                  Revision {quotation.revision} · supersedes previous
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-3 border-b-4 border-double border-slate-800" />

        {/* ---------- client / project ---------- */}
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Quotation For
            </div>
            <div className="mt-1 text-sm font-semibold">{project.clientName || '—'}</div>
            {project.clientAddress ? (
              <div className="mt-0.5 whitespace-pre-line text-xs leading-snug text-slate-600">
                {project.clientAddress}
              </div>
            ) : null}
            {project.clientPhone ? (
              <div className="mt-0.5 text-xs text-slate-600">Phone: {project.clientPhone}</div>
            ) : null}
          </div>
          <div className="sm:text-right">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Project
            </div>
            <div className="mt-1 text-sm font-semibold">
              {project.name}
              {project.code ? <span className="ml-1.5 text-xs font-normal text-slate-500">({project.code})</span> : null}
            </div>
            {project.location ? (
              <div className="mt-0.5 text-xs text-slate-600">{project.location}</div>
            ) : null}
          </div>
        </div>

        {/* ---------- items ---------- */}
        <table className="mt-4 w-full border-collapse text-xs">
          <thead>
            <tr className="border-y border-slate-300 bg-slate-100 text-left text-[10px] uppercase tracking-wide text-slate-700">
              <th className="w-8 px-2 py-1.5 font-semibold">#</th>
              <th className="px-2 py-1.5 font-semibold">Material &amp; Specification</th>
              <th className="w-14 px-2 py-1.5 font-semibold">Unit</th>
              <th className="w-14 px-2 py-1.5 text-right font-semibold">Qty</th>
              <th className="w-24 px-2 py-1.5 text-right font-semibold">Unit Price</th>
              <th className="w-28 px-2 py-1.5 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-2 py-4 text-center text-slate-500">
                  No items in this quotation.
                </td>
              </tr>
            ) : (
              items.map((it, i) => (
                <tr key={`${it.name}-${i}`} className="border-b border-slate-100 odd:bg-white even:bg-slate-50">
                  <td className="px-2 py-1.5 align-top text-slate-500">{i + 1}</td>
                  <td className="px-2 py-1.5 align-top">
                    <div className="font-medium text-slate-900">{it.name}</div>
                    <div className="text-[11px] leading-snug text-slate-500">
                      {[it.specification, it.size].filter(Boolean).join('  ·  ')}
                    </div>
                  </td>
                  <td className="px-2 py-1.5 align-top text-slate-600">{it.unit}</td>
                  <td className="px-2 py-1.5 text-right align-top font-medium">{fmtQty(it.qty)}</td>
                  <td className="px-2 py-1.5 text-right align-top">{fmtBDT(it.unitPrice)}</td>
                  <td className="px-2 py-1.5 text-right align-top font-medium">{fmtBDT(it.lineTotal)}</td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-300">
              <td colSpan={5} className="px-2 pt-2 text-right text-slate-600">Subtotal</td>
              <td className="px-2 pt-2 text-right font-semibold">{fmtBDT(quotation.subtotal)}</td>
            </tr>
            {quotation.discountValue > 0 ? (
              <tr>
                <td colSpan={5} className="px-2 pt-1 text-right text-slate-600">{discountLabel}</td>
                <td className="px-2 pt-1 text-right">− {fmtBDT(discountAmt)}</td>
              </tr>
            ) : null}
            {quotation.otherCharges > 0 ? (
              <tr>
                <td colSpan={5} className="px-2 pt-1 text-right text-slate-600">{otherLabel}</td>
                <td className="px-2 pt-1 text-right">+ {fmtBDT(quotation.otherCharges)}</td>
              </tr>
            ) : null}
            {quotation.vatPct > 0 ? (
              <tr>
                <td colSpan={5} className="px-2 pt-1 text-right text-slate-600">VAT ({quotation.vatPct}%)</td>
                <td className="px-2 pt-1 text-right">+ {fmtBDT(vatAmt)}</td>
              </tr>
            ) : null}
            <tr>
              <td colSpan={5} className="border-t-4 border-double border-slate-900 px-2 pb-1.5 pt-2 text-right text-sm font-bold uppercase text-slate-900">
                Grand Total
              </td>
              <td className="border-t-4 border-double border-slate-900 px-2 pb-1.5 pt-2 text-right text-sm font-extrabold text-slate-900">
                ৳ {fmtBDT(quotation.grandTotal)}
              </td>
            </tr>
          </tfoot>
        </table>

        {/* amount in words */}
        <div className="mt-2 border border-slate-200 bg-slate-50 px-3 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">In Words: </span>
          <span className="text-[11px] font-medium italic text-slate-800">{words}</span>
        </div>

        {/* ---------- terms ---------- */}
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {quotation.paymentTerms ? (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Payment Terms</div>
              <div className="mt-1 whitespace-pre-line text-xs leading-snug text-slate-700">{quotation.paymentTerms}</div>
            </div>
          ) : null}
          {quotation.deliveryTerms ? (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Delivery Terms</div>
              <div className="mt-1 whitespace-pre-line text-xs leading-snug text-slate-700">{quotation.deliveryTerms}</div>
            </div>
          ) : null}
        </div>

        {quotation.terms ? (
          <div className="mt-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Terms &amp; Conditions</div>
            <div className="mt-1 whitespace-pre-line text-xs leading-snug text-slate-700">{quotation.terms}</div>
          </div>
        ) : null}

        {quotation.notes ? (
          <div className="mt-3 border-l-2 border-amber-400 bg-amber-50 px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">Notes</div>
            <div className="mt-0.5 whitespace-pre-line text-xs leading-snug text-slate-700">{quotation.notes}</div>
          </div>
        ) : null}

        {/* ---------- signatures ---------- */}
        <div className="mt-12 grid grid-cols-2 gap-8">
          <div className="text-center">
            <div className="border-t border-slate-500 pt-1 text-[11px] font-medium text-slate-700">
              Client Acceptance
            </div>
            <div className="mt-3 text-[10px] text-slate-500">
              Name / Signature / Date
            </div>
          </div>
          <div className="text-center">
            <div className="border-t border-slate-500 pt-1 text-[11px] font-medium text-slate-700">
              Authorized Signature
            </div>
            <div className="mt-1 text-[11px] font-semibold text-slate-800">{company.name}</div>
          </div>
        </div>

        {/* ---------- footer ---------- */}
        <div className="mt-8 flex flex-col gap-1 border-t border-slate-300 pt-2 text-[10px] text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <span>Printed: {today}</span>
          <span>Computer generated quotation — ElectroFlow BMS</span>
        </div>
      </div>
    </div>
  )
}

export default QuotationPrint
