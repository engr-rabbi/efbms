
// =============================================================================
// symbols.tsx — SVG symbol library for the Floor Plan CAD editor.
// Every symbol is defined as data (Shape[]) inside a 24x24 unit box centered
// on the origin; the same data feeds the live React renderer AND the
// standalone-SVG export stringifier, so canvas and exports always match.
// =============================================================================

import React from 'react'

export type SymSystem = 'ELECTRICAL' | 'PLUMBING'
export type RouteSystem = 'cable' | 'pipe'

export interface SymbolDef {
  type: string
  label: string
  /** On-canvas footprint in meters (default 0.5). */
  sizeM?: number
  special?: boolean // DB / TANK / PUMP / RISER etc.
}

// ---------------------------------------------------------------------------
// Palette definitions
// ---------------------------------------------------------------------------

export const ELECTRICAL_DEFS: SymbolDef[] = [
  { type: 'LIGHT', label: 'Light' },
  { type: 'CEILING_FAN', label: 'Ceiling Fan' },
  { type: 'EXHAUST_FAN', label: 'Exhaust Fan' },
  { type: 'SWITCHBOARD', label: 'Switchboard' },
  { type: 'SOCKET', label: 'Socket' },
  { type: 'AC', label: 'A/C Unit' },
  { type: 'FRIDGE', label: 'Fridge' },
  { type: 'WASHING_MACHINE', label: 'Washing M/C' },
  { type: 'GEYSER', label: 'Geyser' },
  { type: 'KITCHEN_APPLIANCE', label: 'Kitchen Appl.' },
  { type: 'TV_DATA', label: 'TV / Data' },
  { type: 'EMERGENCY_LIGHT', label: 'Emergency Lt.' },
  { type: 'OUTDOOR_LIGHT', label: 'Outdoor Lt.' },
  { type: 'DEDICATED', label: 'Dedicated' },
  { type: 'DB', label: 'DB Board', sizeM: 0.65, special: true },
]

export const PLUMBING_DEFS: SymbolDef[] = [
  { type: 'WC', label: 'WC' },
  { type: 'BASIN', label: 'Basin' },
  { type: 'SINK', label: 'Sink' },
  { type: 'SHOWER', label: 'Shower' },
  { type: 'BIB_COCK', label: 'Bib Cock' },
  { type: 'FLOOR_DRAIN', label: 'Floor Drain' },
  { type: 'FLOOR_TRAP', label: 'Floor Trap' },
  { type: 'GEYSER', label: 'Geyser' },
  { type: 'TANK', label: 'Water Tank', sizeM: 0.9, special: true },
  { type: 'PUMP', label: 'Pump', special: true },
  { type: 'RISER', label: 'Riser', special: true },
]

export const ELEC_COLOR = '#b45309' // amber-700
export const PLUMB_COLOR = '#0e7490' // cyan-700

export function systemColor(system: SymSystem): string {
  return system === 'ELECTRICAL' ? ELEC_COLOR : PLUMB_COLOR
}

export function findSymbolDef(type: string, system: SymSystem): SymbolDef | undefined {
  const list = system === 'ELECTRICAL' ? ELECTRICAL_DEFS : PLUMBING_DEFS
  return list.find((d) => d.type === type)
}

// ---------------------------------------------------------------------------
// Route (cable / pipe) kind + spec tables
// ---------------------------------------------------------------------------

export const ALL_WIRE_SIZES = [1.5, 2.5, 4, 6, 10, 16, 25, 35]

export interface CableKindDef {
  color: string
  sizes: number[]
}

export const CABLE_KINDS: Record<string, CableKindDef> = {
  LIGHT: { color: '#d97706', sizes: [1.5, 2.5] },
  SOCKET: { color: '#7c3aed', sizes: [2.5, 4] },
  AC: { color: '#dc2626', sizes: [2.5, 4, 6] },
  GEYSER: { color: '#475569', sizes: [2.5, 4, 6] },
  KITCHEN: { color: '#57534e', sizes: [2.5, 4, 6] },
  WASHER: { color: '#64748b', sizes: [2.5] },
  FEEDER: { color: '#334155', sizes: [6, 10, 16, 25, 35] },
  SUBMAIN: { color: '#1e293b', sizes: [10, 16, 25, 35] },
  EARTH: { color: '#78716c', sizes: [2.5, 4, 6, 10, 16] },
}

