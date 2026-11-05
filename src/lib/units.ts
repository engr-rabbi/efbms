// =============================================================================
// units.ts — CENTRAL measurement unit registry & conversion engine.
//
// DESIGN CONTRACT (Global Unit Settings spec):
//   * Every measurement is STORED in a standard internal unit:
//       - Length  → meters (m)
//       - Area    → square meters (m²)
//     Database values, drawing geometry, scale (pxPerMeter), cable/pipe route
//     coordinates and calculated quantities ALWAYS stay in internal units.
//   * Only DISPLAY conversion happens, at render time, via the helpers below.
//     A display-unit change must never alter geometry, scale, positions,
//     routes, quantities or any persisted data.
//   * Conversions use exact international factors (1 ft = 0.3048 m exactly,
//     1 in = 0.0254 m exactly) so conversions are lossless & reversible.
//   * The registry is EXTENSIBLE: registerLengthUnit()/registerAreaUnit()
//     add new units at runtime; all selectors, formatters and conversions
//     pick them up automatically.
// No React, no side effects — pure functions (engine/UI separation rule).
// =============================================================================

// --------------------------------- Types -------------------------------------

export type LengthUnit = 'm' | 'cm' | 'mm' | 'ft' | 'in'
export type AreaUnit = 'm2' | 'ft2' | 'in2'
export type RoundingMode = 'NEAREST' | 'UP' | 'DOWN'

export interface UnitDef {
  code: string
  /** Display symbol, e.g. "m", "ft", "m²" */
  symbol: string
  nameEn: string
  nameBn: string
  /** Factor: how many STANDARD internal units are in ONE of this unit. */
  factor: number
  /** Decimal places used for display when the user has not overridden it. */
  defaultPrecision: number
}

export interface UnitPrefs {
  lengthUnit: LengthUnit
  areaUnit: AreaUnit
  /** null = use each unit's defaultPrecision */
  lengthPrecision: number | null
  areaPrecision: number | null
  rounding: RoundingMode
}

export const DEFAULT_UNIT_PREFS: UnitPrefs = {
  lengthUnit: 'm',
  areaUnit: 'm2',
  lengthPrecision: null,
  areaPrecision: null,
  rounding: 'NEAREST',
}

// ------------------------------- Registries ----------------------------------
// Mutable records (not const-asserted) so future units can be registered at
// runtime without touching any call-site.

export const LENGTH_UNITS: Record<string, UnitDef> = {
  m: { code: 'm', symbol: 'm', nameEn: 'Meter', nameBn: 'মিটার', factor: 1, defaultPrecision: 2 },
  cm: { code: 'cm', symbol: 'cm', nameEn: 'Centimeter', nameBn: 'সেন্টিমিটার', factor: 0.01, defaultPrecision: 1 },
  mm: { code: 'mm', symbol: 'mm', nameEn: 'Millimeter', nameBn: 'মিলিমিটার', factor: 0.001, defaultPrecision: 0 },
  ft: { code: 'ft', symbol: 'ft', nameEn: 'Feet', nameBn: 'ফুট', factor: 0.3048, defaultPrecision: 2 },
  in: { code: 'in', symbol: 'in', nameEn: 'Inch', nameBn: 'ইঞ্চি', factor: 0.0254, defaultPrecision: 1 },
}

export const AREA_UNITS: Record<string, UnitDef> = {
  m2: { code: 'm2', symbol: 'm²', nameEn: 'Square Meter', nameBn: 'বর্গ মিটার', factor: 1, defaultPrecision: 2 },
  ft2: { code: 'ft2', symbol: 'ft²', nameEn: 'Square Feet', nameBn: 'বর্গ ফুট', factor: 0.09290304, defaultPrecision: 1 },
  in2: { code: 'in2', symbol: 'in²', nameEn: 'Square Inch', nameBn: 'বর্গ ইঞ্চি', factor: 0.00064516, defaultPrecision: 0 },
}

/** Register a new length unit at runtime (extensibility requirement). */
export function registerLengthUnit(def: UnitDef): void {
  LENGTH_UNITS[def.code] = { ...def, factor: def.factor > 0 ? def.factor : 1 }
}

/** Register a new area unit at runtime (extensibility requirement). */
export function registerAreaUnit(def: UnitDef): void {
  AREA_UNITS[def.code] = { ...def, factor: def.factor > 0 ? def.factor : 1 }
}

export function isLengthUnit(v: unknown): v is LengthUnit {
  return typeof v === 'string' && v in LENGTH_UNITS
}

export function isAreaUnit(v: unknown): v is AreaUnit {
  return typeof v === 'string' && v in AREA_UNITS
}

export function isRounding(v: unknown): v is RoundingMode {
  return v === 'NEAREST' || v === 'UP' || v === 'DOWN'
}

export function lengthSymbol(u: LengthUnit): string {
  return (LENGTH_UNITS[u] ?? LENGTH_UNITS.m).symbol
}

export function areaSymbol(u: AreaUnit): string {
  return (AREA_UNITS[u] ?? AREA_UNITS.m2).symbol
}

// ------------------------------- Conversion ----------------------------------

const EPS = 1e-9

