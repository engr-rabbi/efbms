// =============================================================================
// geometry.ts — pure geometry / math helpers for the Floor Plan CAD editor.
// No React, no side effects. All coordinates are in METERS unless noted.
// =============================================================================

export interface Pt {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Grid snap used for rooms & routes (spec: 0.25 m). */
export const SNAP_GRID = 0.25
/** Minimum room dimension in meters. */
export const MIN_ROOM = 0.5

/** Snap a scalar to the nearest multiple of step. */
export function snap(v: number, step: number): number {
  return Math.round(v / step) * step
}

export function snapPt(p: Pt, step: number): Pt {
  return { x: snap(p.x, step), y: snap(p.y, step) }
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

export function dist(a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  return Math.sqrt(dx * dx + dy * dy)
}

/** Total length of a polyline (meters when points are meters). */
export function polylineLength(pts: Pt[]): number {
  let total = 0
  for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i])
  return total
}

/** Point at half the arc-length of a polyline (for labels). */
export function polylineMidpoint(pts: Pt[]): Pt {
  if (pts.length === 0) return { x: 0, y: 0 }
  if (pts.length === 1) return pts[0]
  let remain = polylineLength(pts) / 2
  for (let i = 1; i < pts.length; i++) {
    const d = dist(pts[i - 1], pts[i])
    if (remain <= d && d > 0) {
      const t = remain / d
      return {
        x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t,
        y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t,
      }
    }
    remain -= d
  }
  return pts[pts.length - 1]
}

/** Shortest distance from point p to segment a-b. */
export function pointSegDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return dist(p, a)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  t = clamp(t, 0, 1)
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy })
}

export function pointInRect(p: Pt, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
}

/** Normalized rectangle from two drag corners. */
export function rectFrom(a: Pt, b: Pt): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  }
}

/** Remove consecutive duplicate points (double-click finish adds one). */
export function dedupePoints(pts: Pt[]): Pt[] {
  const out: Pt[] = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (!last || Math.abs(last.x - p.x) > 1e-6 || Math.abs(last.y - p.y) > 1e-6) out.push(p)
  }
  return out
}

/** Bounding box of an arbitrary point list; null when empty. */
export function bboxOfPoints(pts: Pt[]): Rect | null {
  if (pts.length === 0) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const p of pts) {
    if (p.x < x0) x0 = p.x
    if (p.y < y0) y0 = p.y
    if (p.x > x1) x1 = p.x
    if (p.y > y1) y1 = p.y
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Union of two rects (either may be null). */
export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b
  if (!b) return a
  const x0 = Math.min(a.x, b.x)
  const y0 = Math.min(a.y, b.y)
  const x1 = Math.max(a.x + a.w, b.x + b.w)
  const y1 = Math.max(a.y + a.h, b.y + b.h)
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Expand a rect by padding on all sides. */
export function padRect(r: Rect, pad: number): Rect {
  return { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 }
}

/** Format meters for labels: trims trailing zeros ("4.20" -> "4.2"). */
export function fmtM(v: number): string {
  const s = (Math.round(v * 100) / 100).toFixed(2)
  return s.replace(/\.?0+$/, '')
}

export function round2(v: number): number {
  return Math.round(v * 100) / 100
}

let seq = 0
/** Collision-proof local id generator (no external deps). */
export function uid(prefix: string): string {
  seq += 1
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 7)}`
}