export interface PipeKindDef {
  color: string
  specs: string[]
}

export const PIPE_KINDS: Record<string, PipeKindDef> = {
  COLD: { color: '#0284c7', specs: ['PPR-20', 'PPR-25', 'PPR-32'] },
  HOT: { color: '#dc2626', specs: ['PPR-20', 'PPR-25', 'PPR-32'] },
  SOIL: { color: '#4d7c0f', specs: ['PVC-110'] },
  WASTE: { color: '#a16207', specs: ['PVC-50', 'PVC-75'] },
  VENT: { color: '#7c3aed', specs: ['PVC-50', 'PVC-75'] },
  RAIN: { color: '#0e7490', specs: ['PVC-75', 'PVC-110'] },
}

export function cableColor(kind: string): string {
  return CABLE_KINDS[kind]?.color ?? '#475569'
}

export function pipeColor(kind: string): string {
  return PIPE_KINDS[kind]?.color ?? '#475569'
}

export function routeColor(system: RouteSystem, kind: string): string {
  return system === 'cable' ? cableColor(kind) : pipeColor(kind)
}

export function cableDefaultSpec(kind: string): string {
  return String(CABLE_KINDS[kind]?.sizes[0] ?? 2.5)
}

export function pipeDefaultSpec(kind: string): string {
  return PIPE_KINDS[kind]?.specs[0] ?? 'PPR-20'
}

/** Human label for a route, e.g. "LIGHT 2.5mm²" or "COLD PPR-20". */
export function routeLabel(system: RouteSystem, kind: string, spec: string): string {
  return system === 'cable' ? `${kind} ${spec}mm²` : `${kind} ${spec}`
}

// ---------------------------------------------------------------------------
// Shape data (24x24 unit box, origin at center, y-down)
// ---------------------------------------------------------------------------

export type Shape =
  | { t: 'c'; x: number; y: number; r: number } // circle (stroke)
  | { t: 'r'; x: number; y: number; w: number; h: number; rx?: number } // rect (stroke)
  | { t: 'l'; x1: number; y1: number; x2: number; y2: number } // line
  | { t: 'e'; x: number; y: number; rx: number; ry: number } // ellipse
  | { t: 'p'; d: string } // path (stroke)
  | { t: 'f'; d: string } // filled path
  | { t: 'fc'; x: number; y: number; r: number } // filled circle
  | { t: 't'; x: number; y: number; s: number; str: string } // centered text

function radialLines(n: number, r1: number, r2: number, offsetDeg: number): Shape[] {
  const out: Shape[] = []
  for (let i = 0; i < n; i++) {
    const a = ((offsetDeg + (360 / n) * i) * Math.PI) / 180
    out.push({
      t: 'l',
      x1: Math.cos(a) * r1,
      y1: Math.sin(a) * r1,
      x2: Math.cos(a) * r2,
      y2: Math.sin(a) * r2,
    })
  }
  return out
}

