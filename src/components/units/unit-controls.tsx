
// =============================================================================
// unit-controls.tsx — Reusable unit-aware UI controls.
//   UnitSelect : unit dropdown (registry-driven → future units appear free)
//   UnitInput  : measurement input bound to INTERNAL meters/m², displays in the
//                active unit, auto-converts its shown value when the unit
//                changes, and stores back to internal units on edit.
//   UnitText   : inline converted display ("value symbol").
//   UnitQuickSelector : compact header dropdown for the global unit.
// =============================================================================

import { useCallback, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Check, ChevronDown, Ruler } from 'lucide-react'
import { useAppStore, useT } from '@/lib/store'
import { useFmt, useUnitPrefs, useSetUnitPref, useUnitStore } from '@/lib/unit-store'
import {
  LENGTH_UNITS, AREA_UNITS, lengthSymbol, areaSymbol,
  mToLen, lenToM, sqmToArea, areaToSqm, trimNum,
  type LengthUnit, type AreaUnit,
} from '@/lib/units'

// ------------------------------- UnitSelect ----------------------------------

// Radix Select forbids empty-string item values → sentinel for "follow global".
const EMPTY_UNIT = '__global__'

export function UnitSelect({
  kind, value, onChange, triggerClass, includeEmpty = false, emptyLabel, disabled, id,
}: {
  kind: 'length' | 'area'
  value: string
  onChange: (v: string) => void
  triggerClass?: string
  includeEmpty?: boolean
  emptyLabel?: string
  disabled?: boolean
  id?: string
}) {
  const lang = useAppStore((s) => s.lang)
  const units = Object.values(kind === 'length' ? LENGTH_UNITS : AREA_UNITS)
  return (
    <Select
      value={includeEmpty ? (value || EMPTY_UNIT) : value}
      onValueChange={(v) => onChange(includeEmpty && v === EMPTY_UNIT ? '' : v)}
      disabled={disabled}
    >
      <SelectTrigger id={id} className={triggerClass ?? 'h-9 w-full text-sm'}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {includeEmpty && <SelectItem value={EMPTY_UNIT}>{emptyLabel ?? '—'}</SelectItem>}
        {units.map((u) => (
          <SelectItem key={u.code} value={u.code}>
            {lang === 'bn' ? u.nameBn : u.nameEn} ({u.symbol})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// ------------------------------- UnitInput -----------------------------------

export function UnitInput({
  meters, onMeters, kind = 'length', step, min, max, id, className, disabled, ariaLabel,
}: {
  /** Value in INTERNAL units (meters for length, m² for area). */
  meters: number
  /** Called with the new value converted back to INTERNAL units. */
  onMeters: (v: number) => void
  kind?: 'length' | 'area'
  step?: number
  min?: number
  max?: number
  id?: string
  className?: string
  disabled?: boolean
  ariaLabel?: string
}) {
  const prefs = useUnitPrefs()
  const unit = (kind === 'length' ? prefs.lengthUnit : prefs.areaUnit) as string
  const symbol = kind === 'length' ? lengthSymbol(unit as LengthUnit) : areaSymbol(unit as AreaUnit)

  const toDisp = useCallback(
    (v: number) => (kind === 'length' ? mToLen(v, unit as LengthUnit) : sqmToArea(v, unit as AreaUnit)),
    [kind, unit],
  )
  const toStd = useCallback(
    (v: number) => (kind === 'length' ? lenToM(v, unit as LengthUnit) : areaToSqm(v, unit as AreaUnit)),
    [kind, unit],
  )

  const [focused, setFocused] = useState(false)

  // Display text: derived from the internal value + active unit. When the unit
  // (or the external meters value) changes, the field re-displays the correctly
  // converted value — the stored internal value is untouched (spec: input shows
  // converted value after unit change). Implemented with the React-approved
  // "adjust state during render" pattern (no setState-in-effect).
  const display = trimNum(toDisp(meters ?? 0), 4)
  const [shown, setShown] = useState(display)
  const [prevDisplay, setPrevDisplay] = useState(display)
  if (prevDisplay !== display) {
    setPrevDisplay(display)
    if (!focused) setShown(display)
  }

  return (
    <div className={`relative ${className ?? ''}`}>
      <Input
        type="number"
        inputMode="decimal"
        step={step ?? 0.1}
        min={min}
        max={max}
        id={id}
        disabled={disabled}
        aria-label={ariaLabel}
        className="pr-11"
        value={shown}
        onFocus={() => setFocused(true)}
        onChange={(e) => {
          const v = e.target.value
          setShown(v)
          const n = parseFloat(v)
          if (Number.isFinite(n) && (min === undefined || n >= min) && (max === undefined || n <= max)) {
            onMeters(toStd(n))
          }
        }}
        onBlur={() => {
          setFocused(false)
          const n = parseFloat(shown)
          setShown(Number.isFinite(n) ? trimNum(toDisp(toStd(n)), 4) : display)
        }}
      />
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 select-none text-[11px] font-semibold text-slate-400">
        {symbol}
      </span>
    </div>
  )
}

// ------------------------------- UnitText ------------------------------------

/** Inline converted display: internal meters → "value symbol" (length). */
export function UnitLenText({ meters, precision, className }: { meters: number; precision?: number | null; className?: string }) {
  const f = useFmt()
  return <span className={className}>{f.lenS(meters, precision)}</span>
}

/** Inline converted display: internal m² → "value symbol" (area). */
export function UnitAreaText({ sqm, precision, className }: { sqm: number; precision?: number | null; className?: string }) {
  const f = useFmt()
  return <span className={className}>{f.areaS(sqm, precision)}</span>
}

// --------------------------- Quick unit selector -----------------------------

/** Compact header dropdown: switch the GLOBAL default length/area unit anywhere. */
export function UnitQuickSelector() {
  const t = useT()
  const lang = useAppStore((s) => s.lang)
  // NOTE: header selector reflects & changes the GLOBAL default only.
  // A project-specific override (set in Project → Overview) is displayed there.
  const prefs = useUnitStore((s) => s.prefs)
  const setPrefs = useSetUnitPref()
  const lenUnits = Object.values(LENGTH_UNITS)
  const areaUnits = Object.values(AREA_UNITS)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1.5 px-2.5 text-xs font-semibold"
          title={t('measurementUnit')}
          aria-label={t('measurementUnit')}
        >
          <Ruler className="h-3.5 w-3.5 text-amber-600" />
          {LENGTH_UNITS[prefs.lengthUnit]?.symbol ?? 'm'}
          <ChevronDown className="h-3 w-3 text-slate-400" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-[11px] text-slate-500">{t('lengthUnit')}</DropdownMenuLabel>
        {lenUnits.map((u) => (
          <DropdownMenuItem key={u.code} onClick={() => setPrefs({ lengthUnit: u.code as LengthUnit })}>
            <Check className={`h-3.5 w-3.5 text-amber-600 ${prefs.lengthUnit === u.code ? 'opacity-100' : 'opacity-0'}`} />
            <span>{lang === 'bn' ? u.nameBn : u.nameEn}</span>
            <span className="ml-auto text-slate-400">{u.symbol}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[11px] text-slate-500">{t('areaUnit')}</DropdownMenuLabel>
        {areaUnits.map((u) => (
          <DropdownMenuItem key={u.code} onClick={() => setPrefs({ areaUnit: u.code as AreaUnit })}>
            <Check className={`h-3.5 w-3.5 text-amber-600 ${prefs.areaUnit === u.code ? 'opacity-100' : 'opacity-0'}`} />
            <span>{lang === 'bn' ? u.nameBn : u.nameEn}</span>
            <span className="ml-auto text-slate-400">{u.symbol}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