/** Convert any length value from one unit to another (pure, central logic). */
export function convertLen(value: number, from: LengthUnit, to: LengthUnit): number {
  const f = LENGTH_UNITS[from] ?? LENGTH_UNITS.m
  const t = LENGTH_UNITS[to] ?? LENGTH_UNITS.m
  return (value * f.factor) / t.factor
}

/** Convert any area value from one unit to another (pure, central logic). */
export function convertArea(value: number, from: AreaUnit, to: AreaUnit): number {
  const f = AREA_UNITS[from] ?? AREA_UNITS.m2
  const t = AREA_UNITS[to] ?? AREA_UNITS.m2
  return (value * f.factor) / t.factor
}

/** Internal meters → display-unit number. */
export function mToLen(meters: number, unit: LengthUnit): number {
  const u = LENGTH_UNITS[unit] ?? LENGTH_UNITS.m
  return meters / u.factor
}

/** Display-unit number → internal meters (for storing / calculations). */
export function lenToM(value: number, unit: LengthUnit): number {
  const u = LENGTH_UNITS[unit] ?? LENGTH_UNITS.m
  return value * u.factor
}

/** Internal m² → display-area-unit number. */
export function sqmToArea(sqm: number, unit: AreaUnit): number {
  const u = AREA_UNITS[unit] ?? AREA_UNITS.m2
  return sqm / u.factor
}

/** Display-area-unit number → internal m² (for storing / calculations). */
export function areaToSqm(value: number, unit: AreaUnit): number {
  const u = AREA_UNITS[unit] ?? AREA_UNITS.m2
  return value * u.factor
}

// ------------------------------- Rounding ------------------------------------

/** Round to `precision` decimals with the selected rounding mode. */
export function roundQty(value: number, precision: number, mode: RoundingMode = 'NEAREST'): number {
  const p = Math.max(0, Math.min(6, Math.round(precision)))
  const f = Math.pow(10, p)
  const x = value * f
  let r: number
  if (mode === 'UP') r = Math.ceil(x - EPS)
  else if (mode === 'DOWN') r = Math.floor(x + EPS)
  else r = Math.round(x)
  return r / f
}

/** toFixed then strip trailing zeros ("32.80" → "32.8", "1000.00" → "1000"). */
export function trimNum(value: number, precision: number): string {
  if (!Number.isFinite(value)) return '0'
  const s = value.toFixed(Math.max(0, Math.min(6, precision)))
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s
}

/** Effective precision for a length unit under prefs. */
export function effLenPrecision(p: UnitPrefs): number {
  if (p.lengthPrecision != null) return Math.max(0, Math.min(6, p.lengthPrecision))
  return (LENGTH_UNITS[p.lengthUnit] ?? LENGTH_UNITS.m).defaultPrecision
}

/** Effective precision for an area unit under prefs. */
export function effAreaPrecision(p: UnitPrefs): number {
  if (p.areaPrecision != null) return Math.max(0, Math.min(6, p.areaPrecision))
  return (AREA_UNITS[p.areaUnit] ?? AREA_UNITS.m2).defaultPrecision
}

// ------------------------------- Formatting ----------------------------------
// All formatters take INTERNAL units (meters / m²) and return DISPLAY strings.

/** Format internal meters as a display-unit number string (value only). */
export function fmtLen(meters: number, p: UnitPrefs, precisionOverride?: number | null): string {
  const prec = precisionOverride != null ? Math.max(0, Math.min(6, precisionOverride)) : effLenPrecision(p)
  return trimNum(roundQty(mToLen(meters, p.lengthUnit), prec, p.rounding), prec)
}

/** Format internal meters as "value symbol" (e.g. "32.81 ft"). */
export function fmtLenS(meters: number, p: UnitPrefs, precisionOverride?: number | null): string {
  return `${fmtLen(meters, p, precisionOverride)} ${lengthSymbol(p.lengthUnit)}`
}

/** Format internal m² as a display-area-unit number string (value only). */
export function fmtArea(sqm: number, p: UnitPrefs, precisionOverride?: number | null): string {
  const prec = precisionOverride != null ? Math.max(0, Math.min(6, precisionOverride)) : effAreaPrecision(p)
  return trimNum(roundQty(sqmToArea(sqm, p.areaUnit), prec, p.rounding), prec)
}

/** Format internal m² as "value symbol" (e.g. "107.64 ft²"). */
export function fmtAreaS(sqm: number, p: UnitPrefs, precisionOverride?: number | null): string {
  return `${fmtArea(sqm, p, precisionOverride)} ${areaSymbol(p.areaUnit)}`
}

// ------------------------- Well-known conversions ----------------------------
// Handy for the Settings preview card & sanity checks:
//   10 m = 32.8084 ft = 1000 cm = 10000 mm = 393.7008 in
export function exampleConversions(p: UnitPrefs): Array<{ from: string; to: string }> {
  const rows: Array<{ from: string; to: string }> = []
  rows.push({ from: `10 m = ${mToLen(10, p.lengthUnit).toFixed(4)} ${lengthSymbol(p.lengthUnit)}`, to: `10 m = ${mToLen(10, 'cm').toFixed(0)} cm` })
  rows.push({ from: `1 m² = ${sqmToArea(1, p.areaUnit).toFixed(4)} ${areaSymbol(p.areaUnit)}`, to: `1 ft = 0.3048 m (exact)` })
  return rows
}