const SHAPES: Record<string, Shape[]> = {
  // ----- Electrical ---------------------------------------------------------
  LIGHT: [
    { t: 'c', x: 0, y: 0, r: 7 },
    { t: 'l', x1: -4.95, y1: -4.95, x2: 4.95, y2: 4.95 },
    { t: 'l', x1: -4.95, y1: 4.95, x2: 4.95, y2: -4.95 },
  ],
  CEILING_FAN: [
    { t: 'c', x: 0, y: 0, r: 8 },
    ...radialLines(3, 2.2, 8, -90),
    { t: 'fc', x: 0, y: 0, r: 1.8 },
  ],
  EXHAUST_FAN: [
    { t: 'r', x: -8, y: -8, w: 16, h: 16 },
    { t: 'c', x: 0, y: 0, r: 6 },
    ...radialLines(4, 0, 5.2, 45),
  ],
  SWITCHBOARD: [
    { t: 'r', x: -9, y: -6, w: 18, h: 12 },
    { t: 'l', x1: -3, y1: -6, x2: -3, y2: 6 },
    { t: 'l', x1: 3, y1: -6, x2: 3, y2: 6 },
    { t: 't', x: 0, y: 0, s: 5.5, str: 'SB' },
  ],
  SOCKET: [
    { t: 'p', d: 'M -7 3.5 A 7 7 0 0 1 7 3.5 Z' },
    { t: 'fc', x: -3, y: 0.5, r: 1.3 },
    { t: 'fc', x: 3, y: 0.5, r: 1.3 },
    { t: 'l', x1: 0, y1: 3.5, x2: 0, y2: 9 },
  ],
  AC: [
    { t: 'r', x: -9, y: -5, w: 18, h: 10 },
    { t: 't', x: 0, y: -0.5, s: 6.5, str: 'AC' },
    { t: 'l', x1: -5.5, y1: 7.5, x2: 5.5, y2: 7.5 },
  ],
  FRIDGE: [
    { t: 'r', x: -5, y: -8, w: 10, h: 16 },
    { t: 'l', x1: -5, y1: -3, x2: 5, y2: -3 },
    { t: 'l', x1: 2.5, y1: -6.5, x2: 2.5, y2: -4.5 },
  ],
  WASHING_MACHINE: [
    { t: 'r', x: -7, y: -7, w: 14, h: 14 },
    { t: 'c', x: 0, y: 0.5, r: 4.5 },
    { t: 'c', x: 0, y: 0.5, r: 2 },
  ],
  GEYSER: [
    { t: 'c', x: 0, y: 0, r: 7.5 },
    { t: 't', x: 0, y: 0.5, s: 7.5, str: 'G' },
    { t: 'l', x1: -4.5, y1: 10, x2: 4.5, y2: 10 },
  ],
  KITCHEN_APPLIANCE: [
    { t: 'r', x: -8, y: -6, w: 16, h: 12 },
    { t: 't', x: 0, y: 0, s: 6, str: 'KA' },
  ],
  TV_DATA: [
    { t: 'r', x: -8, y: -5.5, w: 16, h: 11 },
    { t: 't', x: 0, y: -0.5, s: 6, str: 'TV' },
    { t: 'l', x1: -3, y1: 5.5, x2: -1.5, y2: 8.5 },
    { t: 'l', x1: 3, y1: 5.5, x2: 1.5, y2: 8.5 },
    { t: 'l', x1: -2.5, y1: 8.5, x2: 2.5, y2: 8.5 },
  ],
  EMERGENCY_LIGHT: [
    { t: 'c', x: 0, y: 0, r: 7 },
    { t: 't', x: 0, y: 0.5, s: 7, str: 'E' },
    { t: 'l', x1: -4.5, y1: 10, x2: 4.5, y2: 10 },
  ],
  OUTDOOR_LIGHT: [
    { t: 'c', x: 0, y: 0, r: 4.5 },
    ...radialLines(4, 5.5, 9, 0),
    ...radialLines(4, 5.5, 9, 45),
  ],
  DEDICATED: [
    { t: 'c', x: 0, y: 0, r: 7 },
    { t: 't', x: 0, y: 0.5, s: 7, str: 'D' },
    { t: 'fc', x: 0, y: 10, r: 1.1 },
  ],
  DB: [
    { t: 'r', x: -10, y: -7, w: 20, h: 14 },
    { t: 't', x: 0, y: -2, s: 7, str: 'DB' },
    { t: 'l', x1: -6, y1: 3, x2: 6, y2: 3 },
  ],
  // ----- Plumbing -----------------------------------------------------------
  WC: [
    { t: 'r', x: -6, y: -11, w: 12, h: 5 },
    { t: 'e', x: 0, y: -2, rx: 6, ry: 4.5 },
    { t: 'p', d: 'M 0 2.5 C 4.5 4 4.5 8.5 0 9.5' },
  ],
  BASIN: [
    { t: 'e', x: 0, y: 0, rx: 7, ry: 5 },
    { t: 'r', x: -3, y: -8.5, w: 6, h: 3 },
  ],
  SINK: [
    { t: 'r', x: -8, y: -4, w: 16, h: 9 },
    { t: 'c', x: 0, y: 0.5, r: 2.8 },
    { t: 'l', x1: 0, y1: -4, x2: 0, y2: -8.5 },
    { t: 'l', x1: -2.5, y1: -8.5, x2: 2.5, y2: -8.5 },
  ],
  SHOWER: [
    { t: 'r', x: -2.5, y: -10.5, w: 5, h: 3 },
    { t: 'l', x1: -2, y1: -6.5, x2: -1.2, y2: -2 },
    { t: 'l', x1: 0, y1: -6.5, x2: 0, y2: -2 },
    { t: 'l', x1: 2, y1: -6.5, x2: 1.2, y2: -2 },
    { t: 'c', x: 0, y: 5, r: 2.2 },
  ],
  BIB_COCK: [
    { t: 'p', d: 'M -8 0 H 2 L 7 -3' },
    { t: 'c', x: -5, y: -3, r: 1.8 },
    { t: 'l', x1: 7, y1: -3, x2: 7, y2: 4 },
    { t: 'fc', x: 7, y: 5.5, r: 1.2 },
  ],
  FLOOR_DRAIN: [
    { t: 'r', x: -6, y: -6, w: 12, h: 12 },
    { t: 'l', x1: -6, y1: -6, x2: 6, y2: 6 },
    { t: 'l', x1: -6, y1: 6, x2: 6, y2: -6 },
    { t: 'fc', x: 0, y: 0, r: 1.5 },
  ],
  FLOOR_TRAP: [
    { t: 'c', x: 0, y: 0, r: 6.5 },
    { t: 'p', d: 'M -2.5 3.5 V -3 H 3' },
    { t: 'fc', x: 3, y: -3, r: 1.2 },
  ],
  TANK: [
    { t: 'r', x: -8, y: -8, w: 16, h: 16 },
    { t: 'p', d: 'M -6 -2 q 2 -2.5 4 0 t 4 0 t 4 0' },
    { t: 'p', d: 'M -6 3 q 2 -2.5 4 0 t 4 0 t 4 0' },
  ],
  PUMP: [
    { t: 'c', x: 0, y: 0, r: 7.5 },
    { t: 'f', d: 'M -3 3.5 L -3 -3.5 L 4.5 0 Z' },
  ],
  RISER: [
    { t: 'c', x: 0, y: 0, r: 5 },
    { t: 'l', x1: 0, y1: -9.5, x2: 0, y2: 9.5 },
  ],
}

export function symbolShapes(type: string): Shape[] {
  return SHAPES[type] ?? SHAPES.LIGHT
}

// ---------------------------------------------------------------------------
// React renderer (used inside the scaled world <g> of the canvas)
// ---------------------------------------------------------------------------

function shapeEls(shapes: Shape[], color: string, keyPrefix: string): React.ReactNode[] {
  return shapes.map((sh, i) => {
    const key = `${keyPrefix}${i}`
    const vs = { vectorEffect: 'non-scaling-stroke' as const }
    switch (sh.t) {
      case 'c':
        return <circle key={key} cx={sh.x} cy={sh.y} r={sh.r} {...vs} />
      case 'r':
        return <rect key={key} x={sh.x} y={sh.y} width={sh.w} height={sh.h} rx={sh.rx} {...vs} />
      case 'l':
        return <line key={key} x1={sh.x1} y1={sh.y1} x2={sh.x2} y2={sh.y2} {...vs} />
      case 'e':
        return <ellipse key={key} cx={sh.x} cy={sh.y} rx={sh.rx} ry={sh.ry} {...vs} />
      case 'p':
        return <path key={key} d={sh.d} {...vs} />
      case 'f':
        return <path key={key} d={sh.d} fill={color} stroke="none" />
      case 'fc':
        return <circle key={key} cx={sh.x} cy={sh.y} r={sh.r} fill={color} stroke="none" />
      case 't':
        return (
          <text
            key={key}
            x={sh.x}
            y={sh.y}
            dy={sh.s * 0.36}
            fontSize={sh.s}
            fill={color}
            stroke="none"
            textAnchor="middle"
            style={{ fontFamily: 'ui-sans-serif, system-ui, sans-serif', fontWeight: 600, userSelect: 'none' }}
          >
            {sh.str}
          </text>
        )
    }
  })
}

export interface SymbolGlyphProps {
  type: string
  system: SymSystem
  x: number
  y: number
  sizeM: number
  opacity?: number
}

/** Places one symbol glyph at world position (meters) inside the world group. */
export function SymbolGlyph({ type, system, x, y, sizeM, opacity = 1 }: SymbolGlyphProps) {
  const color = systemColor(system)
  const s = sizeM / 24
  return (
    <g
      transform={`translate(${x} ${y}) scale(${s})`}
      stroke={color}
      fill="none"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={opacity}
      pointerEvents="none"
    >
      {shapeEls(symbolShapes(type), color, 'g')}
    </g>
  )
}

/** Standalone small preview (palette buttons, legend). */
export function SymbolPreview({ type, system, size = 22 }: { type: string; system: SymSystem; size?: number }) {
  const color = systemColor(system)
  return (
    <svg viewBox="-13 -13 26 26" width={size} height={size} aria-hidden="true">
      <g stroke={color} fill="none" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        {shapeEls(symbolShapes(type), color, 'p')}
      </g>
    </svg>
  )
}

// ---------------------------------------------------------------------------
// SVG string renderer (for standalone SVG export)
// ---------------------------------------------------------------------------

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function shapeStr(sh: Shape, color: string): string {
  const vs = ' vector-effect="non-scaling-stroke"'
  switch (sh.t) {
    case 'c':
      return `<circle cx="${sh.x}" cy="${sh.y}" r="${sh.r}"${vs}/>`
    case 'r':
      return `<rect x="${sh.x}" y="${sh.y}" width="${sh.w}" height="${sh.h}"${sh.rx ? ` rx="${sh.rx}"` : ''}${vs}/>`
    case 'l':
      return `<line x1="${sh.x1}" y1="${sh.y1}" x2="${sh.x2}" y2="${sh.y2}"${vs}/>`
    case 'e':
      return `<ellipse cx="${sh.x}" cy="${sh.y}" rx="${sh.rx}" ry="${sh.ry}"${vs}/>`
    case 'p':
      return `<path d="${sh.d}"${vs}/>`
    case 'f':
      return `<path d="${sh.d}" fill="${color}" stroke="none"/>`
    case 'fc':
      return `<circle cx="${sh.x}" cy="${sh.y}" r="${sh.r}" fill="${color}" stroke="none"/>`
    case 't':
      return `<text x="${sh.x}" y="${sh.y + sh.s * 0.36}" font-size="${sh.s}" fill="${color}" stroke="none" text-anchor="middle" font-family="sans-serif" font-weight="600">${esc(sh.str)}</text>`
  }
}

/** One placed symbol as a standalone-SVG fragment (coordinates in meters). */
export function symbolSvgString(
  type: string,
  system: SymSystem,
  x: number,
  y: number,
  sizeM: number,
  opacity = 1,
): string {
  const color = systemColor(system)
  const s = sizeM / 24
  const body = symbolShapes(type)
    .map((sh) => shapeStr(sh, color))
    .join('')
  return `<g transform="translate(${x} ${y}) scale(${s})" stroke="${color}" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}">${body}</g>`
}
